import * as THREE from 'three';
import { loopBuffer, white, pink, brown, biquad } from './dsp.js';

// Web Audio core: context, mix buses (rain / wind / fire / wildlife / steps),
// a forest reverb, HRTF 3D panners, listener tracking and optional real
// recordings (public/audio/manifest.json) that replace synthesized layers.

export class AudioEngine {
  constructor() {
    /** @type {AudioContext | null} */
    this.ctx = null;
    this.ready = false;
    /** recordings have finished loading (or failed): nothing waits any longer */
    this.filesLoaded = false;
    this.volumes = { master: 0.85, rain: 0.8, wind: 0.75, fire: 0.9, wildlife: 0.85, steps: 0.7, voices: 1, music: 0.5 };
    this.muted = false;
    /** @type {Record<string, AudioBuffer | AudioBuffer[]>} */
    this.files = {};
    this.duck = 1; // ambience multiplier while someone is speaking (1 = normal)
    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
  }

  async init() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    ctx.resume?.(); // still inside the click
    // iPhone: play even with the ring / silent switch on
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }

    this.out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.out.connect(comp).connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(this.out);

    /** @type {Record<string, GainNode>} */
    this.buses = {};
    for (const name of ['rain', 'wind', 'fire', 'wildlife', 'steps', 'voices', 'music']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[name] = g;
    }

    // forest reverb: soft, damped, ~2.4 s tail
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeIR(2.4);
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = 0.55;
    this.reverbIn.connect(this.reverb).connect(reverbOut).connect(this.master);

    // shared noise loops
    this.noise = {
      white: loopBuffer(ctx, 6, 1, (d) => white(d)),
      pink: loopBuffer(ctx, 8, 2, (d) => pink(d)),
      brown: loopBuffer(ctx, 10, 2, (d) => brown(d)),
    };

    this.applyVolumes();
    // recordings load in the background (all at once); nothing waits for them
    this.filesReady = this._loadManifest().then(() => { this.filesLoaded = true; });
    this.ready = true;
    if (ctx.state !== 'running') await ctx.resume();
  }

  _makeIR(seconds) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / seconds, 2.2) * Math.exp(-t * 1.6);
      }
      // sparse early reflections from trunks
      for (let k = 0; k < 14; k++) {
        const at = Math.floor((0.012 + Math.random() * 0.09) * sr);
        d[at] += (Math.random() - 0.5) * 0.9;
      }
      biquad(d, sr, 'lowpass', 3800, 0.5);
      biquad(d, sr, 'highpass', 180, 0.6);
      for (let i = 0; i < Math.floor(0.015 * sr); i++) d[i] *= i / (0.015 * sr);
    }
    return buf;
  }

  async _loadManifest() {
    try {
      const res = await fetch('audio/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      if (!text.trim().startsWith('{')) return;
      const manifest = JSON.parse(text);
      const load = async (url) => {
        try {
          const r = await fetch('audio/' + url);
          if (!r.ok) return null;
          return await this.ctx.decodeAudioData(await r.arrayBuffer());
        } catch { return null; }
      };
      await Promise.all(Object.entries(manifest).map(async ([key, val]) => {
        if (key.startsWith('_')) return;
        if (Array.isArray(val)) {
          const list = (await Promise.all(val.filter(Boolean).map(load))).filter(Boolean);
          if (list.length) this.files[key] = list;
        } else if (typeof val === 'string' && val) {
          const b = await load(val);
          if (b) this.files[key] = b;
        }
      }));
    } catch {
      /* no manifest: everything is synthesized */
    }
  }

  file(key) { return this.files[key] || null; }

  applyVolumes(tc = 0.08) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.08);
    for (const [k, g] of Object.entries(this.buses)) {
      const v = this.volumes[k] ?? 1;
      g.gain.setTargetAtTime(k === 'voices' ? v * (this.duck < 1 ? 1.6 : 1) : v * this.duck, t, tc);
    }
    if (this.reverbIn) this.reverbIn.gain.setTargetAtTime(this.duck < 1 ? 0.35 : 1, t, tc);
  }

  // Dialogue ducking: quickly lower the rain / wind / fire / animals and lift
  // the voice while a line is spoken, then let the ambience swell back slowly.
  setDucking(on) {
    this.duck = on ? 0.22 : 1;
    this.applyVolumes(on ? 0.18 : 1.6);
  }

  setVolume(name, v) { this.volumes[name] = v; this.applyVolumes(); }
  setMuted(m) { this.muted = m; this.applyVolumes(); }

  /** HRTF panner at a world position, routed into a bus (+ optional reverb send). */
  panner(pos, bus, { ref = 2, rolloff = 1, max = 250, reverb = 0.2 } = {}) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = max;
    this.setPannerPos(p, pos, true);
    p.connect(this.buses[bus]);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      p.connect(s).connect(this.reverbIn);
      p._send = s;
    }
    return p;
  }

  setPannerPos(p, pos, instant = false) {
    if (p.positionX) {
      if (instant) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else {
        const t = this.ctx.currentTime;
        p.positionX.setTargetAtTime(pos.x, t, 0.03);
        p.positionY.setTargetAtTime(pos.y, t, 0.03);
        p.positionZ.setTargetAtTime(pos.z, t, 0.03);
      }
    } else p.setPosition(pos.x, pos.y, pos.z);
  }

  /** Looping buffer source started at a random offset (so layers never line up). */
  loop(buffer, dest, { rate = 1, gain = 1 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(this.ctx.currentTime + 0.05, Math.random() * buffer.duration);
    return { src, gain: g };
  }

  /** One-shot buffer through a fresh gain into dest. */
  oneShot(buffer, dest, { gain = 1, rate = 1, when = 0 } = {}) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(this.ctx.currentTime + when);
    src.onended = () => { src.disconnect(); g.disconnect(); };
    return src;
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = camera.position;
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.015);
      L.positionY.setTargetAtTime(p.y, t, 0.015);
      L.positionZ.setTargetAtTime(p.z, t, 0.015);
      L.forwardX.setTargetAtTime(this._fwd.x, t, 0.015);
      L.forwardY.setTargetAtTime(this._fwd.y, t, 0.015);
      L.forwardZ.setTargetAtTime(this._fwd.z, t, 0.015);
      L.upX.setTargetAtTime(this._up.x, t, 0.015);
      L.upY.setTargetAtTime(this._up.y, t, 0.015);
      L.upZ.setTargetAtTime(this._up.z, t, 0.015);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }
  }
}
