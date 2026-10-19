// Round-robin pool of HRTF panners for short positional one-shots
// (drips, plinks, rustles...), so we don't build a new panner every time.

export class PannerPool {
  constructor(engine, bus, size = 8, opts = {}) {
    this.engine = engine;
    this.items = [];
    for (let i = 0; i < size; i++) this.items.push(engine.panner({ x: 0, y: -999, z: 0 }, bus, opts));
    this.i = 0;
  }

  play(buffer, pos, { gain = 1, rate = 1, when = 0 } = {}) {
    const p = this.items[this.i];
    this.i = (this.i + 1) % this.items.length;
    this.engine.setPannerPos(p, pos, true);
    return this.engine.oneShot(buffer, p, { gain, rate, when });
  }
}

export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
