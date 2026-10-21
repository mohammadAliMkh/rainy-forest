import * as THREE from 'three';
import { merge } from '../game/world/plantGeometry.js';

// Merge every mesh under `root` (that doesn't move relative to it) into one
// mesh per material, to keep draw calls low. `keep(mesh)` returning true
// leaves a mesh (and its subtree) untouched, e.g. animated parts.
export function bakeByMaterial(root, keep = () => false) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  root.traverse((o) => {
    if (o === root || !o.isMesh) return;
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.keep || (p.isMesh && keep(p))) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry.index ? o.geometry.clone() : o.geometry.clone();
    g.applyMatrix4(m);
    if (m.determinant() < 0) {
      // mirrored parts: fix the winding
      const idx = g.index;
      if (idx) for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); }
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    let b = buckets.get(o.material);
    if (!b) buckets.set(o.material, (b = { geos: [], cast: false }));
    b.geos.push(g);
    b.cast = b.cast || o.castShadow;
    remove.push(o);
  });
  for (const o of remove) o.parent.remove(o);
  // drop now-empty groups
  const prune = (o) => { for (const c of [...o.children]) { prune(c); if (c.isGroup && !c.children.length && !c.userData.keep) o.remove(c); } };
  prune(root);
  for (const [mat, b] of buckets) {
    const mesh = new THREE.Mesh(merge(b.geos), mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

// Merge, per material, the leaf meshes directly under each node of an
// articulated model (every joint keeps its own transform).
export function bakeJoints(root) {
  const nodes = [];
  root.traverse((o) => { if (!o.isMesh && !o.userData.keep) nodes.push(o); });
  for (const n of nodes) {
    const leaves = n.children.filter((c) => c.isMesh && !c.children.length && !c.userData.keep);
    const byMat = new Map();
    for (const m of leaves) {
      if (!byMat.has(m.material)) byMat.set(m.material, []);
      byMat.get(m.material).push(m);
    }
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        const g = m.geometry.clone().applyMatrix4(m.matrix);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        return g;
      });
      const itemSizes = new Set(geos.map((g) => g.attributes.color?.itemSize ?? 3));
      if (itemSizes.size > 1) continue;
      const mesh = new THREE.Mesh(merge(geos), mat);
      mesh.castShadow = list.some((m) => m.castShadow);
      for (const m of list) n.remove(m);
      n.add(mesh);
    }
  }
}
