import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Real 3D models for the forest floor (Poly Haven, CC0), slimmed down in
// Blender and compressed by pipeline/process_models.py. Every named part of
// every file becomes { geometry, material } ready for instancing.

export interface ModelPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** bounding box of the geometry (pivot = bottom center) */
  box: THREE.Box3;
}
export type ModelParts = Record<string, ModelPart>;

interface Manifest { models: Record<string, { file: string; parts: string[] }> }

/** meshopt-compressed files store quantized vertices; instancing needs plain floats */
function toFloatGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const a = src.getAttribute(name);
    if (!a) continue;
    const n = a.count, s = a.itemSize;
    const out = new Float32Array(n * s);
    for (let i = 0; i < n; i++) {
      out[i * s] = a.getX(i);
      if (s > 1) out[i * s + 1] = a.getY(i);
      if (s > 2) out[i * s + 2] = a.getZ(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(out, s));
  }
  if (src.index) geo.setIndex(Array.from(src.index.array as ArrayLike<number>));
  geo.applyMatrix4(matrix);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export async function loadEnvModels(anisotropy: number): Promise<ModelParts | null> {
  const base = import.meta.env.BASE_URL;
  let manifest: Manifest;
  try {
    const res = await fetch(`${base}assets/models/manifest.json`);
    if (!res.ok) return null;
    manifest = await res.json();
  } catch {
    return null;
  }
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const parts: ModelParts = {};
  try {
    await Promise.all(
      Object.values(manifest.models).map(async (m) => {
        const gltf = await loader.loadAsync(base + m.file);
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
          for (const t of [material.map, material.normalMap, material.roughnessMap, material.aoMap]) if (t) t.anisotropy = anisotropy;
          const geometry = toFloatGeometry(mesh.geometry, mesh.matrixWorld);
          parts[mesh.name] = { geometry, material, box: geometry.boundingBox!.clone() };
        });
      }),
    );
  } catch (err) {
    console.warn('Forest models unavailable, keeping procedural ones', err);
    return null;
  }
  return parts;
}

/** a copy of the part's geometry scaled so its widest horizontal half-extent is `halfWidth` */
export function fitWidth(part: ModelPart, halfWidth: number): THREE.BufferGeometry {
  const b = part.box;
  const hw = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  const g = part.geometry.clone();
  g.scale(halfWidth / hw, halfWidth / hw, halfWidth / hw);
  g.computeBoundingSphere();
  return g;
}
