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

export type RobotShape = 'orb' | 'block' | 'wedge' | 'walker';
export type RobotProfile = {
  shape: RobotShape;
  texture: string;
  trait: string;
  motion: 'static' | 'rotatingBase';
  smoothness: number;
  density: number;
  restitution: number;
  width: number;
  depth: number;
  height: number;
};

export const TEAMS = {
  pigs: {
    label: 'Flux Orbs', shortLabel: 'Orbs', primary: '#f15f4f', secondary: '#fff4d8',
    crest: '/assets/teams/flux-orbs-robot.webp',
    lore: 'Self-balancing spherical robots built for clean redirects and reliable control across every PlanetBall arena.',
    robot: {
      shape: 'orb', texture: '/assets/robots/flux-orbs-surface.jpg',
      trait: 'Balanced sphere: predictable rebounds and neutral weight for controlled passing lanes.',
      motion: 'static', smoothness: 0.92,
      density: 1, restitution: 1, width: 0.88, depth: 0.88, height: 1.62
    }
  },
  tigers: {
    label: 'Forge Blocks', shortLabel: 'Blocks', primary: '#ffc933', secondary: '#232533',
    crest: '/assets/teams/forge-blocks-robot.webp',
    lore: 'Dense foundry robots with squared armor, designed to absorb hard contact and hold a defensive line.',
    robot: {
      shape: 'block', texture: '/assets/robots/forge-blocks-surface.jpg',
      trait: 'Heavy rounded block: steadier on impact with softer rebounds for defensive holds.',
      motion: 'static', smoothness: 0.78,
      density: 1.18, restitution: 0.9, width: 1.02, depth: 0.92, height: 1.48
    }
  },
  bees: {
    label: 'Vector Wedges', shortLabel: 'Wedges', primary: '#dbe8ff', secondary: '#3454c5',
    crest: '/assets/teams/vector-wedges-robot.webp',
    lore: 'Light triangular robots from the lunar relay yards, tuned for sharp angles and lively attacking deflections.',
    robot: {
      shape: 'wedge', texture: '/assets/robots/vector-wedges-surface.jpg',
      trait: 'Light ramp wedge: lifts low contacts and creates lively attacking deflections.',
      motion: 'static', smoothness: 0.72,
      density: 0.86, restitution: 1.1, width: 1.06, depth: 0.86, height: 1.5
    }
  },
  parrots: {
    label: 'Halo Walkers', shortLabel: 'Walkers', primary: '#31c9b8', secondary: '#9f2638',
    crest: '/assets/teams/halo-walkers-robot.webp',
    lore: 'Wide three-footed ring machines from Saturn, built to catch glancing passes across an elongated footprint.',
    robot: {
      shape: 'walker', texture: '/assets/robots/halo-walkers-surface.jpg',
      trait: 'Wide rotating walker: broader side contact with a stable, controlled rebound.',
      motion: 'rotatingBase', smoothness: 0.86,
      density: 1.08, restitution: 0.96, width: 1.12, depth: 0.76, height: 1.7
    }
  }
} as const satisfies Record<string, { label: string; shortLabel: string; primary: string; secondary: string; crest: string; lore: string; robot: RobotProfile }>;
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
export const FORMATION_LAYOUTS: Record<FormationId, readonly { x: number; y: number }[]> = {
  forward: [{ x: 0, y: -120 }, { x: 80, y: -40 }, { x: 80, y: 40 }, { x: 0, y: 120 }],
  option: [{ x: 80, y: -120 }, { x: 80, y: 0 }, { x: 80, y: 120 }, { x: -35, y: 0 }],
  slant: [{ x: 95, y: -135 }, { x: 45, y: -45 }, { x: -5, y: 45 }, { x: -55, y: 135 }],
  zone: [{ x: 40, y: -135 }, { x: 80, y: -45 }, { x: 80, y: 45 }, { x: 40, y: 135 }],
  wall: [{ x: 0, y: -135 }, { x: 0, y: -45 }, { x: 0, y: 45 }, { x: 0, y: 135 }],
  box: [{ x: 35, y: -95 }, { x: 105, y: -95 }, { x: 35, y: 95 }, { x: 105, y: 95 }],
  rush: [{ x: 110, y: -80 }, { x: 110, y: 80 }, { x: -5, y: -80 }, { x: -5, y: 80 }]
};

export const BOX_TYPES = {
  beachBall: { label: 'Beach Ball', targetId: 'giantball', color: '#facc15', category: 'instant', durationTurns: 1, description: 'Enlarge and lighten the ball for the current turn, making every bounce higher and harder to contain.' },
  moveBall: { label: 'Move Ball', targetId: 'moveball', color: '#fb923c', category: 'instant', durationTurns: 0, description: 'Teleport the ball to a legal field position you choose, with its movement reset on arrival.' },
  swapGoals: { label: 'Swap Goals', targetId: 'goalswap', color: '#e879f9', category: 'instant', durationTurns: 1, description: 'Reverse which goal scores for each side, turning familiar attacks into dangerous own goals.' },
  bigBumpers: { label: 'Big Bumpers', targetId: 'bumppadboost', color: '#f97316', category: 'instant', durationTurns: 1, description: 'Enlarge every arena bumper and increase its kick for the remainder of the current turn.' },
  boost: { label: 'Boost', targetId: 'boost', color: '#38bdf8', category: 'field', durationTurns: 1, description: 'Place and rotate a directional boost pad that accelerates every ball or robot crossing it.' },
  stickyGoo: { label: 'Sticky Goo', targetId: 'sticky', color: '#84cc16', category: 'field', durationTurns: 1, description: 'Place a temporary slow zone that drains momentum from every ball or robot entering it.' },
  ramp: { label: 'Trampoline', targetId: 'ramp', color: '#a78bfa', category: 'field', durationTurns: 1, description: 'Place a physical ramp for this turn. It adds no artificial boost.' },
  block: { label: 'Block', targetId: 'block', color: '#94a3b8', category: 'field', durationTurns: 1, description: 'Place and rotate a temporary physical wall to close a lane or manufacture a bank shot.' },
  bigHead: { label: 'Big Head', targetId: 'bighead', color: '#ef4444', category: 'babble', durationTurns: 1, description: 'Target babblehead grows into a larger, heavier physical collider.' },
  ghosted: { label: 'Ghosted', targetId: 'ghost', color: '#d8b4fe', category: 'babble', durationTurns: 1, description: 'Target babblehead passes through babbleheads and boxes.' },
  movePlayer: { label: 'Move Player', targetId: 'moveplayer', color: '#fde047', category: 'babble', durationTurns: 0, description: 'Reposition a chosen robot at a legal field point and reset its momentum on arrival.' },
  yellowCard: { label: 'Yellow Card', targetId: 'yellowcard', color: '#facc15', category: 'instant', durationTurns: 0, description: 'Stop play around the ball and return it immediately to the exact center of the field.' },
  redCard: { label: 'Red Card', targetId: 'redcard', color: '#ef4444', category: 'babble', durationTurns: 0, description: 'Choose any robot and teleport it to midfield with all of its current momentum removed.' },
  readPlay: { label: 'Read the Play', targetId: 'readplay', color: '#6ee7f5', category: 'instant', durationTurns: 1, description: 'Reveal the opposing team\'s committed launch paths for the remainder of the current turn.' },
  blindness: { label: 'Blindness', targetId: 'blindness', color: '#11131a', category: 'instant', durationTurns: 1, description: 'Black out the opposing team\'s match view until the current turn ends; a warning explains the effect.' }
} as const;
export type BoxType = keyof typeof BOX_TYPES;
export const BOX_TYPE_IDS = Object.keys(BOX_TYPES) as BoxType[];
export const PLANNING_TIMER_RESET_BOX_TYPES: readonly BoxType[] = ['swapGoals', 'yellowCard', 'redCard'];
export function resetsPlanningTimer(type: BoxType) {
  return PLANNING_TIMER_RESET_BOX_TYPES.includes(type);
}

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
  redCard: 123,
  readPlay: 88,
  blindness: 72
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

export type MapId = 'stadium' | 'moon' | 'volcano' | 'saturn';
export const MAP_IDS: readonly MapId[] = ['stadium', 'moon', 'volcano', 'saturn'] as const;

export type MapPhysicsMultipliers = {
  gravity: number;
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
  lore: string;
  physicsSummary: string;
  art: {
    fieldTexture: string;
    surroundings: string;
  };
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

// Original B was the most representative calibration profile. Public lore maps
// inherit it, then apply only the modifiers that make their arena distinct.
const ORIGINAL_PHYSICS_BASE: MapPhysicsMultipliers = {
  gravity: 1,
  babbleImpulseScale: 0.99,
  settleSpeed: 1.7,
  bumperPower: 1,
  boostPadAccel: 1,
  babbleDragPerTick: 1.057,
  ballDragPerTick: 1.053,
  beachBallDragPerTick: 1.025,
  babbleRestitution: 1.05,
  ballRestitution: 1.05,
  wallRestitution: 1.03,
  blockRestitution: 1.05,
  babbleDensity: 1,
  ballDensityBase: 1
};

export const MAPS: Record<MapId, MapConfig> = {
  stadium: {
    id: 'stadium',
    label: 'PlanetBall',
    shortLabel: 'PlanetBall',
    description: 'PlanetBall\'s televised entry arena, framed by the Ball Office resource circuit.',
    lore: 'The first sanctioned Unicup pitch circles the Ball Office, where new teams prove they can compete before the resource board notices their names.',
    physicsSummary: 'Original-calibrated gravity with quick settling, lively walls, and a slightly lighter tournament ball.',
    art: { fieldTexture: '/assets/maps/planetball-field.jpg', surroundings: '/assets/maps/planetball-surroundings.jpg' },
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
      ...ORIGINAL_PHYSICS_BASE,
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
    label: 'Moon',
    shortLabel: 'Moon',
    description: 'A floaty Unicap relay above PlanetBall, with crater bumpers and broadcast gates.',
    lore: 'An abandoned lunar relay became the league\'s quietest venue, where long airborne arcs hang over old transmission dishes and crater glass.',
    physicsSummary: 'Thirty-eight percent gravity, lower density, slower impulses, and the liveliest ball and wall rebounds.',
    art: { fieldTexture: '/assets/maps/moon-field.jpg', surroundings: '/assets/maps/moon-surroundings.jpg' },
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
      ...ORIGINAL_PHYSICS_BASE,
      gravity: 0.38,
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
    lore: 'A coral resource foundry opened its cooling deck to Unicup after workers used maintenance spheres to invent impossible bank shots.',
    physicsSummary: 'Slightly heavier gravity with powerful bumpers, stronger boost pads, and hard block rebounds.',
    art: { fieldTexture: '/assets/maps/coral-foundry-field.jpg', surroundings: '/assets/maps/coral-foundry-surroundings.jpg' },
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
      ...ORIGINAL_PHYSICS_BASE,
      gravity: 1.12,
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
    lore: 'Saturn\'s ring keepers built this final above a freight orbit, using crushing local mass to test patience instead of raw launch power.',
    physicsSummary: 'One hundred thirty-six percent gravity, dense bodies, reduced impulse, and muted rebounds that reward control.',
    art: { fieldTexture: '/assets/maps/saturn-field.jpg', surroundings: '/assets/maps/saturn-surroundings.jpg' },
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
      ...ORIGINAL_PHYSICS_BASE,
      gravity: 1.36,
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
  country?: string;
  name: string;
  avatarUrl?: string;
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
  roundTimeSeconds: number;
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
  serverNowAt?: number;
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
  moveVisionUntilTurn: Record<PlayerSide, number | null>;
  blindnessUntilTurn: Record<PlayerSide, number | null>;
  events: ChatEvent[];
};

export type ClientToServerEvents = {
  'room:create': (payload: { name: string; avatarUrl?: string; team?: TeamId; mode: GameMode; mapId?: MapId; roundTimeSeconds?: number }, cb: (r: JoinResult) => void) => void;
  'room:join': (payload: { roomCode: string; name: string; avatarUrl?: string; team?: TeamId }, cb: (r: JoinResult) => void) => void;
  'player:input': (input: PlayerInput) => void;
  'player:launch': (intent: TurnIntent) => void;
  'player:power': (use: PowerPlayUse) => void;
  'player:ready': () => void;
  'player:fieldRotate': (payload: { id: string; angle?: number }) => void;
  'player:formation': (formation: FormationId) => void;
  'player:team': (team: TeamId) => void;
  'player:side': (side: PlayerSide) => void;
  'room:roundTime': (seconds: number) => void;
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
