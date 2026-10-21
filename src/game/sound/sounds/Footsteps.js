import { makeBuffer, addClick, addTick, biquad, normalize } from '../../../engine/audio/dsp.js';
import { rnd, pick } from './shared.js';

// Player footsteps on wet ground: soft leaf-litter crunch, muddy squelch on
// the trail, splashes in puddles, and hollow knocks on wooden boards (the
// shop's porch and floor). Several pre-rendered variants per
// surface + random pitch so consecutive steps never sound identical.

function thud(d, sr, amp) {
  let lp = 0;
  for (let i = 0; i < sr * 0.07; i++) {
    const t = i / sr;
    lp += ((Math.random() * 2 - 1) - lp) * 0.05;
    d[i] += lp * amp * 6 * (t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / 0.018));
  }
}

export class Footsteps {
  constructor(engine) { this.e = engine; }

  start() {
    const ctx = this.e.ctx;
    this.out = ctx.createStereoPanner();
    this.out.connect(this.e.buses.steps);
    const send = ctx.createGain(); send.gain.value = 0.08;
    this.out.connect(send).connect(this.e.reverbIn);

    const variants = (fn) => [0, 1, 2, 3, 4, 5].map(() => makeBuffer(ctx, 0.45, 1, (d, sr) => { fn(d, sr); normalize(d, 0.8); }));

    this.buffers = {
      leaves: variants((d, sr) => {
        thud(d, sr, 0.55);
        // damp rustle
        const n = Math.floor(sr * rnd(0.12, 0.2));
        const off = Math.floor(sr * 0.008);
        const tmp = new Float32Array(n);
        for (let i = 0; i < n; i++) tmp[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.35)) * 0.35;
        biquad(tmp, sr, 'bandpass', rnd(1400, 2600), 0.7);
        for (let i = 0; i < n; i++) d[off + i] += tmp[i];
        // soft wet crunches
        const k = 6 + Math.floor(Math.random() * 10);
        for (let j = 0; j < k; j++) addClick(d, sr, off + Math.floor(sr * rnd(0, 0.14)), rnd(0.0005, 0.002), rnd(0.03, 0.16));
        // twig snap sometimes
        if (Math.random() < 0.18) addTick(d, sr, off + Math.floor(sr * rnd(0.02, 0.06)), rnd(1800, 3200), 0.0025, 0.35);
      }),
      mud: variants((d, sr) => {
        thud(d, sr, 0.7);
        const off = Math.floor(sr * rnd(0.02, 0.05));
        // suction squelch: rising "bubble" chirps + filtered wet noise
        const n = Math.floor(sr * 0.16);
        const tmp = new Float32Array(n);
        for (let i = 0; i < n; i++) tmp[i] = (Math.random() * 2 - 1) * Math.sin((i / n) * Math.PI) * 0.4;
        biquad(tmp, sr, 'bandpass', rnd(600, 1000), 2.5);
        for (let i = 0; i < n; i++) d[off + i] += tmp[i];
        for (let b = 0; b < 2 + Math.floor(Math.random() * 3); b++) {
          const at = off + Math.floor(sr * rnd(0.03, 0.14));
          const f0 = rnd(220, 420);
          let ph = 0;
          for (let i = 0; i < sr * 0.04; i++) {
            const t = i / sr;
            ph += (2 * Math.PI * f0 * (1 + t * 30)) / sr;
            d[at + i] += Math.sin(ph) * Math.exp(-t / 0.012) * rnd(0.1, 0.25);
          }
        }
      }),
      wood: variants((d, sr) => {
        // a hollow board: low "tok" with a short body resonance, a little creak sometimes
        const f0 = rnd(150, 210);
        let ph = 0;
        for (let i = 0; i < sr * 0.12; i++) {
          const t = i / sr;
          ph += (2 * Math.PI * f0 * (1 - t * 1.2)) / sr;
          d[i] += Math.sin(ph) * Math.min(1, t / 0.002) * Math.exp(-t / 0.03) * 0.7;
        }
        addClick(d, sr, 0, rnd(0.0008, 0.0016), 0.45);
        addTick(d, sr, Math.floor(sr * 0.002), rnd(700, 1100), 0.006, 0.25);
        if (Math.random() < 0.3) {
          // creak: a slow, rough, rising squeak, quiet
          const at = Math.floor(sr * rnd(0.03, 0.08)), n = Math.floor(sr * rnd(0.08, 0.16));
          const c0 = rnd(380, 620);
          let cp = 0;
          for (let i = 0; i < n; i++) {
            const t = i / sr;
            cp += (2 * Math.PI * c0 * (1 + t * 2)) / sr;
            const grain = (Math.random() < 0.5 ? 1 : 0.4);
            d[at + i] += Math.sin(cp) * Math.sin((i / n) * Math.PI) * grain * 0.07;
          }
        }
        biquad(d, sr, 'lowpass', 2600, 0.7);
      }),
      water: variants((d, sr) => {
        thud(d, sr, 0.35);
        const n = Math.floor(sr * 0.25);
        const tmp = new Float32Array(n);
        for (let i = 0; i < n; i++) tmp[i] = (Math.random() * 2 - 1) * (i < 200 ? i / 200 : Math.exp(-(i - 200) / (sr * 0.06))) * 0.6;
        biquad(tmp, sr, 'highpass', 900, 0.7);
        for (let i = 0; i < n; i++) d[i] += tmp[i];
        for (let k = 0; k < 7; k++) {
          const at = Math.floor(sr * rnd(0.03, 0.3));
          const f0 = rnd(900, 2400);
          let ph = 0;
          for (let i = 0; i < sr * 0.05; i++) {
            const t = i / sr;
            ph += (2 * Math.PI * f0 * (1 + Math.min(1.5, t / 0.012))) / sr;
            d[at + i] += Math.sin(ph) * Math.exp(-t / 0.015) * rnd(0.05, 0.2);
          }
        }
      }),
    };
    this.started = true;
  }

  step({ surface, running, side }) {
    if (!this.started) return;
    const buf = pick(this.buffers[surface] || this.buffers.leaves);
    this.out.pan.setTargetAtTime(side * 0.12, this.e.ctx.currentTime, 0.01);
    this.e.oneShot(buf, this.out, { gain: (running ? 0.85 : 0.5) * rnd(0.8, 1.1), rate: rnd(0.88, 1.12) * (running ? 1.08 : 1) });
  }
}
