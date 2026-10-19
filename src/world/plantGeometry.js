import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, createNoise2D, smoothstep } from '../utils/noise.js';

// Procedural geometry builders for trees and plants. Every builder returns a
// geometry with position / normal / uv / color attributes so parts can be
// merged freely.

const UP = new THREE.Vector3(0, 1, 0);

function ensureColor(geo, r = 1, g = 1, b = 1) {
  if (!geo.attributes.color) {
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return geo;
}

export function merge(geos) {
  const list = geos.filter(Boolean).map((g) => {
    ensureColor(g);
    if (!g.index) {
      // make all indexed for mergeGeometries consistency
      const idx = [];
      for (let i = 0; i < g.attributes.position.count; i++) idx.push(i);
      g.setIndex(idx);
    }
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  if (!list.length) return new THREE.BufferGeometry();
  const m = mergeGeometries(list, false);
  m.computeBoundingSphere();
  return m;
}

// ---------------------------------------------------------------------------
// Trunk: tapered, slightly bent, root flare, moss on the lower (north) side.
// ---------------------------------------------------------------------------
export function trunkGeometry({
  height = 20, r0 = 0.45, r1 = 0.08, radial = 10, rings = 14, bend = 0.6, flare = 0.5,
  seed = 1, mossHeight = 2.5, mossColor = [0.55, 0.75, 0.35], uvScaleV = 2.4,
}) {
  const rand = mulberry32(seed);
  const noise = createNoise2D(rand);
  const g = new THREE.CylinderGeometry(1, 1, height, radial, rings, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  const bendDir = rand() * Math.PI * 2;
  const bx = Math.cos(bendDir) * bend, bz = Math.sin(bendDir) * bend;
  const mossDir = rand() * Math.PI * 2;
  const circ = Math.max(1, Math.round(r0 * 2 * Math.PI / 1.2));
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / height;
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const ua = uv.getX(i) * Math.PI * 2;
    let r = r0 + (r1 - r0) * Math.pow(t, 0.85);
    r *= 1 + flare * Math.exp(-y * 1.8) * (0.7 + 0.3 * Math.sin(ua * 5 + seed));
    r *= 1 + 0.07 * noise(Math.cos(ua) * 1.3 + 3, y * 0.35 + Math.sin(ua) * 1.3);
    const off = t * t;
    const x = Math.cos(a) * r + bx * off * height * 0.06;
    const z = Math.sin(a) * r + bz * off * height * 0.06;
    pos.setXYZ(i, x, y, z);
    const slope = (r0 - r1) / height;
    const n = new THREE.Vector3(Math.cos(a), slope, Math.sin(a)).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
    uv.setXY(i, uv.getX(i) * circ, y / uvScaleV);
    // moss: low on the trunk, stronger on one side
    const side = 0.5 + 0.5 * Math.cos(a - mossDir);
    const mh = mossHeight * (0.6 + 0.6 * side);
    const moss = (1 - smoothstep(mh * 0.4, mh, y)) * (0.35 + 0.65 * side);
    const ao = 0.55 + 0.45 * smoothstep(0, 1.5, y);
    colors[i * 3] = (1 - moss + moss * mossColor[0]) * ao;
    colors[i * 3 + 1] = (1 - moss + moss * mossColor[1] * 1.2) * ao;
    colors[i * 3 + 2] = (1 - moss + moss * mossColor[2]) * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.userData.bend = { bx: bx * 0.06 * height, bz: bz * 0.06 * height, height };
  return g;
}

// offset of the bent trunk axis at height y
export function trunkAxisAt(trunk, y) {
  const b = trunk.userData.bend;
  const t = y / b.height;
  return new THREE.Vector3(b.bx * t * t, y, b.bz * t * t);
}

// A limb (tapered cylinder) from a to b
export function limbGeometry(a, b, ra, rb, radial = 6, uvScaleV = 2) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(rb, ra, len, radial, 2, true);
  g.translate(0, len / 2, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), (uv.getY(i) * len) / uvScaleV);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return ensureColor(g, 0.85, 0.85, 0.85);
}

// ---------------------------------------------------------------------------
// Conifer canopy: tiers of drooping branch cards (needle sprays).
// ---------------------------------------------------------------------------
export function coniferFoliage({ trunk, height, crownStart = 0.4, radius = 3.2, tiers = 14, perTier = 5, seed = 1, cardWidth = 0.55, lo = false }) {
  const rand = mulberry32(seed * 7 + (lo ? 3 : 0));
  const parts = [];
  const tierCount = lo ? Math.ceil(tiers / 2) : tiers;
  const per = lo ? Math.max(3, perTier - 2) : perTier;
  for (let k = 0; k < tierCount; k++) {
    const t = k / (tierCount - 1);
    const y = height * (crownStart + (0.96 - crownStart) * t);
    const axis = trunkAxisAt(trunk, y);
    const baseYaw = rand() * Math.PI * 2;
    for (let b = 0; b < per; b++) {
      const L = (radius * Math.pow(1 - t, 0.85) * (0.8 + rand() * 0.4) + 0.45) * (lo ? 1.2 : 1);
      const W = L * cardWidth * (lo ? 1.25 : 1);
      const yaw = baseYaw + (b / per) * Math.PI * 2 + (rand() - 0.5) * 0.6;
      const droop = 0.18 + rand() * 0.25 + (1 - t) * 0.22;
      for (const roll of lo ? [0] : [0.32, -0.32]) {
        const g = new THREE.PlaneGeometry(L, W, 2, 1);
        g.translate(L / 2, 0, 0);
        g.rotateX(-Math.PI / 2 + roll);
        // a bit of droop curvature along the branch
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i);
          p.setY(i, p.getY(i) - (x / L) * (x / L) * L * 0.18);
        }
        g.rotateZ(-droop);
        g.rotateY(yaw);
        g.translate(axis.x, y + (rand() - 0.5) * 0.3, axis.z);
        parts.push(g);
      }
    }
  }
  // top spire
  const top = trunkAxisAt(trunk, height);
  for (let i = 0; i < 2; i++) {
    const g = new THREE.PlaneGeometry(1.4, 0.7);
    g.translate(0.7, 0, 0);
    g.rotateZ(Math.PI / 2 - 0.05);
    g.rotateY(i * Math.PI / 2);
    g.translate(top.x, height - 1.1, top.z);
    parts.push(g);
  }
  const geo = merge(parts);
  canopyShading(geo, height * (crownStart + 0.5 * (1 - crownStart)), radius, height, crownStart, 0.9);
  return geo;
}

// Normals pointing outward from the crown axis (soft volumetric lighting) +
// vertex color "ambient occlusion" darker toward the inside / bottom.
function canopyShading(geo, centerY, radius, height, crownStart, upBias = 0.6) {
  const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rxz = Math.hypot(x, z);
    v.set(x, (y - centerY) * 0.35 + upBias * radius * 0.5, z).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const yt = smoothstep(height * crownStart, height, y);
    const outer = Math.min(1, rxz / Math.max(0.5, radius * (1 - yt * 0.7)));
    const ao = 0.38 + 0.42 * outer + 0.3 * yt;
    const tint = 0.92 + 0.16 * Math.sin(x * 1.7 + z * 2.3);
    c.setXYZ(i, ao * tint, ao * tint, ao);
  }
}

// ---------------------------------------------------------------------------
// Broadleaf crown: limbs + clusters of crossed leaf cards in an ellipsoid.
// ---------------------------------------------------------------------------
export function broadleafParts({ trunk, height, crownStart = 0.5, crownRadius = 4, clusters = 30, seed = 1, lo = false }) {
  const rand = mulberry32(seed * 13 + (lo ? 5 : 0));
  const crownCenterY = height * (crownStart + (1 - crownStart) * 0.55);
  const crownRy = height * (1 - crownStart) * 0.55;
  const limbs = [];
  const leaves = [];
  const limbCount = lo ? 3 : 5;
  const ends = [];
  for (let i = 0; i < limbCount; i++) {
    const y0 = height * (crownStart + rand() * 0.15);
    const a = trunkAxisAt(trunk, y0);
    const ang = (i / limbCount) * Math.PI * 2 + rand() * 0.8;
    const len = crownRadius * (0.7 + rand() * 0.4);
    const b = new THREE.Vector3(a.x + Math.cos(ang) * len, y0 + len * (0.6 + rand() * 0.5), a.z + Math.sin(ang) * len);
    limbs.push(limbGeometry(a, b, 0.16, 0.04, lo ? 4 : 6));
    ends.push(b);
  }
  const n = lo ? Math.ceil(clusters * 0.4) : clusters;
  for (let i = 0; i < n; i++) {
    // random point biased to the ellipsoid surface
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const rr = Math.pow(rand(), 0.35);
    let px = s * Math.cos(th) * crownRadius * rr;
    let pz = s * Math.sin(th) * crownRadius * rr;
    let py = crownCenterY + u * crownRy * rr;
    if (i < ends.length) { px = ends[i].x; py = ends[i].y; pz = ends[i].z; }
    const size = (2.3 + rand() * 1.4) * (lo ? 1.5 : 1);
    const planes = lo ? 2 : 3;
    for (let k = 0; k < planes; k++) {
      const g = new THREE.PlaneGeometry(size, size);
      g.rotateX(rand() * Math.PI);
      g.rotateY(rand() * Math.PI);
      g.rotateZ((rand() - 0.5) * 0.8);
      g.translate(px, py, pz);
      leaves.push(g);
    }
  }
  const leafGeo = merge(leaves);
  // shading relative to crown center
  const p = leafGeo.attributes.position, nn = leafGeo.attributes.normal, c = leafGeo.attributes.color;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    v.set(x / crownRadius, (y - crownCenterY) / crownRy + 0.35, z / crownRadius);
    const depth = Math.min(1, v.length());
    v.normalize();
    nn.setXYZ(i, v.x, v.y, v.z);
    const ao = 0.35 + 0.55 * depth + 0.15 * smoothstep(crownCenterY - crownRy, crownCenterY + crownRy, y);
    c.setXYZ(i, ao * 0.95, ao, ao * 0.9);
  }
  return { limbs: merge(limbs), leaves: leafGeo };
}

// ---------------------------------------------------------------------------
// Understory
// ---------------------------------------------------------------------------
export function fernGeometry(seed = 1, fronds = 8, length = 1.0) {
  const rand = mulberry32(seed);
  const parts = [];
  for (let f = 0; f < fronds; f++) {
    const L = length * (0.7 + rand() * 0.45);
    const W = L * 0.42;
    const elev = 0.75 + rand() * 0.45;
    const seg = 5;
    const g = new THREE.PlaneGeometry(W, L, 1, seg);
    g.translate(0, L / 2, 0); // base at origin, frond along +Y in its plane
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), v = p.getY(i) / L;
      // arch: rises then droops
      const out = L * (Math.cos(elev) * v + 0.35 * v * v);
      const up = L * (Math.sin(elev) * v - 0.62 * v * v);
      p.setXYZ(i, x * (0.4 + 0.6 * Math.sin(Math.min(1, v * 1.4) * Math.PI * 0.5)), up, out);
    }
    const yaw = (f / fronds) * Math.PI * 2 + rand() * 0.5;
    g.rotateZ((rand() - 0.5) * 0.3);
    g.rotateY(yaw);
    const c = new Float32Array(p.count * 3);
    const nor = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), d = Math.hypot(p.getX(i), p.getZ(i));
      const ao = 0.5 + 0.5 * Math.min(1, d / L);
      c[i * 3] = ao; c[i * 3 + 1] = ao; c[i * 3 + 2] = ao * 0.95;
      const nv = new THREE.Vector3(p.getX(i), y + 0.8, p.getZ(i)).normalize();
      nor.setXYZ(i, nv.x, nv.y, nv.z);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  }
  return merge(parts);
}

export function cardClump(seed = 1, cards = 5, size = 1.2, height = 1.0, spread = 0.35, tilt = 0.35) {
  const rand = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const w = size * (0.8 + rand() * 0.4), h = height * (0.8 + rand() * 0.4);
    const g = new THREE.PlaneGeometry(w, h, 1, 2);
    g.translate(0, h / 2, 0);
    const yaw = (i / cards) * Math.PI + rand() * 0.6;
    g.rotateX((rand() - 0.5) * tilt);
    g.rotateY(yaw);
    g.translate((rand() - 0.5) * spread, -0.02, (rand() - 0.5) * spread);
    parts.push(g);
  }
  const geo = merge(parts);
  const p = geo.attributes.position, n = geo.attributes.normal, c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const v = new THREE.Vector3(p.getX(i), y * 0.5 + height * 0.5, p.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    const ao = 0.62 + 0.5 * smoothstep(0, height, y);
    c.setXYZ(i, ao, ao, ao);
  }
  return geo;
}

export function rockGeometry(seed = 1, detail = 3, flatten = 0.6, mossy = 0.6) {
  const rand = mulberry32(seed);
  const noise = createNoise2D(rand);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + 0.22 * noise(v.x * 1.6 + v.z, v.y * 1.6) + 0.08 * noise(v.x * 4, v.z * 4 + v.y * 3);
    v.multiplyScalar(k);
    v.y *= flatten;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const up = n.getY(i);
    const m = smoothstep(0.25, 0.75, up) * mossy;
    const ao = 0.6 + 0.4 * smoothstep(-0.15, 0.4, p.getY(i));
    c[i * 3] = (1 - m + m * 0.45) * ao;
    c[i * 3 + 1] = (1 - m + m * 0.75) * ao;
    c[i * 3 + 2] = (1 - m + m * 0.25) * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function mushroomGeometry(seed = 1, count = 4) {
  const rand = mulberry32(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const h = 0.05 + rand() * 0.09, r = 0.03 + rand() * 0.05;
    const x = (rand() - 0.5) * 0.25, z = (rand() - 0.5) * 0.25;
    const stem = new THREE.CylinderGeometry(r * 0.22, r * 0.3, h, 6, 1);
    stem.translate(x, h / 2, z);
    ensureColor(stem, 0.85, 0.8, 0.7);
    const cap = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    cap.scale(1, 0.55 + rand() * 0.3, 1);
    cap.translate(x, h, z);
    const t = rand();
    const col = t < 0.6 ? [0.42, 0.27, 0.15] : t < 0.85 ? [0.6, 0.45, 0.28] : [0.62, 0.22, 0.1];
    ensureColor(cap, col[0], col[1], col[2]);
    parts.push(stem, cap);
  }
  return merge(parts);
}

export function logGeometry(length = 5, radius = 0.35, seed = 1) {
  const rand = mulberry32(seed);
  const noise = createNoise2D(rand);
  const g = new THREE.CylinderGeometry(radius * 0.85, radius, length, 10, 8, false);
  // lay along X
  g.rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.08 * noise(x * 0.6, Math.atan2(z, y) * 1.5);
    p.setXYZ(i, x, y * k, z * k);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * length / 2.4);
  const n = g.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const m = smoothstep(0.1, 0.7, n.getY(i)) * 0.85;
    const ao = 0.55 + 0.45 * smoothstep(-radius, radius * 0.5, p.getY(i));
    c[i * 3] = (1 - m + m * 0.45) * ao;
    c[i * 3 + 1] = (1 - m + m * 0.78) * ao;
    c[i * 3 + 2] = (1 - m + m * 0.28) * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.translate(0, radius * 0.75, 0);
  return g;
}
