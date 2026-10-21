import * as THREE from 'three';
import { WORLD, CABIN, FIRE, PATH_POINTS, PUDDLES, SPAWN } from '../../config/config.js';
import { worldNoise, detailNoise, fbm2, smoothstep, clamp } from '../../utils/noise.js';

// Heightfield terrain with a carved, muddy trail, a flattened cabin clearing
// and shallow depressions for puddles. Exposes fast height / path queries
// used by every other system (player, deer, vegetation...).

const GRID = 1.0; // meters per height sample

function catmullRom(points, samplesPerSeg = 24) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i];
    const p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export class Terrain {
  constructor(textures) {
    this.size = WORLD.size;
    this.half = this.size / 2;
    this.res = Math.round(this.size / GRID) + 1;
    this.pathLine = catmullRom(PATH_POINTS);
    this._buildFields();
    this.mesh = this._buildMesh(textures);
  }

  // Natural rolling forest floor (before path / clearing edits)
  baseHeight(x, z) {
    let h = fbm2(worldNoise, x * 0.011, z * 0.011, 4) * 3.4;
    h += worldNoise(x * 0.0035 + 10, z * 0.0035 - 4) * 6.5;
    h += detailNoise(x * 0.09, z * 0.09) * 0.18;
    // gently rise toward the far edge so the forest feels like a valley
    const r = Math.hypot(x, z);
    h += smoothstep(90, 190, r) * 9;
    return h;
  }

  smoothHeight(x, z) {
    return fbm2(worldNoise, x * 0.011, z * 0.011, 2) * 3.4 * 0.8 + worldNoise(x * 0.0035 + 10, z * 0.0035 - 4) * 6.5
      + smoothstep(90, 190, Math.hypot(x, z)) * 9;
  }

  distanceToPathRaw(x, z) {
    let best = Infinity;
    const L = this.pathLine;
    for (let i = 0; i < L.length - 1; i++) {
      const ax = L[i][0], az = L[i][1], bx = L[i + 1][0], bz = L[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + dx * t - x, pz = az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  _buildFields() {
    const n = this.res;
    this.heights = new Float32Array(n * n);
    this.pathDist = new Float32Array(n * n);
    const cabinH = this.smoothHeight(CABIN.x, CABIN.z + 2);
    this.clearingHeight = cabinH;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -this.half + i * GRID, z = -this.half + j * GRID;
        // path distance (cheap reject for cells far away from the trail's bbox)
        let pd = 999;
        if (x > -60 && x < 40 && z > -40 && z < 140) pd = this.distanceToPathRaw(x, z);
        // trail wobble so the edge isn't perfectly regular
        const wob = detailNoise(x * 0.25, z * 0.25) * 0.35;
        this.pathDist[j * n + i] = pd + wob;

        let h = this.baseHeight(x, z);
        const pathMask = 1 - smoothstep(0.9, 2.6, pd + wob);
        h = h * (1 - pathMask) + (this.smoothHeight(x, z) - 0.12) * pathMask;

        // flatten the cabin clearing
        const dc = Math.hypot((x - CABIN.x) * 0.85, z - (CABIN.z + 2.5));
        const cm = 1 - smoothstep(7, 13, dc);
        h = h * (1 - cm) + (cabinH + detailNoise(x * 0.3, z * 0.3) * 0.05) * cm;

        // puddle depressions
        for (const p of PUDDLES) {
          const dx = (x - p[0]) / (p[2] + 0.6), dz = (z - p[1]) / (p[3] + 0.6);
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < 1.4) h -= (1 - smoothstep(0.2, 1.4, d)) * 0.16;
        }
        this.heights[j * n + i] = h;
      }
    }
    // record puddle water levels
    this.puddleLevels = PUDDLES.map((p) => this.heightAt(p[0], p[1]) + 0.08);
  }

  _sample(field, x, z) {
    const n = this.res;
    const fx = clamp((x + this.half) / GRID, 0, n - 1.001);
    const fz = clamp((z + this.half) / GRID, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const a = field[j * n + i], b = field[j * n + i + 1];
    const c = field[(j + 1) * n + i], d = field[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  heightAt(x, z) { return this._sample(this.heights, x, z); }
  pathDistance(x, z) { return this._sample(this.pathDist, x, z); }
  isOnPath(x, z) { return this.pathDistance(x, z) < 1.4; }

  normalAt(x, z, target = new THREE.Vector3()) {
    const e = 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return target.set(-hx, 2 * e, -hz).normalize();
  }

  _buildMesh(T) {
    const seg = 260;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const mask = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
      const pd = this.pathDistance(x, z);
      const path = 1 - smoothstep(0.6, 2.0, pd);
      // darker / wetter soil near the cabin and around puddles
      const dc = Math.hypot(x - CABIN.x, z - CABIN.z);
      const trampled = (1 - smoothstep(4, 9, dc)) * 0.6 + (1 - smoothstep(0.5, 2.4, Math.hypot(x - FIRE.x, z - FIRE.z))) * 0.8;
      mask[i * 2] = Math.min(1, path + trampled);
      mask[i * 2 + 1] = smoothstep(-0.2, 0.6, detailNoise(x * 0.06 + 3, z * 0.06 - 2)); // moss amount
    }
    geo.setAttribute('aMask', new THREE.BufferAttribute(mask, 2));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: T.ground,
      normalMap: T.groundNormal,
      roughness: 0.92,
      metalness: 0,
      normalScale: new THREE.Vector2(0.9, 0.9),
    });
    const mud = T.mud, mudN = T.mudNormal;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tMud = { value: mud };
      shader.uniforms.tMudN = { value: mudN };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 aMask;
varying vec2 vMask;
varying vec2 vGroundUv;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vMask = aMask;
vGroundUv = vec2(position.x, -position.z);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tMud;
uniform sampler2D tMudN;
varying vec2 vMask;
varying vec2 vGroundUv;
float gHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }`)
        .replace('#include <map_fragment>', `
vec2 guv = vGroundUv / 5.5;
vec2 guv2 = vGroundUv / 17.0 + vec2(0.37, 0.11);
vec4 floorA = texture2D( map, guv );
vec4 floorB = texture2D( map, guv2 * vec2(1.0, -1.0) );
vec4 floorC = mix( floorA, floorB, 0.35 );
vec4 mudC = texture2D( tMud, vGroundUv / 3.5 );
float pathK = smoothstep( 0.15, 0.85, vMask.x );
vec3 mossTint = mix( vec3(1.0), vec3(0.78, 1.12, 0.62), vMask.y * 0.8 );
vec3 floorCol = floorC.rgb * mossTint;
diffuseColor.rgb *= mix( floorCol, mudC.rgb * 0.95, pathK );
`)
        .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = mix( roughness, 0.38, pathK );
`)
        .replace('#include <normal_fragment_maps>', `
vec3 mapN = mix( texture2D( normalMap, guv ).xyz, texture2D( tMudN, vGroundUv / 3.5 ).xyz, pathK ) * 2.0 - 1.0;
mapN.xy *= normalScale;
normal = normalize( tbn * mapN );
`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  spawnPosition() {
    return { x: SPAWN.x, z: SPAWN.z, y: this.heightAt(SPAWN.x, SPAWN.z) };
  }
}
