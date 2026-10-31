// Where the ghost comes from at the camp (world x / z around the cabin and
// the fire, see config.js CABIN / FIRE / CAMP): out from its hiding place
// behind the cabin, along its west wall to the front corner, and on toward
// the fire.

export const GHOST_IN: [number, number][] = [[1.4, -25.3], [-2.0, -25.0], [-2.0, -18.6], [-0.8, -18.0], [0.4, -17.3]];
/** index of the front corner in GHOST_IN (where it peeks) */
export const CORNER = 2;
/** where it stops when it creeps up on the friends at the fire: behind Amin and the owner */
export const CREEP_STOP = { x: 0.4, z: -17.9 };
/**
 * where the friends line up facing it once they have seen it: across the fire
 * from it, side by side, left to right as the camera sees them (Amin, the
 * owner, Alireza, Amir), with a gap between the first two where the camera
 * sees it beyond them; the way each goes round the fire and the stumps;
 * when each turns round to it (s into the scene) and how long they stare from
 * their seat before getting up
 */
export const LINE_UP: Record<string, { spot: [number, number]; via?: [number, number][]; notice: number; stare: number }> = {
  owner: { spot: [1.45, -12.0], via: [[0.0, -13.6]], notice: 0.2, stare: 1.2 },
  amin: { spot: [0.15, -11.75], via: [[-0.75, -13.9]], notice: 0.45, stare: 1.9 },
  alireza: { spot: [2.25, -12.2], via: [[1.95, -12.9]], notice: 0.9, stare: 2.0 },
  amir: { spot: [3.05, -12.35], via: [[3.45, -13.5]], notice: 0.6, stare: 1.4 },
};
