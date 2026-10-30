import { makeBuffer, loopBuffer, biquad, normalize } from '../../../engine/audio/dsp.js';
import { PannerPool, rnd } from './shared.js';

// The sounds of scenario 1 (the sheet ghost) and the errand: a sneaky plucked tiptoe tune
// while it creeps up, its hollow "BOOOO!", the friends' cartoon screams,
// a giggle, the squeak when it scares itself, and a whoosh as it fades
// away. All synthesized (a plucked string, and voice-like sounds from a
// buzzing source through vowel formants); a real recording in
// public/audio/manifest.json (ghost_boo, ghost_giggle, scream_<name>,
// ghost_laugh_scary, ghost_whisper, luna_bark) replaces the synthesized one.
// The haunted walk back adds its own: a deep, distorted laugh with a long
// tail, an electric glitch when the ghost blinks, a whisper that circles
// your head, a heartbeat, a shriek, and Luna's bark.

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

// soft clipping (a little distortion), in place
function drive(d, k) { for (let i = 0; i < d.length; i++) d[i] = Math.tanh(d[i] * k) / Math.tanh(k); }

// a long, dark tail: a few decaying echoes mixed in (in place)
function tail(d, sr, seconds) {
  const taps = [[0.137, 0.55], [0.211, 0.45], [0.293, 0.4], [0.377, 0.33]];
  for (const [delay, g] of taps) {
    const n = Math.floor(delay * sr);
    for (let i = n; i < d.length; i++) d[i] += d[i - n] * g * Math.exp(-i / (sr * seconds));
  }
}

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

    // ---- the haunted walk back ----
    // the giggle an octave down and slowed, distorted, with a long tail
    this.laughDeep = makeBuffer(ctx, 3.6, 1, (d, sr) => {
      const g = voice(ctx, 2.3, (t) => (280 - 50 * t + 18 * Math.sin(t * 22)) * 0.95, (t) => {
        const k = t / 0.3, p = k - Math.floor(k);
        return k < 6.5 ? Math.sin(Math.min(1, p / 0.7) * Math.PI) ** 0.5 * (1 - k / 10) : 0;
      }, 'a', 0.35).getChannelData(0);
      d.set(g);
      drive(d, 3);
      biquad(d, sr, 'lowpass', 1800, 0.7);
      tail(d, sr, 1.4);
      normalize(d, 0.85);
    });
    // an electric crackle: a buzzing hum broken into stutters, with clicks
    this.glitch = makeBuffer(ctx, 0.32, 1, (d, sr) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const gate = Math.sin(t * 2 * Math.PI * 31) > -0.2 ? 1 : 0;
        const buzz = Math.sign(Math.sin(2 * Math.PI * 120 * t)) * 0.5 + Math.sin(2 * Math.PI * 360 * t) * 0.3;
        d[i] = (buzz * gate + (Math.random() < 0.01 ? (Math.random() * 2 - 1) * 3 : 0) + (Math.random() * 2 - 1) * 0.3) * Math.min(1, t / 0.005) * Math.max(0, 1 - t / 0.32);
      }
      biquad(d, sr, 'highpass', 180, 0.7);
      normalize(d, 0.7);
    });
    // a whisper: breath through the vowels, in syllables
    this.whisper = makeBuffer(ctx, 2.6, 1, (d, sr) => {
      const src = new Float32Array(d.length);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const k = t / 0.32, p = k - Math.floor(k);
        src[i] = (Math.random() * 2 - 1) * (k < 7 ? Math.sin(Math.min(1, p / 0.8) * Math.PI) ** 0.8 : 0) * (0.6 + 0.4 * Math.sin(t * 3));
      }
      for (const [f, q, level] of [...VOWEL.i, ...VOWEL.u]) {
        const band = biquad(Float32Array.from(src), sr, 'bandpass', f * 1.2, q * 0.6);
        for (let i = 0; i < d.length; i++) d[i] += band[i] * level;
      }
      const hiss = biquad(Float32Array.from(src), sr, 'highpass', 4500, 0.7);
      for (let i = 0; i < d.length; i++) d[i] += hiss[i] * 0.35;
      normalize(d, 0.8);
    });
    // lub-dub
    this.heartbeat = makeBuffer(ctx, 0.8, 1, (d, sr) => {
      for (const [at, a] of [[0, 1], [0.24, 0.7]]) {
        const n0 = Math.floor(at * sr);
        for (let i = 0; i < sr * 0.22 && n0 + i < d.length; i++) {
          const t = i / sr;
          d[n0 + i] += Math.sin(2 * Math.PI * (52 + 30 * Math.exp(-t / 0.03)) * t) * a * Math.min(1, t / 0.006) * Math.exp(-t / 0.06);
        }
      }
      normalize(d, 0.9);
    });
    // a shriek: high, harsh, sliding up
    this.shriek = makeBuffer(ctx, 1.3, 1, (d) => {
      d.set(voice(ctx, 1.3, (t) => (1000 + 600 * Math.min(1, t / 0.2)) * (1 + 0.06 * Math.sin(t * 47)), (t) => Math.min(1, t / 0.03) * Math.max(0, 1 - Math.max(0, t - 0.6) / 0.7), 'i', 0.5).getChannelData(0));
      drive(d, 2.5);
      normalize(d, 0.85);
    });
    // Luna: a low, loud "woof"
    this.bark = makeBuffer(ctx, 0.42, 1, (d, sr) => {
      d.set(voice(ctx, 0.42, (t) => 330 - 240 * Math.min(1, t / 0.16), (t) => Math.min(1, t / 0.008) * Math.exp(-Math.max(0, t - 0.05) / 0.07), 'a', 0.6).getChannelData(0));
      for (let i = 0; i < sr * 0.02; i++) d[i] += (Math.random() * 2 - 1) * (1 - i / (sr * 0.02)) * 0.5;
      drive(d, 2);
      biquad(d, sr, 'lowpass', 2400, 0.7);
      normalize(d, 0.9);
    });
    // the whirlwind: rushing wind with a low roar under it (shaped when played)
    this.whirl = makeBuffer(ctx, 7, 1, (d, sr) => {
      let lp = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        lp += ((Math.random() * 2 - 1) - lp) * 0.02;
        d[i] = (Math.random() * 2 - 1) * 0.6 + lp * 4 + Math.sin(2 * Math.PI * (38 + 6 * Math.sin(t * 1.3)) * t) * 0.25;
      }
      normalize(d, 0.8);
    });
    // far away, with lots of the forest's echo
    this.far = new PannerPool(e, 'voices', 2, { ref: 6, rolloff: 0.5, max: 250, reverb: 0.8 });
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
      case 'laughDeep':
        this.far.play(file('ghost_laugh_scary') ?? this.laughDeep, cue.position, { gain: 1.1 });
        break;
      case 'whirl': {
        // the wind rising as the knot grows into a whirlwind, howling, then easing off
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(260, t);
        bp.frequency.exponentialRampToValueAtTime(1300, t + 3.5);
        bp.frequency.exponentialRampToValueAtTime(700, t + 6.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(1, t + 3);
        g.gain.setValueAtTime(1, t + 4.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 6.9);
        const p = e.panner(cue.position, 'voices', { ref: 3, rolloff: 0.8, max: 80, reverb: 0.4 });
        bp.connect(g).connect(p);
        const src = e.oneShot(this.whirl, bp, { gain: 0.9 });
        src.addEventListener('ended', () => { bp.disconnect(); g.disconnect(); p.disconnect(); p._send?.disconnect(); });
        break;
      }
      case 'glitch':
        this.pool.play(this.glitch, cue.position, { gain: 0.7, rate: rnd(0.9, 1.1) });
        break;
      case 'shriek':
        this.pool.play(this.shriek, cue.position, { gain: 0.9 });
        break;
      case 'bark':
        this.pool.play(file('luna_bark') ?? this.bark, cue.position, { gain: 1.3, rate: rnd(0.95, 1.05) });
        break;
      case 'heartbeat':
        // inside your head: not placed in the world
        e.oneShot(this.heartbeat, e.buses.voices, { gain: 0.8 });
        break;
      case 'whisper': {
        // once round the listener's head (cue.position), close by
        const p = e.panner(cue.position, 'voices', { ref: 1, rolloff: 1, max: 20, reverb: 0.1 });
        const { x, y, z } = cue.position;
        const a0 = Math.random() * Math.PI * 2;
        for (let k = 0; k <= 16; k++) {
          const a = a0 + (k / 16) * Math.PI * 2, at = t + (k / 16) * 2.6;
          if (!p.positionX) break;
          const set = k === 0 ? 'setValueAtTime' : 'linearRampToValueAtTime';
          p.positionX[set](x + Math.cos(a) * 0.9, at);
          p.positionY[set](y + 0.1, at);
          p.positionZ[set](z + Math.sin(a) * 0.9, at);
        }
        const src = e.oneShot(file('ghost_whisper') ?? this.whisper, p, { gain: 0.9 });
        src.addEventListener('ended', () => { p.disconnect(); p._send?.disconnect(); });
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
