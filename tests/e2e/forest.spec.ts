import { test, expect, type Page } from '@playwright/test';

// The main things a visitor does, checked through the game's debug handle
// (window.forest, available with ?debug). Each test starts a fresh page.

// inside page.evaluate the game is reached as `(window as any).forest` (untyped on purpose)

async function open(page: Page, errors: string[], url = '/?debug') {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  // ready (start screen showing) or failed (the loading screen shows the error)
  await page.waitForFunction(() => ((window as any).forest && !document.getElementById('start')!.classList.contains('hidden'))
    || document.getElementById('loading-step')!.textContent!.startsWith('خطا'), null, { timeout: 240_000 });
  const failed = await page.textContent('#loading-step');
  expect(failed?.startsWith('خطا') ? failed : '', 'building the scene failed').toBe('');
}

const enter = (page: Page) => page.evaluate(() => {
  document.getElementById('enter-btn')!.click();
  return document.getElementById('start')!.classList.contains('hidden');
});

test('entering: the start screen closes at once, the opening flight, the scene is complete, then the map shows', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  expect(await enter(page)).toBe(true);
  await page.waitForTimeout(1000);
  const stats = await page.evaluate(() => {
    const f = (window as any).forest;
    let meshes = 0, lights = 0;
    f.scene.traverse((o: { isMesh?: boolean; isLight?: boolean }) => { if (o.isMesh) meshes++; if (o.isLight) lights++; });
    // the game opens with the welcome's flight: no map meanwhile
    const flying = f.camp.cinematic, mapDuring = !document.querySelector('.minimap')!.classList.contains('hidden');
    f.camp.intro.skip();
    for (let k = 0; k < 30; k++) f.frame(0.05);
    return { meshes, lights, flying, mapDuring, map: !document.querySelector('.minimap')!.classList.contains('hidden') };
  });
  expect(stats.flying).toBe(true);
  expect(stats.mapDuring).toBe(false);
  expect(stats.meshes).toBeGreaterThan(400);
  expect(stats.lights).toBe(8); // (with the flashlight's beam, dark until it is taken out)
  expect(stats.map).toBe(true);
  expect(errors).toEqual([]);
});

test('introductions: start on entering, Esc skips them, then Esc opens and Continue closes the menu', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await page.waitForFunction(() => (window as any).forest.sound.engine.filesLoaded, null, { timeout: 120_000 });
  await page.evaluate(() => { const f = (window as any).forest; f.day.cycleSeconds = 0; f.player.teleport(0.8, -9.8, 0.05); });
  await page.waitForFunction(() => (window as any).forest.camp.intro.seq?.voice, null, { timeout: 120_000 });
  expect(await page.textContent('#caption')).toBe('میزبان');
  expect(await page.evaluate(() => document.querySelector('.minimap')!.classList.contains('hidden'))).toBe(true);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !(window as any).forest.camp.intro.active, null, { timeout: 60_000 });
  const menuOpen = () => page.evaluate(() => !document.getElementById('pause')!.classList.contains('hidden'));
  expect(await menuOpen()).toBe(false);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await expect.poll(menuOpen).toBe(true);
  await page.evaluate(() => document.getElementById('resume-btn')!.click());
  await expect.poll(menuOpen).toBe(false);
  expect(errors).toEqual([]);
});

test('life at the camp: Amin strums, Luna moves to someone else, footsteps are heard', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  const result = await page.evaluate(() => {
    const f = (window as any).forest;
    const g = f.camp.gathering, amin = g.byName('amin');
    amin.gtPlaying = true; amin.gtTimer = 999;
    let strums = 0, steps = 0;
    f.events.on('guitar:strum', () => strums++);
    f.events.on('player:step', () => steps++);
    for (let k = 0; k < 400; k++) { g.line = null; g.update(0.05, f.camera); }
    const dog = f.camp.dog, from = dog.restingBy;
    dog.timer = 0;
    for (let t = 0; t < 200 && !(dog.state === 'lie' && t > 2); t += 0.05) dog.update(0.05, dog.headWorld, 0, false);
    f.player.touchMove.z = 1;
    for (let k = 0; k < 25; k++) f.frame(0.1);
    f.player.touchMove.z = 0;
    return { strums, steps, from, to: dog.restingBy };
  });
  expect(result.strums).toBeGreaterThan(10);
  expect(result.to).not.toBe(result.from);
  expect(result.to).toBeTruthy();
  expect(result.steps).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('phone: only skip and sound during the opening film, then the touch controls; the gear opens the menu', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await page.waitForTimeout(1500);
  const shown = (sel: string) => page.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).visibility === 'visible' && !document.querySelector(sel)!.classList.contains('hidden'), sel);
  // the opening film: no joystick / buttons / map / hints, just skip and the sound button
  expect(await shown('#touch-ui')).toBe(false);
  expect(await shown('.minimap')).toBe(false);
  expect(await page.evaluate(() => document.getElementById('toast')!.classList.contains('show'))).toBe(false);
  expect(await shown('#skip-btn')).toBe(true);
  expect(await shown('#mute-btn')).toBe(true);
  await page.evaluate(() => document.getElementById('skip-btn')!.click());
  await page.waitForFunction(() => !(window as any).forest.camp.cinematic, null, { timeout: 60_000 });
  await expect.poll(() => shown('#touch-ui')).toBe(true);
  // how to move and look, once the film is over
  await expect.poll(() => page.evaluate(() => document.getElementById('toast')!.classList.contains('show'))).toBe(true);
  await page.evaluate(() => document.getElementById('menu-btn')!.click());
  await expect.poll(() => page.evaluate(() => !document.getElementById('pause')!.classList.contains('hidden'))).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('weather: the rain stops and comes back; a soft lightning flash with a rumble', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await page.waitForFunction(() => (window as any).forest.sound.started, null, { timeout: 60_000 });
  const r = await page.evaluate(() => {
    const f = (window as any).forest, w = f.weather;
    const levels = () => f.sound.rain.levels.map((g: GainNode) => g.gain.value);
    w.setMode('dry');
    for (let t = 0; t < 300; t += 0.5) w.update(0.5);
    f.frame(0.05);
    const dry = { intensity: w.intensity, rainShown: f.rain.lines.visible };
    w.setMode('rain');
    for (let t = 0; t < 200; t += 0.5) w.update(0.5);
    f.frame(0.05);
    const wet = { intensity: w.intensity, rainShown: f.rain.lines.visible };
    let bolts = 0;
    f.events.on('weather:lightning', () => bolts++);
    w.strike();
    f.frame(0.1);
    return { dry, wet, bolts, flash: f.sky.uniforms.uFlash.value, levelsNow: levels() };
  });
  expect(r.dry.intensity).toBeLessThan(0.02);
  expect(r.dry.rainShown).toBe(false);
  expect(r.wet.intensity).toBeGreaterThan(0.5);
  expect(r.wet.rainShown).toBe(true);
  expect(r.bolts).toBe(1);
  expect(r.flash).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the shop: up the steps and in, the door opens with its bell, the shopkeeper greets you, no rain inside', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  const r = await page.evaluate(() => {
    const f = (window as any).forest, s = f.store, V = f.THREE.Vector3, pl = f.player;
    f.camp.intro.skip(); for (let k = 0; k < 30; k++) f.frame(0.05); // past the opening flight
    // on the footpath in front of the steps, facing the door
    const a = s.group.localToWorld(new V(1.05, 0, 8)), b = s.group.localToWorld(new V(1.05, 0, -1));
    pl.teleport(a.x, a.z, Math.atan2(-(b.x - a.x), -(b.z - a.z)));
    const ground = pl.y;
    let bells = 0, woodSteps = 0, doorOpened = 0;
    f.events.on('store:door', () => bells++);
    f.events.on('player:step', (e: { surface: string }) => { if (e.surface === 'wood') woodSteps++; });
    pl.touchMove.z = 1;
    for (let k = 0; k < 80; k++) { f.frame(0.05); doorOpened = Math.max(doorOpened, s.building.door.rotation.y); }
    pl.touchMove.z = 0;
    for (let k = 0; k < 20; k++) f.frame(0.05);
    const local = s.group.worldToLocal(new V(pl.x, pl.y, pl.z));
    return {
      inside: s.playerInside, climbed: pl.y - ground, local: [local.x, local.z], bells, woodSteps, doorOpened,
      greeted: s.shopkeeper.greeted, // nodded to the customer who came in
      shelteredInside: f.rain._sheltered(pl.x, pl.z),
    };
  });
  expect(r.inside).toBe(true);
  expect(r.climbed).toBeGreaterThan(0.35); // the floor is above the ground
  expect(r.local[1]).toBeGreaterThan(-1.5); // stopped by the fridges, not through the back wall
  expect(r.bells).toBeGreaterThan(0);
  expect(r.doorOpened).toBeGreaterThan(1);
  expect(r.woodSteps).toBeGreaterThan(0);
  expect(r.greeted).toBe(true);
  expect(r.shelteredInside).toBe(true);
  expect(errors).toEqual([]);
});

// the errand tests: step the game without drawing; helpers to look at things
// and to walk to a spot by the shop
async function errandSetup(page: Page) {
  await page.evaluate(() => {
    const f = (window as any).forest;
    for (const name of ['render', 'environment map']) { const sys = f.game.systems.find((x: { name: string }) => x.name === name); sys.update = () => {}; }
    (window as any).step = (sec: number) => { for (let i = 0; i < Math.round(sec * 20); i++) f.frame(0.05); };
    (window as any).lookAt = (o: any) => {
      const c = new f.THREE.Vector3(); new f.THREE.Box3().setFromObject(o).getCenter(c);
      const p = f.player; p.vx = p.vz = 0;
      p.yaw = Math.atan2(-(c.x - p.x), -(c.z - p.z)); p.pitch = Math.atan2(c.y - p.y, Math.hypot(c.x - p.x, c.z - p.z));
      f.frame(0.05);
    };
    (window as any).goTo = (lx: number, lz: number) => { const e = f.store.group.localToWorld(new f.THREE.Vector3(lx, 0, lz)); f.player.teleport(e.x, e.z, 0); (window as any).step(0.3); };
    // the recorded lines as silent 6 s stand-ins that run on game time (a real
    // recording runs on the audio clock, while the test fast-forwards the game)
    let gameT = 0;
    const day = f.game.systems.find((x: { name: string }) => x.name === 'day'), dayUpdate = day.update;
    day.update = (fr: { dt: number }) => { gameT += fr.dt; dayUpdate(fr); };
    f.camp.voices = {
      ready: () => true,
      play: () => { const t0 = gameT; return { duration: 6, get done() { return gameT - t0 > 6; }, elapsed: () => gameT - t0, level: () => 0.2, stop: () => {} }; },
    };
    // what made a sound, and the lightning
    (window as any).cues = []; f.events.on('scenario:cue', (c: { cue: string }) => (window as any).cues.push(c.cue));
    f.camp.intro.skip(); for (let k = 0; k < 30; k++) f.frame(0.05); // past the opening flight
    (window as any).step(2);
  });
}

test('the last one saved: they all come back to the fire and sit down', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, '/?debug&stage=12');
  await enter(page);
  await errandSetup(page);
  const r = await page.evaluate(() => {
    const f = (window as any).forest, e = f.errand, step = (window as any).step;
    const people = f.camp.gathering.people;
    step(1);
    const before = { step: e.step, away: people.every((p: any) => Math.hypot(p.h.root.position.x - p.seat.x, p.h.root.position.z - p.seat.z) > 1), ghosts: e.wraiths.filter((w: any) => w.group.visible).length };
    for (let k = 0; k < 60 && !e.returnScene.filming; k++) step(0.1);
    const film = e.returnScene.filming;
    for (let k = 0; k < 400 && e.returnScene.active; k++) step(0.1);
    const seated = people.every((p: any) => !p.act && Math.hypot(p.h.root.position.x - p.seat.x, p.h.root.position.z - p.seat.z) < 0.01);
    return { before, film, seated, cinematic: f.camp.cinematic };
  });
  expect(r).toEqual({ before: { step: 'saved', away: true, ghosts: 0 }, film: true, seated: true, cinematic: false });
  expect(errors).toEqual([]);
});

test('saving the four: the cross fills the bar near a ghost, its friend goes home; left empty the ghost kills you and it starts again', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors, '/?debug&stage=11');
  await enter(page);
  await errandSetup(page);
  const r = await page.evaluate(() => {
    const f = (window as any).forest, e = f.errand, F = e.fight, step = (window as any).step;
    step(1);
    const start = { step: e.step, targets: e.mapTargets().length, key: F.key };
    // up to the ghost behind the shop, the cross in hand: click until it is gone
    f.player.teleport(f.player.x, f.player.z + 3, f.player.yaw);
    f.inventory.equip('amulet');
    step(0.3);
    const near = { key: F.key, ring: !document.getElementById('cross-ring')!.classList.contains('hidden') };
    for (let k = 0; k < 10; k++) { F.tap(); step(0.05); }
    const some = F.fill; step(2);
    const draining = F.fill < some;
    for (let k = 0; k < 600 && !e.saved.size; k++) { F.tap(); step(0.1); }
    step(1);
    const won = { saved: [...e.saved], waiting: f.camp.gathering.byName('owner').act?.phase, goal: document.getElementById('quest-goal')!.textContent, targets: e.mapTargets().length };
    // up to another, doing nothing: it kills you, and it all starts again from when they ran for it
    const s = e.chaseScene.spot('alireza');
    f.player.teleport(s.x, s.z + 3, 0);
    for (let k = 0; k < 200 && !F.dying; k++) step(0.1);
    const dying = { dying: F.dying, cinematic: f.camp.cinematic };
    step(3);
    const over = document.getElementById('game-over')!.classList.contains('show');
    for (let k = 0; k < 200 && F.dying; k++) step(0.1);
    const again = { filming: e.chaseScene.filming, saved: e.saved.size, step: e.step, held: f.inventory.held, over: document.getElementById('game-over')!.classList.contains('show') };
    for (let k = 0; k < 800 && e.step !== 'rescue'; k++) f.frame(0.05);
    const end = { step: e.step, targets: e.mapTargets().length, caught: f.camp.gathering.people.every((p: any) => p.act?.caught), cinematic: f.camp.cinematic };
    // out of time
    const timer = !document.getElementById('quest-timer')!.classList.contains('hidden');
    F.left = 0.2; step(0.5);
    const late = F.dying;
    return { start, near, draining, won, dying, over, again, end, timer, late };
  });
  expect(r).toEqual({
    start: { step: 'rescue', targets: 4, key: null },
    near: { key: 'owner', ring: true },
    draining: true,
    won: { saved: ['owner'], waiting: 'free', goal: 'چهار رفیقت را در جنگل نجات بده (۱ از ۴)', targets: 3 },
    dying: { dying: true, cinematic: true },
    over: true,
    again: { filming: true, saved: 0, step: 'fire', held: null, over: false },
    end: { step: 'rescue', targets: 4, caught: true, cinematic: false },
    timer: true,
    late: true,
  });
  expect(errors).toEqual([]);
});

test('the errand: Amir asks, shop at Farajpour\'s by clicking, pay, the ghost in the pickle jar, up into the sky and down to the friends at the fire, the ghost creeping up on them, they line up facing it, it becomes four, they run for it and are caught', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await errandSetup(page);
  const state = () => page.evaluate(() => (window as any).forest.errand.step);
  const click = async () => { const v = page.viewportSize()!; await page.mouse.click(v.width / 2, v.height / 2); };
  expect(await state()).toBe('toAmir');
  expect(await page.textContent('#banner')).toBe('سناریوی روح سرگردان'); // its title card
  expect(await page.evaluate(() => (window as any).forest.errand.mapTarget())).not.toBeNull(); // Amir blinks on the map
  // Amir asks for the shopping
  await page.evaluate(() => { const f = (window as any).forest, a = f.camp.gathering.byName('amir'); f.player.teleport(a.seat.x + 1.2, a.seat.z + 1.4, 0); (window as any).step(0.5); });
  // he gets up and talks to the player as a film scene
  expect(await state()).toBe('amirTalks');
  expect(await page.evaluate(() => (window as any).forest.camp.cinematic)).toBe(true);
  await page.evaluate(() => (window as any).step(2.5));
  // his recording, or (without it) the caption
  const said = await page.evaluate(() => ((window as any).forest.errand.amirScene.voice ? 'voice' : document.getElementById('dialog-text')!.textContent));
  expect(said === 'voice' || said!.includes('مهمونی')).toBe(true);
  expect(await page.evaluate(() => (window as any).forest.camp.gathering.byName('amir').act?.phase)).toBe('talk');
  // (as long as his line lasts)
  await page.evaluate(() => { const e = (window as any).forest.errand; for (let k = 0; k < 120 && e.step === 'amirTalks'; k++) (window as any).step(1); });
  expect(await state()).toBe('toStore');
  // the sun goes down on the way to the shop
  await page.evaluate(() => (window as any).step(13));
  expect(await page.evaluate(() => (window as any).forest.day.hour)).toBeGreaterThan(17.5);
  // in the shop: click the four things
  await page.evaluate(() => (window as any).goTo(0.4, 0.9));
  expect(await state()).toBe('shop');
  for (const [key, lx, lz] of [['chips', 0.4, 0.9], ['puffs', 0.4, 0.9], ['yogurt', 0.77, -1.2], ['drink', 1.1, -1.25]] as const) {
    await page.evaluate(([key, lx, lz]) => { const f = (window as any).forest; (window as any).goTo(lx, lz); (window as any).lookAt(f.store.errand.items[key]); }, [key, lx, lz] as const);
    await click();
    // a hand takes it off the shelf and it goes in the basket
    expect(await page.evaluate(() => (window as any).forest.hands.busy)).toBe(true);
    expect(await page.evaluate((key) => { (window as any).step(1.5); return !(window as any).forest.store.errand.items[key].visible; }, key)).toBe(true);
  }
  expect(await state()).toBe('pay');
  // pay Farajpour
  await page.evaluate(() => { const f = (window as any).forest; (window as any).goTo(0.9, 0.1); (window as any).lookAt(f.store.errand.keeperProxy); });
  await click();
  // he talks to you as a film scene (his recording or the caption) and gives you the amulet
  expect(await state()).toBe('keeper');
  expect(await page.evaluate(() => (window as any).forest.camp.cinematic)).toBe(true);
  await page.evaluate(() => (window as any).step(1));
  const warned = await page.evaluate(() => ((window as any).forest.errand.keeperScene.voice ? 'voice' : document.getElementById('dialog-text')!.textContent));
  expect(warned === 'voice' || warned!.includes('شب نری سمت دبه')).toBe(true);
  const handed = await page.evaluate(() => {
    const e = (window as any).forest.errand;
    let held = false;
    for (let k = 0; k < 2400 && e.step === 'keeper'; k++) { (window as any).forest.frame(0.05); held ||= !!(window as any).forest.store.shopkeeper.offer; }
    return { held, step: e.step, has: e.hasAmulet };
  });
  expect(handed).toEqual({ held: true, step: 'leave', has: true });
  expect(await page.evaluate(() => (window as any).forest.inventory.items)).toEqual(['flashlight', 'chips', 'puffs', 'yogurt', 'drink', 'amulet']); // in the bag, with the shopping
  expect(await page.evaluate(() => (window as any).forest.store.errand.cash.visible)).toBe(true);
  // "shopping done", and the basket fades away
  expect(await page.textContent('#banner')).toContain('خرید انجام شد');
  await expect(page.locator('#quest-basket')).toHaveClass(/gone/);
  // outside he calls after you about the pickles; the ghost bursts out of the jar
  await page.evaluate(() => { const f = (window as any).forest; (window as any).goTo(1.0, 3.7); (window as any).step(1); (window as any).lookAt(f.store.errand.lid); });
  expect(await state()).toBe('pickles');
  await click();
  expect(await state()).toBe('ghost');
  // a film scene from the moment the lid is off: a whirlwind spins up out of the jar and gathers into the ghost beside it
  const jar = await page.evaluate(() => {
    const f = (window as any).forest, w = f.errand.wraith, mouth = f.store.errand.jarMouthWorld();
    (window as any).step(0.8);
    const rising = { cinematic: f.camp.cinematic, shown: w.group.visible, atMouth: Math.hypot(w.pose.x - mouth.x, w.pose.z - mouth.z) < 0.1, small: w.pose.grow < 0.4 };
    (window as any).step(7.7);
    return { rising, formed: w.pose.form === 1, byTheJar: Math.hypot(w.pose.x - mouth.x, w.pose.z - mouth.z) < 1 };
  });
  expect(jar).toEqual({ rising: { cinematic: true, shown: true, atMouth: true, small: true }, formed: true, byTheJar: true });
  // then the second swell: the ground shakes (the camera) and the sky turns red
  const quake = await page.evaluate(() => {
    const f = (window as any).forest, s = f.errand.jarScene, calm = { shaking: s.shaking, blood: f.day.blood };
    (window as any).step(5);
    return { calm, shaking: s.shaking > 0.9, blood: f.day.blood > 0.95 };
  });
  expect(quake).toEqual({ calm: { shaking: 0, blood: 0 }, shaking: true, blood: true });
  // it goes off into the woods, fainter the further it goes, and the sky turns back as it goes
  const going = await page.evaluate(() => {
    const f = (window as any).forest, w = f.errand.wraith, mouth = f.store.errand.jarMouthWorld();
    (window as any).step(10.5);
    return { far: Math.hypot(w.pose.x - mouth.x, w.pose.z - mouth.z) > 8, faint: w.pose.opacity < 0.8, calming: f.day.blood < 0.7, still: f.errand.jarScene.shaking };
  });
  expect(going).toEqual({ far: true, faint: true, calming: true, still: 0 });
  // in the same shot (no dip to black) the camera goes on up into the sky
  await page.evaluate(() => (window as any).step(6));
  expect(await state()).toBe('fire');
  expect(await page.evaluate(() => { const f = (window as any).forest; return { cinematic: f.camp.cinematic, blood: f.day.blood, ghost: f.errand.wraith.group.visible }; }))
    .toEqual({ cinematic: true, blood: 0, ghost: false });
  // the shopping is in the bag, the pickles too
  expect(await page.evaluate(() => (window as any).forest.inventory.items)).toEqual(expect.arrayContaining(['chips', 'puffs', 'yogurt', 'drink', 'pickles']));
  // night has fallen, in heavy rain
  expect(await page.evaluate(() => { const f = (window as any).forest; return { night: f.day.hour > 21, rain: f.weather.kind, haunted: f.errand.haunted }; }))
    .toEqual({ night: true, rain: 'heavy', haunted: true });
  // high over the trees, then down to a low shot of the four at the fire (still in their seats)
  const sky = await page.evaluate(() => {
    const f = (window as any).forest, s = f.errand.skyShot, ground = f.terrain.heightAt(f.camera.position.x, f.camera.position.z);
    (window as any).step(4);
    const high = f.camera.position.y - ground > 25;
    (window as any).step(4.1);
    const shot = s.shotPos(), atFire = f.camera.position.distanceTo(shot) < 0.5;
    const seated = f.camp.gathering.people.every((p: any) => !p.flight);
    (window as any).step(4);
    return { high, atFire, seated, step: f.errand.step, cinematic: f.camp.cinematic };
  });
  expect(sky).toEqual({ high: true, atFire: true, seated: true, step: 'fire', cinematic: true });
  // and on in the same shot: two red eyes at the cabin's corner as the sky turns red again, Amin playing;
  // it creeps up behind them (still in their seats), its recording playing, Luna staring at it; the guitar stops
  const creep = await page.evaluate(() => {
    const f = (window as any).forest, w = f.errand.wraith;
    (window as any).cues = [];
    (window as any).step(5);
    const eyes = { shown: w.group.visible, dark: w.pose.dim > 0.9, reddening: f.day.blood > 0.2 && f.day.blood < 1, guitar: f.camp.gathering.guitar };
    (window as any).step(14);
    const cues = (window as any).cues;
    const behind = {
      near: Math.hypot(w.pose.x - 0.4, w.pose.z + 17.9) < 0.2, red: f.day.blood > 0.95,
      luna: !f.camp.dog || !!f.camp.dog.alertAt, seated: f.camp.gathering.people.every((p: any) => !p.act), guitar: f.camp.gathering.guitar,
    };
    return { eyes, behind, cues };
  });
  expect(creep).toEqual({
    eyes: { shown: true, dark: true, reddening: true, guitar: 'on' },
    behind: { near: true, red: true, luna: true, seated: true, guitar: 'off' },
    cues: [], // only the guitar and the ghost's recording: nothing synthesized (no barking)
  });
  // and on: they see it, get up and line up across the fire facing it, the sky still red; then back to the player, all in their seats again
  const line = await page.evaluate(() => {
    const f = (window as any).forest, e = f.errand, w = e.wraith, people = f.camp.gathering.people;
    (window as any).step(2);
    const rising = { scene: e.lineUpScene.active, up: people.some((p: any) => p.act) };
    // quickly: all of them in the line within a few seconds
    let k = 0;
    for (; k < 100 && !people.every((p: any) => p.act?.lined); k++) (window as any).step(0.05);
    const lined = { quick: k * 0.05 < 4.5, all: people.every((p: any) => p.act?.lined), ghost: w.group.visible, red: f.day.blood > 0.95 };
    return { rising, lined };
  });
  expect(line).toEqual({ rising: { scene: true, up: true }, lined: { quick: true, all: true, ghost: true, red: true } });
  // and on: it trembles and becomes four, each opposite one of them, who still stand in the line staring at their own;
  // then they run for it, each a different way, each ghost after its own, and each is caught out there; back to the
  // player, the four left where they were caught, each with its ghost over them
  const split = await page.evaluate(() => {
    const f = (window as any).forest, e = f.errand, W = e.wraiths, people = f.camp.gathering.people;
    (window as any).step(6);
    const trembling = { scene: e.splitScene.active, one: W.filter((w: any) => w.group.visible).length, allWatchIt: new Set(people.map((p: any) => p.act?.target)).size };
    (window as any).step(3);
    let apart = true;
    for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) if (Math.hypot(W[i].pose.x - W[j].pose.x, W[i].pose.z - W[j].pose.z) < 1) apart = false;
    const four = {
      shown: W.filter((w: any) => w.group.visible).length, apart, lined: people.every((p: any) => p.act?.lined),
      ownGhost: new Set(people.map((p: any) => p.act?.target)).size, red: f.day.blood > 0.95,
    };
    for (let k = 0; k < 200 && !e.chaseScene.filming; k++) (window as any).step(0.05);
    (window as any).step(1.5);
    const run = { scene: e.chaseScene.filming, off: people.every((p: any) => p.act && 'caught' in p.act && p.act.s > 0) };
    (window as any).step(22);
    const away = people.every((p: any) => Math.hypot(p.h.root.position.x - f.FIRE.x, p.h.root.position.z - f.FIRE.z) > 6);
    return {
      trembling, four, run,
      after: { step: e.step, cinematic: f.camp.cinematic, ghosts: W.filter((w: any) => w.group.visible).length, calm: f.day.blood < 0.05, caught: people.every((p: any) => p.act?.caught), away, targets: e.mapTargets().length, goal: document.getElementById('quest-goal')?.textContent, listed: document.getElementById('quest-basket')?.childElementCount },
    };
  });
  expect(split).toEqual({
    trembling: { scene: true, one: 1, allWatchIt: 1 },
    four: { shown: 4, apart: true, lined: true, ownGhost: 4, red: true },
    run: { scene: true, off: true },
    after: { step: 'rescue', cinematic: false, ghosts: 4, calm: true, caught: true, away: true, targets: 4, goal: 'چهار رفیقت را در جنگل نجات بده (۰ از ۴)', listed: 4 },
  });
  expect(errors).toEqual([]);
});

test('the hands and the bag: a flashlight from the start, taken out it lights the way ahead, put away again', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await errandSetup(page);
  await expect(page.locator('#bag-btn')).not.toHaveClass(/hidden/);
  expect(await page.evaluate(() => { const f = (window as any).forest; f.day.cycleSeconds = 0; f.day.setHour(22.5); (window as any).step(1); return f.hands.rig.visible; })).toBe(true);
  // the bag: open it, the flashlight is in it; choose it
  await page.click('#bag-btn');
  await expect(page.locator('#bag')).not.toHaveClass(/hidden/);
  await expect(page.locator('.bag-item')).toHaveCount(1);
  expect(await page.textContent('.bag-item')).toContain('چراغ‌قوه');
  await page.click('.bag-item');
  const on = await page.evaluate(() => {
    const f = (window as any).forest;
    (window as any).step(1.5);
    // the beam: from the lens in the right hand, toward a few metres ahead of where the player looks
    const b = f.inventory.beam, dir = new f.THREE.Vector3(), to = b.target.position.clone().sub(b.position).normalize();
    f.camera.getWorldDirection(dir);
    return { held: f.inventory.held, inHand: f.hands.right.held?.visible, beam: b.intensity > 20, ahead: dir.dot(to) > 0.95, near: b.position.distanceTo(f.camera.position) < 0.8 };
  });
  expect(on).toEqual({ held: 'flashlight', inHand: true, beam: true, ahead: true, near: true });
  await expect(page.locator('#bag')).toHaveClass(/hidden/);
  // B opens the bag; choosing it again puts it away
  await page.keyboard.press('KeyB');
  await expect(page.locator('#bag')).not.toHaveClass(/hidden/);
  await expect(page.locator('.bag-item.held')).toHaveCount(1);
  await page.click('.bag-item');
  const off = await page.evaluate(() => { const f = (window as any).forest; (window as any).step(1.5); return { held: f.inventory.held, beam: f.inventory.beam.intensity < 0.5 }; });
  expect(off).toEqual({ held: null, beam: true });
  // and they can throw what they hold: it flies off and lands on the ground
  const thrown = await page.evaluate(() => {
    const f = (window as any).forest, ball = new f.THREE.Mesh(new f.THREE.SphereGeometry(0.03), new f.THREE.MeshBasicMaterial());
    f.hands.hold(ball, 'right');
    (window as any).step(0.5);
    let landed = false;
    const from = f.camera.position.clone();
    f.hands.throwHeld('right', { onLand: () => { landed = true; } });
    (window as any).step(3);
    const at = ball.getWorldPosition(new f.THREE.Vector3());
    return { landed, far: Math.hypot(at.x - from.x, at.z - from.z) > 3, onGround: Math.abs(at.y - f.terrain.heightAt(at.x, at.z)) < 0.1 };
  });
  expect(thrown).toEqual({ landed: true, far: true, onGround: true });
  expect(errors).toEqual([]);
});

test('the errand with «روح ترسناک» off: night falls but no storm; the jar scene and the shot down to the fire all the same', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await errandSetup(page);
  // switched off in the menu
  await page.evaluate(() => { const c = document.getElementById('scary-ghost') as HTMLInputElement; c.checked = false; c.dispatchEvent(new Event('change')); });
  const r = await page.evaluate(() => {
    const f = (window as any).forest, e = f.errand;
    // paid (straight to it), Farajpour's scene, out of the door, the jar
    (window as any).goTo(0.9, 0.1); e.step = 'pay'; e._pay();
    for (let k = 0; k < 2400 && e.step === 'keeper'; k++) f.frame(0.05);
    (window as any).goTo(1.0, 3.7); (window as any).step(1);
    (window as any).lookAt(f.store.errand.lid); e._openJar(); (window as any).step(1.5);
    const jar = e.wraith.group.visible;
    for (let k = 0; k < 800 && e.step === 'ghost'; k++) f.frame(0.05);
    const night = f.day.hour > 21, storm = f.weather.kind === 'heavy';
    return { haunted: e.haunted, night, storm, jar, step: e.step };
  });
  expect(r).toEqual({ haunted: false, night: true, storm: false, jar: true, step: 'fire' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rainy-forest-settings-v2')!).scaryGhost)).toBe(false);
  expect(errors).toEqual([]);
});
