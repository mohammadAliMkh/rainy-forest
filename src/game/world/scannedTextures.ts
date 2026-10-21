import * as THREE from 'three';

// Scanned PBR materials (Poly Haven, CC0) prepared by pipeline/fetch_textures.py.
// They replace the painted textures in the shared texture set before the world
// is built, and afterwards every material that uses one of them also gets the
// matching roughness / ambient-occlusion (and normal) maps.

interface ManifestEntry {
  asset: string;
  /** real-world size of one tile in meters */
  size: [number, number];
  /** a foliage card (clamped, not tiled) */
  card?: boolean;
  maps: { diff?: string; nor?: string; arm?: string };
}
interface Manifest { textures: Record<string, ManifestEntry> }

export interface ScannedSet {
  map: THREE.Texture;
  normal?: THREE.Texture;
  /** R = ambient occlusion, G = roughness, B = metalness */
  arm?: THREE.Texture;
  /** meters covered by one tile */
  size: number;
}

/** the shared texture set (painted textures + the scanned ones once loaded) */
export type TextureSet = Record<string, any> & { scanned?: Record<string, ScannedSet> };

// role -> [color key, normal key] in the shared texture set
const REPLACES: Record<string, [string, string | null]> = {
  ground: ['ground', 'groundNormal'],
  mud: ['mud', 'mudNormal'],
  bark: ['bark', 'barkNormal'],
  stone: ['stone', 'stoneNormal'],
  wood: ['wood', 'woodNormal'],
  planks: ['planks', null],
  shingles: ['shingles', 'shinglesNormal'],
  needles: ['needles', null], // fir branch card baked in Blender from a real model
};

// The old painted textures were drawn for the UV layouts in the code; these
// repeats make the scanned ones appear at their real size on the same UVs.
const REPEAT: Record<string, [number, number]> = {
  bark: [0.6, 1.2], // trunk UVs: 1.2 m around, 2.4 m up per unit; pine bark tile = 2 m
  wood: [2, 4.4], // cabin log UVs: ~1 m around, 2.2 m along per unit; tile = 0.5 m
};

/**
 * Loads the scanned textures and swaps them into `T`.
 * Returns false (keeping the painted textures) if anything is missing.
 */
export async function loadScannedTextures(T: TextureSet, anisotropy: number): Promise<boolean> {
  const base = import.meta.env.BASE_URL;
  let manifest: Manifest;
  try {
    const res = await fetch(`${base}assets/tex/manifest.json`);
    if (!res.ok) return false;
    manifest = await res.json();
  } catch {
    return false;
  }
  const loader = new THREE.TextureLoader();
  const load = async (url: string | undefined, srgb: boolean, card = false) => {
    if (!url) return undefined;
    const t = await loader.loadAsync(base + url);
    t.wrapS = t.wrapT = card ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  try {
    const sets: Record<string, ScannedSet> = {};
    await Promise.all(
      Object.entries(manifest.textures).map(async ([role, e]) => {
        const [map, normal, arm] = await Promise.all([load(e.maps.diff, true, e.card), load(e.maps.nor, false), load(e.maps.arm, false)]);
        if (!map) return;
        const rep = REPEAT[role];
        for (const t of [map, normal, arm]) if (t && rep) t.repeat.set(rep[0], rep[1]);
        sets[role] = { map, normal, arm, size: e.size[0] };
      }),
    );
    for (const [role, [colorKey, normalKey]] of Object.entries(REPLACES)) {
      const s = sets[role];
      if (!s) continue;
      T[colorKey] = s.map;
      if (normalKey && s.normal) T[normalKey] = s.normal;
    }
    T.scanned = sets;
    return true;
  } catch (err) {
    console.warn('Scanned textures unavailable, keeping painted ones', err);
    return false;
  }
}

/** a copy of `t` that uses the same UV transform as `like` */
function matching(t: THREE.Texture, like: THREE.Texture): THREE.Texture {
  const c = t.clone();
  c.repeat.copy(like.repeat);
  c.offset.copy(like.offset);
  c.rotation = like.rotation;
  c.center.copy(like.center);
  c.needsUpdate = true;
  return c;
}

/**
 * Gives every material that uses a scanned color texture its roughness / AO
 * maps (and a normal map where it had none). Meshes with
 * `userData.customShading` (the terrain) are left alone.
 */
export function upgradeScannedMaterials(root: THREE.Object3D, T: TextureSet): number {
  const sets = T.scanned;
  if (!sets) return 0;
  const bySource = new Map<THREE.Source, ScannedSet>();
  for (const s of Object.values(sets)) bySource.set(s.map.source, s);
  const done = new Set<THREE.Material>();
  let n = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.customShading) return;
    for (const m of ([] as THREE.Material[]).concat(mesh.material)) {
      const std = m as THREE.MeshStandardMaterial;
      if (done.has(m) || !std.isMeshStandardMaterial || !std.map) continue;
      const s = bySource.get(std.map.source);
      if (!s) continue;
      done.add(m);
      if (s.arm) {
        std.roughnessMap = matching(s.arm, std.map);
        std.aoMap = std.roughnessMap;
        std.aoMapIntensity = 0.8;
        // the scan defines the roughness; keep surfaces a bit wetter (rain)
        std.roughness = Math.min(1, Math.max(0.75, std.roughness + 0.1));
      }
      if (!std.normalMap && s.normal) std.normalMap = matching(s.normal, std.map);
      std.needsUpdate = true;
      n++;
    }
  });
  return n;
}
