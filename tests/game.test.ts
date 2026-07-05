import { describe, expect, it } from 'vitest';
import { addPlayer, applyBox, createInitialState, spawnBox, startGame, stepGame } from '../shared/game';
import { FIELD } from '../shared/types';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('bobble league shared rules', () => {
  it('spawns boxes on top or bottom lane every second scoring turn', () => {
    const s = createInitialState('TEST', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'parrots', 'right');
    startGame(s, seq([0.4, 0.5]));
    s.ball.pos = { x: FIELD.width + FIELD.goalDepth, y: FIELD.goalY + 40 };
    stepGame(s, {}, 1000, seq([0.1, 0.2, 0.3, 0.4]));
    expect(s.turn).toBe(2);
    expect(s.boxes).toHaveLength(1);
    expect(s.boxes[0].pos.y).toBeLessThan(160);
  });

  it('supports first-to-1, first-to-3, and first-to-5 goal modes', () => {
    for (const mode of [1, 3, 5] as const) {
      const s = createInitialState('MODE', mode);
      addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
      addPlayer(s, 'r', 'Righty', 'parrots', 'right');
      startGame(s);
      for (let i = 0; i < mode; i++) {
        s.ball.pos = { x: FIELD.width + FIELD.goalDepth, y: FIELD.goalY + 80 };
        stepGame(s, {}, 1000 + i, seq([0.4]));
      }
      expect(s.phase).toBe('finished');
      expect(s.winner).toBe('left');
    }
  });

  it('applies all box types without crashing and records effects', () => {
    const s = createInitialState('BOX', 3);
    const p = addPlayer(s, 'a', 'Alice', 'pigs', 'left');
    const o = addPlayer(s, 'b', 'Bob', 'parrots', 'right');
    for (const type of ['speed','slow','big','tiny','freeze','ghost','magnet','bomb','shield','swap'] as const) {
      applyBox(s, p, type, 5000);
    }
    expect(p.effects.map(e => e.type)).toEqual(expect.arrayContaining(['speed','big','ghost','magnet','shield']));
    expect(o.effects.map(e => e.type)).toEqual(expect.arrayContaining(['slow','tiny','freeze']));
    expect(s.events.some(e => e.message.includes('picked up'))).toBe(true);
  });

  it('manual spawn chooses valid field coordinates and box type', () => {
    const s = createInitialState('SPAWN', 3);
    const box = spawnBox(s, 123, seq([0.9, 0.0, 0.5]));
    expect(box.pos.x).toBeGreaterThan(140);
    expect(box.pos.x).toBeLessThan(FIELD.width - 140);
    expect(box.pos.y).toBeGreaterThan(FIELD.height - 160);
    expect(box.type).toBe('speed');
  });
});
