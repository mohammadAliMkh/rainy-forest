import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Geometry helpers shared by every builder: a white vertex colour where one
// is missing, and merging many parts (any mix of indexed / non-indexed, with
// or without colours) into one geometry.

export function ensureColor(geo, r = 1, g = 1, b = 1) {
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
