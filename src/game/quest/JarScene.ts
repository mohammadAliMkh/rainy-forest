import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Wraith } from '../scenario/Wraith.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// The pickle jar opened: a film scene, from the moment the lid comes off, in
// one shot on the porch - the camera further along it, past the shop's door,
// looking at the jar. The lid flies off; a small knot of pale light spins up
// out of the jar's mouth, grows into a whirlwind that settles onto the
// boards in front of the jar, and gathers itself into the ghost, which turns
// and glares (a little smaller than out in the open, under the porch roof).
// Then the recording swells a second time: the ground shakes (the camera
// only), the ghost rises a little with its robe streaming, and the sky and
// all the light turn red (`sky.redden`). Once the ground is still it turns
// away and glides off the porch toward the woods, faster and fainter the
// further it goes, until it is gone among the trees; as it fades the sky
// goes back to the night's own colour (`sky.calm`), and the camera, turning
// to follow it, is left looking into the dark woods. A dip to black, and
// back to the player.
// Its sound is a recording (`ghost_appear`), and the timings follow it: a
// rising swell, a deep heavy part, a second swell (the shaking), a lull (it
// turns away), a third swell (it goes).

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the scene's moments (seconds), set to the recording */
const T = {
  knot: 0.3, // the knot appears in the mouth (the sound starts)
  settle: 1.8, // it comes down onto the boards in front of the jar...
  full: 3.2, // ...a full whirlwind
  gather: 3.5, // it gathers into the ghost (the deep part of the sound)...
  formed: 6.0, // ...which turns and glares
  glared: 9.8,
  quake: 10.0, // the second swell: the shaking starts and the sky turns red...
  peak: 12.0, // ...at its strongest...
  calm: 14.5, // ...until the swell passes
  still: 17.0,
  turn: 17.4, // it turns toward the woods...
  leave: 18.2, // ...and glides off the porch, faster and faster (the third swell)...
  gone: 27.5, // ...fading as it goes, gone among the trees
  end: 28.6,
};
/** the part of the recording that is played: from, how long */
const SOUND = { from: 1.0, length: 28.8 };
/** the sky back to the night's own colour while it goes: from, how long (s) */
const CALM = { at: 19.0, seconds: 8.5 };
/** the shaking at its strongest: metres, radians */
const SHAKE = { move: 0.05, turn: 0.014 };
/** a little smaller than its full size, under the porch roof */
const SCALE = 0.88;

export class JarScene {
  /** the film camera has the view */
  filming = false;
  private readonly wraith: Wraith;
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly sky: { redden(): void; calm(seconds?: number): void };
  private readonly ground: (x: number, z: number) => number;
  private t = -1;
  private ending = 0;
  private fade = 0;
  private voice: VoiceHandle | null = null;
  private readonly cue = new Set<string>();
  private readonly mouth = new THREE.Vector3();
  private readonly stand = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly woods = new THREE.Vector3();
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private snap = false;
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private readonly head = new THREE.Vector3();

  /** `sky`: turns the sky and the light red, and back; `ground`: the ground's height */
  constructor({ wraith, events, voices, sky, ground }: {
    wraith: Wraith; events: EventBus<GameEvents>; voices: () => VoiceService | null;
    sky: { redden(): void; calm(seconds?: number): void }; ground: (x: number, z: number) => number;
  }) {
    this.wraith = wraith;
    this.events = events;
    this.voices = voices;
    this.sky = sky;
    this.ground = ground;
  }

  /** how hard the ground shakes now (0..1) */
  get shaking(): number {
    return this.filming ? sstep(T.quake, T.peak, this.t) * (1 - sstep(T.calm, T.still, this.t)) : 0;
  }

  get active(): boolean { return this.t >= 0; }

  /** `mouth`: the jar's mouth; `stand`: where the ghost stands up; `view`: where the camera is; `woods`: where it goes (all world) */
  start(mouth: THREE.Vector3, stand: THREE.Vector3, view: THREE.Vector3, woods: THREE.Vector3): void {
    if (this.active) return;
    this.t = 0; this.ending = 0; this.cue.clear(); this.voice = null;
    this.mouth.copy(mouth);
    this.stand.copy(stand);
    this.view.copy(view);
    this.woods.copy(woods);
    const w = this.wraith;
    w.group.scale.setScalar(SCALE);
    Object.assign(w.pose, { x: mouth.x, z: mouth.z, base: mouth.y, grow: 0, form: 0, opacity: 1, heading: Math.atan2(view.x - mouth.x, view.z - mouth.z) });
    this.filming = true;
    this.snap = true; // straight into the shot, as the lid comes off
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  private _once(name: string, fn: () => void): void { if (!this.cue.has(name)) { this.cue.add(name); fn(); } }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t, w = this.wraith, P = w.pose;
    if (t >= T.knot && !this.ending) {
      this._once('knot', () => {
        w.show(true);
        // its sound: the recording (only the part that fits), else the synthesized wind
        this.voice = this.voices()?.play('ghost_appear', this.mouth, { duck: true, gain: 1, from: SOUND.from, length: SOUND.length }) ?? null;
        if (!this.voice) this.events.emit(EV.SCENARIO_CUE, { cue: 'whirl', position: this.mouth });
      });
      // up out of the mouth, then down onto the boards in front of the jar as it grows
      const down = sstep(T.knot + 0.6, T.settle + 0.6, t);
      P.x = this.mouth.x + (this.stand.x - this.mouth.x) * down;
      P.z = this.mouth.z + (this.stand.z - this.mouth.z) * down;
      P.base = this.mouth.y + (this.stand.y - this.mouth.y) * down;
      P.grow = 0.25 * sstep(T.knot, T.settle, t) + 0.75 * sstep(T.settle, T.full, t);
      P.form = sstep(T.gather, T.formed, t);
      // it turns to us (the camera) as it takes shape, and glares
      const glare = Math.atan2(this.view.x - this.stand.x, this.view.z - this.stand.z);
      // the second swell: the sky turns red; it rises a little, its robe streaming
      if (t >= T.quake) this._once('red', () => this.sky.redden());
      const q = this.shaking;
      P.lift = 0.25 + 0.18 * sstep(T.quake, T.peak, t);
      // then it turns away and goes off into the woods, faster and fainter
      // the further it goes, and the sky goes back to the night's colour
      const away = Math.atan2(this.woods.x - this.stand.x, this.woods.z - this.stand.z);
      const turn = sstep(T.turn, T.turn + 1.2, t);
      P.heading = glare + Math.atan2(Math.sin(away - glare), Math.cos(away - glare)) * turn;
      if (t >= T.leave) {
        const go = Math.pow(Math.min(1, (t - T.leave) / (T.gone - T.leave)), 1.5);
        P.x = this.stand.x + (this.woods.x - this.stand.x) * go;
        P.z = this.stand.z + (this.woods.z - this.stand.z) * go;
        // off the porch's edge and down over the ground
        P.base = this.stand.y + (this.ground(P.x, P.z) - this.stand.y) * sstep(0.04, 0.18, go);
        P.opacity = 1 - sstep(0.25, 0.95, go);
        w.group.scale.setScalar(SCALE + (1 - SCALE) * sstep(0, 0.2, go));
      }
      if (t >= CALM.at) this._once('calm', () => this.sky.calm(CALM.seconds));
      P.wind = 1 + 1.6 * q + 0.8 * sstep(T.leave, T.leave + 2, t);
      w.update(dt);
      if (t >= T.end) this.ending = 1e-6;
    }
    if (!this.ending) return;
    // dip to black, back to the player (skipped: the sky is the night's again)
    this._once('calm', () => this.sky.calm(1));
    this.ending += dt;
    if (this.filming) {
      this.fade = Math.min(1, this.ending / 0.4);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.4) {
        this.filming = false;
        this.voice?.stop();
        w.show(false);
        w.group.scale.setScalar(1);
        Object.assign(P, { base: null, lift: 0.25, wind: 1, opacity: 1 });
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.5);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  // one shot from along the porch: on the jar's mouth at first, then following
  // the whirlwind up, drawing in a little on the ghost's face as it glares,
  // and turning to follow it as it goes off into the woods; the shaking on
  // top (not smoothed away)
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const t = this.t, w = this.wraith;
    const push = sstep(T.formed - 1, T.glared, t);
    this.tPos.copy(this.view).lerp(this.stand, 0.18 * push);
    const centre = w.group.position;
    w.headWorld(this.head);
    if (t < T.knot + 0.2) this.tLook.copy(this.mouth);
    else this.tLook.set(centre.x, centre.y + 1.15 * w.pose.grow * SCALE, centre.z).lerp(this.head, sstep(T.gather, T.formed, t) * 0.75);
    _m.lookAt(this.tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    if (this.snap) { this.snap = false; this.pos.copy(this.tPos); this.quat.copy(_q); }
    const k = 1 - Math.exp(-3 * dt);
    this.pos.lerp(this.tPos, k);
    this.quat.slerp(_q, k);
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    const q = this.shaking;
    if (q > 0) {
      // a few uneven tremors on top of each other: a rumble and a slower sway
      const n = (a: number, b: number, c: number) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.1) * 0.2;
      camera.position.x += SHAKE.move * q * n(31, 47, 7.3);
      camera.position.y += SHAKE.move * q * n(37, 53, 5.9);
      camera.position.z += SHAKE.move * q * n(29, 43, 6.7);
      camera.rotateX(SHAKE.turn * q * n(23, 41, 4.3));
      camera.rotateZ(SHAKE.turn * q * n(19, 35, 3.7));
    }
    if (Math.abs(camera.fov - 55) > 0.01) { camera.fov = 55; camera.updateProjectionMatrix(); }
  }
}
