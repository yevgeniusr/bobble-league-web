export const FIELD = {
  width: 1100,
  height: 620,
  // Deep enough for a babblehead to enter the goal and get behind a ball
  // resting near the line. The goal mouth itself is physically open.
  goalDepth: 120,
  goalY: 205,
  goalHeight: 210,
  playerRadius: 18,
  babbleRadius: 18,
  // 25px at 50px/m = 0.5m, matching the Rapier sphere and observed ~0.49m
  // grounded center height.
  ballRadius: 25,
  boxSize: 34
} as const;

export const TEAMS = {
  bees: { label: 'Signal Stingers', emoji: '🐝', primary: '#ffda36', secondary: '#22252e' },
  fowl: { label: 'Coral Flyers', emoji: '🐔', primary: '#f16655', secondary: '#fffdf5' },
  bears: { label: 'Cobalt Bruisers', emoji: '🐻', primary: '#3152c9', secondary: '#ffda36' },
  cats: { label: 'Aqua Circuit', emoji: '🐱', primary: '#2cc7c1', secondary: '#22252e' },
  pigs: { label: 'Pink Pilots', emoji: '🐷', primary: '#ff9bb0', secondary: '#3152c9' },
  bulls: { label: 'Whitehorn United', emoji: '🐂', primary: '#fffdf5', secondary: '#3152c9' },
  dinos: { label: 'Meteor Eleven', emoji: '🦖', primary: '#3152c9', secondary: '#f16655' },
  snow: { label: 'Polar Caps', emoji: '❄️', primary: '#f5fbff', secondary: '#2cc7c1' },
  parrots: { label: 'Broadcast Birds', emoji: '🦜', primary: '#2cc7c1', secondary: '#ffda36' },
  tigers: { label: 'Stripe Squad', emoji: '🐯', primary: '#ffda36', secondary: '#f16655' }
} as const;
export type TeamId = keyof typeof TEAMS;
export const TEAM_IDS = Object.keys(TEAMS) as TeamId[];

export type GameMode = 1 | 3 | 5;
export type GameLength = 'scrimmage' | 'qualifier' | 'champion';
export const GAME_MODES: GameMode[] = [1, 3, 5];
export const GAME_LENGTHS: Record<GameMode, { length: GameLength; maxTurns: 30 | 90 | 150 }> = {
  1: { length: 'scrimmage', maxTurns: 30 },
  3: { length: 'qualifier', maxTurns: 90 },
  5: { length: 'champion', maxTurns: 150 }
};

export type FormationId = 'forward' | 'option' | 'slant' | 'zone' | 'wall' | 'box' | 'rush';
export const FORMATIONS: Record<FormationId, { label: string; description: string }> = {
  forward: { label: 'Forward', description: 'Four attackers press high.' },
  option: { label: 'Option', description: 'Three attackers and a safety.' },
  slant: { label: 'Slant', description: 'Aggressive diagonal push toward boxes.' },
  zone: { label: 'Zone', description: 'Balanced lanes with one defender.' },
  wall: { label: 'Wall', description: 'Four defenders form a tight vertical wall.' },
  box: { label: 'Box', description: 'Four defenders packed near goal.' },
  rush: { label: 'Rush', description: 'Two attackers and two defenders.' }
};
export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export const BOX_TYPES = {
  beachBall: { label: 'Beach Ball', targetId: 'giantball', color: '#facc15', category: 'instant', durationTurns: 1, description: 'Enlarge and lighten the ball for this turn.' },
  moveBall: { label: 'Move Ball', targetId: 'moveball', color: '#fb923c', category: 'instant', durationTurns: 0, description: 'Teleport the ball to any spot you click.' },
  swapGoals: { label: 'Swap Goals', targetId: 'goalswap', color: '#e879f9', category: 'instant', durationTurns: 1, description: 'Flip scoring direction for one turn.' },
  bigBumpers: { label: 'Big Bumpers', targetId: 'bumppadboost', color: '#f97316', category: 'instant', durationTurns: 1, description: 'Corner bumpers grow stronger for one turn.' },
  boost: { label: 'Boost', targetId: 'boost', color: '#38bdf8', category: 'field', durationTurns: 1, description: 'Place a directional boost pad.' },
  stickyGoo: { label: 'Sticky Goo', targetId: 'sticky', color: '#84cc16', category: 'field', durationTurns: 1, description: 'Place a sticky slow zone.' },
  ramp: { label: 'Trampoline', targetId: 'ramp', color: '#a78bfa', category: 'field', durationTurns: 1, description: 'Place a physical ramp for this turn. It adds no artificial boost.' },
  block: { label: 'Block', targetId: 'block', color: '#94a3b8', category: 'field', durationTurns: 1, description: 'Place a temporary wall.' },
  bigHead: { label: 'Big Head', targetId: 'bighead', color: '#ef4444', category: 'babble', durationTurns: 1, description: 'Target babblehead grows into a larger, heavier physical collider.' },
  ghosted: { label: 'Ghosted', targetId: 'ghost', color: '#d8b4fe', category: 'babble', durationTurns: 1, description: 'Target babblehead passes through babbleheads and boxes.' },
  movePlayer: { label: 'Move Player', targetId: 'moveplayer', color: '#fde047', category: 'babble', durationTurns: 0, description: 'Move a target babblehead back toward center field.' },
  yellowCard: { label: 'Yellow Card', targetId: 'yellowcard', color: '#facc15', category: 'instant', durationTurns: 0, description: 'Teleport the ball to the center of the field.' },
  redCard: { label: 'Red Card', targetId: 'redcard', color: '#ef4444', category: 'babble', durationTurns: 0, description: 'Choose a babblehead to teleport to the center of the field.' }
} as const;
export type BoxType = keyof typeof BOX_TYPES;
export const BOX_TYPE_IDS = Object.keys(BOX_TYPES) as BoxType[];

export const BOX_TYPE_ALIASES = {
  giantball: 'beachBall',
  bumppadboost: 'bigBumpers',
  sticky: 'stickyGoo',
  ghost: 'ghosted',
  goalswap: 'swapGoals',
  bighead: 'bigHead',
  yellowcard: 'yellowCard',
  redcard: 'redCard'
} as const satisfies Record<string, BoxType>;
export type BoxTypeAlias = keyof typeof BOX_TYPE_ALIASES;
export type BoxTypeInput = BoxType | BoxTypeAlias;

export const BOX_SELECTION_WEIGHTS: Record<BoxType, number> = {
  beachBall: 130,
  moveBall: 80,
  swapGoals: 65,
  bigBumpers: 126,
  boost: 120,
  stickyGoo: 129,
  ramp: 140,
  block: 129,
  bigHead: 109,
  ghosted: 129,
  movePlayer: 80,
  yellowCard: 140,
  redCard: 123
};

export function normalizeBoxType(type: unknown): BoxType | null {
  if (BOX_TYPE_IDS.includes(type as BoxType)) return type as BoxType;
  if (typeof type !== 'string') return null;
  return BOX_TYPE_ALIASES[type.toLowerCase() as BoxTypeAlias] ?? null;
}

export function boxTargetPowerId(type: unknown): string | null {
  const normalized = normalizeBoxType(type);
  return normalized ? BOX_TYPES[normalized].targetId : null;
}

export type Vec = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type Quaternion = { x: number; y: number; z: number; w: number };
export type BoxAnchor = 'topMid' | 'bottomMid' | 'midLeft' | 'midRight';

// Ramp wedge footprint (also used by the client renderer). Kept in types.ts so
// the browser bundle never has to import shared/game.ts (which pulls in the
// Rapier WASM physics engine, server/test side only).
export const RAMP_HALF_LEN = 60;
export const RAMP_HALF_WIDTH = 34;

export const BUMPER_RADIUS = 44;
export const BIG_BUMPER_RADIUS = 60;
const STADIUM_BUMPER_OFFSET = 58;
export const BUMPERS: readonly Vec[] = [
  { x: STADIUM_BUMPER_OFFSET, y: STADIUM_BUMPER_OFFSET },
  { x: FIELD.width - STADIUM_BUMPER_OFFSET, y: STADIUM_BUMPER_OFFSET },
  { x: STADIUM_BUMPER_OFFSET, y: FIELD.height - STADIUM_BUMPER_OFFSET },
  { x: FIELD.width - STADIUM_BUMPER_OFFSET, y: FIELD.height - STADIUM_BUMPER_OFFSET }
] as const;

export type MapId = 'stadium' | 'moon' | 'volcano' | 'saturn' | 'original' | 'originalGlide' | 'originalBounce';
export const MAP_IDS: readonly MapId[] = ['stadium', 'moon', 'volcano', 'saturn', 'original', 'originalGlide', 'originalBounce'] as const;

export type MapPhysicsMultipliers = {
  babbleImpulseScale: number;
  settleSpeed: number;
  bumperPower: number;
  boostPadAccel: number;
  babbleDragPerTick: number;
  ballDragPerTick: number;
  beachBallDragPerTick: number;
  babbleRestitution: number;
  ballRestitution: number;
  wallRestitution: number;
  blockRestitution: number;
  babbleDensity: number;
  ballDensityBase: number;
};

export type MapConfig = {
  id: MapId;
  label: string;
  shortLabel: string;
  description: string;
  layout: {
    bumpers: readonly Vec[];
    bumperRadius: number;
    bigBumperRadius: number;
    boxSpawnAnchors: BoxAnchor[];
  };
  theme: {
    sky: number;
    fog: number;
    tableLeft: number;
    tableRight: number;
    plinth: number;
    frame: number;
    frameDark: number;
    fieldBase: number;
    stripeA: string;
    stripeB: string;
    line: string;
    bumperBase: number;
    bumperDrum: number;
    bumperCap: number;
    leftGoal: number;
    rightGoal: number;
    accent: string;
    pattern: 'stadium' | 'craters' | 'lava' | 'rings';
    gateStyle: 'classic' | 'sciFi' | 'volcanic' | 'orbital';
  };
  physics: MapPhysicsMultipliers;
};

const PHYSICS_1X: MapPhysicsMultipliers = {
  babbleImpulseScale: 1,
  settleSpeed: 1,
  bumperPower: 1,
  boostPadAccel: 1,
  babbleDragPerTick: 1,
  ballDragPerTick: 1,
  beachBallDragPerTick: 1,
  babbleRestitution: 1,
  ballRestitution: 1,
  wallRestitution: 1,
  blockRestitution: 1,
  babbleDensity: 1,
  ballDensityBase: 1
};

// Playtest candidates share the closest observed original arena layout so the
// user can compare physics alone. Their values bracket the remaining uncertainty
// in drag and restitution from the sparse original telemetry sample.
const ORIGINAL_LAYOUT: MapConfig['layout'] = {
  bumpers: BUMPERS,
  bumperRadius: BUMPER_RADIUS,
  bigBumperRadius: BIG_BUMPER_RADIUS,
  boxSpawnAnchors: ['topMid', 'bottomMid']
};
const ORIGINAL_THEME: MapConfig['theme'] = {
  sky: 0xffda36, fog: 0xf3c82d,
  tableLeft: 0x3152c9, tableRight: 0xf16655,
  plinth: 0xfffdf5, frame: 0x2cc7c1, frameDark: 0x22252e,
  fieldBase: 0x2aa9a8, stripeA: '#35cbc5', stripeB: '#239f9e',
  line: 'rgba(255,253,245,.94)', bumperBase: 0x22252e,
  bumperDrum: 0xf16655, bumperCap: 0xffda36,
  leftGoal: 0x3152c9, rightGoal: 0xf16655, accent: '#ffda36',
  pattern: 'stadium', gateStyle: 'classic'
};

export const MAPS: Record<MapId, MapConfig> = {
  stadium: {
    id: 'stadium',
    label: 'Unicap Qualifier',
    shortLabel: 'PlanetBall',
    description: 'PlanetBall\'s televised entry arena, framed by the Ball Office resource circuit.',
    layout: { bumpers: BUMPERS, bumperRadius: BUMPER_RADIUS, bigBumperRadius: BIG_BUMPER_RADIUS, boxSpawnAnchors: ['topMid', 'bottomMid'] },
    theme: {
      sky: 0xffda36,
      fog: 0xf3c82d,
      tableLeft: 0x3152c9,
      tableRight: 0xf16655,
      plinth: 0xfffdf5,
      frame: 0xf16655,
      frameDark: 0x22252e,
      fieldBase: 0x2cc7c1,
      stripeA: '#42d2cc',
      stripeB: '#25b8b3',
      line: 'rgba(255,253,245,.94)',
      bumperBase: 0x22252e,
      bumperDrum: 0xf16655,
      bumperCap: 0xffda36,
      leftGoal: 0x3152c9,
      rightGoal: 0xf16655,
      accent: '#ffda36',
      pattern: 'stadium',
      gateStyle: 'classic'
    },
    physics: {
      ...PHYSICS_1X,
      // Move the default map closer to the loved Moon feel: softer launch,
      // lower top speed, later settling, and more glide/carry.
      babbleImpulseScale: 0.94,
      settleSpeed: 0.88,
      babbleDragPerTick: 1.025,
      ballDragPerTick: 1.025,
      beachBallDragPerTick: 1.012,
      babbleRestitution: 1.04,
      ballRestitution: 1.06,
      wallRestitution: 1.04,
      babbleDensity: 0.94,
      ballDensityBase: 0.88
    }
  },
  moon: {
    id: 'moon',
    label: 'Moon Base',
    shortLabel: 'Low Orbit',
    description: 'A floaty Unicap relay above PlanetBall, with crater bumpers and broadcast gates.',
    layout: {
      bumpers: [
        { x: 155, y: 118 },
        { x: FIELD.width - 155, y: 118 },
        { x: 155, y: FIELD.height - 118 },
        { x: FIELD.width - 155, y: FIELD.height - 118 },
        { x: FIELD.width / 2, y: FIELD.height / 2 - 120 },
        { x: FIELD.width / 2, y: FIELD.height / 2 + 120 }
      ],
      bumperRadius: 34,
      bigBumperRadius: 50,
      boxSpawnAnchors: ['topMid', 'bottomMid', 'midLeft', 'midRight']
    },
    theme: {
      sky: 0xffda36,
      fog: 0xf0c42b,
      tableLeft: 0x263f9f,
      tableRight: 0x239f9e,
      plinth: 0xfffdf5,
      frame: 0x2cc7c1,
      frameDark: 0x22252e,
      fieldBase: 0x3152c9,
      stripeA: '#496bdb',
      stripeB: '#2948b7',
      line: 'rgba(255,253,245,.92)',
      bumperBase: 0x22252e,
      bumperDrum: 0x2cc7c1,
      bumperCap: 0xfffdf5,
      leftGoal: 0x3152c9,
      rightGoal: 0xf16655,
      accent: '#2cc7c1',
      pattern: 'craters',
      gateStyle: 'sciFi'
    },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.88,
      settleSpeed: 0.75,
      bumperPower: 1.04,
      boostPadAccel: 0.9,
      babbleDragPerTick: 1.06,
      ballDragPerTick: 1.05,
      beachBallDragPerTick: 1.03,
      babbleRestitution: 1.1,
      ballRestitution: 1.12,
      wallRestitution: 1.1,
      blockRestitution: 1.08,
      babbleDensity: 0.82,
      ballDensityBase: 0.7
    }
  },
  volcano: {
    id: 'volcano',
    label: 'Coral Foundry',
    shortLabel: 'Foundry',
    description: 'A hot resource works where coral rails and offset bumpers reward fearless angles.',
    layout: {
      bumpers: [
        { x: 210, y: 108 },
        { x: FIELD.width - 210, y: 108 },
        { x: 210, y: FIELD.height - 108 },
        { x: FIELD.width - 210, y: FIELD.height - 108 },
        { x: FIELD.width / 2, y: 86 },
        { x: FIELD.width / 2, y: FIELD.height - 86 }
      ],
      bumperRadius: 38,
      bigBumperRadius: 56,
      boxSpawnAnchors: ['topMid', 'bottomMid']
    },
    theme: {
      sky: 0xffda36,
      fog: 0xf6b43c,
      tableLeft: 0xf16655,
      tableRight: 0x3152c9,
      plinth: 0xfffdf5,
      frame: 0xf16655,
      frameDark: 0x22252e,
      fieldBase: 0x30333d,
      stripeA: '#414550',
      stripeB: '#292c34',
      line: 'rgba(255,253,245,.9)',
      bumperBase: 0x22252e,
      bumperDrum: 0xf16655,
      bumperCap: 0xffda36,
      leftGoal: 0x3152c9,
      rightGoal: 0xf16655,
      accent: '#ffda36',
      pattern: 'lava',
      gateStyle: 'volcanic'
    },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.98,
      settleSpeed: 0.9,
      bumperPower: 1.08,
      boostPadAccel: 1.18,
      babbleDragPerTick: 1.038,
      ballDragPerTick: 1.025,
      beachBallDragPerTick: 1.01,
      babbleRestitution: 1.04,
      ballRestitution: 1.08,
      wallRestitution: 1.1,
      blockRestitution: 1.18,
      babbleDensity: 0.94,
      ballDensityBase: 0.84
    }
  },
  saturn: {
    id: 'saturn',
    label: 'Saturn',
    shortLabel: 'Saturn',
    description: 'Unicap\'s heavy orbital final, with ring markings and dense slow-carry collisions.',
    layout: {
      bumpers: [
        { x: FIELD.width / 2 - 300, y: FIELD.height / 2 - 132 },
        { x: FIELD.width / 2 + 300, y: FIELD.height / 2 - 132 },
        { x: FIELD.width / 2 - 300, y: FIELD.height / 2 + 132 },
        { x: FIELD.width / 2 + 300, y: FIELD.height / 2 + 132 },
        { x: FIELD.width / 2, y: FIELD.height / 2 - 210 },
        { x: FIELD.width / 2, y: FIELD.height / 2 + 210 }
      ],
      bumperRadius: 34,
      bigBumperRadius: 54,
      boxSpawnAnchors: ['topMid', 'bottomMid', 'midLeft', 'midRight']
    },
    theme: {
      sky: 0xffda36,
      fog: 0xf0c42b,
      tableLeft: 0x3152c9,
      tableRight: 0x2cc7c1,
      plinth: 0xfffdf5,
      frame: 0xffda36,
      frameDark: 0x22252e,
      fieldBase: 0x3152c9,
      stripeA: '#405fce',
      stripeB: '#2947ae',
      line: 'rgba(255,253,245,.92)',
      bumperBase: 0x22252e,
      bumperDrum: 0x2cc7c1,
      bumperCap: 0xffda36,
      leftGoal: 0x3152c9,
      rightGoal: 0xf16655,
      accent: '#ffda36',
      pattern: 'rings',
      gateStyle: 'orbital'
    },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.86,
      settleSpeed: 0.82,
      bumperPower: 0.98,
      boostPadAccel: 0.92,
      babbleDragPerTick: 1.045,
      ballDragPerTick: 1.04,
      beachBallDragPerTick: 1.018,
      babbleRestitution: 0.96,
      ballRestitution: 0.98,
      wallRestitution: 0.96,
      blockRestitution: 0.95,
      babbleDensity: 3.25,
      ballDensityBase: 3.1
    }
  },
  original: {
    id: 'original',
    label: 'Original A · Tight',
    shortLabel: 'Original A',
    description: 'Original-game candidate A: Ball Office calibration with tighter tournament stopping.',
    layout: ORIGINAL_LAYOUT,
    theme: { ...ORIGINAL_THEME, accent: '#ffda36' },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.98,
      settleSpeed: 2.2, bumperPower: 0.96,
      boostPadAccel: 0.95,
      babbleDragPerTick: 1.045, ballDragPerTick: 1.045, beachBallDragPerTick: 1.02,
      babbleRestitution: 0.95, ballRestitution: 0.95,
      wallRestitution: 0.95, blockRestitution: 0.95,
      babbleDensity: 1.05, ballDensityBase: 1.15
    }
  },
  originalGlide: {
    id: 'originalGlide',
    label: 'Original B · Empirical',
    shortLabel: 'Original B',
    description: 'Original-game candidate B: Ball Office calibration for measured tournament glide.',
    layout: ORIGINAL_LAYOUT,
    theme: { ...ORIGINAL_THEME, accent: '#2cc7c1', frame: 0x2cc7c1 },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.99,
      settleSpeed: 1.7, bumperPower: 1,
      boostPadAccel: 1,
      babbleDragPerTick: 1.057, ballDragPerTick: 1.053, beachBallDragPerTick: 1.025,
      babbleRestitution: 1.05, ballRestitution: 1.05,
      wallRestitution: 1.03, blockRestitution: 1.05,
      babbleDensity: 1, ballDensityBase: 1
    }
  },
  originalBounce: {
    id: 'originalBounce',
    label: 'Original C · Glide',
    shortLabel: 'Original C',
    description: 'Original-game candidate C: the Ball Office\'s liveliest approved rebound profile.',
    layout: ORIGINAL_LAYOUT,
    theme: { ...ORIGINAL_THEME, accent: '#f16655', frame: 0xf16655 },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 1,
      settleSpeed: 1.25, bumperPower: 1.08,
      boostPadAccel: 1.05,
      babbleDragPerTick: 1.063, ballDragPerTick: 1.058, beachBallDragPerTick: 1.026,
      babbleRestitution: 1.12, ballRestitution: 1.08,
      wallRestitution: 1.08, blockRestitution: 1.12,
      babbleDensity: 0.95, ballDensityBase: 0.85
    }
  }
} as const;

export function normalizeMapId(mapId: unknown): MapId {
  return MAP_IDS.includes(mapId as MapId) ? mapId as MapId : 'stadium';
}

export type PlayerInput = { up: boolean; down: boolean; left: boolean; right: boolean; kick: boolean };
export type PlayerSide = 'left' | 'right';
export type EffectName = BoxType;
export type ActiveEffect = { type: EffectName; untilTurn: number; until?: number };

export type PlayerState = {
  id: string;
  accountId?: string;
  name: string;
  side: PlayerSide;
  team: TeamId;
  score: number;
  connected: boolean;
  controlledBabbleIds: string[];
};

export type BabbleState = {
  id: string;
  side: PlayerSide;
  pos: Vec;
  vel: Vec;
  height: number;
  verticalVelocity: number;
  radius: number;
  effects: ActiveEffect[];
  lastLaunchedTurn: number;
};
// spin accumulates rolling rotation (radians) derived from authoritative movement:
// spin.x from travel along field x, spin.y from travel along field y.
export type BallState = {
  pos: Vec;
  vel: Vec;
  height: number;
  verticalVelocity: number;
  radius: number;
  lastTouchedBy?: PlayerSide | null;
  lastTouchedBabbleId?: string | null;
  lastTouchedPlayerId?: string | null;
  // Rapier's full 3D orientation/spin is authoritative so airborne and
  // glancing-hit rotation survives networking and renders identically.
  rotation?: Quaternion;
  angularVelocity?: Vec3;
  // Legacy planar roll accumulator retained for protocol compatibility.
  spin?: Vec;
};
export type BoxState = { id: string; type: BoxType; anchor: BoxAnchor; pos: Vec; spawnedAt: number; untilTurn?: number };
export type FieldObjectType = 'boost' | 'stickyGoo' | 'ramp' | 'block';
export const FIELD_OBJECT_TYPES: readonly FieldObjectType[] = ['boost', 'stickyGoo', 'ramp', 'block'] as const;
export const ROTATABLE_FIELD_OBJECTS: readonly FieldObjectType[] = ['boost', 'ramp', 'block'] as const;
export type FieldObject = { id: string; type: FieldObjectType; owner: PlayerSide; pos: Vec; angle: number; untilTurn: number };
export type BumperEvent = { pos: Vec; at: number };
// Ramp launch feedback: which mover flew off which ramp lip, so the client can
// animate a visible hop/launch arc for exactly that mover.
export type RampEvent = { pos: Vec; at: number; mover: 'ball' | 'babble'; moverId?: string };
export type RoomPhase = 'lobby' | 'formationSelect' | 'planning' | 'resolving' | 'goal' | 'finished';
export type ChatEvent = { at: number; message: string };
export type TurnIntent = { babbleId: string; aimAngle: number; impulse: number };
export type PowerPlayUse = { type: BoxTypeInput; targetBabbleId?: string; position?: Vec; angle?: number };
// holderId: the specific player carrying this box. Each player may hold at most
// one box (server-enforced); teammates can see holders, opponents cannot.
export type InventoryItem = { type: BoxType; availableTurn: number; holderId?: string };
export type MatchConfig = {
  mapId: MapId;
  goalTarget: GameMode;
  length: GameLength;
  maxTurns: 30 | 90 | 150;
  turnDurationMs: number;
  allAimedResolveGraceMs: number;
  boxSpawnEveryTurns: 2;
  boxSpawnAnchors: BoxAnchor[];
};

export type GameState = {
  roomCode: string;
  phase: RoomPhase;
  mode: GameMode;
  mapId: MapId;
  config: MatchConfig;
  winner: PlayerSide | null;
  turn: number;
  kickoffAt: number;
  turnDeadlineAt: number;
  resolvingStartedAt: number | null;
  allIntentsReadyAt: number | null;
  readyPlayerIds: string[];
  nextBoxId: number;
  players: Record<string, PlayerState>;
  sideTeams: Record<PlayerSide, TeamId>;
  formationSelectionTurn: number | null;
  formations: Record<PlayerSide, FormationId>;
  babbles: BabbleState[];
  ball: BallState;
  boxes: BoxState[];
  fieldObjects: FieldObject[];
  bumperEvents: BumperEvent[];
  rampEvents: RampEvent[];
  bigBumpersUntilTurn: number | null;
  beachBallUntilTurn: number | null;
  pendingIntents: Record<string, TurnIntent>;
  powerPlayInventories: Record<PlayerSide, InventoryItem[]>;
  // Redacted box counts per side: opponents only ever learn how many boxes a
  // team holds, never the types or holders (set on server before emitting).
  powerPlayCounts?: Record<PlayerSide, number>;
  score: Record<PlayerSide, number>;
  swappedGoalsUntilTurn: number | null;
  events: ChatEvent[];
};

export type ClientToServerEvents = {
  'room:create': (payload: { name: string; team?: TeamId; mode: GameMode; mapId?: MapId }, cb: (r: JoinResult) => void) => void;
  'room:join': (payload: { roomCode: string; name: string; team?: TeamId }, cb: (r: JoinResult) => void) => void;
  'player:input': (input: PlayerInput) => void;
  'player:launch': (intent: TurnIntent) => void;
  'player:power': (use: PowerPlayUse) => void;
  'player:ready': () => void;
  'player:fieldRotate': (payload: { id: string; angle?: number }) => void;
  'player:formation': (formation: FormationId) => void;
  'player:team': (team: TeamId) => void;
  'room:map': (mapId: MapId) => void;
  // Dev/test-only hooks (window.__babbleDev). Rejected by production servers
  // unless ENABLE_CHEATS=true.
  'player:cheatBoxes': () => void;
  'player:cheatBox': (payload: { type: BoxTypeInput }) => void;
  'room:leave': () => void;
  'game:start': () => void;
  'game:reset': (mode: GameMode) => void;
};

export type ServerToClientEvents = {
  'game:state': (state: GameState, you: string) => void;
  'room:error': (message: string) => void;
  'analytics:event': (event: import('./analytics').AnalyticsEvent) => void;
};

export type JoinResult = { ok: true; roomCode: string; playerId: string } | { ok: false; error: string };
