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
    expect(s.phase).toBe('planning');
    expect(s.pendingIntents['left-1']?.impulse).toBe(600);
    for (const id of ['left-2', 'left-3', 'left-4']) launchBobble(s, 'l', { bobbleId: id, aimAngle: 0, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBobble(s, 'r', { bobbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
    stepGame(s, {}, 1000, seq([0.1, 0.2, 0.3]));
    expect(s.phase).toBe('resolving');

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
      for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBobble(s, 'l', { bobbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
      for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBobble(s, 'r', { bobbleId: id, aimAngle: 0, impulse: 1 }, 1000);
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

  it('distributes four bobbles across four teammates and resolves when all eight are aimed', () => {
    const s = createInitialState('EIGHT', 1);
    for (let i = 0; i < 4; i++) addPlayer(s, `l${i}`, `Left ${i}`, 'pigs', 'left');
    for (let i = 0; i < 4; i++) addPlayer(s, `r${i}`, `Right ${i}`, 'parrots', 'right');
    startGame(s, seq([0.5]));
    for (let i = 0; i < 4; i++) expect(s.players[`l${i}`].controlledBobbleIds).toEqual([`left-${i + 1}`]);
    for (let i = 0; i < 4; i++) expect(s.players[`r${i}`].controlledBobbleIds).toEqual([`right-${i + 1}`]);
    for (let i = 1; i <= 4; i++) launchBobble(s, `l${i - 1}`, { bobbleId: `left-${i}`, aimAngle: 0, impulse: 50 }, 1000);
    for (let i = 1; i <= 4; i++) launchBobble(s, `r${i - 1}`, { bobbleId: `right-${i}`, aimAngle: Math.PI, impulse: 50 }, 1000);
    stepGame(s, {}, 1000, seq([0.5]));
    expect(s.phase).toBe('resolving');
    expect(Object.keys(s.pendingIntents)).toHaveLength(8);
  });

  it('scores only after the ball crosses through the goal mouth trigger', () => {
    const s = createInitialState('GOAL', 1);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.pos = { x: FIELD.width + FIELD.goalDepth, y: FIELD.goalY + FIELD.goalHeight / 2 };
    s.ball.vel = { x: 20, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('left');
    expect(s.score.left).toBe(1);
  });
});
