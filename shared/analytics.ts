import {
  BoxState,
  BoxType,
  GameLength,
  GameMode,
  GameState,
  PlayerSide,
  PowerPlayUse,
  RoomPhase,
  TeamId,
  Vec
} from './types';
import { boxTargetPowerId, normalizeBoxType } from './types';

export type AnalyticsEventName = 'abilityUsed' | 'boxPickup' | 'gamePlayer' | 'goalScored';
export type GamePlayerLifecycle =
  | 'room_created'
  | 'room_joined'
  | 'player_reconnected'
  | 'player_left'
  | 'player_disconnected'
  | 'match_started'
  | 'match_reset';

export type AnalyticsPayload = {
  roomCode: string;
  timestamp: string;
  phase: RoomPhase;
  turn: number;
  score: Record<PlayerSide, number>;
  matchMode: GameMode;
  matchLength: GameLength;
  goalTarget: GameMode;
  maxTurns: number;
  winner: PlayerSide | null;
  mapId: string | null;
  playerId?: string;
  playerSide?: PlayerSide;
  playerTeam?: TeamId;
  playerName?: string;
  [key: string]: unknown;
};

export type AnalyticsEvent = {
  name: AnalyticsEventName;
  payload: AnalyticsPayload;
};

type BoxPickupDetails = {
  box: BoxState;
  holderId: string;
  holderSide: PlayerSide;
  collectorBabbleId?: string;
  pickupMethod: 'babble' | 'ball';
  replacedAbilityType?: BoxType;
  now?: number;
};

type GoalDetails = {
  scoringSide: PlayerSide;
  lastTouchedBy?: PlayerSide | null;
  lastTouchedBabbleId?: string | null;
  lastTouchedPlayerId?: string | null;
  ballPosition: Vec;
  now?: number;
};

const queues = new WeakMap<GameState, AnalyticsEvent[]>();

export function recordAnalyticsEvent(state: GameState, event: AnalyticsEvent) {
  const queue = queues.get(state) ?? [];
  queue.push(event);
  queues.set(state, queue);
}

export function drainAnalyticsEvents(state: GameState): AnalyticsEvent[] {
  const queue = queues.get(state) ?? [];
  queues.set(state, []);
  return queue;
}

function commonPayload(state: GameState, now = Date.now()): AnalyticsPayload {
  return {
    roomCode: state.roomCode,
    timestamp: new Date(now).toISOString(),
    phase: state.phase,
    turn: state.turn,
    score: { ...state.score },
    matchMode: state.mode,
    matchLength: state.config.length,
    goalTarget: state.config.goalTarget,
    maxTurns: state.config.maxTurns,
    winner: state.winner,
    mapId: null
  };
}

function playerFields(state: GameState, playerId?: string) {
  const player = playerId ? state.players[playerId] : undefined;
  if (!player) return {};
  return {
    playerId: player.id,
    playerSide: player.side,
    playerTeam: player.team,
    playerName: player.name,
    babbleIds: [...player.controlledBabbleIds]
  };
}

function sideTeam(state: GameState, side: PlayerSide) {
  return state.sideTeams[side];
}

export function buildAbilityUsedEvent(state: GameState, playerId: string, use: PowerPlayUse, now = Date.now()): AnalyticsEvent {
  const abilityType = normalizeBoxType(use.type) ?? use.type;
  const target = use.targetBabbleId ? state.babbles.find(b => b.id === use.targetBabbleId) : undefined;
  const fieldObject = state.fieldObjects.at(-1);
  return {
    name: 'abilityUsed',
    payload: {
      ...commonPayload(state, now),
      ...playerFields(state, playerId),
      abilityType,
      targetPowerId: boxTargetPowerId(abilityType),
      holderId: playerId,
      targetBabbleId: use.targetBabbleId ?? null,
      targetSide: target?.side ?? null,
      targetTeam: target ? sideTeam(state, target.side) : null,
      targetPosition: target ? { ...target.pos } : null,
      position: use.position ? { ...use.position } : null,
      angle: typeof use.angle === 'number' ? use.angle : null,
      fieldObjectId: fieldObject?.type === use.type ? fieldObject.id : null
    }
  };
}

export function buildBoxPickupEvent(state: GameState, details: BoxPickupDetails): AnalyticsEvent {
  return {
    name: 'boxPickup',
    payload: {
      ...commonPayload(state, details.now),
      ...playerFields(state, details.holderId),
      holderId: details.holderId,
      holderSide: details.holderSide,
      holderTeam: sideTeam(state, details.holderSide),
      collectorBabbleId: details.collectorBabbleId ?? null,
      pickupMethod: details.pickupMethod,
      boxId: details.box.id,
      abilityType: details.box.type,
      targetPowerId: boxTargetPowerId(details.box.type),
      boxAnchor: details.box.anchor,
      position: { ...details.box.pos },
      availableTurn: state.turn + 1,
      replacedAbilityType: details.replacedAbilityType ?? null,
      replacedTargetPowerId: boxTargetPowerId(details.replacedAbilityType)
    }
  };
}

export function buildGoalScoredEvent(state: GameState, details: GoalDetails): AnalyticsEvent {
  const lastTouchedPlayer = details.lastTouchedPlayerId ? state.players[details.lastTouchedPlayerId] : undefined;
  return {
    name: 'goalScored',
    payload: {
      ...commonPayload(state, details.now),
      scoringSide: details.scoringSide,
      scoringTeam: sideTeam(state, details.scoringSide),
      concedingSide: details.scoringSide === 'left' ? 'right' : 'left',
      lastTouchedBy: details.lastTouchedBy ?? null,
      lastTouchedTeam: details.lastTouchedBy ? sideTeam(state, details.lastTouchedBy) : null,
      lastTouchedBabbleId: details.lastTouchedBabbleId ?? null,
      lastTouchedPlayerId: details.lastTouchedPlayerId ?? null,
      lastTouchedPlayerTeam: lastTouchedPlayer?.team ?? null,
      ballPosition: { ...details.ballPosition }
    }
  };
}

export function buildGamePlayerEvent(state: GameState, lifecycle: GamePlayerLifecycle, playerId: string, now = Date.now()): AnalyticsEvent {
  return {
    name: 'gamePlayer',
    payload: {
      ...commonPayload(state, now),
      ...playerFields(state, playerId),
      lifecycle,
      connectedPlayers: Object.values(state.players).filter(p => p.connected).length,
      totalPlayers: Object.keys(state.players).length
    }
  };
}
