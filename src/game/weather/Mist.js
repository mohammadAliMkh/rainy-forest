import * as THREE from 'three';
import { windUniforms } from '../../engine/render/shaderPatches.js';
import { mulberry32 } from '../../utils/noise.js';
import { createNoiseTexture } from '../world/textures.js';
import { CABIN, FIRE } from '../../config/config.js';

// Soft drifting mist banks between the trees (vertical billboards that only
// turn around the Y axis), thicker at a distance and fading out as you get
// close, plus tiny floating moisture particles around the camera.


export class Mist {
  constructor(terrain, { count = 64, radius = 85 } = {}) {
    this.terrain = terrain;
    this.count = count;
    this.radius = radius;
    this.rand = mulberry32(321);
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.aCenter = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aScale = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    this.patches = [];
    for (let i = 0; i < count; i++) {
      const p = { x: 0, z: 0, y: 0, w: 0, h: 0 };
      this._place(p, 0, 0, true);
      this.patches.push(p);
      this.aScale.array[i * 2] = p.w;
      this.aScale.array[i * 2 + 1] = p.h;
      this.aSeed.array[i] = this.rand() * 100;
    }
    geo.setAttribute('aCenter', this.aCenter);
    geo.setAttribute('aScale', this.aScale);
    geo.setAttribute('aSeed', this.aSeed);
    geo.instanceCount = count;
    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0.6, 0.65, 0.68) },
      uOpacity: { value: 0.32 },
      tNoise: { value: createNoiseTexture(128) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aCenter; attribute vec2 aScale; attribute float aSeed;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        void main(){
          vUv = uv; vSeed = aSeed;
          vec3 toCam = cameraPosition - aCenter; toCam.y = 0.0;
          vec3 fwd = normalize(toCam + vec3(1e-4));
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          vec3 world = aCenter + right * position.x * aScale.x + vec3(0.0, position.y * aScale.y, 0.0);
          float d = length(cameraPosition.xz - aCenter.xz);
          vFade = smoothstep(5.0, 18.0, d);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; uniform float uOpacity; uniform sampler2D tNoise;
        varying vec2 vUv; varying float vSeed; varying float vFade;
        void main(){
          vec2 p = vUv;
          float n = texture2D(tNoise, vec2(p.x * 0.6 + vSeed + uTime * 0.006, p.y * 0.4 - uTime * 0.003)).r;
          float n2 = texture2D(tNoise, vec2(p.x * 1.1 - vSeed - uTime * 0.01, p.y * 0.7 + vSeed * 0.37)).g;
          float edgeX = smoothstep(0.0, 0.3, p.x) * smoothstep(1.0, 0.7, p.x);
          float edgeY = smoothstep(0.0, 0.25, p.y) * smoothstep(1.0, 0.45, p.y);
          float a = smoothstep(0.3, 0.75, n * 0.7 + n2 * 0.4) * edgeX * edgeY * uOpacity * vFade;
          gl_FragColor = vec4(uColor * (0.92 + n2 * 0.16), a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;

    // floating micro droplets / motes near the camera
    const N = 900;
    const mp = new Float32Array(N * 3);
    const r2 = mulberry32(9);
    for (let i = 0; i < N * 3; i++) mp[i] = r2();
    const mgeo = new THREE.BufferGeometry();
    mgeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.moteUniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0.8, 0.82, 0.85) },
      uPixel: { value: 1 },
      uWind: { value: new THREE.Vector2() },
    };
    this.motesMat = new THREE.ShaderMaterial({
      uniforms: this.moteUniforms,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform float uPixel; uniform vec2 uWind;
        varying float vA;
        void main(){
          vec3 box = vec3(14.0, 7.0, 14.0);
          vec3 p = position * box;
          float s = position.x * 31.0 + position.z * 17.0;
          p += vec3(sin(uTime * 0.21 + s) * 0.6 + uTime * uWind.x * 0.3, sin(uTime * 0.13 + s * 1.7) * 0.4 - uTime * 0.12, cos(uTime * 0.17 + s) * 0.6 + uTime * uWind.y * 0.3);
          vec3 o = uCam - box * 0.5;
          p = o + mod(p - o, box);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = length(p - uCam);
          vA = smoothstep(7.0, 3.0, d) * smoothstep(0.4, 1.5, d);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.0, 0.022 * uPixel * 700.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.3, 1.0, r)) * vA * 0.35);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.motes = new THREE.Points(mgeo, this.motesMat);
    this.motes.frustumCulled = false;
  }

  _place(p, cx, cz, initial) {
    // keep mist banks away from the cabin & campfire so they stay visible
    for (let tries = 0; tries < 12; tries++) {
      const a = this.rand() * Math.PI * 2;
      const d = initial ? 12 + Math.sqrt(this.rand()) * (this.radius - 12) : this.radius * (0.75 + this.rand() * 0.25);
      p.x = cx + Math.cos(a) * d;
      p.z = cz + Math.sin(a) * d;
      if (Math.hypot(p.x - CABIN.x, p.z - CABIN.z) > 16 && Math.hypot(p.x - FIRE.x, p.z - FIRE.z) > 14) break;
    }
    p.w = 18 + this.rand() * 26;
    p.h = 5 + this.rand() * 7;
    p.yOff = -1.0 + this.rand() * 2.5;
  }

  addTo(scene) { scene.add(this.mesh, this.motes); }

  /** under a roof (in the shop): no floating droplets */
  setIndoor(on) { this.motes.visible = !on; }
  setCount(n) { this.mesh.geometry.instanceCount = Math.min(this.count, n); }
  setPixelRatio(pr) { this.moteUniforms.uPixel.value = pr; }

  update(dt, time, camera, env) {
    this.uniforms.uTime.value = time;
    const cx = camera.position.x, cz = camera.position.z;
    const wd = windUniforms.uWindDir.value, ws = windUniforms.uWind.value;
    for (let i = 0; i < this.count; i++) {
      const p = this.patches[i];
      p.x += wd.x * ws * 0.35 * dt;
      p.z += wd.y * ws * 0.35 * dt;
      const dx = p.x - cx, dz = p.z - cz;
      const nearCabin = Math.hypot(p.x - CABIN.x, p.z - CABIN.z) < 13;
      if (dx * dx + dz * dz > this.radius * this.radius || nearCabin) {
        // re-enter on the upwind side
        this._place(p, cx, cz, false);
        this.aScale.array[i * 2] = p.w;
        this.aScale.array[i * 2 + 1] = p.h;
        this.aScale.needsUpdate = true;
      }
      this.aCenter.array[i * 3] = p.x;
      this.aCenter.array[i * 3 + 1] = this.terrain.heightAt(p.x, p.z) + p.yOff;
      this.aCenter.array[i * 3 + 2] = p.z;
    }
    this.aCenter.needsUpdate = true;
    if (env) {
      this.uniforms.uColor.value.copy(env.fogColor).multiplyScalar(1.06);
      this.moteUniforms.uColor.value.copy(env.fogColor).multiplyScalar(1.3).addScalar(0.05);
      // mist is a bit denser at dawn and in the evening
      const h = env.hour;
      const dawn = Math.exp(-Math.pow((h - 6.2) / 1.6, 2));
      const eve = Math.exp(-Math.pow((h - 19.5) / 2.0, 2));
      this.uniforms.uOpacity.value = 0.26 + 0.18 * dawn + 0.1 * eve;
    }
    this.moteUniforms.uTime.value = time;
    this.moteUniforms.uCam.value.copy(camera.position);
    this.moteUniforms.uWind.value.set(wd.x * ws, wd.y * ws);
  }
}
