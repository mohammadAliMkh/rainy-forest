import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Camp } from '../camp/Camp.js';
import type { Store } from '../store/Store.ts';
import { ERRAND_ITEMS, type ErrandItem } from '../store/ErrandProps.ts';
import type { Picker } from '../player/Picker.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import { Ghost, type GhostFace } from '../scenario/Ghost.ts';
import { FIRE } from '../../config/config.js';
import { AmirScene } from './AmirScene.ts';
import { Nightfall, NightWalk } from './NightWalk.ts';
import { TwistScene } from './TwistScene.ts';
import { TITLE, BANNERS, LINES, GOALS, HINTS, BASKET, NEAR_AMIR, DELIVER_AT } from './errandScript.ts';

// The first errand, step by step, after the introductions:
//   Amir's spot blinks on the map -> walk up to him: he asks you to fetch
//   snacks for tonight's party from Farajpour's -> the shop blinks on the
//   map -> inside, the chips, puffs, yogurt and a drink blink: click each
//   into the basket -> pay Farajpour (click him) -> step outside: he calls
//   after you to help yourself to pickles from the jar by the door -> lift
//   its lid: the sheet ghost bursts out of the jar and flies off into the
//   woods -> take the shopping back to Amir: scenario 1 plays, and once
//   everyone has fled into the trees you are back in control while they
//   come back to their seats.
// With «روح ترسناک» on (read as you step out of the shop) night falls on
// the way back: the walk is haunted (NightWalk.ts), the ghost is the scary
// one, and after the end a twist (TwistScene.ts) shows it sitting at the
// fire with a glass of tea; then the night lifts.
// What to do now is announced as QUEST (the goal line and the basket),
// lines people say as DIALOG, its name at the start and the end and
// "shopping done" as BANNER; `mapTarget()` is what blinks on the map.

type Step = 'wait' | 'toAmir' | 'amirTalks' | 'toStore' | 'shop' | 'pay' | 'leave' | 'pickles' | 'ghost' | 'deliver' | 'scene' | 'done';

interface Line { speaker: string; voice: string; text: string }
interface PlayerLike { x: number; z: number; y: number; yaw: number; pitch: number }
type Night = ConstructorParameters<typeof Nightfall>[0];
// the scary look's moods for the jar act
const SCARY_FACE: Partial<Record<GhostFace, GhostFace>> = { boo: 'scream', happy: 'grin' };

export class PartyErrand {
  step: Step = 'wait';
  private readonly camp: Camp;
  private readonly store: Store;
  private readonly player: PlayerLike;
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly touch: () => boolean;
  private readonly camera: THREE.Camera;
  /** Amir's talk with the player (the errand begins) */
  readonly amirScene: AmirScene;
  /** the ghost in the pickle jar (also the one on the haunted walk back and in the twist) */
  readonly jarGhost: Ghost;
  /** night and heavy rain on the way back, lifted after the twist */
  readonly nightfall: Nightfall;
  /** the scares on the way back */
  readonly nightWalk: NightWalk;
  /** the ghost at the fire with a glass of tea, after the end */
  readonly twist: TwistScene;
  private readonly scary: () => boolean;
  /** this time round the walk back is haunted (read on leaving the shop) */
  haunted = false;
  private twistDone = false;
  private readonly got = new Set<string>();
  private t = 0; // seconds in this step
  private blinkT = 0;
  private fly = new THREE.Vector3();
  private readonly from = new THREE.Vector3();

  constructor({ camp, store, player, picker, events, terrain, collision, world, voices, touch, camera, night, scary }: {
    camp: Camp; store: Store; player: PlayerLike; picker: Picker; events: EventBus<GameEvents>;
    terrain: { heightAt(x: number, z: number): number; pathDistance(x: number, z: number): number; pathLine: ArrayLike<number>[] };
    collision: { isBlocked(x: number, z: number, radius?: number): boolean }; world: THREE.Object3D;
    voices: () => VoiceService | null; touch: () => boolean; camera: THREE.Camera;
    night: Night; scary: () => boolean;
  }) {
    this.camp = camp;
    this.store = store;
    this.player = player;
    this.events = events;
    this.voices = voices;
    this.touch = touch;
    this.camera = camera;
    // Amir getting up to ask you, as a film scene
    this.amirScene = new AmirScene({ gathering: camp.gathering, terrain, events, voices });
    camp.films.push(this.amirScene);
    this.jarGhost = new Ghost(terrain);
    world.add(this.jarGhost.group);
    this.scary = scary;
    this.nightfall = new Nightfall(night);
    const shop = store.mapShape();
    this.nightWalk = new NightWalk({
      ghost: this.jarGhost, events, player, terrain, collision, lighting: night.lighting,
      dog: () => camp.dog ?? null, from: shop, to: FIRE,
    });
    this.twist = new TwistScene({ ghost: this.jarGhost, terrain, events, shared: camp.shared, fire: FIRE, trail: terrain.pathLine });
    camp.films.push(this.twist);
    const props = store.errand;
    // the goods: click one to put it in the basket
    for (const key of ERRAND_ITEMS) {
      picker.add({
        object: props.items[key], reach: 2.6,
        enabled: () => this.step === 'shop' && !this.got.has(key),
        onPick: () => this._take(key),
      });
    }
    // paying: click Farajpour
    picker.add({ object: props.keeperProxy, reach: 3.4, enabled: () => this.step === 'pay', onPick: () => this._pay() });
    // the pickle jar's lid
    picker.add({ object: props.lid, reach: 2.6, enabled: () => this.step === 'pickles', onPick: () => this._openJar() });
  }

  get finished(): boolean { return this.step === 'done'; }

  /** what blinks on the map now (world x / z), or null */
  mapTarget(): { x: number; z: number } | null {
    switch (this.step) {
      case 'toAmir': case 'deliver': {
        const a = this.camp.gathering.byName('amir');
        return a ? { x: a.seat.x, z: a.seat.z } : null;
      }
      case 'toStore': case 'leave': case 'pickles': {
        const s = this.store.mapShape();
        return { x: s.x, z: s.z };
      }
      default: return null;
    }
  }

  private _go(step: Step): void {
    this.step = step;
    this.t = 0;
    this._announce();
  }

  // the goal line and the basket
  private _announce(): void {
    // while Amir talks / the ghost is out, the goal before stays up
    const key = this.step === 'amirTalks' ? 'toAmir' : this.step === 'ghost' ? 'pickles' : this.step;
    const goal = (GOALS as Record<string, string>)[key];
    if (!goal) { this.events.emit(EV.QUEST, null); return; }
    // the basket only while shopping (once paid for it fades away)
    const basket = ['shop', 'pay'].includes(this.step) ? BASKET.map((b) => ({ label: b.label, got: this.got.has(b.key) })) : null;
    const hint = ['shop', 'pay', 'pickles'].includes(this.step) ? (this.touch() ? HINTS.tap : HINTS.click) : null;
    this.events.emit(EV.QUEST, { title: TITLE, objective: goal, hint, basket });
  }

  // someone says a line: a recording if there is one, the caption either way
  private _say(line: Line, from: THREE.Vector3): number {
    const v = this.voices()?.play(line.voice, from) ?? null;
    const seconds = v ? v.duration + 0.4 : Math.max(3.5, line.text.length * 0.075);
    this.events.emit(EV.DIALOG, { speaker: line.speaker, text: line.text, seconds });
    return seconds;
  }

  private _cue(cue: 'pickup' | 'pay' | 'lid' | 'boo' | 'giggle' | 'laughDeep' | 'vanish', at: THREE.Vector3): void {
    this.events.emit(EV.SCENARIO_CUE, { cue, position: at.clone() });
  }

  private _take(key: ErrandItem): void {
    const m = this.store.errand.items[key];
    m.visible = false;
    this.store.errand.setBlink(m, false);
    this.got.add(key);
    this._cue('pickup', m.getWorldPosition(new THREE.Vector3()));
    if (ERRAND_ITEMS.every((k) => this.got.has(k))) {
      this.store.errand.setBeacon('keeper');
      this._go('pay');
    } else this._announce();
  }

  private _pay(): void {
    const props = this.store.errand;
    props.cash.visible = true;
    props.setBeacon(null);
    this._cue('pay', props.cash.getWorldPosition(new THREE.Vector3()));
    const k = this.store.shopkeeper;
    k.nod();
    k.speak(this._say(LINES.thanks, k.human.headPivot.getWorldPosition(new THREE.Vector3())) - 0.4);
    this.events.emit(EV.BANNER, { text: BANNERS.bought, kind: 'note', seconds: 2.6 });
    this._go('leave');
  }

  private _openJar(): void {
    const props = this.store.errand;
    props.popLid();
    props.setBeacon(null);
    const mouth = props.jarMouthWorld();
    this._cue('lid', mouth);
    // out it comes, facing whoever opened the jar, then off sideways over the
    // porch railing into the woods (the shop's +x side, out from the wall)
    const g = this.jarGhost;
    g.setStyle(this.haunted ? 'scary' : 'funny');
    this.fly.set(1, 0, 0.55).transformDirection(this.store.group.matrixWorld).setY(0).normalize();
    Object.assign(g.pose, { x: mouth.x, z: mouth.z, heading: Math.atan2(this.player.x - mouth.x, this.player.z - mouth.z), lift: 0.1, lean: 0, tilt: 0, arms: 0, puff: 0, opacity: 1, face: 'boo' });
    g.group.scale.setScalar(0.3);
    this.from.copy(mouth);
    g.show(true);
    this._go('ghost');
  }

  // the ghost's little act out of the jar
  private _ghost(dt: number): void {
    const g = this.jarGhost, P = g.pose, t = this.t;
    const head = g.headWorld(new THREE.Vector3());
    if (t < 0.35) {
      // bursting out of the jar and growing
      const k = t / 0.35;
      g.group.scale.setScalar(0.3 + 0.55 * k * k);
      // up and a step back, to be seen whole
      Object.assign(P, { x: this.from.x + this.fly.x * 0.7 * k, z: this.from.z + this.fly.z * 0.7 * k, lift: 0.1 + 0.5 * k, arms: k, puff: k, face: 'boo' });
      if (t >= 0.08 && t - dt < 0.08) this._cue('boo', head);
    } else if (t < 1.4) {
      // BOO! in your face
      g.group.scale.setScalar(0.85);
      Object.assign(P, { lift: 0.6 + Math.sin(t * 8) * 0.04, arms: 1, puff: Math.max(0.2, 1 - (t - 0.35) * 0.8), lean: -0.1 });
    } else if (t < 2.4) {
      // giggling at its joke, a spin
      if (t - dt < 1.4) this._cue(this.haunted ? 'laughDeep' : 'giggle', head);
      Object.assign(P, { heading: P.heading + dt * Math.PI * 2, lift: 0.55 + Math.abs(Math.sin(t * 9)) * 0.08, tilt: Math.sin(t * 9) * 0.12, arms: 0.5, puff: 0, face: 'happy' });
    } else if (t < 5.4) {
      // off it flies, over the railing and into the trees, fading
      const k = t - 2.4;
      P.x += this.fly.x * dt * (2 + k * 2.2);
      P.z += this.fly.z * dt * (2 + k * 2.2);
      Object.assign(P, {
        heading: Math.atan2(this.fly.x, this.fly.z), lift: 0.6 + k * 0.45, lean: 0.35, tilt: Math.sin(t * 7) * 0.12, arms: 0.4, face: 'happy',
        opacity: 1 - Math.min(1, Math.max(0, (k - 1.8) / 1.2)),
      });
      if (k > 2.6 && k - dt <= 2.6) this._cue('vanish', head);
    } else {
      g.show(false);
      g.group.scale.setScalar(1);
      this.lookT = 0;
      // ...and the pickles go in the basket after all
      this.got.add('pickles');
      this._go('deliver');
      return;
    }
    if (this.haunted) P.face = SCARY_FACE[P.face] ?? P.face;
    g.update(dt);
    // the view is drawn up to it for a moment (from the jar it would be all sheet and no face)
    if (t < 3.6) this._lookToward(g.headWorld(new THREE.Vector3()).addScaledVector(new THREE.Vector3(0, 1, 0), -0.55), dt, t < 0.2 ? 0 : 1);
  }

  private lookT = 0;
  // turn the player's view toward a point, gently (strength 0..1)
  private _lookToward(at: THREE.Vector3, dt: number, strength: number): void {
    const pl = this.player;
    this.lookT = Math.min(1, this.lookT + dt * 2) * strength;
    const yaw = Math.atan2(-(at.x - pl.x), -(at.z - pl.z));
    const pitch = Math.atan2(at.y - pl.y, Math.hypot(at.x - pl.x, at.z - pl.z));
    let d = yaw - pl.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const k = 1 - Math.exp(-5 * dt * this.lookT);
    pl.yaw += d * k;
    pl.pitch += (pitch - pl.pitch) * k;
  }

  /** system "errand": follows the player through the steps */
  update(dt: number): void {
    this.t += dt;
    this.blinkT += dt;
    this.amirScene.update(dt);
    this.nightfall.update(dt);
    this.twist.update(dt);
    if (this.nightWalk.active) this.nightWalk.update(dt, this.step !== 'ghost');
    const camp = this.camp, store = this.store;
    const amir = camp.gathering.byName('amir');
    const toAmir = amir ? Math.hypot(this.player.x - amir.seat.x, this.player.z - amir.seat.z) : Infinity;
    // Amir blinks like the goods on the shelves while you are meant to go to him
    if (amir) {
      const waiting = (this.step === 'toAmir' || this.step === 'deliver') && !camp.cinematic;
      amir.h.setGlow(waiting ? 0.5 + 0.5 * Math.sin(this.blinkT * Math.PI * 2 * 1.1) : 0);
    }
    switch (this.step) {
      case 'wait':
        // after the introductions (played or skipped)
        if (camp.intro.done && !camp.cinematic && this.t > 1.5) {
          this.events.emit(EV.BANNER, { text: BANNERS.start, kind: 'title', seconds: 3.5 });
          this._go('toAmir');
        }
        break;
      case 'toAmir':
        if (toAmir < NEAR_AMIR && !camp.cinematic && amir) {
          // he gets up and talks to you, pointing the way to the shop at the end
          const s = store.mapShape();
          this.amirScene.start(LINES.amir, new THREE.Vector3(s.x, amir.headPos.y, s.z), this.camera);
          this._go('amirTalks');
        }
        break;
      case 'amirTalks':
        if (!this.amirScene.filming) this._go('toStore');
        break;
      case 'toStore':
        if (store.playerInside) {
          for (const k of ERRAND_ITEMS) store.errand.setBlink(store.errand.items[k], true);
          this._go('shop');
        }
        break;
      case 'leave':
        // out of the door: he calls after you about the pickles
        if (!store.playerInside && this.t > 0.5) {
          // night falls on the way back (unless the scary ghost is switched off)
          this.haunted = this.scary();
          if (this.haunted) { this.nightfall.fall(); this.nightWalk.start(); }
          const k = store.shopkeeper;
          k.speak(this._say(LINES.pickles, k.human.headPivot.getWorldPosition(new THREE.Vector3())) - 0.4);
          store.errand.setBlink(store.errand.lid, true);
          store.errand.setBeacon('jar');
          this._go('pickles');
        }
        break;
      case 'ghost':
        this._ghost(dt);
        break;
      case 'deliver':
        // (on the haunted walk, once Luna has sensed it coming)
        if (toAmir < DELIVER_AT && !camp.cinematic && this.nightWalk.ready) {
          this.nightWalk.stop();
          camp.scenario.start({ handBack: true, scary: this.haunted });
          this._go('scene');
        }
        break;
      case 'scene':
        // everyone is back on their seats: the end
        if (!camp.scenario.active) {
          this._go('done');
          this.events.emit(EV.BANNER, { text: BANNERS.end, kind: 'title', seconds: 4.5 });
        }
        break;
      case 'done':
        // ...or maybe not: once the end card has gone, the twist; then the night lifts
        if (this.haunted && !this.twistDone && this.t > 6 && !camp.cinematic) {
          this.twistDone = true;
          this.twist.start(() => this.nightfall.lift());
        }
        break;
    }
  }
}
