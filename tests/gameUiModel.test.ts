import { describe, expect, it } from 'vitest';
import { heldPowerPlayForPlayer } from '../client/src/gameUiModel';
import { addPlayer, createInitialState, startGame } from '../shared/game';

describe('match HUD inventory model', () => {
  it('returns only the single box held by the current player', () => {
    const state = createInitialState('UI-BOX', 1);
    addPlayer(state, 'me', 'Me', 'pigs', 'left');
    addPlayer(state, 'mate', 'Mate', 'pigs', 'left');
    startGame(state, () => 0.5);
    state.powerPlayInventories.left.push(
      { type: 'boost', availableTurn: 2, holderId: 'mate' },
      { type: 'readPlay', availableTurn: 3, holderId: 'me' }
    );

    expect(heldPowerPlayForPlayer(state, 'me')).toEqual({
      type: 'readPlay',
      availableTurn: 3,
      holderId: 'me',
      locked: true
    });
  });

  it('returns null when only a teammate holds a box', () => {
    const state = createInitialState('UI-EMPTY', 1);
    addPlayer(state, 'me', 'Me', 'pigs', 'left');
    addPlayer(state, 'mate', 'Mate', 'pigs', 'left');
    startGame(state, () => 0.5);
    state.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'mate' });
    expect(heldPowerPlayForPlayer(state, 'me')).toBeNull();
  });
});
