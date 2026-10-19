import * as THREE from 'three';
import { FIRE } from '../core/config.js';
import { windUniforms } from '../core/shaderPatches.js';
import { mulberry32 } from '../utils/noise.js';
import { rockGeometry, merge } from './plantGeometry.js';

// Campfire: stone ring, charred log teepee, glowing embers, animated flame
// billboards, rising sparks, soft smoke and a flickering warm light.

const NOISE_GLSL = /* glsl */ `
float fHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = fHash(i), b = fHash(i + vec2(1.0, 0.0)), c = fHash(i + vec2(0.0, 1.0)), d = fHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fFbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * fNoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// ---------------------------------------------------------------------------
export class Flames {
  constructor({ count = 5, width = 0.9, height = 1.5, intensity = 1 } = {}) {
    this.group = new THREE.Group();
    this.flames = [];
    this.intensity = intensity;
    const rand = mulberry32(5);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: rand() * 100 },
          uIntensity: { value: intensity },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uSeed; uniform float uIntensity;
          varying vec2 vUv;
          ${NOISE_GLSL}
          void main(){
            vec2 uv = vUv;
            float t = uTime;
            float n = fFbm(vec2(uv.x * 3.0 + uSeed, uv.y * 2.4 - t * 2.3));
            float n2 = fFbm(vec2(uv.x * 6.5 - uSeed, uv.y * 4.6 - t * 3.6));
            float x = (uv.x - 0.5) * 2.0;
            x += (n - 0.5) * 0.9 * uv.y;
            float h = uv.y + (n2 - 0.5) * 0.45;
            float width = mix(0.8, 0.04, pow(clamp(h, 0.0, 1.0), 0.75));
            float shape = 1.0 - smoothstep(width * 0.35, width, abs(x));
            shape *= 1.0 - smoothstep(0.35, 0.95, h);
            shape *= smoothstep(0.0, 0.1, uv.y);
            float core = shape * (1.0 - smoothstep(0.0, 0.5, h)) * (1.0 - smoothstep(0.0, 0.5, abs(x)));
            vec3 col = mix(vec3(0.75, 0.12, 0.02), vec3(1.0, 0.45, 0.07), smoothstep(0.1, 0.7, shape));
            col = mix(col, vec3(1.0, 0.8, 0.42), core);
            float a = shape * (0.55 + 0.45 * n2);
            gl_FragColor = vec4(col * a * uIntensity * 3.0, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      const s = 1 - i / (count * 1.6);
      m.scale.set(width * s * (0.8 + rand() * 0.4), height * s * (0.8 + rand() * 0.4), 1);
      m.position.set((rand() - 0.5) * width * 0.3, 0, (rand() - 0.5) * width * 0.3);
      m.userData.baseH = m.scale.y;
      m.userData.phase = rand() * 10;
      m.renderOrder = 10;
      this.group.add(m);
      this.flames.push(m);
    }
  }

  update(time, camera, flicker = 1) {
    const wp = new THREE.Vector3();
    for (const m of this.flames) {
      m.material.uniforms.uTime.value = time + m.userData.phase;
      m.material.uniforms.uIntensity.value = this.intensity * flicker;
      m.getWorldPosition(wp);
      m.rotation.y = Math.atan2(camera.position.x - wp.x, camera.position.z - wp.z) - (this.group.parent ? this.group.parent.rotation.y : 0);
      m.scale.y = m.userData.baseH * (0.85 + 0.15 * flicker + 0.08 * Math.sin(time * 3 + m.userData.phase));
    }
  }
}

// ---------------------------------------------------------------------------
const BILLBOARD_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute float aSize;
attribute float aAlpha;
attribute float aRot;
attribute float aSeed;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vHeight;
void main(){
  vUv = uv;
  vAlpha = aAlpha;
  vSeed = aSeed;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aRot), s = sin(aRot);
  vec2 p = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * aSize;
  vec3 world = aCenter + camRight * p.x + camUp * p.y;
  vHeight = aCenter.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

export class Smoke {
  constructor({ max = 40, rate = 5, life = [7, 10], size = [0.35, 3.2], rise = [0.45, 0.8], alpha = 0.22, color = 0x8a8f94, origin = new THREE.Vector3() } = {}) {
    this.max = max; this.rate = rate; this.life = life; this.size = size; this.rise = rise; this.alpha = alpha;
    this.origin = origin.clone();
    this.rand = mulberry32(Math.floor(origin.x * 13 + origin.z * 7) + 99);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    this.aCenter = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (let i = 0; i < max; i++) this.aSeed.array[i] = this.rand() * 100;
    geo.setAttribute('aCenter', this.aCenter);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aRot', this.aRot);
    geo.setAttribute('aSeed', this.aSeed);
    geo.instanceCount = max;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uLight: { value: 1 },
        uTime: { value: 0 },
        uWarm: { value: new THREE.Color(1.0, 0.45, 0.15) },
        uWarmK: { value: 0 },
        uBaseY: { value: origin.y },
      },
      vertexShader: BILLBOARD_VERT,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uLight; uniform float uTime; uniform vec3 uWarm; uniform float uWarmK; uniform float uBaseY;
        varying vec2 vUv; varying float vAlpha; varying float vSeed; varying float vHeight;
        ${NOISE_GLSL}
        void main(){
          vec2 p = vUv - 0.5;
          float r = length(p) * 2.0;
          float n = fFbm(vUv * 3.0 + vec2(vSeed, vSeed * 0.7) + vec2(0.0, -uTime * 0.15));
          float a = (1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.6)) * vAlpha;
          float warm = uWarmK * (1.0 - smoothstep(0.0, 2.5, vHeight - uBaseY));
          vec3 col = uColor * uLight * (0.75 + 0.5 * n) + uWarm * warm;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.particles = [];
    for (let i = 0; i < max; i++) this.particles.push({ alive: false, age: 0, life: 1, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, rot: 0, vr: 0 });
    this.acc = 0;
  }

  update(dt, time, windStrength = 0.5) {
    this.material.uniforms.uTime.value = time;
    this.acc += dt * this.rate;
    const wd = windUniforms.uWindDir.value;
    for (const p of this.particles) {
      if (!p.alive && this.acc >= 1) {
        this.acc -= 1;
        p.alive = true; p.age = 0;
        p.life = this.life[0] + this.rand() * (this.life[1] - this.life[0]);
        p.x = this.origin.x + (this.rand() - 0.5) * 0.3;
        p.y = this.origin.y + this.rand() * 0.2;
        p.z = this.origin.z + (this.rand() - 0.5) * 0.3;
        p.vx = (this.rand() - 0.5) * 0.1; p.vz = (this.rand() - 0.5) * 0.1;
        p.vy = this.rise[0] + this.rand() * (this.rise[1] - this.rise[0]);
        p.rot = this.rand() * 6.28; p.vr = (this.rand() - 0.5) * 0.3;
      }
    }
    if (this.acc > 2) this.acc = 2;
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) { p.alive = false; }
        const t = p.age / p.life;
        // rising slows down, wind drifts it sideways more with height
        p.vy *= 1 - dt * 0.12;
        p.x += (p.vx + wd.x * windStrength * 0.55 * t) * dt;
        p.z += (p.vz + wd.y * windStrength * 0.55 * t) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        const s = this.size[0] + (this.size[1] - this.size[0]) * Math.sqrt(t);
        const a = this.alpha * Math.min(1, t * 6) * (1 - t) * (1 - t);
        this.aCenter.array[i * 3] = p.x; this.aCenter.array[i * 3 + 1] = p.y; this.aCenter.array[i * 3 + 2] = p.z;
        this.aSize.array[i] = s;
        this.aAlpha.array[i] = p.alive ? a : 0;
        this.aRot.array[i] = p.rot;
      } else {
        this.aAlpha.array[i] = 0;
        this.aCenter.array[i * 3 + 1] = -1000;
      }
    }
    this.aCenter.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aRot.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
export class Sparks {
  constructor(max = 90) {
    this.max = max;
    this.rand = mulberry32(31);
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aLife; attribute float aSize; uniform float uPixel;
        varying float vLife;
        void main(){
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(1.5, aSize * uPixel * 420.0 / -mv.z) * step(0.001, aLife);
        }`,
      fragmentShader: /* glsl */ `
        varying float vLife;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.2, 1.0, d)) * vLife;
          vec3 col = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.3), vLife);
          gl_FragColor = vec4(col * a * 4.0, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ alive: false, age: 0, life: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, seed: this.rand() * 10 });
    this.origin = new THREE.Vector3();
  }

  emit(n = 1, strength = 1) {
    for (const p of this.p) {
      if (n <= 0) break;
      if (p.alive) continue;
      p.alive = true; p.age = 0; p.life = 0.7 + this.rand() * 1.6;
      p.x = this.origin.x + (this.rand() - 0.5) * 0.4;
      p.y = this.origin.y + 0.2 + this.rand() * 0.3;
      p.z = this.origin.z + (this.rand() - 0.5) * 0.4;
      p.vx = (this.rand() - 0.5) * 0.7 * strength;
      p.vz = (this.rand() - 0.5) * 0.7 * strength;
      p.vy = (1.2 + this.rand() * 2.2) * strength;
      this.size[this.p.indexOf(p)] = 0.018 + this.rand() * 0.03;
      n--;
    }
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }

  update(dt, time) {
    const wd = windUniforms.uWindDir.value;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.alive) {
        p.age += dt;
        if (p.age > p.life) p.alive = false;
        p.vy -= 0.35 * dt;
        p.x += (p.vx + Math.sin(time * 5 + p.seed) * 0.35 + wd.x * 0.3) * dt;
        p.z += (p.vz + Math.cos(time * 4.3 + p.seed) * 0.35 + wd.y * 0.3) * dt;
        p.y += p.vy * dt;
      }
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.life[i] = p.alive ? Math.max(0, 1 - p.age / p.life) * (0.6 + 0.4 * Math.sin(time * 30 + p.seed * 7) ** 2) : 0;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aLife.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
export class Campfire {
  constructor(T, terrain, collision) {
    this.group = new THREE.Group();
    const y = terrain.heightAt(FIRE.x, FIRE.z);
    this.position = new THREE.Vector3(FIRE.x, y, FIRE.z);
    this.group.position.copy(this.position);
    const rand = mulberry32(404);

    // ash bed
    const ash = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 24).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 1, map: T.char }),
    );
    ash.position.y = 0.025;
    ash.receiveShadow = true;
    this.group.add(ash);

    // stone ring
    const stoneMat = new THREE.MeshStandardMaterial({ map: T.stone, normalMap: T.stoneNormal, vertexColors: true, roughness: 0.4 });
    const stones = [];
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + rand() * 0.2;
      const g = rockGeometry(500 + i, 2, 0.7, 0.15);
      const s = 0.17 + rand() * 0.07;
      g.scale(s * 1.2, s, s);
      g.rotateY(-a);
      g.translate(Math.cos(a) * 0.85, s * 0.35, Math.sin(a) * 0.85);
      stones.push(g);
    }
    const ring = new THREE.Mesh(merge(stones), stoneMat);
    ring.castShadow = true; ring.receiveShadow = true;
    this.group.add(ring);

    // charred log teepee with glowing cracks
    this.logMat = new THREE.MeshStandardMaterial({
      map: T.char, emissiveMap: T.charEmissive, emissive: new THREE.Color(1.0, 0.4, 0.12), emissiveIntensity: 2.2, roughness: 0.9,
    });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand() * 0.3;
      const len = 0.9 + rand() * 0.25;
      const g = new THREE.CylinderGeometry(0.045, 0.065, len, 7, 1);
      const log = new THREE.Mesh(g, this.logMat);
      log.position.set(Math.cos(a) * 0.32, len * 0.36, Math.sin(a) * 0.32);
      log.rotation.set(0, 0, 0);
      // lean toward the center
      const lean = 0.62 + rand() * 0.12;
      log.rotation.z = Math.cos(a) * lean;
      log.rotation.x = -Math.sin(a) * lean;
      log.castShadow = true;
      this.group.add(log);
    }
    // two half-burnt logs lying in the fire
    for (let i = 0; i < 2; i++) {
      const g = new THREE.CylinderGeometry(0.07, 0.08, 0.95, 8, 1);
      const log = new THREE.Mesh(g, this.logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = i * 1.4 + 0.3;
      log.position.y = 0.08;
      this.group.add(log);
    }

    // embers
    this.emberMat = new THREE.MeshStandardMaterial({ color: 0x2a1208, emissive: new THREE.Color(1.0, 0.32, 0.06), emissiveIntensity: 3, roughness: 0.8 });
    const embers = [];
    for (let i = 0; i < 26; i++) {
      const g = new THREE.IcosahedronGeometry(0.035 + rand() * 0.05, 0);
      const a = rand() * 6.28, d = Math.sqrt(rand()) * 0.42;
      g.translate(Math.cos(a) * d, 0.04, Math.sin(a) * d);
      embers.push(g);
    }
    this.group.add(new THREE.Mesh(merge(embers), this.emberMat));

    // glow disc
    const glowTex = T.soft;
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1.0, 0.35, 0.08), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.glow.position.y = 0.06;
    this.group.add(this.glow);

    // flames
    this.flames = new Flames({ count: 6, width: 0.95, height: 1.45, intensity: 1 });
    this.flames.group.position.y = 0.05;
    this.group.add(this.flames.group);

    // light
    this.light = new THREE.PointLight(0xff8a3a, 11, 26, 1.9);
    this.light.position.set(0, 0.9, 0);
    this.light.castShadow = false;
    this.group.add(this.light);
    this.baseLight = 11;

    // sparks & smoke live in world space
    this.sparks = new Sparks(90);
    this.sparks.origin.copy(this.position);
    this.smoke = new Smoke({ max: 46, rate: 5.5, origin: this.position.clone().add(new THREE.Vector3(0, 1.2, 0)), alpha: 0.2, color: 0x80868c });
    this.smoke.material.uniforms.uWarmK.value = 0.35;

    collision.addCircle(FIRE.x, FIRE.z, 1.05, 'fire');

    this.flicker = 1;
    this._fl = 0;
    this._sparkAcc = 0;
  }

  // called by the audio system when a loud pop is played
  pop(strength = 1) {
    this.sparks.emit(Math.floor(6 + strength * 14), 1 + strength * 0.4);
    this._popBoost = 0.35 * strength;
  }

  addTo(scene) {
    scene.add(this.group, this.sparks.points, this.smoke.mesh);
  }

  update(dt, time, camera, env) {
    // layered flicker: slow breathing + fast jitter
    const target = 0.82 + 0.1 * Math.sin(time * 1.7) + 0.07 * Math.sin(time * 6.1 + 1.3) + 0.05 * Math.sin(time * 13.7) + (Math.random() - 0.5) * 0.1;
    this._fl += (target - this._fl) * Math.min(1, dt * 14);
    this._popBoost = Math.max(0, (this._popBoost || 0) - dt * 1.5);
    this.flicker = this._fl + this._popBoost;
    this.light.intensity = this.baseLight * this.flicker * (env?.fireLightBoost ?? 1);
    this.light.position.x = Math.sin(time * 3.1) * 0.06;
    this.light.position.z = Math.cos(time * 2.7) * 0.06;
    this.emberMat.emissiveIntensity = 2.4 + 1.4 * this.flicker + Math.sin(time * 2) * 0.4;
    this.logMat.emissiveIntensity = 1.6 + 1.2 * this.flicker;
    this.glow.material.opacity = 0.35 + 0.25 * this.flicker;
    this.flames.update(time, camera, this.flicker);

    this._sparkAcc += dt * 2.5;
    if (this._sparkAcc > 1) { this.sparks.emit(1); this._sparkAcc = 0; }
    this.sparks.update(dt, time);
    this.smoke.material.uniforms.uLight.value = env ? env.ambientLevel * 0.9 + 0.08 : 1;
    this.smoke.update(dt, time, windUniforms.uWind.value);
  }
}
