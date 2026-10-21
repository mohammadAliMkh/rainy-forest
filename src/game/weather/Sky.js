import * as THREE from 'three';

// Overcast sky dome with slowly drifting clouds, a sun/moon glow diffused
// through the cloud layer and a few stars visible through gaps at night.
// uCover thins the clouds in dry weather; uFlash lights them softly from
// behind when there is a distant lightning flash (toward uFlashDir).

export class Sky {
  constructor() {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunGlow: { value: 0.4 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCover: { value: 1 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(1, 0.3, 0) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uBottom, uSunColor, uSunDir, uMoonDir;
        uniform float uSunGlow, uStars, uTime, uCover, uFlash;
        uniform vec3 uFlashDir;
        varying vec3 vDir;
        float h21(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
        float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p *= 2.07; a *= 0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.6, h));
          col = mix(col, uBottom, smoothstep(0.0, -0.25, h));
          // cloud deck
          vec2 cp = d.xz / max(h + 0.12, 0.06) * 0.9;
          cp += vec2(uTime * 0.006, uTime * 0.0035);
          float c = fbm(cp * 1.4);
          float c2 = fbm(cp * 4.3 + 7.0);
          float cloud = smoothstep(0.38 + (1.0 - uCover) * 0.14, 0.78, c * 0.75 + c2 * 0.3);
          vec3 cloudDark = mix(uTop, uHorizon, 0.35) * 0.78;
          vec3 cloudLight = uHorizon * 1.04;
          vec3 cc = mix(cloudLight, cloudDark, cloud);
          float cloudVis = smoothstep(-0.02, 0.18, h);
          col = mix(col, cc, cloudVis * 0.75);
          // diffuse sun / moon glow through clouds
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          float thin = 1.0 - cloud * 0.55;
          col += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.35) * uSunGlow * thin;
          float md = max(dot(d, normalize(uMoonDir)), 0.0);
          col += vec3(0.5, 0.6, 0.8) * pow(md, 30.0) * 0.08 * uStars * thin;
          // stars through gaps
          if (uStars > 0.001) {
            vec3 sp = floor(d * 380.0);
            float st = step(0.9975, h31(sp));
            float tw = 0.6 + 0.4 * sin(uTime * 3.0 + h31(sp + 1.0) * 40.0);
            col += vec3(0.8, 0.85, 1.0) * st * tw * uStars * (1.0 - smoothstep(0.2, 0.55, cloud)) * smoothstep(0.08, 0.35, h) * 0.6;
          }
          // lightning: the clouds glow from inside, mostly toward the flash
          if (uFlash > 0.001) {
            float fd = max(dot(d, normalize(uFlashDir)), 0.0);
            col += vec3(0.78, 0.82, 0.95) * uFlash * (0.25 + 0.75 * pow(fd, 3.0)) * (0.4 + 0.6 * cloud) * cloudVis;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.material = material;
  }

  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
  }
}
