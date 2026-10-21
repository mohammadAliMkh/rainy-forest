import * as THREE from 'three';
import { CABIN, FIRE, PUDDLES } from '../../config/config.js';
import { mulberry32, worldNoise } from '../../utils/noise.js';
import { InstancedSet, makeMatrix } from './InstancedSet.js';
import { fernGeometry, cardClump, rockGeometry, mushroomGeometry, logGeometry, limbGeometry, merge } from './plantGeometry.js';
import { foliageMaterial, barkMaterial, setFoliageQuality } from './Forest.js';
import { applyWind } from '../../engine/render/shaderPatches.js';
import { fitWidth } from './envModels.ts';

// small plants live on their own layer: drawn by the main camera, skipped by
// the (expensive) puddle reflection pass
export const DETAIL_LAYER = 2;

// Undergrowth & ground clutter: ferns, dewy bushes, grass, wet rocks,
// moss mounds, mushrooms, fallen logs, branches and stumps.

export class Vegetation {
  constructor(T, terrain, collision, forest) {
    this.group = new THREE.Group();
    this.sets = [];
    const rand = mulberry32(99);
    // real scanned models (when loaded); the painted ones stay as a fallback
    const M = T.models || null;
    const windy = new Set();
    // wind for real plants + a cheaper Lambert twin used on laptop-class quality
    const wind = (mat, opts) => {
      if (!windy.has(mat)) {
        windy.add(mat);
        applyWind(mat, opts);
        const cheap = new THREE.MeshLambertMaterial({
          map: mat.map, normalMap: mat.normalMap, side: mat.side, alphaTest: mat.alphaTest, transparent: mat.transparent,
        });
        applyWind(cheap, opts);
        mat.userData.cheap = cheap;
      }
      return mat;
    };
    const lod = (name) => (M && M[name + '_lo'] ? M[name + '_lo'].geometry : undefined);

    const blocked = (x, z, pathMin) => {
      if (terrain.pathDistance(x, z) < pathMin) return true;
      if (Math.abs(x - CABIN.x) < CABIN.width / 2 + 1.2 && Math.abs(z - CABIN.z) < CABIN.depth / 2 + 1.2) return true;
      if (Math.hypot(x - FIRE.x, z - FIRE.z) < (pathMin > 1.2 ? 4.5 : 2.6)) return true;
      for (const p of PUDDLES) if (Math.hypot((x - p[0]) / p[2], (z - p[1]) / p[3]) < 1.25) return true;
      if (collision.isBlocked(x, z, 0.15) || collision.inClearZone(x, z)) return true;
      return false;
    };

    // scatter helper: random points near the player area (denser close to
    // the trail so the walk feels lush, like the reference photo)
    const scatter = (count, radius, pathMin, pathBias, accept = () => true) => {
      const pts = [];
      let guard = 0;
      while (pts.length < count && guard++ < count * 30) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * radius;
        let x = Math.cos(a) * d, z = Math.sin(a) * d + 8;
        if (pathBias && rand() < pathBias) {
          // pick a point near the trail
          const L = terrain.pathLine;
          const p = L[Math.floor(rand() * L.length)];
          const off = pathMin + rand() * 5;
          const ang = rand() * Math.PI * 2;
          x = p[0] + Math.cos(ang) * off; z = p[1] + Math.sin(ang) * off;
        }
        if (blocked(x, z, pathMin)) continue;
        if (!accept(x, z)) continue;
        pts.push([x, z]);
      }
      return pts;
    };

    // ---------------- Ferns ----------------
    {
      const fernNames = ['fern_a', 'fern_b', 'fern_c', 'fern_d'];
      const real = M && M.fern_a ? fernNames.map((k) => M[k]) : null;
      const mat = real ? wind(real[0].material, { sway: 0.05, flutter: 0.015, heightScale: 1.2 })
        : foliageMaterial(T.fern, { sway: 0.06, flutter: 0.02, heightScale: 1.0, roughness: 0.55, translucency: 0.5 });
      const geos = real ? real.map((p) => p.geometry) : [fernGeometry(1, 8, 1.0), fernGeometry(2, 10, 0.8), fernGeometry(3, 7, 1.25)];
      const items = geos.map(() => []);
      for (const [x, z] of scatter(real ? 4200 : 5200, 115, 2.0, 0.22, (x, z) => worldNoise(x * 0.06, z * 0.06) > -0.35)) {
        const k = Math.floor(rand() * geos.length);
        const s = real ? 0.9 + rand() * 0.8 : 0.6 + rand() * 0.7;
        items[k].push({ matrix: makeMatrix(x, terrain.heightAt(x, z) - 0.03, z, rand() * 6.28, s), x, y: terrain.heightAt(x, z), z, scale: s });
      }
      geos.forEach((g, i) => this._add([{ hi: g, lo: real ? lod(fernNames[i]) : undefined, material: mat }], items[i], { maxDist: 70, hiDist: 16, radius: 1.3, layer: DETAIL_LAYER }));
    }

    // ---------------- Dewy broadleaf bushes ----------------
    {
      const mat = foliageMaterial(T.bushLeaves, { sway: 0.08, flutter: 0.035, heightScale: 1.0, roughness: 0.42, translucency: 0.4 });
      mat.envMapIntensity = 0.75;
      const geos = [cardClump(11, 6, 1.4, 1.2, 0.5, 0.6), cardClump(12, 5, 1.0, 0.8, 0.35, 0.5), cardClump(13, 7, 1.8, 1.6, 0.6, 0.7)];
      const items = geos.map(() => []);
      for (const [x, z] of scatter(M && M.shrub_a ? 900 : 1500, 110, 2.5, 0.35)) {
        const k = Math.floor(rand() * geos.length);
        const s = 0.6 + rand() * 0.8;
        items[k].push({ matrix: makeMatrix(x, terrain.heightAt(x, z) - 0.05, z, rand() * 6.28, s), x, y: terrain.heightAt(x, z), z, scale: s });
      }
      // a couple of hero bushes right next to the spawn, like the reference photo foreground
      const hero = [[-1.6, -0.4, 1.4], [2.9, -1.0, 1.2], [-2.2, -4.6, 1.3], [3.6, 3.2, 1.1]];
      for (const [x, z, s] of hero) {
        items[2].push({ matrix: makeMatrix(x, terrain.heightAt(x, z) - 0.05, z, rand() * 6.28, s), x, y: terrain.heightAt(x, z), z, scale: s });
      }
      geos.forEach((g, i) => this._add([{ hi: g, material: mat }], items[i], { maxDist: 75, radius: 1.2, layer: DETAIL_LAYER }));
    }

    // ---------------- Real shrubs (scanned) ----------------
    if (M && M.shrub_a) {
      const shrubNames = ['shrub_a', 'shrub_b', 'shrub_d'];
      const parts = shrubNames.map((k) => M[k]);
      const items = parts.map(() => []);
      for (const [x, z] of scatter(420, 105, 3.0, 0.25)) {
        const k = Math.floor(rand() * parts.length);
        const s = 0.45 + rand() * 0.45;
        const y = terrain.heightAt(x, z) - 0.05;
        items[k].push({ matrix: makeMatrix(x, y, z, rand() * 6.28, s), x, y, z, scale: s });
      }
      parts.forEach((p, i) => this._add([{ hi: p.geometry, lo: lod(shrubNames[i]), material: wind(p.material, { sway: 0.06, flutter: 0.02, heightScale: 0.6 }) }], items[i], { maxDist: 80, hiDist: 22, radius: 1.4, layer: DETAIL_LAYER }));
    }

    // ---------------- Grass tufts ----------------
    {
      const grassNames = ['grass_c', 'grass_d', 'grass_e'];
      const real = M && M.grass_c ? grassNames.map((k) => M[k]) : null;
      const mat = real ? wind(real[0].material, { sway: 0.1, flutter: 0.015, heightScale: 3.0 })
        : foliageMaterial(T.grass, { sway: 0.12, flutter: 0.02, heightScale: 2.0, roughness: 0.6, translucency: 0.5 });
      const geos = real ? real.map((p) => p.geometry) : [cardClump(21, 3, 0.55, 0.45, 0.1, 0.25)];
      const items = geos.map(() => []);
      for (const [x, z] of scatter(real ? 4200 : 6500, 90, 1.15, 0.4)) {
        const s = real ? 0.9 + rand() * 1.0 : 0.6 + rand() * 0.9;
        items[Math.floor(rand() * geos.length)].push({ matrix: makeMatrix(x, terrain.heightAt(x, z) - 0.02, z, rand() * 6.28, s), x, y: terrain.heightAt(x, z), z, scale: s });
      }
      geos.forEach((g, i) => this._add([{ hi: g, lo: real ? lod(grassNames[i]) : undefined, material: mat }], items[i], { maxDist: 50, hiDist: 12, radius: 0.5, layer: DETAIL_LAYER }));
    }

    // ---------------- Rocks & moss mounds ----------------
    {
      const stoneMat = new THREE.MeshStandardMaterial({
        map: T.stone, normalMap: T.stoneNormal, vertexColors: true, roughness: 0.42, metalness: 0, envMapIntensity: 0.9,
      });
      const mossMat = new THREE.MeshStandardMaterial({
        map: T.ground, normalMap: T.groundNormal, vertexColors: true, roughness: 0.95, color: new THREE.Color(0.55, 0.85, 0.3),
      });
      // real mossy rocks are normalized to a 1 m half-width so `s` keeps meaning "radius"
      const smallRocks = M && M.rock_small_7 ? [7, 8, 9, 10, 11, 12, 13].map((i) => M['rock_small_' + i]) : null;
      const bigRocks = M && M.rock_big_1 ? [1, 2, 3, 4, 5, 6].map((i) => M['rock_big_' + i]).concat(M.boulder ? [M.boulder] : []) : [];
      const realRocks = smallRocks ? smallRocks.concat(bigRocks) : null;
      const rockGeos = realRocks ? realRocks.map((p) => fitWidth(p, 1)) : [rockGeometry(1, 3, 0.6, 0.55), rockGeometry(2, 3, 0.45, 0.7), rockGeometry(3, 2, 0.75, 0.4)];
      const nSmall = smallRocks ? smallRocks.length : 0;
      const mossGeos = [rockGeometry(4, 3, 0.42, 1.0), rockGeometry(5, 3, 0.35, 1.0)];
      const rockItems = rockGeos.map(() => []);
      const mossItems = mossGeos.map(() => []);
      for (const [x, z] of scatter(420, 120, 1.6, 0.25)) {
        const big = rand() < 0.12;
        const s = big ? 0.8 + rand() * 0.9 : 0.15 + rand() * 0.4;
        const k = realRocks && bigRocks.length
          ? (big ? nSmall + Math.floor(rand() * bigRocks.length) : Math.floor(rand() * nSmall))
          : Math.floor(rand() * rockGeos.length);
        const y = terrain.heightAt(x, z) - s * (realRocks ? 0.18 : 0.12);
        rockItems[k].push({ matrix: makeMatrix(x, y, z, rand() * 6.28, s, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3), x, y, z, scale: s });
        if (s > 0.45) collision.addCircle(x, z, s * 0.85, 'rock');
      }
      // moss mounds love the trail edges (reference: mossy humps beside the path)
      for (const [x, z] of scatter(380, 100, 1.8, 0.6)) {
        const s = 0.35 + rand() * 0.6;
        const k = Math.floor(rand() * mossGeos.length);
        const y = terrain.heightAt(x, z) - s * 0.2;
        mossItems[k].push({ matrix: makeMatrix(x, y, z, rand() * 6.28, s, 0, 0, 0.8), x, y, z, scale: s });
      }
      // hero mounds near spawn
      for (const [x, z, s] of [[-1.4, -2.4, 0.8], [-2.0, -1.1, 0.6], [-1.2, -3.8, 0.55], [3.2, -3.0, 0.5]]) {
        const y = terrain.heightAt(x, z) - s * 0.2;
        mossItems[0].push({ matrix: makeMatrix(x, y, z, rand() * 6.28, s, 0, 0, 0.8), x, y, z, scale: s });
      }
      rockGeos.forEach((g, i) => this._add([{ hi: g, material: realRocks ? realRocks[i].material : stoneMat, castShadow: true }], rockItems[i], { maxDist: 90, radius: 1.2 }));
      mossGeos.forEach((g, i) => this._add([{ hi: g, material: mossMat }], mossItems[i], { maxDist: 80, radius: 1.2 }));
    }

    // ---------------- Mushrooms (near trunks) ----------------
    {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 });
      const geos = [mushroomGeometry(1, 4), mushroomGeometry(2, 6), mushroomGeometry(3, 3)];
      const items = geos.map(() => []);
      const trees = forest.trees;
      for (let i = 0; i < 520; i++) {
        const t = trees[Math.floor(rand() * trees.length)];
        if (Math.hypot(t.x, t.z - 8) > 100) continue;
        const a = rand() * 6.28, d = 0.7 + rand() * 1.4;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (blocked(x, z, 1.0)) continue;
        const s = 0.8 + rand() * 0.9;
        const k = Math.floor(rand() * geos.length);
        items[k].push({ matrix: makeMatrix(x, terrain.heightAt(x, z) - 0.01, z, rand() * 6.28, s), x, y: terrain.heightAt(x, z), z, scale: s });
      }
      geos.forEach((g, i) => this._add([{ hi: g, material: mat }], items[i], { maxDist: 35, radius: 0.3, layer: DETAIL_LAYER }));
    }

    // ---------------- Fallen logs, branches, stumps ----------------
    {
      const logMat = barkMaterial(T, { sway: 0, heightScale: 0 });
      const lengths = [6, 4, 9], radii = [0.38, 0.28, 0.45];
      const trunk = M && M.dead_trunk;
      // the scanned dead trunk is stretched to each log size (length along X)
      const logGeos = trunk
        ? lengths.map((L, i) => {
          const b = trunk.box, g = trunk.geometry.clone();
          const d = (radii[i] * 2) / Math.max(b.max.y - b.min.y, b.max.z - b.min.z);
          g.scale(L / (b.max.x - b.min.x), d, d);
          return g;
        })
        : [logGeometry(6, 0.38, 1), logGeometry(4, 0.28, 2), logGeometry(9, 0.45, 3)];
      const logPartMat = trunk ? trunk.material : logMat;
      const logItems = logGeos.map(() => []);
      for (const [x, z] of scatter(70, 120, 3.5, 0.15)) {
        const k = Math.floor(rand() * logGeos.length);
        const rot = rand() * Math.PI;
        const L = lengths[k];
        const dx = Math.cos(rot) * L * 0.5, dz = -Math.sin(rot) * L * 0.5;
        // keep logs fully off the trail
        if (terrain.pathDistance(x + dx, z + dz) < 2.5 || terrain.pathDistance(x - dx, z - dz) < 2.5) continue;
        if (collision.isBlocked(x + dx, z + dz, 0.4) || collision.isBlocked(x - dx, z - dz, 0.4)) continue;
        const h1 = terrain.heightAt(x + dx, z + dz), h2 = terrain.heightAt(x - dx, z - dz);
        const y = (h1 + h2) / 2 - radii[k] * (trunk ? 0.25 : 0.35);
        const tiltZ = Math.atan2(h1 - h2, L);
        logItems[k].push({ matrix: makeMatrix(x, y, z, rot, 1, 0, tiltZ), x, y, z, scale: 1 });
        // collision: circles along the log
        const steps = Math.ceil(L / 0.7);
        for (let s = 0; s <= steps; s++) {
          const t = s / steps - 0.5;
          collision.addCircle(x + Math.cos(rot) * L * t, z - Math.sin(rot) * L * t, radii[k] + 0.05, 'log');
        }
      }
      logGeos.forEach((g, i) => this._add([{ hi: g, material: logPartMat, castShadow: true }], logItems[i], { maxDist: 110, radius: 5 }));

      // small fallen branches (no collision)
      const branchGeo = merge([
        limbGeometry(new THREE.Vector3(-0.9, 0.04, 0), new THREE.Vector3(0.9, 0.05, 0.1), 0.035, 0.015, 5),
        limbGeometry(new THREE.Vector3(0.1, 0.05, 0.02), new THREE.Vector3(0.6, 0.06, 0.45), 0.018, 0.008, 4),
        limbGeometry(new THREE.Vector3(-0.4, 0.04, 0), new THREE.Vector3(-0.8, 0.05, -0.35), 0.016, 0.007, 4),
      ]);
      const realBranches = M && M.branch_a ? ['branch_a', 'branch_b', 'branch_c'].map((k) => M[k]) : null;
      const branchGeos = realBranches ? realBranches.map((p) => p.geometry) : [branchGeo];
      const branchItems = branchGeos.map(() => []);
      for (const [x, z] of scatter(500, 90, 1.6, 0.2)) {
        const s = realBranches ? 0.8 + rand() * 0.8 : 0.6 + rand() * 1.2;
        const y = terrain.heightAt(x, z) - 0.01;
        branchItems[Math.floor(rand() * branchGeos.length)].push({ matrix: makeMatrix(x, y, z, rand() * 6.28, s), x, y, z, scale: s });
      }
      branchGeos.forEach((g, i) => this._add([{ hi: g, material: realBranches ? realBranches[i].material : logMat }], branchItems[i], { maxDist: 40, radius: 1, layer: DETAIL_LAYER }));

      // stumps
      const stumpGeo = new THREE.CylinderGeometry(0.32, 0.42, 0.5, 10, 1, false);
      stumpGeo.translate(0, 0.2, 0);
      const realStumps = M && M.stump_a ? ['stump_a', 'stump_b'].map((k) => M[k]) : null;
      const stumpGeos = realStumps ? realStumps.map((p) => fitWidth(p, 0.75)) : [merge([stumpGeo])];
      const stumpItems = stumpGeos.map(() => []);
      for (const [x, z] of scatter(45, 110, 2.5, 0.1)) {
        const s = 0.7 + rand() * 0.6;
        const y = terrain.heightAt(x, z) - (realStumps ? 0.04 : 0);
        stumpItems[Math.floor(rand() * stumpGeos.length)].push({ matrix: makeMatrix(x, y, z, rand() * 6.28, s), x, y, z, scale: s });
        collision.addCircle(x, z, 0.42 * s, 'stump');
      }
      stumpGeos.forEach((g, i) => this._add([{ hi: g, material: realStumps ? realStumps[i].material : logMat, castShadow: true }], stumpItems[i], { maxDist: 90, radius: 0.8 }));
    }
  }

  _add(parts, items, opts) {
    if (!items.length) return;
    if (opts.layer !== undefined) for (const p of parts) p.layer = opts.layer;
    const set = new InstancedSet(parts, items, opts);
    set.baseMaxDist = opts.maxDist;
    this.sets.push(set);
    this.group.add(set.group);
  }

  setQuality(q) {
    const k = q.vegDist / 60;
    for (const s of this.sets) s.maxDist = s.baseMaxDist * k;
    setFoliageQuality(this.group, q.richFoliage);
  }

  update(camera, frustum) {
    for (const s of this.sets) s.update(camera, frustum);
  }
}
