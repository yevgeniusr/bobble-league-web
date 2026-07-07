import { describe, expect, it, vi } from 'vitest';
import { drainAnalyticsEvents } from '../shared/analytics';
import { addPlayer, collectPowerBox, createInitialState, startGame, stepGame, usePowerPlay } from '../shared/game';
import { FIELD } from '../shared/types';
import { createXtremepushAnalytics } from '../client/src/analytics';
import { buildHitEventBody, createXtremepushSender } from '../server/xtremepush';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

function fakeBrowser() {
  const scripts: HTMLScriptElement[] = [];
  const win = {} as Window;
  const doc = {
    head: {
      appendChild: (script: HTMLScriptElement) => {
        scripts.push(script);
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
      boxAnchor: 'topMid',
      position: babble.pos,
      availableTurn: 2,
      replacedAbilityType: 'ghosted'
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

    stepGame(state, {}, 4000, seq([0.5]));

    const [event] = drainAnalyticsEvents(state);
    expect(event.name).toBe('goalScored');
    expect(event.payload).toMatchObject({
      scoringSide: 'left',
      scoringTeam: 'pigs',
      concedingSide: 'right',
      lastTouchedBy: 'right',
      lastTouchedTeam: 'tigers',
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
    expect(fetcher).toHaveBeenCalledWith('/api/config');
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

    const win = browser.win as unknown as { xtremepush: { q: unknown[] } };
    expect(win.xtremepush.q).toEqual([['event', 'gamePlayer', event.payload]]);
    const script = browser.scripts[0];
    expect(script?.src).toBe('https://cdn.example.test/sdk.js');
    expect(script?.dataset.xtremepushSdk).toBe('public-test-key');
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

  it('posts gameplay analytics from the backend to Xtremepush hit/event', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, code: 200 }), { status: 200 }));
    const sender = createXtremepushSender({ appToken: 'token-for-test', apiBase: 'https://api.example.test/base/', fetcher, logger: { warn: vi.fn() } });

    await expect(sender.send(event)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith('https://api.example.test/base/hit/event', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }));
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    const body = JSON.parse(calls[0][1].body as string);
    expect(body).toMatchObject({ apptoken: 'token-for-test', user_id: 'babble-player:lefty', event: 'abilityUsed', async: false });
    expect(sender.debugSnapshot()).toMatchObject({ enabled: true, attempted: 1, succeeded: 1, failed: 0 });
  });

  it('defaults backend analytics to the Xtremepush demo API host', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, code: 200 }), { status: 200 }));
    const sender = createXtremepushSender({ appToken: 'token-for-test', fetcher, logger: { warn: vi.fn() } });

    await expect(sender.send(event)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith('https://api.demo.xtremepush.com/api/external/hit/event', expect.any(Object));
  });

  it('disables cleanly when the backend app token is missing', async () => {
    const fetcher = vi.fn();
    const sender = createXtremepushSender({ appToken: '', fetcher });

    expect(sender.enabled).toBe(false);
    await expect(sender.send(event)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
