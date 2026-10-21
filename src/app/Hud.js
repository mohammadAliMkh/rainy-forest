// The small readouts on screen: the FPS counter (optional) and the clock in
// the settings menu, refreshed twice a second.

export class Hud {
  constructor({ ui, day }) {
    Object.assign(this, { ui, day });
    this._t0 = 0;
    this._frames = 0;
  }

  update() {
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
