import { GameState, MAPS, PlayerSide, TEAMS } from '../../shared/types';

const sideLabel = (side: PlayerSide) => side === 'left' ? 'Left side' : 'Right side';
const titleCase = (value: string) => value.slice(0, 1).toUpperCase() + value.slice(1);

export type MatchEndSummary = {
  title: string;
  winnerSideLabel: string;
  scoreline: string;
  winnerTeamColor: string | null;
  winnerTeamAccent: string | null;
  stats: { label: string; value: string }[];
};

export function buildMatchEndSummary(state: GameState): MatchEndSummary {
  const winner = state.winner;
  const winnerTeam = winner ? TEAMS[state.sideTeams[winner]] : null;
  return {
    title: winnerTeam ? `${winnerTeam.label} wins` : 'Match finished',
    winnerSideLabel: winner ? sideLabel(winner) : 'No winner',
    scoreline: `${state.score.left} - ${state.score.right}`,
    winnerTeamColor: winnerTeam?.primary ?? null,
    winnerTeamAccent: winnerTeam?.secondary ?? null,
    stats: [
      { label: 'Map', value: MAPS[state.mapId].label },
      { label: 'Turns', value: `${state.turn} / ${state.config.maxTurns}` },
      { label: 'Target', value: `First to ${state.config.goalTarget}` },
      { label: 'Length', value: titleCase(state.config.length) }
    ]
  };
}
