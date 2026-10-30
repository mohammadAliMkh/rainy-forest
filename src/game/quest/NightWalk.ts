import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Ghost } from '../scenario/Ghost.ts';
import type { WeatherKind, WeatherMode } from '../weather/Weather.ts';
import { GHOST_IN } from '../scenario/ghostScript.ts';

// The haunted walk back from Farajpour's (when «روح ترسناک» is on).
//
// Nightfall: the errand's own time of day. Once Amir has asked, the sun goes
// down while you walk to the shop; as you step out of it night comes down
// in a few seconds (on the haunted walk with heavy rain and the lantern
// burning low); after the end the hour, the weather and the speed of the
// day come back slowly.
//
// NightWalk: the scares on the way back, each fired once by how far along
// the way from the shop to the fire you are (so it works at any pace), and
// with the player in control all the time:
//   ~20 %  two red eyes in the dark between the trees, staring
//   ~30 %  footsteps behind you, echoing yours; turn round and they stop,
//          and a deep laugh answers from far away
//   ~45 / 65 / 80 %  a lightning flash shows the whole ghost standing among
//          the trees, nearer each time, gone as the light goes
//   ~85 %  a whisper circles your head
//   near the fire  Luna gets up, stares into the dark behind the cabin and
//          barks; then the scene at the fire may begin (`ready`)
// It moves the errand's jar ghost (one ghost out at a time).

interface PlayerLike { x: number; z: number; y: number; yaw: number }
interface DayLike { hour: number; cycleSeconds: number }
interface WeatherLike { mode: WeatherMode; kind: WeatherKind; setMode(mode: WeatherMode): void; setKind(kind: WeatherKind, seconds?: number): void }
interface LightingLike { lanternMax: number; readonly flashLevel: number }
interface DogLike { alertAt: THREE.Vector3 | null; readonly headWorld: THREE.Vector3 }
interface TerrainLike { heightAt(x: number, z: number): number; pathDistance(x: number, z: number): number }
interface CollisionLike { isBlocked(x: number, z: number, radius?: number): boolean }

const DUSK_HOUR = 18.3;
const NIGHT_HOUR = 22.5;
const LANTERN_LOW = 2.5;
/** shortest way round the clock from a to b (hours, -12..12) */
const hoursTo = (a: number, b: number) => ((b - a + 36) % 24) - 12;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export class Nightfall {
  /** the errand's own time of day is in force (dusk, night, or lifting) */
  active = false;
  /** it is night (or night is coming down) */
  night = false;
  private readonly day: DayLike;
  private readonly weather: WeatherLike;
  private readonly lighting: LightingLike;
  /** how it was before the errand took over the time of day */
  private saved: { hour: number; cycle: number; lantern: number } | null = null;
  private savedWeather: { mode: WeatherMode; kind: WeatherKind } | null = null;
  private h0 = 0;
  private dh = 0;
  private t = -1;
  private len = 1;
  private lifting = false;

  constructor({ day, weather, lighting }: { day: DayLike; weather: WeatherLike; lighting: LightingLike }) {
    this.day = day;
    this.weather = weather;
    this.lighting = lighting;
  }

  private _take(): void {
    if (this.saved) return;
    const { day, lighting } = this;
    this.saved = { hour: day.hour, cycle: day.cycleSeconds, lantern: lighting.lanternMax };
    day.cycleSeconds = 0; // the errand runs the clock now
    this.active = true;
    this.lifting = false;
  }

  /** the sun goes down while you walk to the shop (~12 s) */
  dusk(): void {
    this._take();
    this._go(DUSK_HOUR, 12);
  }

  /** night on the way back (~6 s); `haunted`: in heavy rain, the lantern burning low */
  fall(haunted: boolean): void {
    if (this.night) return;
    this._take();
    if (haunted) {
      const { weather, lighting } = this;
      this.savedWeather = { mode: weather.mode, kind: weather.kind };
      weather.setMode('rain');
      weather.setKind('heavy', 1200);
      lighting.lanternMax = LANTERN_LOW;
    }
    this._go(NIGHT_HOUR, 6);
    this.night = true;
  }

  /** back to how it was before the errand, the hour over ~10 s */
  lift(): void {
    if (!this.active || this.lifting || !this.saved) return;
    this.lighting.lanternMax = this.saved.lantern;
    const w = this.savedWeather;
    if (w) {
      this.weather.setMode(w.mode);
      if (w.mode !== 'dry') this.weather.setKind(w.kind);
      this.savedWeather = null;
    }
    this._go(this.saved.hour, 10);
    this.lifting = true;
  }

  private _go(hour: number, seconds: number): void {
    this.h0 = this.day.hour;
    this.dh = hoursTo(this.h0, hour);
    this.t = 0;
    this.len = seconds;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const k = smooth(this.t / this.len);
    this.day.hour = (((this.h0 + this.dh * k) % 24) + 24) % 24;
    if (this.t >= this.len) {
      this.t = -1;
      if (this.lifting) {
        this.day.cycleSeconds = this.saved!.cycle;
        this.saved = null;
        this.active = this.night = this.lifting = false;
      }
    }
  }
}

type Beat = 'eyes' | 'reveal' | null;
const REVEALS = [{ at: 0.45, dist: 18 }, { at: 0.65, dist: 11 }, { at: 0.8, dist: 6 }];
const ECHO_DELAY = 0.35;
const FOLLOW_MAX = 25;

export class NightWalk {
  /** the scares that have happened (read-only, for tests): eyes, steps, reveal1..3, whisper, luna */
  readonly fired = new Set<string>();
  active = false;
  private readonly ghost: Ghost;
  private readonly events: EventBus<GameEvents>;
  private readonly player: PlayerLike;
  private readonly terrain: TerrainLike;
  private readonly collision: CollisionLike;
  private readonly lighting: LightingLike;
  private readonly dog: () => DogLike | null;
  private readonly from = new THREE.Vector2();
  private readonly to = new THREE.Vector2();
  /** where it comes from at the fire: behind the cabin */
  private readonly lair: THREE.Vector3;
  private readonly rand: () => number;
  private clock = 0;
  private beat: Beat = null;
  private beatT = 0;
  private reveal = 0; // reveals done
  private hideT = 0;
  private waitT = 0; // how long a due beat has been looking for a good place
  private readonly spot = new THREE.Vector2();
  // footsteps behind you: when each echo is due, on what, walking or running
  private following = false;
  private followT = 0;
  private readonly due = new Float64Array(8);
  private readonly surf: GameEvents[typeof EV.PLAYER_STEP]['surface'][] = new Array(8).fill('leaves');
  private readonly run: boolean[] = new Array(8).fill(false);
  private qHead = 0;
  private qLen = 0;
  // which way the player has been walking
  private readonly walkDir = new THREE.Vector2(0, -1);
  private lastX = 0;
  private lastZ = 0;
  private lunaT = -1;
  private readonly flashDir = new THREE.Vector3();
  private readonly at = new THREE.Vector3();

  constructor({ ghost, events, player, terrain, collision, lighting, dog, from, to, rand = Math.random }: {
    ghost: Ghost; events: EventBus<GameEvents>; player: PlayerLike; terrain: TerrainLike; collision: CollisionLike;
    lighting: LightingLike; dog: () => DogLike | null; from: { x: number; z: number }; to: { x: number; z: number }; rand?: () => number;
  }) {
    this.ghost = ghost;
    this.events = events;
    this.player = player;
    this.terrain = terrain;
    this.collision = collision;
    this.lighting = lighting;
    this.dog = dog;
    this.from.set(from.x, from.z);
    this.to.set(to.x, to.z);
    const [lx, lz] = GHOST_IN[0];
    this.lair = new THREE.Vector3(lx, terrain.heightAt(lx, lz) + 1.2, lz);
    this.rand = rand;
    events.on(EV.PLAYER_STEP, ({ surface, running }) => {
      if (!this.following || this.qLen >= this.due.length) return;
      const i = (this.qHead + this.qLen) % this.due.length;
      this.due[i] = this.clock + ECHO_DELAY;
      this.surf[i] = surface;
      this.run[i] = running;
      this.qLen++;
    });
  }

  /** how far along from the shop to the fire the player is, 0..1 */
  get progress(): number {
    const ax = this.from.x, az = this.from.y;
    const dx = this.to.x - ax, dz = this.to.y - az;
    return Math.min(1, Math.max(0, ((this.player.x - ax) * dx + (this.player.z - az) * dz) / (dx * dx + dz * dz)));
  }

  /** Luna has sensed it and barked (or there is no Luna): the scene at the fire may start */
  get ready(): boolean { return !this.active || this.lunaT > 2.2 || (this.lunaT >= 0 && !this.dog()); }

  start(): void {
    this.active = true;
    this.fired.clear();
    this.beat = null;
    this.reveal = 0;
    this.following = false;
    this.qLen = 0;
    this.lunaT = -1;
    this.lastX = this.player.x;
    this.lastZ = this.player.z;
    this.walkDir.set(this.to.x - this.from.x, this.to.y - this.from.y).normalize();
  }

  /** the walk is over (the scene at the fire begins) */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.following = false;
    this.qLen = 0;
    if (this.beat) { this.ghost.show(false); this.beat = null; }
    this.ghost.setEyesOnly(0);
    const dog = this.dog();
    if (dog) dog.alertAt = null;
  }

  /** `ghostFree`: the ghost isn't busy elsewhere (it is during the jar act) */
  update(dt: number, ghostFree: boolean): void {
    if (!this.active) return;
    this.clock += dt;
    const pl = this.player;
    // which way they walk
    const mx = pl.x - this.lastX, mz = pl.z - this.lastZ;
    const moved = Math.hypot(mx, mz);
    if (moved > 0.01 && moved < 2) {
      const k = Math.min(1, dt * 4);
      this.walkDir.x += (mx / moved - this.walkDir.x) * k;
      this.walkDir.y += (mz / moved - this.walkDir.y) * k;
      this.walkDir.normalize();
    }
    this.lastX = pl.x; this.lastZ = pl.z;
    const p = this.progress;

    // the ghost's beats, one at a time
    if (this.beat) this._beat(dt);
    else if (ghostFree) {
      const eyesDue = p >= 0.2 && !this.fired.has('eyes');
      const revealDue = !eyesDue && this.reveal < REVEALS.length && this.fired.has('eyes') && p >= REVEALS[this.reveal].at;
      this.waitT = eyesDue || revealDue ? this.waitT + dt : 0;
      // first only places seen over the open trail; after a few seconds anywhere no trunk is in the way
      const open = this.waitT < 3;
      if (eyesDue && this._spot(20 + this.rand() * 5, 0.42, open)) this._eyes();
      else if (revealDue && this._spot(REVEALS[this.reveal].dist, 0.3, open)) this._reveal();
    }
    // no place for the eyes before the first flash is due: let them go, so the flashes still come
    if (p >= REVEALS[0].at && !this.fired.has('eyes') && !this.beat) this.fired.add('eyes');

    // footsteps behind you
    if (p >= 0.3 && !this.fired.has('steps')) { this.fired.add('steps'); this.following = true; this.followT = 0; }
    if (this.following) this._follow(dt);

    if (p >= 0.85 && !this.fired.has('whisper')) {
      this.fired.add('whisper');
      this.events.emit(EV.SCENARIO_CUE, { cue: 'whisper', position: this.at.set(pl.x, pl.y, pl.z) });
    }

    // Luna senses it, as you come up to the fire (the trail swings past the camp earlier on)
    const toFire = Math.hypot(pl.x - this.to.x, pl.z - this.to.y);
    if (this.lunaT < 0 && ((p >= 0.85 && toFire < 14) || p >= 0.93)) { this.lunaT = 0; this.fired.add('luna'); }
    if (this.lunaT >= 0) {
      const t0 = this.lunaT;
      this.lunaT += dt;
      const dog = this.dog();
      if (dog) {
        dog.alertAt = this.lair;
        for (const b of [0.7, 1.15, 1.5, 2.4]) if (t0 < b && this.lunaT >= b) this.events.emit(EV.SCENARIO_CUE, { cue: 'bark', position: dog.headWorld });
      }
    }
  }

  // a place `dist` ahead in the view (within `spread` radians of where the player
  // looks), beside the path, not in a tree trunk or a building, with nothing in
  // between; `open`: just off the trail, seen across it (no bushes in the way -
  // they grow from ~2 m off the path)
  private _spot(dist: number, spread: number, open: boolean): boolean {
    const pl = this.player;
    const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
    for (let i = 0; i < 24; i++) {
      const a = (this.rand() * 2 - 1) * spread, c = Math.cos(a), s = Math.sin(a);
      const d = dist * (0.92 + this.rand() * 0.16);
      const x = pl.x + (fx * c - fz * s) * d, z = pl.z + (fx * s + fz * c) * d;
      const off = this.terrain.pathDistance(x, z);
      if (off < 1.9 || (open && off > 2.8) || this.collision.isBlocked(x, z, 0.75)) continue;
      if (!this._clearView(x, z, open)) continue;
      this.spot.set(x, z);
      return true;
    }
    return false;
  }

  // nothing (a trunk, a building; with `open` also no plants) between the player and (x, z)
  private _clearView(x: number, z: number, open: boolean): boolean {
    const pl = this.player;
    const d = Math.hypot(x - pl.x, z - pl.z);
    for (let s = 1.2; s < d - 0.8; s += 0.6) {
      const k = s / d, sx = pl.x + (x - pl.x) * k, sz = pl.z + (z - pl.z) * k;
      if (this.collision.isBlocked(sx, sz, 0.3)) return false;
      if (open && s < d - 1.2 && this.terrain.pathDistance(sx, sz) > 1.9) return false;
    }
    return true;
  }

  private _place(lift: number): void {
    const g = this.ghost, pl = this.player;
    g.setStyle('scary');
    Object.assign(g.pose, {
      x: this.spot.x, z: this.spot.y, heading: Math.atan2(pl.x - this.spot.x, pl.z - this.spot.y),
      lift, lean: 0.04, tilt: 0, arms: 0.12, puff: 0, opacity: 1, face: 'stare',
    });
    g.group.scale.setScalar(1);
  }

  private _eyes(): void {
    this.fired.add('eyes');
    this._place(0.1);
    this.ghost.setEyesOnly(1);
    this.ghost.show(true);
    this.beat = 'eyes';
    this.beatT = 0;
  }

  private _reveal(): void {
    this.reveal++;
    this.fired.add(`reveal${this.reveal}`);
    this._place(0.3); // floating a little, above the ferns
    this.ghost.setEyesOnly(0);
    this.ghost.show(true);
    // the flash comes from beyond it; the thunder follows close
    const pl = this.player;
    this.flashDir.set(this.spot.x - pl.x, 0, this.spot.y - pl.z).normalize();
    this.flashDir.y = 0.45;
    this.flashDir.normalize();
    this.events.emit(EV.LIGHTNING, { direction: this.flashDir.clone(), strength: 1.1, delay: 0.4 + this.rand() * 0.4 });
    this.beat = 'reveal';
    this.beatT = 0;
    this.hideT = 0;
  }

  private _beat(dt: number): void {
    const g = this.ghost, P = g.pose, pl = this.player;
    this.beatT += dt;
    const d = Math.hypot(pl.x - P.x, pl.z - P.z);
    P.heading = Math.atan2(pl.x - P.x, pl.z - P.z);
    if (this.beat === 'eyes') {
      // still, staring; out when you come close or after a while
      if (d < 12 || this.beatT > 6) { g.show(false); g.setEyesOnly(0); this.beat = null; return; }
    } else {
      // seen only while the lightning lasts
      const level = this.lighting.flashLevel;
      g.setFlash(level);
      const bright = this.beatT < 0.12 || level > 0.22;
      if (!bright) this.hideT += dt;
      if (this.hideT > 0.15) { g.show(false); g.setFlash(0); this.beat = null; return; }
    }
    g.update(dt);
  }

  // every step of yours is answered a moment later a few metres behind you
  private _follow(dt: number): void {
    const pl = this.player;
    this.followT += dt;
    // facing back the way you came: they stop dead, and something laughs far off
    const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
    if (fx * this.walkDir.x + fz * this.walkDir.y < -0.5) {
      this.following = false;
      this.qLen = 0;
      const back = 24;
      const x = pl.x - this.walkDir.x * back, z = pl.z - this.walkDir.y * back;
      this.events.emit(EV.SCENARIO_CUE, { cue: 'laughDeep', position: this.at.set(x, this.terrain.heightAt(x, z) + 1.5, z) });
      return;
    }
    while (this.qLen > 0 && this.due[this.qHead] <= this.clock) {
      const x = pl.x - this.walkDir.x * 3, z = pl.z - this.walkDir.y * 3;
      this.events.emit(EV.SCENARIO_CUE, { cue: 'echoStep', position: this.at.set(x, this.terrain.heightAt(x, z) + 0.05, z), surface: this.surf[this.qHead], running: this.run[this.qHead] });
      this.qHead = (this.qHead + 1) % this.due.length;
      this.qLen--;
    }
    if (this.followT > FOLLOW_MAX && this.qLen === 0) this.following = false;
  }
}
