import { chromium } from 'playwright';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';

const url = process.env.BABBLE_URL || 'http://127.0.0.1:3117';
const mapId = process.env.BABBLE_MAP || 'stadium';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let host;
const displayedRoomCode = () => document.querySelector('.roomInline b')?.textContent?.trim() || document.querySelector('.menuRoomCode')?.textContent?.trim() || '';
async function waitRoomCode(page) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const code = await page.evaluate(displayedRoomCode).catch(() => '');
    if (code) return code.trim();
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for displayed room code');
}
async function waitMatchPhase(page) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (/planning|resolving|finished/.test(text)) return text;
    await page.waitForTimeout(250);
  }
  throw new Error('Timed out waiting for match phase text');
}
try {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  for (const page of [host, guest]) {
    page.on('pageerror', e => errors.push(String(e)));
    page.on('crash', () => errors.push('PAGE CRASHED (renderer/GPU process died)'));
    page.on('requestfailed', r => errors.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('console', msg => {
      if (msg.type() === 'error' && !/Failed to load resource: the server responded with a status of 400/.test(msg.text())) errors.push(msg.text());
    });
  }

  await host.goto(url, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(host);
  if (await host.locator('select.mapSelect').count()) await host.locator('select.mapSelect').first().selectOption(mapId);
  await host.getByRole('button', { name: /create room/i }).click();
  const roomCode = await waitRoomCode(host);
  if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) throw new Error(`Invalid displayed room code: ${roomCode}`);

  await guest.goto(url, { waitUntil: 'domcontentloaded' });
  await waitPlayerIdentity(guest);
  await guest.getByRole('tab', { name: 'Join room' }).click();
  await guest.locator('input.codeInput').fill(roomCode);
  await guest.getByRole('button', { name: /^join room/i }).click();
  const guestCode = await waitRoomCode(guest);
  if (guestCode !== roomCode) throw new Error(`Guest joined ${guestCode}, expected ${roomCode}`);

  await host.getByRole('button', { name: /start match/i }).click();
  const hostText = await waitMatchPhase(host);
  const guestText = await waitMatchPhase(guest);
  if (!hostText.includes(roomCode) || !guestText.includes(roomCode)) throw new Error('Room code not visible after start');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  console.log(JSON.stringify({ ok: true, roomCode, mapId, hostHasCode: hostText.includes(roomCode), guestHasCode: guestText.includes(roomCode), errors }, null, 2));
} catch (err) {
  if (errors.length) console.error('[multiplayer-smoke] browser errors:\n' + errors.join('\n'));
  if (host) {
    console.error('[multiplayer-smoke] host url at failure: ' + host.url());
    const text = await host.evaluate(() => document.body?.innerText || document.documentElement?.textContent || '').catch(e => `(unreadable: ${e.message?.split('\n')[0]})`);
    console.error('[multiplayer-smoke] host page text at failure:\n' + String(text).slice(0, 600));
  }
  throw err;
} finally {
  await browser.close();
}
