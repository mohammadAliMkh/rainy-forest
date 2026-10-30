import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Wraith } from '../scenario/Wraith.ts';

// The pickle jar opened: a film scene. The lid flies off; from the jar's
// mouth a small knot of pale light spins up, rises and, spinning, leaves the
// porch over the railing, growing as it goes into a whirlwind standing in
// the yard; the whirlwind gathers itself into the ghost, which turns to the
// player and glares (a deep laugh). The camera starts close by the jar,
// then cuts to the yard, a few metres off, to see it grow and take shape
// with the shop behind it (from a spot with no tree in the way).
// (What follows - the shaking, the red sky, the ghost leaving for the woods -
// comes next; for now the scene ends with a dip to black.)

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the scene's moments (seconds) */
const T = {
  knot: 0.6, // the knot appears in the mouth
  leave: 2.2, // it leaves the porch, growing
  yard: 4.2, // a full whirlwind in the yard
  gather: 5.0, // it gathers into the ghost...
  formed: 7.5, // ...which stands there and glares
  end: 10.5,
};

export class JarScene {
  /** the film camera has the view */
  filming = false;
  private readonly wraith: Wraith;
  private readonly events: EventBus<GameEvents>;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly blocked: (x: number, z: number, r: number) => boolean;
  private t = -1;
  private ending = 0;
  private fade = 0;
  private readonly cue = new Set<string>();
  private readonly mouth = new THREE.Vector3();
  private readonly yard = new THREE.Vector3();
  private readonly toPlayer = new THREE.Vector3();
  private readonly player = new THREE.Vector3();
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private fov = 70;
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  /** the second shot: where the camera stands in the yard */
  private readonly wide = new THREE.Vector3();
  private cut = false;
  private snap = false;

  constructor({ wraith, events, terrain, blocked }: {
    wraith: Wraith; events: EventBus<GameEvents>; terrain: { heightAt(x: number, z: number): number }; blocked: (x: number, z: number, r: number) => boolean;
  }) {
    this.blocked = blocked;
    this.wraith = wraith;
    this.events = events;
    this.terrain = terrain;
  }

  get active(): boolean { return this.t >= 0; }

  /**
   * `mouth`: the jar's mouth (world); `out`: which way off the porch (horizontal);
   * `camera`: the player's view, where the first shot starts
   */
  start(mouth: THREE.Vector3, out: THREE.Vector3, camera: THREE.Camera): void {
    if (this.active) return;
    this.t = 0; this.ending = 0; this.cue.clear();
    this.mouth.copy(mouth);
    this.yard.copy(mouth).addScaledVector(out, 3.2);
    this.yard.y = this.terrain.heightAt(this.yard.x, this.yard.z);
    this.player.copy(camera.position);
    this._wideShot(out);
    this.cut = false;
    this.toPlayer.subVectors(camera.position, mouth).setY(0).normalize();
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    const w = this.wraith;
    Object.assign(w.pose, { x: mouth.x, z: mouth.z, base: mouth.y, grow: 0, form: 0, opacity: 1, heading: Math.atan2(this.toPlayer.x, this.toPlayer.z) });
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  // the wide shot: out in the yard 4.5 m from where it will stand, looking back
  // at it (the shop behind); turned this way or that until nothing stands between
  private _wideShot(out: THREE.Vector3): void {
    const y = this.yard, base = Math.atan2(out.x, out.z);
    for (let i = 0; i < 13; i++) {
      const a = base + Math.ceil(i / 2) * 0.17 * (i % 2 ? 1 : -1);
      const x = y.x + Math.sin(a) * 4.5, z = y.z + Math.cos(a) * 4.5;
      let clear = !this.blocked(x, z, 0.5);
      for (let s = 0.8; clear && s < 4; s += 0.4) clear = !this.blocked(y.x + Math.sin(a) * s, y.z + Math.cos(a) * s, 0.3);
      if (clear || i === 12) { this.wide.set(x, this.terrain.heightAt(x, z), z); return; }
    }
  }

  private _once(name: string, fn: () => void): void { if (!this.cue.has(name)) { this.cue.add(name); fn(); } }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, w = this.wraith, P = w.pose;
    if (t >= T.knot && !this.ending) {
      this._once('knot', () => {
        w.show(true);
        this.events.emit(EV.SCENARIO_CUE, { cue: 'whirl', position: this.mouth });
      });
      // up out of the mouth, then off the porch into the yard, coming down to the ground as it grows
      const go = sstep(T.leave, T.yard, t);
      P.x = this.mouth.x + (this.yard.x - this.mouth.x) * go;
      P.z = this.mouth.z + (this.yard.z - this.mouth.z) * go;
      P.base = this.mouth.y + (this.yard.y - this.mouth.y) * go;
      P.grow = 0.3 * sstep(T.knot, T.leave, t) + 0.7 * go;
      P.form = sstep(T.gather, T.formed, t);
      // as it takes shape it turns to us (the camera in the yard) and glares
      const at = t < T.leave ? this.player : this.wide;
      P.heading = Math.atan2(at.x - P.x, at.z - P.z);
      if (t >= T.formed - 0.6) this._once('laugh', () => this.events.emit(EV.SCENARIO_CUE, { cue: 'laughDeep', position: w.headWorld(this.head) }));
      w.update(dt);
      if (t >= T.end) this.ending = 1e-6;
    }
    if (!this.ending) return;
    // dip to black, back to the player
    this.ending += dt;
    if (this.filming) {
      this.fade = Math.min(1, this.ending / 0.4);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.4) {
        this.filming = false;
        w.show(false);
        P.base = null;
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.5);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const t = this.t, w = this.wraith;
    const side = _side.set(this.toPlayer.z, 0, -this.toPlayer.x); // to one side of the line from the jar to the player
    if (t < T.leave) {
      // close by the jar, a little to the side, watching its mouth
      this.tPos.copy(this.mouth).addScaledVector(this.toPlayer, 1.25).addScaledVector(side, 0.35).addScaledVector(UP, 0.3);
      this.tLook.copy(this.mouth).addScaledVector(UP, 0.15 + 0.5 * sstep(T.knot, T.leave, t));
    } else {
      // out in the yard, watching it grow and take shape, rising a little with it
      if (!this.cut) { this.cut = true; this.snap = true; }
      this.tPos.copy(this.wide).addScaledVector(UP, 1.3 + 0.35 * sstep(T.leave, T.formed, t));
      w.headWorld(this.head);
      const centre = w.group.position;
      this.tLook.set(centre.x, centre.y + 1.2 * w.pose.grow, centre.z).lerp(this.head, sstep(T.gather, T.formed, t) * 0.6);
    }
    _m.lookAt(this.tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    if (this.snap) { this.snap = false; this.pos.copy(this.tPos); this.quat.copy(_q); this.fov = 55; }
    const k = 1 - Math.exp(-(t < 1 ? 3 : 4) * dt);
    this.pos.lerp(this.tPos, k);
    this.quat.slerp(_q, k);
    this.fov += (55 - this.fov) * k;
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}

const _side = new THREE.Vector3();
