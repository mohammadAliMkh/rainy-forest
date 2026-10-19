import * as THREE from 'three';
import './style.css';
import { installFogChunks } from './core/shaderPatches.js';
import { QUALITY_PRESETS, FIRE } from './core/config.js';
import { Renderer } from './core/Renderer.js';
import { createTextures, setMaxAnisotropy } from './world/textures.js';
import { Terrain } from './world/Terrain.js';
import { Forest } from './world/Forest.js';
import { Vegetation, DETAIL_LAYER } from './world/Vegetation.js';
import { Cabin } from './world/Cabin.js';
import { Campfire } from './world/Fire.js';
import { Puddles, PUDDLE_LAYER } from './world/Puddles.js';
import { Rain } from './world/Rain.js';
import { Mist } from './world/Mist.js';
import { Sky } from './world/Sky.js';
import { DayCycle } from './world/DayCycle.js';
import { Wind } from './world/Wind.js';
import { DeerHerd } from './creatures/Deer.js';
import { Wildlife } from './creatures/Wildlife.js';
import { CollisionWorld } from './player/Collision.js';
import { PlayerController } from './player/PlayerController.js';
import { Soundscape } from './audio/Soundscape.js';
import { UI } from './ui/UI.js';

installFogChunks();

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// setTimeout (not rAF) so loading also progresses in a background tab
const nextFrame = () => new Promise((r) => setTimeout(r, 16));

const ui = new UI();
ui.bind();

async function build() {
  const renderer = new Renderer(document.getElementById('app'));
  setMaxAnisotropy(renderer.renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8a979e, 0.024);
  scene.background = new THREE.Color(0x8a979e);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.08, 1500);
  camera.layers.enable(PUDDLE_LAYER);
  camera.layers.enable(DETAIL_LAYER);
  scene.add(camera);

  const steps = [];
  const step = async (p, text) => { ui.setLoading(p, text); steps.push(text); await nextFrame(); };

  await step(0.05, 'نقاشی بافت‌ها: پوست درخت، خاک خیس، خزه و برگ‌ها…');
  const T = createTextures();

  await step(0.2, 'شکل دادن زمین و مسیر جنگلی…');
  const terrain = new Terrain(T);
  scene.add(terrain.mesh);
  const collision = new CollisionWorld();

  await step(0.32, 'کاشتن درختان بلند و قدیمی…');
  const cabin = new Cabin(T, terrain, collision); // cabin first: its colliders keep trees away
  const fire = new Campfire(T, terrain, collision);
  const forest = new Forest(T, terrain, collision);
  scene.add(forest.group);

  await step(0.5, 'سرخس‌ها، بوته‌های شبنم‌زده، سنگ‌ها و قارچ‌ها…');
  const vegetation = new Vegetation(T, terrain, collision, forest);
  scene.add(vegetation.group);

  await step(0.62, 'ساختن کلبه چوبی و روشن کردن آتش…');
  cabin.addTo(scene);
  fire.addTo(scene);

  await step(0.72, 'باران، مه و گودال‌های آب…');
  const puddles = new Puddles(terrain, T);
  scene.add(puddles.group);
  const rain = new Rain(terrain);
  rain.addTo(scene);
  const mist = new Mist(terrain);
  mist.addTo(scene);
  const sky = new Sky();
  scene.add(sky.mesh);

  // lights
  const hemi = new THREE.HemisphereLight(0xaab8c4, 0x2b2a1e, 1);
  const ambient = new THREE.AmbientLight(0xaab8c4, 0.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, ambient, sun, sun.target);

  await step(0.82, 'آهوها، پرندگان و خرگوش‌ها…');
  const world = { terrain, collision, cabin, fire, forest, player: null, emit: () => {} };
  const player = new PlayerController(camera, renderer.domElement, terrain, collision, { debug: DEBUG });
  world.player = player;
  const deer = new DeerHerd(T, world);
  scene.add(deer.group);
  const wildlife = new Wildlife(world, forest);
  scene.add(wildlife.group);

  const wind = new Wind();
  const day = new DayCycle({ scene, sky, sun, hemi, ambient, renderer: renderer.renderer });
  const sound = new Soundscape(world);
  world.emit = (type, src) => sound.onEvent(type, src);
  player.onStep = (info) => sound.footstep(info);

  // environment map from the sky (wet reflections), refreshed as the day goes on
  const pmrem = new THREE.PMREMGenerator(renderer.renderer);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(sky.mesh.geometry, sky.material));
  let envRT = null;
  const refreshEnv = () => {
    const rt = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.55;
    if (envRT) envRT.dispose();
    envRT = rt;
  };

  renderer.setupComposer(scene, camera);

  // ---------- quality ----------
  let qualityName = ui.settings.quality;
  const applyQuality = (name) => {
    qualityName = name;
    const q = QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
    renderer.setQuality(q);
    sun.castShadow = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowSize) {
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    forest.setQuality(q);
    vegetation.setQuality(q);
    puddles.setReflections(q.reflections, q.reflectionSize, q.reflectEvery || 1);
    mist.setCount(q.mistCount);
    const pr = renderer.renderer.getPixelRatio();
    rain.setPixelRatio(pr);
    mist.setPixelRatio(pr);
    fire.sparks.material.uniforms.uPixel.value = pr;
  };
  applyQuality(qualityName);

  // ---------- settings wiring ----------
  const s = ui.settings;
  Object.assign(sound.engine.volumes, s.volumes);
  sound.engine.muted = s.muted;
  day.cycleSeconds = s.daySpeed;
  player.sensitivity = s.sensitivity;
  ui.on('volume', (k, v) => sound.engine.setVolume(k, v));
  ui.on('mute', (m) => sound.engine.setMuted(m));
  ui.on('time', (h) => { day.setHour(h); refreshEnv(); });
  ui.on('daySpeed', (v) => { day.cycleSeconds = v; });
  ui.on('sensitivity', (v) => { player.sensitivity = v; });
  ui.on('quality', (q) => applyQuality(q));

  let entered = false;
  ui.on('enter', async () => {
    try { await sound.start(); } catch (e) { console.warn('Audio failed to start', e); }
    entered = true;
    ui.hideStart();
    player.freeMode = true;
    setTimeout(() => ui.toast('نگاه: بردن موس به لبه تصویر، یا نگه‌داشتن کلیک راست و کشیدن · تنظیمات: Esc', 6000), 900);
  });
  ui.on('resume', () => { ui.hidePause(); player.freeMode = true; });
  window.addEventListener('keydown', (e) => {
    // Esc opens / closes the settings menu
    if (e.code !== 'Escape' || !entered) return;
    if (document.getElementById('pause').classList.contains('hidden')) { player.freeMode = false; player.keys.clear(); ui.showPause(''); }
    else { ui.hidePause(); player.freeMode = true; }
  });

  window.addEventListener('resize', () => renderer.resize());
  renderer.resize();

  // ---------- warm-up ----------
  await step(0.92, 'آماده‌سازی نور و سایه‌ها…');
  day.apply(true);
  refreshEnv();
  const frustum = new THREE.Frustum();
  const projScreen = new THREE.Matrix4();
  const updateCulling = () => {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);
    forest.update(camera, frustum);
    vegetation.update(camera, frustum);
  };
  player.update(0, 0);
  updateCulling();
  try { await renderer.renderer.compileAsync(scene, camera); } catch { renderer.renderer.compile(scene, camera); }

  // shadow camera follows the player, snapped to texels to avoid shimmering
  const lightRot = new THREE.Matrix4();
  const lightRotInv = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const updateSun = () => {
    const dir = day.lightDir;
    lightRot.lookAt(new THREE.Vector3(), dir.clone().negate(), new THREE.Vector3(0, 1, 0));
    lightRotInv.copy(lightRot).invert();
    tmpV.copy(camera.position);
    tmpV.y = player.groundY;
    tmpV.applyMatrix4(lightRotInv);
    const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    tmpV.x = Math.round(tmpV.x / texel) * texel;
    tmpV.y = Math.round(tmpV.y / texel) * texel;
    tmpV.applyMatrix4(lightRot);
    sun.target.position.copy(tmpV);
    sun.position.copy(tmpV).addScaledVector(dir, 110);
    sun.target.updateMatrixWorld();
  };

  // ---------- main loop ----------
  const clock = new THREE.Clock();
  let time = 0, envTimer = 0, fpsAcc = 0, fpsFrames = 0, perfAcc = 0, perfFrames = 0, perfChecked = false, playTime = 0;
  const frame = (forcedDt) => {
    const dt = forcedDt ?? Math.min(clock.getDelta(), 0.05);
    time += dt;

    day.update(dt);
    wind.update(dt, time);
    player.update(dt, time);
    updateCulling();
    updateSun();

    const env = day.env;
    sky.update(camera, time);
    fire.update(dt, time, camera, env);
    cabin.update(dt, time, camera, env, wind.strength);
    rain.update(dt, time, camera, env);
    mist.update(dt, time, camera, env);
    puddles.update(time, camera, env);
    deer.update(dt, time, player);
    wildlife.update(dt, time, player, env);
    sound.update(dt, camera, env, wind);

    envTimer += dt;
    if (envTimer > (day.cycleSeconds > 0 && day.cycleSeconds < 1000 ? 1.5 : 4)) { envTimer = 0; refreshEnv(); }

    renderer.render(time);

    // fps + adaptive quality during the first seconds of play
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc > 0.5) {
      ui.setFps(`${Math.round(fpsFrames / fpsAcc)} FPS · ${day.timeString}`);
      ui.setClock(day.timeString, day.hour);
      fpsAcc = 0; fpsFrames = 0;
    }
    if (entered && !perfChecked) {
      playTime += dt;
      if (playTime > 2) { perfAcc += dt; perfFrames++; }
      if (playTime > 8) {
        perfChecked = true;
        const fps = perfFrames / perfAcc;
        if (fps < 28 && qualityName !== 'low') {
          const next = qualityName === 'high' ? 'medium' : 'low';
          applyQuality(next);
          ui.settings.quality = next;
          document.getElementById('quality').value = next;
          ui.toast('برای روان‌تر شدن، کیفیت گرافیک خودکار کمی پایین آمد (قابل تغییر در Esc)', 5000);
        }
      }
    }
  };
  const loop = () => {
    requestAnimationFrame(loop);
    frame();
  };
  loop();

  ui.setLoading(1, '');
  setTimeout(() => { ui.hideLoading(); ui.showStart(); }, 250);

  if (DEBUG) {
    window.forest = { frame, THREE, frustum, scene, camera, renderer, player, day, sound, world, deer, wildlife, fire, cabin, forest, vegetation, rain, mist, puddles, terrain, applyQuality, FIRE };
  }
}

build().catch((e) => {
  console.error(e);
  ui.setLoading(1, 'خطا در ساخت صحنه: ' + e.message);
});
