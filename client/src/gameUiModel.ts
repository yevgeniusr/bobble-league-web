import { GameState, InventoryItem } from '../../shared/types';

export type HeldPowerPlay = InventoryItem & { locked: boolean };

export function heldPowerPlayForPlayer(state: GameState, playerId: string): HeldPowerPlay | null {
  const player = state.players[playerId];
  if (!player) return null;
  const item = state.powerPlayInventories[player.side].find(candidate => candidate.holderId === playerId);
  return item ? { ...item, locked: item.availableTurn > state.turn } : null;
}
