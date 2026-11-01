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
  owner: { spot: [1.45, -12.0], via: [[0.0, -13.6]], notice: 0.1, stare: 0.45 },
  amin: { spot: [0.15, -11.75], via: [[-0.75, -13.9]], notice: 0.2, stare: 0.75 },
  alireza: { spot: [2.25, -12.2], via: [[1.95, -12.9]], notice: 0.35, stare: 0.6 },
  amir: { spot: [3.05, -12.35], via: [[3.45, -13.5]], notice: 0.25, stare: 0.5 },
};
/**
 * where each friend runs to once the ghost has torn into four, one after
 * each of them, and is caught there: the way from their place in the line
 * (x, z; the last point is where they are caught); how they are caught
 * ('cower': backed up against something, 'fall': slipping in the water,
 * 'climb': up the trunk of `tree`); where their ghost stops, over them; and
 * the film camera for their shot (x, z, height above the ground); how long
 * they stand staring at it before they bolt (s)
 *   Amin: up a broadleaf tree west of the camp
 *   Amir: against his Patrol in the carport
 *   Alireza: in the big puddle on the trail
 *   the owner: behind Farajpour's shop
 */
export const CHASE: Record<string, {
  path: [number, number][]; how: 'cower' | 'fall' | 'climb'; ghost: [number, number];
  tree?: { x: number; z: number; r: number; taper: number; lean: [number, number] }; shot: [number, number, number]; stare: number;
}> = {
  alireza: { path: [[2.6, -10.2], [2.6, -6.4], [1.5, -4.2], [1.0, -3.3]], how: 'fall', ghost: [1.55, -4.95], shot: [-0.6, -0.6, 1.5], stare: 0.45 },
  amin: { path: [[-1.6, -11.2], [-5.0, -10.4], [-9.95, -9.75]], how: 'climb', ghost: [-8.2, -9.9], tree: { x: -10.74, z: -9.65, r: 0.42, taper: 0.03, lean: [-0.045, 0] }, shot: [-6.9, -6.4, 1.5], stare: 0.2 },
  amir: { path: [[4.9, -12.2], [6.5, -14.4], [6.9, -17.0], [7.6, -19.4]], how: 'cower', ghost: [5.8, -18.3], shot: [5.4, -15.0, 1.7], stare: 0.3 },
  owner: { path: [[0.9, -9.6], [-1.5, -2.0], [-6.0, 8.0], [-10.0, 18.0], [-13.2, 24.0], [-14.3, 25.85], [-16.05, 28.65]], how: 'cower', ghost: [-17.5, 27.9], shot: [-18.0, 25.3, 1.6], stare: 0.1 },
};
/** the order of their shots, and how long each lasts (s) */
/** when all four are saved they come back to the fire: how far from their seat each comes into the film (m): the nearer, the sooner */
export const RETURN_LEADS: Record<string, number> = { alireza: 8, amin: 11, amir: 14, owner: 17 };

export const CHASE_SHOTS: [string, number][] = [['alireza', 4.2], ['amin', 5.0], ['amir', 4.2], ['owner', 5.0]];
