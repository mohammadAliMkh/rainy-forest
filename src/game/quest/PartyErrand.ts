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
import { SplitScene } from './SplitScene.ts';
import { ChaseScene } from './ChaseScene.ts';
import { CrossFight } from './CrossFight.ts';
import { ReturnScene } from './ReturnScene.ts';
import { Wraith } from '../scenario/Wraith.ts';
import { GHOST_IN, CREEP_STOP, LINE_UP, CHASE, CHASE_SHOTS, RETURN_LEADS } from '../scenario/ghostScript.ts';
import { makeAmulet } from '../items/Amulet.ts';
import type { Inventory } from '../items/Inventory.ts';
import type { Hands } from '../player/Hands.ts';
import { TITLE, BANNERS, LINES, GOALS, HINTS, BASKET, RESCUE, rescueGoal, savedNote, NEAR_AMIR, KEEPER_GIVES_AT } from './errandScript.ts';

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
//   -> it trembles and tears into four, one opposite each of them
//   (SplitScene.ts) -> they run for it, each a different way into the woods, each ghost after its
//   own, and each is caught somewhere out there (ChaseScene.ts); you are back on the porch -> save
//   the four: the goal line counts them, the box lists them, each one blinks on the map; close to
//   a ghost, the stone cross in hand, it's a fight (CrossFight.ts): win and its friend stands
//   free; lose, or run out of the minute there is for all four, and it starts again from the
//   moment they ran for it -> the last one free: they all come back to the fire and sit down
//   (ReturnScene.ts) -> (the rest of the story comes next: you take the shopping to Amir).
// Night falls as you step out of the shop; with «روح ترسناک» on, in heavy rain.
// What to do now is announced as QUEST (the goal line and the basket),
// lines people say as DIALOG, its name at the start and the end and
// "shopping done" as BANNER; `mapTarget()` is what blinks on the map.

/** the last ghost gone: how long before they all come back (s) */
const AFTER_LAST = 1.7;

type Step = 'wait' | 'toAmir' | 'amirTalks' | 'toStore' | 'shop' | 'pay' | 'keeper' | 'leave' | 'pickles' | 'ghost' | 'fire' | 'rescue' | 'saved';

interface PlayerLike { x: number; z: number; y: number; yaw: number; pitch: number; teleport(x: number, z: number, yaw?: number): void }
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
  /** the ghost and the three it splits off at the fire */
  readonly wraiths: Wraith[];
  /** the jar opened: the whirlwind and the ghost (a film scene) */
  readonly jarScene: JarScene;
  /** the sky rises from the porch and comes down on the friends at the fire (a film scene) */
  readonly skyShot: SkyShot;
  /** the ghost creeps up on the friends from behind the cabin (a film scene) */
  readonly creepScene: CreepScene;
  /** the friends see it and line up facing it (a film scene) */
  readonly lineUpScene: LineUpScene;
  /** it trembles and becomes four (a film scene) */
  readonly splitScene: SplitScene;
  /** they run for it, each caught out there with a ghost over them (a film scene; they stay so) */
  readonly chaseScene: ChaseScene;
  /** the fight with a ghost, the stone cross against it */
  readonly fight: CrossFight;
  /** the last one free: they all come back to the fire (a film scene) */
  readonly returnScene: ReturnScene;
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
  /** those of the four saved so far (by name) */
  readonly saved = new Set<string>();
  private t = 0; // seconds in this step
  private blinkT = 0;
  private returned = false; // the film of their coming back has been shown

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
    this.wraiths = [this.wraith, new Wraith(terrain), new Wraith(terrain), new Wraith(terrain)];
    for (const w of this.wraiths) world.add(w.group);
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
    // ...and it becomes four, one opposite each of them
    const order = Object.keys(LINE_UP).sort((a, b) => LINE_UP[a].spot[0] - LINE_UP[b].spot[0]);
    this.splitScene = new SplitScene({ wraiths: this.wraiths, events, voices, sky: this.nightfall, guitar, dog: () => camp.dog ?? null, order });
    camp.films.push(this.splitScene);
    // ...and they run for it, each with a ghost after them
    this.chaseScene = new ChaseScene({
      wraiths: this.wraiths, events, voices, sky: this.nightfall, guitar, dog: () => camp.dog ?? null,
      gathering: camp.gathering, terrain, standing: () => this.lineUpScene.standing(), order, routes: CHASE, shots: CHASE_SHOTS,
    });
    camp.films.push(this.chaseScene);
    world.add(this.chaseScene.light);
    // ...and you go and save them
    this.fight = new CrossFight({
      chase: this.chaseScene, inventory, hands, player, events, voices, picker,
      touch, indoors: () => store.playerInside, ground: (x, z) => terrain.heightAt(x, z),
    });
    camp.films.push(this.fight);
    this.fight.onSaved = (key) => this._saved(key);
    this.fight.onDead = () => this._again();
    // ...and when all are free, back they come
    this.returnScene = new ReturnScene({
      events, chase: this.chaseScene, guitar, fire: FIRE, shot: () => this.skyShot.shotPos(),
      ground: (x, z) => terrain.heightAt(x, z), leads: RETURN_LEADS,
    });
    camp.films.push(this.returnScene);
    this.splitScene.then = (skipped) => this.chaseScene.start(this.camera as THREE.PerspectiveCamera, this.splitScene.takeActs(), this.splitScene.placesNow(), this.splitScene.takeVoices(), skipped);
    this.lineUpScene.then = (skipped) => this.splitScene.start(this.camera as THREE.PerspectiveCamera, this.lineUpScene.takeActs(), this.lineUpScene.takeVoice(), skipped);
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

  /** everywhere that blinks on the map now: where to go next, or each of the four still out there */
  mapTargets(): { x: number; z: number }[] {
    if (this.step === 'rescue') {
      return RESCUE.filter((r) => !this.saved.has(r.key)).flatMap((r) => {
        const p = this.camp.gathering.byName(r.key);
        return p ? [p.h.root.position] : [];
      });
    }
    const t = this.mapTarget();
    return t ? [t] : [];
  }

  private _go(step: Step): void {
    this.step = step;
    if (step === 'rescue') this.fight.begin();
    else this.fight.end();
    this.t = 0;
    this._announce();
  }

  // the goal line and the basket
  private _announce(): void {
    // while Amir talks / the ghost is out, the goal before stays up
    const key = this.step === 'amirTalks' ? 'toAmir' : this.step === 'ghost' ? 'pickles' : this.step === 'keeper' ? 'pay' : this.step;
    const goal = key === 'rescue' ? rescueGoal(this.saved.size) : (GOALS as Record<string, string>)[key];
    if (!goal) { this.events.emit(EV.QUEST, null); return; }
    // the basket only while shopping (once paid for it fades away)
    const basket = this.step === 'rescue' ? RESCUE.map((r) => ({ label: r.label, got: this.saved.has(r.key) }))
      : ['shop', 'pay'].includes(this.step) ? BASKET.map((b) => ({ label: b.label, got: this.got.has(b.key) })) : null;
    const hint = this.step === 'rescue' ? HINTS.rescue : ['shop', 'pay', 'pickles'].includes(this.step) ? (this.touch() ? HINTS.tap : HINTS.click) : null;
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

  // one of the four is free
  private _saved(key: string): void {
    this.saved.add(key);
    const r = RESCUE.find((x) => x.key === key);
    if (this.saved.size < RESCUE.length) {
      if (r) this.events.emit(EV.BANNER, { text: savedNote(r.label), kind: 'note', seconds: 2.6 });
      this._announce();
    } else {
      this.events.emit(EV.BANNER, { text: BANNERS.allSaved, kind: 'title', seconds: 3.5 });
      this._go('saved');
    }
  }

  // the friends in the line, the four ghosts facing them, the camera on them: as they are about to run for it
  private _beforeChase(): void {
    const cam = this.camera as THREE.PerspectiveCamera, shot = this.skyShot.shotPos();
    cam.fov = 55;
    cam.updateProjectionMatrix();
    this.creepScene.setEnd(cam, shot);
    this.splitScene.setEnd(cam, this.lineUpScene.setEnd(cam, shot));
  }

  private _toPorch(): void {
    const st = this.store.errand.jarStage();
    this.player.teleport(st.stand.x, st.stand.z, Math.atan2(-(st.woods.x - st.stand.x), -(st.woods.z - st.stand.z)));
  }

  // you are dead: from the moment the ghosts went for them, all over again (behind the black)
  private _again(): void {
    this.saved.clear();
    this.returned = false;
    this.inventory.equip(null);
    this.chaseScene.reset();
    this._toPorch();
    this._go('fire');
    this._beforeChase();
    this.chaseScene.start(this.camera as THREE.PerspectiveCamera, this.splitScene.takeActs(), this.splitScene.placesNow(), []);
  }

  /**
   * while developing (?stage=N): straight into stage N of the ghost's story
   * (2 the jar, 5 the sky shot, 6 it creeps up, 7 the line-up, 8 it splits,
   * 9 they run for it, 10 go and save them, 11 the same but right by a ghost, 12 all saved and
   * back they come; see STATUS.md), as if all before had happened: the
   * shopping and the amulet in the bag, night fallen, you on the shop's porch
   * (where the films leave you), and what the scene before left
   */
  jumpTo(stage: number): void {
    for (const k of ERRAND_ITEMS) if (!this.got.has(k)) { this.got.add(k); this.inventory.add(k); this.store.errand.items[k].visible = false; }
    if (!this.hasAmulet) { this.hasAmulet = true; this.inventory.add('amulet'); }
    this.store.errand.cash.visible = true;
    this.haunted = this.scary();
    this.nightfall.dusk();
    this.nightfall.fall(this.haunted, 0.1);
    if (stage <= 4) { this._go('pickles'); this._openJar(); return; }
    this.got.add('pickles');
    this.inventory.add('pickles');
    this._go('fire');
    const st = this.store.errand.jarStage();
    this._toPorch();
    const cam = this.camera as THREE.PerspectiveCamera, shot = this.skyShot.shotPos();
    cam.fov = 55;
    cam.updateProjectionMatrix();
    if (stage === 5) {
      cam.position.copy(st.view);
      cam.lookAt(st.woods);
      this.skyShot.start(cam);
    } else if (stage === 6) {
      cam.position.copy(shot);
      cam.lookAt(FIRE.x, shot.y - 0.65, FIRE.z);
      this.creepScene.start(cam, shot);
    } else {
      this.creepScene.setEnd(cam, shot);
      // (the ghost's recording where it would be by then: its last swell)
      if (stage === 7) this.lineUpScene.start(cam, shot, this.voices()?.play('ghost_appear', shot, { gain: 1, from: 18.5, length: 11.3 }) ?? null);
      else if (stage === 8) this.splitScene.start(cam, this.lineUpScene.setEnd(cam, shot), null);
      else {
        this.splitScene.setEnd(cam, this.lineUpScene.setEnd(cam, shot));
        if (stage === 9) this.chaseScene.start(cam, this.splitScene.takeActs(), this.splitScene.placesNow(), []);
        else this.chaseScene.setEnd(this.splitScene.takeActs(), this.splitScene.placesNow());
        // (a few steps from the ghost behind the shop, facing it)
        if (stage === 11) {
          const [gx, gz] = CHASE.owner.ghost, x = gx, z = gz - 9;
          this.player.teleport(x, z, Math.atan2(-(gx - x), -(gz - z)));
        }
        if (stage >= 12) {
          for (const r of RESCUE) { this.saved.add(r.key); this.chaseScene.banishNow(r.key); }
          this._go('saved');
        }
      }
    }
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
    this.splitScene.update(dt);
    this.chaseScene.update(dt);
    this.fight.update(dt);
    this.returnScene.update(dt);
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
      case 'saved':
        // the last ghost gone into the cross: they all come back
        if (!this.returned && this.t > AFTER_LAST) { this.returned = true; this.returnScene.start(); }
        break;
      case 'fire':
        // the films are over and you are back on the porch: now go and save them
        if (!this.skyShot.active && !this.creepScene.active && !this.lineUpScene.active && !this.splitScene.active && !this.chaseScene.active) {
          this.events.emit(EV.BANNER, { text: BANNERS.rescue, kind: 'title', seconds: 3.5 });
          this._go('rescue');
        }
        break;
    }
  }
}
