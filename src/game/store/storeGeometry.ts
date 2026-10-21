import * as THREE from 'three';
import { merge } from '../../utils/geometry.js';
import { ATLAS, CELL } from './storeTextures.ts';

// Geometry helpers for the shop: boxes whose texture follows real size
// (planks don't stretch), and the goods - chip bags, boxes, cans, bottles,
// jars and small packs - each with real volume and its label from the atlas.
// Every product is built standing on y = 0, centred on x / z.

export type Geo = THREE.BufferGeometry;
export { merge };

/** texture coordinates from position (metres / `scale`), picked by face direction */
export function planarUV(geo: Geo, scale = 1): Geo {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** a box from min / max corners, with real-size texture coordinates */
export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, uvScale = 1): Geo {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return planarUV(g, uvScale);
}

// ---- the label atlas --------------------------------------------------------
const INSET = 0.035;
/** squeeze the geometry's 0..1 texture coordinates (vertices `from`..`to`) into one atlas cell */
export function toCell(geo: Geo, cell: number, from = 0, to = geo.attributes.uv.count): Geo {
  const uv = geo.attributes.uv;
  const col = cell % ATLAS, row = Math.floor(cell / ATLAS);
  const u0 = col / ATLAS, v0 = 1 - (row + 1) / ATLAS, s = 1 / ATLAS;
  for (let i = from; i < to; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1), v = THREE.MathUtils.clamp(uv.getY(i), 0, 1);
    uv.setXY(i, u0 + (INSET + u * (1 - 2 * INSET)) * s, v0 + (INSET + v * (1 - 2 * INSET)) * s);
  }
  uv.needsUpdate = true;
  return geo;
}

/** a whole geometry in one flat colour cell */
const flat = (geo: Geo, cell: number) => toCell(geo, cell);

// apply cells per draw group of a three.js primitive (side / top / bottom...)
function groupsToCells(geo: Geo, cells: number[]): Geo {
  const idx = geo.index!;
  geo.groups.forEach((g, k) => {
    const cell = cells[Math.min(k, cells.length - 1)];
    let mn = Infinity, mx = -Infinity;
    for (let i = g.start; i < g.start + g.count; i++) { const v = idx.getX(i); mn = Math.min(mn, v); mx = Math.max(mx, v); }
    toCell(geo, cell, mn, mx + 1);
  });
  geo.clearGroups();
  return geo;
}

// ---- the goods --------------------------------------------------------------
/** a box product (biscuits, tea, pasta, juice cartons...) */
export function boxItem(w: number, h: number, d: number, cell: number): Geo {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  // sides / top get the edge of the label, front and back the whole label
  groupsToCells(g, [cell, cell, cell, cell, cell, cell]);
  return g;
}

/** a puffy snack bag with crimped top and bottom */
export function bag(w: number, h: number, d: number, cell: number): Geo {
  const g = new THREE.BoxGeometry(w, h, d, 3, 6, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / h + 0.5; // 0..1
    const puff = Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(y, 0.02, 0.98)), 0.6);
    const xs = 1 + 0.06 * puff - 0.05 * (1 - puff);
    p.setXYZ(i, p.getX(i) * xs, p.getY(i), p.getZ(i) * (0.15 + 0.85 * puff));
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  groupsToCells(g, [cell, cell, cell, cell, cell, cell]);
  return g;
}

/** a can (drinks, beans, tuna...) */
export function can(r: number, h: number, cell: number): Geo {
  const g = new THREE.CylinderGeometry(r, r, h, 12, 1, false);
  g.translate(0, h / 2, 0);
  groupsToCells(g, [cell, CELL.silver, CELL.silver]);
  return g;
}

/** a jar with a lid */
export function jar(r: number, h: number, cell: number, lid: number = CELL.gold): Geo {
  const body = new THREE.CylinderGeometry(r, r * 0.96, h * 0.86, 12, 1, false);
  body.translate(0, h * 0.43, 0);
  groupsToCells(body, [cell, CELL.glassClear, CELL.glassClear]);
  const cap = new THREE.CylinderGeometry(r * 0.86, r * 0.88, h * 0.14, 12);
  cap.translate(0, h * 0.93, 0);
  flat(cap, lid);
  return merge([body, cap]);
}

export interface BottleSpec {
  h: number; r: number;
  /** glass / plastic colour (an atlas colour cell) */
  glass: number;
  label: number;
  cap?: number;
  /** neck length as a share of the height (wine / liquor bottles have long necks) */
  neck?: number;
  /** square shoulders (liquor) instead of round (soda, water) */
  square?: boolean;
}

/** a bottle: body, shoulders, neck, a label band and a cap */
export function bottle({ h, r, glass, label, cap = CELL.gold, neck = 0.28, square = false }: BottleSpec): Geo {
  const rn = r * 0.36;
  const body = 1 - neck - 0.08;
  const pts = [
    new THREE.Vector2(0.001, 0), new THREE.Vector2(r * 0.94, 0), new THREE.Vector2(r, h * 0.03),
    new THREE.Vector2(r, h * body),
    new THREE.Vector2(square ? r * 0.92 : r * 0.82, h * (body + 0.05)),
    new THREE.Vector2(rn * 1.15, h * (body + 0.09)),
    new THREE.Vector2(rn, h * (1 - neck * 0.5)),
    new THREE.Vector2(rn, h * 0.94),
  ];
  const lathe = new THREE.LatheGeometry(pts, 10);
  flat(lathe, glass);
  const band = new THREE.CylinderGeometry(r * 1.012, r * 1.012, h * 0.34, 10, 1, true);
  band.translate(0, h * (0.12 + 0.17), 0);
  toCell(band, label);
  const c = new THREE.CylinderGeometry(rn * 1.12, rn * 1.12, h * 0.07, 8);
  c.translate(0, h * 0.965, 0);
  flat(c, cap);
  return merge([lathe, band, c]);
}

/** a small pack (gum, chocolate bar, cigarettes, batteries...) */
export function pack(w: number, h: number, d: number, cell: number): Geo {
  return boxItem(w, h, d, cell);
}

/** a disposable lighter */
export function lighter(colorCell: number): Geo {
  const body = new THREE.BoxGeometry(0.024, 0.06, 0.012);
  body.translate(0, 0.03, 0);
  flat(body, colorCell);
  const top = new THREE.BoxGeometry(0.022, 0.016, 0.011);
  top.translate(0, 0.068, 0);
  flat(top, CELL.silver);
  return merge([body, top]);
}

/** put a product somewhere: move and turn a copy */
export function place(geo: Geo, x: number, y: number, z: number, yaw = 0): Geo {
  const g = geo.clone();
  if (yaw) g.rotateY(yaw);
  g.translate(x, y, z);
  return g;
}

/** a flat colour cell for plain parts */
export { flat };
