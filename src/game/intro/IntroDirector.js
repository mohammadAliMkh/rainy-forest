import * as THREE from 'three';
import { INTRO } from './introScript.js';
import { EV } from '../../config/events.js';

// The owner's welcome and introductions, played like a film scene: the
// player's camera hands over to a film camera that cuts (a quick dip to
// black) from face to face - a portrait of whoever is being introduced,
// slowly pushing in - while the recordings play, then hands control back.
// Plays once per visit.

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();

export class IntroDirector {
  constructor(camp) {
    this.camp = camp;
    this.done = false;          // the "flag": once started it never plays again this visit
    this.seq = null;
    this.w = 0;                 // 1 while the film camera owns the view
    this.fade = 0;              // black dip used for cuts (0..1)
    this.pending = null;        // what to do once the screen is black
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.fov = 70;
    this._tPos = new THREE.Vector3();
    this._tLook = new THREE.Vector3();
  }

  get active() { return !!this.seq; }

  start() {
    if (this.done) return;
    this.done = true;
    this.seq = { i: -1, t: 0, gap: 0, voice: null, played: 0, step: null };
    this.camp.events.emit(EV.INTRO_DUCK, true);
    this.camp.events.emit(EV.INTRO_CINEMATIC, true);
    this._cut(() => { this.w = 1; this._next(); });
  }

  skip() {
    if (!this.seq || this.seq.skipping) return;
    this.seq.skipping = true;
    this.seq.voice?.stop?.();
    this._cut(() => this._finish());
  }

  // dip to black, run `fn` while the screen is black, come back
  _cut(fn) { this.pending = fn; this.cutPhase = 'out'; }

  _next() {
    const s = this.seq;
    const g = this.camp.gathering;
    const owner = g.byName('owner');
    while (++s.i < INTRO.length) {
      const step = INTRO[s.i];
      const v = this.camp.voices?.play(step.key, owner.headPos) ?? null;
      if (!v) continue; // no recording for this step (yet)
      Object.assign(s, { voice: v, t: 0, gap: 0, step });
      s.played++;
      g.say('owner', v.duration + 0.2);
      g.focus = step.focus;
      this.camp.events.emit(EV.INTRO_CAPTION, this._name(step.focus));
      this.camp.events.emit(EV.INTRO_SUBTITLE, step.text || null);
      return;
    }
    // nothing recorded at all: he still turns to the player and beckons
    if (!s.played) g.say('owner', 6);
    this._finish();
  }

  _finish() {
    const g = this.camp.gathering;
    this.seq = null;
    this.w = 0;
    g.focus = null;
    this.camp.events.emit(EV.INTRO_CAPTION, null);
    this.camp.events.emit(EV.INTRO_SUBTITLE, null);
    this.camp.events.emit(EV.INTRO_DUCK, false);
    this.camp.events.emit(EV.INTRO_CINEMATIC, false);
  }

  _name(focus) {
    if (focus === 'luna') return 'لونا';
    // the welcome and his own introduction: a neutral title (his name isn't shown)
    if (!focus || focus === 'owner') return this.camp.gathering.byName('owner')?.spec.name || 'میزبان';
    return this.camp.gathering.byName(focus)?.spec.name || null;
  }

  update(dt) {
    // cut transitions
    if (this.cutPhase === 'out') {
      this.fade = Math.min(1, this.fade + dt / 0.35);
      if (this.fade >= 1) { const fn = this.pending; this.pending = null; this.cutPhase = 'in'; this.snap = true; fn?.(); }
    } else if (this.cutPhase === 'in') {
      this.fade = Math.max(0, this.fade - dt / 0.5);
      if (this.fade <= 0) this.cutPhase = null;
    }
    this.camp.events.emit(EV.INTRO_FADE, this.fade);
    const s = this.seq;
    if (!s || !s.voice || this.cutPhase === 'out') return;
    s.t += dt;
    // next line a moment after the audio really finished (frame-rate independent)
    if (s.voice.done) s.gap += dt;
    if (s.gap > 0.6) { s.voice = null; this._cut(() => this._next()); }
  }

  // where the film camera wants to be for the current line
  _shot() {
    const g = this.camp.gathering;
    const s = this.seq;
    const push = Math.min(s.t, 12) / 12; // slow push-in during each line
    const focus = s.step?.focus;
    if (focus === 'luna') {
      const d = this.camp.dog;
      const left = new THREE.Vector3(d.forward.z, 0, -d.forward.x);
      this._tLook.copy(d.headWorld);
      this._tPos.copy(d.headWorld).addScaledVector(d.forward, 0.85 - push * 0.2).addScaledVector(left, 0.3).addScaledVector(UP, 0.1);
      return 34;
    }
    const p = g.byName(focus || 'owner');
    const head = p.headPos;
    if (!focus) {
      // the welcome: a medium shot of the owner beside Luna
      this._tLook.copy(head).addScaledVector(UP, -0.22);
      this._tPos.copy(head).addScaledVector(p.fwd, 1.75 - push * 0.35).addScaledVector(p.right, -0.55).addScaledVector(UP, 0.1);
      return 42;
    }
    if (p.h.guitar) {
      // Amin: a wider three-quarter shot so his guitar is in the frame
      this._tLook.copy(head).addScaledVector(UP, -0.2);
      const dir = p.fwd.clone().multiplyScalar(0.8).addScaledVector(p.right, 0.5).normalize();
      this._tPos.copy(head).addScaledVector(dir, 1.9 - push * 0.25).addScaledVector(UP, 0.0);
      return 42;
    }
    // portrait: three-quarter view, eye level, slowly closing in
    this._tLook.copy(head).addScaledVector(UP, 0.07);
    const dir = p.fwd.clone().multiplyScalar(0.8).addScaledVector(p.right, 0.5).normalize();
    this._tPos.copy(head).addScaledVector(dir, 1.0 - push * 0.18).addScaledVector(UP, 0.06);
    return 30;
  }

  // called right after the player has placed the camera for this frame
  applyCamera(camera, dt) {
    if (!this.w || !this.seq) {
      if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
      return;
    }
    const fov = this._shot();
    _m.lookAt(this._tPos, this._tLook, UP);
    const tq = new THREE.Quaternion().setFromRotationMatrix(_m);
    if (this.snap) { this.pos.copy(this._tPos); this.quat.copy(tq); this.fov = fov; this.snap = false; }
    // within a shot: steady, slightly lagging camera (follows the slow push-in)
    const k = 1 - Math.exp(-4 * dt);
    this.pos.lerp(this._tPos, k);
    this.quat.slerp(tq, k);
    this.fov += (fov - this.fov) * k;
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
