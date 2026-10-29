import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Shopkeeper } from '../store/Shopkeeper.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';
import { VOICE_GAIN, type SceneLine } from './AmirScene.ts';

// Paying Farajpour, as a short film scene: the camera comes in to a close
// shot of him behind the counter and he talks to you (his recording, or a
// caption without one). Partway through he takes out the stone amulet and
// holds it out to you in his open hand - against the ghost - and then it is
// yours: it flies to you. A dip to black and the view is yours again.

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** how long he holds the amulet out before it is yours (s) */
const HOLD = 3.2;

export class KeeperScene {
  /** the film camera has the view */
  filming = false;
  /** the amulet has been handed over */
  given = false;
  private readonly keeper: Shopkeeper;
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly amulet: THREE.Object3D;
  private voice: VoiceHandle | null = null;
  private t = -1;
  private lineT = 0;
  private lineLen = 0;
  private ending = 0;
  private fade = 0;
  private handT = -1; // seconds since he brought it out
  private giveAt = 0; // seconds into his line when he brings it out
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private fov = 70;
  private readonly from = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly tPos = new THREE.Vector3();
  private readonly tLook = new THREE.Vector3();
  private readonly offer = new THREE.Vector3();
  private readonly counter = new THREE.Vector3();
  private readonly fly = new THREE.Vector3();

  /** `amulet`: the amulet, in world space (hidden until he brings it out) */
  constructor({ keeper, events, voices, amulet }: { keeper: Shopkeeper; events: EventBus<GameEvents>; voices: () => VoiceService | null; amulet: THREE.Object3D }) {
    this.keeper = keeper;
    this.events = events;
    this.voices = voices;
    this.amulet = amulet;
  }

  get active(): boolean { return this.t >= 0; }

  /** `giveAt`: seconds into his recording when he brings out the amulet (without one: halfway) */
  start(line: SceneLine, camera: THREE.Camera, giveAt: number): void {
    if (this.active) return;
    this.t = 0; this.ending = 0; this.handT = -1; this.given = false;
    this.from.copy(camera.position);
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
    const k = this.keeper;
    k.nod();
    this.voice = this.voices()?.play(line.voice, k.human.headPivot.getWorldPosition(this.head), { duck: true, gain: VOICE_GAIN }) ?? null;
    this.lineLen = this.voice ? this.voice.duration : Math.max(5, line.text.length * 0.075);
    this.lineT = 0;
    k.speak(this.lineLen);
    this.giveAt = this.voice ? Math.min(giveAt, this.lineLen - HOLD - 1) : this.lineLen * 0.5;
    // a caption only when there is no recording
    if (!this.voice) this.events.emit(EV.DIALOG, { speaker: line.speaker, text: line.text, seconds: this.lineLen + 0.6 });
  }

  /** cut it short: the amulet is yours all the same */
  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    this.lineT = this.voice ? this.voice.elapsed() : this.lineT + dt;
    const k = this.keeper;
    k.human.headPivot.getWorldPosition(this.head);
    // the amulet: out of his apron, held out in his open hand, then over to you
    if (this.handT < 0 && this.lineT >= this.giveAt && !this.ending) {
      this.handT = 0;
      this.amulet.visible = true;
      // from low by the counter up to between you and him
      this.counter.copy(this.head).addScaledVector(UP, -0.75);
    }
    if (this.handT >= 0 && !this.given) {
      this.handT += dt;
      const toYou = this.fly.subVectors(this.from, this.head).setY(0).normalize();
      const rise = Math.min(1, this.handT / 0.9);
      const e = rise * rise * (3 - 2 * rise);
      this.offer.copy(this.counter).lerp(this.tLook.copy(this.head).addScaledVector(UP, -0.42).addScaledVector(toYou, 0.38), e);
      k.offer = this.offer;
      if (this.handT < HOLD) {
        this.amulet.position.copy(this.offer).addScaledVector(UP, 0.03).addScaledVector(toYou, 0.06); // in his fingers
        this.amulet.lookAt(this.amulet.position.x + toYou.x, this.amulet.position.y, this.amulet.position.z + toYou.z);
      } else {
        // it's yours: over to the camera, getting smaller as it goes out of view
        const f = Math.min(1, (this.handT - HOLD) / 0.6);
        this.amulet.position.lerp(this.pos, f * 0.35);
        k.offer = null;
        if (f >= 1) { this.given = true; this.amulet.visible = false; }
      }
    }
    if (!this.ending && this.lineT >= this.lineLen + 0.4 && (this.given || this.handT < 0)) this.ending = 1e-6;
    if (!this.ending) return;
    // dip to black, back to the player
    this.ending += dt;
    if (this.filming) {
      this.fade = Math.min(1, this.ending / 0.35);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.35) {
        this.filming = false;
        this.voice?.stop();
        k.offer = null;
        k.speak(0);
        this.amulet.visible = false;
        this.given = true;
        this.events.emit(EV.DIALOG, null);
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.45);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  // a close shot of him from your side of the counter, a little wider while he holds the amulet out
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const toYou = this.fly.subVectors(this.from, this.head).setY(0);
    const far = Math.max(1.2, toYou.length());
    toYou.normalize();
    const out = this.handT >= 0 && !this.given ? 1 : 0;
    const d = Math.min(far, 1.5 + 0.35 * out);
    this.tPos.copy(this.head).addScaledVector(toYou, d).addScaledVector(UP, -0.08 - 0.1 * out);
    this.tLook.copy(this.head).addScaledVector(UP, -0.08 - 0.3 * out);
    _m.lookAt(this.tPos, this.tLook, UP);
    _q.setFromRotationMatrix(_m);
    const k = 1 - Math.exp(-3 * dt);
    this.pos.lerp(this.tPos, k);
    this.quat.slerp(_q, k);
    this.fov += (44 - this.fov) * k;
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
