import * as THREE from 'three';
import { INTRO } from './introScript.js';
import { EV } from '../../config/events.ts';
import type { Camp } from '../camp/Camp.js';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// The owner's welcome and introductions, played like a film scene: the
// player's camera hands over to a film camera. During the welcome (the
// narrator introducing the game) it flies in from high over the forest,
// circling down over the area to the four friends at the fire, arriving as
// the welcome ends; then it cuts (a quick dip to black) from face to face -
// a portrait of whoever is being introduced, slowly pushing in - while the
// recordings play, and hands control back. Plays once per visit, as soon as
// the player has entered.

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();

/** what the introductions need to play the recordings (set on the camp by app/createGame.ts) */
export interface VoiceService {
  play(key: string, position: THREE.Vector3): VoiceHandle | null;
  /** the recordings have loaded (the introductions wait for them) */
  ready(): boolean;
}

type Step = (typeof INTRO)[number];

/** what the flight has to clear (set by app/createGame.ts) */
export interface FlightObstacles {
  trees: readonly { x: number; z: number; height: number; kind: string }[];
  heightAt(x: number, z: number): number;
}

/** the introductions in progress */
interface Sequence {
  i: number; // index of the current line in INTRO
  t: number; // seconds into the current line
  gap: number; // seconds since its recording ended
  voice: VoiceHandle | null;
  played: number;
  step: Step | null;
  skipping?: boolean;
}

export class IntroDirector {
  readonly camp: Camp;
  /** the "flag": once started it never plays again this visit (set to false to replay) */
  done = false;
  seq: Sequence | null = null;
  /** 1 while the film camera owns the view */
  private w = 0;
  /** black dip used for cuts (0..1) */
  private fade = 0;
  private _sentFade = -1;
  private cutPhase: 'out' | 'in' | null = null;
  /** what to do once the screen is black */
  private pending: (() => void) | null = null;
  private snap = false;
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private fov = 70;
  private _tPos = new THREE.Vector3();
  private _tLook = new THREE.Vector3();
  /** the flight in during the welcome */
  private fly: { curve: THREE.CatmullRomCurve3; dur: number; ground: THREE.Vector3 } | null = null;
  /** the shot follows its path exactly (the flight) instead of lagging behind */
  private exact = false;
  private _from = new THREE.Vector3();
  /** the trees the flight keeps above */
  obstacles: FlightObstacles | null = null;

  constructor(camp: Camp) {
    this.camp = camp;
  }

  get active(): boolean { return !!this.seq; }

  start(): void {
    if (this.done) return;
    this.done = true;
    this.seq = { i: -1, t: 0, gap: 0, voice: null, played: 0, step: null };
    this.camp.events.emit(EV.INTRO_DUCK, true);
    this.camp.events.emit(EV.INTRO_CINEMATIC, true);
    this._cut(() => { this.w = 1; this._next(); });
  }

  skip(): void {
    if (!this.seq || this.seq.skipping) return;
    this.seq.skipping = true;
    this.seq.voice?.stop();
    this._cut(() => this._finish());
  }

  // dip to black, run `fn` while the screen is black, come back
  private _cut(fn: () => void): void { this.pending = fn; this.cutPhase = 'out'; }

  private _next(): void {
    const s = this.seq;
    if (!s) return;
    const g = this.camp.gathering;
    const owner = g.byName('owner')!; // the owner always sits at the fire
    while (++s.i < INTRO.length) {
      const step = INTRO[s.i];
      const v = this.camp.voices?.play(step.key, owner.headPos) ?? null;
      if (!v) continue; // no recording for this step (yet)
      Object.assign(s, { voice: v, t: 0, gap: 0, step });
      this.fly = null;
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

  private _finish(): void {
    const g = this.camp.gathering;
    this.seq = null;
    this.w = 0;
    g.focus = null;
    this.camp.events.emit(EV.INTRO_CAPTION, null);
    this.camp.events.emit(EV.INTRO_SUBTITLE, null);
    this.camp.events.emit(EV.INTRO_DUCK, false);
    this.camp.events.emit(EV.INTRO_CINEMATIC, false);
  }

  private _name(focus: string | null): string | null {
    if (focus === 'luna') return 'لونا';
    // the welcome and his own introduction: a neutral title (his name isn't shown)
    if (!focus || focus === 'owner') return this.camp.gathering.byName('owner')?.spec.name || 'میزبان';
    return this.camp.gathering.byName(focus)?.spec.name || null;
  }

  update(dt: number): void {
    // cut transitions
    if (this.cutPhase === 'out') {
      this.fade = Math.min(1, this.fade + dt / 0.35);
      if (this.fade >= 1) { const fn = this.pending; this.pending = null; this.cutPhase = 'in'; this.snap = true; fn?.(); }
    } else if (this.cutPhase === 'in') {
      this.fade = Math.max(0, this.fade - dt / 0.5);
      if (this.fade <= 0) this.cutPhase = null;
    }
    if (this.fade !== this._sentFade) { this._sentFade = this.fade; this.camp.events.emit(EV.INTRO_FADE, this.fade); } // only on change
    const s = this.seq;
    if (!s || !s.voice || this.cutPhase === 'out') return;
    s.t += dt;
    // next line a moment after the audio really finished (frame-rate independent);
    // the flight lands on the owner just as the welcome ends: no cut, he starts right away
    if (s.voice.done) s.gap += dt;
    const flying = !!this.fly;
    if (s.gap > (flying ? 0.1 : 0.6)) { s.voice = null; if (flying) this._next(); else this._cut(() => this._next()); }
  }

  // the welcome's flight: from high above where the player stands it sweeps
  // round over the camp and the cabin above the treetops, comes down over
  // the open side of the clearing (the trail the player came by) and glides
  // in at head height under the canopy's edge to the owner; it never passes
  // through a tree, a roof or the tarp
  private _plan(end: THREE.Vector3, head: THREE.Vector3, dur: number) {
    const ground = new THREE.Vector3(this.camp.fire.x, head.y - 1.15, this.camp.fire.z);
    const a0 = Math.atan2(this._from.x - ground.x, this._from.z - ground.z);
    const at = (a: number, r: number, h: number) => ground.clone().add(new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r));
    const curve = new THREE.CatmullRomCurve3([
      at(a0, 62, 44),
      at(a0 + 1.4, 40, 34),
      at(a0 + 2.7, 24, 26),
      at(a0 + 0.35, 10, 14),
      at(a0, 6.8, 1.8),
      end.clone(),
    ], false, 'centripetal');
    this._clearTrees(curve);
    return { curve, dur: Math.max(4, dur), ground };
  }

  // lift the high part of the path wherever it would dip into a crown
  private _clearTrees(curve: THREE.CatmullRomCurve3): void {
    const ob = this.obstacles;
    if (!ob) return;
    const pts = curve.points;
    const liftable = pts.length - 2; // the glide in under the canopy stays as planned
    const crowns = ob.trees.map((t) => ({ x: t.x, z: t.z, top: ob.heightAt(t.x, t.z) + t.height + 2.5, r: t.height * (t.kind === 'broadleaf' ? 0.32 : 0.2) + 2.5 }));
    const p = new THREE.Vector3();
    for (let pass = 0; pass < 6; pass++) {
      curve.updateArcLengths();
      let moved = false;
      const N = 200;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        curve.getPoint(u, p);
        let need = -Infinity;
        for (const c of crowns) {
          const dx = p.x - c.x, dz = p.z - c.z;
          if (dx * dx + dz * dz < c.r * c.r && c.top > need) need = c.top;
        }
        if (p.y >= need) continue;
        // the two control points around this spot carry the lift
        const k = u * (pts.length - 1);
        for (const j of [Math.floor(k), Math.ceil(k)]) {
          if (j < liftable) { pts[j].y = Math.max(pts[j].y, pts[j].y + (need - p.y) * 0.6 + 0.5); moved = true; }
        }
      }
      if (!moved) break;
    }
  }

  // where the film camera wants to be for the current line; returns its field of view
  private _shot(s: Sequence): number {
    const g = this.camp.gathering;
    const push = Math.min(s.t, 12) / 12; // slow push-in during each line
    const focus = s.step?.focus;
    this.exact = false;
    if (focus === 'luna') {
      const d = this.camp.dog;
      const left = new THREE.Vector3(d.forward.z, 0, -d.forward.x);
      this._tLook.copy(d.headWorld);
      this._tPos.copy(d.headWorld).addScaledVector(d.forward, 0.85 - push * 0.2).addScaledVector(left, 0.3).addScaledVector(UP, 0.1);
      return 34;
    }
    const p = g.byName(focus || 'owner')!; // everyone introduced is at the fire
    const head = p.headPos;
    if (!focus) {
      // the welcome ends on a medium shot of the owner beside Luna
      const look = head.clone().addScaledVector(UP, -0.22);
      const end = head.clone().addScaledVector(p.fwd, 1.75).addScaledVector(p.right, -0.55).addScaledVector(UP, 0.1);
      if (s.step?.key === 'welcome') {
        this.fly ??= this._plan(end, head, s.voice?.duration ?? 12);
        const f = this.fly;
        f.curve.points[f.curve.points.length - 1].copy(end);
        const u = Math.min(1, s.t / f.dur);
        const e = u * u * (3 - 2 * u); // eases out of the sky and settles at the end
        f.curve.getPointAt(e, this._tPos);
        // first the whole area below, then the friends at the fire
        const k = THREE.MathUtils.smoothstep(e, 0.45, 0.97);
        this._tLook.copy(f.ground).addScaledVector(UP, 0.5).lerp(look, k);
        this.exact = true;
        return 58 + (42 - 58) * k;
      }
      this._tLook.copy(look);
      this._tPos.copy(end).addScaledVector(p.fwd, -push * 0.35);
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
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.w || !this.seq) {
      this._from.copy(camera.position); // where the player is: the flight starts above it
      if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
      return;
    }
    const fov = this._shot(this.seq);
    _m.lookAt(this._tPos, this._tLook, UP);
    const tq = new THREE.Quaternion().setFromRotationMatrix(_m);
    if (this.snap) { this.pos.copy(this._tPos); this.quat.copy(tq); this.fov = fov; this.snap = false; }
    // within a shot: steady, slightly lagging camera (follows the slow push-in);
    // the flight keeps to its path
    const k = 1 - Math.exp(-(this.exact ? 14 : 4) * dt);
    this.pos.lerp(this._tPos, k);
    this.quat.slerp(tq, k);
    this.fov += (fov - this.fov) * k;
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
