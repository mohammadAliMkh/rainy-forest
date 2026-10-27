import type { FlightRoute } from '../people/Flight.ts';

// Scenario 1, "the sheet ghost": where everything happens (world x / z
// around the cabin and the fire, see config.js CABIN / FIRE / CAMP) and
// when (seconds from the start). The ghost creeps out from behind the
// cabin along its west wall, peeks round the corner, tiptoes up behind
// the owner and Amin and says BOO; the four scream and scatter into the
// trees (Amir hops back over his log, Amin over the tea crate); the ghost
// giggles, finds itself alone, gets spooked itself and flees the way it
// came, fading away; the friends walk back laughing and sit down.

export const TITLE = 'سناریو ۱: روح پارچه‌ای';

/** the ghost's way in: out from behind the cabin, along its west wall, the front corner, up behind the friends */
export const GHOST_IN: [number, number][] = [[1.4, -25.3], [-2.0, -25.0], [-2.0, -18.6], [-0.8, -18.0], [0.4, -17.3]];
/** index of the front corner in GHOST_IN (where it peeks) */
export const CORNER = 2;

export const T = {
  sneak: 0.8, // leaves its hiding place behind the cabin
  corner: 8.8, // reaches the front corner
  peekEnd: 12.0, // done peeking, tiptoes over
  arrive: 18.2, // right behind them, starts to rise
  boo: 19.4,
  giggle: 20.6, // happy little dance
  lookAround: 22.6, // ...where did everyone go?
  spooked: 23.7, // it scares itself
  gone: 27.0, // fled and faded out
  comeBack: 27.8, // the friends start walking back
};

/** who runs where, and when after the BOO they jump (seconds) */
export const FLEE: Record<string, FlightRoute & { delay: number }> = {
  // west, past his stump, into the open trees
  owner: { delay: 0.05, path: [[-0.75, -14.6], [-7.0, -14.9]] },
  // over the tea crate, then east toward the carport
  amin: { delay: 0.12, path: [[3.6, -16.0], [6.9, -15.5]], hops: [0] },
  // back over his own log, then south-east
  amir: { delay: 0.2, path: [[3.65, -14.95], [8.3, -11.4]], hops: [0] },
  // round the end of his log and down the slope toward the trail
  alireza: { delay: 0.28, path: [[1.6, -12.6], [1.0, -6.2]] },
};

/** the film camera: one shot after another (hard cuts); y is above the ground under the camera */
export interface Shot {
  from: number;
  pos: [number, number, number];
  look: [number, number, number] | 'ghost';
  fov: number;
}
export const SHOTS: Shot[] = [
  // the camp in the foreground, the cabin's west wall behind: something moves along it
  { from: 0, pos: [-3.4, 2.8, -10.4], look: [-1.4, 0.9, -20.0], fov: 50 },
  // the corner: it peeks
  { from: T.corner - 0.2, pos: [0.1, 1.45, -15.4], look: 'ghost', fov: 48 },
  // over the fire: the friends chatting, the ghost tiptoeing up behind them
  { from: T.peekEnd, pos: [1.0, 1.45, -11.0], look: [0.4, 1.15, -16.6], fov: 48 },
  // closer as it rises behind them
  { from: T.arrive, pos: [0.7, 1.3, -13.4], look: [0.5, 1.45, -16.6], fov: 42 },
  // BOO! - its face and theirs, from the side (the owner flees right past the camera)
  { from: T.boo, pos: [-1.9, 1.6, -13.4], look: [0.5, 1.3, -16.4], fov: 56 },
  // wide: everyone scatters, the ghost giggles
  { from: T.boo + 1.3, pos: [-3.4, 2.8, -9.4], look: [1.4, 0.9, -15.2], fov: 60 },
  // it scares itself and flees back along the wall
  { from: T.spooked - 0.1, pos: [-4.2, 1.7, -16.0], look: 'ghost', fov: 50 },
  // the friends walk back laughing and sit down
  { from: T.comeBack - 0.3, pos: [5.6, 3.2, -8.4], look: [1.2, 0.6, -14.8], fov: 54 },
];
