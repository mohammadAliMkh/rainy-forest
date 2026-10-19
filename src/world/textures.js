import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';

// Procedurally painted textures (no external image files needed).
// All surfaces are generated once at startup on 2D canvases.

let maxAniso = 4;
export function setMaxAnisotropy(v) { maxAniso = Math.min(8, v); }

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas, { repeat = 1, srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
  }
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Tileable value noise (period in lattice cells) + fbm
function tileNoise(seed) {
  const rand = mulberry32(seed);
  const N = 256;
  const table = new Float32Array(N * N);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const fn = function (x, y, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = table[y0 * N + x0], b = table[y0 * N + x1];
    const c = table[y1 * N + x0], d = table[y1 * N + x1];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // hash of already-wrapped integer lattice coords
  fn.hash = (a, b) => table[(Math.imul(a, 7919) + Math.imul(b, 104729)) & 65535];
  return fn;
}

function fbmTile(noise, u, v, basePeriod, octaves = 5) {
  let sum = 0, amp = 0.5, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * period, v * period, period);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// Anisotropic tileable fbm (separate lattice period per axis)
function fbmTile2(noise, u, v, px, py, octaves = 5) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const m = 1 << o;
    // sample a 2D lattice with separate periods by scaling coordinates
    const x = u * px * m, y = v * py * m;
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const P = px * m, Q = py * m;
    const s = (a, b) => noise.hash(((a % P) + P) % P, ((b % Q) + Q) % Q);
    const a = s(xi, yi), b = s(xi + 1, yi), c = s(xi, yi + 1), d = s(xi + 1, yi + 1);
    const uu = fx * fx * (3 - 2 * fx), vv = fy * fy * (3 - 2 * fy);
    sum += amp * (a + (b - a) * uu + (c - a) * vv + (a - b - c + d) * uu * vv);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

function normalFromHeight(height, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const at = (x, y) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function heightFromCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255;
  }
  return out;
}

// draw something with wrap-around so the texture tiles seamlessly
function wrapDraw(size, x, y, r, fn) {
  const offs = [0];
  if (x < r) offs.push(size);
  if (x > size - r) offs.push(-size);
  const offsY = [0];
  if (y < r) offsY.push(size);
  if (y > size - r) offsY.push(-size);
  for (const ox of offs) for (const oy of offsY) fn(x + ox, y + oy);
}

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// Tileable grey fbm noise (R = coarse, G = fine) used by mist shaders so they
// can sample a texture instead of computing noise per pixel.
export function createNoiseTexture(S = 128) {
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const n = tileNoise(123);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      img.data[i] = fbmTile(n, x / S, y / S, 4, 4) * 255;
      img.data[i + 1] = fbmTile(n, x / S + 0.5, y / S + 0.25, 8, 3) * 255;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// ---------------------------------------------------------------------------
export function createTextures() {
  const T = {};

  // ---------------- Forest floor ----------------
  {
    const S = 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const n = tileNoise(11);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const f = fbmTile(n, u, v, 6, 5);
        const m = fbmTile(n, u + 0.37, v + 0.71, 3, 4);
        const moss = Math.min(1, Math.max(0, (m - 0.48) * 4));
        const i = (y * S + x) * 4;
        const soil = [72 + f * 46, 56 + f * 36, 40 + f * 24];
        const mossC = [62 + f * 46, 88 + f * 58, 34 + f * 22];
        img.data[i] = soil[0] * (1 - moss) + mossC[0] * moss;
        img.data[i + 1] = soil[1] * (1 - moss) + mossC[1] * moss;
        img.data[i + 2] = soil[2] * (1 - moss) + mossC[2] * moss;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const r = mulberry32(5);
    // conifer needles
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, l = 4 + r() * 7;
      const t = r();
      ctx.strokeStyle = rgb(70 + t * 50, 50 + t * 30, 28 + t * 15, 0.55);
      ctx.lineWidth = 1;
      wrapDraw(S, x, y, 12, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
        ctx.stroke();
      });
    }
    // fallen leaves
    for (let i = 0; i < 700; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI * 2;
      const L = 5 + r() * 9, W = L * (0.35 + r() * 0.25);
      const t = r();
      const col = t < 0.45 ? rgb(78 + r() * 40, 52 + r() * 22, 26 + r() * 12, 0.9)
        : t < 0.75 ? rgb(60 + r() * 25, 58 + r() * 25, 24 + r() * 10, 0.9)
          : rgb(40 + r() * 20, 30 + r() * 15, 20 + r() * 10, 0.9);
      wrapDraw(S, x, y, 16, (px, py) => {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(0, 0, L, W, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(20,14,8,0.35)';
        ctx.beginPath();
        ctx.moveTo(-L, 0); ctx.lineTo(L, 0);
        ctx.stroke();
        ctx.restore();
      });
    }
    // twigs
    for (let i = 0; i < 90; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, l = 14 + r() * 40;
      ctx.strokeStyle = rgb(45 + r() * 25, 33 + r() * 15, 22, 0.9);
      ctx.lineWidth = 1.5 + r() * 2;
      wrapDraw(S, x, y, 60, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + Math.cos(a) * l * 0.5 + 4, py + Math.sin(a) * l * 0.5 - 3, px + Math.cos(a) * l, py + Math.sin(a) * l);
        ctx.stroke();
      });
    }
    // dark wet spots
    for (let i = 0; i < 60; i++) {
      const x = r() * S, y = r() * S, rad = 10 + r() * 30;
      wrapDraw(S, x, y, rad, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, 'rgba(10,8,5,0.25)');
        g.addColorStop(1, 'rgba(10,8,5,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    T.ground = toTexture(c);
    T.groundNormal = toTexture(normalFromHeight(heightFromCanvas(c), S, S, 3.5), { srgb: false });
  }

  // ---------------- Mud (path) ----------------
  {
    const S = 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const n = tileNoise(23);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const f = fbmTile(n, u, v, 8, 5);
        const g = fbmTile(n, u + 0.5, v + 0.2, 2, 3);
        const i = (y * S + x) * 4;
        const k = 0.75 + g * 0.5;
        img.data[i] = (62 + f * 40) * k;
        img.data[i + 1] = (52 + f * 32) * k;
        img.data[i + 2] = (44 + f * 26) * k;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const r = mulberry32(8);
    for (let i = 0; i < 260; i++) {
      const x = r() * S, y = r() * S, rad = 0.8 + r() * 2.6;
      const t = 60 + r() * 40;
      wrapDraw(S, x, y, 6, (px, py) => {
        ctx.fillStyle = rgb(t, t * 0.95, t * 0.88, 0.85);
        ctx.beginPath();
        ctx.ellipse(px, py, rad, rad * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
        ctx.fill();

      });
    }
    for (let i = 0; i < 120; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI * 2, L = 5 + r() * 7;
      wrapDraw(S, x, y, 12, (px, py) => {
        ctx.save();
        ctx.translate(px, py); ctx.rotate(a);
        ctx.fillStyle = rgb(70 + r() * 40, 45 + r() * 20, 22, 0.8);
        ctx.beginPath(); ctx.ellipse(0, 0, L, L * 0.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
    }
    T.mud = toTexture(c);
    T.mudNormal = toTexture(normalFromHeight(heightFromCanvas(c), S, S, 2.5), { srgb: false });
  }

  // ---------------- Bark ----------------
  {
    const W = 256, H = 512;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const n = tileNoise(31);
    const img = ctx.createImageData(W, H);
    const hgt = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W, v = y / H;
        const ridges = fbmTile2(n, u, v, 14, 3, 4);
        const fine = fbmTile2(n, u + 0.3, v, 40, 20, 3);
        const plates = fbmTile2(n, u, v + 0.5, 5, 6, 3);
        let hh = Math.pow(Math.abs(ridges - 0.5) * 2, 0.6) * 0.65 + fine * 0.25 + plates * 0.2;
        hgt[y * W + x] = hh;
        const i = (y * W + x) * 4;
        const k = 0.35 + hh * 0.75;
        img.data[i] = 54 * k + 6;
        img.data[i + 1] = 48 * k + 5;
        img.data[i + 2] = 44 * k + 5;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // lichen specks
    const r = mulberry32(3);
    for (let i = 0; i < 160; i++) {
      const x = r() * W, y = r() * H, rad = 1 + r() * 5;
      ctx.fillStyle = r() < 0.6 ? rgb(90 + r() * 30, 110 + r() * 30, 80, 0.35) : rgb(60, 85 + r() * 30, 40, 0.4);
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    T.bark = toTexture(c);
    T.barkNormal = toTexture(normalFromHeight(hgt, W, H, 6), { srgb: false });
  }

  // ---------------- Conifer branch card (stem along +X, tip at right) ----------------
  {
    const W = 512, H = 256;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const r = mulberry32(17);
    const cy = H / 2;
    const needle = (x, y, ang, len, shade) => {
      ctx.strokeStyle = rgb(18 + shade * 30, 40 + shade * 42, 24 + shade * 22, 1);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    };
    const twig = (x0, y0, ang, len, density, width) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = 'rgb(48,36,26)';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      ctx.stroke();
      ctx.lineWidth = 1.6;
      const steps = Math.floor(len * density);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const x = x0 + Math.cos(ang) * len * t, y = y0 + Math.sin(ang) * len * t;
        const nl = (16 - t * 8) * (0.7 + r() * 0.5);
        const sh = r();
        needle(x, y, ang + 0.9 + r() * 0.4, nl, sh);
        needle(x, y, ang - 0.9 - r() * 0.4, nl, r());
        if (r() < 0.5) needle(x, y, ang + (r() - 0.5) * 0.6, nl * 0.7, r() * 0.6);
      }
    };
    // main stem
    twig(4, cy, 0, W - 20, 0.5, 4);
    // side twigs
    for (let x = 20; x < W - 50; x += 18 + r() * 12) {
      const t = x / W;
      const len = (1 - t) * 105 + 20;
      twig(x, cy, -0.75 - r() * 0.3, len * (0.7 + r() * 0.4), 0.55, 2);
      twig(x + 6, cy, 0.75 + r() * 0.3, len * (0.7 + r() * 0.4), 0.55, 2);
    }
    T.needles = toTexture(c, { wrap: false });
  }

  // ---------------- Broadleaf cluster (with dew drops) ----------------
  const drawLeaf = (ctx, r, L, Wd, base, dew) => {
    const g = ctx.createLinearGradient(-L * 0.1, 0, L, 0);
    g.addColorStop(0, rgb(base[0] * 0.8, base[1] * 0.8, base[2] * 0.8));
    g.addColorStop(0.6, rgb(base[0], base[1], base[2]));
    g.addColorStop(1, rgb(base[0] * 1.15, base[1] * 1.1, base[2]));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(L * 0.25, -Wd, L * 0.7, -Wd * 0.9, L, 0);
    ctx.bezierCurveTo(L * 0.7, Wd * 0.9, L * 0.25, Wd, 0, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,200,140,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.97, 0); ctx.stroke();
    ctx.lineWidth = 0.7;
    for (let k = 1; k < 6; k++) {
      const x = (L * k) / 6.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + L * 0.12, -Wd * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + L * 0.12, Wd * 0.6); ctx.stroke();
    }
    if (dew) {
      const drops = 3 + Math.floor(r() * 9);
      for (let k = 0; k < drops; k++) {
        const dx = L * (0.15 + r() * 0.75), dy = (r() - 0.5) * Wd * 0.9, dr = 1 + r() * 2.6;
        ctx.fillStyle = 'rgba(20,35,25,0.55)';
        ctx.beginPath(); ctx.arc(dx + 0.6, dy + 0.8, dr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(200,225,220,0.55)';
        ctx.beginPath(); ctx.arc(dx, dy, dr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(dx - dr * 0.35, dy - dr * 0.35, dr * 0.35, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
  {
    const S = 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = mulberry32(29);
    // little twigs
    ctx.strokeStyle = 'rgb(55,42,30)';
    for (let i = 0; i < 9; i++) {
      ctx.lineWidth = 2;
      const a = r() * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(S / 2, S / 2);
      ctx.lineTo(S / 2 + Math.cos(a) * 180, S / 2 + Math.sin(a) * 180); ctx.stroke();
    }
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 170;
      const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + (r() - 0.5) * 1.2);
      const L = 46 + r() * 34;
      const t = r();
      const base = [32 + t * 40, 62 + t * 55, 24 + t * 22];
      drawLeaf(ctx, r, L, L * 0.32, base, r() < 0.45);
      ctx.restore();
    }
    T.leaves = toTexture(c, { wrap: false });
  }

  // ---------------- Big dewy leaves for understory bushes ----------------
  {
    const S = 512;
    const c = makeCanvas(S * 2);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2); // drawn in 512 space, stored at 1024 for crisp close-ups
    const r = mulberry32(91);
    ctx.strokeStyle = 'rgb(60,55,30)';
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (r() - 0.5) * 2.6;
      const d = 40 + r() * 170;
      const x0 = S / 2, y0 = S - 10;
      const x = x0 + Math.cos(a) * d, y = y0 + Math.sin(a) * d * 1.6;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0, y, x, y); ctx.stroke();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a + (r() - 0.5) * 0.8);
      const L = 60 + r() * 50;
      const t = r();
      drawLeaf(ctx, r, L, L * 0.42, [22 + t * 26, 58 + t * 50, 26 + t * 18], r() < 0.92);
      ctx.restore();
    }
    T.bushLeaves = toTexture(c, { wrap: false });
  }

  // ---------------- Fern frond (pointing up) ----------------
  {
    const W = 256, H = 512;
    const c = makeCanvas(W, H);
    const ctx = c.getContext('2d');
    const r = mulberry32(13);
    const cx = W / 2;
    ctx.strokeStyle = 'rgb(55,75,30)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, H); ctx.quadraticCurveTo(cx + 6, H / 2, cx, 6); ctx.stroke();
    for (let y = H - 40; y > 14; y -= 13) {
      const t = 1 - y / H; // 0 bottom .. 1 top
      const len = Math.sin(Math.min(1, (1 - t) * 1.25) * Math.PI * 0.62) * 108 * (1 - t * 0.55) + 6;
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(cx, y);
        ctx.rotate(side * (1.15 - t * 0.35));
        const lobes = Math.max(3, Math.floor(len / 7));
        for (let k = 0; k < lobes; k++) {
          const lx = (k / lobes) * len;
          const lw = (1 - k / lobes) * 6 + 2;
          const sh = r();
          ctx.fillStyle = rgb(38 + sh * 30, 78 + sh * 45, 30 + sh * 20);
          ctx.beginPath(); ctx.ellipse(lx, -lw * 0.4, lw * 0.9, lw, 0.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(lx, lw * 0.4, lw * 0.9, lw, -0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(70,90,40,0.9)';
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
        ctx.restore();
      }
    }
    T.fern = toTexture(c, { wrap: false });
  }

  // ---------------- Grass tuft ----------------
  {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = mulberry32(19);
    for (let i = 0; i < 55; i++) {
      const x0 = S * 0.2 + r() * S * 0.6;
      const h = S * (0.45 + r() * 0.5);
      const lean = (r() - 0.5) * 90;
      const w = 2 + r() * 3;
      const t = r();
      ctx.fillStyle = rgb(45 + t * 45, 70 + t * 55, 25 + t * 20);
      ctx.beginPath();
      ctx.moveTo(x0 - w, S);
      ctx.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h);
      ctx.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, S - h * 0.6, x0 + w, S);
      ctx.fill();
    }
    T.grass = toTexture(c, { wrap: false });
  }

  // ---------------- Weathered log wood (grain along U) ----------------
  {
    const S = 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const n = tileNoise(41);
    const img = ctx.createImageData(S, S);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const grain = fbmTile2(n, u, v, 2, 48, 4);
        const blot = fbmTile2(n, u + 0.4, v + 0.1, 4, 4, 4);
        const crack = Math.pow(Math.max(0, 1 - Math.abs(fbmTile2(n, u, v + 0.33, 3, 22, 3) - 0.5) * 18), 3);
        const g = grain * 0.6 + blot * 0.4;
        const i = (y * S + x) * 4;
        const k = (0.62 + g * 0.6) * (1 - crack * 0.6);
        hgt[y * S + x] = g * 0.5 - crack * 0.6;
        // warm brown, weathered grey in blotches
        const grey = Math.max(0, (blot - 0.5) * 1.6);
        img.data[i] = (112 * (1 - grey) + 92 * grey) * k;
        img.data[i + 1] = (78 * (1 - grey) + 84 * grey) * k;
        img.data[i + 2] = (50 * (1 - grey) + 74 * grey) * k;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    T.wood = toTexture(c);
    T.woodNormal = toTexture(normalFromHeight(hgt, S, S, 4), { srgb: false });
  }

  // ---------------- Log end grain ----------------
  {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = mulberry32(51);
    const cx = S / 2 + (r() - 0.5) * 12, cy = S / 2 + (r() - 0.5) * 12;
    ctx.fillStyle = 'rgb(58,40,28)';
    ctx.fillRect(0, 0, S, S);
    const g = ctx.createRadialGradient(cx, cy, 4, S / 2, S / 2, S * 0.47);
    g.addColorStop(0, 'rgb(205,160,108)');
    g.addColorStop(0.75, 'rgb(190,140,90)');
    g.addColorStop(0.92, 'rgb(150,100,60)');
    g.addColorStop(1, 'rgb(70,48,32)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.47, 0, Math.PI * 2); ctx.fill();
    for (let rr = 6; rr < S * 0.44; rr += 3 + r() * 5) {
      ctx.strokeStyle = `rgba(120,78,45,${0.25 + r() * 0.35})`;
      ctx.lineWidth = 0.8 + r();
      ctx.beginPath();
      ctx.ellipse(cx + (r() - 0.5) * 2, cy + (r() - 0.5) * 2, rr, rr * (0.96 + r() * 0.08), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, L = S * (0.15 + r() * 0.3);
      ctx.strokeStyle = 'rgba(50,30,20,0.7)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * S * 0.46, cy + Math.sin(a) * S * 0.46);
      ctx.lineTo(cx + Math.cos(a) * (S * 0.46 - L), cy + Math.sin(a) * (S * 0.46 - L)); ctx.stroke();
    }
    T.logEnd = toTexture(c, { wrap: false });
  }

  // ---------------- Roof shingles (mossy) ----------------
  {
    const S = 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = mulberry32(61);
    const n = tileNoise(62);
    ctx.fillStyle = 'rgb(28,26,24)';
    ctx.fillRect(0, 0, S, S);
    const rows = 10, cols = 7;
    const rh = S / rows, cw = S / cols;
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? cw * 0.5 : 0;
      for (let col = -1; col <= cols; col++) {
        const x = col * cw + off + (r() - 0.5) * 4, y = row * rh;
        const w = cw * (0.92 + r() * 0.06);
        const t = r();
        const base = 52 + t * 30;
        const gr = ctx.createLinearGradient(0, y, 0, y + rh);
        gr.addColorStop(0, rgb(base * 0.55, base * 0.52, base * 0.5));
        gr.addColorStop(1, rgb(base, base * 0.92, base * 0.85));
        ctx.fillStyle = gr;
        ctx.fillRect(x + 1, y + 1, w - 2, rh - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x, y + rh - 3, w, 3);
      }
    }
    // moss
    const img = ctx.getImageData(0, 0, S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const m = fbmTile(n, x / S, y / S, 4, 4);
        const k = Math.max(0, (m - 0.55) * 3.2);
        if (k <= 0) continue;
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i] * (1 - k) + 60 * k;
        img.data[i + 1] = img.data[i + 1] * (1 - k) + 82 * k;
        img.data[i + 2] = img.data[i + 2] * (1 - k) + 32 * k;
      }
    }
    ctx.putImageData(img, 0, 0);
    T.shingles = toTexture(c);
    T.shinglesNormal = toTexture(normalFromHeight(heightFromCanvas(c), S, S, 3), { srgb: false });
  }

  // ---------------- Stone ----------------
  {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const n = tileNoise(71);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const f = fbmTile(n, u, v, 4, 6);
        const l = fbmTile(n, u + 0.2, v + 0.6, 3, 3);
        const lich = Math.max(0, (l - 0.6) * 4);
        const i = (y * S + x) * 4;
        const g = 70 + f * 70;
        img.data[i] = g * (1 - lich) + 95 * lich;
        img.data[i + 1] = g * 1.02 * (1 - lich) + 112 * lich;
        img.data[i + 2] = g * 1.05 * (1 - lich) + 70 * lich;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    T.stone = toTexture(c);
    T.stoneNormal = toTexture(normalFromHeight(heightFromCanvas(c), S, S, 4), { srgb: false });
  }

  // ---------------- Planks (door, floor, gable) ----------------
  {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = mulberry32(81);
    const n = tileNoise(82);
    const img = ctx.createImageData(S, S);
    const boards = 5;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const b = Math.floor((x / S) * boards);
        const u = x / S, v = y / S;
        const grain = fbmTile2(n, u + b * 0.17, v, 24, 2, 3);
        const edge = Math.min((x / S) * boards - b, 1 - ((x / S) * boards - b));
        const k = (0.6 + grain * 0.6) * (edge < 0.04 ? 0.35 : 1);
        const i = (y * S + x) * 4;
        img.data[i] = 96 * k; img.data[i + 1] = 70 * k; img.data[i + 2] = 48 * k; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    T.planks = toTexture(c);
    void r;
  }

  // ---------------- Charred wood + ember emissive ----------------
  {
    const S = 256;
    const c = makeCanvas(S);
    const e = makeCanvas(S);
    const ctx = c.getContext('2d');
    const ectx = e.getContext('2d');
    const n = tileNoise(91);
    const img = ctx.createImageData(S, S);
    const eimg = ectx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        const f = fbmTile(n, u, v, 8, 4);
        const cells = Math.abs(fbmTile2(n, u, v + 0.3, 10, 6, 3) - 0.5);
        const crack = cells < 0.04 ? 1 - cells / 0.04 : 0;
        const i = (y * S + x) * 4;
        const g = 14 + f * 26;
        img.data[i] = g; img.data[i + 1] = g * 0.9; img.data[i + 2] = g * 0.8; img.data[i + 3] = 255;
        eimg.data[i] = 255 * crack; eimg.data[i + 1] = 90 * crack; eimg.data[i + 2] = 20 * crack; eimg.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ectx.putImageData(eimg, 0, 0);
    T.char = toTexture(c);
    T.charEmissive = toTexture(e);
  }

  // ---------------- Soft round particle ----------------
  {
    const S = 128;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    T.soft = toTexture(c, { wrap: false, srgb: false });
  }

  // ---------------- Deer fur (subtle) ----------------
  {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const n = tileNoise(101);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const f = fbmTile2(n, x / S, y / S, 64, 8, 3);
        const i = (y * S + x) * 4;
        const k = 0.8 + f * 0.4;
        img.data[i] = 255 * k * 0.85; img.data[i + 1] = 255 * k * 0.85; img.data[i + 2] = 255 * k * 0.85; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    T.fur = toTexture(c, { repeat: 3 });
    T.furNormal = toTexture(normalFromHeight(heightFromCanvas(c), S, S, 2), { srgb: false, repeat: 3 });
  }

  return T;
}
