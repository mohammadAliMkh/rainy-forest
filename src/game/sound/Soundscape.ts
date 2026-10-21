import type * as THREE from 'three';
import { AudioEngine } from '../../engine/audio/AudioEngine.js';
import { RainSound } from './sounds/RainSound.js';
import { WindSound } from './sounds/WindSound.js';
import { FireSound } from './sounds/FireSound.js';
import { WildlifeSound } from './sounds/WildlifeSound.js';
import { Footsteps } from './sounds/Footsteps.js';
import { GuitarSound } from './sounds/GuitarSound.js';
import { ThunderSound } from './sounds/ThunderSound.js';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';

// Orchestrates the whole forest soundscape. Must be started from a user
// gesture (the "enter the forest" button) because of browser autoplay rules.
// It listens on the event bus for what makes a sound (steps, the guitar,
// animals) and lowers the ambience while the introductions speak.

/** a recording that is playing: how long it is, whether it ended, its loudness now */
export interface VoiceHandle {
  duration: number;
  readonly done: boolean;
  stop(): void;
  /** current loudness 0..1 (for lip sync) */
  level(): number;
}

type CreatureSound = GameEvents[typeof EV.CREATURE_SOUND];

export class Soundscape {
  readonly engine = new AudioEngine();
  readonly rain: RainSound;
  readonly wind: WindSound;
  readonly fire: FireSound;
  readonly wildlife: WildlifeSound;
  readonly steps: Footsteps;
  readonly guitar: GuitarSound;
  readonly thunder: ThunderSound;
  started = false;

  /** world: what the ambient layers listen to (terrain, fire, creatures) */
  constructor(world: object, events?: EventBus<GameEvents>) {
    this.rain = new RainSound(this.engine, world);
    this.wind = new WindSound(this.engine, world);
    this.fire = new FireSound(this.engine, world);
    this.wildlife = new WildlifeSound(this.engine, world);
    this.steps = new Footsteps(this.engine);
    this.guitar = new GuitarSound(this.engine);
    this.thunder = new ThunderSound(this.engine);
    if (events) {
      events.on(EV.LIGHTNING, ({ strength, delay }) => { if (this.started) this.thunder.rumble(strength, delay); });
      events.on(EV.PLAYER_STEP, (info) => this.footstep(info));
      events.on(EV.GUITAR_STRUM, ({ position, chord, down, velocity }) => this.strum(position, chord, down, velocity));
      events.on(EV.CREATURE_SOUND, (sound) => this.onEvent(sound));
      events.on(EV.INTRO_DUCK, (on) => this.engine.setDucking(on));
    }
  }

  async start(): Promise<void> {
    await this.engine.init();
    if (this.started) return;
    this.rain.start();
    this.wind.start();
    this.fire.start();
    this.wildlife.start();
    this.steps.start();
    this.guitar.start();
    this.thunder.start();
    this.started = true;
  }

  onEvent(sound: CreatureSound): void {
    if (this.started) this.wildlife.onEvent(sound.type, sound.source);
  }

  // a recorded voice line from the manifest, spoken from a world position,
  // or null if there is no recording.
  // `flat`: narration (the film-style introductions) - centred, not placed
  // in 3D, so it doesn't jump between ears when the camera cuts.
  playVoice(key: string, pos: THREE.Vector3, { duck = true, flat = false } = {}): VoiceHandle | null {
    if (!this.started) return null;
    const file = this.engine.file(key);
    if (!file || Array.isArray(file)) return null;
    const buf = file;
    const engine = this.engine;
    const ctx = engine.ctx!;
    // close, dry and only gently attenuated so every word is clear
    let p: AudioNode;
    if (flat) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(engine.buses!.voices); // buses and reverb exist once started
      const s = ctx.createGain();
      s.gain.value = 0.05;
      g.connect(s).connect(engine.reverbIn!);
      p = g;
    } else p = engine.panner(pos, 'voices', { ref: 4, rolloff: 0.5, max: 60, reverb: 0.05 });
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    an.connect(p);
    if (duck) engine.setDucking(true);
    const src = engine.oneShot(buf, an, { when: 0.25 }); // after the ambience has dipped
    const data = new Float32Array(an.fftSize);
    let ended = false;
    src.addEventListener('ended', () => { ended = true; an.disconnect(); if (duck) engine.setDucking(false); });
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

  strum(pos: THREE.Vector3, chord: number, down: boolean, velocity: number): void {
    if (this.started) this.guitar.strum(pos, chord, down, velocity);
  }

  footstep(info: GameEvents[typeof EV.PLAYER_STEP]): void {
    if (this.started) this.steps.step(info);
  }

  /** how hard it rains (0..1) and how wet the leaves still are */
  setRain(intensity: number, wetness: number): void {
    this.rain.setIntensity(intensity, wetness);
  }

  update(dt: number, camera: THREE.Camera, env: { birdActivity: number }, wind: { strength: number }): void {
    if (!this.started) return;
    this.engine.updateListener(camera);
    const listener = camera.position;
    this.rain.update(dt, listener);
    this.wind.update(dt, listener, wind);
    this.fire.update(dt);
    this.wildlife.update(dt, listener, env);
  }

  get state(): string { return this.engine.ctx ? this.engine.ctx.state : 'none'; }
}
