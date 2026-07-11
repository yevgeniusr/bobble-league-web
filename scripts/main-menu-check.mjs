import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

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
  await page.getByRole('button', { name: /create room/i }).click();
  await page.locator('.roomCodeValue').waitFor({ state: 'visible' });
  await page.locator('button.menuToggle').click();
  const menu = page.getByRole('button', { name: 'Main menu' });
  await menu.waitFor({ state: 'visible' });
  await menu.click();
  await page.getByRole('heading', { name: /create or join/i }).waitFor({ state: 'visible' });
  await page.waitForTimeout(800); // stale game-state packets must not reopen the room.
  if (!(await page.getByRole('heading', { name: /create or join/i }).isVisible())) throw new Error('main menu required a second click');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ok: true, oneClickMainMenu: true, loyaltyCardVisible: await page.locator('.loyaltyCard').isVisible(), errors }, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
