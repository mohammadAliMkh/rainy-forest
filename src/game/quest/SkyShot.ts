import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';

// After the jar scene, in one unbroken shot: from where the camera was left
// on the porch (looking into the woods after the ghost) it rises straight up
// into the night sky, tilting up toward it; then it flies over the trees
// toward the camp, looking down ahead, and comes down to a low shot of the
// four friends around the fire, who know nothing - with the cabin behind
// them, where the ghost will come from (`lair`). (What follows comes next;
// for now the scene ends with a dip to black.)

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the scene's moments (seconds) */
const T = {
  rise: 4.5, // up into the sky...
  over: 11.0, // ...over the trees to the camp...
  down: 15.5, // ...and down to the friends
  end: 18.5,
};
/** how high it goes (metres above where it starts), how high it flies over */
const HIGH = { rise: 38, over: 30 };
/** the last shot: how far from the fire, how high above the ground */
const SHOT = { back: 5.2, eye: 1.55 };

export class SkyShot {
  /** the film camera has the view */
  filming = false;
  private readonly events: EventBus<GameEvents>;
  private readonly ground: (x: number, z: number) => number;
  private readonly shoo: (x: number, z: number, r: number) => void;
  private readonly fire = new THREE.Vector3();
  private readonly lair = new THREE.Vector3();
  private t = -1;
  private ending = 0;
  private fade = 0;
  private path: THREE.CatmullRomCurve3 | null = null;
  private readonly rose = new THREE.Vector3(); // where it is once up in the sky
  private readonly start0 = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3(); // which way it looked at first (level)
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();

  /**
   * `fire`: the fire (world x / z); `lair`: behind the cabin, where the ghost
   * will come from; `shoo`: sends any deer near a place away (out of the shot)
   */
  constructor({ events, ground, fire, lair, shoo }: {
    events: EventBus<GameEvents>; ground: (x: number, z: number) => number;
    fire: { x: number; z: number }; lair: { x: number; z: number };
    shoo: (x: number, z: number, r: number) => void;
  }) {
    this.events = events;
    this.ground = ground;
    this.shoo = shoo;
    this.fire.set(fire.x, ground(fire.x, fire.z), fire.z);
    this.lair.set(lair.x, ground(lair.x, lair.z), lair.z);
  }

  get active(): boolean { return this.t >= 0; }

  /** where the last shot is: in front of the friends, the cabin behind them (world) */
  shotPos(target = new THREE.Vector3()): THREE.Vector3 {
    _v.set(this.fire.x - this.lair.x, 0, this.fire.z - this.lair.z).normalize();
    const x = this.fire.x + _v.x * SHOT.back, z = this.fire.z + _v.z * SHOT.back;
    return target.set(x, this.ground(x, z) + SHOT.eye, z);
  }

  /** from where `camera` is now (the end of the jar scene) */
  start(camera: THREE.Camera): void {
    if (this.active) return;
    this.t = 0; this.ending = 0;
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.start0.copy(camera.position);
    camera.getWorldDirection(this.ahead);
    this.ahead.y = 0;
    this.ahead.normalize();
    this.rose.copy(this.start0).addScaledVector(UP, HIGH.rise);
    // over the trees to the camp, coming in from beyond the shot, and down to it
    const last = this.shotPos();
    _v.set(last.x - this.fire.x, 0, last.z - this.fire.z).normalize();
    const over = new THREE.Vector3(last.x + _v.x * 16, this.fire.y + HIGH.over * 0.8, last.z + _v.z * 16);
    const mid = this.rose.clone().lerp(over, 0.5);
    mid.y = Math.max(this.rose.y, over.y) + 4;
    const near = new THREE.Vector3(last.x + _v.x * 5, last.y + 5, last.z + _v.z * 5);
    this.path = new THREE.CatmullRomCurve3([this.rose.clone(), mid, over, near, last], false, 'centripetal');
    // no deer wandering into the shot at the camp (the camera is far away yet)
    this.shoo(this.fire.x, this.fire.z, 22);
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (!this.ending && this.t >= T.end) this.ending = 1e-6;
    if (!this.ending) return;
    // dip to black, back to the player
    this.ending += dt;
    if (this.filming) {
      this.fade = Math.min(1, this.ending / 0.5);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.5) {
        this.filming = false;
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.6);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming || !this.path) return;
    const t = this.t;
    // up, then along the way to the camp and down (eased: it gathers speed and settles)
    if (t < T.rise) this.tPos.copy(this.start0).lerp(this.rose, sstep(0, T.rise, t));
    else this.path.getPointAt(sstep(T.rise, T.down, t), this.tPos);
    // where it looks: ahead, up into the sky as it rises, then down ahead to
    // the camp, and at the friends round the fire as it comes down
    const sky = _v.copy(this.start0).addScaledVector(this.ahead, 20).addScaledVector(UP, HIGH.rise + 30);
    this.tLook.copy(this.start0).addScaledVector(this.ahead, 20).lerp(sky, sstep(0.3, T.rise, t));
    const camp = _v.set(this.fire.x, this.fire.y + 0.9, this.fire.z);
    this.tLook.lerp(camp, sstep(T.rise - 0.3, T.rise + 2.8, t));
    _m.lookAt(this.tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    const k = 1 - Math.exp(-4 * dt);
    this.pos.copy(this.tPos);
    this.quat.slerp(_q, k);
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - 55) > 0.01) { camera.fov = 55; camera.updateProjectionMatrix(); }
  }
}
