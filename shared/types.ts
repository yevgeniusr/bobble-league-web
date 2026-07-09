export const FIELD = {
  width: 1100,
  height: 620,
  goalDepth: 34,
  goalY: 205,
  goalHeight: 210,
  playerRadius: 18,
  babbleRadius: 18,
  ballRadius: 22,
  boxSize: 34
} as const;

export const TEAMS = {
  bees: { label: 'B-Team', emoji: '🐝', primary: '#fcc84c', secondary: '#111827' },
  fowl: { label: 'Flagrant Fowl', emoji: '🐔', primary: '#de4f49', secondary: '#fff7ed' },
  bears: { label: 'Troubles Bruin', emoji: '🐻', primary: '#f28625', secondary: '#3f2412' },
  cats: { label: 'Bad Cattitude', emoji: '🐯', primary: '#1a898d', secondary: '#dffbff' },
  pigs: { label: 'Piggy in Pink', emoji: '🐷', primary: '#f8b196', secondary: '#5b2135' },
  bulls: { label: 'Milk Buds', emoji: '🐮', primary: '#66ac61', secondary: '#f1faee' },
  dinos: { label: 'T-Wrecks', emoji: '🦖', primary: '#b895c1', secondary: '#2b1533' },
  snow: { label: 'Snow Ballers', emoji: '☃️', primary: '#5c64d1', secondary: '#eff6ff' },
  parrots: { label: 'Party Parrots', emoji: '🦜', primary: '#24c06f', secondary: '#f7d64a' },
  tigers: { label: 'Stripe Squad', emoji: '🐯', primary: '#f77f00', secondary: '#111827' }
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

export type FormationId = 'forward' | 'option' | 'slant' | 'zone' | 'box' | 'rush';
export const FORMATIONS: Record<FormationId, { label: string; description: string }> = {
  forward: { label: 'Forward', description: 'Four attackers press high.' },
  option: { label: 'Option', description: 'Three attackers and a safety.' },
  slant: { label: 'Slant', description: 'Aggressive diagonal push toward boxes.' },
  zone: { label: 'Zone', description: 'Balanced lanes with one defender.' },
  box: { label: 'Box', description: 'Four defenders packed near goal.' },
  rush: { label: 'Rush', description: 'Two attackers and two defenders.' }
};
export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

export const BOX_TYPES = {
  beachBall: { label: 'Beach Ball', color: '#facc15', category: 'instant', durationTurns: 1, description: 'Enlarge and lighten the ball for this turn.' },
  moveBall: { label: 'Move Ball', color: '#fb923c', category: 'instant', durationTurns: 0, description: 'Teleport the ball to any spot you click.' },
  swapGoals: { label: 'Swap Goals', color: '#e879f9', category: 'instant', durationTurns: 1, description: 'Flip scoring direction for one turn.' },
  bigBumpers: { label: 'Big Bumpers', color: '#f97316', category: 'instant', durationTurns: 1, description: 'Corner bumpers grow stronger for one turn.' },
  boost: { label: 'Boost', color: '#38bdf8', category: 'field', durationTurns: 1, description: 'Place a directional boost pad.' },
  stickyGoo: { label: 'Sticky Goo', color: '#84cc16', category: 'field', durationTurns: 1, description: 'Place a sticky slow zone.' },
  ramp: { label: 'Ramp', color: '#a78bfa', category: 'field', durationTurns: 1, description: 'Place a ramp deflector.' },
  block: { label: 'Block', color: '#94a3b8', category: 'field', durationTurns: 1, description: 'Place a temporary wall.' },
  bigHead: { label: 'Big Head', color: '#ef4444', category: 'babble', durationTurns: 1, description: 'Target babblehead grows and kicks harder.' },
  ghosted: { label: 'Ghosted', color: '#d8b4fe', category: 'babble', durationTurns: 1, description: 'Target babblehead passes through babbleheads and boxes.' },
  movePlayer: { label: 'Move Player', color: '#fde047', category: 'babble', durationTurns: 0, description: 'Move a target babblehead back toward center field.' }
} as const;
export type BoxType = keyof typeof BOX_TYPES;
export const BOX_TYPE_IDS = Object.keys(BOX_TYPES) as BoxType[];

export type Vec = { x: number; y: number };
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

export type MapId = 'stadium' | 'moon' | 'volcano' | 'saturn';
export const MAP_IDS: readonly MapId[] = ['stadium', 'moon', 'volcano', 'saturn'] as const;

export type MapPhysicsMultipliers = {
  babbleImpulseScale: number;
  maxSpeed: number;
  settleSpeed: number;
  lowSpeedBrakeThreshold: number;
  lowSpeedBrakeFactor: number;
  bumperBoost: number;
  bumperMinExitBall: number;
  bumperMinExitBabble: number;
  bigBumperBoostMult: number;
  bigBumperRestitution: number;
  boostPadAccel: number;
  rampLaunchSpeed: number;
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
  maxSpeed: 1,
  settleSpeed: 1,
  lowSpeedBrakeThreshold: 1,
  lowSpeedBrakeFactor: 1,
  bumperBoost: 1,
  bumperMinExitBall: 1,
  bumperMinExitBabble: 1,
  bigBumperBoostMult: 1,
  bigBumperRestitution: 1,
  boostPadAccel: 1,
  rampLaunchSpeed: 1,
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

export const MAPS: Record<MapId, MapConfig> = {
  stadium: {
    id: 'stadium',
    label: 'Stadium',
    shortLabel: 'Stadium',
    description: 'The classic Babble League arena with corner bumpers and standard tabletop physics.',
    layout: { bumpers: BUMPERS, bumperRadius: BUMPER_RADIUS, bigBumperRadius: BIG_BUMPER_RADIUS, boxSpawnAnchors: ['topMid', 'bottomMid'] },
    theme: {
      sky: 0xf16845,
      fog: 0xf16845,
      tableLeft: 0xf3714d,
      tableRight: 0xea5a41,
      plinth: 0xfff3be,
      frame: 0xf7b43a,
      frameDark: 0xe89a2b,
      fieldBase: 0x2c9297,
      stripeA: '#56c6c8',
      stripeB: '#32adb2',
      line: 'rgba(255,255,255,.85)',
      bumperBase: 0x9b5144,
      bumperDrum: 0xc94d5b,
      bumperCap: 0xffe08a,
      leftGoal: 0x4a5ad6,
      rightGoal: 0xf05d48,
      accent: '#ffe86a',
      pattern: 'stadium',
      gateStyle: 'classic'
    },
    physics: {
      ...PHYSICS_1X,
      // Move the default map closer to the loved Moon feel: softer launch,
      // lower top speed, later settling, and more glide/carry.
      babbleImpulseScale: 0.94,
      maxSpeed: 0.97,
      settleSpeed: 0.88,
      lowSpeedBrakeThreshold: 0.78,
      lowSpeedBrakeFactor: 1.04,
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
    shortLabel: 'Moon',
    description: 'Low-grip lunar felt with floatier movement, bouncier walls, crater bumpers, and sci-fi gates.',
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
      sky: 0x101827,
      fog: 0x1b2440,
      tableLeft: 0x172033,
      tableRight: 0x101827,
      plinth: 0xd7e3f6,
      frame: 0x6dd8ff,
      frameDark: 0x405174,
      fieldBase: 0x72819a,
      stripeA: '#8593aa',
      stripeB: '#697892',
      line: 'rgba(232,244,255,.82)',
      bumperBase: 0x45536f,
      bumperDrum: 0x7dd3fc,
      bumperCap: 0xe0f7ff,
      leftGoal: 0x67e8f9,
      rightGoal: 0xc084fc,
      accent: '#bfdbfe',
      pattern: 'craters',
      gateStyle: 'sciFi'
    },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.88,
      maxSpeed: 0.93,
      settleSpeed: 0.75,
      lowSpeedBrakeThreshold: 0.55,
      lowSpeedBrakeFactor: 1.12,
      bumperBoost: 0.88,
      bumperMinExitBall: 0.86,
      bumperMinExitBabble: 0.86,
      bigBumperBoostMult: 0.92,
      bigBumperRestitution: 1.04,
      boostPadAccel: 0.9,
      rampLaunchSpeed: 0.92,
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
    label: 'Volcano Bowl',
    shortLabel: 'Volcano',
    description: 'Hot lava rails, offset volcanic bumpers, faster boosts, and harsher hazard bounces.',
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
      sky: 0x2a100c,
      fog: 0x5a1f11,
      tableLeft: 0x4a140d,
      tableRight: 0x2d0d0a,
      plinth: 0x2f1b17,
      frame: 0xf97316,
      frameDark: 0x7c2d12,
      fieldBase: 0x4a1d1a,
      stripeA: '#5f2420',
      stripeB: '#3d1715',
      line: 'rgba(255,196,120,.78)',
      bumperBase: 0x6b1f13,
      bumperDrum: 0xef4444,
      bumperCap: 0xfbbf24,
      leftGoal: 0xffb84d,
      rightGoal: 0xff4d4d,
      accent: '#fed7aa',
      pattern: 'lava',
      gateStyle: 'volcanic'
    },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.98,
      maxSpeed: 1,
      settleSpeed: 0.9,
      lowSpeedBrakeThreshold: 0.82,
      lowSpeedBrakeFactor: 1.03,
      bumperBoost: 1.28,
      bumperMinExitBall: 1.2,
      bumperMinExitBabble: 1.16,
      bigBumperBoostMult: 1.1,
      bigBumperRestitution: 1.08,
      boostPadAccel: 1.18,
      rampLaunchSpeed: 1.15,
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
    description: 'A heavy orbital arena with ring markings, satellite bumpers, and dense slow-carry collisions.',
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
      sky: 0x100b20,
      fog: 0x241235,
      tableLeft: 0x2b1740,
      tableRight: 0x151426,
      plinth: 0xf5dfaa,
      frame: 0xd8a848,
      frameDark: 0x76532f,
      fieldBase: 0x3f5572,
      stripeA: '#596f8d',
      stripeB: '#3f5572',
      line: 'rgba(255,235,173,.84)',
      bumperBase: 0x72533a,
      bumperDrum: 0x8bd3dd,
      bumperCap: 0xf6d365,
      leftGoal: 0x7dd3fc,
      rightGoal: 0xf9a8d4,
      accent: '#f6d365',
      pattern: 'rings',
      gateStyle: 'orbital'
    },
    physics: {
      ...PHYSICS_1X,
      babbleImpulseScale: 0.86,
      maxSpeed: 0.88,
      settleSpeed: 0.82,
      lowSpeedBrakeThreshold: 0.72,
      lowSpeedBrakeFactor: 1.04,
      bumperBoost: 1.02,
      bumperMinExitBall: 0.96,
      bumperMinExitBabble: 0.96,
      bigBumperBoostMult: 0.96,
      bigBumperRestitution: 0.98,
      boostPadAccel: 0.92,
      rampLaunchSpeed: 0.9,
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
  radius: number;
  effects: ActiveEffect[];
  lastLaunchedTurn: number;
};
// spin accumulates rolling rotation (radians) derived from authoritative movement:
// spin.x from travel along field x, spin.y from travel along field y.
export type BallState = { pos: Vec; vel: Vec; radius: number; lastTouchedBy?: PlayerSide | null; spin?: Vec };
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
export type PowerPlayUse = { type: BoxType; targetBabbleId?: string; position?: Vec; angle?: number };
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
  'player:cheatBox': (payload: { type: BoxType }) => void;
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
