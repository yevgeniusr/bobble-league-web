import compression from 'compression';
import express from 'express';
import fs from 'node:fs';
import helmet from 'helmet';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { buildGamePlayerEvent, drainAnalyticsEvents, GamePlayerLifecycle } from '../shared/analytics';
import { addCheatBoxes, addPlayer, applyFormation, blankInput, createInitialState, findDisconnectedSeat, grantCheatBox, launchBabble, reclaimPlayer, redactStateFor, removePlayer, resetGame, rotateFieldObject, setFieldObjectAngle, setMap, setPlayerReady, setSideTeam, startGame, stepGame, usePowerPlay } from '../shared/game';
import { freePhysics } from '../shared/physics';
import { BOX_TYPES, ClientToServerEvents, FORMATION_IDS, GAME_MODES, GameMode, GameState, MAP_IDS, MapId, ServerToClientEvents, TEAM_IDS, TeamId, normalizeBoxType } from '../shared/types';
import { createXtremepushSender } from './xtremepush';
import { createLoyaltyService } from './loyalty';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv();
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
const xtremepush = createXtremepushSender({
  appToken: process.env.XTREMEPUSH_APP_TOKEN,
  apiBase: process.env.XTREMEPUSH_API_BASE
});
const xtremepushSdkKey = process.env.XTREMEPUSH_SDK_KEY?.trim() ?? '';
const publicHostname = (process.env.PUBLIC_HOSTNAME ?? 'bobble.rachkovan.com').trim().toLowerCase();
const allowLocalXtremepush = process.env.XTREMEPUSH_ALLOW_LOCAL === 'true';
const loyalty = createLoyaltyService({
  sdkKey: xtremepushSdkKey,
  endpoint: process.env.XTREMEPUSH_LOYALTY_ENDPOINT,
  privateKey: process.env.XTREMEPUSH_LOYALTY_PRIVATE_KEY || readLocalKey('private.key'),
  publicKey: process.env.XTREMEPUSH_LOYALTY_PUBLIC_KEY || readLocalKey('public.key'),
  keyId: process.env.XTREMEPUSH_LOYALTY_KEY_ID,
  tokenTtlSeconds: Number(process.env.XTREMEPUSH_LOYALTY_TOKEN_TTL ?? 300)
});
const loyaltyTokenSchema = z.object({ nickname: z.string().trim().min(1).max(18) }).strict();
const loyaltyRate = new Map<string, { count: number; resetAt: number }>();
// Dev/test cheat hooks (window.__babbleDev on the client) are rejected in
// production unless the deployment explicitly opts in with ENABLE_CHEATS=true.
const cheatsEnabled = !isProd || process.env.ENABLE_CHEATS === 'true';
// Light rate limiting so the cheat hooks cannot spam rooms even where enabled.
const CHEAT_BOX_COOLDOWN_MS = 800;
const CHEAT_ALL_COOLDOWN_MS = 5000;

type InterServerEvents = Record<string, never>;
type SocketData = { roomCode?: string; playerId?: string; lastCheatAt?: number; lastCheatAllAt?: number };
type IOServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type IOSocket = Parameters<Parameters<IOServer['on']>[1]>[0];

type Room = { state: GameState; inputs: Record<string, typeof blankInput>; lastActiveAt: number };
const rooms = new Map<string, Room>();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      // Xtremepush's current vendor SDK evaluates its generated command
      // dispatcher at runtime; keep eval scoped to scripts and every network
      // origin separately allowlisted below.
      scriptSrc: ["'self'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'https://api.xtremepush.com'],
      frameSrc: loyalty.endpoint ? [`https://${loyalty.endpoint}`] : ["'none'"],
      workerSrc: ["'self'", 'blob:'],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(compression());
app.use(express.json());
app.get('/healthz', (_, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));
app.get('/api/config', (req, res) => {
  res.setHeader('cache-control', 'no-store');
  const browserIntegrationEnabled = allowLocalXtremepush || req.hostname.toLowerCase() === publicHostname;
  return res.json({
  xtremepushBackend: xtremepush.enabled,
  xtremepushSdkKey: browserIntegrationEnabled ? xtremepushSdkKey || null : null,
  loyaltyEnabled: browserIntegrationEnabled && loyalty.enabled,
  loyaltyEndpoint: browserIntegrationEnabled && loyalty.enabled ? loyalty.endpoint : null
  });
});
if (process.env.ENABLE_ANALYTICS_DEBUG === 'true') {
  app.get('/api/analytics/debug', (_, res) => res.json({ xtremepush: xtremepush.debugSnapshot() }));
} else {
  app.get('/api/analytics/debug', (_, res) => res.status(404).json({ error: 'Not found.' }));
}
app.get('/api/xtremepush/sdk.js', async (_, res) => {
  res.type('application/javascript');
  if (!xtremepushSdkKey) return res.status(204).send('');
  try {
    const upstream = await fetch(`https://cdn.webpu.sh/${encodeURIComponent(xtremepushSdkKey)}/sdk.js`, {
      signal: AbortSignal.timeout(10_000)
    });
    if (!upstream.ok) throw new Error('Xtremepush SDK unavailable');
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!/(?:java|ecma)script/i.test(contentType)) throw new Error('Unexpected Xtremepush SDK content type');
    const body = await upstream.arrayBuffer();
    if (body.byteLength > 2_000_000) throw new Error('Xtremepush SDK too large');
    res.setHeader('cache-control', 'public, max-age=300');
    return res.send(Buffer.from(body));
  } catch {
    res.setHeader('cache-control', 'no-store');
    return res.status(502).send('// Xtremepush SDK temporarily unavailable.');
  }
});
app.post('/api/loyalty/token', (req, res) => {
  res.setHeader('cache-control', 'no-store');
  if (!loyalty.enabled) return res.status(503).json({ error: 'Loyalty is not configured.' });
  const parsed = loyaltyTokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a nickname first.' });
  const now = Date.now();
  if (loyaltyRate.size > 5_000) {
    for (const [key, value] of loyaltyRate) if (value.resetAt <= now) loyaltyRate.delete(key);
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rate = loyaltyRate.get(ip);
  if (!rate || rate.resetAt <= now) loyaltyRate.set(ip, { count: 1, resetAt: now + 60_000 });
  else if (++rate.count > 30) return res.status(429).json({ error: 'Too many loyalty sessions.' });
  try {
    const guest = loyalty.guestSession(readCookie(req.headers.cookie, 'babble_loyalty_guest'));
    if (!guest) return res.status(503).json({ error: 'Loyalty is not configured.' });
    if (guest.created) {
      res.cookie('babble_loyalty_guest', guest.cookie, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000,
        path: '/'
      });
    }
    const issued = loyalty.issueToken(parsed.data.nickname, guest.id);
    if (!issued) return res.status(503).json({ error: 'Loyalty is not configured.' });
    return res.json(issued);
  } catch {
    return res.status(500).json({ error: 'Could not create loyalty session.' });
  }
});

if (isProd) {
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.get(/.*/, (_, res) => res.sendFile(path.join(clientDir, 'index.html')));
}

const httpServer = createServer(app);
const io: IOServer = new Server(httpServer, { cors: { origin: true, credentials: false } });

const createSchema = z.object({
  name: z.string().max(24),
  team: z.enum(TEAM_IDS as [string, ...string[]]).optional(),
  mode: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  mapId: z.enum(MAP_IDS as [string, ...string[]]).optional()
});
const joinSchema = z.object({ roomCode: z.string().min(3).max(8), name: z.string().max(24), team: z.enum(TEAM_IDS as [string, ...string[]]).optional() });
const finiteVecSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const powerPlaySchema = z.object({
  type: z.string().min(1).max(40),
  targetBabbleId: z.string().min(1).max(80).optional(),
  position: finiteVecSchema.optional(),
  angle: z.number().finite().optional()
}).strict();

io.on('connection', socket => {
  socket.on('room:create', (payload, cb) => {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return cb({ ok: false, error: 'Invalid room settings.' });
    const roomCode = uniqueRoomCode();
    const state = createInitialState(roomCode, parsed.data.mode as GameMode, parsed.data.mapId as MapId | undefined);
    const room: Room = { state, inputs: {}, lastActiveAt: Date.now() };
    rooms.set(roomCode, room);
    joinRoom(socket, room, parsed.data.name, parsed.data.team as TeamId | undefined);
    emitGamePlayer(socket, room, 'room_created');
    cb({ ok: true, roomCode, playerId: socket.id });
  });

  socket.on('room:join', (payload, cb) => {
    const parsed = joinSchema.safeParse({ ...payload, roomCode: payload.roomCode?.toUpperCase?.() });
    if (!parsed.success) return cb({ ok: false, error: 'Invalid join form.' });
    const room = rooms.get(parsed.data.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (Object.values(room.state.players).filter(p => p.connected).length >= 8) return cb({ ok: false, error: 'Room is full.' });
    const join = joinRoom(socket, room, parsed.data.name, parsed.data.team as TeamId | undefined);
    emitGamePlayer(socket, room, join.reclaimed ? 'player_reconnected' : 'room_joined');
    cb({ ok: true, roomCode: parsed.data.roomCode, playerId: socket.id });
  });

  socket.on('player:input', input => {
    const room = currentRoom(socket); if (!room) return;
    room.inputs[socket.id] = { ...blankInput, ...input };
    room.lastActiveAt = Date.now();
  });

  socket.on('player:launch', intent => {
    const room = currentRoom(socket); if (!room) return;
    if (!launchBabble(room.state, socket.id, intent)) socket.emit('room:error', 'That babblehead cannot be launched right now.');
    room.lastActiveAt = Date.now();
  });

  socket.on('player:power', use => {
    const room = currentRoom(socket); if (!room) return;
    const parsed = powerPlaySchema.safeParse(use);
    if (!parsed.success) return socket.emit('room:error', 'Invalid Power Play payload.');
    const type = normalizeBoxType(parsed.data.type);
    if (!type) return socket.emit('room:error', 'Invalid Power Play payload.');
    if (!usePowerPlay(room.state, socket.id, { ...parsed.data, type })) socket.emit('room:error', 'That Power Play is not available to you right now.');
    flushAnalytics(room);
    room.lastActiveAt = Date.now();
  });

  socket.on('player:ready', () => {
    const room = currentRoom(socket); if (!room) return;
    if (!setPlayerReady(room.state, socket.id)) socket.emit('room:error', 'Ready is only available during planning.');
    room.lastActiveAt = Date.now();
  });

  socket.on('player:fieldRotate', payload => {
    const room = currentRoom(socket); if (!room) return;
    if (typeof payload?.id !== 'string') return;
    const ok = typeof payload.angle === 'number' && Number.isFinite(payload.angle)
      ? setFieldObjectAngle(room.state, socket.id, payload.id, payload.angle)
      : rotateFieldObject(room.state, socket.id, payload.id);
    if (!ok) socket.emit('room:error', 'That obstacle cannot be rotated.');
    room.lastActiveAt = Date.now();
  });

  socket.on('player:formation', formation => {
    const room = currentRoom(socket); if (!room) return;
    const player = room.state.players[socket.id];
    if (player && FORMATION_IDS.includes(formation)) {
      if (!applyFormation(room.state, player.side, formation)) socket.emit('room:error', 'Position selection is only available on kickoff and right after a goal.');
    }
    room.lastActiveAt = Date.now();
  });

  socket.on('player:team', team => {
    const room = currentRoom(socket); if (!room) return;
    if (TEAM_IDS.includes(team)) setSideTeam(room.state, socket.id, team);
    room.lastActiveAt = Date.now();
  });

  socket.on('room:map', mapId => {
    const room = currentRoom(socket); if (!room) return;
    if (!MAP_IDS.includes(mapId)) return;
    if (!setMap(room.state, mapId)) socket.emit('room:error', 'Map selection is locked after kickoff. Reset or create a new room to change maps.');
    else freePhysics(room.state);
    room.lastActiveAt = Date.now();
  });

  // Dev/test-only cheat hooks. Rejected outright in production deployments
  // unless ENABLE_CHEATS=true; every successful grant warns the whole room.
  socket.on('player:cheatBoxes', () => {
    const room = currentRoom(socket); if (!room) return;
    if (!cheatsEnabled) return socket.emit('room:error', 'Cheats are disabled on this server.');
    const now = Date.now();
    if (now - (socket.data.lastCheatAllAt ?? 0) < CHEAT_ALL_COOLDOWN_MS) return;
    socket.data.lastCheatAllAt = now;
    if (addCheatBoxes(room.state, socket.id)) io.to(room.state.roomCode).emit('room:error', 'CHEAT MODE: a player added every Power Play box for testing.');
    room.lastActiveAt = now;
  });

  socket.on('player:cheatBox', payload => {
    const room = currentRoom(socket); if (!room) return;
    if (!cheatsEnabled) return socket.emit('room:error', 'Cheats are disabled on this server.');
    const type = normalizeBoxType(payload?.type);
    if (!type) return;
    const now = Date.now();
    if (now - (socket.data.lastCheatAt ?? 0) < CHEAT_BOX_COOLDOWN_MS) return;
    socket.data.lastCheatAt = now;
    if (grantCheatBox(room.state, socket.id, type)) {
      const name = room.state.players[socket.id]?.name ?? 'A player';
      io.to(room.state.roomCode).emit('room:error', `CHEAT MODE: ${name} granted themselves ${BOX_TYPES[type].label} for testing.`);
    }
    room.lastActiveAt = now;
  });

  socket.on('room:leave', () => {
    const room = currentRoom(socket); if (!room) return;
    emitGamePlayer(socket, room, 'player_left');
    removePlayer(room.state, socket.id);
    socket.leave(room.state.roomCode);
    socket.data.roomCode = undefined;
    delete room.inputs[socket.id];
    room.lastActiveAt = Date.now();
  });

  // freePhysics at match boundaries: the next resolving tick rebuilds a
  // pristine Rapier world, so no contact/solver state carries across matches.
  socket.on('game:start', () => { const room = currentRoom(socket); if (room) { freePhysics(room.state); startGame(room.state); emitGamePlayerToConnected(room, 'match_started'); } });
  socket.on('game:reset', mode => { const room = currentRoom(socket); if (room && GAME_MODES.includes(mode)) { freePhysics(room.state); resetGame(room.state, mode); emitGamePlayerToConnected(room, 'match_reset'); } });
  socket.on('disconnect', () => { const room = currentRoom(socket); if (room) { emitGamePlayer(socket, room, 'player_disconnected'); removePlayer(room.state, socket.id); } });
});

function joinRoom(socket: IOSocket, room: Room, name: string, team?: TeamId) {
  socket.data.roomCode = room.state.roomCode;
  socket.data.playerId = socket.id;
  socket.join(room.state.roomCode);
  // returning player (same name, disconnected seat): reclaim side/babbleheads/box
  const seat = findDisconnectedSeat(room.state, name);
  const reclaimed = seat ? reclaimPlayer(room.state, seat.id, socket.id) : null;
  if (!reclaimed) {
    addPlayer(room.state, socket.id, name, team);
    if (team) setSideTeam(room.state, socket.id, team);
  }
  room.inputs[socket.id] = { ...blankInput };
  room.lastActiveAt = Date.now();
  socket.emit('game:state', redactStateFor(room.state, socket.id), socket.id);
  return { reclaimed: Boolean(reclaimed) };
}
function currentRoom(socket: { data: SocketData }) { return socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined; }
function uniqueRoomCode() { let code = ''; do code = nanoid(5).replace(/[-_]/g, 'Z').toUpperCase(); while (rooms.has(code)); return code; }

function emitGamePlayer(socket: IOSocket, room: Room, lifecycle: GamePlayerLifecycle) {
  sendAnalyticsEvent(buildGamePlayerEvent(room.state, lifecycle, socket.id));
}

function emitGamePlayerToConnected(room: Room, lifecycle: GamePlayerLifecycle) {
  for (const player of Object.values(room.state.players)) {
    if (!player.connected) continue;
    sendAnalyticsEvent(buildGamePlayerEvent(room.state, lifecycle, player.id));
  }
}

function flushAnalytics(room: Room) {
  for (const event of drainAnalyticsEvents(room.state)) {
    sendAnalyticsEvent(event);
  }
}

function sendAnalyticsEvent(event: ReturnType<typeof buildGamePlayerEvent>) {
  void xtremepush.send(event);
}

function loadLocalEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

function readLocalKey(filename: string) {
  const file = path.resolve(process.cwd(), filename);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    stepGame(room.state, room.inputs, now);
    flushAnalytics(room);
    if (now - room.lastActiveAt > 1000 * 60 * 60 && Object.values(room.state.players).every(p => !p.connected)) {
      freePhysics(room.state); // release the room's Rapier world (WASM memory)
      rooms.delete(code);
    }
  }
  // per-socket emits so each viewer only ever receives their own team's
  // inventory details; opponents just get box counts
  for (const [, s] of io.sockets.sockets) {
    const room = s.data.roomCode ? rooms.get(s.data.roomCode) : undefined;
    if (room) s.emit('game:state', redactStateFor(room.state, s.id), s.id);
  }
}, 1000 / 30);

httpServer.listen(port, () => console.log(`Unicup listening on :${port}`));
