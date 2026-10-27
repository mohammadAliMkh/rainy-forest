import { makeBuffer, loopBuffer, biquad, normalize } from '../../../engine/audio/dsp.js';
import { PannerPool, rnd } from './shared.js';

// The sounds of scenario 1 (the sheet ghost) and the errand: a sneaky plucked tiptoe tune
// while it creeps up, its hollow "BOOOO!", the friends' cartoon screams,
// a giggle, the squeak when it scares itself, and a whoosh as it fades
// away. All synthesized (a plucked string, and voice-like sounds from a
// buzzing source through vowel formants); a real recording in
// public/audio/manifest.json (ghost_boo, ghost_giggle, scream_<name>)
// replaces the synthesized one.

// vowel formants (Hz, bandwidth as Q, level)
const VOWEL = {
  u: [[310, 6, 1], [870, 8, 0.45], [2250, 10, 0.12]],
  a: [[780, 5, 1], [1180, 6, 0.8], [2600, 9, 0.3]],
  i: [[300, 6, 0.8], [2300, 9, 0.7], [3000, 10, 0.4]],
};

/**
 * a voice-like sound: a buzzing source following the pitch curve `f0(t)`,
 * shaped by a vowel, with breath noise and a loudness envelope `env(t)`
 */
function voice(ctx, seconds, f0, env, vowel, breath = 0.15) {
  return makeBuffer(ctx, seconds, 1, (d, sr) => {
    const src = new Float32Array(d.length);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      ph += f0(t) / sr;
      const saw = 2 * (ph - Math.floor(ph)) - 1;
      src[i] = (saw * 0.8 + (Math.random() * 2 - 1) * breath) * env(t);
    }
    d.fill(0);
    for (const [f, q, level] of VOWEL[vowel]) {
      const band = biquad(Float32Array.from(src), sr, 'bandpass', f, q);
      for (let i = 0; i < d.length; i++) d[i] += band[i] * level;
    }
    normalize(d, 0.85);
  });
}

// a plucked string (Karplus-Strong), added into `d` at sample `at`
function pluck(d, sr, at, freq, amp) {
  const n = Math.max(2, Math.round(sr / freq));
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) line[i] = (Math.random() * 2 - 1) * amp;
  const len = Math.min(d.length - at, Math.floor(sr * 0.42));
  let k = 0;
  for (let i = 0; i < len; i++) {
    const a = line[k], b = line[(k + 1) % n];
    line[k] = (a + b) * 0.5 * 0.985; // dampened: a short pizzicato
    d[at + i] += a * Math.min(1, (len - i) / (sr * 0.05));
    k = (k + 1) % n;
  }
}

const note = (semi) => 110 * Math.pow(2, semi / 12); // semitones above A2

export class ScenarioSound {
  constructor(engine) {
    this.e = engine;
  }

  start() {
    const e = this.e, ctx = e.ctx;
    // the tiptoe tune: a sneaky pizzicato bass walk with little answers on top (one 4.8 s bar, looped)
    const STEP = 0.3;
    const BASS = [7, null, 10, null, 12, null, 13, 14, null, null, 7, null, 10, 12, null, null]; // E G A Bb B .. E G A
    const TOP = [null, null, null, null, null, null, null, null, 26, 25, null, 22, null, null, 19, null];
    this.tune = loopBuffer(ctx, STEP * 16, 1, (d, sr) => {
      for (let s = 0; s < 16; s++) {
        const at = Math.floor(s * STEP * sr);
        if (BASS[s] != null) pluck(d, sr, at, note(BASS[s]), 0.9);
        if (TOP[s] != null) pluck(d, sr, at, note(TOP[s]), 0.45);
      }
      biquad(d, sr, 'lowpass', 2600, 0.7);
      normalize(d, 0.7);
    }, 0.02);
    this.tuneGain = ctx.createGain();
    this.tuneGain.gain.value = 0;
    this.tuneGain.connect(e.buses.music);

    // BOOOO: low and hollow, wavering, sliding down
    this.boo = voice(ctx, 1.7, (t) => (165 - 45 * t) * (1 + 0.04 * Math.sin(t * 33)), (t) => Math.min(1, t / 0.07) * Math.max(0, 1 - Math.max(0, t - 1.1) / 0.6), 'u', 0.25);
    // a giggle: "hee-hee-hee-hee"
    this.giggle = voice(ctx, 1.3, (t) => 560 - 120 * t + 40 * Math.sin(t * 40), (t) => {
      const k = t / 0.19, p = k - Math.floor(k);
      return k < 6 ? Math.sin(Math.min(1, p / 0.65) * Math.PI) ** 0.6 * (1 - k / 9) : 0;
    }, 'i', 0.2);
    // eek!
    this.eek = voice(ctx, 0.5, (t) => 900 + 700 * Math.min(1, t / 0.15), (t) => Math.min(1, t / 0.02) * Math.max(0, 1 - t / 0.48), 'i', 0.1);
    // four cartoon screams, each their own pitch: up, a wobble, trailing off
    this.screams = {};
    for (const [who, f] of [['owner', 300], ['amir', 260], ['alireza', 340], ['amin', 280]]) {
      this.screams[who] = voice(ctx, 1.5, (t) => f * (1 + 0.45 * Math.min(1, t / 0.12) - 0.25 * Math.max(0, t - 0.5)) * (1 + 0.05 * Math.sin(t * 38 + f)), (t) => Math.min(1, t / 0.05) * Math.max(0, 1 - Math.max(0, t - 0.75) / 0.7), 'a', 0.35);
    }
    // the whoosh as it vanishes: noise for a filter sweep (shaped when played)
    this.noise = makeBuffer(ctx, 1.6, 1, (d) => { for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((i / d.length) * Math.PI) ** 2; });
    // the errand: picking something off the shelf, paying (a till's bell and drawer), the jar's lid popping
    this.pickup = makeBuffer(ctx, 0.25, 1, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * (620 + 900 * Math.min(1, t / 0.08)) * t) * Math.exp(-t / 0.06) * 0.8 + (Math.random() * 2 - 1) * Math.exp(-t / 0.01) * 0.3;
      }
      biquad(d, sr, 'highpass', 300, 0.7);
      normalize(d, 0.6);
    });
    this.till = makeBuffer(ctx, 1.4, 1, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        // the drawer sliding out, then the bell
        let v = (Math.random() * 2 - 1) * (t < 0.18 ? 0.25 * Math.sin((t / 0.18) * Math.PI) : 0);
        const b = t - 0.15;
        if (b > 0) for (const [f, a, dec] of [[2093, 1, 0.5], [2093 * 2.76, 0.35, 0.18], [2637, 0.6, 0.4]]) v += Math.sin(2 * Math.PI * f * b) * a * Math.exp(-b / dec) * 0.4;
        d[i] = v;
      }
      normalize(d, 0.65);
    });
    this.lidPop = makeBuffer(ctx, 0.3, 1, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = Math.sin(2 * Math.PI * (180 - 120 * t) * t) * Math.exp(-t / 0.05) + (Math.random() * 2 - 1) * Math.exp(-t / 0.006) * 0.6;
      }
      normalize(d, 0.7);
    });
    this.pool = new PannerPool(e, 'voices', 6, { ref: 2.5, rolloff: 0.9, max: 80, reverb: 0.25 });
    this.started = true;
  }

  /** a cue from the scenario (see SCENARIO_CUE in config/events.ts) */
  play(cue) {
    if (!this.started) return;
    const e = this.e, ctx = e.ctx, t = ctx.currentTime;
    const file = (key) => { const f = e.file(key); return f && !Array.isArray(f) ? f : null; };
    switch (cue.cue) {
      case 'sneak':
        this.tuneSrc?.src.stop();
        this.tuneSrc = e.loop(this.tune, this.tuneGain, { gain: 1 });
        this.tuneGain.gain.cancelScheduledValues(t);
        this.tuneGain.gain.setTargetAtTime(0.55, t, 0.3);
        break;
      case 'sneakStop':
        this.tuneGain.gain.cancelScheduledValues(t);
        this.tuneGain.gain.setTargetAtTime(0, t, 0.12);
        try { this.tuneSrc?.src.stop(t + 1); } catch { /* already stopped */ }
        this.tuneSrc = null;
        break;
      case 'boo':
        this.pool.play(file('ghost_boo') ?? this.boo, cue.position, { gain: 1.2 });
        break;
      case 'giggle':
        this.pool.play(file('ghost_giggle') ?? this.giggle, cue.position, { gain: 0.8 });
        break;
      case 'pickup':
        this.pool.play(this.pickup, cue.position, { gain: 0.6, rate: rnd(0.95, 1.08) });
        break;
      case 'pay':
        this.pool.play(this.till, cue.position, { gain: 0.7 });
        break;
      case 'lid':
        this.pool.play(this.lidPop, cue.position, { gain: 0.8 });
        break;
      case 'eek':
        this.pool.play(this.eek, cue.position, { gain: 0.7 });
        break;
      case 'scream': {
        const buf = file(`scream_${cue.who}`) ?? this.screams[cue.who] ?? this.screams.owner;
        this.pool.play(buf, cue.position, { gain: 0.9, rate: rnd(0.97, 1.03) });
        break;
      }
      case 'vanish': {
        // a soft rising-then-falling whoosh
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 2.5;
        bp.frequency.setValueAtTime(600, t);
        bp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
        bp.frequency.exponentialRampToValueAtTime(300, t + 1.5);
        const p = e.panner(cue.position, 'voices', { ref: 2.5, rolloff: 0.9, max: 80, reverb: 0.4 });
        bp.connect(p);
        const src = e.oneShot(this.noise, bp, { gain: 0.35 });
        src.addEventListener('ended', () => { bp.disconnect(); p.disconnect(); p._send?.disconnect(); });
        break;
      }
    }
  }
}
