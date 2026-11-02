import * as THREE from 'three';

// A phone gives a page far less memory than a laptop: Safari on an iPhone
// closes the tab ("A problem repeatedly occurred") once it runs out. So on a
// phone the loaded pictures are made smaller as they arrive, and everywhere a
// picture that was loaded more than once (the same skin normal map in every
// person, the same fern in two files) is kept only once.

type Picture = CanvasImageSource & { width: number; height: number };

// one canvas reused to shrink pictures that end up as an ImageBitmap
let scratch: HTMLCanvasElement | null = null;

/** the long side to shrink pictures to on this device (0: keep them as they are) */
export function textureCap(mobile: boolean): number {
  return mobile ? 512 : 0;
}

/**
 * Makes the picture behind `tex` at most `max` pixels on its long side
 * (0 leaves it). A picture shared by several textures is shrunk once (`done`).
 */
export async function shrinkTexture(tex: THREE.Texture, max: number, done: WeakSet<object> = new WeakSet()): Promise<void> {
  const src = tex.source;
  const img = src.data as Picture | null;
  if (!max || !img || done.has(src)) return;
  done.add(src);
  const w = img.width, h = img.height;
  if (!w || !h || Math.max(w, h) <= max) return;
  const s = max / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
  const bitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
  const c = bitmap ? (scratch ??= document.createElement('canvas')) : document.createElement('canvas');
  c.width = nw;
  c.height = nh;
  const g = c.getContext('2d');
  if (!g) return;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, nw, nh);
  if (bitmap) {
    // the picture is copied out of the canvas at once, so the canvas can be reused straight away
    let out: ImageBitmap;
    try {
      out = await createImageBitmap(c, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      const own = document.createElement('canvas');
      own.width = nw; own.height = nh;
      own.getContext('2d')?.drawImage(c, 0, 0);
      tex.image = own;
      tex.needsUpdate = true;
      return;
    }
    (img as ImageBitmap).close();
    tex.image = out;
  } else {
    tex.image = c;
  }
  tex.needsUpdate = true;
}

/**
 * Where the same picture was loaded more than once (same name, size and use),
 * every material is given the first copy, so the rest are never uploaded.
 */
export function shareTextures(materials: Iterable<THREE.Material>): void {
  const first = new Map<string, THREE.Texture>();
  for (const m of materials) {
    const slots = m as unknown as Record<string, unknown>;
    for (const [slot, v] of Object.entries(slots)) {
      const t = v as THREE.Texture | null;
      if (!t || !t.isTexture || !t.name) continue;
      const img = t.image as Picture | null;
      if (!img) continue;
      const key = [t.name, img.width, img.height, t.colorSpace, t.flipY, t.wrapS, t.wrapT, t.channel,
        t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation].join('|');
      const kept = first.get(key);
      if (!kept) first.set(key, t);
      else if (kept !== t) slots[slot] = kept;
    }
  }
}
