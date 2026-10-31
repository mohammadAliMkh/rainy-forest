import type { WeatherKind, WeatherMode } from '../weather/Weather.ts';

// The errand's own time of day. Once Amir has asked, the sun goes down while
// you walk to the shop; as you step out of it night comes down in a few
// seconds (with «روح ترسناک» on, in heavy rain and the lantern burning low);
// as the ghost comes out of the jar the sky turns red (`redden`) and back
// (`calm`) as it goes; after the end the hour, the weather, the colour of the
// sky and the speed of the day come back slowly.

interface DayLike { hour: number; cycleSeconds: number; blood: number }
interface WeatherLike { mode: WeatherMode; kind: WeatherKind; setMode(mode: WeatherMode): void; setKind(kind: WeatherKind, seconds?: number): void }
interface LightingLike { lanternMax: number }

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
  // the red sky: from, to, how far along (-1 = still), over how long
  private r0 = 0;
  private r1 = 0;
  private rt = -1;
  private rLen = 1;

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

  /** night on the way back (over `seconds`); `haunted`: in heavy rain, the lantern burning low */
  fall(haunted: boolean, seconds = 6): void {
    if (this.night) return;
    this._take();
    if (haunted) {
      const { weather, lighting } = this;
      this.savedWeather = { mode: weather.mode, kind: weather.kind };
      weather.setMode('rain');
      weather.setKind('heavy', 1200);
      lighting.lanternMax = LANTERN_LOW;
    }
    this._go(NIGHT_HOUR, seconds);
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
    if (this.day.blood > 0) this._blood(0, 10);
  }

  /** the sky turns red (the ghost is out), over `seconds` */
  redden(seconds = 3.5): void {
    this._blood(1, seconds);
  }

  /** the sky back to its own colour (the ghost has gone), over `seconds` */
  calm(seconds = 8): void {
    if (this.day.blood > 0 || this.rt >= 0) this._blood(0, seconds);
  }

  private _blood(to: number, seconds: number): void {
    this.r0 = this.day.blood;
    this.r1 = to;
    this.rt = 0;
    this.rLen = seconds;
  }

  private _go(hour: number, seconds: number): void {
    this.h0 = this.day.hour;
    this.dh = hoursTo(this.h0, hour);
    this.t = 0;
    this.len = seconds;
  }

  update(dt: number): void {
    if (this.rt >= 0) {
      this.rt += dt;
      this.day.blood = this.r0 + (this.r1 - this.r0) * smooth(this.rt / this.rLen);
      if (this.rt >= this.rLen) this.rt = -1;
    }
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
