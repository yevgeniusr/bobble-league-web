import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { addCheatBoxes, addPlayer, applyFormation, blankInput, createInitialState, findDisconnectedSeat, grantCheatBox, launchBabble, reclaimPlayer, redactStateFor, removePlayer, resetGame, rotateFieldObject, setFieldObjectAngle, setSideTeam, startGame, stepGame, usePowerPlay } from '../shared/game';
import { freePhysics } from '../shared/physics';
import { BOX_TYPE_IDS, BOX_TYPES, BoxType, ClientToServerEvents, FORMATION_IDS, GAME_MODES, GameMode, GameState, ServerToClientEvents, TEAM_IDS, TeamId } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);
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
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
app.get('/healthz', (_, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

if (isProd) {
  const clientDir = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDir, { maxAge: '1h', index: false }));
  app.get(/.*/, (_, res) => res.sendFile(path.join(clientDir, 'index.html')));
}

const httpServer = createServer(app);
const io: IOServer = new Server(httpServer, { cors: { origin: true, credentials: false } });

const createSchema = z.object({ name: z.string().max(24), team: z.enum(TEAM_IDS as [string, ...string[]]).optional(), mode: z.union([z.literal(1), z.literal(3), z.literal(5)]) });
const joinSchema = z.object({ roomCode: z.string().min(3).max(8), name: z.string().max(24), team: z.enum(TEAM_IDS as [string, ...string[]]).optional() });

io.on('connection', socket => {
  socket.on('room:create', (payload, cb) => {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return cb({ ok: false, error: 'Invalid room settings.' });
    const roomCode = uniqueRoomCode();
    const state = createInitialState(roomCode, parsed.data.mode as GameMode);
    const room: Room = { state, inputs: {}, lastActiveAt: Date.now() };
    rooms.set(roomCode, room);
    joinRoom(socket, room, parsed.data.name, parsed.data.team as TeamId | undefined);
    cb({ ok: true, roomCode, playerId: socket.id });
  });

  socket.on('room:join', (payload, cb) => {
    const parsed = joinSchema.safeParse({ ...payload, roomCode: payload.roomCode?.toUpperCase?.() });
    if (!parsed.success) return cb({ ok: false, error: 'Invalid join form.' });
    const room = rooms.get(parsed.data.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (Object.values(room.state.players).filter(p => p.connected).length >= 8) return cb({ ok: false, error: 'Room is full.' });
    joinRoom(socket, room, parsed.data.name, parsed.data.team as TeamId | undefined);
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
    if (!use || !BOX_TYPE_IDS.includes(use.type as BoxType)) return;
    if (!usePowerPlay(room.state, socket.id, use)) socket.emit('room:error', 'That Power Play is not available to you right now.');
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
    const type = payload?.type as BoxType;
    if (!BOX_TYPE_IDS.includes(type)) return;
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
    removePlayer(room.state, socket.id);
    socket.leave(room.state.roomCode);
    socket.data.roomCode = undefined;
    delete room.inputs[socket.id];
    room.lastActiveAt = Date.now();
  });

  // freePhysics at match boundaries: the next resolving tick rebuilds a
  // pristine Rapier world, so no contact/solver state carries across matches.
  socket.on('game:start', () => { const room = currentRoom(socket); if (room) { freePhysics(room.state); startGame(room.state); } });
  socket.on('game:reset', mode => { const room = currentRoom(socket); if (room && GAME_MODES.includes(mode)) { freePhysics(room.state); resetGame(room.state, mode); } });
  socket.on('disconnect', () => { const room = currentRoom(socket); if (room) removePlayer(room.state, socket.id); });
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
}
function currentRoom(socket: { data: SocketData }) { return socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined; }
function uniqueRoomCode() { let code = ''; do code = nanoid(5).replace(/[-_]/g, 'Z').toUpperCase(); while (rooms.has(code)); return code; }

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    stepGame(room.state, room.inputs, now);
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

httpServer.listen(port, () => console.log(`Babble League listening on :${port}`));
