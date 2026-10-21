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

test('entering: the start screen closes at once, the scene is complete, the map shows', async ({ page }) => {
  const errors: string[] = [];
  await open(page, errors);
  expect(await enter(page)).toBe(true);
  await page.waitForTimeout(1000);
  const stats = await page.evaluate(() => {
    let meshes = 0, lights = 0;
    (window as any).forest.scene.traverse((o: { isMesh?: boolean; isLight?: boolean }) => { if (o.isMesh) meshes++; if (o.isLight) lights++; });
    return { meshes, lights, map: !document.querySelector('.minimap')!.classList.contains('hidden') };
  });
  expect(stats.meshes).toBeGreaterThan(400);
  expect(stats.lights).toBe(6);
  expect(stats.map).toBe(true);
  expect(errors).toEqual([]);
});

test('introductions: start at the fire, Esc skips them, then Esc opens and Continue closes the menu', async ({ page }) => {
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

test('phone: touch controls show, the gear opens the menu', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors: string[] = [];
  await open(page, errors);
  await enter(page);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => !document.getElementById('touch-ui')!.classList.contains('hidden'))).toBe(true);
  await page.evaluate(() => document.getElementById('menu-btn')!.click());
  await expect.poll(() => page.evaluate(() => !document.getElementById('pause')!.classList.contains('hidden'))).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});
