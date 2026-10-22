import * as THREE from 'three';
import { CABIN } from '../../config/config.js';
import { mulberry32 } from '../../utils/noise.js';
import { SkinBinding } from './skinBinding.ts';

// Small birds that perch on branches / logs / the cabin roof, hop, sing
// (audio events), and fly between perches with flapping & gliding;
// plus a few rabbits that hop around near the bushes.

const TAU = Math.PI * 2;

function birdModel(rand) {
  const tone = 0.6 + rand() * 0.5;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.22 * tone, 0.16 * tone, 0.11 * tone), roughness: 0.8 });
  const bellyMat = new THREE.MeshStandardMaterial({ color: rand() < 0.4 ? 0x9a5a32 : 0x8c8478, roughness: 0.8 });
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).scale(0.045, 0.045, 0.075), bodyMat);
  body.position.y = 0.05;
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.038, 0.035, 0.055), bellyMat);
  belly.position.set(0, 0.035, 0.012);
  const head = new THREE.Group();
  head.position.set(0, 0.085, 0.055);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), bodyMat));
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.03, 5).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2520 }));
  beak.position.set(0, -0.003, 0.038);
  head.add(beak);
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.08).translate(0, -0.04, 0).rotateX(-Math.PI / 2 + 0.3), bodyMat);
  tail.material.side = THREE.DoubleSide;
  tail.position.set(0, 0.06, -0.06);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.03, 0.07, 0.0);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.03); shape.lineTo(s * 0.13, 0.0); shape.lineTo(s * 0.11, -0.035); shape.lineTo(0, -0.045);
    const wg = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const w = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: bodyMat.color, side: THREE.DoubleSide, roughness: 0.8 }));
    pivot.add(w);
    root.add(pivot);
    wings.push({ pivot, side: s });
  }
  root.add(body, belly, head, tail);
  root.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return { root, head, wings, body };
}

class Bird {
  constructor(world, perches, seed) {
    this.world = world;
    this.rand = mulberry32(seed);
    this.m = birdModel(this.rand);
    this.perches = perches;
    this.perch = perches[Math.floor(this.rand() * perches.length)];
    this.pos = new THREE.Vector3(this.perch.x, this.perch.y, this.perch.z);
    this.state = 'perched';
    this.timer = 3 + this.rand() * 10;
    this.singTimer = 2 + this.rand() * 15;
    this.heading = this.rand() * TAU;
    this.species = Math.floor(this.rand() * 4);
    this.flapT = 0;
  }

  takeOff() {
    let next;
    for (let i = 0; i < 10; i++) {
      next = this.perches[Math.floor(this.rand() * this.perches.length)];
      const d = Math.hypot(next.x - this.pos.x, next.z - this.pos.z);
      if (d > 6 && d < 60) break;
    }
    this.from = this.pos.clone();
    this.to = new THREE.Vector3(next.x, next.y, next.z);
    this.perch = next;
    const d = this.from.distanceTo(this.to);
    this.flightDur = d / (5 + this.rand() * 3);
    this.arc = 1.5 + d * 0.15;
    this.flightT = 0;
    this.state = 'flying';
    this.world.emit('birdFlap', this);
  }

  update(dt, time, player, env) {
    const m = this.m;
    if (this.state === 'perched') {
      this.timer -= dt;
      const dp = Math.hypot(player.x - this.pos.x, player.z - this.pos.z);
      if (dp < 4.5 && this.pos.y < player.y + 2.5) this.timer = Math.min(this.timer, 0.05);
      if (this.timer <= 0 && (!env.isDark || dp < 4.5)) {
        this.takeOff();
      } else if (this.timer <= 0) this.timer = 20;
      // song (day only)
      this.singTimer -= dt * (0.35 + env.birdActivity);
      if (this.singTimer <= 0) {
        if (env.birdActivity > 0.15 && this.rand() < env.birdActivity) this.world.emit('birdSong', this);
        this.singTimer = 4 + this.rand() * 18;
      }
      // little hops and head turns
      if (this.rand() < dt * 0.4) this.heading += (this.rand() - 0.5) * 2;
      m.head.rotation.y = Math.sin(time * 1.7 + this.species * 3) * 0.6 * (Math.sin(time * 0.6 + this.species) > 0 ? 1 : 0);
      m.head.rotation.x = this.perch.ground && Math.sin(time * 2.1 + this.species) > 0.6 ? 0.8 : 0;
      for (const w of m.wings) { w.pivot.rotation.z = 0; w.pivot.rotation.y = -w.side * 0.15; }
      m.root.position.copy(this.pos);
      m.root.rotation.set(0, this.heading, 0);
    } else {
      this.flightT += dt / this.flightDur;
      const t = Math.min(1, this.flightT);
      const e = t * t * (3 - 2 * t);
      const prev = this.pos.clone();
      this.pos.lerpVectors(this.from, this.to, e);
      this.pos.y += Math.sin(t * Math.PI) * this.arc;
      const dir = this.pos.clone().sub(prev);
      if (dir.lengthSq() > 1e-8) this.heading = Math.atan2(dir.x, dir.z);
      m.root.position.copy(this.pos);
      m.root.rotation.set(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) * 0.5, this.heading, 0);
      // flap, with glides in the middle of long flights
      const glide = t > 0.35 && t < 0.65 && this.flightDur > 3 && Math.sin(time * 2) > 0;
      this.flapT += dt * (glide ? 0 : 24);
      const f = glide ? 0.15 : Math.sin(this.flapT) * 0.9;
      for (const w of m.wings) { w.pivot.rotation.z = w.side * f; w.pivot.rotation.y = 0; }
      if (t >= 1) {
        this.state = 'perched';
        this.pos.copy(this.to);
        this.timer = 6 + this.rand() * 25;
      }
    }
  }
}

function rabbitModel() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 0.9 });
  const light = new THREE.MeshStandardMaterial({ color: 0xcfc6ba, roughness: 0.9 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10).scale(0.1, 0.1, 0.15), mat);
  torso.position.set(0, 0.11, 0);
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).scale(0.09, 0.09, 0.09), mat);
  haunch.position.set(0, 0.1, -0.08);
  const head = new THREE.Group();
  head.position.set(0, 0.19, 0.12);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8).scale(0.055, 0.055, 0.07), mat));
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.018, 0.075, 0.01).translate(0, 0.07, 0), mat);
    ear.position.set(s * 0.025, 0.035, -0.01);
    ear.rotation.set(-0.35, 0, -s * 0.15);
    head.add(ear);
  }
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), eyeMat);
    eye.position.set(s * 0.04, 0.015, 0.03);
    head.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), light);
  tail.position.set(0, 0.13, -0.16);
  body.add(torso, haunch, head, tail);
  return { root, body, head };
}

class Rabbit {
  constructor(world, home, seed, model = null) {
    this.world = world;
    this.rand = mulberry32(seed);
    this.m = rabbitModel();
    if (model) {
      // the skinned rabbit built in Blender, driven by this little rig
      const fur = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      this.binding = new SkinBinding(this.m.root, model, { body: this.m.body, head: this.m.head }, (mesh) => {
        if (mesh.material.name === 'fur') mesh.material = fur;
      });
    }
    this.home = home;
    this.x = home.x + (this.rand() - 0.5) * 4;
    this.z = home.z + (this.rand() - 0.5) * 4;
    this.heading = this.rand() * TAU;
    this.state = 'idle';
    this.timer = 1 + this.rand() * 3;
    this.hopT = 0;
    this.hops = 0;
    this.fleeing = false;
  }

  update(dt, time, player) {
    const terrain = this.world.terrain;
    const dp = Math.hypot(player.x - this.x, player.z - this.z);
    if (dp < 5 && !this.fleeing) {
      this.fleeing = true;
      this.heading = Math.atan2(this.x - player.x, this.z - player.z) + (this.rand() - 0.5) * 0.6;
      this.state = 'hop'; this.hops = 8 + Math.floor(this.rand() * 6); this.hopT = 0;
    }
    let lift = 0;
    if (this.state === 'idle') {
      this.timer -= dt;
      // nibbling / sitting up
      this.m.head.rotation.x = Math.sin(time * 1.3 + this.home.x) > 0.3 ? 0.5 + Math.sin(time * 12) * 0.05 : -0.2;
      if (this.timer <= 0) {
        this.state = 'hop';
        this.hops = 1 + Math.floor(this.rand() * 4);
        this.hopT = 0;
        const toHome = Math.atan2(this.home.x - this.x, this.home.z - this.z);
        const far = Math.hypot(this.home.x - this.x, this.home.z - this.z) > 8;
        this.heading = far ? toHome : this.heading + (this.rand() - 0.5) * 2.5;
      }
    } else {
      const dur = this.fleeing ? 0.22 : 0.32;
      const dist = this.fleeing ? 0.9 : 0.4;
      this.hopT += dt / dur;
      lift = Math.sin(Math.min(1, this.hopT) * Math.PI) * (this.fleeing ? 0.22 : 0.12);
      const p = { x: this.x + Math.sin(this.heading) * dist * dt / dur, z: this.z + Math.cos(this.heading) * dist * dt / dur };
      if (this.world.collision.resolve(p, 0.15)) this.heading += 1.2;
      this.x = p.x; this.z = p.z;
      this.m.head.rotation.x = -0.1;
      if (this.hopT >= 1) {
        this.hopT = 0;
        this.hops--;
        if (this.hops <= 0) {
          this.state = 'idle';
          this.timer = 1.5 + this.rand() * 5;
          if (this.fleeing && dp > 9) this.fleeing = false;
          else if (this.fleeing) { this.state = 'hop'; this.hops = 4; }
        }
      }
    }
    this.m.root.position.set(this.x, terrain.heightAt(this.x, this.z) + lift, this.z);
    this.m.root.rotation.y = this.heading;
    this.m.body.rotation.x = this.state === 'hop' ? Math.sin(this.hopT * TAU) * 0.25 : 0;
    if (this.binding) {
      this.m.root.updateMatrixWorld(true);
      this.binding.sync();
    }
  }
}

export class Wildlife {
  /** `scenes`: models built in Blender (the rabbit) */
  constructor(world, forest, scenes = null) {
    this.group = new THREE.Group();
    const rand = mulberry32(4242);
    // perch points: branch stubs on trees, logs, rocks, the cabin ridge, woodpile
    const perches = [];
    const trees = forest.trees.filter((t) => Math.hypot(t.x, t.z - 5) < 60);
    for (let i = 0; i < 70 && trees.length; i++) {
      const t = trees[Math.floor(rand() * trees.length)];
      // sit on the lowest branch tier, a little out from the trunk
      const a = rand() * TAU, d = 0.9 + rand() * 1.0;
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      const tier = t.kind === 'conifer' ? 0.36 : t.kind === 'broadleaf' ? 0.58 : 0.5;
      perches.push({ x, z, y: world.terrain.heightAt(t.x, t.z) + t.height * (tier + rand() * 0.1) });
    }
    for (let i = 0; i < 25; i++) {
      const a = rand() * TAU, d = 2 + rand() * 25;
      const x = Math.cos(a) * d, z = Math.sin(a) * d - 6;
      if (world.collision.isBlocked(x, z, 0.3)) continue;
      perches.push({ x, z, y: world.terrain.heightAt(x, z) + 0.02, ground: true });
    }
    const roofY = world.cabin.roofCenter.y + world.cabin.dims.rise * 0.5 + 0.25;
    perches.push({ x: CABIN.x, z: CABIN.z + 1.5, y: roofY }, { x: CABIN.x, z: CABIN.z - 1.0, y: roofY });
    perches.push({ x: CABIN.x + 1.8, z: CABIN.z + CABIN.depth / 2 + 0.55, y: world.cabin.worldBase.y + 1.25 });
    this.birds = [];
    for (let i = 0; i < 9; i++) {
      const b = new Bird(world, perches, 100 + i);
      this.birds.push(b);
      this.group.add(b.m.root);
    }
    this.rabbits = [];
    const homes = [{ x: -6, z: 6 }, { x: 8, z: -4 }, { x: -9, z: -18 }];
    homes.forEach((h, i) => {
      const r = new Rabbit(world, h, 300 + i, scenes && scenes.rabbit);
      this.rabbits.push(r);
      this.group.add(r.m.root);
    });
  }

  update(dt, time, player, env) {
    for (const b of this.birds) b.update(dt, time, player, env);
    for (const r of this.rabbits) r.update(dt, time, player);
  }
}
