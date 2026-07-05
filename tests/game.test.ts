import { describe, expect, it } from 'vitest';
import {
  addCheatBoxes,
  addPlayer,
  applyFormation,
  BIG_BUMPER_BOOST_MULT,
  BOOST_PAD_ACCEL,
  BOX_LIFETIME_TURNS,
  collectPowerBox,
  createInitialState,
  grantCheatBox,
  launchBobble,
  MAX_RESOLVE_MS,
  RAMP_LAUNCH_SPEED,
  rotateFieldObject,
  setFieldObjectAngle,
  setSideTeam,
  spawnBox,
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

  it('keeps spawned boxes alive by turn count so planning timers do not expire pickup', () => {
    const s = createInitialState('LIFE', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.turn = 2;
    const box = spawnBox(s, 1000, seq([0.1, 0.0, 0.5]));
    expect(box.untilTurn).toBe(2 + BOX_LIFETIME_TURNS - 1);
    s.phase = 'resolving';
    s.resolvingStartedAt = 17000;
    // More than the old 14s wall-clock expiry has passed, but same turn boxes still exist.
    stepGame(s, {}, 17000, seq([0.5]));
    expect(s.boxes.map(b => b.id)).toContain(box.id);
  });

  it('lets a last-touched ball collect a power box for that side', () => {
    const s = createInitialState('BALLBOX', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.pos = { x: FIELD.width / 2, y: FIELD.height / 2 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.lastTouchedBy = 'left';
    s.boxes = [{ id: 'ball-box', type: 'boost', anchor: 'topMid', pos: { ...s.ball.pos }, spawnedAt: 1000, untilTurn: s.turn + 2 }];

    stepGame(s, {}, 1033, seq([0.5]));

    expect(s.boxes.some(b => b.id === 'ball-box')).toBe(false);
    expect(s.powerPlayInventories.left).toEqual([{ type: 'boost', availableTurn: 2 }]);
    expect(s.powerPlayInventories.right).toHaveLength(0);
  });

  it('allows power plays to target any player on either team', () => {
    const s = createInitialState('ANY', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'bigHead', availableTurn: 1 });

    expect(usePowerPlay(s, 'l', { type: 'bigHead', targetBobbleId: 'right-2' }, 1000)).toBe(true);

    expect(s.bobbles.find(b => b.id === 'right-2')?.effects.map(e => e.type)).toContain('bigHead');
    expect(s.bobbles.find(b => b.id === 'left-1')?.effects.map(e => e.type)).not.toContain('bigHead');
  });

  it('locks formation selection except kickoff and the first turn after a goal', () => {
    const s = createInitialState('FORM', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(applyFormation(s, 'left', 'box')).toBe(true);
    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBobble(s, 'l', { bobbleId: id, aimAngle: 0, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBobble(s, 'r', { bobbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
    for (let i = 0; i < 400 && s.phase === 'planning'; i++) stepGame(s, {}, 1000 + i * 33, seq([0.5]));
    for (let i = 0; i < 400 && s.phase === 'resolving'; i++) stepGame(s, {}, 2000 + i * 33, seq([0.5]));
    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(applyFormation(s, 'left', 'rush')).toBe(false);

    s.phase = 'resolving';
    s.resolvingStartedAt = 5000;
    s.ball.pos = { x: FIELD.width + FIELD.goalDepth, y: FIELD.goalY + FIELD.goalHeight / 2 };
    s.ball.vel = { x: 20, y: 0 };
    stepGame(s, {}, 5033, seq([0.5]));
    expect(s.phase).toBe('planning');
    expect(applyFormation(s, 'left', 'rush')).toBe(true);
  });

  it('cheat boxes add every box type to the requesting side with immediate availability and warnings', () => {
    const s = createInitialState('CHEAT', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    // addCheatBoxes should be implemented by production code.
    expect(() => addCheatBoxes(s, 'l')).not.toThrow();
    expect(s.powerPlayInventories.left.map(i => i.type).sort()).toEqual([...BOX_TYPE_IDS].sort());
    expect(s.powerPlayInventories.left.every(i => i.availableTurn === s.turn)).toBe(true);
    expect(s.events.at(-1)?.message).toMatch(/CHEAT/i);
  });

  it('lets a side mascot change in the room and mirrors it to team players', () => {
    const s = createInitialState('TEAM', 3);
    addPlayer(s, 'l1', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');

    expect(setSideTeam(s, 'l1', 'bees')).toBe(true);
    expect(s.sideTeams.left).toBe('bees');
    expect(s.players.l1.team).toBe('bees');
    expect(s.players.l2.team).toBe('bees');
    expect(s.players.r.team).toBe('tigers');
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

  it('ramps launch movers along the ramp direction with a guaranteed exit speed', () => {
    const s = createInitialState('RAMP', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.fieldObjects = [{ id: 'ramp-1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    // slow ball rolling up the ramp gets redirected and launched off the lip
    s.ball.pos = { x: 505, y: 330 };
    s.ball.vel = { x: 150, y: -60 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.ball.vel.x).toBeGreaterThanOrEqual(RAMP_LAUNCH_SPEED - 1);
    expect(Math.abs(s.ball.vel.y)).toBeLessThan(1); // aligned to the ramp facing
  });

  it('ramps bounce movers that hit the tall back face instead of ramping them', () => {
    const s = createInitialState('RAMPB', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.fieldObjects = [{ id: 'ramp-1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    s.ball.pos = { x: 620, y: 310 };
    s.ball.vel = { x: -200, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.ball.vel.x).toBeGreaterThan(0); // reflected back off the wedge cliff
    expect(s.ball.pos.x).toBeGreaterThan(610); // pushed out past the lip
  });

  it('boost pads give a strong, noticeable acceleration', () => {
    expect(BOOST_PAD_ACCEL).toBeGreaterThanOrEqual(2000);
    const s = createInitialState('BOOSTP', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.fieldObjects = [{ id: 'b1', type: 'boost', owner: 'left', pos: { x: 470, y: 310 }, angle: 0, untilTurn: 99 }];
    s.ball.pos = { x: 470, y: 310 };
    s.ball.vel = { x: 50, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.ball.vel.x).toBeGreaterThan(110); // more than doubled in one tick
  });

  it('big bumpers hit far harder than normal bumpers', () => {
    expect(BIG_BUMPER_BOOST_MULT).toBeGreaterThanOrEqual(2.5);
    const run = (big: boolean) => {
      const s = createInitialState('BIGHIT', 3);
      addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
      addPlayer(s, 'r', 'Righty', 'tigers', 'right');
      startGame(s, seq([0.5]));
      s.phase = 'resolving';
      s.resolvingStartedAt = 1000;
      if (big) s.bigBumpersUntilTurn = s.turn;
      s.ball.pos = { x: BUMPERS[0].x + 55, y: BUMPERS[0].y };
      s.ball.vel = { x: -300, y: 0 };
      stepGame(s, {}, 1033, seq([0.5]));
      return s.ball.vel.x;
    };
    const normal = run(false);
    const big = run(true);
    expect(normal).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(normal + 150);
  });

  it('accumulates authoritative ball spin matching travelled distance over radius', () => {
    const s = createInitialState('SPIN', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.spin = { x: 0, y: 0 };
    s.ball.vel = { x: 300, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.ball.spin!.x).toBeCloseTo(300 * (1 / 30) / FIELD.ballRadius, 3);
    expect(s.ball.spin!.y).toBeCloseTo(0, 5);
    const before = s.ball.spin!.y;
    s.ball.vel = { x: 0, y: -240 };
    stepGame(s, {}, 1066, seq([0.5]));
    expect(s.ball.spin!.y).toBeLessThan(before); // spin follows the new travel direction
  });

  it('grants cheat boosters exactly once and never duplicates unused grants', () => {
    const s = createInitialState('CHEAT1', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(grantCheatBox(s, 'l', 'boost')).toBe(true);
    expect(s.events.at(-1)?.message).toMatch(/CHEAT/i);
    expect(grantCheatBox(s, 'l', 'boost')).toBe(false); // no duplicate while unused
    expect(grantCheatBox(s, 'l', 'boost')).toBe(false);
    expect(s.powerPlayInventories.left.filter(i => i.type === 'boost')).toHaveLength(1);
    expect(s.powerPlayInventories.left[0].availableTurn).toBe(s.turn); // usable immediately

    // one-time: using it consumes it, after which a new grant is allowed
    expect(usePowerPlay(s, 'l', { type: 'boost', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(true);
    expect(s.powerPlayInventories.left.filter(i => i.type === 'boost')).toHaveLength(0);
    expect(grantCheatBox(s, 'l', 'boost')).toBe(true);
    expect(grantCheatBox(s, 'l', 'ghosted')).toBe(true); // other types unaffected
  });

  it('sets absolute pad angles for drag-hold rotation, owner only', () => {
    const s = createInitialState('ROTABS', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'ramp', availableTurn: 1 });
    expect(usePowerPlay(s, 'l', { type: 'ramp', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(true);
    const placed = s.fieldObjects[0];
    expect(setFieldObjectAngle(s, 'r', placed.id, 1.2)).toBe(false); // opponent cannot rotate
    expect(setFieldObjectAngle(s, 'l', placed.id, Number.NaN)).toBe(false);
    expect(setFieldObjectAngle(s, 'l', placed.id, 1.2)).toBe(true);
    expect(placed.angle).toBeCloseTo(1.2);
    s.powerPlayInventories.left.push({ type: 'stickyGoo', availableTurn: 1 });
    usePowerPlay(s, 'l', { type: 'stickyGoo', position: { x: 400, y: 300 } }, 1000);
    const goo = s.fieldObjects.find(o => o.type === 'stickyGoo')!;
    expect(setFieldObjectAngle(s, 'l', goo.id, 1)).toBe(false); // goo is not rotatable
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
