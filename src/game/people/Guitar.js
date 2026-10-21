import * as THREE from 'three';
import { merge } from '../world/plantGeometry.js';
import { createCampTextures } from './clothTextures.js';

// Acoustic guitar for Amin: spruce top, mahogany sides and neck, rosewood
// fretboard with frets, a rosette around the sound hole, bridge + saddle,
// angled headstock with tuners and six strings.
// Local frame: neck along +X, top facing +Z, body centre at the origin.
// `strum` / `fret` anchors tell the hands where to go.

export function buildGuitar() {
  const C = createCampTextures();
  const spruce = new THREE.MeshStandardMaterial({ color: 0xd9a865, map: C.suede.map, roughness: 0.35, envMapIntensity: 0.9 });
  const mahogany = new THREE.MeshStandardMaterial({ color: 0x5a2a14, map: C.suede.map, roughness: 0.4 });
  const rosewood = new THREE.MeshStandardMaterial({ color: 0x24140c, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x080605, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, metalness: 1, roughness: 0.25 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xece4d0, roughness: 0.4 });

  const g = new THREE.Group();
  const T = 0.095; // body depth

  // body outline: two bouts joined by a waist
  const halfW = (x) => {
    const e1 = x > -0.32 && x < 0.08 ? 0.19 * Math.sqrt(Math.max(0, 1 - ((x + 0.12) / 0.2) ** 2)) : 0;
    const e2 = x > -0.04 && x < 0.27 ? 0.145 * Math.sqrt(Math.max(0, 1 - ((x - 0.12) / 0.15) ** 2)) : 0;
    const waist = Math.exp(-(((x - 0.035) / 0.05) ** 2)) * 0.012;
    return Math.max(e1, e2) - waist;
  };
  const pts = [];
  const N = 60;
  for (let i = 0; i <= N; i++) { const x = -0.32 + (i / N) * 0.59; pts.push(new THREE.Vector2(x, halfW(x))); }
  for (let i = N; i >= 0; i--) { const x = -0.32 + (i / N) * 0.59; pts.push(new THREE.Vector2(x, -halfW(x))); }
  const shape = new THREE.Shape(pts);
  const hole = new THREE.Path();
  hole.absarc(0.06, 0, 0.044, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const body = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 24 });
  body.translate(0, 0, -T);
  const bodyMesh = new THREE.Mesh(body, [spruce, mahogany]);
  bodyMesh.castShadow = true;
  g.add(bodyMesh);
  // dark inside visible through the sound hole + rosette + bridge
  const inside = new THREE.Mesh(new THREE.CircleGeometry(0.046, 24), dark);
  inside.position.set(0.06, 0, -0.03);
  g.add(inside);
  const rosette = new THREE.Mesh(new THREE.RingGeometry(0.046, 0.056, 32), rosewood);
  rosette.position.set(0.06, 0, 0.0075);
  g.add(rosette);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.01), rosewood);
  bridge.position.set(-0.17, 0, 0.011);
  g.add(bridge);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.075, 0.006), bone);
  saddle.position.set(-0.165, 0, 0.019);
  g.add(saddle);

  // neck, fretboard, frets, headstock, tuners
  const neck = new THREE.BoxGeometry(0.47, 0.048, 0.028);
  neck.translate(0.27 + 0.235, 0, -0.008);
  const p = neck.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getX(i) > 0.6) p.setY(i, p.getY(i) * 0.9); // taper
  g.add(new THREE.Mesh(neck, mahogany));
  const board = new THREE.BoxGeometry(0.47, 0.052, 0.006);
  board.translate(0.27 + 0.235, 0, 0.009);
  g.add(new THREE.Mesh(board, rosewood));
  const frets = [];
  const scale = 0.64;
  for (let k = 1; k <= 14; k++) {
    const x = 0.74 - scale * (1 - Math.pow(2, -k / 12));
    if (x < 0.27) break;
    frets.push(new THREE.BoxGeometry(0.0025, 0.05, 0.003).translate(x, 0, 0.0135));
  }
  frets.push(new THREE.BoxGeometry(0.006, 0.052, 0.006).translate(0.738, 0, 0.014)); // nut
  g.add(new THREE.Mesh(merge(frets), bone));
  const head = new THREE.Group();
  head.position.set(0.74, 0, 0.0);
  head.rotation.y = 0.25; // angled back
  const hs = new THREE.BoxGeometry(0.18, 0.075, 0.016);
  hs.translate(0.09, 0, -0.004);
  head.add(new THREE.Mesh(hs, mahogany));
  const pegs = [];
  for (const sy of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = 0.04 + k * 0.05;
      pegs.push(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 6).translate(x, sy * 0.05, -0.004));
      pegs.push(new THREE.BoxGeometry(0.012, 0.014, 0.006).translate(x, sy * 0.068, -0.004));
      pegs.push(new THREE.CylinderGeometry(0.0035, 0.0035, 0.016, 6).rotateX(Math.PI / 2).translate(x, sy * 0.022, 0.01));
    }
  }
  head.add(new THREE.Mesh(merge(pegs), metal));
  g.add(head);

  // six strings from the saddle to the nut
  const strings = [];
  for (let k = 0; k < 6; k++) {
    const y0 = -0.027 + k * 0.0108, y1 = -0.021 + k * 0.0084;
    const a = new THREE.Vector3(-0.165, y0, 0.022), b = new THREE.Vector3(0.738, y1, 0.018);
    const len = a.distanceTo(b);
    const s = new THREE.CylinderGeometry(0.0006 + (5 - k) * 0.00012, 0.0006 + (5 - k) * 0.00012, len, 4);
    s.rotateZ(-Math.PI / 2);
    s.translate(len / 2, 0, 0);
    s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize()));
    s.translate(a.x, a.y, a.z);
    strings.push(s);
  }
  g.add(new THREE.Mesh(merge(strings), metal));

  // anchors for the hands
  const strum = new THREE.Object3D();
  strum.position.set(0.0, 0.0, 0.07);
  g.add(strum);
  const fret = new THREE.Object3D();
  fret.position.set(0.6, 0.0, 0.0);
  g.add(fret);
  return { group: g, strum, fret };
}
