import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import { DRAW, type ChaseScene } from './ChaseScene.ts';
import type { Inventory } from '../items/Inventory.ts';
import type { Hands } from '../player/Hands.ts';
import type { Picker } from '../player/Picker.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { LoopHandle } from '../sound/Soundscape.ts';
import { RESCUE, FIGHT_TEXT } from './errandScript.ts';

// Saving the four, one ghost at a time. Come close to a ghost and it turns on
// you. With the stone cross in your hand a round bar comes up: every click
// (every tap on a phone) fills it; stop and it slowly empties again. All the
// while, every few seconds, the ghost rushes at you, and each time it reaches
// you the bar loses a bite; the nearer you stand, the sooner it comes, the faster
// and the harder, so keep your distance. Full: the ghost is drawn into the cross
// and is gone, and its friend stands free. Walk away and it all starts over. But
// with the bar empty, the cross held or not, a clock runs while you are near it,
// the nearer the faster: run out of that and the ghost comes for you - you drop
// to the ground, dead, game over. And above it all the time runs: all four saved
// in time, or that's game over as well. Either way it all starts again from
// the moment the ghosts went for the friends. All the while the nearest ghost can
// be heard, louder and clearer the nearer it is, the friends' fear faintly under it,
// and over it all the music, round and round until it is over one way or the other.

const UP = new THREE.Vector3(0, 1, 0);
const sstep = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/**
 * how near to a ghost it turns on you, how far to get away from it again (m);
 * how much a click fills the bar (of 1); how long without a click before it
 * starts to empty (s), how fast it does (per s); how long you can stay near it
 * with the bar empty (s); how near its glow lights up its friend (m), how
 * brightly; how long there is to save all four (s)
 */
const FIGHT = { range: 7.5, leave: 10, fill: 0.03, idle: 0.5, drain: 0.06, empty: 8, glowAt: 16, glow: 3, time: 90 };
/**
 * its rushes, [from as far as it turns on you, from as near as `near` metres]: how long between them (s);
 * how much each takes off the bar; how long it takes to reach you, to get back (s); how hard it shakes you.
 * From `warn` (of the way from far to near) on you are told to back off
 */
const RUSH = { near: 1.5, every: [4.2, 1.1], bite: [0.07, 0.28], rush: [0.6, 0.22], back: [0.9, 0.45], shake: [0.45, 1], warn: 0.55 };
const mix = (r: number[], k: number) => r[0] + (r[1] - r[0]) * k;
/** the stone of the cross held up, glowing brighter as the bar fills: its colour, at empty, at full */
const SHINE = { color: 0xffc27a, from: 0.06, to: 0.5, drawing: 2.2 };
/** dying: the fall (s), lying there, the dip to black, the words on the black, back from the black; the eye's height on the ground (m); how far over the head rolls */
const DEATH = { fall: 1.1, lie: 0.7, black: 0.9, over: 3.2, back: 0.9, eye: 0.22, roll: 1.35 };
/** the ghost's laughter (its recording) as it rushes at you: somewhere in this stretch (s), how long, how loud; and as it comes for you */
const LAUGH = { from: 2, to: 26, length: 1.1, gain: 0.9, last: 2.6 };
/**
 * hearing the nearest ghost: from how far (m), all there from how near (m); how steeply it gets louder;
 * how much of it comes through the shop's walls
 */
const HEAR = { far: 30, near: 2, steep: 2.2, indoors: 0.35 };
/** what is heard, going round: the three swells of the ghost's recording; under it, faintly, the friends' gasp and scream, now and then */
const DREAD = [
  { key: 'ghost_appear', parts: [[4.6, 8.6], [11.2, 17], [22, 28.5]], fade: 1.2, rest: 0, gain: 1.4 },
  { key: 'friends_scared', parts: [[5.1, 9.4]], fade: 0.15, rest: 5, gain: 0.12 },
] as const;
/** the music all through it: its recording, how loud */
const MUSIC = { key: 'rescue_music', gain: 1.6 };

export class CrossFight {
  /** the film camera has the view: you are dying */
  filming = false;
  /** there are ghosts to fight (the errand's rescue) */
  on = false;
  /** how full the bar is (0..1) */
  fill = 0;
  /** which of the four's ghost has turned on you */
  key: string | null = null;
  /** how long there is left to save them all (s) */
  left: number = FIGHT.time;
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
  private next = 1;
  private rushT = -1;
  private rushIn = 0;
  private rushBack = 0;
  private flare = 0;
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
  private falls = false;
  private readonly into = new THREE.Vector3();
  private over = false;
  private backT = -1;
  private readonly at = new THREE.Vector3();
  private readonly you = new THREE.Vector3();
  private readonly head = new THREE.Vector3();
  private readonly pos0 = new THREE.Vector3();
  private readonly quat0 = new THREE.Quaternion();
  private fallen = false;
  private readonly dread: (LoopHandle | null)[] = [];
  private music: LoopHandle | null = null;
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

  // until its next rush: 1 is about the usual wait, at any distance
  private _wait(): number { return 0.75 + Math.random() * 0.5; }

  /** the clock starts: save them all in time */
  begin(): void {
    this.on = true;
    this.left = FIGHT.time;
    this._clock();
  }

  /** no more of it (all saved, or a film) */
  end(): void {
    this.on = false;
    this._clear();
    this._silence();
    this.events.emit(EV.RESCUE_TIMER, null);
  }

  // the nearest ghost, `dist` metres off, and the friends' fear under it
  private _hear(dist: number): void {
    const k = 1 - Math.min(1, Math.max(0, (dist - HEAR.near) / (HEAR.far - HEAR.near)));
    const level = k ** HEAR.steep * (this.indoors() ? HEAR.indoors : 1);
    DREAD.forEach((d, i) => {
      this.dread[i] ??= this.voices()?.loop(d.key, d) ?? null;
      this.dread[i]?.set(level * d.gain, k);
    });
  }

  // the music: on, or held down (with the menu open)
  private _play(on: boolean): void {
    this.music ??= this.voices()?.loop(MUSIC.key, { music: true }) ?? null;
    this.music?.set(on ? MUSIC.gain : 0, 1);
  }

  private _silence(): void {
    for (const d of this.dread) d?.stop();
    this.dread.length = 0;
    this.music?.stop();
    this.music = null;
  }

  private _clock(): void { this.events.emit(EV.RESCUE_TIMER, { left: this.left, total: FIGHT.time }); }

  update(dt: number): void {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.kick = Math.max(0, this.kick - dt * 7);
    if (this.dying) { this._dying(dt); return; }
    // the cross flaring, the ghost going into it
    if (this.flare > 0) {
      this.flare = Math.max(0, this.flare - dt);
      if (this.flare > 0) { this.raised = true; this.hands.raiseHeld(0); this._shine(SHINE.drawing * (1 - Math.abs(this.flare / DRAW - 0.3))); }
      else if (!this.key) { this.raised = false; this.hands.raiseHeld(null); this._shine(0); }
    }
    if (this.backT >= 0) {
      this.backT += dt;
      this.events.emit(EV.INTRO_FADE, Math.max(0, 1 - this.backT / DEATH.back));
      if (this.backT >= DEATH.back) this.backT = -1;
    }
    if (!this.on) return;
    // (nothing runs with the menu open)
    if (!this.picker.ready) { this._hear(Infinity); this._play(false); return; }
    // the time for all of them
    this.left = Math.max(0, this.left - dt);
    this._clock();
    if (this.left <= 0) { this._die(null); return; }
    // the nearest of them: its glow lights up its friend; close enough, it turns on you
    let near: string | null = null, best = Infinity;
    for (const { key } of RESCUE) {
      const s = this.chase.spot(key);
      if (!s) continue;
      const d = Math.hypot(s.x - this.player.x, s.z - this.player.z);
      if (d < best) { best = d; near = key; }
    }
    this._hear(best);
    this._play(true);
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
    // how near you are to it: the nearer, the sooner it rushes at you, the faster and the harder
    const spot = this.chase.spot(key)!;
    const dist = Math.hypot(spot.x - this.player.x, spot.z - this.player.z);
    const close = 1 - Math.min(1, Math.max(0, (dist - RUSH.near) / (FIGHT.range - RUSH.near)));
    if (this.rushT < 0) {
      this.next -= dt / mix(RUSH.every, close);
      if (this.next <= 0) {
        this.rushT = 0; this.bitten = false;
        this.rushIn = mix(RUSH.rush, close);
        this.rushBack = mix(RUSH.back, close);
        this._laugh(key, LAUGH.from + Math.random() * (LAUGH.to - LAUGH.from), LAUGH.length);
      }
    }
    let lunge = 0, hit = false;
    if (this.rushT >= 0) {
      this.rushT += dt;
      const t = this.rushT;
      lunge = t < this.rushIn ? sstep(t / this.rushIn) : 1 - sstep((t - this.rushIn) / this.rushBack);
      if (t >= this.rushIn && !this.bitten) {
        // the bar loses a bite, and it hits you
        this.bitten = true; hit = true;
        this.fill = Math.max(0, this.fill - mix(RUSH.bite, close));
        this.shake = mix(RUSH.shake, close);
      }
      if (t >= this.rushIn + this.rushBack) { this.rushT = -1; this.next = this._wait(); }
    }
    this.chase.threat(key, this.you, lunge);
    // the cross held up against it, jumping with each click
    if (armed) { this.raised = true; this.hands.raiseHeld(this.kick); }
    else if (this.raised) { this.raised = false; this.hands.raiseHeld(null); }
    this._shine(armed ? SHINE.from + (SHINE.to - SHINE.from) * this.fill : 0);
    // the bar left empty: the clock runs
    this.empty = this.fill <= 0 ? this.empty + dt * (1 + close) : Math.max(0, this.empty - dt * 2);
    const danger = Math.min(1, this.empty / FIGHT.empty);
    this.ring = true;
    this.events.emit(EV.CROSS_RING, {
      fill: this.fill, danger, hit, armed,
      label: close >= RUSH.warn ? FIGHT_TEXT.back : !armed ? (this.touch() ? FIGHT_TEXT.takeTouch : FIGHT_TEXT.take) : this.touch() ? FIGHT_TEXT.tap : FIGHT_TEXT.click,
      warn: close >= RUSH.warn,
    });
    if (this.fill >= 1) {
      this._clear();
      // it goes into the cross, flaring in your hand
      this.flare = DRAW;
      this.chase.banish(key, () => this.hands.right.held?.getWorldPosition(this.into) ?? this.you, this.you);
      this.onSaved?.(key);
    } else if (this.empty >= FIGHT.empty) this._die(key);
  }

  private _laugh(key: string, from: number, length: number): void {
    this.chase.head(key, this.head);
    this.voices()?.play('ghost_split', this.head, { gain: LAUGH.gain, from, length });
  }

  // it comes for you
  // (or, `null`, your time is up: no ghost, the view just goes dark)
  private _die(key: string | null): void {
    this._silence();
    this.at.set(this.player.x, this.player.y, this.player.z);
    if (key) {
      this.chase.threat(key, this.at, 1);
      this._laugh(key, LAUGH.from, LAUGH.last);
      this.chase.head(key, this.head);
    } else if (this.key) this.chase.threat(this.key, null, 0);
    this.key = null; // (it stays over you: not let go of until the end)
    if (this.ring) { this.ring = false; this.events.emit(EV.CROSS_RING, null); }
    if (this.raised) { this.raised = false; this.hands.raiseHeld(null); }
    this._shine(0);
    this.falls = !!key;
    this.dieT = key ? 0 : DEATH.fall + DEATH.lie; this.over = false; this.fallen = false;
    this.filming = true;
    this.deadKey = key;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  /** cut the dying short: straight to starting again */
  skip(): void { if (this.dying) this.dieT = Math.max(this.dieT, DEATH.fall + DEATH.lie + DEATH.black + DEATH.over); }

  private _dying(dt: number): void {
    this.dieT += dt;
    if (this.deadKey) { this.chase.threat(this.deadKey, this.at, 1); this.chase.head(this.deadKey, this.head); }
    const black = this.dieT - DEATH.fall - DEATH.lie;
    if (black > 0) this.events.emit(EV.INTRO_FADE, Math.min(1, black / DEATH.black));
    if (black >= DEATH.black && !this.over) {
      this.over = true;
      this.events.emit(EV.GAME_OVER, { title: this.falls ? FIGHT_TEXT.over : FIGHT_TEXT.late, note: FIGHT_TEXT.again });
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
      if (!this.falls) { camera.position.copy(this.pos0); camera.quaternion.copy(this.quat0); return; }
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
