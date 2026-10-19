// Central world layout & tuning values. Everything that several modules need
// to agree on (where the cabin is, where the path runs...) lives here.

export const WORLD = {
  size: 380,            // terrain side length (m)
  playableRadius: 150,  // player can't walk beyond this
  forestRadius: 175,    // trees are placed up to here
  eyeHeight: 1.68,
};

// Player spawn & initial look direction (yaw in radians, 0 = looking toward -Z)
export const SPAWN = { x: 0.6, z: 1.5, yaw: 0.05 };

// Cabin footprint (center), facing +Z (door toward the path / spawn)
export const CABIN = {
  x: 2.5,
  z: -21,
  rotation: 0,
  width: 6.2,   // along X
  depth: 5.0,   // along Z
  wallHeight: 2.55,
};

// Campfire sits in front of the cabin at a safe distance from the walls
export const FIRE = { x: 1.2, z: -14.3 };

// Control points of the narrow trail (x, z). It comes out of the far forest,
// passes the spawn point and ends at the campfire in front of the cabin.
export const PATH_POINTS = [
  [-26, 120], [-14, 92], [-18, 66], [-6, 44], [4, 28], [-3, 14],
  [-0.5, 3], [2.2, -5], [0.4, -10.5], [1.2, -14.3],
];

// Small puddles along the trail (x, z, radiusX, radiusZ, rotation)
export const PUDDLES = [
  [0.9, -3.2, 1.7, 1.1, 0.4],
  [2.3, -7.6, 1.0, 0.65, -0.3],
  [-1.6, 9.5, 1.2, 0.8, 0.9],
  [3.1, 21.5, 1.4, 0.9, 0.2],
  [-3.2, 38, 1.1, 0.7, -0.6],
  [5.2, -12.0, 0.7, 0.5, 0.1],
  [-12, 62, 1.3, 0.8, 0.5],
];

// Day cycle: one full day (morning, noon, sunset, night, midnight) per real hour
export const DAY = {
  cycleSeconds: 3600,
  startHour: 7.2,
};

// renderScale = absolute pixel ratio (1 = one rendered pixel per CSS pixel).
// "high" is for a dedicated GPU; "medium" is tuned for typical laptop iGPUs.
export const QUALITY_PRESETS = {
  low: { renderScale: 0.6, msaa: 0, fxaa: true, shadows: false, shadowSize: 1024, bloom: false, reflections: false, richFoliage: false, treeHiDist: 30, vegDist: 30, mistCount: 28 },
  medium: { renderScale: 0.75, msaa: 0, fxaa: true, shadows: false, shadowSize: 1024, bloom: true, reflections: true, reflectionSize: 256, reflectEvery: 3, richFoliage: false, treeHiDist: 42, vegDist: 36, mistCount: 36 },
  high: { renderScale: 1.0, msaa: 4, fxaa: false, shadows: true, shadowSize: 2048, bloom: true, reflections: true, reflectionSize: 512, reflectEvery: 1, richFoliage: true, treeHiDist: 62, vegDist: 70, mistCount: 56 },
};
