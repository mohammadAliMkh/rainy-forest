import * as THREE from 'three';

// A friendly bedsheet ghost: a white sheet over a round head, flaring into
// a wavy, fluttering hem, with a painted face that changes with its mood
// (sly while it sneaks, a big open "BOO!" mouth, a happy grin when it
// laughs). Lifting its arms pulls the sheet up into two draped wings.
// The sheet is a parametric surface rebuilt every frame (a few thousand
// vertices) so the cloth can ripple, puff up and lift.

export type GhostFace = 'sly' | 'boo' | 'happy';

/** where the ghost is and how it holds itself (set by the scenario every frame) */
export interface GhostPose {
  x: number; z: number;
  /** which way it faces (radians, 0 = +z) */
  heading: number;
  /** float height of the hem above the ground */
  lift: number;
  /** forward lean / sideways tilt (radians) */
  lean: number; tilt: number;
  /** 0..1 arms raised under the sheet */
  arms: number;
  /** 0..1 puffed up for the "BOO!" */
  puff: number;
  opacity: number;
  face: GhostFace;
}

const H = 1.62; // top of the head above the hem
const RH = 0.29; // head radius
const R_HEM = 0.6; // hem radius
const V_HEAD = 0.26; // share of the surface that is the head dome
const NU = 72, NV = 44; // around / down
const FACE_U = 0.16, FACE_V0 = 0.07, FACE_V1 = 0.46; // face patch: half width around the front, top / bottom

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** a point of the sheet: angle around (u 0..1, 0 = front), down from the top (v 0..1) */
function sheet(u: number, v: number, t: number, arms: number, puff: number, out: THREE.Vector3, outward = 0): THREE.Vector3 {
  const th = u * Math.PI * 2;
  let r: number, y: number;
  if (v <= V_HEAD) {
    const phi = (v / V_HEAD) * (Math.PI / 2);
    r = RH * Math.sin(phi);
    y = H - RH * (1 - Math.cos(phi));
  } else {
    const k = (v - V_HEAD) / (1 - V_HEAD);
    r = RH + (R_HEM - RH) * Math.pow(sstep(0, 1, k * 1.05), 0.9) * (0.75 + 0.25 * k);
    y = (H - RH) * (1 - k);
  }
  const lower = sstep(V_HEAD, 1, v); // 0 on the head, 1 at the hem
  // vertical folds, a scalloped hem and a slow flutter
  r *= 1 + (0.07 * Math.sin(7 * th + 0.6 * Math.sin(3 * th)) + 0.04 * Math.sin(5 * th - t * 2.3)) * lower * lower;
  y += (0.09 * (0.5 + 0.5 * Math.sin(7 * th + 1.1)) + 0.035 * Math.sin(4 * th + t * 3.1)) * Math.pow(lower, 3);
  // arms raised under the sheet: the sides lift into two draped peaks
  if (arms > 0) {
    const side = Math.pow(Math.abs(Math.sin(th)), 5);
    const band = sstep(V_HEAD * 0.9, 0.42, v) * (1 - sstep(0.62, 1.0, v));
    const hang = sstep(0.55, 1.0, v); // the lower sheet hangs from the raised arms
    const a = arms * side;
    r += a * (0.42 * band + 0.3 * hang);
    y += a * (0.62 * band + 0.42 * hang);
  }
  // puffing up: fuller and taller
  r *= 1 + puff * 0.16 * (0.4 + lower);
  y *= 1 + puff * 0.1;
  r += outward;
  return out.set(Math.sin(th) * r, y, Math.cos(th) * r);
}

function paintFace(face: GhostFace): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#16120f';
  g.strokeStyle = '#16120f';
  g.lineJoin = g.lineCap = 'round';
  // the patch is wider than tall on the head: draw in a squashed frame
  const eye = (x: number, y: number, rx: number, ry: number, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  if (face === 'sly') {
    // half-closed, mischievous eyes and a lopsided smirk
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(256 + s * 92, 160, 50, 56, 0, Math.PI * 0.02, Math.PI * 0.98);
      g.closePath();
      g.fill();
      // heavy lids sloping down to the middle
      g.lineWidth = 18;
      g.beginPath();
      g.moveTo(256 + s * 150, 150);
      g.lineTo(256 + s * 38, 172);
      g.stroke();
    }
    g.lineWidth = 22;
    g.beginPath();
    g.moveTo(170, 300);
    g.quadraticCurveTo(270, 370, 352, 284);
    g.stroke();
  } else if (face === 'boo') {
    // round eyes, a little triangle nose, a huge jagged mouth
    eye(256 - 95, 150, 50, 62);
    eye(256 + 95, 150, 50, 62);
    g.beginPath(); g.moveTo(256, 222); g.lineTo(236, 258); g.lineTo(276, 258); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(140, 290);
    g.quadraticCurveTo(256, 330, 372, 290);
    g.quadraticCurveTo(360, 470, 256, 480);
    g.quadraticCurveTo(152, 470, 140, 290);
    g.fill();
    // two teeth on top, one below
    g.fillStyle = '#f4f2ec';
    g.fillRect(205, 300, 34, 40);
    g.fillRect(275, 300, 34, 40);
    g.fillRect(240, 440, 32, 30);
  } else {
    // happy: round eyes, a big open grin
    eye(256 - 92, 155, 44, 56, -0.15);
    eye(256 + 92, 155, 44, 56, 0.15);
    g.beginPath();
    g.moveTo(150, 280);
    g.quadraticCurveTo(256, 300, 362, 280);
    g.quadraticCurveTo(340, 430, 256, 432);
    g.quadraticCurveTo(172, 430, 150, 280);
    g.fill();
    g.fillStyle = '#c4555a';
    g.beginPath(); g.ellipse(256, 395, 52, 26, 0, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Ghost {
  readonly group = new THREE.Group();
  readonly pose: GhostPose = { x: 0, z: 0, heading: 0, lift: 0.15, lean: 0, tilt: 0, arms: 0, puff: 0, opacity: 1, face: 'sly' };
  private readonly cloth: THREE.Mesh;
  private readonly faceMesh: THREE.Mesh;
  private readonly clothMat: THREE.MeshStandardMaterial;
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly faces: Record<GhostFace, THREE.CanvasTexture>;
  private readonly terrain: { heightAt(x: number, z: number): number };
  private time = 0;

  constructor(terrain: { heightAt(x: number, z: number): number }) {
    this.terrain = terrain;
    // the sheet: a grid (NU + 1) x (NV + 1); the seam column repeats the first
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((NU + 1) * (NV + 1) * 3), 3));
    const idx: number[] = [];
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setIndex(idx);
    this.clothMat = new THREE.MeshStandardMaterial({
      color: 0xf3f2ee, roughness: 0.88, side: THREE.DoubleSide,
      emissive: 0x8fa6c4, emissiveIntensity: 0.12, // a faint glow, so it reads at night too
    });
    this.cloth = new THREE.Mesh(geo, this.clothMat);
    this.cloth.castShadow = true;
    this.cloth.frustumCulled = false;
    this.group.add(this.cloth);

    // the painted face: a patch of the same surface, a hair in front of it
    const FU = 16, FV = 14;
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FU + 1) * (FV + 1) * 3), 3));
    const uv = new Float32Array((FU + 1) * (FV + 1) * 2);
    const fidx: number[] = [];
    for (let j = 0; j <= FV; j++) for (let i = 0; i <= FU; i++) {
      const k = j * (FU + 1) + i;
      uv[k * 2] = i / FU; uv[k * 2 + 1] = 1 - j / FV;
      if (i < FU && j < FV) fidx.push(k, k + FU + 1, k + 1, k + 1, k + FU + 1, k + FU + 2);
    }
    fgeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    fgeo.setIndex(fidx);
    this.faces = { sly: paintFace('sly'), boo: paintFace('boo'), happy: paintFace('happy') };
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.faces.sly, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.faceMesh = new THREE.Mesh(fgeo, this.faceMat);
    this.faceMesh.frustumCulled = false;
    this.faceMesh.renderOrder = 1;
    this.group.add(this.faceMesh);
    (this.faceMesh.userData as { fu: number; fv: number }).fu = FU;
    (this.faceMesh.userData as { fu: number; fv: number }).fv = FV;
    this.group.visible = false;
    this._rebuild();
  }

  /** the top of its head (world) */
  headWorld(target = new THREE.Vector3()): THREE.Vector3 {
    return this.group.localToWorld(target.set(0, H - RH * 0.6, 0));
  }

  private _rebuild(): void {
    const { arms, puff } = this.pose;
    const t = this.time;
    const pos = this.cloth.geometry.attributes.position as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      for (let i = 0; i <= NU; i++) {
        sheet((i % NU) / NU, v, t, arms, puff, p);
        pos.setXYZ(j * (NU + 1) + i, p.x, p.y, p.z);
      }
    }
    pos.needsUpdate = true;
    this.cloth.geometry.computeVertexNormals();
    const fp = this.faceMesh.geometry.attributes.position as THREE.BufferAttribute;
    const { fu, fv } = this.faceMesh.userData as { fu: number; fv: number };
    for (let j = 0; j <= fv; j++) {
      const v = FACE_V0 + (FACE_V1 - FACE_V0) * (j / fv);
      for (let i = 0; i <= fu; i++) {
        const u = (-FACE_U + 2 * FACE_U * (i / fu) + 1) % 1;
        sheet(u, v, t, arms, puff, p, 0.006);
        fp.setXYZ(j * (fu + 1) + i, p.x, p.y, p.z);
      }
    }
    fp.needsUpdate = true;
  }

  show(on: boolean): void { this.group.visible = on; }

  update(dt: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const P = this.pose;
    const g = this.group;
    g.position.set(P.x, this.terrain.heightAt(P.x, P.z) + P.lift, P.z);
    g.rotation.set(P.lean, P.heading, P.tilt, 'YXZ');
    const fading = P.opacity < 0.999;
    if (this.clothMat.transparent !== fading) { this.clothMat.transparent = fading; this.clothMat.depthWrite = !fading; this.clothMat.needsUpdate = true; }
    this.clothMat.opacity = P.opacity;
    this.faceMat.opacity = P.opacity;
    this.cloth.castShadow = P.opacity > 0.5;
    if (this.faceMat.map !== this.faces[P.face]) { this.faceMat.map = this.faces[P.face]; this.faceMat.needsUpdate = true; }
    this._rebuild();
  }
}
