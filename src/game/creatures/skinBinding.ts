import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Puts a skinned animal built in Blender (pipeline/blender_animals.py) on top
// of an animal's existing joint rig. The rig keeps doing all the animation
// (walking, grazing, wagging...); its meshes are hidden, and every frame each
// bone is moved exactly like the joint it was built around. Bones are matched
// to joints by name.
//
// The rig must be in the pose the Blender model was built in when the
// binding is created (the caller sets it), so each bone's offset from its
// joint is measured in that shared pose.

const _w = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

export class SkinBinding {
  readonly model: THREE.Object3D;
  private readonly pairs: { bone: THREE.Bone; joint: THREE.Object3D; offset: THREE.Matrix4 }[] = [];

  constructor(
    root: THREE.Object3D,
    source: THREE.Object3D,
    joints: Record<string, THREE.Object3D>,
    material: (mesh: THREE.SkinnedMesh) => void,
    opts: {
      /** hand-built meshes that stay visible (things held in the hands...) */
      keep?: (o: THREE.Object3D) => boolean;
      /** fit the rig to the model before the offsets are measured */
      prepare?: (model: THREE.Object3D) => void;
    } = {},
  ) {
    // hide the hand-built meshes of the rig (their joints keep animating)
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !opts.keep?.(o)) o.visible = false; });
    this.model = SkeletonUtils.clone(source);
    root.add(this.model);
    opts.prepare?.(this.model);
    this.model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh && !(o as THREE.Mesh).isMesh) return;
      m.visible = true;
      m.frustumCulled = false; // bounds of skinned meshes don't follow the bones
      m.castShadow = true;
      m.receiveShadow = true;
      if (m.isSkinnedMesh) material(m);
    });
    root.updateMatrixWorld(true);
    const bones: THREE.Bone[] = [];
    this.model.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone); });
    const depth = (o: THREE.Object3D) => { let d = 0; for (let p = o.parent; p; p = p.parent) d++; return d; };
    bones.sort((a, b) => depth(a) - depth(b));
    for (const bone of bones) {
      const joint = joints[bone.name];
      if (!joint) continue;
      const offset = new THREE.Matrix4().copy(joint.matrixWorld).invert().multiply(bone.matrixWorld);
      this.pairs.push({ bone, joint, offset });
    }
  }

  /** call after the rig has been animated and its matrices updated */
  sync(): void {
    for (const { bone, joint, offset } of this.pairs) {
      _w.multiplyMatrices(joint.matrixWorld, offset);
      const parent = bone.parent!;
      bone.matrix.multiplyMatrices(_inv.copy(parent.matrixWorld).invert(), _w);
      bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
      bone.matrixWorld.copy(_w);
    }
  }
}
