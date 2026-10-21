import * as THREE from 'three';
import { CABIN } from '../../config/config.js';
import { mulberry32 } from '../../utils/noise.js';
import { merge, rockGeometry } from './plantGeometry.js';
import { Flames, Smoke } from '../camp/Fire.js';

// Rustic log cabin (like the reference photo): stacked round logs with
// crossing corner ends, steep gable roof with mossy shingles, stone chimney
// with smoke, a warmly glowing window, an open door showing a fireplace,
// a stacked woodpile and a chopping block (the seats around the campfire
// belong to the camp, see Camp.js).

export class Cabin {
  constructor(T, terrain, collision) {
    this.group = new THREE.Group();
    const baseY = terrain.clearingHeight;
    this.group.position.set(CABIN.x, baseY, CABIN.z);
    this.group.rotation.y = CABIN.rotation;
    this.worldBase = new THREE.Vector3(CABIN.x, baseY, CABIN.z);
    const rand = mulberry32(808);

    const W = CABIN.width, D = CABIN.depth, H = CABIN.wallHeight;
    const r = 0.15;
    const course = r * 1.9;
    const plinth = 0.28;
    const rise = 2.2;
    this.dims = { W, D, H, rise };

    // ---------- materials ----------
    const woodMat = new THREE.MeshStandardMaterial({ map: T.wood, normalMap: T.woodNormal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.72, vertexColors: true, envMapIntensity: 0.6 });
    const endMat = new THREE.MeshStandardMaterial({ map: T.logEnd, roughness: 0.8, vertexColors: true });
    const roofTex = T.shingles.clone();
    roofTex.repeat.set(2.4, 2.0);
    roofTex.needsUpdate = true;
    const roofN = T.shinglesNormal.clone();
    roofN.repeat.copy(roofTex.repeat);
    roofN.needsUpdate = true;
    const roofMat = new THREE.MeshStandardMaterial({ map: roofTex, normalMap: roofN, roughness: 0.5, envMapIntensity: 0.9 });
    const plankMat = new THREE.MeshStandardMaterial({ map: T.planks, roughness: 0.8 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: T.stone, normalMap: T.stoneNormal, roughness: 0.55, vertexColors: true });
    const stoneTex = T.stone.clone(); stoneTex.repeat.set(1.5, 3); stoneTex.needsUpdate = true;
    const chimneyMat = new THREE.MeshStandardMaterial({ map: stoneTex, normalMap: T.stoneNormal, roughness: 0.6 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 1 });

    const sides = [];
    const caps = [];

    // a single round log along an axis, with slight wobble + darker underside
    const addLog = (axis, a0, a1, y, c) => {
      const len = a1 - a0;
      if (len < 0.15) return;
      const g = new THREE.CylinderGeometry(r, r, len, 12, Math.max(1, Math.round(len / 1.2)), true);
      const uv = g.attributes.uv;
      const off = rand();
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.9 + off, uv.getY(i) * len / 2.2 + off * 3);
      const p = g.attributes.position;
      const col = new Float32Array(p.count * 3);
      const tone = 0.8 + rand() * 0.3;
      for (let i = 0; i < p.count; i++) {
        const lx = p.getX(i), lz = p.getZ(i), ly = p.getY(i);
        const k = 1 + Math.sin(ly * 2.1 + off * 9) * 0.04;
        p.setXYZ(i, lx * k, ly, lz * k);
        // darker underside / ends; slight moss near the ground
        const under = (axis === 'x' ? lx < 0 : lz > 0) ? 0.75 : 1;
        const moss = y < 0.9 ? (1 - y / 0.9) * 0.35 : 0;
        col[i * 3] = tone * under * (1 - moss * 0.4);
        col[i * 3 + 1] = tone * under * (1 + moss * 0.15);
        col[i * 3 + 2] = tone * under * (1 - moss * 0.5);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const mid = (a0 + a1) / 2;
      if (axis === 'x') { g.rotateZ(Math.PI / 2); g.translate(mid, y, c); }
      else { g.rotateX(Math.PI / 2); g.translate(c, y, mid); }
      sides.push(g);
      for (const end of [a0, a1]) {
        const cap = new THREE.CircleGeometry(r * 0.98, 12);
        const dir = end === a0 ? -1 : 1;
        if (axis === 'x') { cap.rotateY((dir * Math.PI) / 2); cap.translate(end, y, c); }
        else { if (dir < 0) cap.rotateY(Math.PI); cap.translate(c, y, end); }
        caps.push(cap);
      }
    };

    // openings (local coordinates)
    const door = { wall: 'front', c: -1.0, w: 1.05, y0: plinth, y1: plinth + 1.95 };
    const winFront = { wall: 'front', c: 1.55, w: 1.0, y0: 1.05, y1: 1.95 };
    const winSide = { wall: 'left', c: -0.3, w: 1.0, y0: 1.05, y1: 1.9 };
    const openings = [door, winFront, winSide];

    const segmentsFor = (wall, a0, a1, y) => {
      let segs = [[a0, a1]];
      for (const o of openings) {
        if (o.wall !== wall) continue;
        if (y + r * 0.6 < o.y0 || y - r * 0.6 > o.y1) continue;
        const c0 = o.c - o.w / 2, c1 = o.c + o.w / 2;
        const next = [];
        for (const [s0, s1] of segs) {
          if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
          if (c0 > s0) next.push([s0, c0]);
          if (c1 < s1) next.push([c1, s1]);
        }
        segs = next;
      }
      return segs;
    };

    const over = 0.32;
    const courses = Math.ceil((H - plinth) / course);
    for (let i = 0; i < courses; i++) {
      const yFB = plinth + r + i * course;
      const ySide = yFB + course / 2;
      for (const [s0, s1] of segmentsFor('front', -W / 2 - over, W / 2 + over, yFB)) addLog('x', s0, s1, yFB, D / 2);
      for (const [s0, s1] of segmentsFor('back', -W / 2 - over, W / 2 + over, yFB)) addLog('x', s0, s1, yFB, -D / 2);
      if (ySide < H + 0.1) {
        for (const [s0, s1] of segmentsFor('left', -D / 2 - over, D / 2 + over, ySide)) addLog('z', s0, s1, ySide, -W / 2);
        for (const [s0, s1] of segmentsFor('right', -D / 2 - over, D / 2 + over, ySide)) addLog('z', s0, s1, ySide, W / 2);
      }
    }
    const wallTop = plinth + r + (courses - 1) * course + r;
    // gables (front & back): shortening logs, ridge runs along Z
    const gCourses = Math.ceil(rise / course);
    for (let i = 0; i < gCourses; i++) {
      const y = wallTop + r + i * course;
      const half = (W / 2 + 0.05) * (1 - (y - wallTop + r) / (rise + 0.05));
      if (half < 0.15) break;
      addLog('x', -half, half, y, D / 2);
      addLog('x', -half, half, y, -D / 2);
    }

    const walls = new THREE.Mesh(merge(sides), woodMat);
    walls.castShadow = true; walls.receiveShadow = true;
    const ends = new THREE.Mesh(merge(caps), endMat);
    ends.castShadow = true;
    this.group.add(walls, ends);

    // stone plinth
    const plinthMesh = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, plinth + 0.5, D + 0.2), stoneMat);
    plinthMesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(plinthMesh.geometry.attributes.position.count * 3).fill(0.75), 3));
    plinthMesh.position.y = (plinth - 0.5) / 2;
    plinthMesh.receiveShadow = true;
    this.group.add(plinthMesh);

    // floor + interior shell (dark, so the doorway reads as a deep interior)
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.05, D - 0.2), plankMat);
    floor.position.y = plinth + 0.02;
    floor.receiveShadow = true;
    this.group.add(floor);

    // ---------- roof ----------
    const eave = 0.55, front = 0.85, back = 0.45;
    const run = W / 2 + eave;
    const angle = Math.atan2(rise, W / 2);
    const slopeLen = run / Math.cos(angle) + 0.1;
    const roofDepth = D + front + back;
    const ridgeY = wallTop + rise + 0.18;
    for (const s of [-1, 1]) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.12, roofDepth), roofMat);
      slab.rotation.z = -s * angle;
      slab.position.set(s * (slopeLen / 2) * Math.cos(angle) - s * 0.03, ridgeY - (slopeLen / 2) * Math.sin(angle), (front - back) / 2);
      slab.castShadow = true; slab.receiveShadow = true;
      this.group.add(slab);
      // fascia board along the eave
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, roofDepth + 0.04), plankMat);
      fascia.position.set(s * (slopeLen * Math.cos(angle) - 0.02), ridgeY - slopeLen * Math.sin(angle) - 0.02, (front - back) / 2);
      fascia.rotation.z = -s * angle;
      this.group.add(fascia);
    }
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, roofDepth + 0.1, 8), new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.7 }));
    ridge.rotation.x = Math.PI / 2;
    ridge.position.set(0, ridgeY + 0.05, (front - back) / 2);
    ridge.castShadow = true;
    this.group.add(ridge);
    // barge boards on the front gable
    for (const s of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.22, 0.06), plankMat);
      b.rotation.z = -s * angle;
      b.position.set(s * (slopeLen / 2) * Math.cos(angle), ridgeY - (slopeLen / 2) * Math.sin(angle) - 0.1, D / 2 + front + 0.01);
      this.group.add(b);
    }

    // ---------- chimney (right side, outside) ----------
    const chH = ridgeY + 1.0;
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, chH + 0.3, 0.95), chimneyMat);
    chimney.position.set(W / 2 + 0.55, (chH - 0.3) / 2, -0.6);
    chimney.castShadow = true; chimney.receiveShadow = true;
    this.group.add(chimney);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 1.1), chimneyMat);
    cap.position.set(W / 2 + 0.55, chH - 0.06, -0.6);
    this.group.add(cap);
    const flue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.5), darkMat);
    flue.position.set(W / 2 + 0.55, chH + 0.005, -0.6);
    this.group.add(flue);

    // ---------- door (open inward) & frames ----------
    const frameMat = new THREE.MeshStandardMaterial({ map: T.wood, roughness: 0.75, color: 0xb8a38f });
    const frame = (cx, cy, w, h, z, axis = 'x') => {
      const parts = [];
      const t = 0.09;
      parts.push(new THREE.BoxGeometry(w + t * 2, t, 0.34).translate(0, h / 2 + t / 2, 0));
      parts.push(new THREE.BoxGeometry(w + t * 2, t, 0.34).translate(0, -h / 2 - t / 2, 0));
      parts.push(new THREE.BoxGeometry(t, h, 0.34).translate(-w / 2 - t / 2, 0, 0));
      parts.push(new THREE.BoxGeometry(t, h, 0.34).translate(w / 2 + t / 2, 0, 0));
      const g = merge(parts);
      if (axis === 'z') g.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(g, frameMat);
      if (axis === 'x') m.position.set(cx, cy, z); else m.position.set(z, cy, cx);
      m.castShadow = true;
      this.group.add(m);
    };
    frame(door.c, (door.y0 + door.y1) / 2, door.w, door.y1 - door.y0, D / 2);
    frame(winFront.c, (winFront.y0 + winFront.y1) / 2, winFront.w, winFront.y1 - winFront.y0, D / 2);
    frame(winSide.c, (winSide.y0 + winSide.y1) / 2, winSide.w, winSide.y1 - winSide.y0, -W / 2, 'z');

    const doorPivot = new THREE.Group();
    doorPivot.position.set(door.c - door.w / 2, door.y0, D / 2 - 0.05);
    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(door.w - 0.04, door.y1 - door.y0 - 0.04, 0.06), plankMat);
    doorMesh.position.set((door.w - 0.04) / 2, (door.y1 - door.y0) / 2, 0);
    doorMesh.castShadow = true;
    doorPivot.add(doorMesh);
    doorPivot.rotation.y = 1.15; // swung inward
    this.group.add(doorPivot);

    // threshold step
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.55), stoneMat);
    step.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(step.geometry.attributes.position.count * 3).fill(0.8), 3));
    step.position.set(door.c, 0.06, D / 2 + 0.38);
    step.receiveShadow = true;
    this.group.add(step);

    // glowing windows (warm interior light like the reference)
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0x1a120c, emissive: new THREE.Color(1.0, 0.55, 0.22), emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.0,
    });
    const muntinMat = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.8 });
    const addWindow = (o, axis) => {
      const w = o.w, h = o.y1 - o.y0;
      const g = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.windowMat);
      g.add(pane);
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.04), muntinMat);
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.04), muntinMat);
      g.add(m1, m2);
      if (axis === 'x') { g.position.set(o.c, (o.y0 + o.y1) / 2, D / 2 - 0.02); }
      else { g.rotation.y = -Math.PI / 2; g.position.set(-W / 2 - 0.02, (o.y0 + o.y1) / 2, o.c); }
      this.group.add(g);
    };
    addWindow(winFront, 'x');
    addWindow(winSide, 'z');

    // ---------- interior: fireplace glow visible through the door ----------
    const hearth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 0.6), chimneyMat);
    hearth.position.set(W / 2 - 0.45, plinth + 0.7, -0.6);
    hearth.rotation.y = Math.PI / 2;
    this.group.add(hearth);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), darkMat);
    hole.rotation.y = -Math.PI / 2;
    hole.position.set(W / 2 - 0.76, plinth + 0.4, -0.6);
    this.group.add(hole);
    this.innerFlames = new Flames({ count: 3, width: 0.5, height: 0.5, intensity: 0.8 });
    this.innerFlames.group.position.set(W / 2 - 0.8, plinth + 0.12, -0.6);
    this.group.add(this.innerFlames.group);
    this.innerLight = new THREE.PointLight(0xff7a30, 3.2, 4.2, 1.5);
    this.innerLight.position.set(W / 2 - 1.4, plinth + 0.8, -0.4);
    this.group.add(this.innerLight);
    // a little table and a bench silhouette inside
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.7), plankMat);
    table.position.set(-1.2, plinth + 0.75, -1.2);
    this.group.add(table);
    for (const [x, z] of [[-1.7, -1.5], [-0.7, -1.5], [-1.7, -0.9], [-0.7, -0.9]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.06), plankMat);
      leg.position.set(x, plinth + 0.38, z);
      this.group.add(leg);
    }

    // ---------- woodpile along the front wall, under the window ----------
    const pileMat = [
      new THREE.MeshStandardMaterial({ map: T.bark, normalMap: T.barkNormal, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ map: T.logEnd, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ map: T.logEnd, roughness: 0.75 }),
    ];
    const pieceGeo = new THREE.CylinderGeometry(1, 1, 1, 9, 1, false);
    pieceGeo.rotateX(Math.PI / 2); // length along Z (ends face the viewer)
    const pieces = [];
    const pileX0 = 0.55, pileX1 = W / 2 + 0.2, pileZ = D / 2 + 0.55;
    const pr = 0.095;
    for (let row = 0; row < 7; row++) {
      const y = pr + row * pr * 1.75;
      const off = (row % 2) * pr;
      for (let x = pileX0 + pr + off; x < pileX1 - pr; x += pr * 2.02) {
        for (const dz of [-0.24, 0.24]) {
          const rr = pr * (0.82 + rand() * 0.3);
          pieces.push({ x: x + (rand() - 0.5) * 0.02, y: y + (rand() - 0.5) * 0.02, z: pileZ + dz + (rand() - 0.5) * 0.06, r: rr, len: 0.46 + rand() * 0.06, rot: (rand() - 0.5) * 0.1 });
        }
      }
    }
    // a loose second pile like in the reference (front-left of the cabin)
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI;
      const d = rand() * 0.9;
      pieces.push({ x: -W / 2 + 0.2 + Math.cos(a) * d, y: 0.1 + rand() * 0.25, z: D / 2 + 1.5 + Math.sin(a) * d * 0.6, r: 0.08 + rand() * 0.05, len: 0.45 + rand() * 0.1, rot: rand() * 3, roll: (rand() - 0.5) * 0.6 });
    }
    const pile = new THREE.InstancedMesh(pieceGeo, pileMat, pieces.length);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), m4 = new THREE.Matrix4();
    pieces.forEach((p, i) => {
      e.set(p.roll || 0, p.rot, 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.r, p.r, p.len));
      pile.setMatrixAt(i, m4);
    });
    pile.castShadow = true; pile.receiveShadow = true;
    this.group.add(pile);

    // ---------- chopping block + axe, sitting logs near the fire ----------
    const blockGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.55, 12);
    const block = new THREE.Mesh(blockGeo, pileMat);
    block.position.set(-W / 2 - 1.0, 0.27, D / 2 + 1.3);
    block.castShadow = true;
    this.group.add(block);
    const axe = new THREE.Group();
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.8, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.6 }));
    handle.position.y = 0.4;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.03), new THREE.MeshStandardMaterial({ color: 0x3a3c3e, metalness: 0.8, roughness: 0.35 }));
    head.position.set(0.05, 0.78, 0);
    axe.add(handle, head);
    axe.position.set(-W / 2 - 1.0, 0.55, D / 2 + 1.3);
    axe.rotation.set(0.15, 0.5, -0.5);
    this.group.add(axe);

    // world-space props around the clearing
    this.props = new THREE.Group();
    // a few stones around the clearing
    const stones = [];
    for (let i = 0; i < 9; i++) {
      const a = rand() * Math.PI * 2, d = 5 + rand() * 3;
      const x = CABIN.x + Math.cos(a) * d * 1.2, z = CABIN.z + 2 + Math.sin(a) * d;
      const s = 0.2 + rand() * 0.35;
      const g = rockGeometry(900 + i, 2, 0.6, 0.6);
      g.scale(s, s, s);
      g.translate(x, terrain.heightAt(x, z) - s * 0.1, z);
      stones.push(g);
    }
    const stoneMesh = new THREE.Mesh(merge(stones), stoneMat);
    stoneMesh.castShadow = true; stoneMesh.receiveShadow = true;
    this.props.add(stoneMesh);

    // ---------- collisions (world space) ----------
    const toWorld = (lx, lz) => {
      const c = Math.cos(CABIN.rotation), s = Math.sin(CABIN.rotation);
      return [CABIN.x + lx * c + lz * s, CABIN.z - lx * s + lz * c];
    };
    {
      const [x, z] = toWorld(0, 0);
      collision.addBox(x, z, W / 2 + over + 0.1, D / 2 + over + 0.1, CABIN.rotation, 'cabin');
    }
    {
      const [x, z] = toWorld(W / 2 + 0.55, -0.6);
      collision.addBox(x, z, 0.5, 0.5, CABIN.rotation, 'chimney');
    }
    {
      const [x, z] = toWorld((pileX0 + pileX1) / 2, pileZ);
      collision.addBox(x, z, (pileX1 - pileX0) / 2 + 0.05, 0.36, CABIN.rotation, 'woodpile');
    }
    {
      const [x, z] = toWorld(-W / 2 - 1.0, D / 2 + 1.3);
      collision.addCircle(x, z, 0.42, 'prop');
    }

    // chimney smoke (world space)
    const [cx, cz] = toWorld(W / 2 + 0.55, -0.6);
    this.chimneySmoke = new Smoke({
      max: 34, rate: 2.6, life: [8, 12], size: [0.4, 3.2], rise: [0.5, 0.75], alpha: 0.16, color: 0x6d7378,
      origin: new THREE.Vector3(cx, baseY + chH + 0.1, cz),
    });

    // useful anchors for audio
    this.roofCenter = new THREE.Vector3(CABIN.x, baseY + wallTop + rise * 0.5, CABIN.z);
    const [hx, hz] = toWorld(W / 2 - 0.8, -0.6);
    this.hearthWorld = new THREE.Vector3(hx, baseY + plinth + 0.4, hz);
  }

  addTo(scene) {
    scene.add(this.group, this.props, this.chimneySmoke.mesh);
  }

  update(dt, time, camera, env, windStrength) {
    const fl = 0.85 + 0.1 * Math.sin(time * 2.3) + 0.05 * Math.sin(time * 7.7 + 1);
    this.windowMat.emissiveIntensity = (env?.isDark ? 2.2 : 1.4) * fl;
    this.innerLight.intensity = 3.2 * fl;
    this.innerFlames.update(time, camera, fl);
    this.chimneySmoke.material.uniforms.uLight.value = env ? env.ambientLevel * 0.9 + 0.06 : 1;
    this.chimneySmoke.update(dt, time, windStrength);
  }
}
