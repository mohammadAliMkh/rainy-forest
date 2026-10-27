import * as THREE from 'three';
import type { Human } from './Human.js';
import { damp, clamp } from '../../utils/noise.js';

// Someone at the fire getting the fright of their life: they jump in their
// seat, scream with their hands up, leap to their feet and run off into the
// trees (hopping over whatever is in the way), stop at a safe distance bent
// over and panting, watching; later they walk back laughing and sit down
// again. Drives the same rig the gathering uses (legs, spine, head, arms by
// IK), so the Blender-built body follows. While a Flight runs, the gathering
// leaves that person alone.

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export interface FlightRoute {
  /** where they run to, after stepping out in front of their seat (x, z) */
  path: [number, number][];
  /** segments they jump over something (0 = from in front of the seat to the first point) */
  hops?: number[];
}

/** where and how they sit (from the gathering's seat) */
export interface SeatPose { x: number; y: number; z: number; facing: number; lean: number }

/** the rig, with the mouth's voice level (null = its own talking rhythm) */
type Rig = Human & { voiceLevel: number | null };
type Phase = 'wait' | 'startle' | 'up' | 'run' | 'hide' | 'back' | 'down' | 'done';
type Euler3 = [number, number, number];

const RUN_SPEED = 4.1, WALK_SPEED = 1.35;
const HOP_H = 0.42;

const easeInOut = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class Flight {
  phase: Phase = 'wait';
  private readonly h: Rig;
  private readonly seat: SeatPose;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly path: THREE.Vector2[];
  private readonly hops: Set<number>;
  private readonly onScream: () => void;
  private readonly seatedLegs: Euler3[][];
  /** pelvis above the ground when standing straight */
  private readonly standH: number;
  private readonly guitarLocal: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion } | null;
  /** the guitar being put down against the stump */
  private guitarDrop: { from: THREE.Vector3; fromQ: THREE.Quaternion; to: THREE.Vector3; toQ: THREE.Quaternion; t: number } | null = null;
  private t = 0; // seconds in this phase
  private wait: number;
  private time = 0;
  // where they are
  private x: number; private z: number; private heading: number;
  private stand = 0; // 0 seated .. 1 on their feet
  private run = 0; private walk = 0; private crouch = 0;
  private gait = 0; // stride phase
  private seg = 0; private along = 0; // position on the path
  private hopK = 0; // 0..1 through a hop, or -1
  private headYaw = 0; private headPitch = 0;
  private readonly hand: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];
  private handsSet = false;

  constructor(h: Human, seat: SeatPose, route: FlightRoute, terrain: { heightAt(x: number, z: number): number }, opts: { delay: number; onScream: () => void }) {
    this.h = h as Rig;
    this.seat = seat;
    this.terrain = terrain;
    this.onScream = opts.onScream;
    this.wait = opts.delay;
    const fwd = new THREE.Vector2(Math.sin(seat.facing), Math.cos(seat.facing));
    const front = new THREE.Vector2(seat.x, seat.z).addScaledVector(fwd, 0.35);
    this.path = [front, ...route.path.map(([x, z]) => new THREE.Vector2(x, z))];
    this.hops = new Set(route.hops ?? []);
    this.x = seat.x; this.z = seat.z; this.heading = seat.facing;
    this.seatedLegs = h.legs.map((L) => [L.hip, L.knee, L.ankle].map((j) => [j.rotation.x, j.rotation.y, j.rotation.z] as Euler3));
    // how high the pelvis sits when standing: straighten the legs for a moment and measure
    for (const L of h.legs) for (const j of [L.hip, L.knee, L.ankle]) j.rotation.set(0, 0, 0);
    const spineX = h.spine.rotation.x;
    h.spine.rotation.x = 0;
    h.root.updateMatrixWorld(true);
    const ankle = h.legs[0].ankle.getWorldPosition(_v).y;
    this.standH = h.root.position.y - ankle + 0.085 * h.root.scale.x;
    h.spine.rotation.x = spineX;
    this._setLegs(0, 0, 0, 0);
    // a guitar stays on the stump while its player runs (put back afterwards)
    const gt = h.guitar?.group as THREE.Object3D | undefined;
    this.guitarLocal = gt ? { parent: gt.parent!, pos: gt.position.clone(), quat: gt.quaternion.clone() } : null;
  }

  get done(): boolean { return this.phase === 'done'; }
  /** standing (or running) somewhere away from the seat */
  get away(): boolean { return this.phase === 'run' || this.phase === 'hide' || this.phase === 'back'; }
  /** at their hiding place */
  get hiding(): boolean { return this.phase === 'hide'; }

  /** the coast is clear: walk back and sit down */
  comeBack(): void {
    if (this.phase === 'run' || this.phase === 'hide') { this.phase = 'back'; this.t = 0; this.path.reverse(); this._reverseHops(); this.seg = 0; this.along = 0; this._snapToPath(); }
  }

  /** back on their seat at once (when the scene is skipped) */
  finish(): void {
    this.phase = 'done';
    this.stand = 0;
    this._restore();
  }

  private _reverseHops(): void {
    const n = this.path.length - 1;
    const hops = [...this.hops].map((s) => n - 1 - s);
    this.hops.clear();
    for (const s of hops) this.hops.add(s);
  }

  // continue the walk back from wherever they are now (they may still have been running)
  private _snapToPath(): void {
    const here = new THREE.Vector2(this.x, this.z);
    if (here.distanceTo(this.path[0]) > 0.05) { this.path.unshift(here); const hops = [...this.hops]; this.hops.clear(); for (const s of hops) this.hops.add(s + 1); }
  }

  /** `look`: the scare (where they look while startled and hiding) */
  update(dt: number, look: THREE.Vector3): void {
    const h = this.h;
    this.time += dt;
    this.t += dt;
    const fwd = _w.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    let scream = false, panic = 0, laugh = 0, jump = 0;
    let lookAt: THREE.Vector3 | null = look;
    switch (this.phase) {
      case 'wait':
        if (this.t >= this.wait) { this.phase = 'startle'; this.t = 0; }
        lookAt = this.t > this.wait - 0.25 ? look : null;
        break;
      case 'startle': {
        // a jump in the seat, hands flying up
        jump = Math.sin(clamp(this.t / 0.32, 0, 1) * Math.PI) * 0.09;
        panic = easeInOut(this.t / 0.25);
        scream = this.t > 0.12;
        if (this.t > 0.12 && this.t - dt <= 0.12) this.onScream();
        if (this.t >= 0.45) {
          this.phase = 'up'; this.t = 0;
          const gt = this.h.guitar?.group as THREE.Object3D | undefined;
          if (gt) this._putGuitarDown(gt);
        }
        break;
      }
      case 'up': {
        // on their feet, turning toward where they will run
        const k = easeInOut(this.t / 0.5);
        this.stand = k;
        this.x = this.seat.x + (this.path[0].x - this.seat.x) * k;
        this.z = this.seat.z + (this.path[0].y - this.seat.z) * k;
        const d = this.path[1].clone().sub(this.path[0]);
        this.heading = lerpAngle(this.seat.facing, Math.atan2(d.x, d.y), k);
        panic = 1; scream = true;
        this.run = k * 0.4;
        if (this.t >= 0.5) { this.phase = 'run'; this.t = 0; this.seg = 0; this.along = 0; }
        break;
      }
      case 'run':
      case 'back': {
        const running = this.phase === 'run';
        const speed = running ? RUN_SPEED * Math.min(1, 0.4 + this.t * 2) : WALK_SPEED;
        this._advance(speed * dt);
        this.run = damp(this.run, running ? 1 : 0, 6, dt);
        this.walk = damp(this.walk, running ? 0 : 1, 6, dt);
        this.crouch = damp(this.crouch, 0, 6, dt);
        this.gait += dt * (running ? 2 * Math.PI * 1.55 : 2 * Math.PI * 0.95);
        panic = running ? 1 : 0;
        scream = running && this.t < 1.6;
        laugh = running ? 0 : 1;
        // running: eyes ahead, a terrified glance back now and then
        lookAt = running ? ((this.t % 1.7) > 1.25 ? look : null) : null;
        if (this.seg >= this.path.length - 1) {
          if (running) { this.phase = 'hide'; this.t = 0; }
          else { this.phase = 'down'; this.t = 0; }
        }
        break;
      }
      case 'hide': {
        // stop, turn to watch, bent over with hands on the knees, panting
        this.run = damp(this.run, 0, 5, dt);
        this.walk = damp(this.walk, 0, 5, dt);
        this.crouch = damp(this.crouch, 1, 3, dt);
        const to = Math.atan2(look.x - this.x, look.z - this.z);
        this.heading = lerpAngle(this.heading, to, 1 - Math.exp(-3 * dt));
        break;
      }
      case 'down': {
        // turn back to the fire and sit
        const k = easeInOut(this.t / 0.9);
        this.heading = lerpAngle(this.heading, this.seat.facing, Math.min(1, dt * 6));
        this.stand = 1 - k;
        this.x = this.path[this.path.length - 1].x + (this.seat.x - this.path[this.path.length - 1].x) * k;
        this.z = this.path[this.path.length - 1].y + (this.seat.z - this.path[this.path.length - 1].y) * k;
        this.walk = damp(this.walk, 0, 8, dt);
        laugh = 1 - k * 0.6;
        if (this.t >= 0.9) { this.phase = 'done'; this._restore(); return; }
        break;
      }
      case 'done':
        return;
    }
    this._pose(dt, fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading)), lookAt, panic, jump);
    this._guitarFall(dt);
    h.voiceLevel = scream ? 0.75 + 0.25 * Math.abs(Math.sin(this.time * 23)) : (this.phase === 'hide' ? 0.25 + 0.15 * Math.sin(this.time * 9) : null);
    h.laugh = damp(h.laugh, laugh, 3, dt);
    h.talk = 0;
  }

  // dropped in a hurry: stood up against the front of the stump, neck leaning back
  private _putGuitarDown(gt: THREE.Object3D): void {
    this.h.root.parent!.attach(gt);
    const s = this.seat;
    const fwd = new THREE.Vector3(Math.sin(s.facing), 0, Math.cos(s.facing));
    const a = 0.3;
    const X = UP.clone().multiplyScalar(Math.cos(a)).addScaledVector(fwd, -Math.sin(a)); // toward the headstock
    const Z = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(UP, Math.sin(a)); // out of the top
    const Y = new THREE.Vector3().crossVectors(Z, X);
    const toQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const bx = s.x + fwd.x * 0.5, bz = s.z + fwd.z * 0.5;
    const to = new THREE.Vector3(bx, this.terrain.heightAt(bx, bz) + 0.01, bz).addScaledVector(X, 0.32);
    // into the parent's frame (the gathering's group)
    const parent = gt.parent!;
    parent.updateWorldMatrix(true, false);
    const inv = parent.matrixWorld.clone().invert();
    const pq = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.guitarDrop = { from: gt.position.clone(), fromQ: gt.quaternion.clone(), to: to.applyMatrix4(inv), toQ: pq.multiply(toQ), t: 0 };
  }

  private _guitarFall(dt: number): void {
    const d = this.guitarDrop, gt = this.h.guitar?.group as THREE.Object3D | undefined;
    if (!d || !gt) return;
    d.t = Math.min(1, d.t + dt / 0.35);
    const k = d.t * d.t;
    gt.position.lerpVectors(d.from, d.to, k);
    gt.quaternion.slerpQuaternions(d.fromQ, d.toQ, k);
    if (d.t >= 1) this.guitarDrop = null;
  }

  // move `step` metres along the path
  private _advance(step: number): void {
    while (step > 0 && this.seg < this.path.length - 1) {
      const a = this.path[this.seg], b = this.path[this.seg + 1];
      const len = a.distanceTo(b);
      const left = len - this.along;
      if (step < left) { this.along += step; step = 0; } else { step -= left; this.seg++; this.along = 0; }
    }
    const i = Math.min(this.seg, this.path.length - 2);
    const a = this.path[i], b = this.path[i + 1];
    const len = Math.max(1e-3, a.distanceTo(b));
    const k = this.seg >= this.path.length - 1 ? 1 : this.along / len;
    this.x = a.x + (b.x - a.x) * k;
    this.z = a.y + (b.y - a.y) * k;
    this.heading = lerpAngle(this.heading, Math.atan2(b.x - a.x, b.y - a.y), 0.25);
    this.hopK = this.hops.has(i) && this.seg < this.path.length - 1 ? k : -1;
  }

  private _setLegs(stand: number, stride: number, crouch: number, tuck: number): void {
    const h = this.h;
    h.legs.forEach((L, i) => {
      const ph = this.gait + (i === 0 ? 0 : Math.PI);
      const A = 0.78 * this.run + 0.36 * this.walk;
      const swing = Math.max(0, Math.cos(ph)) ** 1.5;
      const hip = -A * Math.sin(ph) * stride - crouch * 0.45 - tuck * 1.0;
      const knee = (0.22 * this.run + 0.05 * this.walk + (1.25 * this.run + 0.55 * this.walk) * swing) * stride + crouch * 0.85 + tuck * 1.5;
      const ankle = -0.18 * this.run * Math.sin(ph) * stride + crouch * -0.25 + tuck * 0.2;
      const target: Euler3[] = [[hip, 0, 0], [knee, 0, 0], [ankle, 0, 0]];
      [L.hip, L.knee, L.ankle].forEach((j, k) => {
        const s = this.seatedLegs[i][k], tg = target[k];
        j.rotation.set(s[0] + (tg[0] - s[0]) * stand, s[1] + (tg[1] - s[1]) * stand, s[2] + (tg[2] - s[2]) * stand);
      });
    });
  }

  private _pose(dt: number, fwd: THREE.Vector3, lookAt: THREE.Vector3 | null, panic: number, jump: number): void {
    const h = this.h;
    const right = _v.set(-fwd.z, 0, fwd.x).clone(); // the character's right
    const stand = this.stand;
    const tuck = this.hopK >= 0 ? Math.sin(this.hopK * Math.PI) : 0;
    this._setLegs(stand, 1 - tuck, this.crouch, tuck);
    // where the pelvis is: on the seat, or above the ground with a running bob / a hop
    const ground = this.terrain.heightAt(this.x, this.z);
    const bob = (0.05 * this.run + 0.02 * this.walk) * Math.abs(Math.cos(this.gait)) - 0.03 * this.run;
    const hop = this.hopK >= 0 ? Math.sin(this.hopK * Math.PI) * HOP_H : 0;
    const standY = ground + this.standH - this.crouch * 0.16 + bob + hop - tuck * 0.12;
    h.root.position.set(this.x, this.seat.y + (standY - this.seat.y) * stand + jump, this.z);
    h.root.rotation.y = this.heading;
    // spine: leaning into the run, bent over while panting, upright walking back
    const pant = Math.sin(this.time * 7.5) * 0.03 * this.crouch;
    const lean = this.seat.lean * (1 - stand) + stand * (0.24 * this.run + 0.05 * this.walk + 0.5 * this.crouch) + pant - panic * 0.12 * (1 - this.run);
    h.spine.rotation.set(lean, 0, Math.sin(this.gait) * 0.05 * (this.run + this.walk), 'YXZ');
    // head: at the scare, ahead while running
    let yaw = 0, pitch = 0;
    h.root.updateMatrixWorld(true);
    const head = h.headPivot.getWorldPosition(new THREE.Vector3());
    if (lookAt) {
      const to = lookAt.clone().sub(head);
      const fd = to.dot(fwd), rd = to.dot(right);
      yaw = clamp(Math.atan2(-rd, fd), -1.4, 1.4);
      pitch = clamp(Math.atan2(to.y, Math.hypot(fd, rd)), -0.6, 0.5);
    } else if (stand > 0.5) pitch = -0.1 - 0.2 * this.crouch + 0.25 * this.run;
    this.headYaw = damp(this.headYaw, yaw, 9, dt);
    this.headPitch = damp(this.headPitch, pitch, 9, dt);
    h.neck.rotation.set(-this.headPitch * 0.35, this.headYaw * 0.4, 0, 'YXZ');
    h.headPivot.rotation.set(-this.headPitch * 0.65, this.headYaw * 0.6, 0, 'YXZ');
    h.root.updateMatrixWorld(true);
    // arms: flailing above the head in a panic, on the knees while panting, swinging walking back
    for (let i = 0; i < 2; i++) {
      const A = h.arms[i];
      const out = right.clone().multiplyScalar(i === 0 ? 1 : -1);
      const sh = A.shoulder.getWorldPosition(new THREE.Vector3());
      const reachLen = (A.upperLen + A.foreLen) * h.root.scale.x;
      const ph = this.gait + (i === 0 ? Math.PI : 0);
      const wave = Math.sin(this.time * 13 + i * 2.1);
      const panicT = sh.clone().addScaledVector(UP, reachLen * 0.82).addScaledVector(out, 0.2 + wave * 0.07).addScaledVector(fwd, 0.08 + Math.cos(this.time * 11 + i) * 0.06);
      const kneeW = h.legs[i].knee.getWorldPosition(new THREE.Vector3());
      const kneeT = kneeW.addScaledVector(UP, 0.07).addScaledVector(fwd, 0.04).addScaledVector(out, 0.02);
      const swingT = sh.clone().addScaledVector(UP, -reachLen * 0.9).addScaledVector(fwd, 0.16 * Math.sin(ph) * this.walk + 0.05).addScaledVector(out, 0.08);
      const restT = sh.clone().addScaledVector(UP, -reachLen * 0.6).addScaledVector(fwd, 0.25).addScaledVector(out, -0.05);
      // blend: panic > hands on knees > walking swing > (seated) resting
      let target: THREE.Vector3;
      if (panic > 0.01) target = (stand > 0.5 || this.phase === 'startle' ? restT.clone().lerp(panicT, panic) : panicT);
      else if (this.crouch > 0.3) target = kneeT;
      else if (this.walk > 0.3 || stand > 0.5) target = swingT;
      else target = restT;
      if (!this.handsSet) this.hand[i].copy(target);
      this.hand[i].lerp(target, 1 - Math.exp(-14 * dt));
      const up = panic > 0.5;
      const pole = out.clone().multiplyScalar(0.7).addScaledVector(fwd, up ? 0.2 : -0.5).addScaledVector(UP, up ? 0.1 : -0.4).normalize();
      const thumb = up ? out.clone().negate().addScaledVector(fwd, 0.3).normalize() : fwd.clone();
      const fingers = up ? UP.clone().addScaledVector(out, 0.15).normalize() : UP.clone().negate().addScaledVector(fwd, this.crouch * 0.6).normalize();
      h.reach(i, this.hand[i], pole, thumb, fingers);
      if (!A.glass) h.setHandOpen(i, up);
    }
    this.handsSet = true;
  }

  // exactly back as they were before the fright
  private _restore(): void {
    const h = this.h;
    h.root.position.set(this.seat.x, this.seat.y, this.seat.z);
    h.root.rotation.y = this.seat.facing;
    this.x = this.seat.x; this.z = this.seat.z; this.heading = this.seat.facing;
    this.stand = 0; this.run = 0; this.walk = 0; this.crouch = 0; this.hopK = -1;
    this._setLegs(0, 0, 0, 0);
    h.spine.rotation.set(this.seat.lean, 0, 0);
    h.voiceLevel = null;
    h.setHandOpen(1, false);
    if (!h.arms[0].glass) h.setHandOpen(0, false);
    this.guitarDrop = null;
    const g = this.guitarLocal, gt = h.guitar?.group as THREE.Object3D | undefined;
    if (g && gt) { g.parent.add(gt); gt.position.copy(g.pos); gt.quaternion.copy(g.quat); }
  }
}
