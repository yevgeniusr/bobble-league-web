import {
  BOX_TYPE_IDS,
  BOX_TYPES,
  BobbleState,
  BoxState,
  BoxType,
  FIELD,
  FORMATION_IDS,
  FormationId,
  GAME_LENGTHS,
  GameMode,
  GameState,
  InventoryItem,
  PlayerInput,
  PlayerSide,
  PlayerState,
  PowerPlayUse,
  TEAM_IDS,
  TeamId,
  TurnIntent,
  Vec
} from './types';

export type Rng = () => number;
export const blankInput: PlayerInput = { up: false, down: false, left: false, right: false, kick: false };

const TICK_MS = 1000 / 30;
const BOBBLE_DRAG = 0.985;
const BALL_DRAG = 0.992;
const SETTLE_SPEED = 18;
const MAX_RESOLVE_MS = 2500;

export function createInitialState(roomCode: string, mode: GameMode = 3): GameState {
  const length = GAME_LENGTHS[mode];
  return {
    roomCode,
    phase: 'lobby',
    mode,
    config: { goalTarget: mode, length: length.length, maxTurns: length.maxTurns, boxSpawnEveryTurns: 2, boxSpawnAnchors: ['topMid', 'bottomMid'] },
    winner: null,
    turn: 1,
    kickoffAt: Date.now(),
    resolvingStartedAt: null,
    nextBoxId: 1,
    players: {},
    formations: { left: 'forward', right: 'forward' },
    bobbles: [],
    ball: { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: 0, y: 0 }, radius: FIELD.ballRadius },
    boxes: [],
    fieldObjects: [],
    pendingIntents: {},
    powerPlayInventories: { left: [], right: [] },
    score: { left: 0, right: 0 },
    swappedGoalsUntilTurn: null,
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
    score: state.score[chosenSide],
    connected: true,
    controlledBobbleIds: []
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

export function applyFormation(state: GameState, side: PlayerSide, formation: FormationId) {
  if (!FORMATION_IDS.includes(formation)) return false;
  state.formations[side] = formation;
  if (state.bobbles.some(b => b.side === side)) placeFormation(state, side);
  if (state.phase === 'formationSelect') state.phase = 'planning';
  pushEvent(state, `${side} selected ${formation} formation.`);
  return true;
}

export function startGame(state: GameState, rng: Rng = Math.random) {
  state.phase = 'planning';
  state.winner = null;
  state.turn = 1;
  state.score = { left: 0, right: 0 };
  state.boxes = [];
  state.fieldObjects = [];
  state.pendingIntents = {};
  state.powerPlayInventories = { left: [], right: [] };
  state.swappedGoalsUntilTurn = null;
  state.ball = { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: (rng() - 0.5) * 20, y: 0 }, radius: FIELD.ballRadius };
  buildBobbles(state);
  pushEvent(state, `Kickoff! First to ${state.mode}.`);
}

export function resetGame(state: GameState, mode: GameMode, rng: Rng = Math.random) {
  const length = GAME_LENGTHS[mode];
  state.mode = mode;
  state.config = { goalTarget: mode, length: length.length, maxTurns: length.maxTurns, boxSpawnEveryTurns: 2, boxSpawnAnchors: ['topMid', 'bottomMid'] };
  state.phase = 'lobby';
  state.winner = null;
  state.turn = 1;
  state.score = { left: 0, right: 0 };
  state.boxes = [];
  state.fieldObjects = [];
  state.pendingIntents = {};
  state.powerPlayInventories = { left: [], right: [] };
  state.swappedGoalsUntilTurn = null;
  state.ball = { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: (rng() - 0.5) * 20, y: 0 }, radius: FIELD.ballRadius };
  for (const p of Object.values(state.players)) p.score = 0;
  buildBobbles(state);
  pushEvent(state, `Reset to ${length.length} first-to-${mode}.`);
}

export function launchBobble(state: GameState, playerId: string, intent: TurnIntent, now = Date.now()) {
  if (state.phase !== 'planning') return false;
  const player = state.players[playerId];
  if (!player || !player.connected || !player.controlledBobbleIds.includes(intent.bobbleId)) return false;
  const bobble = state.bobbles.find(b => b.id === intent.bobbleId);
  if (!bobble || bobble.lastLaunchedTurn === state.turn) return false;
  const impulse = Math.max(1, Math.min(900, intent.impulse));
  const boost = bobble.effects.some(e => e.type === 'boost' && e.untilTurn >= state.turn) ? 1.35 : 1;
  bobble.vel.x += Math.cos(intent.aimAngle) * impulse * boost;
  bobble.vel.y += Math.sin(intent.aimAngle) * impulse * boost;
  bobble.lastLaunchedTurn = state.turn;
  state.pendingIntents[bobble.id] = { bobbleId: bobble.id, aimAngle: intent.aimAngle, impulse };
  state.phase = 'resolving';
  state.resolvingStartedAt = now;
  pushEvent(state, `${player.name} launched ${bobble.id}.`);
  return true;
}

export function stepGame(state: GameState, _inputs: Record<string, PlayerInput> = {}, now = Date.now(), rng: Rng = Math.random, dtMs = TICK_MS) {
  if (state.phase !== 'resolving') return;
  const dt = dtMs / 1000;
  expireTurnEffects(state);
  for (const b of state.bobbles) integrateCircle(b.pos, b.vel, b.radius, dt, BOBBLE_DRAG);
  integrateBall(state, dt);
  resolveBobbleCollisions(state);
  collectBoxesForBobbles(state, now);
  const goal = detectGoal(state);
  if (goal) return handleClassicGoal(state, goal, now, rng);
  const started = state.resolvingStartedAt ?? now;
  if (now - started >= MAX_RESOLVE_MS || allSettled(state)) endTurn(state, now, rng);
}

export function collectPowerBox(state: GameState, bobble: BobbleState, now = Date.now()) {
  const index = state.boxes.findIndex(box => dist(box.pos, bobble.pos) <= bobble.radius + FIELD.boxSize / 2);
  if (index < 0) return false;
  const [box] = state.boxes.splice(index, 1);
  const item: InventoryItem = { type: box.type, availableTurn: state.turn + 1 };
  state.powerPlayInventories[bobble.side].push(item);
  pushEvent(state, `${bobble.side} collected ${BOX_TYPES[box.type].label}.`);
  return true;
}

export function usePowerPlay(state: GameState, playerId: string, use: PowerPlayUse, now = Date.now()) {
  const player = state.players[playerId];
  if (!player || !player.connected) return false;
  const inventory = state.powerPlayInventories[player.side];
  const itemIndex = inventory.findIndex(item => item.type === use.type && item.availableTurn <= state.turn);
  if (itemIndex < 0) return false;
  inventory.splice(itemIndex, 1);
  applyPowerPlay(state, player.side, use, now);
  pushEvent(state, `${player.name} used ${BOX_TYPES[use.type].label}.`);
  return true;
}

export function applyBox(state: GameState, picker: PlayerState, type: BoxType, now = Date.now()) {
  state.powerPlayInventories[picker.side].push({ type, availableTurn: state.turn + 1 });
  pushEvent(state, `${picker.name} picked up ${BOX_TYPES[type].label}.`);
}

export function spawnBox(state: GameState, now = Date.now(), rng: Rng = Math.random): BoxState {
  const anchor = rng() < 0.5 ? 'topMid' : 'bottomMid';
  const type = BOX_TYPE_IDS[Math.floor(rng() * BOX_TYPE_IDS.length)] ?? 'beachBall';
  const box: BoxState = {
    id: `box-${state.nextBoxId++}`,
    type,
    anchor,
    pos: anchorPosition(anchor, rng),
    spawnedAt: now
  };
  state.boxes = [box];
  pushEvent(state, `Mystery box spawned on the ${anchor === 'topMid' ? 'top' : 'bottom'} lane.`);
  return box;
}

function buildBobbles(state: GameState) {
  state.bobbles = [];
  for (const side of ['left', 'right'] as const) {
    const playerIds = Object.values(state.players).filter(p => p.side === side).map(p => p.id);
    const ids = Array.from({ length: 4 }, (_, i) => `${side}-${i + 1}`);
    for (const playerId of playerIds) state.players[playerId].controlledBobbleIds = ids;
    for (let i = 0; i < 4; i++) state.bobbles.push({ id: ids[i], side, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, radius: FIELD.bobbleRadius, effects: [], lastLaunchedTurn: 0 });
    placeFormation(state, side);
  }
}

function placeFormation(state: GameState, side: PlayerSide) {
  const formation = state.formations[side];
  const mirrored = side === 'right';
  const baseX = mirrored ? FIELD.width - 150 : 230;
  const sign = mirrored ? -1 : 1;
  const layouts: Record<FormationId, Vec[]> = {
    forward: [{ x: 0, y: -120 }, { x: 80, y: -40 }, { x: 80, y: 40 }, { x: 0, y: 120 }],
    option: [{ x: 80, y: -120 }, { x: 80, y: 0 }, { x: 80, y: 120 }, { x: -35, y: 0 }],
    slant: [{ x: 95, y: -135 }, { x: 45, y: -45 }, { x: -5, y: 45 }, { x: -55, y: 135 }],
    zone: [{ x: 40, y: -135 }, { x: 80, y: -45 }, { x: 80, y: 45 }, { x: 40, y: 135 }],
    box: [{ x: 35, y: -95 }, { x: 105, y: -95 }, { x: 35, y: 95 }, { x: 105, y: 95 }],
    rush: [{ x: 110, y: -80 }, { x: 110, y: 80 }, { x: -5, y: -80 }, { x: -5, y: 80 }]
  };
  const bobbles = state.bobbles.filter(b => b.side === side).sort((a, b) => a.id.localeCompare(b.id));
  layouts[formation].forEach((offset, i) => {
    const bobble = bobbles[i];
    if (!bobble) return;
    bobble.pos = { x: baseX + offset.x * sign, y: FIELD.height / 2 + offset.y };
    bobble.vel = { x: 0, y: 0 };
    bobble.radius = FIELD.bobbleRadius;
  });
}

function integrateCircle(pos: Vec, vel: Vec, radius: number, dt: number, drag: number) {
  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  vel.x *= drag;
  vel.y *= drag;
  if (pos.y < radius) { pos.y = radius; vel.y = Math.abs(vel.y) * 0.75; }
  if (pos.y > FIELD.height - radius) { pos.y = FIELD.height - radius; vel.y = -Math.abs(vel.y) * 0.75; }
  if (pos.x < radius) { pos.x = radius; vel.x = Math.abs(vel.x) * 0.75; }
  if (pos.x > FIELD.width - radius) { pos.x = FIELD.width - radius; vel.x = -Math.abs(vel.x) * 0.75; }
}

function integrateBall(state: GameState, dt: number) {
  const b = state.ball;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.vel.x *= BALL_DRAG;
  b.vel.y *= BALL_DRAG;
  if (b.pos.y < b.radius) { b.pos.y = b.radius; b.vel.y = Math.abs(b.vel.y) * 0.88; }
  if (b.pos.y > FIELD.height - b.radius) { b.pos.y = FIELD.height - b.radius; b.vel.y = -Math.abs(b.vel.y) * 0.88; }
  const inGoalMouth = b.pos.y > FIELD.goalY && b.pos.y < FIELD.goalY + FIELD.goalHeight;
  if (!inGoalMouth) {
    if (b.pos.x < b.radius) { b.pos.x = b.radius; b.vel.x = Math.abs(b.vel.x) * 0.88; }
    if (b.pos.x > FIELD.width - b.radius) { b.pos.x = FIELD.width - b.radius; b.vel.x = -Math.abs(b.vel.x) * 0.88; }
  }
}

function resolveBobbleCollisions(state: GameState) {
  for (const b of state.bobbles) {
    if (!b.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn)) circleBounce(b.pos, b.vel, b.radius, state.ball.pos, state.ball.vel, state.ball.radius, 0.95);
  }
  for (let i = 0; i < state.bobbles.length; i++) for (let j = i + 1; j < state.bobbles.length; j++) {
    const a = state.bobbles[i], b = state.bobbles[j];
    if (a.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn) || b.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn)) continue;
    circleBounce(a.pos, a.vel, a.radius, b.pos, b.vel, b.radius, 0.55);
  }
}

function circleBounce(a: Vec, av: Vec, ar: number, b: Vec, bv: Vec, br: number, impulse: number) {
  const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.0001; const min = ar + br;
  if (d >= min) return false;
  const nx = dx / d, ny = dy / d, overlap = (min - d) / 2;
  a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
  const rvx = bv.x - av.x, rvy = bv.y - av.y; const sep = rvx * nx + rvy * ny;
  const j = Math.max(24, Math.abs(sep) * impulse);
  av.x -= nx * j * 0.25; av.y -= ny * j * 0.25; bv.x += nx * j; bv.y += ny * j;
  return true;
}

function collectBoxesForBobbles(state: GameState, now: number) {
  for (const bobble of [...state.bobbles]) collectPowerBox(state, bobble, now);
  state.boxes = state.boxes.filter(box => now - box.spawnedAt < 14000);
}

function applyPowerPlay(state: GameState, side: PlayerSide, use: PowerPlayUse, now: number) {
  const target = (use.targetBobbleId && state.bobbles.find(b => b.id === use.targetBobbleId)) || state.bobbles.find(b => b.side === side);
  switch (use.type) {
    case 'beachBall': state.ball.radius = FIELD.ballRadius * 1.35; state.ball.vel.x *= 1.25; state.ball.vel.y *= 1.25; break;
    case 'moveBall': state.ball.pos = use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }; state.ball.vel = { x: 0, y: 0 }; break;
    case 'swapGoals': state.swappedGoalsUntilTurn = state.turn + 1; break;
    case 'bigBumpers': for (const b of state.bobbles.filter(b => b.side === side)) { b.radius = FIELD.bobbleRadius * 1.3; addBobbleEffect(b, 'bigBumpers', state.turn + 1); } break;
    case 'boost': state.fieldObjects.push({ id: `field-${now}`, type: 'boost', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: use.angle ?? 0, untilTurn: state.turn + 1 }); if (target) addBobbleEffect(target, 'boost', state.turn + 1); break;
    case 'stickyGoo': state.fieldObjects.push({ id: `field-${now}`, type: 'stickyGoo', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: 0, untilTurn: state.turn + 1 }); if (target) { target.vel.x *= 0.5; target.vel.y *= 0.5; addBobbleEffect(target, 'stickyGoo', state.turn + 1); } break;
    case 'ramp': state.fieldObjects.push({ id: `field-${now}`, type: 'ramp', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: use.angle ?? -Math.PI / 4, untilTurn: state.turn + 1 }); break;
    case 'block': state.fieldObjects.push({ id: `field-${now}`, type: 'block', owner: side, pos: use.position ?? { x: side === 'left' ? 85 : FIELD.width - 85, y: FIELD.height / 2 }, angle: 0, untilTurn: state.turn + 1 }); break;
    case 'bigHead': if (target) { target.radius = FIELD.bobbleRadius * 1.45; addBobbleEffect(target, 'bigHead', state.turn + 1); } break;
    case 'ghosted': if (target) addBobbleEffect(target, 'ghosted', state.turn + 1); break;
    case 'movePlayer': if (target) { target.pos = use.position ?? { x: side === 'left' ? FIELD.width * 0.42 : FIELD.width * 0.58, y: FIELD.height / 2 }; target.vel = { x: 0, y: 0 }; } break;
  }
}

function addBobbleEffect(bobble: BobbleState, type: BoxType, untilTurn: number) {
  bobble.effects = bobble.effects.filter(e => e.type !== type);
  bobble.effects.push({ type, untilTurn });
}

function expireTurnEffects(state: GameState) {
  for (const b of state.bobbles) {
    b.effects = b.effects.filter(e => e.untilTurn >= state.turn);
    if (!b.effects.some(e => ['bigHead', 'bigBumpers'].includes(e.type))) b.radius = FIELD.bobbleRadius;
  }
  state.fieldObjects = state.fieldObjects.filter(o => o.untilTurn >= state.turn);
  if (state.swappedGoalsUntilTurn !== null && state.swappedGoalsUntilTurn < state.turn) state.swappedGoalsUntilTurn = null;
}

function detectGoal(state: GameState): PlayerSide | null {
  const b = state.ball;
  if (b.pos.y < FIELD.goalY || b.pos.y > FIELD.goalY + FIELD.goalHeight) return null;
  const leftGoalScorer: PlayerSide = state.swappedGoalsUntilTurn && state.swappedGoalsUntilTurn >= state.turn ? 'left' : 'right';
  const rightGoalScorer: PlayerSide = state.swappedGoalsUntilTurn && state.swappedGoalsUntilTurn >= state.turn ? 'right' : 'left';
  if (b.pos.x < -FIELD.goalDepth + b.radius) return leftGoalScorer;
  if (b.pos.x > FIELD.width + FIELD.goalDepth - b.radius) return rightGoalScorer;
  return null;
}

function handleClassicGoal(state: GameState, scorer: PlayerSide, now: number, rng: Rng) {
  state.score[scorer] += 1;
  for (const p of Object.values(state.players)) if (p.side === scorer) p.score = state.score[scorer];
  pushEvent(state, `${scorer === 'left' ? 'Left' : 'Right'} scores!`);
  if (state.score[scorer] >= state.mode) {
    state.phase = 'finished';
    state.winner = scorer;
    pushEvent(state, `${scorer} wins first-to-${state.mode}!`);
    return;
  }
  endTurn(state, now, rng);
}

function endTurn(state: GameState, now: number, rng: Rng) {
  if (state.turn >= state.config.maxTurns) {
    state.phase = 'finished';
    state.winner = state.score.left === state.score.right ? null : state.score.left > state.score.right ? 'left' : 'right';
    pushEvent(state, state.winner ? `${state.winner} wins on turns!` : 'Turn limit reached: draw.');
    return;
  }
  state.turn += 1;
  state.phase = 'planning';
  state.resolvingStartedAt = null;
  state.pendingIntents = {};
  resetForPlanning(state, rng);
  if (state.turn % state.config.boxSpawnEveryTurns === 0) spawnBox(state, now, rng);
}

function resetForPlanning(state: GameState, _rng: Rng) {
  // Bobble League turns are tabletop turns: pieces stay where physics resolved.
  // Only very small residual velocities are cleared so the next planning phase is stable.
  if (Math.hypot(state.ball.vel.x, state.ball.vel.y) < SETTLE_SPEED * 1.8) state.ball.vel = { x: 0, y: 0 };
  for (const b of state.bobbles) if (Math.hypot(b.vel.x, b.vel.y) < SETTLE_SPEED * 1.8) b.vel = { x: 0, y: 0 };
  state.kickoffAt = Date.now();
}

function allSettled(state: GameState) {
  const speeds = [Math.hypot(state.ball.vel.x, state.ball.vel.y), ...state.bobbles.map(b => Math.hypot(b.vel.x, b.vel.y))];
  return speeds.every(s => s < SETTLE_SPEED);
}

function anchorPosition(anchor: BoxState['anchor'], rng: Rng): Vec {
  const x = 300 + rng() * (FIELD.width - 600);
  if (anchor === 'topMid') return { x, y: 58 + rng() * 70 };
  if (anchor === 'bottomMid') return { x, y: FIELD.height - 128 + rng() * 70 };
  if (anchor === 'midLeft') return { x: 150, y: FIELD.height / 2 };
  return { x: FIELD.width - 150, y: FIELD.height / 2 };
}

function chooseSide(state: GameState): PlayerSide { const vals = Object.values(state.players).filter(p => p.connected); return vals.filter(p => p.side === 'left').length <= vals.filter(p => p.side === 'right').length ? 'left' : 'right'; }
function randomTeam(rng: Rng): TeamId { return TEAM_IDS[Math.floor(rng() * TEAM_IDS.length)] ?? 'pigs'; }
function sanitizeName(name: string) { return (name || 'Player').replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 18) || 'Player'; }
function pushEvent(state: GameState, message: string) { state.events.push({ at: Date.now(), message }); state.events = state.events.slice(-8); }
function dist(a: Vec, b: Vec) { return Math.hypot(a.x - b.x, a.y - b.y); }
