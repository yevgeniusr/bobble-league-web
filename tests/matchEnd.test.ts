import { describe, expect, it } from 'vitest';
import { createInitialState } from '../shared/game';
import { buildMatchEndSummary } from '../client/src/matchEnd';

describe('match end summary', () => {
  it('formats winner, score, map, turn, and match target for the final overlay', () => {
    const state = createInitialState('ROOM42', 3, 'moon');
    state.phase = 'finished';
    state.winner = 'right';
    state.score = { left: 2, right: 3 };
    state.turn = 17;

    const summary = buildMatchEndSummary(state);

    expect(summary.title).toBe('Stripe Squad wins');
    expect(summary.winnerSideLabel).toBe('Right side');
    expect(summary.scoreline).toBe('2 - 3');
    expect(summary.stats).toContainEqual({ label: 'Map', value: 'Moon Base' });
    expect(summary.stats).toContainEqual({ label: 'Turns', value: '17 / 90' });
    expect(summary.stats).toContainEqual({ label: 'Target', value: 'First to 3' });
  });
});
