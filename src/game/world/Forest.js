import * as THREE from 'three';
import { WORLD, CABIN, FIRE, PUDDLES, SPAWN } from '../../config/config.js';
import { applyWind } from '../../engine/render/shaderPatches.js';
import { mulberry32, worldNoise, detailNoise, smoothstep } from '../../utils/noise.js';
import { InstancedSet, makeMatrix } from './InstancedSet.js';
import {
  trunkGeometry, limbGeometry, coniferFoliage, broadleafParts, merge, trunkAxisAt,
} from './plantGeometry.js';

// Tall old trees: several conifer and broadleaf templates instanced across
// the whole world, with collision circles for every trunk.

const NO_FACE_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

export function foliageMaterial(map, { sway, flutter, heightScale, roughness = 0.62, translucency = 0.35, alwaysRich = false } = {}) {
  const extra = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', NO_FACE_FLIP)
      // cheap translucency: leaves glow slightly with the ambient sky
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * ${translucency.toFixed(3)} * ambientLightColor;`);
  };
  extra.key = 'foliage';
  // rich: PBR with wet specular reflections; cheap: Lambert for laptop GPUs
  const rich = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness, metalness: 0, envMapIntensity: 0.6,
  });
  const cheap = new THREE.MeshLambertMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true });
  applyWind(rich, { sway, flutter, heightScale, extraFragment: extra });
  applyWind(cheap, { sway, flutter, heightScale, extraFragment: extra });
  if (!alwaysRich) rich.userData.cheap = cheap;
  return rich;
}

/** Switch every foliage mesh under root between its rich and cheap material. */
export function setFoliageQuality(root, rich) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.userData.richMat) o.userData.richMat = o.material;
    const cheap = o.userData.richMat.userData?.cheap;
    o.material = rich || !cheap ? o.userData.richMat : cheap;
  });
}

export function barkMaterial(T, { sway = 0.2, heightScale = 0.05 } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: T.bark,
    normalMap: T.barkNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    vertexColors: true,
    roughness: 0.82,
    metalness: 0,
    envMapIntensity: 0.5,
  });
  applyWind(m, { sway, flutter: 0, heightScale });
  return m;
}

function buildTemplates(T) {
  const templates = [];
  const trunkMat = barkMaterial(T, { sway: 0.22, heightScale: 0.05 });
  const needleMat = foliageMaterial(T.needles, { sway: 0.22, flutter: 0.015, heightScale: 0.05, roughness: 0.65 });
  const leafMat = foliageMaterial(T.leaves, { sway: 0.22, flutter: 0.03, heightScale: 0.05, roughness: 0.55, translucency: 0.45 });

  // ---- conifers ----
  const coniferDefs = [
    { height: 27, r0: 0.5, crownStart: 0.42, radius: 3.6, tiers: 15, perTier: 5, seed: 3 },
    { height: 22, r0: 0.38, crownStart: 0.36, radius: 2.9, tiers: 13, perTier: 5, seed: 5 },
    { height: 32, r0: 0.6, crownStart: 0.55, radius: 3.9, tiers: 14, perTier: 6, seed: 9 },
    { height: 17, r0: 0.3, crownStart: 0.22, radius: 2.6, tiers: 12, perTier: 5, seed: 12 },
  ];
  for (const d of coniferDefs) {
    const trunk = trunkGeometry({ height: d.height, r0: d.r0, r1: 0.06, radial: 10, rings: 14, bend: 0.5, flare: 0.55, seed: d.seed, mossHeight: 3 });
    const trunkLo = trunkGeometry({ height: d.height, r0: d.r0, r1: 0.06, radial: 6, rings: 5, bend: 0.5, flare: 0.55, seed: d.seed, mossHeight: 3 });
    // a few dead stub branches on the bare lower trunk
    const rand = mulberry32(d.seed * 31);
    const stubs = [];
    for (let i = 0; i < 7; i++) {
      const y = d.height * (0.12 + rand() * (d.crownStart - 0.12));
      const a = trunkAxisAt(trunk, y);
      const ang = rand() * Math.PI * 2, len = 0.4 + rand() * 1.1;
      const b = new THREE.Vector3(a.x + Math.cos(ang) * len, y + len * 0.1 - rand() * 0.2, a.z + Math.sin(ang) * len);
      stubs.push(limbGeometry(a, b, 0.045, 0.012, 4));
    }
    const trunkHi = merge([trunk, ...stubs]);
    templates.push({
      kind: 'conifer',
      height: d.height,
      radius: d.r0 * 1.15,
      parts: [
        { hi: trunkHi, lo: trunkLo, material: trunkMat, castShadow: true },
        {
          hi: coniferFoliage({ trunk, height: d.height, crownStart: d.crownStart, radius: d.radius, tiers: d.tiers, perTier: d.perTier, seed: d.seed }),
          lo: coniferFoliage({ trunk, height: d.height, crownStart: d.crownStart, radius: d.radius, tiers: d.tiers, perTier: d.perTier, seed: d.seed, lo: true }),
          material: needleMat,
          castShadow: true,
        },
      ],
    });
  }

  // ---- broadleaves (tall straight trunks like in the reference) ----
  const leafDefs = [
    { height: 21, r0: 0.42, crownStart: 0.55, crownRadius: 4.2, clusters: 30, seed: 21 },
    { height: 25, r0: 0.36, crownStart: 0.62, crownRadius: 3.6, clusters: 26, seed: 23 },
    { height: 15, r0: 0.3, crownStart: 0.42, crownRadius: 3.4, clusters: 24, seed: 27 },
  ];
  for (const d of leafDefs) {
    const trunk = trunkGeometry({ height: d.height * 0.88, r0: d.r0, r1: 0.12, radial: 10, rings: 12, bend: 0.9, flare: 0.4, seed: d.seed, mossHeight: 4.5 });
    const trunkLo = trunkGeometry({ height: d.height * 0.88, r0: d.r0, r1: 0.12, radial: 6, rings: 4, bend: 0.9, flare: 0.4, seed: d.seed, mossHeight: 4.5 });
    const hi = broadleafParts({ trunk, height: d.height, crownStart: d.crownStart, crownRadius: d.crownRadius, clusters: d.clusters, seed: d.seed });
    const lo = broadleafParts({ trunk, height: d.height, crownStart: d.crownStart, crownRadius: d.crownRadius, clusters: d.clusters, seed: d.seed, lo: true });
    templates.push({
      kind: 'broadleaf',
      height: d.height,
      radius: d.r0 * 1.15,
      parts: [
        { hi: merge([trunk, hi.limbs]), lo: merge([trunkLo, lo.limbs]), material: trunkMat, castShadow: true },
        { hi: hi.leaves, lo: lo.leaves, material: leafMat, castShadow: true },
      ],
    });
  }

  // ---- dead snag ----
  {
    const h = 14;
    const trunk = trunkGeometry({ height: h, r0: 0.42, r1: 0.18, radial: 9, rings: 10, bend: 1.2, flare: 0.5, seed: 77, mossHeight: 6 });
    const trunkLo = trunkGeometry({ height: h, r0: 0.42, r1: 0.18, radial: 6, rings: 4, bend: 1.2, flare: 0.5, seed: 77, mossHeight: 6 });
    const rand = mulberry32(78);
    const limbs = [];
    for (let i = 0; i < 5; i++) {
      const y = h * (0.4 + rand() * 0.5);
      const a = trunkAxisAt(trunk, y);
      const ang = rand() * Math.PI * 2, len = 1 + rand() * 2;
      limbs.push(limbGeometry(a, new THREE.Vector3(a.x + Math.cos(ang) * len, y + len * 0.5, a.z + Math.sin(ang) * len), 0.09, 0.03, 5));
    }
    templates.push({
      kind: 'snag',
      height: h,
      radius: 0.48,
      parts: [{ hi: merge([trunk, ...limbs]), lo: trunkLo, material: trunkMat, castShadow: true }],
    });
  }
  return templates;
}

export class Forest {
  constructor(T, terrain, collision) {
    this.group = new THREE.Group();
    this.templates = buildTemplates(T);
    const rand = mulberry32(2024);
    const buckets = this.templates.map(() => []);
    this.trees = [];

    const cell = 6.2;
    const R = WORLD.forestRadius;
    for (let gx = -R; gx < R; gx += cell) {
      for (let gz = -R; gz < R; gz += cell) {
        const x = gx + rand() * cell, z = gz + rand() * cell;
        const r = Math.hypot(x, z);
        if (r > R) continue;
        // density field: dense stands and small natural openings
        const dens = 0.62 + 0.35 * worldNoise(x * 0.025 + 40, z * 0.025 - 9) + 0.1 * detailNoise(x * 0.1, z * 0.1);
        if (rand() > dens) continue;
        const pd = terrain.pathDistance(x, z);
        if (pd < 2.1 + rand() * 1.2) continue;
        // cabin clearing
        if (Math.hypot((x - CABIN.x) * 0.9, z - CABIN.z) < 9.5) continue;
        if (Math.hypot(x - FIRE.x, z - FIRE.z) < 7) continue;
        if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 3) continue;
        if (collision.inClearZone(x, z)) continue;
        let inPuddle = false;
        for (const p of PUDDLES) if (Math.hypot(x - p[0], z - p[1]) < p[2] + 1.2) inPuddle = true;
        if (inPuddle) continue;

        // template choice: conifer-dominated with broadleaf patches
        const mix = worldNoise(x * 0.018 - 70, z * 0.018 + 33);
        let ti;
        const q = rand();
        if (q < 0.04) ti = 7; // snag
        else if (mix > 0.15 ? q < 0.6 : q < 0.22) ti = 4 + Math.floor(rand() * 3); // broadleaf
        else ti = Math.floor(rand() * 4);
        const tpl = this.templates[ti];
        const scale = 0.78 + rand() * 0.5;
        const y = terrain.heightAt(x, z) - 0.15;
        const tilt = (rand() - 0.5) * 0.06;
        const matrix = makeMatrix(x, y, z, rand() * Math.PI * 2, scale, tilt, (rand() - 0.5) * 0.06, 0.9 + rand() * 0.2);
        buckets[ti].push({ matrix, x, y, z, scale });
        collision.addCircle(x, z, tpl.radius * scale + 0.08, 'tree');
        this.trees.push({ x, z, height: tpl.height * scale, kind: tpl.kind });
      }
    }

    this.sets = this.templates.map((tpl, i) => {
      const set = new InstancedSet(tpl.parts, buckets[i], {
        hiDist: 60, maxDist: 190, radius: tpl.height * 0.6, centerY: tpl.height * 0.5,
      });
      this.group.add(set.group);
      return set;
    });
  }

  setQuality(q) {
    for (const s of this.sets) s.setDistances(q.treeHiDist, 190);
    setFoliageQuality(this.group, q.richFoliage);
  }

  update(camera, frustum) {
    for (const s of this.sets) s.update(camera, frustum);
  }
}
