// Full-page screenshots of the new match UI (top HUD + bottom action bar),
// plus one with the settings menu open. Spawns its own production server.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

// port outside box-control-check's dynamic 3200-3599 range to avoid stale-server collisions
const PORT = process.env.HUD_PORT || '3699';
const url = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT, NODE_ENV: 'production' } });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('pageerror:', e));
  page.on('crash', () => console.error('PAGE CRASHED (renderer/GPU process died)'));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('button', { hasText: /create room/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  // waitForSelector('.roomCodeValue', visible) can flake here (tiny inline <b>),
  // and this is only a screenshot helper — the room chip text is proof enough.
  await page.waitForFunction(() => /room\s/i.test(document.body.innerText) && /lobby|planning/.test(document.body.innerText), null, { timeout: 10000 });
  await page.locator('button', { hasText: /start match/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  await page.waitForFunction(() => /planning/.test(document.body.innerText), null, { timeout: 10000 });
  await delay(2500);
  await page.screenshot({ path: 'tmp/fable-hud-match.png' });
  await page.locator('.menuToggle').click({ force: true });
  await delay(400);
  await page.screenshot({ path: 'tmp/fable-hud-menu.png' });
  console.log('saved tmp/fable-hud-match.png tmp/fable-hud-menu.png');
  await browser.close();
} finally { server.kill('SIGTERM'); }
