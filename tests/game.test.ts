import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applyFormation,
  collectPowerBox,
  createInitialState,
  launchBobble,
  startGame,
  stepGame,
  usePowerPlay
} from '../shared/game';
import { BOX_TYPE_IDS, FIELD } from '../shared/types';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('classic Bobble League shared rules', () => {
  it('starts classic matches with four bobbles per team in selected formations', () => {
    const s = createInitialState('TEST', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    applyFormation(s, 'left', 'slant');
    applyFormation(s, 'right', 'box');
    startGame(s, seq([0.5]));

    expect(s.phase).toBe('planning');
    expect(s.bobbles.filter(b => b.side === 'left')).toHaveLength(4);
    expect(s.bobbles.filter(b => b.side === 'right')).toHaveLength(4);
    expect(s.bobbles.find(b => b.id === 'left-1')?.pos.x).toBeGreaterThan(250);
    expect(s.bobbles.find(b => b.id === 'right-1')?.pos.x).toBeGreaterThan(FIELD.width - 260);
  });

  it('uses drag/launch intents and resolves turn-based physics back to planning', () => {
    const s = createInitialState('TURN', 1);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    const accepted = launchBobble(s, 'l', { bobbleId: 'left-1', aimAngle: 0, impulse: 600 }, 1000);
    expect(accepted).toBe(true);
    expect(s.phase).toBe('resolving');
    expect(s.pendingIntents['left-1']?.impulse).toBe(600);

    for (let i = 0; i < 260 && s.phase === 'resolving'; i++) stepGame(s, {}, 1000 + i * 33, seq([0.1, 0.2, 0.3]));

    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(Object.keys(s.pendingIntents)).toHaveLength(0);
    expect(s.boxes).toHaveLength(1);
    expect(['topMid', 'bottomMid']).toContain(s.boxes[0].anchor);
  });

  it('tracks scrimmage, qualifier, and champion turn limits', () => {
    const cases = [[1, 30, 'scrimmage'], [3, 90, 'qualifier'], [5, 150, 'champion']] as const;
    for (const [mode, maxTurns, label] of cases) {
      const s = createInitialState('MODE', mode);
      expect(s.config.maxTurns).toBe(maxTurns);
      expect(s.config.length).toBe(label);
      addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
      addPlayer(s, 'r', 'Righty', 'tigers', 'right');
      startGame(s);
      s.turn = maxTurns;
      launchBobble(s, 'l', { bobbleId: 'left-1', aimAngle: Math.PI, impulse: 1 }, 1000);
      for (let i = 0; i < 260 && s.phase !== 'finished'; i++) stepGame(s, {}, 1000 + i * 33);
      expect(s.phase).toBe('finished');
      expect(s.winner).toBeNull();
    }
  });

  it('collects canonical power plays into inventory for next turn use', () => {
    const s = createInitialState('BOX', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    const type = 'bigHead';
    s.boxes = [{ id: 'box-1', type, anchor: 'topMid', pos: { ...s.bobbles[0].pos }, spawnedAt: 1000 }];

    collectPowerBox(s, s.bobbles[0], 1000);

    expect(s.boxes).toHaveLength(0);
    expect(s.powerPlayInventories.left).toEqual([{ type, availableTurn: 2 }]);
    expect(usePowerPlay(s, 'l', { type, targetBobbleId: 'left-1' }, 1000)).toBe(false);

    s.turn = 2;
    expect(usePowerPlay(s, 'l', { type, targetBobbleId: 'left-1' }, 2000)).toBe(true);
    expect(s.powerPlayInventories.left).toHaveLength(0);
    expect(s.bobbles[0].effects.map(e => e.type)).toContain('bigHead');
  });

  it('defines all eleven researched power plays as box types', () => {
    expect(BOX_TYPE_IDS).toEqual(expect.arrayContaining([
      'beachBall', 'moveBall', 'swapGoals', 'bigBumpers',
      'boost', 'stickyGoo', 'ramp', 'block',
      'bigHead', 'ghosted', 'movePlayer'
    ]));
    expect(BOX_TYPE_IDS).toHaveLength(11);
  });
});
