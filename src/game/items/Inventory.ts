import * as THREE from 'three';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import type { Hands } from '../player/Hands.ts';
import { makeFlashlight } from './Flashlight.ts';
import { makeAmulet } from './Amulet.ts';

// The player's bag: what they have picked up or been given. The bag on the
// screen lists it (INVENTORY); choosing something there puts it in the
// player's right hand (`equip`), choosing it again puts it away. A
// flashlight is in it from the start: held, it shines a beam where the
// player looks (its light is always in the scene, dark while put away, so
// taking it out never stalls the game). The shopping for the party goes in
// it too, the pickles last; their models in the hand are copies of the
// ones in the shop (`define`).

export type ItemId = 'flashlight' | 'amulet' | 'chips' | 'puffs' | 'yogurt' | 'drink' | 'pickles';

/** what each thing is called on screen, its icon, and its model in the hand (null: given by `define`) */
export const ITEMS: Record<ItemId, { label: string; icon: string; make: (() => THREE.Object3D) | null }> = {
  flashlight: { label: 'چراغ‌قوه', icon: '🔦', make: makeFlashlight },
  amulet: {
    label: 'صلیب سنگی', icon: '☩',
    make: () => {
      // in the hand: smaller, held by its foot, its face toward you
      const a = makeAmulet();
      a.scale.setScalar(0.75);
      a.position.y = -0.03;
      const g = new THREE.Group();
      g.add(a);
      g.rotation.y = 0;
      return g;
    },
  },
  chips: { label: 'چیپس', icon: '🍟', make: null },
  puffs: { label: 'پفک', icon: '🧀', make: null },
  yogurt: { label: 'ماست', icon: '🥛', make: null },
  drink: { label: 'نوشیدنی', icon: '🥤', make: null },
  pickles: { label: 'خیارشور', icon: '🥒', make: null },
};

const BEAM = { intensity: 26, distance: 34, angle: 0.4, penumbra: 0.55, decay: 1.25 };

export class Inventory {
  readonly items: ItemId[] = [];
  held: ItemId | null = null;
  /** the flashlight's beam (in the scene all the time; off unless the flashlight is out) */
  readonly beam: THREE.SpotLight;
  private readonly hands: Hands;
  private readonly events: EventBus<GameEvents>;
  private readonly models = new Map<ItemId, THREE.Object3D>();
  private readonly makers = new Map<ItemId, () => THREE.Object3D>();
  private readonly _v = new THREE.Vector3();
  private readonly _d = new THREE.Vector3();

  constructor({ hands, events, scene }: { hands: Hands; events: EventBus<GameEvents>; scene: THREE.Object3D }) {
    this.hands = hands;
    this.events = events;
    this.beam = new THREE.SpotLight(0xfff1d6, 0, BEAM.distance, BEAM.angle, BEAM.penumbra, BEAM.decay);
    this.beam.castShadow = false;
    scene.add(this.beam, this.beam.target);
  }

  has(id: ItemId): boolean { return this.items.includes(id); }

  /** how `id` is made for the hand (for things whose model lives elsewhere) */
  define(id: ItemId, make: () => THREE.Object3D): void { this.makers.set(id, make); }

  /** it goes in the bag */
  add(id: ItemId): void {
    if (this.has(id)) return;
    this.items.push(id);
    this._announce();
  }

  /** take `id` out into the right hand (null, or the one already held: put it away) */
  equip(id: ItemId | null): void {
    if (id && (!this.has(id) || id === this.held)) id = null;
    let model: THREE.Object3D | null = null;
    const make = id ? this.makers.get(id) ?? ITEMS[id].make : null;
    if (id && make) {
      model = this.models.get(id) ?? make();
      this.models.set(id, model);
    } else id = null;
    this.held = id;
    this.hands.hold(model, 'right');
    this._announce();
  }

  private _announce(): void {
    this.events.emit(EV.INVENTORY, { items: this.items.map((id) => ({ id, label: ITEMS[id].label, icon: ITEMS[id].icon })), held: this.held });
  }

  /** after the hands (the beam comes from the lens, toward where the player looks) */
  update(dt: number, camera: THREE.Camera, cinematic: boolean): void {
    const fl = this.held === 'flashlight' ? (this.models.get('flashlight') as ReturnType<typeof makeFlashlight> | undefined) : undefined;
    const on = !!fl && !cinematic && this.hands.rig.visible;
    const b = this.beam;
    b.intensity += ((on ? BEAM.intensity : 0) - b.intensity) * Math.min(1, dt * 12);
    if (fl) {
      fl.lens.getWorldPosition(this._v);
      b.position.copy(this._v);
      camera.getWorldDirection(this._d);
      b.target.position.copy(camera.position).addScaledVector(this._d, 12);
      b.target.updateMatrixWorld();
      (fl.userData.lensMat as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2.2 : 0;
    }
  }
}
