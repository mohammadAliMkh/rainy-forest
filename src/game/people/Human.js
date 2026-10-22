import * as THREE from 'three';
import { createNoise2D, mulberry32 } from '../../utils/noise.js';
import { merge } from '../world/plantGeometry.js';
import { createCampTextures } from './clothTextures.js';
import { buildGuitar } from './Guitar.js';
import { SkinBinding } from '../creatures/skinBinding.ts';

// Procedural seated person: a sculpted head (brow, eye sockets, nose, lips,
// chin, jaw), hair / beard / eyebrows grown as shells over the scalp, real
// eyes with blinking lids, clothing with collars and quilting, and a jointed
// skeleton (spine, neck, head, two-bone arms solved with IK, legs).
// Everything is described by a plain "spec" object (see Friends.js).

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgb = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

// piecewise linear profile lookup: pts = [[t, v], ...]
function profile(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      const k = (t - t0) / (t1 - t0);
      return lerp(v0, v1, k * k * (3 - 2 * k));
    }
  }
  return pts[pts.length - 1][1];
}

function colorize(geo, fn) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getX(i), p.getY(i), p.getZ(i), i);
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const solid = (geo, col) => colorize(geo, () => col);

function flipWinding(geo) {
  const idx = geo.index;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  geo.computeVertexNormals();
  return geo;
}

// tapered tube along a curve (hair locks, cables, cords)
export function taperTube(points, r0, r1, radial = 6, segs = 12) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position;
  for (let i = 0; i <= segs; i++) {
    const c = curve.getPointAt(i / segs);
    const r = lerp(r0, r1, i / segs);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------
const HEAD_SEG = [112, 84];

function faceSculptor(f) {
  const S = [0.077 * f.width, 0.113 * f.length, 0.097 * f.depth];
  const fn = (ux, uy, uz) => {
    let x = ux, y = uy, z = uz;
    const ax = Math.abs(x);
    // lower face narrows into the jaw / chin
    const low = sstep(-0.1, -1.0, y);
    x *= 1 - (0.46 - 0.32 * f.jaw) * low;
    // back of the skull: fuller on top, tucks into the neck below
    if (z < 0) {
      z *= 1 - 0.42 * sstep(-0.2, -0.95, y);
      z *= 1 + 0.07 * sstep(-0.1, 0.5, y);
    }
    // lower face comes forward (jaw + chin) instead of following the sphere
    if (z > 0) z *= 1 + (0.95 + f.chin * 0.1) * sstep(-0.35, -0.98, y) * sstep(0.0, 0.5, z);
    // temples slightly flatter
    x *= 1 - 0.05 * sstep(0.0, 0.6, y) * sstep(0.2, 0.7, z);
    const front = sstep(0.25, 0.8, uz);
    let dz = 0;
    if (front > 0) {
      dz += f.brow * 0.075 * gauss(ax, y, 0.36, 0.15, 0.24, 0.07);
      dz += 0.035 * gauss(x, y, 0, 0.12, 0.13, 0.07);
      dz -= 0.17 * gauss(ax, y, 0.35 * f.eyeGap, 0.0, 0.17, 0.1);
      dz += f.cheek * 0.05 * gauss(ax, y, 0.5, -0.24, 0.2, 0.15);
      // nose: bridge -> tip -> base
      const y0 = 0.06, y1 = -0.34, y2 = -0.45;
      let P = 0, W = 0.08;
      if (y <= y0 && y >= y1) {
        const t = (y0 - y) / (y0 - y1);
        P = lerp(0.045, f.nose * 0.3, Math.pow(t, 1.5)) + f.hump * 0.03 * gauss(t, 0, 0.45, 0, 0.18, 1);
        W = lerp(0.07, 0.105, t) * f.noseWidth;
      } else if (y < y1 && y > y2) {
        const t = (y1 - y) / (y1 - y2);
        P = f.nose * 0.3 * (1 - t * t);
        W = 0.11 * f.noseWidth;
      }
      dz += P * Math.exp(-((x / W) ** 2));
      dz += 0.06 * f.noseWidth * gauss(ax, y, 0.115 * f.noseWidth, -0.37, 0.06, 0.05);
      // lips & mouth crease (corners rise when smiling)
      const sm = f.smile;
      const mouthY = -0.585 + sm * 0.09 * (x / 0.26) ** 2;
      dz += f.lips * 0.045 * gauss(x, y, 0, -0.535, 0.21 + sm * 0.04, 0.05);
      dz += f.lips * 0.045 * gauss(x, y, 0, -0.64, 0.18 + sm * 0.04, 0.05);
      dz -= 0.035 * Math.exp(-(((y - mouthY) / 0.022) ** 2)) * Math.exp(-((x / (0.25 + sm * 0.07)) ** 2));
      // smile lines / raised cheeks
      dz += sm * 0.035 * gauss(ax, y, 0.38, -0.3, 0.12, 0.12);
      // open mouth cavity
      if (f.open) dz -= mouthCavity(f, x, y) * 0.3;
      // chin
      dz += f.chin * 0.08 * gauss(x, y, 0, -0.88, 0.22, 0.13);
    }
    z += dz * front;
    // chin length
    y -= f.chinLen * 0.08 * sstep(-0.6, -1, y) * sstep(0.1, 0.6, z);
    return [x * S[0], y * S[1], z * S[2]];
  };
  fn.S = S;
  return fn;
}

// sculpted surface point for a direction given by unit x / y on the front
function facePoint(sculpt, x, y) {
  return sculpt(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y)));
}

function noiseField(seed) {
  const n = createNoise2D(mulberry32(seed));
  return (ux, uy, uz, f = 6) => {
    const a = Math.atan2(ux, uz);
    return n(a * f * 0.5, uy * f) * 0.5 + n(a * f * 1.3 + 7, uy * f * 2.2 + 3) * 0.25;
  };
}

// grow a shell (hair / beard / eyebrows) over the sculpted head surface
function shell(head, maskFn, thickFn, colorFn, coverage = 1) {
  const { geo, unit } = head;
  const pos = geo.attributes.position, nor = geo.attributes.normal, uvs = geo.attributes.uv;
  const n = pos.count;
  const masks = new Float32Array(n);
  for (let i = 0; i < n; i++) masks[i] = maskFn(unit[i * 3], unit[i * 3 + 1], unit[i * 3 + 2]);
  // RGBA colours: alpha = coverage; the material alpha-tests it against a
  // strand texture, so edges (hairline, beard line) break up like real hair
  const out = new Float32Array(n * 3), col = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const ux = unit[i * 3], uy = unit[i * 3 + 1], uz = unit[i * 3 + 2];
    const m = masks[i];
    const t = 0.0006 + thickFn(ux, uy, uz, m) * sstep(0.0, 0.6, m);
    out[i * 3] = pos.getX(i) + nor.getX(i) * t;
    out[i * 3 + 1] = pos.getY(i) + nor.getY(i) * t;
    out[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * t;
    const c = colorFn(ux, uy, uz, m);
    col[i * 4] = c[0]; col[i * 4 + 1] = c[1]; col[i * 4 + 2] = c[2];
    col[i * 4 + 3] = Math.min(1, m * 1.5) * coverage;
  }
  const idx = geo.index;
  const keep = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    if (Math.max(masks[a], masks[b], masks[c]) > 0.08) keep.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setAttribute('uv', uvs.clone());
  g.setIndex(keep);
  g.computeVertexNormals();
  return g;
}

function buildHead(spec, mats) {
  const f = { width: 1, length: 1, depth: 1, jaw: 0.5, chin: 1, chinLen: 0, nose: 1, noseWidth: 1, hump: 0, brow: 1, cheek: 1, lips: 1, smile: 0, eyeGap: 1, ...spec.face };
  const sculpt = faceSculptor(f);
  const skin = rgb(spec.skin);
  const hairCol = rgb(spec.hairColor);
  const noise = noiseField(spec.seed || 1);

  const geo = new THREE.SphereGeometry(1, HEAD_SEG[0], HEAD_SEG[1]);
  // sphere seam at the back
  geo.rotateY(-Math.PI / 2);
  const pos = geo.attributes.position;
  const unit = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const ux = pos.getX(i), uy = pos.getY(i), uz = pos.getZ(i);
    unit[i * 3] = ux; unit[i * 3 + 1] = uy; unit[i * 3 + 2] = uz;
    const [x, y, z] = sculpt(ux, uy, uz);
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const head = { geo, unit, sculpt };

  // skin colouring: lips, cheeks, stubble shadow, darker sockets
  const beard = { ...(spec.beard || {}), open: f.open };
  const stubble = beard.stubble ?? 0;
  const lipCol = mix3(skin, rgb(0x9a4a42), 0.55);
  const cheekCol = mix3(skin, rgb(0xc0605a), 0.25);
  const stubbleCol = mix3(skin, rgb(0x35302e), 0.6);
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = unit[i * 3], y = unit[i * 3 + 1], z = unit[i * 3 + 2];
    const front = sstep(0.3, 0.8, z);
    let c = skin;
    c = mix3(c, cheekCol, front * gauss(Math.abs(x), y, 0.48, -0.2, 0.18, 0.16));
    const lips = front * Math.max(gauss(x, y, 0, -0.545, 0.2, 0.035), gauss(x, y, 0, -0.625, 0.17, 0.04));
    c = mix3(c, lipCol, lips * 0.9);
    c = mix3(c, mix3(skin, [0.2, 0.12, 0.1], 0.5), front * gauss(Math.abs(x), y, 0.35, 0.02, 0.15, 0.08) * 0.35);
    const bm = beardMask(beard, x, y, z, true);
    c = mix3(c, stubbleCol, Math.max(stubble, bm * 0.8) * bm * (1 - lips));
    c = mix3(c, [0.09, 0.025, 0.02], sstep(0.15, 0.6, mouthCavity(f, x, y) * front));
    const sb = scalpMask(spec.hair || {}, x, y, z);
    c = mix3(c, mix3(skin, hairCol, 0.75), sb * 0.85);
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));

  const group = new THREE.Group();
  const skull = new THREE.Mesh(geo, mats.skin);
  skull.castShadow = true;
  group.add(skull);

  // ---- ears ----
  for (const s of [-1, 1]) {
    const eg = new THREE.SphereGeometry(1, 14, 10);
    const ep = eg.attributes.position;
    for (let i = 0; i < ep.count; i++) {
      let x = ep.getX(i), y = ep.getY(i), z = ep.getZ(i);
      // flat shell, cupped toward the front, lobe at the bottom
      x *= 0.32;
      if (x * s > 0) x -= 0.25 * (1 - y * y) * Math.max(0, 1 - z * z) * s * 0.6;
      z *= 0.62 * (1 - 0.25 * sstep(0.2, -1, y));
      ep.setXYZ(i, x, y, z);
    }
    eg.scale(0.012, 0.027, 0.028);
    eg.rotateY(s * 0.18);
    eg.computeVertexNormals();
    solid(eg, mix3(skin, rgb(0xb06050), 0.12));
    const ear = new THREE.Mesh(eg, mats.skin);
    const [ex, ey, ez] = sculpt(s * 0.97, -0.17, -0.12);
    ear.position.set(ex + s * 0.002, ey, ez);
    group.add(ear);
  }

  // ---- eyes with lids ----
  const eyes = [];
  const lids = [];
  const irisCol = rgb(spec.eyeColor || 0x3b2414);
  for (const s of [-1, 1]) {
    const dir = new THREE.Vector3(s * 0.35 * f.eyeGap, 0.0, 0.93).normalize();
    const [px, py, pz] = sculpt(dir.x, dir.y, dir.z);
    const r = 0.0112;
    const eg = new THREE.SphereGeometry(r, 24, 16);
    eg.rotateX(Math.PI / 2); // pole -> +Z
    colorize(eg, (x, y, z) => {
      const a = Math.acos(Math.min(1, Math.max(-1, z / r)));
      if (a < 0.2) return [0.01, 0.01, 0.01];
      if (a < 0.5) return mix3(irisCol, mix3(irisCol, [0, 0, 0], 0.5), sstep(0.38, 0.5, a));
      return mix3([0.72, 0.68, 0.64], [0.6, 0.46, 0.42], sstep(1.0, 1.6, a));
    });
    const eye = new THREE.Mesh(eg, mats.eye);
    const eyePivot = new THREE.Group();
    eyePivot.position.set(px, py, pz + 0.004);
    eyePivot.add(eye);
    group.add(eyePivot);
    eyes.push(eyePivot);
    // upper lid (skin cap that rotates down to blink) + lower lid
    const lidGeo = new THREE.SphereGeometry(r * 1.12, 20, 10, 0, Math.PI * 2, 0, 1.25);
    colorize(lidGeo, (x, y) => (y < r * 0.4 ? [0.05, 0.035, 0.03] : mix3(skin, [0.25, 0.15, 0.12], 0.12)));
    const lid = new THREE.Mesh(lidGeo, mats.skin);
    const lidPivot = new THREE.Group();
    lidPivot.position.copy(eyePivot.position);
    lidPivot.add(lid);
    lidPivot.userData.open = 0.08 + (f.lidOpen ?? 0);
    lidPivot.rotation.x = lidPivot.userData.open;
    group.add(lidPivot);
    lids.push(lidPivot);
    const low = new THREE.Mesh(new THREE.SphereGeometry(r * 1.1, 20, 6, 0, Math.PI * 2, Math.PI - 1.2, 1.2), mats.skin);
    solid(low.geometry, mix3(skin, [0.3, 0.18, 0.15], 0.1));
    low.position.copy(eyePivot.position);
    group.add(low);
  }

  // ---- open mouth (dark inside + teeth), mostly hidden behind the lips ----
  const mouth = new THREE.Group();
  {
    const [mx, my, mz] = facePoint(sculpt, 0, -0.585);
    mouth.position.set(mx, my - f.smile * 0.004, mz - 0.012 + f.smile * 0.006);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), mats.mouth);
    inner.scale.set(0.021 + f.smile * 0.006, 0.009, 0.006);
    mouth.add(inner);
    const teethGeo = new THREE.CylinderGeometry(0.019, 0.019, 0.006, 16, 1, true, -1.1, 2.2);
    teethGeo.rotateY(Math.PI);
    const teeth = new THREE.Mesh(teethGeo, mats.teeth);
    teeth.position.set(0, 0.003, -0.012);
    mouth.add(teeth);
    mouth.userData.inner = inner;
    mouth.userData.teeth = teeth;
    group.add(mouth);
    if (f.open) {
      inner.visible = false;
      const tg = new THREE.CylinderGeometry(0.024, 0.024, 0.0075, 18, 1, true, -0.85, 1.7);
      const upperTeeth = new THREE.Mesh(tg, mats.teeth);
      const [tx, ty, tz] = facePoint(sculpt, 0, -0.565);
      upperTeeth.position.set(tx, ty - 0.001, tz - 0.026);
      group.add(upperTeeth);
      const lowerTeeth = new THREE.Mesh(tg, mats.teeth);
      lowerTeeth.scale.set(0.9, 0.8, 0.9);
      lowerTeeth.position.set(tx, ty - 0.0085, tz - 0.028);
      group.add(lowerTeeth);
    }
  }

  // ---- scalp hair ----
  const hair = spec.hair || {};
  if (hair.style !== 'none') {
    const hg = shell(head, (x, y, z) => scalpMask(hair, x, y, z),
      (x, y, z, m) => {
        let t = hair.thick ?? 0.008;
        // top volume (quiff) toward the front
        t += (hair.quiff ?? 0) * sstep(0.2, 0.75, y) * sstep(-0.2, 0.7, z);
        t += (hair.backVolume ?? 0) * sstep(0.2, -0.6, z) * sstep(-0.4, 0.4, y);
        t *= lerp(1, hair.sides ?? 1, sstep(0.55, 0.95, Math.abs(x)) * sstep(0.4, -0.2, y));
        return t * (0.8 + noise(x, y, z, 9) * (hair.rough ?? 0.45));
      },
      (x, y, z, m) => mix3(mix3(skin, hairCol, 0.7), mix3(hairCol, rgb(hair.highlight ?? spec.hairColor), Math.max(0, noise(x, y, z, 14))), sstep(0.2, 0.75, m)));
    const hm = new THREE.Mesh(hg, mats.hair);
    hm.castShadow = true;
    group.add(hm);
  }
  // ---- beard / mustache ----
  if (beard.style && beard.style !== 'none') {
    const beardCol = rgb(beard.color ?? spec.hairColor);
    const bg = shell(head, (x, y, z) => beardMask(beard, x, y, z),
      (x, y, z) => (beard.thick ?? 0.01) * (0.65 + noise(x, y, z, 18) * 0.7) * lerp(1, 1.4, sstep(-0.6, -1, y)),
      (x, y, z, m) => mix3(stubbleCol, mix3(beardCol, rgb(beard.highlight ?? beard.color ?? spec.hairColor), Math.max(0, noise(x, y, z, 22)) * 0.8), sstep(0.25, 0.8, m)),
      beard.density ?? 1);
    const bm = new THREE.Mesh(bg, (beard.density ?? 1) < 0.8 ? mats.stubble : mats.hair);
    bm.castShadow = true;
    group.add(bm);
  }
  // ---- eyebrows ----
  {
    const brow = spec.brows || {};
    const bg = shell(head, (x, y, z) => {
      if (z < 0.5) return 0;
      const ax = Math.abs(x) / f.eyeGap;
      const cy = 0.16 + 0.04 * Math.sin(Math.min(1, Math.max(0, (ax - 0.15) / 0.5)) * Math.PI) - (brow.slant ?? 0) * (ax - 0.35);
      const w = (brow.width ?? 0.045) * lerp(1.15, 0.45, sstep(0.18, 0.66, ax));
      return sstep(0.1, 0.16, ax) * sstep(0.7, 0.6, ax) * Math.exp(-(((y - cy) / w) ** 2) * 2.2) * 1.5;
    }, (x, y, z, m) => (brow.thick ?? 0.0025) * 0.7 * m, (x, y, z, m) => mix3(skin, hairCol, sstep(0.2, 0.7, m)));
    group.add(new THREE.Mesh(bg, mats.hair));
  }

  // long hair locks (hang from the back of the head)
  if (hair.long) {
    const rand = mulberry32(spec.seed * 7 + 3);
    const locks = [];
    const L = hair.long;
    for (let i = 0; i < L.count; i++) {
      const a = lerp(-1.15, 1.15, (i + rand() * 0.6) / L.count) + Math.PI; // around the back
      const ux = Math.sin(a) * 0.95, uz = Math.cos(a) * 0.95;
      const uy = lerp(0.35, -0.15, rand());
      const [sx, sy, sz] = sculpt(ux, uy, uz);
      const start = new THREE.Vector3(sx, sy, sz).multiplyScalar(1.06);
      const pts = [start];
      const len = L.length * (0.75 + rand() * 0.4);
      const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        const curl = Math.sin(t * Math.PI * (L.curls ?? 3) + rand() * 6) * (L.wave ?? 0.015);
        pts.push(new THREE.Vector3(
          start.x + out.x * (0.01 + t * 0.03) + curl,
          start.y - len * t,
          start.z + out.z * (0.015 + t * 0.03) - t * 0.06 + curl * 0.6,
        ));
      }
      const g = taperTube(pts, L.radius * (0.8 + rand() * 0.4), L.radius * 0.35, 6, 14);
      const shade = 0.75 + rand() * 0.35;
      solid(g, mix3(hairCol, rgb(hair.highlight ?? spec.hairColor), rand() * 0.6).map((v) => v * shade));
      locks.push(g);
    }
    const lm = new THREE.Mesh(merge(locks), mats.locks);
    lm.castShadow = true;
    group.add(lm);
  }

  return { group, eyes, lids, mouth, sculpt };
}

function mouthCavity(f, x, y) {
  if (!f.open) return 0;
  const cy = -0.6 + (f.smile ?? 0) * 0.025 * (x / 0.2) ** 2;
  return f.open * Math.exp(-((x / (0.17 + 0.05 * (f.smile ?? 0))) ** 4) - (((y - cy) / (0.045 * f.open + 0.005)) ** 4));
}

// unit-sphere masks ---------------------------------------------------------
function scalpMask(h, x, y, z) {
  if (!h || h.style === 'none') return 0;
  const ax = Math.abs(x);
  const front = sstep(0.05, 0.85, z);
  const lineFront = (h.front ?? 0.5) + (h.recede ?? 0) * Math.exp(-(((ax - 0.5) / 0.2) ** 2));
  const lineBack = lerp(h.sidesLine ?? 0.05, h.nape ?? -0.55, sstep(-0.1, -0.85, z));
  let line = lerp(lineBack, lineFront, front);
  // hair goes around the ears
  if (ax > 0.75) line = Math.max(line, lerp(line, 0.02, sstep(0.75, 0.95, ax) * gauss(z, 0, -0.1, 0, 0.3, 1)));
  let m = sstep(line - 0.05, line + 0.04, y);
  // sideburns
  if (h.sideburns) m = Math.max(m, sstep(0.86, 0.95, ax) * sstep(-0.05, 0.12, z) * sstep(0.32, 0.22, z) * sstep(-h.sideburns - 0.05, -h.sideburns + 0.05, y));
  // bald crown (older men): no hair above `bald` on the top and front, a fringe around the sides and back
  if (h.bald !== undefined) m *= 1 - sstep(h.bald - 0.07, h.bald + 0.05, y) * sstep(-0.75, -0.2, z);
  return m;
}

function beardMask(b, x, y, z, forStubble = false) {
  if (!b || (!b.style && !forStubble)) return 0;
  const ax = Math.abs(x);
  const front = sstep(0.25, 0.75, z);
  const cheekTop = b.cheekTop ?? -0.12;
  const cheekLine = lerp(-0.38, cheekTop, sstep(0.3, 0.85, ax));
  let m = sstep(cheekLine + 0.05, cheekLine - 0.06, y);
  // jaw angle limit (further back under the chin / on the neck)
  m *= sstep(-0.4, -0.15, z + 0.35 * sstep(-0.55, -0.95, y));
  // keep lips clear, mustache over the upper lip
  const op = b.open ?? 0;
  const lipsZone = front * Math.max(gauss(x, y, 0, -0.6, 0.22 + op * 0.08, 0.05 + op * 0.035), gauss(x, y, 0, -0.64, 0.16, 0.05));
  m *= 1 - Math.min(1, lipsZone * 1.4);
  const must = front * gauss(x, y, 0, -0.48, 0.28 + (b.mustacheWidth ?? 0), 0.055) * (b.mustache ?? 1);
  if (b.style === 'mustache') return Math.min(1, must) * (1 - front * gauss(x, y, 0, -0.4, 0.1, 0.03));
  // the region under the nose stays clear
  m = Math.max(m, must) * (1 - front * gauss(x, y, 0, -0.4, 0.1, 0.03));
  // goatee-like beards are thinner on the cheeks
  m *= lerp(b.cheeks ?? 1, 1, Math.max(gauss(x, y, 0, -0.8, 0.32, 0.3), must));
  return m;
}

// ---------------------------------------------------------------------------
// Body parts
// ---------------------------------------------------------------------------
function torsoGeometry(o, col) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 36, 30, false);
  const p = g.attributes.position;
  const pad = o.pad ?? 0.012;
  const W = [[0, 0.168], [0.15, 0.172], [0.42, 0.155], [0.66, 0.172], [0.8, 0.19], [0.88, 0.19], [0.95, 0.163], [1, 0.075]];
  const D = [[0, 0.118], [0.15, 0.122], [0.42, 0.112], [0.66, 0.125], [0.8, 0.118], [0.88, 0.104], [0.95, 0.088], [1, 0.062]];
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = y + 0.5;
    const rr = Math.hypot(x, z);
    const a = Math.atan2(x, z);
    let w = profile(W, t) * lerp(1, o.shoulders ?? 1, sstep(0.55, 0.85, t)) * (o.width ?? 1) + pad;
    let d = profile(D, t) * (o.depth ?? 1) + pad;
    const frontW = Math.cos(a);
    if (frontW > 0) d += (o.belly ?? 0) * Math.exp(-(((t - 0.35) / 0.18) ** 2)) * frontW + 0.012 * Math.exp(-(((t - 0.68) / 0.12) ** 2)) * frontW;
    if (o.quilted) { const q = 1 + 0.035 * Math.abs(Math.sin(t * Math.PI * 8)) - 0.012; w *= q; d *= q; }
    // folds where the jacket bunches at the waist when seated
    const fold = 1 + 0.015 * Math.sin(a * 7 + t * 9) * sstep(0.35, 0.05, t);
    p.setXYZ(i, Math.sin(a) * w * rr * fold, -0.07 + t * 0.6, Math.cos(a) * d * rr * fold);
    let c = col.main;
    if (o.open && frontW > 0) {
      const open = lerp(0.025, 0.07, sstep(0.2, 0.95, t));
      const ox = Math.abs(Math.sin(a) * w);
      if (ox < open) c = col.inner;
      else if (ox < open + 0.012) c = col.edge;
    } else if (o.zip && frontW > 0 && Math.abs(Math.sin(a) * w) < 0.004) c = col.edge;
    if (o.hemColor && t < 0.06) c = col.edge;
    cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

function limbGeometry(r0, r1, len, segs = 14) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 6, true);
  g.translate(0, -len / 2, 0);
  const top = new THREE.SphereGeometry(r0, segs, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const bot = new THREE.SphereGeometry(r1, segs, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bot.translate(0, -len, 0);
  return merge([g, top, bot]);
}

// right hand: fingers along -Y, palm normal +Z, thumb toward +X
function handGeometry(skinCol, holding, open = false) {
  const parts = [];
  const palm = new THREE.SphereGeometry(1, 14, 10);
  palm.scale(0.04, 0.05, 0.018);
  palm.translate(0, -0.045, 0);
  parts.push(palm);
  if (holding) {
    // four fingers wrapped around a glass held in front of the palm (glass
    // axis along X, centre at (-0.005, -0.072, 0.03))
    for (let i = 0; i < 4; i++) {
      const t = new THREE.TorusGeometry(0.031, 0.0088 - i * 0.0004, 6, 12, Math.PI * 1.05);
      t.rotateY(Math.PI / 2);
      t.rotateX(-Math.PI * 0.6);
      t.translate(0.02 - i * 0.0155, -0.072, 0.03);
      parts.push(t);
    }
    const th = limbGeometry(0.0095, 0.0082, 0.042, 8);
    th.rotateZ(Math.PI / 2 - 0.35);
    th.translate(0.02, -0.052, 0.012);
    parts.push(th);
  } else if (open) {
    // open hand (waving): straight, slightly spread fingers, thumb out
    for (let i = 0; i < 4; i++) {
      const len = [0.044, 0.05, 0.052, 0.048][i];
      const f = limbGeometry(0.0086, 0.0074, len, 8);
      f.rotateX(0.08);
      f.rotateZ((i - 1.5) * 0.09);
      f.translate(0.027 - i * 0.018, -0.088, 0.002);
      parts.push(f);
    }
    const th = limbGeometry(0.0098, 0.0082, 0.046, 8);
    th.rotateZ(1.05);
    th.rotateX(0.15);
    th.translate(0.036, -0.032, 0.006);
    parts.push(th);
  } else {
    for (let i = 0; i < 4; i++) {
      const f = limbGeometry(0.0088, 0.0078, 0.05 - Math.abs(i - 1.5) * 0.006, 8);
      f.rotateX(0.5);
      f.translate(0.027 - i * 0.018, -0.088, 0.004);
      parts.push(f);
    }
    const th = limbGeometry(0.0095, 0.008, 0.045, 8);
    th.rotateZ(0.9);
    th.rotateX(0.3);
    th.translate(0.035, -0.03, 0.012);
    parts.push(th);
  }
  return solid(merge(parts), skinCol);
}

function shoeGeometry(style, col, soleCol) {
  const parts = [];
  const upper = new THREE.SphereGeometry(1, 16, 12);
  const p = upper.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < -0.2) y = -0.2;
    // toe box lower than the heel / ankle
    y *= lerp(1, 0.55, sstep(-0.2, 0.9, z));
    p.setXYZ(i, x, y, z);
  }
  upper.scale(0.052, 0.07, 0.14);
  upper.translate(0, 0.0, 0.05);
  solid(upper, col);
  parts.push(upper);
  const shaft = new THREE.CylinderGeometry(0.05, 0.054, style === 'sneaker' ? 0.05 : 0.11, 14);
  shaft.translate(0, style === 'sneaker' ? 0.02 : 0.05, -0.015);
  solid(shaft, col);
  parts.push(shaft);
  if (style === 'chelsea') {
    for (const s of [-1, 1]) {
      const el = new THREE.BoxGeometry(0.004, 0.07, 0.035);
      el.translate(s * 0.053, 0.05, -0.012);
      solid(el, col.map((v) => v * 0.45));
      parts.push(el);
    }
    const tab = new THREE.BoxGeometry(0.02, 0.025, 0.004);
    tab.translate(0, 0.115, -0.066);
    solid(tab, col.map((v) => v * 0.6));
    parts.push(tab);
  }
  const sole = new THREE.BoxGeometry(0.108, 0.025, 0.285);
  const sp = sole.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const z = sp.getZ(i);
    const k = z > 0.1 ? 0.8 : 1;
    sp.setX(i, sp.getX(i) * k);
  }
  sole.translate(0, -0.016, 0.05);
  solid(sole, soleCol);
  parts.push(sole);
  return merge(parts);
}

// ---------------------------------------------------------------------------
// Accessories
// ---------------------------------------------------------------------------
export function teaGlass(mats) {
  const g = new THREE.Group();
  const prof = [[0.0, 0], [0.021, 0], [0.023, 0.004], [0.02, 0.018], [0.016, 0.035], [0.019, 0.055], [0.024, 0.075], [0.0245, 0.077]];
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 18), mats.glass);
  const tea = new THREE.Mesh(new THREE.LatheGeometry(prof.slice(0, 6).map(([r, y]) => new THREE.Vector2(Math.max(0, r - 0.0015), y + 0.002)).concat([new THREE.Vector2(0, 0.057)]), 16), mats.tea);
  g.add(tea, glass);
  return g;
}

function hatGeometry(h) {
  const col = rgb(h.color);
  const parts = [];
  // crown: oval, tapering, pinched top with a centre dent
  const crown = new THREE.CylinderGeometry(1, 1, 1, 30, 8, false);
  const p = crown.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i) + 0.5, z = p.getZ(i);
    const rr = Math.hypot(x, z);
    const a = Math.atan2(x, z);
    let r = lerp(1, 0.8, y * y) * rr;
    let yy = y * 0.082;
    if (y > 0.99) yy -= (1 - rr) * 0.028 * (1 + Math.cos(a * 2) * 0.4); // top dent
    // front pinch
    const pinch = Math.exp(-((a / 0.55) ** 2)) * sstep(0.4, 1, y) * 0.16;
    p.setXYZ(i, Math.sin(a) * r * 0.09 * (1 - pinch), yy, Math.cos(a) * r * 0.104);
  }
  crown.computeVertexNormals();
  solid(crown, col);
  parts.push(crown);
  // band (snakeskin-like scales)
  const band = new THREE.CylinderGeometry(1, 1, 0.026, 36, 2, true);
  band.scale(0.092, 1, 0.106);
  band.translate(0, 0.016, 0);
  colorize(band, (x, y, z) => {
    const a = Math.atan2(x, z);
    const s = Math.sin(a * 40) * Math.sin(y * 500);
    return s > 0.2 ? [0.06, 0.05, 0.04] : [0.26, 0.22, 0.17];
  });
  parts.push(band);
  // brim: sides curled up, front & back dip
  const brim = new THREE.RingGeometry(0.06, 1, 56, 12); // enough rings for a smooth curl
  brim.rotateX(-Math.PI / 2);
  const bp = brim.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i);
    const rr = Math.hypot(x, z);
    const a = Math.atan2(x, z);
    const out = sstep(0.06, 1, rr);
    const R = lerp(0.09, 0.185, out);
    const sx = Math.sin(a), cz = Math.cos(a);
    const y = out * (0.045 * sx * sx - 0.016 * cz * cz) * out;
    bp.setXYZ(i, sx * R * 0.97, y + 0.004, cz * R * 1.05);
  }
  brim.computeVertexNormals();
  const brimBack = brim.clone();
  flipWinding(brimBack);
  brimBack.translate(0, -0.004, 0);
  solid(brim, col);
  solid(brimBack, col.map((v) => v * 0.8));
  parts.push(brim, brimBack);
  // snap button on the crown front
  const snap = new THREE.SphereGeometry(0.008, 8, 6);
  snap.scale(1, 1, 0.5);
  snap.translate(0, 0.055, 0.094);
  solid(snap, [0.12, 0.1, 0.08]);
  parts.push(snap);
  return merge(parts);
}

function sunglassesGeometry() {
  const frame = [];
  const lenses = [];
  for (const s of [-1, 1]) {
    const lens = new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, 0.6);
    lens.rotateX(Math.PI / 2);
    lens.scale(0.026, 0.02, 0.012);
    lens.translate(s * 0.033, 0, 0);
    lenses.push(lens);
    const rim = new THREE.TorusGeometry(1, 0.13, 6, 20);
    rim.scale(0.027, 0.021, 0.022);
    rim.translate(s * 0.033, 0, 0.004);
    frame.push(rim);
    const arm = new THREE.BoxGeometry(0.004, 0.006, 0.11);
    arm.translate(s * 0.064, 0.004, -0.05);
    frame.push(arm);
  }
  const bridge = new THREE.BoxGeometry(0.016, 0.005, 0.005);
  bridge.translate(0, 0.008, 0.004);
  frame.push(bridge);
  return { frame: merge(frame), lenses: merge(lenses) };
}

// ---------------------------------------------------------------------------
// The person
// ---------------------------------------------------------------------------
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);

export class Human {
  constructor(spec, shared) {
    this.spec = spec;
    const C = createCampTextures();
    const skinCol = rgb(spec.skin);
    const tex = (k) => C[k] || C.fabric;
    const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
    const out = spec.outfit;
    const mats = {
      skin: mat({ vertexColors: true, map: C.skin.map, normalMap: C.skin.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.62 }),
      hair: mat({ vertexColors: true, map: C.hair.map, normalMap: C.hair.normal, alphaMap: C.hairAlpha, alphaTest: 0.5, roughness: 0.6 }),
      stubble: mat({ vertexColors: true, map: C.hair.map, alphaMap: C.stubbleAlpha, alphaTest: 0.5, roughness: 0.7 }),
      locks: mat({ vertexColors: true, map: C.hair.map, normalMap: C.hair.normal, roughness: 0.6 }),
      eye: mat({ vertexColors: true, roughness: 0.12 }),
      mouth: mat({ color: 0x2a0d0b, roughness: 0.6 }),
      teeth: mat({ color: 0xe8e2d4, roughness: 0.35 }),
      jacket: mat({ vertexColors: true, map: tex(out.jacket.tex).map, normalMap: tex(out.jacket.tex).normal, roughness: out.jacket.roughness ?? 0.85 }),
      pants: mat({ color: out.pants.color, map: tex(out.pants.tex).map, normalMap: tex(out.pants.tex).normal, roughness: 0.9 }),
      shoes: mat({ vertexColors: true, roughness: out.shoes.roughness ?? 0.7, map: C.suede.map }),
      collar: mat({ color: out.jacket.collarColor ?? out.jacket.color, map: tex(out.jacket.collarTex ?? 'fleece').map, normalMap: tex(out.jacket.collarTex ?? 'fleece').normal, roughness: 0.95 }),
      metal: mat({ color: 0xc8ccd0, metalness: 1, roughness: 0.3 }),
      dark: mat({ color: 0x111111, roughness: 0.5 }),
      glass: shared.glass,
      tea: shared.tea,
    };
    this.mats = mats;

    const root = new THREE.Group();
    this.root = root;
    const scale = spec.height ?? 1;
    root.scale.setScalar(scale);

    // ---- skeleton ----
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.1;
    root.add(pelvis);
    const spine = new THREE.Group();
    pelvis.add(spine);
    const neck = new THREE.Group();
    neck.position.set(0, 0.515, -0.008);
    spine.add(neck);
    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.07, 0.012);
    neck.add(headPivot);
    this.pelvis = pelvis;
    this.spine = spine;
    this.neck = neck;
    this.headPivot = headPivot;

    // ---- torso ----
    const jc = { main: rgb(out.jacket.color), inner: rgb(out.inner?.color ?? 0x151515), edge: rgb(out.jacket.edge ?? out.jacket.color) };
    jc.edge = out.jacket.edge ? rgb(out.jacket.edge) : jc.main.map((v) => v * 0.7);
    const torso = new THREE.Mesh(torsoGeometry({ ...out.jacket, shoulders: spec.shoulders, width: spec.build, depth: spec.build, belly: spec.belly }, jc), mats.jacket);
    torso.castShadow = true;
    spine.add(torso);
    this.torso = torso;

    // neck (skin) + collar
    const neckGeo = limbGeometry(0.046, 0.05, 0.11, 16);
    neckGeo.rotateX(Math.PI);
    neckGeo.translate(0, -0.03, 0);
    solid(neckGeo, skinCol.map((v) => v * 0.93));
    neck.add(new THREE.Mesh(neckGeo, mats.skin));
    this._collar(out.jacket, mats, spine, jc);

    // ---- head ----
    const head = buildHead(spec, mats);
    head.group.position.set(0, 0.1, 0.012);
    headPivot.add(head.group);
    this.head = head;
    this.mouthOpenBase = spec.face?.smile ? 0.7 : 0;

    // guitar resting on the right thigh against the belly, neck to the left
    if (spec.guitar) {
      const gt = buildGuitar();
      gt.group.position.set(0.0, 0.2, 0.19);
      gt.group.rotation.set(-0.22, 0, 0.42, 'XYZ');
      spine.add(gt.group);
      this.guitar = gt;
    }

    // hat / sunglasses
    if (spec.hat) {
      const hat = new THREE.Mesh(hatGeometry(spec.hat), mat({ vertexColors: true, map: C.suede.map, normalMap: C.suede.normal, roughness: 0.65 }));
      const [, hy] = head.sculpt(0, 0.62, 0);
      hat.position.set(0, hy - 0.03, -0.004);
      hat.rotation.x = -0.1;
      hat.castShadow = true;
      head.group.add(hat);
    }
    if (spec.sunglasses) {
      const sg = sunglassesGeometry();
      const g = new THREE.Group();
      g.add(new THREE.Mesh(sg.frame, mats.dark));
      g.add(new THREE.Mesh(sg.lenses, mat({ color: 0x2a6bd8, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.6 })));
      const [, gy, gz] = head.sculpt(0, 0.72, 0.62);
      g.position.set(0, gy + 0.012, gz - 0.005);
      g.rotation.x = -0.75;
      head.group.add(g);
    }
    // reading glasses: thin round metal rims in front of the eyes, arms to the ears
    if (spec.glasses) {
      const parts = [];
      const [eL, eR] = head.eyes.map((e) => e.position);
      for (const [s, e] of [[-1, eL], [1, eR]]) {
        const rim = new THREE.TorusGeometry(0.021, 0.0022, 6, 22);
        rim.translate(e.x, e.y + 0.002, e.z + 0.017);
        parts.push(rim);
        const [ex, ey, ez] = head.sculpt(s * 0.97, -0.12, -0.15);
        const a = new THREE.Vector3(e.x + s * 0.021, e.y + 0.004, e.z + 0.014), b = new THREE.Vector3(ex + s * 0.004, ey + 0.01, ez);
        const len = a.distanceTo(b);
        const arm = new THREE.CylinderGeometry(0.0015, 0.0015, len, 4);
        arm.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        arm.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        parts.push(arm);
      }
      const bridge = new THREE.CylinderGeometry(0.0018, 0.0018, eR.x - eL.x - 0.04, 4);
      bridge.rotateZ(Math.PI / 2);
      bridge.translate((eL.x + eR.x) / 2, eL.y + 0.008, eL.z + 0.022);
      parts.push(bridge);
      head.group.add(new THREE.Mesh(merge(parts), mat({ color: 0xb9a36a, metalness: 0.9, roughness: 0.3 })));
      const lenses = [eL, eR].map((e) => new THREE.CircleGeometry(0.02, 18).translate(e.x, e.y + 0.002, e.z + 0.017));
      head.group.add(new THREE.Mesh(merge(lenses), mat({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.12, envMapIntensity: 1.5, depthWrite: false })));
    }
    if (spec.earrings) {
      for (const s of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0013, 6, 14), mats.metal);
        const [ex, ey, ez] = head.sculpt(s * 0.98, -0.42, -0.1);
        ring.position.set(ex + s * 0.004, ey, ez);
        ring.rotation.y = Math.PI / 2;
        head.group.add(ring);
      }
    }

    // ---- arms ----
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.17 * (spec.shoulders ?? 1) * (spec.build ?? 1), 0.455, -0.005);
      spine.add(shoulder);
      const upperLen = 0.29, foreLen = 0.255;
      const sleeveR = out.jacket.sleeve ?? 0.052;
      const ball = new THREE.Mesh(solid(new THREE.SphereGeometry(sleeveR * 1.12, 14, 10), jc.main), mats.jacket);
      shoulder.add(ball);
      const ug = solid(limbGeometry(sleeveR, sleeveR * 0.86, upperLen), jc.main);
      if (out.jacket.quilted) ug.scale(1.05, 1, 1.05);
      const upper = new THREE.Mesh(ug, mats.jacket);
      upper.castShadow = true;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -upperLen;
      shoulder.add(elbow);
      const fore = new THREE.Mesh(solid(limbGeometry(sleeveR * 0.86, sleeveR * 0.74, foreLen - 0.01), jc.main), mats.jacket);
      fore.castShadow = true;
      elbow.add(fore);
      const cuff = new THREE.Mesh(solid(new THREE.CylinderGeometry(sleeveR * 0.78, sleeveR * 0.78, 0.03, 14, 1, true), jc.edge), mats.jacket);
      cuff.position.y = -foreLen + 0.03;
      elbow.add(cuff);
      const wrist = new THREE.Group();
      wrist.position.y = -foreLen;
      elbow.add(wrist);
      const wristSkin = new THREE.Mesh(solid(new THREE.CylinderGeometry(0.026, 0.028, 0.04, 12), skinCol), mats.skin);
      wristSkin.position.y = 0.01;
      wrist.add(wristSkin);
      const sideName = s < 0 ? 'right' : 'left';
      const holding = spec.hold === sideName || spec.hold === 'both';
      const hg = handGeometry(skinCol, holding);
      if (s < 0) flipWinding(hg.scale(1, 1, -1));
      const hand = new THREE.Mesh(hg, mats.skin);
      hand.castShadow = true;
      wrist.add(hand);
      // a free hand also has an open pose (for waving); both stay separate meshes
      let openHand = null;
      if (!holding) {
        const og = handGeometry(skinCol, false, true);
        if (s < 0) flipWinding(og.scale(1, 1, -1));
        openHand = new THREE.Mesh(og, mats.skin);
        openHand.castShadow = true;
        openHand.visible = false;
        openHand.userData.keep = hand.userData.keep = true;
        wrist.add(openHand);
      }
      let glass = null;
      if (holding) {
        glass = teaGlass(mats);
        glass.rotation.z = -Math.PI / 2;
        glass.position.set(-0.03, -0.072, 0.03 * s);
        wrist.add(glass);
      }
      if (spec.watch === sideName) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.007, 6, 18), mats.dark);
        w.rotation.x = Math.PI / 2;
        w.position.y = 0.012;
        wrist.add(w);
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.008, 18), mats.dark);
        face.rotation.z = Math.PI / 2;
        face.position.set(-s * 0.033, 0.012, 0);
        wrist.add(face);
        const dial = new THREE.Mesh(new THREE.CircleGeometry(0.014, 18), mat({ color: 0x0a0a0a, roughness: 0.2, metalness: 0.4 }));
        dial.rotation.y = -s * Math.PI / 2;
        dial.position.set(-s * 0.0375, 0.012, 0);
        wrist.add(dial);
      }
      if (spec.rings) {
        for (const [dx, dy] of [[0.009, -0.095], [-0.009, -0.093], [-0.027, -0.088]]) {
          const r = new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0024, 6, 12), mats.metal);
          r.rotation.x = Math.PI / 2;
          r.position.set(dx, dy, holding ? 0.015 * s : 0.006 * s);
          wrist.add(r);
        }
      }
      this.arms.push({ side: s, shoulder, elbow, wrist, upperLen, foreLen, glass, hand, openHand });
    }

    // ---- legs ----
    this.legs = [];
    const pantsCol = rgb(out.pants.color);
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.092 * (spec.build ?? 1), 0.0, 0.0);
      pelvis.add(hip);
      const thighLen = 0.43 * (spec.legs ?? 1), shinLen = 0.44 * (spec.legs ?? 1);
      const thigh = new THREE.Mesh(solid(limbGeometry(0.08 * (spec.build ?? 1), 0.058, thighLen), pantsCol), mats.pants);
      thigh.castShadow = true;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -thighLen;
      hip.add(knee);
      const shin = new THREE.Mesh(solid(limbGeometry(0.056, 0.047, shinLen - 0.05), pantsCol), mats.pants);
      shin.castShadow = true;
      knee.add(shin);
      const ankle = new THREE.Group();
      ankle.position.y = -shinLen;
      knee.add(ankle);
      const shoe = new THREE.Mesh(shoeGeometry(out.shoes.style, rgb(out.shoes.color), rgb(out.shoes.sole ?? 0x1a1714)), mats.shoes);
      shoe.position.y = -0.045;
      shoe.castShadow = true;
      ankle.add(shoe);
      this.legs.push({ side: s, hip, knee, ankle, thighLen, shinLen });
    }

    // a work apron (the shopkeeper): a bib that follows the chest, neck straps,
    // and a skirt hanging from the waist (for a standing person)
    if (out.apron) {
      const am = mat({ color: out.apron.color, map: C.denim.map, normalMap: C.denim.normal, roughness: 0.9, side: THREE.DoubleSide });
      const tp = torso.geometry.attributes.position;
      const surfaceZ = (x, y) => {
        let best = -1;
        for (let i = 0; i < tp.count; i++) {
          const vx = tp.getX(i), vy = tp.getY(i), vz = tp.getZ(i);
          if (vz > 0 && Math.abs(vx - x) < 0.035 && Math.abs(vy - y) < 0.035 && vz > best) best = vz;
        }
        return best;
      };
      const bib = new THREE.PlaneGeometry(0.25, 0.32, 6, 8);
      bib.translate(0, 0.25, 0);
      const bp = bib.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const z = surfaceZ(bp.getX(i), bp.getY(i));
        bp.setZ(i, (z > 0 ? z : 0.12) + 0.008);
      }
      bib.computeVertexNormals();
      const bm = new THREE.Mesh(bib, am);
      bm.castShadow = true;
      spine.add(bm);
      for (const sx of [-1, 1]) {
        const a = new THREE.Vector3(sx * 0.115, 0.41, surfaceZ(sx * 0.115, 0.41) + 0.006), b = new THREE.Vector3(sx * 0.06, 0.56, -0.03);
        const strap = new THREE.CylinderGeometry(0.008, 0.008, a.distanceTo(b), 4);
        strap.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        strap.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
        spine.add(new THREE.Mesh(strap, am));
      }
      const skirt = new THREE.PlaneGeometry(0.4, 0.58, 6, 4);
      const sp = skirt.attributes.position;
      for (let i = 0; i < sp.count; i++) sp.setZ(i, 0.11 * (spec.build ?? 1) - sp.getX(i) * sp.getX(i) * 0.6);
      skirt.computeVertexNormals();
      skirt.translate(0, -0.27, 0);
      const sm = new THREE.Mesh(skirt, am);
      sm.castShadow = true;
      pelvis.add(sm);
    }

    // animation state
    this.lookYaw = 0; this.lookPitch = 0;
    this.blinkT = 2 + Math.random() * 3;
    this.talk = 0;
    this.laugh = 0;
    this._t = Math.random() * 100;
    if (spec.model) this._useModel(spec.model);
  }

  // ---- the person built in Blender (pipeline/blender_people.py) -----------
  // The skinned MakeHuman body replaces the hand-built meshes; this rig keeps
  // animating it. First the rig is fitted to the model: every joint moves to
  // the matching bone and points along it, and the limb lengths the IK uses
  // become the model's own. Blink and smile are morph targets, the jaw bone
  // opens the mouth.
  _useModel(src) {
    const MAP = {
      root: this.pelvis, pelvisL: this.pelvis, pelvisR: this.pelvis,
      spine05: this.spine, spine04: this.spine, spine03: this.spine, spine02: this.spine, spine01: this.spine,
      breastL: this.spine, breastR: this.spine, clavicleL: this.spine, clavicleR: this.spine, shoulder01L: this.spine, shoulder01R: this.spine,
      neck01: this.neck, neck02: this.neck, neck03: this.neck, head: this.headPivot,
    };
    // arms[0] / legs[0] are the character's right side (MakeHuman ".R")
    const SIDES = [[0, 'R'], [1, 'L']];
    for (const [i, side] of SIDES) {
      const A = this.arms[i], L = this.legs[i];
      Object.assign(MAP, {
        ['upperarm01' + side]: A.shoulder, ['upperarm02' + side]: A.shoulder,
        ['lowerarm01' + side]: A.elbow, ['lowerarm02' + side]: A.elbow, ['wrist' + side]: A.wrist,
        ['upperleg01' + side]: L.hip, ['upperleg02' + side]: L.hip,
        ['lowerleg01' + side]: L.knee, ['lowerleg02' + side]: L.knee, ['foot' + side]: L.ankle,
      });
    }
    const keep = new Set();
    for (const A of this.arms) A.glass?.traverse((o) => keep.add(o));
    this.guitar?.group.traverse((o) => keep.add(o));
    const root = this.root;
    const P = (o) => o.getWorldPosition(new THREE.Vector3());
    // aim joint j so its -Y axis points at world point `to` (smallest turn)
    const aim = (j, to) => {
      j.parent.updateWorldMatrix(true, false);
      const pq = j.parent.getWorldQuaternion(new THREE.Quaternion());
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(pq);
      const dir = to.clone().sub(P(j)).normalize();
      const wq = new THREE.Quaternion().setFromUnitVectors(down, dir).multiply(pq);
      j.quaternion.copy(pq.invert().multiply(wq));
      j.updateWorldMatrix(false, false);
    };
    const prepare = (model) => {
      model.scale.setScalar(1 / root.scale.x); // the model keeps its real size
      root.updateMatrixWorld(true);
      const bone = (n) => model.getObjectByName(n);
      const W = (n) => P(bone(n));
      const hipMid = W('upperleg01L').add(W('upperleg01R')).multiplyScalar(0.5);
      model.position.add(root.worldToLocal(P(this.pelvis)).sub(root.worldToLocal(hipMid)));
      root.updateMatrixWorld(true);
      const local = (parent, w) => parent.worldToLocal(w.clone());
      this.neck.position.copy(local(this.spine, W('neck01')));
      this.neck.updateWorldMatrix(false, false);
      this.headPivot.position.copy(local(this.neck, W('head')));
      const s = root.scale.x;
      for (const [i, side] of SIDES) {
        const A = this.arms[i], L = this.legs[i];
        const sh = W('upperarm01' + side), el = W('lowerarm01' + side), wr = W('wrist' + side);
        A.shoulder.position.copy(local(this.spine, sh));
        aim(A.shoulder, el);
        A.upperLen = el.distanceTo(sh) / s;
        A.elbow.position.set(0, -A.upperLen, 0);
        aim(A.elbow, wr);
        A.foreLen = wr.distanceTo(el) / s;
        A.wrist.position.set(0, -A.foreLen, 0);
        const hp = W('upperleg01' + side), kn = W('lowerleg01' + side), an = W('foot' + side);
        L.hip.position.copy(local(this.pelvis, hp));
        aim(L.hip, kn);
        L.thighLen = kn.distanceTo(hp) / s;
        L.knee.position.set(0, -L.thighLen, 0);
        aim(L.knee, an);
        L.shinLen = an.distanceTo(kn) / s;
        L.ankle.position.set(0, -L.shinLen, 0);
      }
      root.updateMatrixWorld(true);
      // the front of the lips, kept in the head's frame (for sips of tea)
      let rigNode = null;
      model.traverse((o) => { if (o.userData && o.userData.mouth) rigNode = o; });
      if (rigNode) {
        const m = rigNode.userData.mouth;
        this._mouthLocal = this.headPivot.worldToLocal(rigNode.localToWorld(new THREE.Vector3(m[0], m[1], m[2])));
      }
      this._jaw = bone('jaw');
      this._jawRest = this._jaw ? this._jaw.quaternion.clone() : null;
    };
    this.binding = new SkinBinding(root, src, MAP, (mesh) => {
      const m = mesh.material;
      if (/hair|eyebrow|eyelash|beard/.test(m.name)) {
        m.transparent = false;
        m.depthWrite = true;
        m.alphaTest = /eyelash/.test(m.name) ? 0.3 : 0.5;
        m.side = THREE.DoubleSide;
        mesh.castShadow = !/eyelash|eyebrow/.test(m.name);
      }
      if (mesh.morphTargetDictionary && 'blink' in mesh.morphTargetDictionary) this._face = mesh;
    }, { keep: (o) => keep.has(o), prepare });
    // back to the rig's rest pose (the animation sets the rotations it needs)
    for (const j of [this.spine, this.neck, this.headPivot]) j.rotation.set(0, 0, 0);
    for (const A of this.arms) for (const j of [A.shoulder, A.elbow, A.wrist]) j.rotation.set(0, 0, 0);
    for (const L of this.legs) for (const j of [L.hip, L.knee, L.ankle]) j.rotation.set(0, 0, 0);
    this.model = this.binding.model;
  }

  /** after the rig has been posed for this frame */
  syncModel() {
    if (!this.binding) return;
    this.root.updateMatrixWorld(true);
    this.binding.sync();
  }

  _collar(j, mats, spine, jc) {
    const type = j.collar;
    if (type === 'shearling') {
      const g = new THREE.TorusGeometry(0.078, 0.03, 10, 28, Math.PI * 1.5);
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI * 1.5 - Math.PI * 0.75);
      g.scale(1.15, 1.5, 1.05);
      const c = new THREE.Mesh(g, mats.collar);
      c.position.set(0, 0.545, -0.02);
      c.rotation.x = 0.3;
      spine.add(c);
    } else if (type === 'hood') {
      const g = new THREE.TorusGeometry(0.082, 0.03, 10, 26, Math.PI * 1.4);
      g.rotateX(Math.PI / 2);
      g.rotateY(Math.PI * 1.5 - Math.PI * 0.7);
      g.scale(1.1, 1.4, 1.05);
      const c = new THREE.Mesh(solid(g, jc.main.map((v) => v * 0.92)), mats.jacket);
      c.position.set(0, 0.55, -0.02);
      c.rotation.x = 0.25;
      const st = new THREE.Mesh(solid(new THREE.CylinderGeometry(0.066, 0.075, 0.07, 20, 1, true), jc.main), mats.jacket);
      st.position.set(0, 0.555, -0.006);
      spine.add(st);
      spine.add(c);
      const hood = new THREE.SphereGeometry(1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6);
      hood.scale(0.13, 0.12, 0.07);
      const h = new THREE.Mesh(solid(hood, jc.main.map((v) => v * 0.85)), mats.jacket);
      h.position.set(0, 0.47, -0.11);
      h.rotation.x = -1.9;
      spine.add(h);
    } else if (type === 'stand') {
      const g = new THREE.CylinderGeometry(0.068, 0.078, 0.08, 22, 1, true);
      const c = new THREE.Mesh(solid(g, jc.main), mats.jacket);
      c.material.side = THREE.DoubleSide;
      c.position.set(0, 0.565, -0.008);
      spine.add(c);
    } else if (type === 'turtle') {
      const g = new THREE.CylinderGeometry(0.058, 0.07, 0.085, 22, 3, true);
      const c = new THREE.Mesh(g, mats.collar);
      c.position.set(0, 0.57, -0.006);
      spine.add(c);
      for (const s of [-1, 1]) {
        const lap = new THREE.BoxGeometry(0.06, 0.16, 0.012);
        const l = new THREE.Mesh(solid(lap, jc.main.map((v) => v * 0.9)), mats.jacket);
        l.position.set(s * 0.08, 0.43, 0.115);
        l.rotation.set(-0.2, 0, s * 0.35);
        spine.add(l);
      }
    }
  }

  // ---- posing helpers ------------------------------------------------------
  setSeated({ lean = 0.12, kneeSpread = 0.12, footForward = 0.05 } = {}) {
    this.spine.rotation.x = lean;
    for (const L of this.legs) {
      L.hip.rotation.set(-Math.PI / 2 + 0.06, 0, L.side * -kneeSpread);
      L.knee.rotation.set(Math.PI / 2 - footForward - 0.06, 0, 0);
      L.ankle.rotation.set(footForward, 0, L.side * kneeSpread * 0.6);
    }
  }

  // two-bone IK: put the wrist of arm `i` at world position `target`; the
  // elbow bends toward world direction `pole`; the hand is then oriented so
  // its thumb points along `thumbUp` (world) and fingers along `fingers`.
  reach(i, target, pole, thumbUp, fingers) {
    const A = this.arms[i];
    const sh = A.shoulder;
    sh.parent.updateWorldMatrix(true, false);
    const parentQ = sh.parent.getWorldQuaternion(_q2);
    const origin = sh.getWorldPosition(_v1);
    const s = this.root.scale.x;
    const a = A.upperLen * s, b = A.foreLen * s;
    const t = _v2.subVectors(target, origin);
    let d = t.length();
    d = Math.min(Math.max(d, Math.abs(a - b) + 1e-3), a + b - 1e-3);
    const tDir = t.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const alpha = Math.acos(Math.min(1, Math.max(-1, cosA)));
    const pperp = _v3.copy(pole).addScaledVector(tDir, -pole.dot(tDir)).normalize();
    const u = _v4.copy(tDir).multiplyScalar(Math.cos(alpha)).addScaledVector(pperp, Math.sin(alpha)); // upper arm dir
    const elbowPos = origin.clone().addScaledVector(u, a);
    const fdir = tDir.clone().multiplyScalar(d).add(origin).sub(elbowPos).normalize();
    // upper arm basis: local -Y along u, forearm bends toward local +Z
    const Y = u.clone().negate();
    let Z = fdir.clone().addScaledVector(u, -fdir.dot(u));
    if (Z.lengthSq() < 1e-6) Z.copy(pperp).negate();
    Z.normalize();
    const X = new THREE.Vector3().crossVectors(Y, Z);
    _m.makeBasis(X, Y, Z);
    const worldQ = _q.setFromRotationMatrix(_m);
    sh.quaternion.copy(parentQ.clone().invert().multiply(worldQ));
    const bend = Math.acos(Math.min(1, Math.max(-1, u.dot(fdir))));
    A.elbow.rotation.set(-bend, 0, 0);
    // hand orientation
    if (thumbUp) {
      A.elbow.updateWorldMatrix(true, false);
      const elbowQ = A.elbow.getWorldQuaternion(new THREE.Quaternion());
      const fing = (fingers ? fingers.clone() : fdir.clone());
      const hx = thumbUp.clone().addScaledVector(fing, -thumbUp.dot(fing)).normalize();
      const hy = fing.clone().negate().normalize();
      const hz = new THREE.Vector3().crossVectors(hx, hy);
      _m.makeBasis(hx, hy, hz);
      const hq = new THREE.Quaternion().setFromRotationMatrix(_m);
      A.wrist.quaternion.copy(elbowQ.invert().multiply(hq));
    } else {
      A.wrist.quaternion.identity();
    }
  }

  setHandOpen(i, open) {
    const A = this.arms[i];
    if (!A.openHand) return;
    A.openHand.visible = open;
    A.hand.visible = !open;
  }

  // place the rim of the glass held by arm i at `rim` (world)
  sipAt(i, rim, thumbUp, fingers, pole) {
    const A = this.arms[i];
    const fing = fingers.clone().normalize();
    const hx = thumbUp.clone().addScaledVector(fing, -thumbUp.dot(fing)).normalize();
    const hy = fing.clone().negate();
    const hz = new THREE.Vector3().crossVectors(hx, hy);
    _m.makeBasis(hx, hy, hz);
    const hq = new THREE.Quaternion().setFromRotationMatrix(_m);
    const local = new THREE.Vector3(0.047, -0.072, 0.03 * A.side).multiplyScalar(this.root.scale.x);
    const wristT = rim.clone().sub(local.applyQuaternion(hq));
    this.reach(i, wristT, pole, thumbUp, fingers);
  }

  mouthWorld(target) {
    if (this._mouthLocal) return this.headPivot.localToWorld(target.copy(this._mouthLocal));
    const [mx, my, mz] = facePoint(this.head.sculpt, 0, -0.59);
    return this.head.group.localToWorld(target.set(mx, my, mz + 0.01));
  }

  // per-frame face animation (blink, mouth, gaze)
  updateFace(dt) {
    this._t += dt;
    if (this.binding) { this._updateModelFace(dt); return; }
    this.blinkT -= dt;
    let lid = 0;
    if (this.blinkT < 0) {
      lid = Math.sin(Math.min(1, -this.blinkT / 0.16) * Math.PI);
      if (this.blinkT < -0.16) this.blinkT = 2 + Math.random() * 4.5;
    }
    const squint = this.laugh * 0.35 + (this.spec.face?.smile ?? 0) * 0.12;
    for (const l of this.head.lids) l.rotation.x = l.userData.open + (1.15 - l.userData.open) * Math.max(lid, squint);
    // real voice -> mouth follows its loudness; otherwise a talking rhythm
    const talkOpen = this.voiceLevel != null ? this.voiceLevel : this.talk * (0.35 + 0.65 * Math.abs(Math.sin(this._t * 11) * Math.sin(this._t * 4.3 + 1)));
    const open = Math.min(1, this.mouthOpenBase * (0.75 + this.laugh * 0.5) + talkOpen + this.laugh * 0.8);
    const m = this.head.mouth;
    m.userData.inner.scale.y = 0.002 + open * (0.011 + this.mouthOpenBase * 0.004);
    m.userData.teeth.visible = open > 0.25;
  }

  _updateModelFace(dt) {
    this.blinkT -= dt;
    let lid = 0;
    if (this.blinkT < 0) {
      lid = Math.sin(Math.min(1, -this.blinkT / 0.16) * Math.PI);
      if (this.blinkT < -0.16) this.blinkT = 2 + Math.random() * 4.5;
    }
    const smile = Math.min(1, (this.spec.face?.smile ?? 0) * 0.6 + this.laugh);
    const talkOpen = this.voiceLevel != null ? this.voiceLevel : this.talk * (0.35 + 0.65 * Math.abs(Math.sin(this._t * 11) * Math.sin(this._t * 4.3 + 1)));
    const open = Math.min(1, this.mouthOpenBase * (0.3 + this.laugh * 0.5) + talkOpen * 0.8 + this.laugh * 0.7);
    const f = this._face;
    if (f) {
      const d = f.morphTargetDictionary;
      f.morphTargetInfluences[d.blink] = Math.max(lid, smile * 0.15);
      if (d.smile != null) f.morphTargetInfluences[d.smile] = smile;
    }
    if (this._jaw) this._jaw.quaternion.copy(this._jawRest).multiply(_jawQ.setFromAxisAngle(_X, open * JAW_OPEN));
  }
}

const _X = new THREE.Vector3(1, 0, 0);
const _jawQ = new THREE.Quaternion();
const JAW_OPEN = 0.22; // radians at a full laugh

