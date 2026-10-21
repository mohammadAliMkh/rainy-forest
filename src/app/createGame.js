import * as THREE from 'three';
import { FIRE } from '../config/config.js';
import { EV } from '../config/events.js';
import { EventBus } from '../engine/events.js';
import { Game } from '../engine/Game.js';
import { installFogChunks } from '../engine/render/shaderPatches.js';
import { Renderer } from '../engine/render/Renderer.js';
import { detectGpu } from '../engine/render/gpuTier.js';
import { QualityManager } from '../engine/quality/QualityManager.js';
import { createTextures, setMaxAnisotropy } from '../game/world/textures.js';
import { Terrain } from '../game/world/Terrain.js';
import { Forest } from '../game/world/Forest.js';
import { Vegetation, DETAIL_LAYER } from '../game/world/Vegetation.js';
import { Cabin } from '../game/world/Cabin.js';
import { Puddles, PUDDLE_LAYER } from '../game/world/Puddles.js';
import { Culling } from '../game/world/Culling.js';
import { Campfire } from '../game/camp/Fire.js';
import { Camp } from '../game/camp/Camp.js';
import { Rain } from '../game/weather/Rain.js';
import { Mist } from '../game/weather/Mist.js';
import { Sky } from '../game/weather/Sky.js';
import { DayCycle } from '../game/weather/DayCycle.js';
import { Wind } from '../game/weather/Wind.js';
import { Lighting } from '../game/lighting/Lighting.js';
import { DeerHerd } from '../game/creatures/Deer.js';
import { Wildlife } from '../game/creatures/Wildlife.js';
import { CollisionWorld } from '../game/player/Collision.js';
import { PlayerController } from '../game/player/PlayerController.js';
import { Soundscape } from '../game/sound/Soundscape.js';
import { Minimap } from '../ui/Minimap.js';
import { Session } from './Session.js';
import { Hud } from './Hud.js';
import { connectSettings } from './settings.js';

// Builds the whole game (with the loading bar), connects the parts and
// lists the systems that run every frame, in order. This is the one place
// that knows about everything; the parts themselves only know the event
// bus and the few services they are handed.

// setTimeout (not rAF) so loading also progresses in a background tab
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

export async function createGame({ ui, debug = false }) {
  installFogChunks();
  const events = new EventBus();
  const renderer = new Renderer(document.getElementById('app'));
  setMaxAnisotropy(renderer.renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8a979e, 0.024);
  scene.background = new THREE.Color(0x8a979e);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 1500);
  camera.layers.enable(PUDDLE_LAYER);
  camera.layers.enable(DETAIL_LAYER);
  scene.add(camera);

  const step = async (p, text) => { ui.setLoading(p, text); await nextFrame(); };

  // ---------- building the world ----------
  await step(0.05, 'نقاشی بافت‌ها: پوست درخت، خاک خیس، خزه و برگ‌ها…');
  // pick the starting quality from the GPU the browser runs on
  const gpu = detectGpu(renderer.renderer);
  const quality = new QualityManager({ renderer, events, gpuTier: gpu.tier, setting: ui.settings.quality });
  const T = createTextures({ detail: quality.preset.texDetail });

  await step(0.2, 'شکل دادن زمین و مسیر جنگلی…');
  const terrain = new Terrain(T);
  scene.add(terrain.mesh);
  const collision = new CollisionWorld();

  await step(0.32, 'کاشتن درختان بلند و قدیمی…');
  const cabin = new Cabin(T, terrain, collision); // cabin first: its colliders keep trees away
  const fire = new Campfire(T, terrain, collision);
  await step(0.38, 'دوستان دور آتش، لونا، پاترول و هورنت…');
  const camp = new Camp(T, terrain, collision, { events }); // before the forest: keeps trees off the car & bike
  const forest = new Forest(T, terrain, collision);
  scene.add(forest.group);

  await step(0.5, 'سرخس‌ها، بوته‌های شبنم‌زده، سنگ‌ها و قارچ‌ها…');
  const vegetation = new Vegetation(T, terrain, collision, forest);
  scene.add(vegetation.group);

  await step(0.62, 'ساختن کلبه چوبی و روشن کردن آتش…');
  cabin.addTo(scene);
  fire.addTo(scene);
  camp.addTo(scene);

  await step(0.72, 'باران، مه و گودال‌های آب…');
  const puddles = new Puddles(terrain, T);
  scene.add(puddles.group);
  const rain = new Rain(terrain);
  rain.setShelters([camp.canopy.shelter, camp.carport.shelter]);
  rain.addTo(scene);
  const mist = new Mist(terrain);
  mist.addTo(scene);
  const sky = new Sky();
  scene.add(sky.mesh);
  const lighting = new Lighting({ scene, renderer, sky });

  await step(0.82, 'آهوها، پرندگان و خرگوش‌ها…');
  // shared context the creatures use; their sounds go out on the event bus
  const world = { terrain, collision, cabin, fire, camp, forest, player: null, emit: (type, source) => events.emit(EV.CREATURE_SOUND, { type, source }) };
  const player = new PlayerController(camera, renderer.domElement, terrain, collision, { debug, events });
  world.player = player;
  const deer = new DeerHerd(T, world);
  scene.add(deer.group);
  const wildlife = new Wildlife(world, forest);
  scene.add(wildlife.group);

  const wind = new Wind();
  const day = new DayCycle({ scene, sky, sun: lighting.sun, hemi: lighting.hemi, ambient: lighting.ambient, renderer: renderer.renderer });
  lighting.connect({ day, player, cinematic: () => camp.intro.active });
  const sound = new Soundscape(world, events);
  // the camp's introductions keep the ambience lowered across all of their lines
  camp.voices = {
    play: (key, pos) => sound.playVoice(key, pos, { duck: false, flat: true }),
    ready: () => !!sound.engine.filesLoaded,
  };

  renderer.setupComposer(scene, camera);

  // ---------- graphics quality ----------
  events.on(EV.QUALITY_CHANGED, ({ name, preset }) => {
    lighting.setQuality(name, preset);
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
  connectSettings({ ui, sound, day, player, quality, lighting });
  // small map in the corner (hidden during the introductions)
  const minimap = new Minimap({ container: document.body, trees: forest.trees, pathLine: terrain.pathLine, camp, deer });
  const session = new Session({ ui, events, player, camp, sound, quality, minimap, canvas: renderer.domElement });
  const hud = new Hud({ ui, day });

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  // ---------- warm-up ----------
  await step(0.92, 'آماده‌سازی نور و سایه‌ها…');
  day.apply(true);
  lighting.refreshEnv();
  const culling = new Culling({ camera, forest, vegetation });
  player.update(0, 0);
  culling.update();
  try { await renderer.renderer.compileAsync(scene, camera); } catch { renderer.renderer.compile(scene, camera); }

  // ---------- the systems, in the order they run every frame ----------
  const game = new Game();
  const frame = game.frameState;
  frame.camera = camera;
  const sys = (name, update) => game.add({ name, update });
  sys('day', (f) => { day.update(f.dt); f.env = day.env; });
  sys('wind', (f) => wind.update(f.dt, f.time));
  sys('player', (f) => player.update(f.dt, f.time));
  sys('film camera', (f) => camp.intro.applyCamera(camera, f.dt)); // the introductions take over the view
  sys('culling', () => culling.update());
  sys('lighting', (f) => lighting.update(f));
  sys('session', (f) => session.update(f));
  sys('minimap', (f) => { if (session.entered) minimap.update(f.dt, player.x, player.z, player.yaw); });
  sys('sky', (f) => sky.update(camera, f.time));
  sys('fire', (f) => fire.update(f.dt, f.time, camera, f.env));
  sys('cabin', (f) => cabin.update(f.dt, f.time, camera, f.env, wind.strength));
  sys('camp', (f) => camp.update(f.dt, f.time, camera, f.env, wind.strength));
  sys('rain', (f) => rain.update(f.dt, f.time, camera, f.env));
  sys('mist', (f) => mist.update(f.dt, f.time, camera, f.env));
  sys('puddles', (f) => puddles.update(f.time, camera, f.env));
  sys('deer', (f) => deer.update(f.dt, f.time, player));
  sys('wildlife', (f) => wildlife.update(f.dt, f.time, player, f.env));
  sys('sound', (f) => sound.update(f.dt, camera, f.env, wind));
  sys('environment map', (f) => lighting.updateEnvironment(f));
  sys('render', (f) => renderer.render(f.time));
  sys('hud', () => hud.update());
  sys('quality', () => quality.update());
  game.start();

  ui.setLoading(1, '');
  setTimeout(() => { ui.hideLoading(); ui.showStart(); }, 250);

  if (debug) {
    // for tests and the browser console (?debug)
    window.forest = {
      game, events, frame: (dt) => game.frame(dt), THREE, frustum: culling.frustum, scene, camera, renderer, gpu, gov: quality.gov, quality,
      player, day, sound, world, deer, wildlife, fire, cabin, camp, forest, vegetation, rain, mist, puddles, terrain, lighting, session,
      applyQuality: (name) => quality.apply(name), FIRE,
    };
  }
  return game;
}
