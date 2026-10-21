import * as THREE from 'three';
import { Human } from './Human.js';
import { damp, clamp } from '../../utils/noise.js';
import { EV } from '../../config/events.ts';

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
  constructor(seats, shared, rand, events) {
    this.events = events;
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
    this.focus = null; // key of the person (or 'luna') being introduced
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

  // Strumming pattern (eighth notes, "D-DU-UDU") over a slow I-vi-IV-V
  // style progression; plays for a while, rests, plays again. Calls
  // onStrum(worldPos, chord, down, velocity) on every stroke for the sound.
  _guitar(p, i, dt, quiet) {
    const h = p.h, gt = h.guitar;
    if (p.gtTimer === undefined) { p.gtTimer = 6 + this.rand() * 10; p.gtPlaying = false; p.gtStep = 0; p.gtClock = 0; p.strumY = 0; }
    p.gtTimer -= dt;
    if (p.gtTimer <= 0) {
      p.gtPlaying = !p.gtPlaying;
      p.gtTimer = p.gtPlaying ? 22 + this.rand() * 25 : 14 + this.rand() * 20;
      p.gtStep = 0; p.gtClock = 0;
    }
    const playing = p.gtPlaying && !quiet;
    const PATTERN = [1, 0, 1, -1, 0, -1, 1, -1]; // 1 down, -1 up, 0 rest
    if (playing) {
      p.gtClock += dt;
      const STEP = 0.34;
      while (p.gtClock >= STEP) {
        p.gtClock -= STEP;
        const s = PATTERN[p.gtStep % 8];
        const chord = Math.floor(p.gtStep / 8) % 4;
        if (s) {
          p.strumY = s > 0 ? 1 : -1;
          this.events?.emit(EV.GUITAR_STRUM, { position: gt.strum.getWorldPosition(new THREE.Vector3()), chord, down: s > 0, velocity: s > 0 ? 0.8 + this.rand() * 0.2 : 0.45 + this.rand() * 0.15 });
        }
        p.gtStep++;
      }
    }
    // the strumming hand swings across the strings and settles in between
    p.strumHand = damp(p.strumHand ?? 0, playing ? p.strumY : 0, playing ? 22 : 4, dt);
    p.strumY *= Math.exp(-dt * 3);
    h.root.updateMatrixWorld(true);
    const gq = gt.group.getWorldQuaternion(new THREE.Quaternion());
    const gx = new THREE.Vector3(1, 0, 0).applyQuaternion(gq); // toward the headstock
    const gy = new THREE.Vector3(0, 1, 0).applyQuaternion(gq); // across the strings
    const gz = new THREE.Vector3(0, 0, 1).applyQuaternion(gq); // out of the top
    // right hand over the sound hole: the forearm rests on the top edge of
    // the lower bout (elbow up and out), the palm just above the strings
    const strum = gt.strum.getWorldPosition(new THREE.Vector3())
      .addScaledVector(gy, 0.12 - p.strumHand * 0.055).addScaledVector(gx, -0.05).addScaledVector(gz, 0.04);
    const poleR = p.right.clone().multiplyScalar(0.7).addScaledVector(UP, 0.35).addScaledVector(gz, 0.5).addScaledVector(gx, -0.4);
    h.reach(0, strum, poleR, gx.clone(), gy.clone().negate().addScaledVector(gz, 0.1).normalize());
    // left hand around the neck, fingers over the fretboard (moving with the chords)
    const chordShift = playing ? [0, 0.02, -0.015, 0.03][Math.floor(p.gtStep / 8) % 4] : 0;
    p.fretX = damp(p.fretX ?? 0, chordShift, 6, dt);
    const fret = gt.fret.getWorldPosition(new THREE.Vector3())
      .addScaledVector(gx, p.fretX).addScaledVector(gy, -0.075).addScaledVector(gz, -0.035);
    const poleL = p.right.clone().multiplyScalar(-0.6).addScaledVector(UP, -0.8).addScaledVector(p.fwd, -0.1);
    h.reach(1, fret, poleL, gy.clone().addScaledVector(gx, 0.4).normalize(), gy.clone().multiplyScalar(0.6).addScaledVector(gz, 0.8).normalize());
    void i;
  }

  // one short "hello" wave: raise the hand, wave a few times, lower it
  _waveAt(p, delay = 0) { p.waveFrom = this.time + delay; p.waveUntil = p.waveFrom + 2.3; }

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
      if (playerNear && !this.greeted) {
        this.greeted = true;
        this.greetT = 3.2;
        for (const p of this.people) if (p.seat.waves) this._waveAt(p, 0.3);
      }
      if (d > 14) this.greeted = false;
    }
    this.greetT = Math.max(0, this.greetT - dt);
    // whoever starts being introduced waves once, after the cut has faded in
    if (this.focus !== this._prevFocus) {
      this._prevFocus = this.focus;
      const fp = this.focus && this.focus !== 'owner' && this.focus !== 'luna' ? this.byName(this.focus) : null;
      if (fp && !fp.h.guitar) this._waveAt(fp, 0.7); // the guitarist keeps his hands on the guitar
    }

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
      const focusP = this.focus && this.focus !== 'luna' ? this.byName(this.focus) : null;
      const focusLuna = this.focus === 'luna' && this.dog;
      const focused = focusP === p;
      const swap = Math.floor(this.time / 1.6) % 2 === 1;
      if (focused) target = cam;
      else if (saying && focusP) target = swap ? focusP.headPos : cam;
      else if (saying && focusLuna) target = swap ? this.dog.headWorld : cam;
      else if (focusLuna) target = this.dog.headWorld;
      else if (focusP) target = focusP.headPos;
      else if (saying || this.greetT > 0 || (this.line && this.line.t < 2.5)) target = cam;
      else if (talking) {
        // speaker looks around the circle
        const k = Math.floor(this.time / 1.7 + i) % this.people.length;
        target = k === i ? this.people[(k + 1) % this.people.length].headPos : this.people[k].headPos;
        if (playerNear && Math.floor(this.time / 2.3 + i) % 4 === 0) target = cam;
      } else if (p.sipPhase >= 0) target = _t.copy(p.headPos).addScaledVector(p.fwd, 1).setY(p.headPos.y - 0.25);
      else if (this.dog && p.pet > 0.5) target = this.dog.headWorld;
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
      const nod = talking ? Math.sin(this.time * 3.3 + i) * 0.05 : focused ? Math.max(0, Math.sin(this.time * 2.6)) * 0.13 : 0;
      const laughBob = h.laugh * (Math.sin(this.time * 17) * 0.04 - 0.22);
      h.neck.rotation.set(-p.pitch * 0.35 + laughBob * 0.4, p.yaw * 0.35, 0, 'YXZ');
      h.headPivot.rotation.set(-p.pitch * 0.65 + nod + laughBob, p.yaw * 0.65, Math.sin(this.time * 0.4 + i) * 0.03, 'YXZ');
      // breathing + laughter shaking the shoulders
      h.spine.rotation.x = p.baseLean + Math.sin(this.time * 1.6 + i) * 0.008 + h.laugh * Math.sin(this.time * 15) * 0.025 - h.laugh * 0.05;
      h.spine.rotation.y = p.yaw * 0.12;

      // ---- Amin and his guitar ----
      if (h.guitar) { this._guitar(p, i, dt, talking || laughing || !!this.line); h.updateFace(dt); continue; }

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
      p.gesture = damp(p.gesture, talking && this.focus !== 'owner' && this.focus !== 'luna' ? 1 : 0, 3, dt);
      // being introduced: raise a hand to the player (the owner puts his on his chest)
      const waving = !saying && this.time > (p.waveFrom ?? 0) && this.time < (p.waveUntil ?? 0);
      p.wave = damp(p.wave, waving ? 1 : 0, 5, dt);
      h.setHandOpen(1, p.wave > 0.35);
      p.beckon = damp(p.beckon ?? 0, saying && !this.focus && this.line.t < this.line.dur - 0.4 ? 1 : 0, 4, dt);
      p.chest = damp(p.chest ?? 0, focused && p.seat.key === 'owner' ? 1 : 0, 4, dt);
      const restL = kneeL.clone().addScaledVector(UP, 0.07 * h.root.scale.x).addScaledVector(p.fwd, -0.13);
      let tL = restL;
      let thumbL = p.fwd.clone().negate();
      let fingL = p.fwd.clone().addScaledVector(p.right, 0.25).normalize();
      // whoever Luna is lying beside strokes her now and then
      const besideLuna = this.dog && this.dog.restingBy === p.seat.key && this.dog.isLying;
      const petting = besideLuna && ((Math.sin(this.time * 0.13 + i * 1.3) > 0.1 && !talking) || focusLuna);
      p.pet = damp(p.pet, petting ? 1 : 0, 2, dt);
      if (this.dog) {
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
        // hand up beside the head, palm toward the player, waving from the
        // wrist with a little sway of the forearm
        const sh = h.arms[1].shoulder.getWorldPosition(new THREE.Vector3());
        const toCam = _w.subVectors(cam, sh).setY(0).normalize();
        const osc = Math.sin((this.time - (p.waveFrom ?? 0)) * 8.5);
        const w = sh.addScaledVector(UP, 0.26).addScaledVector(p.right, -0.16 + osc * 0.025).addScaledVector(toCam, 0.14);
        tL = tL.clone().lerp(w, p.wave);
        const fingers = UP.clone().applyAxisAngle(toCam, osc * 0.32).addScaledVector(p.right, -0.15).normalize();
        const thumb = new THREE.Vector3().crossVectors(toCam, fingers).normalize(); // palm faces the player
        thumbL = thumbL.lerp(thumb, p.wave).normalize();
        fingL = fingL.lerp(fingers, p.wave).normalize();
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
      if (p.chest > 0.01) {
        const c = h.spine.localToWorld(new THREE.Vector3(0.02, 0.4, 0.17));
        tL = tL.clone().lerp(c, p.chest);
        thumbL = thumbL.lerp(UP.clone(), p.chest).normalize();
        fingL = fingL.lerp(p.right.clone().addScaledVector(p.fwd, -0.3).normalize(), p.chest).normalize();
      }
      h.reach(1, tL, poleL, thumbL, fingL);
      h.updateFace(dt);
    }
  }
}
