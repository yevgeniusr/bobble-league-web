// Full-page screenshots of the new match UI (top HUD + corner controls),
// plus one with the settings menu open. Spawns its own production server.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';

// port outside box-control-check's dynamic 3200-3599 range to avoid stale-server collisions
const PORT = process.env.HUD_PORT || '3699';
const url = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT, NODE_ENV: 'production', ENABLE_CHEATS: 'true' } });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('pageerror:', e));
  page.on('crash', () => console.error('PAGE CRASHED (renderer/GPU process died)'));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto(`${url}?dev=1`, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(page);
  await page.locator('button', { hasText: /create room/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  // waitForSelector('.roomCodeValue', visible) can flake here (tiny inline <b>),
  // and this is only a screenshot helper — the room chip text is proof enough.
  await page.waitForFunction(() => /room\s/i.test(document.body.innerText) && /lobby|planning/.test(document.body.innerText), null, { timeout: 10000 });
  await page.locator('.formationDock button').first().waitFor({ state: 'visible', timeout: 10000 });
  const lobbyFormationOptions = await page.locator('.formationDock button').count();
  if (lobbyFormationOptions !== 7) throw new Error(`expected 7 lobby formations, saw ${lobbyFormationOptions}`);
  fs.mkdirSync('output/playwright', { recursive: true });
  await waitForStableCanvas(page);
  await page.screenshot({ path: 'output/playwright/unicup-hud-lobby.png' });
  await page.locator('button', { hasText: /start match/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  await page.waitForFunction(() => /planning/.test(document.body.innerText), null, { timeout: 10000 });
  await page.evaluate(() => (window).__babbleDev.grantBox('readPlay'));
  await page.locator('.abilityTrigger.held').waitFor({ state: 'visible', timeout: 10000 });
  if (await page.locator('.panel.error').count()) await page.locator('.panel.error').click({ force: true });
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/assets/maps/planetball-field.jpg')), null, { timeout: 10000 });
  await delay(2500);
  const desktopPixels = await waitForStableCanvas(page);
  await page.screenshot({ path: 'output/playwright/unicup-hud-desktop.png' });
  await page.locator('.menuToggle').click({ force: true });
  await delay(400);
  await waitForStableCanvas(page);
  const settingsOverflow = await page.locator('.settingsMenu').evaluate(menu => menu.scrollWidth > menu.clientWidth);
  if (settingsOverflow) throw new Error('settings menu has horizontal overflow');
  await page.screenshot({ path: 'output/playwright/unicup-hud-menu.png' });
  await page.getByRole('button', { name: /close settings/i }).click({ force: true });
  await page.waitForFunction(() => !document.querySelector('.settingsMenu'));
  await page.setViewportSize({ width: 390, height: 844 });
  await delay(1000);
  const mobilePixels = await waitForStableCanvas(page);
  await page.screenshot({ path: 'output/playwright/unicup-hud-mobile.png' });
  const layout = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    rosters: document.querySelectorAll('.teamRoster').length,
    formationOptions: document.querySelectorAll('.formationDock button').length,
    heldAbilityVisible: !!document.querySelector('.abilityTrigger.held'),
    actionPanelWidth: document.querySelector('.actionControls')?.getBoundingClientRect().width ?? 0,
    viewportWidth: window.innerWidth,
    settingsOpen: !!document.querySelector('.settingsMenu')
  }));
  if (layout.horizontalOverflow || layout.rosters !== 2 || layout.formationOptions !== 7 || !layout.heldAbilityVisible || layout.actionPanelWidth !== layout.viewportWidth || layout.settingsOpen) throw new Error(`invalid mobile HUD layout: ${JSON.stringify(layout)}`);
  for (const [viewport, pixels] of Object.entries({ desktop: desktopPixels, mobile: mobilePixels })) {
    if (pixels.opaqueRatio < 0.2 || pixels.colorBuckets < 20 || pixels.nearBlackRatio > 0.35) throw new Error(`invalid ${viewport} WebGL canvas: ${JSON.stringify(pixels)}`);
  }
  console.log(JSON.stringify({ ok: true, screenshots: ['output/playwright/unicup-hud-lobby.png', 'output/playwright/unicup-hud-desktop.png', 'output/playwright/unicup-hud-menu.png', 'output/playwright/unicup-hud-mobile.png'], lobbyFormationOptions, layout, settingsOverflow, canvasPixels: { desktop: desktopPixels, mobile: mobilePixels } }, null, 2));
  await browser.close();
} finally { server.kill('SIGTERM'); }

async function canvasPixelMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.threeField');
    const gl = canvas?.getContext('webgl2');
    if (!gl) return { opaqueRatio: 0, nearBlackRatio: 1, colorBuckets: 0 };
    gl.finish();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let opaque = 0;
    let nearBlack = 0;
    const buckets = new Set();
    for (let i = 0; i < pixels.length; i += 16) {
      if (pixels[i + 3] > 8) opaque++;
      if (pixels[i + 3] > 8 && pixels[i] < 12 && pixels[i + 1] < 12 && pixels[i + 2] < 12) nearBlack++;
      buckets.add(`${pixels[i] >> 4}:${pixels[i + 1] >> 4}:${pixels[i + 2] >> 4}:${pixels[i + 3] >> 4}`);
    }
    return { opaqueRatio: opaque / (pixels.length / 16), nearBlackRatio: nearBlack / (pixels.length / 16), colorBuckets: buckets.size };
  });
}

async function waitForStableCanvas(page) {
  let metrics;
  for (let attempt = 0; attempt < 12; attempt++) {
    metrics = await canvasPixelMetrics(page);
    if (metrics.opaqueRatio >= 0.2 && metrics.colorBuckets >= 20 && metrics.nearBlackRatio <= 0.35) return metrics;
    await delay(250);
  }
  return metrics;
}
