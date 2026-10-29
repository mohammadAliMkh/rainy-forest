import * as THREE from 'three';
import { STORE } from '../../config/config.js';
import { EV } from '../../config/events.ts';
import type { GameEvents } from '../../config/events.ts';
import type { EventBus } from '../../engine/events.ts';
import { clamp, damp } from '../../utils/noise.js';
import { createStoreTextures } from './storeTextures.ts';
import { buildBuilding, buildSignpost, roofY } from './StoreBuilding.ts';
import type { BuildingParts } from './StoreBuilding.ts';
import { buildGoods } from './StoreGoods.ts';
import type { GoodsParts } from './StoreGoods.ts';
import { Shopkeeper } from './Shopkeeper.ts';
import { ErrandProps } from './ErrandProps.ts';
import {
  F, H, RIDGE, W, X0, X1, Z0, Z1, T as WALL, IX0, IX1, IZ0, IZ1, PZ1, STEP_N, STEP_D, ROOF_OVER, ROOF_FRONT,
  DOOR, STEPS, COUNTER, COUNTER_END, ERRAND, FRIDGES, LIQUOR, SHELF_LEFT, SHELF_BACK, GONDOLA, CRATES, DRINK_CRATES, LAMP_MAIN,
} from './storeLayout.ts';

// The little supermarket in the forest, put together: the building, the
// shelves and fridges full of goods, the old shopkeeper, a signpost where
// its footpath leaves the trail. The rest of the game sees it as walls to
// bump into, a raised floor to walk on (porch, steps, floorboards), a roof
// that keeps the rain off, a door that opens with a bell, and a warm light.

type Shared = ConstructorParameters<typeof Shopkeeper>[0];
/** the forest's own textures the shop reuses (wood, stone, bark) */
type Tex = Record<'wood' | 'woodNormal' | 'stone' | 'stoneNormal' | 'bark' | 'barkNormal' | 'logEnd', THREE.Texture>;

interface TerrainLike {
  storePadHeight?: number;
  heightAt(x: number, z: number): number;
  addPlatform(p: { x: number; z: number; yaw?: number; hx: number; hz: number; y0: number; y1?: number; surface?: string }): unknown;
}
interface CollisionLike {
  addBox(x: number, z: number, hx: number, hz: number, rot?: number, tag?: string): unknown;
  addCircle(x: number, z: number, r: number, tag?: string): unknown;
  clearZones: { x: number; z: number; hx: number; hz: number }[];
}
interface StoreEnv { ambientLevel: number }

/** a rain shelter for Rain.setShelters: the roof over the room and the porch */
export interface StoreShelter { x: number; z: number; hx: number; hz: number; yaw: number; y: number; peak: number; ridge: boolean }

const _v = new THREE.Vector3();
const c = Math.cos(STORE.yaw), s = Math.sin(STORE.yaw);
/** shop frame (x, z) -> world (x, z) */
const toWorld = (lx: number, lz: number): [number, number] => [STORE.x + lx * c + lz * s, STORE.z - lx * s + lz * c];

export class Store {
  readonly group = new THREE.Group();
  readonly building: BuildingParts;
  readonly goods: GoodsParts;
  readonly shopkeeper: Shopkeeper;
  /** the errand's goods, the pickle jar, the money (game/quest) */
  readonly errand: ErrandProps;
  readonly signpost: THREE.Group;
  readonly light: THREE.PointLight;
  readonly shelter: StoreShelter;
  /** world positions for sounds */
  readonly roofCenter: THREE.Vector3;
  readonly fridgeCenter: THREE.Vector3;
  readonly doorWorld: THREE.Vector3;
  /** the player is inside (set every frame) */
  playerInside = false;
  /** how near the player is (metres from the shop's middle) */
  playerDistance = Infinity;
  private readonly events?: EventBus<GameEvents>;
  private doorOpen = 0;
  private doorWanted = false;
  private lastSecond = -1;
  private readonly viewer = new THREE.Vector3();

  /** paints the textures (they wait for the Persian font) and builds the shop */
  static async create(T0: Tex, terrain: TerrainLike, collision: CollisionLike, opts: { events?: EventBus<GameEvents>; shared: Shared }): Promise<Store> {
    const S = await createStoreTextures();
    return new Store(S, T0, terrain, collision, opts);
  }

  private constructor(S: Awaited<ReturnType<typeof createStoreTextures>>, T0: Tex, terrain: TerrainLike, collision: CollisionLike, { events, shared }: { events?: EventBus<GameEvents>; shared: Shared }) {
    this.events = events;
    const pad = terrain.storePadHeight ?? terrain.heightAt(STORE.x, STORE.z);
    const g = this.group;
    g.position.set(STORE.x, pad, STORE.z);
    g.rotation.y = STORE.yaw;

    const scenes = (T0 as unknown as { scenes?: Record<string, THREE.Group> | null }).scenes;
    this.building = buildBuilding(S, T0, scenes?.store);
    g.add(this.building.group);
    this.goods = buildGoods(S);
    g.add(this.goods.group);
    this.shopkeeper = new Shopkeeper(shared, scenes?.person_farajpour ?? null);
    g.add(this.shopkeeper.root);
    // everything inside is under the roof's shadow already: no shadow casting
    for (const o of [this.goods.group, this.shopkeeper.root]) o.traverse((m) => { m.castShadow = false; });
    this.errand = new ErrandProps(this.goods);
    g.add(this.errand.group);
    g.updateMatrixWorld(true);

    // one warm light under the main lamp; always there (switching lights
    // on and off makes every material recompile), it reaches the counter,
    // the shelves and a little way out of the door
    this.light = new THREE.PointLight(0xffc27a, 5.5, 7.5, 1.6);
    this.light.position.set(LAMP_MAIN.x, F + LAMP_MAIN.y - 0.22, LAMP_MAIN.z);
    g.add(this.light);

    // ---- what the rest of the game needs ----
    const at = (lx: number, y: number, lz: number) => g.localToWorld(new THREE.Vector3(lx, y, lz));
    this.roofCenter = at(0, F + H + RIDGE * 0.5, 0);
    this.fridgeCenter = at((FRIDGES[0].x0 + FRIDGES[1].x1) / 2, F + 1.0, FRIDGES[0].z1);
    this.doorWorld = at((DOOR.x0 + DOOR.x1) / 2, F + DOOR.h - 0.1, Z1);

    // rain: one gable roof over the room and the porch
    const rz0 = Z0 - ROOF_OVER, rz1 = ROOF_FRONT, hx = W / 2 + ROOF_OVER;
    const [sx, sz] = toWorld(0, (rz0 + rz1) / 2);
    this.shelter = { x: sx, z: sz, hx, hz: (rz1 - rz0) / 2, yaw: STORE.yaw, y: pad + roofY(hx), peak: pad + roofY(0), ridge: true };

    // walls, railings, furniture and the things lying outside
    const block = (x0: number, x1: number, z0: number, z1: number, tag = 'store') => {
      const [x, z] = toWorld((x0 + x1) / 2, (z0 + z1) / 2);
      collision.addBox(x, z, Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2, STORE.yaw, tag);
    };
    const round = (lx: number, lz: number, r: number) => { const [x, z] = toWorld(lx, lz); collision.addCircle(x, z, r, 'store'); };
    block(X0, X1, Z0, Z0 + WALL); // back
    block(X0, X0 + WALL, Z0, Z1); // left
    block(X1 - WALL, X1, Z0, Z1); // right
    block(X0, DOOR.x0, Z1 - WALL, Z1); // front, either side of the door
    block(DOOR.x1, X1, Z1 - WALL, Z1);
    // porch railings (open at the steps) and the handrails down the steps
    block(X0, STEPS.x0 - 0.02, PZ1 - 0.16, PZ1 - 0.02);
    block(STEPS.x1 + 0.02, X1, PZ1 - 0.16, PZ1 - 0.02);
    block(X0, X0 + 0.16, Z1, PZ1);
    block(X1 - 0.16, X1, Z1, PZ1);
    const stepsEnd = PZ1 + STEP_N * STEP_D;
    block(STEPS.x0 - 0.12, STEPS.x0 - 0.02, PZ1, stepsEnd - 0.05);
    block(STEPS.x1 + 0.02, STEPS.x1 + 0.12, PZ1, stepsEnd - 0.05);
    // outside: bench, basket, barrel, firewood, crates, trash bin
    block(-2.38, -0.82, Z1 + 0.14, Z1 + 0.66);
    round(-0.55, Z1 + 0.35, 0.22);
    round(X1 - 0.5, Z1 + 0.5, 0.3);
    block(X0 - 0.64, X0, -2.25, 2.0);
    block(X1, X1 + 0.82, 0.6, 1.85);
    block(STEPS.x1 + 0.49, STEPS.x1 + 1.01, PZ1 + 0.18, PZ1 + 0.72);
    round(ERRAND.jar.x, ERRAND.jar.z, 0.17 * ERRAND.jar.scale + 0.03); // the pickle jar
    // inside: the counter and the space behind it (the shopkeeper's), fridges, shelves, crates
    block(COUNTER.x0, IX1, LIQUOR.z1, COUNTER_END.z1);
    block(FRIDGES[0].x0, FRIDGES[1].x1, IZ0, FRIDGES[0].z1);
    block(LIQUOR.x0, LIQUOR.x1, LIQUOR.z0, LIQUOR.z1);
    block(SHELF_LEFT.x0, SHELF_LEFT.x1, SHELF_LEFT.z0, SHELF_LEFT.z1);
    block(SHELF_BACK.x0, SHELF_BACK.x1, SHELF_BACK.z0, SHELF_BACK.z1);
    block(GONDOLA.x0, GONDOLA.x1, GONDOLA.z0, GONDOLA.z1);
    block(CRATES.x0, CRATES.x1, CRATES.z0, CRATES.z1);
    block(DRINK_CRATES.x0, DRINK_CRATES.x1, DRINK_CRATES.z0, DRINK_CRATES.z1);
    // no trees or bushes on the shop, its porch or right outside
    const [cx, cz] = toWorld(0, (Z0 + stepsEnd) / 2);
    collision.clearZones.push({ x: cx, z: cz, hx: 6.2, hz: 6.2 });

    // walkable: floorboards and porch at one height, the steps as a ramp down
    const [fx, fz] = toWorld(0, (Z0 + PZ1) / 2);
    terrain.addPlatform({ x: fx, z: fz, yaw: STORE.yaw, hx: W / 2, hz: (PZ1 - Z0) / 2, y0: pad + F });
    const [tx, tz] = toWorld((STEPS.x0 + STEPS.x1) / 2, (PZ1 + stepsEnd) / 2);
    terrain.addPlatform({ x: tx, z: tz, yaw: STORE.yaw, hx: (STEPS.x1 - STEPS.x0) / 2, hz: (stepsEnd - PZ1) / 2, y0: pad + F, y1: pad + F / (STEP_N + 1) * 0.6 });

    // the signpost where the footpath leaves the trail, pointing along it
    const P = STORE.path;
    const toward = new THREE.Vector2(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]).normalize();
    this.signpost = buildSignpost(S, T0, STORE.sign.x, terrain.heightAt(STORE.sign.x, STORE.sign.z), STORE.sign.z, toward);
    collision.addCircle(STORE.sign.x, STORE.sign.z, 0.12, 'store');

    this._clock(true);
  }

  addTo(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.signpost);
  }

  /** system "store": the door, the shopkeeper, lights and the clock */
  update(dt: number, camera: THREE.Camera, env: StoreEnv): void {
    // the player in the shop's frame
    const local = this.group.worldToLocal(this.viewer.copy(camera.position));
    const inside = local.x > IX0 && local.x < IX1 && local.z > IZ0 && local.z < IZ1 && local.y < F + H;
    this.playerInside = inside;
    this.playerDistance = Math.hypot(local.x, local.z);
    const near = this.playerDistance < 40;
    this.errand.update(dt);
    this.goods.group.visible = near;
    this.shopkeeper.root.visible = near;
    if (!near) return;

    // the door opens toward you as you walk up, and closes behind you
    const dx = local.x - (DOOR.x0 + DOOR.x1) / 2, dz = local.z - Z1;
    const want = Math.hypot(dx, dz) < 1.9;
    if (want !== this.doorWanted) {
      this.doorWanted = want;
      if (want) this.events?.emit(EV.STORE_DOOR, { position: this.doorWorld, open: true });
    }
    this.doorOpen = damp(this.doorOpen, want ? 1 : 0, want ? 4 : 2.2, dt);
    this.building.door.rotation.y = this.doorOpen * 1.45;

    // warmer windows as the light outside fades
    const dark = clamp((0.62 - env.ambientLevel) / 0.35, 0, 1);
    this.building.windowGlass.emissiveIntensity = 0.12 + 0.55 * dark;
    this.building.lanternGlow.emissiveIntensity = 0.6 + 2.0 * dark + Math.sin(performance.now() * 0.004) * 0.06 * dark;

    this.shopkeeper.update(dt, local, inside || this.doorOpen > 0.5);
    this._clock(false);
  }

  /** the wall clock keeps real time */
  private _clock(force: boolean): void {
    const now = new Date();
    const sec = now.getSeconds();
    if (!force && sec === this.lastSecond) return;
    this.lastSecond = sec;
    const min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
    const k = this.goods.clock;
    k.second.rotation.z = -(sec / 60) * Math.PI * 2;
    k.minute.rotation.z = -(min / 60) * Math.PI * 2;
    k.hour.rotation.z = -(hr / 12) * Math.PI * 2;
  }

  /** the map: the shop with its porch as a turned rectangle */
  mapShape(): { x: number; z: number; w: number; d: number; yaw: number } {
    const [x, z] = toWorld(0, (Z0 + PZ1) / 2);
    return { x, z, w: W, d: PZ1 - Z0, yaw: STORE.yaw };
  }

  /** the shop's middle, for distances (world) */
  center(target = _v): THREE.Vector3 { return target.set(STORE.x, this.group.position.y, STORE.z); }
}
