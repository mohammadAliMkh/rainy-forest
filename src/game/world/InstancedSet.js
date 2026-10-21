import * as THREE from 'three';

// A set of placed instances rendered through one or two InstancedMeshes per
// "part" (e.g. trunk + foliage). Every frame the visible instances are chosen
// with frustum + distance culling and split into a high and a low detail
// level. This keeps the large forest cheap enough for ordinary laptops.

const _sphere = new THREE.Sphere();
const _m = new THREE.Matrix4();

export class InstancedSet {
  /**
   * parts: [{ hi: geometry, lo?: geometry, material, castShadow, receiveShadow }]
   * opts: { hiDist, maxDist, radius (bounding radius in local units), centerY }
   */
  constructor(parts, items, opts = {}) {
    this.items = items; // [{ matrix: Matrix4, x, y, z, scale }]
    this.hiDist = opts.hiDist ?? 60;
    this.maxDist = opts.maxDist ?? 200;
    this.radius = opts.radius ?? 5;
    this.centerY = opts.centerY ?? 0;
    this.group = new THREE.Group();
    this.parts = parts.map((p) => {
      const hi = new THREE.InstancedMesh(p.hi, p.material, items.length);
      hi.castShadow = !!p.castShadow;
      hi.receiveShadow = p.receiveShadow !== false;
      hi.frustumCulled = false;
      hi.count = 0;
      this.group.add(hi);
      let lo = null;
      if (p.lo) {
        lo = new THREE.InstancedMesh(p.lo, p.loMaterial || p.material, items.length);
        lo.castShadow = false;
        lo.receiveShadow = p.receiveShadow !== false;
        lo.frustumCulled = false;
        lo.count = 0;
        this.group.add(lo);
      }
      if (p.layer !== undefined) { hi.layers.set(p.layer); lo?.layers.set(p.layer); }
      return { hi, lo };
    });
    this.hasLo = this.parts.some((p) => p.lo);
  }

  setDistances(hiDist, maxDist) {
    this.hiDist = hiDist;
    if (maxDist) this.maxDist = maxDist;
  }

  update(camera, frustum) {
    const cx = camera.position.x, cz = camera.position.z;
    const hi2 = this.hiDist * this.hiDist, max2 = this.maxDist * this.maxDist;
    let nh = 0, nl = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const dx = it.x - cx, dz = it.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > max2) continue;
      const r = this.radius * it.scale;
      _sphere.center.set(it.x, it.y + this.centerY * it.scale, it.z);
      _sphere.radius = r;
      // keep very close items always (shadows / audio don't pop)
      if (d2 > 64 && !frustum.intersectsSphere(_sphere)) continue;
      if (d2 < hi2 || !this.hasLo) {
        for (const p of this.parts) p.hi.setMatrixAt(nh, it.matrix);
        nh++;
      } else {
        for (const p of this.parts) (p.lo || p.hi).setMatrixAt(p.lo ? nl : nh, it.matrix);
        nl++;
      }
    }
    for (const p of this.parts) {
      p.hi.count = nh;
      p.hi.instanceMatrix.needsUpdate = true;
      if (p.lo) {
        p.lo.count = nl;
        p.lo.instanceMatrix.needsUpdate = true;
      }
    }
    // in a set that has LODs, parts without a lo geometry are simply dropped at distance
  }
}

export function makeMatrix(x, y, z, rotY, scale, tiltX = 0, tiltZ = 0, sy = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, rotY, tiltZ, 'YXZ'));
  return _m.clone().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale * sy, scale));
}
