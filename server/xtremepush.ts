import type { AnalyticsEvent, AnalyticsPayload } from '../shared/analytics';

type Fetcher = typeof fetch;

type XtremepushHitBody = {
  apptoken: string;
  user_id: string;
  event: string;
  value: Record<string, unknown>;
  user_attributes?: Record<string, unknown>;
  timestamp?: string;
  // Xtremepush docs do not list this field, but the dashboard/request path can
  // return `{ async: true }`. Keep sending it false for the user's requested
  // synchronous debug mode; the API currently still reports async:true.
  async: false;
};

type XtremepushSendRecord = {
  at: string;
  event: string;
  userId: string;
  ok: boolean;
  status?: number;
  responseCode?: unknown;
  responseSuccess?: unknown;
  responseAsync?: unknown;
  error?: string;
};

export type XtremepushDebugSnapshot = {
  enabled: boolean;
  attempted: number;
  succeeded: number;
  failed: number;
  last: XtremepushSendRecord[];
};

export type XtremepushSender = {
  enabled: boolean;
  send: (event: AnalyticsEvent) => Promise<boolean>;
  debugSnapshot: () => XtremepushDebugSnapshot;
};

const DEFAULT_API_BASE = 'https://api.eu.xtremepush.com/api/external';
const DEBUG_LOG_SUCCESS = process.env.XTREMEPUSH_DEBUG === 'true' || process.env.XTREMEPUSH_LOG_SUCCESS === 'true';
const MAX_RECORDS = 20;

export function createXtremepushSender(options: {
  appToken?: string;
  apiBase?: string;
  fetcher?: Fetcher;
  logger?: Pick<Console, 'warn'> & Partial<Pick<Console, 'info'>>;
}): XtremepushSender {
  const appToken = options.appToken?.trim() ?? '';
  const apiBase = (options.apiBase?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '');
  const fetcher = options.fetcher ?? globalThis.fetch;
  const logger = options.logger ?? console;
  const stats = createStats(false);

  if (!appToken || !fetcher) {
    return { enabled: false, send: async () => false, debugSnapshot: () => snapshot(stats, false) };
  }

  stats.enabled = true;

  return {
    enabled: true,
    send: async event => {
      const body = buildHitEventBody(appToken, event);
      stats.attempted += 1;
      try {
        const res = await fetcher(`${apiBase}/hit/event`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const response = await parseJsonResponse(res);
        const ok = res.ok && responseOk(response);
        const record = buildRecord(body, ok, res.status, response);
        remember(stats, record);
        if (!ok) {
          stats.failed += 1;
          logger.warn(`Xtremepush hit/event failed for ${event.name}: status=${res.status} response=${summarizeResponse(response)}`);
          return false;
        }
        stats.succeeded += 1;
        if (DEBUG_LOG_SUCCESS) logger.info?.(`Xtremepush hit/event ok event=${event.name} user=${body.user_id} status=${res.status} async=${String(record.responseAsync)}`);
        return true;
      } catch (err) {
        stats.failed += 1;
        const message = err instanceof Error ? err.message : 'unknown error';
        remember(stats, buildRecord(body, false, undefined, undefined, message));
        logger.warn(`Xtremepush hit/event failed for ${event.name}: ${message}`);
        return false;
      }
    },
    debugSnapshot: () => snapshot(stats, true)
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
    timestamp: formatXtremepushTimestamp(payload.timestamp),
    async: false
  };
}

function parseJsonResponse(res: Response) {
  return res.text().then(text => {
    if (!text) return null;
    try { return JSON.parse(text) as unknown; }
    catch { return text; }
  });
}

function responseOk(response: unknown) {
  if (!response || typeof response !== 'object') return true;
  const value = (response as { success?: unknown }).success;
  return value === undefined || value === true || value === 'true';
}

function buildRecord(body: XtremepushHitBody, ok: boolean, status?: number, response?: unknown, error?: string): XtremepushSendRecord {
  const obj = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  return {
    at: new Date().toISOString(),
    event: body.event,
    userId: body.user_id,
    ok,
    status,
    responseCode: obj.code,
    responseSuccess: obj.success,
    responseAsync: obj.async,
    error
  };
}

function createStats(enabled: boolean) {
  return { enabled, attempted: 0, succeeded: 0, failed: 0, last: [] as XtremepushSendRecord[] };
}

function remember(stats: ReturnType<typeof createStats>, record: XtremepushSendRecord) {
  stats.last.unshift(record);
  stats.last.splice(MAX_RECORDS);
}

function snapshot(stats: ReturnType<typeof createStats>, enabled: boolean): XtremepushDebugSnapshot {
  return { enabled, attempted: stats.attempted, succeeded: stats.succeeded, failed: stats.failed, last: [...stats.last] };
}

function summarizeResponse(response: unknown) {
  if (!response) return 'empty';
  if (typeof response === 'string') return response.slice(0, 200);
  const obj = response as Record<string, unknown>;
  return JSON.stringify({ success: obj.success, code: obj.code, async: obj.async, message: obj.message });
}

function formatXtremepushTimestamp(value: unknown) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : new Date().toISOString();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  // Docs show timezone-bearing timestamps such as `2024-12-13 11:36:00 +01:00`.
  // Use explicit UTC offset rather than relying on ISO `Z` parsing.
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' +00:00');
}

function userIdFor(payload: AnalyticsPayload) {
  // Xtremepush docs say `user_id` is the external user ID and auto-creates
  // that profile if missing. Socket IDs were technically unique, but ephemeral
  // and hard to find in the dashboard. Prefer stable, human-readable Babble IDs.
  const playerName = stringOrNull(payload.playerName);
  if (playerName) return `babble-player:${slug(playerName)}`;
  const holderId = stringOrNull(payload.holderId);
  if (holderId) return `babble-player:${slug(holderId)}`;
  const roomCode = stringOrNull(payload.roomCode) ?? 'unknown-room';
  const side = stringOrNull(payload.scoringSide);
  return side ? `babble-room:${slug(roomCode)}:side:${side}` : `babble-room:${slug(roomCode)}`;
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

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'unknown';
}
