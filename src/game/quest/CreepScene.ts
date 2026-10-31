import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Wraith } from '../scenario/Wraith.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// After the sky shot, in the same shot: the four friends at the fire, who
// know nothing, Amin playing his guitar. The camera slowly turns from them and draws in on the
// cabin's front corner behind them, while the sky starts turning red; two
// red eyes open there in the dark, peering round the corner, and the rest
// of the ghost glows out of the dark round them, half hidden by the wall. It
// slips out from behind the wall, and the camera draws back to show the
// friends and it behind them; it creeps up on them, stopping and starting,
// its arms rising, staring at us all the while, until it stands right behind
// them, its robe streaming wildly, the camera drawing in on it - and the
// guitar stops (Luna has been staring at it, silent, since the eyes opened).
// From there the next scene (`then`) carries on in the same shot; skipped,
// or without one, a dip to black, the sky turning back, and the player.
// Its sound: Amin's guitar all along, and over it from the moment the eyes
// open the ghost's recording (`ghost_appear`, the same as at the jar: its
// rising swell on the eyes, its deep part as it glows out of the dark, its
// second swell as it comes up behind them). Nothing else: no barking, no
// synthesized sounds.

interface DogLike { alertAt: THREE.Vector3 | null }

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** the scene's moments (seconds) */
const T = {
  look: 2.0, // the camera turns from the fire to the cabin's corner, drawing in...
  red: 3.5, // (the sky starts turning red, slowly)
  near: 6.5, // ...close on it
  eyes: 6.0, // two red eyes open there...
  body: 8.5, // ...and the rest of it glows out of the dark
  out: 11.0, // it slips out from behind the wall
  creep: 13.5, // it creeps up on them, stopping and starting...
  there: 20.4, // ...right behind them
  end: 23.5,
};
/** how long the sky takes to turn red (s) */
const RED = 7;
/** its creeping: [seconds, how far along] - moving, still, moving, still, moving */
const CREEP: [number, number][] = [[13.5, 0], [15.0, 0.3], [16.2, 0.3], [17.6, 0.65], [18.6, 0.65], [20.4, 1]];
/** the camera's field of view: as the sky shot left it, close on the corner, drawn back, at the end */
const FOV = { wide: 55, near: 18, mid: 40, close: 31 };
/** a little under its full size (its hood clear of the shelter's eaves over the fire) */
const SCALE = 0.95;
/**
 * where it waits, from the cabin's front corner along the line from the camera (m);
 * how much of it shows past the wall's edge (m); how far out it slips (m); its eyes above the ground (m)
 */
const HIDE = { back: 2.2, show: 0.06, out: 1.5, eyes: 2.0 };
/** the guitar stops (s) */
const HUSH = 21.0;
/** the part of the ghost's recording played from the eyes on: from, how long (s); how far in front of the camera it sounds (m) */
const SOUND = { from: 1.0, length: 28.8, near: 2.5 };

export class CreepScene {
  /** the film camera has the view */
  filming = false;
  /** the scene that carries on from the last frame (`skipped`: straight on behind the black) */
  then: ((skipped: boolean) => void) | null = null;
  private readonly wraith: Wraith;
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly guitar: (mode: 'auto' | 'on' | 'off') => void;
  private voice: VoiceHandle | null = null;
  private readonly sky: { redden(seconds?: number): void; calm(seconds?: number): void };
  private readonly ground: (x: number, z: number) => number;
  /** the cabin: what hides it until it peeks out */
  private readonly walls: THREE.Mesh[] = [];
  private readonly dog: () => DogLike | null;
  private readonly fire = new THREE.Vector3();
  private readonly corner = new THREE.Vector3();
  private readonly cabin = new THREE.Vector3();
  private readonly stop = new THREE.Vector3();
  private t = -1;
  private ending = 0;
  private fade = 0;
  private readonly cue = new Set<string>();
  private readonly shot = new THREE.Vector3();
  private readonly peek = new THREE.Vector3();
  private readonly out = new THREE.Vector3();
  private readonly alert = new THREE.Vector3();
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private snap = false;
  private fov: number = FOV.wide;
  private readonly tLook = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly mid = new THREE.Vector3();

  /**
   * `corner`: the cabin's front corner it peeks round (the side away from the
   * camera, toward `cabin`, its middle, hides it; `occluder`: the cabin's
   * model, whose logs stick out past the corner); `stop`: where it stops,
   * behind the friends; `sky`: turns the sky red and back (all world x / z);
   * `guitar`: Amin playing on, stopping, or as he likes
   */
  constructor({ wraith, events, voices, guitar, sky, ground, fire, corner, cabin, occluder, stop, dog }: {
    wraith: Wraith; events: EventBus<GameEvents>; voices: () => VoiceService | null; guitar: (mode: 'auto' | 'on' | 'off') => void;
    sky: { redden(seconds?: number): void; calm(seconds?: number): void };
    ground: (x: number, z: number) => number; fire: { x: number; z: number }; corner: { x: number; z: number };
    cabin: { x: number; z: number }; occluder: THREE.Object3D; stop: { x: number; z: number }; dog: () => DogLike | null;
  }) {
    occluder.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.walls.push(o as THREE.Mesh); });
    this.wraith = wraith;
    this.events = events;
    this.voices = voices;
    this.guitar = guitar;
    this.sky = sky;
    this.ground = ground;
    this.dog = dog;
    this.fire.set(fire.x, ground(fire.x, fire.z), fire.z);
    this.corner.set(corner.x, ground(corner.x, corner.z), corner.z);
    this.cabin.set(cabin.x, 0, cabin.z);
    this.stop.set(stop.x, 0, stop.z);
  }

  get active(): boolean { return this.t >= 0; }

  /**
   * from where `camera` is now (the end of the sky shot, at `shot`);
   * `skipped`: the scene before was skipped - straight on behind the black
   */
  start(camera: THREE.Camera, shot: THREE.Vector3, skipped = false): void {
    if (this.active) return;
    if (skipped && this.then) { this.then(true); return; }
    this.t = 0; this.cue.clear(); this.voice = null;
    this.ending = skipped ? 1e-6 : 0;
    this.fade = skipped ? 1 : 0;
    this.snap = skipped;
    this.shot.copy(shot);
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov = FOV.wide;
    // where it waits: behind the corner on the line from the camera, at the
    // wall's edge as the camera sees it, only its eyes and a little of it out;
    // then out, clear of the wall
    const d = _v.set(this.corner.x - shot.x, 0, this.corner.z - shot.z).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    if (side.x * (this.cabin.x - this.corner.x) + side.z * (this.cabin.z - this.corner.z) < 0) side.negate();
    this.peek.copy(this.corner).addScaledVector(d, HIDE.back);
    this.peek.addScaledVector(side, this._edge(shot, this.peek, side) - HIDE.show);
    this.out.copy(this.peek).addScaledVector(side, -HIDE.out);
    this.filming = true;
    this.guitar('on');
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  /** the ghost's recording, still playing, for the next scene to carry on with (and stop) */
  takeVoice(): VoiceHandle | null { const v = this.voice; this.voice = null; return v; }

  /** how far from `at`, along `side` (into the cabin), its eyes stop being seen from `from` */
  private _edge(from: THREE.Vector3, at: THREE.Vector3, side: THREE.Vector3): number {
    const eye = new THREE.Vector3();
    let s = 1;
    for (; s > -3; s -= 0.04) {
      eye.copy(at).addScaledVector(side, s);
      eye.y = this.ground(eye.x, eye.z) + HIDE.eyes;
      const far = from.distanceTo(eye);
      _ray.set(from, eye.sub(from).normalize());
      _ray.far = far;
      if (!_ray.intersectObjects(this.walls, false).length) break;
    }
    return s;
  }

  private _once(name: string, fn: () => void): void { if (!this.cue.has(name)) { this.cue.add(name); fn(); } }

  /** how far along from where it came out to where it stops (0..1) */
  private _creep(t: number): number {
    for (let i = 1; i < CREEP.length; i++) {
      const [t1, k1] = CREEP[i];
      if (t < t1) { const [t0, k0] = CREEP[i - 1]; return lerp(k0, k1, sstep(t0, t1, t)); }
    }
    return 1;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, w = this.wraith, P = w.pose;
    if (!this.ending) {
      if (t >= T.red) this._once('red', () => this.sky.redden(RED));
      if (t >= T.eyes) {
        this._once('eyes', () => {
          w.group.scale.setScalar(SCALE);
          Object.assign(P, { form: 1, grow: 1, base: null, lift: 0.1, opacity: 0, dim: 1 });
          w.show(true);
          // its sound, a little in front of us toward it
          const at = new THREE.Vector3().subVectors(this.peek, this.shot).setY(0).setLength(SOUND.near).add(this.shot);
          this.voice = this.voices()?.play('ghost_appear', at, { gain: 1, from: SOUND.from, length: SOUND.length }) ?? null;
        });
        // the eyes in the dark, then the rest of it round them
        P.opacity = sstep(T.eyes, T.eyes + 1.5, t);
        P.dim = 1 - sstep(T.body, T.out, t);
        // out from behind the wall, quickly, then up behind them by fits and starts
        const slip = sstep(T.out, T.out + 0.7, t), go = this._creep(t);
        P.x = lerp(lerp(this.peek.x, this.out.x, slip), this.stop.x, go);
        P.z = lerp(lerp(this.peek.z, this.out.z, slip), this.stop.z, go);
        // staring at us all the while; its arms rising as it comes; at the end its robe streams wildly
        P.heading = Math.atan2(this.shot.x - P.x, this.shot.z - P.z);
        P.arms = 0.15 + 0.85 * sstep(T.creep, T.there, t);
        P.wind = 0.7 + 1.0 * sstep(T.there, T.there + 1.5, t);
        // Luna feels it before anyone and stares at it; at the end the guitar stops
        const dog = this.dog();
        if (dog && t >= T.eyes + 0.8) dog.alertAt = w.headWorld(this.alert);
        if (t >= HUSH) this._once('hush', () => this.guitar('off'));
      }
      if (t >= T.end) {
        // on in the same shot (the ghost, the red sky, Luna's stare and the silence stay)
        if (this.then) { this.filming = false; this.t = -1; this.then(false); return; }
        this.ending = 1e-6;
      }
    }
    if (w.group.visible) w.update(dt);
    if (!this.ending) return;
    // dip to black, back to the player; the sky turns back behind the black
    this.ending += dt;
    if (this.filming) {
      this.fade = Math.max(this.fade, Math.min(1, this.ending / 0.5));
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.5) {
        this._close();
        if (this.then) { this.t = -1; this.then(true); return; }
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.6);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  private _close(): void {
    this.filming = false;
    this.voice?.stop();
    this.guitar('auto');
    this.sky.calm(1);
    const w = this.wraith;
    w.show(false);
    w.group.scale.setScalar(1);
    Object.assign(w.pose, { lift: 0.25, arms: 1, wind: 1, opacity: 1, dim: 0 });
    const dog = this.dog();
    if (dog) dog.alertAt = null;
  }

  // one shot from in front of the fire: turning from the friends to the
  // cabin's corner and drawing in on it; following it as it slips out; drawn
  // back to the friends and it behind them; at the end pushing in a little on it
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const t = this.t;
    const tPos = _v.copy(this.shot);
    const there = sstep(T.there - 1, T.end, t);
    tPos.lerp(this.mid.set(this.stop.x, this.ground(this.stop.x, this.stop.z) + 1.6, this.stop.z), 0.12 * there);
    // where it looks: the fire, then the corner where the eyes will be, then
    // after it as it comes out, then the friends and it, then on it
    this.tLook.set(this.fire.x, this.fire.y + 0.9, this.fire.z);
    this.head.set(this.peek.x, this.ground(this.peek.x, this.peek.z) + 1.95, this.peek.z);
    this.tLook.lerp(this.head, sstep(T.look, T.near, t));
    if (t >= T.out - 0.2) {
      this.wraith.headWorld(this.head);
      const mid = this.mid.set(this.fire.x, this.fire.y + 1.0, this.fire.z).lerp(this.head, 0.55);
      this.tLook.lerp(this.head, sstep(T.out - 0.2, T.out + 0.6, t)).lerp(mid, sstep(T.out + 0.4, T.creep, t) * (1 - there)).lerp(this.head, there * 0.7);
    }
    _m.lookAt(tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    const k = 1 - Math.exp(-3 * dt);
    if (this.snap) { this.snap = false; this.pos.copy(tPos); this.quat.copy(_q); }
    this.pos.lerp(tPos, k);
    this.quat.slerp(_q, k);
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    // drawing in, back, and in a little
    let fov = lerp(FOV.wide, FOV.near, sstep(T.look, T.near, t));
    fov = lerp(fov, FOV.mid, sstep(T.out + 0.3, T.creep, t));
    fov = lerp(fov, FOV.close, there);
    this.fov += (fov - this.fov) * Math.min(1, dt * 6);
    // back to the sky shot's once the screen is black
    if (this.ending && this.fade >= 1) this.fov = FOV.wide;
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
