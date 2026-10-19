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
