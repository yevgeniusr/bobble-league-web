// Rapier 3D physics core for Babble League.
//
// Coordinate mapping is intentionally explicit and stable:
//   field x -> Rapier world x
//   field y -> Rapier world z
//   height  -> Rapier world y
//
// GameState remains the protocol/source-of-truth boundary. Each tick writes
// public state into a persistent Rapier world, steps true 3D gravity/contacts,
// then projects field-plane position/velocity plus vertical height/velocity
// back to the public state shape.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';
import type { BallImpactObservation } from './airborne';
import {
  BALL_MAX_HEIGHT,
  BABBLE_GRAVITY,
  babbleRestHeight,
  ballGravity,
  ballRestHeight,
  normalizeBabbleVertical,
  normalizeBallVertical
} from './airborne';
import { FIELD, GameState, MAPS, PlayerSide, Vec, normalizeMapId } from './types';
import { PHYSICS_CONFIG } from './physicsConfig';

// Rapier is tuned for meter-scale numbers; the field is 1100x620 px.
export const PX_PER_METER = 50;

// Convert the legacy per-tick velocity drags (applied at 30Hz) into continuous
// linear damping so the tabletop deceleration feel is preserved.
const LEGACY_TICK_HZ = 30;
const dampingFromDrag = (dragPerTick: number) => -Math.log(dragPerTick) * LEGACY_TICK_HZ;

const WORLD_GRAVITY = BABBLE_GRAVITY;
const mapOf = (state: GameState) => MAPS[normalizeMapId(state.mapId)];
const tune = (state: GameState, key: keyof typeof PHYSICS_CONFIG) => PHYSICS_CONFIG[key] * mapOf(state).physics[key];
const dragTune = (state: GameState, key: 'babbleDragPerTick' | 'ballDragPerTick' | 'beachBallDragPerTick') =>
  Math.max(0.5, Math.min(0.995, tune(state, key)));

// Collision groups (16-bit membership << 16 | 16-bit filter).
const G_BALL = 0x0001;
const G_BABBLE = 0x0002;
const G_GHOST = 0x0004; // ghosted babbles: pass through ball, babbles, blocks
const G_ARENA = 0x0008; // floor + outer walls
const G_MOUTH = 0x0010; // goal-mouth strips: stop babbles, let the ball in
const G_BLOCK = 0x0020; // placed Block power-play walls
const G_BACK = 0x0040; // goal back walls behind the mouth (ball only)
const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;
const BALL_GROUPS = groups(G_BALL, G_BABBLE | G_ARENA | G_BLOCK | G_BACK);
const BABBLE_GROUPS = groups(G_BABBLE, G_BALL | G_BABBLE | G_ARENA | G_MOUTH | G_BLOCK);
const GHOST_GROUPS = groups(G_GHOST, G_ARENA | G_MOUTH);
const ARENA_GROUPS = groups(G_ARENA, G_BALL | G_BABBLE | G_GHOST);
const MOUTH_GROUPS = groups(G_MOUTH, G_BABBLE | G_GHOST);
const BLOCK_GROUPS = groups(G_BLOCK, G_BALL | G_BABBLE);
const BACK_GROUPS = groups(G_BACK, G_BALL);

const WALL_HALF_THICKNESS = 1; // meters (50px): thick walls + CCD stop tunneling
const WALL_HALF_HEIGHT = 2.5;
const FLOOR_HALF_THICKNESS = 0.25;
const BLOCK_HALF_LEN = 60 / PX_PER_METER;
const BLOCK_HALF_THICKNESS = 14 / PX_PER_METER;
const BLOCK_HALF_HEIGHT = WALL_HALF_HEIGHT;
const REST_EPS = 0.004;

// -compat builds expose an async init that instantiates the inlined WASM.
// Top-level await: server/tests wait for it once at module load. The browser
// bundle never imports this module.
await (RAPIER.init as (options?: unknown) => Promise<void>)({});

interface BabbleEntry {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  ghosted: boolean;
}

interface PhysicsCache {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  mapId: string;
  ballBody: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  ballRadius: number;
  beachy: boolean;
  babbles: Map<string, BabbleEntry>;
  babbleKey: string;
  blocksKey: string;
  blockColliders: RAPIER.Collider[];
}

const caches = new WeakMap<GameState, PhysicsCache>();
export type PhysicsStepResult = { ballBabbleImpacts: BallImpactObservation[] };

type BabbleImpactSnapshot = {
  id: string;
  side: PlayerSide;
  pos: Vec;
  vel: Vec;
};

export function freePhysics(state: GameState) {
  const cache = caches.get(state);
  if (!cache) return;
  cache.events.free();
  cache.world.free();
  caches.delete(state);
}

export function stepPhysics(state: GameState, dt: number): PhysicsStepResult {
  const cache = getCache(state);
  const { world, events } = cache;
  const result: PhysicsStepResult = { ballBabbleImpacts: [] };
  world.timestep = dt;
  syncBlocks(state, cache);
  syncBall(state, cache);
  const ballPreStep = {
    pos: { ...state.ball.pos },
    vel: { ...state.ball.vel }
  };
  const touchable = new Map<number, BabbleImpactSnapshot>();
  for (const b of state.babbles) syncBabble(state, cache, b, touchable);

  world.step(events);

  projectBall(state, cache.ballBody);
  for (const b of state.babbles) projectBabble(b, cache.babbles.get(b.id)!.body);

  // Ball possession. A babble still pressed against the ball (dribbling)
  // fires its collision event only once in a persistent world, so first
  // credit any non-ghosted babble overlapping the ball after the step.
  for (const b of state.babbles) {
    if (cache.babbles.get(b.id)!.ghosted) continue;
    const planar = Math.hypot(b.pos.x - state.ball.pos.x, b.pos.y - state.ball.pos.y);
    const vertical = (state.ball.height ?? ballRestHeight(state.ball.radius)) - (b.height ?? babbleRestHeight(b.radius));
    const contactRadius = (ballColliderRadius(state.ball.radius) + babbleColliderRadius(b.radius)) * PX_PER_METER;
    const gap = Math.hypot(planar, vertical * PX_PER_METER) - contactRadius;
    if (gap <= 2) recordBallTouch(state, b.id, b.side); // 2px: restitution separates ~2px/tick
  }
  // ...then let fresh impacts this tick take precedence (a fast bounce can
  // separate within one step and would be missed by the overlap scan).
  const ballHandle = cache.ballCollider.handle;
  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const other = h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;
    if (other === null) return;
    const babble = touchable.get(other);
    if (babble) {
      recordBallTouch(state, babble.id, babble.side);
      const impact = ballBabbleImpact(ballPreStep, babble);
      if (impact) result.ballBabbleImpacts.push(impact);
    }
  });
  return result;
}

function recordBallTouch(state: GameState, babbleId: string, side: PlayerSide) {
  state.ball.lastTouchedBy = side;
  state.ball.lastTouchedBabbleId = babbleId;
  state.ball.lastTouchedPlayerId = Object.values(state.players).find(p => p.side === side && p.controlledBabbleIds.includes(babbleId))?.id ?? null;
}

const isBeachy = (state: GameState) =>
  state.beachBallUntilTurn !== null && state.beachBallUntilTurn >= state.turn;

const babbleKeyOf = (state: GameState) => state.babbles.map(b => b.id).join(',');

function getCache(state: GameState): PhysicsCache {
  const existing = caches.get(state);
  // The babble roster is fixed after startGame; if a test swaps it, rebuild.
  if (existing && existing.babbleKey === babbleKeyOf(state) && existing.mapId === normalizeMapId(state.mapId)) return existing;
  if (existing) freePhysics(state);
  const cache = buildCache(state);
  caches.set(state, cache);
  return cache;
}

function buildCache(state: GameState): PhysicsCache {
  const world = new RAPIER.World({ x: 0, y: -WORLD_GRAVITY, z: 0 });
  world.maxCcdSubsteps = 4;
  buildArena(world, state);
  const beachy = isBeachy(state);
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(beachy ? dampingFromDrag(dragTune(state, 'beachBallDragPerTick')) : dampingFromDrag(dragTune(state, 'ballDragPerTick')))
      .setAngularDamping(0.45)
      .setGravityScale(ballGravity(beachy) / WORLD_GRAVITY)
      .setCanSleep(false)
  );
  // The beach ball grows but keeps its mass, so it floats farther, not heavier.
  const ballCollider = world.createCollider(
    RAPIER.ColliderDesc.ball(ballColliderRadius(state.ball.radius))
      .setFriction(0.18)
      .setRestitution(tune(state, 'ballRestitution'))
      .setDensity(ballDensity(state, state.ball.radius))
      .setCollisionGroups(BALL_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    ballBody
  );
  const babbles = new Map<string, BabbleEntry>();
  for (const b of state.babbles) {
    const ghosted = isGhosted(state, b);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(dampingFromDrag(dragTune(state, 'babbleDragPerTick')))
        .setAngularDamping(4)
        .setCanSleep(false)
        .lockRotations()
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.ball(babbleColliderRadius(b.radius))
        .setFriction(0.12)
        .setRestitution(tune(state, 'babbleRestitution'))
        .setDensity(tune(state, 'babbleDensity'))
        .setCollisionGroups(ghosted ? GHOST_GROUPS : BABBLE_GROUPS),
      body
    );
    babbles.set(b.id, { body, collider, radius: b.radius, ghosted });
  }
  return {
    world,
    events: new RAPIER.EventQueue(true),
    mapId: normalizeMapId(state.mapId),
    ballBody,
    ballCollider,
    ballRadius: state.ball.radius,
    beachy,
    babbles,
    babbleKey: babbleKeyOf(state),
    blocksKey: '',
    blockColliders: [],
  };
}

const ballDensity = (state: GameState, radius: number) =>
  tune(state, 'ballDensityBase') * (ballColliderRadius(FIELD.ballRadius) / ballColliderRadius(radius)) ** 3;
const ballColliderRadius = (radius: number) => ballRestHeight(radius);
const babbleColliderRadius = (radius: number) => babbleRestHeight(radius);

const isGhosted = (state: GameState, babble: GameState['babbles'][number]) =>
  babble.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn);

// GameState velocities/positions are authoritative between ticks (launches,
// bumper boosts, goo, ramps, teleport power plays and tests all write them),
// so bodies are re-synced from state every tick, not just on changes.
function syncBall(state: GameState, cache: PhysicsCache) {
  const body = cache.ballBody;
  const vertical = normalizeBallVertical(state.ball.radius, state.ball.height, state.ball.verticalVelocity);
  state.ball.height = vertical.height;
  state.ball.verticalVelocity = vertical.verticalVelocity;
  body.setTranslation(fieldToWorld(state.ball.pos, state.ball.height), true);
  body.setLinvel(fieldVelocityToWorld(state.ball.vel, state.ball.verticalVelocity), true);
  body.enableCcd(Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.verticalVelocity * PX_PER_METER) > CCD_MIN_SPEED);
  const beachy = isBeachy(state);
  if (beachy !== cache.beachy) {
    body.setLinearDamping(beachy ? dampingFromDrag(dragTune(state, 'beachBallDragPerTick')) : dampingFromDrag(dragTune(state, 'ballDragPerTick')));
    body.setGravityScale(ballGravity(beachy) / WORLD_GRAVITY, true);
    cache.beachy = beachy;
  }
  if (state.ball.radius !== cache.ballRadius) {
    cache.ballCollider.setRadius(ballColliderRadius(state.ball.radius));
    cache.ballCollider.setDensity(ballDensity(state, state.ball.radius));
    cache.ballRadius = state.ball.radius;
  }
}

function syncBabble(
  state: GameState,
  cache: PhysicsCache,
  babble: GameState['babbles'][number],
  touchable: Map<number, BabbleImpactSnapshot>
) {
  const entry = cache.babbles.get(babble.id)!;
  const vertical = normalizeBabbleVertical(babble.height, babble.verticalVelocity, babble.radius);
  babble.height = vertical.height;
  babble.verticalVelocity = vertical.verticalVelocity;
  entry.body.setTranslation(fieldToWorld(babble.pos, babble.height), true);
  entry.body.setLinvel(fieldVelocityToWorld(babble.vel, babble.verticalVelocity), true);
  entry.body.enableCcd(Math.hypot(babble.vel.x, babble.vel.y, babble.verticalVelocity * PX_PER_METER) > CCD_MIN_SPEED);
  const ghosted = isGhosted(state, babble);
  if (ghosted !== entry.ghosted) {
    entry.collider.setCollisionGroups(ghosted ? GHOST_GROUPS : BABBLE_GROUPS);
    entry.ghosted = ghosted;
  }
  if (babble.radius !== entry.radius) {
    entry.collider.setRadius(babbleColliderRadius(babble.radius));
    entry.radius = babble.radius;
  }
  if (!ghosted) touchable.set(entry.collider.handle, {
    id: babble.id,
    side: babble.side,
    pos: { ...babble.pos },
    vel: { ...babble.vel }
  });
}

function projectBall(state: GameState, body: RAPIER.RigidBody) {
  const p = body.translation();
  const v = body.linvel();
  state.ball.pos.x = p.x * PX_PER_METER;
  state.ball.pos.y = p.z * PX_PER_METER;
  state.ball.vel.x = v.x * PX_PER_METER;
  state.ball.vel.y = v.z * PX_PER_METER;
  const rest = ballRestHeight(state.ball.radius);
  let height = p.y;
  let vy = v.y;
  if (height <= rest + REST_EPS && vy <= 0) {
    height = rest;
    vy = 0;
    body.setTranslation({ x: p.x, y: rest, z: p.z }, true);
    body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
  } else if (height >= BALL_MAX_HEIGHT && vy > 0) {
    height = BALL_MAX_HEIGHT;
    vy = 0;
    body.setTranslation({ x: p.x, y: BALL_MAX_HEIGHT, z: p.z }, true);
    body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
  }
  state.ball.height = Math.max(rest, Math.min(BALL_MAX_HEIGHT, height));
  state.ball.verticalVelocity = vy;
}

function projectBabble(babble: GameState['babbles'][number], body: RAPIER.RigidBody) {
  const p = body.translation();
  const v = body.linvel();
  babble.pos.x = p.x * PX_PER_METER;
  babble.pos.y = p.z * PX_PER_METER;
  babble.vel.x = v.x * PX_PER_METER;
  babble.vel.y = v.z * PX_PER_METER;
  const rest = babbleRestHeight(babble.radius);
  let height = p.y;
  let vy = v.y;
  if (height <= rest + REST_EPS && vy <= 0) {
    height = rest;
    vy = 0;
    body.setTranslation({ x: p.x, y: rest, z: p.z }, true);
    body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
  }
  babble.height = Math.max(rest, height);
  babble.verticalVelocity = vy;
}

function fieldToWorld(pos: Vec, height: number): RAPIER.Vector {
  return { x: pos.x / PX_PER_METER, y: height, z: pos.y / PX_PER_METER };
}

function fieldVelocityToWorld(vel: Vec, verticalVelocity: number): RAPIER.Vector {
  return { x: vel.x / PX_PER_METER, y: verticalVelocity, z: vel.y / PX_PER_METER };
}

function ballBabbleImpact(
  ball: { pos: Vec; vel: Vec },
  babble: BabbleImpactSnapshot
): BallImpactObservation | null {
  const dx = ball.pos.x - babble.pos.x;
  const dy = ball.pos.y - babble.pos.y;
  const dist = Math.hypot(dx, dy);
  const rvx = ball.vel.x - babble.vel.x;
  const rvy = ball.vel.y - babble.vel.y;
  let nx = 1;
  let ny = 0;
  if (dist > 0.0001) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    const rel = Math.hypot(rvx, rvy);
    if (rel > 0.0001) {
      nx = -rvx / rel;
      ny = -rvy / rel;
    }
  }
  const closing = Math.max(0, -(rvx * nx + rvy * ny));
  const relativeSpeed = Math.hypot(rvx, rvy);
  const impactSpeed = Math.max(closing, relativeSpeed * 0.35);
  if (impactSpeed < 1) return null;
  return {
    babbleId: babble.id,
    side: babble.side,
    impactSpeed,
    normal: { x: nx, y: ny }
  };
}

function fixedCuboid(
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  collisionGroups: number,
  restitution: number,
  friction = 0,
  rotation?: RAPIER.Rotation
) {
  let desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setTranslation(x, y, z)
    .setFriction(friction)
    .setRestitution(restitution)
    .setCollisionGroups(collisionGroups);
  if (rotation) desc = desc.setRotation(rotation);
  world.createCollider(desc);
}

function yawRotation(angle: number): RAPIER.Rotation {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

function buildArena(world: RAPIER.World, state: GameState) {
  const w = FIELD.width / PX_PER_METER;
  const h = FIELD.height / PX_PER_METER;
  const mouthTop = FIELD.goalY / PX_PER_METER;
  const mouthBottom = (FIELD.goalY + FIELD.goalHeight) / PX_PER_METER;
  const goalDepth = FIELD.goalDepth / PX_PER_METER;
  const t = WALL_HALF_THICKNESS;
  const wallRestitution = tune(state, 'wallRestitution');
  const wallY = WALL_HALF_HEIGHT;
  const floorX = w / 2;
  const floorZ = h / 2;
  const floorHx = w / 2 + goalDepth + 2 * t;
  const floorHz = h / 2 + 2 * t;

  // Floor top is y=0. Spheres therefore rest at world y == radius.
  fixedCuboid(world, floorX, -FLOOR_HALF_THICKNESS, floorZ, floorHx, FLOOR_HALF_THICKNESS, floorHz, ARENA_GROUPS, 0, 0.22);

  // Top and bottom rails (overhang past the corners so nothing slips out).
  fixedCuboid(world, w / 2, wallY, -t, w / 2 + 2 * t + goalDepth, WALL_HALF_HEIGHT, t, ARENA_GROUPS, wallRestitution);
  fixedCuboid(world, w / 2, wallY, h + t, w / 2 + 2 * t + goalDepth, WALL_HALF_HEIGHT, t, ARENA_GROUPS, wallRestitution);
  for (const side of ['left', 'right'] as const) {
    const x = side === 'left' ? -t : w + t;
    // Solid wall segments above and below the goal mouth.
    fixedCuboid(world, x, wallY, mouthTop / 2, t, WALL_HALF_HEIGHT, mouthTop / 2, ARENA_GROUPS, wallRestitution);
    fixedCuboid(world, x, wallY, (mouthBottom + h) / 2, t, WALL_HALF_HEIGHT, (h - mouthBottom) / 2, ARENA_GROUPS, wallRestitution);
    // The mouth strip stops babbleheads on the goal line but lets the ball
    // through so goals score reliably and nothing bounces back off a gate.
    fixedCuboid(world, x, wallY, (mouthTop + mouthBottom) / 2, t, WALL_HALF_HEIGHT, (mouthBottom - mouthTop) / 2, MOUTH_GROUPS, wallRestitution);
    // Back of the net: keeps a flying ball inside the gate pocket.
    const backX = side === 'left' ? -goalDepth - t : w + goalDepth + t;
    fixedCuboid(world, backX, wallY, (mouthTop + mouthBottom) / 2, t, WALL_HALF_HEIGHT, (mouthBottom - mouthTop) / 2 + t, BACK_GROUPS, wallRestitution);
  }
}

// Placed Block walls appear/expire between turns; rebuild their colliders
// only when the active set actually changes.
function syncBlocks(state: GameState, cache: PhysicsCache) {
  const active = state.fieldObjects.filter(o => o.type === 'block' && o.untilTurn >= state.turn);
  const key = active.map(o => `${o.id}:${o.pos.x},${o.pos.y},${o.angle}`).join('|');
  if (key === cache.blocksKey) return;
  for (const c of cache.blockColliders) cache.world.removeCollider(c, false);
  cache.blockColliders = active.map(o =>
    cache.world.createCollider(
      RAPIER.ColliderDesc.cuboid(BLOCK_HALF_LEN, BLOCK_HALF_HEIGHT, BLOCK_HALF_THICKNESS)
        .setTranslation(o.pos.x / PX_PER_METER, BLOCK_HALF_HEIGHT, o.pos.y / PX_PER_METER)
        .setRotation(yawRotation(-o.angle))
        .setFriction(0)
        .setRestitution(tune(state, 'blockRestitution'))
        .setCollisionGroups(BLOCK_GROUPS)
    )
  );
  cache.blocksKey = key;
}

// CCD (swept collision) is only worth its cost for genuinely fast movers that
// could cross a thin collider within one 33ms tick.
const CCD_MIN_SPEED = 350; // px/s; slowest piece is 24px radius vs 28px blocks
