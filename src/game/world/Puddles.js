import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { PUDDLES } from '../../config/config.js';

// Puddles on the trail. The puddle closest to the player gets a real planar
// reflection (trees & sky mirrored in the water, like the reference photo)
// distorted by expanding raindrop ripples. Farther puddles use a cheaper
// reflective material. Puddles live on layer 1 so reflections skip them.

export const PUDDLE_LAYER = 1;

const RIPPLE_GLSL = /* glsl */ `
float rh(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
vec2 ripples(vec2 p, float t){
  vec2 n = vec2(0.0);
  for (int layer = 0; layer < 2; layer++){
    float sc = layer == 0 ? 2.3 : 3.7;
    vec2 q = p * sc + float(layer) * 17.0;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 c = cell + vec2(float(i), float(j));
      float h = rh(c);
      vec2 center = vec2(float(i), float(j)) + 0.15 + 0.7 * vec2(rh(c + 3.1), rh(c + 7.7));
      vec2 d = f - center;
      float r = length(d);
      float ph = fract(t * (0.55 + 0.4 * h) + h * 13.0);
      float rad = ph * 0.75;
      float w = sin((r - rad) * 55.0) * smoothstep(0.09, 0.0, abs(r - rad)) * (1.0 - ph) * (1.0 - ph);
      n += d / (r + 1e-3) * w;
    }
  }
  return n;
}
float rnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(rh(i), rh(i+vec2(1,0)), u.x), mix(rh(i+vec2(0,1)), rh(i+vec2(1,1)), u.x), u.y); }
`;

const PuddleShader = {
  name: 'PuddleShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uWater: { value: new THREE.Color(0.02, 0.025, 0.03) },
    uSeed: { value: 0 },
    uRain: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    varying vec2 vLocal;
    void main(){
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vLocal = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uTime; uniform vec3 uWater; uniform float uSeed; uniform float uRain;
    varying vec4 vUv; varying vec3 vWorld; varying vec2 vLocal;
    ${RIPPLE_GLSL}
    void main(){
      vec2 n = ripples(vWorld.xz, uTime) * uRain; // no rain, no ripples
      vec4 uvp = vUv;
      uvp.xy += n * 0.035 * uvp.w;
      vec3 refl = texture2DProj(tDiffuse, uvp).rgb;
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.15 + 0.85 * pow(1.0 - max(V.y, 0.0), 3.0);
      vec3 col = mix(uWater, refl * 0.82, clamp(fres + 0.35, 0.0, 1.0));
      col += vec3(0.04) * length(n);
      vec2 lp = vLocal * 2.0 - 1.0;
      float r = length(lp) + (rnoise(lp * 3.0 + uSeed) - 0.5) * 0.3;
      float a = smoothstep(1.0, 0.78, r);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export class Puddles {
  constructor(terrain, T) {
    this.group = new THREE.Group();
    this.items = [];
    this.reflectionsEnabled = true;
    this.reflectEvery = 1;
    this._tick = 0;

    // generic puddle shape mask for the cheap version
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 62);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.75, '#fff');
    g.addColorStop(1, '#000');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const mask = new THREE.CanvasTexture(c);

    const cheapMat = new THREE.MeshStandardMaterial({
      color: 0x0b0c0d, roughness: 0.04, metalness: 0.0, envMapIntensity: 1.6, transparent: true, alphaMap: mask, depthWrite: false,
    });

    PUDDLES.forEach((p, i) => {
      const [x, z, rx, rz, rot] = p;
      const y = terrain.puddleLevels[i];
      const geo = new THREE.PlaneGeometry(rx * 2, rz * 2);
      const cheap = new THREE.Mesh(geo, cheapMat);
      cheap.rotation.set(-Math.PI / 2, 0, rot);
      cheap.position.set(x, y, z);
      cheap.layers.set(PUDDLE_LAYER);
      cheap.renderOrder = 1;
      this.group.add(cheap);

      const refl = new Reflector(geo, {
        textureWidth: 512, textureHeight: 512, clipBias: 0.003, shader: PuddleShader, multisample: 0,
      });
      refl.material.transparent = true;
      refl.material.depthWrite = false;
      refl.material.uniforms.uSeed.value = i * 3.7;
      refl.rotation.set(-Math.PI / 2, 0, rot);
      refl.position.set(x, y + 0.002, z);
      refl.layers.set(PUDDLE_LAYER);
      // the mirror pass re-renders the scene: optionally refresh it only every
      // Nth frame (ripples hide the tiny lag)
      const renderMirror = refl.onBeforeRender;
      refl.onBeforeRender = (...args) => {
        if (this._tick++ % this.reflectEvery === 0) renderMirror(...args);
      };
      refl.visible = false;
      refl.renderOrder = 1;
      this.group.add(refl);

      this.items.push({ x, z, y, cheap, refl });
    });
    void T;
  }

  setReflections(on, size = 512, every = 1) {
    this.reflectionsEnabled = on;
    this.reflectEvery = every;
    for (const it of this.items) it.refl.getRenderTarget().setSize(size, size);
  }

  // rain: 0..1, how many drops ripple the water
  update(time, camera, env, rain = 1) {
    let best = null, bestD = 22;
    for (const it of this.items) {
      const d = Math.hypot(it.x - camera.position.x, it.z - camera.position.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    for (const it of this.items) {
      const useRefl = this.reflectionsEnabled && it === best;
      it.refl.visible = useRefl;
      it.cheap.visible = !useRefl;
      if (useRefl) {
        const u = it.refl.material.uniforms;
        u.uTime.value = time;
        u.uRain.value = Math.min(1, rain * 1.4);
        if (env) u.uWater.value.copy(env.fogColor).multiplyScalar(0.12);
      }
    }
  }
}
