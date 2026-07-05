export const FIELD = {
  width: 1100,
  height: 620,
  goalDepth: 34,
  goalY: 205,
  goalHeight: 210,
  playerRadius: 24,
  ballRadius: 14,
  boxSize: 34
} as const;

export const TEAMS = {
  pigs: { label: 'Pigs', emoji: '🐷', primary: '#ff8fb3', secondary: '#ffd1dc' },
  parrots: { label: 'Parrots', emoji: '🦜', primary: '#24c06f', secondary: '#f7d64a' },
  penguins: { label: 'Penguins', emoji: '🐧', primary: '#1d3557', secondary: '#f1faee' },
  tigers: { label: 'Tigers', emoji: '🐯', primary: '#f77f00', secondary: '#111827' },
  frogs: { label: 'Frogs', emoji: '🐸', primary: '#56c271', secondary: '#f3f86f' },
  foxes: { label: 'Foxes', emoji: '🦊', primary: '#fb6f24', secondary: '#fff3d7' }
} as const;

export type TeamId = keyof typeof TEAMS;
export const TEAM_IDS = Object.keys(TEAMS) as TeamId[];

export type GameMode = 1 | 3 | 5;
export const GAME_MODES: GameMode[] = [1, 3, 5];

export const BOX_TYPES = {
  speed: { label: 'Turbo Boots', color: '#38bdf8', durationMs: 7000, description: 'Move 70% faster.' },
  slow: { label: 'Mud Boots', color: '#92400e', durationMs: 5500, description: 'Opponent moves slower.' },
  big: { label: 'Giant Head', color: '#f97316', durationMs: 7000, description: 'Your bobble grows and tackles harder.' },
  tiny: { label: 'Tiny Trouble', color: '#a78bfa', durationMs: 6500, description: 'Opponent shrinks and loses tackling reach.' },
  freeze: { label: 'Brain Freeze', color: '#67e8f9', durationMs: 2800, description: 'Opponent is frozen briefly.' },
  ghost: { label: 'Ghost Mode', color: '#d8b4fe', durationMs: 5500, description: 'Phase through players, not walls or ball.' },
  magnet: { label: 'Ball Magnet', color: '#f43f5e', durationMs: 6000, description: 'Ball is pulled toward you.' },
  bomb: { label: 'Boom Box', color: '#ef4444', durationMs: 1, description: 'Explodes the ball away from you.' },
  shield: { label: 'Goal Shield', color: '#22c55e', durationMs: 6500, description: 'Adds a temporary blocker in your goal.' },
  swap: { label: 'Swap Spell', color: '#fde047', durationMs: 1, description: 'Swap places with the nearest opponent.' }
} as const;
export type BoxType = keyof typeof BOX_TYPES;
export const BOX_TYPE_IDS = Object.keys(BOX_TYPES) as BoxType[];

export type Vec = { x: number; y: number };
export type PlayerInput = { up: boolean; down: boolean; left: boolean; right: boolean; kick: boolean };
export type PlayerSide = 'left' | 'right';
export type EffectName = BoxType;
export type ActiveEffect = { type: EffectName; until: number };

export type PlayerState = {
  id: string;
  name: string;
  side: PlayerSide;
  team: TeamId;
  pos: Vec;
  vel: Vec;
  radius: number;
  score: number;
  connected: boolean;
  effects: ActiveEffect[];
  lastKickAt: number;
};

export type BallState = { pos: Vec; vel: Vec; radius: number };
export type BoxState = { id: string; type: BoxType; pos: Vec; spawnedAt: number };
export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'goal' | 'finished';
export type ChatEvent = { at: number; message: string };

export type GameState = {
  roomCode: string;
  phase: RoomPhase;
  mode: GameMode;
  winner: PlayerSide | null;
  turn: number;
  kickoffAt: number;
  nextBoxId: number;
  players: Record<string, PlayerState>;
  ball: BallState;
  boxes: BoxState[];
  events: ChatEvent[];
};

export type ClientToServerEvents = {
  'room:create': (payload: { name: string; team: TeamId; mode: GameMode }, cb: (r: JoinResult) => void) => void;
  'room:join': (payload: { roomCode: string; name: string; team: TeamId }, cb: (r: JoinResult) => void) => void;
  'player:input': (input: PlayerInput) => void;
  'player:team': (team: TeamId) => void;
  'game:start': () => void;
  'game:reset': (mode: GameMode) => void;
};

export type ServerToClientEvents = {
  'game:state': (state: GameState, you: string) => void;
  'room:error': (message: string) => void;
};

export type JoinResult = { ok: true; roomCode: string; playerId: string } | { ok: false; error: string };
