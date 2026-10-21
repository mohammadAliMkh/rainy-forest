import * as THREE from 'three';
import { merge } from '../world/plantGeometry.js';
import { createCampTextures } from '../people/clothTextures.js';

// A canvas tarp roof over the seats around the fire: four rough wooden
// posts, eave beams and hip rafters rising to an open smoke hole above the
// fire, covered by a small raised cap so the rain stays out while the smoke
// and sparks escape. The tarp sags a little between its supports. Exposes
// the sheltered rectangle so the rain (drops, splashes) stops underneath.

function sagPanel(a, b, c, d, sag, nu = 18, nv = 8) {
  // a-b = outer (eave) edge, d-c = inner edge; bilinear patch with a sag
  const g = new THREE.PlaneGeometry(1, 1, nu, nv);
  const p = g.attributes.position;
  const v = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5, w = p.getY(i) + 0.5;
    t1.lerpVectors(a, b, u);
    t2.lerpVectors(d, c, u);
    v.lerpVectors(t1, t2, w);
    v.y -= sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, w * 1.15));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Canopy {
  constructor(T, terrain, collision, { cx, cz, halfX, halfZ, inset = 0.45, eave = 2.35, peak = 3.0, hole = 0.75, cap = 3.4 }) {
    const C = createCampTextures();
    this.group = new THREE.Group();
    const ground = terrain.heightAt(cx, cz);
    const y0 = ground;
    const wood = new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkNormal, roughness: 0.85, color: 0xb8a48c });
    const tarpTex = C.fabric.map.clone();
    tarpTex.repeat.set(3, 3);
    tarpTex.needsUpdate = true;
    const tarp = new THREE.MeshStandardMaterial({ color: 0x55603f, map: tarpTex, normalMap: C.fabric.normal, roughness: 0.62, side: THREE.DoubleSide, envMapIntensity: 0.8 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.9 });

    const px = halfX - inset, pz = halfZ - inset;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const woodParts = [];
    const log = (from, to, r) => {
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(r * 0.9, r, len, 8, 1);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
      g.translate(from.x, from.y, from.z);
      woodParts.push(g);
    };
    const top = corners.map(([sx, sz]) => new THREE.Vector3(cx + sx * px, y0 + eave, cz + sz * pz));
    const inner = corners.map(([sx, sz]) => new THREE.Vector3(cx + sx * hole, y0 + peak, cz + sz * hole));
    corners.forEach(([sx, sz], i) => {
      const x = cx + sx * px, z = cz + sz * pz;
      const g = terrain.heightAt(x, z);
      log(new THREE.Vector3(x, g - 0.3, z), top[i].clone().add(new THREE.Vector3(0, 0.08, 0)), 0.075);
      collision.addCircle(x, z, 0.14, 'post');
      // eave beam to the next post, hip rafter up to the smoke hole
      log(top[i], top[(i + 1) % 4], 0.055);
      log(top[i], inner[i], 0.05);
      // lantern frame + short posts carrying the cap
      log(inner[i], inner[(i + 1) % 4], 0.04);
      log(inner[i], inner[i].clone().setY(y0 + cap - 0.05), 0.03);
    });
    const frame = new THREE.Mesh(merge(woodParts), wood);
    frame.castShadow = true; frame.receiveShadow = true;
    this.group.add(frame);

    // tarp: four sagging panels from the eaves (with overhang) to the hole
    const edge = corners.map(([sx, sz]) => new THREE.Vector3(cx + sx * halfX, y0 + eave - 0.16, cz + sz * halfZ));
    const lip = corners.map(([sx, sz]) => new THREE.Vector3(cx + sx * (hole + 0.06), y0 + peak + 0.03, cz + sz * (hole + 0.06)));
    const panels = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      panels.push(sagPanel(edge[i], edge[j], lip[j], lip[i], 0.11));
    }
    const roof = new THREE.Mesh(merge(panels), tarp);
    roof.castShadow = true; roof.receiveShadow = true;
    this.group.add(roof);
    // the cap over the smoke hole (a small pitched tarp with overhang)
    const capY = y0 + cap;
    const cs = hole + 0.45;
    const capEdge = corners.map(([sx, sz]) => new THREE.Vector3(cx + sx * cs, capY - 0.12, cz + sz * cs));
    const capTop = corners.map(([sx, sz]) => new THREE.Vector3(cx + sx * 0.05, capY + 0.32, cz + sz * 0.05));
    const capPanels = [];
    for (let i = 0; i < 4; i++) capPanels.push(sagPanel(capEdge[i], capEdge[(i + 1) % 4], capTop[(i + 1) % 4], capTop[i], 0.03, 8, 4));
    const capMesh = new THREE.Mesh(merge(capPanels), tarp);
    capMesh.castShadow = true;
    this.group.add(capMesh);
    // guy ropes from the tarp corners down to pegs
    const ropes = [];
    corners.forEach(([sx, sz], i) => {
      const peg = new THREE.Vector3(cx + sx * (halfX + 0.9), 0, cz + sz * (halfZ + 0.9));
      peg.y = terrain.heightAt(peg.x, peg.z) + 0.05;
      const dir = new THREE.Vector3().subVectors(peg, edge[i]);
      const len = dir.length();
      const g = new THREE.CylinderGeometry(0.006, 0.006, len, 4);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
      g.translate(edge[i].x, edge[i].y, edge[i].z);
      ropes.push(g);
      ropes.push(new THREE.CylinderGeometry(0.015, 0.008, 0.18, 5).translate(peg.x, peg.y + 0.03, peg.z));
    });
    this.group.add(new THREE.Mesh(merge(ropes), rope));

    // a hurricane lantern hanging from a rafter (glows; no extra light)
    {
      const at = top[0].clone().lerp(inner[0], 0.45);
      const L = new THREE.Group();
      L.position.copy(at).add(new THREE.Vector3(0, -0.42, 0));
      const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f2a, metalness: 0.7, roughness: 0.45 });
      this.lanternGlass = new THREE.MeshStandardMaterial({ color: 0x3a2a14, emissive: 0xffa040, emissiveIntensity: 1.6, roughness: 0.2, transparent: true, opacity: 0.9 });
      L.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.13, 12), this.lanternGlass));
      const capL = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.06, 12), metal);
      capL.position.y = 0.095;
      L.add(capL);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.05, 12), metal);
      base.position.y = -0.09;
      L.add(base);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.32, 4), metal);
      hook.position.y = 0.28;
      L.add(hook);
      this.group.add(L);
      this.lantern = L;
    }

    // what the rain needs to know (slightly inside the tarp edge)
    this.shelter = { minX: cx - halfX + 0.1, maxX: cx + halfX - 0.1, minZ: cz - halfZ + 0.1, maxZ: cz + halfZ - 0.1, y: y0 + eave - 0.2, peak: y0 + cap + 0.3 };
    this.center = new THREE.Vector3(cx, y0 + peak - 0.2, cz);
  }

  update(time) {
    const fl = 0.85 + 0.1 * Math.sin(time * 7.3) + 0.05 * Math.sin(time * 17.1);
    this.lanternGlass.emissiveIntensity = 1.6 * fl;
    this.lantern.rotation.z = Math.sin(time * 0.9) * 0.03;
  }
}
