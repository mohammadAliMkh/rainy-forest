import * as THREE from 'three';

// The main loop. Every part of the game that changes over time is a
// "system": an object with a name and update(frame). Systems run in the
// order they were added (the order is set in one place: app/createGame.js),
// once per frame. `frame` is shared by all of them: dt and time are set
// here, systems add what others need (e.g. the weather puts `env` on it).

export class Game {
  constructor() {
    this.systems = [];
    this.clock = new THREE.Clock();
    this.frameState = { dt: 0, time: 0 };
  }

  add(system) {
    if (!system?.name || typeof system.update !== 'function') throw new Error('a system needs a name and update(frame)');
    this.systems.push(system);
    return system;
  }

  get(name) {
    return this.systems.find((s) => s.name === name) ?? null;
  }

  // one frame; `forcedDt` lets tests step the game by a fixed amount
  frame(forcedDt) {
    const f = this.frameState;
    f.dt = forcedDt ?? Math.min(this.clock.getDelta(), 0.05);
    f.time += f.dt;
    for (const s of this.systems) s.update(f);
  }

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }
}
