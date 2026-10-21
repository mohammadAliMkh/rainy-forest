import * as THREE from 'three';

// Trees and plants outside the view (or far away) are not drawn: each frame
// the camera's view volume is handed to the forest and the vegetation.

export class Culling {
  constructor({ camera, forest, vegetation }) {
    Object.assign(this, { camera, forest, vegetation });
    this.frustum = new THREE.Frustum();
    this._m = new THREE.Matrix4();
  }

  update() {
    const camera = this.camera;
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    this.forest.update(camera, this.frustum);
    this.vegetation.update(camera, this.frustum);
  }
}
