export const FIELD = {
  width: 1100,
  height: 620,
  goalDepth: 34,
  goalY: 205,
  goalHeight: 210,
  playerRadius: 24,
  bobbleRadius: 24,
  ballRadius: 14,
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
  moveBall: { label: 'Move Ball', color: '#fb923c', category: 'instant', durationTurns: 0, description: 'Move the ball back to center.' },
  swapGoals: { label: 'Swap Goals', color: '#e879f9', category: 'instant', durationTurns: 1, description: 'Flip scoring direction for one turn.' },
  bigBumpers: { label: 'Big Bumpers', color: '#f97316', category: 'instant', durationTurns: 1, description: 'Corner bumpers grow stronger for one turn.' },
  boost: { label: 'Boost', color: '#38bdf8', category: 'field', durationTurns: 1, description: 'Place a directional boost pad.' },
  stickyGoo: { label: 'Sticky Goo', color: '#84cc16', category: 'field', durationTurns: 1, description: 'Place a sticky slow zone.' },
  ramp: { label: 'Ramp', color: '#a78bfa', category: 'field', durationTurns: 1, description: 'Place a ramp deflector.' },
  block: { label: 'Block', color: '#94a3b8', category: 'field', durationTurns: 1, description: 'Place a temporary wall.' },
  bigHead: { label: 'Big Head', color: '#ef4444', category: 'bobble', durationTurns: 1, description: 'Target bobble grows and kicks harder.' },
  ghosted: { label: 'Ghosted', color: '#d8b4fe', category: 'bobble', durationTurns: 1, description: 'Target bobble passes through bobbles and boxes.' },
  movePlayer: { label: 'Move Player', color: '#fde047', category: 'bobble', durationTurns: 0, description: 'Move a target bobble to center field.' }
} as const;
export type BoxType = keyof typeof BOX_TYPES;
export const BOX_TYPE_IDS = Object.keys(BOX_TYPES) as BoxType[];

export type Vec = { x: number; y: number };

export const BUMPER_RADIUS = 36;
export const BIG_BUMPER_RADIUS = 52;
export const BUMPERS: readonly Vec[] = [
  { x: 92, y: 92 },
  { x: FIELD.width - 92, y: 92 },
  { x: 92, y: FIELD.height - 92 },
  { x: FIELD.width - 92, y: FIELD.height - 92 }
] as const;

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
  controlledBobbleIds: string[];
};

export type BobbleState = {
  id: string;
  side: PlayerSide;
  pos: Vec;
  vel: Vec;
  radius: number;
  effects: ActiveEffect[];
  lastLaunchedTurn: number;
};
export type BallState = { pos: Vec; vel: Vec; radius: number };
export type BoxAnchor = 'topMid' | 'bottomMid' | 'midLeft' | 'midRight';
export type BoxState = { id: string; type: BoxType; anchor: BoxAnchor; pos: Vec; spawnedAt: number };
export type FieldObjectType = 'boost' | 'stickyGoo' | 'ramp' | 'block';
export const FIELD_OBJECT_TYPES: readonly FieldObjectType[] = ['boost', 'stickyGoo', 'ramp', 'block'] as const;
export const ROTATABLE_FIELD_OBJECTS: readonly FieldObjectType[] = ['boost', 'ramp', 'block'] as const;
export type FieldObject = { id: string; type: FieldObjectType; owner: PlayerSide; pos: Vec; angle: number; untilTurn: number };
export type BumperEvent = { pos: Vec; at: number };
export type RoomPhase = 'lobby' | 'formationSelect' | 'planning' | 'resolving' | 'goal' | 'finished';
export type ChatEvent = { at: number; message: string };
export type TurnIntent = { bobbleId: string; aimAngle: number; impulse: number };
export type PowerPlayUse = { type: BoxType; targetBobbleId?: string; position?: Vec; angle?: number };
export type InventoryItem = { type: BoxType; availableTurn: number };
export type MatchConfig = {
  goalTarget: GameMode;
  length: GameLength;
  maxTurns: 30 | 90 | 150;
  turnDurationMs: number;
  boxSpawnEveryTurns: 2;
  boxSpawnAnchors: BoxAnchor[];
};

export type GameState = {
  roomCode: string;
  phase: RoomPhase;
  mode: GameMode;
  config: MatchConfig;
  winner: PlayerSide | null;
  turn: number;
  kickoffAt: number;
  turnDeadlineAt: number;
  resolvingStartedAt: number | null;
  nextBoxId: number;
  players: Record<string, PlayerState>;
  formations: Record<PlayerSide, FormationId>;
  bobbles: BobbleState[];
  ball: BallState;
  boxes: BoxState[];
  fieldObjects: FieldObject[];
  bumperEvents: BumperEvent[];
  bigBumpersUntilTurn: number | null;
  beachBallUntilTurn: number | null;
  pendingIntents: Record<string, TurnIntent>;
  powerPlayInventories: Record<PlayerSide, InventoryItem[]>;
  score: Record<PlayerSide, number>;
  swappedGoalsUntilTurn: number | null;
  events: ChatEvent[];
};

export type ClientToServerEvents = {
  'room:create': (payload: { name: string; team: TeamId; mode: GameMode }, cb: (r: JoinResult) => void) => void;
  'room:join': (payload: { roomCode: string; name: string; team: TeamId }, cb: (r: JoinResult) => void) => void;
  'player:input': (input: PlayerInput) => void;
  'player:launch': (intent: TurnIntent) => void;
  'player:power': (use: PowerPlayUse) => void;
  'player:fieldRotate': (payload: { id: string }) => void;
  'player:formation': (formation: FormationId) => void;
  'player:team': (team: TeamId) => void;
  'game:start': () => void;
  'game:reset': (mode: GameMode) => void;
};

export type ServerToClientEvents = {
  'game:state': (state: GameState, you: string) => void;
  'room:error': (message: string) => void;
};

export type JoinResult = { ok: true; roomCode: string; playerId: string } | { ok: false; error: string };
