import * as THREE from 'three';
import { makeCanvas, toTexture, tileNoise, fbmTile, fbmTile2, normalFromHeight, heightFromCanvas } from '../world/textures.js';
import { mulberry32 } from '../../utils/noise.js';

// Everything the shop is painted with, drawn once on canvases: weathered
// plank siding, the honey-coloured boards inside, worn floorboards, a
// corrugated roof, the carved sign, and the label atlas for the goods
// (made-up products with Persian names - no real brands).

export interface StoreTextures {
  siding: THREE.Texture; sidingNormal: THREE.Texture;
  boards: THREE.Texture; boardsNormal: THREE.Texture;
  floor: THREE.Texture; floorNormal: THREE.Texture;
  roof: THREE.Texture; roofNormal: THREE.Texture;
  sign: THREE.Texture;
  /** the signpost board: arrow pointing left (front) / right (back) */
  signpostL: THREE.Texture;
  signpostR: THREE.Texture;
  /** the little "open" card hanging on the door */
  openSign: THREE.Texture;
  labels: THREE.Texture;
  calendar: THREE.Texture;
  clockFace: THREE.Texture;
  calculator: THREE.Texture;
  notebook: THREE.Texture;
}

type Ctx = CanvasRenderingContext2D;
const faNum = (n: number) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
const FONT = 'Vazirmatn, Tahoma, sans-serif';

// grey-scale-ish wood painted in colour: planks along x (horizontal) or y
function planks(S: number, { count, base, vertical, seed, gap = 0.012, wear = 0.3 }: { count: number; base: [number, number, number]; vertical: boolean; seed: number; gap?: number; wear?: number }) {
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const n = tileNoise(seed);
  const rand = mulberry32(seed);
  const tone = Array.from({ length: count }, () => 0.82 + rand() * 0.3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const along = vertical ? v : u, across = vertical ? u : v;
      const k = Math.floor(across * count);
      const f = across * count - k;
      const grain = fbmTile2(n, vertical ? across * 3 : along, vertical ? along : across * 3, vertical ? 3 : 2, vertical ? 2 : 3, 3);
      const fine = fbmTile2(n, vertical ? u * 40 : u * 1.5, vertical ? v * 1.5 : v * 40, vertical ? 40 : 2, vertical ? 2 : 40, 2);
      const knot = Math.max(0, 1 - Math.hypot(((along * 3 + k * 0.37) % 1) - 0.5, (f - 0.5) * 0.5) * 9) * (k % 3 === 0 ? 1 : 0);
      let l = tone[k] * (0.78 + grain * 0.3 + (fine - 0.5) * 0.18) - knot * 0.35;
      const edge = Math.min(f, 1 - f);
      if (edge < gap * count) l *= 0.35; // dark gap between boards
      l *= 1 - wear * Math.max(0, fbmTile(n, u * 2 + 5, v * 2, 4, 3) - 0.55);
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, base[0] * l);
      img.data[i + 1] = Math.min(255, base[1] * l);
      img.data[i + 2] = Math.min(255, base[2] * l);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function pair(c: HTMLCanvasElement, strength: number) {
  return { map: toTexture(c), normal: toTexture(normalFromHeight(heightFromCanvas(c), c.width, c.height, strength), { srgb: false }) };
}

// ---- label atlas ----------------------------------------------------------
// 8 x 8 cells; the last row is flat colours (glass, caps, cardboard...).
export const ATLAS = 8;
export const CELL = {
  // snacks
  chipsSalt: 0, chipsVinegar: 1, chipsCheese: 2, puffs: 3, puffsBig: 4, biscuit: 5, biscuitChoc: 6, wafer: 7,
  chocolate: 8, chocolateMilk: 9, candy: 10, gum: 11, gumMint: 12, nuts: 13, seeds: 14, cake: 15,
  // groceries
  beans: 16, tuna: 17, tomatoPaste: 18, pasta: 19, rice: 20, tea: 21, sugar: 22, matches: 23,
  soap: 24, tissue: 25, batteries: 26, flashlight: 27, honey: 28, jam: 29, pickles: 30, coffee: 31,
  // drinks
  water: 32, cola: 33, orange: 34, lemon: 35, juiceApple: 36, juiceCherry: 37, doogh: 38, energy: 39,
  beer: 40, beerDark: 41, wine: 42, vodka: 43, whisky: 44, liqueur: 45, milk: 46, iceTea: 47,
  // small things at the counter
  cigRed: 48, cigBlue: 49, cigGold: 50, cigWhite: 51, lighter: 52, gumPack: 53, mints: 54, candyBar: 55,
  // flat colours
  white: 56, black: 57, gold: 58, silver: 59, red: 60, glassGreen: 61, glassBrown: 62, glassClear: 63,
} as const;

interface Label { fa: string; sub?: string; bg: string; bg2?: string; fg: string; style: 'bag' | 'box' | 'can' | 'bottle' | 'jar' | 'pack' | 'flat' }
const L: Record<number, Label> = {
  [CELL.chipsSalt]: { fa: 'چیپس', sub: 'ساده', bg: '#f2c230', bg2: '#e0761e', fg: '#7a1c0c', style: 'bag' },
  [CELL.chipsVinegar]: { fa: 'چیپس', sub: 'سرکه‌ای', bg: '#3f9a4b', bg2: '#1f5e2c', fg: '#fff6c8', style: 'bag' },
  [CELL.chipsCheese]: { fa: 'چیپس', sub: 'پنیری', bg: '#f5d74a', bg2: '#e5a116', fg: '#1c3d8f', style: 'bag' },
  [CELL.puffs]: { fa: 'پفک', sub: 'نمکی', bg: '#f08a24', bg2: '#d4471c', fg: '#ffffff', style: 'bag' },
  [CELL.puffsBig]: { fa: 'پفک', sub: 'بزرگ', bg: '#e8473b', bg2: '#a3201e', fg: '#ffe46a', style: 'bag' },
  [CELL.biscuit]: { fa: 'بیسکویت', sub: 'ساقه‌طلایی', bg: '#2d63b8', bg2: '#173a78', fg: '#ffe9a8', style: 'box' },
  [CELL.biscuitChoc]: { fa: 'بیسکویت', sub: 'کاکائویی', bg: '#5a3220', bg2: '#2f190f', fg: '#f6d9a0', style: 'box' },
  [CELL.wafer]: { fa: 'ویفر', sub: 'فندقی', bg: '#c7362e', bg2: '#7c1915', fg: '#ffffff', style: 'pack' },
  [CELL.chocolate]: { fa: 'شکلات', sub: 'تلخ', bg: '#3a1f14', bg2: '#1c0e08', fg: '#e8c27a', style: 'pack' },
  [CELL.chocolateMilk]: { fa: 'شکلات', sub: 'شیری', bg: '#6b3b23', bg2: '#3e1f10', fg: '#ffffff', style: 'pack' },
  [CELL.candy]: { fa: 'آبنبات', sub: 'میوه‌ای', bg: '#e74c8c', bg2: '#8f2b8a', fg: '#ffffff', style: 'bag' },
  [CELL.gum]: { fa: 'آدامس', sub: 'نعنا', bg: '#29a5c9', bg2: '#16698a', fg: '#ffffff', style: 'pack' },
  [CELL.gumMint]: { fa: 'آدامس', sub: 'دارچین', bg: '#d6452b', bg2: '#8e2414', fg: '#fff2c4', style: 'pack' },
  [CELL.nuts]: { fa: 'آجیل', sub: 'مخلوط', bg: '#b7884a', bg2: '#6b4a20', fg: '#ffffff', style: 'bag' },
  [CELL.seeds]: { fa: 'تخمه', sub: 'آفتابگردان', bg: '#f4d03f', bg2: '#2b2b2b', fg: '#2b2b2b', style: 'bag' },
  [CELL.cake]: { fa: 'کیک', sub: 'یزدی', bg: '#f7e1b5', bg2: '#d9a05b', fg: '#7a3b12', style: 'pack' },
  [CELL.beans]: { fa: 'لوبیا', sub: 'کنسرو', bg: '#b23a2b', bg2: '#5e1c12', fg: '#fff3d6', style: 'can' },
  [CELL.tuna]: { fa: 'تن ماهی', bg: '#1f4f8c', bg2: '#0f2a4d', fg: '#ffd85a', style: 'can' },
  [CELL.tomatoPaste]: { fa: 'رب گوجه', bg: '#d23224', bg2: '#7d1710', fg: '#ffffff', style: 'can' },
  [CELL.pasta]: { fa: 'ماکارونی', bg: '#f3c33d', bg2: '#2a5aa8', fg: '#1d2f66', style: 'box' },
  [CELL.rice]: { fa: 'برنج', sub: 'ایرانی', bg: '#f2ede0', bg2: '#3c8a43', fg: '#2b5d2f', style: 'bag' },
  [CELL.tea]: { fa: 'چای', sub: 'سیاه', bg: '#2b6b3c', bg2: '#123a1e', fg: '#f3d27a', style: 'box' },
  [CELL.sugar]: { fa: 'قند', bg: '#ffffff', bg2: '#4b86c9', fg: '#1d4d85', style: 'box' },
  [CELL.matches]: { fa: 'کبریت', bg: '#c9a36a', bg2: '#7b2f1a', fg: '#2a1408', style: 'box' },
  [CELL.soap]: { fa: 'صابون', bg: '#9fd3e8', bg2: '#4a99bd', fg: '#ffffff', style: 'box' },
  [CELL.tissue]: { fa: 'دستمال', bg: '#f6f6f2', bg2: '#e58bb0', fg: '#8c2e59', style: 'box' },
  [CELL.batteries]: { fa: 'باتری', bg: '#1d1d1f', bg2: '#d8a12c', fg: '#ffd257', style: 'pack' },
  [CELL.flashlight]: { fa: 'چراغ‌قوه', bg: '#2e3b47', bg2: '#f0a32a', fg: '#ffffff', style: 'box' },
  [CELL.honey]: { fa: 'عسل', bg: '#e8a524', bg2: '#9a5a0c', fg: '#3b1f04', style: 'jar' },
  [CELL.jam]: { fa: 'مربا', sub: 'آلبالو', bg: '#9b1d2a', bg2: '#530c14', fg: '#ffe4e6', style: 'jar' },
  [CELL.pickles]: { fa: 'خیارشور', bg: '#6c8a2b', bg2: '#334716', fg: '#f5f1d0', style: 'jar' },
  [CELL.coffee]: { fa: 'قهوه', bg: '#4a2a17', bg2: '#21120a', fg: '#e9d0a8', style: 'jar' },
  [CELL.water]: { fa: 'آب معدنی', sub: 'چشمه', bg: '#e8f4fb', bg2: '#3d8ed1', fg: '#1b5c96', style: 'bottle' },
  [CELL.cola]: { fa: 'نوشابه', sub: 'کولا', bg: '#b3121b', bg2: '#5c070c', fg: '#ffffff', style: 'bottle' },
  [CELL.orange]: { fa: 'نوشابه', sub: 'پرتقالی', bg: '#f5891f', bg2: '#c4500f', fg: '#ffffff', style: 'bottle' },
  [CELL.lemon]: { fa: 'لیموناد', bg: '#d9e64a', bg2: '#5e9b2a', fg: '#26420f', style: 'bottle' },
  [CELL.juiceApple]: { fa: 'آبمیوه', sub: 'سیب', bg: '#9bc93b', bg2: '#d7342c', fg: '#ffffff', style: 'box' },
  [CELL.juiceCherry]: { fa: 'آبمیوه', sub: 'آلبالو', bg: '#7d1028', bg2: '#3d0612', fg: '#ffd9e1', style: 'box' },
  [CELL.doogh]: { fa: 'دوغ', bg: '#f4f7f2', bg2: '#2f8f4f', fg: '#1c6236', style: 'bottle' },
  [CELL.energy]: { fa: 'انرژی‌زا', bg: '#1b1b1f', bg2: '#33c4e8', fg: '#c8f531', style: 'can' },
  [CELL.beer]: { fa: 'آبجو', bg: '#e3c46b', bg2: '#1f5130', fg: '#1f2c18', style: 'bottle' },
  [CELL.beerDark]: { fa: 'آبجو', sub: 'تیره', bg: '#2a1a12', bg2: '#c9a24a', fg: '#e9cf8a', style: 'bottle' },
  [CELL.wine]: { fa: 'شراب', sub: 'قرمز', bg: '#f2e8d8', bg2: '#6b1022', fg: '#5a0c1a', style: 'bottle' },
  [CELL.vodka]: { fa: 'ودکا', bg: '#e9eef2', bg2: '#2e5c9a', fg: '#1e3c66', style: 'bottle' },
  [CELL.whisky]: { fa: 'ویسکی', bg: '#2a1a10', bg2: '#c88a2c', fg: '#e7c27a', style: 'bottle' },
  [CELL.liqueur]: { fa: 'لیکور', sub: 'نعنا', bg: '#e9f5ec', bg2: '#2a9a62', fg: '#145233', style: 'bottle' },
  [CELL.milk]: { fa: 'شیر', bg: '#ffffff', bg2: '#3c7fd0', fg: '#1d4f91', style: 'box' },
  [CELL.iceTea]: { fa: 'چای سرد', sub: 'لیمو', bg: '#f0b63a', bg2: '#7a4a12', fg: '#3a1e05', style: 'can' },
  [CELL.cigRed]: { fa: 'سیگار', sub: 'قرمز', bg: '#ffffff', bg2: '#c4161c', fg: '#c4161c', style: 'pack' },
  [CELL.cigBlue]: { fa: 'سیگار', sub: 'آبی', bg: '#ffffff', bg2: '#1f4fa0', fg: '#1f4fa0', style: 'pack' },
  [CELL.cigGold]: { fa: 'سیگار', sub: 'طلایی', bg: '#f3e6c6', bg2: '#b8862c', fg: '#6b4a10', style: 'pack' },
  [CELL.cigWhite]: { fa: 'سیگار', sub: 'سبک', bg: '#f4f4f4', bg2: '#8a8a8a', fg: '#4a4a4a', style: 'pack' },
  [CELL.lighter]: { fa: '', bg: '#e23b3b', bg2: '#ffcc33', fg: '#ffffff', style: 'flat' },
  [CELL.gumPack]: { fa: 'آدامس', bg: '#7ed957', bg2: '#2f8a2a', fg: '#ffffff', style: 'pack' },
  [CELL.mints]: { fa: 'نعنا', bg: '#dff3ff', bg2: '#5aa6d6', fg: '#1d5b85', style: 'pack' },
  [CELL.candyBar]: { fa: 'کاکائو', sub: 'بار', bg: '#5b2a86', bg2: '#2f1247', fg: '#ffd84d', style: 'pack' },
};
const FLAT: Record<number, string> = {
  [CELL.white]: '#f2f0ea', [CELL.black]: '#18181a', [CELL.gold]: '#c8a046', [CELL.silver]: '#b9bcc0', [CELL.red]: '#c22b25',
  [CELL.glassGreen]: '#2f5a2a', [CELL.glassBrown]: '#5a2e12', [CELL.glassClear]: '#b8cfd6',
};

function drawLabel(ctx: Ctx, x: number, y: number, s: number, lab: Label, rand: () => number) {
  const g = ctx.createLinearGradient(x, y, x, y + s);
  g.addColorStop(0, lab.bg);
  g.addColorStop(1, lab.bg2 ?? lab.bg);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, s, s);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, s, s);
  ctx.clip();
  // a band or a burst behind the name, a little different on each product
  ctx.fillStyle = lab.bg2 ?? lab.bg;
  if (lab.style === 'bag' || lab.style === 'can') {
    ctx.beginPath();
    ctx.ellipse(x + s * 0.5, y + s * 0.52, s * 0.44, s * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rand();
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.52);
      ctx.lineTo(x + s * 0.5 + Math.cos(a) * s, y + s * 0.52 + Math.sin(a) * s);
      ctx.lineTo(x + s * 0.5 + Math.cos(a + 0.18) * s, y + s * 0.52 + Math.sin(a + 0.18) * s);
      ctx.fill();
    }
  } else if (lab.style === 'bottle' || lab.style === 'jar') {
    ctx.fillRect(x, y + s * 0.18, s, s * 0.08);
    ctx.fillRect(x, y + s * 0.74, s, s * 0.08);
  } else {
    ctx.fillRect(x, y + s * 0.62, s, s * 0.38);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y + s * 0.6, s, s * 0.03);
  }
  // product pictures, very simple: chips, a bean, a drop...
  if (lab.style === 'bag') {
    ctx.fillStyle = 'rgba(255, 220, 120, 0.85)';
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.ellipse(x + s * (0.25 + k * 0.17), y + s * 0.82, s * 0.07, s * 0.045, rand() * 3, 0, Math.PI * 2); ctx.fill(); }
  }
  if (lab.fa) {
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = lab.fg;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    const fs = lab.fa.length > 6 ? s * 0.2 : s * 0.27;
    ctx.font = `800 ${fs}px ${FONT}`;
    ctx.strokeText(lab.fa, x + s * 0.5, y + s * 0.45);
    ctx.fillText(lab.fa, x + s * 0.5, y + s * 0.45);
    if (lab.sub) {
      ctx.font = `600 ${s * 0.13}px ${FONT}`;
      ctx.fillText(lab.sub, x + s * 0.5, y + s * 0.66);
    }
  }
  ctx.restore();
}

function labelAtlas(): HTMLCanvasElement {
  const S = 1024, s = S / ATLAS;
  const c = makeCanvas(S);
  const ctx = c.getContext('2d')!;
  const rand = mulberry32(77);
  for (let i = 0; i < ATLAS * ATLAS; i++) {
    const x = (i % ATLAS) * s, y = Math.floor(i / ATLAS) * s;
    if (FLAT[i]) {
      ctx.fillStyle = FLAT[i];
      ctx.fillRect(x, y, s, s);
      continue;
    }
    const lab = L[i];
    if (lab) drawLabel(ctx, x, y, s, lab, rand);
  }
  return c;
}

// ---- the sign above the porch and the signpost by the trail ---------------
function carvedSign(text: string, w: number, h: number, arrow: '' | 'left' | 'right' = ''): HTMLCanvasElement {
  const c = planks(256, { count: 3, base: [118, 78, 46], vertical: false, seed: 91, gap: 0.006, wear: 0.2 });
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(c, 0, 0, w, h);
  ctx.strokeStyle = 'rgba(40, 22, 10, 0.8)';
  ctx.lineWidth = h * 0.06;
  ctx.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${h * 0.5}px ${FONT}`;
  const tx = arrow === 'left' ? w * 0.56 : arrow === 'right' ? w * 0.44 : w * 0.5;
  // carved: dark groove, light lower edge
  ctx.fillStyle = 'rgba(255, 228, 170, 0.35)';
  ctx.fillText(text, tx + 1.5, h * 0.53 + 2);
  ctx.fillStyle = '#f3dfb0';
  ctx.fillText(text, tx, h * 0.51);
  if (arrow) {
    ctx.fillStyle = '#f3dfb0';
    if (arrow === 'right') { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.5);
    ctx.lineTo(w * 0.17, h * 0.25);
    ctx.lineTo(w * 0.17, h * 0.4);
    ctx.lineTo(w * 0.24, h * 0.4);
    ctx.lineTo(w * 0.24, h * 0.6);
    ctx.lineTo(w * 0.17, h * 0.6);
    ctx.lineTo(w * 0.17, h * 0.75);
    ctx.closePath();
    ctx.fill();
  }
  return out;
}

// ---- small paper things -----------------------------------------------------
function calendar(): HTMLCanvasElement {
  const c = makeCanvas(256, 360);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, 256, 360);
  // a picture: green hills and a lake, like an old shop calendar
  const g = ctx.createLinearGradient(0, 12, 0, 160);
  g.addColorStop(0, '#9cc4d8'); g.addColorStop(1, '#e7e1c8');
  ctx.fillStyle = g; ctx.fillRect(12, 12, 232, 150);
  ctx.fillStyle = '#4f7a3a';
  ctx.beginPath(); ctx.moveTo(12, 120); ctx.quadraticCurveTo(90, 70, 160, 112); ctx.quadraticCurveTo(210, 90, 244, 108); ctx.lineTo(244, 162); ctx.lineTo(12, 162); ctx.fill();
  ctx.fillStyle = '#3b6e8f'; ctx.fillRect(12, 140, 232, 22);
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.fillStyle = '#7a1f12';
  ctx.font = `800 26px ${FONT}`; ctx.fillText('مهر', 128, 196);
  ctx.fillStyle = '#2b2b2b'; ctx.font = `400 15px ${FONT}`;
  for (let r = 0; r < 5; r++) for (let k = 0; k < 7; k++) {
    const n = r * 7 + k + 1;
    if (n > 30) continue;
    ctx.fillStyle = k === 0 ? '#b3261e' : '#2b2b2b';
    ctx.fillText(faNum(n), 232 - k * 34, 232 + r * 26);
  }
  return c;
}

function clockFace(): HTMLCanvasElement {
  const c = makeCanvas(256);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f2ead6';
  ctx.beginPath(); ctx.arc(128, 128, 126, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a2a1a';
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2, big = k % 5 === 0;
    ctx.lineWidth = big ? 5 : 2;
    ctx.beginPath();
    ctx.moveTo(128 + Math.sin(a) * (big ? 96 : 104), 128 - Math.cos(a) * (big ? 96 : 104));
    ctx.lineTo(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
    ctx.stroke();
  }
  ctx.fillStyle = '#2a1d12';
  ctx.font = `700 26px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    ctx.fillText(faNum(h), 128 + Math.sin(a) * 78, 130 - Math.cos(a) * 78);
  }
  return c;
}

function calculator(): HTMLCanvasElement {
  const c = makeCanvas(128, 192);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2b2d30'; ctx.fillRect(0, 0, 128, 192);
  ctx.fillStyle = '#9aa88a'; ctx.fillRect(12, 12, 104, 38); // display
  ctx.fillStyle = '#2b3324'; ctx.font = '700 24px monospace'; ctx.textAlign = 'right'; ctx.fillText('1250', 110, 40);
  for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) {
    ctx.fillStyle = k === 3 ? '#c96a2a' : r === 0 ? '#5a5d62' : '#d8d6cf';
    ctx.fillRect(12 + k * 27, 62 + r * 25, 22, 19);
  }
  return c;
}

function notebook(): HTMLCanvasElement {
  const c = makeCanvas(256, 180);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f3ecd8'; ctx.fillRect(0, 0, 256, 180);
  ctx.strokeStyle = '#9fb6d4'; ctx.lineWidth = 1;
  for (let y = 22; y < 180; y += 14) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(252, y); ctx.stroke(); }
  ctx.strokeStyle = '#c99'; ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 180); ctx.stroke();
  // handwriting scribbles
  ctx.strokeStyle = '#2a3a6a'; ctx.lineWidth = 1.6;
  const rand = mulberry32(5);
  for (let page = 0; page < 2; page++) for (let row = 0; row < 8; row++) {
    let x = page * 128 + 118 - rand() * 10;
    const y = 20 + row * 14;
    ctx.beginPath(); ctx.moveTo(x, y);
    const len = 50 + rand() * 50;
    for (let k = 0; k < len; k += 3) { x -= 3; ctx.lineTo(x, y - 2 - rand() * 6 + (k % 2) * 2); }
    ctx.stroke();
  }
  return c;
}

function openCard(): HTMLCanvasElement {
  const c = makeCanvas(256, 128);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f6f1e4'; ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#a2261c'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 240, 112);
  ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a2261c'; ctx.font = `800 56px ${FONT}`;
  ctx.fillText('باز است', 128, 66);
  return c;
}

let cache: StoreTextures | null = null;

// the fonts must be loaded before the labels and signs are painted
export async function createStoreTextures(): Promise<StoreTextures> {
  if (cache) return cache;
  try { await Promise.all([document.fonts.load(`800 40px ${FONT}`), document.fonts.load(`600 20px ${FONT}`), document.fonts.load(`400 16px ${FONT}`)]); } catch { /* fall back */ }
  const siding = pair(planks(512, { count: 8, base: [124, 84, 54], vertical: false, seed: 41, gap: 0.01, wear: 0.45 }), 3);
  const boards = pair(planks(512, { count: 6, base: [178, 124, 72], vertical: true, seed: 42, gap: 0.008, wear: 0.15 }), 2);
  const floor = pair(planks(512, { count: 5, base: [128, 88, 56], vertical: false, seed: 43, gap: 0.01, wear: 0.55 }), 2.5);
  // corrugated metal: soft ridges, a little rust
  const rc = makeCanvas(256);
  {
    const ctx = rc.getContext('2d')!;
    const img = ctx.createImageData(256, 256);
    const n = tileNoise(44);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const ridge = 0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 2 * 16);
      const rust = Math.max(0, fbmTile(n, x / 256, y / 256, 6, 4) - 0.55) * 2.2;
      const l = 0.55 + ridge * 0.35;
      const i = (y * 256 + x) * 4;
      img.data[i] = (128 * l) * (1 - rust) + 112 * rust;
      img.data[i + 1] = (58 * l) * (1 - rust) + 60 * rust;
      img.data[i + 2] = (42 * l) * (1 - rust) + 30 * rust;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  const roof = pair(rc, 4);
  const labels = toTexture(labelAtlas(), { wrap: false });
  labels.colorSpace = THREE.SRGBColorSpace;
  cache = {
    siding: siding.map, sidingNormal: siding.normal,
    boards: boards.map, boardsNormal: boards.normal,
    floor: floor.map, floorNormal: floor.normal,
    roof: roof.map, roofNormal: roof.normal,
    sign: toTexture(carvedSign('سوپرمارکت', 512, 128), { wrap: false }),
    signpostL: toTexture(carvedSign('سوپرمارکت', 512, 128, 'left'), { wrap: false }),
    signpostR: toTexture(carvedSign('سوپرمارکت', 512, 128, 'right'), { wrap: false }),
    openSign: toTexture(openCard(), { wrap: false }),
    labels,
    calendar: toTexture(calendar(), { wrap: false }),
    clockFace: toTexture(clockFace(), { wrap: false }),
    calculator: toTexture(calculator(), { wrap: false }),
    notebook: toTexture(notebook(), { wrap: false }),
  };
  return cache;
}
