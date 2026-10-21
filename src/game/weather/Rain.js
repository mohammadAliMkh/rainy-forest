import * as THREE from 'three';
import { windUniforms } from '../../engine/render/shaderPatches.js';
import { mulberry32 } from '../../utils/noise.js';

// Very fine, gentle rain. Thousands of thin streaks are animated entirely on
// the GPU inside a box that follows the camera (world-anchored wrap, so the
// rain doesn't "move with you"). Tiny splashes appear on the ground nearby.

export class Rain {
  constructor(terrain, { count = 14000 } = {}) {
    this.terrain = terrain;
    const rand = mulberry32(77);
    const pos = new Float32Array(count * 2 * 3);
    const speed = new Float32Array(count * 2);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = rand(), y = rand(), z = rand();
      const s = 4.5 + rand() * 2.5;
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos[j * 3] = x; pos[j * 3 + 1] = y; pos[j * 3 + 2] = z;
        speed[j] = s;
        end[j] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(34, 20, 34) },
      uWind: { value: new THREE.Vector2() },
      uLen: { value: 0.32 },
      uColor: { value: new THREE.Color(0.75, 0.8, 0.85) },
      uOpacity: { value: 0.32 },
      uIntensity: { value: 1 },
      // roofed rectangles: centre x / z and half sizes, their turn (cos, sin)
      // and roof heights (at the edges, in the middle, shape: 0 = rising to a
      // peak in the middle, 1 = a ridge along the local z axis); unused slots are empty
      uShelter: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1e9, 1e9, 0, 0)) },
      uShelterRot: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(1, 0)) },
      uShelterY: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, 0)) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uLen; uniform float uIntensity;
        uniform vec4 uShelter[4]; uniform vec2 uShelterRot[4]; uniform vec3 uShelterY[4];
        attribute float aSpeed; attribute float aEnd;
        varying float vAlpha; varying float vEnd;
        void main(){
          vec3 p = position * uBox;
          p.y -= uTime * aSpeed;
          p.xz += uTime * uWind;
          vec3 origin = uCam - uBox * 0.5;
          p = origin + mod(p - origin, uBox);
          vec3 dir = normalize(vec3(uWind.x, -aSpeed, uWind.y));
          p += dir * uLen * aEnd;
          float dist = length(p - uCam);
          // fewer drops when intensity is low (hash on the start position)
          float keep = step(fract(position.x * 91.7 + position.z * 37.3), uIntensity);
          vAlpha = keep * (1.0 - smoothstep(uBox.x * 0.25, uBox.x * 0.5, dist)) * smoothstep(0.25, 1.1, dist);
          // no rain under the roofs
          for (int i = 0; i < 4; i++) {
            vec4 S = uShelter[i];
            vec2 q = p.xz - S.xy, r = uShelterRot[i];
            vec2 sd = abs(vec2(q.x * r.x - q.y * r.y, q.x * r.y + q.y * r.x)) / max(S.zw, vec2(1e-3));
            float across = mix(max(sd.x, sd.y), sd.x, uShelterY[i].z);
            float roofY = mix(uShelterY[i].y, uShelterY[i].x, across); // high middle, low edges
            if (max(sd.x, sd.y) < 1.0 && p.y < roofY) vAlpha = 0.0;
          }
          vEnd = aEnd;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying float vAlpha; varying float vEnd;
        void main(){
          gl_FragColor = vec4(uColor, uOpacity * vAlpha * (1.0 - vEnd * 0.85));
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.lines = new THREE.LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 8;

    // ---- splashes ----
    this.splashCount = 260;
    this.sp = [];
    const spPos = new Float32Array(this.splashCount * 3);
    const spLife = new Float32Array(this.splashCount);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
    sgeo.setAttribute('aLife', new THREE.BufferAttribute(spLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.splashMat = new THREE.ShaderMaterial({
      uniforms: { uColor: this.uniforms.uColor, uPixel: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aLife; uniform float uPixel; varying float vLife;
        void main(){
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(7.0 * uPixel, (0.035 + (1.0 - aLife) * 0.05) * uPixel * 600.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vLife;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c) * 2.0;
          float ring = smoothstep(0.5, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
          float dotc = 1.0 - smoothstep(0.0, 0.35, r);
          float a = (ring * 0.7 + dotc * vLife * 0.4) * vLife * 0.16;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    for (let i = 0; i < this.splashCount; i++) this.sp.push({ life: 0, max: 0.2 });
    this.splashes = new THREE.Points(sgeo, this.splashMat);
    this.splashes.frustumCulled = false;
    this.spPos = spPos; this.spLife = spLife;
  }

  addTo(scene) { scene.add(this.lines, this.splashes); }

  // keep drops and splashes out of roofed rectangles (up to 4):
  // {minX, maxX, minZ, maxZ} or {x, z, hx, hz, yaw} (turned), with
  // y: height at the edges, peak: height in the middle, ridge: true for a
  // gable roof whose ridge runs along the local z axis
  setShelters(list) {
    this.shelters = list.slice(0, 4).map((s) => {
      const box = s.hx !== undefined ? s : { x: (s.minX + s.maxX) / 2, z: (s.minZ + s.maxZ) / 2, hx: (s.maxX - s.minX) / 2, hz: (s.maxZ - s.minZ) / 2 };
      const yaw = s.yaw ?? 0;
      return { ...box, c: Math.cos(yaw), s: Math.sin(yaw) };
    });
    this.shelters.forEach((sh, i) => {
      const src = list[i];
      this.uniforms.uShelter.value[i].set(sh.x, sh.z, sh.hx, sh.hz);
      this.uniforms.uShelterRot.value[i].set(sh.c, sh.s);
      this.uniforms.uShelterY.value[i].set(src.y, src.peak ?? src.y, src.ridge ? 1 : 0);
    });
  }

  // is a point under one of the roofs?
  _sheltered(x, z) {
    return this.shelters?.some((sh) => {
      const dx = x - sh.x, dz = z - sh.z;
      return Math.abs(dx * sh.c - dz * sh.s) < sh.hx && Math.abs(dx * sh.s + dz * sh.c) < sh.hz;
    });
  }

  setPixelRatio(pr) { this.splashMat.uniforms.uPixel.value = pr; }

  // how hard it rains, 0 (dry) .. 1 (heavy): fewer, fainter drops and fewer splashes
  setIntensity(x) {
    this.intensity = x;
    this.uniforms.uIntensity.value = x;
    this.lines.visible = this.splashes.visible = x > 0.005;
  }

  update(dt, time, camera, env) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    const w = windUniforms.uWind.value;
    const d = windUniforms.uWindDir.value;
    u.uWind.value.set(d.x * w * 0.9, d.y * w * 0.9);
    // rain is lit by the sky (and very faintly visible at night)
    const l = env ? env.ambientLevel : 1;
    u.uColor.value.setRGB(0.07 + 0.68 * l, 0.08 + 0.72 * l, 0.1 + 0.74 * l);
    u.uOpacity.value = (0.16 + 0.18 * l) * (0.65 + 0.35 * (this.intensity ?? 1));

    // splashes around the player
    const cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < this.splashCount; i++) {
      const s = this.sp[i];
      s.life -= dt;
      if (s.life <= 0) {
        if (Math.random() > (this.intensity ?? 1)) { s.life = 0.1; this.spLife[i] = 0; continue; }
        const a = Math.random() * Math.PI * 2, r = 2.0 + Math.sqrt(Math.random()) * 12;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (this._sheltered(x, z)) { s.life = 0.1; this.spLife[i] = 0; continue; }
        this.spPos[i * 3] = x;
        this.spPos[i * 3 + 1] = this.terrain.heightAt(x, z) + 0.03;
        this.spPos[i * 3 + 2] = z;
        s.max = 0.12 + Math.random() * 0.18;
        s.life = s.max + Math.random() * 0.4;
      }
      this.spLife[i] = s.life < s.max ? s.life / s.max : 0;
    }
    this.splashes.geometry.attributes.position.needsUpdate = true;
    this.splashes.geometry.attributes.aLife.needsUpdate = true;
  }
}
