import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { addPlayer, applyFormation, blankInput, createInitialState, launchBobble, removePlayer, resetGame, setPlayerTeam, startGame, stepGame, usePowerPlay } from '../shared/game';
import { ClientToServerEvents, FORMATION_IDS, GAME_MODES, GameMode, GameState, ServerToClientEvents, TEAM_IDS, TeamId } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);

type InterServerEvents = Record<string, never>;
type SocketData = { roomCode?: string; playerId?: string };
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

const createSchema = z.object({ name: z.string().max(24), team: z.enum(TEAM_IDS as [string, ...string[]]), mode: z.union([z.literal(1), z.literal(3), z.literal(5)]) });
const joinSchema = z.object({ roomCode: z.string().min(3).max(8), name: z.string().max(24), team: z.enum(TEAM_IDS as [string, ...string[]]) });

io.on('connection', socket => {
  socket.on('room:create', (payload, cb) => {
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) return cb({ ok: false, error: 'Invalid room settings.' });
    const roomCode = uniqueRoomCode();
    const state = createInitialState(roomCode, parsed.data.mode as GameMode);
    const room: Room = { state, inputs: {}, lastActiveAt: Date.now() };
    rooms.set(roomCode, room);
    joinRoom(socket, room, parsed.data.name, parsed.data.team as TeamId);
    cb({ ok: true, roomCode, playerId: socket.id });
  });

  socket.on('room:join', (payload, cb) => {
    const parsed = joinSchema.safeParse({ ...payload, roomCode: payload.roomCode?.toUpperCase?.() });
    if (!parsed.success) return cb({ ok: false, error: 'Invalid join form.' });
    const room = rooms.get(parsed.data.roomCode);
    if (!room) return cb({ ok: false, error: 'Room not found.' });
    if (Object.values(room.state.players).filter(p => p.connected).length >= 8) return cb({ ok: false, error: 'Room is full.' });
    joinRoom(socket, room, parsed.data.name, parsed.data.team as TeamId);
    cb({ ok: true, roomCode: parsed.data.roomCode, playerId: socket.id });
  });

  socket.on('player:input', input => {
    const room = currentRoom(socket); if (!room) return;
    room.inputs[socket.id] = { ...blankInput, ...input };
    room.lastActiveAt = Date.now();
  });

  socket.on('player:launch', intent => {
    const room = currentRoom(socket); if (!room) return;
    if (!launchBobble(room.state, socket.id, intent)) socket.emit('room:error', 'That bobble cannot be launched right now.');
    room.lastActiveAt = Date.now();
  });

  socket.on('player:power', use => {
    const room = currentRoom(socket); if (!room) return;
    if (!usePowerPlay(room.state, socket.id, use)) socket.emit('room:error', 'That Power Play is not available yet.');
    room.lastActiveAt = Date.now();
  });

  socket.on('player:formation', formation => {
    const room = currentRoom(socket); if (!room) return;
    const player = room.state.players[socket.id];
    if (player && FORMATION_IDS.includes(formation)) applyFormation(room.state, player.side, formation);
    room.lastActiveAt = Date.now();
  });

  socket.on('player:team', team => {
    const room = currentRoom(socket); if (!room) return;
    if (TEAM_IDS.includes(team)) setPlayerTeam(room.state, socket.id, team);
  });

  socket.on('game:start', () => { const room = currentRoom(socket); if (room) startGame(room.state); });
  socket.on('game:reset', mode => { const room = currentRoom(socket); if (room && GAME_MODES.includes(mode)) resetGame(room.state, mode); });
  socket.on('disconnect', () => { const room = currentRoom(socket); if (room) removePlayer(room.state, socket.id); });
});

function joinRoom(socket: IOSocket, room: Room, name: string, team: TeamId) {
  socket.data.roomCode = room.state.roomCode;
  socket.data.playerId = socket.id;
  socket.join(room.state.roomCode);
  addPlayer(room.state, socket.id, name, team);
  room.inputs[socket.id] = { ...blankInput };
  room.lastActiveAt = Date.now();
  socket.emit('game:state', room.state, socket.id);
}
function currentRoom(socket: { data: SocketData }) { return socket.data.roomCode ? rooms.get(socket.data.roomCode) : undefined; }
function uniqueRoomCode() { let code = ''; do code = nanoid(5).replace(/[-_]/g, 'Z').toUpperCase(); while (rooms.has(code)); return code; }

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    stepGame(room.state, room.inputs, now);
    io.to(code).emit('game:state', room.state, '');
    if (now - room.lastActiveAt > 1000 * 60 * 60 && Object.values(room.state.players).every(p => !p.connected)) rooms.delete(code);
  }
}, 1000 / 30);

httpServer.listen(port, () => console.log(`Bobble League listening on :${port}`));
