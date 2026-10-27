import * as THREE from 'three';
import { mulberry32 } from '../../utils/noise.js';
import { CELL, type StoreTextures } from './storeTextures.ts';
import { box, merge, place, boxItem, bag, can, jar, bottle, pack, lighter, planarUV, flat, type Geo } from './storeGeometry.ts';
import {
  F, IX0, IX1, IZ0, COUNTER, COUNTER_END, FRIDGES, LIQUOR, SHELF_LEFT, SHELF_BACK, GONDOLA, CIG_RACK, CRATES, DRINK_CRATES,
  LAMP_MAIN, LAMP_2, H, ERRAND,
} from './storeLayout.ts';

// Inside the shop: wooden shelves along the walls and a metal one in the
// middle, all full of goods (snacks, groceries, everyday things), two
// glass-door fridges glowing cool white with drinks, a shelf of liquor
// bottles behind the counter, the dark wooden counter with an old cash
// register, a calculator, a notebook and the small things people buy at
// the till (gum, chocolate, cigarettes, lighters), cartons and crates, a
// wall clock that keeps real time, a calendar and two hanging lamps.

export interface GoodsParts {
  group: THREE.Group;
  /** the clock's hands (turned every second) */
  clock: { hour: THREE.Object3D; minute: THREE.Object3D; second: THREE.Object3D };
  /** fridge light panels / their glow (dimmed far away) */
  fridgeLight: THREE.MeshStandardMaterial;
  lampGlow: THREE.MeshStandardMaterial;
  /** the errand's four things to buy (geometry, standing on y = 0) and the materials of shop / fridge goods */
  errand: { chips: Geo; puffs: Geo; yogurt: Geo; drink: Geo; goodsMat: THREE.MeshStandardMaterial; fridgeGoodsMat: THREE.MeshStandardMaterial };
}

type Item = { geo: Geo; w: number; d: number };

export function buildGoods(S: StoreTextures): GoodsParts {
  const group = new THREE.Group();
  const rand = mulberry32(731);
  const r = (a: number, b: number) => a + rand() * (b - a);
  const m = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
  const mats = {
    shelfWood: m({ map: S.boards, normalMap: S.boardsNormal, color: 0xb08a68, roughness: 0.75 }),
    counterWood: m({ map: S.siding, normalMap: S.sidingNormal, color: 0xa07a5c, roughness: 0.55 }),
    metal: m({ color: 0x8c9196, metalness: 0.6, roughness: 0.4 }),
    darkMetal: m({ color: 0x2b2d30, metalness: 0.5, roughness: 0.45 }),
    fridgeBody: m({ color: 0xe7e4dc, metalness: 0.15, roughness: 0.35 }),
    fridgeRed: m({ color: 0xb3261e, metalness: 0.2, roughness: 0.4 }),
    cardboard: m({ color: 0xb48a58, roughness: 0.95 }),
    crate: m({ color: 0x2f6fae, roughness: 0.6 }),
    brass: m({ color: 0xb08d3c, metalness: 0.85, roughness: 0.35 }),
    paper: m({ map: S.notebook, roughness: 0.9 }),
  };
  const goodsMat = new THREE.MeshStandardMaterial({ map: S.labels, roughness: 0.42, metalness: 0.0 });
  // things inside the fridges: lit by the fridge's own cool light
  const fridgeGoodsMat = new THREE.MeshStandardMaterial({ map: S.labels, roughness: 0.35, emissive: 0xcfe2ff, emissiveMap: S.labels, emissiveIntensity: 0.32 });
  const fridgeLight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdcebff, emissiveIntensity: 1.6 });
  const lampGlow = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc677, emissiveIntensity: 3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xc8dce6, roughness: 0.04, transparent: true, opacity: 0.16, envMapIntensity: 1.5, depthWrite: false });

  const parts: Record<string, Geo[]> = {};
  const add = (key: string, g: Geo) => (parts[key] ??= []).push(g);
  const goods: Geo[] = [], fridgeGoods: Geo[] = [];
  const Y = (y: number) => F + y; // heights above the floor

  // ---- the product range ----
  const it = (geo: Geo, w: number, d: number): Item => ({ geo, w, d });
  const P = {
    chips: [CELL.chipsSalt, CELL.chipsVinegar, CELL.chipsCheese].map((c) => it(bag(0.17, 0.25, 0.07, c), 0.17, 0.08)),
    puffs: [CELL.puffs, CELL.puffsBig].map((c) => it(bag(0.18, 0.27, 0.07, c), 0.18, 0.08)),
    smallBags: [CELL.candy, CELL.nuts, CELL.seeds].map((c) => it(bag(0.12, 0.17, 0.05, c), 0.12, 0.06)),
    rice: it(bag(0.2, 0.3, 0.1, CELL.rice), 0.2, 0.11),
    biscuits: [CELL.biscuit, CELL.biscuitChoc].map((c) => it(boxItem(0.21, 0.065, 0.06, c), 0.065, 0.21)),
    wafer: it(boxItem(0.06, 0.16, 0.035, CELL.wafer), 0.06, 0.04),
    cake: it(boxItem(0.09, 0.05, 0.09, CELL.cake), 0.09, 0.09),
    tea: it(boxItem(0.12, 0.17, 0.07, CELL.tea), 0.12, 0.08),
    pasta: it(boxItem(0.13, 0.22, 0.06, CELL.pasta), 0.13, 0.07),
    sugar: it(boxItem(0.17, 0.12, 0.1, CELL.sugar), 0.17, 0.11),
    tissue: it(boxItem(0.23, 0.09, 0.12, CELL.tissue), 0.23, 0.12),
    soap: it(boxItem(0.09, 0.035, 0.06, CELL.soap), 0.09, 0.065),
    matches: it(boxItem(0.11, 0.05, 0.07, CELL.matches), 0.11, 0.075),
    batteries: it(pack(0.07, 0.12, 0.02, CELL.batteries), 0.075, 0.03),
    flashlight: it(boxItem(0.08, 0.2, 0.06, CELL.flashlight), 0.085, 0.07),
    cans: [CELL.beans, CELL.tomatoPaste].map((c) => it(can(0.04, 0.11, c), 0.085, 0.085)),
    tuna: it(merge([can(0.045, 0.035, CELL.tuna), can(0.045, 0.035, CELL.tuna).translate(0, 0.036, 0), can(0.045, 0.035, CELL.tuna).translate(0, 0.072, 0)]), 0.095, 0.095),
    jars: [CELL.honey, CELL.jam, CELL.pickles, CELL.coffee].map((c) => it(jar(0.045, 0.13, c, c === CELL.pickles ? CELL.red : CELL.gold), 0.095, 0.095)),
    water: it(bottle({ h: 0.27, r: 0.034, glass: CELL.glassClear, label: CELL.water, cap: CELL.white, neck: 0.2 }), 0.075, 0.075),
    cola: it(bottle({ h: 0.31, r: 0.043, glass: CELL.glassBrown, label: CELL.cola, cap: CELL.red, neck: 0.22 }), 0.09, 0.09),
    orange: it(bottle({ h: 0.31, r: 0.043, glass: CELL.glassClear, label: CELL.orange, cap: CELL.gold, neck: 0.22 }), 0.09, 0.09),
    lemon: it(bottle({ h: 0.27, r: 0.038, glass: CELL.glassGreen, label: CELL.lemon, cap: CELL.silver, neck: 0.24 }), 0.08, 0.08),
    doogh: it(bottle({ h: 0.25, r: 0.04, glass: CELL.white, label: CELL.doogh, cap: CELL.glassGreen, neck: 0.18 }), 0.085, 0.085),
    beer: it(bottle({ h: 0.23, r: 0.03, glass: CELL.glassBrown, label: CELL.beer, cap: CELL.gold, neck: 0.32 }), 0.066, 0.066),
    beerGreen: it(bottle({ h: 0.23, r: 0.03, glass: CELL.glassGreen, label: CELL.beerDark, cap: CELL.silver, neck: 0.32 }), 0.066, 0.066),
    drinkCans: [CELL.energy, CELL.iceTea, CELL.cola].map((c) => it(can(0.033, 0.12, c), 0.07, 0.07)),
    juice: [CELL.juiceApple, CELL.juiceCherry, CELL.milk].map((c) => it(boxItem(0.07, 0.2, 0.07, c), 0.075, 0.075)),
    wine: it(bottle({ h: 0.31, r: 0.037, glass: CELL.glassGreen, label: CELL.wine, cap: CELL.red, neck: 0.38 }), 0.08, 0.08),
    vodka: it(bottle({ h: 0.3, r: 0.04, glass: CELL.glassClear, label: CELL.vodka, cap: CELL.silver, neck: 0.3, square: true }), 0.085, 0.085),
    whisky: it(bottle({ h: 0.26, r: 0.045, glass: CELL.glassBrown, label: CELL.whisky, cap: CELL.black, neck: 0.26, square: true }), 0.095, 0.095),
    liqueur: it(bottle({ h: 0.28, r: 0.04, glass: CELL.glassGreen, label: CELL.liqueur, cap: CELL.gold, neck: 0.3 }), 0.085, 0.085),
    chocolate: [CELL.chocolate, CELL.chocolateMilk, CELL.candyBar].map((c) => it(pack(0.06, 0.15, 0.014, c), 0.065, 0.02)),
  };

  // fill a shelf line: from `a` along `dir` for `len`, products facing `yaw`,
  // each product kind in a block of a few side by side (like a real shop)
  const fill = (a: THREE.Vector3, dir: THREE.Vector3, len: number, yaw: number, items: Item[], { rows = 1, deep = 0, out = goods, gap = 0.008, block = [3, 6] as [number, number], maxH = 9 } = {}) => {
    let s = 0.02;
    const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)); // toward the wall
    while (s < len - 0.05) {
      const item = items[Math.floor(rand() * items.length)];
      const n = Math.round(r(block[0], block[1]));
      for (let k = 0; k < n && s + item.w < len; k++) {
        for (let row = 0; row < rows; row++) {
          if (row > 0 && rand() < 0.25) continue; // a few gaps at the back
          const p = a.clone().addScaledVector(dir, s + item.w / 2).addScaledVector(back, row * (item.d + 0.005) + deep);
          const g = place(item.geo, p.x, p.y, p.z, yaw + r(-0.06, 0.06));
          const bb = (g.boundingBox ?? (g.computeBoundingBox(), g.boundingBox))!;
          if (bb.max.y - p.y > maxH) continue;
          out.push(g);
        }
        s += item.w + gap;
      }
      s += r(0.01, 0.03);
    }
  };

  // ---- shelf units ----
  const shelfLevels = (h: number, n: number) => Array.from({ length: n }, (_, k) => 0.1 + (k * (h - 0.25)) / (n - 1));
  // wooden wall shelf: open toward `open` (+x for the left wall, +z for the back wall)
  const woodShelf = (b: { x0: number; x1: number; z0: number; z1: number; h: number }, open: 'x' | 'z', levels: number[]) => {
    const t = 0.025;
    if (open === 'x') {
      add('shelfWood', box(b.x0, Y(0), b.z0, b.x0 + t, Y(b.h), b.z1, 1)); // back panel
      for (const z of [b.z0, b.z1 - t]) add('shelfWood', box(b.x0, Y(0), z, b.x1, Y(b.h), z + t, 1));
      for (const y of levels) add('shelfWood', box(b.x0, Y(y - t), b.z0, b.x1, Y(y), b.z1, 1));
      add('shelfWood', box(b.x0, Y(b.h - t), b.z0, b.x1, Y(b.h), b.z1, 1));
      add('shelfWood', box(b.x1 - 0.02, Y(0), b.z0, b.x1, Y(0.1), b.z1, 1)); // kick board
    } else {
      add('shelfWood', box(b.x0, Y(0), b.z0, b.x1, Y(b.h), b.z0 + t, 1));
      for (const x of [b.x0, b.x1 - t]) add('shelfWood', box(x, Y(0), b.z0, x + t, Y(b.h), b.z1, 1));
      for (const y of levels) add('shelfWood', box(b.x0, Y(y - t), b.z0, b.x1, Y(y), b.z1, 1));
      add('shelfWood', box(b.x0, Y(b.h - t), b.z0, b.x1, Y(b.h), b.z1, 1));
      add('shelfWood', box(b.x0, Y(0), b.z1 - 0.02, b.x1, Y(0.1), b.z1, 1));
    }
  };

  // left wall: snacks up high, groceries below
  {
    const b = SHELF_LEFT, lv = shelfLevels(b.h, 5);
    woodShelf(b, 'x', lv);
    const dir = new THREE.Vector3(0, 0, 1), len = b.z1 - b.z0, x = b.x1 - 0.06, yaw = Math.PI / 2;
    const at = (y: number) => new THREE.Vector3(x, Y(y), b.z0);
    const room = (k: number) => (k < lv.length - 1 ? lv[k + 1] - lv[k] - 0.035 : b.h - lv[k] - 0.04);
    fill(at(lv[0]), dir, len, yaw, [P.rice, P.sugar, P.pasta, P.tea], { maxH: room(0) });
    fill(at(lv[1]), dir, len, yaw, [...P.cans, P.tuna, ...P.jars], { rows: 2, maxH: room(1) });
    fill(at(lv[2]), dir, len, yaw, [...P.biscuits, P.wafer, P.cake, P.tea], { rows: 2, maxH: room(2) });
    fill(at(lv[3]), dir, len, yaw, [...P.chips, ...P.puffs], { maxH: room(3) });
    fill(at(lv[4]), dir, len, yaw, [P.tissue, P.soap, P.matches, ...P.smallBags], { maxH: room(4) });
  }
  // back wall (left of the fridges): everyday things and sweets
  {
    const b = SHELF_BACK, lv = shelfLevels(b.h, 5);
    woodShelf(b, 'z', lv);
    const dir = new THREE.Vector3(1, 0, 0), len = b.x1 - b.x0 - 0.06, z = b.z1 - 0.06;
    const at = (y: number) => new THREE.Vector3(b.x0 + 0.03, Y(y), z);
    const room = (k: number) => (k < lv.length - 1 ? lv[k + 1] - lv[k] - 0.035 : b.h - lv[k] - 0.04);
    fill(at(lv[0]), dir, len, 0, [P.sugar, P.tissue, P.rice], { maxH: room(0) });
    fill(at(lv[1]), dir, len, 0, [...P.jars, P.tuna], { rows: 2, maxH: room(1) });
    fill(at(lv[2]), dir, len, 0, [...P.smallBags, ...P.chips], { maxH: room(2) });
    fill(at(lv[3]), dir, len, 0, [P.batteries, P.flashlight, P.matches, P.soap], { maxH: room(3) });
    fill(at(lv[4]), dir, len, 0, [...P.puffs, P.pasta], { maxH: room(4) });
  }
  // metal shelf in the middle, two-sided
  {
    const g = GONDOLA, lv = [0.1, 0.45, 0.8, 1.15];
    const mx = (g.x0 + g.x1) / 2;
    add('metal', box(mx - 0.02, Y(0), g.z0, mx + 0.02, Y(g.h), g.z1, 1)); // spine
    for (const z of [g.z0, g.z1 - 0.03]) add('metal', box(g.x0, Y(0), z, g.x1, Y(g.h), z + 0.03, 1));
    for (const y of lv) add('metal', box(g.x0, Y(y - 0.02), g.z0, g.x1, Y(y), g.z1, 1));
    add('darkMetal', box(g.x0, Y(0), g.z0, g.x1, Y(0.1), g.z1, 1));
    const len = g.z1 - g.z0 - 0.06;
    for (const side of [1, -1]) {
      const x = side > 0 ? g.x1 - 0.05 : g.x0 + 0.05, yaw = side * Math.PI / 2;
      const a0 = (y: number) => new THREE.Vector3(x, Y(y), side > 0 ? g.z0 + 0.03 : g.z1 - 0.03);
      const dir = new THREE.Vector3(0, 0, side > 0 ? 1 : -1);
      const sets = side > 0
        ? [[...P.chocolate, P.wafer], [...P.biscuits, P.cake], [...P.smallBags, P.wafer], [...P.chips, ...P.puffs]]
        : [[...P.cans, P.tuna], [P.tea, P.pasta, P.sugar], [...P.jars], [...P.chips]];
      lv.forEach((y, k) => {
        const opts = { maxH: k < lv.length - 1 ? lv[k + 1] - y - 0.03 : 0.3 };
        // the top shelf on the door side keeps a gap for the errand's chips and puffs
        if (side > 0 && k === lv.length - 1) {
          const [g0, g1] = ERRAND.gondolaGap, start = a0(y).z;
          fill(a0(y), dir, g0 - start, yaw, sets[k], opts);
          fill(a0(y).setZ(g1), dir, g.z1 - 0.03 - g1, yaw, sets[k], opts);
        } else fill(a0(y), dir, len, yaw, sets[k], opts);
      });
    }
  }
  // the liquor shelf behind the counter
  {
    const b = LIQUOR, lv = [0.9, 1.3, 1.7];
    woodShelf({ ...b, h: b.h }, 'z', lv);
    add('shelfWood', box(b.x0, Y(0), b.z0, b.x1, Y(0.88), b.z1, 1)); // closed cupboard below
    const dir = new THREE.Vector3(1, 0, 0), len = b.x1 - b.x0 - 0.06;
    lv.forEach((y, k) => fill(new THREE.Vector3(b.x0 + 0.03, Y(y), b.z1 - 0.07), dir, len, 0,
      k === 0 ? [P.wine, P.liqueur] : k === 1 ? [P.vodka, P.whisky] : [P.whisky, P.wine, P.liqueur], { block: [2, 4], gap: 0.012, maxH: 0.36 }));
  }

  // ---- fridges: a lit cabinet with glass doors and drinks on wire shelves ----
  FRIDGES.forEach((f, i) => {
    const w = f.x1 - f.x0, d = f.z1 - f.z0;
    // the cabinet: back, sides, top and a base, open at the front behind the glass
    const shell = i === 0 ? 'fridgeRed' : 'fridgeBody';
    add(shell, box(f.x0, Y(0), f.z0, f.x1, Y(f.h), f.z0 + 0.03, 1));
    add(shell, box(f.x0, Y(0), f.z0, f.x0 + 0.04, Y(f.h), f.z1 - 0.02, 1));
    add(shell, box(f.x1 - 0.04, Y(0), f.z0, f.x1, Y(f.h), f.z1 - 0.02, 1));
    add(shell, box(f.x0, Y(f.h - 0.05), f.z0, f.x1, Y(f.h), f.z1 - 0.02, 1));
    add(shell, box(f.x0, Y(0), f.z0, f.x1, Y(0.1), f.z1 - 0.02, 1));
    add('darkMetal', box(f.x0 + 0.03, Y(f.h - 0.22), f.z1 - 0.025, f.x1 - 0.03, Y(f.h - 0.05), f.z1 - 0.01, 1)); // header
    // the inside: light panel at the back and on top, wire shelves
    add('fridgeLight', box(f.x0 + 0.05, Y(0.12), f.z0 + 0.03, f.x1 - 0.05, Y(f.h - 0.26), f.z0 + 0.04, 1));
    add('fridgeLight', box(f.x0 + 0.05, Y(f.h - 0.27), f.z0 + 0.05, f.x1 - 0.05, Y(f.h - 0.25), f.z1 - 0.08, 1));
    const lv = [0.12, 0.47, 0.82, 1.17, 1.5];
    for (const y of lv) add('metal', box(f.x0 + 0.04, Y(y - 0.012), f.z0 + 0.05, f.x1 - 0.04, Y(y), f.z1 - 0.08, 1));
    const sets = i === 0
      ? [[P.water], [P.cola, P.orange], [P.lemon, P.doogh], [...P.drinkCans], [...P.juice]]
      : [[P.beer, P.beerGreen], [P.beer], [...P.drinkCans], [P.beerGreen, P.water], [...P.juice]];
    lv.forEach((y, k) => {
      const opts = { rows: 3, out: fridgeGoods, block: [2, 5] as [number, number], maxH: k < lv.length - 1 ? lv[k + 1] - y - 0.02 : 0.3 };
      const a = new THREE.Vector3(f.x0 + 0.06, Y(y), f.z1 - 0.12), dir = new THREE.Vector3(1, 0, 0);
      // a gap in the middle of the errand's shelf (the yogurt / the drink go there)
      if (k === ERRAND.fridgeLevel) {
        const [g0, g1] = ERRAND.fridgeGap[i];
        fill(a, dir, g0 - a.x, 0, sets[k], opts);
        fill(a.clone().setX(g1), dir, f.x1 - 0.06 - g1, 0, sets[k], opts);
      } else fill(a, dir, w - 0.12, 0, sets[k], opts);
    });
    // glass door with a frame and a long handle
    const door = new THREE.PlaneGeometry(w - 0.08, f.h - 0.32);
    door.translate((f.x0 + f.x1) / 2, Y(0.1 + (f.h - 0.32) / 2), f.z1 - 0.012);
    add('glass', door);
    add('darkMetal', box(f.x0 + 0.02, Y(0.06), f.z1 - 0.02, f.x1 - 0.02, Y(0.1), f.z1, 1));
    add('darkMetal', box(f.x0 + 0.02, Y(f.h - 0.24), f.z1 - 0.02, f.x1 - 0.02, Y(f.h - 0.2), f.z1, 1));
    for (const x of [f.x0 + 0.02, f.x1 - 0.06]) add('darkMetal', box(x, Y(0.06), f.z1 - 0.02, x + 0.04, Y(f.h - 0.2), f.z1, 1));
    add('metal', box(f.x1 - 0.12, Y(0.7), f.z1, f.x1 - 0.1, Y(1.4), f.z1 + 0.035, 1));
    void d;
  });

  // ---- the counter ----
  {
    const c = COUNTER;
    // body with panels and drawers on the customer's side (-x)
    add('counterWood', box(c.x0 + 0.03, Y(0), c.z0, c.x1, Y(c.h - 0.05), c.z1, 1.2));
    add('counterWood', box(c.x0 - 0.04, Y(c.h - 0.05), c.z0 - 0.04, c.x1 + 0.04, Y(c.h), c.z1 + 0.04, 1.2)); // top
    add('shelfWood', box(c.x0 + 0.01, Y(0), c.z0, c.x0 + 0.04, Y(0.08), c.z1, 1)); // kick
    const panels = 4, pl = (c.z1 - c.z0) / panels;
    for (let k = 0; k < panels; k++) {
      const z0 = c.z0 + k * pl + 0.06, z1 = c.z0 + (k + 1) * pl - 0.06;
      add('shelfWood', box(c.x0, Y(0.15), z0, c.x0 + 0.03, Y(0.6), z1, 1));
      add('shelfWood', box(c.x0, Y(0.66), z0, c.x0 + 0.03, Y(0.84), z1, 1)); // drawer
      add('brass', box(c.x0 - 0.02, Y(0.73), (z0 + z1) / 2 - 0.04, c.x0, Y(0.77), (z0 + z1) / 2 + 0.04, 1));
    }
    const e = COUNTER_END;
    add('counterWood', box(e.x0, Y(0), e.z0, e.x1, Y(e.h - 0.04), e.z1, 1.2));
    add('counterWood', box(e.x0 - 0.02, Y(e.h - 0.04), e.z0 - 0.02, e.x1, Y(e.h), e.z1 + 0.02, 1.2));
    fill(new THREE.Vector3(e.x0 + 0.04, Y(e.h), e.z1 - 0.08), new THREE.Vector3(1, 0, 0), e.x1 - e.x0 - 0.08, 0, [...P.chips], { block: [2, 3] }); // facing the door
    const top = Y(c.h);
    // an old cash register at the back end, facing the customer
    {
      const x = c.x0 + 0.3, z = c.z0 + 0.35;
      const reg: Geo[] = [
        box(x - 0.22, top, z - 0.2, x + 0.2, top + 0.12, z + 0.2, 1), // drawer base
        box(x - 0.16, top + 0.12, z - 0.18, x + 0.2, top + 0.3, z + 0.18, 1), // body
        box(x - 0.02, top + 0.3, z - 0.14, x + 0.14, top + 0.42, z + 0.14, 1), // display hood
      ];
      add('brass', merge(reg));
      const keys = box(x - 0.2, top + 0.12, z - 0.17, x - 0.12, top + 0.2, z + 0.17, 1);
      add('darkMetal', keys);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) add('shelfWood', box(x - 0.19 + i * 0.018, top + 0.2, z - 0.15 + j * 0.05, x - 0.18 + i * 0.018, top + 0.215, z - 0.12 + j * 0.05, 1));
      const disp = new THREE.PlaneGeometry(0.22, 0.08);
      disp.rotateY(-Math.PI / 2);
      disp.translate(x - 0.025, top + 0.36, z);
      add('fridgeLight', disp);
    }
    // calculator, an open notebook with a pen
    {
      const calc = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.018, 0.15), [mats.darkMetal, mats.darkMetal, new THREE.MeshStandardMaterial({ map: S.calculator, roughness: 0.6 }), mats.darkMetal, mats.darkMetal, mats.darkMetal]);
      calc.position.set(c.x0 + 0.3, top + 0.009, c.z0 + 1.05);
      calc.rotation.y = -Math.PI / 2 + 0.2;
      group.add(calc);
      const nb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.21), [mats.cardboard, mats.cardboard, mats.paper, mats.cardboard, mats.cardboard, mats.cardboard]);
      nb.position.set(c.x0 + 0.33, top + 0.006, c.z0 + 1.55);
      nb.rotation.y = Math.PI / 2 + 0.08;
      group.add(nb);
      const pen = new THREE.CylinderGeometry(0.004, 0.004, 0.14, 6);
      pen.rotateZ(Math.PI / 2);
      pen.rotateY(0.6);
      pen.translate(c.x0 + 0.3, top + 0.016, c.z0 + 1.45);
      add('darkMetal', pen);
    }
    // gum, chocolate and mints in an open box near the customer, cigarettes, lighters in a cup, a candy jar
    {
      const z = c.z1 - 0.32, x = c.x0 + 0.18;
      add('shelfWood', box(x - 0.13, top, z - 0.17, x + 0.13, top + 0.06, z + 0.17, 1));
      const small = [CELL.gumPack, CELL.mints, CELL.gum, CELL.gumMint];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) {
        const p = pack(0.045, 0.02, 0.065, small[(i + j) % small.length]);
        goods.push(place(p, x - 0.09 + i * 0.06, top + 0.06, z - 0.13 + j * 0.065, Math.PI / 2 + r(-0.1, 0.1)));
      }
      for (let k = 0; k < 8; k++) {
        const bar = pack(0.12, 0.012, 0.035, [CELL.candyBar, CELL.chocolate, CELL.chocolateMilk][k % 3]);
        goods.push(place(bar, c.x0 + 0.17, top + k * 0.013, c.z1 - 0.62, Math.PI / 2 + r(-0.15, 0.15)));
      }
      const cigs = [CELL.cigRed, CELL.cigBlue, CELL.cigGold, CELL.cigWhite];
      for (let s = 0; s < 3; s++) for (let k = 0; k < 4; k++) {
        const pk = pack(0.085, 0.022, 0.055, cigs[s % 4]);
        goods.push(place(pk, c.x0 + 0.45, top + k * 0.023, c.z0 + 0.82 + s * 0.08, Math.PI / 2 + r(-0.08, 0.08)));
      }
      // lighters in a cup
      const cup = new THREE.CylinderGeometry(0.05, 0.045, 0.08, 12, 1, true);
      cup.translate(c.x0 + 0.17, top + 0.04, c.z1 - 0.85);
      add('darkMetal', cup);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const l = lighter([CELL.red, CELL.glassGreen, CELL.gold, CELL.black, CELL.lighter][k % 5]);
        l.rotateX(r(-0.25, 0.25)); l.rotateZ(r(-0.25, 0.25));
        goods.push(place(l, c.x0 + 0.17 + Math.cos(a) * 0.025, top + 0.02, c.z1 - 0.85 + Math.sin(a) * 0.025));
      }
      goods.push(place(jar(0.07, 0.2, CELL.candy, CELL.red), c.x0 + 0.2, top, c.z1 - 0.12));
    }
  }

  // ---- the cigarette rack behind the counter ----
  {
    const k = CIG_RACK;
    add('shelfWood', box(k.x - 0.02, Y(k.y0), k.z0, k.x, Y(k.y1), k.z1, 1)); // back board
    for (const z of [k.z0, k.z1 - 0.02]) add('shelfWood', box(k.x - 0.2, Y(k.y0), z, k.x, Y(k.y1), z + 0.02, 1));
    add('shelfWood', box(k.x - 0.2, Y(k.y1 - 0.02), k.z0, k.x, Y(k.y1), k.z1, 1));
    const rows = 4, cigs = [CELL.cigRed, CELL.cigBlue, CELL.cigGold, CELL.cigWhite];
    for (let i = 0; i < rows; i++) {
      const y = k.y0 + 0.04 + (i * (k.y1 - k.y0 - 0.06)) / rows;
      add('shelfWood', box(k.x - 0.2, Y(y - 0.012), k.z0, k.x - 0.02, Y(y), k.z1, 1));
      for (let j = 0; j < 13; j++) {
        const p = pack(0.055, 0.085, 0.022, cigs[(i + Math.floor(j / 3)) % 4]);
        goods.push(place(p, k.x - 0.12, Y(y), k.z0 + 0.06 + j * 0.088, -Math.PI / 2));
      }
    }
  }

  // ---- cartons and drink crates ----
  {
    const carton = (x: number, y: number, z: number, w: number, h: number, d: number, yaw: number) => {
      const g = box(-w / 2, 0, -d / 2, w / 2, h, d / 2, 1);
      g.rotateY(yaw);
      g.translate(x, y, z);
      add('cardboard', g);
      const tape = box(-w / 2 - 0.002, h - 0.002, -0.03, w / 2 + 0.002, h + 0.003, 0.03, 1);
      tape.rotateY(yaw); tape.translate(x, y, z);
      add('shelfWood', tape);
    };
    const cb = CRATES;
    carton((cb.x0 + cb.x1) / 2, Y(0), (cb.z0 + cb.z1) / 2, 0.55, 0.38, 0.42, 0.05);
    carton((cb.x0 + cb.x1) / 2 + 0.02, Y(0.38), (cb.z0 + cb.z1) / 2, 0.48, 0.3, 0.38, -0.1);
    carton(IX1 - 0.32, Y(0), COUNTER_END.z0 - 0.35, 0.45, 0.32, 0.4, 0.2); // behind the counter
    carton(GONDOLA.x0 - 0.3, Y(0), GONDOLA.z0 - 0.4, 0.4, 0.28, 0.35, 0.4);
    // plastic drink crates with bottles, stacked by the fridges
    const dc = DRINK_CRATES;
    for (let k = 0; k < 2; k++) {
      const y = Y(k * 0.3), x = (dc.x0 + dc.x1) / 2, z = dc.z0 + 0.36;
      const crate: Geo[] = [box(x - 0.16, y, z - 0.3, x + 0.16, y + 0.03, z + 0.3, 1)];
      for (const sx of [-1, 1]) crate.push(box(x + sx * 0.16 - 0.015, y, z - 0.3, x + sx * 0.16 + 0.015, y + 0.28, z + 0.3, 1));
      for (const sz of [-1, 1]) crate.push(box(x - 0.16, y, z + sz * 0.3 - 0.015, x + 0.16, y + 0.28, z + sz * 0.3 + 0.015, 1));
      add('crate', merge(crate));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) goods.push(place((k ? P.cola : P.beer).geo, x - 0.1 + i * 0.1, y + 0.03, z - 0.25 + j * 0.1));
    }
  }

  // ---- a wall clock (real time), a calendar, hanging lamps ----
  const clockGroup = new THREE.Group();
  {
    clockGroup.position.set(-1.25, Y(2.3), IZ0 + 0.03);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), new THREE.MeshStandardMaterial({ map: S.clockFace, roughness: 0.5 }));
    face.position.z = 0.01;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.018, 8, 32), mats.counterWood);
    rim.position.z = 0.015;
    clockGroup.add(face, rim);
    group.add(clockGroup);
  }
  const hand = (len: number, w: number, z: number, mat: THREE.Material) => {
    const pivot = new THREE.Object3D();
    const g = new THREE.BoxGeometry(w, len, 0.004);
    g.translate(0, len / 2 - 0.02, 0);
    pivot.add(new THREE.Mesh(g, mat));
    pivot.position.z = z;
    clockGroup.add(pivot);
    return pivot;
  };
  const clock = { hour: hand(0.09, 0.012, 0.022, mats.darkMetal), minute: hand(0.135, 0.008, 0.026, mats.darkMetal), second: hand(0.145, 0.003, 0.03, mats.fridgeRed) };
  {
    const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.45), new THREE.MeshStandardMaterial({ map: S.calendar, roughness: 0.85 }));
    cal.position.set(IX1 - 0.005, Y(1.55), -1.15);
    cal.rotation.y = -Math.PI / 2;
    group.add(cal);
    // a framed old photo and a coat hook by the door
    add('counterWood', box(IX0 + 0.005, Y(2.05), 1.35, IX0 + 0.03, Y(2.4), 1.8, 1));
    add('brass', box(IX1 - 0.03, Y(1.75), 1.95, IX1, Y(1.78), 2.05, 1));
  }
  for (const L of [LAMP_MAIN, LAMP_2]) {
    const shade = new THREE.ConeGeometry(0.22, 0.17, 20, 1, true);
    shade.translate(L.x, Y(L.y + 0.085), L.z);
    add('fridgeRed', shade);
    const cord = box(L.x - 0.006, Y(L.y + 0.17), L.z - 0.006, L.x + 0.006, Y(H), L.z + 0.006, 1);
    add('darkMetal', cord);
    const bulb = new THREE.SphereGeometry(0.06, 12, 10);
    bulb.translate(L.x, Y(L.y + 0.02), L.z);
    add('lampGlow', bulb);
  }

  // ---- meshes ----
  const matFor: Record<string, THREE.Material> = { ...mats, glass, fridgeLight, lampGlow };
  for (const [key, list] of Object.entries(parts)) {
    const mesh = new THREE.Mesh(merge(list), matFor[key]);
    mesh.castShadow = key !== 'glass' && key !== 'fridgeLight' && key !== 'lampGlow';
    mesh.receiveShadow = true;
    if (key === 'glass') mesh.renderOrder = 2;
    group.add(mesh);
  }
  const gm = new THREE.Mesh(merge(goods), goodsMat);
  gm.receiveShadow = true;
  group.add(gm);
  group.add(new THREE.Mesh(merge(fridgeGoods), fridgeGoodsMat));
  void planarUV; void flat; void IX0;
  const errand = {
    chips: P.chips[2].geo, puffs: P.puffs[0].geo, drink: P.cola.geo,
    yogurt: can(0.052, 0.085, CELL.milk), // a tub with a foil lid
    goodsMat, fridgeGoodsMat,
  };
  return { group, clock, fridgeLight, lampGlow, errand };
}
