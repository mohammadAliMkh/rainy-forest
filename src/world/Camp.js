import * as THREE from 'three';
import { FIRE, CAMP } from '../core/config.js';
import { mulberry32, damp } from '../utils/noise.js';
import { bakeByMaterial, bakeJoints } from '../utils/bake.js';
import { taperTube, teaGlass } from '../people/Human.js';
import { FRIENDS } from '../people/friendSpecs.js';
import { Gathering } from '../people/Gathering.js';
import { Dog } from '../creatures/Dog.js';
import { Patrol } from '../vehicles/Patrol.js';
import { Hornet } from '../vehicles/Hornet.js';
import { Smoke } from './Fire.js';
import { IntroDirector } from './IntroDirector.js';
import { Canopy } from './Canopy.js';

// The camp in front of the cabin: four friends in warm clothes sitting on
// logs and stumps around the fire drinking tea, Luna lying beside her owner,
// a kettle with a teapot on top warming at the fire, a crate with a tray of
// tea things, Amir's Patrol parked beside the cabin and the Hornet on its
// side stand. Built before the forest so its colliders keep trees away.

export class Camp {
  constructor(T, terrain, collision) {
    this.group = new THREE.Group();
    const rand = mulberry32(2024);
    const F = new THREE.Vector3(FIRE.x, terrain.heightAt(FIRE.x, FIRE.z), FIRE.z);
    this.fire = F;

    const woodMats = [
      new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkNormal, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: T.logEnd, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ map: T.logEnd, roughness: 0.75 }),
    ];
    const unitLog = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);

    // ---- seats + people ----
    const shared = {
      glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.04, metalness: 0, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false }),
      tea: new THREE.MeshStandardMaterial({ color: 0x7a2006, roughness: 0.15, emissive: 0x1c0500 }),
    };
    this.shared = shared;
    const seats = [];
    for (const s of CAMP.seats) {
      const x = F.x + s.dx, z = F.z + s.dz;
      const facing = Math.atan2(F.x - x, F.z - z) + (s.turn ?? 0);
      const g = terrain.heightAt(x, z);
      const fwd = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
      let top;
      if (s.seat === 'log') {
        const r = 0.235, len = 1.45;
        const m = new THREE.Mesh(unitLog, woodMats);
        m.scale.set(r, len, r);
        // lying across the sitter's facing direction
        m.rotation.set(0, facing + Math.PI / 2, Math.PI / 2, 'YXZ');
        m.position.set(x - fwd.x * 0.04, g + r * 0.85, z - fwd.z * 0.04);
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        collision.addBox(x, z, len / 2, r + 0.05, facing + Math.PI / 2, 'prop');
        top = g + r * 1.85;
      } else {
        const r = 0.25, h = 0.44;
        const m = new THREE.Mesh(unitLog, woodMats);
        m.scale.set(r, h, r);
        m.position.set(x - fwd.x * 0.03, g + h / 2 - 0.01, z - fwd.z * 0.03);
        m.rotation.y = rand() * 6;
        m.castShadow = true; m.receiveShadow = true;
        this.group.add(m);
        top = g + h - 0.01;
      }
      // the person (plus their legs / feet) blocks the player
      collision.addCircle(x + fwd.x * 0.2, z + fwd.z * 0.2, 0.45, 'person');
      seats.push({ key: s.key, spec: FRIENDS[s.key], x, y: top, z, facing, lean: s.lean, kneeSpread: s.kneeSpread, waves: s.waves, center: F });
    }
    this.gathering = new Gathering(seats, shared, rand);
    this.group.add(this.gathering.group);
    // static parts of each person merged per material (heads keep eyes / lids / mouth separate)
    for (const p of this.gathering.people) {
      const h = p.h;
      bakeByMaterial(h.head.group, (m) => h.head.eyes.some((e) => e.children.includes(m)) || h.head.lids.some((l) => l.children.includes(m)) || m.parent === h.head.mouth);
      for (const e of h.head.eyes) e.userData.keep = true;
      for (const l of h.head.lids) l.userData.keep = true;
      h.head.mouth.userData.keep = true;
      bakeJoints(h.root);
    }

    // ---- Luna next to her owner ----
    const owner = this.gathering.byName('owner');
    {
      const o = owner.seat;
      const fwd = owner.fwd, left = owner.right.clone().negate();
      const x = o.x + left.x * 0.66 + fwd.x * 0.18, z = o.z + left.z * 0.66 + fwd.z * 0.18;
      this.dog = new Dog();
      this.dog.place(x, terrain.heightAt(x, z), z, o.facing + 0.35);
      this.group.add(this.dog.root);
      collision.addCircle(x + fwd.x * 0.15, z + fwd.z * 0.15, 0.4, 'dog');
      this.gathering.dog = this.dog;
    }

    // ---- kettle with a teapot on top, at the edge of the fire ----
    {
      const k = new THREE.Group();
      const enamel = new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.25, metalness: 0.05 });
      const enamelBlue = new THREE.MeshStandardMaterial({ color: 0x2a4f8a, roughness: 0.3 });
      const metal = new THREE.MeshStandardMaterial({ color: 0x8c8f93, metalness: 0.9, roughness: 0.35 });
      const soot = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.9 });
      const body = [[0, 0], [0.11, 0], [0.125, 0.03], [0.125, 0.11], [0.1, 0.16], [0.05, 0.18], [0.05, 0.19], [0, 0.19]];
      const kettle = new THREE.Mesh(new THREE.LatheGeometry(body.map(([r, y]) => new THREE.Vector2(r, y)), 24), enamel);
      kettle.castShadow = true;
      k.add(kettle);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.127, 0.127, 0.02, 24, 1, true), enamelBlue);
      band.position.y = 0.09;
      k.add(band);
      const sootBase = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.11, 0.03, 24), soot);
      sootBase.position.y = 0.012;
      k.add(sootBase);
      k.add(new THREE.Mesh(taperTube([new THREE.Vector3(0, 0.07, 0.11), new THREE.Vector3(0, 0.12, 0.17), new THREE.Vector3(0, 0.17, 0.21)], 0.022, 0.011, 8, 10), enamel));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.008, 6, 16, Math.PI), metal);
      handle.position.y = 0.19;
      k.add(handle);
      // teapot (ghoori) sitting on the kettle
      const pot = [[0, 0], [0.055, 0], [0.075, 0.03], [0.072, 0.07], [0.045, 0.095], [0.03, 0.1], [0, 0.11]];
      const tp = new THREE.Mesh(new THREE.LatheGeometry(pot.map(([r, y]) => new THREE.Vector2(r, y)), 20), new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.2 }));
      tp.position.y = 0.19;
      tp.castShadow = true;
      k.add(tp);
      const flowers = new THREE.Mesh(new THREE.CylinderGeometry(0.0745, 0.0745, 0.018, 20, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a2a3a, roughness: 0.3 }));
      flowers.position.y = 0.235;
      k.add(flowers);
      k.add(new THREE.Mesh(taperTube([new THREE.Vector3(0, 0.215, 0.065), new THREE.Vector3(0, 0.24, 0.1), new THREE.Vector3(0, 0.27, 0.12)], 0.012, 0.007, 6, 8), enamel));
      const ph = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12, Math.PI * 1.3), enamel);
      ph.position.set(0, 0.24, -0.075);
      ph.rotation.y = Math.PI / 2;
      k.add(ph);
      const a = CAMP.kettleAngle;
      const kx = F.x + Math.cos(a) * 0.62, kz = F.z + Math.sin(a) * 0.62;
      k.position.set(kx, F.y + 0.12, kz);
      k.rotation.y = -a + Math.PI / 2;
      // flat stones under it
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.12, 9), new THREE.MeshStandardMaterial({ map: T.stone, roughness: 0.6 }));
      st.position.set(kx, F.y + 0.06, kz);
      st.receiveShadow = true;
      this.group.add(st);
      bakeByMaterial(k);
      this.group.add(k);
      const spout = new THREE.Vector3(0, 0.17, 0.21).applyAxisAngle(new THREE.Vector3(0, 1, 0), k.rotation.y).add(k.position);
      this.steam = new Smoke({ max: 16, rate: 1.6, life: [2, 3.2], size: [0.04, 0.4], rise: [0.25, 0.4], alpha: 0.11, color: 0xe8e8e8, origin: spout });
      this.group.add(this.steam.mesh);
    }

    // ---- crate with a tray: sugar bowl, dates, spare glasses, thermos ----
    {
      const c = new THREE.Group();
      const x = F.x + CAMP.crate.dx, z = F.z + CAMP.crate.dz;
      c.position.set(x, terrain.heightAt(x, z), z);
      c.rotation.y = CAMP.crate.rot;
      const plank = new THREE.MeshStandardMaterial({ map: T.planks, roughness: 0.8, color: 0xb59a7a });
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.36), plank);
      crate.position.y = 0.17;
      crate.castShadow = true;
      c.add(crate);
      const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.015, 28), new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 1, roughness: 0.3 }));
      tray.position.y = 0.348;
      c.add(tray);
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.3, side: THREE.DoubleSide }));
      bowl.rotation.x = Math.PI;
      bowl.position.set(-0.07, 0.41, 0.04);
      bowl.position.y = 0.356 + 0.055;
      c.add(bowl);
      // nabat (saffron rock candy) crystals in the bowl
      const nabatMat = new THREE.MeshPhysicalMaterial({ color: 0xe8a72c, roughness: 0.15, transmission: 0.3, thickness: 0.01, clearcoat: 1 });
      for (let i = 0; i < 7; i++) {
        const n = new THREE.Mesh(new THREE.OctahedronGeometry(0.011 + rand() * 0.007, 0), nabatMat);
        n.scale.set(1, 1.6, 1);
        n.position.set(-0.07 + (rand() - 0.5) * 0.05, 0.398 + rand() * 0.008, 0.04 + (rand() - 0.5) * 0.05);
        n.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        c.add(n);
      }
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.01, 18), new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.3 }));
      plate.position.set(0.09, 0.362, -0.05);
      c.add(plate);
      const dateMat = new THREE.MeshStandardMaterial({ color: 0x3a1a0c, roughness: 0.35 });
      for (let i = 0; i < 6; i++) {
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), dateMat);
        d.scale.set(1, 0.8, 1.9);
        d.position.set(0.09 + (rand() - 0.5) * 0.07, 0.375, -0.05 + (rand() - 0.5) * 0.07);
        d.rotation.y = rand() * 3;
        c.add(d);
      }
      for (const [gx, gz] of [[0.02, 0.1], [0.1, 0.07]]) {
        const sauc = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.006, 16), new THREE.MeshStandardMaterial({ color: 0xece6da, roughness: 0.3 }));
        sauc.position.set(gx, 0.36, gz);
        c.add(sauc);
        const g = teaGlass(shared);
        g.position.set(gx, 0.364, gz);
        c.add(g);
      }
      const thermos = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x8a1d1d, roughness: 0.35, metalness: 0.4 }));
      thermos.position.set(0.31, 0.15, 0.08);
      thermos.castShadow = true;
      c.add(thermos);
      bakeByMaterial(c);
      this.group.add(c);
      collision.addBox(x, z, 0.32, 0.25, CAMP.crate.rot, 'prop');
    }

    this.intro = new IntroDirector(this);

    // ---- tarp roof over the seats ----
    this.canopy = new Canopy(T, terrain, collision, { cx: F.x, cz: F.z, ...CAMP.canopy });
    this.group.add(this.canopy.group);

    // ---- the Patrol beside the cabin ----
    {
      const car = new Patrol();
      const P = CAMP.car;
      car.group.position.set(P.x, terrain.heightAt(P.x, P.z), P.z);
      car.group.rotation.y = P.yaw;
      bakeByMaterial(car.group);
      this.group.add(car.group);
      collision.addBox(P.x, P.z, car.halfSize.x, car.halfSize.z, P.yaw, 'car');
      this.car = car;
    }
    // ---- the Hornet on its side stand ----
    {
      const bike = new Hornet();
      const B = CAMP.bike;
      bike.group.position.set(B.x, terrain.heightAt(B.x, B.z), B.z);
      bike.group.rotation.y = B.yaw;
      bakeByMaterial(bike.group);
      this.group.add(bike.group);
      collision.addBox(B.x, B.z, 0.4, 1.0, B.yaw, 'bike');
      this.bike = bike;
    }
  }

  addTo(scene) { scene.add(this.group); }

  // hooks set by main:
  //   onVoice(key, position) -> { duration, done, level(), stop() } | null
  //   onDuck(on) (lower the ambience during speech)
  //   onCinematic(on), onCaption(name | null), onFade(0..1) (film-style intro, see IntroDirector)

  update(dt, time, camera, env, windStrength) {
    // the owner welcomes the player and introduces everyone (once per visit)
    {
      const cam = camera.position;
      if (!this.intro.done && Math.hypot(cam.x - this.fire.x, cam.z - this.fire.z) < 5.2) this.intro.start();
      this.intro.update(dt);
    }
    this.gathering.update(dt, time, camera);
    // lip sync from the recording's loudness while it plays
    {
      const h = this.gathering.byName('owner').h;
      const v = this.intro.seq?.voice;
      if (v) h.voiceLevel = damp(h.voiceLevel ?? 0, Math.min(1, v.level() * 1.4), 18, dt);
      else h.voiceLevel = null;
    }
    // Luna: watches the player when close, otherwise whoever is talking
    const cam = camera.position;
    const d = Math.hypot(cam.x - this.dog.root.position.x, cam.z - this.dog.root.position.z);
    const near = Math.max(0, 1 - (d - 1.5) / 4.5);
    const owner = this.gathering.byName('owner');
    const speaker = this.gathering.people[this.gathering.speaker];
    const look = near > 0.2 ? cam : speaker.seat.key === 'owner' ? owner.headPos : speaker.headPos;
    this._dogExcite = damp(this._dogExcite ?? 0, Math.max(near, owner.pet * 0.6), 1.5, dt);
    const lunaFocus = this.gathering.focus === 'luna';
    this.dog.update(dt, lunaFocus ? cam : look, lunaFocus ? 1 : this._dogExcite);
    this.steam.material.uniforms.uLight.value = env ? env.ambientLevel * 0.9 + 0.1 : 1;
    this.steam.update(dt, time, windStrength);
    this.canopy.update(time);
  }
}
