import * as THREE from 'three';
import type { Human } from './Human.js';
import { damp, clamp } from '../../utils/noise.js';
import { putGuitarDown, stepGuitarDrop } from './Flight.ts';
import type { SeatPose, GuitarDrop } from './Flight.ts';

// Someone at the fire who has seen the ghost: still in their seat they turn
// their head to it with a start, staring, frozen for a moment; then they jump
// up (a guitar is put down against the stump), hurry round to their place in
// the line, glancing back at it, and stand there facing it - upright,
// breathing hard, hands half up in front of them, ready. Drives the same rig
// the gathering uses; while it runs the gathering leaves that person alone
// (Gathering checks `act`). `sitFrom()` has them sit back down, standing in front
// of the seat; `finish()` puts them straight back on it.

const UP = new THREE.Vector3(0, 1, 0);
type Rig = Human & { voiceLevel: number | null };
type Euler3 = [number, number, number];
type Phase = 'turn' | 'up' | 'walk' | 'face' | 'sit' | 'done';

/** hurrying (m/s), strides a second, getting up (s) */
const HURRY = { speed: 2.5, steps: 1.45, up: 0.45 };
/** sitting back down (s) */
const SIT = 2;

const ease = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export interface LineUpRoute {
  /** where they stand in the line (x, z) */
  spot: [number, number];
  /** the way round to it, from in front of the seat (x, z) */
  via?: [number, number][];
  /** how long they sit staring before they get up (s) */
  stare: number;
}

export class LineUp {
  phase: Phase = 'turn';
  /** what they stare at (world; the scene keeps it up to date, or gives them another) */
  target: THREE.Vector3;
  private readonly h: Rig;
  private readonly seat: SeatPose;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly path: THREE.Vector2[];
  private readonly stare: number;
  private readonly seatedLegs: Euler3[][];
  /** the pelvis above the ground standing straight */
  readonly standH: number;
  private readonly guitarLocal: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion } | null;
  private guitarDrop: GuitarDrop | null = null;
  private t = 0; private time = 0;
  private x: number; private z: number; private heading: number;
  private stand = 0; private walk = 0; private tense = 0;
  private gait = 0;
  private seg = 0; private along = 0;
  private headYaw = 0; private headPitch = 0;
  private flinchT = -1;
  private readonly hand = [new THREE.Vector3(), new THREE.Vector3()];
  private handsSet = false;
  private readonly from = new THREE.Vector2();
  private fromHeading = 0;

  constructor(h: Human, seat: SeatPose, route: LineUpRoute, terrain: { heightAt(x: number, z: number): number }, target: THREE.Vector3) {
    this.h = h as Rig;
    this.seat = seat;
    this.terrain = terrain;
    this.target = target;
    this.stare = route.stare;
    this.x = seat.x; this.z = seat.z; this.heading = seat.facing;
    const front = new THREE.Vector2(seat.x + Math.sin(seat.facing) * 0.35, seat.z + Math.cos(seat.facing) * 0.35);
    this.path = [front, ...(route.via ?? []).map(([x, z]) => new THREE.Vector2(x, z)), new THREE.Vector2(...route.spot)];
    this.seatedLegs = h.legs.map((L) => [L.hip, L.knee, L.ankle].map((j) => [j.rotation.x, j.rotation.y, j.rotation.z] as Euler3));
    // the pelvis height standing: straighten the legs for a moment and measure
    for (const L of h.legs) for (const j of [L.hip, L.knee, L.ankle]) j.rotation.set(0, 0, 0);
    h.root.updateMatrixWorld(true);
    this.standH = h.root.position.y - h.legs[0].ankle.getWorldPosition(new THREE.Vector3()).y + 0.085 * h.root.scale.x;
    this._legs();
    const gt = h.guitar?.group as THREE.Object3D | undefined;
    this.guitarLocal = gt ? { parent: gt.parent!, pos: gt.position.clone(), quat: gt.quaternion.clone() } : null;
  }

  get done(): boolean { return this.phase === 'done'; }
  /** their place in the line (x, z) */
  get spot(): THREE.Vector2 { return this.path[this.path.length - 1]; }
  /** in their place in the line, facing it */
  get lined(): boolean { return this.phase === 'face'; }
  /** where they stand now (x, z) and which way they face */
  get where(): { x: number; z: number; heading: number } { return { x: this.x, z: this.z, heading: this.heading }; }
  /** where their hands are now (world; right, left) */
  get hands(): readonly THREE.Vector3[] { return this.hand; }

  /** at once in their place in the line, facing what they stare at (when what comes before is skipped over) */
  standInLine(): void {
    const gt = this.h.guitar?.group as THREE.Object3D | undefined;
    if (gt) stepGuitarDrop(putGuitarDown(this.h, gt, this.seat, this.terrain), gt, 1);
    const s = this.spot;
    this.x = s.x; this.z = s.y;
    this.heading = Math.atan2(this.target.x - s.x, this.target.z - s.y);
    this.stand = 1; this.walk = 0; this.tense = 1;
    this.seg = this.path.length - 1;
    this.phase = 'face'; this.t = 1;
  }

  /** in the line, a start: half a step back from it, the hands flying up */
  flinch(): void { if (this.phase === 'face') this.flinchT = 0; }

  /** the way back from their place in the line to in front of the seat (x, z) */
  get wayBack(): THREE.Vector2[] { return this.path.map((v) => v.clone()); }

  /** standing at (x, z), coming from elsewhere, their hands at `hands`: they sit back down */
  sitFrom(x: number, z: number, heading: number, hands: readonly THREE.Vector3[], stride: number, walk: number): void {
    this.x = x; this.z = z; this.heading = heading;
    this.from.set(x, z); this.fromHeading = heading;
    this.gait = stride; this.walk = walk; this.stand = 1; this.tense = 0;
    hands.forEach((v, i) => this.hand[i].copy(v));
    this.handsSet = true;
    this.phase = 'sit'; this.t = 0;
  }

  /** at once back on the seat (the scene is over or cut short) */
  finish(): void { this.phase = 'done'; this._restore(); }

  update(dt: number): void {
    if (this.phase === 'done') return;
    this.t += dt; this.time += dt;
    let jump = 0;
    const toTarget = Math.atan2(this.target.x - this.x, this.target.z - this.z);
    if (this.phase === 'turn') {
      // a start in the seat, then frozen, staring
      jump = Math.sin(clamp(this.t / 0.3, 0, 1) * Math.PI) * 0.05;
      this.tense = ease(this.t / 0.3);
      if (this.t >= this.stare) {
        this.phase = 'up'; this.t = 0;
        const gt = this.h.guitar?.group as THREE.Object3D | undefined;
        if (gt) this.guitarDrop = putGuitarDown(this.h, gt, this.seat, this.terrain);
      }
    } else if (this.phase === 'up') {
      // up on their feet, turning toward the way they go
      const k = ease(this.t / HURRY.up);
      this.stand = k;
      this.x = this.seat.x + (this.path[0].x - this.seat.x) * k;
      this.z = this.seat.z + (this.path[0].y - this.seat.z) * k;
      const d = this.path[1].clone().sub(this.path[0]);
      this.heading = lerpAngle(this.seat.facing, Math.atan2(d.x, d.y), k);
      if (this.t >= HURRY.up) { this.phase = 'walk'; this.t = 0; this.seg = 0; this.along = 0; }
    } else if (this.phase === 'walk') {
      // quick from the first step, slowing for the last metre
      const left = this._left();
      this._advance(HURRY.speed * Math.min(1, 0.6 + this.t * 2) * Math.min(1, 0.35 + left) * dt);
      this.walk = damp(this.walk, 1, 10, dt);
      this.gait += dt * 2 * Math.PI * HURRY.steps;
      if (this.seg >= this.path.length - 1) { this.phase = 'face'; this.t = 0; }
    } else if (this.phase === 'sit') {
      // turning round to the seat and down onto it
      const k = ease(this.t / SIT);
      this.stand = 1 - k;
      this.walk = damp(this.walk, 0, 4, dt);
      this.x = this.from.x + (this.seat.x - this.from.x) * k;
      this.z = this.from.y + (this.seat.z - this.from.y) * k;
      this.heading = lerpAngle(this.fromHeading, this.seat.facing, ease(this.t / (SIT * 0.7)));
      if (this.t >= SIT) { this.finish(); return; }
    } else {
      // in the line: turning to face it, standing their ground (a start: half a step back)
      this.walk = damp(this.walk, 0, 6, dt);
      this.heading = lerpAngle(this.heading, toTarget, 1 - Math.exp(-4 * dt));
      if (this.flinchT >= 0) {
        const k0 = ease(this.flinchT / 0.3);
        this.flinchT += dt;
        const k = ease(this.flinchT / 0.3) - k0;
        this.x -= Math.sin(toTarget) * 0.3 * k;
        this.z -= Math.cos(toTarget) * 0.3 * k;
        jump = Math.sin(clamp(this.flinchT / 0.3, 0, 1) * Math.PI) * 0.04;
        if (this.flinchT > 1.6) this.flinchT = -1;
      }
    }
    if (this.guitarDrop) {
      const gt = this.h.guitar?.group as THREE.Object3D | undefined;
      if (!gt || !stepGuitarDrop(this.guitarDrop, gt, dt)) this.guitarDrop = null;
    }
    this._pose(dt, jump);
    // no talking, no laughing: breathing hard through the mouth once they stand
    this.h.voiceLevel = this.stand > 0.5 ? 0.12 + 0.08 * Math.sin(this.time * 7) : null;
    this.h.laugh = damp(this.h.laugh, 0, 4, dt);
    this.h.talk = 0;
  }

  /** how far they still have to go (m) */
  private _left(): number {
    let d = -this.along;
    for (let i = this.seg; i < this.path.length - 1; i++) d += this.path[i].distanceTo(this.path[i + 1]);
    return Math.max(0, d);
  }

  // move `step` metres along the path
  private _advance(step: number): void {
    while (step > 0 && this.seg < this.path.length - 1) {
      const len = this.path[this.seg].distanceTo(this.path[this.seg + 1]);
      const left = len - this.along;
      if (step < left) { this.along += step; step = 0; } else { step -= left; this.seg++; this.along = 0; }
    }
    const i = Math.min(this.seg, this.path.length - 2);
    const a = this.path[i], b = this.path[i + 1];
    const k = this.seg >= this.path.length - 1 ? 1 : this.along / Math.max(1e-3, a.distanceTo(b));
    this.x = a.x + (b.x - a.x) * k;
    this.z = a.y + (b.y - a.y) * k;
    this.heading = lerpAngle(this.heading, Math.atan2(b.x - a.x, b.y - a.y), 0.3);
  }

  private _legs(): void {
    const { stand, walk } = this;
    this.h.legs.forEach((L, i) => {
      const ph = this.gait + (i === 0 ? 0 : Math.PI);
      const swing = Math.max(0, Math.cos(ph)) ** 1.5;
      // a long hurried stride, or standing with the knees a little bent, ready
      const target: Euler3[] = [
        [-0.55 * walk * Math.sin(ph) - 0.08 * (1 - walk), 0, 0],
        [(0.1 + 0.85 * swing) * walk + 0.16 * (1 - walk), 0, 0],
        [-0.1 * walk * Math.sin(ph) - 0.06 * (1 - walk), 0, 0],
      ];
      [L.hip, L.knee, L.ankle].forEach((j, k) => {
        const s = this.seatedLegs[i][k], tg = target[k];
        j.rotation.set(s[0] + (tg[0] - s[0]) * stand, s[1] + (tg[1] - s[1]) * stand, s[2] + (tg[2] - s[2]) * stand);
      });
    });
  }

  private _pose(dt: number, jump: number): void {
    const h = this.h, stand = this.stand;
    this._legs();
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // the character's right
    const ground = this.terrain.heightAt(this.x, this.z);
    const bob = 0.035 * this.walk * Math.abs(Math.cos(this.gait)) - 0.02 * this.walk;
    const standY = ground + this.standH - 0.04 * (1 - this.walk) + bob;
    h.root.position.set(this.x, this.seat.y + (standY - this.seat.y) * stand + jump, this.z);
    h.root.rotation.y = this.heading;
    // seated: drawn back from it; standing: upright, chest heaving
    const breath = Math.sin(this.time * 4.2) * 0.015 * stand;
    const lean = this.seat.lean * (1 - stand) - 0.1 * this.tense * (1 - stand) + stand * (0.04 + 0.1 * this.walk) + breath;
    h.spine.rotation.set(lean, 0, Math.sin(this.gait) * 0.04 * this.walk, 'YXZ');
    // eyes on it all the time (over the shoulder while walking)
    h.root.updateMatrixWorld(true);
    const head = h.headPivot.getWorldPosition(new THREE.Vector3());
    const to = this.target.clone().sub(head);
    const fd = to.dot(fwd), rd = to.dot(right);
    this.headYaw = damp(this.headYaw, clamp(Math.atan2(-rd, fd), -1.4, 1.4), this.phase === 'turn' ? 12 : 7, dt);
    this.headPitch = damp(this.headPitch, clamp(Math.atan2(to.y, Math.hypot(fd, rd)), -0.5, 0.5), 7, dt);
    h.neck.rotation.set(-this.headPitch * 0.35, this.headYaw * 0.4, 0, 'YXZ');
    h.headPivot.rotation.set(-this.headPitch * 0.65, this.headYaw * 0.6, 0, 'YXZ');
    h.root.updateMatrixWorld(true);
    // hands: off the guitar / out of the lap with the start, swinging as they walk, half up in front in the line
    const ready = this.phase === 'face' ? ease(this.t / 0.8) : 0;
    // the start: the hands up toward the face, then down again
    const shock = this.flinchT >= 0 ? Math.min(1, this.flinchT / 0.15) * (1 - ease((this.flinchT - 0.6) / 1.0)) : 0;
    for (let i = 0; i < 2; i++) {
      const A = h.arms[i];
      const out = right.clone().multiplyScalar(i === 0 ? 1 : -1);
      const sh = A.shoulder.getWorldPosition(new THREE.Vector3());
      const reach = (A.upperLen + A.foreLen) * h.root.scale.x;
      const rest = sh.clone().addScaledVector(UP, -reach * 0.6).addScaledVector(fwd, 0.25).addScaledVector(out, -0.05);
      const startled = sh.clone().addScaledVector(UP, -reach * 0.45).addScaledVector(fwd, 0.3).addScaledVector(out, 0.05);
      const swing = sh.clone().addScaledVector(UP, -reach * 0.85).addScaledVector(fwd, 0.26 * Math.sin(this.gait + (i === 0 ? Math.PI : 0)) * this.walk + 0.08).addScaledVector(out, 0.1);
      const guard = sh.clone().addScaledVector(UP, -reach * 0.62).addScaledVector(fwd, 0.26).addScaledVector(out, 0.12);
      const sat = rest.lerp(startled, this.tense * (1 - stand));
      const shield = sh.clone().addScaledVector(UP, -reach * 0.15).addScaledVector(fwd, 0.32).addScaledVector(out, -0.02);
      const tg = sat.lerp(swing, stand).lerp(guard, ready).lerp(shield, shock);
      if (!this.handsSet) this.hand[i].copy(tg);
      this.hand[i].lerp(tg, 1 - Math.exp(-16 * dt));
      const pole = out.clone().multiplyScalar(0.7).addScaledVector(fwd, -0.4).addScaledVector(UP, -0.5).normalize();
      const thumb = UP.clone().addScaledVector(fwd, 0.5 * ready).normalize();
      const fingers = UP.clone().negate().lerp(fwd, 0.4 + 0.5 * ready).normalize();
      h.reach(i, this.hand[i], pole, thumb, fingers);
      if (!A.glass) h.setHandOpen(i, ready > 0.5);
    }
    this.handsSet = true;
  }

  // exactly back as they were on the seat
  private _restore(): void {
    const h = this.h;
    h.root.position.set(this.seat.x, this.seat.y, this.seat.z);
    h.root.rotation.y = this.seat.facing;
    this.stand = 0; this.walk = 0; this.tense = 0;
    this.x = this.seat.x; this.z = this.seat.z; this.heading = this.seat.facing;
    this._legs();
    h.spine.rotation.set(this.seat.lean, 0, 0);
    h.neck.rotation.set(0, 0, 0);
    h.headPivot.rotation.set(0, 0, 0);
    h.voiceLevel = null;
    h.setHandOpen(1, false);
    if (!h.arms[0].glass) h.setHandOpen(0, false);
    this.guitarDrop = null;
    const g = this.guitarLocal, gt = h.guitar?.group as THREE.Object3D | undefined;
    if (g && gt) { g.parent.add(gt); gt.position.copy(g.pos); gt.quaternion.copy(g.quat); }
  }
}
