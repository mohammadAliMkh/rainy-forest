import * as THREE from 'three';
import type { Human } from './Human.js';
import { damp, clamp } from '../../utils/noise.js';
import type { SeatPose } from './Flight.ts';

// Someone at the fire getting up to talk to the player face to face: they
// stand, turn to whoever came up, talk with their free hand (the other
// keeps the tea glass), can point the way somewhere, and sit back down.
// Drives the same rig the gathering uses; while it runs the gathering
// leaves that person alone (Gathering checks `act`).

const UP = new THREE.Vector3(0, 1, 0);
type Rig = Human & { voiceLevel: number | null };
type Euler3 = [number, number, number];
type Phase = 'up' | 'talk' | 'down' | 'done';

const ease = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class StandTalk {
  phase: Phase = 'up';
  /** talking now (the scene sets it while the line plays) */
  speaking = false;
  /** a recording's loudness drives the lips instead (0..1), or null */
  voice: (() => number) | null = null;
  /** where to point (world), and how far along the gesture is (0..1, set by the scene) */
  pointAt: THREE.Vector3 | null = null;
  point = 0;
  private readonly h: Rig;
  private readonly seat: SeatPose;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly seatedLegs: Euler3[][];
  private readonly standH: number;
  private readonly front: THREE.Vector2;
  private t = 0; private time = 0;
  private stand = 0;
  private x: number; private z: number; private heading: number;
  private headYaw = 0; private headPitch = 0;
  private gest = 0;
  private readonly hand = [new THREE.Vector3(), new THREE.Vector3()];
  private handsSet = false;

  constructor(h: Human, seat: SeatPose, terrain: { heightAt(x: number, z: number): number }) {
    this.h = h as Rig;
    this.seat = seat;
    this.terrain = terrain;
    this.x = seat.x; this.z = seat.z; this.heading = seat.facing;
    this.front = new THREE.Vector2(seat.x + Math.sin(seat.facing) * 0.4, seat.z + Math.cos(seat.facing) * 0.4);
    this.seatedLegs = h.legs.map((L) => [L.hip, L.knee, L.ankle].map((j) => [j.rotation.x, j.rotation.y, j.rotation.z] as Euler3));
    // the pelvis height standing: straighten the legs for a moment and measure
    for (const L of h.legs) for (const j of [L.hip, L.knee, L.ankle]) j.rotation.set(0, 0, 0);
    h.root.updateMatrixWorld(true);
    this.standH = h.root.position.y - h.legs[0].ankle.getWorldPosition(new THREE.Vector3()).y + 0.085 * h.root.scale.x;
    this._legs(0);
  }

  get done(): boolean { return this.phase === 'done'; }
  /** on their feet and turned to the listener */
  get ready(): boolean { return this.phase === 'talk' && this.t > 0.3; }

  /** sit back down */
  sitDown(): void { if (this.phase === 'up' || this.phase === 'talk') { this.phase = 'down'; this.t = 0; } }

  /** at once back on the seat (when the scene is cut short) */
  finish(): void { this.phase = 'done'; this._restore(); }

  private _legs(stand: number): void {
    this.h.legs.forEach((L, i) => {
      // standing: knees just soft, a little weight shift
      const sway = Math.sin(this.time * 0.8) * 0.04 * (i === 0 ? 1 : -1);
      const target: Euler3[] = [[-0.04 + sway, 0, 0], [0.08 + Math.max(0, sway) * 1.5, 0, 0], [-0.03, 0, 0]];
      [L.hip, L.knee, L.ankle].forEach((j, k) => {
        const s = this.seatedLegs[i][k], tg = target[k];
        j.rotation.set(s[0] + (tg[0] - s[0]) * stand, s[1] + (tg[1] - s[1]) * stand, s[2] + (tg[2] - s[2]) * stand);
      });
    });
  }

  /** `look`: the listener's eye (world) */
  update(dt: number, look: THREE.Vector3): void {
    const h = this.h;
    this.t += dt; this.time += dt;
    const toward = Math.atan2(look.x - this.front.x, look.z - this.front.y);
    if (this.phase === 'up') {
      const k = ease(this.t / 0.9);
      this.stand = k;
      this.x = this.seat.x + (this.front.x - this.seat.x) * k;
      this.z = this.seat.z + (this.front.y - this.seat.z) * k;
      this.heading = lerpAngle(this.seat.facing, toward, ease((this.t - 0.3) / 0.9));
      if (this.t >= 1.2) { this.phase = 'talk'; this.t = 0; }
    } else if (this.phase === 'talk') {
      this.heading = lerpAngle(this.heading, toward, 1 - Math.exp(-4 * dt));
    } else if (this.phase === 'down') {
      const k = ease(this.t / 1.0);
      this.heading = lerpAngle(this.heading, this.seat.facing, Math.min(1, dt * 5));
      this.stand = 1 - k;
      this.x = this.front.x + (this.seat.x - this.front.x) * k;
      this.z = this.front.y + (this.seat.z - this.front.y) * k;
      if (this.t >= 1.0) { this.phase = 'done'; this._restore(); return; }
    } else return;

    const stand = this.stand;
    this._legs(stand);
    const ground = this.terrain.heightAt(this.x, this.z);
    h.root.position.set(this.x, this.seat.y + (ground + this.standH - 0.02 - this.seat.y) * stand, this.z);
    h.root.rotation.y = this.heading;
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    // upright, breathing, a little nod with the words
    const talking = this.speaking && this.phase === 'talk';
    const words = talking ? Math.sin(this.time * 5.3) * 0.025 + Math.sin(this.time * 2.1) * 0.02 : 0;
    h.spine.rotation.set(this.seat.lean * (1 - stand) + stand * (0.03 + Math.sin(this.time * 1.4) * 0.01), 0, Math.sin(this.time * 0.7) * 0.015 * stand, 'YXZ');
    // eyes on the listener (or where he points, for a moment)
    h.root.updateMatrixWorld(true);
    const head = h.headPivot.getWorldPosition(new THREE.Vector3());
    const target = this.pointAt && this.point > 0.3 && this.point < 0.75 ? this.pointAt : look;
    const to = target.clone().sub(head);
    const fd = to.dot(fwd), rd = to.dot(right);
    this.headYaw = damp(this.headYaw, clamp(Math.atan2(-rd, fd), -1.3, 1.3), 6, dt);
    this.headPitch = damp(this.headPitch, clamp(Math.atan2(to.y, Math.hypot(fd, rd)), -0.5, 0.5), 6, dt);
    h.neck.rotation.set(-this.headPitch * 0.35, this.headYaw * 0.4, 0, 'YXZ');
    h.headPivot.rotation.set(-this.headPitch * 0.65 + words, this.headYaw * 0.6, Math.sin(this.time * 0.9) * 0.03, 'YXZ');
    h.root.updateMatrixWorld(true);
    // hands: the glass hand (right) low in front, the other talking - or pointing the way
    this.gest = damp(this.gest, talking ? 1 : 0, 3, dt);
    for (let i = 0; i < 2; i++) {
      const A = h.arms[i];
      const out = right.clone().multiplyScalar(i === 0 ? 1 : -1);
      const sh = A.shoulder.getWorldPosition(new THREE.Vector3());
      const reach = (A.upperLen + A.foreLen) * h.root.scale.x;
      let tg: THREE.Vector3, thumb: THREE.Vector3, fingers: THREE.Vector3, pole: THREE.Vector3;
      const seatedRest = sh.clone().addScaledVector(UP, -reach * 0.6).addScaledVector(fwd, 0.28).addScaledVector(out, -0.05);
      const low = sh.clone().addScaledVector(UP, -reach * 0.78).addScaledVector(fwd, 0.22).addScaledVector(out, 0.02);
      if (i === 0 || !talking && this.point < 0.01) {
        tg = seatedRest.lerp(low, stand);
        thumb = UP.clone(); fingers = fwd.clone().addScaledVector(out, -0.5).normalize();
        pole = out.clone().multiplyScalar(0.7).addScaledVector(UP, -0.6).addScaledVector(fwd, -0.3).normalize();
      } else {
        // talking: the hand comes up in front of the chest, opening and turning with the words
        const w = this.time;
        const gest = sh.clone().addScaledVector(UP, -0.22 + Math.sin(w * 2.3) * 0.05).addScaledVector(fwd, 0.32 + Math.sin(w * 1.7) * 0.04).addScaledVector(out, -0.08 + Math.sin(w * 1.3 + 1) * 0.07);
        tg = low.lerp(gest, this.gest);
        thumb = UP.clone().addScaledVector(out, 0.3).normalize();
        fingers = fwd.clone().addScaledVector(UP, 0.4 + Math.sin(w * 2.9) * 0.2).normalize();
        pole = out.clone().multiplyScalar(0.7).addScaledVector(UP, -0.7).normalize();
        if (this.pointAt && this.point > 0) {
          // "go that way": the arm out toward it, index first
          const dir = this.pointAt.clone().sub(sh).setY(0).normalize().addScaledVector(UP, 0.12).normalize();
          const p = ease(Math.min(1, this.point * 3) * Math.min(1, (1 - this.point) * 4));
          tg = tg.clone().lerp(sh.clone().addScaledVector(dir, reach * 0.95), p);
          thumb = thumb.lerp(UP.clone(), p).normalize();
          fingers = fingers.lerp(dir, p).normalize();
          pole = pole.lerp(UP.clone().negate().addScaledVector(out, 0.3), p).normalize();
        }
      }
      if (!this.handsSet) this.hand[i].copy(tg);
      this.hand[i].lerp(tg, 1 - Math.exp(-10 * dt));
      h.reach(i, this.hand[i], pole, thumb, fingers);
    }
    this.handsSet = true;
    h.setHandOpen(1, talking);
    h.voiceLevel = talking && this.voice ? Math.min(1, this.voice() * 1.4) : null;
    h.talk = talking && !this.voice ? 1 : 0;
  }

  private _restore(): void {
    const h = this.h;
    h.root.position.set(this.seat.x, this.seat.y, this.seat.z);
    h.root.rotation.y = this.seat.facing;
    this._legs(0);
    h.spine.rotation.set(this.seat.lean, 0, 0);
    h.voiceLevel = null;
    h.talk = 0;
    h.setHandOpen(1, false);
  }
}
