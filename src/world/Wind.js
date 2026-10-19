import { windUniforms } from '../core/shaderPatches.js';
import { createNoise2D, mulberry32 } from '../utils/noise.js';

// One shared, slowly varying wind signal. It drives foliage sway, rain slant,
// smoke & mist drift AND the wind / leaf-rustle audio, so what you see and
// what you hear move together.

export class Wind {
  constructor() {
    this.noise = createNoise2D(mulberry32(555));
    this.strength = 0.5;
    this.gust = 0;
    this.angle = 0.6;
    this._gustTimer = 6;
    this._gustTarget = 0;
  }

  update(dt, time) {
    const base = 0.38 + 0.22 * this.noise(time * 0.03, 1.7) + 0.08 * this.noise(time * 0.11, 9.1);
    // occasional soft gusts
    this._gustTimer -= dt;
    if (this._gustTimer <= 0) {
      this._gustTarget = Math.random() < 0.55 ? 0.25 + Math.random() * 0.45 : 0;
      this._gustTimer = 4 + Math.random() * 10;
    }
    this.gust += (this._gustTarget - this.gust) * Math.min(1, dt * 0.45);
    this.strength = Math.max(0.08, base + this.gust);
    this.angle = 0.6 + this.noise(time * 0.01, 3.3) * 0.7;
    windUniforms.uTime.value = time;
    windUniforms.uWind.value = this.strength;
    windUniforms.uWindDir.value.set(Math.cos(this.angle), Math.sin(this.angle));
  }
}
