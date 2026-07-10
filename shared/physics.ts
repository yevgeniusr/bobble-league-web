// Rapier 3D physics core for Babble League.
//
// Coordinate mapping is intentionally explicit and stable:
//   field x -> Rapier world x
//   field y -> Rapier world z
//   height  -> Rapier world y
//
// GameState remains the public protocol boundary. Rapier is authoritative while
// a turn resolves; explicit launches/teleports/powers are synchronized once,
// then each step projects the resulting 3D state back to the public shape.
import RAPIER from '@dimforge/rapier3d-deterministic-compat';

import {
  BABBLE_GRAVITY,
  babbleRestHeight,
  ballRestHeight,
  normalizeBabbleVertical,
  normalizeBallVertical
} from './airborne';
import { FIELD, GameState, MAPS, MapPhysicsMultipliers, PlayerSide, RAMP_HALF_LEN, RAMP_HALF_WIDTH, Vec, normalizeMapId } from './types';
import { PHYSICS_CONFIG } from './physicsConfig';

// Rapier is tuned for meter-scale numbers; the field is 1100x620 px.
export const PX_PER_METER = 50;

// Convert the legacy per-tick velocity drags (applied at 30Hz) into continuous
// linear damping so the tabletop deceleration feel is preserved.
const LEGACY_TICK_HZ = 30;
const dampingFromDrag = (dragPerTick: number) => -Math.log(dragPerTick) * LEGACY_TICK_HZ;

const WORLD_GRAVITY = BABBLE_GRAVITY;
const mapOf = (state: GameState) => MAPS[normalizeMapId(state.mapId)];
const tune = (state: GameState, key: keyof MapPhysicsMultipliers) => PHYSICS_CONFIG[key] * mapOf(state).physics[key];
export const clampRestitution = (value: number) => Math.max(0, Math.min(1, value));
export const clampMotorParameter = (value: number) => Math.max(0, value);
const restitutionTune = (state: GameState, key: 'babbleRestitution' | 'ballRestitution' | 'wallRestitution' | 'blockRestitution' | 'bigBumperRestitution') =>
  clampRestitution(tune(state, key));
const dragTune = (state: GameState, key: 'babbleDragPerTick' | 'ballDragPerTick' | 'beachBallDragPerTick') =>
  Math.max(0.5, Math.min(0.995, tune(state, key)));

// Collision groups (16-bit membership << 16 | 16-bit filter).
const G_BALL = 0x0001;
const G_BABBLE = 0x0002;
const G_GHOST = 0x0004; // ghosted babbles: pass through ball, babbles, blocks
const G_ARENA = 0x0008; // floor + outer walls
const G_BLOCK = 0x0020; // placed Block power-play walls
const groups = (membership: number, filter: number) => ((membership << 16) | filter) >>> 0;
const BALL_GROUPS = groups(G_BALL, G_BABBLE | G_ARENA | G_BLOCK);
const BABBLE_GROUPS = groups(G_BABBLE, G_BALL | G_BABBLE | G_ARENA | G_BLOCK);
const GHOST_GROUPS = groups(G_GHOST, G_ARENA);
const ARENA_GROUPS = groups(G_ARENA, G_BALL | G_BABBLE | G_GHOST);
const BLOCK_GROUPS = groups(G_BLOCK, G_BALL | G_BABBLE);

const WALL_HALF_THICKNESS = 1; // meters (50px): thick walls + CCD stop tunneling
const WALL_HALF_HEIGHT = 2.5;
const FLOOR_HALF_THICKNESS = 0.25;
const BLOCK_HALF_LEN = 60 / PX_PER_METER;
const BLOCK_HALF_THICKNESS = 14 / PX_PER_METER;
const BLOCK_HALF_HEIGHT = WALL_HALF_HEIGHT;
const RAMP_HEIGHT = 0.82; // matches client wedgeGeometry exactly


// -compat builds expose an async init that instantiates the inlined WASM.
// Top-level await: server/tests wait for it once at module load. The browser
// bundle never imports this module.
await (RAPIER.init as (options?: unknown) => Promise<void>)({});

interface BabbleEntry {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  radius: number;
  ghosted: boolean;
  stateKey: string;
}

interface PhysicsCache {
  world: RAPIER.World;
  events: RAPIER.EventQueue;
  mapId: string;
  ballBody: RAPIER.RigidBody;
  ballCollider: RAPIER.Collider;
  ballRadius: number;
  beachy: boolean;
  ballStateKey: string;
  babbles: Map<string, BabbleEntry>;
  babbleKey: string;
  blocksKey: string;
  blockColliders: RAPIER.Collider[];
  rampsKey: string;
  rampColliders: RAPIER.Collider[];
  bumpersKey: string;
  bumperColliders: RAPIER.Collider[];
  bumperBodies: RAPIER.RigidBody[];
  bumperHandles: Map<number, Vec>;
}

const caches = new WeakMap<GameState, PhysicsCache>();
export type PhysicsStepResult = { bumperHits: Vec[] };

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

export function applyBabblePlanarImpulse(state: GameState, babbleId: string, deltaVelocity: Vec) {
  const babble = state.babbles.find(b => b.id === babbleId);
  if (!babble) return false;
  const cache = getCache(state);
  syncBabble(state, cache, babble, new Map());
  const entry = cache.babbles.get(babbleId)!;
  const mass = entry.body.mass();
  entry.body.applyImpulse({
    x: deltaVelocity.x / PX_PER_METER * mass,
    y: 0,
    z: deltaVelocity.y / PX_PER_METER * mass
  }, true);
  const velocity = entry.body.linvel();
  babble.vel = { x: velocity.x * PX_PER_METER, y: velocity.z * PX_PER_METER };
  babble.verticalVelocity = velocity.y;
  entry.stateKey = babbleStateKey(babble);
  return true;
}

export function stepPhysics(state: GameState, dt: number): PhysicsStepResult {
  const cache = getCache(state);
  const { world, events } = cache;
  const result: PhysicsStepResult = { bumperHits: [] };
  world.timestep = dt;
  syncBumpers(state, cache);
  syncBlocks(state, cache);
  syncRamps(state, cache);
  syncBall(state, cache);

  const touchable = new Map<number, BabbleImpactSnapshot>();
  for (const b of state.babbles) syncBabble(state, cache, b, touchable);
  applyFieldForces(state, cache);

  world.step(events);

  projectBall(state, cache);
  for (const b of state.babbles) projectBabble(b, cache.babbles.get(b.id)!);

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
    const bumper = cache.bumperHandles.get(h1) ?? cache.bumperHandles.get(h2);
    if (bumper) result.bumperHits.push({ ...bumper });
    const other = h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;
    if (other === null) return;
    const babble = touchable.get(other);
    if (babble) recordBallTouch(state, babble.id, babble.side);
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
      .setCanSleep(false)
  );
  // Giant Ball uses a lower collider density, so resizing changes mass through
  // Rapier rather than injecting velocity.
  const ballCollider = world.createCollider(
    RAPIER.ColliderDesc.ball(ballColliderRadius(state.ball.radius))
      .setFriction(0.35)
      .setRestitution(restitutionTune(state, 'ballRestitution'))
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
        // The collision sphere is the physical rolling base of the bobblehead,
        // not its full visual/body height. Its lower center creates a real
        // upward contact normal when it strikes the larger ball.
        .setTranslation(0, babbleColliderOffsetY(b.radius), 0)
        .setFriction(0.3)
        .setRestitution(restitutionTune(state, 'babbleRestitution'))
        .setDensity(babbleDensity(state, b.radius))
        .setCollisionGroups(ghosted ? GHOST_GROUPS : BABBLE_GROUPS),
      body
    );
    babbles.set(b.id, { body, collider, radius: b.radius, ghosted, stateKey: '' });
  }
  return {
    world,
    events: new RAPIER.EventQueue(true),
    mapId: normalizeMapId(state.mapId),
    ballBody,
    ballCollider,
    ballRadius: state.ball.radius,
    beachy,
    ballStateKey: '',
    babbles,
    babbleKey: babbleKeyOf(state),
    blocksKey: '',
    blockColliders: [],
    rampsKey: '',
    rampColliders: [],
    bumpersKey: '',
    bumperColliders: [],
    bumperBodies: [],
    bumperHandles: new Map(),
  };
}

const ballDensity = (state: GameState, radius: number) => {
  const massPreservingDensity = tune(state, 'ballDensityBase') * (ballColliderRadius(FIELD.ballRadius) / ballColliderRadius(radius)) ** 3;
  // Giant Ball is a genuinely lighter physical body, not a scripted launch.
  return radius > FIELD.ballRadius * 1.2 ? massPreservingDensity * PHYSICS_CONFIG.giantBallMassScale : massPreservingDensity;
};
const ballColliderRadius = (radius: number) => ballRestHeight(radius);
const babbleColliderRadius = (radius: number) => radius / PX_PER_METER;
const babbleColliderOffsetY = (radius: number) => babbleColliderRadius(radius) - babbleRestHeight(radius);
const babbleDensity = (state: GameState, _radius: number) =>
  // Density is a physical material calibration. The smaller rolling-base
  // collider intentionally makes the bobblehead lighter than a full 0.5m ball.
  tune(state, 'babbleDensity');

const isGhosted = (state: GameState, babble: GameState['babbles'][number]) =>
  babble.effects.some(e => e.type === 'ghosted' && e.untilTurn >= state.turn);

const ballStateKey = (state: GameState) => {
  const b = state.ball;
  const q = b.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
  const a = b.angularVelocity ?? { x: 0, y: 0, z: 0 };
  return [b.pos.x, b.pos.y, b.height, b.radius, b.vel.x, b.vel.y, b.verticalVelocity, q.x, q.y, q.z, q.w, a.x, a.y, a.z].join(':');
};

const babbleStateKey = (b: GameState['babbles'][number]) =>
  [b.pos.x, b.pos.y, b.height, b.radius, b.vel.x, b.vel.y, b.verticalVelocity].join(':');

// Rapier remains authoritative between explicit game events. State is written
// into a body only when a launch, teleport, resize, power, or test changed the
// last state projected by Rapier.
function syncBall(state: GameState, cache: PhysicsCache) {
  const body = cache.ballBody;
  const vertical = normalizeBallVertical(state.ball.radius, state.ball.height, state.ball.verticalVelocity);
  state.ball.height = vertical.height;
  state.ball.verticalVelocity = vertical.verticalVelocity;
  const stateKey = ballStateKey(state);
  if (stateKey !== cache.ballStateKey) {
    body.setTranslation(fieldToWorld(state.ball.pos, state.ball.height), true);
    body.setLinvel(fieldVelocityToWorld(state.ball.vel, state.ball.verticalVelocity), true);
    const rotation = state.ball.rotation;
    const rotationLength = rotation ? Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w) : 0;
    if (rotation && [rotation.x, rotation.y, rotation.z, rotation.w].every(Number.isFinite) && rotationLength > 1e-8) {
      body.setRotation({ x: rotation.x / rotationLength, y: rotation.y / rotationLength, z: rotation.z / rotationLength, w: rotation.w / rotationLength }, true);
    } else {
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
    const angular = state.ball.angularVelocity;
    body.setAngvel(angular && [angular.x, angular.y, angular.z].every(Number.isFinite) ? angular : { x: 0, y: 0, z: 0 }, true);
    cache.ballStateKey = stateKey;
  }
  const beachy = isBeachy(state);
  // One physical drag coefficient applies in every state. Floor friction and
  // contact—not a grounded/airborne branch—produce the difference in carry.
  const drag = dragTune(state, beachy ? 'beachBallDragPerTick' : 'ballDragPerTick');
  body.setLinearDamping(dampingFromDrag(drag));
  body.enableCcd(Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.verticalVelocity * PX_PER_METER) > CCD_MIN_SPEED);
  if (beachy !== cache.beachy) {
    body.setLinearDamping(dampingFromDrag(drag));
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
  const stateKey = babbleStateKey(babble);
  if (stateKey !== entry.stateKey) {
    entry.body.setTranslation(fieldToWorld(babble.pos, babble.height), true);
    entry.body.setLinvel(fieldVelocityToWorld(babble.vel, babble.verticalVelocity), true);
    entry.stateKey = stateKey;
  }
  entry.body.enableCcd(Math.hypot(babble.vel.x, babble.vel.y, babble.verticalVelocity * PX_PER_METER) > CCD_MIN_SPEED);
  const ghosted = isGhosted(state, babble);
  if (ghosted !== entry.ghosted) {
    entry.collider.setCollisionGroups(ghosted ? GHOST_GROUPS : BABBLE_GROUPS);
    entry.ghosted = ghosted;
  }
  if (babble.radius !== entry.radius) {
    entry.collider.setRadius(babbleColliderRadius(babble.radius));
    entry.collider.setTranslationWrtParent({ x: 0, y: babbleColliderOffsetY(babble.radius), z: 0 });
    entry.collider.setDensity(babbleDensity(state, babble.radius));
    entry.radius = babble.radius;
  }
  if (!ghosted) touchable.set(entry.collider.handle, {
    id: babble.id,
    side: babble.side,
    pos: { ...babble.pos },
    vel: { ...babble.vel }
  });
}

function applyFieldForces(state: GameState, cache: PhysicsCache) {
  const active = state.fieldObjects.filter(o => o.untilTurn >= state.turn);
  const boosts = active.filter(o => o.type === 'boost');
  const goo = active.filter(o => o.type === 'stickyGoo');
  const boostAcceleration = tune(state, 'boostPadAccel') / PX_PER_METER;
  const gooDamping = dampingFromDrag(0.93);
  const affect = (body: RAPIER.RigidBody, pos: Vec, radius: number, baseDamping: number) => {
    body.resetForces(true);
    const inGoo = goo.some(o => Math.hypot(pos.x - o.pos.x, pos.y - o.pos.y) <= 80 + radius);
    body.setLinearDamping(baseDamping + (inGoo ? gooDamping : 0));
    for (const o of boosts) {
      if (Math.hypot(pos.x - o.pos.x, pos.y - o.pos.y) > 70 + radius) continue;
      const mass = body.mass();
      body.addForce({
        x: Math.cos(o.angle) * boostAcceleration * mass,
        y: 0,
        z: Math.sin(o.angle) * boostAcceleration * mass
      }, true);
    }
  };
  const beachy = isBeachy(state);
  affect(cache.ballBody, state.ball.pos, state.ball.radius,
    dampingFromDrag(dragTune(state, beachy ? 'beachBallDragPerTick' : 'ballDragPerTick')));
  for (const b of state.babbles) {
    affect(cache.babbles.get(b.id)!.body, b.pos, b.radius, dampingFromDrag(dragTune(state, 'babbleDragPerTick')));
  }
}

function projectBall(state: GameState, cache: PhysicsCache) {
  const body = cache.ballBody;
  const p = body.translation();
  const v = body.linvel();
  const r = body.rotation();
  const av = body.angvel();
  state.ball.pos.x = p.x * PX_PER_METER;
  state.ball.pos.y = p.z * PX_PER_METER;
  state.ball.vel.x = v.x * PX_PER_METER;
  state.ball.vel.y = v.z * PX_PER_METER;
  // Height and landing velocity are direct Rapier outputs. The floor collider,
  // material restitution, gravity, and damping are the complete bounce model.
  state.ball.height = p.y;
  state.ball.verticalVelocity = v.y;
  state.ball.rotation = { x: r.x, y: r.y, z: r.z, w: r.w };
  state.ball.angularVelocity = { x: av.x, y: av.y, z: av.z };
  cache.ballStateKey = ballStateKey(state);
}

function projectBabble(babble: GameState['babbles'][number], entry: BabbleEntry) {
  const body = entry.body;
  const p = body.translation();
  const v = body.linvel();
  babble.pos.x = p.x * PX_PER_METER;
  babble.pos.y = p.z * PX_PER_METER;
  babble.vel.x = v.x * PX_PER_METER;
  babble.vel.y = v.z * PX_PER_METER;
  babble.height = p.y;
  babble.verticalVelocity = v.y;
  entry.stateKey = babbleStateKey(babble);
}

function fieldToWorld(pos: Vec, height: number): RAPIER.Vector {
  return { x: pos.x / PX_PER_METER, y: height, z: pos.y / PX_PER_METER };
}

function fieldVelocityToWorld(vel: Vec, verticalVelocity: number): RAPIER.Vector {
  return { x: vel.x / PX_PER_METER, y: verticalVelocity, z: vel.y / PX_PER_METER };
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
  const wallRestitution = restitutionTune(state, 'wallRestitution');
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
    // The mouth is completely open to both ball and babbleheads. The goal is a
    // real pocket with rear and side walls, so a goalie can enter, get behind a
    // ball resting near the line, and push it back onto the field.
    const backX = side === 'left' ? -goalDepth - t : w + goalDepth + t;
    fixedCuboid(world, backX, wallY, (mouthTop + mouthBottom) / 2, t, WALL_HALF_HEIGHT, (mouthBottom - mouthTop) / 2 + t, ARENA_GROUPS, wallRestitution);
    const pocketCenterX = side === 'left' ? -goalDepth / 2 : w + goalDepth / 2;
    fixedCuboid(world, pocketCenterX, wallY, mouthTop - t, goalDepth / 2 + t, WALL_HALF_HEIGHT, t, ARENA_GROUPS, wallRestitution);
    fixedCuboid(world, pocketCenterX, wallY, mouthBottom + t, goalDepth / 2 + t, WALL_HALF_HEIGHT, t, ARENA_GROUPS, wallRestitution);
  }
}

// Corner bumpers are physical spring-loaded plungers: a dynamic cylinder moves
// only along a prismatic joint aimed toward field centre, and a Rapier motor
// restores it after compression. This creates powered rebounds through contact
// forces while keeping restitution in Rapier's documented [0,1] range.
function syncBumpers(state: GameState, cache: PhysicsCache) {
  const map = mapOf(state);
  const big = state.bigBumpersUntilTurn !== null && state.bigBumpersUntilTurn >= state.turn;
  const radiusPx = big ? map.layout.bigBumperRadius : map.layout.bumperRadius;
  const restitution = big ? restitutionTune(state, 'bigBumperRestitution') : clampRestitution(PHYSICS_CONFIG.bumperRestitution);
  const stiffness = clampMotorParameter(big ? PHYSICS_CONFIG.bigBumperMotorStiffness : PHYSICS_CONFIG.bumperMotorStiffness);
  const damping = clampMotorParameter(PHYSICS_CONFIG.bumperMotorDamping);
  // Rebuild once per turn so a compressed spring cannot carry hidden energy
  // across the explicit tabletop turn boundary.
  const key = `${state.turn}:${big}:${radiusPx}:${restitution}:${stiffness}:${damping}:${map.layout.bumpers.map(p => `${p.x},${p.y}`).join('|')}`;
  if (key === cache.bumpersKey) return;
  for (const body of cache.bumperBodies) cache.world.removeRigidBody(body);
  cache.bumperColliders = [];
  cache.bumperBodies = [];
  cache.bumperHandles.clear();
  for (const p of map.layout.bumpers) {
    const dx = FIELD.width / 2 - p.x;
    const dz = FIELD.height / 2 - p.y;
    const length = Math.hypot(dx, dz) || 1;
    const axis = { x: dx / length, y: 0, z: dz / length };
    const position = { x: p.x / PX_PER_METER, y: WALL_HALF_HEIGHT, z: p.y / PX_PER_METER };
    const anchor = cache.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z));
    const plunger = cache.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setLinearDamping(0.15)
        .lockRotations()
        .setCanSleep(false)
    );
    const collider = cache.world.createCollider(
      RAPIER.ColliderDesc.cylinder(WALL_HALF_HEIGHT, radiusPx / PX_PER_METER)
        .setFriction(0.2)
        .setRestitution(restitution)
        .setDensity(big ? 10 : 7)
        .setCollisionGroups(ARENA_GROUPS)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      plunger
    );
    const joint = cache.world.createImpulseJoint(
      RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, axis),
      anchor,
      plunger,
      true
    ) as RAPIER.PrismaticImpulseJoint;
    joint.setLimits(-0.18, 0.06);
    joint.configureMotorPosition(0.04, stiffness, damping);
    cache.bumperColliders.push(collider);
    cache.bumperBodies.push(anchor, plunger);
    cache.bumperHandles.set(collider.handle, { ...p });
  }
  cache.bumpersKey = key;
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
        .setRestitution(restitutionTune(state, 'blockRestitution'))
        .setCollisionGroups(BLOCK_GROUPS)
    )
  );
  cache.blocksKey = key;
}

// Trampolines are real static 3D wedges. They add no velocity or minimum exit
// speed: Rapier converts incoming horizontal momentum into height through the
// contact normal, gravity, friction, and wedge geometry itself.
function syncRamps(state: GameState, cache: PhysicsCache) {
  const active = state.fieldObjects.filter(o => o.type === 'ramp' && o.untilTurn >= state.turn);
  const key = active.map(o => `${o.id}:${o.pos.x},${o.pos.y},${o.angle}`).join('|');
  if (key === cache.rampsKey) return;
  for (const c of cache.rampColliders) cache.world.removeCollider(c, false);
  const halfLen = RAMP_HALF_LEN / PX_PER_METER;
  const halfWidth = RAMP_HALF_WIDTH / PX_PER_METER;
  const points = new Float32Array([
    -halfLen, 0, -halfWidth,
    -halfLen, 0, halfWidth,
    halfLen, 0, -halfWidth,
    halfLen, 0, halfWidth,
    halfLen, RAMP_HEIGHT, -halfWidth,
    halfLen, RAMP_HEIGHT, halfWidth
  ]);
  cache.rampColliders = active.flatMap(o => {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (!desc) return [];
    return [cache.world.createCollider(
      desc
        .setTranslation(o.pos.x / PX_PER_METER, 0, o.pos.y / PX_PER_METER)
        .setRotation(yawRotation(-o.angle))
        .setFriction(0.08)
        .setRestitution(0)
        .setCollisionGroups(BLOCK_GROUPS)
    )];
  });
  cache.rampsKey = key;
}

// CCD (swept collision) is only worth its cost for genuinely fast movers that
// could cross a thin collider within one 33ms tick.
const CCD_MIN_SPEED = 350; // px/s; slowest piece is 24px radius vs 28px blocks
