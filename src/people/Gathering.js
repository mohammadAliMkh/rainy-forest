import * as THREE from 'three';
import { Human } from './Human.js';
import { damp, clamp } from '../utils/noise.js';

// The friends sitting around the fire: who talks, who listens, sips of tea,
// laughter, glances at the dog and a greeting when the player walks up.

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3();

class Seated {
  constructor(spec, seat, shared, rand) {
    this.h = new Human(spec, shared);
    this.spec = spec;
    this.seat = seat;
    this.rand = rand;
    const r = this.h.root;
    r.position.set(seat.x, seat.y, seat.z);
    r.rotation.y = seat.facing;
    this.h.setSeated({ lean: seat.lean ?? 0.12, kneeSpread: seat.kneeSpread ?? 0.12 });
    this.baseLean = seat.lean ?? 0.12;
    this.fwd = new THREE.Vector3(Math.sin(seat.facing), 0, Math.cos(seat.facing));
    this.right = new THREE.Vector3(-this.fwd.z, 0, this.fwd.x); // character's right
    this.yaw = 0; this.pitch = 0;
    this.sip = 0; this.sipPhase = -1; this.nextSip = 4 + rand() * 12;
    this.gesture = 0; this.wave = 0; this.pet = 0;
    this.headPos = new THREE.Vector3();
  }
}

export class Gathering {
  constructor(seats, shared, rand) {
    this.group = new THREE.Group();
    this.people = seats.map((s) => new Seated(s.spec, s, shared, rand));
    for (const p of this.people) this.group.add(p.h.root);
    this.rand = rand;
    this.speaker = 0;
    this.talkT = 3;
    this.laughT = 0;
    this.greetT = 0;
    this.greeted = false;
    this.time = 0;
    this.dog = null;
    this.line = null; // { index, t, dur }: someone saying a line to the player
  }

  // person `key` turns to the player and talks for `dur` seconds, beckoning
  say(key, dur) {
    const index = this.people.findIndex((p) => p.seat.key === key);
    if (index < 0) return;
    this.line = { index, t: 0, dur };
    this.speaker = index;
    this.talkT = dur;
    this.laughT = 0;
  }

  byName(key) { return this.people.find((p) => p.seat.key === key); }

  _nextSpeaker() {
    const n = this.people.length;
    let next = Math.floor(this.rand() * n);
    if (next === this.speaker) next = (next + 1) % n;
    this.speaker = next;
    this.talkT = 2.5 + this.rand() * 5;
  }

  update(dt, time, camera) {
    this.time += dt;
    const rand = this.rand;
    // ---- conversation director ----
    if (this.line) {
      this.line.t += dt;
      this.speaker = this.line.index;
      if (this.line.t >= this.line.dur) { this.line = null; this.talkT = 1.5; }
    }
    this.talkT -= dt;
    if (this.talkT <= 0 && !this.line) {
      if (this.laughT <= 0 && rand() < 0.3) this.laughT = 1.6 + rand() * 1.2;
      this._nextSpeaker();
    }
    this.laughT = Math.max(0, this.laughT - dt);
    const laughing = this.laughT > 0;

    // ---- the player ----
    const cam = camera.position;
    let playerNear = false;
    {
      const c = this.people[0].seat.center;
      const d = Math.hypot(cam.x - c.x, cam.z - c.z);
      playerNear = d < 6.5;
      if (playerNear && !this.greeted) { this.greeted = true; this.greetT = 3.2; }
      if (d > 14) this.greeted = false;
    }
    this.greetT = Math.max(0, this.greetT - dt);

    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      const h = p.h;
      const talking = i === this.speaker && !laughing;
      h.talk = damp(h.talk, talking ? 1 : 0, 6, dt);
      h.laugh = damp(h.laugh, laughing ? (p.seat.key === 'amin' ? 1 : 0.7) : 0, 5, dt);

      // head target: the speaker, the player (greeting / glances), the dog, the fire
      p.headPos.copy(h.headPivot.getWorldPosition(_v));
      let target;
      const saying = this.line && this.line.index === i;
      if (saying || this.greetT > 0 || (this.line && this.line.t < 2.5)) target = cam;
      else if (talking) {
        // speaker looks around the circle
        const k = Math.floor(this.time / 1.7 + i) % this.people.length;
        target = k === i ? this.people[(k + 1) % this.people.length].headPos : this.people[k].headPos;
        if (playerNear && Math.floor(this.time / 2.3 + i) % 4 === 0) target = cam;
      } else if (p.sipPhase >= 0) target = _t.copy(p.headPos).addScaledVector(p.fwd, 1).setY(p.headPos.y - 0.25);
      else if (this.dog && p.seat.key === 'owner' && p.pet > 0.5) target = this.dog.headWorld;
      else {
        target = this.people[this.speaker].headPos;
        if (playerNear && Math.floor(this.time / 3.1 + i * 1.7) % 5 === 0) target = cam;
      }
      // convert to yaw / pitch relative to the body
      const to = _w.subVectors(target, p.headPos);
      const fwdD = to.dot(p.fwd), rightD = to.dot(p.right);
      let yaw = Math.atan2(-rightD, fwdD); // positive = turn left
      const pitch = Math.atan2(to.y, Math.hypot(fwdD, rightD));
      yaw = clamp(yaw, -1.2, 1.2);
      p.yaw = damp(p.yaw, yaw, 3.2, dt);
      p.pitch = damp(p.pitch, clamp(pitch, -0.6, 0.45), 3.2, dt);
      const nod = talking ? Math.sin(this.time * 3.3 + i) * 0.05 : 0;
      const laughBob = h.laugh * (Math.sin(this.time * 17) * 0.04 - 0.22);
      h.neck.rotation.set(-p.pitch * 0.35 + laughBob * 0.4, p.yaw * 0.35, 0, 'YXZ');
      h.headPivot.rotation.set(-p.pitch * 0.65 + nod + laughBob, p.yaw * 0.65, Math.sin(this.time * 0.4 + i) * 0.03, 'YXZ');
      // breathing + laughter shaking the shoulders
      h.spine.rotation.x = p.baseLean + Math.sin(this.time * 1.6 + i) * 0.008 + h.laugh * Math.sin(this.time * 15) * 0.025 - h.laugh * 0.05;
      h.spine.rotation.y = p.yaw * 0.12;

      // ---- sipping tea ----
      p.nextSip -= dt;
      if (p.sipPhase < 0 && p.nextSip <= 0 && !talking && !laughing && this.greetT <= 0) p.sipPhase = 0;
      if (p.sipPhase >= 0) {
        p.sipPhase += dt / 3.6;
        if (p.sipPhase >= 1) { p.sipPhase = -1; p.nextSip = 9 + rand() * 18; }
      }
      const sp = p.sipPhase < 0 ? 0 : Math.min(1, Math.sin(Math.min(1, p.sipPhase) * Math.PI) * 1.6);
      p.sip = sp;

      h.root.updateMatrixWorld(true);
      const kneeR = h.legs[0].knee.getWorldPosition(new THREE.Vector3());
      const kneeL = h.legs[1].knee.getWorldPosition(new THREE.Vector3());
      // right hand: glass resting above the right knee <-> at the lips
      const restR = kneeR.clone().addScaledVector(UP, 0.12 * h.root.scale.x).addScaledVector(p.fwd, -0.07).addScaledVector(p.right, 0.01);
      const poleR = p.right.clone().multiplyScalar(0.7).addScaledVector(UP, -0.6).addScaledVector(p.fwd, -0.3);
      if (sp > 0.01) {
        const mouth = h.mouthWorld(new THREE.Vector3());
        const rim = mouth.addScaledVector(p.fwd, 0.012).addScaledVector(UP, -0.004);
        const tilt = 0.15 + sp * 0.5;
        const thumb = UP.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(p.fwd, -Math.sin(tilt)).normalize();
        const fing = p.right.clone().negate().addScaledVector(p.fwd, 0.3).normalize();
        // blend from the rest pose (wrist position) toward the lips
        if (sp < 0.999) {
          const wristRest = restR.clone();
          h.sipAt(0, rim, thumb, fing, poleR);
          const wristSip = h.arms[0].wrist.getWorldPosition(new THREE.Vector3());
          const e = sp * sp * (3 - 2 * sp);
          const w = wristRest.lerp(wristSip, e);
          const th = UP.clone().lerp(thumb, e).normalize();
          const fg = p.fwd.clone().addScaledVector(p.right, -0.6).normalize().lerp(fing, e).normalize();
          h.reach(0, w, poleR, th, fg);
        } else h.sipAt(0, rim, thumb, fing, poleR);
      } else {
        h.reach(0, restR, poleR, UP, p.fwd.clone().addScaledVector(p.right, -0.6).normalize());
      }

      // left hand: on the thigh, gesturing while talking, waving, petting Luna
      const poleL = p.right.clone().multiplyScalar(-0.7).addScaledVector(UP, -0.6).addScaledVector(p.fwd, -0.3);
      p.gesture = damp(p.gesture, talking ? 1 : 0, 3, dt);
      p.wave = damp(p.wave, this.greetT > 0.6 && p.seat.waves && !saying ? 1 : 0, 4, dt);
      p.beckon = damp(p.beckon ?? 0, saying && this.line.t < this.line.dur - 0.4 ? 1 : 0, 4, dt);
      const restL = kneeL.clone().addScaledVector(UP, 0.07 * h.root.scale.x).addScaledVector(p.fwd, -0.13);
      let tL = restL;
      let thumbL = p.fwd.clone().negate();
      let fingL = p.fwd.clone().addScaledVector(p.right, 0.25).normalize();
      if (this.dog && p.seat.key === 'owner') {
        const petting = Math.sin(this.time * 0.13) > 0.1 && !talking;
        p.pet = damp(p.pet, petting ? 1 : 0, 2, dt);
        if (p.pet > 0.01) {
          const stroke = Math.sin(this.time * 2.2) * 0.07;
          const back = this.dog.backWorld.clone().addScaledVector(this.dog.forward, stroke).addScaledVector(UP, 0.06);
          tL = tL.clone().lerp(back, p.pet);
          thumbL = thumbL.lerp(this.dog.forward.clone(), p.pet).normalize();
          fingL = fingL.lerp(new THREE.Vector3(0, -1, 0).addScaledVector(this.dog.forward, 0.6), p.pet).normalize();
        }
      }
      if (p.gesture > 0.01) {
        const chest = h.spine.localToWorld(_t.set(0, 0.3, 0.1));
        const g = chest.addScaledVector(p.fwd, 0.22).addScaledVector(p.right, -0.12 + Math.sin(this.time * 2.1 + i) * 0.06).addScaledVector(UP, -0.02 + Math.sin(this.time * 3.7 + i * 2) * 0.05);
        tL = tL.clone().lerp(g, p.gesture);
        thumbL = thumbL.lerp(UP.clone().addScaledVector(p.right, 0.3), p.gesture).normalize();
        fingL = fingL.lerp(p.fwd.clone().addScaledVector(UP, 0.4), p.gesture).normalize();
      }
      if (p.wave > 0.01) {
        const sh = h.arms[1].shoulder.getWorldPosition(new THREE.Vector3());
        const w = sh.addScaledVector(UP, 0.32).addScaledVector(p.fwd, 0.12).addScaledVector(p.right, -0.12 + Math.sin(this.time * 9) * 0.05);
        tL = tL.clone().lerp(w, p.wave);
        thumbL = thumbL.lerp(p.right.clone().negate(), p.wave).normalize();
        fingL = fingL.lerp(UP.clone(), p.wave).normalize();
      }
      if (p.beckon > 0.01) {
        // "come, sit with us": palm up toward the player, fingers curling in
        const sh = h.arms[1].shoulder.getWorldPosition(new THREE.Vector3());
        const d = _w.subVectors(cam, sh).setY(0).normalize();
        const curl = Math.max(0, Math.sin(this.time * 7));
        const b = sh.addScaledVector(d, 0.38 - curl * 0.06).addScaledVector(UP, -0.12 + curl * 0.03);
        tL = tL.clone().lerp(b, p.beckon);
        thumbL = thumbL.lerp(new THREE.Vector3(d.z, 0, -d.x), p.beckon).normalize();
        fingL = fingL.lerp(d.clone().addScaledVector(UP, 0.2 + curl * 0.9).normalize(), p.beckon).normalize();
      }
      h.reach(1, tL, poleL, thumbL, fingL);
      h.updateFace(dt);
    }
  }
}
