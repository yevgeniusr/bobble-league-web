// Browser contract for Blindness: the caster keeps their view, the opposing
// player receives the intentional blackout, and the veil clears next turn.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';

const PORT = process.env.BLINDNESS_PORT || String(3600 + (process.pid % 300));
const url = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, PORT, NODE_ENV: 'production', ENABLE_CHEATS: 'true', BABBLE_TURN_MS: '60000' }
});

async function waitForHealth() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${url}/healthz`)).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Blindness test server did not become healthy');
}

let browser;
try {
  await waitForHealth();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const errors = [];

  for (const page of [host, guest]) {
    page.on('pageerror', error => errors.push(`pageerror: ${error}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  }
  await host.addInitScript(() => localStorage.setItem('babble:devtools', '1'));

  await host.goto(url, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(host);
  await host.getByRole('button', { name: /create room/i }).click();
  const roomCode = (await host.locator('.roomInline b').textContent({ timeout: 10000 }))?.trim();
  if (!roomCode) throw new Error('Host room code was not rendered');

  await guest.goto(url, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(guest);
  await guest.getByRole('tab', { name: 'Join room' }).click();
  await guest.locator('input.codeInput').fill(roomCode);
  await guest.getByRole('button', { name: /^join room/i }).click();
  await guest.locator('.roomInline b').waitFor({ state: 'visible', timeout: 10000 });

  await host.getByRole('button', { name: /start match/i }).click();
  await host.locator('.readyBtn').waitFor({ state: 'visible', timeout: 10000 });
  await guest.locator('.readyBtn').waitFor({ state: 'visible', timeout: 10000 });
  await host.waitForFunction(() => typeof window.__babbleDev?.grantBox === 'function', null, { timeout: 10000 });
  await host.evaluate(() => window.__babbleDev.grantBox('blindness'));
  await host.getByRole('button', { name: /Use Blindness/i }).click();

  const veil = guest.locator('.blindnessVeil');
  await veil.waitFor({ state: 'visible', timeout: 10000 });
  const guestWarning = (await veil.innerText()).replace(/\s+/g, ' ').trim();
  const hostStayedVisible = await host.locator('.blindnessVeil').count() === 0;
  const guestBlack = await veil.evaluate(element => getComputedStyle(element).backgroundColor === 'rgb(0, 0, 0)');

  await host.locator('.readyBtn').click();
  await guest.locator('.readyBtn').click();
  await guest.waitForFunction(() => /turn 2\//i.test(document.body.innerText), null, { timeout: 20000 });
  await veil.waitFor({ state: 'detached', timeout: 10000 });

  const result = {
    ok: hostStayedVisible && guestBlack && /intentionally hidden until this turn ends/i.test(guestWarning) && errors.length === 0,
    roomCode,
    hostStayedVisible,
    guestBlack,
    clearedNextTurn: true,
    guestWarning,
    errors
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
