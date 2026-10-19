import { makeCanvas, toTexture, tileNoise, fbmTile, fbmTile2, normalFromHeight, heightFromCanvas } from '../world/textures.js';
import { mulberry32 } from '../utils/noise.js';

// Neutral (light grey) procedural textures for people, the dog and the
// vehicles. Colours come from vertex colours / material colours, so one
// texture serves every garment of the same kind.

function greyCanvas(S, fn) {
  const c = makeCanvas(S);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = Math.max(0, Math.min(1, fn(x, y))) * 255;
      const i = (y * S + x) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function pair(c, S, strength, repeat = 1) {
  return {
    map: toTexture(c, { repeat }),
    normal: toTexture(normalFromHeight(heightFromCanvas(c), S, S, strength), { srgb: false, repeat }),
  };
}

let cache = null;

export function createCampTextures() {
  if (cache) return cache;
  const C = {};

  // hair: fine vertical strands with clumps (v runs along the strands)
  {
    const S = 256;
    const n = tileNoise(71);
    const c = greyCanvas(S, (x, y) => {
      const strands = fbmTile2(n, x / S, y / S, 96, 2, 3);
      const clump = fbmTile2(n, x / S + 0.3, y / S, 12, 1, 2);
      return 0.55 + strands * 0.45 + (clump - 0.5) * 0.25;
    });
    C.hair = pair(c, S, 3);
    // linear coverage mask for alpha-tested hair edges (mostly opaque,
    // thin strand gaps that only show where the vertex coverage fades)
    const m = greyCanvas(S, (x, y) => 0.55 + fbmTile2(n, x / S, y / S, 128, 3, 2) * 0.6);
    C.hairAlpha = toTexture(m, { srgb: false });
    // fine isotropic speckle for stubble
    const rand = mulberry32(80);
    const sp = greyCanvas(S, () => 0.35 + rand() * 0.9);
    C.stubbleAlpha = toTexture(sp, { srgb: false, repeat: 3 });
  }

  // woven fabric (cotton, wool coats)
  {
    const S = 128;
    const n = tileNoise(72);
    const c = greyCanvas(S, (x, y) => {
      const weave = ((x + (y >> 1)) % 2) * 0.06 + ((y + (x >> 1)) % 2) * 0.05;
      return 0.8 + weave + (fbmTile(n, x / S, y / S, 8, 3) - 0.5) * 0.18;
    });
    C.fabric = pair(c, S, 1.4, 6);
  }

  // denim twill (diagonal ribs + fading)
  {
    const S = 128;
    const n = tileNoise(73);
    const c = greyCanvas(S, (x, y) => {
      const rib = Math.sin(((x + y) / S) * Math.PI * 2 * 24) * 0.5 + 0.5;
      const fade = fbmTile(n, x / S, y / S, 4, 3);
      return 0.68 + rib * 0.16 + fade * 0.2 + (fbmTile2(n, x / S, y / S, 64, 64, 1) - 0.5) * 0.1;
    });
    C.denim = pair(c, S, 2.2, 5);
  }

  // chunky knit (vertical cable columns)
  {
    const S = 128;
    const n = tileNoise(74);
    const c = greyCanvas(S, (x, y) => {
      const col = (x / S) * 12;
      const row = (y / S) * 20;
      const fx = col - Math.floor(col) - 0.5;
      const fy = row - Math.floor(row);
      const v = Math.abs(fx + (fy - 0.5) * (Math.floor(col) % 2 ? 0.6 : -0.6));
      return 0.95 - v * 0.7 + (fbmTile(n, x / S, y / S, 16, 2) - 0.5) * 0.1;
    });
    C.knit = pair(c, S, 3.5, 4);
  }

  // suede / brushed leather
  {
    const S = 128;
    const n = tileNoise(75);
    const c = greyCanvas(S, (x, y) => 0.78 + (fbmTile(n, x / S, y / S, 6, 4) - 0.5) * 0.4);
    C.suede = pair(c, S, 1.2, 3);
  }

  // curly shearling / long dog fur
  {
    const S = 128;
    const rand = mulberry32(76);
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {
      const x = rand() * S, y = rand() * S, r = 2 + rand() * 4;
      const v = 120 + rand() * 135;
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 1 + rand();
      ctx.beginPath();
      ctx.arc(x, y, r, rand() * 6, rand() * 6 + 3);
      ctx.stroke();
    }
    C.fleece = pair(c, S, 2.5, 4);
  }

  // directional fur (dog coat): long streaks
  {
    const S = 256;
    const n = tileNoise(77);
    const c = greyCanvas(S, (x, y) => {
      const s = fbmTile2(n, x / S, y / S, 48, 4, 3);
      return 0.6 + s * 0.5;
    });
    C.fur = pair(c, S, 3, 3);
  }

  // skin: soft pores / blotches (very subtle)
  {
    const S = 128;
    const n = tileNoise(78);
    const c = greyCanvas(S, (x, y) => 0.9 + (fbmTile(n, x / S, y / S, 16, 3) - 0.5) * 0.12);
    C.skin = pair(c, S, 0.8, 4);
  }

  // rubber tyre tread (u around the tyre, v across)
  {
    const S = 256;
    const n = tileNoise(79);
    const c = greyCanvas(S, (x, y) => {
      const u = x / S, v = y / S;
      const lug = (Math.floor(u * 36) % 2 === 0) ? (Math.abs(v - 0.5) < 0.38 ? 1 : 0.6) : (Math.abs(v - 0.5) > 0.12 ? 1 : 0.55);
      const groove = Math.abs(((u * 36) % 1) - 0.5) > 0.42 ? 0.35 : 1;
      return (0.35 + lug * 0.45) * groove + (fbmTile(n, u, v, 16, 2) - 0.5) * 0.08;
    });
    C.tread = pair(c, S, 5);
  }

  cache = C;
  return C;
}
