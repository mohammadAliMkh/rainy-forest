import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Wraith } from '../scenario/Wraith.ts';
import type { LineUp } from '../people/LineUp.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// After the friends have lined up facing the ghost, in the same shot: it
// hangs there behind the fire, then begins to tremble - a shiver at first,
// harder and harder, its robe thrashing - until it tears apart: four ghosts
// slide out of it, sideways and toward the friends, flickering, the whole
// place shaking as in an earthquake (the camera), and each stops opposite one
// of them, staring at them. The friends watch it all along - the one ghost
// until it tears, then each their own - and flinch back half a step, hands
// up, as it tears. The camera draws back and widens to have all eight, then
// slowly closes in. Its sound: the tail of the ghost's recording that played
// before; from the split the same recording's swell that shook the ground at
// the jar underneath, and over it the laughter of its tearing (`ghost_split`).
// What follows carries on from its last frame (`then`, ChaseScene.ts); without
// it the scene ends with a dip to black, everyone back in their seats and the
// sky turning back.

interface DogLike { alertAt: THREE.Vector3 | null }

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** the scene's moments (seconds) */
const T = {
  tremble: 0.8, // it begins to tremble, harder and harder...
  split: 3.8, // ...and tears apart into four...
  apart: 5.4, // ...which stop, each opposite one of them
  end: 10,
};
/** the ghosts' places: how much nearer the friends than the one was; how far beside each friend (to the right) the camera sees its ghost (m) */
const SPREAD = { nearer: 0.6, side: 0.45 };
/** its trembling at its hardest: metres, radians */
const SHIVER = { move: 0.12, turn: 0.3 };
/** the earthquake as it tears (the camera): metres, radians at its strongest; how long it takes to die away (s) */
const SHAKE = { move: 0.11, turn: 0.035, fade: 2.6 };
/** the part of the tearing's recording played from the split: from, how long (s) */
const SOUND = { from: 0, length: 6.3 };
/** underneath it from the split: the ghost's own recording, its swell that shook the ground at the jar: from, how long (s), how loud */
const UNDER = { from: 11.0, length: 8.0, gain: 0.8 };
/** a little under their full size (their hoods clear of the shelter's eaves over the fire) */
const SCALE = 0.92;
/** the camera: how far back and up it draws (m), its field of view at its widest and at the end */
const CAM = { back: 0.6, up: 0.35, wide: 52, close: 45 };

export class SplitScene {
  /** the film camera has the view */
  filming = false;
  /** the scene that carries on from the last frame (`skipped`: straight on behind the black) */
  then: ((skipped: boolean) => void) | null = null;
  private readonly wraiths: Wraith[];
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly sky: { calm(seconds?: number): void };
  private readonly guitar: (mode: 'auto' | 'on' | 'off') => void;
  private readonly dog: () => DogLike | null;
  /** the friends left to right as the camera sees them (by name) */
  private readonly order: string[];
  private acts = new Map<string, LineUp>();
  private voice: VoiceHandle | null = null;
  private tail: VoiceHandle | null = null;
  private under: VoiceHandle | null = null;
  private t = -1;
  private ending = 0;
  private fade = 0;
  private readonly cue = new Set<string>();
  private readonly from = new THREE.Vector3(); // where the one was
  private heading0 = 0;
  private readonly places: THREE.Vector3[] = [];
  private readonly heads: THREE.Vector3[] = [];
  private readonly middle = new THREE.Vector3(); // of the four
  private readonly look = new THREE.Vector3(); // between them and the line of friends, at head height
  // film camera
  private readonly cam0 = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private fov0 = 42;
  private fov = 42;
  private snap = false;
  private readonly tLook = new THREE.Vector3();

  /** `wraiths`: the ghost (first) and three more like it; `order`: the friends left to right in the line */
  constructor({ wraiths, events, voices, sky, guitar, dog, order }: {
    wraiths: Wraith[]; events: EventBus<GameEvents>; voices: () => VoiceService | null;
    sky: { calm(seconds?: number): void }; guitar: (mode: 'auto' | 'on' | 'off') => void; dog: () => DogLike | null; order: string[];
  }) {
    this.wraiths = wraiths;
    this.events = events;
    this.voices = voices;
    this.sky = sky;
    this.guitar = guitar;
    this.dog = dog;
    this.order = order;
    for (let i = 0; i < wraiths.length; i++) { this.places.push(new THREE.Vector3()); this.heads.push(new THREE.Vector3()); }
  }

  get active(): boolean { return this.t >= 0; }

  /** the four ghosts' places once apart, left to right (world, on the ground; for the next scene) */
  placesNow(): THREE.Vector3[] { return this.places; }

  /** the recordings still playing (the laughter, the swell under it), for the next scene to carry on with (and stop) */
  takeVoices(): VoiceHandle[] { const v = [this.voice, this.under].filter((x): x is VoiceHandle => !!x); this.voice = this.under = null; return v; }

  /** the friends in the line, for the next scene to carry on with (and finish) */
  takeActs(): Map<string, LineUp> { const a = this.acts; this.acts = new Map(); return a; }

  /**
   * from where `camera` is now (the end of the line-up); `acts`: the friends
   * standing in the line (by name); `voice`: the recording still playing;
   * `skipped`: the scene before was skipped - straight on behind the black
   */
  start(camera: THREE.PerspectiveCamera, acts: Map<string, LineUp>, voice: VoiceHandle | null, skipped = false): void {
    if (this.active) return;
    if (skipped && this.then) { voice?.stop(); for (const a of acts.values()) a.finish(); this.then(true); return; }
    this.t = 0; this.cue.clear();
    this.acts = acts;
    this.tail = voice; this.voice = null;
    this.ending = skipped ? 1e-6 : 0;
    this.fade = skipped ? 1 : 0;
    this.snap = skipped;
    this.cam0.copy(camera.position);
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov0 = this.fov = camera.fov;
    this._plan();
    // all of them watch the one until it tears (the others' heads are where it is)
    this.wraiths[0].headWorld(this.heads[0]);
    for (const h of this.heads) h.copy(this.heads[0]);
    for (const a of this.acts.values()) a.target = this.heads[0];
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  /**
   * everything at once as this scene leaves it (the four ghosts each opposite
   * one of the friends, the friends staring each at their own, the camera's
   * last frame); `acts`: the friends standing in the line, for the next scene
   * to take: to start it straight away, while developing
   */
  setEnd(camera: THREE.PerspectiveCamera, acts: Map<string, LineUp>): void {
    this.acts = acts;
    this.cam0.copy(camera.position);
    this._plan();
    const W = this.wraiths, one = W[0];
    one.group.scale.setScalar(SCALE);
    for (let i = 0; i < W.length; i++) {
      const w = W[i], P = w.pose;
      if (i > 0) { w.group.scale.setScalar(SCALE); Object.assign(P, { ...one.pose }); w.show(true); }
      P.x = this.places[i].x; P.z = this.places[i].z;
      const a = acts.get(this.order[i]);
      if (a) P.heading = Math.atan2(a.spot.x - P.x, a.spot.y - P.z);
      Object.assign(P, { wind: 1.7, arms: 0.55, lift: 0.1, opacity: 1 });
      w.update(0);
      w.headWorld(this.heads[i]);
      if (a) a.target = this.heads[i];
    }
    camera.position.copy(this.back).lerp(this.middle.clone().setY(this.back.y), 0.08);
    camera.lookAt(this.look.setY(this.heads[0].y - 0.35));
    camera.fov = CAM.close;
    camera.updateProjectionMatrix();
  }

  // where the four will be, and where the camera draws back to
  private _plan(): void {
    const one = this.wraiths[0].pose;
    this.from.set(one.x, 0, one.z);
    this.heading0 = one.heading;
    // the camera draws back from it (and up)
    _v.set(this.cam0.x - this.from.x, 0, this.cam0.z - this.from.z).normalize();
    this.back.copy(this.cam0).addScaledVector(_v, CAM.back).addScaledVector(UP, CAM.up);
    // where the four will be: on a line across from the friends, a little nearer
    // them than the one was, each where the camera sees it just beside (over
    // the right shoulder of) the one it stares at
    const spots = this.order.map((k) => this.acts.get(k)?.spot ?? null);
    if (spots.every((s): s is THREE.Vector2 => !!s)) {
      const c = spots.reduce((a, s) => a.add(s), new THREE.Vector2()).multiplyScalar(1 / spots.length);
      const along = spots[spots.length - 1].clone().sub(spots[0]).normalize();
      const toward = new THREE.Vector2(c.x - this.from.x, c.y - this.from.z).normalize();
      const g0 = new THREE.Vector2(this.from.x, this.from.z).addScaledVector(toward, SPREAD.nearer);
      const eye = new THREE.Vector2(this.back.x, this.back.z);
      spots.forEach((s, i) => {
        // eye + d u = g0 + along v
        const d = s.clone().addScaledVector(along, SPREAD.side).sub(eye);
        const r = g0.clone().sub(eye);
        const u = (along.x * r.y - r.x * along.y) / (along.x * d.y - d.x * along.y);
        this.places[i].set(eye.x + d.x * u, 0, eye.y + d.y * u);
      });
      this.look.set(c.x, 0, c.y);

    } else {
      for (const p of this.places) p.copy(this.from);
      this.look.copy(this.from);
    }
    this.middle.set(0, 0, 0);
    for (const p of this.places) this.middle.add(p);
    this.middle.multiplyScalar(1 / this.places.length);
    this.look.lerp(this.middle, 0.6);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  private _once(name: string, fn: () => void): void { if (!this.cue.has(name)) { this.cue.add(name); fn(); } }

  /** how hard the earthquake shakes now (0..1): a rumble as it trembles, all at once as it tears, dying away */
  private get shaking(): number {
    const t = this.t;
    return Math.max(0.12 * sstep(T.split - 1.5, T.split, t), sstep(T.split - 0.05, T.split + 0.15, t)) * (1 - sstep(T.split + 0.6, T.split + SHAKE.fade, t));
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, W = this.wraiths;
    if (!this.ending) {
      // trembling, harder and harder until it tears; dying away once the four are apart
      const shiver = sstep(T.tremble, T.split, t) ** 1.6 * (1 - sstep(T.split + 0.4, T.apart + 0.8, t));
      if (t >= T.split) {
        this._once('split', () => {
          // the sound of its tearing: its own recording underneath (the quake swell, in place
          // of what was still playing), the laughter over it
          this.tail?.stop(); this.tail = null;
          const at = this.heads[0].clone();
          this.under = this.voices()?.play('ghost_appear', at, { gain: UNDER.gain, from: UNDER.from, length: UNDER.length }) ?? null;
          this.voice = this.voices()?.play('ghost_split', at, { gain: 1.1, from: SOUND.from, length: SOUND.length }) ?? null;
          const one = W[0];
          for (let i = 1; i < W.length; i++) {
            W[i].group.scale.setScalar(one.group.scale.x);
            Object.assign(W[i].pose, { ...one.pose });
            W[i].show(true);
          }
          // they flinch, and from now on each watches their own
          for (const a of this.acts.values()) a.flinch();
          this.order.forEach((k, i) => { const a = this.acts.get(k); if (a) a.target = this.heads[i]; });
        });
      }
      const apart = sstep(T.split, T.apart, t);
      for (let i = 0; i < W.length; i++) {
        const w = W[i], P = w.pose;
        if (i > 0 && t < T.split) continue;
        // out of the one, sideways and toward them (fast at first, settling)
        const k = 1 - (1 - apart) ** 2.2;
        const tx = lerp(this.from.x, this.places[i].x, k), tz = lerp(this.from.z, this.places[i].z, k);
        // each shivers on its own
        const n = (a: number) => Math.sin(t * (37 + i * 5) + a) * 0.6 + Math.sin(t * (23 + i * 3) + a * 2.3) * 0.4;
        P.x = tx + SHIVER.move * shiver * n(i * 1.7);
        P.z = tz + SHIVER.move * shiver * n(i * 2.9 + 1);
        const look = this.acts.get(this.order[i]);
        const face = look ? Math.atan2(look.spot.x - P.x, look.spot.y - P.z) : this.heading0;
        P.heading = lerp(this.heading0, face, apart) + SHIVER.turn * shiver * n(i * 0.7 + 2);
        P.wind = 1.7 + 1.6 * shiver;
        P.arms = 1 - 0.45 * apart;
        P.lift = 0.1 + 0.03 * Math.sin(t * 1.3 + i);
        // all four on top of each other would glow four times as bright: they come up as they part, flickering
        P.opacity = t < T.split ? 1 - 0.15 * shiver * (0.5 + 0.5 * Math.sin(t * 31)) : lerp(1 / W.length, 1, apart) * (1 - 0.25 * (1 - apart) * (0.5 + 0.5 * Math.sin(t * 27 + i * 2)));
        if (i === 0 && t < T.split) w.group.scale.setScalar(SCALE + (w.group.scale.x - SCALE) * Math.exp(-dt * 2));
        w.update(dt);
        w.headWorld(this.heads[i]);
      }
      const dog = this.dog();
      if (dog) dog.alertAt = this.heads[0];
      if (t >= T.end) {
        if (this.then) { this.filming = false; this.t = -1; this.then(false); return; }
        this.ending = 1e-6;
      }
      return;
    }
    // dip to black, back to the player; everyone back in their seats, the sky turning back
    for (const w of W) if (w.group.visible) w.update(dt);
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
    this.tail?.stop(); this.tail = null;
    this.under?.stop(); this.under = null;
    this.voice?.stop(); this.voice = null;
    for (const a of this.acts.values()) a.finish();
    this.acts.clear();
    this.guitar('auto');
    this.sky.calm(1);
    for (const w of this.wraiths) {
      w.show(false);
      w.group.scale.setScalar(1);
      Object.assign(w.pose, { lift: 0.25, arms: 1, wind: 1, opacity: 1, dim: 0 });
    }
    const dog = this.dog();
    if (dog) dog.alertAt = null;
  }

  // one shot from behind the line: drawing back and widening as it trembles,
  // to have the four of them and the four ghosts; the ground shaking as it
  // tears; then slowly closing in
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const t = this.t;
    const wide = sstep(T.tremble, T.split + 0.6, t);
    const close = sstep(T.apart + 0.5, T.end, t);
    const tPos = _v.copy(this.cam0).lerp(this.back, wide).lerp(this.middle.clone().setY(this.cam0.y), 0.08 * close);
    // on the one, then on all eight, at about head height
    this.tLook.copy(this.heads[0]).lerp(this.look.setY(this.heads[0].y - 0.35), sstep(T.split, T.apart, t));
    _m.lookAt(tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    if (this.snap) { this.snap = false; this.pos.copy(tPos); this.quat.copy(_q); }
    const k = 1 - Math.exp(-3 * dt);
    this.pos.lerp(tPos, k);
    this.quat.slerp(_q, k);
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    const q = this.shaking;
    if (q > 0) {
      const n = (a: number, b: number, c: number) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.1) * 0.2;
      camera.position.x += SHAKE.move * q * n(31, 47, 7.3);
      camera.position.y += SHAKE.move * q * n(37, 53, 5.9);
      camera.position.z += SHAKE.move * q * n(29, 43, 6.7);
      camera.rotateX(SHAKE.turn * q * n(23, 41, 4.3));
      camera.rotateZ(SHAKE.turn * q * n(19, 35, 3.7));
    }
    const fov = lerp(lerp(this.fov0, CAM.wide, wide), CAM.close, close);
    this.fov += (fov - this.fov) * Math.min(1, dt * 6);
    if (this.ending && this.fade >= 1) this.fov = 55;
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
