import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Camp } from '../camp/Camp.js';
import type { Store } from '../store/Store.ts';
import { ERRAND_ITEMS, type ErrandItem } from '../store/ErrandProps.ts';
import type { Picker } from '../player/Picker.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import { FIRE, CABIN } from '../../config/config.js';
import { AmirScene, VOICE_GAIN } from './AmirScene.ts';
import { Nightfall } from './Nightfall.ts';
import { KeeperScene } from './KeeperScene.ts';
import { JarScene } from './JarScene.ts';
import { SkyShot } from './SkyShot.ts';
import { CreepScene } from './CreepScene.ts';
import { LineUpScene } from './LineUpScene.ts';
import { Wraith } from '../scenario/Wraith.ts';
import { GHOST_IN, CREEP_STOP, LINE_UP } from '../scenario/ghostScript.ts';
import { makeAmulet } from '../items/Amulet.ts';
import type { Inventory } from '../items/Inventory.ts';
import type { Hands } from '../player/Hands.ts';
import { TITLE, BANNERS, LINES, GOALS, HINTS, BASKET, NEAR_AMIR, KEEPER_GIVES_AT } from './errandScript.ts';

// The first errand, step by step, after the introductions:
//   Amir's spot blinks on the map -> walk up to him: he asks you to fetch
//   snacks for tonight's party from Farajpour's -> the shop blinks on the
//   map -> inside, the chips, puffs, yogurt and a drink blink: click each
//   into the basket (your hand takes each one) -> pay Farajpour (click him):
//   he talks to you as a film scene and holds out a stone amulet against the
//   ghost; you take it, and it goes in your bag -> step outside: he calls
//   after you to help yourself to pickles from the jar by the door -> lift
//   its lid: a film scene (JarScene.ts) - a whirlwind spins up out of the
//   jar and gathers into the ghost's true shape, the ground shakes and the
//   sky turns red; then it goes off into the woods, fading, and the sky
//   turns back; the pickles go in your bag with the rest of the shopping ->
//   in the same shot the camera rises into the sky and comes down on the
//   four friends at the fire (SkyShot.ts) -> and on: the ghost creeps up on
//   them from behind the cabin, the sky turning red again (CreepScene.ts) ->
//   they see it, get up and line up across the fire facing it (LineUpScene.ts)
//   -> (the rest of the story comes next; at its very end you take the shopping
//   to Amir).
// Night falls as you step out of the shop; with «روح ترسناک» on, in heavy rain.
// What to do now is announced as QUEST (the goal line and the basket),
// lines people say as DIALOG, its name at the start and the end and
// "shopping done" as BANNER; `mapTarget()` is what blinks on the map.

type Step = 'wait' | 'toAmir' | 'amirTalks' | 'toStore' | 'shop' | 'pay' | 'keeper' | 'leave' | 'pickles' | 'ghost' | 'fire' | 'next';

interface PlayerLike { x: number; z: number; y: number; yaw: number; pitch: number }
type Night = ConstructorParameters<typeof Nightfall>[0];

/** a copy of `o` (without `leave`), about 20 cm across, centred: for the hand */
function inHand(o: THREE.Object3D, leave?: THREE.Object3D): THREE.Object3D {
  const c = o.clone();
  if (leave) c.children[o.children.indexOf(leave)]?.removeFromParent();
  c.position.set(0, 0, 0); c.quaternion.identity(); c.scale.setScalar(1); c.visible = true;
  c.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(c), size = box.getSize(new THREE.Vector3());
  const k = 0.2 / Math.max(size.x, size.y, size.z);
  c.scale.setScalar(k);
  c.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-k);
  const g = new THREE.Group();
  g.add(c);
  return g;
}

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
  /** the ghost's true shape: out of the pickle jar */
  readonly wraith: Wraith;
  /** the jar opened: the whirlwind and the ghost (a film scene) */
  readonly jarScene: JarScene;
  /** the sky rises from the porch and comes down on the friends at the fire (a film scene) */
  readonly skyShot: SkyShot;
  /** the ghost creeps up on the friends from behind the cabin (a film scene) */
  readonly creepScene: CreepScene;
  /** the friends see it and line up facing it (a film scene) */
  readonly lineUpScene: LineUpScene;
  /** night (and heavy rain) from leaving the shop */
  readonly nightfall: Nightfall;
  /** paying: Farajpour talks to you and gives you the amulet */
  readonly keeperScene: KeeperScene;
  /** you have the amulet (in your bag) */
  hasAmulet = false;
  private readonly hands: Hands;
  private readonly inventory: Inventory;
  private readonly scary: () => boolean;
  /** this time round the night is stormy (read on leaving the shop) */
  haunted = false;
  private readonly got = new Set<string>();
  private t = 0; // seconds in this step
  private blinkT = 0;

  constructor({ camp, store, player, picker, events, terrain, world, voices, touch, camera, night, scary, hands, inventory, shoo, cabin }: {
    camp: Camp; store: Store; player: PlayerLike; picker: Picker; events: EventBus<GameEvents>;
    terrain: { heightAt(x: number, z: number): number }; world: THREE.Object3D;
    voices: () => VoiceService | null; touch: () => boolean; camera: THREE.Camera;
    night: Night; scary: () => boolean; hands: Hands; inventory: Inventory;
    /** the deer near (x, z) leave (out of a film shot) */
    shoo: (x: number, z: number, r: number) => void;
    /** the cabin's model (the ghost hides behind it) */
    cabin: THREE.Object3D;
  }) {
    this.hands = hands;
    this.inventory = inventory;
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
    this.wraith = new Wraith(terrain);
    world.add(this.wraith.group);
    this.scary = scary;
    this.nightfall = new Nightfall(night);
    this.jarScene = new JarScene({ wraith: this.wraith, events, voices, sky: this.nightfall, ground: (x, z) => terrain.heightAt(x, z) });
    camp.films.push(this.jarScene);
    // the jar scene carries on, in the same shot, up into the sky and down to the fire
    const [lx, lz] = GHOST_IN[0];
    this.skyShot = new SkyShot({ events, ground: (x, z) => terrain.heightAt(x, z), fire: FIRE, lair: { x: lx, z: lz }, shoo });
    camp.films.push(this.skyShot);
    // ...and on, in the same shot: the ghost comes out from behind the cabin
    const guitar = (mode: 'auto' | 'on' | 'off') => { camp.gathering.guitar = mode; };
    this.creepScene = new CreepScene({
      wraith: this.wraith, events, voices, guitar, sky: this.nightfall, ground: (x, z) => terrain.heightAt(x, z), fire: FIRE,
      corner: { x: CABIN.x - CABIN.width / 2, z: CABIN.z + CABIN.depth / 2 }, cabin: CABIN, occluder: cabin, stop: CREEP_STOP,
      dog: () => camp.dog ?? null,
    });
    camp.films.push(this.creepScene);
    // ...and they see it
    this.lineUpScene = new LineUpScene({
      wraith: this.wraith, events, gathering: camp.gathering, terrain, sky: this.nightfall, guitar,
      dog: () => camp.dog ?? null, fire: FIRE, routes: LINE_UP,
    });
    camp.films.push(this.lineUpScene);
    this.creepScene.then = (skipped) => this.lineUpScene.start(this.camera as THREE.PerspectiveCamera, this.skyShot.shotPos(), this.creepScene.takeVoice(), skipped);
    // (the pickles go in the bag after all)
    this.jarScene.then = (skipped) => {
      this.got.add('pickles');
      this.inventory.add('pickles');
      this.skyShot.start(this.camera, skipped);
      this._go('fire');
    };
    this.skyShot.then = (skipped) => this.creepScene.start(this.camera, this.skyShot.shotPos(), skipped);
    // the amulet he holds out to you (you take it into your bag)
    const given = makeAmulet();
    given.visible = false;
    world.add(given);
    this.keeperScene = new KeeperScene({
      keeper: store.shopkeeper, events, voices, amulet: given, hands,
      onGiven: () => { this.hasAmulet = true; this.inventory.add('amulet'); },
    });
    camp.films.push(this.keeperScene);
    const props = store.errand;
    // in the bag: copies of the goods (and the jar, without its lid), small enough for the hand
    for (const key of ERRAND_ITEMS) inventory.define(key, () => inHand(props.items[key]));
    inventory.define('pickles', () => inHand(props.jar, props.lid));
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


  /** what blinks on the map now (world x / z), or null */
  mapTarget(): { x: number; z: number } | null {
    switch (this.step) {
      case 'toAmir': {
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
    const key = this.step === 'amirTalks' ? 'toAmir' : this.step === 'ghost' ? 'pickles' : this.step === 'keeper' ? 'pay' : this.step;
    const goal = (GOALS as Record<string, string>)[key];
    if (!goal) { this.events.emit(EV.QUEST, null); return; }
    // the basket only while shopping (once paid for it fades away)
    const basket = ['shop', 'pay'].includes(this.step) ? BASKET.map((b) => ({ label: b.label, got: this.got.has(b.key) })) : null;
    const hint = ['shop', 'pay', 'pickles'].includes(this.step) ? (this.touch() ? HINTS.tap : HINTS.click) : null;
    this.events.emit(EV.QUEST, { title: TITLE, objective: goal, hint, basket });
  }

  private _cue(cue: 'pickup' | 'pay' | 'lid' | 'boo' | 'giggle' | 'laughDeep' | 'vanish', at: THREE.Vector3): void {
    this.events.emit(EV.SCENARIO_CUE, { cue, position: at.clone() });
  }

  private _take(key: ErrandItem): void {
    const m = this.store.errand.items[key];
    this.store.errand.setBlink(m, false);
    // your hand takes it off the shelf (the other hand if that one is busy)
    const free = !this.hands.right.step ? 'right' : !this.hands.left.step ? 'left' : null;
    if (free) this.hands.take(m, free, { reach: 0.45, onDone: () => this.inventory.add(key) });
    else { m.visible = false; this.inventory.add(key); }
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
    // he thanks you, warns you about the jar and gives you the amulet
    this.keeperScene.start(LINES.thanks, this.camera, KEEPER_GIVES_AT);
    this._go('keeper');
  }



  private _openJar(): void {
    const props = this.store.errand;
    props.popLid();
    props.setBeacon(null);
    const mouth = props.jarMouthWorld();
    this._cue('lid', mouth);
    // a film scene there on the porch, from the moment the lid comes off
    const stage = props.jarStage();
    this.jarScene.start(mouth, stage.stand, stage.view, stage.woods);
    this._go('ghost');
  }

  /** system "errand": follows the player through the steps */
  update(dt: number): void {
    this.t += dt;
    this.blinkT += dt;
    this.amirScene.update(dt);
    this.keeperScene.update(dt);
    this.jarScene.update(dt);
    this.skyShot.update(dt);
    this.creepScene.update(dt);
    this.lineUpScene.update(dt);
    this.nightfall.update(dt);
    const camp = this.camp, store = this.store;
    const amir = camp.gathering.byName('amir');
    const toAmir = amir ? Math.hypot(this.player.x - amir.seat.x, this.player.z - amir.seat.z) : Infinity;
    // Amir blinks like the goods on the shelves while you are meant to go to him
    if (amir) {
      const waiting = this.step === 'toAmir' && !camp.cinematic;
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
        // on your way to the shop the sun goes down
        if (!this.amirScene.filming) { this.nightfall.dusk(); this._go('toStore'); }
        break;
      case 'toStore':
        if (store.playerInside) {
          for (const k of ERRAND_ITEMS) store.errand.setBlink(store.errand.items[k], true);
          this._go('shop');
        }
        break;
      case 'keeper':
        // the scene is over: shopping done, the amulet is yours
        if (!this.keeperScene.filming) {
          this.events.emit(EV.BANNER, { text: BANNERS.bought, kind: 'note', seconds: 2.6 });
          this._go('leave');
        }
        break;
      case 'leave':
        // out of the door: he calls after you about the pickles
        if (!store.playerInside && this.t > 0.5) {
          // night falls (in heavy rain, unless the scary ghost is switched off)
          this.haunted = this.scary();
          this.nightfall.fall(this.haunted);
          // (only his recording, if there is one: no caption box - the goal line says it)
          const k = store.shopkeeper;
          const v = this.voices()?.play(LINES.pickles.voice, k.human.headPivot.getWorldPosition(new THREE.Vector3()), { duck: true, gain: VOICE_GAIN }) ?? null;
          if (v) k.speak(v.duration);
          store.errand.setBlink(store.errand.lid, true);
          store.errand.setBeacon('jar');
          this._go('pickles');
        }
        break;
      case 'fire':
        // the ghost at the fire: the rest of the story comes next
        if (!this.skyShot.active && !this.creepScene.active && !this.lineUpScene.active) this._go('next');
        break;
    }
  }
}
