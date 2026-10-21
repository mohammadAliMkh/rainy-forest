import * as THREE from 'three';
import type { QualityName, QualityPreset } from '../../config/config.js';
import type { Renderer } from '../../engine/render/Renderer.js';
import type { Sky } from '../weather/Sky.js';
import type { DayCycle } from '../weather/DayCycle.js';
import type { PlayerController } from '../player/PlayerController.ts';
import type { FrameBase } from '../../engine/Game.ts';

interface LightingFrame extends FrameBase {
  camera: THREE.Camera;
  env: { ambientLevel: number };
}

// All the light in the scene: sky (hemisphere) and ambient light, the sun /
// moon with its shadow, the lantern the player carries after dark, and the
// environment map (wet reflections) made from the sky. The day cycle sets
// the colours and strengths; this keeps the shadow following the player,
// fades the lantern and refreshes the environment map as the day goes on.

export class Lighting {
  readonly scene: THREE.Scene;
  readonly hemi: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly lantern: THREE.PointLight;
  readonly sun: THREE.DirectionalLight;
  private pmrem: THREE.PMREMGenerator;
  private envScene: THREE.Scene;
  private envRT: THREE.WebGLRenderTarget | null;
  private envTimer: number;
  private day!: DayCycle;
  private player!: PlayerController;
  private cinematic: () => boolean = () => false;
  private _rot = new THREE.Matrix4();
  private _rotInv = new THREE.Matrix4();
  private _v = new THREE.Vector3();

  constructor({ scene, renderer, sky }: { scene: THREE.Scene; renderer: Renderer; sky: Sky }) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xaab8c4, 0x2b2a1e, 1);
    this.ambient = new THREE.AmbientLight(0xaab8c4, 0.2);
    // a lantern the player carries: warm light a few metres around them, only
    // after dark (always in the scene so switching it on never recompiles)
    this.lantern = new THREE.PointLight(0xffbf80, 0, 13, 1.35);
    scene.add(this.lantern);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    this.sun = sun;
    scene.add(this.hemi, this.ambient, sun, sun.target);

    // environment map from the sky, refreshed as the day goes on
    this.pmrem = new THREE.PMREMGenerator(renderer.renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(sky.mesh.geometry, sky.material));
    this.envRT = null;
    this.envTimer = 0;
  }

  /** what it follows (set once everything exists) */
  connect({ day, player, cinematic }: { day: DayCycle; player: PlayerController; cinematic: () => boolean }): void {
    this.day = day;
    this.player = player;
    this.cinematic = cinematic;
  }

  /** QUALITY_CHANGED */
  setQuality(name: QualityName, q: QualityPreset): void {
    const sun = this.sun;
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    // the lantern costs a light per pixel: the lowest level does without it
    // and gets a little more moonlight instead (switching levels recompiles anyway)
    this.lantern.visible = name !== 'low';
  }

  refreshEnv(): void {
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
  }

  /** system "lighting": shadow camera + lantern (after the camera has moved) */
  update(frame: LightingFrame): void {
    const camera = frame.camera;
    this._followShadow(camera);
    const dark = THREE.MathUtils.clamp((0.48 - frame.env.ambientLevel) / 0.12, 0, 1);
    const on = this.cinematic() ? 0 : dark;
    const lantern = this.lantern;
    lantern.intensity += (on * 5.5 - lantern.intensity) * Math.min(1, frame.dt * 2);
    if (!lantern.visible) this.hemi.intensity += dark * 0.3;
    lantern.position.set(0.28, -0.42, -0.3).applyQuaternion(camera.quaternion).add(camera.position);
  }

  /** system "environment map": a few times a minute (more often when time runs fast) */
  updateEnvironment(frame: FrameBase): void {
    this.envTimer += frame.dt;
    const fast = this.day.cycleSeconds > 0 && this.day.cycleSeconds < 1000;
    if (this.envTimer > (fast ? 1.5 : 4)) { this.envTimer = 0; this.refreshEnv(); }
  }

  // the shadow camera follows the player, snapped to texels to avoid shimmering
  private _followShadow(camera: THREE.Camera): void {
    const sun = this.sun, sc = sun.shadow.camera as THREE.OrthographicCamera;
    const dir = this.day.lightDir;
    const v = this._v;
    this._rot.lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(0, 1, 0));
    this._rotInv.copy(this._rot).invert();
    v.copy(camera.position);
    v.y = this.player.groundY;
    v.applyMatrix4(this._rotInv);
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    v.x = Math.round(v.x / texel) * texel;
    v.y = Math.round(v.y / texel) * texel;
    v.applyMatrix4(this._rot);
    sun.target.position.copy(v);
    sun.position.copy(v).addScaledVector(dir, 110);
    sun.target.updateMatrixWorld();
  }
}
