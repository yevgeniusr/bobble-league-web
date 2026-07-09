import {
  BIG_BUMPER_RADIUS,
  BOX_TYPE_IDS,
  BOX_TYPES,
  BUMPER_RADIUS,
  BUMPERS,
  BabbleState,
  BoxState,
  BoxType,
  FIELD,
  RAMP_HALF_LEN,
  RAMP_HALF_WIDTH,
  ROTATABLE_FIELD_OBJECTS,
  FORMATION_IDS,
  FormationId,
  GAME_LENGTHS,
  GameMode,
  GameState,
  InventoryItem,
  MAPS,
  MapId,
  PlayerInput,
  PlayerSide,
  PlayerState,
  PowerPlayUse,
  TEAM_IDS,
  TeamId,
  TurnIntent,
  Vec,
  normalizeMapId
} from './types';
import { buildAbilityUsedEvent, buildBoxPickupEvent, buildGoalScoredEvent, recordAnalyticsEvent } from './analytics';
import { stepPhysics } from './physics';
import { PHYSICS_CONFIG } from './physicsConfig';
import type { BallImpactObservation } from './airborne';
import {
  BABBLE_RAMP_VERTICAL_VELOCITY,
  BABBLE_REST_HEIGHT,
  BEACH_BALL_RAMP_VERTICAL_VELOCITY,
  BALL_MAX_HEIGHT,
  BALL_RAMP_VERTICAL_VELOCITY,
  BALL_REST_HEIGHT,
  ballImpactLiftVelocity,
  ballRestHeight,
  integrateBabbleVertical,
  integrateBallVertical,
  normalizeBabbleVertical,
  normalizeBallVertical
} from './airborne';

export type Rng = () => number;
export const blankInput: PlayerInput = { up: false, down: false, left: false, right: false, kick: false };

const TICK_MS = 1000 / 30;
// Body integration, damping, wall/block collisions and ball/babble impacts now
// run in Rapier 2D (see shared/physics.ts). The rule layer below keeps the
// tabletop feel knobs: strong pull impulse and lively bumpers/pads/ramps.
export const BABBLE_IMPULSE_SCALE = PHYSICS_CONFIG.babbleImpulseScale;
export const BOX_LIFETIME_TURNS = 3;
export const SETTLE_SPEED = PHYSICS_CONFIG.settleSpeed;
export const MAX_RESOLVE_MS = 8000;
// BABBLE_TURN_MS is a server-side test hook (used by scripts/box-control-check.mjs,
// where headless WebGL is too slow to finish a scripted turn in 15s). Browsers have
// no `process`, so players always get the standard 15s turn.
const TURN_DURATION_MS = (typeof process !== 'undefined' && Number(process.env?.BABBLE_TURN_MS)) || 15000;
const ALL_AIMED_RESOLVE_GRACE_MS = (typeof process !== 'undefined' && Number(process.env?.BABBLE_ALL_AIMED_GRACE_MS)) || 3000;
export const MAX_SPEED = PHYSICS_CONFIG.maxSpeed;
export const BUMPER_BOOST = PHYSICS_CONFIG.bumperBoost;
// Bumper hits are event moments: even a graze exits at a strong minimum speed.
export const BUMPER_MIN_EXIT_BALL = PHYSICS_CONFIG.bumperMinExitBall;
export const BUMPER_MIN_EXIT_BABBLE = PHYSICS_CONFIG.bumperMinExitBabble;
// Low-speed brake: extra per-tick decay below this speed so pieces stop
// crisply instead of gliding for seconds at a visible crawl.
export const LOW_SPEED_BRAKE_THRESHOLD = PHYSICS_CONFIG.lowSpeedBrakeThreshold;
const LOW_SPEED_BRAKE_FACTOR = PHYSICS_CONFIG.lowSpeedBrakeFactor;
// Big Bumpers power play: noticeably stronger corner hits plus higher restitution.
export const BIG_BUMPER_BOOST_MULT = PHYSICS_CONFIG.bigBumperBoostMult;
export const BIG_BUMPER_RESTITUTION = PHYSICS_CONFIG.bigBumperRestitution;
const BUMPER_EVENT_TTL_MS = 1500;
const RAMP_EVENT_TTL_MS = 1500;
// Boost pad acceleration (units/s^2) applied while a mover sits on the pad.
// Tuned strong enough that crossing the pad visibly slingshots the mover.
export const BOOST_PAD_ACCEL = PHYSICS_CONFIG.boostPadAccel;
// Ramp wedge: movers riding up the slope get redirected along the ramp
// direction and launched off the lip at a minimum exit speed.
export const RAMP_LAUNCH_SPEED = PHYSICS_CONFIG.rampLaunchSpeed;
export { BALL_MAX_HEIGHT, BALL_REST_HEIGHT, ballRestHeight } from './airborne';
export { RAMP_HALF_LEN, RAMP_HALF_WIDTH } from './types';

export function createInitialState(roomCode: string, mode: GameMode = 3, mapId: MapId = 'stadium'): GameState {
  const length = GAME_LENGTHS[mode];
  const selectedMap = normalizeMapId(mapId);
  return {
    roomCode,
    phase: 'lobby',
    mode,
    mapId: selectedMap,
    config: matchConfig(mode, selectedMap),
    winner: null,
    turn: 1,
    kickoffAt: Date.now(),
    turnDeadlineAt: Date.now() + TURN_DURATION_MS,
    resolvingStartedAt: null,
    allIntentsReadyAt: null,
    readyPlayerIds: [],
    nextBoxId: 1,
    players: {},
    sideTeams: { left: 'pigs', right: 'tigers' },
    formationSelectionTurn: null,
    formations: { left: 'forward', right: 'forward' },
    babbles: [],
    ball: ballState(),
    boxes: [],
    fieldObjects: [],
    bumperEvents: [],
    rampEvents: [],
    bigBumpersUntilTurn: null,
    beachBallUntilTurn: null,
    pendingIntents: {},
    powerPlayInventories: { left: [], right: [] },
    score: { left: 0, right: 0 },
    swappedGoalsUntilTurn: null,
    events: [{ at: Date.now(), message: `Room ${roomCode} created on ${MAPS[selectedMap].label}.` }]
  };
}

function matchConfig(mode: GameMode, mapId: MapId) {
  const length = GAME_LENGTHS[mode];
  return {
    mapId,
    goalTarget: mode,
    length: length.length,
    maxTurns: length.maxTurns,
    turnDurationMs: TURN_DURATION_MS,
    allAimedResolveGraceMs: ALL_AIMED_RESOLVE_GRACE_MS,
    boxSpawnEveryTurns: 2 as const,
    boxSpawnAnchors: [...MAPS[mapId].layout.boxSpawnAnchors]
  };
}

const mapOf = (state: GameState) => MAPS[normalizeMapId(state.mapId)];
const tune = (state: GameState, key: keyof typeof PHYSICS_CONFIG) => PHYSICS_CONFIG[key] * mapOf(state).physics[key];
const ballState = (vel: Vec = { x: 0, y: 0 }) => ({
  pos: { x: FIELD.width / 2, y: FIELD.height / 2 },
  vel,
  height: BALL_REST_HEIGHT,
  verticalVelocity: 0,
  radius: FIELD.ballRadius,
  lastTouchedBy: null,
  spin: { x: 0, y: 0 }
});

function syncBallVerticalDefaults(state: GameState) {
  const v = normalizeBallVertical(state.ball.radius, state.ball.height, state.ball.verticalVelocity);
  state.ball.height = v.height;
  state.ball.verticalVelocity = v.verticalVelocity;
}

function syncBabbleVerticalDefaults(babble: BabbleState) {
  const v = normalizeBabbleVertical(babble.height, babble.verticalVelocity);
  babble.height = v.height;
  babble.verticalVelocity = v.verticalVelocity;
}

export function setMap(state: GameState, mapId: MapId) {
  const selectedMap = normalizeMapId(mapId);
  if (state.phase !== 'lobby') return false;
  if (state.mapId === selectedMap) return true;
  state.mapId = selectedMap;
  state.config = matchConfig(state.mode, selectedMap);
  state.ball = ballState();
  state.boxes = [];
  state.bumperEvents = [];
  state.rampEvents = [];
  pushEvent(state, `Map changed to ${MAPS[selectedMap].label}.`);
  return true;
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
    controlledBabbleIds: []
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

// Reconnect support: a returning player takes over their old disconnected seat,
// keeping side, team, mascot, controlled babbleheads and any held Power Play box.
export function reclaimPlayer(state: GameState, oldId: string, newId: string): PlayerState | null {
  const old = state.players[oldId];
  if (!old || old.connected || state.players[newId]) return null;
  delete state.players[oldId];
  const p: PlayerState = { ...old, id: newId, connected: true };
  state.players[newId] = p;
  clearReadyVote(state, oldId);
  for (const side of ['left', 'right'] as const) {
    for (const item of state.powerPlayInventories[side]) if (item.holderId === oldId) item.holderId = newId;
  }
  pushEvent(state, `${p.name} reconnected.`);
  return p;
}

// Find a disconnected seat matching this display name (used to auto-reclaim on rejoin).
export function findDisconnectedSeat(state: GameState, name: string): PlayerState | null {
  const clean = sanitizeName(name);
  return Object.values(state.players).find(p => !p.connected && p.name === clean) ?? null;
}

export function removePlayer(state: GameState, id: string) {
  if (state.players[id]) {
    state.players[id].connected = false;
    resetReadyVotes(state);
    pushEvent(state, `${state.players[id].name} disconnected.`);
  }
}

export function canSelectFormation(state: GameState) {
  return state.phase === 'lobby' || state.formationSelectionTurn === state.turn;
}

export function applyFormation(state: GameState, side: PlayerSide, formation: FormationId) {
  if (!FORMATION_IDS.includes(formation) || !canSelectFormation(state)) return false;
  state.formations[side] = formation;
  if (state.babbles.some(b => b.side === side)) placeFormation(state, side);
  pushEvent(state, `${side} selected ${formation} formation.`);
  return true;
}

export function startGame(state: GameState, rng: Rng = Math.random) {
  state.mapId = normalizeMapId(state.mapId);
  state.config = matchConfig(state.mode, state.mapId);
  state.phase = 'planning';
  state.winner = null;
  state.formationSelectionTurn = 1;
  state.turn = 1;
  state.score = { left: 0, right: 0 };
  state.boxes = [];
  state.fieldObjects = [];
  state.bumperEvents = [];
  state.rampEvents = [];
  state.bigBumpersUntilTurn = null;
  state.beachBallUntilTurn = null;
  state.pendingIntents = {};
  state.allIntentsReadyAt = null;
  state.readyPlayerIds = [];
  state.powerPlayInventories = { left: [], right: [] };
  state.swappedGoalsUntilTurn = null;
  state.ball = ballState({ x: (rng() - 0.5) * 20, y: 0 });
  buildBabbles(state);
  state.kickoffAt = Date.now();
  state.turnDeadlineAt = state.kickoffAt + state.config.turnDurationMs;
  pushEvent(state, `Kickoff on ${MAPS[state.mapId].label}! First to ${state.mode}.`);
}

export function resetGame(state: GameState, mode: GameMode, rng: Rng = Math.random) {
  const length = GAME_LENGTHS[mode];
  state.mode = mode;
  state.mapId = normalizeMapId(state.mapId);
  state.config = matchConfig(mode, state.mapId);
  state.phase = 'lobby';
  state.formationSelectionTurn = null;
  state.winner = null;
  state.turn = 1;
  state.score = { left: 0, right: 0 };
  state.boxes = [];
  state.fieldObjects = [];
  state.bumperEvents = [];
  state.rampEvents = [];
  state.bigBumpersUntilTurn = null;
  state.beachBallUntilTurn = null;
  state.pendingIntents = {};
  state.allIntentsReadyAt = null;
  state.readyPlayerIds = [];
  state.powerPlayInventories = { left: [], right: [] };
  state.swappedGoalsUntilTurn = null;
  state.ball = ballState({ x: (rng() - 0.5) * 20, y: 0 });
  state.kickoffAt = Date.now();
  state.turnDeadlineAt = state.kickoffAt + state.config.turnDurationMs;
  for (const p of Object.values(state.players)) p.score = 0;
  buildBabbles(state);
  pushEvent(state, `Reset to ${length.length} first-to-${mode} on ${MAPS[state.mapId].label}.`);
}

export function launchBabble(state: GameState, playerId: string, intent: TurnIntent, _now = Date.now()) {
  if (state.phase !== 'planning') return false;
  const player = state.players[playerId];
  if (!player || !player.connected || !player.controlledBabbleIds.includes(intent.babbleId)) return false;
  const babble = state.babbles.find(b => b.id === intent.babbleId);
  if (!babble) return false;
  const impulse = Math.max(1, Math.min(900, intent.impulse));
  const previous = state.pendingIntents[babble.id];
  state.pendingIntents[babble.id] = { babbleId: babble.id, aimAngle: intent.aimAngle, impulse };
  clearReadyVote(state, playerId);
  if (previous && (previous.aimAngle !== intent.aimAngle || previous.impulse !== impulse)) state.allIntentsReadyAt = null;
  pushEvent(state, `${player.name} aimed ${babble.id}.`);
  return true;
}

export function setPlayerReady(state: GameState, playerId: string, now = Date.now()) {
  if (state.phase !== 'planning') return false;
  const player = state.players[playerId];
  if (!player || !player.connected) return false;
  if (!state.readyPlayerIds.includes(playerId)) {
    state.readyPlayerIds.push(playerId);
    pushEvent(state, `${player.name} is ready to finish the turn.`);
  }
  if (connectedReadyStatus(state).allReady) beginResolving(state, now);
  return true;
}

export function clearReadyVote(state: GameState, playerId: string) {
  const next = state.readyPlayerIds.filter(id => id !== playerId);
  const changed = next.length !== state.readyPlayerIds.length;
  state.readyPlayerIds = next;
  return changed;
}

function resetReadyVotes(state: GameState) {
  state.readyPlayerIds = [];
}

export function connectedReadyStatus(state: GameState) {
  const connected = Object.values(state.players).filter(p => p.connected);
  const ready = state.readyPlayerIds.filter(id => connected.some(p => p.id === id)).length;
  return { ready, total: connected.length, allReady: connected.length > 0 && ready === connected.length };
}

export function stepGame(state: GameState, _inputs: Record<string, PlayerInput> = {}, now = Date.now(), rng: Rng = Math.random, dtMs = TICK_MS) {
  if (state.phase === 'planning') {
    if (shouldResolveTurn(state, now)) beginResolving(state, now);
    else return;
  }
  if (state.phase !== 'resolving') return;
  const dt = dtMs / 1000;
  syncAirborneDefaults(state);
  expireTurnEffects(state);
  // Authoritative rolling spin uses the pre-step velocity so the visual roll
  // matches the distance the ball is about to travel this tick.
  updateBallSpin(state, dt);
  // Rapier 2D handles integration, damping, arena walls (with open goal
  // mouths), placed blocks and every ball/babble collision.
  const physicsResult = stepPhysics(state, dt);
  clampAllSpeeds(state);
  applyBallImpactLift(state, physicsResult.ballBabbleImpacts);
  resolveFieldObjects(state, dt, now);
  resolveCornerBumpers(state, now);
  integrateAirborne(state, dt);
  applyLowSpeedBrake(state);
  collectBoxesForBabbles(state, now);
  const goal = detectGoal(state);
  if (goal) return handleClassicGoal(state, goal, now, rng);
  const started = state.resolvingStartedAt ?? now;
  if (now - started >= MAX_RESOLVE_MS || allSettled(state)) endTurn(state, now, rng);
}

function shouldResolveTurn(state: GameState, now: number) {
  if (connectedReadyStatus(state).allReady) return true;
  const required = state.babbles.map(b => b.id);
  const allReady = required.every(id => Boolean(state.pendingIntents[id]));
  if (!allReady) {
    state.allIntentsReadyAt = null;
    return now >= state.turnDeadlineAt;
  }
  if (state.allIntentsReadyAt === null) state.allIntentsReadyAt = now;
  return now >= state.turnDeadlineAt || now - state.allIntentsReadyAt >= state.config.allAimedResolveGraceMs;
}

function beginResolving(state: GameState, now: number) {
  for (const intent of Object.values(state.pendingIntents)) {
    const babble = state.babbles.find(b => b.id === intent.babbleId);
    if (!babble) continue;
    const boost = babble.effects.some(e => e.type === 'boost' && e.untilTurn >= state.turn) ? 1.35 : 1;
    const bigHead = babble.effects.some(e => e.type === 'bigHead' && e.untilTurn >= state.turn) ? 1.3 : 1;
    const impulseScale = tune(state, 'babbleImpulseScale');
    babble.vel.x += Math.cos(intent.aimAngle) * intent.impulse * boost * bigHead * impulseScale;
    babble.vel.y += Math.sin(intent.aimAngle) * intent.impulse * boost * bigHead * impulseScale;
    babble.lastLaunchedTurn = state.turn;
  }
  state.phase = 'resolving';
  state.resolvingStartedAt = now;
  state.allIntentsReadyAt = null;
  state.readyPlayerIds = [];
  pushEvent(state, `Turn ${state.turn} resolving with ${Object.keys(state.pendingIntents).length}/${state.babbles.length} babbleheads aimed.`);
}

// Every box is carried by a specific player. Picking up a new one replaces that
// holder's previous box so control is never blocked by stale inventory.
export function playerHoldsBox(state: GameState, playerId: string) {
  const side = state.players[playerId]?.side;
  if (!side) return false;
  return state.powerPlayInventories[side].some(i => i.holderId === playerId);
}

function freeHolderFor(state: GameState, side: PlayerSide, collectingBabbleId?: string): PlayerState | null {
  const teammates = Object.values(state.players).filter(p => p.side === side && p.connected);
  const controller = collectingBabbleId ? teammates.find(p => p.controlledBabbleIds.includes(collectingBabbleId)) : undefined;
  if (controller) return controller;
  return teammates.find(p => !playerHoldsBox(state, p.id)) ?? teammates[0] ?? null;
}

function replaceHeldBox(state: GameState, side: PlayerSide, holderId: string, item: InventoryItem) {
  const inventory = state.powerPlayInventories[side];
  const existing = inventory.findIndex(i => i.holderId === holderId);
  if (existing >= 0) inventory.splice(existing, 1, item);
  else inventory.push(item);
}

export function collectPowerBox(state: GameState, babble: BabbleState, now = Date.now()) {
  const index = state.boxes.findIndex(box => dist(box.pos, babble.pos) <= babble.radius + FIELD.boxSize / 2);
  if (index < 0) return false;
  const holder = freeHolderFor(state, babble.side, babble.id);
  if (!holder) return false;
  const [box] = state.boxes.splice(index, 1);
  const replaced = state.powerPlayInventories[babble.side].find(i => i.holderId === holder.id);
  const item: InventoryItem = { type: box.type, availableTurn: state.turn + 1, holderId: holder.id };
  replaceHeldBox(state, babble.side, holder.id, item);
  recordAnalyticsEvent(state, buildBoxPickupEvent(state, { box, holderId: holder.id, holderSide: babble.side, collectorBabbleId: babble.id, pickupMethod: 'babble', replacedAbilityType: replaced?.type, now }));
  // never reveal the box type in the public event feed: it is team-private
  pushEvent(state, `${holder.name} grabbed a mystery box.`);
  return true;
}

export function usePowerPlay(state: GameState, playerId: string, use: PowerPlayUse, now = Date.now()) {
  const player = state.players[playerId];
  if (!player || !player.connected) return false;
  const inventory = state.powerPlayInventories[player.side];
  // players may only spend the box they personally hold (legacy holder-less items stay usable)
  const itemIndex = inventory.findIndex(item => item.type === use.type && item.availableTurn <= state.turn && (!item.holderId || item.holderId === playerId));
  if (itemIndex < 0) return false;
  inventory.splice(itemIndex, 1);
  applyPowerPlay(state, player.side, use, now);
  recordAnalyticsEvent(state, buildAbilityUsedEvent(state, playerId, use, now));
  clearReadyVote(state, playerId);
  pushEvent(state, `${player.name} used ${BOX_TYPES[use.type].label}.`);
  return true;
}

export function addCheatBoxes(state: GameState, playerIdOrSide: string | PlayerSide) {
  const side = playerIdOrSide === 'left' || playerIdOrSide === 'right' ? playerIdOrSide : state.players[playerIdOrSide]?.side;
  if (!side) return false;
  const holderId = playerIdOrSide === 'left' || playerIdOrSide === 'right' ? undefined : playerIdOrSide;
  state.powerPlayInventories[side].push(...BOX_TYPE_IDS.map(type => ({ type, availableTurn: state.turn, holderId })));
  pushEvent(state, `CHEAT MODE: ${side} received every Power Play box for testing. All users are warned.`);
  return true;
}

export function rotateFieldObject(state: GameState, playerId: string, id: string, delta = Math.PI / 4) {
  const obj = ownedRotatable(state, playerId, id);
  if (!obj) return false;
  obj.angle = (obj.angle + delta) % (Math.PI * 2);
  clearReadyVote(state, playerId);
  pushEvent(state, `${state.players[playerId].name} rotated a ${obj.type} pad.`);
  return true;
}

// Drag-hold rotation: set an absolute facing angle on an owned rotatable pad.
export function setFieldObjectAngle(state: GameState, playerId: string, id: string, angle: number) {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) return false;
  const obj = ownedRotatable(state, playerId, id);
  if (!obj) return false;
  obj.angle = angle % (Math.PI * 2);
  clearReadyVote(state, playerId);
  return true;
}

function ownedRotatable(state: GameState, playerId: string, id: string) {
  if (state.phase !== 'planning') return null;
  const player = state.players[playerId];
  if (!player || !player.connected) return null;
  const obj = state.fieldObjects.find(o => o.id === id && o.owner === player.side && o.untilTurn >= state.turn);
  if (!obj || !ROTATABLE_FIELD_OBJECTS.includes(obj.type)) return null;
  return obj;
}

// Cheat panel: grant exactly one testing copy of a Power Play. Repeated clicks
// never duplicate an unused cheat item; using it up allows granting again.
export function grantCheatBox(state: GameState, playerIdOrSide: string | PlayerSide, type: BoxType) {
  const side = playerIdOrSide === 'left' || playerIdOrSide === 'right' ? playerIdOrSide : state.players[playerIdOrSide]?.side;
  if (!side || !BOX_TYPE_IDS.includes(type)) return false;
  if (state.powerPlayInventories[side].some(item => item.type === type)) return false;
  const holderId = playerIdOrSide === 'left' || playerIdOrSide === 'right' ? undefined : playerIdOrSide;
  state.powerPlayInventories[side].push({ type, availableTurn: state.turn, holderId });
  pushEvent(state, `CHEAT MODE: ${side} granted one ${BOX_TYPES[type].label} for testing. All users are warned.`);
  return true;
}

// Redact team-private inventory details for a specific viewer: only your own
// team's box types/holders are visible; opponents just see how many are held.
export function redactStateFor(state: GameState, viewerId: string): GameState {
  const side = state.players[viewerId]?.side;
  return {
    ...state,
    powerPlayInventories: {
      left: side === 'left' ? state.powerPlayInventories.left : [],
      right: side === 'right' ? state.powerPlayInventories.right : []
    },
    powerPlayCounts: {
      left: state.powerPlayInventories.left.length,
      right: state.powerPlayInventories.right.length
    }
  };
}

export function spawnBox(state: GameState, now = Date.now(), rng: Rng = Math.random): BoxState {
  const anchors = state.config.boxSpawnAnchors.length ? state.config.boxSpawnAnchors : mapOf(state).layout.boxSpawnAnchors;
  const anchor = anchors[Math.floor(rng() * anchors.length)] ?? 'topMid';
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

function buildBabbles(state: GameState) {
  state.babbles = [];
  for (const side of ['left', 'right'] as const) {
    const playerIds = Object.values(state.players).filter(p => p.side === side).map(p => p.id);
    const ids = Array.from({ length: 4 }, (_, i) => `${side}-${i + 1}`);
    for (const playerId of playerIds) state.players[playerId].controlledBabbleIds = [];
    ids.forEach((babbleId, i) => {
      if (playerIds.length === 0) return;
      state.players[playerIds[i % playerIds.length]].controlledBabbleIds.push(babbleId);
    });
    for (let i = 0; i < 4; i++) {
      state.babbles.push({
        id: ids[i],
        side,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        height: BABBLE_REST_HEIGHT,
        verticalVelocity: 0,
        radius: FIELD.babbleRadius,
        effects: [],
        lastLaunchedTurn: 0
      });
    }
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
  const babbles = state.babbles.filter(b => b.side === side).sort((a, b) => a.id.localeCompare(b.id));
  layouts[formation].forEach((offset, i) => {
    const babble = babbles[i];
    if (!babble) return;
    babble.pos = { x: baseX + offset.x * sign, y: FIELD.height / 2 + offset.y };
    babble.vel = { x: 0, y: 0 };
    babble.height = BABBLE_REST_HEIGHT;
    babble.verticalVelocity = 0;
    babble.radius = FIELD.babbleRadius;
  });
}

// Authoritative rolling spin: angular displacement = travelled distance / radius.
function updateBallSpin(state: GameState, dt: number) {
  const b = state.ball;
  if (!b.spin) b.spin = { x: 0, y: 0 };
  b.spin.x += (b.vel.x * dt) / b.radius;
  b.spin.y += (b.vel.y * dt) / b.radius;
}

function clampAllSpeeds(state: GameState) {
  const max = tune(state, 'maxSpeed');
  clampSpeed(state.ball.vel, max);
  for (const b of state.babbles) clampSpeed(b.vel, max);
}

// Below the brake threshold pieces decay extra fast, so turns end with a crisp
// stop instead of a long low-speed glide (settling feels immediate).
function applyLowSpeedBrake(state: GameState) {
  const threshold = tune(state, 'lowSpeedBrakeThreshold');
  const factor = Math.min(0.99, tune(state, 'lowSpeedBrakeFactor'));
  for (const vel of [state.ball.vel, ...state.babbles.map(b => b.vel)]) {
    const s = Math.hypot(vel.x, vel.y);
    if (s > 0 && s < threshold) {
      vel.x *= factor;
      vel.y *= factor;
    }
  }
}

function syncAirborneDefaults(state: GameState) {
  syncBallVerticalDefaults(state);
  for (const b of state.babbles) syncBabbleVerticalDefaults(b);
}

function beachBallActive(state: GameState) {
  return state.beachBallUntilTurn !== null && state.beachBallUntilTurn >= state.turn;
}

function applyBallImpactLift(state: GameState, impacts: readonly BallImpactObservation[]) {
  const lift = ballImpactLiftVelocity(impacts, beachBallActive(state));
  if (lift > 0) state.ball.verticalVelocity = Math.max(state.ball.verticalVelocity, lift);
  for (const impact of impacts) {
    const hop = Math.max(0, Math.min(BABBLE_RAMP_VERTICAL_VELOCITY * 0.82, (impact.impactSpeed - 260) / 420));
    if (hop > 0) launchBabbleHop(state, impact.babbleId, hop);
  }
}

function launchBallAirborne(state: GameState, verticalVelocity: number) {
  syncBallVerticalDefaults(state);
  state.ball.verticalVelocity = Math.max(state.ball.verticalVelocity, verticalVelocity);
}

function launchBabbleHop(state: GameState, babbleId: string | undefined, verticalVelocity: number) {
  if (!babbleId) return;
  const babble = state.babbles.find(b => b.id === babbleId);
  if (!babble) return;
  syncBabbleVerticalDefaults(babble);
  babble.verticalVelocity = Math.max(babble.verticalVelocity, verticalVelocity);
}

function integrateAirborne(state: GameState, dt: number) {
  const ball = integrateBallVertical(state.ball, state.ball.radius, dt, beachBallActive(state));
  state.ball.height = ball.height;
  state.ball.verticalVelocity = ball.verticalVelocity;
  for (const b of state.babbles) {
    const next = integrateBabbleVertical(b.height, b.verticalVelocity, dt);
    b.height = next.height;
    b.verticalVelocity = next.verticalVelocity;
  }
}

export function bigBumpersActive(state: GameState) {
  return state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn >= state.turn;
}

function resolveCornerBumpers(state: GameState, now: number) {
  const big = bigBumpersActive(state);
  const map = mapOf(state);
  const bumperRadius = big ? map.layout.bigBumperRadius : map.layout.bumperRadius;
  const baseBoost = tune(state, 'bumperBoost');
  const boost = big ? baseBoost * tune(state, 'bigBumperBoostMult') : baseBoost;
  const maxSpeed = tune(state, 'maxSpeed');
  for (const c of map.layout.bumpers) {
    for (const b of state.babbles) {
      if (staticCircleBounce(b.pos, b.vel, b.radius, c, bumperRadius, big ? 1.05 : 0.92, boost * 0.85, tune(state, 'bumperMinExitBabble'), maxSpeed)) pushBumperEvent(state, c, now);
    }
    if (staticCircleBounce(state.ball.pos, state.ball.vel, state.ball.radius, c, bumperRadius, big ? tune(state, 'bigBumperRestitution') : 1.04, boost, tune(state, 'bumperMinExitBall'), maxSpeed)) pushBumperEvent(state, c, now);
  }
  state.bumperEvents = state.bumperEvents.filter(e => now - e.at < BUMPER_EVENT_TTL_MS).slice(-12);
}

function pushBumperEvent(state: GameState, pos: Vec, now: number) {
  const last = state.bumperEvents[state.bumperEvents.length - 1];
  if (last && last.pos.x === pos.x && last.pos.y === pos.y && now - last.at < 180) return;
  state.bumperEvents.push({ pos: { ...pos }, at: now });
}

function staticCircleBounce(pos: Vec, vel: Vec, radius: number, center: Vec, bumperRadius: number, restitution: number, boost = 0, minExitSpeed = 0, maxSpeed = MAX_SPEED) {
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
    // Min-exit speed: weak grazes still leave the bumper as a real hit, so
    // every bumper contact reads as an intentional pinball moment.
    const exit = Math.hypot(vel.x, vel.y);
    if (exit > 0 && exit < minExitSpeed) {
      vel.x *= minExitSpeed / exit;
      vel.y *= minExitSpeed / exit;
    }
    clampSpeed(vel, maxSpeed);
    return true;
  }
  return false;
}

function clampSpeed(vel: Vec, max = MAX_SPEED) {
  const s = Math.hypot(vel.x, vel.y);
  if (s > max) { vel.x *= max / s; vel.y *= max / s; }
}

function resolveFieldObjects(state: GameState, dt: number, now = Date.now()) {
  const boostPadAccel = tune(state, 'boostPadAccel');
  const rampLaunchSpeed = tune(state, 'rampLaunchSpeed');
  const maxSpeed = tune(state, 'maxSpeed');
  const movers: { pos: Vec; vel: Vec; radius: number; ghosted: boolean; mover: 'ball' | 'babble'; moverId?: string }[] = [
    { pos: state.ball.pos, vel: state.ball.vel, radius: state.ball.radius, ghosted: false, mover: 'ball' },
    ...state.babbles.map(b => ({ pos: b.pos, vel: b.vel, radius: b.radius, ghosted: b.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn), mover: 'babble' as const, moverId: b.id }))
  ];
  for (const o of state.fieldObjects) {
    if (o.untilTurn < state.turn) continue;
    for (const m of movers) {
      if (o.type === 'boost') {
        if (dist(m.pos, o.pos) <= 70 + m.radius) {
          m.vel.x += Math.cos(o.angle) * boostPadAccel * dt;
          m.vel.y += Math.sin(o.angle) * boostPadAccel * dt;
          clampSpeed(m.vel, maxSpeed);
        }
      } else if (o.type === 'stickyGoo') {
        if (dist(m.pos, o.pos) <= 80 + m.radius) { m.vel.x *= 0.93; m.vel.y *= 0.93; }
      } else if (o.type === 'ramp') {
        if (!m.ghosted && resolveRamp(m.pos, m.vel, m.radius, o.pos, o.angle, rampLaunchSpeed, maxSpeed) === 'launch') {
          if (m.mover === 'ball') launchBallAirborne(state, beachBallActive(state) ? BEACH_BALL_RAMP_VERTICAL_VELOCITY : BALL_RAMP_VERTICAL_VELOCITY);
          else launchBabbleHop(state, m.moverId, BABBLE_RAMP_VERTICAL_VELOCITY);
          pushRampEvent(state, o.pos, m.mover, m.moverId, now);
        }
      }
    }
  }
  state.rampEvents = state.rampEvents.filter(e => now - e.at < RAMP_EVENT_TTL_MS).slice(-8);
}

// Debounced ramp launch events drive the client-side launch hop animation.
function pushRampEvent(state: GameState, pos: Vec, mover: 'ball' | 'babble', moverId: string | undefined, now: number) {
  const last = [...state.rampEvents].reverse().find(e => e.mover === mover && e.moverId === moverId);
  if (last && now - last.at < 450) return;
  state.rampEvents.push({ pos: { ...pos }, at: now, mover, moverId });
}

// Ramp wedge physics: movers travelling with the ramp direction ride up the
// slope, get aligned to the ramp's facing and launched off the lip; movers
// hitting the tall back face bounce off like a wall.
function resolveRamp(pos: Vec, vel: Vec, radius: number, center: Vec, angle: number, launchSpeed = RAMP_LAUNCH_SPEED, maxSpeed = MAX_SPEED): 'launch' | 'wall' | false {
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const relX = pos.x - center.x, relY = pos.y - center.y;
  const along = relX * dirX + relY * dirY;
  const lateral = -relX * dirY + relY * dirX;
  if (Math.abs(along) > RAMP_HALF_LEN + radius || Math.abs(lateral) > RAMP_HALF_WIDTH + radius) return false;
  const into = vel.x * dirX + vel.y * dirY;
  if (into >= 0) {
    // riding up the wedge: redirect along the ramp and guarantee launch speed
    const speed = Math.hypot(vel.x, vel.y);
    const exit = Math.max(speed, launchSpeed);
    vel.x = dirX * exit;
    vel.y = dirY * exit;
    clampSpeed(vel, maxSpeed);
    return 'launch';
  }
  // hitting the tall back of the wedge: push out and reflect
  pos.x = center.x + dirX * (RAMP_HALF_LEN + radius) - dirY * lateral;
  pos.y = center.y + dirY * (RAMP_HALF_LEN + radius) + dirX * lateral;
  vel.x -= 1.8 * into * dirX;
  vel.y -= 1.8 * into * dirY;
  return 'wall';
}

function collectBoxesForBabbles(state: GameState, now: number) {
  for (const babble of [...state.babbles]) collectPowerBox(state, babble, now);
  collectPowerBoxWithBall(state, now);
  // Boxes expire by turn count, never by wall-clock time, so they always
  // survive the planning phase and can be collected during resolution.
  state.boxes = state.boxes.filter(box => (box.untilTurn ?? state.turn) >= state.turn);
}

function collectPowerBoxWithBall(state: GameState, now: number) {
  const side = state.ball.lastTouchedBy;
  if (!side) return;
  const index = state.boxes.findIndex(box => dist(box.pos, state.ball.pos) <= state.ball.radius + FIELD.boxSize / 2);
  if (index < 0) return;
  const holder = freeHolderFor(state, side);
  if (!holder) return;
  const [box] = state.boxes.splice(index, 1);
  const replaced = state.powerPlayInventories[side].find(i => i.holderId === holder.id);
  replaceHeldBox(state, side, holder.id, { type: box.type, availableTurn: state.turn + 1, holderId: holder.id });
  recordAnalyticsEvent(state, buildBoxPickupEvent(state, { box, holderId: holder.id, holderSide: side, pickupMethod: 'ball', replacedAbilityType: replaced?.type, now }));
  pushEvent(state, `${holder.name} grabbed a mystery box with the ball.`);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// Client positions are untrusted: reject non-finite vectors and keep teleports inside the field.
function safeFieldPos(p: Vec | undefined, fallback: Vec, margin: number): Vec {
  const src = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : fallback;
  return { x: clamp(src.x, margin, FIELD.width - margin), y: clamp(src.y, margin, FIELD.height - margin) };
}

function applyPowerPlay(state: GameState, side: PlayerSide, use: PowerPlayUse, now: number) {
  const target = (use.targetBabbleId && state.babbles.find(b => b.id === use.targetBabbleId)) || state.babbles.find(b => b.side === side);
  switch (use.type) {
    case 'beachBall':
      state.ball.radius = FIELD.ballRadius * 1.6;
      state.beachBallUntilTurn = state.turn;
      state.ball.height = Math.max(ballRestHeight(state.ball.radius), state.ball.height);
      state.ball.verticalVelocity = Math.max(state.ball.verticalVelocity, BEACH_BALL_RAMP_VERTICAL_VELOCITY * 0.45);
      state.ball.vel.x *= 1.25;
      state.ball.vel.y *= 1.25;
      break;
    case 'moveBall':
      state.ball.pos = safeFieldPos(use.position, { x: FIELD.width / 2, y: FIELD.height / 2 }, state.ball.radius);
      state.ball.vel = { x: 0, y: 0 };
      state.ball.height = ballRestHeight(state.ball.radius);
      state.ball.verticalVelocity = 0;
      state.ball.lastTouchedBy = null;
      break;
    case 'swapGoals': state.swappedGoalsUntilTurn = state.turn + 1; break;
    case 'bigBumpers': state.bigBumpersUntilTurn = state.turn; break;
    case 'boost': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'boost', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: use.angle ?? 0, untilTurn: state.turn + 1 }); if (target) addBabbleEffect(target, 'boost', state.turn + 1); break;
    case 'stickyGoo': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'stickyGoo', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: 0, untilTurn: state.turn + 1 }); break;
    case 'ramp': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'ramp', owner: side, pos: use.position ?? { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: use.angle ?? -Math.PI / 4, untilTurn: state.turn + 1 }); break;
    case 'block': state.fieldObjects.push({ id: `field-${state.nextBoxId++}`, type: 'block', owner: side, pos: use.position ?? { x: side === 'left' ? 85 : FIELD.width - 85, y: FIELD.height / 2 }, angle: use.angle ?? 0, untilTurn: state.turn + 1 }); break;
    case 'bigHead': if (target) { target.radius = FIELD.babbleRadius * 1.45; addBabbleEffect(target, 'bigHead', state.turn + 1); } break;
    case 'ghosted': if (target) addBabbleEffect(target, 'ghosted', state.turn + 1); break;
    case 'movePlayer': if (target) { target.pos = safeFieldPos(use.position, { x: side === 'left' ? FIELD.width * 0.42 : FIELD.width * 0.58, y: FIELD.height / 2 }, target.radius); target.vel = { x: 0, y: 0 }; target.height = BABBLE_REST_HEIGHT; target.verticalVelocity = 0; } break;
  }
}

function addBabbleEffect(babble: BabbleState, type: BoxType, untilTurn: number) {
  babble.effects = babble.effects.filter(e => e.type !== type);
  babble.effects.push({ type, untilTurn });
}

function expireTurnEffects(state: GameState) {
  for (const b of state.babbles) {
    b.effects = b.effects.filter(e => e.untilTurn >= state.turn);
    if (!b.effects.some(e => e.type === 'bigHead')) b.radius = FIELD.babbleRadius;
  }
  state.fieldObjects = state.fieldObjects.filter(o => o.untilTurn >= state.turn);
  if (state.swappedGoalsUntilTurn !== null && state.swappedGoalsUntilTurn < state.turn) state.swappedGoalsUntilTurn = null;
  if (state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn < state.turn) state.bigBumpersUntilTurn = null;
  if (state.beachBallUntilTurn !== null && state.beachBallUntilTurn < state.turn) {
    state.beachBallUntilTurn = null;
    state.ball.radius = FIELD.ballRadius;
    state.ball.height = ballRestHeight(state.ball.radius);
    state.ball.verticalVelocity = 0;
  }
}

// Goal trigger tolerance: any penetration of the goal-line plane deeper than
// this scores. Outside the mouth the walls clamp the ball at exactly pos.x ==
// radius, so the epsilon keeps wall-contact jitter from ever counting.
export const GOAL_TRIGGER_EPS = 0.5;

function detectGoal(state: GameState): PlayerSide | null {
  const b = state.ball;
  if (b.pos.y < FIELD.goalY || b.pos.y > FIELD.goalY + FIELD.goalHeight) return null;
  const swapped = state.swappedGoalsUntilTurn !== null && state.swappedGoalsUntilTurn >= state.turn;
  const leftGoalScorer: PlayerSide = swapped ? 'left' : 'right';
  const rightGoalScorer: PlayerSide = swapped ? 'right' : 'left';
  // Score as soon as the ball overlaps the goal mouth plane. There is no dead
  // pocket: the ball can never rest inside a gate without the goal counting.
  if (b.pos.x < b.radius - GOAL_TRIGGER_EPS) return leftGoalScorer;
  if (b.pos.x > FIELD.width - b.radius + GOAL_TRIGGER_EPS) return rightGoalScorer;
  return null;
}

function handleClassicGoal(state: GameState, scorer: PlayerSide, now: number, rng: Rng) {
  const lastTouchedBy = state.ball.lastTouchedBy;
  const ballPosition = { ...state.ball.pos };
  state.score[scorer] += 1;
  state.readyPlayerIds = [];
  for (const p of Object.values(state.players)) if (p.side === scorer) p.score = state.score[scorer];
  pushEvent(state, `${scorer === 'left' ? 'Left' : 'Right'} scores!`);
  if (state.score[scorer] >= state.mode) {
    state.phase = 'finished';
    state.winner = scorer;
    pushEvent(state, `${scorer} wins first-to-${state.mode}!`);
    recordAnalyticsEvent(state, buildGoalScoredEvent(state, { scoringSide: scorer, lastTouchedBy, ballPosition, now }));
    return;
  }
  recordAnalyticsEvent(state, buildGoalScoredEvent(state, { scoringSide: scorer, lastTouchedBy, ballPosition, now }));
  state.ball = ballState();
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
  state.allIntentsReadyAt = null;
  state.readyPlayerIds = [];
  resetForPlanning(state, rng);
  expireTurnEffects(state);
  state.turnDeadlineAt = now + state.config.turnDurationMs;
  if (state.turn % state.config.boxSpawnEveryTurns === 0) spawnBox(state, now, rng);
}

function resetForPlanning(state: GameState, _rng: Rng) {
  // Babble League turns are tabletop turns: pieces stay where physics resolved,
  // but no momentum carries into the next planning turn.
  state.ball.vel = { x: 0, y: 0 };
  state.ball.height = ballRestHeight(state.ball.radius);
  state.ball.verticalVelocity = 0;
  state.ball.lastTouchedBy = null;
  for (const b of state.babbles) {
    b.vel = { x: 0, y: 0 };
    b.height = BABBLE_REST_HEIGHT;
    b.verticalVelocity = 0;
  }
  state.bumperEvents = [];
  state.rampEvents = [];
  state.kickoffAt = Date.now();
}

function allSettled(state: GameState) {
  const speeds = [Math.hypot(state.ball.vel.x, state.ball.vel.y), ...state.babbles.map(b => Math.hypot(b.vel.x, b.vel.y))];
  const ballRested = Math.abs(state.ball.verticalVelocity) < 0.05 && state.ball.height <= ballRestHeight(state.ball.radius) + 0.015;
  return ballRested && speeds.every(s => s < tune(state, 'settleSpeed'));
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
