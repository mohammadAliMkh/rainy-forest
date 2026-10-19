import { WORLD, SPAWN, PUDDLES } from '../core/config.js';
import { damp, clamp } from '../utils/noise.js';

// First-person controller: right-drag mouse look (cursor stays visible), WASD (physical keys, so
// it works with a Persian keyboard layout too), Shift to run, smooth
// acceleration, terrain following, gentle head-bob and footstep events.

export class PlayerController {
  constructor(camera, dom, terrain, collision, { debug = false } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.terrain = terrain;
    this.collision = collision;
    this.debug = debug;

    this.x = SPAWN.x; this.z = SPAWN.z;
    this.groundY = terrain.heightAt(this.x, this.z);
    this.y = this.groundY + WORLD.eyeHeight;
    this.yaw = SPAWN.yaw; this.pitch = -0.04;
    this.vx = 0; this.vz = 0;
    this.speed = 0;
    this.running = false;
    this.sensitivity = 1;
    this.walkSpeed = 1.9;
    this.runSpeed = 4.6;
    this.keys = new Set();
    this.bobPhase = 0;
    this.stepIndex = 0;
    this.onStep = null;
    this.idleT = 0;

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && this.active) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Mouse look only while the RIGHT mouse button is held and dragged; the
    // cursor is never locked or hidden.
    this.dragging = false;
    this.freeMode = false; // set once the player has entered the forest
    const stopDrag = () => { this.dragging = false; this.dom.style.cursor = ''; };
    window.addEventListener('blur', () => { this.keys.clear(); stopDrag(); });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => {
      if (e.button !== 2 || !this.active) return;
      this.dragging = true;
      dom.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 2) stopDrag(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      if (!(e.buttons & 2)) { stopDrag(); return; } // button released outside the window
      const mx = clamp(e.movementX, -250, 250), my = clamp(e.movementY, -250, 250);
      const k = 0.0042 * this.sensitivity;
      this.yaw -= mx * k;
      this.pitch = clamp(this.pitch - my * k, -1.45, 1.45);
    });
  }

  get active() { return this.debug || this.freeMode; }

  surfaceAt(x, z) {
    for (const p of PUDDLES) if (Math.hypot((x - p[0]) / p[2], (z - p[1]) / p[3]) < 0.9) return 'water';
    return this.terrain.pathDistance(x, z) < 1.3 ? 'mud' : 'leaves';
  }

  update(dt, time) {
    let fx = 0, fz = 0;
    if (this.active) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
      if (k.has('KeyD')) fx += 1;
      if (k.has('KeyA')) fx -= 1;
      // arrow keys / Q-E turn the view (alternative to the mouse)
      const turn = (k.has('ArrowLeft') || k.has('KeyQ') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyE') ? 1 : 0);
      this.yaw += turn * 1.8 * dt;
      this.running = k.has('ShiftLeft') || k.has('ShiftRight');
    } else this.running = false;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sp = this.running ? this.runSpeed : this.walkSpeed;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const tvx = (-sy * fz + cy * fx) * sp;
    const tvz = (-cy * fz - sy * fx) * sp;
    const lambda = len > 0 ? 8 : 6;
    this.vx = damp(this.vx, tvx, lambda, dt);
    this.vz = damp(this.vz, tvz, lambda, dt);

    const p = { x: this.x + this.vx * dt, z: this.z + this.vz * dt };
    this.collision.resolve(p, 0.38);
    // stay inside the forest
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD.playableRadius) { p.x *= WORLD.playableRadius / r; p.z *= WORLD.playableRadius / r; }
    const moved = Math.hypot(p.x - this.x, p.z - this.z);
    this.speed = dt > 0 ? moved / dt : 0;
    this.x = p.x; this.z = p.z;

    // head bob & footsteps
    const stepLen = this.running ? 1.35 : 0.85;
    this.bobPhase += (moved / stepLen) * Math.PI;
    const idx = Math.floor(this.bobPhase / Math.PI);
    if (idx !== this.stepIndex) {
      this.stepIndex = idx;
      if (this.speed > 0.4 && this.onStep) {
        this.onStep({ running: this.running, surface: this.surfaceAt(this.x, this.z), side: idx % 2 ? 1 : -1, speed: this.speed });
      }
    }
    const moveK = clamp(this.speed / this.walkSpeed, 0, 1.6);
    const bobAmp = (this.running ? 0.055 : 0.032) * Math.min(1, moveK);
    const bobY = (Math.cos(this.bobPhase * 2) - 1) * 0.5 * bobAmp;
    const sway = Math.sin(this.bobPhase) * 0.012 * Math.min(1, moveK);

    this.groundY = this.terrain.heightAt(this.x, this.z);
    this.y = damp(this.y, this.groundY + 1.68, 12, dt);

    // tiny breathing motion when standing still
    this.idleT += dt;
    const breath = Math.sin(this.idleT * 1.1) * 0.006 * (1 - Math.min(1, moveK));

    const cam = this.camera;
    cam.position.set(this.x + cy * sway, this.y + bobY + breath, this.z - sy * sway);
    cam.rotation.set(this.pitch + Math.sin(this.idleT * 0.7) * 0.002, this.yaw, Math.sin(this.bobPhase) * 0.003 * moveK, 'YXZ');
    void time;
  }

  teleport(x, z, yaw) {
    this.x = x; this.z = z;
    if (yaw !== undefined) this.yaw = yaw;
    this.y = this.terrain.heightAt(x, z) + 1.68;
  }
}
