import type { UI } from '../ui/UI.js';
import type { DayCycle } from '../game/weather/DayCycle.js';

// The small readouts on screen: the FPS counter (optional) and the clock in
// the settings menu, refreshed twice a second.

export class Hud {
  private ui: UI;
  private day: DayCycle;
  private _t0 = 0;
  private _frames = 0;

  constructor({ ui, day }: { ui: UI; day: DayCycle }) {
    this.ui = ui;
    this.day = day;
  }

  update(): void {
    const now = performance.now();
    if (!this._t0) this._t0 = now;
    this._frames++;
    if (now - this._t0 > 500) {
      const { ui, day } = this;
      ui.setFps(`${Math.round((this._frames * 1000) / (now - this._t0))} FPS · ${day.timeString}`);
      ui.setClock(day.timeString, day.hour);
      this._t0 = now;
      this._frames = 0;
    }
  }
}
