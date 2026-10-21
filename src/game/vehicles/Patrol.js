import * as THREE from 'three';
import { merge } from '../world/plantGeometry.js';
import { createCampTextures } from '../people/clothTextures.js';
import { makeCanvas, toTexture } from '../world/textures.js';

// Amir's black Nissan Patrol Y60 (5-door), built up for off-road: lift kit,
// mud-terrain tyres on black steel wheels, fender flares, steel front bumper
// with a hoop bar, round LED headlights in a black slatted grille, snorkel
// up the left A-pillar, full-length roof basket with a rear ladder and a
// swing-out spare wheel, aluminium side steps.
// Local frame: front toward +Z, ground at y = 0, origin between the axles.

const WB = 2.97;          // wheelbase
const TR = 0.43;          // tyre radius (33")
const TW = 0.31;          // tyre width
const TRACK = 0.83;       // wheel centre x
const FRONT = 2.22, REAR = -2.22;
const SILL = 0.7, BELT = 1.4, ROOF = 2.0;
const WIDTH = 1.9;

function extrudeSide(points, width, bevel = 0.035, holes = []) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(h);
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 18 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // shape x -> car z, extrusion -> car x
  return g;
}

function plateTexture() {
  const c = makeCanvas(256, 56);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f2ee'; ctx.fillRect(0, 0, 256, 56);
  ctx.fillStyle = '#1c3f94'; ctx.fillRect(0, 0, 30, 56);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 9px sans-serif'; ctx.fillText('I.R.', 6, 40); ctx.fillText('IRAN', 3, 50);
  ctx.fillStyle = '#239f40'; ctx.fillRect(6, 6, 18, 4); ctx.fillStyle = '#fff'; ctx.fillRect(6, 10, 18, 4); ctx.fillStyle = '#da0000'; ctx.fillRect(6, 14, 18, 4);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, 253, 53);
  ctx.fillStyle = '#111'; ctx.font = 'bold 34px sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillText('۴۷ ج ۳۱۸', 44, 30);
  ctx.beginPath(); ctx.moveTo(206, 4); ctx.lineTo(206, 52); ctx.stroke();
  ctx.font = 'bold 26px sans-serif'; ctx.fillText('۵۵', 216, 32);
  return toTexture(c, { wrap: false });
}

export class Patrol {
  /** `model`: the Blender build (pipeline/blender_patrol.py); without it the car is built here */
  constructor(model) {
    const C = createCampTextures();
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.42, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1.0 });
    const matte = new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.75, metalness: 0.2 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.85 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a2630, roughness: 0.04, metalness: 0.5, clearcoat: 1, envMapIntensity: 1.6 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 1, roughness: 0.18 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xa9adb2, metalness: 0.9, roughness: 0.4 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, map: C.tread.map, normalMap: C.tread.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 });
    const lens = new THREE.MeshPhysicalMaterial({ color: 0xc9d2dc, roughness: 0.05, metalness: 0.6, clearcoat: 1, emissive: 0x000000 });
    this.haloMat = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.3 });
    const red = new THREE.MeshStandardMaterial({ color: 0x5a0606, roughness: 0.2, emissive: 0x200000 });
    const amber = new THREE.MeshStandardMaterial({ color: 0xc87a10, roughness: 0.25 });
    this.group = new THREE.Group();
    this.halfSize = { x: WIDTH / 2 + 0.12, z: (FRONT - REAR) / 2 + 0.35 };
    this.wheels = [];
    if (model) {
      const m = model.clone(true);
      m.userData.keep = true; // already merged by material in Blender
      const plateMat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 });
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.name.startsWith('plate_front')) { o.material = plateMat; o.castShadow = false; }
        else if (o.name.startsWith('halo')) { o.material = this.haloMat; o.castShadow = false; }
      });
      this.group.add(m);
      return;
    }
    const G = this.group;
    const add = (geo, mat, x = 0, y = 0, z = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = cast; m.receiveShadow = true;
      G.add(m);
      return m;
    };

    // ---------------- lower body (with wheel arches) ----------------
    const arch = (cz) => {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const a = Math.PI - (i / 16) * Math.PI;
        pts.push([cz + Math.cos(a) * 0.53, 0.66 + Math.sin(a) * 0.36]);
      }
      return pts;
    };
    // outline: front-bottom, up over the hood and cabin line, down the back,
    // then forward along the bottom through both wheel arches
    const outline = [
      [FRONT, SILL + 0.05], [FRONT, 1.2], [FRONT - 0.07, 1.285], [0.88, 1.385], [0.86, BELT], [REAR + 0.05, BELT], [REAR, BELT - 0.06], [REAR, SILL + 0.04],
      ...arch(-WB / 2), ...arch(WB / 2),
    ];
    add(extrudeSide(outline, WIDTH, 0.05), paint);
    // flat sill below the doors
    add(new THREE.BoxGeometry(WIDTH - 0.08, 0.1, WB - 1.08), matte, 0, SILL - 0.02, 0);
    // under-body / chassis shadow block
    add(new THREE.BoxGeometry(1.2, 0.3, 4.0), plastic, 0, 0.55, 0, false);

    // ---------------- greenhouse ----------------
    const gh = [[0.86, BELT - 0.02], [0.5, ROOF - 0.04], [REAR + 0.1, ROOF - 0.03], [REAR + 0.04, BELT - 0.02]];
    add(extrudeSide(gh, WIDTH - 0.14, 0.03), glass);
    // roof skin + rain gutters
    add(new THREE.BoxGeometry(WIDTH - 0.12, 0.05, 2.74), paint, 0, ROOF - 0.01, -0.82);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.025, 0.03, 2.8), matte, s * (WIDTH / 2 - 0.07), ROOF - 0.03, -0.82);
    // pillars & window frames (body colour)
    const pillar = (z0, y0, z1, y1, w = 0.08) => {
      for (const s of [-1, 1]) {
        const len = Math.hypot(z1 - z0, y1 - y0);
        const b = add(new THREE.BoxGeometry(0.04, len, w), paint, s * (WIDTH / 2 - 0.065), (y0 + y1) / 2, (z0 + z1) / 2);
        b.rotation.x = Math.atan2(z1 - z0, y1 - y0) * -1;
      }
    };
    pillar(0.86, BELT, 0.5, ROOF - 0.03, 0.09);          // A
    pillar(-0.28, BELT, -0.28, ROOF - 0.03, 0.11);       // B
    pillar(-1.28, BELT, -1.26, ROOF - 0.03, 0.12);       // C
    pillar(REAR + 0.06, BELT, REAR + 0.1, ROOF - 0.03, 0.12); // D
    // windscreen frame top/bottom
    add(new THREE.BoxGeometry(WIDTH - 0.12, 0.05, 0.06), paint, 0, ROOF - 0.05, 0.49);
    add(new THREE.BoxGeometry(WIDTH - 0.1, 0.04, 0.08), plastic, 0, BELT + 0.005, 0.86);
    // wipers
    for (const x of [-0.35, 0.3]) { const w = add(new THREE.BoxGeometry(0.55, 0.012, 0.02), plastic, x, BELT + 0.04, 0.8); w.rotation.z = 0.12; }
    // rear window frame
    add(new THREE.BoxGeometry(WIDTH - 0.12, 0.06, 0.04), paint, 0, ROOF - 0.05, REAR + 0.08);

    // door seams, handles, mirrors
    const seamMat = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const s of [-1, 1]) {
      const x = s * (WIDTH / 2 + 0.004);
      for (const z of [0.86, -0.28, -1.28]) {
        const seam = add(new THREE.BoxGeometry(0.006, BELT - SILL - 0.06, 0.008), seamMat, x, (BELT + SILL) / 2 + 0.02, z, false);
        seam.renderOrder = 1;
      }
      for (const z of [0.0, -1.0]) add(new THREE.BoxGeometry(0.03, 0.035, 0.16), chrome, x + s * 0.01, 1.22, z);
      const mirror = add(new THREE.BoxGeometry(0.06, 0.16, 0.22), plastic, s * (WIDTH / 2 + 0.11), BELT + 0.1, 0.72);
      mirror.rotation.y = s * 0.15;
      add(new THREE.BoxGeometry(0.14, 0.03, 0.05), plastic, s * (WIDTH / 2 + 0.05), BELT + 0.05, 0.76);
      // side steps (aluminium checker plate)
      add(new THREE.BoxGeometry(0.2, 0.04, 2.0), alu, s * (WIDTH / 2 + 0.06), 0.56, -0.02);
      for (const z of [0.7, -0.7]) add(new THREE.BoxGeometry(0.12, 0.12, 0.05), plastic, s * (WIDTH / 2 - 0.03), 0.6, z);
    }

    // ---------------- front ----------------
    // black grille with horizontal slats between the round lights
    add(new THREE.BoxGeometry(WIDTH - 0.12, 0.34, 0.04), plastic, 0, 1.03, FRONT + 0.01);
    for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.9, 0.025, 0.05), matte, 0, 0.9 + i * 0.065, FRONT + 0.035);
    for (const s of [-1, 1]) {
      const hx = s * 0.66;
      add(new THREE.CylinderGeometry(0.125, 0.125, 0.06, 28).rotateX(Math.PI / 2), plastic, hx, 1.03, FRONT + 0.02);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 28).rotateX(Math.PI / 2), lens, hx, 1.03, FRONT + 0.05);
      add(new THREE.TorusGeometry(0.092, 0.008, 6, 32), this.haloMat, hx, 1.03, FRONT + 0.066, false);
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16).rotateX(Math.PI / 2), chrome, hx, 1.03, FRONT + 0.07, false);
      // indicators
      add(new THREE.BoxGeometry(0.14, 0.05, 0.03), amber, s * 0.84, 0.86, FRONT + 0.02);
    }
    // hood bulge + emblem on the nose
    add(new THREE.BoxGeometry(1.0, 0.03, 1.1), paint, 0, 1.335, 1.55).rotation.x = 0.07;
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 10), chrome, 0, 1.31, FRONT - 0.06);
    add(new THREE.TorusGeometry(0.026, 0.004, 6, 18), chrome, 0, 1.35, FRONT - 0.06).rotation.x = 0;

    // heavy steel bumper + hoop bar + plate
    const bumper = add(new THREE.BoxGeometry(WIDTH + 0.06, 0.32, 0.26), matte, 0, 0.7, FRONT + 0.16);
    bumper.geometry.translate(0, 0, 0);
    add(new THREE.BoxGeometry(WIDTH - 0.2, 0.08, 0.32), matte, 0, 0.5, FRONT + 0.1); // skid plate
    const bar = merge([
      new THREE.CylinderGeometry(0.03, 0.03, 0.42, 10).translate(-0.55, 1.07, FRONT + 0.27),
      new THREE.CylinderGeometry(0.03, 0.03, 0.42, 10).translate(0.55, 1.07, FRONT + 0.27),
      new THREE.CylinderGeometry(0.03, 0.03, 1.1, 10).rotateZ(Math.PI / 2).translate(0, 1.28, FRONT + 0.27),
    ]);
    add(bar, matte);
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 18).rotateX(Math.PI / 2), plastic, s * 0.78, 0.7, FRONT + 0.3);
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 18).rotateX(Math.PI / 2), lens, s * 0.78, 0.7, FRONT + 0.33);
      // recovery shackle mounts
      add(new THREE.TorusGeometry(0.035, 0.012, 6, 12), new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.5 }), s * 0.45, 0.57, FRONT + 0.3).rotation.y = Math.PI / 2;
    }
    const plate = add(new THREE.PlaneGeometry(0.52, 0.115), new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }), -0.05, 0.71, FRONT + 0.295, false);
    plate.receiveShadow = false;

    // snorkel up the left A-pillar (left = +X when facing +Z)
    {
      const x = WIDTH / 2 + 0.07;
      const pts = [
        new THREE.Vector3(x - 0.02, 1.16, 1.28), new THREE.Vector3(x, 1.38, 1.0), new THREE.Vector3(x - 0.01, 1.62, 0.78),
        new THREE.Vector3(x - 0.04, 1.95, 0.56), new THREE.Vector3(x - 0.06, 2.06, 0.52),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      add(new THREE.TubeGeometry(curve, 24, 0.055, 12, false), plastic);
      add(new THREE.BoxGeometry(0.16, 0.16, 0.22), plastic, x - 0.06, 2.1, 0.58);
      add(new THREE.BoxGeometry(0.2, 0.32, 0.03), plastic, x - 0.03, 1.2, 1.28);
    }

    // fender flares
    for (const cz of [WB / 2, -WB / 2]) {
      for (const s of [-1, 1]) {
        const g = new THREE.TorusGeometry(0.575, 0.05, 6, 20, Math.PI);
        g.scale(1, 1, 1.9);
        const f = add(g, plastic, s * (WIDTH / 2 + 0.02), 0.62, cz);
        f.rotation.y = Math.PI / 2;
      }
    }

    // ---------------- wheels ----------------
    const tyreProfile = [];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      tyreProfile.push(new THREE.Vector2(TR - 0.06 + Math.cos(a) * 0.06, Math.sin(a) * TW / 2));
    }
    tyreProfile.unshift(new THREE.Vector2(0.27, -TW / 2 + 0.01));
    tyreProfile.push(new THREE.Vector2(0.27, TW / 2 - 0.01));
    const tyreGeo = new THREE.LatheGeometry(tyreProfile, 48);
    tyreGeo.rotateZ(Math.PI / 2);
    const tread = tyreGeo.attributes.uv;
    for (let i = 0; i < tread.count; i++) tread.setXY(i, tread.getX(i) * 2, tread.getY(i));
    const rimParts = [];
    const disk = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 32);
    disk.rotateZ(Math.PI / 2);
    rimParts.push(disk);
    const lip = new THREE.TorusGeometry(0.265, 0.018, 6, 32);
    lip.rotateY(Math.PI / 2);
    lip.translate(0.06, 0, 0);
    rimParts.push(lip);
    const rimGeo = merge(rimParts);
    const holeGeo = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12);
      h.rotateZ(Math.PI / 2);
      h.translate(0.022, Math.cos(a) * 0.16, Math.sin(a) * 0.16);
      holeGeo.push(h);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const n = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6);
      n.rotateZ(Math.PI / 2);
      n.translate(0.03, Math.cos(a) * 0.075, Math.sin(a) * 0.075);
      holeGeo.push(n);
    }
    const hubGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.05, 16).rotateZ(Math.PI / 2).translate(0.03, 0, 0);
    const steelBlack = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0.6, roughness: 0.45 });
    this.wheels = [];
    for (const cz of [WB / 2, -WB / 2]) {
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(s * TRACK, TR, cz);
        const tyre = new THREE.Mesh(tyreGeo, rubber);
        tyre.castShadow = true;
        w.add(tyre);
        const rim = new THREE.Mesh(rimGeo, steelBlack);
        rim.scale.x = s;
        w.add(rim);
        const holes = new THREE.Mesh(merge(holeGeo.map((g) => g.clone())), plastic);
        holes.scale.x = s;
        w.add(holes);
        const hub = new THREE.Mesh(hubGeo, chrome);
        hub.scale.x = s;
        w.add(hub);
        if (cz > 0) w.rotation.y = 0.18; // parked with the wheels turned a little
        G.add(w);
        this.wheels.push(w);
      }
    }

    // ---------------- rear: lights, swing-out spare, ladder ----------------
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.12, 0.3, 0.03), red, s * 0.86, 1.15, REAR - 0.02);
    }
    add(new THREE.BoxGeometry(WIDTH + 0.02, 0.18, 0.16), matte, 0, 0.66, REAR - 0.05);
    {
      const spare = new THREE.Group();
      spare.position.set(-0.32, 1.12, REAR - 0.3);
      const t = new THREE.Mesh(tyreGeo, rubber);
      t.rotation.y = Math.PI / 2;
      spare.add(t);
      const r = new THREE.Mesh(rimGeo, steelBlack);
      r.rotation.y = -Math.PI / 2;
      spare.add(r);
      G.add(spare);
      // carrier arm
      add(new THREE.BoxGeometry(1.2, 0.06, 0.06), matte, 0.1, 0.82, REAR - 0.18);
      add(new THREE.BoxGeometry(0.06, 0.6, 0.06), matte, -0.32, 1.1, REAR - 0.16);
    }
    // ladder on the rear left corner up to the rack
    {
      const x = 0.62, z = REAR - 0.09;
      const parts = [];
      for (const dx of [-0.17, 0.17]) parts.push(new THREE.BoxGeometry(0.04, 1.45, 0.04).translate(x + dx, 1.42, z));
      for (let i = 0; i < 6; i++) parts.push(new THREE.BoxGeometry(0.34, 0.03, 0.05).translate(x, 0.85 + i * 0.24, z));
      add(merge(parts), matte);
    }

    // ---------------- roof basket ----------------
    {
      const parts = [];
      const y0 = ROOF + 0.07, y1 = ROOF + 0.24;
      const z0 = 0.45, z1 = REAR - 0.02;
      const L = z0 - z1, zc = (z0 + z1) / 2;
      const hw = WIDTH / 2 - 0.02;
      const tube = (len, axis, x, y, z, r = 0.022) => {
        const g = new THREE.CylinderGeometry(r, r, len, 8);
        if (axis === 'x') g.rotateZ(Math.PI / 2);
        if (axis === 'z') g.rotateX(Math.PI / 2);
        g.translate(x, y, z);
        parts.push(g);
      };
      for (const s of [-1, 1]) {
        tube(L, 'z', s * hw, y1, zc);
        tube(L, 'z', s * hw, y0, zc);
        for (let i = 0; i <= 7; i++) tube(y1 - y0, 'y', s * hw, (y0 + y1) / 2, z1 + (i / 7) * L, 0.018);
        // feet onto the gutters
        for (const z of [z0 - 0.2, zc, z1 + 0.2]) tube(0.08, 'y', s * (hw - 0.03), ROOF + 0.03, z, 0.03);
      }
      tube(hw * 2, 'x', 0, y1, z0); tube(hw * 2, 'x', 0, y1, z1);
      tube(hw * 2, 'x', 0, y0, z0); tube(hw * 2, 'x', 0, y0, z1);
      for (let i = 1; i < 12; i++) parts.push(new THREE.BoxGeometry(hw * 2, 0.02, 0.06).translate(0, y0, z1 + (i / 12) * L));
      // wind deflector at the front
      const def = new THREE.BoxGeometry(hw * 2, 0.02, 0.22);
      def.rotateX(-0.6);
      def.translate(0, y0 + 0.07, z0 + 0.06);
      parts.push(def);
      add(merge(parts), matte);
      // a rolled tarp and a jerry can in the basket
      const tarp = add(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3e4a2c, map: C.fabric.map, roughness: 0.9 }), 0, y0 + 0.12, -1.2);
      tarp.castShadow = true;
      add(new THREE.BoxGeometry(0.17, 0.34, 0.45), new THREE.MeshStandardMaterial({ color: 0x2f4a22, roughness: 0.6, metalness: 0.3 }), 0.55, y0 + 0.18, -0.2);
    }

    // shared bounds for collisions
    this.halfSize = { x: WIDTH / 2 + 0.12, z: (FRONT - REAR) / 2 + 0.35 };
  }
}
