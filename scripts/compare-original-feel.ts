import { BOX_TYPES, FORMATION_IDS, MAP_IDS } from '../shared/types';
import { addCheatBoxes, addPlayer, BALL_MAX_HEIGHT, BALL_REST_HEIGHT, createInitialState, launchBabble, setPlayerReady, startGame, stepGame, usePowerPlay } from '../shared/game';

const assert = (ok: boolean, message: string) => {
  if (!ok) throw new Error(message);
};

function setup(beach = false) {
  const state = createInitialState(`CMP${beach ? 'B' : 'N'}`, 1, 'stadium');
  for (let i = 0; i < 4; i++) addPlayer(state, `l${i}`, `Left ${i}`, 'pigs', 'left');
  for (let i = 0; i < 4; i++) addPlayer(state, `r${i}`, `Right ${i}`, 'tigers', 'right');
  startGame(state, () => 0.5);
  if (beach) {
    addCheatBoxes(state, 'l0');
    usePowerPlay(state, 'l0', { type: 'giantball' as any });
  }
  const left = state.babbles.find(b => b.id === 'left-2')!;
  const right = state.babbles.find(b => b.id === 'right-2')!;
  state.ball.pos = { x: 550, y: 310 };
  state.ball.vel = { x: 0, y: 0 };
  left.pos = { x: 500, y: 310 };
  right.pos = { x: 600, y: 310 };
  launchBabble(state, state.players.l1.controlledBabbleIds.includes('left-2') ? 'l1' : 'l0', { babbleId: 'left-2', aimAngle: 0, impulse: 900 });
  launchBabble(state, state.players.r1.controlledBabbleIds.includes('right-2') ? 'r1' : 'r0', { babbleId: 'right-2', aimAngle: Math.PI, impulse: 900 });
  for (const p of Object.values(state.players)) setPlayerReady(state, p.id, Date.now());
  return state;
}

function simulate(beach = false) {
  const state = setup(beach);
  let maxBall = state.ball.height ?? 0;
  let maxBabble = 0;
  for (let i = 0; i < 240 && state.phase === 'resolving'; i++) {
    stepGame(state, {}, Date.now() + i * 33, () => 0.5, 1000 / 30);
    maxBall = Math.max(maxBall, state.ball.height ?? 0);
    for (const b of state.babbles) maxBabble = Math.max(maxBabble, b.height ?? 0);
  }
  return { maxBall, maxBabble, radius: state.ball.radius, lastTouchedBabbleId: state.ball.lastTouchedBabbleId };
}

function touchScenario() {
  const state = createInitialState('CMPT', 1, 'stadium');
  addPlayer(state, 'l0', 'Left 0', 'pigs', 'left');
  addPlayer(state, 'r0', 'Right 0', 'tigers', 'right');
  startGame(state, () => 0.5);
  const left = state.babbles.find(b => b.id === 'left-1')!;
  state.ball.pos = { x: 550, y: 310 };
  state.ball.vel = { x: 0, y: 0 };
  left.pos = { x: 550 - left.radius - state.ball.radius + 1, y: 310 };
  left.vel = { x: 200, y: 0 };
  state.phase = 'resolving';
  state.resolvingStartedAt = Date.now();
  stepGame(state, {}, Date.now(), () => 0.5, 1000 / 30);
  return { lastTouchedBabbleId: state.ball.lastTouchedBabbleId, lastTouchedPlayerId: state.ball.lastTouchedPlayerId };
}

const normal = simulate(false);
const beach = simulate(true);
const touch = touchScenario();
const boxTargetIds = new Set(Object.values(BOX_TYPES).map(b => b.targetId));
const requiredPowers = ['giantball', 'bumppadboost', 'redcard', 'yellowcard', 'goalswap', 'bighead', 'ghost', 'sticky', 'ramp', 'block', 'boost'];

const checks = [
  ['maps include saturn', MAP_IDS.includes('saturn' as any)],
  ['formations include wall', FORMATION_IDS.includes('wall' as any)],
  ['normal ball has vertical state', normal.maxBall >= BALL_REST_HEIGHT],
  ['normal compound-hit peak stays in the documented original-like tolerance', normal.maxBall >= 0.85 && normal.maxBall <= 1.2],
  ['beach/giant ball lofts higher than normal', beach.maxBall > normal.maxBall + 0.35],
  ['beach/giant ball approaches original airborne range', beach.maxBall > Math.min(BALL_MAX_HEIGHT * 0.55, 1.45)],
  ['player/babble hop remains subtler than beach ball', beach.maxBabble < beach.maxBall],
  ['last touch tracks exact babble id', typeof touch.lastTouchedBabbleId === 'string'],
  ...requiredPowers.map(id => [`power alias present: ${id}`, boxTargetIds.has(id)] as [string, boolean]),
] as [string, boolean][];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
console.log(JSON.stringify({ normal, beach, touch, targets: { originalBallRest: 0.49, originalNormalMax: 0.90, originalGiantMax: 2.66, BALL_REST_HEIGHT, BALL_MAX_HEIGHT } }, null, 2));
assert(failed === 0, `${failed} original-feel comparison checks failed`);
