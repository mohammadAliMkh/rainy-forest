import { STORE } from '../../config/config.js';

// The shop's measurements, in its own frame: x across (left -, right +),
// z from back (-) to front (+, the door and porch), y up from the level pad.
// Building, furniture, colliders and walkable floors all read these.

export const W = STORE.w; // outside width
export const D = STORE.d; // outside depth
export const T = 0.14; // wall thickness
export const F = 0.45; // floor height above the pad (the stone base)
export const H = 2.7; // wall height above the floor
export const RIDGE = 1.35; // roof ridge above the walls
export const X0 = -W / 2, X1 = W / 2, Z0 = -D / 2, Z1 = D / 2;
export const IX0 = X0 + T, IX1 = X1 - T, IZ0 = Z0 + T, IZ1 = Z1 - T; // inside faces

// porch, steps (in front of the door) and the roof over both
export const PORCH = 1.95; // porch depth in front of the front wall
export const PZ1 = Z1 + PORCH; // porch front edge
export const STEP_N = 3;
export const STEP_D = 0.32;
export const ROOF_OVER = 0.38; // roof overhang at the sides and back
export const ROOF_FRONT = PZ1 + 0.3;

// openings in the front wall (x ranges, y above the floor)
export const DOOR = { x0: 0.55, x1: 1.55, h: 2.05 };
export const WIN_L = { x0: -2.6, x1: -0.25, y0: 0.85, y1: 2.15 };
export const WIN_R = { x0: 1.95, x1: 2.75, y0: 1.0, y1: 2.05 };
export const STEPS = { x0: DOOR.x0 - 0.2, x1: DOOR.x1 + 0.2 };

// inside: furniture footprints (x0, x1, z0, z1)
export const COUNTER = { x0: 1.55, x1: 2.15, z0: -1.62, z1: 1.3, h: 0.95 };
export const COUNTER_END = { x0: 2.15, x1: IX1, z0: 1.3, z1: 1.72, h: 1.1 }; // closes the space behind
export const SHOPKEEPER = { x: 2.56, z: 0.05 };
export const FRIDGES = [{ x0: 0.38, x1: 1.14 }, { x0: 1.18, x1: 1.94 }].map((f) => ({ ...f, z0: IZ0, z1: IZ0 + 0.72, h: 2.0 }));
export const LIQUOR = { x0: 2.0, x1: IX1, z0: IZ0, z1: IZ0 + 0.32, h: 2.15 };
export const SHELF_LEFT = { x0: IX0, x1: IX0 + 0.42, z0: IZ0 + 0.45, z1: IZ1 - 0.5, h: 2.0 };
export const SHELF_BACK = { x0: IX0, x1: 0.28, z0: IZ0, z1: IZ0 + 0.42, h: 2.0 };
export const GONDOLA = { x0: -1.55, x1: -0.75, z0: -1.25, z1: 0.85, h: 1.45 };
export const CIG_RACK = { x: IX1, z0: -0.45, z1: 0.75, y0: 1.25, y1: 1.95 };
export const CRATES = { x0: IX0 + 0.05, x1: IX0 + 0.7, z0: IZ1 - 0.48, z1: IZ1 - 0.02 };
export const DRINK_CRATES = { x0: 0.0, x1: 0.34, z0: IZ0 + 0.05, z1: IZ0 + 0.75 };

// lamps hanging from the tie beams
export const LAMP_MAIN = { x: 1.25, y: H - 0.55, z: 0.15 };
export const LAMP_2 = { x: -1.15, y: H - 0.5, z: -0.2 };
export const TIE_BEAMS = [-1.7, 0.15, 1.75];

// the errand (game/quest): the four things to buy wait in gaps left on the
// shelves - chips and puffs on the top shelf of the middle unit (facing the
// door), yogurt and a drink in the fridges - each { x, y above the floor, z, yaw }
export const ERRAND = {
  /** the gap on the middle unit's top shelf, door side (z range) */
  gondolaGap: [-0.62, -0.2] as [number, number],
  /** the gap in the middle of each fridge's third shelf (x range per fridge) */
  fridgeGap: [[0.67, 0.86], [1.47, 1.66]] as [number, number][],
  fridgeLevel: 2,
  chips: { x: GONDOLA.x1 - 0.06, y: 1.15, z: -0.505, yaw: Math.PI / 2 },
  puffs: { x: GONDOLA.x1 - 0.06, y: 1.15, z: -0.31, yaw: Math.PI / 2 },
  yogurt: { x: 0.765, y: 0.82, z: FRIDGES[0].z1 - 0.12, yaw: 0 },
  drink: { x: 1.565, y: 0.82, z: FRIDGES[1].z1 - 0.12, yaw: 0 },
  /** the pickle jar on the porch, right of the door */
  jar: { x: DOOR.x1 + 0.45, z: Z1 + 0.36, scale: 1.5 }, // a big one, ~70 cm tall
  /** where the money is laid on the counter (customer side) */
  cash: { x: COUNTER.x0 + 0.22, z: 0.25 },
};
