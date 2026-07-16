// Regression gate: using a Power Play box must never block babble control.
// Real browser flow: launch a babble, place a Boost pad, launch again, apply
// Ghosted to a babble, launch again. Clicks are computed by projecting field
// coordinates through the exact render3d camera so they land on the pieces.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';
import { cameraLayoutForViewport, fieldToWorld } from '../client/src/render3d.ts';

// unique default port per run so a stale server from an old run can never be
// mistaken for the one we spawn (a stale one would miss BABBLE_TURN_MS below)
const PORT = process.env.BOXCHECK_PORT || String(3200 + (process.pid % 400));
const url = `http://127.0.0.1:${PORT}`;
const mapId = process.env.BABBLE_MAP || 'stadium';
const TURF_Y = 1.02;

function makeProjector(box) {
  const layout = cameraLayoutForViewport(box.width, box.height);
  const cam = new THREE.PerspectiveCamera(layout.fov, box.width / box.height, 0.1, 200);
  cam.position.set(layout.position.x, layout.position.y, layout.position.z);
  cam.lookAt(layout.target.x, layout.target.y, layout.target.z);
  cam.updateMatrixWorld();
  return (fx, fy, worldY = TURF_Y) => {
    const world = fieldToWorld({ x: fx, y: fy });
    const v = new THREE.Vector3(world.x, worldY, world.z);
    v.project(cam);
    return { x: box.x + (v.x + 1) / 2 * box.width, y: box.y + (1 - v.y) / 2 * box.height };
  };
}

// long turns: headless WebGL is slow enough that the scripted flow cannot fit in
// the normal 15s planning window, and a mid-flow turn resolve moves the babbles.
// ENABLE_CHEATS lets the window.__babbleDev test hook grant boxes against the
// production server build (cheat events are otherwise rejected in production).
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT, NODE_ENV: 'production', ENABLE_CHEATS: 'true', BABBLE_TURN_MS: '120000' } });
const aimedCount = async (page, label = '') => {
  const t = await page.locator('body').innerText();
  const m = t.match(/aimed (\d+)\/(\d+)/);
  const hud = t.match(/turn (\d+)\/\d+ · (\w+) · (\d+)s/);
  console.log('hud', label, hud ? `turn=${hud[1]} phase=${hud[2]} secs=${hud[3]}` : 'none', 'aimed', m?.[1] ?? '?');
  return m ? Number(m[1]) : -1;
};
const secondsRemaining = async page => {
  const label = await page.locator('.timerBadge').getAttribute('aria-label');
  return Number(label?.match(/(\d+) seconds/)?.[1] ?? -1);
};
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // opt into the developer console hook (no cheat UI exists in the app)
  await page.addInitScript(() => localStorage.setItem('babble:devtools', '1'));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(page);
  if (await page.locator('select.mapSelect').count()) await page.locator('select.mapSelect').first().selectOption(mapId);
  await page.locator('.roundTimeField input[type="range"]').fill('60');
  await page.getByRole('button', { name: /create room/i }).click();
  await page.waitForSelector('.roomInline b', { timeout: 10000 });
  await page.getByRole('button', { name: /start match/i }).click();
  await page.waitForFunction(() => /planning/.test(document.body.innerText), null, { timeout: 10000 });
  await delay(600);

  const box = await page.locator('canvas.threeField').boundingBox();
  const project = makeProjector(box);
  // default 'forward' formation, left-side babble field positions
  const babbles = [{ x: 230, y: 190 }, { x: 310, y: 270 }, { x: 310, y: 350 }, { x: 230, y: 430 }];
  const dragLaunch = async (fieldPos, pull = { x: -90, y: 60 }) => {
    const from = project(fieldPos.x, fieldPos.y);
    const to = project(fieldPos.x + pull.x, fieldPos.y + pull.y);
    const el = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? 'none', [from.x, from.y]);
    console.log('dragLaunch from', Math.round(from.x), Math.round(from.y), '->', el);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await delay(500);
  };
  const clickAbility = async (name) => {
    const button = page.getByRole('button', { name: new RegExp(`Use ${name}`, 'i') });
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
  };
  const grantAbility = async (type, label) => {
    await page.evaluate(value => window.__babbleDev.grantBox(value), type);
    await page.getByRole('button', { name: new RegExp(`Use ${label}`, 'i') }).waitFor({ state: 'visible', timeout: 10000 });
    await delay(1000);
  };

  // 0. grant the test boxes through the developer console hook
  //    (window.__babbleDev, gated by localStorage babble:devtools=1 above).
  //    Grants are spaced out to respect the server's cheat rate limit.
  await page.waitForFunction(() => typeof window.__babbleDev?.grantBox === 'function', null, { timeout: 10000 });
  // the whole sequence must land inside a single planning turn (BABBLE_TURN_MS
  // above) or the deadline resolves the turn and resets the aimed counter
  await aimedCount(page, 'preWait');
  await page.waitForFunction(() => {
    const m = document.body.innerText.match(/planning · (\d+)s/);
    return !!m && Number(m[1]) >= 45;
  }, null, { timeout: 40000 });

  // 1. baseline launch registers an intent
  await dragLaunch(babbles[0]);
  const aimedBefore = await aimedCount(page, 'before');
  await dragLaunch(babbles[0], { x: -70, y: -80 });
  const aimedAfterReaim = await aimedCount(page, 'afterReaim');

  // 2. use the placeable box (Boost)
  await grantAbility('boost', 'Boost');
  await clickAbility('Boost');
  await delay(250);
  const padA = project(560, 250), padB = project(660, 250);
  await page.mouse.move(padA.x, padA.y);
  await page.mouse.down();
  await page.mouse.move(padB.x, padB.y, { steps: 5 });
  await page.mouse.up();
  await delay(500);
  const placingHintCleared = await page.locator('.abilityTrigger.held').count() === 0;

  // 3. launching another controlled babble still works
  await dragLaunch(babbles[1]);
  const aimedAfterBoost = await aimedCount(page, 'afterBoost');

  // 4. apply the babble-target box (Ghosted) to an own babble
  await grantAbility('ghosted', 'Ghosted');
  await clickAbility('Ghosted');
  await delay(250);
  // Click the visible oversized head rather than its turf coordinate. This
  // exercises screen-space model picking used for players behind WebGL boxes.
  const ghostTarget = project(babbles[2].x, babbles[2].y, TURF_Y + 0.9);
  await page.mouse.click(ghostTarget.x, ghostTarget.y);
  await delay(500);
  const targetingCleared = await page.locator('.abilityTrigger.held').count() === 0;

  // 5. launching after the targeting flow still works
  await dragLaunch(babbles[3]);
  const aimedAfterGhost = await aimedCount(page, 'afterGhost');

  // 6. Trampoline is placeable, clears placement, and does not block controls.
  await grantAbility('ramp', 'Trampoline');
  await clickAbility('Trampoline');
  await delay(250);
  const rampA = project(500, 380), rampB = project(600, 380);
  await page.mouse.move(rampA.x, rampA.y);
  await page.mouse.down();
  await page.mouse.move(rampB.x, rampB.y, { steps: 5 });
  await page.mouse.up();
  await delay(500);
  const trampolinePlacementCleared = await page.locator('.abilityTrigger.held').count() === 0;

  // 7. Yellow Card is instant: no field/babble targeting mode should open.
  await grantAbility('yellowCard', 'Yellow Card');
  const timerBeforeYellow = await secondsRemaining(page);
  await clickAbility('Yellow Card');
  await delay(500);
  const yellowWasInstant = await page.locator('.abilityTrigger.held').count() === 0;
  const timerAfterYellow = await secondsRemaining(page);

  // 8. Red Card requires a babble click and then exits targeting mode.
  await grantAbility('redCard', 'Red Card');
  const timerBeforeRed = await secondsRemaining(page);
  await clickAbility('Red Card');
  await delay(250);
  const redTarget = project(babbles[2].x, babbles[2].y, TURF_Y + 0.9);
  await page.mouse.click(redTarget.x, redTarget.y);
  await delay(500);
  const redTargetingCleared = await page.locator('.abilityTrigger.held').count() === 0;
  const timerAfterRed = await secondsRemaining(page);

  // 9. Swap Goals is instant, resets planning and renders a fitted banner.
  await grantAbility('swapGoals', 'Swap Goals');
  const timerBeforeSwap = await secondsRemaining(page);
  await clickAbility('Swap Goals');
  await delay(500);
  const timerAfterSwap = await secondsRemaining(page);
  await page.screenshot({ path: 'output/playwright/unicup-goal-swap.png' });

  // 10. An unresolved targeting mode must disappear when planning ends.
  await grantAbility('redCard', 'Red Card');
  await clickAbility('Red Card');
  await page.locator('.readyBtn').evaluate(button => button.click());
  await page.waitForFunction(() => /resolving/i.test(document.body.innerText), null, { timeout: 10000 });
  await delay(250);
  const targetingClearedOnResolve = await page.locator('.abilityTrigger.selected').count() === 0;

  const out = {
    ok: aimedBefore >= 1 && aimedAfterReaim === aimedBefore && placingHintCleared && aimedAfterBoost > aimedAfterReaim && targetingCleared && aimedAfterGhost > aimedAfterBoost && trampolinePlacementCleared && yellowWasInstant && redTargetingCleared && timerAfterYellow >= 55 && timerAfterYellow > timerBeforeYellow && timerAfterRed >= 55 && timerAfterRed >= timerBeforeRed && timerAfterSwap >= 55 && timerAfterSwap >= timerBeforeSwap && targetingClearedOnResolve && errors.length === 0,
    mapId,
    aimedBefore, aimedAfterReaim, aimedAfterBoost, aimedAfterGhost, placingHintCleared, targetingCleared, trampolinePlacementCleared, yellowWasInstant, redTargetingCleared, timerBeforeYellow, timerAfterYellow, timerBeforeRed, timerAfterRed, timerBeforeSwap, timerAfterSwap, targetingClearedOnResolve,
    errors: errors.slice(0, 5)
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  // exitCode (not process.exit) so the finally block still reaps the server
  if (!out.ok) process.exitCode = 1;
} finally { server.kill('SIGTERM'); }
