import { loopBuffer, makeBuffer, addTick, addClick, biquad, normalize } from '../dsp.js';
import { PannerPool, rnd, pick } from './shared.js';
import { PUDDLES } from '../../core/config.js';

// Rain: a wide stereo bed (canopy hiss + thousands of tiny droplet ticks),
// rain drumming on the cabin roof (positional), eave drips, and 3D drips /
// puddle plinks that happen around the listener.

export class RainSound {
  constructor(engine, world) {
    this.e = engine;
    this.world = world;
  }

  start() {
    const e = this.e, ctx = e.ctx, bus = e.buses.rain;
    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 1;
    this.bedGain.connect(bus);

    const file = e.file('rain_loop');
    if (file) {
      e.loop(file, this.bedGain, { gain: 0.9 });
    } else {
      // canopy hiss
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 650;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      hp.connect(lp).connect(this.bedGain);
      this.hiss = e.loop(e.noise.pink, hp, { gain: 0.16 });
      // droplet patter: two independent, differently sized loops
      const patter = (seconds, rate, seedShift) => loopBuffer(ctx, seconds, 2, (d, sr) => {
        const count = Math.floor((d.length / sr) * rate);
        for (let k = 0; k < count; k++) {
          const at = Math.floor(Math.random() * (d.length - 2000));
          const amp = 0.012 + 0.22 * Math.pow(Math.random(), 5);
          if (Math.random() < 0.55) addTick(d, sr, at, 2200 + Math.random() * 5500 + seedShift, 0.0005 + Math.random() * 0.0014, amp);
          else addClick(d, sr, at, 0.0006 + Math.random() * 0.0018, amp * 0.9);
        }
        biquad(d, sr, 'highpass', 900, 0.7);
        normalize(d, 0.55);
      });
      this.patterA = e.loop(patter(7.3, 300, 0), this.bedGain, { gain: 0.55 });
      this.patterB = e.loop(patter(9.7, 180, 600), this.bedGain, { gain: 0.38, rate: 0.94 });
      // soft low wash
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 320;
      lp2.connect(this.bedGain);
      e.loop(e.noise.brown, lp2, { gain: 0.1 });
    }

    // rain on the cabin roof
    const roofFile = e.file('roof_rain_loop');
    this.roofPanner = e.panner(this.world.cabin.roofCenter, 'rain', { ref: 3.2, rolloff: 1.3, reverb: 0.12 });
    if (roofFile) e.loop(roofFile, this.roofPanner, { gain: 0.8 });
    else {
      const roof = loopBuffer(ctx, 8.3, 1, (d, sr) => {
        const count = Math.floor((d.length / sr) * 150);
        for (let k = 0; k < count; k++) {
          const at = Math.floor(Math.random() * (d.length - 4000));
          const amp = 0.04 + 0.3 * Math.pow(Math.random(), 3);
          addTick(d, sr, at, 650 + Math.random() * 1900, 0.0018 + Math.random() * 0.004, amp);
          if (Math.random() < 0.4) addClick(d, sr, at, 0.0012, amp * 0.6);
        }
        // eave drips (plops)
        const drips = Math.floor((d.length / sr) * 1.3);
        for (let k = 0; k < drips; k++) {
          const at = Math.floor(Math.random() * (d.length - 6000));
          const f0 = 500 + Math.random() * 500;
          for (let i = 0; i < 0.05 * sr; i++) {
            const t = i / sr;
            d[at + i] += Math.sin(2 * Math.PI * f0 * (1 + 6 * t) * t) * Math.exp(-t / 0.012) * 0.5;
          }
        }
        biquad(d, sr, 'highpass', 300, 0.7);
        normalize(d, 0.6);
      });
      e.loop(roof, this.roofPanner, { gain: 0.85 });
      // the same patter, duller, drumming on the camp's canvas tarp
      if (this.world.camp?.canopy) {
        const tarpPanner = e.panner(this.world.camp.canopy.center, 'rain', { ref: 2.6, rolloff: 1.4, reverb: 0.08 });
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.5;
        lp.connect(tarpPanner);
        e.loop(roof, lp, { gain: 0.75, rate: 0.82 });
      }
    }

    // positional one-shots
    this.pool = new PannerPool(e, 'rain', 10, { ref: 1.2, rolloff: 1.4, reverb: 0.05 });
    this.drips = [];
    for (let v = 0; v < 10; v++) {
      this.drips.push(makeBuffer(ctx, 0.06, 1, (d, sr) => {
        addTick(d, sr, 0, 2400 + Math.random() * 2600, 0.0025 + Math.random() * 0.003, 0.6);
        addClick(d, sr, 0, 0.001, 0.3);
      }));
    }
    this.plinks = [];
    for (let v = 0; v < 12; v++) {
      this.plinks.push(makeBuffer(ctx, 0.14, 1, (d, sr) => {
        const f0 = 800 + Math.random() * 1500;
        let ph = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const f = f0 * (1 + Math.min(2.2, t / 0.012));
          ph += (2 * Math.PI * f) / sr;
          d[i] = Math.sin(ph) * Math.exp(-t / 0.022) * 0.6;
        }
        addClick(d, sr, 0, 0.0015, 0.25);
      }));
    }
    this._dripAcc = 0;
    this._modTimer = 0;
    this.started = true;
  }

  update(dt, listener) {
    if (!this.started) return;
    const ctx = this.e.ctx;
    // slow, organic intensity changes
    this._modTimer -= dt;
    if (this._modTimer <= 0) {
      this._modTimer = rnd(3, 8);
      const k = rnd(0.82, 1.12);
      this.bedGain.gain.setTargetAtTime(k, ctx.currentTime, 2.5);
    }
    // drips off leaves around the listener
    this._dripAcc += dt * 3.2 * rnd(0.3, 1.7);
    while (this._dripAcc > 1) {
      this._dripAcc -= 1;
      const a = Math.random() * Math.PI * 2, r = rnd(1.5, 9);
      const x = listener.x + Math.cos(a) * r, z = listener.z + Math.sin(a) * r;
      const y = this.world.terrain.heightAt(x, z) + rnd(0, 1.2);
      this.pool.play(pick(this.drips), { x, y, z }, { gain: rnd(0.15, 0.5), rate: rnd(0.85, 1.2) });
    }
    // drops landing in nearby puddles
    for (let i = 0; i < PUDDLES.length; i++) {
      const p = PUDDLES[i];
      const d = Math.hypot(p[0] - listener.x, p[1] - listener.z);
      if (d > 16) continue;
      if (Math.random() < dt * 5 * (p[2] * p[3])) {
        const x = p[0] + (Math.random() - 0.5) * p[2] * 1.4, z = p[1] + (Math.random() - 0.5) * p[3] * 1.4;
        this.pool.play(pick(this.plinks), { x, y: this.world.terrain.puddleLevels[i], z }, { gain: rnd(0.12, 0.4), rate: rnd(0.9, 1.15) });
      }
    }
  }
}

