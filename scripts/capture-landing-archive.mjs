import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import fs from 'node:fs';
import { waitPlayerIdentity } from './browser-smoke-helpers.mjs';

const PORT = process.env.ARCHIVE_PORT || '3708';
const url = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PORT, NODE_ENV: 'production' } });

try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(url, { waitUntil: 'networkidle' });
  await waitPlayerIdentity(page);
  fs.mkdirSync('output/playwright', { recursive: true });

  const sections = [
    ['powerups', 'unicup-archive-powerups-desktop.png'],
    ['teams', 'unicup-archive-teams-desktop.png'],
    ['maps', 'unicup-archive-maps-desktop.png']
  ];
  for (const [id, filename] of sections) await page.locator(`#${id}`).screenshot({ path: `output/playwright/${filename}` });

  const firstCard = page.locator('.powerupCard').first();
  await firstCard.click();
  await page.waitForTimeout(450);
  await firstCard.screenshot({ path: 'output/playwright/unicup-archive-powerup-open.png' });

  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('#powerups').scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'output/playwright/unicup-archive-mobile.png' });
  const layout = await page.evaluate(() => ({
    viewport: window.innerWidth,
    rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    sectionOverflow: [...document.querySelectorAll('.archiveBand')].some(section => section.scrollWidth > section.clientWidth + 1),
    powerCards: document.querySelectorAll('.powerupCard').length,
    teamDossiers: document.querySelectorAll('.teamDossier').length,
    mapDossiers: document.querySelectorAll('.mapDossier').length,
    minCardWidth: Math.min(...[...document.querySelectorAll('.powerupCard')].map(card => card.getBoundingClientRect().width))
  }));
  if (layout.rootOverflow || layout.sectionOverflow || layout.powerCards !== 15 || layout.teamDossiers !== 4 || layout.mapDossiers !== 4 || layout.minCardWidth < 260) {
    throw new Error(`invalid archive layout: ${JSON.stringify(layout)}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, layout, errors }, null, 2));
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
