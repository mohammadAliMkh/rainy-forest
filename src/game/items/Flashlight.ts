import * as THREE from 'three';

// A small metal flashlight: a ribbed black grip, a wider metal head with a
// glass lens at the front (-z), a rubber switch on top. Its origin is where
// the hand holds it; `lens` marks the front of the glass, where the beam
// comes from. The light itself lives in the inventory (always in the scene).

export function makeFlashlight(): THREE.Group & { lens: THREE.Object3D } {
  const g = new THREE.Group() as THREE.Group & { lens: THREE.Object3D };
  const grip = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.55, metalness: 0.3 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.28, metalness: 0.85 });
  const along = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = Math.PI / 2;
    m.position.z = z;
    g.add(m);
    return m;
  };
  along(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 16), grip, 0.02);
  for (let i = 0; i < 5; i++) along(new THREE.TorusGeometry(0.0165, 0.0018, 6, 16), grip, -0.01 + i * 0.016).rotation.x = 0;
  along(new THREE.CylinderGeometry(0.017, 0.017, 0.012, 16), metal, 0.09); // the tail cap
  along(new THREE.CylinderGeometry(0.025, 0.017, 0.035, 18), metal, -0.06); // the neck widening into the head
  along(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 18), metal, -0.087);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d6, emissiveIntensity: 0, roughness: 0.1 });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 18), lensMat);
  lens.rotation.y = Math.PI; // facing forward (-z)
  lens.position.z = -0.0975;
  g.add(lens);
  const sw = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.005, 0.014), new THREE.MeshStandardMaterial({ color: 0x3c3f2e, roughness: 0.8 }));
  sw.position.set(0, 0.017, -0.02);
  g.add(sw);
  g.lens = lens;
  g.userData.lensMat = lensMat;
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}
