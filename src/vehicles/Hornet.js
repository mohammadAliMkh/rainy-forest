import * as THREE from 'three';
import { merge } from '../world/plantGeometry.js';
import { createCampTextures } from '../people/clothTextures.js';
import { makeCanvas, toTexture } from '../world/textures.js';
import { taperTube } from '../people/Human.js';

// Honda Hornet 2.0 street bike in matte blue: gold upside-down fork, black
// alloy wheels with blue rim tape, petal discs, black single-cylinder engine,
// sculpted tank shrouds with the white HORNET graphic, stepped black seat,
// grey tail panels, rear rack and a short flyscreen over the LED headlight.
// Parked on its side stand. Front toward +Z, ground at y = 0, left = +X.

const R = 0.3;                         // wheel radius incl. tyre
const FA = new THREE.Vector3(0, R, 0.68);   // front axle
const RA = new THREE.Vector3(0, R, -0.68);  // rear axle
const HEAD = new THREE.Vector3(0, 0.96, 0.46); // steering head

function decalTexture() {
  const c = makeCanvas(512, 160);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 160);
  ctx.fillStyle = 'rgba(236,240,244,0.95)';
  ctx.beginPath();
  ctx.moveTo(505, 150); ctx.quadraticCurveTo(260, 122, 6, 22); ctx.lineTo(6, 46); ctx.quadraticCurveTo(250, 140, 485, 157); ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(46, 116);
  ctx.transform(1, -0.1, -0.32, 1, 0, 0);
  ctx.font = 'italic 900 90px sans-serif';
  ctx.lineWidth = 7; ctx.strokeStyle = '#0d2c6e';
  ctx.strokeText('HORNET', 0, 0);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillText('HORNET', 0, 0);
  ctx.restore();
  ctx.fillStyle = 'rgba(12,30,80,0.5)';
  for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(330 + i * 10, 18 + (i % 3) * 11, 3.5, 0, 6.3); ctx.fill(); }
  return toTexture(c, { wrap: false });
}

// extrude a side profile (z, y) across X; `taper(y)` scales the width
function sideExtrude(points, width, bevel, taper) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 4, curveSegments: 12 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);
  g.rotateY(-Math.PI / 2);
  if (taper) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getY(i), p.getZ(i)));
  }
  g.computeVertexNormals();
  return g;
}

export class Hornet {
  constructor() {
    const C = createCampTextures();
    const blue = new THREE.MeshPhysicalMaterial({ color: 0x1a4cb4, roughness: 0.5, metalness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.5 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.55, metalness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0f1011, roughness: 0.5, metalness: 0.35 });
    const matte = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.85 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xcc9a2c, metalness: 1, roughness: 0.25 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd2d5d8, metalness: 1, roughness: 0.15 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9a9da2, metalness: 0.9, roughness: 0.35 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, map: C.suede.map, roughness: 0.75 });
    const lens = new THREE.MeshPhysicalMaterial({ color: 0xdfe6ee, roughness: 0.05, metalness: 0.5, clearcoat: 1 });
    const red = new THREE.MeshStandardMaterial({ color: 0x700808, roughness: 0.2 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xc87a10, roughness: 0.3 });
    const tape = new THREE.MeshStandardMaterial({ color: 0x2060e0, roughness: 0.4 });
    const decal = new THREE.MeshStandardMaterial({ map: decalTexture(), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });

    this.group = new THREE.Group();
    const bike = new THREE.Group();
    this.group.add(bike);
    const add = (geo, mat, x = 0, y = 0, z = 0, parent = bike, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      parent.add(m);
      return m;
    };

    // ---- wheels (axis along X) ----
    const wheel = (w) => {
      const g = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(R - w / 2, w / 2, 12, 44), rubber);
      tyre.rotation.y = Math.PI / 2;
      tyre.castShadow = true;
      g.add(tyre);
      const rimR = R - w * 0.95;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.013, 8, 44), black);
      rim.rotation.y = Math.PI / 2;
      g.add(rim);
      for (const s of [-1, 1]) {
        const st = new THREE.Mesh(new THREE.TorusGeometry(rimR + 0.004, 0.005, 4, 48), tape);
        st.rotation.y = Math.PI / 2;
        st.position.x = s * 0.016;
        g.add(st);
      }
      const sp = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        for (const d of [-0.11, 0.11]) {
          const b = new THREE.BoxGeometry(0.016, rimR - 0.04, 0.018);
          b.translate(0, (rimR - 0.04) / 2 + 0.04, 0);
          b.rotateX(a + d);
          sp.push(b);
        }
      }
      sp.push(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 16).rotateZ(Math.PI / 2));
      g.add(new THREE.Mesh(merge(sp), black));
      return g;
    };
    const front = wheel(0.1);
    const rear = wheel(0.135);

    // ---- steering: fork from the head down to the front axle ----
    const forkVec = new THREE.Vector3().subVectors(FA, HEAD);
    const forkLen = forkVec.length();
    const rake = Math.atan2(forkVec.z, -forkVec.y);
    const steer = new THREE.Group();
    steer.position.copy(HEAD);
    steer.rotation.x = -rake;
    bike.add(steer);
    const yawG = new THREE.Group();
    steer.add(yawG);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.031, 0.031, 0.36, 14), gold, s * 0.082, -0.2, 0, yawG);
      add(new THREE.CylinderGeometry(0.023, 0.023, forkLen - 0.36, 12), chrome, s * 0.082, -0.36 - (forkLen - 0.36) / 2, 0, yawG);
      add(new THREE.BoxGeometry(0.04, 0.07, 0.06), black, s * 0.082, -forkLen + 0.01, 0, yawG);
    }
    add(new THREE.BoxGeometry(0.22, 0.035, 0.08), black, 0, 0.0, 0, yawG);
    add(new THREE.BoxGeometry(0.22, 0.03, 0.08), black, 0, -0.17, 0, yawG);
    front.position.set(0, -forkLen, 0);
    yawG.add(front);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.006, 24), steel);
    disc.rotation.z = Math.PI / 2; disc.position.x = 0.055;
    front.add(disc);
    add(new THREE.BoxGeometry(0.035, 0.1, 0.06), black, 0.07, -forkLen + 0.1, -0.08, yawG);
    // mudguard arc over the front of the tyre (in the steering frame)
    {
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const a = 0.2 + (i / 8) * 1.7 + rake; // from front-low over the top
        pts.push(new THREE.Vector3(0, -forkLen + Math.sin(a) * (R + 0.03), Math.cos(a) * (R + 0.03)));
      }
      const g = taperTube(pts, 0.05, 0.045, 10, 16);
      g.scale(1.15, 1, 1);
      const m = add(g, blue, 0, 0, 0, yawG);
      m.scale.set(1, 1, 1);
    }
    // handlebar + grips + mirrors + levers
    add(taperTube([new THREE.Vector3(-0.34, 0.12, -0.1), new THREE.Vector3(-0.14, 0.07, -0.03), new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(0.14, 0.07, -0.03), new THREE.Vector3(0.34, 0.12, -0.1)], 0.012, 0.012, 8, 16), black, 0, 0, 0, yawG);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.019, 0.019, 0.12, 10).rotateZ(Math.PI / 2), matte, s * 0.31, 0.112, -0.09, yawG);
      const stalk = add(new THREE.CylinderGeometry(0.006, 0.006, 0.17, 6), black, s * 0.2, 0.17, -0.04, yawG);
      stalk.rotation.z = -s * 0.35;
      const mir = add(new THREE.BoxGeometry(0.12, 0.065, 0.02), black, s * 0.24, 0.26, -0.04, yawG);
      mir.rotation.z = -s * 0.25;
      add(new THREE.BoxGeometry(0.15, 0.01, 0.02), steel, s * 0.25, 0.1, -0.04, yawG).rotation.y = s * 0.3;
    }
    // headlight with flyscreen (faces forward/down along the steering frame)
    const hl = new THREE.Group();
    hl.position.set(0, -0.12, 0.13);
    hl.rotation.x = rake;
    yawG.add(hl);
    add(new THREE.BoxGeometry(0.17, 0.13, 0.1), black, 0, 0, 0, hl);
    add(new THREE.BoxGeometry(0.13, 0.07, 0.02), lens, 0, -0.01, 0.05, hl);
    add(new THREE.BoxGeometry(0.19, 0.14, 0.012), matte, 0, 0.11, 0.0, hl).rotation.x = -0.35;
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.045, 0.02, 0.03), amber, s * 0.12, 0.0, -0.02, hl);
    add(new THREE.BoxGeometry(0.12, 0.07, 0.04), black, 0, 0.12, -0.08, yawG).rotation.x = -0.6; // dash

    // ---- rear wheel, swingarm, chain, shock, hugger ----
    rear.position.copy(RA);
    bike.add(rear);
    const rdisc = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.006, 20), steel);
    rdisc.rotation.z = Math.PI / 2; rdisc.position.x = -0.07;
    rear.add(rdisc);
    const spr = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20), black);
    spr.rotation.z = Math.PI / 2; spr.position.x = 0.075;
    rear.add(spr);
    const pivot = new THREE.Vector3(0, 0.42, -0.1);
    const armDir = new THREE.Vector3().subVectors(RA, pivot);
    for (const s of [-1, 1]) {
      const arm = add(new THREE.BoxGeometry(0.03, 0.06, armDir.length()), black, s * 0.09, (pivot.y + RA.y) / 2, (pivot.z + RA.z) / 2);
      arm.rotation.x = Math.atan2(armDir.y, -armDir.z) * -1;
    }
    const chain = add(new THREE.BoxGeometry(0.012, 0.025, armDir.length()), steel, 0.1, (pivot.y + RA.y) / 2 + 0.02, (pivot.z + RA.z) / 2);
    chain.rotation.x = -Math.atan2(armDir.y, -armDir.z);
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.28, 10), new THREE.MeshStandardMaterial({ color: 0xb02020, roughness: 0.4 }), 0, 0.56, -0.26).rotation.x = -0.75;
    add(new THREE.TorusGeometry(R + 0.03, 0.03, 6, 12, 1.0), black, 0, R, -0.68).rotation.set(0, Math.PI / 2, 0);

    // ---- engine ----
    const eng = [];
    eng.push(new THREE.BoxGeometry(0.26, 0.22, 0.3).translate(0, 0.4, 0.02));
    const cyl = new THREE.BoxGeometry(0.19, 0.22, 0.17);
    cyl.rotateX(0.38); cyl.translate(0, 0.56, 0.14);
    eng.push(cyl);
    for (const s of [-1, 1]) eng.push(new THREE.CylinderGeometry(0.095, 0.095, 0.03, 20).rotateZ(Math.PI / 2).translate(s * 0.14, 0.4, 0.0));
    add(merge(eng), black);
    const fins = [];
    for (let i = 0; i < 6; i++) fins.push(new THREE.BoxGeometry(0.235, 0.008, 0.2).rotateX(0.38).translate(0, 0.5 + i * 0.033, 0.13 + i * 0.013));
    add(merge(fins), steel);
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 14).rotateZ(Math.PI / 2), steel, 0.16, 0.4, 0.0);
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 12).rotateZ(Math.PI / 2), tape, 0.17, 0.52, 0.22);
    // exhaust: header under the engine to a short angled muffler on the right (-X)
    add(taperTube([new THREE.Vector3(0, 0.58, 0.26), new THREE.Vector3(-0.03, 0.4, 0.3), new THREE.Vector3(-0.08, 0.23, 0.12), new THREE.Vector3(-0.12, 0.25, -0.18), new THREE.Vector3(-0.13, 0.3, -0.3)], 0.022, 0.022, 8, 20), steel);
    const muff = add(new THREE.CylinderGeometry(0.055, 0.068, 0.34, 14), matte, -0.14, 0.36, -0.42);
    muff.rotation.x = Math.PI / 2 - 0.35;
    add(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 12), chrome, -0.14, 0.42, -0.58).rotation.x = Math.PI / 2 - 0.35;
    // frame tubes (mostly hidden)
    add(taperTube([HEAD.clone().add(new THREE.Vector3(0, -0.02, -0.02)), new THREE.Vector3(0, 0.8, 0.2), new THREE.Vector3(0, 0.66, -0.02), pivot], 0.032, 0.032, 8, 16), black);

    // ---- tank + shrouds ----
    const tankProfile = [[0.47, 0.99], [0.3, 1.03], [0.06, 1.0], [-0.06, 0.88], [-0.04, 0.72], [0.18, 0.64], [0.42, 0.66], [0.56, 0.78], [0.55, 0.9]];
    const tank = add(sideExtrude(tankProfile, 0.34, 0.06, (y, z) => (0.62 + 0.38 * Math.min(1, Math.max(0, (1.03 - y) / 0.28))) * (1 - Math.max(0, -z) * 0.6)), blue);
    tank.castShadow = true;
    // grey inner panel under the tank + black lower cowl
    add(sideExtrude([[0.3, 0.7], [0.06, 0.7], [-0.02, 0.6], [0.2, 0.56]], 0.3, 0.02), grey);
    for (const s of [-1, 1]) {
      const d = add(new THREE.PlaneGeometry(0.46, 0.145), decal, s * 0.168, 0.83, 0.25, bike, false);
      d.rotation.set(0, s * Math.PI / 2, 0);
    }

    // ---- seat, tail, rack ----
    add(sideExtrude([[-0.03, 0.9], [-0.3, 0.84], [-0.42, 0.86], [-0.62, 0.93], [-0.66, 0.89], [-0.6, 0.8], [-0.05, 0.8]], 0.25, 0.035, (y, z) => 1 - Math.max(0, -z - 0.35) * 0.5), seatMat);
    add(sideExtrude([[-0.12, 0.8], [-0.62, 0.86], [-0.82, 0.86], [-0.84, 0.8], [-0.5, 0.64], [-0.15, 0.62]], 0.22, 0.02, (y, z) => 1 - Math.max(0, -z - 0.4) * 0.8), grey);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.01, 0.02, 0.36), tape, s * 0.105, 0.82, -0.52).rotation.x = -0.1;
    add(new THREE.BoxGeometry(0.12, 0.035, 0.02), red, 0, 0.84, -0.85);
    {
      const parts = [];
      for (const s of [-1, 1]) parts.push(taperTube([new THREE.Vector3(s * 0.13, 0.86, -0.35), new THREE.Vector3(s * 0.14, 0.93, -0.58), new THREE.Vector3(s * 0.12, 0.95, -0.86)], 0.012, 0.012, 6, 10));
      for (let i = 0; i < 5; i++) parts.push(new THREE.BoxGeometry(0.25, 0.012, 0.03).translate(0, 0.955, -0.62 - i * 0.05));
      add(merge(parts), black);
    }
    add(new THREE.BoxGeometry(0.15, 0.11, 0.01), black, 0, 0.66, -0.86).rotation.x = 0.4;
    for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8).rotateZ(Math.PI / 2), steel, s * 0.17, 0.34, -0.14);

    // ---- side stand on the left; lean onto it, bars turned that way ----
    const stand = add(new THREE.CylinderGeometry(0.012, 0.01, 0.38, 8), black, 0.16, 0.18, -0.04);
    stand.rotation.set(0.35, 0, 0.42);
    bike.rotation.z = -0.16;
    yawG.rotation.y = 0.45;

    this.halfSize = { x: 0.45, z: 1.05 };
  }
}
