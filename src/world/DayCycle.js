import * as THREE from 'three';
import { DAY } from '../core/config.js';
import { smoothstep } from '../utils/noise.js';

// Full day/night cycle. By default one real hour = one whole day:
// dawn -> misty morning -> overcast noon -> dim sunset -> night -> midnight.
// Every lighting-related value is interpolated between keyframes.

const K = (hour, o) => ({ hour, ...o });
const KEYS = [
  K(0, { top: 0x04070c, hor: 0x0b1017, fog: 0x0a0e13, sun: 0x7f95c0, sunI: 0.08, hs: 0x2a3a55, hg: 0x0b0c0a, hI: 0.2, amb: 0.03, exp: 1.3, fogD: 0.021, stars: 0.7, glow: 0.15 }),
  K(4.4, { top: 0x060a11, hor: 0x10161f, fog: 0x0d1218, sun: 0x8197c0, sunI: 0.08, hs: 0x2d3d58, hg: 0x0c0d0b, hI: 0.22, amb: 0.03, exp: 1.3, fogD: 0.022, stars: 0.6, glow: 0.15 }),
  K(5.5, { top: 0x1a2636, hor: 0x4b5a6c, fog: 0x3a4757, sun: 0xd29c78, sunI: 0.22, hs: 0x55667a, hg: 0x191913, hI: 0.48, amb: 0.06, exp: 1.12, fogD: 0.025, stars: 0.05, glow: 0.55 }),
  K(7.0, { top: 0x4f6478, hor: 0x93a3b2, fog: 0x7a8b9b, sun: 0xe6e0d4, sunI: 0.85, hs: 0x9fb2c6, hg: 0x262a1e, hI: 1.0, amb: 0.12, exp: 1.0, fogD: 0.023, stars: 0, glow: 0.5 }),
  K(12.0, { top: 0x71859a, hor: 0xb3bfc8, fog: 0x95a4b0, sun: 0xf2efe8, sunI: 1.5, hs: 0xb8c7d4, hg: 0x2f3127, hI: 1.25, amb: 0.15, exp: 0.95, fogD: 0.019, stars: 0, glow: 0.35 }),
  K(16.0, { top: 0x667a8d, hor: 0xa6b2ba, fog: 0x8a99a5, sun: 0xf0e0c4, sunI: 1.2, hs: 0xb4bec5, hg: 0x312e25, hI: 1.1, amb: 0.13, exp: 0.97, fogD: 0.02, stars: 0, glow: 0.45 }),
  K(18.0, { top: 0x4a5463, hor: 0xae8a70, fog: 0x7a7371, sun: 0xffa86a, sunI: 0.62, hs: 0x8a8b94, hg: 0x2a2219, hI: 0.72, amb: 0.08, exp: 1.05, fogD: 0.022, stars: 0, glow: 1.0 }),
  K(19.3, { top: 0x18233a, hor: 0x37445a, fog: 0x2a3446, sun: 0x9aa8c8, sunI: 0.14, hs: 0x3c4a60, hg: 0x121210, hI: 0.36, amb: 0.05, exp: 1.18, fogD: 0.024, stars: 0.12, glow: 0.3 }),
  K(20.8, { top: 0x05080d, hor: 0x0c1118, fog: 0x0b0f14, sun: 0x7f95c0, sunI: 0.08, hs: 0x2a3a55, hg: 0x0b0c0a, hI: 0.2, amb: 0.03, exp: 1.3, fogD: 0.021, stars: 0.65, glow: 0.15 }),
  K(24.0, { top: 0x04070c, hor: 0x0b1017, fog: 0x0a0e13, sun: 0x7f95c0, sunI: 0.08, hs: 0x2a3a55, hg: 0x0b0c0a, hI: 0.2, amb: 0.03, exp: 1.3, fogD: 0.021, stars: 0.7, glow: 0.15 }),
];
const COLOR_KEYS = ['top', 'hor', 'fog', 'sun', 'hs', 'hg'];
const NUM_KEYS = ['sunI', 'hI', 'amb', 'exp', 'fogD', 'stars', 'glow'];
// pre-convert colors
for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = new THREE.Color(k[c]);

export class DayCycle {
  constructor({ scene, sky, sun, hemi, ambient, renderer }) {
    this.scene = scene; this.sky = sky; this.sun = sun; this.hemi = hemi; this.ambient = ambient; this.renderer = renderer;
    this.hour = DAY.startHour;
    this.cycleSeconds = DAY.cycleSeconds;
    this.paused = false;
    this.state = {};
    for (const c of COLOR_KEYS) this.state[c] = new THREE.Color();
    this.lightDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.env = {
      hour: this.hour, ambientLevel: 1, isDark: false, birdActivity: 1, owlActivity: 0, fogColor: new THREE.Color(),
      fireLightBoost: 1, dayFactor: 1,
    };
    this.apply(true);
  }

  setHour(h) { this.hour = ((h % 24) + 24) % 24; this.apply(true); }

  update(dt) {
    if (!this.paused && this.cycleSeconds > 0) {
      this.hour = (this.hour + (dt * 24) / this.cycleSeconds) % 24;
    }
    this.apply(false);
  }

  _sample() {
    const h = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].hour <= h) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = smoothstep(0, 1, (h - a.hour) / (b.hour - a.hour));
    for (const c of COLOR_KEYS) this.state[c].copy(a[c]).lerp(b[c], t);
    for (const n of NUM_KEYS) this.state[n] = a[n] + (b[n] - a[n]) * t;
  }

  apply(snap) {
    this._sample();
    const s = this.state;
    const h = this.hour;

    // sun travels east -> south -> west; moon opposite
    const ang = ((h - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(ang) * 0.85, Math.sin(ang), -0.45).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.y = Math.abs(this.moonDir.y) * 0.8 + 0.25;
    this.moonDir.normalize();
    const src = this.sunDir.y > -0.02 ? this.sunDir : this.moonDir;
    const target = src.clone();
    target.y = Math.max(target.y, 0.22);
    target.normalize();
    if (snap) this.lightDir.copy(target);
    else this.lightDir.lerp(target, 0.02).normalize();

    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI;
    this.hemi.color.copy(s.hs);
    this.hemi.groundColor.copy(s.hg);
    this.hemi.intensity = s.hI;
    this.ambient.intensity = s.amb * 2.2;
    this.ambient.color.copy(s.hs);

    this.scene.fog.color.copy(s.fog);
    this.scene.fog.density = s.fogD;
    this.renderer.toneMappingExposure = s.exp;

    const u = this.sky.uniforms;
    u.uTop.value.copy(s.top);
    u.uHorizon.value.copy(s.fog).lerp(s.hor, 0.35);
    u.uBottom.value.copy(s.fog);
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uSunColor.value.copy(s.sun);
    u.uSunGlow.value = s.glow * smoothstep(-0.15, 0.1, this.sunDir.y);
    u.uStars.value = s.stars;

    const level = Math.min(1, s.hI / 1.25);
    const e = this.env;
    e.hour = h;
    e.ambientLevel = level;
    e.isDark = level < 0.3;
    e.fogColor.copy(s.fog);
    e.dayFactor = smoothstep(0.25, 0.8, level);
    // dawn chorus, quieter mid-day, evening song, silent night
    const dawn = Math.exp(-Math.pow((h - 6.3) / 1.2, 2));
    const eve = Math.exp(-Math.pow((h - 18.2) / 1.0, 2));
    e.birdActivity = Math.min(1, e.dayFactor * 0.45 + dawn * 0.9 + eve * 0.55);
    e.owlActivity = 1 - smoothstep(0.15, 0.4, level);
  }

  get timeString() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
