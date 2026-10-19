import * as THREE from 'three';
import { createNoise2D, mulberry32, damp, clamp } from '../utils/noise.js';
import { merge } from '../world/plantGeometry.js';
import { createCampTextures } from '../people/clothTextures.js';
import { taperTube, rgb } from '../people/Human.js';

// Luna: a black long-haired German Shepherd lying "sphinx" style next to her
// owner. Shaggy coat (noise-displaced shells), upright ears, bushy tail,
// khaki harness. She pants, flicks her ears, watches people / the player and
// wags her tail when someone comes close.

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const BLACK = rgb(0x121010);
const TAN = rgb(0x3d2a1c);
const UP = new THREE.Vector3(0, 1, 0);

function furry(geo, amount, seed, colorFn) {
  const n = createNoise2D(mulberry32(seed));
  geo.computeVertexNormals();
  const p = geo.attributes.position, nr = geo.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (n(x * 28 + z * 9, y * 28) * 0.6 + n(x * 70, z * 70 + y * 30) * 0.4) * amount;
    p.setXYZ(i, x + nr.getX(i) * k, y + nr.getY(i) * k, z + nr.getZ(i) * k);
    const col = colorFn ? colorFn(x, y, z) : BLACK;
    const v = 0.85 + n(x * 40, y * 40 + z * 13) * 0.25;
    c[i * 3] = col[0] * v; c[i * 3 + 1] = col[1] * v; c[i * 3 + 2] = col[2] * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo;
}

function ellipsoid(rx, ry, rz, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
  g.scale(rx, ry, rz);
  return g;
}

export class Dog {
  constructor() {
    const C = createCampTextures();
    const fur = new THREE.MeshStandardMaterial({ vertexColors: true, map: C.fleece.map, normalMap: C.fleece.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.3 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1c0f07, roughness: 0.08 });
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xc8606e, roughness: 0.35 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x8a7a55, map: C.fabric.map, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 1, roughness: 0.35 });

    this.root = new THREE.Group();
    const body = new THREE.Group();
    this.root.add(body);
    this.body = body;

    // torso (lying, a little rolled onto the left hip)
    const torsoGeo = new THREE.CapsuleGeometry(0.15, 0.42, 10, 20);
    torsoGeo.rotateX(Math.PI / 2);
    {
      const p = torsoGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const chest = sstep(-0.1, 0.25, z);
        const waist = Math.exp(-(((z + 0.08) / 0.12) ** 2));
        p.setXYZ(i, x * (0.95 - waist * 0.1), y * (1.0 + chest * 0.12 - waist * 0.12) + (y < 0 ? 0.02 * waist : 0), z);
      }
    }
    const torso = furry(torsoGeo, 0.02, 1, (x, y, z) => mix3(BLACK, TAN, sstep(-0.06, -0.15, y) * 0.35));
    const tm = new THREE.Mesh(torso, fur);
    tm.position.set(0, 0.17, -0.04);
    tm.rotation.z = 0.12;
    tm.castShadow = true;
    body.add(tm);
    this.torso = tm;
    // chest + neck ruff (thick mane of a long-haired shepherd)
    const ruff = furry(ellipsoid(0.15, 0.17, 0.15, 24), 0.03, 2, (x, y) => mix3(BLACK, TAN, sstep(0.0, -0.14, y) * 0.3));
    const rm = new THREE.Mesh(ruff, fur);
    rm.position.set(0, 0.25, 0.24);
    rm.castShadow = true;
    body.add(rm);
    // hip / folded hind leg (right side up), the left one tucked under
    const thigh = furry(ellipsoid(0.08, 0.13, 0.15), 0.02, 3);
    const th = new THREE.Mesh(thigh, fur);
    th.position.set(0.11, 0.15, -0.26);
    th.rotation.set(0.3, 0, -0.2);
    body.add(th);
    const hindPaw = furry(ellipsoid(0.04, 0.03, 0.08), 0.008, 4, () => mix3(BLACK, TAN, 0.25));
    const hp = new THREE.Mesh(hindPaw, fur);
    hp.position.set(0.15, 0.03, -0.1);
    body.add(hp);
    const shin = new THREE.Mesh(furry(new THREE.CapsuleGeometry(0.035, 0.13, 6, 10), 0.01, 5), fur);
    shin.position.set(0.15, 0.06, -0.2);
    shin.rotation.set(Math.PI / 2 + 0.3, 0, 0);
    body.add(shin);
    // front legs stretched forward on the ground
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(furry(new THREE.CapsuleGeometry(0.032, 0.24, 6, 12), 0.01, 6 + s, () => mix3(BLACK, TAN, 0.2)), fur);
      leg.position.set(s * 0.07, 0.06, 0.42);
      leg.rotation.set(Math.PI / 2 - 0.12, 0, 0);
      leg.castShadow = true;
      body.add(leg);
      const paw = new THREE.Mesh(furry(ellipsoid(0.042, 0.028, 0.06), 0.006, 8 + s, () => mix3(BLACK, TAN, 0.3)), fur);
      paw.position.set(s * 0.07, 0.03, 0.58);
      body.add(paw);
    }
    // harness straps + ring
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.013, 6, 28), strap);
    band.position.set(0, 0.19, 0.1);
    band.scale.set(0.98, 1.1, 1);
    body.add(band);
    const chestStrap = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24), strap);
    chestStrap.position.set(0, 0.31, 0.29);
    chestStrap.rotation.x = 1.1;
    body.add(chestStrap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12), metal);
    ring.position.set(0, 0.375, 0.12);
    body.add(ring);
    this.backAnchor = new THREE.Object3D();
    this.backAnchor.position.set(0, 0.33, -0.05);
    body.add(this.backAnchor);

    // neck + head
    const neck = new THREE.Group();
    neck.position.set(0, 0.32, 0.3);
    body.add(neck);
    const neckMesh = new THREE.Mesh(furry(new THREE.CylinderGeometry(0.075, 0.11, 0.2, 16, 4), 0.022, 9), fur);
    neckMesh.position.set(0, 0.06, 0.03);
    neckMesh.rotation.x = 0.55;
    neck.add(neckMesh);
    const head = new THREE.Group();
    head.position.set(0, 0.15, 0.08);
    neck.add(head);
    const skull = new THREE.Mesh(furry(ellipsoid(0.075, 0.072, 0.09), 0.01, 10, (x, y) => mix3(BLACK, TAN, sstep(-0.01, -0.07, y) * 0.25)), fur);
    skull.castShadow = true;
    head.add(skull);
    const muzzleGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.12, 14, 3);
    muzzleGeo.rotateX(Math.PI / 2);
    muzzleGeo.translate(0, -0.025, 0.1);
    const muzzle = new THREE.Mesh(furry(muzzleGeo, 0.004, 11, () => mix3(BLACK, [0.02, 0.02, 0.02], 0.5)), fur);
    head.add(muzzle);
    const nose = new THREE.Mesh(ellipsoid(0.022, 0.016, 0.016, 12), dark);
    nose.position.set(0, -0.012, 0.165);
    head.add(nose);
    // jaw (opens while panting) + tongue
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.045, 0.05);
    head.add(jaw);
    const jawGeo = new THREE.CylinderGeometry(0.022, 0.038, 0.1, 12, 2);
    jawGeo.rotateX(Math.PI / 2);
    jawGeo.scale(1, 0.55, 1);
    jawGeo.translate(0, 0, 0.05);
    jaw.add(new THREE.Mesh(furry(jawGeo, 0.003, 12), fur));
    const mouthIn = new THREE.Mesh(ellipsoid(0.03, 0.012, 0.055, 12), new THREE.MeshStandardMaterial({ color: 0x2a0a0c, roughness: 0.6 }));
    mouthIn.position.set(0, 0.012, 0.055);
    jaw.add(mouthIn);
    const tongueGeo = ellipsoid(0.024, 0.006, 0.06, 14);
    tongueGeo.translate(0, 0, 0.05);
    const tongue = new THREE.Mesh(tongueGeo, tongueMat);
    tongue.position.set(0, 0.012, 0.04);
    tongue.rotation.x = 0.5;
    jaw.add(tongue);
    this.jaw = jaw; this.tongue = tongue;
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), eyeMat);
      eye.position.set(s * 0.037, 0.018, 0.075);
      head.add(eye);
    }
    // upright ears
    this.ears = [];
    for (const s of [-1, 1]) {
      const ep = new THREE.Group();
      ep.position.set(s * 0.045, 0.055, -0.01);
      const eg = new THREE.ConeGeometry(0.038, 0.11, 10, 3, true);
      const p = eg.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) * 0.25); // hollow front
      eg.translate(0, 0.055, 0);
      eg.scale(1, 1, 0.55);
      const ear = new THREE.Mesh(furry(eg, 0.004, 13 + s, (x, y, z) => (z > 0.003 ? mix3(BLACK, TAN, 0.5) : BLACK)), fur);
      ear.material.side = THREE.DoubleSide;
      ep.add(ear);
      ep.rotation.set(-0.15, 0, -s * 0.28);
      head.add(ep);
      this.ears.push(ep);
    }
    this.neck = neck; this.head = head;

    // bushy tail lying on the ground, curving around
    const tail = new THREE.Group();
    tail.position.set(0.02, 0.13, -0.46);
    body.add(tail);
    const tailGeo = taperTube([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.03, -0.06, -0.12), new THREE.Vector3(0.1, -0.1, -0.25),
      new THREE.Vector3(0.22, -0.1, -0.3), new THREE.Vector3(0.32, -0.09, -0.26),
    ], 0.05, 0.03, 10, 18);
    const tm2 = new THREE.Mesh(furry(tailGeo, 0.02, 14), fur);
    tm2.castShadow = true;
    tail.add(tm2);
    this.tail = tail;

    this.headWorld = new THREE.Vector3();
    this.backWorld = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.yaw = 0; this.pitch = 0;
    this.wag = 0;
    this.pant = 1;
    this.earT = 2;
    this.time = Math.random() * 10;
  }

  place(x, y, z, heading) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = heading;
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
  }

  // look: world point of interest; excite 0..1 (player close / petted)
  update(dt, look, excite = 0) {
    this.time += dt;
    const t = this.time;
    this.root.updateMatrixWorld(true);
    this.head.getWorldPosition(this.headWorld);
    this.backAnchor.getWorldPosition(this.backWorld);
    // head tracking
    if (look) {
      const to = new THREE.Vector3().subVectors(look, this.headWorld);
      const right = new THREE.Vector3(this.forward.z, 0, -this.forward.x);
      const yaw = clamp(Math.atan2(to.dot(right), to.dot(this.forward)), -1.3, 1.3);
      const pitch = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.5, 0.4);
      this.yaw = damp(this.yaw, yaw, 2.5, dt);
      this.pitch = damp(this.pitch, pitch, 2.5, dt);
    }
    this.neck.rotation.set(-this.pitch * 0.5, this.yaw * 0.45, 0, 'YXZ');
    this.head.rotation.set(-this.pitch * 0.5 + Math.sin(t * 0.7) * 0.03, this.yaw * 0.55, Math.sin(t * 0.33) * 0.06, 'YXZ');
    // panting
    this.pant = damp(this.pant, 0.5 + excite * 0.5, 1, dt);
    const pf = 2.4 + excite * 1.4;
    const open = (0.12 + 0.12 * Math.abs(Math.sin(t * pf * Math.PI))) * this.pant;
    this.jaw.rotation.x = open;
    this.tongue.rotation.x = 0.5 + open * 0.8;
    this.torso.scale.y = 1 + Math.sin(t * pf * Math.PI * 2) * 0.012 * this.pant;
    // ears: alert and twitching
    this.earT -= dt;
    let twitch = 0;
    if (this.earT < 0) { twitch = Math.sin(Math.min(1, -this.earT / 0.25) * Math.PI); if (this.earT < -0.25) this.earT = 1.5 + Math.random() * 4; }
    for (const [i, e] of this.ears.entries()) e.rotation.x = -0.15 - (i === 0 ? twitch * 0.35 : 0) - excite * 0.1;
    // tail wag on the ground
    this.wag = damp(this.wag, excite, 2, dt);
    this.tail.rotation.y = Math.sin(t * (3 + this.wag * 7)) * (0.08 + this.wag * 0.35);
    this.tail.rotation.x = -this.wag * 0.15;
  }
}
