import { loopBuffer, makeBuffer, addClick, biquad, normalize } from '../../../engine/audio/dsp.js';
import { rnd } from './shared.js';

// The little supermarket: the drink fridges' low hum (clear inside, a faint
// murmur through the walls), and the small brass bell over the door that
// jingles when it opens, with the hinge's creak.

export class StoreSound {
  constructor(engine, world) {
    this.e = engine;
    this.world = world;
  }

  start() {
    const store = this.world.store;
    if (!store) return;
    const e = this.e, ctx = e.ctx;

    // fridge hum: mains hum and its harmonics, a compressor's rattle, a fan's hiss
    const hum = loopBuffer(ctx, 6.1, 1, (d, sr) => {
      const parts = [[50, 0.25], [100, 1], [150, 0.3], [200, 0.22], [300, 0.08], [400, 0.05]];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let v = 0;
        for (const [f, a] of parts) v += Math.sin(2 * Math.PI * f * t + f) * a;
        // slow beating, as two old compressors drift against each other
        v *= 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.33 * t);
        d[i] = v * 0.4 + (Math.random() * 2 - 1) * 0.05;
      }
      biquad(d, sr, 'lowpass', 1400, 0.7);
      normalize(d, 0.5);
    });
    this.humPanner = e.panner(store.fridgeCenter, 'fire', { ref: 0.9, rolloff: 1.8, max: 40, reverb: 0.03 });
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 300;
    this.humLevel = ctx.createGain();
    this.humLevel.gain.value = 0.15;
    this.humLevel.connect(this.humFilter).connect(this.humPanner);
    e.loop(hum, this.humLevel, { gain: 0.32 });

    // the door bell: a few strikes of a small brass bell (inharmonic partials)
    this.bells = [];
    for (let v = 0; v < 3; v++) {
      const f0 = rnd(1750, 2150);
      this.bells.push(makeBuffer(ctx, 1.6, 1, (d, sr) => {
        const partials = [[1, 1, 0.5], [2.32, 0.55, 0.32], [4.25, 0.3, 0.16], [6.63, 0.16, 0.09]];
        const strikes = [0, rnd(0.09, 0.13), rnd(0.21, 0.27), rnd(0.36, 0.44)];
        strikes.forEach((at, k) => {
          const amp = [1, 0.7, 0.5, 0.28][k] * rnd(0.85, 1.1);
          const i0 = Math.floor(at * sr);
          for (const [ratio, a, decay] of partials) {
            const f = f0 * ratio * rnd(0.995, 1.005);
            for (let i = 0; i + i0 < d.length; i++) {
              const t = i / sr;
              const env = Math.exp(-t / decay);
              if (env < 0.001) break;
              d[i0 + i] += Math.sin(2 * Math.PI * f * t) * a * amp * env * Math.min(1, t * 2000);
            }
          }
          addClick(d, sr, i0, 0.0008, 0.3 * amp);
        });
        normalize(d, 0.7);
      }));
    }
    // the hinge: a short stick-slip creak
    this.creaks = [];
    for (let v = 0; v < 2; v++) {
      this.creaks.push(makeBuffer(ctx, 0.7, 1, (d, sr) => {
        let t = 0.02;
        const len = rnd(0.45, 0.6);
        while (t < len) {
          const k = t / len;
          addClick(d, sr, Math.floor(t * sr), 0.0012, 0.6 * Math.sin(k * Math.PI));
          t += 1 / (rnd(140, 180) + 90 * Math.sin(k * Math.PI * 1.5));
        }
        biquad(d, sr, 'bandpass', rnd(700, 1100), 4);
        normalize(d, 0.5);
      }));
    }
    this.doorPanner = e.panner(store.doorWorld, 'steps', { ref: 1.4, rolloff: 1.3, max: 60, reverb: 0.06 });
    this.started = true;
  }

  /** the door swings open: bell and creak */
  door() {
    if (!this.started) return;
    const e = this.e;
    e.oneShot(this.bells[Math.floor(Math.random() * this.bells.length)], this.doorPanner, { gain: 0.55, when: 0.05 });
    e.oneShot(this.creaks[Math.floor(Math.random() * this.creaks.length)], this.doorPanner, { gain: 0.35, rate: rnd(0.9, 1.1) });
  }

  update() {
    if (!this.started) return;
    const store = this.world.store;
    const inside = store.playerInside;
    const t = this.e.ctx.currentTime;
    this.humLevel.gain.setTargetAtTime(inside ? 1 : 0.15, t, 0.4);
    this.humFilter.frequency.setTargetAtTime(inside ? 1400 : 300, t, 0.4);
  }
}
