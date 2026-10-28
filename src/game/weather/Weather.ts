import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';

// The weather changes by itself: dry spells, drizzle, rain and now and then
// a heavier shower, each lasting a few minutes, with slow, smooth changes in
// between. `intensity` (0 = dry .. 1 = heavy) is the state everyone reads
// each frame (rain, its sound, puddles, light, birds). In a heavy shower a
// rare, soft and distant lightning flash may come (announced as LIGHTNING),
// with a low rumble a few seconds later - cosy, never a sharp crack.

export type WeatherKind = 'dry' | 'drizzle' | 'rain' | 'heavy';
/** 'auto': the random schedule; 'rain': always raining; 'dry': no rain */
export type WeatherMode = 'auto' | 'rain' | 'dry';

// how long each lasts (seconds). Over a long visit this works out to about
// half the time dry, a quarter drizzle, a fifth rain and a little heavy rain.
const KINDS: Record<WeatherKind, { level: number; min: number; max: number }> = {
  dry: { level: 0, min: 300, max: 600 },
  drizzle: { level: 0.3, min: 90, max: 180 },
  rain: { level: 0.65, min: 120, max: 240 },
  heavy: { level: 1, min: 90, max: 150 },
};

export class Weather {
  kind: WeatherKind = 'drizzle';
  mode: WeatherMode = 'auto';
  /** current rain, 0..1, changing smoothly toward the kind's level */
  intensity: number;
  /** leaves and ground still dripping after the rain (follows the rain, dries slowly) */
  wetness: number;
  /** seconds left in the current kind */
  timer: number;
  private boltTimer = 0;
  private readonly events: EventBus<GameEvents>;
  private readonly rand: () => number;

  constructor({ events, rand = Math.random }: { events: EventBus<GameEvents>; rand?: () => number }) {
    this.events = events;
    this.rand = rand;
    // a visit starts in a light drizzle (it's the rainy forest), then the schedule takes over
    this.intensity = this.wetness = KINDS.drizzle.level;
    this.timer = this._duration('drizzle');
  }

  setMode(mode: WeatherMode): void {
    this.mode = mode;
    if (mode === 'rain' && (this.kind === 'dry' || this.kind === 'drizzle')) this._enter('rain');
    if (mode === 'dry') this._enter('dry');
    if (mode === 'auto') this.timer = Math.min(this.timer, this._duration(this.kind));
  }

  /** switch to `kind` now (it builds up smoothly), for `seconds` (default: its usual length) */
  setKind(kind: WeatherKind, seconds?: number): void {
    this._enter(kind);
    if (seconds !== undefined) this.timer = seconds;
  }

  /** the target level of the current kind */
  get target(): number { return KINDS[this.kind].level; }

  update(dt: number): void {
    // the schedule (frozen in the fixed modes)
    this.timer -= dt;
    if (this.timer <= 0 && this.mode !== 'dry') this._enter(this._next());
    // smooth change: a shower builds up / eases off over half a minute or so
    const k = 1 - Math.exp(-dt / (this.target > this.intensity ? 14 : 22));
    this.intensity += (this.target - this.intensity) * k;
    // wet leaves follow the rain quickly and dry over a couple of minutes
    const w = this.intensity > this.wetness ? 1 - Math.exp(-dt / 6) : 1 - Math.exp(-dt / 90);
    this.wetness += (this.intensity - this.wetness) * w;
    this._lightning(dt);
  }

  private _next(): WeatherKind {
    const r = this.rand();
    switch (this.kind) {
      case 'dry': return 'drizzle';
      case 'drizzle': return this.mode === 'rain' ? 'rain' : r < 0.45 ? 'rain' : 'dry';
      case 'rain': return r < 0.2 ? 'heavy' : this.mode === 'rain' ? 'rain' : 'drizzle';
      case 'heavy': return 'rain';
    }
  }

  private _enter(kind: WeatherKind): void {
    this.kind = kind;
    this.timer = this._duration(kind);
    // at most one lightning in a heavy shower, and only in about half of them
    // (roughly one every couple of hours); never right at its start
    this.boltTimer = this.rand() < 0.55 ? 30 + this.rand() * 80 : Infinity;
  }

  private _duration(kind: WeatherKind): number {
    const d = KINDS[kind];
    return d.min + this.rand() * (d.max - d.min);
  }

  // rare: only in a heavy shower that has built up
  private _lightning(dt: number): void {
    if (this.kind !== 'heavy' || this.intensity < 0.85) return;
    this.boltTimer -= dt;
    if (this.boltTimer > 0) return;
    this.boltTimer = Infinity;
    this.strike();
  }

  /** a soft, distant flash (also handy for testing) */
  strike(): void {
    const a = this.rand() * Math.PI * 2;
    const direction = new THREE.Vector3(Math.cos(a), 0.25 + this.rand() * 0.2, Math.sin(a)).normalize();
    const distance = 0.5 + this.rand(); // 0..1, far away
    this.events.emit(EV.LIGHTNING, { direction, strength: 0.85 - distance * 0.35, delay: 2.5 + distance * 5 });
  }
}
