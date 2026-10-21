import * as THREE from 'three';
import type { Forest } from './Forest.js';
import type { Vegetation } from './Vegetation.js';

// Trees and plants outside the view (or far away) are not drawn: each frame
// the camera's view volume is handed to the forest and the vegetation.

export class Culling {
  readonly frustum = new THREE.Frustum();
  private _m = new THREE.Matrix4();
  private camera: THREE.Camera;
  private forest: Forest;
  private vegetation: Vegetation;

  constructor({ camera, forest, vegetation }: { camera: THREE.Camera; forest: Forest; vegetation: Vegetation }) {
    this.camera = camera;
    this.forest = forest;
    this.vegetation = vegetation;
  }

  update(): void {
    const camera = this.camera;
    camera.updateMatrixWorld();
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._m);
    this.forest.update(camera, this.frustum);
    this.vegetation.update(camera, this.frustum);
  }
}
