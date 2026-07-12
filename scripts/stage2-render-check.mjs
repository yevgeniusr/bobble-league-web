// Ad-hoc Stage 2 render sanity: real browser, start match, let the rAF pump run,
// perform a drag-launch on the canvas, assert no console/page errors and no 3D fallback.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';

const PORT = process.env.STAGE2_PORT || String(12000 + (process.pid % 1000));
const url = `http://127.0.0.1:${PORT}`;
const mapId = process.env.BABBLE_MAP || 'stadium';
const displayedRoomCode = () => document.querySelector('.roomCodeValue')?.textContent?.trim() || document.querySelector('.menuRoomCode')?.textContent?.trim() || '';
async function waitRoomCode(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const code = await page.evaluate(displayedRoomCode).catch(() => '');
    if (code) return code.trim();
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for displayed room code');
}
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: 'ignore', env: { ...process.env, PORT, NODE_ENV: 'production' } });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 400/.test(m.text())) errors.push('console: ' + m.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(page);
  if (await page.locator('select.mapSelect').count()) await page.locator('select.mapSelect').first().selectOption(mapId);
  await page.getByRole('button', { name: /create room/i }).click();
  await waitRoomCode(page);
  await page.getByRole('button', { name: /start match/i }).click();
  await page.waitForFunction(() => /planning/.test(document.body.innerText), null, { timeout: 10000 });
  await delay(4000); // let the rAF animation pump run
  const fallback = await page.locator('.renderFallback').count();
  // drag-launch on the canvas (roughly over the left formation)
  const box = await page.locator('canvas.threeField').boundingBox();
  await page.mouse.move(box.x + box.width * 0.33, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await delay(1500);
  const hudText = await page.locator('body').innerText();
  const out = { ok: fallback === 0 && errors.length === 0, mapId, fallback, errors: errors.slice(0, 5), hasControlsHint: /drag back to aim/i.test(hudText) };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!out.ok) process.exitCode = 1;
} finally { server.kill('SIGTERM'); }
