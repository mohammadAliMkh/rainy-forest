import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { ChaseScene } from './ChaseScene.ts';
import type { Inventory } from '../items/Inventory.ts';
import type { Hands } from '../player/Hands.ts';
import type { Picker } from '../player/Picker.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import { RESCUE, FIGHT_TEXT } from './errandScript.ts';

// Saving the four, one ghost at a time. Come close to a ghost and it turns on
// you. With the stone cross in your hand a round bar comes up: every click
// (every tap on a phone) fills it; stop and it slowly empties again. All the
// while, every few seconds, the ghost rushes at you, and each time it reaches
// you the bar loses a bite. Full: the ghost is gone and its friend runs back
// to the fire. Walk away and it all starts over. But with the bar empty, the
// cross held or not, a clock runs while you are near it: run out of that and
// the ghost comes for you - you drop to the ground, dead, game over, and it
// all starts again from the moment the ghosts went for the friends.

const UP = new THREE.Vector3(0, 1, 0);
const sstep = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/**
 * how near to a ghost it turns on you, how far to get away from it again (m);
 * how much a click fills the bar (of 1); how long without a click before it
 * starts to empty (s), how fast it does (per s); how much each rush takes;
 * how long between rushes (s); how long it takes to reach you, to get back (s);
 * how far toward you it comes (of the way, up to arm's reach of you); how long you can stay near it with
 * the bar empty (s); how near its glow lights up its friend (m), how brightly
 */
const FIGHT = {
  range: 6, leave: 8.5, fill: 0.03, idle: 0.5, drain: 0.06, bite: 0.12,
  every: [2.6, 4.6], rush: 0.45, back: 0.9, lunge: 1, empty: 8, glowAt: 16, glow: 3,
};
/** the stone of the cross held up, glowing brighter as the bar fills: its colour, at empty, at full */
const SHINE = { color: 0xffc27a, from: 0.06, to: 0.5 };
/** dying: the fall (s), lying there, the dip to black, the words on the black, back from the black; the eye's height on the ground (m); how far over the head rolls */
const DEATH = { fall: 1.1, lie: 0.7, black: 0.9, over: 3.2, back: 0.9, eye: 0.22, roll: 1.35 };
/** the ghost's laughter (its recording) as it rushes at you: somewhere in this stretch (s), how long, how loud; and as it comes for you */
const LAUGH = { from: 2, to: 26, length: 1.1, gain: 0.9, last: 2.6 };

export class CrossFight {
  /** the film camera has the view: you are dying */
  filming = false;
  /** there are ghosts to fight (the errand's rescue) */
  on = false;
  /** how full the bar is (0..1) */
  fill = 0;
  /** which of the four's ghost has turned on you */
  key: string | null = null;
  private readonly chase: ChaseScene;
  private readonly inventory: Inventory;
  private readonly hands: Hands;
  private readonly player: { x: number; y: number; z: number };
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly picker: Picker;
  private readonly touch: () => boolean;
  private readonly indoors: () => boolean;
  private readonly ground: (x: number, z: number) => number;
  /** `onSaved`: a ghost is gone (by the name of its friend); `onDead`: to start again, behind the black */
  onSaved: ((key: string) => void) | null = null;
  onDead: (() => void) | null = null;
  private idle = 0;
  private empty = 0;
  private next = 0;
  private rushT = -1;
  private bitten = false;
  private kick = 0;
  private shake = 0;
  private time = 0;
  private ring = false;
  private raised = false;
  private shining: THREE.Object3D | null = null;
  // dying
  private dieT = -1;
  private deadKey: string | null = null;
  private over = false;
  private backT = -1;
  private readonly at = new THREE.Vector3();
  private readonly you = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly pos0 = new THREE.Vector3();
  private readonly quat0 = new THREE.Quaternion();
  private fallen = false;
  private readonly _m = new THREE.Matrix4();
  private readonly _q = new THREE.Quaternion();
  private readonly _r = new THREE.Quaternion();
  private readonly _p = new THREE.Vector3();

  constructor({ chase, inventory, hands, player, events, voices, picker, touch, indoors, ground }: {
    chase: ChaseScene; inventory: Inventory; hands: Hands; player: { x: number; y: number; z: number };
    events: EventBus<GameEvents>; voices: () => VoiceService | null; picker: Picker;
    touch: () => boolean; indoors: () => boolean; ground: (x: number, z: number) => number;
  }) {
    this.chase = chase;
    this.inventory = inventory;
    this.hands = hands;
    this.player = player;
    this.events = events;
    this.voices = voices;
    this.picker = picker;
    this.touch = touch;
    this.indoors = indoors;
    this.ground = ground;
    // every click on the view, every short tap on it (a longer touch is looking round)
    const dom = picker.dom;
    dom.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) this.tap(); });
    const taps = new Map<number, { x: number; y: number; t: number }>();
    dom.addEventListener('touchstart', (e) => { for (const t of Array.from(e.changedTouches)) taps.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now() }); }, { passive: true });
    dom.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        const s = taps.get(t.identifier);
        taps.delete(t.identifier);
        if (s && performance.now() - s.t < 350 && Math.hypot(t.clientX - s.x, t.clientY - s.y) < 12) this.tap();
      }
    }, { passive: true });
  }

  get dying(): boolean { return this.dieT >= 0; }
  private get armed(): boolean { return this.inventory.held === 'amulet'; }

  /** a click: the bar fills (with the cross in hand, near a ghost) */
  tap(): void {
    if (!this.on || !this.key || !this.armed || this.dying || !this.picker.ready) return;
    this.fill = Math.min(1, this.fill + FIGHT.fill);
    this.idle = 0;
    this.kick = 1;
  }

  /** no more of it (the fight over, or starting again) */
  private _clear(): void {
    if (this.key) this.chase.threat(this.key, null, 0);
    this.key = null;
    this.fill = 0; this.empty = 0; this.idle = 0; this.kick = 0;
    this.rushT = -1; this.next = this._wait();
    if (this.ring) { this.ring = false; this.events.emit(EV.CROSS_RING, null); }
    if (this.raised) { this.raised = false; this.hands.raiseHeld(null); }
    this._shine(0);
  }

  // the stone of the cross in hand glows by `v` (its gems have their own glow)
  private _shine(v: number): void {
    const model = v > 0 ? this.hands.right.held : null;
    if (this.shining && this.shining !== model) this._glowOn(this.shining, 0);
    this.shining = model;
    if (model) this._glowOn(model, v);
  }

  private _glowOn(model: THREE.Object3D, v: number): void {
    model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (!m?.emissive) return;
      m.userData.stone ??= m.emissive.getHex() === 0;
      if (m.userData.stone) { m.emissive.setHex(SHINE.color); m.emissiveIntensity = v; }
    });
  }

  private _wait(): number { return FIGHT.every[0] + Math.random() * (FIGHT.every[1] - FIGHT.every[0]); }

  update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.kick = Math.max(0, this.kick - dt * 7);
    if (this.dying) { this._dying(dt); return; }
    if (this.backT >= 0) {
      this.backT += dt;
      this.events.emit(EV.INTRO_FADE, Math.max(0, 1 - this.backT / DEATH.back));
      if (this.backT >= DEATH.back) this.backT = -1;
    }
    if (!this.on) return;
    // the nearest of them: its glow lights up its friend; close enough, it turns on you
    let near: string | null = null, best = Infinity;
    for (const { key } of RESCUE) {
      const s = this.chase.spot(key);
      if (!s) continue;
      const d = Math.hypot(s.x - this.player.x, s.z - this.player.z);
      if (d < best) { best = d; near = key; }
    }
    this.chase.lit = near && best < FIGHT.glowAt ? near : null;
    this.chase.litBy = FIGHT.glow;
    if (this.key) {
      const s = this.chase.spot(this.key);
      if (!s || this.indoors() || Math.hypot(s.x - this.player.x, s.z - this.player.z) > FIGHT.leave) this._clear();
    }
    if (!this.key && near && best < FIGHT.range && !this.indoors()) { this.key = near; this.next = this._wait(); }
    const key = this.key;
    if (!key) return;
    this.you.set(this.player.x, this.player.y, this.player.z);
    const armed = this.armed;
    // the bar: emptying when you stop
    this.idle += dt;
    if (this.idle > FIGHT.idle) this.fill = Math.max(0, this.fill - FIGHT.drain * dt);
    // it rushes at you now and then, and the bar loses a bite when it gets there
    if (this.rushT < 0 && armed && this.fill > 0) {
      this.next -= dt;
      if (this.next <= 0) {
        this.rushT = 0; this.bitten = false;
        this._laugh(key, LAUGH.from + Math.random() * (LAUGH.to - LAUGH.from), LAUGH.length);
      }
    }
    let lunge = 0, hit = false;
    if (this.rushT >= 0) {
      this.rushT += dt;
      const t = this.rushT;
      lunge = FIGHT.lunge * (t < FIGHT.rush ? sstep(t / FIGHT.rush) : 1 - sstep((t - FIGHT.rush) / FIGHT.back));
      if (t >= FIGHT.rush && !this.bitten) {
        this.bitten = true; hit = true;
        this.fill = Math.max(0, this.fill - FIGHT.bite);
        this.shake = 1;
      }
      if (t >= FIGHT.rush + FIGHT.back) { this.rushT = -1; this.next = this._wait(); }
    }
    this.chase.threat(key, this.you, lunge);
    // the cross held up against it, jumping with each click
    if (armed) { this.raised = true; this.hands.raiseHeld(this.kick); }
    else if (this.raised) { this.raised = false; this.hands.raiseHeld(null); }
    this._shine(armed ? SHINE.from + (SHINE.to - SHINE.from) * this.fill : 0);
    // the bar left empty: the clock runs
    this.empty = this.fill <= 0 ? this.empty + dt : Math.max(0, this.empty - dt * 2);
    const danger = Math.min(1, this.empty / FIGHT.empty);
    this.ring = true;
    this.events.emit(EV.CROSS_RING, {
      fill: this.fill, danger, hit, armed,
      label: !armed ? (this.touch() ? FIGHT_TEXT.takeTouch : FIGHT_TEXT.take) : this.touch() ? FIGHT_TEXT.tap : FIGHT_TEXT.click,
    });
    if (this.fill >= 1) {
      this._clear();
      this.chase.banish(key);
      this.onSaved?.(key);
    } else if (this.empty >= FIGHT.empty) this._die(key);
  }

  private _laugh(key: string, from: number, length: number): void {
    this.chase.head(key, this.head);
    this.voices()?.play('ghost_split', this.head, { gain: LAUGH.gain, from, length });
  }

  // it comes for you
  private _die(key: string): void {
    this.chase.threat(key, this.you, FIGHT.lunge);
    this._laugh(key, LAUGH.from, LAUGH.last);
    this.chase.head(key, this.head);
    this.key = null; // (it stays over you: not let go of until the end)
    this.at.copy(this.you);
    if (this.ring) { this.ring = false; this.events.emit(EV.CROSS_RING, null); }
    this.raised = false;
    this._shine(0);
    this.dieT = 0; this.over = false; this.fallen = false;
    this.filming = true;
    this.deadKey = key;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  /** cut the dying short: straight to starting again */
  skip(): void { if (this.dying) this.dieT = Math.max(this.dieT, DEATH.fall + DEATH.lie + DEATH.black + DEATH.over); }

  private _dying(dt: number): void {
    this.dieT += dt;
    if (this.deadKey) { this.chase.threat(this.deadKey, this.at, FIGHT.lunge); this.chase.head(this.deadKey, this.head); }
    const black = this.dieT - DEATH.fall - DEATH.lie;
    if (black > 0) this.events.emit(EV.INTRO_FADE, Math.min(1, black / DEATH.black));
    if (black >= DEATH.black && !this.over) {
      this.over = true;
      this.events.emit(EV.GAME_OVER, { title: FIGHT_TEXT.over, note: FIGHT_TEXT.again });
    }
    if (black >= DEATH.black + DEATH.over) {
      this.events.emit(EV.INTRO_FADE, 1);
      this.events.emit(EV.GAME_OVER, null);
      this.dieT = -1;
      this.filming = false;
      this.deadKey = null;
      this.fill = 0; this.empty = 0;
      this.backT = 0;
      this.onDead?.();
    }
  }

  applyCamera(camera: THREE.PerspectiveCamera): void {
    if (this.filming) {
      if (!this.fallen) { this.fallen = true; this.pos0.copy(camera.position); this.quat0.copy(camera.quaternion); }
      // down to the ground, the head rolling over, looking up at it
      const k = Math.min(1, this.dieT / DEATH.fall);
      const floor = this.ground(this.pos0.x, this.pos0.z) + DEATH.eye;
      this._p.copy(this.pos0);
      this._p.y += (floor - this.pos0.y) * k * k;
      camera.position.copy(this._p);
      this._m.lookAt(this._p, this.head, UP);
      this._q.setFromRotationMatrix(this._m);
      this._r.setFromAxisAngle(new THREE.Vector3(0, 0, 1), DEATH.roll * sstep(k));
      this._q.multiply(this._r);
      camera.quaternion.copy(this.quat0).slerp(this._q, sstep(k));
      return;
    }
    // shaken as it hits you
    if (this.shake > 0 && this.on) {
      const s = this.shake * this.shake;
      camera.rotateZ(Math.sin(this.time * 41) * 0.05 * s);
      camera.rotateX(Math.sin(this.time * 53 + 1) * 0.035 * s);
    }
  }
}
