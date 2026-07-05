import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applyFormation,
  collectPowerBox,
  createInitialState,
  launchBobble,
  MAX_RESOLVE_MS,
  rotateFieldObject,
  startGame,
  stepGame,
  usePowerPlay
} from '../shared/game';
import { BOX_TYPE_IDS, BUMPERS, FIELD } from '../shared/types';

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

    for (let i = 0; i < 400 && s.phase === 'resolving'; i++) stepGame(s, {}, 1000 + i * 33, seq([0.1, 0.2, 0.3]));

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
      for (let i = 0; i < 400 && s.phase !== 'finished'; i++) stepGame(s, {}, 1000 + i * 33);
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

  it('resets ball and formations to kickoff after a non-winning goal', () => {
    const s = createInitialState('KICK', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.pos = { x: FIELD.width + FIELD.goalDepth, y: FIELD.goalY + FIELD.goalHeight / 2 };
    s.ball.vel = { x: 20, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));

    expect(s.score.left).toBe(1);
    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(s.ball.pos).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 });

    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBobble(s, 'l', { bobbleId: id, aimAngle: 0, impulse: 1 }, 2000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBobble(s, 'r', { bobbleId: id, aimAngle: Math.PI, impulse: 1 }, 2000);
    for (let i = 0; i < 400 && s.turn === 2; i++) stepGame(s, {}, 2000 + i * 33, seq([0.5]));
    expect(s.score.left).toBe(1);
    expect(s.score.right).toBe(0);
  });

  it('defines four corner bumpers matching every arena corner', () => {
    expect(BUMPERS).toHaveLength(4);
    const corners = BUMPERS.map(b => `${b.x < FIELD.width / 2 ? 'L' : 'R'}${b.y < FIELD.height / 2 ? 'T' : 'B'}`).sort();
    expect(corners).toEqual(['LB', 'LT', 'RB', 'RT']);
  });

  it('bumpers boost the ball on impact and emit a hit event for the client animation', () => {
    const s = createInitialState('BUMP', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.pos = { x: BUMPERS[0].x + 55, y: BUMPERS[0].y };
    s.ball.vel = { x: -300, y: 0 };

    stepGame(s, {}, 1033, seq([0.5]));

    expect(s.ball.vel.x).toBeGreaterThan(300); // reflected AND boosted beyond incoming speed
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeLessThanOrEqual(1600); // clamped
    expect(s.bumperEvents.length).toBeGreaterThanOrEqual(1);
    expect(s.bumperEvents[0].pos).toEqual({ x: BUMPERS[0].x, y: BUMPERS[0].y });
  });

  it('allows up to 10 seconds of resolution and zeroes all velocities before the next turn', () => {
    expect(MAX_RESOLVE_MS).toBe(10000);
    const s = createInitialState('TIME', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    for (let now = 1033; now <= 10990; now += 33) {
      s.bobbles[0].vel = { x: 500, y: 0 }; // keep an object perpetually fast
      stepGame(s, {}, now, seq([0.5]));
      expect(s.phase).toBe('resolving'); // still resolving before the 10s cap
    }
    s.bobbles[0].vel = { x: 500, y: 0 };
    stepGame(s, {}, 11001, seq([0.5]));
    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(s.ball.vel).toEqual({ x: 0, y: 0 });
    for (const b of s.bobbles) expect(b.vel).toEqual({ x: 0, y: 0 }); // no physics carryover
  });

  it('placed blocks deflect the ball, goo slows it, and boost pads accelerate it', () => {
    const s = createInitialState('OBJ', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;

    // block wall in the ball path
    s.fieldObjects = [{ id: 'f1', type: 'block', owner: 'left', pos: { x: 560, y: 310 }, angle: Math.PI / 2, untilTurn: 99 }];
    s.ball.pos = { x: 470, y: 310 };
    s.ball.vel = { x: 400, y: 0 };
    for (let i = 1; i <= 20; i++) stepGame(s, {}, 1000 + i * 33, seq([0.5]));
    expect(s.ball.vel.x).toBeLessThan(0); // bounced back off the wall
    expect(s.ball.pos.x).toBeLessThan(560);

    // sticky goo slows beyond normal drag
    s.fieldObjects = [{ id: 'f2', type: 'stickyGoo', owner: 'left', pos: { x: 470, y: 310 }, angle: 0, untilTurn: 99 }];
    s.ball.pos = { x: 470, y: 310 };
    s.ball.vel = { x: 300, y: 0 };
    s.resolvingStartedAt = 2000;
    stepGame(s, {}, 2033, seq([0.5]));
    expect(s.ball.vel.x).toBeLessThan(280);

    // boost pad accelerates along its angle
    s.fieldObjects = [{ id: 'f3', type: 'boost', owner: 'left', pos: { x: 470, y: 310 }, angle: 0, untilTurn: 99 }];
    s.ball.pos = { x: 470, y: 310 };
    s.ball.vel = { x: 50, y: 0 };
    s.resolvingStartedAt = 3000;
    stepGame(s, {}, 3033, seq([0.5]));
    expect(s.ball.vel.x).toBeGreaterThan(60);
  });

  it('beach ball enlarges the ball for the turn and reverts next turn', () => {
    const s = createInitialState('BEACH', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'beachBall', availableTurn: 1 });
    expect(usePowerPlay(s, 'l', { type: 'beachBall' }, 1000)).toBe(true);
    expect(s.ball.radius).toBeGreaterThan(FIELD.ballRadius);
    expect(s.beachBallUntilTurn).toBe(1);
    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBobble(s, 'l', { bobbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBobble(s, 'r', { bobbleId: id, aimAngle: 0, impulse: 1 }, 1000);
    for (let i = 0; i < 400 && s.turn === 1; i++) stepGame(s, {}, 1000 + i * 33, seq([0.5]));
    expect(s.turn).toBe(2);
    expect(s.ball.radius).toBe(FIELD.ballRadius);
    expect(s.beachBallUntilTurn).toBeNull();
  });

  it('big bumpers power play super-charges the corner bumpers for the turn', () => {
    const s = createInitialState('BIGB', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'bigBumpers', availableTurn: 1 });
    expect(usePowerPlay(s, 'l', { type: 'bigBumpers' }, 1000)).toBe(true);
    expect(s.bigBumpersUntilTurn).toBe(1);
  });

  it('placed rotatable obstacles keep their angle in state and rotate only for their owner', () => {
    const s = createInitialState('ROT', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'block', availableTurn: 1 });
    expect(usePowerPlay(s, 'l', { type: 'block', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(true);
    const placed = s.fieldObjects[0];
    expect(placed.type).toBe('block');
    expect(placed.angle).toBe(0);
    expect(rotateFieldObject(s, 'r', placed.id)).toBe(false); // opponent cannot rotate
    expect(rotateFieldObject(s, 'l', placed.id)).toBe(true);
    expect(placed.angle).toBeCloseTo(Math.PI / 4);
    s.powerPlayInventories.left.push({ type: 'stickyGoo', availableTurn: 1 });
    usePowerPlay(s, 'l', { type: 'stickyGoo', position: { x: 400, y: 300 } }, 1000);
    const goo = s.fieldObjects.find(o => o.type === 'stickyGoo')!;
    expect(rotateFieldObject(s, 'l', goo.id)).toBe(false); // goo is not rotatable
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
