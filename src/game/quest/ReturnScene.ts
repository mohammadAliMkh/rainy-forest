import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { ChaseScene } from './ChaseScene.ts';

// The last of the four is free: a dip to black, and at the fire they come back
// one after another, each out of the woods from their own side, and sit down
// in their own seats. Then back to the player, where they were.

const UP = new THREE.Vector3(0, 1, 0);

/** the dips to black and back (s); how long it holds once they all sit; the longest it can last (s) */
const TIME = { dip: 0.6, back: 0.8, hold: 1.8, most: 24 };
/** the camera: how far from the fire, how high, at first and by the end (m); field of view */
const CAM = { far: [8.4, 6.4], up: [3, 2.1], fov: 58 };
/** a warm light high over the fire, so they can be seen coming out of the dark: how high (m), how bright */
const LIGHT = { up: 5, by: 40 };

const sstep = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export class ReturnScene {
  /** the film camera has the view */
  filming = false;
  private readonly events: EventBus<GameEvents>;
  private readonly chase: ChaseScene;
  private readonly guitar: (mode: 'auto' | 'on' | 'off') => void;
  private readonly fire: { x: number; z: number };
  private readonly shot: () => THREE.Vector3;
  private readonly ground: (x: number, z: number) => number;
  private readonly leads: Record<string, number>;
  private t = -1;
  private time = 0;
  private cut = false;
  private seatedAt = -1;
  private ending = -1;
  private fade = 0;
  private readonly pos0 = new THREE.Vector3();
  private readonly quat0 = new THREE.Quaternion();
  private fov0 = 55;
  private held = false;
  private readonly look = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly lamp = new THREE.Vector3();

  /** `shot`: the usual place to see the fire from; `leads`: how far from their seat each comes into the film (m, by name) */
  constructor({ events, chase, guitar, fire, shot, ground, leads }: {
    events: EventBus<GameEvents>; chase: ChaseScene; guitar: (mode: 'auto' | 'on' | 'off') => void;
    fire: { x: number; z: number }; shot: () => THREE.Vector3; ground: (x: number, z: number) => number; leads: Record<string, number>;
  }) {
    this.events = events;
    this.chase = chase;
    this.guitar = guitar;
    this.fire = fire;
    this.shot = shot;
    this.ground = ground;
    this.leads = leads;
  }

  get active(): boolean { return this.t >= 0; }

  start(): void {
    if (this.active) return;
    this.t = 0; this.time = 0;
    this.cut = false; this.seatedAt = -1; this.ending = -1; this.fade = 0; this.held = false;
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  /** cut it short: everyone sat down */
  skip(): void {
    if (!this.filming) return;
    if (this.ending < 0) this.ending = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (this.filming && this.ending < 0) {
      if (!this.cut) {
        // to black, then the fire
        this.fade = Math.min(1, this.t / TIME.dip);
        this.events.emit(EV.INTRO_FADE, this.fade);
        if (this.t >= TIME.dip) {
          this.cut = true; this.time = 0;
          this.chase.comeBack(this.leads);
          this.chase.flood = this.lamp.set(this.fire.x, this.ground(this.fire.x, this.fire.z) + LIGHT.up, this.fire.z);
          this.chase.floodBy = LIGHT.by;
        }
        return;
      }
      this.time += dt;
      this.fade = Math.max(0, 1 - this.time / TIME.back);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.seatedAt < 0 && this.chase.allSeated) this.seatedAt = this.time;
      if ((this.seatedAt >= 0 && this.time >= this.seatedAt + TIME.hold) || this.time >= TIME.most) this.ending = 0;
      return;
    }
    if (this.filming) {
      // to black; everyone in their seat; back to the player
      this.ending += dt;
      this.fade = Math.max(this.fade, Math.min(1, this.ending / TIME.dip));
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= TIME.dip) {
        if (!this.cut) { this.cut = true; this.chase.comeBack(this.leads); }
        this.chase.seatAll();
        this.chase.flood = null;
        this.guitar('auto');
        this.filming = false;
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
      return;
    }
    this.fade = Math.max(0, this.fade - dt / TIME.back);
    this.events.emit(EV.INTRO_FADE, this.fade);
    if (this.fade <= 0) this.t = -1;
  }

  applyCamera(camera: THREE.PerspectiveCamera): void {
    if (!this.filming) {
      if (this.held) { this.held = false; camera.fov = this.fov0; camera.updateProjectionMatrix(); }
      return;
    }
    if (!this.held) { this.held = true; this.pos0.copy(camera.position); this.quat0.copy(camera.quaternion); this.fov0 = camera.fov; }
    if (!this.cut) {
      camera.position.copy(this.pos0);
      camera.quaternion.copy(this.quat0);
      return;
    }
    // over the fire, drawing slowly in
    const k = sstep(this.time / 15), s = this.shot();
    this.dir.set(s.x - this.fire.x, 0, s.z - this.fire.z).normalize();
    const far = CAM.far[0] + (CAM.far[1] - CAM.far[0]) * k, up = CAM.up[0] + (CAM.up[1] - CAM.up[0]) * k;
    this.look.set(this.fire.x, this.ground(this.fire.x, this.fire.z), this.fire.z);
    camera.position.copy(this.look).addScaledVector(this.dir, far).addScaledVector(UP, up);
    this.look.y += 0.8;
    camera.lookAt(this.look);
    if (camera.fov !== CAM.fov) { camera.fov = CAM.fov; camera.updateProjectionMatrix(); }
  }
}
