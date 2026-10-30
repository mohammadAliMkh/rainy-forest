// Where the ghost comes from at the camp (world x / z around the cabin and
// the fire, see config.js CABIN / FIRE / CAMP): out from its hiding place
// behind the cabin, along its west wall to the front corner, and on toward
// the fire.

export const GHOST_IN: [number, number][] = [[1.4, -25.3], [-2.0, -25.0], [-2.0, -18.6], [-0.8, -18.0], [0.4, -17.3]];
/** index of the front corner in GHOST_IN (where it peeks) */
export const CORNER = 2;
