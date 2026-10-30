import * as THREE from 'three';

// The wandering ghost's true shape: a tall, see-through spectre that glows
// at its edges - a hood with nothing but darkness (and two faint red
// sparks) inside, arms held out in wide sleeves, and a long robe that
// streams back and down into wisps as if a wind were always blowing
// through it. It can also be a whirlwind: a twisting column of the same
// pale light, narrow at the bottom and wide at the top. `form` goes from 0
// (whirlwind) to 1 (the spectre); in between the swirl gathers itself into
// the figure.
// `appear()` plays its coming: a small knot spinning low down that rises
// into the whirlwind, which gathers into the spectre; `vanish()` the same
// backwards - into the whirlwind, shrinking, spinning ever faster, gone.
// The surface is one parametric sheet (around u, down v) rebuilt every
// frame, so the cloth can stream and the two shapes can blend; it glows
// by its rim (bright where it is seen edge-on, faint where face-on), adds
// its light to what is behind it, and thins into strands toward the hem.

const NU = 64, NV = 52;
const H = 2.15; // top of the hood above the ground point
const RH = 0.2; // hood radius
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
  /** the height it stands on (world), or null: the ground under it (e.g. the jar's mouth on the porch) */
  base: number | null;
  /** 0 = whirlwind .. 1 = the spectre */
  form: number;
  /** the whirlwind: 0 = a small knot spinning low down .. 1 = full height */
  grow: number;
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
  // the face: a hollow in the front of the hood, from the brow down to the chin
  const front = sstep(0.72, 0.93, c);
  if (v <= HOOD) {
    // the hood: a cloak thrown over the head - a tall, slightly pointed cowl
    // whose brim comes forward round a deep opening
    const q = v / HOOD, phi = q * Math.PI * 0.5;
    r = RH * Math.sin(phi);
    y = H - RH * (1 - Math.cos(phi)) * 1.6 + (1 - q) * (1 - q) * 0.07;
    dz = 0.1 * Math.pow(Math.max(0, c), 1.5) * sstep(0.25, 0.8, q);
    // the opening: the cloth there is drawn far back, leaving the brim round it
    const hollow = front * sstep(0.42, 0.62, q);
    r *= 1 - 0.85 * hollow;
    dz *= 1 - hollow;
  } else {
    const k = (v - HOOD) / (1 - HOOD); // 0 at the neck, 1 at the end of the trailing wisps
    y = lerp(H - RH * 1.6, -0.6, k);
    // the cloak falling from the hood onto the shoulders (no neck), a slim body,
    // then the gown flaring toward the hem
    r = lerp(RH, 0.22, sstep(0, 0.08, k)) - 0.04 * sstep(0.1, 0.3, k) + 0.2 * Math.pow(sstep(0.3, 0.85, k), 1.3);
    // the hollow goes on down to the chin, then the cloak closes under it
    const chin = front * (1 - sstep(0.015, 0.05, k));
    r *= 1 - 0.85 * chin;
    // the hood's brim runs on down the front edges of the cloak
    dz = 0.1 * Math.pow(Math.max(0, c), 1.5) * (1 - chin) * (1 - sstep(0.02, 0.1, k));
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
    dz += -Math.pow(lower, 1.5) * (0.8 + 0.4 * tongue) * wind;
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

/**
 * the whirlwind: a twisting funnel, narrow at the bottom, wide high up, swaying.
 * `grow` 0..1: it starts as a small knot spinning low down and rises into its full height
 */
function funnel(u: number, v: number, t: number, grow: number, out: THREE.Vector3): number {
  const h = 1 - v; // 1 at the top
  const g = Math.max(0.04, grow);
  const th = u * Math.PI * 2 + h * 5.5 + t * (6.5 + 4 * (1 - g));
  const r = lerp(0.05, 1.0, Math.pow(h, 1.6)) * (0.18 + 0.82 * g) * (1 + 0.16 * Math.sin(u * Math.PI * 6 + t * 5 + v * 9));
  const cx = Math.sin(t * 1.7 + v * 3.2) * 0.12 * h * g, cz = Math.cos(t * 1.3 + v * 2.6) * 0.1 * h * g;
  out.set(Math.sin(th) * r + cx, h * 2.5 * Math.pow(g, 0.85), Math.cos(th) * r + cz);
  return 0.55 + 0.45 * (1 - h * 0.5);
}

/** a glowing slit eye; `side` -1 / +1: which eye (they slant down toward each other) */
function eyeTexture(side: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.translate(64, 32);
  g.rotate(-0.38 * side); // the inner corner low, the outer one high
  const almond = (w: number, h: number) => {
    g.beginPath();
    g.moveTo(-w, h * 0.15);
    g.quadraticCurveTo(-w * 0.1, -h * 1.1, w, -h * 0.35); // the upper lid, nearly straight and hard
    g.quadraticCurveTo(w * 0.05, h * 0.9, -w, h * 0.15);
    g.closePath();
    g.fill();
  };
  g.shadowColor = 'rgba(255,30,10,1)';
  g.shadowBlur = 14;
  g.fillStyle = 'rgba(220,20,8,1)';
  almond(46, 15);
  g.shadowBlur = 6;
  g.fillStyle = 'rgba(255,120,60,1)';
  almond(34, 8);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,235,200,1)';
  almond(20, 3.5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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
  readonly pose: WraithPose = { x: 0, z: 0, heading: 0, lift: 0.25, base: null, form: 1, grow: 1, arms: 1, opacity: 1, wind: 1 };
  private readonly body: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly solid: Float32Array;
  private readonly face: THREE.Mesh;
  private readonly eyes: THREE.Sprite[] = [];
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
    this.face = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false, transparent: true }));
    this.face.scale.set(0.12, 0.16, 1);
    this.face.position.set(0, H - RH * 1.25, RH * 0.55);
    this.face.renderOrder = 2;
    this.group.add(this.face);
    // two red eyes in it: long, narrow slits slanting down toward the middle - an angry glare
    for (const sx of [-1, 1]) {
      const e = new THREE.Sprite(new THREE.SpriteMaterial({ map: eyeTexture(sx), blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true }));
      e.position.set(sx * 0.05, H - RH * 1.05, RH * 0.6);
      e.scale.set(0.12, 0.06, 1);
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

  /** coming or going on its own (appear / vanish), and what to do when that is over */
  private act: { kind: 'appear' | 'vanish'; t: number; onDone?: () => void } | null = null;

  /** it comes: a small knot spinning low down rises into the whirlwind, which gathers into the spectre (~6.5 s) */
  appear(onDone?: () => void): void {
    Object.assign(this.pose, { grow: 0, form: 0, opacity: 1 });
    this.show(true);
    this.act = { kind: 'appear', t: 0, onDone };
  }

  /** it goes, the way it came: back into the whirlwind, which shrinks spinning ever faster to nothing (~3 s) */
  vanish(onDone?: () => void): void {
    this.act = { kind: 'vanish', t: 0, onDone };
  }

  /** coming or going */
  get busy(): boolean { return !!this.act; }

  private _act(dt: number): void {
    const a = this.act!, P = this.pose;
    a.t += dt;
    const t = a.t;
    let done: boolean;
    if (a.kind === 'appear') {
      P.grow = sstep(0, 3, t);
      P.form = sstep(4.2, 6.7, t);
      P.opacity = 1;
      done = t >= 6.7;
    } else {
      P.form = 1 - sstep(0, 1.3, t);
      P.grow = 1 - sstep(1.2, 2.8, t);
      P.opacity = 1 - sstep(2.3, 3, t);
      done = t >= 3;
    }
    if (done) {
      this.act = null;
      if (a.kind === 'vanish') this.show(false);
      a.onDone?.();
    }
  }

  /** the top of the hood (world) */
  headWorld(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.localToWorld(target.set(0, H - RH, 0));
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    if (this.act) this._act(dt);
    const t = this.time, P = this.pose;
    const f = Math.min(1, Math.max(0, P.form));
    const e = f * f * (3 - 2 * f);
    const g = this.group;
    g.position.set(P.x, (P.base ?? this.terrain.heightAt(P.x, P.z)) + P.lift * e, P.z);
    // a whirlwind spins as a whole; as it gathers into the figure it slows and turns to face its way
    g.rotation.set(0, P.heading + (1 - e) * (1 - e) * t * 4, 0);
    // the sheet: the two shapes blended
    const pos = this.body.geometry.attributes.position as THREE.BufferAttribute;
    const A = this._a, B = this._b;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NU; i++) {
        const u = (i % NU) / NU, k = j * (NU + 1) + i;
        const sa = e < 1 ? funnel(u, v, t, P.grow, A) : 0;
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
    for (const s of this.eyes) {
      s.visible = faced > 0.02;
      (s.material as THREE.SpriteMaterial).opacity = faced * (0.8 + 0.2 * Math.sin(t * 2.3));
    }
    // the motes
    const mp = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    const sd = this.moteSeed;
    for (let i = 0; i < mp.count; i++) {
      const a = sd[i * 3] * Math.PI * 2, h = sd[i * 3 + 1], sp = 0.5 + sd[i * 3 + 2];
      // in the funnel: whirling round at its radius, rising
      const hy = (h + t * 0.25 * sp) % 1;
      const gr = Math.max(0.04, P.grow);
      const fr = lerp(0.05, 1.05, Math.pow(hy, 1.6)) * (0.18 + 0.82 * gr), fa = a + t * 6 * sp + hy * 5.5;
      // round the spectre: drifting up and back along the robe, slowly
      const ry = ((h + t * 0.06 * sp) % 1);
      const rr = 0.25 + 0.35 * (1 - ry), ra = a + t * 0.4 * sp;
      mp.setXYZ(i,
        lerp(Math.sin(fa) * fr, Math.sin(ra) * rr, e),
        lerp(hy * 2.5 * Math.pow(gr, 0.85), -0.3 + ry * 2.3, e),
        lerp(Math.cos(fa) * fr, Math.cos(ra) * rr - (1 - ry) * 0.5, e));
    }
    mp.needsUpdate = true;
    (this.motes.material as THREE.PointsMaterial).opacity = P.opacity * lerp(0.9, 0.55, e);
  }
}
