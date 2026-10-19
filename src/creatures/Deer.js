import * as THREE from 'three';
import { CABIN, FIRE } from '../core/config.js';
import { mulberry32, damp } from '../utils/noise.js';

// Procedural deer with a jointed skeleton (hips/knees, neck, head, ears,
// tail) and a small behaviour brain: wander, graze, look around, notice the
// player, flee, walk off into the mist and later come back out of the trees.

const TAU = Math.PI * 2;

function coloredGeo(geo, fn) {
  const p = geo.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const col = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

const BROWN = [0.36, 0.2, 0.1];
const DARK = [0.2, 0.12, 0.07];
const CREAM = [0.75, 0.66, 0.55];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function buildDeerModel(T, { buck = false, tone = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ map: T.fur, normalMap: T.furNormal, normalScale: new THREE.Vector2(0.4, 0.4), vertexColors: true, roughness: 0.88 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0907, roughness: 0.35 });
  const brown = BROWN.map((v) => v * tone);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // torso: capsule along Z, deeper chest, sagging belly, lighter underside
  const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.72, 8, 16);
  torsoGeo.rotateX(Math.PI / 2);
  const tp = torsoGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    let x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i);
    const front = sstep(-0.2, 0.5, z);
    y *= 1.12 + front * 0.12;
    x *= 0.92 + front * 0.06 - sstep(0.3, 0.6, z) * 0.1;
    if (y < 0) y *= 1.05;
    // haunch bump at the back top
    y += sstep(-0.1, -0.45, z) * sstep(0.0, 0.2, y) * 0.05;
    tp.setXYZ(i, x, y, z);
  }
  torsoGeo.computeVertexNormals();
  coloredGeo(torsoGeo, (x, y, z) => {
    const belly = sstep(-0.05, -0.22, y);
    return mix3(brown, CREAM, belly * 0.85);
  });
  const torso = new THREE.Mesh(torsoGeo, mat);
  torso.position.set(0, 1.0, 0);
  torso.castShadow = true;
  body.add(torso);

  // white rump patch
  const rumpGeo = new THREE.SphereGeometry(0.17, 12, 8);
  rumpGeo.scale(1, 1.1, 0.45);
  coloredGeo(rumpGeo, () => CREAM.map((v) => v * 1.1));
  const rump = new THREE.Mesh(rumpGeo, mat);
  rump.position.set(0, 1.02, -0.5);
  body.add(rump);

  // neck
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.13, 0.4);
  body.add(neckPivot);
  const neckGeo = new THREE.CylinderGeometry(0.085, 0.15, 0.62, 12, 4);
  neckGeo.translate(0, 0.27, 0);
  coloredGeo(neckGeo, (x, y, z) => mix3(brown, CREAM, sstep(0.02, 0.1, z) * 0.6));
  const neck = new THREE.Mesh(neckGeo, mat);
  neck.castShadow = true;
  neckPivot.add(neck);

  // head
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.56, 0);
  neckPivot.add(headPivot);
  const skull = new THREE.SphereGeometry(0.12, 14, 10);
  skull.scale(0.82, 0.9, 1.25);
  skull.translate(0, 0.03, 0.06);
  coloredGeo(skull, (x, y) => mix3(brown, CREAM, sstep(-0.02, -0.1, y) * 0.5));
  const snout = new THREE.CylinderGeometry(0.048, 0.085, 0.24, 10, 2);
  snout.rotateX(Math.PI / 2);
  snout.translate(0, -0.01, 0.24);
  coloredGeo(snout, (x, y, z) => mix3(mix3(brown, DARK, 0.3), CREAM, sstep(0.0, -0.05, y) * 0.6));
  const head = new THREE.Mesh(skull, mat);
  const muzzle = new THREE.Mesh(snout, mat);
  head.castShadow = true;
  headPivot.add(head, muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), darkMat);
  nose.position.set(0, -0.0, 0.36);
  headPivot.add(nose);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), darkMat);
    eye.position.set(s * 0.085, 0.06, 0.12);
    headPivot.add(eye);
  }
  const ears = [];
  for (const s of [-1, 1]) {
    const ep = new THREE.Group();
    ep.position.set(s * 0.07, 0.12, -0.02);
    const eg = new THREE.SphereGeometry(1, 10, 8);
    eg.scale(0.055, 0.12, 0.022);
    eg.translate(0, 0.1, 0);
    coloredGeo(eg, (x, y, z) => (z > 0 ? mix3(CREAM, DARK, 0.2) : brown));
    const ear = new THREE.Mesh(eg, mat);
    ep.add(ear);
    ep.rotation.z = -s * 0.75;
    ep.rotation.x = -0.25;
    ep.userData.side = s;
    headPivot.add(ep);
    ears.push(ep);
  }
  if (buck) {
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const a = new THREE.Group();
      a.position.set(s * 0.05, 0.14, 0.02);
      const mk = (len, r, rx, rz, y = 0, parent = a) => {
        const g = new THREE.CylinderGeometry(r * 0.6, r, len, 5);
        g.translate(0, len / 2, 0);
        const m = new THREE.Mesh(g, antlerMat);
        m.rotation.set(rx, 0, rz);
        m.position.y = y;
        parent.add(m);
        return m;
      };
      const beam = mk(0.38, 0.022, -0.5, -s * 0.55);
      mk(0.18, 0.012, 0.6, -s * 0.1, 0.12, beam);
      mk(0.16, 0.011, 0.3, s * 0.3, 0.26, beam);
      mk(0.14, 0.01, 0.8, -s * 0.2, 0.36, beam);
      headPivot.add(a);
    }
  }

  // legs
  const legs = [];
  const legDefs = [
    { x: -0.13, z: 0.36, front: true }, { x: 0.13, z: 0.36, front: true },
    { x: -0.13, z: -0.38, front: false }, { x: 0.13, z: -0.38, front: false },
  ];
  for (const d of legDefs) {
    const hip = new THREE.Group();
    hip.position.set(d.x, d.front ? 0.96 : 1.0, d.z);
    const upperLen = d.front ? 0.48 : 0.5;
    const ug = new THREE.CylinderGeometry(0.04, d.front ? 0.075 : 0.1, upperLen, 8, 2);
    ug.translate(0, -upperLen / 2, 0);
    coloredGeo(ug, (x, y, z) => mix3(brown, CREAM, (d.front ? 0 : sstep(0.0, 0.05, -x * Math.sign(d.x))) * 0.3));
    const upper = new THREE.Mesh(ug, mat);
    upper.castShadow = true;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -upperLen;
    hip.add(knee);
    const lowerLen = d.front ? 0.45 : 0.47;
    const lg = new THREE.CylinderGeometry(0.022, 0.032, lowerLen, 7, 1);
    lg.translate(0, -lowerLen / 2, 0);
    coloredGeo(lg, () => mix3(brown, DARK, 0.25));
    const lower = new THREE.Mesh(lg, mat);
    lower.castShadow = true;
    knee.add(lower);
    const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.05, 7), darkMat);
    hoof.position.y = -lowerLen - 0.01;
    knee.add(hoof);
    body.add(hip);
    legs.push({ hip, knee, front: d.front, side: Math.sign(d.x) });
  }

  // tail
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 1.13, -0.6);
  const tg = new THREE.SphereGeometry(1, 10, 8);
  tg.scale(0.05, 0.11, 0.03);
  tg.translate(0, -0.08, -0.01);
  coloredGeo(tg, (x, y, z) => (z < -0.005 ? brown : CREAM.map((v) => v * 1.15)));
  tailPivot.add(new THREE.Mesh(tg, mat));
  tailPivot.rotation.x = 0.35;
  body.add(tailPivot);

  return { root, body, neckPivot, headPivot, ears, legs, tailPivot };
}

// ---------------------------------------------------------------------------
class DeerAgent {
  constructor(T, world, opts) {
    this.world = world;
    this.rand = mulberry32(opts.seed);
    this.model = buildDeerModel(T, { buck: opts.buck, tone: opts.tone });
    this.scale = opts.scale;
    this.model.root.scale.setScalar(this.scale);
    this.home = opts.home;
    this.x = opts.x; this.z = opts.z;
    this.heading = this.rand() * TAU;
    this.speed = 0;
    this.targetSpeed = 0;
    this.gait = 0;
    this.state = 'idle';
    this.timer = 2 + this.rand() * 3;
    this.target = null;
    this.neckPitch = 0.45; this.neckYaw = 0;
    this.headPitch = -0.1;
    this.lookYaw = 0;
    this.grazeAmt = 0;
    this.alertAmt = 0;
    this.earTimer = 1; this.earFlick = 0; this.earSide = 1;
    this.tailTimer = 3; this.tailFlick = 0;
    this.stepAcc = 0;
    this.collider = { x: this.x, z: this.z, radius: 0.5 * this.scale };
    world.collision.dynamic.add(this.collider);
    this.hiddenTimer = 0;
    this.alertCooldown = 0;
    this.lastStepPhase = 0;
  }

  get position() { return this.model.root.position; }

  pickTarget(kind = 'wander') {
    const r = this.rand;
    let x, z;
    for (let tries = 0; tries < 20; tries++) {
      if (kind === 'cabin') {
        const a = Math.PI * (0.55 + r() * 0.9);
        const d = 9 + r() * 6;
        x = FIRE.x + Math.cos(a) * d * 1.3; z = FIRE.z + Math.sin(a) * d * 0.5 - 2;
      } else if (kind === 'leave') {
        const a = Math.atan2(this.z - this.world.player.z, this.x - this.world.player.x) + (r() - 0.5) * 1.2;
        const d = 75 + r() * 25;
        x = this.world.player.x + Math.cos(a) * d; z = this.world.player.z + Math.sin(a) * d;
      } else {
        const a = r() * TAU, d = 6 + r() * 26;
        x = this.home.x + Math.cos(a) * d; z = this.home.z + Math.sin(a) * d;
      }
      if (Math.hypot(x, z) > 160) continue;
      if (Math.hypot(x - FIRE.x, z - FIRE.z) < 6) continue;
      if (Math.abs(x - CABIN.x) < 5 && Math.abs(z - CABIN.z) < 4.5) continue;
      if (this.world.collision.isBlocked(x, z, 0.8)) continue;
      return { x, z };
    }
    return { x: this.home.x, z: this.home.z };
  }

  setState(s, t) {
    this.state = s;
    this.timer = t;
    if (s === 'walk' || s === 'leave' || s === 'arrive') this.targetSpeed = 0.75 + this.rand() * 0.35;
    else if (s === 'flee') this.targetSpeed = 6.5 + this.rand() * 1.5;
    else this.targetSpeed = 0;
  }

  think(dt, player) {
    const dx = player.x - this.x, dz = player.z - this.z;
    const dPlayer = Math.hypot(dx, dz);
    this.timer -= dt;

    // awareness of the player
    if (this.state !== 'flee' && this.state !== 'hidden') {
      const scary = dPlayer < 6.5 || (player.running && dPlayer < 15) || (player.speed > 1 && dPlayer < 9);
      if (scary) {
        const a = Math.atan2(-dz, -dx) + (this.rand() - 0.5) * 0.8;
        this.target = { x: this.x + Math.cos(a) * 45, z: this.z + Math.sin(a) * 45 };
        this.setState('flee', 4 + this.rand() * 3);
        this.world.emit('deerSnort', this);
        return;
      }
      if (dPlayer < 14 && this.state !== 'alert' && this.alertCooldown <= 0) {
        this.setState('alert', 2.5 + this.rand() * 4);
        this.alertCooldown = 12;
        if (this.rand() < 0.4) this.world.emit('deerSnort', this);
      }
    }
    this.alertCooldown = (this.alertCooldown || 0) - dt;

    switch (this.state) {
      case 'idle':
      case 'graze':
      case 'alert':
        if (this.timer <= 0) this.decide(dPlayer);
        break;
      case 'walk':
      case 'arrive':
      case 'flee':
      case 'leave': {
        const tx = this.target.x - this.x, tz = this.target.z - this.z;
        const dist = Math.hypot(tx, tz);
        if (this.state === 'leave' && dPlayer > 70) { this.hide(); break; }
        if (dist < 1.2 || this.timer <= 0) {
          if (this.state === 'flee') {
            this.target = this.pickTarget('leave');
            this.setState('walk', 6);
          } else this.decide(dPlayer);
        }
        break;
      }
      case 'hidden':
        this.hiddenTimer -= dt;
        if (this.hiddenTimer <= 0) this.reappear();
        break;
    }
  }

  decide(dPlayer) {
    const r = this.rand();
    if (this.state === 'walk' || this.state === 'arrive') {
      if (r < 0.55) return this.setState('graze', 5 + this.rand() * 10);
      return this.setState('idle', 2 + this.rand() * 4);
    }
    if (r < 0.5) {
      const kind = this.rand() < 0.22 ? 'cabin' : 'wander';
      this.target = this.pickTarget(kind);
      return this.setState('walk', 40);
    }
    if (r < 0.62 && dPlayer < 60) {
      this.target = this.pickTarget('leave');
      return this.setState('leave', 70);
    }
    if (r < 0.85) return this.setState('graze', 5 + this.rand() * 12);
    return this.setState('idle', 2 + this.rand() * 4);
  }

  hide() {
    this.state = 'hidden';
    this.hiddenTimer = 15 + this.rand() * 40;
    this.model.root.visible = false;
    this.speed = 0;
    this.collider.x = 9999;
  }

  reappear() {
    // come back out of the mist somewhere 45-65 m from the player
    const p = this.world.player;
    for (let i = 0; i < 30; i++) {
      const a = this.rand() * TAU, d = 45 + this.rand() * 20;
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (Math.hypot(x, z) > 150 || this.world.collision.isBlocked(x, z, 0.8)) continue;
      this.x = x; this.z = z;
      this.model.root.visible = true;
      this.target = this.rand() < 0.4 ? this.pickTarget('cabin') : { x: p.x + (x - p.x) * 0.45 + (this.rand() - 0.5) * 10, z: p.z + (z - p.z) * 0.45 + (this.rand() - 0.5) * 10 };
      this.home = { x: this.target.x, z: this.target.z };
      this.setState('arrive', 60);
      return;
    }
    this.hiddenTimer = 5;
  }

  update(dt, time, player) {
    if (this.state === 'hidden') { this.think(dt, player); return; }
    this.think(dt, player);
    const m = this.model;
    const col = this.world.collision;

    // steering
    const moving = this.targetSpeed > 0 && this.target;
    if (moving) {
      let desired = Math.atan2(this.target.x - this.x, this.target.z - this.z);
      // obstacle avoidance: probe ahead
      const look = 1.6 + this.speed * 0.4;
      const px = this.x + Math.sin(this.heading) * look, pz = this.z + Math.cos(this.heading) * look;
      if (col.isBlocked(px, pz, 0.6)) {
        const l = col.isBlocked(this.x + Math.sin(this.heading + 0.8) * look, this.z + Math.cos(this.heading + 0.8) * look, 0.6);
        desired = this.heading + (l ? -1.2 : 1.2);
      }
      let dh = ((desired - this.heading + Math.PI * 3) % TAU) - Math.PI;
      const turnRate = this.state === 'flee' ? 3.0 : 1.3;
      this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, dh));
      // slow down for sharp turns
      this.speedLimit = Math.abs(dh) > 1.2 ? 0.4 : 1;
    } else this.speedLimit = 1;
    this.speed = damp(this.speed, this.targetSpeed * this.speedLimit, this.state === 'flee' ? 3 : 2, dt);
    const p = { x: this.x + Math.sin(this.heading) * this.speed * dt, z: this.z + Math.cos(this.heading) * this.speed * dt, self: this.collider };
    col.resolve(p, 0.45 * this.scale);
    this.x = p.x; this.z = p.z;
    this.collider.x = this.x; this.collider.z = this.z;

    // ground follow & slope pitch
    const t = this.world.terrain;
    const y = t.heightAt(this.x, this.z);
    const fy = t.heightAt(this.x + Math.sin(this.heading) * 0.6, this.z + Math.cos(this.heading) * 0.6);
    const by = t.heightAt(this.x - Math.sin(this.heading) * 0.6, this.z - Math.cos(this.heading) * 0.6);
    const pitch = Math.atan2(by - fy, 1.2);
    m.root.position.set(this.x, y, this.z);
    m.root.rotation.set(0, this.heading, 0);
    m.body.rotation.x = damp(m.body.rotation.x, pitch * 0.8, 4, dt);

    // gait
    const running = this.speed > 2.5;
    const stride = running ? 0.55 : 1.15;
    this.gait += (this.speed / stride) * dt;
    const g = this.gait * TAU;
    const amp = Math.min(1, this.speed / 0.9);
    for (let i = 0; i < 4; i++) {
      const L = m.legs[i];
      let off;
      if (running) off = L.front ? (L.side < 0 ? 0 : 0.08) : (L.side < 0 ? 0.5 : 0.58); // bound
      else off = [0.25, 0.75, 0.0, 0.5][i]; // lateral sequence walk
      const ph = g + off * TAU;
      const swing = Math.sin(ph) * (running ? 0.75 : 0.32) * amp;
      const lift = Math.max(0, -Math.cos(ph)) * (running ? 1.2 : 0.7) * amp;
      L.hip.rotation.x = swing;
      L.knee.rotation.x = L.front ? lift : -lift * 0.8;
    }
    // body motion
    const bob = running ? Math.abs(Math.sin(g)) * 0.12 : Math.abs(Math.sin(g * 2)) * 0.018 * amp;
    m.body.position.y = bob;
    m.body.rotation.z = running ? 0 : Math.sin(g) * 0.02 * amp;
    if (running) m.body.rotation.x += Math.sin(g) * 0.12;

    // step sound events
    const stepPhase = Math.floor(this.gait * 2);
    if (stepPhase !== this.lastStepPhase && this.speed > 0.3) {
      this.lastStepPhase = stepPhase;
      this.world.emit('deerStep', this);
    }

    // head & neck
    const grazing = this.state === 'graze';
    this.grazeAmt = damp(this.grazeAmt, grazing ? 1 : 0, 1.6, dt);
    const alert = this.state === 'alert' || this.state === 'flee';
    this.alertAmt = damp(this.alertAmt, this.state === 'alert' ? 1 : 0, 3, dt);
    // look target yaw
    let lookYaw = 0;
    if (this.state === 'alert') {
      const a = Math.atan2(player.x - this.x, player.z - this.z);
      lookYaw = ((a - this.heading + Math.PI * 3) % TAU) - Math.PI;
      lookYaw = Math.max(-1.3, Math.min(1.3, lookYaw));
    } else if (this.state === 'idle') {
      lookYaw = Math.sin(time * 0.4 + this.scale * 10) * 0.9;
    }
    this.lookYaw = damp(this.lookYaw, lookYaw, 2.5, dt);
    // occasionally lift head while grazing to check surroundings
    const peek = grazing && Math.sin(time * 0.35 + this.scale * 31) > 0.85 ? 1 : 0;
    this.peek = damp(this.peek || 0, peek, 2, dt);
    const graze = this.grazeAmt * (1 - this.peek);
    m.neckPivot.rotation.x = 0.42 - this.alertAmt * 0.3 + graze * 2.2 + (running ? 0.35 : 0);
    m.neckPivot.rotation.y = this.lookYaw * 0.55;
    m.headPivot.rotation.x = -0.1 + graze * -0.7 + this.alertAmt * 0.15 + (grazing ? Math.sin(time * 9) * 0.04 * graze : 0);
    m.headPivot.rotation.y = this.lookYaw * 0.45;
    if (!grazing && !alert) m.headPivot.rotation.x += Math.sin(g * 2) * 0.05 * amp;

    // ears
    this.earTimer -= dt;
    if (this.earTimer <= 0) { this.earFlick = 1; this.earSide = this.rand() < 0.5 ? 0 : 1; this.earTimer = 1.5 + this.rand() * 5; }
    this.earFlick = Math.max(0, this.earFlick - dt * 4);
    m.ears.forEach((e, i) => {
      const s = e.userData.side;
      const perk = this.alertAmt * 0.45;
      e.rotation.z = -s * (0.75 - perk) + (i === this.earSide ? Math.sin(this.earFlick * 20) * 0.35 * this.earFlick : 0);
      e.rotation.y = s * perk * 0.4;
    });
    // tail
    this.tailTimer -= dt;
    if (this.tailTimer <= 0) { this.tailFlick = 1; this.tailTimer = 2 + this.rand() * 6; }
    this.tailFlick = Math.max(0, this.tailFlick - dt * 2.5);
    m.tailPivot.rotation.x = 0.35 - (alert ? 0.9 * Math.max(this.alertAmt, running ? 1 : 0) : 0) + Math.sin(this.tailFlick * 25) * 0.3 * this.tailFlick;
  }
}

export class DeerHerd {
  constructor(T, world) {
    this.group = new THREE.Group();
    this.agents = [];
    const defs = [
      // a doe & two young near the left side of the trail
      { x: -14, z: -8, home: { x: -16, z: -12 }, scale: 1.0, seed: 1, tone: 1.0 },
      { x: -17, z: -6, home: { x: -16, z: -12 }, scale: 0.82, seed: 2, tone: 1.08 },
      { x: -19, z: -11, home: { x: -16, z: -12 }, scale: 0.78, seed: 3, tone: 0.95 },
      // a buck wandering further away
      { x: 26, z: 18, home: { x: 24, z: 10 }, scale: 1.12, seed: 4, buck: true, tone: 0.9 },
      // another doe deep in the forest, mostly seen through the mist
      { x: -32, z: 34, home: { x: -30, z: 30 }, scale: 0.98, seed: 5, tone: 1.05 },
    ];
    for (const d of defs) {
      const a = new DeerAgent(T, world, d);
      this.agents.push(a);
      this.group.add(a.model.root);
    }
  }

  update(dt, time, player) {
    for (const a of this.agents) a.update(dt, time, player);
  }
}
