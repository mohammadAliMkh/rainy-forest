import * as THREE from 'three';

// The player's two hands, seen from their own eyes: forearms in sleeves
// coming in from the lower corners of the view, hands with fingers that
// open and close. They rest low in the view, sway a little as you walk, and
// do things through a small set of actions that later parts of the game
// build on:
//   hold(item, side)        put something in a hand (a flashlight, the amulet)
//   take(object, side)      reach for something (in the world, or held out by
//                           someone), close the hand on it, bring it back
//   pickUp(object, side)    the same, down to the ground or a shelf
//   throwHeld(side)         wind up, swing, let go: it flies off and falls
//   push(onContact)         both hands forward, palms out
//   pull(object, onDone)    grab something in front with both hands, pull back
// Each action runs over time and calls back at its moment (`onGrab`,
// `onRelease`, `onDone`); one action per hand at a time (`busy`).
// The hands live in the scene (so the lantern and the flashlight light
// them) and follow the camera, placed in the camera's own frame. They are
// the owner's own forearms and hands (fp_arms.glb, cut from his model by
// pipeline/blender_fp_arms.py): their forearm, wrist and finger bones are
// moved to match; without that file, simple built ones stand in.

export type Side = 'left' | 'right';

interface Pose { pos: THREE.Vector3; quat: THREE.Quaternion; grip: number }

/** something that flies after being thrown, until it comes to rest on the ground */
interface Flight { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; onLand?: (obj: THREE.Object3D) => void }

/** an action in progress on one hand: called every frame with seconds since it began; returns true when finished */
type Step = (t: number, dt: number) => boolean;

const SKIN = 0xd6a07e;
const SLEEVE = 0x3a4336;
const FINGERS: { x: number; len: number }[] = [
  { x: -0.028, len: 0.07 }, // index (nearest the thumb)
  { x: -0.009, len: 0.078 },
  { x: 0.01, len: 0.074 },
  { x: 0.028, len: 0.06 }, // little finger
];
const REACH = 0.62; // how far a hand gets from the shoulder (m)
const FOREARM = 0.3;
/** where the forearms come from, low at the corners of the view (camera space, right; the left mirrored) */
const ELBOW = new THREE.Vector3(0.34, -0.55, 0.02);
const SHOULDER = { left: new THREE.Vector3(-0.19, -0.3, 0.12), right: new THREE.Vector3(0.19, -0.3, 0.12) };

const euler = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));
/** the camera-space poses, for the right hand (the left one is the mirror image) */
const POSE = {
  /** resting low at the corner of the view, palm turned in toward the other hand, thumb on top, fingers relaxed */
  rest: { pos: new THREE.Vector3(0.21, -0.27, -0.42), quat: euler(0.15, 0.35, -1.25), grip: 0.3 },
  /** holding something up in front, ready to use it (turned a little inward, so it is seen from the side) */
  hold: { pos: new THREE.Vector3(0.19, -0.2, -0.4), quat: euler(0.16, 0.3, -1.35), grip: 1 },
  /** out of view, down by the side */
  away: { pos: new THREE.Vector3(0.24, -0.62, -0.22), quat: euler(0.6, 0.1, -0.4), grip: 0.5 },
  /** palm out, pushing */
  push: { pos: new THREE.Vector3(0.13, -0.12, -0.5), quat: euler(-1.25, 0.1, 0.1), grip: 0 },
  /** drawn back over the shoulder to throw */
  windup: { pos: new THREE.Vector3(0.26, -0.06, -0.12), quat: euler(-0.5, 0.2, -1.3), grip: 1 },
  /** the arm thrown forward */
  release: { pos: new THREE.Vector3(0.1, -0.1, -0.62), quat: euler(0.3, 0.05, -1.3), grip: 0.1 },
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

function mirror(p: Pose): Pose {
  // the left hand: x flipped, and the rotation mirrored across the y-z plane
  const e = new THREE.Euler().setFromQuaternion(p.quat, 'YXZ');
  return { pos: p.pos.clone().setX(-p.pos.x), quat: euler(e.x, -e.y, -e.z), grip: p.grip };
}

/** a bone of the model by its name in Blender (the loader drops the dot: "wrist.R" -> "wristR") */
function bone(root: THREE.Object3D, name: string): THREE.Bone | null {
  return (root.getObjectByName(name) ?? root.getObjectByName(name.replace('.', '')) ?? root.getObjectByName(name.replace('.', '_'))) as THREE.Bone | null;
}

/** an orthonormal frame as a quaternion: y = up, z = back (minus forward), x = y x z */
function frame(forward: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const z = forward.clone().negate().normalize();
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * One of the model's arms: the forearm bone set every frame from where the
 * elbow is and where the wrist must be, the wrist bone turned to the hand's
 * pose, the finger bones curled toward the palm by the grip.
 */
class ModelArm {
  private readonly fore: THREE.Bone;
  private readonly fore2: THREE.Bone;
  private readonly wrist: THREE.Bone;
  private readonly fingers: { bone: THREE.Bone; bind: THREE.Quaternion; axis: THREE.Vector3; amount: number }[] = [];
  /** forearm length (lowerarm01 head to the wrist), bind direction and the back of the hand */
  readonly length: number;
  private readonly d0: THREE.Vector3;
  private readonly u0: THREE.Vector3;
  private readonly fore0: THREE.Quaternion;
  /** the wrist bone's world rotation relative to the hand's own frame */
  private readonly wristOff: THREE.Quaternion;

  constructor(model: THREE.Object3D, side: Side, container: THREE.Object3D) {
    const S = side === 'right' ? 'R' : 'L';
    const need = (n: string) => { const b = bone(model, `${n}.${S}`); if (!b) throw new Error(`fp_arms: no bone ${n}.${S}`); return b; };
    this.fore = need('lowerarm01');
    this.fore2 = need('lowerarm02');
    this.wrist = need('wrist');
    model.updateMatrixWorld(true);
    const at = (b: THREE.Object3D) => b.getWorldPosition(new THREE.Vector3());
    const w = at(this.wrist), f0 = at(this.fore);
    const index = at(need('finger2-1')), little = at(need('finger5-1'));
    const fwd = index.clone().add(little).multiplyScalar(0.5).sub(w).normalize();
    const toThumb = index.clone().sub(little).normalize();
    // the back of the hand (its palm faces the other way)
    const up = side === 'right' ? new THREE.Vector3().crossVectors(fwd, toThumb) : new THREE.Vector3().crossVectors(toThumb, fwd);
    up.normalize();
    const hand0 = frame(fwd, up);
    this.wristOff = hand0.clone().invert().multiply(this.wrist.getWorldQuaternion(new THREE.Quaternion()));
    this.length = w.distanceTo(f0);
    this.d0 = w.clone().sub(f0).normalize();
    this.u0 = up.clone().addScaledVector(this.d0, -up.dot(this.d0)).normalize();
    this.fore0 = this.fore.getWorldQuaternion(new THREE.Quaternion());
    // the fingers: each joint bends about the axis that turns it toward the palm
    const palm = up.clone().negate();
    const AMOUNT = [[0.35, 0.55, 0.45], [1.15, 1.35, 0.95], [1.2, 1.4, 1.0], [1.2, 1.4, 1.0], [1.15, 1.35, 0.95]];
    for (let i = 1; i <= 5; i++) {
      for (let j = 1; j <= 3; j++) {
        const b = need(`finger${i}-${j}`);
        const dir = (b.children[0] ? at(b.children[0]) : at(b).addScaledVector(fwd, 0.02)).sub(at(b)).normalize();
        const axis = new THREE.Vector3().crossVectors(dir, palm).normalize();
        axis.applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()).invert());
        this.fingers.push({ bone: b, bind: b.quaternion.clone(), axis, amount: AMOUNT[i - 1][j - 1] });
      }
    }
    // the forearm is moved on its own from now on (in world space)
    container.attach(this.fore);
  }

  /** the hand's frame (world) and where the elbow side of the forearm points from (world) */
  pose(handPos: THREE.Vector3, handQuat: THREE.Quaternion, elbow: THREE.Vector3, grip: number): void {
    const d = _a.subVectors(handPos, elbow).normalize();
    const up = _b.set(0, 1, 0).applyQuaternion(handQuat);
    up.addScaledVector(d, -up.dot(d)).normalize();
    // turn the forearm as a whole from its bind direction to this one, keeping the back of the hand up
    const align = frame(d, up).multiply(frame(this.d0, this.u0).invert());
    this.fore.quaternion.copy(align).multiply(this.fore0);
    this.fore.position.copy(handPos).addScaledVector(d, -this.length);
    this.fore.updateMatrixWorld(true);
    // the wrist turned to the hand's pose
    const parent = this.fore2.getWorldQuaternion(_q1);
    this.wrist.quaternion.copy(parent.invert()).multiply(_q2.copy(handQuat).multiply(this.wristOff));
    for (const f of this.fingers) f.bone.quaternion.copy(f.bind).multiply(_q1.setFromAxisAngle(f.axis, -0.05 + f.amount * grip));
    this.fore.updateMatrixWorld(true);
  }
}

class Hand {
  readonly side: Side;
  readonly root = new THREE.Group(); // the wrist, in camera space
  /** the forearm in its sleeve: from the wrist back to the corner of the view (placed every frame) */
  readonly arm: THREE.Mesh;
  /** where a held thing sits (inside the closed hand) */
  readonly grip = new THREE.Group();
  readonly pose: Pose;
  /** where it is heading (actions move this; the hand follows smoothly) */
  readonly goal: Pose;
  speed = 10;
  held: THREE.Object3D | null = null;
  step: Step | null = null;
  stepT = 0;
  private readonly fingers: THREE.Object3D[][] = [];
  private readonly thumb: THREE.Object3D[] = [];
  /** the owner's own arm (else the simple one built here) */
  model: ModelArm | null = null;
  private readonly built: THREE.Object3D[] = [];

  constructor(side: Side, skin: THREE.Material, sleeve: THREE.Material) {
    this.side = side;
    const s = side === 'right' ? 1 : -1; // the thumb is on the inner side
    const start = side === 'right' ? POSE.rest : mirror(POSE.rest);
    this.pose = { pos: start.pos.clone(), quat: start.quat.clone(), grip: start.grip };
    this.goal = { pos: start.pos.clone(), quat: start.quat.clone(), grip: start.grip };
    // the forearm (unit length along +y, the wrist end on top)
    this.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.048, 1, 12), sleeve);
    this.arm.frustumCulled = false;
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.03, 12), skin);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.002, 0.01);
    // the palm: fingers forward (-z), palm facing down (-y)
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
    palm.scale.set(0.044, 0.016, 0.048);
    palm.position.set(0, 0, -0.045);
    this.root.add(cuff, palm);
    this.built.push(cuff, palm, this.arm);
    const seg = (len: number, r: number) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 3, 8), skin);
      m.rotation.x = Math.PI / 2;
      m.position.z = -len / 2;
      return m;
    };
    for (const f of FINGERS) {
      // two joints per finger: the knuckle and the middle joint
      const k1 = new THREE.Group();
      k1.position.set(f.x * -s, -0.002, -0.088);
      const k2 = new THREE.Group();
      k2.position.z = -f.len * 0.55;
      k1.add(seg(f.len * 0.55, 0.0085), k2);
      k2.add(seg(f.len * 0.45, 0.0078));
      this.root.add(k1);
      this.built.push(k1);
      this.fingers.push([k1, k2]);
    }
    // the thumb, from the side of the palm, forward and in
    const t1 = new THREE.Group();
    t1.position.set(-0.036 * s, -0.008, -0.03);
    t1.rotation.set(0, 0.55 * s, 0, 'YXZ');
    const t2 = new THREE.Group();
    t2.position.z = -0.034;
    t1.add(seg(0.034, 0.0105), t2);
    t2.add(seg(0.03, 0.0095));
    this.root.add(t1);
    this.built.push(t1);
    this.thumb.push(t1, t2);
    this.grip.position.set(0, -0.032, -0.07);
    this.root.add(this.grip);
    this.root.traverse((o) => { o.frustumCulled = false; });
  }

  /** set the goal to a pose (given for the right hand; mirrored for the left) */
  aim(p: Pose, speed = 10): void {
    const q = this.side === 'right' ? p : mirror(p);
    this.goal.pos.copy(q.pos);
    this.goal.quat.copy(q.quat);
    this.goal.grip = q.grip;
    this.speed = speed;
  }

  /** use the model's arm instead of the built one */
  useModel(m: ModelArm): void {
    this.model = m;
    for (const o of this.built) o.visible = false;
  }

  update(dt: number, bob: THREE.Vector3): void {
    const k = 1 - Math.exp(-this.speed * dt);
    this.pose.pos.lerp(this.goal.pos, k);
    this.pose.quat.slerp(this.goal.quat, k);
    this.pose.grip += (this.goal.grip - this.pose.grip) * Math.min(1, dt * 9);
    this.root.position.copy(this.pose.pos).add(bob);
    this.root.quaternion.copy(this.pose.quat);
    // the forearm: a fixed length from the wrist toward its corner of the view
    const wrist = _a.copy(this.root.position).add(_b.set(0, 0, 0.02).applyQuaternion(this.root.quaternion));
    const elbow = _b.set(ELBOW.x * (this.side === 'right' ? 1 : -1), ELBOW.y, ELBOW.z).sub(wrist).setLength(FOREARM).add(wrist);
    this.arm.position.addVectors(wrist, elbow).multiplyScalar(0.5);
    this.arm.quaternion.setFromUnitVectors(UP, _c.subVectors(wrist, elbow).normalize());
    this.arm.scale.set(1, FOREARM + 0.04, 1);
    // fingers curl toward the palm (-y) as the grip closes
    const g = this.pose.grip;
    for (const [k1, k2] of this.fingers) { k1.rotation.x = -0.15 - 1.25 * g; k2.rotation.x = -0.2 - 1.3 * g; }
    const s = this.side === 'right' ? 1 : -1;
    this.thumb[0].rotation.set(-0.25 - 0.5 * g, (0.55 - 0.35 * g) * s, 0, 'YXZ');
    this.thumb[1].rotation.x = -0.2 - 0.9 * g;
  }
}

export class Hands {
  /** follows the camera; holds both hands (in camera space) */
  readonly rig = new THREE.Group();
  readonly left: Hand;
  readonly right: Hand;
  /** the hands are shown (the game hides them in film scenes, unless an action needs them) */
  enabled = true;
  private readonly flights: Flight[] = [];
  private readonly world: THREE.Object3D;
  private readonly ground: (x: number, z: number) => number;
  private walk = 0;
  /** the owner's arms (world space; shown with the rig) */
  private readonly arms: THREE.Object3D | null = null;
  private readonly bob = new THREE.Vector3();
  private readonly lastCam = new THREE.Vector3();

  /** `world`: where thrown things go; `ground`: the ground height at (x, z) */
  /** `model`: fp_arms.glb (the owner's forearms and hands), or null for the built ones */
  constructor({ scene, world, ground, model = null }: { scene: THREE.Object3D; world: THREE.Object3D; ground: (x: number, z: number) => number; model?: THREE.Object3D | null }) {
    this.world = world;
    this.ground = ground;
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7 });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: 0.9 });
    this.left = new Hand('left', skin, sleeve);
    this.right = new Hand('right', skin, sleeve);
    this.rig.add(this.left.root, this.right.root, this.left.arm, this.right.arm);
    scene.add(this.rig);
    if (model) {
      try {
        const arms = new THREE.Group();
        arms.add(model);
        model.traverse((o) => {
          o.frustumCulled = false;
          const m = o as THREE.Mesh;
          if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; }
        });
        scene.add(arms);
        this.right.useModel(new ModelArm(model, 'right', arms));
        this.left.useModel(new ModelArm(model, 'left', arms));
        this.arms = arms;
      } catch (e) {
        console.warn('first-person arms: using the built hands', e);
      }
    }
  }

  hand(side: Side): Hand { return side === 'right' ? this.right : this.left; }

  /** a hand is in the middle of an action */
  get busy(): boolean { return !!(this.left.step || this.right.step); }

  private _run(h: Hand, step: Step): void { h.step = step; h.stepT = 0; }

  // ---------------------------------------------------------------- actions

  /** put `item` in the hand (null: empty it); the item is placed so that its own -z points forward */
  hold(item: THREE.Object3D | null, side: Side = 'right'): void {
    const h = this.hand(side);
    if (h.held && h.held !== item) h.grip.remove(h.held);
    h.held = item;
    if (item) {
      h.grip.add(item);
      item.position.set(0, 0.004, -0.09); // held by its back end, sticking out ahead of the fist
      item.quaternion.copy(GRIP_TURN);
      item.visible = true;
    }
    if (!h.step) h.aim(item ? POSE.hold : POSE.rest, 8);
  }

  /**
   * reach for `object` (wherever it is, even moving), close the hand on it and
   * bring it back. Out of reach, the hand stretches toward it and the object
   * comes the rest of the way. `keep`: it stays in the hand (else it is put
   * away: back where it came from in the scene graph, hidden).
   */
  take(object: THREE.Object3D, side: Side = 'right', { reach = 0.55, keep = false, onGrab, onDone }: { reach?: number; keep?: boolean; onGrab?: () => void; onDone?: () => void } = {}): void {
    const h = this.hand(side);
    const home = object.parent;
    let grabbed = false;
    this._run(h, (t) => {
      if (!grabbed) {
        // reach out, hand open, toward where it is now
        this._aimAt(h, object.getWorldPosition(_w), 0);
        h.speed = 9;
        if (t > reach) {
          grabbed = true;
          h.grip.attach(object);
          onGrab?.();
        }
        return false;
      }
      const k = ease((t - reach) / 0.35);
      // the object settles into the closed hand
      object.position.multiplyScalar(1 - k);
      object.quaternion.slerp(GRIP_TURN, k);
      h.goal.grip = 1;
      if (t < reach + 0.35) return false;
      if (keep) { h.held = object; h.aim(POSE.hold, 7); onDone?.(); return true; }
      // into the bag: down out of view, then gone
      h.aim(POSE.away, 7);
      if (t < reach + 0.85) return false;
      object.visible = false;
      if (home) home.attach(object); else h.grip.remove(object);
      h.aim(this.hand(side).held ? POSE.hold : POSE.rest, 6);
      onDone?.();
      return true;
    });
  }

  /** pick something up from the ground or a shelf (like `take`, reaching down) */
  pickUp(object: THREE.Object3D, side: Side = 'right', opts: { keep?: boolean; onGrab?: () => void; onDone?: () => void } = {}): void {
    this.take(object, side, { reach: 0.7, ...opts });
  }

  /**
   * throw what the hand holds: wind up, swing, let go. It flies off along the
   * view (`speed` m/s, a little up) and falls until it rests on the ground.
   */
  throwHeld(side: Side = 'right', { speed = 9, onRelease, onLand }: { speed?: number; onRelease?: (obj: THREE.Object3D) => void; onLand?: (obj: THREE.Object3D) => void } = {}): void {
    const h = this.hand(side);
    const obj = h.held;
    if (!obj) return;
    let gone = false;
    this._run(h, (t) => {
      if (t < 0.35) { h.aim(POSE.windup, 8); return false; }
      if (!gone) {
        h.aim(POSE.release, 22);
        if (t < 0.5) return false;
        gone = true;
        h.held = null;
        this.world.attach(obj);
        const dir = _v.set(0, 0.22, -1).normalize().applyQuaternion(this.rig.quaternion);
        this.flights.push({ obj, vel: dir.clone().multiplyScalar(speed), spin: new THREE.Vector3(8, 2, 0), onLand });
        onRelease?.(obj);
      }
      if (t < 0.9) return false;
      h.aim(POSE.rest, 6);
      return true;
    });
  }

  /** both hands forward, palms out; `onContact` as they reach full stretch */
  push(onContact?: () => void): void {
    for (const h of [this.left, this.right]) {
      const lead = h === this.right;
      this._run(h, (t) => {
        if (t < 0.12) { h.aim(POSE.rest, 10); return false; }
        if (t < 0.42) { h.aim(POSE.push, 16); return false; }
        if (lead && t - 0.016 < 0.42) onContact?.();
        if (t < 0.75) return false;
        h.aim(h.held ? POSE.hold : POSE.rest, 7);
        return true;
      });
    }
  }

  /** grab `object` in front with both hands and pull it back toward you; `onGrab`, then `onDone` */
  pull(object: THREE.Object3D, { onGrab, onDone }: { onGrab?: () => void; onDone?: () => void } = {}): void {
    let grabbed = false;
    for (const h of [this.left, this.right]) {
      const lead = h === this.right;
      const side = h === this.right ? 1 : -1;
      this._run(h, (t) => {
        const at = object.getWorldPosition(_w);
        if (t < 0.5) {
          this._aimAt(h, at, 0);
          h.goal.pos.x += 0.09 * side;
          return false;
        }
        if (lead && !grabbed) { grabbed = true; onGrab?.(); }
        h.goal.grip = 1;
        if (t < 1.1) {
          // back toward the chest
          h.goal.pos.lerp(_v.set(0.14 * side, -0.24, -0.25), 0.08);
          h.speed = 6;
          return false;
        }
        if (lead) onDone?.();
        h.aim(h.held ? POSE.hold : POSE.rest, 6);
        return true;
      });
    }
  }

  // aim a hand at a world point (clamped to its reach), the fingers pointing at it
  private _aimAt(h: Hand, world: THREE.Vector3, grip: number): void {
    const local = this.rig.worldToLocal(_v.copy(world));
    const sh = SHOULDER[h.side];
    const d = _w.subVectors(local, sh);
    if (d.length() > REACH) d.setLength(REACH);
    h.goal.pos.copy(sh).add(d);
    // fingers (-z) toward the target, palm down
    _m.lookAt(sh, h.goal.pos, UP);
    h.goal.quat.setFromRotationMatrix(_m);
    h.goal.grip = grip;
  }

  // ---------------------------------------------------------------- per frame

  /** after the camera is final for the frame; `moving` 0..1 (walking speed) */
  update(dt: number, camera: THREE.Camera, show: boolean, moving: number): void {
    this.rig.position.copy(camera.position);
    this.rig.quaternion.copy(camera.quaternion);
    // a gentle sway while walking, settling when still
    const travelled = this.lastCam.distanceTo(camera.position);
    this.lastCam.copy(camera.position);
    if (travelled < 1) this.walk += travelled * 5.2;
    const sway = Math.min(1, moving);
    this.bob.set(Math.sin(this.walk) * 0.008 * sway, -Math.abs(Math.cos(this.walk)) * 0.012 * sway, 0);
    for (const h of [this.left, this.right]) {
      if (h.step) {
        h.stepT += dt;
        if (h.step(h.stepT, dt)) h.step = null;
      }
      h.update(dt, this.bob);
    }
    if (this.arms) {
      this.rig.updateMatrixWorld(true);
      for (const h of [this.left, this.right]) {
        const m = h.model!;
        const pos = h.root.getWorldPosition(_v);
        const quat = h.root.getWorldQuaternion(_q3);
        // the elbow: out toward the lower corner of the view, a forearm's length away
        const elbow = this.rig.localToWorld(_w.set(ELBOW.x * (h.side === 'right' ? 1 : -1), ELBOW.y, ELBOW.z)).sub(pos).setLength(m.length).add(pos);
        m.pose(pos, quat, elbow, h.pose.grip);
      }
    }
    this.rig.visible = this.enabled && (show || this.busy);
    if (this.arms) this.arms.visible = this.rig.visible;
    this._fly(dt);
  }

  // thrown things: a simple arc with gravity, coming to rest on the ground
  private _fly(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.vel.y -= 9.8 * dt;
      f.obj.position.addScaledVector(f.vel, dt);
      f.obj.rotation.x += f.spin.x * dt;
      f.obj.rotation.y += f.spin.y * dt;
      const g = this.ground(f.obj.position.x, f.obj.position.z) + 0.04;
      if (f.obj.position.y <= g) {
        f.obj.position.y = g;
        this.flights.splice(i, 1);
        f.onLand?.(f.obj);
      }
    }
  }
}

/** how a held item sits in the closed hand: pointing along the fingers, upright */
const GRIP_TURN = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 1.35));
