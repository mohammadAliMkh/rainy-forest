import { makeBuffer, addClick, biquad, normalize, white } from '../../../engine/audio/dsp.js';
import { rnd, pick } from './shared.js';

// Synthesized animal voices, all positional:
// several songbird types (warble, two-note whistle, trill, chips), distant
// wood pigeon & crow, woodpecker drumming, owls at night, deer snorts,
// hoof steps and wing flaps.

export class WildlifeSound {
  constructor(engine, world) {
    this.e = engine;
    this.world = world;
  }

  start() {
    const ctx = this.e.ctx;
    this._distantTimer = rnd(1, 4);
    this._owlTimer = rnd(10, 30);
    this._woodpeckerTimer = rnd(30, 70);
    this._crowTimer = rnd(60, 140);
    this._barkTimer = rnd(90, 200);
    this.flaps = [0, 1, 2].map(() => makeBuffer(ctx, 0.5, 1, (d, sr) => {
      white(d);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] *= Math.exp(-t / 0.18) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 22 * t) ** 2);
      }
      biquad(d, sr, 'bandpass', 900, 0.6);
      normalize(d, 0.5);
    }));
    this.hoof = [0, 1, 2, 3].map(() => makeBuffer(ctx, 0.15, 1, (d, sr) => {
      for (let k = 0; k < 6; k++) addClick(d, sr, Math.floor(sr * rnd(0, 0.06)), rnd(0.001, 0.004), rnd(0.1, 0.4), false);
      biquad(d, sr, 'bandpass', rnd(600, 1400), 0.8);
      normalize(d, 0.5);
    }));
    this.started = true;
  }

  // ---- generic tone phrase: notes = [{t, dur, f0, f1, a}] ----
  phrase(pos, notes, { type = 'sine', vib = 0, vibRate = 40, ref = 3.5, lp = 9000, gain = 1, reverb = 0.3 } = {}) {
    const ctx = this.e.ctx;
    const listener = this.world.player;
    const dist = Math.hypot(pos.x - listener.x, pos.z - listener.z);
    const p = this.e.panner(pos, 'wildlife', { ref, rolloff: 1, reverb: reverb + Math.min(0.35, dist * 0.006) });
    const osc = ctx.createOscillator();
    osc.type = type;
    const env = ctx.createGain(); env.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass';
    filt.frequency.value = Math.max(1200, lp - dist * 90); // air absorption
    osc.connect(env).connect(filt).connect(p);
    const t0 = ctx.currentTime + 0.05;
    let end = 0;
    for (const n of notes) {
      const t = t0 + n.t;
      osc.frequency.setValueAtTime(n.f0, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, n.f1), t + n.dur);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(n.a * gain, t + Math.min(0.012, n.dur * 0.3));
      env.gain.setValueAtTime(n.a * gain, t + n.dur * 0.7);
      env.gain.linearRampToValueAtTime(0, t + n.dur);
      end = Math.max(end, n.t + n.dur);
    }
    let lfo = null;
    if (vib > 0) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = vibRate;
      const lg = ctx.createGain(); lg.gain.value = vib;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0); lfo.stop(t0 + end + 0.1);
    }
    osc.start(t0);
    osc.stop(t0 + end + 0.1);
    osc.onended = () => { osc.disconnect(); env.disconnect(); filt.disconnect(); p.disconnect(); if (lfo) lfo.disconnect(); };
  }

  song(species, pos, gain = 1) {
    // real recordings (if provided) are mixed in with the synthesized ones
    const files = this.e.file('birds');
    if (files && Math.random() < 0.6) {
      const p = this.e.panner(pos, 'wildlife', { ref: 3.5, rolloff: 1, reverb: 0.3 });
      const src = this.e.oneShot(pick(files), p, { gain: 0.8 * gain, rate: rnd(0.95, 1.05) });
      src.addEventListener('ended', () => p.disconnect());
      return;
    }
    const notes = [];
    let t = 0;
    switch (species % 4) {
      case 0: { // warbler: varied gliding notes
        const n = 5 + Math.floor(Math.random() * 6);
        let f = rnd(2300, 3600);
        for (let i = 0; i < n; i++) {
          const dur = rnd(0.06, 0.17);
          const f1 = Math.min(5200, Math.max(1800, f * rnd(0.75, 1.35)));
          notes.push({ t, dur, f0: f, f1, a: rnd(0.25, 0.5) });
          t += dur + rnd(0.02, 0.07);
          f = f1 * rnd(0.85, 1.2);
        }
        return this.phrase(pos, notes, { vib: rnd(40, 140), vibRate: rnd(25, 60), gain });
      }
      case 1: { // two-note whistle "fee-bee", sometimes repeated
        const reps = Math.random() < 0.5 ? 1 : 2;
        const hi = rnd(3600, 4100), lo = hi * rnd(0.8, 0.88);
        for (let r = 0; r < reps; r++) {
          notes.push({ t, dur: rnd(0.25, 0.33), f0: hi, f1: hi * 0.99, a: 0.38 });
          t += 0.4;
          notes.push({ t, dur: rnd(0.22, 0.3), f0: lo, f1: lo * 0.97, a: 0.32 });
          t += 0.9;
        }
        return this.phrase(pos, notes, { gain });
      }
      case 2: { // trill
        const n = 12 + Math.floor(Math.random() * 14);
        let f = rnd(4600, 5600);
        for (let i = 0; i < n; i++) {
          notes.push({ t, dur: 0.028, f0: f, f1: f * 0.8, a: 0.22 + 0.1 * Math.sin((i / n) * Math.PI) });
          t += rnd(0.045, 0.055);
          f *= 0.992;
        }
        return this.phrase(pos, notes, { gain });
      }
      default: { // chip calls
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const f = rnd(5000, 6500);
          notes.push({ t, dur: rnd(0.02, 0.035), f0: f, f1: f * 0.55, a: 0.32 });
          t += rnd(0.12, 0.35);
        }
        return this.phrase(pos, notes, { gain });
      }
    }
  }

  pigeon(pos) {
    const notes = [];
    const pattern = [0.35, 0.55, 0.3, 0.3, 0.45];
    let t = 0;
    const f = rnd(430, 520);
    for (const d of pattern) {
      notes.push({ t, dur: d, f0: f * 0.92, f1: f, a: 0.28 });
      t += d + 0.12;
    }
    this.phrase(pos, notes, { lp: 1800, vib: 6, vibRate: 7, reverb: 0.5 });
  }

  owl(pos) {
    const f = rnd(340, 420);
    const notes = [
      { t: 0, dur: 0.45, f0: f, f1: f * 0.97, a: 0.35 },
      { t: 1.1, dur: 0.14, f0: f * 1.02, f1: f, a: 0.22 },
      { t: 1.32, dur: 0.14, f0: f * 1.02, f1: f, a: 0.24 },
      { t: 1.6, dur: 0.8, f0: f, f1: f * 0.93, a: 0.33 },
    ];
    this.phrase(pos, notes, { lp: 1500, vib: 5, vibRate: 6, reverb: 0.6 });
  }

  crow(pos) {
    const notes = [];
    let t = 0;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      notes.push({ t, dur: rnd(0.22, 0.32), f0: rnd(560, 640), f1: rnd(420, 480), a: 0.18 });
      t += rnd(0.45, 0.6);
    }
    this.phrase(pos, notes, { type: 'sawtooth', lp: 1500, reverb: 0.55 });
  }

  deerBark(pos) {
    this.phrase(pos, [{ t: 0, dur: 0.22, f0: 760, f1: 520, a: 0.22 }], { type: 'sawtooth', lp: 1400, reverb: 0.6 });
  }

  woodpecker(pos) {
    const ctx = this.e.ctx;
    const p = this.e.panner(pos, 'wildlife', { ref: 4, rolloff: 1, reverb: 0.5 });
    const n = 14 + Math.floor(Math.random() * 10);
    const rate = rnd(14, 18);
    const buf = makeBuffer(ctx, n / rate + 0.1, 1, (d, sr) => {
      for (let i = 0; i < n; i++) {
        const at = Math.floor((i / rate) * sr);
        const a = 0.4 + 0.6 * Math.sin((i / n) * Math.PI);
        addClick(d, sr, at, 0.003, a, false);
        const f = rnd(700, 900);
        for (let k = 0; k < sr * 0.02; k++) d[at + k] += Math.sin((2 * Math.PI * f * k) / sr) * Math.exp(-k / (sr * 0.004)) * a * 0.6;
      }
      biquad(d, sr, 'bandpass', 1100, 0.9);
      normalize(d, 0.6);
    });
    const src = this.e.oneShot(buf, p, { gain: 0.5 });
    src.addEventListener('ended', () => p.disconnect());
  }

  snort(pos) {
    const ctx = this.e.ctx;
    const p = this.e.panner(pos, 'wildlife', { ref: 3, rolloff: 1, reverb: 0.3 });
    const buf = makeBuffer(ctx, 0.5, 1, (d, sr) => {
      white(d);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] *= (t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) / 0.09)) + (t > 0.22 ? Math.exp(-(t - 0.22) / 0.05) * 0.5 * (t < 0.3 ? 1 : 1) : 0);
      }
      biquad(d, sr, 'bandpass', rnd(500, 750), 1.3);
      normalize(d, 0.7);
    });
    const src = this.e.oneShot(buf, p, { gain: 0.6 });
    src.addEventListener('ended', () => p.disconnect());
  }

  _randomPos(listener, rMin, rMax, hMin, hMax) {
    const a = Math.random() * Math.PI * 2, r = rnd(rMin, rMax);
    const x = listener.x + Math.cos(a) * r, z = listener.z + Math.sin(a) * r;
    return { x, y: this.world.terrain.heightAt(x, z) + rnd(hMin, hMax), z };
  }

  // events from the world (visible animals)
  onEvent(type, src) {
    if (!this.started) return;
    const listener = this.world.player;
    if (type === 'birdSong') {
      this.song(src.species, src.pos, 0.9);
    } else if (type === 'birdFlap') {
      const d = Math.hypot(src.pos.x - listener.x, src.pos.z - listener.z);
      if (d < 18) {
        const p = this.e.panner(src.pos, 'wildlife', { ref: 1.5, rolloff: 1.4, reverb: 0.1 });
        const s = this.e.oneShot(pick(this.flaps), p, { gain: 0.5, rate: rnd(0.9, 1.3) });
        s.addEventListener('ended', () => p.disconnect());
      }
    } else if (type === 'deerSnort') {
      this.snort({ x: src.x, y: this.world.terrain.heightAt(src.x, src.z) + 1.4, z: src.z });
    } else if (type === 'deerStep') {
      const d = Math.hypot(src.x - listener.x, src.z - listener.z);
      if (d < 26) {
        if (!this.hoofPool) this.hoofPool = [0, 1, 2, 3].map(() => this.e.panner({ x: 0, y: -99, z: 0 }, 'wildlife', { ref: 1.5, rolloff: 1.5, reverb: 0.08 }));
        const p = this.hoofPool[(this._hi = ((this._hi || 0) + 1) % 4)];
        this.e.setPannerPos(p, { x: src.x, y: this.world.terrain.heightAt(src.x, src.z), z: src.z }, true);
        this.e.oneShot(pick(this.hoof), p, { gain: src.speed > 2.5 ? 0.5 : 0.22, rate: rnd(0.85, 1.15) });
      }
    }
  }

  update(dt, listener, env) {
    if (!this.started) return;
    // distant, unseen birds
    this._distantTimer -= dt * (0.15 + env.birdActivity);
    if (this._distantTimer <= 0) {
      this._distantTimer = rnd(2.5, 9);
      if (env.birdActivity > 0.1 && Math.random() < env.birdActivity + 0.1) {
        const pos = this._randomPos(listener, 18, 65, 3, 14);
        if (Math.random() < 0.12) this.pigeon(pos);
        else this.song(Math.floor(Math.random() * 4), pos, 0.75);
      }
    }
    this._woodpeckerTimer -= dt * env.dayFactor;
    if (this._woodpeckerTimer <= 0) {
      this._woodpeckerTimer = rnd(60, 150);
      this.woodpecker(this._randomPos(listener, 30, 60, 4, 10));
    }
    this._crowTimer -= dt * env.dayFactor;
    if (this._crowTimer <= 0) {
      this._crowTimer = rnd(90, 220);
      this.crow(this._randomPos(listener, 50, 90, 15, 25));
    }
    this._owlTimer -= dt * env.owlActivity;
    if (this._owlTimer <= 0) {
      this._owlTimer = rnd(18, 45);
      this.owl(this._randomPos(listener, 25, 60, 6, 14));
    }
    this._barkTimer -= dt * (1 - env.dayFactor * 0.7);
    if (this._barkTimer <= 0) {
      this._barkTimer = rnd(120, 300);
      this.deerBark(this._randomPos(listener, 60, 100, 1, 1.5));
    }
  }
}
