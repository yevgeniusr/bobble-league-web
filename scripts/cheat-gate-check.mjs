// Ad-hoc gate check: production server without ENABLE_CHEATS must reject
// player:cheatBox / player:cheatBoxes and grant nothing.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const PORT = '3355';
const url = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { stdio: 'ignore', env: { ...process.env, PORT, NODE_ENV: 'production' } });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${url}/healthz`)).ok) break; } catch {} await delay(400); }
  const socket = io(url, { reconnection: false });
  const errors = [];
  let state = null;
  socket.on('room:error', e => errors.push(e));
  socket.on('game:state', s => { state = s; });
  await new Promise(r => socket.emit('room:create', { name: 'GateBot', mode: 1 }, r));
  socket.emit('player:cheatBox', { type: 'boost' });
  socket.emit('player:cheatBoxes');
  await delay(1200);
  const inv = state?.powerPlayInventories ?? { left: [], right: [] };
  const out = { rejected: errors.filter(e => /disabled/i.test(e)).length >= 2, inventoriesEmpty: inv.left.length === 0 && inv.right.length === 0, errors };
  console.log(JSON.stringify(out));
  socket.disconnect();
  if (!out.rejected || !out.inventoriesEmpty) process.exitCode = 1;
} finally { server.kill('SIGTERM'); }
