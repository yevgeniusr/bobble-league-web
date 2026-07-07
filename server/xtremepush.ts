import type { AnalyticsEvent, AnalyticsPayload } from '../shared/analytics';

type Fetcher = typeof fetch;

type XtremepushHitBody = {
  apptoken: string;
  user_id: string;
  event: string;
  value: Record<string, unknown>;
  user_attributes?: Record<string, unknown>;
  timestamp?: string;
};

export type XtremepushSender = {
  enabled: boolean;
  send: (event: AnalyticsEvent) => Promise<boolean>;
};

const DEFAULT_API_BASE = 'https://api.eu.xtremepush.com/api/external';

export function createXtremepushSender(options: {
  appToken?: string;
  apiBase?: string;
  fetcher?: Fetcher;
  logger?: Pick<Console, 'warn'>;
}): XtremepushSender {
  const appToken = options.appToken?.trim() ?? '';
  const apiBase = (options.apiBase?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
  const fetcher = options.fetcher ?? globalThis.fetch;
  const logger = options.logger ?? console;

  if (!appToken || !fetcher) {
    return { enabled: false, send: async () => false };
  }

  return {
    enabled: true,
    send: async event => {
      const body = buildHitEventBody(appToken, event);
      try {
        const res = await fetcher(`${apiBase}/hit/event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          logger.warn(`Xtremepush hit/event failed for ${event.name}: ${res.status}`);
          return false;
        }
        return true;
      } catch (err) {
        logger.warn(`Xtremepush hit/event failed for ${event.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
        return false;
      }
    }
  };
}

export function buildHitEventBody(appToken: string, event: AnalyticsEvent): XtremepushHitBody {
  const payload = event.payload;
  const userId = userIdFor(payload);
  return {
    apptoken: appToken,
    user_id: userId,
    event: event.name,
    value: {
      ...payload,
      // Make correlation easy in Xtremepush even for room-level events such as goals.
      babbleUserId: userId
    },
    user_attributes: userAttributesFor(payload),
    timestamp: payload.timestamp
  };
}

function userIdFor(payload: AnalyticsPayload) {
  const direct = stringOrNull(payload.playerId) ?? stringOrNull(payload.holderId);
  if (direct) return direct;
  const roomCode = stringOrNull(payload.roomCode) ?? 'unknown-room';
  const side = stringOrNull(payload.scoringSide);
  return side ? `room:${roomCode}:side:${side}` : `room:${roomCode}`;
}

function userAttributesFor(payload: AnalyticsPayload) {
  const attrs: Record<string, unknown> = {
    room_code: payload.roomCode,
    player_side: payload.playerSide ?? payload.holderSide ?? payload.scoringSide ?? null,
    player_team: payload.playerTeam ?? payload.holderTeam ?? payload.scoringTeam ?? null,
    player_name: payload.playerName ?? null,
    match_mode: payload.matchMode,
    map_id: payload.mapId,
    last_event: payload.lifecycle ?? payload.abilityType ?? undefined
  };
  return Object.fromEntries(Object.entries(attrs).filter(([, value]) => value !== undefined && value !== null));
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
