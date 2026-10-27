import * as THREE from 'three';

// Clicking (or tapping) things in the world: the errand's goods on the
// shelves, the shopkeeper, the lid of the pickle jar... Parts register a
// target; a left click on the view (or a short tap without dragging on a
// touch screen) casts a ray from the camera and the nearest enabled target
// within reach is picked. The cursor turns into a hand over something that
// can be picked. Right-drag / edge turning and touch look are unaffected.

export interface PickTarget {
  /** what is hit by the ray (with its children) */
  object: THREE.Object3D;
  /** how far from the eye it can be picked (metres) */
  reach?: number;
  /** whether it can be picked right now */
  enabled: () => boolean;
  onPick: () => void;
}

const TAP_MS = 350, TAP_PX = 12;

export class Picker {
  /** too far: something to say (set by app/) */
  onTooFar: (() => void) | null = null;
  private readonly targets = new Set<PickTarget>();
  private readonly camera: THREE.Camera;
  private readonly dom: HTMLElement;
  private readonly active: () => boolean;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private hoverAt: { x: number; y: number } | null = null;
  private hovering = false;

  constructor(camera: THREE.Camera, dom: HTMLElement, { active }: { active: () => boolean }) {
    this.camera = camera;
    this.dom = dom;
    this.active = active;
    // mouse: a plain left click (no drag)
    let down: { x: number; y: number; t: number } | null = null;
    dom.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    dom.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || !down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < TAP_PX) this.pickAt(e.clientX, e.clientY);
      down = null;
    });
    dom.addEventListener('mousemove', (e) => { this.hoverAt = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('mouseleave', () => { this.hoverAt = null; });
    // touch: a short tap that didn't turn into a look-drag
    const taps = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
    dom.addEventListener('touchstart', (e) => { for (const t of Array.from(e.changedTouches)) taps.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now(), moved: false }); }, { passive: true });
    dom.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) { const s = taps.get(t.identifier); if (s && Math.hypot(t.clientX - s.x, t.clientY - s.y) > TAP_PX) s.moved = true; }
    }, { passive: true });
    dom.addEventListener('touchend', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        const s = taps.get(t.identifier);
        taps.delete(t.identifier);
        if (s && !s.moved && performance.now() - s.t < TAP_MS) this.pickAt(t.clientX, t.clientY);
      }
    }, { passive: true });
  }

  /** register something that can be picked; returns a function that removes it */
  add(target: PickTarget): () => void {
    this.targets.add(target);
    return () => this.targets.delete(target);
  }

  // the nearest enabled target under the screen point, with its distance
  private _hit(x: number, y: number): { target: PickTarget; distance: number } | null {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.camera.updateMatrixWorld();
    this.ray.setFromCamera(this.ndc, this.camera);
    let best: { target: PickTarget; distance: number } | null = null;
    for (const t of this.targets) {
      if (!t.enabled()) continue;
      const hit = this.ray.intersectObject(t.object, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { target: t, distance: hit.distance };
    }
    return best;
  }

  /** pick at a screen point (a click / tap) */
  pickAt(x: number, y: number): boolean {
    if (!this.active()) return false;
    const hit = this._hit(x, y);
    if (!hit) return false;
    if (hit.distance > (hit.target.reach ?? 3)) { this.onTooFar?.(); return false; }
    hit.target.onPick();
    return true;
  }

  /** system: the hand cursor over something that can be picked */
  update(): void {
    let over = false;
    if (this.hoverAt && this.active() && !this.dom.style.cursor.startsWith('grab')) {
      const hit = this._hit(this.hoverAt.x, this.hoverAt.y);
      over = !!hit && hit.distance <= (hit.target.reach ?? 3);
    }
    if (over !== this.hovering) {
      this.hovering = over;
      if (!this.dom.style.cursor.startsWith('grab')) this.dom.style.cursor = over ? 'pointer' : '';
    }
  }
}
