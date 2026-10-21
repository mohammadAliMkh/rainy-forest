import * as THREE from 'three';
import { merge } from '../world/plantGeometry.js';
import { mulberry32, createNoise2D } from '../../utils/noise.js';

// A rustic carport beside the cabin for Amir's Patrol and the Hornet: square
// timber posts, a corrugated (slightly rusty) metal shed roof sloping away
// from the cabin, a plank back wall with a shelf, a spare tyre and a jerry
// can, and a bare bulb under the roof. Like the tarp, it keeps the rain out.
// Long side along Z; the roof is high on the west (cabin) side.

export class Carport {
  constructor(T, terrain, collision, { cx, cz, halfX = 1.95, halfZ = 4.35, high = 2.95, low = 2.5 }) {
    this.group = new THREE.Group();
    const y0 = terrain.heightAt(cx, cz);
    const rand = mulberry32(31);
    const wood = new THREE.MeshStandardMaterial({ map: T.planks, color: 0x9c8468, roughness: 0.85 });
    const roofY = (x) => y0 + high + ((x - (cx - halfX)) / (2 * halfX)) * (low - high); // west high, east low

    // ---- posts, side beams, rafters ----
    const parts = [];
    const box = (w, h, d, x, y, z, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (rz) g.rotateZ(rz);
      g.translate(x, y, z);
      parts.push(g);
    };
    const px = halfX - 0.15;
    const slope = Math.atan2(low - high, 2 * halfX);
    for (const sx of [-1, 1]) {
      const x = cx + sx * px;
      const top = roofY(x) - 0.12;
      for (const z of [cz - halfZ + 0.3, cz, cz + halfZ - 0.3]) {
        const g = terrain.heightAt(x, z);
        box(0.13, top - g + 0.3, 0.13, x, (top + g - 0.3) / 2, z);
        collision.addCircle(x, z, 0.14, 'post');
      }
      box(0.1, 0.16, 2 * halfZ - 0.3, x, top + 0.02, cz);
    }
    for (let i = 0; i <= 7; i++) {
      const z = cz - halfZ + 0.25 + (i / 7) * (2 * halfZ - 0.5);
      box(2 * halfX + 0.5, 0.1, 0.07, cx, (roofY(cx - halfX) + roofY(cx + halfX)) / 2 - 0.02, z, slope);
    }
    // back wall (north end) of vertical planks, with a shelf
    const wallZ = cz - halfZ + 0.12;
    for (let x = cx - halfX + 0.1; x < cx + halfX - 0.05; x += 0.2) {
      const h = roofY(x) - y0 - 0.05;
      const g = new THREE.BoxGeometry(0.19, h, 0.03);
      g.translate(x + 0.1, y0 + h / 2, wallZ);
      parts.push(g);
    }
    box(1.6, 0.04, 0.32, cx - 0.4, y0 + 1.35, wallZ + 0.17);
    const frame = new THREE.Mesh(merge(parts), wood);
    frame.castShadow = true; frame.receiveShadow = true;
    this.group.add(frame);
    collision.addBox(cx, wallZ, halfX, 0.12, 0, 'wall');

    // ---- corrugated metal roof (ridges run down the slope) ----
    {
      const W = 2 * halfX + 0.6, L = 2 * halfZ + 0.5;
      const g = new THREE.PlaneGeometry(W, L, 3, Math.round(L / 0.019));
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      const n = createNoise2D(mulberry32(5));
      const col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i) + cx, z = p.getZ(i) + cz;
        p.setXYZ(i, x, roofY(x) + 0.012 * Math.sin((z / 0.076) * Math.PI * 2), z);
        // galvanised grey with rust streaks running downhill
        const rust = Math.max(0, n(x * 0.6, z * 3.5) * 0.8 + n(x * 2, z * 9) * 0.3 - 0.25);
        const k = 0.9 + n(x * 4, z * 1.3) * 0.08;
        col[i * 3] = (0.56 + rust * 0.25) * k;
        col[i * 3 + 1] = (0.58 - rust * 0.12) * k;
        col[i * 3 + 2] = (0.6 - rust * 0.3) * k;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const roof = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.65, roughness: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.1 }));
      roof.castShadow = true; roof.receiveShadow = true;
      this.group.add(roof);
    }

    // ---- garage bits: spare tyre against the wall, jerry can, oil cans, bulb ----
    {
      const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.9 });
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 10, 24), rubber);
      tyre.position.set(cx + halfX - 0.45, y0 + 0.42, wallZ + 0.2);
      tyre.rotation.set(0.12, 0, 0);
      tyre.castShadow = true;
      this.group.add(tyre);
      const can = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.34, 0.45), new THREE.MeshStandardMaterial({ color: 0x8a1c14, roughness: 0.5, metalness: 0.3 }));
      can.position.set(cx - halfX + 0.4, y0 + 0.17, wallZ + 0.35);
      can.rotation.y = 0.3;
      can.castShadow = true;
      this.group.add(can);
      const oil = new THREE.MeshStandardMaterial({ color: 0x1d4a8a, roughness: 0.4, metalness: 0.4 });
      for (let i = 0; i < 4; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 12), i % 2 ? oil : new THREE.MeshStandardMaterial({ color: 0xc8a020, roughness: 0.4, metalness: 0.4 }));
        c.position.set(cx - 1.0 + i * 0.22 + rand() * 0.05, y0 + 1.47, wallZ + 0.17);
        this.group.add(c);
      }
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: 0x2a2010, emissive: 0xffd9a0, emissiveIntensity: 1.4 }));
      bulb.position.set(cx, roofY(cx) - 0.45, cz);
      this.group.add(bulb);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.38, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      cord.position.set(cx, roofY(cx) - 0.24, cz);
      this.group.add(cord);
    }

    // rain stays out underneath (the roof's low edge is the safe height)
    this.shelter = { minX: cx - halfX - 0.2, maxX: cx + halfX + 0.2, minZ: cz - halfZ - 0.15, maxZ: cz + halfZ + 0.15, y: y0 + low - 0.08 };
    this.center = new THREE.Vector3(cx, y0 + (high + low) / 2, cz);
    // no trees / ferns growing inside or right next to it
    collision.clearZones.push({ x: cx, z: cz, hx: halfX + 1.2, hz: halfZ + 1.2 });
  }
}
