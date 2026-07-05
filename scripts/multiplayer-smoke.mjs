import { chromium } from 'playwright';

const url = process.env.BOBBLE_URL || 'http://127.0.0.1:3117';
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const host = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const guest = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const page of [host, guest]) {
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  }

  await host.goto(url, { waitUntil: 'domcontentloaded' });
  await host.locator('button', { hasText: /create room/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  await host.waitForSelector('.roomCodeValue', { timeout: 10000 });
  const roomCode = (await host.locator('.roomCodeValue').innerText()).trim();
  if (!/^[A-Z0-9]{4,8}$/.test(roomCode)) throw new Error(`Invalid displayed room code: ${roomCode}`);

  await guest.goto(url, { waitUntil: 'domcontentloaded' });
  await guest.locator('input.codeInput').fill(roomCode);
  await guest.locator('button', { hasText: /^join room$/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  await guest.waitForSelector('.roomCodeValue', { timeout: 10000 });
  const guestCode = (await guest.locator('.roomCodeValue').innerText()).trim();
  if (guestCode !== roomCode) throw new Error(`Guest joined ${guestCode}, expected ${roomCode}`);

  await host.locator('button', { hasText: /start match/i }).click({ force: true, timeout: 10000, noWaitAfter: true });
  await host.waitForFunction(() => /planning|resolving|finished/.test(document.body.innerText), null, { timeout: 10000 });
  await guest.waitForFunction(() => /planning|resolving|finished/.test(document.body.innerText), null, { timeout: 10000 });
  const hostText = await host.locator('body').innerText();
  const guestText = await guest.locator('body').innerText();
  if (!hostText.includes(roomCode) || !guestText.includes(roomCode)) throw new Error('Room code not visible after start');
  if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
  console.log(JSON.stringify({ ok: true, roomCode, hostHasCode: hostText.includes(roomCode), guestHasCode: guestText.includes(roomCode), errors }, null, 2));
} finally {
  await browser.close();
}
