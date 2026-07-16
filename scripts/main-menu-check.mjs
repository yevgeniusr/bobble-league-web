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
  const cheatTypes = await page.evaluate(() => window.__babbleDev?.listTypes());
  if (!Array.isArray(cheatTypes) || cheatTypes.length !== 15) throw new Error('production client did not expose window.__babbleDev.listTypes()');
  await page.getByRole('heading', { level: 1, name: /^Unicup$/i }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Power plays, decoded.' }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Meet the machines.' }).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Four worlds. Four kinds of gravity.' }).waitFor({ state: 'visible' });
  if (await page.locator('.roundTimeMilestone').count() !== 12) throw new Error('round-time slider is missing five-second milestones');
  const loyaltyTrigger = page.locator('.loyaltyHomeTrigger');
  if (await loyaltyTrigger.count()) {
    await loyaltyTrigger.click();
    await page.locator('.loyaltyEmbed iframe').waitFor({ state: 'visible', timeout: 15000 });
    if (await page.locator('.loyaltyEmbed #loyalty-widget-button').count()) throw new Error('embedded loyalty rendered a second launcher');
    await page.getByRole('button', { name: 'Close rewards' }).click();
  }
  const firstPower = page.locator('.powerupCard').first();
  await firstPower.waitFor({ state: 'visible' });
  if (await firstPower.getAttribute('aria-expanded') !== 'false') throw new Error('powerup card did not start closed');
  await firstPower.click();
  if (await firstPower.getAttribute('aria-expanded') !== 'true') throw new Error('powerup card did not flip open');
  await firstPower.click();
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
  await page.locator('.roomInline').waitFor({ state: 'visible' });
  if (await page.locator('.loyaltyHomeTrigger, .loyaltyHomePanel, #loyalty-frame-container').count()) throw new Error('home-only loyalty UI leaked into the match');
  const matchLabel = (await page.locator('.matchStatus > b').textContent()) ?? '';
  if (!/moon.*first to 5/i.test(matchLabel)) throw new Error(`room did not preserve selected format/map: ${matchLabel}`);
  await page.setViewportSize({ width: 390, height: 844 });
  const visibleRosters = await page.locator('.teamRoster:visible').count();
  if (visibleRosters !== 2) throw new Error(`expected both mobile team rosters, received ${visibleRosters}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('button.menuToggle').click();
  const settingsRoundTime = page.locator('.settingsMenu input[aria-label="Round time"]');
  await settingsRoundTime.fill('42');
  const settingsRoundLabel = await page.locator('.settingsMenu label').filter({ hasText: 'Round time' }).locator(':scope > span').first().textContent();
  if (settingsRoundLabel !== '42s') throw new Error(`round-time label lagged behind slider: ${settingsRoundLabel}`);
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
    rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    archiveOverflow: [...document.querySelectorAll('.archiveBand')].some(section => section.scrollWidth > section.clientWidth + 1)
  }));
  if (shortViewport.deskTop > 548) throw new Error(`short viewport has no tournament-desk hint: ${shortViewport.deskTop}`);
  if (shortViewport.rootOverflow) throw new Error('short viewport has horizontal overflow');
  if (shortViewport.archiveOverflow) throw new Error('landing archive has horizontal overflow');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, oneClickMainMenu: true, errors }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
