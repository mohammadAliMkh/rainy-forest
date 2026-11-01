import * as THREE from 'three';
import type { Human } from './Human.js';
import { damp, clamp } from '../../utils/noise.js';
import type { LineUp } from './LineUp.ts';

// Someone from the line with a ghost after them: they spin round and run for
// it into the woods, screaming, glancing back over their shoulder, until they
// are caught where their way ends:
//   'cower' - backed up against something (a wall, the car), sliding down it
//             into a crouch, arms up over their face, shaking;
//   'fall'  - slipping in the water and going down on their backside, facing
//             it, one hand behind them in the puddle, the other up against it,
//             shoving themselves back;
//   'climb' - up the trunk of a tree, hugging it, looking down at it.
// They stay so until saved: `free()` gets them up (or down the trunk) and running
// back the way they came, and at the end of it onto their seat through the
// line's own act (`finish()`: at once). Drives the same rig as the gathering; while
// it runs the gathering leaves that person alone.

const UP = new THREE.Vector3(0, 1, 0);
type Rig = Human & { voiceLevel: number | null };
type Phase = 'stare' | 'run' | 'caught' | 'home' | 'done';
export type CaughtHow = 'cower' | 'fall' | 'climb';

/** a tree's trunk: its centre and radius at the ground, how much thinner it gets for each metre up, and how far it leans over for each metre up (x, z) */
export interface Trunk { x: number; z: number; r: number; taper: number; lean: [number, number] }

export interface ChaseRoute {
  /** the way from their place in the line (x, z); the last point is where they are caught */
  path: [number, number][];
  how: CaughtHow;
  /** 'climb': the trunk */
  tree?: Trunk;
}

/** running: m/s, strides a second */
const RUN = { speed: 4.1, steps: 1.55 };
/** how long it takes them to go down / up (s) */
const CATCH: Record<CaughtHow, number> = { cower: 0.9, fall: 0.55, climb: 2.2 };
/** saved: how long it takes them to get up / down again (s) */
const RISE: Record<CaughtHow, number> = { cower: 0.7, fall: 0.8, climb: 1.5 };
/**
 * up the tree: how much higher the pelvis gets (m), a whole number of `step`s; how far out from the bark it is (m);
 * how far they get with each reach of either hand (m); how far above the shoulder a hand takes hold (m); how far
 * round the trunk the hands are (radians from straight in front of them); how far off the bark the wrist is (m), and
 * more as the hand moves up; half the hand's length (m); the knees going out to either side of it (radians)
 */
const CLIMB = { up: 1.2, off: 0.17, step: 0.3, top: 0.28, wrap: 1.0, wrist: 0.05, lift: 0.07, hand: 0.09, splay: 0.55 };
/** in the water: how far they shove themselves back (m) and in how long (s) */
const SHOVE = { by: 0.35, time: 2.2 };

const ease = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class Chase {
  phase: Phase = 'stare';
  /** what they run from: its head (world; the scene keeps it up to date) */
  chaser: THREE.Vector3;
  /** metres along their way */
  s = 0;
  /** the length of their way (m) */
  total: number;
  readonly how: CaughtHow;
  private readonly h: Rig;
  private readonly line: LineUp;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly path: THREE.Vector2[];
  private readonly tree: Trunk | null;
  /** they get this far along their way and wait there (off camera) until `release()` */
  private hold = Infinity;
  /** how long they stand staring at it before they bolt (s) */
  private readonly wait: number;
  private t = 0; private time = 0;
  private x: number; private z: number; private heading: number;
  private gait = 0; private run = 0;
  private headYaw = 0; private headPitch = 0;
  private readonly hand: THREE.Vector3[];
  private handsSet = true;
  private homeward = false; // saved, and on their way
  private readonly fell = new THREE.Vector2(); // where they went down in the water
  private readonly _p = new THREE.Vector2();

  /** `line`: their act standing in the line (it puts them back on the seat); `wait`: how long they stand staring before they bolt (s) */
  constructor(h: Human, line: LineUp, route: ChaseRoute, terrain: { heightAt(x: number, z: number): number }, chaser: THREE.Vector3, wait = 0) {
    this.h = h as Rig;
    this.line = line;
    this.terrain = terrain;
    this.chaser = chaser;
    this.how = route.how;
    this.tree = route.tree ?? null;
    const w = line.where;
    this.x = w.x; this.z = w.z; this.heading = w.heading;
    this.path = [new THREE.Vector2(w.x, w.z), ...route.path.map(([x, z]) => new THREE.Vector2(x, z))];
    let d = 0;
    for (let i = 1; i < this.path.length; i++) d += this.path[i].distanceTo(this.path[i - 1]);
    this.total = d;
    this.wait = wait;
    this.hand = line.hands.map((v) => v.clone());
  }

  get done(): boolean { return this.phase === 'done'; }
  /** caught (and holding still there) */
  get caught(): boolean { return this.phase === 'caught'; }
  /** their way, from their place in the line */
  get points(): readonly THREE.Vector2[] { return this.path; }
  /** where they are (x, z) */
  get pos(): THREE.Vector2 { return this._p.set(this.x, this.z); }

  /** from now on they run no further than `m` metres along (and wait there, off camera) */
  holdAt(m: number): void { this.hold = Math.min(this.total, Math.max(this.s, m)); }

  /** off they go again (the cut to their shot), from at least `m` metres along: anywhere short of that they were out of sight */
  release(m = 0): void {
    this.hold = Infinity;
    if (this.phase !== 'caught' && m > this.s) { this.s = Math.min(m, this.total); this._at(this.s); }
  }

  /** out of sight (off camera, waiting for their shot) */
  set hidden(v: boolean) { this.h.root.visible = !v; }

  /** at once caught, as they will stay (when the film is skipped) */
  caughtNow(): void {
    this.hold = this.s = this.total;
    this._at(this.s);
    this.phase = 'caught'; this.t = 10; this.run = 0;
    if (this.how === 'fall') this.fell.set(this.x, this.z);
    this.handsSet = false;
    this.hidden = false;
  }

  /** saved: up they get and off back the way they came */
  free(): void { if (this.phase === 'caught') { this.phase = 'home'; this.t = 0; this.run = 0; } }

  /** back on the seat at once (the story is over, or cut short) */
  finish(): void { this.phase = 'done'; this.hidden = false; this.line.finish(); }

  update(dt: number): void {
    if (this.phase === 'done') return;
    this.t += dt; this.time += dt;
    if (this.phase === 'stare') {
      // frozen for a moment, staring at it
      this.run = 0;
      this.heading = lerpAngle(this.heading, Math.atan2(this.chaser.x - this.x, this.chaser.z - this.z), 1 - Math.exp(-4 * dt));
      if (this.t >= this.wait) { this.phase = 'run'; this.t = 0; }
    } else if (this.phase === 'run') {
      // off at once, faster with every stride
      this.s = Math.min(this.hold, this.s + RUN.speed * Math.min(1, 0.35 + this.t * 1.8) * dt);
      this._at(this.s);
      this.run = damp(this.run, 1, 8, dt);
      this.gait += dt * 2 * Math.PI * RUN.steps;
      if (this.s >= this.total) {
        this.phase = 'caught'; this.t = 0;
        this.fell.set(this.x, this.z);
      }
    } else if (this.phase === 'home') {
      if (this.t < RISE[this.how]) {
        if (this.how === 'climb') this._toTrunk(1, dt);
      } else {
        if (!this.homeward) {
          // from where they are now, along their way
          this.homeward = true;
          this.path[this.path.length - 1].set(this.x, this.z);
          this.total = 0;
          for (let i = 1; i < this.path.length; i++) this.total += this.path[i].distanceTo(this.path[i - 1]);
          this.s = this.total;
        }
        this.s = Math.max(0, this.s - RUN.speed * Math.min(1, 0.35 + (this.t - RISE[this.how]) * 1.8) * dt);
        this._at(this.s, true);
        this.run = damp(this.run, 1, 8, dt);
        this.gait += dt * 2 * Math.PI * RUN.steps;
        if (this.s <= 0) { this.finish(); return; }
      }
    } else {
      this.run = damp(this.run, 0, 10, dt);
      const toIt = Math.atan2(this.chaser.x - this.x, this.chaser.z - this.z);
      if (this.how === 'climb' && this.tree) {
        this._toTrunk(ease(this.t / 0.35), dt);
      } else {
        // round to face it (going down in the water: spinning round as they fall)
        this.heading = lerpAngle(this.heading, toIt, 1 - Math.exp(-(this.how === 'fall' ? 12 : 6) * dt));
        if (this.how === 'fall') {
          // shoving themselves back through the water, in jerks
          const k = ease((this.t - CATCH.fall) / SHOVE.time);
          const jerk = k + 0.03 * Math.sin(this.t * 9) * (k > 0 && k < 1 ? 1 : 0);
          this.x = this.fell.x - Math.sin(toIt) * SHOVE.by * jerk;
          this.z = this.fell.y - Math.cos(toIt) * SHOVE.by * jerk;
        }
      }
    }
    this._pose(dt);
    // screaming as they run and again as they are caught; then sobbing breaths, shaking
    const scream = this.phase === 'stare' ? false : (this.phase === 'run' && this.t < 1.8) || (this.phase === 'caught' && this.t < 1.3);
    this.h.voiceLevel = scream ? 0.75 + 0.25 * Math.abs(Math.sin(this.time * 23)) : 0.25 + 0.15 * Math.sin(this.time * 9);
    this.h.laugh = damp(this.h.laugh, 0, 4, dt);
    this.h.talk = 0;
  }

  // round to face the trunk, in to it by `k`, as high as they are up it
  private _toTrunk(k: number, dt: number): void {
    const tr = this.tree!;
    const at = this._trunk(this.terrain.heightAt(tr.x, tr.z) + this.line.standH * 0.85 + CLIMB.up * this._climbed);
    this.heading = lerpAngle(this.heading, Math.atan2(at.x - this.x, at.z - this.z), 1 - Math.exp(-14 * dt));
    const end = this.path[this.path.length - 1];
    const a = Math.atan2(end.x - tr.x, end.y - tr.z), r = at.r + CLIMB.off;
    this.x = end.x + (at.x + Math.sin(a) * r - end.x) * k;
    this.z = end.y + (at.z + Math.cos(a) * r - end.y) * k;
  }

  // where `s` metres along the way is (and they face along it, or back along it)
  private _at(s: number, back = false): void {
    let i = 0, left = s;
    while (i < this.path.length - 2 && left > this.path[i].distanceTo(this.path[i + 1])) { left -= this.path[i].distanceTo(this.path[i + 1]); i++; }
    const a = this.path[i], b = this.path[i + 1];
    const k = Math.min(1, left / Math.max(1e-3, a.distanceTo(b)));
    const nx = a.x + (b.x - a.x) * k, nz = a.y + (b.y - a.y) * k;
    if (Math.hypot(nx - this.x, nz - this.z) > 1e-4) this.heading = lerpAngle(this.heading, back ? Math.atan2(a.x - b.x, a.y - b.y) : Math.atan2(b.x - a.x, b.y - a.y), 0.18);
    this.x = nx; this.z = nz;
  }

  // how far up the tree they are (0..1)
  private get _climbed(): number { return this.phase === 'home' ? 1 - ease(this.t / RISE.climb) : ease((this.t - 0.25) / (CATCH.climb - 0.25)); }

  // where the trunk is and how thick at height `y` (world): it thins out and leans over on the way up
  private _trunk(y: number): { x: number; z: number; r: number } {
    const tr = this.tree!, up = y - this.terrain.heightAt(tr.x, tr.z);
    return { x: tr.x + tr.lean[0] * up, z: tr.z + tr.lean[1] * up, r: Math.max(0.08, tr.r - tr.taper * up) };
  }

  private _legs(fn: (i: number) => [number, number, number, number]): void {
    this.h.legs.forEach((L, i) => {
      const [hip, knee, ankle, splay] = fn(i);
      L.hip.rotation.set(hip, 0, L.side * splay);
      L.knee.rotation.set(knee, 0, 0);
      L.ankle.rotation.set(ankle, 0, 0);
    });
  }

  private _pose(dt: number): void {
    const h = this.h, how = this.how, run = this.run;
    const k = this.phase === 'caught' ? ease(this.t / CATCH[how]) : this.phase === 'home' ? 1 - ease(this.t / RISE[how]) : 0;
    const shake = this.phase === 'caught' ? Math.sin(this.time * 31) * 0.6 + Math.sin(this.time * 47 + 1) * 0.4 : 0;
    // legs: running strides, then how they end up
    const climbed = how === 'climb' && k > 0 ? this._climbed : 0, rose = CLIMB.up * climbed;
    const caughtLegs = (i: number): [number, number, number, number] => {
      if (how === 'cower') return [-1.2, 2.0, -0.8, 0];
      if (how === 'fall') return i === 0 ? [-1.25, 0.95, -0.35, 0] : [-1.5, 0.45, -0.2, 0];
      // climbing: knees out round the trunk, one up after the other in time with the hands, then gripping
      const ph = (rose / (2 * CLIMB.step)) * 2 * Math.PI + (i === 0 ? 0 : Math.PI);
      const climbing = 1 - ease((climbed - 0.85) / 0.15);
      return [-1.0 + 0.3 * Math.sin(ph) * climbing, 1.25 + 0.3 * Math.sin(ph) * climbing, -0.4, CLIMB.splay];
    };
    this._legs((i) => {
      const ph = this.gait + (i === 0 ? 0 : Math.PI);
      const swing = Math.max(0, Math.cos(ph)) ** 1.5;
      const stride: [number, number, number, number] = [-0.78 * Math.sin(ph) * run - 0.08 * (1 - run), (0.22 + 1.25 * swing) * run + 0.16 * (1 - run), -0.18 * Math.sin(ph) * run - 0.06 * (1 - run), 0];
      if (k <= 0) return stride;
      const c = caughtLegs(i);
      return [stride[0] + (c[0] - stride[0]) * k, stride[1] + (c[1] - stride[1]) * k, stride[2] + (c[2] - stride[2]) * k, c[3] * k];
    });
    // the pelvis: above the ground with a running bob; down into a crouch, onto the ground, or up the trunk
    const ground = this.terrain.heightAt(this.x, this.z);
    const S = this.line.standH;
    const bob = (0.05 * Math.abs(Math.cos(this.gait)) - 0.03) * run;
    let y = ground + S - 0.04 * (1 - run) + bob;
    // (up the tree in heaves, then hanging there)
    const heave = -0.05 * CLIMB.up * Math.sin(climbed * Math.PI * 5) * (1 - climbed);
    if (k > 0) {
      if (how === 'cower') y -= S * 0.4 * k;
      else if (how === 'fall') y -= (S * 0.83) * (k * k);
      else y += -S * 0.15 * k + rose + heave;
    }
    h.root.position.set(this.x, y, this.z);
    h.root.rotation.y = this.heading;
    // the spine: leaning into the run; hunched; thrown back on their hands; against the trunk
    const breath = Math.sin(this.time * 6) * 0.02;
    const caughtLean = how === 'cower' ? 0.28 : how === 'fall' ? -0.55 : 0.08;
    const lean = (0.24 * run + 0.02 * (1 - run)) * (1 - k) + caughtLean * k + breath + shake * 0.02 * k;
    h.spine.rotation.set(lean, 0, Math.sin(this.gait) * 0.05 * run + shake * 0.025 * k, 'YXZ');
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x); // the character's right
    // the head: ahead as they run, a terrified look back now and then; on it once caught
    h.root.updateMatrixWorld(true);
    const head = h.headPivot.getWorldPosition(new THREE.Vector3());
    let yaw = 0, pitch = -0.05 + 0.2 * run;
    const glance = this.phase === 'run' && this.t > 0.6 && (this.t % 1.6) > 1.1;
    if (glance || this.phase === 'caught' || this.phase === 'stare') {
      const to = this.chaser.clone().sub(head);
      const fd = to.dot(fwd), rd = to.dot(right);
      yaw = clamp(Math.atan2(-rd, fd), -1.4, 1.4);
      pitch = clamp(Math.atan2(to.y, Math.hypot(fd, rd)), -0.7, 0.6);
      // cowering: turning the face away a little, peeking
      if (how === 'cower' && this.phase === 'caught') { yaw *= 0.6; yaw += 0.35 * k; pitch -= 0.15 * k; }
    }
    this.headYaw = damp(this.headYaw, yaw + shake * 0.03 * k, 9, dt);
    this.headPitch = damp(this.headPitch, pitch, 9, dt);
    h.neck.rotation.set(-this.headPitch * 0.35, this.headYaw * 0.4, 0, 'YXZ');
    h.headPivot.rotation.set(-this.headPitch * 0.65, this.headYaw * 0.6, 0, 'YXZ');
    h.root.updateMatrixWorld(true);
    // the hands
    const face = h.headPivot.getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 2; i++) {
      const A = h.arms[i];
      const out = right.clone().multiplyScalar(i === 0 ? 1 : -1);
      const sh = A.shoulder.getWorldPosition(new THREE.Vector3());
      const reach = (A.upperLen + A.foreLen) * h.root.scale.x;
      // pumping as they run
      const ph = this.gait + (i === 0 ? Math.PI : 0);
      const pump = sh.clone().addScaledVector(UP, -reach * 0.62).addScaledVector(fwd, 0.08 + 0.26 * Math.sin(ph)).addScaledVector(out, 0.06);
      let caughtT: THREE.Vector3;
      let grip: { pole: THREE.Vector3; thumb: THREE.Vector3; fingers: THREE.Vector3 } | null = null;
      if (how === 'cower') {
        // forearms up in front of the face
        caughtT = face.clone().addScaledVector(fwd, 0.2).addScaledVector(out, 0.04).addScaledVector(UP, -0.04 + (i === 0 ? 0.03 : -0.02));
      } else if (how === 'fall') {
        const pelvis = h.root.position;
        caughtT = i === 0
          ? new THREE.Vector3(pelvis.x, ground + 0.04, pelvis.z).addScaledVector(fwd, -0.3).addScaledVector(out, 0.22)
          : face.clone().addScaledVector(fwd, 0.32).addScaledVector(out, 0.1).addScaledVector(UP, 0.08);
      } else {
        // arms round the trunk, one hand over the other: each takes hold of the bark and stays
        // there as they pull themselves up past it, then lets go and reaches up again
        const tr = this.tree!, end = this.path[this.path.length - 1];
        const a0 = Math.atan2(end.x - tr.x, end.y - tr.z);
        const front = new THREE.Vector3(Math.sin(a0), 0, Math.cos(a0)); // from the trunk toward them
        const side = new THREE.Vector3(front.z, 0, -front.x).multiplyScalar(i === 0 ? 1 : -1); // their right / left of it
        const round = (a: number) => front.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
        const c = (rose + i * CLIMB.step) / (2 * CLIMB.step), n = Math.floor(c), reaching = ease((c - n) / 0.5);
        const hold = (m: number) => CLIMB.top + (2 * m + 1 - i) * CLIMB.step - rose;
        const hy = sh.y - heave + hold(n - 1) + (hold(n) - hold(n - 1)) * reaching;
        const at = this._trunk(hy);
        caughtT = new THREE.Vector3(at.x, hy, at.z).addScaledVector(round(CLIMB.wrap), at.r + CLIMB.wrist + CLIMB.lift * Math.sin(reaching * Math.PI));
        // the palm flat on the bark, the fingers up and on round it, the thumb on the side above them
        const mid = CLIMB.wrap + CLIMB.hand / at.r;
        const inward = round(mid).negate();
        const along = front.clone().multiplyScalar(-Math.sin(mid)).addScaledVector(side, Math.cos(mid));
        const fingers = along.addScaledVector(UP, 0.45).normalize();
        grip = {
          pole: side.clone().addScaledVector(UP, -0.8).addScaledVector(front, 0.25).normalize(),
          thumb: i === 0 ? new THREE.Vector3().crossVectors(fingers, inward) : new THREE.Vector3().crossVectors(inward, fingers),
          fingers,
        };
      }
      caughtT.addScaledVector(right, shake * 0.012 * k).addScaledVector(UP, shake * 0.01 * k);
      const tg = this.phase === 'caught' ? pump.clone().lerp(caughtT, ease(this.t / (how === 'climb' ? 0.22 : CATCH[how] * 0.7))) : this.phase === 'home' ? pump.clone().lerp(caughtT, k) : pump;
      if (!this.handsSet) this.hand[i].copy(tg);
      this.hand[i].lerp(tg, 1 - Math.exp(-16 * dt));
      const shield = this.phase === 'caught' && how !== 'climb' && (how === 'cower' || i === 1);
      const pole = out.clone().multiplyScalar(0.7).addScaledVector(fwd, shield ? 0.1 : -0.4).addScaledVector(UP, -0.5).normalize();
      const thumb = shield ? UP.clone().addScaledVector(out, -0.3).normalize() : fwd.clone();
      const fingers = shield ? UP.clone().addScaledVector(fwd, 0.2).normalize() : UP.clone().negate().addScaledVector(fwd, 0.3).normalize();
      if (grip && k > 0) {
        const w = this.phase === 'home' ? k : ease(this.t / 0.22);
        pole.lerp(grip.pole, w).normalize();
        thumb.lerp(grip.thumb, w).normalize();
        fingers.lerp(grip.fingers, w).normalize();
      }
      h.reach(i, this.hand[i], pole, thumb, fingers);
      if (!A.glass) h.setHandOpen(i, this.phase === 'caught');
    }
    this.handsSet = true;
  }
}
