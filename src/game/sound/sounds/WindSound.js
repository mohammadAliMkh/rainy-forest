import { loopBuffer, makeBuffer, addClick, biquad, normalize } from '../../../engine/audio/dsp.js';
import { PannerPool, rnd, pick } from './shared.js';

// Wind: a low stereo "air" bed and a leaf-rustle layer, both following the
// shared wind signal; positional rustle bursts in nearby trees during gusts,
// and rare soft branch creaks.

export class WindSound {
  constructor(engine, world) {
    this.e = engine;
    this.world = world;
  }

  start() {
    const e = this.e, ctx = e.ctx, bus = e.buses.wind;
    const file = e.file('wind_loop');
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.15;
    this.airGain.connect(bus);
    if (file) {
      e.loop(file, this.airGain, { gain: 1 });
      this.airLP = null;
    } else {
      this.airLP = ctx.createBiquadFilter();
      this.airLP.type = 'lowpass'; this.airLP.frequency.value = 400; this.airLP.Q.value = 0.9;
      const peak = ctx.createBiquadFilter();
      peak.type = 'peaking'; peak.frequency.value = 260; peak.gain.value = 5; peak.Q.value = 0.8;
      this.airLP.connect(peak).connect(this.airGain);
      e.loop(e.noise.brown, this.airLP, { gain: 0.9 });
      // whistle through branches
      this.whistleBP = ctx.createBiquadFilter();
      this.whistleBP.type = 'bandpass'; this.whistleBP.frequency.value = 650; this.whistleBP.Q.value = 2.2;
      this.whistleGain = ctx.createGain(); this.whistleGain.gain.value = 0;
      this.whistleBP.connect(this.whistleGain).connect(bus);
      e.loop(e.noise.pink, this.whistleBP, { gain: 0.6 });
    }

    // leaf rustle layer with a flutter modulator
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 5200; pk.gain.value = 4; pk.Q.value = 0.7;
    this.leafGain = ctx.createGain(); this.leafGain.gain.value = 0.03;
    hp.connect(pk).connect(this.leafGain).connect(bus);
    e.loop(e.noise.pink, hp, { gain: 0.5 });
    const flutter = loopBuffer(ctx, 5, 1, (d, sr) => {
      let v = 0, target = 0, cnt = 0;
      for (let i = 0; i < d.length; i++) {
        if (cnt-- <= 0) { target = Math.random(); cnt = Math.floor(sr / (5 + Math.random() * 12)); }
        v += (target - v) * 0.0015;
        d[i] = v * 2 - 1;
      }
    });
    this.flutterDepth = ctx.createGain();
    this.flutterDepth.gain.value = 0.02;
    e.loop(flutter, this.flutterDepth, { gain: 1 });
    this.flutterDepth.connect(this.leafGain.gain);

    // positional rustles
    this.pool = new PannerPool(e, 'wind', 6, { ref: 3, rolloff: 1.1, reverb: 0.25 });
    this.rustles = [];
    for (let v = 0; v < 6; v++) {
      const dur = rnd(1.2, 2.4);
      this.rustles.push(makeBuffer(ctx, dur, 1, (d, sr) => {
        let env = 0, fl = 0, flT = 0, cnt = 0;
        const peakT = rnd(0.25, 0.55) * dur;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          env = t < peakT ? t / peakT : Math.exp(-(t - peakT) / (dur * 0.25));
          if (cnt-- <= 0) { flT = Math.random(); cnt = Math.floor(sr / (8 + Math.random() * 16)); }
          fl += (flT - fl) * 0.004;
          d[i] = (Math.random() * 2 - 1) * env * (0.35 + fl);
        }
        biquad(d, sr, 'bandpass', rnd(2600, 4200), 0.6);
        // a few leaf ticks
        for (let k = 0; k < 25; k++) addClick(d, sr, Math.floor(Math.random() * (d.length - 200)), 0.0008, rnd(0.02, 0.08));
        normalize(d, 0.6);
      }));
    }
    this._rustleAcc = 0;
    this._creakTimer = rnd(15, 40);
    this.started = true;
  }

  creak(pos) {
    const ctx = this.e.ctx;
    const p = this.e.panner(pos, 'wind', { ref: 3, rolloff: 1, reverb: 0.4 });
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rnd(450, 900); bp.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0;
    osc.connect(bp).connect(g).connect(p);
    const t = ctx.currentTime + 0.05, dur = rnd(0.7, 1.6);
    const f0 = rnd(70, 140);
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f0 * rnd(1.15, 1.5), t + dur * 0.6);
    osc.frequency.linearRampToValueAtTime(f0 * rnd(0.9, 1.1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t); osc.stop(t + dur + 0.1);
    osc.onended = () => { osc.disconnect(); g.disconnect(); p.disconnect(); };
  }

  update(dt, listener, wind) {
    if (!this.started) return;
    const t = this.e.ctx.currentTime;
    const s = wind.strength;
    this.airGain.gain.setTargetAtTime(0.06 + s * 0.32, t, 0.4);
    if (this.airLP) this.airLP.frequency.setTargetAtTime(220 + s * 650, t, 0.5);
    if (this.whistleGain) {
      this.whistleGain.gain.setTargetAtTime(Math.max(0, s - 0.55) * 0.08, t, 0.6);
      this.whistleBP.frequency.setTargetAtTime(520 + s * 380, t, 0.8);
    }
    const leaf = 0.015 + s * s * 0.12;
    this.leafGain.gain.setTargetAtTime(leaf, t, 0.4);
    this.flutterDepth.gain.setTargetAtTime(leaf * 0.7, t, 0.4);

    // rustle bursts in trees around the listener, more during gusts
    this._rustleAcc += dt * (0.12 + wind.gust * 1.4 + Math.max(0, s - 0.5) * 0.8);
    if (this._rustleAcc > 1) {
      this._rustleAcc = 0;
      const trees = this.world.collision.nearby(listener.x, listener.z, 18);
      if (trees.length) {
        const tr = pick(trees);
        const y = this.world.terrain.heightAt(tr.x, tr.z) + rnd(2, 7);
        this.pool.play(pick(this.rustles), { x: tr.x, y, z: tr.z }, { gain: rnd(0.25, 0.6) * (0.5 + s), rate: rnd(0.85, 1.15) });
      }
    }
    this._creakTimer -= dt * (0.6 + wind.gust * 2);
    if (this._creakTimer <= 0) {
      this._creakTimer = rnd(30, 90);
      const trees = this.world.collision.nearby(listener.x, listener.z, 25).filter((c) => Math.hypot(c.x - listener.x, c.z - listener.z) > 7);
      if (trees.length) {
        const tr = pick(trees);
        this.creak({ x: tr.x, y: this.world.terrain.heightAt(tr.x, tr.z) + rnd(4, 9), z: tr.z });
      }
    }
  }
}
