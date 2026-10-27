import * as THREE from 'three';
import type { GoodsParts } from './StoreGoods.ts';
import { F, ERRAND, COUNTER, SHOPKEEPER } from './storeLayout.ts';
import { place, type Geo } from './storeGeometry.ts';

// The shop's part in the errand (game/quest): the four things to buy, each
// its own mesh so it can blink and be picked off the shelf; the pickle jar
// on the porch, whose lid comes off; the banknote laid on the counter; an
// invisible stand-in for the shopkeeper (easy to click); and a little
// glowing marker that floats over whatever to go to next. All in the shop
// frame, inside the shop's group.

export type ErrandItem = 'chips' | 'puffs' | 'yogurt' | 'drink';
export const ERRAND_ITEMS: ErrandItem[] = ['chips', 'puffs', 'yogurt', 'drink'];

const WARM = new THREE.Color(0xffc34d);

export class ErrandProps {
  readonly group = new THREE.Group();
  readonly items: Record<ErrandItem, THREE.Mesh>;
  /** the pickle jar: body + lid (the lid is picked) */
  readonly jar = new THREE.Group();
  readonly lid: THREE.Mesh;
  readonly cash: THREE.Mesh;
  /** click target for paying (around the shopkeeper's upper body) */
  readonly keeperProxy: THREE.Mesh;
  /** a glowing marker over the next thing to do */
  readonly beacon: THREE.Mesh;
  private readonly blinking = new Set<THREE.Mesh>();
  private beaconAt: THREE.Vector3 | null = null;
  private lidFly: { t: number; from: THREE.Vector3; to: THREE.Vector3 } | null = null;
  private time = 0;

  constructor(goods: GoodsParts) {
    const e = goods.errand;
    const mk = (geo: Geo, fridge: boolean, spot: { x: number; y: number; z: number; yaw: number }) => {
      // each item has its own material, so only it lights up
      const mat = (fridge ? e.fridgeGoodsMat : e.goodsMat).clone();
      mat.emissive = new THREE.Color(fridge ? 0xcfe2ff : 0x000000);
      mat.emissiveMap = fridge ? mat.map : null;
      mat.userData.base = { color: mat.emissive.clone(), intensity: mat.emissiveIntensity };
      const m = new THREE.Mesh(place(geo, spot.x, F + spot.y, spot.z, spot.yaw), mat);
      this.group.add(m);
      return m;
    };
    this.items = {
      chips: mk(e.chips, false, ERRAND.chips),
      puffs: mk(e.puffs, false, ERRAND.puffs),
      yogurt: mk(e.yogurt, true, ERRAND.yogurt),
      drink: mk(e.drink, true, ERRAND.drink),
    };

    // the pickle jar ("dabbeh"): a big translucent plastic jar of brine and
    // gherkins with a blue screw lid, standing on the porch
    {
      const j = this.jar;
      j.position.set(ERRAND.jar.x, F, ERRAND.jar.z);
      const R = 0.17, HJ = 0.46;
      const body = new THREE.Mesh(
        new THREE.LatheGeometry([[0, 0], [R * 0.92, 0], [R, 0.03], [R, HJ * 0.8], [R * 0.82, HJ * 0.92], [R * 0.62, HJ * 0.95], [R * 0.62, HJ]].map(([r, y]) => new THREE.Vector2(r, y)), 24),
        new THREE.MeshStandardMaterial({ color: 0xe9efe0, roughness: 0.25, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
      );
      body.renderOrder = 2;
      j.add(body);
      const brine = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.95, R * 0.92, HJ * 0.72, 20), new THREE.MeshStandardMaterial({ color: 0xb8b45a, roughness: 0.2, transparent: true, opacity: 0.55, depthWrite: false }));
      brine.position.y = HJ * 0.37;
      j.add(brine);
      const pk: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 22; k++) {
        const g = new THREE.CapsuleGeometry(0.018, 0.07, 3, 6);
        g.rotateZ((Math.random() - 0.5) * 1.2);
        g.rotateY(Math.random() * Math.PI);
        const a = Math.random() * Math.PI * 2, r = Math.random() * R * 0.75;
        g.translate(Math.cos(a) * r, 0.05 + Math.random() * HJ * 0.62, Math.sin(a) * r);
        pk.push(g);
      }
      for (const g of pk) j.add(new THREE.Mesh(g, PICKLE));
      // a paper label: «خیارشور»
      const label = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.12, 24, 1, true, -0.9, 1.8), new THREE.MeshStandardMaterial({ map: labelTexture(), roughness: 0.8 }));
      label.position.y = HJ * 0.45;
      j.add(label);
      this.lid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.68, R * 0.68, 0.05, 20), new THREE.MeshStandardMaterial({ color: 0x2f6fc4, roughness: 0.45 }));
      this.lid.position.y = HJ + 0.025;
      (this.lid.material as THREE.MeshStandardMaterial).userData.base = { color: new THREE.Color(0x000000), intensity: 1 };
      j.add(this.lid);
      j.traverse((o) => { o.castShadow = (o as THREE.Mesh).isMesh && o !== body; });
      this.group.add(j);
    }

    // the money, laid on the counter when paying
    {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = '#c9d8b4'; g.fillRect(0, 0, 256, 128);
      g.strokeStyle = '#5c7a4a'; g.lineWidth = 8; g.strokeRect(8, 8, 240, 112);
      g.fillStyle = '#4d6a3d'; g.font = '700 54px Vazirmatn, Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('۱۰۰٬۰۰۰', 128, 66);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      this.cash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
      this.cash.rotation.set(-Math.PI / 2, 0, 0.3);
      this.cash.position.set(ERRAND.cash.x, F + COUNTER.h + 0.004, ERRAND.cash.z);
      this.cash.visible = false;
      this.group.add(this.cash);
    }

    // the shopkeeper, as a simple shape to click (not drawn)
    this.keeperProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.1, 10), new THREE.MeshBasicMaterial({ visible: false }));
    this.keeperProxy.position.set(SHOPKEEPER.x - 0.1, F + 1.35, SHOPKEEPER.z);
    this.group.add(this.keeperProxy);

    // the marker: a glowing downward point, bobbing
    this.beacon = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 4), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, depthTest: false }));
    this.beacon.rotation.x = Math.PI;
    this.beacon.renderOrder = 5;
    this.beacon.visible = false;
    this.group.add(this.beacon);
  }

  /** where the jar's mouth is (world) - the ghost comes out there */
  jarMouthWorld(target = new THREE.Vector3()): THREE.Vector3 { return this.jar.localToWorld(target.set(0, 0.46, 0)); }

  setBlink(m: THREE.Mesh, on: boolean): void {
    if (on) this.blinking.add(m);
    else { this.blinking.delete(m); this._glow(m, 0); }
  }

  /** the marker over the shopkeeper / the jar, or nowhere */
  setBeacon(where: 'keeper' | 'jar' | null): void {
    this.beaconAt = where === 'keeper' ? new THREE.Vector3(SHOPKEEPER.x - 0.05, F + 2.1, SHOPKEEPER.z)
      : where === 'jar' ? new THREE.Vector3(ERRAND.jar.x, F + 0.85, ERRAND.jar.z) : null;
    this.beacon.visible = !!this.beaconAt;
  }

  /** the lid pops off and lands on the porch */
  popLid(): void {
    const from = this.lid.position.clone();
    this.lidFly = { t: 0, from, to: new THREE.Vector3(-0.55, 0.03, 0.42) };
    this.setBlink(this.lid, false);
  }

  private _glow(m: THREE.Mesh, k: number): void {
    const mat = m.material as THREE.MeshStandardMaterial;
    const base = mat.userData.base as { color: THREE.Color; intensity: number };
    mat.emissive.copy(base.color).lerp(WARM, k);
    mat.emissiveIntensity = base.intensity + k * 1.3;
  }

  update(dt: number): void {
    this.time += dt;
    const k = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 * 1.1); // a soft blink, about once a second
    for (const m of this.blinking) this._glow(m, k);
    if (this.beaconAt) {
      this.beacon.position.copy(this.beaconAt).setY(this.beaconAt.y + Math.sin(this.time * 3) * 0.05);
      this.beacon.rotation.y = this.time * 2;
      (this.beacon.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * k;
    }
    const f = this.lidFly;
    if (f) {
      f.t = Math.min(1, f.t + dt / 0.6);
      // in the jar's frame: up, over and down onto the porch boards, spinning
      this.lid.position.lerpVectors(f.from, f.to, f.t);
      this.lid.position.y += Math.sin(f.t * Math.PI) * 0.7;
      this.lid.rotation.set(f.t * 9, 0, f.t * 4);
      if (f.t >= 1) { this.lid.rotation.set(Math.PI / 2 * 0.95, 0, 0.4); this.lidFly = null; }
    }
  }

  /** everything back as it was (the errand starts over) */
  reset(): void {
    for (const m of Object.values(this.items)) { m.visible = true; this.setBlink(m, false); }
    this.lid.position.set(0, 0.46 + 0.025, 0);
    this.lid.rotation.set(0, 0, 0);
    this.lidFly = null;
    this.cash.visible = false;
    this.setBeacon(null);
  }
}

const PICKLE = new THREE.MeshStandardMaterial({ color: 0x5b7a2a, roughness: 0.6 });

function labelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2e6c4'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#3f6b22'; g.fillRect(0, 0, 256, 8); g.fillRect(0, 56, 256, 8);
  g.fillStyle = '#2f4f19'; g.font = '800 34px Vazirmatn, Tahoma, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('خیارشور', 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

