import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Wraith } from '../scenario/Wraith.ts';
import type { LineUp } from '../people/LineUp.ts';
import type { Gathering } from '../people/Gathering.ts';
import { Chase, type CaughtHow, type Trunk } from '../people/Chase.ts';
import type { VoiceService } from '../intro/IntroDirector.ts';
import type { VoiceHandle } from '../sound/Soundscape.ts';

// Once the ghost has torn into four, in the same shot: for a moment the
// friends stand frozen, each staring at their own, then they bolt - every one
// a different way into the dark - and each ghost sweeps after its own. Then
// one shot for each of them, cut together: Alireza slips in the big puddle on
// the trail and goes down in the water; Amin scrambles up a tree; Amir runs
// for his Patrol and ends up backed against it; the owner hides behind
// Farajpour's shop - and every time the ghost is there, over them. The sound:
// the ghost's laughter from its tearing goes on and on, each shot's part of
// it from that shot's ghost, its own recording swelling under the last two;
// a scream for each as they are caught (if there is a recording of it). Then
// a dip to black and back to the player (on the shop's porch): the four stay
// caught out there, each with its ghost over them, until they are saved.

interface DogLike { alertAt: THREE.Vector3 | null }
interface Route {
  path: [number, number][]; how: CaughtHow; ghost: [number, number];
  tree?: Trunk; shot: [number, number, number]; stare: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** the first shot, from behind where the line was, as they scatter (s) */
const SCATTER = 1.8;
/** off camera, those whose shot is still to come wait this far short of where they are caught (m) */
const LEAD = 6;
/** the ghosts: how far behind the one they chase (m); how fast they can go (m/s); how high they float running */
const GHOST = { gap: 2.2, speed: 5.5, lift: 0.3 };
/** how high each floats over the one it has caught: bowing down over the one on the ground or crouching, rising to the one up the tree */
const LOOM: Record<CaughtHow, number> = { cower: 0.1, fall: 0, climb: 1.25 };
/** in each shot a cold glow from its ghost lights the one it is after (colour, candela, reach m); how far down from its head */
const GLOW = { color: 0xb8ccff, intensity: 5, distance: 8, below: 0.7 };
/** the laughter of its tearing goes on from here in its recording (s), how loud */
const LAUGH = { from: 6.3, gain: 1.0 };
/** its own recording under the last two shots: its third swell (from, how long, how loud), from which shot */
const SWELL = { from: 22.0, length: 8.6, gain: 0.8, shot: 2 };
/** turned on the player, how near to them it comes at most (m) */
const CLOSE = 2.1;
/** the film camera's field of view in the shots */
const FOV = 50;

interface Ghost {
  w: Wraith; path: THREE.Vector2[]; total: number; before: number; s: number; head: THREE.Vector3; loom: number;
  /** it has been driven off (going, or gone) */
  gone: boolean;
  /** it has turned on the player: where they are, and how far toward them it has come (0..1) */
  to: THREE.Vector3 | null; lunge: number;
}

export class ChaseScene {
  /** the film camera has the view */
  filming = false;
  /** the four are out there, caught, each with its ghost over them (after the film, until they are saved) */
  caught = false;
  /** after the film: whose ghost's glow is on (by the name of its friend), how brightly */
  lit: string | null = null;
  litBy = 0;
  /** the glow from the ghost in the shot (to be added to the world) */
  readonly light = new THREE.PointLight(GLOW.color, 0, GLOW.distance, 1.6);
  private readonly wraiths: Wraith[];
  private readonly events: EventBus<GameEvents>;
  private readonly voices: () => VoiceService | null;
  private readonly sky: { calm(seconds?: number): void };
  private readonly guitar: (mode: 'auto' | 'on' | 'off') => void;
  private readonly dog: () => DogLike | null;
  private readonly gathering: Gathering;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private readonly standing: () => Map<string, LineUp>;
  private readonly order: string[];
  private readonly routes: Record<string, Route>;
  private readonly shots: [string, number][];
  private readonly chases = new Map<string, Chase>();
  private readonly ghosts = new Map<string, Ghost>();
  private held: VoiceHandle[] = [];
  private laugh: VoiceHandle | null = null;
  private swell: VoiceHandle | null = null;
  private t = -1;
  private time = 0;
  private shot = -1; // which shot (-1: the scatter)
  private ending = 0;
  private fade = 0;
  private readonly screamed = new Set<string>();
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly cam0 = new THREE.Vector3();
  private readonly quat0 = new THREE.Quaternion();
  private fov = 45;
  private snap = false;
  private readonly tLook = new THREE.Vector3();

  /** `order`: the friends left to right in the line (as the four ghosts are); `standing`: the friends at once in the line (when what came before was skipped) */
  constructor({ wraiths, events, voices, sky, guitar, dog, gathering, terrain, standing, order, routes, shots }: {
    wraiths: Wraith[]; events: EventBus<GameEvents>; voices: () => VoiceService | null;
    sky: { calm(seconds?: number): void }; guitar: (mode: 'auto' | 'on' | 'off') => void; dog: () => DogLike | null;
    gathering: Gathering; terrain: { heightAt(x: number, z: number): number }; standing: () => Map<string, LineUp>;
    order: string[]; routes: Record<string, Route>; shots: [string, number][];
  }) {
    this.wraiths = wraiths;
    this.events = events;
    this.voices = voices;
    this.sky = sky;
    this.guitar = guitar;
    this.dog = dog;
    this.gathering = gathering;
    this.terrain = terrain;
    this.standing = standing;
    this.order = order;
    this.routes = routes;
    this.shots = shots;
  }

  get active(): boolean { return this.t >= 0; }

  /** when the shot for each starts (s into the scene), and when it all ends */
  private get times(): { at: number[]; end: number } {
    const at: number[] = [];
    let t = SCATTER;
    for (const [, d] of this.shots) { at.push(t); t += d; }
    return { at, end: t };
  }

  /**
   * from where `camera` is now (the end of the split): `acts`: the friends
   * standing in the line (by name; none: they are put there); `places`: the
   * four ghosts' places, left to right; `voices`: the recordings still playing;
   * `skipped`: the scene before was skipped - straight to how it ends, behind the black
   */
  start(camera: THREE.PerspectiveCamera, acts: Map<string, LineUp>, places: THREE.Vector3[], voices: VoiceHandle[], skipped = false): void {
    if (this.active) return;
    if (!acts.size) acts = this.standing();
    this.t = 0; this.shot = -1;
    this.screamed.clear();
    this.held = voices;
    this.ending = skipped ? 1e-6 : 0;
    this.fade = skipped ? 1 : 0;
    this.cam0.copy(camera.position);
    this.quat0.copy(camera.quaternion);
    this.pos.copy(camera.position);
    this.quat.copy(camera.quaternion);
    this.fov = camera.fov;
    this._cast(acts, places);
    if (skipped) this._settle();
    this.filming = true;
    this.guitar('off');
    const dog = this.dog();
    if (dog) dog.alertAt = null;
    this.events.emit(EV.INTRO_CINEMATIC, true);
  }

  /** everything at once as the film leaves it - the four caught, their ghosts over them - and back to the player (while developing) */
  setEnd(acts: Map<string, LineUp>, places: THREE.Vector3[]): void {
    if (!acts.size) acts = this.standing();
    this._cast(acts, places);
    this._settle();
    this.caught = true;
    this.guitar('off');
    this.sky.calm(1);
  }

  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  /** where the ghost over `key` waits (none: it has been driven off) */
  spot(key: string): { x: number; z: number } | null {
    const g = this.ghosts.get(key), r = this.routes[key];
    return g && !g.gone && r ? { x: r.ghost[0], z: r.ghost[1] } : null;
  }

  /** the head of the ghost over `key` (world) */
  head(key: string, out: THREE.Vector3): THREE.Vector3 {
    const g = this.ghosts.get(key);
    return g ? out.copy(g.head) : out;
  }

  /** the ghost over `key` turns on someone at `to` and comes `lunge` (0..1) of the way there; null: back over its friend */
  threat(key: string, to: THREE.Vector3 | null, lunge: number): void {
    const g = this.ghosts.get(key);
    if (g) { g.to = to; g.lunge = lunge; }
  }

  /** the ghost over `key` is driven off, its friend free to go home */
  banish(key: string): void {
    const g = this.ghosts.get(key);
    if (!g) return;
    g.gone = true;
    g.w.vanish();
    this.chases.get(key)?.free();
  }

  /** all of it off, the friends back on their seats and the ghosts away (to start over) */
  reset(): void {
    for (const c of this.chases.values()) c.finish();
    for (const w of this.wraiths) { w.still(); w.show(false); }
    this.chases.clear();
    this.ghosts.clear();
    this.caught = false;
    this.lit = null;
    this.light.intensity = 0;
  }

  // each friend off on their way, each ghost after its own
  private _cast(acts: Map<string, LineUp>, places: THREE.Vector3[]): void {
    this.chases.clear();
    this.ghosts.clear();
    this.order.forEach((key, i) => {
      const line = acts.get(key), p = this.gathering.byName(key), r = this.routes[key], w = this.wraiths[i];
      if (!line || !p || !r || !w) return;
      const g: Ghost = { w, path: [], total: 0, before: 0, s: 0, head: new THREE.Vector3(), loom: LOOM[r.how], gone: false, to: null, lunge: 0 };
      w.show(true);
      w.headWorld(g.head);
      const chase = new Chase(p.h, line, r, this.terrain, g.head, r.stare);
      p.act = chase;
      // its way: from where it is to where they started, after them along theirs, and to its place over them
      const pts = chase.points;
      const at = places[i] ?? new THREE.Vector3(w.pose.x, 0, w.pose.z);
      g.path = [new THREE.Vector2(at.x, at.z), ...pts.slice(0, -1).map((v) => v.clone()), new THREE.Vector2(...r.ghost)];
      for (let k = 1; k < g.path.length; k++) g.total += g.path[k].distanceTo(g.path[k - 1]);
      g.before = g.path[0].distanceTo(g.path[1]);
      this.chases.set(key, chase);
      this.ghosts.set(key, g);
    });
  }

  // at once as it ends: everyone caught, every ghost over them; the sky turning back
  private _settle(): void {
    for (const [key, c] of this.chases) {
      c.caughtNow();
      const g = this.ghosts.get(key)!;
      g.s = g.total;
      g.w.show(true);
    }
    this.light.intensity = 0;
    this._ghosts(0, true);
  }

  update(dt: number): void {
    this.time += dt;
    // after the film: they stay caught out there, the ghosts hovering over them
    if (this.caught && !this.active) {
      this._ghosts(dt, true);
      this._glow(this.lit, this.litBy);
      return;
    }
    if (!this.active) return;
    this.t += dt;
    const t = this.t, { at, end } = this.times;
    if (!this.ending) {
      // the cuts: in each, its friend runs in, a little short of where they are caught (those
      // still to come wait out of sight; those caught already stay where they are)
      const shot = at.reduce((n, a, i) => (t >= a ? i : n), -1);
      if (shot !== this.shot) {
        this.shot = shot;
        this.snap = true;
        const key = this.shots[shot][0];
        this.shots.forEach(([k], i) => {
          const c = this.chases.get(k), g = this.ghosts.get(k);
          if (!c || !g || i < shot) return;
          if (i === shot) { c.release(c.total - LEAD); g.s = this._want(g, c); } else c.holdAt(c.s);
          c.hidden = i > shot;
          g.w.show(i === shot);
        });
        // the laughter goes on, from this shot's ghost
        const g = this.ghosts.get(key);
        if (g) {
          this.laugh?.stop();
          for (const v of this.held) v.stop();
          this.held = [];
          this.laugh = this.voices()?.play('ghost_split', g.head, { gain: LAUGH.gain, from: LAUGH.from + at[shot] - SCATTER, length: this.shots[shot][1] + 0.2 }) ?? null;
          if (shot === SWELL.shot) this.swell = this.voices()?.play('ghost_appear', g.head, { gain: SWELL.gain, from: SWELL.from, length: SWELL.length }) ?? null;
        }
      }
      // a scream as each in their shot is caught
      const k = this.shot >= 0 ? this.shots[this.shot][0] : null;
      const c = k ? this.chases.get(k) : null;
      if (k && c?.caught && !this.screamed.has(k)) {
        this.screamed.add(k);
        const p = this.gathering.byName(k);
        if (p) this.voices()?.play(`scream_${k}`, p.headPos, { gain: 1 });
      }
      this._ghosts(dt, false);
      if (t >= end) this.ending = 1e-6;
      return;
    }
    // dip to black; then back to the player, the four left where they were caught
    this._ghosts(dt, false);
    this.ending += dt;
    if (this.filming) {
      this.fade = Math.max(this.fade, Math.min(1, this.ending / 0.6));
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending >= 0.6) {
        this.filming = false;
        this.laugh?.stop(); this.laugh = null;
        this.swell?.stop(); this.swell = null;
        for (const v of this.held) v.stop();
        this.held = [];
        this._settle();
        this.caught = true;
        this.sky.calm(1);
        this.events.emit(EV.INTRO_CINEMATIC, false);
      }
    } else {
      this.fade = Math.max(0, this.fade - dt / 0.8);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.fade <= 0) this.t = -1;
    }
  }

  // each ghost after its own: close behind them as they run, then over them once they are caught
  private _ghosts(dt: number, still: boolean): void {
    let i = 0;
    for (const [key, g] of this.ghosts) {
      const c = this.chases.get(key)!, w = g.w, P = w.pose;
      if (g.gone) { w.update(dt); w.headWorld(g.head); i++; continue; }
      const want = this._want(g, c);
      // (out of sight: there at once)
      if (!g.w.group.visible) g.s = want;
      else if (!still) g.s = Math.min(want, g.s + GHOST.speed * Math.min(1, 0.3 + this.t) * dt);
      const [x, z] = this._along(g, g.s);
      const lastLeg = g.path[g.path.length - 2].distanceTo(g.path[g.path.length - 1]);
      const over = c.caught ? sstep(g.total - lastLeg, g.total, g.s) : 0;
      const wob = (a: number) => Math.sin(this.time * (1.3 + i * 0.2) + a);
      P.x = x + 0.05 * wob(i) * over;
      P.z = z + 0.05 * wob(i + 2) * over;
      const them = c.pos;
      P.heading = Math.atan2(them.x - P.x, them.y - P.z);
      P.lift = GHOST.lift + (g.loom - GHOST.lift) * over + 0.04 * wob(i * 3);
      P.arms = 0.55 + 0.45 * over;
      P.wind = 2.0 - 0.8 * over;
      P.opacity = 1 - 0.12 * (0.5 + 0.5 * Math.sin(this.time * 17 + i * 2)) * (1 - over);
      P.dim = 0;
      // turned on the player, and rushing at them
      if (g.to) {
        P.heading = Math.atan2(g.to.x - P.x, g.to.z - P.z);
        const dx = g.to.x - P.x, dz = g.to.z - P.z, way = Math.max(0, 1 - CLOSE / Math.max(CLOSE, Math.hypot(dx, dz))) * g.lunge;
        P.x += dx * way;
        P.z += dz * way;
        P.lift += (0 - P.lift) * Math.min(1, g.lunge * 1.5);
        P.arms = Math.max(P.arms, 0.55 + 0.45 * g.lunge);
      }
      // (back to its full size out of the shelter)
      w.group.scale.setScalar(w.group.scale.x + (1 - w.group.scale.x) * Math.min(1, dt * 1.5));
      w.update(dt);
      w.headWorld(g.head);
      i++;
    }
  }

  // how far along its way it wants to be: as far as they are along theirs, a little behind; all the way once they are caught
  private _want(g: Ghost, c: Chase): number {
    if (c.caught) return g.total;
    const lastLeg = g.path[g.path.length - 2].distanceTo(g.path[g.path.length - 1]);
    return Math.min(g.total - lastLeg, Math.max(0, c.s + g.before - GHOST.gap));
  }

  private _along(g: Ghost, s: number): [number, number] {
    let i = 0, left = s;
    while (i < g.path.length - 2 && left > g.path[i].distanceTo(g.path[i + 1])) { left -= g.path[i].distanceTo(g.path[i + 1]); i++; }
    const a = g.path[i], b = g.path[i + 1];
    const k = Math.min(1, left / Math.max(1e-3, a.distanceTo(b)));
    return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
  }

  // the glow from the ghost over `key`, toward its friend
  private _glow(key: string | null, intensity: number): void {
    const g = key ? this.ghosts.get(key) : null, p = key ? this.gathering.byName(key) : null;
    if (g && !g.gone && p) {
      this.light.position.copy(g.head).lerp(p.headPos, 0.3).addScaledVector(UP, -GLOW.below);
      this.light.intensity = intensity;
    } else this.light.intensity = 0;
  }

  // the scatter from where the split left the camera (drawing up and back a
  // little); then each shot from its own place, on the one running into it and
  // the ghost after them
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    let fov = this.fov;
    if (this.shot < 0) {
      const k = sstep(0, SCATTER, this.t);
      this.pos.copy(this.cam0).addScaledVector(UP, 0.25 * k);
      this.quat.copy(this.quat0);
    } else {
      const key = this.shots[this.shot][0], r = this.routes[key], g = this.ghosts.get(key), p = this.gathering.byName(key);
      if (r && g && p) {
        const [x, z, hgt] = r.shot;
        const tPos = _v.set(x, this.terrain.heightAt(x, z) + hgt, z);
        this.tLook.copy(p.headPos).lerp(g.head, 0.4);
        _m.lookAt(tPos, this.tLook, UP);
        _q.setFromRotationMatrix(_m);
        if (this.snap) { this.snap = false; this.pos.copy(tPos); this.quat.copy(_q); }
        const k = 1 - Math.exp(-4 * dt);
        this.pos.lerp(tPos, k);
        this.quat.slerp(_q, k);
      }
      fov = FOV;
    }
    // the glow: from the ghost in the shot, toward the one it is after
    this._glow(this.shot >= 0 ? this.shots[this.shot][0] : null, GLOW.intensity * (1 - this.fade));
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (this.ending && this.fade >= 1) fov = 55;
    this.fov = fov;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
}
