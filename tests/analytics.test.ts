import { describe, expect, it, vi } from 'vitest';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { drainAnalyticsEvents } from '../shared/analytics';
import { addPlayer, collectPowerBox, createInitialState, startGame, stepGame, usePowerPlay } from '../shared/game';
import { FIELD } from '../shared/types';
import { createXtremepushAnalytics } from '../client/src/analytics';
import { buildHitEventBody, buildImportProfileBody, createXtremepushSender } from '../server/xtremepush';
import { createLoyaltyService, normalizeLoyaltyEndpoint } from '../server/loyalty';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

function fakeBrowser() {
  const scripts: HTMLScriptElement[] = [];
  const win = {} as Window;
  const doc = {
    head: {
      appendChild: (script: HTMLScriptElement) => {
        scripts.push(script);
        (win as unknown as { XPInterfaceInstance?: object }).XPInterfaceInstance = {};
        queueMicrotask(() => script.onload?.call(script, new Event('load')));
        return script;
      }
    },
    createElement: () => ({ async: false, src: '', dataset: {} }) as HTMLScriptElement,
    querySelector: (selector: string) => selector === 'script[data-xtremepush-sdk]' ? scripts[0] ?? null : null,
    querySelectorAll: (selector: string) => selector === 'script[data-xtremepush-sdk]' ? scripts : []
  } as unknown as Document;
  return { win, doc, scripts };
}

describe('Xtremepush gameplay analytics payloads', () => {
  it('records rich abilityUsed payloads only after successful power plays', () => {
    const state = createInitialState('ANL1', 3);
    addPlayer(state, 'left-socket', 'Lefty', 'pigs', 'left');
    addPlayer(state, 'right-socket', 'Righty', 'tigers', 'right');
    startGame(state, seq([0.5]));

    expect(usePowerPlay(state, 'left-socket', { type: 'boost', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(false);
    expect(drainAnalyticsEvents(state)).toHaveLength(0);

    state.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'left-socket' });
    expect(usePowerPlay(state, 'left-socket', { type: 'boost', position: { x: 500, y: 300 }, angle: 0.25 }, 2000)).toBe(true);

    const [event] = drainAnalyticsEvents(state);
    expect(event.name).toBe('abilityUsed');
    expect(event.payload).toMatchObject({
      roomCode: 'ANL1',
      playerId: 'left-socket',
      playerSide: 'left',
      playerTeam: 'pigs',
      abilityType: 'boost',
      targetPowerId: 'boost',
      holderId: 'left-socket',
      position: { x: 500, y: 300 },
      angle: 0.25,
      turn: 1,
      phase: 'planning',
      score: { left: 0, right: 0 },
      matchLength: 'qualifier',
      matchMode: 3,
      winner: null,
      mapId: null
    });
    expect(event.payload.timestamp).toBe('1970-01-01T00:00:02.000Z');
  });

  it('records boxPickup payloads with holder, collector, position, and replacement details', () => {
    const state = createInitialState('ANL2', 3);
    addPlayer(state, 'left-socket', 'Lefty', 'pigs', 'left');
    addPlayer(state, 'right-socket', 'Righty', 'tigers', 'right');
    startGame(state, seq([0.5]));
    state.powerPlayInventories.left.push({ type: 'ghosted', availableTurn: 1, holderId: 'left-socket' });
    const babble = state.babbles.find(b => b.id === 'left-1')!;
    state.boxes = [{ id: 'box-rich', type: 'bigHead', anchor: 'topMid', pos: { ...babble.pos }, spawnedAt: 1000, untilTurn: 3 }];

    expect(collectPowerBox(state, babble, 3000)).toBe(true);

    const [event] = drainAnalyticsEvents(state);
    expect(event.name).toBe('boxPickup');
    expect(event.payload).toMatchObject({
      playerId: 'left-socket',
      holderId: 'left-socket',
      holderSide: 'left',
      holderTeam: 'pigs',
      collectorBabbleId: 'left-1',
      pickupMethod: 'babble',
      boxId: 'box-rich',
      abilityType: 'bigHead',
      targetPowerId: 'bighead',
      boxAnchor: 'topMid',
      position: babble.pos,
      availableTurn: 2,
      replacedAbilityType: 'ghosted',
      replacedTargetPowerId: 'ghost'
    });
  });

  it('records goalScored payloads with scoring side and last touch', () => {
    const state = createInitialState('ANL3', 1);
    addPlayer(state, 'left-socket', 'Lefty', 'pigs', 'left');
    addPlayer(state, 'right-socket', 'Righty', 'tigers', 'right');
    startGame(state, seq([0.5]));
    state.phase = 'resolving';
    state.resolvingStartedAt = 1000;
    state.ball.pos = { x: FIELD.width + FIELD.goalDepth, y: FIELD.goalY + FIELD.goalHeight / 2 };
    state.ball.vel = { x: 20, y: 0 };
    state.ball.lastTouchedBy = 'right';
    state.ball.lastTouchedBabbleId = 'right-1';
    state.ball.lastTouchedPlayerId = 'right-socket';

    stepGame(state, {}, 4000, seq([0.5]));

    const [event] = drainAnalyticsEvents(state);
    expect(event.name).toBe('goalScored');
    expect(event.payload).toMatchObject({
      scoringSide: 'left',
      scoringTeam: 'pigs',
      concedingSide: 'right',
      lastTouchedBy: 'right',
      lastTouchedTeam: 'tigers',
      lastTouchedBabbleId: 'right-1',
      lastTouchedPlayerId: 'right-socket',
      lastTouchedPlayerTeam: 'tigers',
      score: { left: 1, right: 0 },
      phase: 'finished',
      winner: 'left'
    });
    const ballPosition = event.payload.ballPosition as { x: number; y: number };
    expect(ballPosition.x).toBeGreaterThan(FIELD.width);
    expect(ballPosition.y).toBeCloseTo(FIELD.goalY + FIELD.goalHeight / 2, 3);
  });
});

describe('Xtremepush browser analytics client', () => {
  const event = {
    name: 'gamePlayer' as const,
    payload: {
      roomCode: 'ANL4',
      timestamp: '2026-07-07T00:00:00.000Z',
      phase: 'lobby' as const,
      turn: 1,
      score: { left: 0, right: 0 },
      matchMode: 3 as const,
      matchLength: 'qualifier' as const,
      goalTarget: 3 as const,
      maxTurns: 90,
      winner: null,
      mapId: null,
      lifecycle: 'room_created'
    }
  };

  it('no-ops safely when the SDK key is missing', async () => {
    const browser = fakeBrowser();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ xtremepushSdkKey: null })));
    const analytics = createXtremepushAnalytics({ win: browser.win, doc: browser.doc, fetcher });

    expect(analytics.track(event)).toBe(false);
    await expect(analytics.init()).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledWith('/api/config', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect((browser.win as unknown as { xtremepush?: unknown }).xtremepush).toBeUndefined();
    expect(browser.scripts).toHaveLength(0);
    expect(analytics.track(event)).toBe(false);
  });

  it('queues events until config loads, then sends through the Xtremepush command queue', async () => {
    const browser = fakeBrowser();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ xtremepushSdkKey: 'public-test-key' })));
    const analytics = createXtremepushAnalytics({ win: browser.win, doc: browser.doc, fetcher, sdkBaseUrl: 'https://cdn.example.test' });

    expect(analytics.track(event)).toBe(false);
    await expect(analytics.init()).resolves.toBe(true);

    const win = browser.win as unknown as { XtremePushObject: string; xtremepush: { q: unknown[] } };
    expect(win.XtremePushObject).toBe('xtremepush');
    expect(win.xtremepush.q).toEqual([['event', 'gamePlayer', event.payload]]);
    const script = browser.scripts[0];
    expect(script?.src).toBe('https://cdn.example.test/sdk.js');
    expect(script?.dataset.xtremepushSdk).toBe('public-test-key');
  });
});

describe('Xtremepush Loyalty authentication', () => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  it('signs a short-lived RS256 JWT mapped to the nickname profile id', () => {
    const service = createLoyaltyService({
      sdkKey: 'public-sdk-key', endpoint: 'p123.p.loyalty.eu.xtremepush.com',
      privateKey: keys.privateKey, publicKey: keys.publicKey, keyId: 'primary', tokenTtlSeconds: 120
    });
    expect(service.enabled).toBe(true);
    const guest = service.guestSession()!;
    const restored = service.guestSession(guest.cookie)!;
    expect(restored.id).toBe(guest.id);
    expect(restored.created).toBe(false);
    expect(service.guestSession(`${guest.cookie}tampered`)!.id).not.toBe(guest.id);
    const issued = service.issueToken(' Yev ', guest.id, 1_000)!;
    const subject = `babble-player:yev:guest:${guest.id}`;
    expect(issued.userId).toBe(subject);
    expect(issued.expiresAt).toBe(1_120);
    const [header64, payload64, signature64] = issued.token.split('.');
    expect(JSON.parse(Buffer.from(header64, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'primary' });
    expect(JSON.parse(Buffer.from(payload64, 'base64url').toString())).toEqual({ sub: subject, exp: 1_120 });
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header64}.${payload64}`); verifier.end();
    expect(verifier.verify(keys.publicKey, Buffer.from(signature64, 'base64url'))).toBe(true);
  });

  it('stays disabled for mismatched, weak, or invalid deployment configuration', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const weak = generateKeyPairSync('rsa', { modulusLength: 1024, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    expect(createLoyaltyService({ sdkKey: 'sdk', endpoint: 'p1.p.loyalty.eu.xtremepush.com', privateKey: keys.privateKey, publicKey: other.publicKey }).enabled).toBe(false);
    expect(createLoyaltyService({ sdkKey: 'sdk', endpoint: 'p1.p.loyalty.eu.xtremepush.com', privateKey: weak.privateKey, publicKey: weak.publicKey }).enabled).toBe(false);
    expect(normalizeLoyaltyEndpoint('https://p1.p.loyalty.eu.xtremepush.com/')).toBe('p1.p.loyalty.eu.xtremepush.com');
    expect(normalizeLoyaltyEndpoint('https://example.com/path')).toBe('');
    const safeTtl = createLoyaltyService({ sdkKey: 'sdk', endpoint: 'p1.p.loyalty.eu.xtremepush.com', privateKey: keys.privateKey, publicKey: keys.publicKey, tokenTtlSeconds: Number.NaN });
    const guest = safeTtl.guestSession()!;
    expect(safeTtl.issueToken('Yev', guest.id, 1_000)?.expiresAt).toBe(1_300);
  });
});


describe('Xtremepush backend hit-event sender', () => {
  const event = {
    name: 'abilityUsed' as const,
    payload: {
      roomCode: 'ANL5',
      timestamp: '2026-07-07T01:02:03.000Z',
      phase: 'planning' as const,
      turn: 4,
      score: { left: 1, right: 0 },
      matchMode: 3 as const,
      matchLength: 'qualifier' as const,
      goalTarget: 3 as const,
      maxTurns: 90,
      winner: null,
      mapId: 'volcano',
      playerId: 'socket-123',
      playerSide: 'left' as const,
      playerTeam: 'pigs' as const,
      playerName: 'Lefty',
      abilityType: 'boost'
    }
  };

  it('builds the documented /hit/event body with app token, user_id, event, value, attributes, and timestamp', () => {
    expect(buildHitEventBody('token-for-test', event)).toMatchObject({
      apptoken: 'token-for-test',
      user_id: 'babble-player:lefty',
      event: 'abilityUsed',
      value: {
        roomCode: 'ANL5',
        abilityType: 'boost',
        babbleUserId: 'babble-player:lefty'
      },
      user_attributes: {
        room_code: 'ANL5',
        player_side: 'left',
        player_team: 'pigs',
        player_name: 'Lefty',
        match_mode: 3,
        map_id: 'volcano',
        last_event: 'boost'
      },
      timestamp: '2026-07-07 01:02:03 +00:00',
      async: false
    });
  });

  it('builds the profile import body used to make users visible before events are hit', () => {
    expect(buildImportProfileBody('token-for-test', 'babble-player:lefty', event)).toEqual({
      apptoken: 'token-for-test',
      columns: ['user_id', 'first_name'],
      rows: [['babble-player:lefty', 'Lefty']],
      async: false
    });
  });

  it('imports the user profile before posting gameplay analytics to Xtremepush hit/event', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, code: 200 }), { status: 200 }));
    const sender = createXtremepushSender({ appToken: 'token-for-test', apiBase: 'https://api.example.test/base/', fetcher, logger: { warn: vi.fn() } });

    await expect(sender.send(event)).resolves.toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://api.example.test/base/import/profile', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://api.example.test/base/hit/event', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }));
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const importBody = JSON.parse(calls[0][1].body as string);
    expect(importBody).toMatchObject({ apptoken: 'token-for-test', columns: ['user_id', 'first_name'], rows: [['babble-player:lefty', 'Lefty']], async: false });
    const body = JSON.parse(calls[1][1].body as string);
    expect(body).toMatchObject({ apptoken: 'token-for-test', user_id: 'babble-player:lefty', event: 'abilityUsed', async: false });
    expect(sender.debugSnapshot()).toMatchObject({ enabled: true, attempted: 1, succeeded: 1, failed: 0, profilesAttempted: 1, profilesSucceeded: 1, profilesFailed: 0 });
  });

  it('defaults backend analytics to the Xtremepush external API host', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, code: 200 }), { status: 200 }));
    const sender = createXtremepushSender({ appToken: 'token-for-test', fetcher, logger: { warn: vi.fn() } });

    await expect(sender.send(event)).resolves.toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://external-api.xtremepush.com/api/external/import/profile', expect.any(Object));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://external-api.xtremepush.com/api/external/hit/event', expect.any(Object));
  });

  it('disables cleanly when the backend app token is missing', async () => {
    const fetcher = vi.fn();
    const sender = createXtremepushSender({ appToken: '', fetcher });

    expect(sender.enabled).toBe(false);
    await expect(sender.send(event)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
