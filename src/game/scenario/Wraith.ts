import * as THREE from 'three';

// The wandering ghost's true shape: a tall, see-through spectre that glows
// at its edges - a hood with nothing but darkness (and two faint red
// sparks) inside, arms held out in wide sleeves, and a long robe that
// streams back and down into wisps as if a wind were always blowing
// through it. It can also be a whirlwind: a twisting column of the same
// pale light, narrow at the bottom and wide at the top. `form` goes from 0
// (whirlwind) to 1 (the spectre); in between the swirl gathers itself into
// the figure.
// The surface is one parametric sheet (around u, down v) rebuilt every
// frame, so the cloth can stream and the two shapes can blend; it glows
// by its rim (bright where it is seen edge-on, faint where face-on), adds
// its light to what is behind it, and thins into strands toward the hem.

const NU = 64, NV = 52;
const H = 2.15; // top of the hood above the ground point
const RH = 0.19; // hood radius
const HOOD = 0.17; // share of the surface that is the hood
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** where the ghost is and how it moves (set by the scene every frame) */
export interface WraithPose {
  x: number; z: number;
  /** which way it faces (radians, 0 = +z) */
  heading: number;
  /** how high it floats */
  lift: number;
  /** 0 = whirlwind .. 1 = the spectre */
  form: number;
  /** 0..1 arms held out */
  arms: number;
  opacity: number;
  /** how wildly the cloth streams (1 = normal) */
  wind: number;
}

/** the spectre: hood, shoulders, sleeves held out, the robe streaming back */
function robe(u: number, v: number, t: number, arms: number, wind: number, out: THREE.Vector3): number {
  const th = u * Math.PI * 2;
  const s = Math.sin(th), c = Math.cos(th);
  let r: number, y: number, dz = 0, dx = 0;
  if (v <= HOOD) {
    // the hood: a rounded dome, a little pointed, drawn forward over the face
    const phi = (v / HOOD) * Math.PI * 0.55;
    r = RH * Math.sin(phi) * 1.15;
    y = H - RH * (1 - Math.cos(phi)) * 1.25 + (1 - v / HOOD) * 0.03;
    dz = 0.035 * Math.max(0, c) * (v / HOOD);
  } else {
    const k = (v - HOOD) / (1 - HOOD); // 0 at the neck, 1 at the end of the trailing wisps
    y = lerp(H - RH * 1.4, -0.6, k);
    // slender: the neck, narrow shoulders, a slim body, then the gown flaring toward the hem
    r = lerp(0.09, 0.18, sstep(0, 0.07, k)) - 0.025 * sstep(0.1, 0.3, k) + 0.2 * Math.pow(sstep(0.3, 0.85, k), 1.3);
    // tapering again at the very end, into the trailing wisps
    r *= 1 - 0.45 * sstep(0.78, 1, k);
    // the arms held out and a little down, the wide sleeves hanging from them to the hips
    const side = Math.pow(Math.abs(s), 6);
    // out to the hands at the top, the sleeve's cloth then narrowing in a long point down to the hips
    const reach = sstep(0.02, 0.11, k) * Math.pow(1 - sstep(0.11, 0.62, k), 1.4);
    const arm = arms * side * reach;
    r += arm * 0.85;
    y += arm * 0.05 - arms * side * sstep(0.11, 0.45, k) * 0.2;
    // the gown streams back (-z) and down, rippling, in long ragged tongues
    const lower = sstep(0.35, 1, k);
    const tongue = 0.5 + 0.5 * Math.sin(th * 5 + 1.3 * Math.sin(th * 3));
    dz = -Math.pow(lower, 1.5) * (0.8 + 0.4 * tongue) * wind;
    y -= lower * lower * 0.3 * tongue;
    const ripple = Math.sin(th * 6 + t * 2.1 - k * 7) * 0.05 + Math.sin(th * 3 - t * 1.4 + k * 4) * 0.04;
    r *= 1 + ripple * (0.3 + lower) * wind;
    dx = Math.sin(t * 0.9 + k * 3) * 0.14 * lower * lower * wind;
    // folds down the gown
    r *= 1 + 0.06 * Math.sin(th * 9 + k * 2) * sstep(0.1, 0.6, k);
  }
  out.set(s * r + dx, y, c * r + dz);
  // how solid this part is: the hood and shoulders full, thinning out toward the hem,
  // and the cloth hanging from the sleeves thin and wispy
  if (v <= HOOD) return 1;
  const k = (v - HOOD) / (1 - HOOD);
  return (1 - sstep(0.5, 1, k) * 0.92) * (1 - Math.pow(Math.abs(s), 6) * sstep(0.22, 0.5, k) * 0.7);
}

/** the whirlwind: a twisting funnel, narrow at the ground, wide high up, swaying */
function funnel(u: number, v: number, t: number, out: THREE.Vector3): number {
  const h = 1 - v; // 1 at the top
  const th = u * Math.PI * 2 + h * 5.5 + t * 6.5;
  const r = lerp(0.07, 1.0, Math.pow(h, 1.6)) * (1 + 0.16 * Math.sin(u * Math.PI * 6 + t * 5 + v * 9));
  const cx = Math.sin(t * 1.7 + v * 3.2) * 0.12 * h, cz = Math.cos(t * 1.3 + v * 2.6) * 0.1 * h;
  out.set(Math.sin(th) * r + cx, h * 2.5 - 0.05, Math.cos(th) * r + cz);
  return 0.55 + 0.45 * (1 - h * 0.5);
}

const VERT = /* glsl */ `
  attribute float aSolid;
  varying float vSolid;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vSolid = aSolid;
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    vNormalV = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSwirl;
  varying float vSolid;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vec3 view = normalize(-vViewPos);
    float facing = abs(dot(normalize(vNormalV), view));
    // bright where the cloth is seen edge-on, faint where face-on
    float rim = pow(1.0 - facing, 2.6);
    // strands running down the cloth (and round the whirlwind), drifting
    float strands = 0.5 + 0.5 * sin(vUv.x * 6.2832 * 11.0 + sin(vUv.y * 9.0 - uTime * 1.3) * 2.0 + uTime * uSwirl);
    float wisp = mix(1.0, 0.35 + 0.65 * strands, clamp(1.15 - vSolid, 0.0, 1.0));
    float a = (0.035 + 0.95 * rim) * vSolid * wisp * uOpacity;
    vec3 col = uColor * (0.6 + 1.4 * rim);
    gl_FragColor = vec4(col, a); // (added as col * a)
  }
`;

export class Wraith {
  readonly group = new THREE.Group();
  readonly pose: WraithPose = { x: 0, z: 0, heading: 0, lift: 0.25, form: 1, arms: 1, opacity: 1, wind: 1 };
  private readonly body: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly solid: Float32Array;
  private readonly face: THREE.Mesh;
  private readonly eyes: THREE.Sprite[] = [];
  private readonly eyeMat: THREE.SpriteMaterial;
  private readonly motes: THREE.Points;
  private readonly moteSeed: Float32Array;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private time = 0;
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();

  constructor(terrain: { heightAt(x: number, z: number): number }) {
    this.terrain = terrain;
    // the sheet: (NU + 1) x (NV + 1), the seam column repeats the first
    const geo = new THREE.BufferGeometry();
    const n = (NU + 1) * (NV + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const uv = new Float32Array(n * 2);
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { const k = j * (NU + 1) + i; uv[k * 2] = i / NU; uv[k * 2 + 1] = j / NV; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.solid = new Float32Array(n);
    geo.setAttribute('aSolid', new THREE.BufferAttribute(this.solid, 1));
    const idx: number[] = [];
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uColor: { value: new THREE.Color(0xcfe3ff) }, uTime: { value: 0 }, uOpacity: { value: 1 }, uSwirl: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, // its own light, added to what is behind it
    });
    this.body = new THREE.Mesh(geo, this.mat);
    this.body.frustumCulled = false;
    this.body.renderOrder = 3;
    this.group.add(this.body);

    // nothing but darkness inside the hood
    this.face = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x010203, fog: false, transparent: true }));
    this.face.scale.set(0.105, 0.14, 0.05);
    this.face.position.set(0, H - RH * 1.05, RH * 0.92);
    this.face.renderOrder = 2;
    this.group.add(this.face);
    // two faint red sparks deep in it
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,220,200,1)'); gr.addColorStop(0.2, 'rgba(255,40,20,0.9)'); gr.addColorStop(1, 'rgba(120,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const glow = new THREE.CanvasTexture(c);
    glow.colorSpace = THREE.SRGBColorSpace;
    this.eyeMat = new THREE.SpriteMaterial({ map: glow, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true });
    for (const sx of [-1, 1]) {
      const e = new THREE.Sprite(this.eyeMat);
      e.position.set(sx * 0.04, H - RH * 1.0, RH * 1.18);
      e.scale.setScalar(0.06);
      e.renderOrder = 4;
      this.eyes.push(e);
      this.group.add(e);
    }

    // pale motes of light: whirling in the funnel, drifting round the spectre
    const M = 60;
    this.moteSeed = new Float32Array(M * 3);
    for (let i = 0; i < M * 3; i++) this.moteSeed[i] = Math.random();
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    const mc = document.createElement('canvas');
    mc.width = mc.height = 32;
    const mx = mc.getContext('2d')!;
    const mgr = mx.createRadialGradient(16, 16, 0, 16, 16, 16);
    mgr.addColorStop(0, 'rgba(230,240,255,1)'); mgr.addColorStop(1, 'rgba(160,190,255,0)');
    mx.fillStyle = mgr; mx.fillRect(0, 0, 32, 32);
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({
      size: 0.045, map: new THREE.CanvasTexture(mc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xdbe8ff,
    }));
    this.motes.frustumCulled = false;
    this.group.add(this.motes);
    this.group.visible = false;
  }

  show(on: boolean): void { this.group.visible = on; }

  /** the top of the hood (world) */
  headWorld(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.localToWorld(target.set(0, H - RH, 0));
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const t = this.time, P = this.pose;
    const f = Math.min(1, Math.max(0, P.form));
    const e = f * f * (3 - 2 * f);
    const g = this.group;
    g.position.set(P.x, this.terrain.heightAt(P.x, P.z) + P.lift * e, P.z);
    // a whirlwind spins as a whole; as it gathers into the figure it slows and turns to face its way
    g.rotation.set(0, P.heading + (1 - e) * (1 - e) * t * 4, 0);
    // the sheet: the two shapes blended
    const pos = this.body.geometry.attributes.position as THREE.BufferAttribute;
    const A = this._a, B = this._b;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NU; i++) {
        const u = (i % NU) / NU, k = j * (NU + 1) + i;
        const sa = e < 1 ? funnel(u, v, t, A) : 0;
        const sb = e > 0 ? robe(u, v, t, P.arms, P.wind, B) : 0;
        if (e <= 0) pos.setXYZ(k, A.x, A.y, A.z);
        else if (e >= 1) pos.setXYZ(k, B.x, B.y, B.z);
        else pos.setXYZ(k, lerp(A.x, B.x, e), lerp(A.y, B.y, e), lerp(A.z, B.z, e));
        this.solid[k] = lerp(sa, sb, e);
      }
    }
    pos.needsUpdate = true;
    (this.body.geometry.attributes.aSolid as THREE.BufferAttribute).needsUpdate = true;
    this.body.geometry.computeVertexNormals();
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uOpacity.value = P.opacity;
    this.mat.uniforms.uSwirl.value = (1 - e) * 9;
    // the dark face and its sparks only once it has a face
    const faced = sstep(0.7, 1, f) * P.opacity;
    this.face.visible = faced > 0.02;
    (this.face.material as THREE.MeshBasicMaterial).opacity = faced;
    this.eyeMat.opacity = faced * (0.75 + 0.25 * Math.sin(t * 2.3));
    for (const s of this.eyes) s.visible = faced > 0.02;
    // the motes
    const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const sd = this.moteSeed;
    for (let i = 0; i < mp.count; i++) {
      const a = sd[i * 3] * Math.PI * 2, h = sd[i * 3 + 1], sp = 0.5 + sd[i * 3 + 2];
      // in the funnel: whirling round at its radius, rising
      const hy = (h + t * 0.25 * sp) % 1;
      const fr = lerp(0.07, 1.05, Math.pow(hy, 1.6)), fa = a + t * 6 * sp + hy * 5.5;
      // round the spectre: drifting up and back along the robe, slowly
      const ry = ((h + t * 0.06 * sp) % 1);
      const rr = 0.25 + 0.35 * (1 - ry), ra = a + t * 0.4 * sp;
      mp.setXYZ(i,
        lerp(Math.sin(fa) * fr, Math.sin(ra) * rr, e),
        lerp(hy * 2.5, -0.3 + ry * 2.3, e),
        lerp(Math.cos(fa) * fr, Math.cos(ra) * rr - (1 - ry) * 0.5, e));
    }
    mp.needsUpdate = true;
    (this.motes.material as THREE.PointsMaterial).opacity = P.opacity * lerp(0.9, 0.55, e);
  }
}
