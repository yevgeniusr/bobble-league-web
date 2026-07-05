import {
  BIG_BUMPER_RADIUS,
  BOX_TYPE_IDS,
  BOX_TYPES,
  BUMPER_RADIUS,
  BUMPERS,
  BobbleState,
  BoxState,
  BoxType,
  FIELD,
  ROTATABLE_FIELD_OBJECTS,
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
// Tuned for a heavy tabletop feel: strong pull impulse, visible inertia,
// and enough rolling friction to avoid ice-like endless sliding.
const BOBBLE_DRAG = 0.952;
const BALL_DRAG = 0.968;
const BEACH_BALL_DRAG = 0.982;
export const BOBBLE_IMPULSE_SCALE = 1.12;
export const BALL_MASS_FACTOR = 0.78;
export const BOX_LIFETIME_TURNS = 3;
const SETTLE_SPEED = 18;
export const MAX_RESOLVE_MS = 10000;
const TURN_DURATION_MS = 15000;
const MAX_SPEED = 1600;
export const BUMPER_BOOST = 220;
const BUMPER_EVENT_TTL_MS = 1500;

export function createInitialState(roomCode: string, mode: GameMode = 3): GameState {
  const length = GAME_LENGTHS[mode];
  return {
    roomCode,
    phase: 'lobby',
    mode,
    config: { goalTarget: mode, length: length.length, maxTurns: length.maxTurns, turnDurationMs: TURN_DURATION_MS, boxSpawnEveryTurns: 2, boxSpawnAnchors: ['topMid', 'bottomMid'] },
    winner: null,
    turn: 1,
    kickoffAt: Date.now(),
    turnDeadlineAt: Date.now() + TURN_DURATION_MS,
    resolvingStartedAt: null,
    nextBoxId: 1,
    players: {},
    sideTeams: { left: 'pigs', right: 'tigers' },
    formationSelectionTurn: null,
    formations: { left: 'forward', right: 'forward' },
    bobbles: [],
    ball: { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: 0, y: 0 }, radius: FIELD.ballRadius, lastTouchedBy: null },
    boxes: [],
    fieldObjects: [],
    bumperEvents: [],
    bigBumpersUntilTurn: null,
    beachBallUntilTurn: null,
    pendingIntents: {},
    powerPlayInventories: { left: [], right: [] },
    score: { left: 0, right: 0 },
    swappedGoalsUntilTurn: null,
    events: [{ at: Date.now(), message: `Room ${roomCode} created.` }]
  };
}

export function addPlayer(state: GameState, id: string, name: string, team: TeamId = randomTeam(Math.random), side?: PlayerSide): PlayerState {
  const chosenSide = side ?? chooseSide(state);
  const chosenTeam = state.sideTeams[chosenSide] ?? team;
  const p: PlayerState = {
    id,
    name: sanitizeName(name),
    side: chosenSide,
    team: chosenTeam,
    score: state.score[chosenSide],
    connected: true,
    controlledBobbleIds: []
  };
  state.players[id] = p;
  pushEvent(state, `${p.name} joined ${chosenSide} as ${team}.`);
  return p;
}

export function setPlayerTeam(state: GameState, id: string, team: TeamId) {
  return setSideTeam(state, id, team);
}

export function setSideTeam(state: GameState, id: string, team: TeamId) {
  const player = state.players[id];
  if (!player || !TEAM_IDS.includes(team)) return false;
  state.sideTeams[player.side] = team;
  for (const p of Object.values(state.players)) if (p.side === player.side) p.team = team;
  pushEvent(state, `${player.side} chose ${team} mascot.`);
  return true;
}

export function removePlayer(state: GameState, id: string) {
  if (state.players[id]) {
    state.players[id].connected = false;
    pushEvent(state, `${state.players[id].name} disconnected.`);
  }
}

export function canSelectFormation(state: GameState) {
  return state.phase === 'lobby' || state.formationSelectionTurn === state.turn;
}

export function applyFormation(state: GameState, side: PlayerSide, formation: FormationId) {
  if (!FORMATION_IDS.includes(formation) || !canSelectFormation(state)) return false;
  state.formations[side] = formation;
  if (state.bobbles.some(b => b.side === side)) placeFormation(state, side);
  pushEvent(state, `${side} selected ${formation} formation.`);
  return true;
}

export function startGame(state: GameState, rng: Rng = Math.random) {
  state.phase = 'planning';
  state.winner = null;
  state.formationSelectionTurn = 1;
  state.turn = 1;
  state.score = { left: 0, right: 0 };
  state.boxes = [];
  state.fieldObjects = [];
  state.bumperEvents = [];
  state.bigBumpersUntilTurn = null;
  state.beachBallUntilTurn = null;
  state.pendingIntents = {};
  state.powerPlayInventories = { left: [], right: [] };
  state.swappedGoalsUntilTurn = null;
  state.ball = { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: (rng() - 0.5) * 20, y: 0 }, radius: FIELD.ballRadius, lastTouchedBy: null };
  buildBobbles(state);
  state.kickoffAt = Date.now();
  state.turnDeadlineAt = state.kickoffAt + state.config.turnDurationMs;
  pushEvent(state, `Kickoff! First to ${state.mode}.`);
}

export function resetGame(state: GameState, mode: GameMode, rng: Rng = Math.random) {
  const length = GAME_LENGTHS[mode];
  state.mode = mode;
  state.config = { goalTarget: mode, length: length.length, maxTurns: length.maxTurns, turnDurationMs: TURN_DURATION_MS, boxSpawnEveryTurns: 2, boxSpawnAnchors: ['topMid', 'bottomMid'] };
  state.phase = 'lobby';
  state.formationSelectionTurn = null;
  state.winner = null;
  state.turn = 1;
  state.score = { left: 0, right: 0 };
  state.boxes = [];
  state.fieldObjects = [];
  state.bumperEvents = [];
  state.bigBumpersUntilTurn = null;
  state.beachBallUntilTurn = null;
  state.pendingIntents = {};
  state.powerPlayInventories = { left: [], right: [] };
  state.swappedGoalsUntilTurn = null;
  state.ball = { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: (rng() - 0.5) * 20, y: 0 }, radius: FIELD.ballRadius, lastTouchedBy: null };
  state.kickoffAt = Date.now();
  state.turnDeadlineAt = state.kickoffAt + state.config.turnDurationMs;
  for (const p of Object.values(state.players)) p.score = 0;
  buildBobbles(state);
  pushEvent(state, `Reset to ${length.length} first-to-${mode}.`);
}

export function launchBobble(state: GameState, playerId: string, intent: TurnIntent, _now = Date.now()) {
  if (state.phase !== 'planning') return false;
  const player = state.players[playerId];
  if (!player || !player.connected || !player.controlledBobbleIds.includes(intent.bobbleId)) return false;
  const bobble = state.bobbles.find(b => b.id === intent.bobbleId);
  if (!bobble || bobble.lastLaunchedTurn === state.turn) return false;
  const impulse = Math.max(1, Math.min(900, intent.impulse));
  state.pendingIntents[bobble.id] = { bobbleId: bobble.id, aimAngle: intent.aimAngle, impulse };
  bobble.lastLaunchedTurn = state.turn;
  pushEvent(state, `${player.name} aimed ${bobble.id}.`);
  return true;
}

export function stepGame(state: GameState, _inputs: Record<string, PlayerInput> = {}, now = Date.now(), rng: Rng = Math.random, dtMs = TICK_MS) {
  if (state.phase === 'planning') {
    if (shouldResolveTurn(state, now)) beginResolving(state, now);
    else return;
  }
  if (state.phase !== 'resolving') return;
  const dt = dtMs / 1000;
  expireTurnEffects(state);
  for (const b of state.bobbles) integrateCircle(b.pos, b.vel, b.radius, dt, BOBBLE_DRAG);
  integrateBall(state, dt);
  resolveFieldObjects(state, dt);
  resolveCornerBumpers(state, now);
  resolveBobbleCollisions(state);
  collectBoxesForBobbles(state, now);
  const goal = detectGoal(state);
  if (goal) return handleClassicGoal(state, goal, now, rng);
  const started = state.resolvingStartedAt ?? now;
  if (now - started >= MAX_RESOLVE_MS || allSettled(state)) endTurn(state, now, rng);
}

function shouldResolveTurn(state: GameState, now: number) {
  const required = state.bobbles.map(b => b.id);
  return now >= state.turnDeadlineAt || required.every(id => Boolean(state.pendingIntents[id]));
}

function beginResolving(state: GameState, now: number) {
  for (const intent of Object.values(state.pendingIntents)) {
    const bobble = state.bobbles.find(b => b.id === intent.bobbleId);
    if (!bobble) continue;
    const boost = bobble.effects.some(e => e.type === 'boost' && e.untilTurn >= state.turn) ? 1.35 : 1;
    const bigHead = bobble.effects.some(e => e.type === 'bigHead' && e.untilTurn >= state.turn) ? 1.3 : 1;
    bobble.vel.x += Math.cos(intent.aimAngle) * intent.impulse * boost * bigHead * BOBBLE_IMPULSE_SCALE;
    bobble.vel.y += Math.sin(intent.aimAngle) * intent.impulse * boost * bigHead * BOBBLE_IMPULSE_SCALE;
  }
  state.phase = 'resolving';
  state.resolvingStartedAt = now;
  pushEvent(state, `Turn ${state.turn} resolving with ${Object.keys(state.pendingIntents).length}/${state.bobbles.length} bobbles aimed.`);
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

export function addCheatBoxes(state: GameState, playerIdOrSide: string | PlayerSide) {
  const side = playerIdOrSide === 'left' || playerIdOrSide === 'right' ? playerIdOrSide : state.players[playerIdOrSide]?.side;
  if (!side) return false;
  state.powerPlayInventories[side].push(...BOX_TYPE_IDS.map(type => ({ type, availableTurn: state.turn })));
  pushEvent(state, `CHEAT MODE: ${side} received every Power Play box for testing. All users are warned.`);
  return true;
}

export function rotateFieldObject(state: GameState, playerId: string, id: string, delta = Math.PI / 4) {
  if (state.phase !== 'planning') return false;
  const player = state.players[playerId];
  if (!player || !player.connected) return false;
  const obj = state.fieldObjects.find(o => o.id === id && o.owner === player.side && o.untilTurn >= state.turn);
  if (!obj || !ROTATABLE_FIELD_OBJECTS.includes(obj.type)) return false;
  obj.angle = (obj.angle + delta) % (Math.PI * 2);
  pushEvent(state, `${player.name} rotated a ${obj.type} pad.`);
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
    spawnedAt: now,
    untilTurn: state.turn + BOX_LIFETIME_TURNS - 1
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
    for (const playerId of playerIds) state.players[playerId].controlledBobbleIds = [];
    ids.forEach((bobbleId, i) => {
      if (playerIds.length === 0) return;
      state.players[playerIds[i % playerIds.length]].controlledBobbleIds.push(bobbleId);
    });
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
  const drag = state.beachBallUntilTurn !== null && state.beachBallUntilTurn >= state.turn ? BEACH_BALL_DRAG : BALL_DRAG;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.vel.x *= drag;
  b.vel.y *= drag;
  if (b.pos.y < b.radius) { b.pos.y = b.radius; b.vel.y = Math.abs(b.vel.y) * 0.88; }
  if (b.pos.y > FIELD.height - b.radius) { b.pos.y = FIELD.height - b.radius; b.vel.y = -Math.abs(b.vel.y) * 0.88; }
  const inGoalMouth = b.pos.y > FIELD.goalY && b.pos.y < FIELD.goalY + FIELD.goalHeight;
  if (!inGoalMouth) {
    if (b.pos.x < b.radius) { b.pos.x = b.radius; b.vel.x = Math.abs(b.vel.x) * 0.88; }
    if (b.pos.x > FIELD.width - b.radius) { b.pos.x = FIELD.width - b.radius; b.vel.x = -Math.abs(b.vel.x) * 0.88; }
  }
}

export function bigBumpersActive(state: GameState) {
  return state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn >= state.turn;
}

function resolveCornerBumpers(state: GameState, now: number) {
  const big = bigBumpersActive(state);
  const bumperRadius = big ? BIG_BUMPER_RADIUS : BUMPER_RADIUS;
  const boost = big ? BUMPER_BOOST * 1.6 : BUMPER_BOOST;
  for (const c of BUMPERS) {
    for (const b of state.bobbles) {
      if (staticCircleBounce(b.pos, b.vel, b.radius, c, bumperRadius, 0.92, boost * 0.85)) pushBumperEvent(state, c, now);
    }
    if (staticCircleBounce(state.ball.pos, state.ball.vel, state.ball.radius, c, bumperRadius, 1.04, boost)) pushBumperEvent(state, c, now);
  }
  state.bumperEvents = state.bumperEvents.filter(e => now - e.at < BUMPER_EVENT_TTL_MS).slice(-12);
}

function pushBumperEvent(state: GameState, pos: Vec, now: number) {
  const last = state.bumperEvents[state.bumperEvents.length - 1];
  if (last && last.pos.x === pos.x && last.pos.y === pos.y && now - last.at < 180) return;
  state.bumperEvents.push({ pos: { ...pos }, at: now });
}

function staticCircleBounce(pos: Vec, vel: Vec, radius: number, center: Vec, bumperRadius: number, restitution: number, boost = 0) {
  const dx = pos.x - center.x, dy = pos.y - center.y;
  const d = Math.hypot(dx, dy) || 0.0001;
  const min = radius + bumperRadius;
  if (d >= min) return false;
  const nx = dx / d, ny = dy / d;
  pos.x = center.x + nx * min;
  pos.y = center.y + ny * min;
  const into = vel.x * nx + vel.y * ny;
  if (into < 0) {
    vel.x -= (1 + restitution) * into * nx;
    vel.y -= (1 + restitution) * into * ny;
    vel.x += nx * boost;
    vel.y += ny * boost;
    clampSpeed(vel);
    return true;
  }
  return false;
}

function clampSpeed(vel: Vec, max = MAX_SPEED) {
  const s = Math.hypot(vel.x, vel.y);
  if (s > max) { vel.x *= max / s; vel.y *= max / s; }
}

function resolveFieldObjects(state: GameState, dt: number) {
  const movers: { pos: Vec; vel: Vec; radius: number; ghosted: boolean }[] = [
    { pos: state.ball.pos, vel: state.ball.vel, radius: state.ball.radius, ghosted: false },
    ...state.bobbles.map(b => ({ pos: b.pos, vel: b.vel, radius: b.radius, ghosted: b.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn) }))
  ];
  for (const o of state.fieldObjects) {
    if (o.untilTurn < state.turn) continue;
    for (const m of movers) {
      if (o.type === 'boost') {
        if (dist(m.pos, o.pos) <= 70 + m.radius) {
          m.vel.x += Math.cos(o.angle) * 900 * dt;
          m.vel.y += Math.sin(o.angle) * 900 * dt;
          clampSpeed(m.vel);
        }
      } else if (o.type === 'stickyGoo') {
        if (dist(m.pos, o.pos) <= 80 + m.radius) { m.vel.x *= 0.93; m.vel.y *= 0.93; }
      } else if (o.type === 'block') {
        if (!m.ghosted) segmentBounce(m.pos, m.vel, m.radius, o.pos, o.angle, 60, 14, 0.75);
      } else if (o.type === 'ramp') {
        if (!m.ghosted && segmentBounce(m.pos, m.vel, m.radius, o.pos, o.angle, 55, 12, 1.25)) clampSpeed(m.vel);
      }
    }
  }
}

function segmentBounce(pos: Vec, vel: Vec, radius: number, center: Vec, angle: number, halfLen: number, thickness: number, restitution: number) {
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const relX = pos.x - center.x, relY = pos.y - center.y;
  const along = Math.max(-halfLen, Math.min(halfLen, relX * dirX + relY * dirY));
  const cx = center.x + dirX * along, cy = center.y + dirY * along;
  const dx = pos.x - cx, dy = pos.y - cy;
  const d = Math.hypot(dx, dy) || 0.0001;
  const min = radius + thickness;
  if (d >= min) return false;
  const nx = dx / d, ny = dy / d;
  pos.x = cx + nx * min;
  pos.y = cy + ny * min;
  const into = vel.x * nx + vel.y * ny;
  if (into < 0) {
    vel.x -= (1 + restitution) * into * nx;
    vel.y -= (1 + restitution) * into * ny;
  }
  return true;
}

function resolveBobbleCollisions(state: GameState) {
  for (const b of state.bobbles) {
    if (b.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn)) continue;
    if (circleBounce(b.pos, b.vel, b.radius, state.ball.pos, state.ball.vel, state.ball.radius, 0.95)) state.ball.lastTouchedBy = b.side;
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
  av.x -= nx * j * 0.22; av.y -= ny * j * 0.22; bv.x += nx * j * BALL_MASS_FACTOR; bv.y += ny * j * BALL_MASS_FACTOR;
  return true;
}

function collectBoxesForBobbles(state: GameState, now: number) {
  for (const bobble of [...state.bobbles]) collectPowerBox(state, bobble, now);
  collectPowerBoxWithBall(state);
  // Boxes expire by turn count, never by wall-clock time, so they always
  // survive the planning phase and can be collected during resolution.
  state.boxes = state.boxes.filter(box => (box.untilTurn ?? state.turn) >= state.turn);
}

function collectPowerBoxWithBall(state: GameState) {
  const side = state.ball.lastTouchedBy;
  if (!side) return;
  const index = state.boxes.findIndex(box => dist(box.pos, state.ball.pos) <= state.ball.radius + FIELD.boxSize / 2);
  if (index < 0) return;
  const [box] = state.boxes.splice(index, 1);
  state.powerPlayInventories[side].push({ type: box.type, availableTurn: state.turn + 1 });
  pushEvent(state, `${side} collected ${BOX_TYPES[box.type].label} with the ball.`);
}

function applyPowerPlay(state: GameState, side: PlayerSide, use: PowerPlayUse, now: number) {
  const target = (use.targetBobbleId && state.bobbles.find(b => b.id === use.targetBobbleId)) || state.bobbles.find(b => b.side === side);
  switch (use.type) {
    case 'beachBall': state.ball.radius = FIELD.ballRadius * 1.6; state.beachBallUntilTurn = state.turn; state.ball.vel.x *= 1.25; state.ball.vel.y *= 1.25; break;
    case 'moveBall': state.ball.pos = use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }; state.ball.vel = { x: 0, y: 0 }; break;
    case 'swapGoals': state.swappedGoalsUntilTurn = state.turn + 1; break;
    case 'bigBumpers': state.bigBumpersUntilTurn = state.turn; break;
    case 'boost': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'boost', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: use.angle ?? 0, untilTurn: state.turn + 1 }); if (target) addBobbleEffect(target, 'boost', state.turn + 1); break;
    case 'stickyGoo': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'stickyGoo', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: 0, untilTurn: state.turn + 1 }); break;
    case 'ramp': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'ramp', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: use.angle ?? -Math.PI / 4, untilTurn: state.turn + 1 }); break;
    case 'block': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'block', owner: side, pos: use.position ?? { x: side === 'left' ? 85 : FIELD.width - 85, y: FIELD.height / 2 }, angle: use.angle ?? 0, untilTurn: state.turn + 1 }); break;
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
    if (!b.effects.some(e => e.type === 'bigHead')) b.radius = FIELD.bobbleRadius;
  }
  state.fieldObjects = state.fieldObjects.filter(o => o.untilTurn >= state.turn);
  if (state.swappedGoalsUntilTurn !== null && state.swappedGoalsUntilTurn < state.turn) state.swappedGoalsUntilTurn = null;
  if (state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn < state.turn) state.bigBumpersUntilTurn = null;
  if (state.beachBallUntilTurn !== null && state.beachBallUntilTurn < state.turn) {
    state.beachBallUntilTurn = null;
    state.ball.radius = FIELD.ballRadius;
  }
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
  state.ball = { pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, vel: { x: 0, y: 0 }, radius: FIELD.ballRadius, lastTouchedBy: null };
  placeFormation(state, 'left');
  placeFormation(state, 'right');
  endTurn(state, now, rng, true);
}

function endTurn(state: GameState, now: number, rng: Rng, unlockFormation = false) {
  if (state.turn >= state.config.maxTurns) {
    state.phase = 'finished';
    state.winner = state.score.left === state.score.right ? null : state.score.left > state.score.right ? 'left' : 'right';
    pushEvent(state, state.winner ? `${state.winner} wins on turns!` : 'Turn limit reached: draw.');
    return;
  }
  state.turn += 1;
  state.phase = 'planning';
  state.formationSelectionTurn = unlockFormation ? state.turn : null;
  state.resolvingStartedAt = null;
  state.pendingIntents = {};
  resetForPlanning(state, rng);
  expireTurnEffects(state);
  state.turnDeadlineAt = now + state.config.turnDurationMs;
  if (state.turn % state.config.boxSpawnEveryTurns === 0) spawnBox(state, now, rng);
}

function resetForPlanning(state: GameState, _rng: Rng) {
  // Bobble League turns are tabletop turns: pieces stay where physics resolved,
  // but no momentum carries into the next planning turn.
  state.ball.vel = { x: 0, y: 0 };
  state.ball.lastTouchedBy = null;
  for (const b of state.bobbles) b.vel = { x: 0, y: 0 };
  state.bumperEvents = [];
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
