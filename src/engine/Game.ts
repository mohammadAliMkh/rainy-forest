import * as THREE from 'three';

// The main loop. Every part of the game that changes over time is a
// "system": an object with a name and update(frame). Systems run in the
// order they were added (the order is set in one place: app/createGame.ts),
// once per frame. `frame` is shared by all of them: dt and time are set
// here, the game adds what its systems need (camera, weather...).

export interface FrameBase {
  /** seconds since the last frame (capped, so a hiccup doesn't teleport anything) */
  dt: number;
  /** seconds since the game started */
  time: number;
}

export interface System<F extends FrameBase = FrameBase> {
  name: string;
  update(frame: F): void;
}

export class Game<F extends FrameBase = FrameBase> {
  readonly systems: System<F>[] = [];
  readonly frameState: F;
  private clock = new THREE.Clock();

  constructor(frame: Omit<F, keyof FrameBase>) {
    this.frameState = { ...frame, dt: 0, time: 0 } as F;
  }

  add(system: System<F>): System<F> {
    this.systems.push(system);
    return system;
  }

  get(name: string): System<F> | null {
    return this.systems.find((s) => s.name === name) ?? null;
  }

  /** one frame; `forcedDt` lets tests step the game by a fixed amount */
  frame(forcedDt?: number): void {
    const f = this.frameState;
    f.dt = forcedDt ?? Math.min(this.clock.getDelta(), 0.05);
    f.time += f.dt;
    for (const s of this.systems) s.update(f);
  }

  start(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }
}
