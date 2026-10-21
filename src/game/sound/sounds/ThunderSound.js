import { makeBuffer, biquad, normalize } from '../../../engine/audio/dsp.js';
import { rnd } from './shared.js';

// Distant thunder: a soft, low, rolling rumble that swells in and fades out
// over several seconds - no sharp crack, nothing startling. A few variations
// are rendered once; each lightning plays one, quieter the farther it was.

function rumble(ctx) {
  // a few rolling swells: slow rise, long tail (the same in both ears)
  const swells = [];
  let t = rnd(0.2, 0.6);
  for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) { swells.push({ t, a: rnd(0.5, 1) * (k === 0 ? 1 : 0.8), w: rnd(0.5, 1.2) }); t += rnd(0.5, 1.6); }
  return makeBuffer(ctx, 9, 2, (d, sr) => {
    // brown noise (deep, soft; different in each ear, so it sounds wide)
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; }
    for (let i = 0; i < d.length; i++) {
      const x = i / sr;
      let env = 0;
      for (const s of swells) {
        const dx = x - s.t;
        env += s.a * (dx < 0 ? Math.exp(-((dx / (s.w * 0.6)) ** 2)) : Math.exp(-dx / (s.w * 1.6)));
      }
      d[i] *= Math.min(1.2, env) * Math.min(1, x / 0.5); // never starts abruptly
    }
    biquad(d, sr, 'lowpass', 140, 0.6);
    biquad(d, sr, 'lowpass', 220, 0.5);
    biquad(d, sr, 'highpass', 28, 0.7);
    normalize(d, 0.8);
  });
}

export class ThunderSound {
  constructor(engine) {
    this.e = engine;
    this.buffers = null;
  }

  start() {
    const ctx = this.e.ctx;
    this.buffers = [rumble(ctx), rumble(ctx), rumble(ctx)];
    // not placed in 3D (it's all around, far away): straight to the rain bus, plenty of echo
    this.out = ctx.createGain();
    this.out.connect(this.e.buses.rain);
    const send = ctx.createGain();
    send.gain.value = 0.35;
    this.out.connect(send).connect(this.e.reverbIn);
  }

  // strength 0..1 (closer = a little louder), after `delay` seconds
  rumble(strength, delay) {
    if (!this.buffers) return;
    const b = this.buffers[Math.floor(Math.random() * this.buffers.length)];
    this.e.oneShot(b, this.out, { gain: 0.35 + strength * 0.35, rate: rnd(0.85, 1.05), when: delay });
  }
}
