import * as THREE from 'three';

// The amulet Farajpour gives you against the ghost: a small stone Celtic
// cross (a ring behind flared arms, a round boss with an interlaced knot in
// the middle, two carved scrolls at the foot, a plinth), with red, green
// and blue gems set in the hollows between the arms and the ring and at the
// arms' ends. About 16 cm tall, its face toward +z, standing on y = 0.

const U = 0.0155; // metres per design unit (the cross is ~10 units tall)

// weathered grey-green stone
function stoneTexture(): THREE.CanvasTexture {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8f978c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = 110 + Math.floor(Math.random() * 90);
    g.fillStyle = `rgba(${v},${v + 6},${v - 4},${0.15 + Math.random() * 0.25})`;
    g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 0.5 + Math.random() * 2.5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// the interlaced knot on the boss: four loops woven round a ring
function knotTexture(): THREE.CanvasTexture {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7d857a';
  g.fillRect(0, 0, S, S);
  g.lineCap = 'round';
  const loops: [number, number, number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    loops.push([128 + Math.cos(a) * 42, 128 + Math.sin(a) * 42, a + Math.PI * 0.75, a + Math.PI * 2.25]);
  }
  const band = (w: number, col: string) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    for (const [x, y, a0, a1] of loops) { g.beginPath(); g.arc(x, y, 40, a0, a1); g.stroke(); }
    g.beginPath(); g.arc(128, 128, 96, 0, Math.PI * 2); g.stroke();
  };
  band(26, '#3c423b'); // the carved groove's shadow
  band(16, '#e4e6df'); // the raised strands
  // over-under: short gaps where one strand passes beneath another
  g.strokeStyle = '#3c423b';
  g.lineWidth = 6;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    g.beginPath(); g.arc(128, 128, 62, a - 0.06, a + 0.06); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** an arm that widens toward its end (a trapezoid, extruded) */
function arm(len: number, wIn: number, wOut: number, depth: number): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-wIn / 2, 0);
  s.lineTo(wIn / 2, 0);
  s.lineTo(wOut / 2, len);
  s.lineTo(-wOut / 2, len);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 });
}

export function makeAmulet(): THREE.Group {
  const group = new THREE.Group();
  const stoneMap = stoneTexture();
  const stone = new THREE.MeshStandardMaterial({ map: stoneMap, color: 0xd8ddd2, roughness: 0.92 });
  const dark = new THREE.MeshStandardMaterial({ map: stoneMap, color: 0x9da496, roughness: 0.95 });
  const knot = new THREE.MeshStandardMaterial({ map: knotTexture(), roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x * U, y * U, z * U);
    m.rotation.z = rz;
    m.scale.setScalar(U);
    group.add(m);
    return m;
  };
  const CY = 6.6; // the centre of the cross, above the plinth's foot
  // the ring, set back a little behind the arms (its inner face darker: the hollows)
  const ring = new THREE.Shape();
  ring.absarc(0, 0, 3.3, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 2.35, 0, Math.PI * 2, true);
  ring.holes.push(hole);
  add(new THREE.ExtrudeGeometry(ring, { depth: 0.7, bevelEnabled: true, bevelSize: 0.07, bevelThickness: 0.07, bevelSegments: 1, curveSegments: 40 }), stone, 0, CY, -0.35);
  add(new THREE.CircleGeometry(2.4, 36), dark, 0, CY, -0.2); // the back of the hollows
  // the four arms, flaring out; the lower one runs down to the plinth
  add(arm(4.3, 1.3, 1.9, 0.9), stone, 0, CY, -0.45); // up
  add(arm(4.1, 1.3, 1.9, 0.9), stone, 0, CY, -0.45, Math.PI / 2); // left
  add(arm(4.1, 1.3, 1.9, 0.9), stone, 0, CY, -0.45, -Math.PI / 2); // right
  add(arm(5.0, 1.3, 1.7, 0.9), stone, 0, CY, -0.45, Math.PI); // down
  // the boss with the knot
  const boss = add(new THREE.CylinderGeometry(1.75, 1.85, 0.6, 40), stone, 0, CY, 0.6);
  boss.rotation.x = Math.PI / 2;
  add(new THREE.CircleGeometry(1.62, 40), knot, 0, CY, 0.92);
  // two carved scrolls at the foot of the stem
  for (const sx of [-1, 1]) {
    for (const [dy, r] of [[1.9, 0.55], [1.05, 0.62]] as const) {
      const sc = add(new THREE.TorusGeometry(r, 0.22, 8, 18, Math.PI * 1.6), stone, sx * 1.55, dy, 0.1);
      sc.rotation.z = sx > 0 ? 0.4 : Math.PI - 0.4 + Math.PI * 0.4;
      add(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.5, 18), dark, sx * 1.55, dy, -0.2).rotation.x = Math.PI / 2;
    }
  }
  // the plinth
  add(new THREE.BoxGeometry(5.6, 1.0, 1.7), stone, 0, 0.5, 0);
  add(new THREE.BoxGeometry(5.0, 0.35, 1.5), stone, 0, 1.15, 0);

  // the gems: in the four hollows between the arms and the ring, and at the arms' ends
  const gem = (color: number) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.12, metalness: 0.15 });
  const RED = gem(0xd8142e), GREEN = gem(0x14b84e), BLUE = gem(0x1e54ff);
  const big = new THREE.IcosahedronGeometry(0.46, 1);
  const small = new THREE.IcosahedronGeometry(0.36, 1);
  const hollows: [number, THREE.Material][] = [[Math.PI / 4, RED], [(3 * Math.PI) / 4, GREEN], [(5 * Math.PI) / 4, BLUE], [(7 * Math.PI) / 4, GREEN]];
  for (const [a, m] of hollows) add(big, m, Math.cos(a) * 2.1, CY + Math.sin(a) * 2.1, 0.05).scale.set(U, U, U * 0.6);
  for (const [x, y, m] of [[0, CY + 3.75, BLUE], [-3.55, CY, RED], [3.55, CY, RED]] as const) add(small, m, x, y, 0.62).scale.set(U, U, U * 0.6);
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return group;
}
