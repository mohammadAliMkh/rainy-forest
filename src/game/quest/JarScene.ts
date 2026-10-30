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
// Its sound is a recording (`ghost_appear`): its first seconds - a rising
// swell, then a deep heavy part - fit the scene, so the timings follow it.
// (What follows - the shaking, the red sky, the ghost leaving for the woods -
// comes next; for now the scene ends with a dip to black.)

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
  end: 9.8,
};
/** the part of the recording that is played: from, how long */
const SOUND = { from: 1.0, length: 9.6 };
/** a little smaller than its full size, under the porch roof */
const SCALE = 0.88;

export class JarScene {
  /** the film camera has the view */
  filming = false;
  private readonly wraith: Wraith;
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private t = -1;
  private ending = 0;
  private fade = 0;
  private voice: VoiceHandle | null = null;
  private readonly cue = new Set<string>();
  private readonly mouth = new THREE.Vector3();
  private readonly stand = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private snap = false;
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private readonly head = new THREE.Vector3();

  constructor({ wraith, events, voices }: { wraith: Wraith; events: EventBus<GameEvents>; voices: () => VoiceService | null }) {
    this.wraith = wraith;
    this.events = events;
    this.voices = voices;
  }

  get active(): boolean { return this.t >= 0; }

  /** `mouth`: the jar's mouth; `stand`: where the ghost stands up; `view`: where the camera is (all world) */
  start(mouth: THREE.Vector3, stand: THREE.Vector3, view: THREE.Vector3): void {
    if (this.active) return;
    this.t = 0; this.ending = 0; this.cue.clear(); this.voice = null;
    this.mouth.copy(mouth);
    this.stand.copy(stand);
    this.view.copy(view);
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
      P.heading = Math.atan2(this.view.x - P.x, this.view.z - P.z);
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
        this.voice?.stop();
        w.show(false);
        w.group.scale.setScalar(1);
        P.base = null;
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.5);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  // one shot from along the porch: on the jar's mouth at first, then following
  // the whirlwind up, and drawing in a little on the ghost's face as it glares
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const t = this.t, w = this.wraith;
    const push = sstep(T.formed - 1, T.end, t);
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
    if (Math.abs(camera.fov - 55) > 0.01) { camera.fov = 55; camera.updateProjectionMatrix(); }
  }
}
