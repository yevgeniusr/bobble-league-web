// Self-contained smoke harness: boots the production server on :3117, runs the
// betabots gameplay gate and the Playwright multiplayer smoke, then shuts down.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.SMOKE_PORT || '3117';
const url = `http://127.0.0.1:${PORT}`;

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('exit', code => (code === 0 ? resolve(0) : reject(new Error(`${args.join(' ')} exited ${code}`))));
    child.on('error', reject);
  });
}

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT, NODE_ENV: 'production' }
});
let serverExited = false;
server.on('exit', () => { serverExited = true; });

try {
  let healthy = false;
  for (let i = 0; i < 60 && !serverExited; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) { healthy = true; break; }
    } catch {}
    await delay(500);
  }
  if (!healthy) throw new Error('Server did not become healthy on ' + url);
  console.log(`[stage1-smoke] server healthy at ${url}`);
  if (!process.env.SKIP_BETABOTS) {
    await run(process.execPath, ['scripts/betabots-match.mjs'], { BABBLE_URL: url });
    console.log('[stage1-smoke] betabots gate passed');
  }
  await run(process.execPath, ['scripts/multiplayer-smoke.mjs'], { BABBLE_URL: url });
  console.log('[stage1-smoke] multiplayer smoke passed');
  if (!process.env.SKIP_RENDER_CHECK) {
    // These spawn their own servers on separate ports.
    await run(process.execPath, ['scripts/stage2-render-check.mjs']);
    console.log('[stage1-smoke] stage2 render check passed');
    await run(process.execPath, ['scripts/box-control-check.mjs']);
    console.log('[stage1-smoke] box control check passed');
  }
  console.log('[stage1-smoke] ALL SMOKES PASSED');
} finally {
  server.kill('SIGTERM');
}
