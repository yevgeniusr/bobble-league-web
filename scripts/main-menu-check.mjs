import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';

const port = Number(process.env.BABBLE_PORT ?? 3119);
const base = `http://127.0.0.1:${port}`;
const server = spawn('npm', ['start'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

async function waitForHealth() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy');
}

let browser;
try {
  await waitForHealth();
  browser = await chromium.launch({ headless: true, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base, { waitUntil: 'networkidle' });
  await waitPlayerIdentity(page);
  await page.getByRole('heading', { level: 1, name: /^Unicup$/i }).waitFor({ state: 'visible' });
  const sealName = (await page.locator('.seasonSeal b').textContent())?.replace(/\s/g, '').toUpperCase();
  if (sealName !== 'UNICUP') throw new Error(`expected Unicup hero seal, received ${sealName ?? 'nothing'}`);
  await page.getByText('No hands. No weapons. All skill.', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Host match' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('textbox', { name: 'Room code' }).waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowLeft');
  await page.getByLabel('Tournament format').waitFor({ state: 'visible' });
  await page.getByLabel('Tournament format').selectOption('5');
  await page.getByLabel('Planet arena').selectOption('moon');
  await page.getByRole('slider', { name: /Music/ }).fill('0.25');
  await page.getByRole('button', { name: /create room/i }).click();
  await page.locator('.roomCodeValue').waitFor({ state: 'visible' });
  const matchLabel = (await page.locator('.matchStatus > b').textContent()) ?? '';
  if (!/moon.*champion.*first to 5/i.test(matchLabel)) throw new Error(`room did not preserve selected format/map: ${matchLabel}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const visibleRosters = await page.locator('.teamRoster:visible').count();
  if (visibleRosters !== 2) throw new Error(`expected both mobile team rosters, received ${visibleRosters}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('button.menuToggle').click();
  const menu = page.getByRole('button', { name: 'Main menu' });
  await menu.waitFor({ state: 'visible' });
  await menu.click();
  await page.getByRole('heading', { name: /create or join/i }).waitFor({ state: 'visible' });
  await page.waitForTimeout(800); // stale game-state packets must not reopen the room.
  if (!(await page.getByRole('heading', { name: /create or join/i }).isVisible())) throw new Error('main menu required a second click');
  if (await page.getByLabel('Tournament format').inputValue() !== '5') throw new Error('tournament format did not persist after leaving');
  if (await page.getByLabel('Planet arena').inputValue() !== 'moon') throw new Error('arena did not persist after leaving');
  if (await page.getByRole('slider', { name: /Music/ }).inputValue() !== '0.25') throw new Error('audio setting did not persist after leaving');
  await page.setViewportSize({ width: 320, height: 568 });
  const shortViewport = await page.evaluate(() => ({
    deskTop: document.querySelector('.tournamentDesk')?.getBoundingClientRect().top ?? Infinity,
    rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  }));
  if (shortViewport.deskTop > 548) throw new Error(`short viewport has no tournament-desk hint: ${shortViewport.deskTop}`);
  if (shortViewport.rootOverflow) throw new Error('short viewport has horizontal overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, oneClickMainMenu: true, errors }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
