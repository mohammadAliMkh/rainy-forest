// 2D (XZ-plane) collision world: circles for trunks / rocks / fire and
// oriented boxes for the cabin, woodpile, etc. Uses a spatial hash so queries
// stay cheap even with ~1500 trees.

const CELL = 6;

export class CollisionWorld {
  constructor() {
    this.cells = new Map();
    this.boxes = [];
    this.dynamic = new Set(); // objects with {x, z, radius} (deer, etc.)
    this.clearZones = [];     // axis-aligned rects {x, z, hx, hz} where nothing may grow
  }

  inClearZone(x, z) {
    for (const r of this.clearZones) if (Math.abs(x - r.x) < r.hx && Math.abs(z - r.z) < r.hz) return true;
    return false;
  }

  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  addCircle(x, z, r, tag = 'tree') {
    const c = { x, z, r, tag };
    const ix0 = Math.floor((x - r) / CELL), ix1 = Math.floor((x + r) / CELL);
    const iz0 = Math.floor((z - r) / CELL), iz1 = Math.floor((z + r) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.cells.get(k);
        if (!arr) this.cells.set(k, (arr = []));
        arr.push(c);
      }
    }
    return c;
  }

  // oriented rectangle: center, half sizes, rotation (radians about Y)
  addBox(x, z, hx, hz, rot = 0, tag = 'box') {
    const b = { x, z, hx, hz, cos: Math.cos(rot), sin: Math.sin(rot), tag };
    this.boxes.push(b);
    return b;
  }

  // Is the point blocked (with the given radius)?
  isBlocked(x, z, radius = 0.3) {
    const p = { x, z };
    return this.resolve(p, radius, true);
  }

  /** is a static collider with one of `tags` (e.g. 'post', 'tree') within `radius` of (x, z)? */
  hasNear(x, z, radius, tags) {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const c of this.cells.get(this._key(ix + dx, iz + dz)) || []) {
          if (tags.includes(c.tag) && Math.hypot(x - c.x, z - c.z) < c.r + radius) return true;
        }
      }
    }
    for (const b of this.boxes) {
      if (!tags.includes(b.tag)) continue;
      const lx = (x - b.x) * b.cos - (z - b.z) * b.sin, lz = (x - b.x) * b.sin + (z - b.z) * b.cos;
      if (Math.hypot(lx - Math.max(-b.hx, Math.min(b.hx, lx)), lz - Math.max(-b.hz, Math.min(b.hz, lz))) < radius) return true;
    }
    return false;
  }

  /** Pushes p = {x, z} out of all colliders. Returns true if any contact. */
  resolve(p, radius, testOnly = false) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const ix = Math.floor(p.x / CELL), iz = Math.floor(p.z / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = this.cells.get(this._key(ix + dx, iz + dz));
          if (!arr) continue;
          for (const c of arr) {
            const ox = p.x - c.x, oz = p.z - c.z;
            const minD = c.r + radius;
            const d2 = ox * ox + oz * oz;
            if (d2 < minD * minD) {
              hit = true;
              if (testOnly) return true;
              const d = Math.sqrt(d2) || 0.0001;
              const push = minD - d;
              p.x += (ox / d) * push;
              p.z += (oz / d) * push;
              moved = true;
            }
          }
        }
      }
      for (const b of this.boxes) {
        // to box local space
        const lx = (p.x - b.x) * b.cos - (p.z - b.z) * b.sin;
        const lz = (p.x - b.x) * b.sin + (p.z - b.z) * b.cos;
        const cx = Math.max(-b.hx, Math.min(b.hx, lx));
        const cz = Math.max(-b.hz, Math.min(b.hz, lz));
        let ox = lx - cx, oz = lz - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 < radius * radius) {
          hit = true;
          if (testOnly) return true;
          let nlx, nlz;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = radius - d;
            nlx = lx + (ox / d) * push;
            nlz = lz + (oz / d) * push;
          } else {
            // center inside the box: push out along the smallest axis
            const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
            if (px < pz) { nlx = Math.sign(lx || 1) * (b.hx + radius); nlz = lz; }
            else { nlz = Math.sign(lz || 1) * (b.hz + radius); nlx = lx; }
          }
          // back to world
          p.x = b.x + nlx * b.cos + nlz * b.sin;
          p.z = b.z - nlx * b.sin + nlz * b.cos;
          moved = true;
        }
      }
      for (const o of this.dynamic) {
        if (o === p.self) continue;
        const ox = p.x - o.x, oz = p.z - o.z;
        const minD = o.radius + radius;
        const d2 = ox * ox + oz * oz;
        if (d2 < minD * minD) {
          hit = true;
          if (testOnly) return true;
          const d = Math.sqrt(d2) || 0.0001;
          p.x += (ox / d) * (minD - d);
          p.z += (oz / d) * (minD - d);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }

  /** Nearest static circle colliders around a point (for audio rustles etc.) */
  nearby(x, z, maxDist, tag = 'tree') {
    const out = [];
    const r = Math.ceil(maxDist / CELL);
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    const seen = new Set();
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const arr = this.cells.get(this._key(ix + dx, iz + dz));
        if (!arr) continue;
        for (const c of arr) {
          if (c.tag !== tag || seen.has(c)) continue;
          seen.add(c);
          if (Math.hypot(c.x - x, c.z - z) < maxDist) out.push(c);
        }
      }
    }
    return out;
  }
}
