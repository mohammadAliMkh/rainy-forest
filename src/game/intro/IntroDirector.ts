import * as THREE from 'three';
import { INTRO } from './introScript.js';
import { EV } from '../../config/events.ts';
import type { Camp } from '../camp/Camp.js';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// The owner's welcome and introductions, played like a film scene. The
// moment the player enters, the view is already high in the sky (circling
// there until the recordings have loaded); during the welcome (the narrator
// introducing the game) the camera flies like a drone, circling and coming
// down over the area, lower and closer as the welcome ends, and lands on the
// owner's face just as his own introduction starts. Then it cuts (a quick
// dip to black) from face to face - a portrait of whoever is being
// introduced, slowly pushing in - while the recordings play, and hands
// control back. The voices are a voice-over: nobody's lips move. Once per
// visit.

const UP = new THREE.Vector3(0, 1, 0);

// how the people at the fire are framed when introduced (metres from the
// head, out along the three-quarter view; vertical field of view in degrees):
// the whole seated person, head to feet, not just the face
const PORTRAIT = { d: 2.1, up: -0.08, lookDown: 0.35, fov: 40 };
const GUITAR = { d: 2.4, up: -0.08, lookDown: 0.35, fov: 42 };

/** a shot's vertical field of view, widened on a tall (portrait) screen so the
 * sides of the frame - the person's body - are the same as on a square one */
export function fitFov(fov: number, aspect: number): number {
  if (!(aspect < 1)) return fov;
  const t = Math.tan(THREE.MathUtils.degToRad(fov) / 2) / aspect;
  return Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(t)));
}
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
  /** up in the sky, waiting for the recordings to load */
  waiting?: boolean;
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
  /** seconds spent circling in the sky while the recordings load */
  private hoverT = 0;
  /** the trees the flight keeps above */
  obstacles: FlightObstacles | null = null;

  constructor(camp: Camp) {
    this.camp = camp;
  }

  get active(): boolean { return !!this.seq; }

  start(): void {
    if (this.done) return;
    this.done = true;
    this.seq = { i: -1, t: 0, gap: 0, voice: null, played: 0, step: null, waiting: true };
    this.camp.events.emit(EV.INTRO_DUCK, true);
    this.camp.events.emit(EV.INTRO_CINEMATIC, true);
    // straight into the sky: the first frame after entering is already up there
    this.w = 1;
    this.snap = true;
    this.hoverT = 0;
    this.fade = 1;
    this.cutPhase = 'in';
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
    if (s?.waiting) {
      this.hoverT += dt;
      if (this.camp.voices?.ready() ?? true) { s.waiting = false; this._next(); }
      return;
    }
    if (!s || !s.voice || this.cutPhase === 'out') return;
    // time in the line by the audio clock, so the flight lands as the welcome
    // ends even when frames come slowly (a busy laptop just after entering
    // drops frames, and the game's step is capped at 1/20 s)
    s.t = s.voice.elapsed?.() ?? s.t + dt;
    // next line a moment after the audio really finished (frame-rate independent);
    // the flight lands on the owner just as the welcome ends: no cut, he starts right away
    if (s.voice.done) s.gap += dt;
    const flying = !!this.fly;
    if (s.gap > (flying ? 0.1 : 0.6)) { s.voice = null; if (flying) this._next(); else this._cut(() => this._next()); }
  }

  /** the ground at the fire, and which way the player stood from it */
  private _ground(head: THREE.Vector3): { ground: THREE.Vector3; a0: number } {
    const ground = new THREE.Vector3(this.camp.fire.x, head.y - 1.15, this.camp.fire.z);
    return { ground, a0: Math.atan2(this._from.x - ground.x, this._from.z - ground.z) };
  }

  // the welcome's flight, like a drone, always coming down: from where it
  // circles high in the sky it loops round the cabin and the camp above the
  // treetops, drops into the clearing through its open side (the side the
  // owner is seen from) and settles on the owner's face; it never passes
  // through a tree, a roof or the tarp
  private _plan(end: THREE.Vector3, head: THREE.Vector3, toward: THREE.Vector3, dur: number) {
    const { ground, a0 } = this._ground(head);
    const at = (a: number, r: number, h: number) => ground.clone().add(new THREE.Vector3(Math.sin(a) * r, h, Math.cos(a) * r));
    const aA = Math.atan2(toward.x, toward.z); // the way into the clearing: where the owner is seen from
    let loop = aA - a0;
    while (loop > 0) loop -= Math.PI * 2; // the long way round, over the cabin
    while (loop < -Math.PI * 2) loop += Math.PI * 2;
    const curve = new THREE.CatmullRomCurve3([
      this.pos.clone(), // where it was circling
      at(a0 + loop * 0.4, 42, 50),
      at(a0 + loop * 0.75, 24, 42),
      at(aA, 7, 20),
      at(aA, 6, 1.9),
      end.clone(),
    ], false, 'centripetal');
    this._clearTrees(curve);
    return { curve, dur: Math.max(4, dur), ground };
  }

  // keep the high part of the path above the treetops: each control point
  // is lifted by the most any spot near it dips into a crown (counted from
  // where the crown starts - flying under one near the ground is fine), and
  // the path never climbs: no point is higher than the one before it
  private _clearTrees(curve: THREE.CatmullRomCurve3): void {
    const ob = this.obstacles;
    const pts = curve.points;
    const n = pts.length;
    const liftable = n - 2; // the glide in under the canopy stays as planned
    if (ob) {
      const crowns = ob.trees.map((t) => {
        const g = ob.heightAt(t.x, t.z);
        const broad = t.kind === 'broadleaf';
        return { x: t.x, z: t.z, top: g + t.height + 2.5, base: g + t.height * (broad ? 0.35 : 0.15) - 1, r: t.height * (broad ? 0.32 : 0.2) + 2.5 };
      });
      const p = new THREE.Vector3();
      const N = 160;
      const uMax = (liftable - 1) / (n - 1); // only the part between the liftable points
      for (let pass = 0; pass < 4; pass++) {
        const deficit = new Array<number>(n).fill(0);
        for (let i = 0; i <= N; i++) {
          const u = (i / N) * uMax;
          curve.getPoint(u, p);
          let need = -Infinity;
          for (const c of crowns) {
            const dx = p.x - c.x, dz = p.z - c.z;
            if (p.y > c.base && dx * dx + dz * dz < c.r * c.r && c.top > need) need = c.top;
          }
          if (p.y >= need) continue;
          const j = Math.round(u * (n - 1));
          deficit[j] = Math.max(deficit[j], need - p.y);
        }
        let moved = false;
        for (let j = 1; j < liftable; j++) if (deficit[j] > 0) { pts[j].y += deficit[j] + 0.5; moved = true; }
        if (!moved) break;
      }
    }
    // only ever coming down
    for (let j = 1; j < n; j++) pts[j].y = Math.min(pts[j].y, pts[j - 1].y);
    curve.updateArcLengths();
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
    if (s.waiting || !s.step) {
      // high in the sky, slowly circling over the area until the recordings are there
      const { ground, a0 } = this._ground(head);
      const a = a0 + this.hoverT * 0.03;
      this._tPos.copy(ground).add(new THREE.Vector3(Math.sin(a) * 70, 60, Math.cos(a) * 70));
      this._tLook.copy(ground).addScaledVector(UP, 0.5);
      this.exact = true;
      return 58;
    }
    if (!focus) {
      // the welcome lands on the owner: the very shot his introduction starts with
      const pdir = p.fwd.clone().multiplyScalar(0.8).addScaledVector(p.right, 0.5).normalize();
      const look = head.clone().addScaledVector(UP, -PORTRAIT.lookDown);
      const end = head.clone().addScaledVector(pdir, PORTRAIT.d).addScaledVector(UP, PORTRAIT.up);
      if (s.step?.key === 'welcome') {
        this.fly ??= this._plan(end, head, pdir, s.voice?.duration ?? 12);
        const f = this.fly;
        f.curve.points[f.curve.points.length - 1].copy(end);
        const u = Math.min(1, s.t / f.dur);
        const e = 1 - Math.pow(1 - u, 1.7); // moving off at once, settling gently in front of him
        f.curve.getPointAt(e, this._tPos);
        // first the whole area below, then the friends at the fire
        const k = THREE.MathUtils.smoothstep(e, 0.45, 0.97);
        this._tLook.copy(f.ground).addScaledVector(UP, 0.5).lerp(look, k);
        this.exact = true;
        return 58 + (PORTRAIT.fov - 58) * k;
      }
      this._tLook.copy(look);
      this._tPos.copy(end);
      return PORTRAIT.fov;
    }
    // portrait: three-quarter view of the whole person on their seat, a little
    // below eye level, slowly closing in; Amin a bit wider for the guitar
    const f = p.h.guitar ? GUITAR : PORTRAIT;
    const dir = p.fwd.clone().multiplyScalar(0.8).addScaledVector(p.right, 0.5).normalize();
    this._tLook.copy(head).addScaledVector(UP, -f.lookDown);
    this._tPos.copy(head).addScaledVector(dir, f.d - push * 0.25).addScaledVector(UP, f.up);
    return f.fov;
  }

  // called right after the player has placed the camera for this frame
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.w || !this.seq) {
      this._from.copy(camera.position); // where the player is: the flight starts above it
      if (camera.fov !== 70) { camera.fov = 70; camera.updateProjectionMatrix(); }
      return;
    }
    const fov = fitFov(this._shot(this.seq), camera.aspect);
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
