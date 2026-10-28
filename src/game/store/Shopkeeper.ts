import * as THREE from 'three';
import { Human } from '../people/Human.js';
import { damp, clamp } from '../../utils/noise.js';
import { COUNTER, F, SHOPKEEPER } from './storeLayout.ts';

// Farajpour behind the counter: short and round, bald with black tufts
// over the ears, a thick black moustache curled up at the ends, a cheerful
// smile, a red shirt under a dark vest (the Blender model, pipeline/
// blender_people.py; the hand-built person below is the fallback).
// He stands with his hands on the counter, breathes, blinks, glances down
// at his notebook now and then, turns his head to whoever walks in and
// gives them a small nod.

type Shared = ConstructorParameters<typeof Human>[1];

export const SHOPKEEPER_SPEC = {
  name: 'فرج‌پور',
  seed: 77,
  height: 0.97, build: 1.05, shoulders: 0.92, belly: 0.03,
  skin: 0xc4977a,
  eyeColor: 0x3b2a1b,
  hairColor: 0x15110e,
  face: { width: 1.12, length: 0.96, jaw: 0.7, nose: 1.22, noseWidth: 1.2, hump: 0.1, brow: 1.15, cheek: 1.3, lips: 0.9, chin: 0.95, smile: 0.6 },
  hair: { front: 0.2, recede: 0.15, bald: 0.42, sidesLine: 0.05, nape: -0.55, thick: 0.009, sides: 0.55, highlight: 0x2a221c, rough: 0.35 },
  beard: { style: 'mustache', thick: 0.011, mustache: 1.8, mustacheWidth: 0.07, color: 0x15110e, highlight: 0x2a221c },
  brows: { thick: 0.0048, width: 0.055 },
  hold: 'none',
  outfit: {
    jacket: { color: 0xb8261b, tex: 'fabric', sleeve: 0.05, pad: 0.01 },
    pants: { color: 0x3b342c, tex: 'fabric' },
    shoes: { style: 'boot', color: 0x2e2219 },
    apron: { color: 0x1b2236 },
  },
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Shopkeeper {
  readonly human: Human;
  readonly root: THREE.Group;
  // head direction relative to the body, and where it wants to look
  private yaw = 0; private pitch = 0;
  private time = 0;
  private glanceT = 6;
  private glance = 0; // 0..1 looking down at the notebook
  private nodT = -1;
  private greeted = false;
  private sayT = 0; // seconds left of something he is saying
  // where the hands rest (shop frame) and the elbow / hand directions (shop frame)
  private readonly handsLocal: THREE.Vector3[];

  /** `model`: Farajpour built in Blender, when loaded */
  constructor(shared: Shared, model: THREE.Object3D | null = null) {
    this.human = new Human(model ? { ...SHOPKEEPER_SPEC, model } : SHOPKEEPER_SPEC, shared);
    const h = this.human;
    this.root = h.root as THREE.Group;
    if (!model) h.head.group.scale.setScalar(1.1); // the hand-built one: a big round head
    // facing the counter (the shop's -x)
    this.root.rotation.y = -Math.PI / 2;
    this.root.position.set(SHOPKEEPER.x, 0, SHOPKEEPER.z);
    this.root.updateMatrixWorld(true);
    // stand on the floor: lift until the soles touch it
    const box = new THREE.Box3().setFromObject(this.root);
    this.root.position.y = F - box.min.y;
    const top = F + COUNTER.h + 0.035;
    const x = COUNTER.x1 - 0.07;
    this.handsLocal = [new THREE.Vector3(x, top, SHOPKEEPER.z - 0.16), new THREE.Vector3(x, top, SHOPKEEPER.z + 0.17)]; // right, left
  }

  /** he says something (his lips move, he looks at the customer) */
  speak(seconds: number): void { this.sayT = seconds; }

  /** a nod of thanks */
  nod(): void { this.nodT = 0.5; }

  /**
   * `viewer`: the player's eye in the shop frame, `inside`: whether they are
   * in the shop (he only follows people who came in, or are at the door)
   */
  update(dt: number, viewer: THREE.Vector3, inside: boolean): void {
    const h = this.human;
    this.time += dt;
    const t = this.time;

    // where to look: the customer, or now and then the notebook
    const headPos = h.headPivot.getWorldPosition(_v);
    this.root.parent!.worldToLocal(headPos);
    const to = _w.subVectors(viewer, headPos);
    // in the body's frame (he faces the shop's -x, his left is +z)
    let tyaw = Math.atan2(to.z, -to.x), tpitch = Math.atan2(to.y, Math.hypot(to.x, to.z));
    const near = to.length() < 7 && Math.abs(tyaw) < 1.7;
    if (inside && !this.greeted) { this.greeted = true; this.nodT = 0.6; h.talk = 0; }
    if (!inside && to.length() > 9) this.greeted = false;

    this.glanceT -= dt;
    if (this.glanceT < 0) this.glanceT = near ? 7 + Math.random() * 9 : 4 + Math.random() * 6;
    const lookingDown = this.glanceT < (near ? 1.6 : 3.2);
    this.glance = damp(this.glance, (lookingDown || !near) && this.sayT <= 0 ? 1 : 0, 3, dt);
    tyaw = clamp(tyaw, -1.15, 1.15) * (1 - this.glance) + 0.12 * this.glance;
    tpitch = clamp(tpitch, -0.5, 0.45) * (1 - this.glance) - 0.55 * this.glance;
    this.yaw = damp(this.yaw, tyaw, 4, dt);
    this.pitch = damp(this.pitch, tpitch, 4, dt);

    // a slow nod when someone comes in, and "salaam" on his lips
    let nod = 0;
    if (this.nodT >= 0) {
      this.nodT += dt;
      const k = this.nodT - 0.6;
      if (k > 0 && k < 1.2) nod = Math.sin((k / 1.2) * Math.PI) * 0.28;
      h.talk = k > 0.1 && k < 0.8 ? 0.6 : 0;
      if (this.nodT > 2.2) { this.nodT = -1; h.talk = 0; }
    }
    if (this.sayT > 0) { this.sayT -= dt; h.talk = this.sayT > 0 ? 1 : 0; }

    // breathing and a little sway; leaning on his hands
    const breath = Math.sin(t * 1.5) * 0.012;
    h.spine.rotation.set(0.16 + breath, this.yaw * 0.12, Math.sin(t * 0.37) * 0.012, 'YXZ');
    h.neck.rotation.set(-this.pitch * 0.35, this.yaw * 0.35, 0, 'YXZ');
    h.headPivot.rotation.set(-this.pitch * 0.65 + nod, this.yaw * 0.65, Math.sin(t * 0.5) * 0.025, 'YXZ');

    // hands flat on the counter: elbows out and back, thumbs inward
    const shop = this.root.parent!;
    shop.updateWorldMatrix(true, false);
    const q = shop.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    const left = new THREE.Vector3(0, 0, 1).applyQuaternion(q); // his left
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1; // arm 0 is his right
      const target = shop.localToWorld(_v.copy(this.handsLocal[i]));
      const out = left.clone().multiplyScalar(side);
      const pole = out.clone().multiplyScalar(0.45).addScaledVector(fwd, -0.8).addScaledVector(UP, -0.3).normalize();
      const thumb = out.clone().negate().addScaledVector(fwd, 0.3).normalize();
      const fingers = fwd.clone().addScaledVector(out, -0.15).addScaledVector(UP, -0.25).normalize();
      h.reach(i, target, pole, thumb, fingers);
    }
    h.updateFace(dt);
  }
}
