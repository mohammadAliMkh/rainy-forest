import { makeBuffer, biquad, normalize } from '../../../engine/audio/dsp.js';

// Amin's acoustic guitar: plucked-string (Karplus-Strong) chords rendered
// once at start - Am, F, C, G - as down and up strums, then played from his
// position whenever his strumming hand hits the strings.

const CHORDS = [
  [110.0, 164.81, 220.0, 261.63, 329.63],          // Am  x02210
  [130.81, 174.61, 220.0, 261.63, 349.23],         // F   x33211
  [130.81, 164.81, 196.0, 261.63, 329.63],         // C   x32010
  [98.0, 123.47, 146.83, 196.0, 246.94, 392.0],    // G   320003
];

function pluck(d, sr, at, freq, amp) {
  const N = Math.max(2, Math.round(sr / freq));
  const ring = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = prev * 0.45 + w * 0.55; ring[i] = prev; } // softer pick
  let k = 0;
  for (let i = at; i < d.length; i++) {
    const v = ring[k];
    const n = ring[(k + 1) % N];
    ring[k] = 0.9965 * 0.5 * (v + n);
    d[i] += v * amp;
    k = (k + 1) % N;
  }
}

export class GuitarSound {
  constructor(engine) {
    this.e = engine;
    this.buffers = null;
    this.panner = null;
  }

  start() {
    const ctx = this.e.ctx;
    const make = (freqs, down) => makeBuffer(ctx, 2.4, 1, (d, sr) => {
      const order = down ? freqs : freqs.slice(-4).reverse();
      order.forEach((f, j) => pluck(d, sr, Math.floor((0.004 + j * (down ? 0.014 : 0.01)) * sr), f, down ? 0.5 - j * 0.03 : 0.32));
      biquad(d, sr, 'highpass', 75, 0.7);
      biquad(d, sr, 'peak', 210, 1.0, 4); // body resonance
      biquad(d, sr, 'lowpass', 4200, 0.6);
      normalize(d, down ? 0.75 : 0.5);
    });
    this.buffers = CHORDS.map((c) => ({ down: make(c, true), up: make(c, false) }));
  }

  strum(pos, chord, down, velocity = 1) {
    if (!this.buffers) return;
    // carries across the camp: louder, and fades more slowly with distance
    if (!this.panner) this.panner = this.e.panner(pos, 'music', { ref: 2.6, rolloff: 1.0, reverb: 0.25 });
    const b = this.buffers[chord % this.buffers.length];
    this.e.oneShot(down ? b.down : b.up, this.panner, { gain: velocity * 1.5, rate: 1 + (Math.random() - 0.5) * 0.004 });
  }
}
