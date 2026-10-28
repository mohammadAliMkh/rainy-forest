import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Ghost } from '../scenario/Ghost.ts';
import { teaGlass } from '../people/Human.js';

// The twist after the end of «سناریوی روح سرگردان»: a wide shot of the
// fire from the trail - and in the empty gap of the ring sits the ghost
// (the friendly white one, see-through), a glass of tea in hand, waving at
// the camera while the friends notice nothing. "...or maybe not 👻". A dip
// to black and the view is yours again (`onEnd` then lifts the night).

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
/** where it sits, from the fire (x, z) */
export const TWIST_SEAT = { dx: -1.35, dz: 1.25 };
export const TWIST_TEXT = '...یا شاید هم نه 👻';
const LENGTH = 4.2;

export class TwistScene {
  /** the film camera has the view */
  filming = false;
  private readonly ghost: Ghost;
  private readonly events: EventBus<GameEvents>;
  private readonly glass: THREE.Group;
  private readonly seat = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private t = -1;
  private ending = 0;
  private fade = 0;
  private onEnd: (() => void) | null = null;

  /** `trail`: the trail's points, ending at the fire */
  constructor({ ghost, terrain, events, shared, fire, trail }: {
    ghost: Ghost; terrain: { heightAt(x: number, z: number): number }; events: EventBus<GameEvents>;
    shared: { glass: THREE.Material; tea: THREE.Material }; fire: { x: number; z: number }; trail: ArrayLike<number>[];
  }) {
    this.ghost = ghost;
    this.events = events;
    // its tea, held up in front where a hand would be
    this.glass = teaGlass(shared);
    this.glass.scale.setScalar(2.4);
    this.glass.position.set(0.36, 0.92, 0.38);
    this.glass.visible = false;
    ghost.group.add(this.glass);
    const sx = fire.x + TWIST_SEAT.dx, sz = fire.z + TWIST_SEAT.dz;
    this.seat.set(sx, terrain.heightAt(sx, sz), sz);
    // from the trail side, a little above eye level: 5 m back toward where
    // the trail is 7 m from the seat (the open way in, no bushes in between)
    let tx = trail[0][0], tz = trail[0][1];
    for (let i = trail.length - 1; i >= 0; i--) {
      if (Math.hypot(trail[i][0] - sx, trail[i][1] - sz) > 7) { tx = trail[i][0]; tz = trail[i][1]; break; }
    }
    const dir = new THREE.Vector2(tx - sx, tz - sz).normalize();
    const cx = sx + dir.x * 5, cz = sz + dir.y * 5;
    this.camPos.set(cx, terrain.heightAt(cx, cz) + 2.6, cz);
    this.lookAt.copy(this.seat).addScaledVector(UP, 0.75);
  }

  get active(): boolean { return this.t >= 0; }

  start(onEnd: () => void): void {
    if (this.active) return;
    this.onEnd = onEnd;
    this.t = 0;
    this.ending = 0;
    const g = this.ghost;
    g.setStyle('funny');
    Object.assign(g.pose, {
      x: this.seat.x, z: this.seat.z, heading: Math.atan2(this.camPos.x - this.seat.x, this.camPos.z - this.seat.z),
      lift: -0.08, lean: -0.05, tilt: 0, arms: 0.3, puff: 0, opacity: 0.72, face: 'happy',
    });
    g.group.scale.setScalar(0.8); // sitting down, about as tall as the friends on their logs
    this.glass.visible = true;
    g.show(true);
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
    this.events.emit(EV.BANNER, { text: TWIST_TEXT, kind: 'title', seconds: 3 });
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const g = this.ghost, P = g.pose, t = this.t;
    if (this.filming) {
      // waving: its arms up and down under the sheet, a happy little sway
      P.arms = 0.5 + 0.45 * Math.sin(t * 7);
      P.tilt = Math.sin(t * 3.5) * 0.08;
      P.lift = -0.08 + Math.abs(Math.sin(t * 3.5)) * 0.03;
      this.glass.position.y = 0.92 + P.arms * 0.12;
      g.update(dt);
      if (t > LENGTH && !this.ending) this.ending = 1e-6;
    }
    if (!this.ending) return;
    this.ending += dt;
    if (this.filming) {
      // dip to black; the ghost is gone and the view is yours again
      this.fade = Math.min(1, this.ending / 0.4);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.4) {
        this.filming = false;
        g.show(false);
        g.group.scale.setScalar(1);
        this.glass.visible = false;
        this.events.emit(EV.INTRO_CINEMATIC, false);
        this.onEnd?.();
        this.onEnd = null;
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.5);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  // one still, wide shot
  applyCamera(camera: THREE.PerspectiveCamera): void {
    if (!this.filming) return;
    const look = _m.lookAt(this.camPos, this.lookAt, UP);
    camera.position.copy(this.camPos);
    camera.quaternion.copy(_q.setFromRotationMatrix(look));
    if (Math.abs(camera.fov - 42) > 0.01) { camera.fov = 42; camera.updateProjectionMatrix(); }
  }
}
