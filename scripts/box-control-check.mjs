// Regression gate: using a Power Play box must never block babble control.
// Real browser flow: launch a babble, place a Boost pad, launch again, apply
// Ghosted to a babble, launch again. Clicks are computed by projecting field
// coordinates through the exact render3d camera so they land on the pieces.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import * as THREE from 'three';

// unique default port per run so a stale server from an old run can never be
// mistaken for the one we spawn (a stale one would miss BABBLE_TURN_MS below)
const PORT = process.env.BOXCHECK_PORT || String(3200 + (process.pid % 400));
const url = `http://127.0.0.1:${PORT}`;
const FIELD = { width: 1100, height: 620 };
const TURF_Y = 1.02;

function makeProjector(box) {
  const cam = new THREE.PerspectiveCamera(42, box.width / box.height, 0.1, 200);
  cam.position.set(0, 16.2, 14.4);
  cam.lookAt(0, 0.4, 0);
  cam.updateMatrixWorld();
  return (fx, fy) => {
    const v = new THREE.Vector3((fx - FIELD.width / 2) / 50, TURF_Y, (fy - FIELD.height / 2) / 50);
    v.project(cam);
    return { x: box.x + (v.x + 1) / 2 * box.width, y: box.y + (1 - v.y) / 2 * box.height };
  };
}

// long turns: headless WebGL is slow enough that the scripted flow cannot fit in
// the normal 15s planning window, and a mid-flow turn resolve moves the babbles
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT, NODE_ENV: 'production', BABBLE_TURN_MS: '120000' } });
const aimedCount = async (page, label = '') => {
  const t = await page.locator('body').innerText();
  const m = t.match(/aimed (\d+)\/(\d+)/);
  const hud = t.match(/turn (\d+)\/\d+ · (\w+) · (\d+)s/);
  console.log('hud', label, hud ? `turn=${hud[1]} phase=${hud[2]} secs=${hud[3]}` : 'none', 'aimed', m?.[1] ?? '?');
  return m ? Number(m[1]) : -1;
};
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('button', { hasText: /create room/i }).click({ force: true });
  await page.waitForSelector('.roomCodeValue', { timeout: 10000 });
  await page.locator('button', { hasText: /start match/i }).click({ force: true });
  await page.waitForFunction(() => /planning/.test(document.body.innerText), null, { timeout: 10000 });
  await delay(600);

  const box = await page.locator('canvas.threeField').boundingBox();
  const project = makeProjector(box);
  // default 'forward' formation, left-side babble field positions
  const babbles = [{ x: 230, y: 190 }, { x: 310, y: 270 }, { x: 310, y: 350 }, { x: 230, y: 430 }];
  const dragLaunch = async fieldPos => {
    const from = project(fieldPos.x, fieldPos.y);
    const to = project(fieldPos.x - 90, fieldPos.y + 60);
    const el = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? 'none', [from.x, from.y]);
    console.log('dragLaunch from', Math.round(from.x), Math.round(from.y), '->', el);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    await delay(500);
  };

  // 0. grant both test boxes, then close the cheat panel so its buttons do not
  //    legitimately cover the field during the control checks
  await page.locator('button', { hasText: /cheat panel/i }).click({ force: true });
  await page.locator('.cheatPanel button', { hasText: /Boost/ }).first().click({ force: true });
  await delay(200);
  await page.locator('.cheatPanel button', { hasText: /Ghosted/ }).first().click({ force: true });
  await delay(200);
  await page.locator('button', { hasText: /close cheats/i }).click({ force: true });
  await delay(200);

  // the whole sequence must land inside a single planning turn (BABBLE_TURN_MS
  // above) or the deadline resolves the turn and resets the aimed counter
  await aimedCount(page, 'preWait');
  await page.waitForFunction(() => {
    const m = document.body.innerText.match(/planning · (\d+)s/);
    return !!m && Number(m[1]) >= 60;
  }, null, { timeout: 40000 });

  // 1. baseline launch registers an intent
  await dragLaunch(babbles[0]);
  const aimedBefore = await aimedCount(page, 'before');

  // 2. use the placeable box (Boost)
  await page.locator('.inventory:not(.cheatPanel) button', { hasText: /Boost/ }).first().click({ force: true });
  await delay(250);
  const padA = project(560, 250), padB = project(660, 250);
  await page.mouse.move(padA.x, padA.y);
  await page.mouse.down();
  await page.mouse.move(padB.x, padB.y, { steps: 5 });
  await page.mouse.up();
  await delay(500);
  const placingHintCleared = !/Placing Boost/.test(await page.locator('body').innerText());

  // 3. launching another controlled babble still works
  await dragLaunch(babbles[1]);
  const aimedAfterBoost = await aimedCount(page, 'afterBoost');

  // 4. apply the babble-target box (Ghosted) to an own babble
  await page.locator('.inventory:not(.cheatPanel) button', { hasText: /Ghosted/ }).first().click({ force: true });
  await delay(250);
  const ghostTarget = project(babbles[2].x, babbles[2].y);
  await page.mouse.click(ghostTarget.x, ghostTarget.y);
  await delay(500);
  const targetingCleared = !/Targeting Ghosted/.test(await page.locator('body').innerText());

  // 5. launching after the targeting flow still works
  await dragLaunch(babbles[3]);
  const aimedAfterGhost = await aimedCount(page, 'afterGhost');

  const out = {
    ok: aimedBefore >= 1 && placingHintCleared && aimedAfterBoost > aimedBefore && targetingCleared && aimedAfterGhost > aimedAfterBoost && errors.length === 0,
    aimedBefore, aimedAfterBoost, aimedAfterGhost, placingHintCleared, targetingCleared,
    errors: errors.slice(0, 5)
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  // exitCode (not process.exit) so the finally block still reaps the server
  if (!out.ok) process.exitCode = 1;
} finally { server.kill('SIGTERM'); }
