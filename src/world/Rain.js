import * as THREE from 'three';
import { windUniforms } from '../core/shaderPatches.js';
import { mulberry32 } from '../utils/noise.js';

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
      // roofed rectangles (minX, minZ, maxX, maxZ) and their heights
      // (at the edges / in the middle); unused slots are empty
      uShelter: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(1e9, 1e9, -1e9, -1e9)) },
      uShelterY: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(0, 0)) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uLen; uniform float uIntensity;
        uniform vec4 uShelter[4]; uniform vec2 uShelterY[4];
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
          // no rain under the tarp
          for (int i = 0; i < 4; i++) {
            vec4 S = uShelter[i];
            vec2 sc = (S.xy + S.zw) * 0.5, sh = max((S.zw - S.xy) * 0.5, vec2(1e-3));
            vec2 sd = abs(p.xz - sc) / sh;
            float roofY = mix(uShelterY[i].y, uShelterY[i].x, max(sd.x, sd.y)); // high middle, low edges
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
  // {minX, maxX, minZ, maxZ, y: height at the edges, peak: height in the middle}
  setShelters(list) {
    this.shelters = list.slice(0, 4);
    this.shelters.forEach((s, i) => {
      this.uniforms.uShelter.value[i].set(s.minX, s.minZ, s.maxX, s.maxZ);
      this.uniforms.uShelterY.value[i].set(s.y, s.peak ?? s.y);
    });
  }

  setPixelRatio(pr) { this.splashMat.uniforms.uPixel.value = pr; }

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
    u.uOpacity.value = 0.16 + 0.18 * l;

    // splashes around the player
    const cx = camera.position.x, cz = camera.position.z;
    for (let i = 0; i < this.splashCount; i++) {
      const s = this.sp[i];
      s.life -= dt;
      if (s.life <= 0) {
        const a = Math.random() * Math.PI * 2, r = 2.0 + Math.sqrt(Math.random()) * 12;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (this.shelters?.some((sh) => x > sh.minX && x < sh.maxX && z > sh.minZ && z < sh.maxZ)) { s.life = 0.1; this.spLife[i] = 0; continue; }
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
