import * as THREE from 'three';
import { FIRE } from '../config/config.js';
import { EV } from '../config/events.ts';
import type { GameEvents } from '../config/events.ts';
import { EventBus } from '../engine/events.ts';
import { Game } from '../engine/Game.ts';
import type { FrameBase } from '../engine/Game.ts';
import { installFogChunks } from '../engine/render/shaderPatches.js';
import { Renderer } from '../engine/render/Renderer.js';
import { detectGpu } from '../engine/render/gpuTier.js';
import { QualityManager } from '../engine/quality/QualityManager.ts';
import { createTextures, setMaxAnisotropy } from '../game/world/textures.js';
import { loadScannedTextures, upgradeScannedMaterials, type TextureSet } from '../game/world/scannedTextures.ts';
import { loadEnvModels } from '../game/world/envModels.ts';
import { Terrain } from '../game/world/Terrain.js';
import { Forest } from '../game/world/Forest.js';
import { Vegetation, DETAIL_LAYER } from '../game/world/Vegetation.js';
import { Cabin } from '../game/world/Cabin.js';
import { Puddles, PUDDLE_LAYER } from '../game/world/Puddles.js';
import { Culling } from '../game/world/Culling.ts';
import { Store } from '../game/store/Store.ts';
import { Picker } from '../game/player/Picker.ts';
import { PartyErrand } from '../game/quest/PartyErrand.ts';
import { Campfire } from '../game/camp/Fire.js';
import { Camp } from '../game/camp/Camp.js';
import { Rain } from '../game/weather/Rain.js';
import { Mist } from '../game/weather/Mist.js';
import { Sky } from '../game/weather/Sky.js';
import { DayCycle } from '../game/weather/DayCycle.js';
import { Wind } from '../game/weather/Wind.js';
import { Weather } from '../game/weather/Weather.ts';
import type { WeatherMode } from '../game/weather/Weather.ts';
import { Lighting } from '../game/lighting/Lighting.ts';
import { DeerHerd } from '../game/creatures/Deer.js';
import { Wildlife } from '../game/creatures/Wildlife.js';
import { CollisionWorld } from '../game/player/Collision.js';
import { PlayerController } from '../game/player/PlayerController.ts';
import { Hands } from '../game/player/Hands.ts';
import { Inventory, type ItemId } from '../game/items/Inventory.ts';
import { Wraith } from '../game/scenario/Wraith.ts';
import { Soundscape } from '../game/sound/Soundscape.ts';
import { Minimap } from '../ui/Minimap.js';
import { Session } from './Session.ts';
import { Hud } from './Hud.ts';
import { connectSettings } from './settings.ts';
import type { UI } from '../ui/UI.js';

/** what every system gets each frame */
export interface ForestFrame extends FrameBase {
  camera: THREE.PerspectiveCamera;
  /** light level, fog colour, bird activity... from the day cycle */
  env: DayCycle['env'];
}

declare global {
  // the game's parts, for tests and the browser console (only with ?debug)
  interface Window { forest?: Record<string, unknown> }
}

// Builds the whole game (with the loading bar), connects the parts and
// lists the systems that run every frame, in order. This is the one place
// that knows about everything; the parts themselves only know the event
// bus and the few services they are handed.

// setTimeout (not rAF) so loading also progresses in a background tab
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 16));

export async function createGame({ ui, debug = false }: { ui: UI; debug?: boolean }): Promise<Game<ForestFrame>> {
  installFogChunks();
  const events = new EventBus<GameEvents>();
  const renderer = new Renderer(document.getElementById('app'));
  setMaxAnisotropy(renderer.renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8a979e, 0.024);
  scene.background = new THREE.Color(0x8a979e);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 1500);
  camera.layers.enable(PUDDLE_LAYER);
  camera.layers.enable(DETAIL_LAYER);
  scene.add(camera);

  const step = async (p: number, _text: string) => { ui.setLoading(p); await nextFrame(); };

  // ---------- building the world ----------
  await step(0.05, 'نقاشی بافت‌ها: پوست درخت، خاک خیس، خزه و برگ‌ها…');
  // pick the starting quality from the GPU the browser runs on
  const gpu = detectGpu(renderer.renderer);
  const quality = new QualityManager({ renderer, events, gpuTier: gpu.tier, setting: ui.settings.quality });
  const T = createTextures({ detail: quality.preset.texDetail });
  await step(0.12, 'بارگذاری بافت‌های اسکن‌شده از طبیعت…');
  const aniso = Math.min(8, renderer.renderer.capabilities.getMaxAnisotropy());
  const [, models] = await Promise.all([loadScannedTextures(T, aniso), loadEnvModels(aniso)]);
  (T as TextureSet).models = models ? models.parts : null;
  (T as TextureSet).scenes = models ? models.scenes : null;

  await step(0.2, 'شکل دادن زمین و مسیر جنگلی…');
  const terrain = new Terrain(T);
  scene.add(terrain.mesh);
  const collision = new CollisionWorld();

  await step(0.32, 'کاشتن درختان بلند و قدیمی…');
  const cabin = new Cabin(T, terrain, collision); // cabin first: its colliders keep trees away
  const fire = new Campfire(T, terrain, collision);
  await step(0.38, 'دوستان دور آتش، لونا، پاترول و هورنت…');
  const camp = new Camp(T, terrain, collision, { events }); // before the forest: keeps trees off the car & bike
  await step(0.42, 'سوپرمارکت کوچک جنگل و صاحب پیرش…');
  const store = await Store.create(T, terrain, collision, { events, shared: camp.shared }); // before the forest too
  const forest = new Forest(T, terrain, collision);
  const TALL = ['post', 'tree', 'cabin', 'wall', 'store', 'car', 'chimney', 'woodpile'];
  camp.intro.obstacles = { // the welcome's flight keeps above them; the player is put down where nothing stands
    trees: forest.trees, heightAt: (x, z) => terrain.heightAt(x, z), blocked: (x, z, r) => collision.isBlocked(x, z, r), tall: (x, z, r) => collision.hasNear(x, z, r, TALL),
  };
  // after the introductions the player stands where their last shot ends
  camp.intro.onHandBack = (x, z, yaw, pitch) => { player.teleport(x, z, yaw); player.pitch = pitch; };
  scene.add(forest.group);

  await step(0.5, 'سرخس‌ها، بوته‌های شبنم‌زده، سنگ‌ها و قارچ‌ها…');
  const vegetation = new Vegetation(T, terrain, collision, forest);
  scene.add(vegetation.group);

  await step(0.62, 'ساختن کلبه چوبی و روشن کردن آتش…');
  cabin.addTo(scene);
  fire.addTo(scene);
  camp.addTo(scene);
  store.addTo(scene);

  await step(0.72, 'باران، مه و گودال‌های آب…');
  const puddles = new Puddles(terrain, T);
  scene.add(puddles.group);
  const rain = new Rain(terrain);
  rain.setShelters([camp.canopy.shelter, camp.carport.shelter, store.shelter]);
  rain.addTo(scene);
  const mist = new Mist(terrain);
  mist.addTo(scene);
  const sky = new Sky();
  scene.add(sky.mesh);
  const lighting = new Lighting({ scene, renderer, sky });

  await step(0.82, 'آهوها، پرندگان و خرگوش‌ها…');
  // shared context the creatures use; their sounds go out on the event bus
  const world = {
    terrain, collision, cabin, fire, camp, store, forest, player: null as PlayerController | null,
    // (the creatures are plain JS: deer send { x, z }, birds { species, pos })
    emit: (type: string, source: unknown) => events.emit(EV.CREATURE_SOUND, { type, source } as GameEvents[typeof EV.CREATURE_SOUND]),
  };
  const player = new PlayerController(camera, renderer.domElement, terrain, collision, { debug, events });
  world.player = player;
  const deer = new DeerHerd(T, world);
  scene.add(deer.group);
  const wildlife = new Wildlife(world, forest, (T as TextureSet).scenes);
  scene.add(wildlife.group);

  const wind = new Wind();
  const weather = new Weather({ events });
  weather.setMode(ui.settings.weather as WeatherMode);
  events.on(EV.LIGHTNING, ({ direction, strength }) => lighting.flash(direction, strength));
  const day = new DayCycle({ scene, sky, sun: lighting.sun, hemi: lighting.hemi, ambient: lighting.ambient, renderer: renderer.renderer });
  lighting.connect({ day, player, cinematic: () => camp.cinematic });
  const sound = new Soundscape(world, events);
  // the camp's introductions keep the ambience lowered across all of their lines
  camp.voices = {
    play: (key: string, pos: THREE.Vector3, o?: { duck?: boolean; gain?: number }) => sound.playVoice(key, pos, { duck: o?.duck ?? false, flat: true, gain: o?.gain ?? 1 }),
    ready: () => !!sound.engine.filesLoaded,
  };

  renderer.setupComposer(scene, camera);

  // ---------- graphics quality ----------
  events.on(EV.QUALITY_CHANGED, ({ name, preset }) => {
    lighting.setQuality(name, preset);
    terrain.setQuality(preset);
    forest.setQuality(preset);
    vegetation.setQuality(preset);
    puddles.setReflections(preset.reflections, preset.reflectionSize, preset.reflectEvery || 1);
    mist.setCount(preset.mistCount);
  });
  events.on(EV.PIXEL_RATIO, (pr) => {
    rain.setPixelRatio(pr);
    mist.setPixelRatio(pr);
    fire.sparks.material.uniforms.uPixel.value = pr;
  });
  quality.apply(quality.name);
  if (quality.auto) ui.setAutoQualityLabel(quality.name);

  // ---------- settings, screens and the flow of a visit ----------
  connectSettings({ ui, sound, day, player, quality, lighting, weather });
  // clicking / tapping things in the world (the errand's goods, the shopkeeper, the jar)
  const picker = new Picker(camera, renderer.domElement, { active: () => player.active && !ui.isMenuOpen() && !camp.cinematic });
  picker.onTooFar = () => ui.toast('نزدیک‌تر برو', 1500);
  // the errand (made below, once the session exists): the map blinks where it leads
  let errand: PartyErrand | null = null;
  // small map in the corner (hidden during the introductions)
  const minimap = new Minimap({
    container: document.body, trees: forest.trees, pathLine: terrain.pathLine,
    // what moves on the map, read-only
    source: {
      people: () => camp.gathering.people.map((p) => p.seat),
      dog: () => camp.dog?.root.position ?? null,
      deer: () => deer.agents,
      target: () => errand?.mapTarget() ?? null,
    },
    store: { ...store.mapShape(), path: terrain.storePath },
  });
  const session = new Session({ ui, events, player, camp, sound, quality, minimap, canvas: renderer.domElement, errandDone: () => errand?.finished ?? true });
  const questWorld = new THREE.Group(); // the jar's ghost flies in world coordinates
  scene.add(questWorld);
  // the player's own hands, and the bag (a flashlight in it from the start)
  const hands = new Hands({ scene, world: questWorld, ground: (x, z) => terrain.heightAt(x, z), model: (T as TextureSet).scenes?.fp_arms ?? null });
  const inventory = new Inventory({ hands, events, scene });
  events.on(EV.INVENTORY, (inv) => ui.setInventory(inv));
  ui.on('equip', (id) => inventory.equip(id as ItemId | null));
  ui.on('enter', () => ui.showBag(true));
  inventory.add('flashlight');
  errand = new PartyErrand({
    camp, store, player, picker, events, terrain, collision, world: questWorld,
    voices: () => camp.voices, touch: () => session.touch.enabled, camera,
    night: { day, weather, lighting },
    // «روح ترسناک» in the menu: read when the walk back begins
    scary: () => ui.settings.scaryGhost !== false,
    hands, inventory,
  });
  const theErrand = errand;
  const hud = new Hud({ ui, day });

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  // ---------- warm-up ----------
  await step(0.92, 'آماده‌سازی نور و سایه‌ها…');
  upgradeScannedMaterials(scene, T);
  day.apply(true);
  lighting.refreshEnv();
  const culling = new Culling({ camera, forest, vegetation });
  player.update(0);
  culling.update();
  try { await renderer.renderer.compileAsync(scene, camera); } catch { renderer.renderer.compile(scene, camera); }

  // ---------- the systems, in the order they run every frame ----------
  const game = new Game<ForestFrame>({ camera, env: day.env });
  const sys = (name: string, update: (f: ForestFrame) => void) => game.add({ name, update });
  // 1. time and the player: the hour (and so the light) first, then movement
  sys('day', (f) => { day.update(f.dt); f.env = day.env; });
  sys('weather', (f) => {
    weather.update(f.dt);
    // dry spells: a little more sun, thinner mist and clouds, more birdsong
    const dry = 1 - weather.intensity;
    lighting.sun.intensity *= 1 + 0.35 * dry;
    (scene.fog as THREE.FogExp2).density *= 1 - 0.2 * dry;
    sky.uniforms.uCover.value = 0.35 + 0.65 * weather.intensity;
    f.env.birdActivity = Math.min(1, f.env.birdActivity * (0.55 + 0.75 * dry));
    rain.setIntensity(weather.intensity);
    sound.setRain(weather.intensity, weather.wetness);
  });
  sys('wind', (f) => wind.update(f.dt, f.time));
  sys('player', (f) => player.update(f.dt));
  // 2. the camera is final for this frame: the introductions may take it over,
  //    then everything that depends on where it looks
  sys('film camera', (f) => {
    camp.applyCamera(f.camera, f.dt);
    // a film camera high over the forest (the welcome's flight) sees through thinner mist
    if (camp.cinematic) {
      const c = f.camera.position;
      const up = THREE.MathUtils.clamp((c.y - terrain.heightAt(c.x, c.z) - 8) / 30, 0, 1);
      (scene.fog as THREE.FogExp2).density *= 1 - 0.6 * up;
    }
  });
  // the hands (and what they hold) follow the camera; shown while playing, not in film scenes
  sys('hands', (f) => {
    hands.update(f.dt, f.camera, session.entered && !camp.cinematic, player.speed / player.walkSpeed);
    inventory.update(f.dt, f.camera, camp.cinematic);
  });
  sys('culling', () => culling.update());
  sys('lighting', (f) => lighting.update(f));
  // 3. the world moves
  sys('session', (f) => session.update(f));
  sys('sky', (f) => sky.update(f.camera, f.time));
  sys('fire', (f) => fire.update(f.dt, f.time, f.camera, f.env));
  sys('cabin', (f) => cabin.update(f.dt, f.time, f.camera, f.env, wind.strength));
  sys('camp', (f) => camp.update(f.dt, f.time, f.camera, f.env, wind.strength));
  sys('store', (f) => store.update(f.dt, f.camera, f.env));
  sys('errand', (f) => { if (session.entered) theErrand.update(f.dt); });
  // ?lab=wraith: the ghost's true shape on its own, at night in front of the player,
  // over and over: a small knot spinning up out of the ground into the whirlwind (3 s), the
  // whirlwind (1.5 s), gathering into the spectre (2.5 s), the spectre (5 s), back (1 s)
  if (new URLSearchParams(location.search).get('lab') === 'wraith') {
    const wraith = new Wraith(terrain);
    questWorld.add(wraith.group);
    let labT = -1;
    sys('lab', (f) => {
      if (!session.entered) return;
      if (camp.intro.active) { camp.intro.skip(); return; }
      if (labT < 0) {
        labT = 0;
        day.cycleSeconds = 0;
        day.setHour(23);
        // in the dark of the woods on the trail, away from the fire's light
        player.teleport(-3, 22, Math.atan2(-(FIRE.x + 3), -(FIRE.z - 22)));
        player.pitch = 0.12;
        const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
        Object.assign(wraith.pose, { x: player.x + fx * 4.5, z: player.z + fz * 4.5, heading: Math.atan2(-fx, -fz) });
        wraith.show(true);
      }
      labT = (labT + f.dt) % 13;
      wraith.pose.grow = Math.min(1, labT / 3);
      wraith.pose.form = labT < 4.5 ? 0 : labT < 7 ? (labT - 4.5) / 2.5 : labT < 12 ? 1 : 0;
      wraith.pose.opacity = labT < 12 ? 1 : 1 - (labT - 12);
      wraith.update(f.dt);
    });
    if (debug) (window as unknown as { wraith: Wraith }).wraith = wraith;
  }
  sys('picker', () => picker.update());
  sys('rain', (f) => rain.update(f.dt, f.time, f.camera, f.env));
  sys('mist', (f) => { mist.setIndoor(store.playerInside); mist.update(f.dt, f.time, f.camera, f.env); });
  sys('puddles', (f) => puddles.update(f.time, f.camera, f.env, weather.intensity));
  sys('deer', (f) => deer.update(f.dt, f.time, player));
  sys('wildlife', (f) => wildlife.update(f.dt, f.time, player, f.env));
  // 4. output: sound, the map (after everyone has moved), the picture
  sys('sound', (f) => sound.update(f.dt, f.camera, f.env, wind));
  sys('minimap', (f) => { if (session.entered) minimap.update(f.dt, player.x, player.z, player.yaw); });
  sys('environment map', (f) => lighting.updateEnvironment(f));
  sys('render', (f) => renderer.render(f.time));
  // 5. after the frame: readouts and automatic quality (measures the frame just drawn)
  sys('hud', () => hud.update());
  sys('quality', () => quality.update());
  game.start();

  ui.setLoading(1);
  setTimeout(() => { ui.hideLoading(); ui.showStart(); }, 250);

  if (debug) {
    // for tests and the browser console (?debug)
    window.forest = {
      game, events, frame: (dt?: number) => game.frame(dt), THREE, frustum: culling.frustum, scene, camera, renderer, gpu, gov: quality.gov, quality,
      player, hands, inventory, day, weather, sky, sound, world, deer, wildlife, fire, cabin, camp, store, errand: theErrand, picker, forest, vegetation, rain, mist, puddles, terrain, lighting, session,
      applyQuality: (name: Parameters<QualityManager['apply']>[0]) => quality.apply(name), FIRE,
    };
  }
  return game;
}
