import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import { clamp } from '../../utils/noise.js';
import type { Gathering } from '../people/Gathering.ts';
import { Flight } from '../people/Flight.ts';
import { Ghost, type GhostFace } from './Ghost.ts';
import { TITLE, GHOST_IN, CORNER, T, FLEE, SHOTS } from './ghostScript.ts';

// Plays scenario 1 (see ghostScript.ts) like a short film: takes the camera
// the way the introductions do, moves the ghost through its little act,
// sets the friends running (people/Flight.ts) and brings them back, and
// announces the moments that make a sound (SCENARIO_CUE). Once played it
// doesn't offer itself again this visit, unless replayed from the menu.

const UP = new THREE.Vector3(0, 1, 0);
// the scary look's moods for the same moments (until it scares itself)
const SCARY_FACE: Partial<Record<GhostFace, GhostFace>> = { sly: 'stare', boo: 'scream', happy: 'grin' };
const _m = new THREE.Matrix4();

interface Terrain { heightAt(x: number, z: number): number }

const ease = (t: number) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const lerpAngle = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

/** point at distance `s` along a polyline, with the heading of that stretch */
function along(pts: [number, number][], s: number): { x: number; z: number; heading: number; end: boolean } {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (s <= len || i === pts.length - 2) {
      const k = clamp(s / len, 0, 1);
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, heading: Math.atan2(bx - ax, bz - az), end: s >= len && i === pts.length - 2 };
    }
    s -= len;
  }
  const [x, z] = pts[pts.length - 1];
  return { x, z, heading: 0, end: true };
}
const length = (pts: [number, number][]) => pts.slice(1).reduce((a, [x, z], i) => a + Math.hypot(x - pts[i][0], z - pts[i][1]), 0);

export class GhostScenario {
  readonly ghost: Ghost;
  /** played this visit (the button doesn't come back) */
  done = false;
  private readonly gathering: Gathering;
  private readonly terrain: Terrain;
  private readonly events: EventBus<GameEvents>;
  private t = -1; // seconds since the start, -1 = not playing
  private shot = -1;
  private ending = 0; // fading out at the end / on skip
  private fade = 0;
  private returned = false;
  private readonly cue = new Set<string>();
  // film camera
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private fov = 50;
  private snap = false;
  private readonly head = new THREE.Vector3();

  constructor(gathering: Gathering, terrain: Terrain, events: EventBus<GameEvents>) {
    this.gathering = gathering;
    this.terrain = terrain;
    this.events = events;
    this.ghost = new Ghost(terrain);
  }

  /** the film camera has the view (in the errand it hands back once everyone has run off) */
  filming = false;
  private handBack = false;
  /** at night on the haunted walk back: the scary ghost (until it gets spooked) */
  private scary = false;

  get active(): boolean { return this.t >= 0; }

  /** where the ghost's head is (for eyes that follow it), or null when it isn't out */
  ghostHead(): THREE.Vector3 | null { return this.active && this.ghost.group.visible ? this.head : null; }

  /**
   * `handBack`: the camera goes back to the player once everyone has run into
   * the trees; the ghost and the friends carry on around them.
   * `scary`: the grey ghost with red eyes sneaks up and screams; the comic
   * end stays (spooked by its own trick, it flees with the funny face)
   */
  start({ handBack = false, scary = false }: { handBack?: boolean; scary?: boolean } = {}): void {
    if (this.active) return;
    this.done = true;
    this.filming = true;
    this.handBack = handBack;
    this.scary = scary;
    this.ghost.setStyle(scary ? 'scary' : 'funny');
    this.t = 0; this.shot = -1; this.ending = 0; this.returned = false;
    this.cue.clear();
    this.ghost.show(true);
    Object.assign(this.ghost.pose, { x: GHOST_IN[0][0], z: GHOST_IN[0][1], heading: Math.PI, lift: 0.14, lean: 0, tilt: 0, arms: 0, puff: 0, opacity: 1, face: 'sly' });
    this.gathering.blind = true;
    this.events.emit(EV.INTRO_CINEMATIC, true);
    this.events.emit(EV.INTRO_CAPTION, TITLE);
    this.fade = 1;
    this.events.emit(EV.INTRO_FADE, 1);
  }

  /** jump to the end: everyone back on their seats, the ghost gone */
  skip(): void { if (this.filming && !this.ending) this.ending = 1e-6; }

  // the film camera lets go: back to the player, the scene goes on around them
  private _cutBack(): void {
    this.filming = false;
    this.events.emit(EV.INTRO_CAPTION, null);
    this.events.emit(EV.INTRO_CINEMATIC, false);
  }

  private _end(): void {
    for (const p of this.gathering.people) { p.flight?.finish(); p.flight = null; }
    this.gathering.blind = false;
    this.gathering.scare = null;
    this.ghost.show(false);
    this.t = -1;
    if (this.filming) this._cutBack();
    this.events.emit(EV.SCENARIO_CUE, { cue: 'sneakStop', position: this.head });
  }

  private _once(name: string, fn: () => void): void { if (!this.cue.has(name)) { this.cue.add(name); fn(); } }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    const t = this.t;
    // fades: in at the start, out at the end (or on skip), then hand the view back
    if (this.ending && !this.filming) { this._end(); return; }
    if (this.ending) {
      this.ending += dt;
      this.fade = Math.min(1, this.ending / 0.4);
      this.events.emit(EV.INTRO_FADE, this.fade);
      if (this.ending > 0.45) { this._end(); this.fade = 0; this.events.emit(EV.INTRO_FADE, 0); return; }
    } else if (this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt / 0.6);
      this.events.emit(EV.INTRO_FADE, this.fade);
    }
    if (t > 3.2) this._once('title', () => this.events.emit(EV.INTRO_CAPTION, null));
    this._ghost(dt, t);
    if (this.scary && t < T.spooked) this.ghost.pose.face = SCARY_FACE[this.ghost.pose.face] ?? this.ghost.pose.face;
    this.ghost.update(dt);
    this.ghost.headWorld(this.head);
    this.gathering.scare = this.ghost.group.visible ? this.head : null;

    // BOO: everyone jumps, screams and runs
    if (t >= T.boo + 0.1) this._once('flee', () => {
      for (const p of this.gathering.people) {
        const route = FLEE[p.seat.key];
        if (!route) continue;
        const s = p.seat;
        p.flight = new Flight(p.h, { x: s.x, y: s.y, z: s.z, facing: s.facing, lean: p.baseLean }, route, this.terrain, {
          delay: route.delay,
          onScream: () => this.events.emit(EV.SCENARIO_CUE, { cue: 'scream', who: s.key, position: p.headPos.clone() }),
        });
      }
    });
    // in the errand: once they have all run into the trees, the player is back in control
    if (this.handBack && this.filming && t > T.boo + 1.5 && (t > T.boo + 4.5 || this.gathering.people.every((p) => !p.flight || p.flight.hiding))) this._cutBack();
    // the coast is clear: back to the fire
    if (t >= T.comeBack && !this.returned) {
      this.returned = true;
      for (const p of this.gathering.people) p.flight?.comeBack();
    }
    // the end: everyone has sat down again
    if (this.returned && !this.ending && this.gathering.people.every((p) => !p.flight) && t > T.comeBack + 1) this.ending = 1e-6;
  }

  // the ghost's act
  private _ghost(dt: number, t: number): void {
    const g = this.ghost.pose;
    const wallLen = length(GHOST_IN.slice(0, CORNER + 1));
    const inLen = length(GHOST_IN);
    const step = (f: number) => Math.abs(Math.sin(t * Math.PI * f)); // a bounce per tiptoe step
    if (t < T.sneak) {
      // waiting behind the cabin
      Object.assign(g, { x: GHOST_IN[0][0], z: GHOST_IN[0][1], heading: 0, lift: 0.12 });
    } else if (t < T.corner) {
      // creeping along the wall on tiptoe: little hops, leaning in, swaying, glancing about
      this._once('sneak', () => this.events.emit(EV.SCENARIO_CUE, { cue: 'sneak', position: this.head }));
      const k = (t - T.sneak) / (T.corner - T.sneak);
      const p = along(GHOST_IN, wallLen * k);
      Object.assign(g, { x: p.x, z: p.z, heading: p.heading + Math.sin(t * 1.3) * 0.35, lift: 0.1 + step(1.6) * 0.16, lean: 0.18, tilt: Math.sin(t * Math.PI * 1.6) * 0.1, arms: 0.12, face: 'sly' });
    } else if (t < T.peekEnd) {
      // at the corner: leans out to look at them, ducks back, leans out again, a little shimmy of delight
      const k = t - T.corner;
      const [cx, cz] = GHOST_IN[CORNER];
      const out = k < 0.9 ? ease(k / 0.6) : k < 1.5 ? 1 - ease((k - 0.9) / 0.4) : ease((k - 1.6) / 0.5);
      const toward = Math.atan2(0.4 - cx, -15.8 - cz);
      Object.assign(g, {
        x: cx + 0.3 * out, z: cz + 0.15 * out, heading: lerpAngle(0, toward, 0.4 + 0.6 * out), lift: 0.1 + (k > 2.4 ? step(4) * 0.06 : 0),
        lean: 0.05, tilt: -0.45 * out + (k > 2.4 ? Math.sin(t * 18) * 0.06 : 0), arms: k > 2.4 ? 0.3 : 0.1, face: 'sly',
      });
    } else if (t < T.arrive) {
      // slowly over to them, exaggerated tiptoe steps
      const k = ease((t - T.peekEnd) / (T.arrive - T.peekEnd));
      const p = along(GHOST_IN, wallLen + (inLen - wallLen) * k);
      Object.assign(g, { x: p.x, z: p.z, heading: lerpAngle(g.heading, p.heading, 0.1), lift: 0.1 + step(1.1) * 0.14, lean: 0.2, tilt: Math.sin(t * Math.PI * 1.1) * 0.12, arms: 0.2 + 0.1 * step(1.1), face: 'sly' });
    } else if (t < T.boo) {
      // right behind them: rises up, arms spreading, turning to face them
      const k = ease((t - T.arrive) / (T.boo - T.arrive));
      this._once('sneakStop', () => this.events.emit(EV.SCENARIO_CUE, { cue: 'sneakStop', position: this.head }));
      Object.assign(g, { heading: lerpAngle(g.heading, Math.atan2(1.0 - g.x, -15.4 - g.z), 0.12), lift: 0.12 + 0.35 * k, lean: 0.12 - 0.2 * k, tilt: 0, arms: 0.3 + 0.7 * k, face: 'sly' });
    } else if (t < T.giggle) {
      // BOO!
      this._once('boo', () => this.events.emit(EV.SCENARIO_CUE, { cue: 'boo', position: this.head }));
      const k = t - T.boo;
      Object.assign(g, { lift: 0.47 + Math.sin(Math.min(1, k / 0.25) * Math.PI) * 0.12, lean: -0.08 + (k < 0.3 ? 0.25 * Math.sin((k / 0.3) * Math.PI) : 0), arms: 1, puff: k < 0.2 ? k / 0.2 : Math.max(0.3, 1 - (k - 0.2) * 0.6), face: 'boo' });
    } else if (t < T.lookAround) {
      // pleased with itself: giggles and spins round once
      this._once('giggle', () => this.events.emit(EV.SCENARIO_CUE, { cue: this.scary ? 'laughDeep' : 'giggle', position: this.head }));
      const k = (t - T.giggle) / (T.lookAround - T.giggle);
      Object.assign(g, { heading: g.heading + dt * Math.PI * 2 / (T.lookAround - T.giggle) * Math.sin(k * Math.PI) * 1.6, lift: 0.3 + Math.abs(Math.sin(t * 9)) * 0.08, lean: 0, tilt: Math.sin(t * 9) * 0.12, arms: 0.55 + Math.sin(t * 9) * 0.25, puff: Math.max(0, g.puff - dt * 2), face: 'happy' });
    } else if (t < T.spooked) {
      // ...where did everyone go? Looks left, right
      const k = t - T.lookAround;
      Object.assign(g, { heading: lerpAngle(g.heading, Math.PI * 0.15 + Math.sin(k * 3.2) * 1.1, 0.15), lift: 0.26, tilt: Math.sin(k * 3.2) * 0.1, arms: 0.2, puff: 0, face: 'sly' });
    } else if (t < T.gone) {
      // spooked by its own trick: jumps and flees back the way it came, fading away
      this._once('eek', () => this.events.emit(EV.SCENARIO_CUE, { cue: 'eek', position: this.head }));
      const k = t - T.spooked;
      const back = [...GHOST_IN].reverse();
      const run = Math.max(0, k - 0.35);
      const p = along(back, run * run * 1.2 + run * 2.2);
      const jump = k < 0.35 ? Math.sin((k / 0.35) * Math.PI) * 0.5 : 0;
      Object.assign(g, {
        x: p.x, z: p.z, heading: k < 0.35 ? g.heading : lerpAngle(g.heading, p.heading, 0.2), lift: 0.3 + jump + Math.abs(Math.sin(t * 11)) * 0.08,
        lean: k < 0.35 ? -0.2 : 0.3, tilt: Math.sin(t * 11) * 0.15, arms: 1, puff: 0, face: 'boo',
        opacity: 1 - ease((t - (T.gone - 1.2)) / 1.2),
      });
    } else {
      this._once('vanish', () => { this.events.emit(EV.SCENARIO_CUE, { cue: 'vanish', position: this.head }); this.ghost.show(false); });
    }
  }

  // ---- the film camera ----
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    if (!this.filming) return;
    let i = 0;
    while (i + 1 < SHOTS.length && this.t >= SHOTS[i + 1].from) i++;
    if (i !== this.shot) { this.shot = i; this.snap = true; }
    const s = SHOTS[i];
    const [px, py, pz] = s.pos;
    const tPos = new THREE.Vector3(px, this.terrain.heightAt(px, pz) + py, pz);
    let tLook: THREE.Vector3;
    if (s.look === 'ghost') tLook = this.head.clone().addScaledVector(UP, -0.25);
    else { const [lx, ly, lz] = s.look; tLook = new THREE.Vector3(lx, this.terrain.heightAt(lx, lz) + ly, lz); }
    _m.lookAt(tPos, tLook, UP);
    const tq = new THREE.Quaternion().setFromRotationMatrix(_m);
    if (this.snap) { this.pos.copy(tPos); this.quat.copy(tq); this.fov = s.fov; this.snap = false; }
    const k = 1 - Math.exp(-5 * dt);
    this.pos.lerp(tPos, k);
    this.quat.slerp(tq, k);
    this.fov += (s.fov - this.fov) * k;
    camera.position.copy(this.pos);
    camera.quaternion.copy(this.quat);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }
}
