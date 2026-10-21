import { AudioEngine } from '../../engine/audio/AudioEngine.js';
import { RainSound } from './sounds/RainSound.js';
import { WindSound } from './sounds/WindSound.js';
import { FireSound } from './sounds/FireSound.js';
import { WildlifeSound } from './sounds/WildlifeSound.js';
import { Footsteps } from './sounds/Footsteps.js';
import { GuitarSound } from './sounds/GuitarSound.js';
import { EV } from '../../config/events.ts';

// Orchestrates the whole forest soundscape. Must be started from a user
// gesture (the "enter the forest" button) because of browser autoplay rules.
// It listens on the event bus for what makes a sound (steps, the guitar,
// animals) and lowers the ambience while the introductions speak.

export class Soundscape {
  constructor(world, events) {
    this.world = world;
    this.engine = new AudioEngine();
    this.rain = new RainSound(this.engine, world);
    this.wind = new WindSound(this.engine, world);
    this.fire = new FireSound(this.engine, world);
    this.wildlife = new WildlifeSound(this.engine, world);
    this.steps = new Footsteps(this.engine);
    this.guitar = new GuitarSound(this.engine);
    this.started = false;
    if (events) {
      events.on(EV.PLAYER_STEP, (info) => this.footstep(info));
      events.on(EV.GUITAR_STRUM, ({ position, chord, down, velocity }) => this.strum(position, chord, down, velocity));
      events.on(EV.CREATURE_SOUND, ({ type, source }) => this.onEvent(type, source));
      events.on(EV.INTRO_DUCK, (on) => this.engine.setDucking(on));
    }
  }

  async start() {
    await this.engine.init();
    if (this.started) return;
    this.rain.start();
    this.wind.start();
    this.fire.start();
    this.wildlife.start();
    this.steps.start();
    this.guitar.start();
    this.started = true;
  }

  onEvent(type, src) {
    if (this.started) this.wildlife.onEvent(type, src);
  }

  // a recorded voice line from the manifest, spoken from a world position.
  // Returns { duration, level() } (level = current loudness 0..1, for lip
  // sync), or null if there is no recording.
  // `flat`: narration (the film-style introductions) - centred, not placed
  // in 3D, so it doesn't jump between ears when the camera cuts.
  playVoice(key, pos, { duck = true, flat = false } = {}) {
    if (!this.started) return null;
    const buf = this.engine.file(key);
    if (!buf) return null;
    const ctx = this.engine.ctx;
    // close, dry and only gently attenuated so every word is clear
    let p;
    if (flat) {
      p = ctx.createGain();
      p.gain.value = 1;
      p.connect(this.engine.buses.voices);
      const s = ctx.createGain();
      s.gain.value = 0.05;
      p.connect(s).connect(this.engine.reverbIn);
    } else p = this.engine.panner(pos, 'voices', { ref: 4, rolloff: 0.5, max: 60, reverb: 0.05 });
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.connect(p);
    if (duck) this.engine.setDucking(true);
    const src = this.engine.oneShot(buf, an, { when: 0.25 }); // after the ambience has dipped
    const data = new Float32Array(an.fftSize);
    let ended = false;
    src.addEventListener('ended', () => { ended = true; an.disconnect(); if (duck) this.engine.setDucking(false); });
    return {
      duration: buf.duration + 0.25,
      get done() { return ended; },
      stop() { if (!ended) try { src.stop(); } catch { /* not started yet */ } },
      level() {
        if (ended) return 0;
        an.getFloatTimeDomainData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        return Math.min(1, Math.sqrt(s / data.length) * 6);
      },
    };
  }

  strum(pos, chord, down, velocity) {
    if (this.started) this.guitar.strum(pos, chord, down, velocity);
  }

  footstep(info) {
    if (this.started) this.steps.step(info);
  }

  update(dt, camera, env, wind) {
    if (!this.started) return;
    this.engine.updateListener(camera);
    const listener = camera.position;
    this.rain.update(dt, listener);
    this.wind.update(dt, listener, wind);
    this.fire.update(dt);
    this.wildlife.update(dt, listener, env);
  }

  get state() { return this.engine.ctx ? this.engine.ctx.state : 'none'; }
}
