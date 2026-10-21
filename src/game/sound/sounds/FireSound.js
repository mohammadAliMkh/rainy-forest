import { loopBuffer, makeBuffer, addTick, addClick, biquad, normalize } from '../../../engine/audio/dsp.js';
import { rnd, pick } from './shared.js';

// Campfire: low roar + hiss + two layers of crackle (pre-rendered, looped at
// different lengths so they never repeat audibly) + randomly scheduled wood
// pops that also throw sparks in the visual fire. A quieter, muffled fire
// plays from the cabin's fireplace.

function crackleBuffer(ctx, seconds, density) {
  return loopBuffer(ctx, seconds, 1, (d, sr) => {
    let t = 0;
    let rate = density, rateTarget = density, nextRateChange = 0;
    while (t < d.length - sr * 0.05) {
      if (t > nextRateChange) { rateTarget = density * rnd(0.25, 1.8); nextRateChange = t + sr * rnd(0.3, 1.2); }
      rate += (rateTarget - rate) * 0.3;
      t += Math.floor((-Math.log(1 - Math.random()) / rate) * sr);
      const k = 1 + Math.floor(Math.pow(Math.random(), 2) * 6);
      let at = t;
      for (let j = 0; j < k && at < d.length - 400; j++) {
        const amp = 0.04 + 0.9 * Math.pow(Math.random(), 3);
        addClick(d, sr, at, rnd(0.0002, 0.0018), amp);
        if (Math.random() < 0.3) addTick(d, sr, at, rnd(1400, 4800), rnd(0.0006, 0.002), amp * 0.5);
        at += Math.floor(sr * rnd(0.0008, 0.012));
      }
    }
    biquad(d, sr, 'highpass', 650, 0.7);
    normalize(d, 0.85);
  });
}

export class FireSound {
  constructor(engine, world) {
    this.e = engine;
    this.world = world;
  }

  start() {
    const e = this.e, ctx = e.ctx;
    const firePos = this.world.fire.position.clone();
    firePos.y += 0.4;
    this.panner = e.panner(firePos, 'fire', { ref: 1.6, rolloff: 1.25, reverb: 0.12 });
    const file = e.file('fire_loop');
    const crackA = crackleBuffer(ctx, 11.3, 12);
    const crackB = crackleBuffer(ctx, 8.1, 7);
    if (file) {
      e.loop(file, this.panner, { gain: 0.9 });
    } else {
      // roar
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      this.roar = ctx.createGain(); this.roar.gain.value = 0.3;
      lp.connect(this.roar).connect(this.panner);
      e.loop(e.noise.brown, lp, { gain: 1 });
      // hiss
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.5;
      bp.connect(this.panner);
      e.loop(e.noise.pink, bp, { gain: 0.035 });
      e.loop(crackA, this.panner, { gain: 0.5 });
      e.loop(crackB, this.panner, { gain: 0.35, rate: 0.9 });
    }

    // pops
    this.pops = [];
    for (let v = 0; v < 6; v++) {
      this.pops.push(makeBuffer(ctx, 0.35, 1, (d, sr) => {
        addClick(d, sr, 0, rnd(0.002, 0.005), 1, true);
        addTick(d, sr, 0, rnd(180, 380), rnd(0.012, 0.03), 0.5);
        addTick(d, sr, 0, rnd(1200, 2400), rnd(0.002, 0.005), 0.4);
        for (let k = 0; k < 14; k++) addClick(d, sr, Math.floor(sr * rnd(0.01, 0.25)), rnd(0.0003, 0.0012), rnd(0.05, 0.35) * Math.random());
        normalize(d, 0.95);
      }));
    }
    this._popTimer = rnd(2, 6);

    // fireplace inside the cabin (muffled by the walls)
    const hearth = this.world.cabin.hearthWorld;
    this.inner = e.panner(hearth, 'fire', { ref: 1.0, rolloff: 1.7, reverb: 0.05 });
    const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 1600;
    muffle.connect(this.inner);
    e.loop(crackB, muffle, { gain: 0.25, rate: 1.1 });
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 300;
    lp2.connect(muffle);
    e.loop(e.noise.brown, lp2, { gain: 0.25 });
    this.started = true;
  }

  update(dt) {
    if (!this.started) return;
    const fire = this.world.fire;
    if (this.roar) this.roar.gain.setTargetAtTime(0.18 + 0.16 * fire.flicker, this.e.ctx.currentTime, 0.06);
    this._popTimer -= dt;
    if (this._popTimer <= 0) {
      this._popTimer = Math.random() < 0.25 ? rnd(0.3, 1.2) : rnd(2.5, 9);
      const strength = rnd(0.3, 1);
      this.e.oneShot(pick(this.pops), this.panner, { gain: 0.35 + strength * 0.55, rate: rnd(0.85, 1.2) });
      fire.pop(strength);
    }
  }
}
