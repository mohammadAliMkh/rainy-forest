import { AudioEngine } from './AudioEngine.js';
import { RainSound } from './sounds/RainSound.js';
import { WindSound } from './sounds/WindSound.js';
import { FireSound } from './sounds/FireSound.js';
import { WildlifeSound } from './sounds/WildlifeSound.js';
import { Footsteps } from './sounds/Footsteps.js';

// Orchestrates the whole forest soundscape. Must be started from a user
// gesture (the "enter the forest" button) because of browser autoplay rules.

export class Soundscape {
  constructor(world) {
    this.world = world;
    this.engine = new AudioEngine();
    this.rain = new RainSound(this.engine, world);
    this.wind = new WindSound(this.engine, world);
    this.fire = new FireSound(this.engine, world);
    this.wildlife = new WildlifeSound(this.engine, world);
    this.steps = new Footsteps(this.engine);
    this.started = false;
  }

  async start() {
    await this.engine.init();
    if (this.started) return;
    this.rain.start();
    this.wind.start();
    this.fire.start();
    this.wildlife.start();
    this.steps.start();
    this.started = true;
  }

  onEvent(type, src) {
    if (this.started) this.wildlife.onEvent(type, src);
  }

  // a recorded voice line from the manifest, spoken from a world position.
  // Returns { duration, level() } (level = current loudness 0..1, for lip
  // sync), or null if there is no recording.
  playVoice(key, pos) {
    if (!this.started) return null;
    const buf = this.engine.file(key);
    if (!buf) return null;
    const ctx = this.engine.ctx;
    const p = this.engine.panner(pos, 'voices', { ref: 1.6, rolloff: 1.1, max: 60, reverb: 0.12 });
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.connect(p);
    const src = this.engine.oneShot(buf, an);
    const data = new Float32Array(an.fftSize);
    let ended = false;
    src.addEventListener('ended', () => { ended = true; an.disconnect(); });
    return {
      duration: buf.duration,
      level() {
        if (ended) return 0;
        an.getFloatTimeDomainData(data);
        let s = 0;
        for (let i = 0; i < data.length; i++) s += data[i] * data[i];
        return Math.min(1, Math.sqrt(s / data.length) * 6);
      },
    };
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
