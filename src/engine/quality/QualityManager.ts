import { QUALITY_PRESETS } from '../../config/config.js';
import type { QualityName, QualityPreset } from '../../config/config.js';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../events.ts';
import type { Renderer } from '../render/Renderer.js';
import { TIERS } from '../render/gpuTier.js';

// Graphics quality: applies a level (low .. ultra) and, in automatic mode,
// adapts to the measured frame rate while the game is being played.
// It only talks to the renderer; everything else that depends on the level
// (shadows, trees, reflections, the lantern...) listens to QUALITY_CHANGED,
// and things drawn in pixels listen to PIXEL_RATIO.
//
// Automatic mode: the resolution floats with the frame rate; the whole
// level only changes when resolution alone can't keep up (or there is
// clear headroom). Never goes more than one level above the GPU guess; a
// level it had to leave is only tried again after ~30 s of plenty of
// headroom, then 60 s, and after two failed tries never again (each level
// change recompiles shaders, a short hitch). The low mark sits under 30 so
// screens / battery savers that cap at 30 FPS don't drag the quality down
// for nothing.

/** the automatic mode's bookkeeping (exposed for tests) */
interface Governor {
  t0: number; frames: number; holdUntil: number; highStreak: number; calm: number;
  wait: number; fails: number; retried: boolean; retriedAt: number;
  ceiling: number; maxCeiling: number;
  reset(holdSeconds?: number): void;
}

const isLevel = (s: string): s is QualityName => s in QUALITY_PRESETS;

export class QualityManager {
  readonly renderer: Renderer;
  readonly events: EventBus<GameEvents>;
  readonly gpuTier: QualityName;
  auto: boolean;
  name: QualityName;
  /** set by the app: adapt only while actually playing */
  active: () => boolean = () => true;
  readonly gov: Governor;

  constructor({ renderer, events, gpuTier, setting }: { renderer: Renderer; events: EventBus<GameEvents>; gpuTier: QualityName; setting: string }) {
    this.renderer = renderer;
    this.events = events;
    this.gpuTier = gpuTier;
    this.auto = setting === 'auto' || !isLevel(setting);
    this.name = isLevel(setting) && !this.auto ? setting : gpuTier;
    const ceiling = Math.min(TIERS.length - 1, TIERS.indexOf(gpuTier) + 1);
    const gov: Governor = {
      t0: 0, frames: 0, holdUntil: 0, highStreak: 0, calm: 0, wait: 15, fails: 0, retried: false, retriedAt: 0,
      ceiling, maxCeiling: ceiling,
      reset: (hold = 3) => { gov.t0 = 0; gov.frames = 0; gov.holdUntil = performance.now() + hold * 1000; gov.highStreak = 0; },
    };
    this.gov = gov;
  }

  get preset(): QualityPreset { return QUALITY_PRESETS[this.name] || QUALITY_PRESETS.high; }

  apply(name: QualityName): void {
    this.name = name;
    const q = this.preset;
    this.renderer.setQuality(q);
    this.events.emit(EV.QUALITY_CHANGED, { name, preset: q, auto: this.auto });
    this.syncPixelRatio();
  }

  syncPixelRatio(): void {
    this.events.emit(EV.PIXEL_RATIO, this.renderer.renderer.getPixelRatio());
  }

  /** the menu choice: 'auto' or a level name */
  setSetting(setting: string): void {
    this.auto = setting === 'auto' || !isLevel(setting);
    this.apply(isLevel(setting) && !this.auto ? setting : this.gpuTier);
    this.gov.reset();
  }

  private setLevel(name: QualityName): void {
    this.apply(name);
    this.gov.reset(4);
  }

  /** system: runs once per frame, after rendering */
  update(): void {
    if (this.auto && this.active()) this.governor(performance.now());
    else this.gov.reset(1);
  }

  private governor(now: number): void {
    const gov = this.gov;
    if (now < gov.holdUntil) return;
    if (!gov.t0) { gov.t0 = now; gov.frames = 0; return; }
    gov.frames++;
    if (now - gov.t0 < 2000) return;
    const fps = (gov.frames * 1000) / (now - gov.t0);
    gov.t0 = now; gov.frames = 0;
    const q = QUALITY_PRESETS[this.name];
    const i = TIERS.indexOf(this.name) as number;
    const renderer = this.renderer;
    const pr = renderer.renderer.getPixelRatio();
    if (fps < 27) {
      gov.highStreak = 0; gov.calm = 0;
      if (pr > q.minScale + 0.01) { renderer.setScale(pr - (fps < 22 ? 0.2 : 0.1)); this.syncPixelRatio(); gov.reset(1); }
      else if (i > 0) {
        if (gov.retried && now - gov.retriedAt < 90000) {
          // a retried level failed again: wait twice as long, give up after two
          gov.retried = false;
          gov.wait *= 2;
          if (++gov.fails >= 2) gov.maxCeiling = Math.min(gov.maxCeiling, i - 1);
        }
        gov.ceiling = Math.min(gov.ceiling, i - 1);
        this.setLevel(TIERS[i - 1]);
      }
    } else if (fps > 55) {
      if (++gov.calm >= gov.wait && gov.ceiling < gov.maxCeiling) { gov.ceiling++; gov.calm = 0; gov.retried = true; gov.retriedAt = now; }
      if (++gov.highStreak < 2) return;
      gov.highStreak = 0;
      if (pr < q.maxScale - 0.01) { renderer.setScale(pr + 0.1); this.syncPixelRatio(); gov.reset(1); }
      else if (i < gov.ceiling) this.setLevel(TIERS[i + 1]);
    } else { gov.highStreak = 0; gov.calm = 0; }
  }
}
