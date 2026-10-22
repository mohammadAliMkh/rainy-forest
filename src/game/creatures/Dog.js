import * as THREE from 'three';
import { createNoise2D, mulberry32, damp, clamp } from '../../utils/noise.js';
import { createCampTextures } from '../people/clothTextures.js';
import { taperTube, rgb } from '../people/Human.js';
import { SkinBinding } from './skinBinding.ts';

// Luna: a black long-haired German Shepherd. Shaggy coat (noise-displaced
// shells), upright ears, bushy tail, khaki harness and jointed legs, so she
// can lie "sphinx" style, get up, trot around the camp, sniff about and lie
// down again beside someone else. She pants, flicks her ears, watches people
// or the player and wags her tail when someone comes close.

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerp = (a, b, t) => a + (b - a) * t;

const BLACK = rgb(0x121010);
const TAN = rgb(0x3d2a1c);

// body height above the ground and leg joint angles for each pose
const LYING_Y = 0.17, STAND_Y = 0.43;
const LEGS = [
  // front legs: shoulder joint, upper / lower length, lying + standing angles
  { x: -0.075, y: -0.07, z: 0.25, up: 0.17, low: 0.16, r: 0.034, front: true, lie: [-1.38, 0, 0], stand: [0.04, -0.04, 0] },
  { x: 0.075, y: -0.07, z: 0.25, up: 0.17, low: 0.16, r: 0.034, front: true, lie: [-1.38, 0, 0], stand: [0.04, -0.04, 0] },
  // hind legs fold under the body (thigh forward, shin back, splayed out)
  { x: -0.085, y: -0.04, z: -0.27, up: 0.2, low: 0.21, r: 0.042, front: false, lie: [-1.25, 2.45, -0.35], stand: [-0.32, 0.6, 0] },
  { x: 0.085, y: -0.04, z: -0.27, up: 0.2, low: 0.21, r: 0.042, front: false, lie: [-1.25, 2.45, 0.35], stand: [-0.32, 0.6, 0] },
];
const TROT = [0, Math.PI, Math.PI, 0]; // diagonal pairs

function furry(geo, amount, seed, colorFn) {
  const n = createNoise2D(mulberry32(seed));
  geo.computeVertexNormals();
  const p = geo.attributes.position, nr = geo.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (n(x * 28 + z * 9, y * 28) * 0.6 + n(x * 70, z * 70 + y * 30) * 0.4) * amount;
    p.setXYZ(i, x + nr.getX(i) * k, y + nr.getY(i) * k, z + nr.getZ(i) * k);
    const col = colorFn ? colorFn(x, y, z) : BLACK;
    const v = 0.85 + n(x * 40, y * 40 + z * 13) * 0.25;
    c[i * 3] = col[0] * v; c[i * 3 + 1] = col[1] * v; c[i * 3 + 2] = col[2] * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo;
}

function ellipsoid(rx, ry, rz, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7));
  g.scale(rx, ry, rz);
  return g;
}

export class Dog {
  /** `model`: Luna built in Blender (pipeline/blender_animals.py), driven by this rig */
  constructor(model = null) {
    const C = createCampTextures();
    const fur = new THREE.MeshStandardMaterial({ vertexColors: true, map: C.fleece.map, normalMap: C.fleece.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.3 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1c0f07, roughness: 0.08 });
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xc8606e, roughness: 0.35 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x8a7a55, map: C.fabric.map, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 1, roughness: 0.35 });

    this.root = new THREE.Group();
    // body origin = middle of the torso; its height and pitch change with the pose
    const body = new THREE.Group();
    body.position.y = LYING_Y;
    this.root.add(body);
    this.body = body;

    const torsoGeo = new THREE.CapsuleGeometry(0.15, 0.42, 10, 20);
    torsoGeo.rotateX(Math.PI / 2);
    {
      const p = torsoGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const chest = sstep(-0.1, 0.25, z);
        const waist = Math.exp(-(((z + 0.08) / 0.12) ** 2));
        p.setXYZ(i, x * (0.95 - waist * 0.1), y * (1.0 + chest * 0.12 - waist * 0.12) + (y < 0 ? 0.02 * waist : 0), z);
      }
    }
    const torso = new THREE.Mesh(furry(torsoGeo, 0.02, 1, (x, y) => mix3(BLACK, TAN, sstep(-0.06, -0.15, y) * 0.35)), fur);
    torso.position.set(0, 0, -0.04);
    torso.castShadow = true;
    body.add(torso);
    this.torso = torso;
    // chest + neck ruff (thick mane of a long-haired shepherd)
    const ruff = new THREE.Mesh(furry(ellipsoid(0.15, 0.17, 0.15, 24), 0.03, 2, (x, y) => mix3(BLACK, TAN, sstep(0.0, -0.14, y) * 0.3)), fur);
    ruff.position.set(0, 0.08, 0.28);
    ruff.castShadow = true;
    body.add(ruff);
    // harness straps + ring
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.013, 6, 28), strap);
    band.position.set(0, 0.02, 0.14);
    band.scale.set(0.98, 1.1, 1);
    body.add(band);
    const chestStrap = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24), strap);
    chestStrap.position.set(0, 0.14, 0.33);
    chestStrap.rotation.x = 1.1;
    body.add(chestStrap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 12), metal);
    ring.position.set(0, 0.205, 0.16);
    body.add(ring);
    this.backAnchor = new THREE.Object3D();
    this.backAnchor.position.set(0, 0.16, -0.01);
    body.add(this.backAnchor);

    // ---- legs: hip -> knee -> paw ----
    this.legs = LEGS.map((L, k) => {
      const hip = new THREE.Group();
      hip.position.set(L.x, L.y, L.z);
      body.add(hip);
      const upperGeo = L.front ? new THREE.CapsuleGeometry(L.r, L.up, 6, 12) : ellipsoid(0.065, L.up * 0.62, 0.085);
      upperGeo.translate(0, -L.up / 2, 0);
      const upper = new THREE.Mesh(furry(upperGeo, 0.012, 20 + k, () => mix3(BLACK, TAN, 0.12)), fur);
      upper.castShadow = true;
      hip.add(upper);
      const knee = new THREE.Group();
      knee.position.y = -L.up;
      hip.add(knee);
      const lowGeo = new THREE.CapsuleGeometry(L.front ? 0.03 : 0.032, L.low, 6, 10);
      lowGeo.translate(0, -L.low / 2, 0);
      const lower = new THREE.Mesh(furry(lowGeo, 0.008, 30 + k, () => mix3(BLACK, TAN, 0.22)), fur);
      lower.castShadow = true;
      knee.add(lower);
      const paw = new THREE.Group();
      paw.position.y = -L.low - 0.01;
      knee.add(paw);
      const pawGeo = ellipsoid(0.038, 0.024, 0.055);
      pawGeo.translate(0, -0.005, 0.02);
      paw.add(new THREE.Mesh(furry(pawGeo, 0.005, 40 + k, () => mix3(BLACK, TAN, 0.3)), fur));
      return { ...L, hip, knee, paw, phase: TROT[k] };
    });

    // ---- neck + head ----
    const neck = new THREE.Group();
    neck.position.set(0, 0.15, 0.34);
    body.add(neck);
    const neckMesh = new THREE.Mesh(furry(new THREE.CylinderGeometry(0.075, 0.11, 0.2, 16, 4), 0.022, 9), fur);
    neckMesh.position.set(0, 0.06, 0.03);
    neckMesh.rotation.x = 0.55;
    neck.add(neckMesh);
    const head = new THREE.Group();
    head.position.set(0, 0.15, 0.08);
    neck.add(head);
    const skull = new THREE.Mesh(furry(ellipsoid(0.075, 0.072, 0.09), 0.01, 10, (x, y) => mix3(BLACK, TAN, sstep(-0.01, -0.07, y) * 0.25)), fur);
    skull.castShadow = true;
    head.add(skull);
    const muzzleGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.12, 14, 3);
    muzzleGeo.rotateX(Math.PI / 2);
    muzzleGeo.translate(0, -0.025, 0.1);
    head.add(new THREE.Mesh(furry(muzzleGeo, 0.004, 11, () => mix3(BLACK, [0.02, 0.02, 0.02], 0.5)), fur));
    const nose = new THREE.Mesh(ellipsoid(0.022, 0.016, 0.016, 12), dark);
    nose.position.set(0, -0.012, 0.165);
    head.add(nose);
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.045, 0.05);
    head.add(jaw);
    const jawGeo = new THREE.CylinderGeometry(0.022, 0.038, 0.1, 12, 2);
    jawGeo.rotateX(Math.PI / 2);
    jawGeo.scale(1, 0.55, 1);
    jawGeo.translate(0, 0, 0.05);
    jaw.add(new THREE.Mesh(furry(jawGeo, 0.003, 12), fur));
    const mouthIn = new THREE.Mesh(ellipsoid(0.03, 0.012, 0.055, 12), new THREE.MeshStandardMaterial({ color: 0x2a0a0c, roughness: 0.6 }));
    mouthIn.position.set(0, 0.012, 0.055);
    jaw.add(mouthIn);
    const tongueGeo = ellipsoid(0.024, 0.006, 0.06, 14);
    tongueGeo.translate(0, 0, 0.05);
    const tongue = new THREE.Mesh(tongueGeo, tongueMat);
    tongue.position.set(0, 0.012, 0.04);
    tongue.rotation.x = 0.5;
    jaw.add(tongue);
    this.jaw = jaw; this.tongue = tongue;
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), eyeMat);
      eye.position.set(s * 0.037, 0.018, 0.075);
      head.add(eye);
    }
    this.ears = [];
    for (const s of [-1, 1]) {
      const ep = new THREE.Group();
      ep.position.set(s * 0.045, 0.055, -0.01);
      const eg = new THREE.ConeGeometry(0.038, 0.11, 10, 3, true);
      const p = eg.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) > 0) p.setZ(i, p.getZ(i) * 0.25); // hollow front
      eg.translate(0, 0.055, 0);
      eg.scale(1, 1, 0.55);
      const ear = new THREE.Mesh(furry(eg, 0.004, 13 + s, (x, y, z) => (z > 0.003 ? mix3(BLACK, TAN, 0.5) : BLACK)), fur);
      ear.material.side = THREE.DoubleSide;
      ep.add(ear);
      ep.rotation.set(-0.15, 0, -s * 0.28);
      head.add(ep);
      this.ears.push(ep);
    }
    this.neck = neck; this.head = head;

    // bushy tail: hangs when standing, lies curled on the ground when lying
    const tail = new THREE.Group();
    tail.position.set(0.0, 0.03, -0.42);
    body.add(tail);
    const tailGeo = taperTube([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.05, -0.1), new THREE.Vector3(0.01, -0.14, -0.19),
      new THREE.Vector3(0.03, -0.25, -0.24), new THREE.Vector3(0.05, -0.34, -0.24),
    ], 0.05, 0.03, 10, 18);
    const tm2 = new THREE.Mesh(furry(tailGeo, 0.02, 14), fur);
    tm2.castShadow = true;
    tail.add(tm2);
    this.tail = tail;

    this.headWorld = new THREE.Vector3();
    this.backWorld = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.yaw = 0; this.pitch = 0;
    this.wag = 0;
    this.pant = 1;
    this.earT = 2;
    this.time = Math.random() * 10;
    // locomotion / behaviour
    this.stand = 0;          // 0 lying .. 1 standing
    this.speed = 0;
    this.gait = 0;
    this.heading = 0;
    this.state = 'lie';
    this.timer = 45;          // first rest is long (she starts beside the owner)
    this.restingBy = null;
    this.path = [];
    this.goal = null;
    this.sniff = 0;
    this.rand = mulberry32(4242);
    if (model) {
      // put the rig in the standing pose the Blender model was built in
      this.body.position.y = STAND_Y;
      for (const L of this.legs) {
        L.hip.rotation.set(L.stand[0], 0, 0);
        L.knee.rotation.x = L.stand[1];
        L.paw.rotation.x = -(L.stand[0] + L.stand[1]) * (L.front ? 1 : 0.6);
      }
      this.neck.rotation.set(0.35, 0, 0, 'YXZ');
      this.head.rotation.set(-0.3, 0, 0, 'YXZ');
      for (const e of this.ears) e.rotation.x = -0.15;
      this.tail.rotation.set(0.35, 0, 0);
      const joints = { body: this.body, neck: this.neck, head: this.head, jaw: this.jaw, tail: this.tail };
      this.ears.forEach((e, i) => { joints[`ear_${i}`] = e; });
      this.legs.forEach((L, i) => { joints[`hip_${i}`] = L.hip; joints[`knee_${i}`] = L.knee; joints[`paw_${i}`] = L.paw; });
      this.binding = new SkinBinding(this.root, model, joints, (mesh) => { if (mesh.material.name === 'fur') mesh.material = fur; });
      this.body.position.y = LYING_Y;
    }
  }

  get isLying() { return this.state === 'lie' && this.stand < 0.05; }

  // where she can go: `spots` = beside people [{key, x, z, heading}],
  // `wander` = places to sniff around [{x, z}], `ring` = {x, z, r} to walk around
  setWorld({ terrain, collision, spots, wander, ring }) {
    Object.assign(this, { terrain, collision, spots, wander, ring });
    this.col = { x: this.root.position.x, z: this.root.position.z, radius: 0.3 };
    collision.dynamic.add(this.col);
  }

  place(x, y, z, heading, restingBy = null) {
    this.root.position.set(x, y, z);
    this.heading = heading;
    this.root.rotation.y = heading;
    this.forward.set(Math.sin(heading), 0, Math.cos(heading));
    this.restingBy = restingBy;
    if (this.col) { this.col.x = x; this.col.z = z; }
  }

  // ---- behaviour ----------------------------------------------------------
  _plan() {
    const r = this.rand;
    const others = this.spots.filter((s) => s.key !== this.restingBy);
    const dest = others[Math.floor(r() * others.length)];
    const stops = [];
    if (this.wander?.length && r() < 0.6) {
      const n = 1 + Math.floor(r() * 2);
      const pool = [...this.wander];
      for (let i = 0; i < n && pool.length; i++) stops.push({ ...pool.splice(Math.floor(r() * pool.length), 1)[0], sniff: true });
    }
    stops.push({ ...dest, final: true });
    // route around the circle of seats instead of through people / the fire
    let from = { x: this.root.position.x, z: this.root.position.z };
    this.path = [];
    for (const s of stops) { this.path.push(...this._route(from, s)); from = s; }
    this.goal = dest;
  }

  _route(a, b) {
    const R = this.ring;
    const pts = [];
    if (R) {
      // does the straight line pass through the seats ring?
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = clamp(((R.x - a.x) * dx + (R.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const cx = a.x + dx * t - R.x, cz = a.z + dz * t - R.z;
      if (Math.hypot(cx, cz) < R.r) {
        let a0 = Math.atan2(a.z - R.z, a.x - R.x), a1 = Math.atan2(b.z - R.z, b.x - R.x);
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const steps = Math.max(1, Math.ceil(Math.abs(d) / 0.9));
        for (let i = 0; i <= steps; i++) {
          const ang = a0 + (d * i) / steps;
          pts.push({ x: R.x + Math.cos(ang) * (R.r + 0.5), z: R.z + Math.sin(ang) * (R.r + 0.5) });
        }
      }
    }
    pts.push(b);
    return pts;
  }

  _think(dt, hold) {
    switch (this.state) {
      case 'lie':
        this.timer -= dt;
        if (this.timer <= 0 && !hold && this.spots?.length > 1) { this._plan(); this.restingBy = null; this.state = 'up'; }
        break;
      case 'up':
        this.stand = Math.min(1, this.stand + dt / 1.1);
        if (this.stand >= 1) this.state = 'walk';
        break;
      case 'sniff':
        this.sniff -= dt;
        if (this.sniff <= 0) this.state = 'walk';
        break;
      case 'walk': {
        const wp = this.path[0];
        if (!wp) { this.state = 'down'; break; }
        const p = this.root.position;
        const dx = wp.x - p.x, dz = wp.z - p.z;
        const dist = Math.hypot(dx, dz);
        const reach = wp.final ? 0.12 : 0.35;
        if (dist < reach) {
          this.path.shift();
          if (wp.sniff) { this.state = 'sniff'; this.sniff = 2 + this.rand() * 3; this.speed = 0; }
          if (wp.final) { this.state = 'turn'; this.speed = 0; }
          break;
        }
        // turn toward the waypoint, trot forward (slower while turning)
        const want = Math.atan2(dx, dz);
        let dh = want - this.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.heading += clamp(dh, -2.6 * dt, 2.6 * dt);
        const target = (wp.final && dist < 0.8 ? 0.45 : 1.05) * (1 - Math.min(0.7, Math.abs(dh)));
        this.speed = damp(this.speed, target, 4, dt);
        const step = { x: p.x + Math.sin(this.heading) * this.speed * dt, z: p.z + Math.cos(this.heading) * this.speed * dt, self: this.col };
        if (!wp.final || dist > 0.6) this.collision.resolve(step, 0.28);
        p.x = step.x; p.z = step.z;
        break;
      }
      case 'turn': {
        let dh = this.goal.heading - this.heading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.heading += clamp(dh, -1.8 * dt, 1.8 * dt);
        this.speed = 0.25; // shuffle round
        if (Math.abs(dh) < 0.05) { this.state = 'down'; this.speed = 0; }
        break;
      }
      case 'down':
        this.speed = damp(this.speed, 0, 6, dt);
        this.stand = Math.max(0, this.stand - dt / 1.3);
        if (this.stand <= 0) {
          this.state = 'lie';
          this.restingBy = this.goal?.key ?? null;
          this.timer = 35 + this.rand() * 45;
        }
        break;
    }
  }

  // look: world point of interest; excite 0..1 (player close / petted);
  // hold: don't start a new trip (e.g. during the introductions)
  update(dt, look, excite = 0, hold = false) {
    this.time += dt;
    const t = this.time;
    if (this.spots) this._think(dt, hold);

    // ---- place the body / pose the legs ----
    const p = this.root.position;
    if (this.terrain) p.y = this.terrain.heightAt(p.x, p.z);
    this.root.rotation.y = this.heading;
    this.forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    if (this.col) { this.col.x = p.x; this.col.z = p.z; }
    const s = this.stand * this.stand * (3 - 2 * this.stand);
    const moving = Math.min(1, this.speed / 0.4);
    this.gait += (dt * Math.max(this.speed, 0.25 * moving) / 0.62) * Math.PI * 2;
    const bob = Math.abs(Math.sin(this.gait)) * 0.018 * moving;
    this.body.position.y = lerp(LYING_Y, STAND_Y + bob, s);
    // getting up: chest first; lying down: hindquarters first
    this.body.rotation.x = Math.sin(this.stand * Math.PI) * (this.state === 'down' ? 0.12 : -0.14);
    for (const L of this.legs) {
      const ph = this.gait + L.phase;
      const swing = Math.sin(ph) * 0.42 * moving;
      const lift = Math.max(0, Math.cos(ph)) * moving;
      const hx = lerp(L.lie[0], L.stand[0] + swing, s);
      const kx = lerp(L.lie[1], L.stand[1] + (L.front ? lift * 0.75 : lift * 0.55), s);
      L.hip.rotation.set(hx, 0, lerp(L.lie[2], 0, s));
      L.knee.rotation.x = kx;
      L.paw.rotation.x = -(hx + kx) * (L.front ? 1 : 0.6); // keep paws roughly flat
    }
    // tail: hangs (wagging) when standing, curled on the ground when lying
    this.wag = damp(this.wag, excite, 2, dt);
    this.tail.rotation.x = lerp(1.25, 0.35 + moving * 0.25, s) - this.wag * 0.15;
    this.tail.rotation.y = lerp(0.55, 0, s) + Math.sin(t * (3 + this.wag * 7)) * (0.08 + this.wag * 0.35);

    this.root.updateMatrixWorld(true);
    this.head.getWorldPosition(this.headWorld);
    this.backAnchor.getWorldPosition(this.backWorld);
    // ---- head: sniffing while exploring, looking around otherwise ----
    let yawT = this.yaw, pitchT = this.pitch;
    if (this.state === 'sniff') { yawT = Math.sin(t * 1.3) * 0.5; pitchT = -0.75; }
    else if (moving > 0.3) { yawT = 0; pitchT = -0.15; }
    else if (look) {
      const to = new THREE.Vector3().subVectors(look, this.headWorld);
      const left = new THREE.Vector3(this.forward.z, 0, -this.forward.x);
      yawT = clamp(Math.atan2(to.dot(left), to.dot(this.forward)), -1.3, 1.3);
      pitchT = clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.5, 0.4);
    }
    this.yaw = damp(this.yaw, yawT, 2.5, dt);
    this.pitch = damp(this.pitch, pitchT, 2.5, dt);
    this.neck.rotation.set(-this.pitch * 0.5 + lerp(0, 0.35, s), this.yaw * 0.45, 0, 'YXZ');
    this.head.rotation.set(-this.pitch * 0.5 + Math.sin(t * 0.7) * 0.03 - lerp(0, 0.3, s), this.yaw * 0.55, Math.sin(t * 0.33) * 0.06, 'YXZ');
    // panting (harder after a trot)
    this.pant = damp(this.pant, 0.5 + Math.max(excite, moving) * 0.5, 1, dt);
    const pf = 2.4 + Math.max(excite, moving) * 1.4;
    const open = (0.12 + 0.12 * Math.abs(Math.sin(t * pf * Math.PI))) * this.pant;
    this.jaw.rotation.x = this.state === 'sniff' ? 0.03 : open;
    this.tongue.rotation.x = 0.5 + open * 0.8;
    this.torso.scale.y = 1 + Math.sin(t * pf * Math.PI * 2) * 0.012 * this.pant;
    // ears: alert and twitching
    this.earT -= dt;
    let twitch = 0;
    if (this.earT < 0) { twitch = Math.sin(Math.min(1, -this.earT / 0.25) * Math.PI); if (this.earT < -0.25) this.earT = 1.5 + Math.random() * 4; }
    for (const [i, e] of this.ears.entries()) e.rotation.x = -0.15 - (i === 0 ? twitch * 0.35 : 0) - excite * 0.1;
    if (this.binding) {
      this.root.updateMatrixWorld(true);
      this.binding.sync();
    }
  }
}
