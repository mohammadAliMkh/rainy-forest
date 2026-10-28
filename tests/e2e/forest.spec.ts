import { test, expect, type Page } from '@playwright/test';

// The main things a visitor does, checked through the game's debug handle
// (window.forest, available with ?debug). Each test starts a fresh page.

// inside page.evaluate the game is reached as `(window as any).forest` (untyped on purpose)

async function open(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/?debug');
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
  expect(stats.lights).toBe(7);
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

test('scenario 1: the button near the camp, the ghost, everyone runs and comes back to their seats', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  // past the opening flight; offered near the camp once the introductions (and the errand) are over
  const offered = await page.evaluate(() => {
    const f = (window as any).forest, c = f.camp;
    c.intro.skip();
    for (let k = 0; k < 30; k++) f.frame(0.05);
    f.errand.step = 'done';
    f.player.teleport(1.5, -8, 0);
    for (let k = 0; k < 5; k++) f.frame(0.05);
    return {
      button: !document.getElementById('scenario-btn')!.classList.contains('hidden'),
      intro: c.intro.active, cinematic: c.cinematic, scenarioDone: c.scenario.done, errand: f.errand.step, menu: f.session.menuOpen(),
    };
  });
  expect(offered.button, JSON.stringify(offered)).toBe(true);
  const r = await page.evaluate(() => {
    const f = (window as any).forest, g = f.camp.gathering, s = f.camp.scenario;
    // step the game without drawing (software rendering is slow)
    for (const name of ['render', 'environment map']) { const sys = f.game.systems.find((x: { name: string }) => x.name === name); sys.update = () => {}; }
    const cues: string[] = [];
    f.events.on('scenario:cue', (c: { cue: string }) => cues.push(c.cue));
    const seats = g.people.map((p: any) => [p.h.root.position.x, p.h.root.position.y, p.h.root.position.z]);
    document.getElementById('scenario-btn')!.click();
    let ranOff = 0, maxAway = 0, cinematic = false;
    for (let k = 0; k < 1000 && (s.active || k < 5); k++) {
      f.frame(0.05);
      cinematic ||= f.camp.cinematic;
      g.people.forEach((p: any, i: number) => {
        const d = Math.hypot(p.h.root.position.x - seats[i][0], p.h.root.position.z - seats[i][2]);
        maxAway = Math.max(maxAway, d);
        if (p.flight?.hiding) ranOff |= 1 << i;
      });
    }
    f.frame(0.05);
    const back = g.people.every((p: any, i: number) => Math.hypot(p.h.root.position.x - seats[i][0], p.h.root.position.y - seats[i][1], p.h.root.position.z - seats[i][2]) < 0.01 && !p.flight);
    return { cues, ranOff, maxAway, cinematic, back, active: s.active, ghost: s.ghost.group.visible, done: s.done, cinemaNow: f.camp.cinematic };
  });
  expect(r.cinematic).toBe(true);
  for (const c of ['sneak', 'sneakStop', 'boo', 'giggle', 'eek', 'vanish']) expect(r.cues).toContain(c);
  expect(r.cues.filter((c) => c === 'scream')).toHaveLength(4);
  expect(r.ranOff).toBe(0b1111); // all four reached their hiding places
  expect(r.maxAway).toBeGreaterThan(4);
  expect(r.back).toBe(true); // and sat down exactly where they were
  expect(r.active).toBe(false);
  expect(r.ghost).toBe(false);
  expect(r.cinemaNow).toBe(false);
  // played: the button doesn't come back, until it is offered again from the menu
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.getElementById('scenario-btn')!.classList.contains('hidden'))).toBe(true);
  await page.evaluate(() => document.getElementById('replay-scenario-btn')!.click());
  await page.waitForFunction(() => !document.getElementById('scenario-btn')!.classList.contains('hidden'), null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});

// the errand tests: step the game without drawing; helpers to look at things,
// to walk to a spot by the shop, and to walk home along the trail
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
    // the way home: the shop's path, then the trail to the fire; walking pace, looking ahead, a step every half second
    (window as any).walkHome = (until: () => boolean, maxSec = 90) => {
      const t = f.terrain, end = t.storePath[t.storePath.length - 1];
      let best = 0;
      t.pathLine.forEach(([x, z]: number[], i: number) => { if (Math.hypot(x - end[0], z - end[1]) < Math.hypot(t.pathLine[best][0] - end[0], t.pathLine[best][1] - end[1])) best = i; });
      // ...up to the fire, then over to beside Amir
      const a = f.camp.gathering.byName('amir');
      const route = [...t.storePath, ...t.pathLine.slice(best + 1)].filter(([x, z]: number[]) => Math.hypot(x - f.FIRE.x, z - f.FIRE.z) > 4);
      route.push([a.seat.x + 2.0, a.seat.z + 2.6]);
      f.player.teleport(route[0][0], route[0][1]);
      let wp = 0;
      for (let i = 0; i < maxSec * 20 && !until(); i++) {
        while (wp < route.length - 1 && Math.hypot(route[wp][0] - f.player.x, route[wp][1] - f.player.z) < 0.5) wp++;
        const dx = route[wp][0] - f.player.x, dz = route[wp][1] - f.player.z, d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const k = Math.min(1, 0.07 / d);
          f.player.teleport(f.player.x + dx * k, f.player.z + dz * k, Math.atan2(-dx, -dz));
        }
        if (i % 10 === 0) f.events.emit('player:step', { running: false, surface: 'mud', side: 1, speed: 1.4 });
        f.frame(0.05);
      }
    };
    // what made a sound, and the lightning
    (window as any).cues = []; f.events.on('scenario:cue', (c: { cue: string }) => (window as any).cues.push(c.cue));
    (window as any).flashes = 0; f.events.on('weather:lightning', () => (window as any).flashes++);
    f.camp.intro.skip(); for (let k = 0; k < 30; k++) f.frame(0.05); // past the opening flight
    (window as any).step(2);
  });
}

test('the errand: Amir asks, shop at Farajpour\'s by clicking, pay, the ghost in the pickle jar, the haunted walk back, deliver, the twist', async ({ page }) => {
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
  expect(await page.textContent('#dialog-text')).toContain('مهمونی');
  expect(await page.evaluate(() => (window as any).forest.camp.gathering.byName('amir').act?.phase)).toBe('talk');
  await page.evaluate(() => (window as any).step(14));
  expect(await state()).toBe('toStore');
  // in the shop: click the four things
  await page.evaluate(() => (window as any).goTo(0.4, 0.9));
  expect(await state()).toBe('shop');
  for (const [key, lx, lz] of [['chips', 0.4, 0.9], ['puffs', 0.4, 0.9], ['yogurt', 0.77, -1.2], ['drink', 1.1, -1.25]] as const) {
    await page.evaluate(([key, lx, lz]) => { const f = (window as any).forest; (window as any).goTo(lx, lz); (window as any).lookAt(f.store.errand.items[key]); }, [key, lx, lz] as const);
    await click();
    expect(await page.evaluate((key) => !(window as any).forest.store.errand.items[key].visible, key)).toBe(true);
  }
  expect(await state()).toBe('pay');
  // pay Farajpour
  await page.evaluate(() => { const f = (window as any).forest; (window as any).goTo(0.9, 0.1); (window as any).lookAt(f.store.errand.keeperProxy); });
  const hourBefore = await page.evaluate(() => (window as any).forest.day.hour);
  await click();
  expect(await state()).toBe('leave');
  expect(await page.textContent('#dialog-text')).toContain('شب نری سمت دبه'); // Farajpour's warning
  expect(await page.evaluate(() => (window as any).forest.store.errand.cash.visible)).toBe(true);
  // "shopping done", and the basket fades away
  expect(await page.textContent('#banner')).toContain('خرید انجام شد');
  await expect(page.locator('#quest-basket')).toHaveClass(/gone/);
  // outside he calls after you about the pickles; the ghost bursts out of the jar
  await page.evaluate(() => { const f = (window as any).forest; (window as any).goTo(1.0, 3.7); (window as any).step(1); (window as any).lookAt(f.store.errand.lid); });
  expect(await state()).toBe('pickles');
  expect(await page.textContent('#dialog-text')).toContain('خیارشور');
  await click();
  expect(await state()).toBe('ghost');
  expect(await page.evaluate(() => { (window as any).step(1); return (window as any).forest.errand.jarGhost.group.visible; })).toBe(true);
  expect(await page.evaluate(() => (window as any).forest.errand.jarGhost.style)).toBe('scary');
  await page.evaluate(() => (window as any).step(5));
  expect(await state()).toBe('deliver');
  // night has fallen, in heavy rain
  expect(await page.evaluate(() => { const f = (window as any).forest; return { night: f.day.hour > 21, rain: f.weather.kind, haunted: f.errand.haunted }; }))
    .toEqual({ night: true, rain: 'heavy', haunted: true });
  // the walk back: eyes, steps behind, three lightning reveals in order, the whisper, Luna barks; then the scene at the fire
  const walk = await page.evaluate(() => {
    const f = (window as any).forest, w = f.errand.nightWalk;
    let seenGhost = 0;
    const flashes0 = (window as any).flashes;
    (window as any).walkHome(() => { if (f.errand.jarGhost.group.visible) seenGhost++; return f.errand.step === 'scene'; });
    return { fired: [...w.fired], flashes: (window as any).flashes - flashes0, seenGhost: seenGhost > 0, barked: (window as any).cues.includes('bark'), echoes: (window as any).cues.includes('echoStep'), step: f.errand.step };
  });
  expect(walk.fired.filter((b: string) => b.startsWith('reveal'))).toEqual(['reveal1', 'reveal2', 'reveal3']);
  expect(walk.fired).toEqual(expect.arrayContaining(['eyes', 'steps', 'whisper', 'luna']));
  expect(walk).toMatchObject({ flashes: 3, seenGhost: true, barked: true, echoes: true, step: 'scene' });
  // scenario 1 at night with the scary ghost; once they have all fled the player has control while they come back
  const end = await page.evaluate(() => {
    const f = (window as any).forest;
    const started = f.errand.step === 'scene' && f.camp.cinematic && f.camp.scenario.ghost.style === 'scary';
    let handedBack = false;
    for (let k = 0; k < 900 && f.camp.scenario.active; k++) {
      f.frame(0.05);
      if (!handedBack && f.camp.scenario.active && !f.camp.cinematic) handedBack = f.player.active && f.camp.gathering.people.some((p: any) => p.flight);
    }
    (window as any).step(0.5);
    return { started, handedBack, step: f.errand.step, seated: f.camp.gathering.people.every((p: any) => !p.flight) };
  });
  expect(end).toEqual({ started: true, handedBack: true, step: 'done', seated: true });
  expect(await page.textContent('#banner')).toBe('پایان سناریوی روح سرگردان');
  // ...or maybe not: the ghost at the fire with a glass of tea
  const twist = await page.evaluate(() => {
    const f = (window as any).forest, g = f.errand.jarGhost;
    (window as any).step(6.5);
    return { filming: f.errand.twist.filming, cinematic: f.camp.cinematic, visible: g.group.visible, nearFire: Math.hypot(g.pose.x - f.FIRE.x, g.pose.z - f.FIRE.z) < 2.5 };
  });
  expect(twist).toEqual({ filming: true, cinematic: true, visible: true, nearFire: true });
  expect(await page.textContent('#banner')).toBe('...یا شاید هم نه 👻');
  // then the view is the player's again and the night lifts
  const after = await page.evaluate(() => { const f = (window as any).forest; (window as any).step(16); return { cinematic: f.camp.cinematic, hour: f.day.hour, night: f.errand.nightfall.active, lantern: f.lighting.lanternMax }; });
  expect(after).toMatchObject({ cinematic: false, night: false, lantern: 5.5 });
  expect(Math.abs(after.hour - hourBefore)).toBeLessThan(0.3);
  expect(errors).toEqual([]);
});

test('the errand with «روح ترسناک» off: daylight stays, no scares on the way back, the funny ghost', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await errandSetup(page);
  // switched off in the menu
  await page.evaluate(() => { const c = document.getElementById('scary-ghost') as HTMLInputElement; c.checked = false; c.dispatchEvent(new Event('change')); });
  const r = await page.evaluate(() => {
    const f = (window as any).forest, e = f.errand;
    const hour = f.day.hour;
    // paid (straight to it), out of the door, the jar
    (window as any).goTo(0.9, 0.1); e.step = 'pay'; e._pay();
    (window as any).goTo(1.0, 3.7); (window as any).step(1);
    (window as any).lookAt(f.store.errand.lid); e._openJar(); (window as any).step(0.8);
    const face = e.jarGhost.pose.face, style = e.jarGhost.style;
    (window as any).step(5);
    (window as any).walkHome(() => e.step === 'scene');
    return { haunted: e.haunted, dayStays: Math.abs(f.day.hour - hour) < 0.5, face, style, fired: e.nightWalk.fired.size, step: e.step, scenarioGhost: f.camp.scenario.ghost.style };
  });
  expect(r).toEqual({ haunted: false, dayStays: true, face: 'boo', style: 'funny', fired: 0, step: 'scene', scenarioGhost: 'funny' });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rainy-forest-settings-v2')!).scaryGhost)).toBe(false);
  expect(errors).toEqual([]);
});
