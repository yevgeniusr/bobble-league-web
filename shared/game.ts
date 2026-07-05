import { BOX_TYPE_IDS, BOX_TYPES, BoxState, BoxType, FIELD, GameMode, GameState, PlayerInput, PlayerSide, PlayerState, TEAM_IDS, TeamId, Vec } from './types';

export type Rng = () => number;
export const blankInput: PlayerInput = { up: false, down: false, left: false, right: false, kick: false };
const MAX_SPEED = 330;
const TICK_MS = 1000 / 30;
const KICK_COOLDOWN = 420;
const PLAYER_DRAG = 0.88;
const BALL_DRAG = 0.992;

export function createInitialState(roomCode: string, mode: GameMode = 3): GameState {
  return {
    roomCode,
    phase: 'lobby',
    mode,
    winner: null,
    turn: 1,
    kickoffAt: Date.now(),
    nextBoxId: 1,
    players: {},
    ball: { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: 0, y: 0 }, radius: FIELD.ballRadius },
    boxes: [],
    events: [{ at: Date.now(), message: `Room ${roomCode} created.` }]
  };
}

export function addPlayer(state: GameState, id: string, name: string, team: TeamId = randomTeam(Math.random), side?: PlayerSide): PlayerState {
  const chosenSide = side ?? chooseSide(state);
  const p: PlayerState = {
    id,
    name: sanitizeName(name),
    side: chosenSide,
    team,
    pos: spawnFor(chosenSide),
    vel: { x: 0, y: 0 },
    radius: FIELD.playerRadius,
    score: scoreForSide(state, chosenSide),
    connected: true,
    effects: [],
    lastKickAt: 0
  };
  state.players[id] = p;
  pushEvent(state, `${p.name} joined ${chosenSide} as ${team}.`);
  return p;
}

export function setPlayerTeam(state: GameState, id: string, team: TeamId) {
  if (state.players[id] && TEAM_IDS.includes(team)) state.players[id].team = team;
}

export function removePlayer(state: GameState, id: string) {
  if (state.players[id]) {
    state.players[id].connected = false;
    pushEvent(state, `${state.players[id].name} disconnected.`);
  }
}

export function startGame(state: GameState, rng: Rng = Math.random) {
  state.phase = 'playing';
  state.winner = null;
  state.turn = 1;
  state.boxes = [];
  resetPositions(state, rng);
  pushEvent(state, `Kickoff! First to ${state.mode}.`);
}

export function resetGame(state: GameState, mode: GameMode, rng: Rng = Math.random) {
  state.mode = mode;
  state.phase = 'lobby';
  state.winner = null;
  state.turn = 1;
  state.boxes = [];
  for (const p of Object.values(state.players)) {
    p.score = 0;
    p.effects = [];
    p.radius = FIELD.playerRadius;
  }
  resetPositions(state, rng);
  pushEvent(state, `Reset to first-to-${mode}.`);
}

export function stepGame(state: GameState, inputs: Record<string, PlayerInput>, now = Date.now(), rng: Rng = Math.random, dtMs = TICK_MS) {
  if (state.phase !== 'playing') return;
  const dt = dtMs / 1000;
  expireEffects(state, now);
  for (const p of Object.values(state.players)) stepPlayer(state, p, inputs[p.id] ?? blankInput, now, dt);
  applyMagnet(state, dt);
  integrateBall(state, dt);
  resolveCollisions(state, now);
  collectBoxes(state, now);
  const goal = detectGoal(state);
  if (goal) handleGoal(state, goal, now, rng);
}

function stepPlayer(state: GameState, p: PlayerState, input: PlayerInput, now: number, dt: number) {
  if (!p.connected) return;
  const frozen = hasEffect(p, 'freeze', now);
  let ax = 0, ay = 0;
  if (!frozen) {
    if (input.left) ax -= 1; if (input.right) ax += 1; if (input.up) ay -= 1; if (input.down) ay += 1;
  }
  const len = Math.hypot(ax, ay) || 1;
  const speedEffect = hasEffect(p, 'speed', now) ? 1.7 : hasEffect(p, 'slow', now) ? 0.52 : 1;
  const accel = 1180 * speedEffect;
  p.vel.x += (ax / len) * accel * dt;
  p.vel.y += (ay / len) * accel * dt;
  const max = MAX_SPEED * speedEffect;
  const vlen = Math.hypot(p.vel.x, p.vel.y);
  if (vlen > max) { p.vel.x = (p.vel.x / vlen) * max; p.vel.y = (p.vel.y / vlen) * max; }
  p.vel.x *= PLAYER_DRAG; p.vel.y *= PLAYER_DRAG;
  p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt;
  clampPlayer(p);
  if (input.kick && now - p.lastKickAt >= KICK_COOLDOWN) kickBall(state, p, now);
}

function kickBall(state: GameState, p: PlayerState, now: number) {
  const d = sub(state.ball.pos, p.pos); const dist = mag(d);
  if (dist < p.radius + state.ball.radius + 18) {
    const n = norm(d.x || (p.side === 'left' ? 1 : -1), d.y);
    state.ball.vel.x += n.x * 620 + p.vel.x * 0.45;
    state.ball.vel.y += n.y * 620 + p.vel.y * 0.45;
    p.lastKickAt = now;
  }
}

function integrateBall(state: GameState, dt: number) {
  const b = state.ball;
  b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt;
  b.vel.x *= BALL_DRAG; b.vel.y *= BALL_DRAG;
  if (b.pos.y < b.radius) { b.pos.y = b.radius; b.vel.y = Math.abs(b.vel.y) * 0.88; }
  if (b.pos.y > FIELD.height - b.radius) { b.pos.y = FIELD.height - b.radius; b.vel.y = -Math.abs(b.vel.y) * 0.88; }
  const inGoalMouth = b.pos.y > FIELD.goalY && b.pos.y < FIELD.goalY + FIELD.goalHeight;
  if (!inGoalMouth) {
    if (b.pos.x < b.radius) { b.pos.x = b.radius; b.vel.x = Math.abs(b.vel.x) * 0.88; }
    if (b.pos.x > FIELD.width - b.radius) { b.pos.x = FIELD.width - b.radius; b.vel.x = -Math.abs(b.vel.x) * 0.88; }
  }
}

function resolveCollisions(state: GameState, now: number) {
  const players = Object.values(state.players).filter(p => p.connected);
  for (const p of players) {
    if (hasEffect(p, 'ghost', now)) continue;
    circleBounce(p.pos, p.vel, p.radius, state.ball.pos, state.ball.vel, state.ball.radius, 0.92);
    for (const other of players) {
      if (other.id <= p.id || hasEffect(other, 'ghost', now)) continue;
      circleBounce(p.pos, p.vel, p.radius, other.pos, other.vel, other.radius, 0.55);
    }
  }
  for (const p of players) {
    if (hasEffect(p, 'shield', now)) applyShield(state, p);
  }
}

function circleBounce(a: Vec, av: Vec, ar: number, b: Vec, bv: Vec, br: number, impulse: number) {
  const dx = b.x - a.x, dy = b.y - a.y; const dist = Math.hypot(dx, dy) || 0.0001; const min = ar + br;
  if (dist >= min) return false;
  const nx = dx / dist, ny = dy / dist; const overlap = (min - dist) / 2;
  a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
  const rvx = bv.x - av.x, rvy = bv.y - av.y; const sep = rvx * nx + rvy * ny;
  const j = Math.max(36, Math.abs(sep) * impulse);
  av.x -= nx * j * 0.35; av.y -= ny * j * 0.35; bv.x += nx * j; bv.y += ny * j;
  return true;
}

function collectBoxes(state: GameState, now: number) {
  const remaining: BoxState[] = [];
  for (const box of state.boxes) {
    let used = false;
    for (const p of Object.values(state.players)) {
      if (!p.connected) continue;
      if (dist(p.pos, box.pos) < p.radius + FIELD.boxSize / 2) { applyBox(state, p, box.type, now); used = true; break; }
    }
    if (!used && now - box.spawnedAt < 14000) remaining.push(box);
  }
  state.boxes = remaining;
}

export function applyBox(state: GameState, picker: PlayerState, type: BoxType, now = Date.now()) {
  const opponent = nearestOpponent(state, picker);
  const spec = BOX_TYPES[type];
  switch (type) {
    case 'speed': addEffect(picker, 'speed', now + spec.durationMs); break;
    case 'slow': if (opponent) addEffect(opponent, 'slow', now + spec.durationMs); break;
    case 'big': picker.radius = FIELD.playerRadius * 1.42; addEffect(picker, 'big', now + spec.durationMs); break;
    case 'tiny': if (opponent) { opponent.radius = FIELD.playerRadius * 0.68; addEffect(opponent, 'tiny', now + spec.durationMs); } break;
    case 'freeze': if (opponent) addEffect(opponent, 'freeze', now + spec.durationMs); break;
    case 'ghost': addEffect(picker, 'ghost', now + spec.durationMs); break;
    case 'magnet': addEffect(picker, 'magnet', now + spec.durationMs); break;
    case 'shield': addEffect(picker, 'shield', now + spec.durationMs); break;
    case 'bomb': {
      const n = norm(state.ball.pos.x - picker.pos.x, state.ball.pos.y - picker.pos.y);
      state.ball.vel.x += n.x * 930; state.ball.vel.y += n.y * 930; break;
    }
    case 'swap': if (opponent) { const pos = picker.pos; picker.pos = opponent.pos; opponent.pos = pos; } break;
  }
  pushEvent(state, `${picker.name} picked up ${spec.label}.`);
}

function handleGoal(state: GameState, scorer: PlayerSide, now: number, rng: Rng) {
  for (const p of Object.values(state.players)) if (p.side === scorer) p.score += 1;
  pushEvent(state, `${scorer === 'left' ? 'Left' : 'Right'} scores!`);
  if (scoreForSide(state, scorer) >= state.mode) {
    state.phase = 'finished'; state.winner = scorer; pushEvent(state, `${scorer} wins first-to-${state.mode}!`); return;
  }
  state.turn += 1;
  resetPositions(state, rng);
  if (state.turn % 2 === 0) spawnBox(state, now, rng);
}

export function spawnBox(state: GameState, now = Date.now(), rng: Rng = Math.random): BoxState {
  const laneTop = rng() < 0.5;
  const type = BOX_TYPE_IDS[Math.floor(rng() * BOX_TYPE_IDS.length)] ?? 'speed';
  const box: BoxState = {
    id: `box-${state.nextBoxId++}`,
    type,
    pos: { x: 150 + rng() * (FIELD.width - 300), y: laneTop ? 54 + rng() * 95 : FIELD.height - 149 + rng() * 95 },
    spawnedAt: now
  };
  state.boxes = [box];
  pushEvent(state, `Mystery box spawned on the ${laneTop ? 'top' : 'bottom'} lane.`);
  return box;
}

function detectGoal(state: GameState): PlayerSide | null {
  const b = state.ball;
  if (b.pos.y < FIELD.goalY || b.pos.y > FIELD.goalY + FIELD.goalHeight) return null;
  if (b.pos.x < -FIELD.goalDepth + b.radius) return 'right';
  if (b.pos.x > FIELD.width + FIELD.goalDepth - b.radius) return 'left';
  return null;
}

function applyMagnet(state: GameState, dt: number) {
  for (const p of Object.values(state.players)) if (hasEffect(p, 'magnet', Date.now())) {
    const d = sub(p.pos, state.ball.pos); const m = Math.max(70, mag(d)); const pull = 54000 / (m * m);
    state.ball.vel.x += (d.x / m) * pull * dt * 120; state.ball.vel.y += (d.y / m) * pull * dt * 120;
  }
}

function applyShield(state: GameState, p: PlayerState) {
  const b = state.ball; const shieldX = p.side === 'left' ? 28 : FIELD.width - 28;
  if (b.pos.y > FIELD.goalY && b.pos.y < FIELD.goalY + FIELD.goalHeight && Math.abs(b.pos.x - shieldX) < b.radius + 12) {
    b.pos.x = shieldX + (p.side === 'left' ? b.radius + 12 : -b.radius - 12);
    b.vel.x = Math.abs(b.vel.x || 300) * (p.side === 'left' ? 1 : -1);
  }
}

function resetPositions(state: GameState, rng: Rng) {
  state.ball.pos = { x: FIELD.width / 2, y: FIELD.height / 2 }; state.ball.vel = { x: (rng() - 0.5) * 80, y: (rng() - 0.5) * 80 };
  const left = Object.values(state.players).filter(p => p.side === 'left'); const right = Object.values(state.players).filter(p => p.side === 'right');
  left.forEach((p, i) => { p.pos = { x: 210, y: 240 + i * 100 }; p.vel = { x: 0, y: 0 }; });
  right.forEach((p, i) => { p.pos = { x: FIELD.width - 210, y: 240 + i * 100 }; p.vel = { x: 0, y: 0 }; });
  state.kickoffAt = Date.now();
}

function expireEffects(state: GameState, now: number) {
  for (const p of Object.values(state.players)) {
    p.effects = p.effects.filter(e => e.until > now);
    if (!hasEffect(p, 'big', now) && !hasEffect(p, 'tiny', now)) p.radius = FIELD.playerRadius;
  }
}
function addEffect(p: PlayerState, type: BoxType, until: number) { p.effects = p.effects.filter(e => e.type !== type); p.effects.push({ type, until }); }
function hasEffect(p: PlayerState, type: BoxType, now: number) { return p.effects.some(e => e.type === type && e.until > now); }
function nearestOpponent(state: GameState, p: PlayerState) { return Object.values(state.players).filter(o => o.side !== p.side && o.connected).sort((a,b)=>dist(a.pos,p.pos)-dist(b.pos,p.pos))[0]; }
function chooseSide(state: GameState): PlayerSide { const vals = Object.values(state.players).filter(p=>p.connected); return vals.filter(p=>p.side==='left').length <= vals.filter(p=>p.side==='right').length ? 'left' : 'right'; }
function scoreForSide(state: GameState, side: PlayerSide) { return Math.max(0, ...Object.values(state.players).filter(p => p.side === side).map(p => p.score)); }
function spawnFor(side: PlayerSide): Vec { return { x: side === 'left' ? 210 : FIELD.width - 210, y: FIELD.height / 2 }; }
function clampPlayer(p: PlayerState) { p.pos.x = Math.max(p.radius, Math.min(FIELD.width - p.radius, p.pos.x)); p.pos.y = Math.max(p.radius, Math.min(FIELD.height - p.radius, p.pos.y)); }
function randomTeam(rng: Rng): TeamId { return TEAM_IDS[Math.floor(rng() * TEAM_IDS.length)] ?? 'pigs'; }
function sanitizeName(name: string) { return (name || 'Player').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 18) || 'Player'; }
function pushEvent(state: GameState, message: string) { state.events.push({ at: Date.now(), message }); state.events = state.events.slice(-8); }
function dist(a: Vec, b: Vec) { return Math.hypot(a.x - b.x, a.y - b.y); }
function sub(a: Vec, b: Vec): Vec { return { x: a.x - b.x, y: a.y - b.y }; }
function mag(v: Vec) { return Math.hypot(v.x, v.y); }
function norm(x: number, y: number): Vec { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; }
