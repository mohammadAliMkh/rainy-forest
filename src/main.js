import * as THREE from 'three';
// Vazirmatn is bundled with the site (no Google Fonts request, which can be slow or blocked)
import '@fontsource/vazirmatn/300.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/800.css';
import './style.css';
import { installFogChunks } from './core/shaderPatches.js';
import { QUALITY_PRESETS, FIRE } from './core/config.js';
import { Renderer } from './core/Renderer.js';
import { detectGpu, TIERS } from './core/gpuTier.js';
import { createTextures, setMaxAnisotropy } from './world/textures.js';
import { Terrain } from './world/Terrain.js';
import { Forest } from './world/Forest.js';
import { Vegetation, DETAIL_LAYER } from './world/Vegetation.js';
import { Cabin } from './world/Cabin.js';
import { Campfire } from './world/Fire.js';
import { Camp } from './world/Camp.js';
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
import { TouchControls, isTouchFirst } from './ui/TouchControls.js';
import { Minimap } from './ui/Minimap.js';

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
  // pick the starting quality from the GPU the browser runs on
  const gpu = detectGpu(renderer.renderer);
  let autoMode = ui.settings.quality === 'auto' || !QUALITY_PRESETS[ui.settings.quality];
  const T = createTextures({ detail: QUALITY_PRESETS[autoMode ? gpu.tier : ui.settings.quality].texDetail });

  await step(0.2, 'شکل دادن زمین و مسیر جنگلی…');
  const terrain = new Terrain(T);
  scene.add(terrain.mesh);
  const collision = new CollisionWorld();

  await step(0.32, 'کاشتن درختان بلند و قدیمی…');
  const cabin = new Cabin(T, terrain, collision); // cabin first: its colliders keep trees away
  const fire = new Campfire(T, terrain, collision);
  await step(0.38, 'دوستان دور آتش، لونا، پاترول و هورنت…');
  const camp = new Camp(T, terrain, collision); // before the forest: keeps trees off the car & bike
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

  // lights
  const hemi = new THREE.HemisphereLight(0xaab8c4, 0x2b2a1e, 1);
  const ambient = new THREE.AmbientLight(0xaab8c4, 0.2);
  // a lantern the player carries: warm light a few metres around them, only
  // after dark (always in the scene so switching it on never recompiles)
  const lantern = new THREE.PointLight(0xffbf80, 0, 13, 1.35);
  scene.add(lantern);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, ambient, sun, sun.target);

  await step(0.82, 'آهوها، پرندگان و خرگوش‌ها…');
  const world = { terrain, collision, cabin, fire, camp, forest, player: null, emit: () => {} };
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
  // the camp's intro keeps the ambience lowered across all of its lines
  camp.onVoice = (key, pos) => sound.playVoice(key, pos, { duck: false, flat: true });
  camp.voicesReady = () => !!sound.engine.filesLoaded;
  camp.onDuck = (on) => sound.engine.setDucking(on);
  camp.gathering.onStrum = (pos, chord, down, vel) => sound.strum(pos, chord, down, vel);
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
  let qualityName = autoMode ? gpu.tier : ui.settings.quality;
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
    // the lantern costs a light per pixel: the lowest level does without it
    // and gets a little more moonlight instead (switching levels recompiles anyway)
    lantern.visible = name !== 'low';
    syncPixelRatio();
  };
  const syncPixelRatio = () => {
    const pr = renderer.renderer.getPixelRatio();
    rain.setPixelRatio(pr);
    mist.setPixelRatio(pr);
    fire.sparks.material.uniforms.uPixel.value = pr;
  };
  applyQuality(qualityName);
  if (autoMode) ui.setAutoQualityLabel(qualityName);

  // Automatic quality: the resolution floats with the measured frame rate;
  // the whole level only changes when resolution alone can't keep up (or
  // there is clear headroom). Never goes more than one level above the GPU
  // guess; a level it had to leave is only tried again after ~30 s of
  // plenty of headroom, then 60 s, and after two failed tries never again
  // (each level change recompiles shaders, a short hitch). The low mark sits
  // under 30 so screens / battery savers that cap at 30 FPS don't drag the
  // quality down for nothing.
  const gov = { t0: 0, frames: 0, holdUntil: 0, highStreak: 0, calm: 0, wait: 15, fails: 0, retried: false, ceiling: Math.min(TIERS.length - 1, TIERS.indexOf(gpu.tier) + 1) };
  gov.maxCeiling = gov.ceiling;
  gov.reset = (hold = 3) => { gov.t0 = 0; gov.frames = 0; gov.holdUntil = performance.now() + hold * 1000; gov.highStreak = 0; };
  const setLevel = (name) => {
    applyQuality(name);
    ui.setAutoQualityLabel(name);
    gov.reset(4);
  };
  const governor = (now) => {
    if (now < gov.holdUntil) return;
    if (!gov.t0) { gov.t0 = now; gov.frames = 0; return; }
    gov.frames++;
    if (now - gov.t0 < 2000) return;
    const fps = (gov.frames * 1000) / (now - gov.t0);
    gov.t0 = now; gov.frames = 0;
    const q = QUALITY_PRESETS[qualityName];
    const i = TIERS.indexOf(qualityName);
    const pr = renderer.renderer.getPixelRatio();
    if (fps < 27) {
      gov.highStreak = 0; gov.calm = 0;
      if (pr > q.minScale + 0.01) { renderer.setScale(pr - (fps < 22 ? 0.2 : 0.1)); syncPixelRatio(); gov.reset(1); }
      else if (i > 0) {
        if (gov.retried && now - gov.retriedAt < 90000) {
          // a retried level failed again: wait twice as long, give up after two
          gov.retried = false;
          gov.wait *= 2;
          if (++gov.fails >= 2) gov.maxCeiling = Math.min(gov.maxCeiling, i - 1);
        }
        gov.ceiling = Math.min(gov.ceiling, i - 1);
        setLevel(TIERS[i - 1]);
      }
    } else if (fps > 55) {
      if (++gov.calm >= gov.wait && gov.ceiling < gov.maxCeiling) { gov.ceiling++; gov.calm = 0; gov.retried = true; gov.retriedAt = now; }
      if (++gov.highStreak < 2) return;
      gov.highStreak = 0;
      if (pr < q.maxScale - 0.01) { renderer.setScale(pr + 0.1); syncPixelRatio(); gov.reset(1); }
      else if (i < gov.ceiling) setLevel(TIERS[i + 1]);
    } else { gov.highStreak = 0; gov.calm = 0; }
  };

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
  // small map in the corner (hidden during the introductions)
  const minimap = new Minimap({ container: document.body, trees: forest.trees, pathLine: terrain.pathLine, camp, deer });
  const showMap = () => minimap.setVisible(entered && ui.settings.minimap && !camp.intro.active);
  ui.on('minimap', showMap);
  ui.on('quality', (q) => {
    autoMode = q === 'auto';
    const level = autoMode ? gpu.tier : q;
    applyQuality(level);
    if (autoMode) ui.setAutoQualityLabel(level);
    gov.reset();
  });

  let entered = false;
  const menuOpen = () => !document.getElementById('pause').classList.contains('hidden');
  const openMenu = () => { player.freeMode = false; player.keys.clear(); touch.show(false); ui.showPause(''); };
  const closeMenu = () => { ui.hidePause(); player.freeMode = !camp.intro.active; touch.show(!camp.intro.active); };
  // phones / tablets: joystick + drag-to-look + buttons instead of keys & mouse
  const touch = new TouchControls(player, renderer.domElement, { onMenu: openMenu });
  touch.onEnable = () => { if (entered && !menuOpen() && !camp.intro.active) touch.show(true); };
  // the introductions take over the camera like a film scene
  camp.onCinematic = (on) => {
    player.freeMode = !on && !menuOpen();
    player.keys.clear();
    if (!menuOpen()) touch.show(!on);
    ui.setCinema(on);
    showMap();
  };
  camp.onCaption = (name) => ui.setCaption(name);
  camp.onSubtitle = (text) => ui.setSubtitle(text);
  camp.onFade = (a) => ui.setFade(a);
  ui.on('skip', () => camp.intro.skip());
  if (isTouchFirst()) touch.enable();

  ui.on('enter', () => {
    if (entered) return;
    // the audio context is created inside this click; the recordings load in
    // the background, so the forest opens right away
    sound.start().catch((e) => {
      console.warn('Audio failed to start', e);
      sound.engine.filesLoaded = true; // no sound: the introductions must not wait forever
    });
    entered = true;
    ui.hideStart();
    showMap();
    player.freeMode = true;
    if (touch.enabled) {
      // full screen + landscape where the browser allows it (not on iPhone)
      touch.show(true);
      const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      Promise.resolve(fs).then(() => screen.orientation?.lock?.('landscape')).catch(() => { /* not allowed / supported */ });
      setTimeout(() => ui.toast('حرکت: دایره پایین سمت چپ · نگاه: انگشت را روی صفحه بکشید', 6000), 900);
    } else {
      setTimeout(() => ui.toast('نگاه: بردن موس به لبه تصویر، یا نگه‌داشتن کلیک راست و کشیدن · تنظیمات: Esc', 6000), 900);
    }
  });
  ui.on('resume', closeMenu);
  ui.on('replayIntro', () => {
    camp.intro.done = false; // plays again (now if near the fire, else on the way there)
    closeMenu();
  });
  // pause the sound while the tab is hidden
  document.addEventListener('visibilitychange', () => {
    const ctx = sound.engine.ctx;
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.();
    else if (entered) ctx.resume?.();
  });
  window.addEventListener('keydown', (e) => {
    if (!entered) return;
    // during the introductions Esc / Space / Enter skip them
    if (camp.intro.active && !menuOpen() && ['Escape', 'Space', 'Enter'].includes(e.code)) {
      e.preventDefault();
      camp.intro.skip();
      return;
    }
    // Esc opens / closes the settings menu
    if (e.code !== 'Escape') return;
    if (!menuOpen()) openMenu();
    else closeMenu();
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
  let time = 0, envTimer = 0, fpsAcc = 0, fpsFrames = 0, waitHintAt = 0;
  const frame = (forcedDt) => {
    const dt = forcedDt ?? Math.min(clock.getDelta(), 0.05);
    time += dt;

    day.update(dt);
    wind.update(dt, time);
    player.update(dt, time);
    camp.intro.applyCamera(camera, dt); // film camera during the introductions
    updateCulling();
    updateSun();

    const env = day.env;
    {
      const dark = THREE.MathUtils.clamp((0.48 - env.ambientLevel) / 0.12, 0, 1);
      const on = camp.intro.active ? 0 : dark;
      lantern.intensity += (on * 5.5 - lantern.intensity) * Math.min(1, dt * 2);
      if (!lantern.visible) hemi.intensity += dark * 0.3;
      lantern.position.set(0.28, -0.42, -0.3).applyQuaternion(camera.quaternion).add(camera.position);
    }
    if (entered && !camp.intro.done && !sound.engine.filesLoaded && time > waitHintAt
      && Math.hypot(camera.position.x - FIRE.x, camera.position.z - FIRE.z) < 5.2) {
      ui.toast('صداها در حال آماده شدن‌اند…', 2500);
      waitHintAt = time + 6;
    }
    if (entered) minimap.update(dt, player.x, player.z, player.yaw);
    sky.update(camera, time);
    fire.update(dt, time, camera, env);
    cabin.update(dt, time, camera, env, wind.strength);
    camp.update(dt, time, camera, env, wind.strength);
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
    const nowMs = performance.now();
    if (!fpsAcc) fpsAcc = nowMs;
    fpsFrames++;
    if (nowMs - fpsAcc > 500) {
      ui.setFps(`${Math.round((fpsFrames * 1000) / (nowMs - fpsAcc))} FPS · ${day.timeString}`);
      ui.setClock(day.timeString, day.hour);
      fpsAcc = nowMs; fpsFrames = 0;
    }
    if (entered && autoMode && !menuOpen() && !document.hidden) governor(performance.now());
    else gov.reset(1);
  };
  const loop = () => {
    requestAnimationFrame(loop);
    frame();
  };
  loop();

  ui.setLoading(1, '');
  setTimeout(() => { ui.hideLoading(); ui.showStart(); }, 250);

  if (DEBUG) {
    window.forest = { frame, THREE, frustum, scene, camera, renderer, gpu, gov, player, day, sound, world, deer, wildlife, fire, cabin, camp, forest, vegetation, rain, mist, puddles, terrain, applyQuality, FIRE };
  }
}

build().catch((e) => {
  console.error(e);
  ui.setLoading(1, 'خطا در ساخت صحنه: ' + e.message);
});
