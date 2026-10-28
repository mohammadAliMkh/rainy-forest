import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Gathering } from '../people/Gathering.ts';
import { StandTalk } from '../people/StandTalk.ts';
import { fitFov } from '../intro/IntroDirector.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// The errand begins: you walk up to Amir and he gets up to talk to you, as
// a short film scene. From your own view you see him stand and turn to you;
// the camera comes in to a close shot in front of him and he says his line
// straight into it (to you), with his free hand; toward the end he points
// the way to the shop. A dip to black, the view is yours again, and he sits
// back down. The line is a recording when there is one, a caption always.

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();

export interface SceneLine { speaker: string; voice: string; text: string }

export class AmirScene {
  /** the film camera has the view */
  filming = false;
  private readonly gathering: Gathering;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private act: StandTalk | null = null;
  private line: SceneLine | null = null;
  private pointAt = new THREE.Vector3();
  private voice: VoiceHandle | null = null;
  private t = -1;
  private lineT = -1; // seconds into the line, -1 before it
  private lineLen = 0;
  private ending = 0;
  private fade = 0;
  // the camera: from the player's eye, in to a close shot of his face
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private fov = 70;
  private readonly start0 = new THREE.Vector3();
  private readonly look0 = new THREE.Vector3();

  constructor({ gathering, terrain, events, voices }: { gathering: Gathering; terrain: { heightAt(x: number, z: number): number }; events: EventBus<GameEvents>; voices: () => VoiceService | null }) {
    this.gathering = gathering;
    this.terrain = terrain;
    this.events = events;
    this.voices = voices;
  }

  get active(): boolean { return this.t >= 0; }

  /** Amir gets up and says `line`; `pointAt` is where he shows the way (world) */
  start(line: SceneLine, pointAt: THREE.Vector3, camera: THREE.Camera): void {
    const p = this.gathering.byName('amir');
    if (!p || this.active) return;
    this.line = line;
    this.pointAt.copy(pointAt);
    this.t = 0; this.lineT = -1; this.ending = 0; this.voice = null;
    const s = p.seat;
    this.act = new StandTalk(p.h, { x: s.x, y: s.y, z: s.z, facing: s.facing, lean: p.baseLean }, this.terrain);
    this.act.pointAt = this.pointAt;
    p.act = this.act;
    // the first shot is the player's own view
    this.start0.copy(camera.position);
    this.look0.copy(camera.getWorldDirection(new THREE.Vector3())).multiplyScalar(3).add(camera.position);
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov = (camera as THREE.PerspectiveCamera).fov ?? 70;
    this.filming = true;
    this.events.emit(EV.INTRO_CINEMATIC, true); // (his name is on the line's caption box)
  }

  /** cut it short: he sits down, the view comes back */
  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  private _say(): void {
    const line = this.line!;
    const p = this.gathering.byName('amir')!;
    this.voice = this.voices()?.play(line.voice, p.headPos) ?? null;
    this.lineLen = this.voice ? this.voice.duration : Math.max(4, line.text.length * 0.075);
    this.lineT = 0;
    this.events.emit(EV.DIALOG, { speaker: line.speaker, text: line.text, seconds: this.lineLen + 0.6 });
    const act = this.act!;
    act.speaking = true;
    const v = this.voice;
    act.voice = v ? () => v.level() : null;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const act = this.act;
    // the line starts once he is up and facing you
    if (this.lineT < 0 && act?.ready) this._say();
    if (this.lineT >= 0) {
      this.lineT = this.voice ? this.voice.elapsed() : this.lineT + dt;
      // the last couple of seconds: "that way, to the shop"
      if (act) act.point = Math.min(1, Math.max(0, (this.lineT - (this.lineLen - 2.8)) / 2.6));
      if (this.lineT >= this.lineLen + 0.4 && !this.ending) this.ending = 1e-6;
    }
    // dip to black, back to the player, then he sits down
    if (this.ending) {
      this.ending += dt;
      if (this.filming) {
        this.fade = Math.min(1, this.ending / 0.35);
        this.events.emit(EV.INTRO_FADE, this.fade);
        if (this.ending >= 0.35) {
          this.filming = false;
          this.voice?.stop();
          if (act) { act.speaking = false; act.point = 0; act.sitDown(); }
          this.events.emit(EV.DIALOG, null);
          this.events.emit(EV.INTRO_CINEMATIC, false);
        }
      } else {
        this.fade = Math.max(0, this.fade - dt / 0.45);
        this.events.emit(EV.INTRO_FADE, this.fade);
        if (this.fade <= 0 && (!act || act.done)) { this.t = -1; this.act = null; }
      }
    }
  }

  // close shot in front of his face, on the line between him and where you stood
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    const p = this.gathering.byName('amir')!;
    const head = p.headPos;
    const toYou = new THREE.Vector3(this.start0.x - head.x, 0, this.start0.z - head.z);
    const far = Math.max(1.2, toYou.length());
    toYou.normalize();
    let tPos: THREE.Vector3, tLook: THREE.Vector3, fov: number;
    const into = this.act?.ready ?? false;
    if (!into) {
      // your own view: watching him get up, turning to keep him in frame
      tPos = this.start0.clone();
      tLook = this.look0.clone().lerp(head.clone().addScaledVector(UP, -0.25), Math.min(1, this.t / 0.8));
      fov = 62;
    } else {
      // in close, at his eye level, coming in a little while he talks; wider when he points
      const k = this.lineT >= 0 ? Math.min(1, this.lineT / Math.max(1, this.lineLen)) : 0;
      const pt = this.act?.point ?? 0;
      const d = Math.min(far, 1.75 - 0.4 * k + 0.6 * pt);
      tPos = head.clone().addScaledVector(toYou, d).addScaledVector(UP, -0.06);
      tPos.y = Math.max(tPos.y, this.terrain.heightAt(tPos.x, tPos.z) + 1.2);
      tLook = head.clone().addScaledVector(UP, -0.05 - 0.15 * pt);
      fov = fitFov(38 + 16 * pt, camera.aspect);
    }
    _m.lookAt(tPos, tLook, UP);
    const tq = new THREE.Quaternion().setFromRotationMatrix(_m);
    const k = 1 - Math.exp(-(into ? 2.6 : 6) * dt);
    this.pos.lerp(tPos, k);
    this.quat.slerp(tq, k);
    this.fov += (fov - this.fov) * k;
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
