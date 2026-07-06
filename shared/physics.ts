// Rapier 2D physics core for Babble League.
//
// This module owns rigid-body integration and collision response during the
// resolving phase: ball + babblehead movement/damping, ball<->babble and
// babble<->babble impacts, arena walls with open goal mouths, and placed
// "block" walls. Game-feel rules (corner bumper boosts, boost pads, sticky
// goo, ramp launches, box pickups, goal detection, settle/end-turn) stay in
// shared/game.ts as explicit, readable rule code layered on top.
//
// Engine choice: @dimforge/rapier2d-deterministic-compat. The -compat build
// inlines the WASM blob as base64 so it loads in plain Node (tsx, vitest,
// Docker) without bundler wiring; the -deterministic build gives
// cross-platform reproducible results, which keeps the authoritative server
// simulation stable and replayable.
//
// The GameState remains the single source of truth: each GameState owns one
// persistent Rapier world (cached in a WeakMap). Every tick we write the
// state's positions/velocities into the world, reconcile anything power plays
// or tests changed between ticks (teleports, radius changes, ghosting, placed
// blocks), step once, and copy positions/velocities back. Persisting the
// world avoids per-tick allocation churn while keeping GameState mutations
// (from rules, power plays and tests) unconditionally authoritative. Servers
// should call freePhysics(state) when discarding a room to release WASM
// memory promptly.
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { FIELD, GameState, PlayerSide } from './types';

// Rapier is tuned for meter-scale numbers; the field is 1100x620 px.
export const PX_PER_METER = 50;

// Convert the legacy per-tick velocity drags (applied at 30Hz) into continuous
// linear damping so the tabletop deceleration feel is preserved exactly.
const LEGACY_TICK_HZ = 30;
const dampingFromDrag = (dragPerTick: number) => -Math.log(dragPerTick) * LEGACY_TICK_HZ;
const BABBLE_DAMPING = dampingFromDrag(0.952);
const BALL_DAMPING = dampingFromDrag(0.968);
const BEACH_BALL_DAMPING = dampingFromDrag(0.982);

// Restitutions reproduce the pre-Rapier bounce feel: the ball is lively (0.88
// against walls/babbles via CombineRule.Max), babbles are heavier and duller.
const BALL_RESTITUTION = 0.88;
const BABBLE_RESTITUTION = 0.6;
const WALL_RESTITUTION = 0.9; // avg(0.9, 0.6) = 0.75 = legacy babble wall bounce
const BLOCK_RESTITUTION = 0.6;

// Densities set the momentum exchange: a babble outweighs the ball ~3.5x, so
// flicked babbles send the ball flying (legacy BALL_MASS_FACTOR feel).
const BABBLE_DENSITY = 1;
const BALL_DENSITY_BASE = 0.84;

// Collision groups (16-bit membership << 16 | 16-bit filter).
const G_BALL = 0x0001;
const G_BABBLE = 0x0002;
const G_GHOST = 0x0004; // ghosted babbles: pass through ball, babbles, blocks
const G_ARENA = 0x0008; // outer walls
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
const BLOCK_HALF_LEN = 60 / PX_PER_METER;
const BLOCK_HALF_THICKNESS = 14 / PX_PER_METER;

// -compat builds expose an async init that instantiates the inlined WASM.
// Top-level await: server/tests wait for it once at module load. The browser
// bundle never imports this module.
await RAPIER.init();

interface BabbleEntry {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  ghosted: boolean;
}

interface PhysicsCache {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
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

// Release the Rapier world backing a GameState. WeakMap lets abandoned test
// states be garbage collected, but the WASM-side memory is only reclaimed by
// an explicit free, so servers call this when deleting a room.
export function freePhysics(state: GameState) {
  const cache = caches.get(state);
  if (!cache) return;
  cache.events.free();
  cache.world.free();
  caches.delete(state);
}

export function stepPhysics(state: GameState, dt: number) {
  const cache = getCache(state);
  const { world, events } = cache;
  world.timestep = dt;
  syncBlocks(state, cache);
  syncBall(state, cache);
  const touchable = new Map<number, PlayerSide>();
  for (const b of state.babbles) syncBabble(state, cache, b, touchable);

  world.step(events);

  // Copy authoritative positions/velocities back into GameState so the
  // Socket.IO protocol, renderer, and rule code stay engine-agnostic.
  const bp = cache.ballBody.translation();
  const bv = cache.ballBody.linvel();
  state.ball.pos.x = bp.x * PX_PER_METER;
  state.ball.pos.y = bp.y * PX_PER_METER;
  state.ball.vel.x = bv.x * PX_PER_METER;
  state.ball.vel.y = bv.y * PX_PER_METER;
  for (const b of state.babbles) {
    const body = cache.babbles.get(b.id)!.body;
    const p = body.translation();
    const v = body.linvel();
    b.pos.x = p.x * PX_PER_METER;
    b.pos.y = p.y * PX_PER_METER;
    b.vel.x = v.x * PX_PER_METER;
    b.vel.y = v.y * PX_PER_METER;
  }

  // Ball possession. A babble still pressed against the ball (dribbling)
  // fires its collision event only once in a persistent world, so first
  // credit any babble overlapping the ball after the step...
  for (const b of state.babbles) {
    if (cache.babbles.get(b.id)!.ghosted) continue;
    const gap = Math.hypot(b.pos.x - state.ball.pos.x, b.pos.y - state.ball.pos.y) - b.radius - state.ball.radius;
    if (gap <= 2) state.ball.lastTouchedBy = b.side; // 2px: restitution separates ~2px/tick
  }
  // ...then let fresh impacts this tick take precedence (a fast bounce can
  // separate within one step and would be missed by the overlap scan).
  const ballHandle = cache.ballCollider.handle;
  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const other = h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;
    if (other === null) return;
    const side = touchable.get(other);
    if (side) state.ball.lastTouchedBy = side;
  });
}

const isBeachy = (state: GameState) =>
  state.beachBallUntilTurn !== null && state.beachBallUntilTurn >= state.turn;

const babbleKeyOf = (state: GameState) => state.babbles.map(b => b.id).join(',');

function getCache(state: GameState): PhysicsCache {
  const existing = caches.get(state);
  // The babble roster is fixed after startGame; if a test swaps it, rebuild.
  if (existing && existing.babbleKey === babbleKeyOf(state)) return existing;
  if (existing) freePhysics(state);
  const cache = buildCache(state);
  caches.set(state, cache);
  return cache;
}

function buildCache(state: GameState): PhysicsCache {
  const world = new RAPIER.World({ x: 0, y: 0 });
  buildArena(world);
  const beachy = isBeachy(state);
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(beachy ? BEACH_BALL_DAMPING : BALL_DAMPING)
      .setCanSleep(false)
      .lockRotations()
  );
  // The beach ball grows but keeps its mass, so it floats farther, not heavier.
  const ballCollider = world.createCollider(
    RAPIER.ColliderDesc.ball(state.ball.radius / PX_PER_METER)
      .setFriction(0)
      .setRestitution(BALL_RESTITUTION)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setDensity(ballDensity(state.ball.radius))
      .setCollisionGroups(BALL_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    ballBody
  );
  const babbles = new Map<string, BabbleEntry>();
  for (const b of state.babbles) {
    const ghosted = isGhosted(state, b);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setLinearDamping(BABBLE_DAMPING)
        .setCanSleep(false)
        .lockRotations()
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.ball(b.radius / PX_PER_METER)
        .setFriction(0)
        .setRestitution(BABBLE_RESTITUTION)
        .setDensity(BABBLE_DENSITY)
        .setCollisionGroups(ghosted ? GHOST_GROUPS : BABBLE_GROUPS),
      body
    );
    babbles.set(b.id, { body, collider, radius: b.radius, ghosted });
  }
  return {
    world,
    events: new RAPIER.EventQueue(true),
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

const ballDensity = (radius: number) => BALL_DENSITY_BASE * (FIELD.ballRadius / radius) ** 2;

const isGhosted = (state: GameState, babble: GameState['babbles'][number]) =>
  babble.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn);

// GameState velocities/positions are authoritative between ticks (launches,
// bumper boosts, goo, ramps, teleport power plays and tests all write them),
// so bodies are re-synced from state every tick, not just on changes.
function syncBall(state: GameState, cache: PhysicsCache) {
  const body = cache.ballBody;
  body.setTranslation({ x: state.ball.pos.x / PX_PER_METER, y: state.ball.pos.y / PX_PER_METER }, true);
  body.setLinvel({ x: state.ball.vel.x / PX_PER_METER, y: state.ball.vel.y / PX_PER_METER }, true);
  body.enableCcd(Math.hypot(state.ball.vel.x, state.ball.vel.y) > CCD_MIN_SPEED);
  const beachy = isBeachy(state);
  if (beachy !== cache.beachy) {
    body.setLinearDamping(beachy ? BEACH_BALL_DAMPING : BALL_DAMPING);
    cache.beachy = beachy;
  }
  if (state.ball.radius !== cache.ballRadius) {
    cache.ballCollider.setRadius(state.ball.radius / PX_PER_METER);
    cache.ballCollider.setDensity(ballDensity(state.ball.radius));
    cache.ballRadius = state.ball.radius;
  }
}

function syncBabble(
  state: GameState,
  cache: PhysicsCache,
  babble: GameState['babbles'][number],
  touchable: Map<number, PlayerSide>
) {
  const entry = cache.babbles.get(babble.id)!;
  entry.body.setTranslation({ x: babble.pos.x / PX_PER_METER, y: babble.pos.y / PX_PER_METER }, true);
  entry.body.setLinvel({ x: babble.vel.x / PX_PER_METER, y: babble.vel.y / PX_PER_METER }, true);
  entry.body.enableCcd(Math.hypot(babble.vel.x, babble.vel.y) > CCD_MIN_SPEED);
  const ghosted = isGhosted(state, babble);
  if (ghosted !== entry.ghosted) {
    entry.collider.setCollisionGroups(ghosted ? GHOST_GROUPS : BABBLE_GROUPS);
    entry.ghosted = ghosted;
  }
  if (babble.radius !== entry.radius) {
    entry.collider.setRadius(babble.radius / PX_PER_METER);
    entry.radius = babble.radius;
  }
  if (!ghosted) touchable.set(entry.collider.handle, babble.side);
}

function fixedCuboid(world: RAPIER.World, x: number, y: number, hx: number, hy: number, collisionGroups: number) {
  const desc = RAPIER.ColliderDesc.cuboid(hx, hy)
    .setTranslation(x, y)
    .setFriction(0)
    .setRestitution(WALL_RESTITUTION)
    .setCollisionGroups(collisionGroups);
  world.createCollider(desc);
}

function buildArena(world: RAPIER.World) {
  const w = FIELD.width / PX_PER_METER;
  const h = FIELD.height / PX_PER_METER;
  const mouthTop = FIELD.goalY / PX_PER_METER;
  const mouthBottom = (FIELD.goalY + FIELD.goalHeight) / PX_PER_METER;
  const goalDepth = FIELD.goalDepth / PX_PER_METER;
  const t = WALL_HALF_THICKNESS;
  // Top and bottom rails (overhang past the corners so nothing slips out).
  fixedCuboid(world, w / 2, -t, w / 2 + 2 * t + goalDepth, t, ARENA_GROUPS);
  fixedCuboid(world, w / 2, h + t, w / 2 + 2 * t + goalDepth, t, ARENA_GROUPS);
  for (const side of ['left', 'right'] as const) {
    const x = side === 'left' ? -t : w + t;
    // Solid wall segments above and below the goal mouth.
    fixedCuboid(world, x, mouthTop / 2, t, mouthTop / 2, ARENA_GROUPS);
    fixedCuboid(world, x, (mouthBottom + h) / 2, t, (h - mouthBottom) / 2, ARENA_GROUPS);
    // The mouth strip stops babbleheads on the goal line but lets the ball
    // through so goals score reliably and nothing bounces back off a "gate".
    fixedCuboid(world, x, (mouthTop + mouthBottom) / 2, t, (mouthBottom - mouthTop) / 2, MOUTH_GROUPS);
    // Back of the net: keeps a flying ball inside the gate pocket.
    const backX = side === 'left' ? -goalDepth - t : w + goalDepth + t;
    fixedCuboid(world, backX, (mouthTop + mouthBottom) / 2, t, (mouthBottom - mouthTop) / 2 + t, BACK_GROUPS);
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
    // Same capsule footprint as the legacy segment wall (halfLen 60, radius 14).
    // Rapier capsules extend along +y, so rotate by angle - PI/2.
    cache.world.createCollider(
      RAPIER.ColliderDesc.capsule(BLOCK_HALF_LEN, BLOCK_HALF_THICKNESS)
        .setTranslation(o.pos.x / PX_PER_METER, o.pos.y / PX_PER_METER)
        .setRotation(o.angle - Math.PI / 2)
        .setFriction(0)
        .setRestitution(BLOCK_RESTITUTION)
        .setCollisionGroups(BLOCK_GROUPS)
    )
  );
  cache.blocksKey = key;
}

// CCD (swept collision) is only worth its cost for genuinely fast movers that
// could cross a thin collider within one 33ms tick.
const CCD_MIN_SPEED = 350; // px/s; slowest piece is 24px radius vs 28px blocks
