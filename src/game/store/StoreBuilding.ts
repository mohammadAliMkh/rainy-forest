import * as THREE from 'three';
import { mulberry32 } from '../../utils/noise.js';
import type { StoreTextures } from './storeTextures.ts';
import { box, planarUV, merge, type Geo } from './storeGeometry.ts';
import {
  W, D, T, F, H, RIDGE, X0, X1, Z0, Z1, IX0, IX1, IZ0, IZ1, PORCH, PZ1, STEP_N, STEP_D, ROOF_OVER, ROOF_FRONT,
  DOOR, WIN_L, WIN_R, STEPS, TIE_BEAMS,
} from './storeLayout.ts';

// The shop building, in its own frame (see storeLayout.ts): a stone base,
// plank walls with a door and two windows, a gable roof with white trim
// reaching over the porch, the porch with railing and steps, the carved
// sign, a lantern by the door, and the things lying about outside (bench,
// crates, barrel, a basket of apples, firewood, a trash bin). Also the
// interior shell: floorboards, panelled walls and the open ceiling with
// beams. The door leaf is a separate group so it can swing open.

/** the forest's own textures the shop reuses (wood, stone, bark) */
type Tex = Record<'wood' | 'woodNormal' | 'stone' | 'stoneNormal' | 'bark' | 'barkNormal' | 'logEnd', THREE.Texture>;

export interface BuildingParts {
  group: THREE.Group;
  door: THREE.Group; // pivot at the hinge
  windowGlass: THREE.MeshStandardMaterial;
  lanternGlow: THREE.MeshStandardMaterial;
  /** where the lantern hangs (for its light / glow), in the shop frame */
  lanternPos: THREE.Vector3;
}

const ROOF_SLOPE = RIDGE / (W / 2);
/** height of the roof's underside at x (shop frame) */
export const roofY = (x: number) => F + H + RIDGE * (1 - Math.abs(x) / (W / 2));

export function buildBuilding(S: StoreTextures, T0: Tex): BuildingParts {
  const group = new THREE.Group();
  const rand = mulberry32(512);
  const m = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
  const mats = {
    siding: m({ map: S.siding, normalMap: S.sidingNormal, roughness: 0.9 }),
    boards: m({ map: S.boards, normalMap: S.boardsNormal, roughness: 0.72 }),
    floor: m({ map: S.floor, normalMap: S.floorNormal, roughness: 0.8 }),
    roof: m({ map: S.roof, normalMap: S.roofNormal, roughness: 0.62, metalness: 0.15 }),
    trim: m({ color: 0xd8d0be, roughness: 0.75 }),
    darkWood: m({ map: S.siding, color: 0x8a6a52, roughness: 0.8 }),
    wood: m({ map: T0.wood, normalMap: T0.woodNormal, roughness: 0.85 }),
    stone: m({ map: T0.stone, normalMap: T0.stoneNormal, roughness: 0.95, vertexColors: true }),
    metal: m({ color: 0x2c2c2a, metalness: 0.7, roughness: 0.45 }),
    green: m({ color: 0x2f7d3a, roughness: 0.6 }),
    bark: m({ map: T0.bark, normalMap: T0.barkNormal, roughness: 0.95 }),
    logEnd: m({ map: T0.logEnd, roughness: 0.8 }),
    apple: m({ color: 0xb0261c, roughness: 0.45 }),
    basket: m({ color: 0x9a7444, map: S.boards, roughness: 0.9 }),
  };
  const windowGlass = new THREE.MeshStandardMaterial({
    color: 0xa9bcc4, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, envMapIntensity: 1.4,
    emissive: 0xffb764, emissiveIntensity: 0.0, depthWrite: false, side: THREE.DoubleSide,
  });
  const lanternGlow = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffb050, emissiveIntensity: 2.2, roughness: 0.4 });
  const parts: Record<string, Geo[]> = {};
  const add = (key: keyof typeof mats, g: Geo) => (parts[key] ??= []).push(g);

  // ---- stone base: a plinth, with irregular stones around it ----
  {
    const plinth = box(X0 + 0.06, -0.4, Z0 + 0.06, X1 - 0.06, F - 0.02, PZ1 - 0.06, 1.2);
    paint(plinth, [0.42, 0.41, 0.38]);
    add('stone', plinth);
    const stones: Geo[] = [];
    const ring = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / 0.42);
      for (let k = 0; k <= n; k++) {
        for (const yy of [0.1, 0.32]) {
          const t = (k + rand() * 0.4) / n;
          const g = new THREE.IcosahedronGeometry(1, 0);
          const s = 0.2 + rand() * 0.1;
          g.scale(s * (1 + rand() * 0.5), s * 0.62, s * 0.7);
          g.rotateY(rand() * 6);
          g.translate(x0 + (x1 - x0) * t, yy + rand() * 0.04, z0 + (z1 - z0) * t);
          planarUV(g, 0.8);
          const v = 0.36 + rand() * 0.16, moss = rand() < 0.3 ? 0.08 : 0;
          paint(g, [v - moss, v + moss * 0.6, v - moss]);
          stones.push(g);
        }
      }
    };
    ring(X0, Z0, X1, Z0); ring(X0, Z0, X0, PZ1); ring(X1, Z0, X1, PZ1);
    ring(X0, PZ1, STEPS.x0, PZ1); ring(STEPS.x1, PZ1, X1, PZ1);
    add('stone', merge(stones));
  }

  // ---- floors: inside boards and the porch deck ----
  add('floor', box(IX0 - 0.02, F - 0.06, IZ0 - 0.02, IX1 + 0.02, F, IZ1 + 0.02, 1.6));
  add('floor', box(X0, F - 0.07, Z1, X1, F, PZ1, 1.6));
  // door threshold
  add('darkWood', box(DOOR.x0, F, Z1 - T, DOOR.x1, F + 0.025, Z1 + 0.02, 1));

  // ---- walls: plank siding outside, honey boards inside ----
  const OUT = 0.07;
  const wallPiece = (x0: number, x1: number, y0: number, y1: number) => {
    add('siding', box(x0, F + y0, Z1 - OUT, x1, F + y1, Z1, 1.4));
    add('boards', box(x0, F + y0, Z1 - T, x1, F + y1, Z1 - OUT, 1.4));
  };
  // front wall around the door and windows
  wallPiece(X0, WIN_L.x0, 0, H);
  wallPiece(WIN_L.x0, WIN_L.x1, 0, WIN_L.y0);
  wallPiece(WIN_L.x0, WIN_L.x1, WIN_L.y1, H);
  wallPiece(WIN_L.x1, DOOR.x0, 0, H);
  wallPiece(DOOR.x0, DOOR.x1, DOOR.h, H);
  wallPiece(DOOR.x1, WIN_R.x0, 0, H);
  wallPiece(WIN_R.x0, WIN_R.x1, 0, WIN_R.y0);
  wallPiece(WIN_R.x0, WIN_R.x1, WIN_R.y1, H);
  wallPiece(WIN_R.x1, X1, 0, H);
  // back and sides
  add('siding', box(X0, F, Z0, X1, F + H, Z0 + OUT, 1.4));
  add('boards', box(IX0, F, Z0 + OUT, IX1, F + H, IZ0, 1.4));
  for (const s of [-1, 1]) {
    const xo = s < 0 ? X0 : X1 - OUT, xi = s < 0 ? X0 + OUT : IX1;
    add('siding', box(xo, F, Z0, xo + OUT, F + H, Z1, 1.4));
    add('boards', box(xi, F, IZ0, xi + (T - OUT), F + H, IZ1, 1.4));
  }
  // corner boards (outside)
  for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) add('darkWood', box(x - 0.05, F, z - 0.05, x + 0.05, F + H, z + 0.05, 1));
  // gable triangles: back, front wall, and a thinner one closing the porch roof
  for (const [z, t] of [[Z1 - T, T], [Z0, T], [PZ1 - 0.13, 0.06]]) {
    const shape = new THREE.Shape([new THREE.Vector2(X0, 0), new THREE.Vector2(X1, 0), new THREE.Vector2(0, RIDGE)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    g.translate(0, F + H, z);
    planarUV(g, 1.4);
    add('siding', g);
  }

  // ---- roof: two corrugated slopes, ridge cap, white trim, inner lining ----
  {
    const zA = Z0 - ROOF_OVER, zB = ROOF_FRONT;
    const halfSpan = W / 2 + ROOF_OVER;
    const L = Math.hypot(halfSpan, halfSpan * ROOF_SLOPE);
    const ang = Math.atan(ROOF_SLOPE);
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(L, 0.05, zB - zA);
      planarUV(g, 1);
      // corrugations run down the slope: swap u / v
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 1.2, uv.getX(i) * 1.2);
      g.rotateZ(-s * ang);
      g.translate(s * halfSpan / 2, F + H + RIDGE - (halfSpan / 2) * ROOF_SLOPE + 0.06, (zA + zB) / 2);
      add('roof', g);
      // inner lining under the slope, over the room only
      const li = new THREE.BoxGeometry(W / 2, 0.03, D - 2 * T);
      planarUV(li, 1.4);
      li.rotateZ(-s * ang);
      li.translate(s * W / 4, F + H + RIDGE / 2 - 0.05, 0);
      add('boards', li);
      // white fascia along the eave
      const fa = box(-0.03, -0.09, zA, 0.03, 0.09, zB, 1);
      fa.translate(s * halfSpan, F + H + RIDGE - halfSpan * ROOF_SLOPE + 0.04, 0);
      add('trim', fa);
      // white rake boards along the front and back edges
      for (const z of [zA, zB]) {
        const rk = new THREE.BoxGeometry(L, 0.16, 0.05);
        rk.rotateZ(-s * ang);
        rk.translate(s * halfSpan / 2, F + H + RIDGE - (halfSpan / 2) * ROOF_SLOPE + 0.03, z);
        planarUV(rk, 1);
        add('trim', rk);
      }
    }
    add('trim', box(-0.09, F + H + RIDGE + 0.04, zA, 0.09, F + H + RIDGE + 0.12, zB, 1)); // ridge cap
    // ridge beam and tie beams inside
    add('darkWood', box(-0.08, F + H + RIDGE - 0.22, Z0, 0.08, F + H + RIDGE - 0.02, PZ1, 1));
    for (const z of TIE_BEAMS) add('darkWood', box(IX0, F + H - 0.16, z - 0.07, IX1, F + H, z + 0.07, 1));
    add('darkWood', box(X0, F + H - 0.18, PZ1 - 0.16, X1, F + H, PZ1, 1)); // porch header beam
  }

  // ---- windows: frames, mullions, sills, glass ----
  const glass: Geo[] = [];
  const windowAt = (w: { x0: number; x1: number; y0: number; y1: number }, panes: number) => {
    const f = 0.06, zf = Z1 + 0.012;
    add('darkWood', box(w.x0 - f, F + w.y0 - f, Z1 - T - 0.01, w.x1 + f, F + w.y0, zf + 0.03, 1)); // sill
    add('darkWood', box(w.x0 - f, F + w.y1, Z1 - T - 0.01, w.x1 + f, F + w.y1 + f, zf, 1));
    add('darkWood', box(w.x0 - f, F + w.y0, Z1 - T - 0.01, w.x0, F + w.y1, zf, 1));
    add('darkWood', box(w.x1, F + w.y0, Z1 - T - 0.01, w.x1 + f, F + w.y1, zf, 1));
    for (let k = 1; k < panes; k++) {
      const x = w.x0 + ((w.x1 - w.x0) * k) / panes;
      add('darkWood', box(x - 0.022, F + w.y0, Z1 - 0.07, x + 0.022, F + w.y1, Z1 - 0.03, 1));
    }
    const ym = (w.y0 + w.y1) / 2;
    add('darkWood', box(w.x0, F + ym - 0.02, Z1 - 0.07, w.x1, F + ym + 0.02, Z1 - 0.03, 1));
    const p = new THREE.PlaneGeometry(w.x1 - w.x0, w.y1 - w.y0);
    p.translate((w.x0 + w.x1) / 2, F + (w.y0 + w.y1) / 2, Z1 - 0.05);
    glass.push(p);
  };
  windowAt(WIN_L, 3);
  windowAt(WIN_R, 1);

  // ---- door: frame here, the leaf (with a glass panel and an "open" card) swings ----
  add('darkWood', box(DOOR.x0 - 0.08, F, Z1 - T - 0.01, DOOR.x0, F + DOOR.h + 0.08, Z1 + 0.02, 1));
  add('darkWood', box(DOOR.x1, F, Z1 - T - 0.01, DOOR.x1 + 0.08, F + DOOR.h + 0.08, Z1 + 0.02, 1));
  add('darkWood', box(DOOR.x0 - 0.08, F + DOOR.h, Z1 - T - 0.01, DOOR.x1 + 0.08, F + DOOR.h + 0.08, Z1 + 0.02, 1));
  const door = new THREE.Group();
  door.position.set(DOOR.x0, F, Z1 - 0.05);
  {
    const dw = DOOR.x1 - DOOR.x0 - 0.01, dh = DOOR.h - 0.02, t = 0.045;
    const leaf: Geo[] = [
      box(0, 0, -t / 2, dw, 1.0, t / 2, 1), // lower panel
      box(0, 1.0, -t / 2, 0.12, dh, t / 2, 1), box(dw - 0.12, 1.0, -t / 2, dw, dh, t / 2, 1), // stiles
      box(0, dh - 0.12, -t / 2, dw, dh, t / 2, 1), // top rail
      box(dw / 2 - 0.02, 1.0, -t / 4, dw / 2 + 0.02, dh - 0.12, t / 4, 1), // glazing bar
    ];
    const dm = new THREE.Mesh(merge(leaf), mats.wood);
    dm.castShadow = true;
    door.add(dm);
    const dg = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.24, dh - 1.12), windowGlass);
    dg.position.set(dw / 2, 1.0 + (dh - 1.12) / 2, 0);
    door.add(dg);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mats.metal);
    knob.position.set(dw - 0.09, 1.0, 0.05);
    door.add(knob, knob.clone().translateZ(-0.1));
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshStandardMaterial({ map: S.openSign, roughness: 0.8 }));
    card.position.set(dw / 2, 1.55, 0.035);
    door.add(card);
  }
  group.add(door);

  // ---- porch: posts, railing, steps with handrails ----
  {
    const postAt = (x: number, z: number) => add('darkWood', box(x - 0.07, F, z - 0.07, x + 0.07, F + H - 0.1, z + 0.07, 1));
    const zp = PZ1 - 0.09;
    for (const x of [X0 + 0.09, STEPS.x0 - 0.07, STEPS.x1 + 0.07, X1 - 0.09]) postAt(x, zp);
    for (const x of [X0 + 0.09, X1 - 0.09]) postAt(x, Z1 + 0.09);
    const rail = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (const y of [0.12, 0.88]) {
        const g = box(-len / 2, F + y - 0.035, -0.03, len / 2, F + y + 0.035, 0.03, 1);
        g.rotateY(-Math.atan2(z1 - z0, x1 - x0));
        g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
        add('darkWood', g);
      }
      const n = Math.floor(len / 0.13);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        add('darkWood', box(x - 0.018, F + 0.12, z - 0.018, x + 0.018, F + 0.88, z + 0.018, 1));
      }
    };
    rail(X0 + 0.09, zp, STEPS.x0 - 0.07, zp);
    rail(STEPS.x1 + 0.07, zp, X1 - 0.09, zp);
    rail(X0 + 0.09, Z1 + 0.09, X0 + 0.09, zp);
    rail(X1 - 0.09, Z1 + 0.09, X1 - 0.09, zp);
    // steps (treads with a stone-ish riser below)
    for (let k = 0; k < STEP_N; k++) {
      const top = F * (STEP_N - k) / (STEP_N + 1);
      add('floor', box(STEPS.x0, -0.2, PZ1 + k * STEP_D, STEPS.x1, top, PZ1 + (k + 1) * STEP_D, 1.6));
    }
    // handrails down the steps
    for (const x of [STEPS.x0 - 0.07, STEPS.x1 + 0.07]) {
      const z0 = zp, z1 = PZ1 + STEP_N * STEP_D - 0.05;
      add('darkWood', box(x - 0.05, -0.1, z1 - 0.05, x + 0.05, 0.95, z1 + 0.05, 1));
      const len = Math.hypot(z1 - z0, F);
      const g = box(-0.03, -0.035, -len / 2, 0.03, 0.035, len / 2, 1);
      g.rotateX(Math.atan2(F, z1 - z0));
      g.translate(x, F * 0.5 + 0.88, (z0 + z1) / 2);
      add('darkWood', g);
    }
  }

  // ---- the sign under the gable, and a small lamp under it ----
  {
    // on the porch gable, where it is seen from the path
    const zs = PZ1 - 0.07;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), new THREE.MeshStandardMaterial({ map: S.sign, roughness: 0.8 }));
    sign.position.set(0, F + H + 0.43, zs + 0.035);
    group.add(sign);
    add('darkWood', box(-1.06, F + H + 0.15, zs, 1.06, F + H + 0.71, zs + 0.03, 1));
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.08, 12), lanternGlow);
    lamp.position.set(0, F + H + 0.1, zs + 0.12);
    group.add(lamp);
    add('metal', box(-0.012, F + H + 0.12, zs, 0.012, F + H + 0.15, zs + 0.12, 1));
  }

  // ---- the lantern beside the door ----
  const lanternPos = new THREE.Vector3(DOOR.x0 - 0.26, F + 1.85, Z1 + 0.16);
  {
    add('metal', box(lanternPos.x - 0.015, lanternPos.y + 0.12, Z1, lanternPos.x + 0.015, lanternPos.y + 0.15, lanternPos.z, 1));
    const cage: Geo[] = [];
    cage.push(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 8).translate(0, -0.11, 0));
    cage.push(new THREE.ConeGeometry(0.085, 0.07, 8).translate(0, 0.13, 0));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      cage.push(new THREE.BoxGeometry(0.01, 0.22, 0.01).translate(Math.cos(a) * 0.07, 0, Math.sin(a) * 0.07));
    }
    const cm = new THREE.Mesh(merge(cage), mats.metal);
    cm.position.copy(lanternPos);
    group.add(cm);
    const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.19, 8), lanternGlow);
    flame.position.copy(lanternPos);
    group.add(flame);
  }

  // ---- outside: bench, crates, barrel, basket of apples, firewood, trash bin, flowers ----
  {
    // bench on the porch, back to the wall
    const bx = -1.6, bz = Z1 + 0.42;
    add('wood', box(bx - 0.75, F + 0.42, bz - 0.2, bx + 0.75, F + 0.47, bz + 0.2, 1));
    add('wood', box(bx - 0.75, F + 0.55, bz - 0.25, bx + 0.75, F + 0.9, bz - 0.21, 1));
    for (const sx of [-0.68, 0.68]) for (const sz of [-0.16, 0.16]) add('darkWood', box(bx + sx - 0.03, F, bz + sz - 0.03, bx + sx + 0.03, F + 0.42, bz + sz + 0.03, 1));
    // barrel on the porch's right corner
    const barrel = new THREE.LatheGeometry([0, 1, 2, 3, 4, 5, 6].map((k) => new THREE.Vector2(0.24 + Math.sin((k / 6) * Math.PI) * 0.05, (k / 6) * 0.82)), 14);
    barrel.translate(X1 - 0.5, F, Z1 + 0.5);
    planarUV(barrel, 0.8);
    add('wood', barrel);
    for (const y of [0.12, 0.7]) add('metal', new THREE.TorusGeometry(0.27, 0.012, 6, 18).rotateX(Math.PI / 2).translate(X1 - 0.5, F + y, Z1 + 0.5));
    add('darkWood', new THREE.CylinderGeometry(0.235, 0.235, 0.02, 14).translate(X1 - 0.5, F + 0.81, Z1 + 0.5));
    // crates outside the right wall (two stacked, one beside)
    const crate = (x: number, y: number, z: number, yaw: number, apples: boolean) => {
      const g: Geo[] = [];
      for (let k = 0; k < 4; k++) g.push(box(-0.26, k * 0.075 + 0.01, -0.19, 0.26, k * 0.075 + 0.06, 0.19, 1));
      g.push(box(-0.26, 0, -0.19, -0.23, 0.3, 0.19, 1), box(0.23, 0, -0.19, 0.26, 0.3, 0.19, 1));
      const c = merge(g);
      c.rotateY(yaw); c.translate(x, y, z);
      add('wood', c);
      if (apples) {
        for (let k = 0; k < 14; k++) {
          const a = new THREE.SphereGeometry(0.045, 8, 6);
          a.translate((rand() - 0.5) * 0.4, 0.28 + rand() * 0.04, (rand() - 0.5) * 0.28);
          a.rotateY(yaw); a.translate(x, y, z);
          add('apple', a);
        }
      }
    };
    crate(X1 + 0.5, 0, 0.9, 0.1, false);
    crate(X1 + 0.5, 0.31, 0.92, -0.05, true);
    crate(X1 + 0.48, 0, 1.55, 0.2, false);
    // a basket with apples by the bench
    {
      const b = new THREE.CylinderGeometry(0.2, 0.15, 0.22, 14, 1, true);
      b.translate(-0.55, F + 0.11, Z1 + 0.35);
      planarUV(b, 0.3);
      add('basket', b);
      add('basket', new THREE.TorusGeometry(0.2, 0.015, 6, 16).rotateX(Math.PI / 2).translate(-0.55, F + 0.22, Z1 + 0.35));
      for (let k = 0; k < 9; k++) add('apple', new THREE.SphereGeometry(0.045, 8, 6).translate(-0.55 + (rand() - 0.5) * 0.24, F + 0.2 + rand() * 0.04, Z1 + 0.35 + (rand() - 0.5) * 0.24));
    }
    // firewood stacked along the left wall, under the eaves
    {
      const logs: Geo[] = [], ends: Geo[] = [];
      for (let row = 0; row < 5; row++) {
        for (let k = 0; k < 14; k++) {
          const r = 0.06 + rand() * 0.03;
          const z = -2.1 + k * 0.29 + (row % 2) * 0.14;
          if (z > 1.9) continue;
          const g = new THREE.CylinderGeometry(r, r, 0.5, 7, 1, true);
          g.rotateZ(Math.PI / 2);
          g.translate(X0 - 0.36 + (rand() - 0.5) * 0.04, 0.08 + row * 0.15, z);
          planarUV(g, 0.5);
          logs.push(g);
          for (const s of [-1, 1]) {
            const e = new THREE.CircleGeometry(r, 7);
            e.rotateY(s * Math.PI / 2);
            e.translate(X0 - 0.36 + s * 0.25, 0.08 + row * 0.15, z);
            ends.push(e);
          }
        }
      }
      add('bark', merge(logs));
      add('logEnd', merge(ends));
    }
    // a green trash bin beside the steps
    {
      const tb = box(-0.22, 0, -0.24, 0.22, 0.8, 0.24, 1);
      tb.translate(STEPS.x1 + 0.75, 0, PZ1 + 0.45);
      add('green', tb);
      add('green', box(STEPS.x1 + 0.49, 0.8, PZ1 + 0.18, STEPS.x1 + 1.01, 0.85, PZ1 + 0.72, 1)); // lid
    }
    // a hanging flower pot at the porch corner
    {
      const px = X0 + 0.45, pz = PZ1 - 0.25, py = F + H - 0.75;
      add('metal', box(px - 0.005, py + 0.18, pz - 0.005, px + 0.005, F + H - 0.18, pz + 0.005, 1));
      const pot = new THREE.CylinderGeometry(0.15, 0.1, 0.16, 12);
      pot.translate(px, py + 0.08, pz);
      add('trim', pot);
      const flowers: Geo[] = [];
      for (let k = 0; k < 16; k++) {
        const f = new THREE.IcosahedronGeometry(0.04, 0);
        f.translate(px + (rand() - 0.5) * 0.3, py + 0.17 + rand() * 0.08, pz + (rand() - 0.5) * 0.3);
        paint(f, rand() < 0.5 ? [0.92, 0.45, 0.66] : [0.98, 0.86, 0.9]);
        flowers.push(f);
      }
      const fm = new THREE.Mesh(merge(flowers), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
      group.add(fm);
    }
  }

  // ---- meshes, one per material ----
  for (const [key, list] of Object.entries(parts)) {
    const mesh = new THREE.Mesh(merge(list), mats[key as keyof typeof mats]);
    mesh.castShadow = key !== 'trim';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const gm = new THREE.Mesh(merge(glass), windowGlass);
  gm.renderOrder = 2;
  group.add(gm);
  return { group, door, windowGlass, lanternGlow, lanternPos };
}

/** the signpost where the footpath leaves the trail (world frame): a post and an arrow board along the footpath */
export function buildSignpost(S: StoreTextures, T0: Tex, x: number, y: number, z: number, towardStore: THREE.Vector2): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  // board along the footpath; its local -x points toward the shop
  g.rotation.y = Math.atan2(towardStore.y, -towardStore.x);
  const wood = new THREE.MeshStandardMaterial({ map: T0.wood, normalMap: T0.woodNormal, roughness: 0.9 });
  const post = new THREE.Mesh(box(-0.06, -0.3, -0.06, 0.06, 1.75, 0.06, 1), wood);
  post.castShadow = true;
  g.add(post);
  for (const [side, tex] of [[1, S.signpostL], [-1, S.signpostR]] as const) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    b.position.set(-0.32, 1.45, side * 0.03);
    if (side < 0) b.rotation.y = Math.PI;
    g.add(b);
  }
  const back = new THREE.Mesh(box(-0.83, 1.32, -0.025, 0.19, 1.58, 0.025, 1), wood);
  g.add(back);
  return g;
}

/** a flat vertex colour over the whole geometry */
function paint(g: Geo, [r, gg, b]: number[]): Geo {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export { PORCH };
