import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Wraith } from '../scenario/Wraith.ts';
import type { Gathering } from '../people/Gathering.ts';
import { LineUp } from '../people/LineUp.ts';
import type { LineUpRoute } from '../people/LineUp.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// After the ghost has crept up behind the friends, in the same shot: Luna
// has barked, the guitar has stopped. One by one they turn round in their
// seats and see it, with a start, and stare, frozen; then they jump up (Amin
// puts his guitar down against his stump) and hurry round the fire, glancing
// back at it, to stand side by side across the fire from it, facing it,
// hands half up, breathing hard - the sky still red. The camera draws back
// and widens to have them and it in the shot, then slowly closes in on it
// between their shoulders. The ghost's recording (handed on from the scene
// before) plays its last swell under it. From there the next scene (`then`)
// carries on in the same shot, with them still in the line; skipped, or
// without one, a dip to black, everyone back in their seats, the sky turning
// back.

interface DogLike { alertAt: THREE.Vector3 | null }

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** the scene's moments (seconds) */
const T = {
  widen: 0.5, // as the first gets up the camera draws back and widens...
  wide: 2.6, // ...to the whole line and it
  hold: 3.5, // once all of them stand in the line, this long on them (closing in on it)
  most: 12, // and at the very latest the scene ends here
};
/** the camera's field of view: as the scene before left it, wide, at the end */
const FOV = { wide: 50, close: 42 };
/** where the camera draws back to: behind the sky shot's place, a little higher (m) */
const BACK = { by: 1.0, up: 0.55 };

export class LineUpScene {
  /** the film camera has the view */
  filming = false;
  /** the scene that carries on from the last frame (`skipped`: straight on behind the black) */
  then: ((skipped: boolean) => void) | null = null;
  private readonly wraith: Wraith;
  private readonly events: EventBus<GameEvents>;
  private readonly gathering: Gathering;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly sky: { calm(seconds?: number): void };
  private readonly guitar: (mode: 'auto' | 'on' | 'off') => void;
  private readonly dog: () => DogLike | null;
  private readonly routes: Record<string, LineUpRoute & { notice: number }>;
  private readonly fire = new THREE.Vector3();
  private readonly acts = new Map<string, LineUp>();
  private voice: VoiceHandle | null = null;
  private t = -1;
  private ending = 0;
  private fade = 0;
  private linedAt = -1;
  /** the ghost's head (what they all stare at) */
  private readonly head = new THREE.Vector3();
  private readonly middle = new THREE.Vector3(); // of the line
  // film camera
  private readonly from = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private fov0 = 31;
  private fov = 31;
  private snap = false;
  private readonly tLook = new THREE.Vector3();

  /** `routes`: where each of the friends stands in the line and how they go there (by name) */
  constructor({ wraith, events, gathering, terrain, sky, guitar, dog, fire, routes }: {
    wraith: Wraith; events: EventBus<GameEvents>; gathering: Gathering; terrain: { heightAt(x: number, z: number): number };
    sky: { calm(seconds?: number): void }; guitar: (mode: 'auto' | 'on' | 'off') => void; dog: () => DogLike | null;
    fire: { x: number; z: number }; routes: Record<string, LineUpRoute & { notice: number }>;
  }) {
    this.wraith = wraith;
    this.events = events;
    this.gathering = gathering;
    this.terrain = terrain;
    this.sky = sky;
    this.guitar = guitar;
    this.dog = dog;
    this.routes = routes;
    this.fire.set(fire.x, terrain.heightAt(fire.x, fire.z), fire.z);
    const spots = Object.values(routes);
    for (const r of spots) this.middle.x += r.spot[0] / spots.length, this.middle.z += r.spot[1] / spots.length;
    this.middle.y = terrain.heightAt(this.middle.x, this.middle.z) + 1.5;
  }

  get active(): boolean { return this.t >= 0; }

  /**
   * everything at once as this scene leaves it (the friends standing in the
   * line, the ghost turned to them, the camera's last frame), from where the
   * scene before left things; returns the friends' acts for the next scene:
   * to start it straight away, while developing
   */
  setEnd(camera: THREE.PerspectiveCamera, shot: THREE.Vector3): Map<string, LineUp> {
    const w = this.wraith, P = w.pose;
    P.heading = Math.atan2(this.middle.x - P.x, this.middle.z - P.z);
    w.update(0);
    w.headWorld(this.head);
    const acts = this.standing();
    _v.set(shot.x - this.fire.x, 0, shot.z - this.fire.z).normalize();
    camera.position.copy(shot).addScaledVector(_v, BACK.by).addScaledVector(UP, BACK.up);
    camera.lookAt(this.tLook.copy(this.head).lerp(this.middle, 0.45 * 0.4));
    camera.fov = FOV.close;
    camera.updateProjectionMatrix();
    return acts;
  }

  /** the friends at once standing in their places in the line, staring at the ghost (by name; each is the gathering's act for them) */
  standing(): Map<string, LineUp> {
    const acts = new Map<string, LineUp>();
    for (const [key, r] of Object.entries(this.routes)) {
      const p = this.gathering.byName(key);
      if (!p) continue;
      const s = p.seat;
      const act = new LineUp(p.h, { x: s.x, y: s.y, z: s.z, facing: s.facing, lean: p.baseLean }, r, this.terrain, this.head);
      act.standInLine();
      acts.set(key, act);
      p.act = act;
    }
    return acts;
  }

  /** the ghost's recording, still playing, for the next scene to carry on with (and stop) */
  takeVoice(): VoiceHandle | null { const v = this.voice; this.voice = null; return v; }

  /** the friends standing in the line (by name), for the next scene to carry on with (and finish) */
  takeActs(): Map<string, LineUp> { const a = new Map(this.acts); this.acts.clear(); return a; }

  /**
   * from where `camera` is now (the end of the creeping scene; `shot`: the
   * sky shot's place); `voice`: the ghost's recording, still playing;
   * `skipped`: the scene before was skipped - straight on behind the black
   */
  start(camera: THREE.PerspectiveCamera, shot: THREE.Vector3, voice: VoiceHandle | null, skipped = false): void {
    if (this.active) return;
    if (skipped && this.then) { voice?.stop(); this.then(true); return; }
    this.t = 0; this.linedAt = -1; this.acts.clear();
    this.voice = voice;
    this.ending = skipped ? 1e-6 : 0;
    this.fade = skipped ? 1 : 0;
    this.snap = skipped;
    this.from.copy(camera.position);
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov0 = this.fov = camera.fov;
    _v.set(shot.x - this.fire.x, 0, shot.z - this.fire.z).normalize();
    this.back.copy(shot).addScaledVector(_v, BACK.by).addScaledVector(UP, BACK.up);
    this.wraith.headWorld(this.head);
    this.filming = true;
    this.guitar('off');
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, w = this.wraith, P = w.pose;
    if (w.group.visible) {
      // it hangs there behind the fire, robe streaming, turned to them
      const turn = Math.atan2(this.middle.x - P.x, this.middle.z - P.z) - P.heading;
      P.heading += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 0.8);
      P.lift = 0.1 + 0.03 * Math.sin(t * 1.3);
      w.update(dt);
      w.headWorld(this.head);
      const dog = this.dog();
      if (dog) dog.alertAt = this.head;
    }
    if (!this.ending) {
      // one by one they turn round and see it
      for (const [key, r] of Object.entries(this.routes)) {
        if (this.acts.has(key) || t < r.notice) continue;
        const p = this.gathering.byName(key);
        if (!p) continue;
        const s = p.seat;
        const act = new LineUp(p.h, { x: s.x, y: s.y, z: s.z, facing: s.facing, lean: p.baseLean }, r, this.terrain, this.head);
        this.acts.set(key, act);
        p.act = act;
      }
      if (this.linedAt < 0 && this.acts.size && [...this.acts.values()].every((a) => a.lined)) this.linedAt = t;
      if ((this.linedAt >= 0 && t >= this.linedAt + T.hold) || t >= T.most) {
        if (this.then) { this.filming = false; this.t = -1; this.then(false); return; }
        this.ending = 1e-6;
      }
      return;
    }
    // dip to black, back to the player; everyone back in their seats, the sky turning back
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
    this.voice = null;
    for (const a of this.acts.values()) a.finish();
    this.acts.clear();
    this.guitar('auto');
    this.sky.calm(1);
    const w = this.wraith;
    w.show(false);
    w.group.scale.setScalar(1);
    Object.assign(w.pose, { lift: 0.25, arms: 1, wind: 1, opacity: 1, dim: 0 });
    const dog = this.dog();
    if (dog) dog.alertAt = null;
  }

  // one shot: from where the scene before left it (close on the ghost), drawing
  // back and widening as they get up, to the line of them and it beyond the
  // fire; then slowly closing in on it between their shoulders
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const t = this.t;
    const wide = sstep(T.widen, T.wide, t);
    const close = this.linedAt >= 0 ? sstep(this.linedAt, this.linedAt + T.hold, t) : 0;
    const tPos = _v.copy(this.from).lerp(this.back, wide);
    // on it; then between them and it; then nearer it again
    this.tLook.copy(this.head).lerp(this.middle, wide * 0.45 * (1 - close * 0.6));
    _m.lookAt(tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    if (this.snap) { this.snap = false; this.pos.copy(tPos); this.quat.copy(_q); }
    const k = 1 - Math.exp(-3 * dt);
    this.pos.lerp(tPos, k);
    this.quat.slerp(_q, k);
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    const fov = lerp(lerp(this.fov0, FOV.wide, wide), FOV.close, close);
    this.fov += (fov - this.fov) * Math.min(1, dt * 6);
    // back to the sky shot's once the screen is black
    if (this.ending && this.fade >= 1) this.fov = 55;
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
