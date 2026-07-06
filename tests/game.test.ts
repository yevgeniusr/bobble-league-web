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
  findDisconnectedSeat,
  grantCheatBox,
  launchBabble,
  BUMPER_MIN_EXIT_BALL,
  BUMPER_MIN_EXIT_BABBLE,
  MAX_RESOLVE_MS,
  MAX_SPEED,
  RAMP_LAUNCH_SPEED,
  reclaimPlayer,
  redactStateFor,
  removePlayer,
  rotateFieldObject,
  setFieldObjectAngle,
  setPlayerReady,
  setSideTeam,
  spawnBox,
  startGame,
  stepGame,
  usePowerPlay
} from '../shared/game';
import { BOX_TYPE_IDS, BUMPERS, FIELD } from '../shared/types';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('classic Babble League shared rules', () => {
  it('starts classic matches with four babbles per team in selected formations', () => {
    const s = createInitialState('TEST', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    applyFormation(s, 'left', 'slant');
    applyFormation(s, 'right', 'box');
    startGame(s, seq([0.5]));

    expect(s.phase).toBe('planning');
    expect(s.babbles.filter(b => b.side === 'left')).toHaveLength(4);
    expect(s.babbles.filter(b => b.side === 'right')).toHaveLength(4);
    expect(s.babbles.find(b => b.id === 'left-1')?.pos.x).toBeGreaterThan(250);
    expect(s.babbles.find(b => b.id === 'right-1')?.pos.x).toBeGreaterThan(FIELD.width - 260);
  });

  it('uses drag/launch intents and resolves turn-based physics back to planning', () => {
    const s = createInitialState('TURN', 1);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    const accepted = launchBabble(s, 'l', { babbleId: 'left-1', aimAngle: 0, impulse: 600 }, 1000);
    expect(accepted).toBe(true);
    expect(s.phase).toBe('planning');
    expect(s.pendingIntents['left-1']?.impulse).toBe(600);
    for (const id of ['left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
    stepGame(s, {}, 1000, seq([0.1, 0.2, 0.3]));
    expect(s.phase).toBe('planning');
    expect(s.allIntentsReadyAt).toBe(1000);
    stepGame(s, {}, 1000 + s.config.allAimedResolveGraceMs - 1, seq([0.1, 0.2, 0.3]));
    expect(s.phase).toBe('planning');
    stepGame(s, {}, 1000 + s.config.allAimedResolveGraceMs, seq([0.1, 0.2, 0.3]));
    expect(s.phase).toBe('resolving');

    for (let i = 0; i < 400 && s.phase === 'resolving'; i++) stepGame(s, {}, 1000 + s.config.allAimedResolveGraceMs + i * 33, seq([0.1, 0.2, 0.3]));

    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(Object.keys(s.pendingIntents)).toHaveLength(0);
    expect(s.boxes).toHaveLength(1);
    expect(['topMid', 'bottomMid']).toContain(s.boxes[0].anchor);
  });

  it('lets players replace a pending aim intent before resolution', () => {
    const s = createInitialState('REAIM', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(launchBabble(s, 'l', { babbleId: 'left-1', aimAngle: 0, impulse: 250 }, 1000)).toBe(true);
    expect(launchBabble(s, 'l', { babbleId: 'left-1', aimAngle: Math.PI / 2, impulse: 700 }, 1200)).toBe(true);

    expect(Object.keys(s.pendingIntents)).toEqual(['left-1']);
    expect(s.pendingIntents['left-1']).toMatchObject({ aimAngle: Math.PI / 2, impulse: 700 });
    expect(s.babbles.find(b => b.id === 'left-1')?.lastLaunchedTurn).toBe(0);
  });

  it('keeps planning open during all-aimed grace and launches the replacement aim', () => {
    const s = createInitialState('REAIM-GRACE', 1);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 100 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: Math.PI, impulse: 100 }, 1000);
    stepGame(s, {}, 1000, seq([0.5]));

    expect(s.phase).toBe('planning');
    expect(s.allIntentsReadyAt).toBe(1000);
    expect(Object.keys(s.pendingIntents)).toHaveLength(8);

    expect(launchBabble(s, 'l', { babbleId: 'left-1', aimAngle: Math.PI / 2, impulse: 700 }, 1200)).toBe(true);
    expect(Object.keys(s.pendingIntents)).toHaveLength(8);
    expect(s.pendingIntents['left-1']).toMatchObject({ aimAngle: Math.PI / 2, impulse: 700 });
    expect(s.allIntentsReadyAt).toBeNull();

    stepGame(s, {}, 1200, seq([0.5]));
    expect(s.phase).toBe('planning');
    expect(s.allIntentsReadyAt).toBe(1200);
    stepGame(s, {}, 1200 + s.config.allAimedResolveGraceMs - 1, seq([0.5]));
    expect(s.phase).toBe('planning');
    stepGame(s, {}, 1200 + s.config.allAimedResolveGraceMs, seq([0.5]));
    expect(s.phase).toBe('resolving');
    expect(s.babbles.find(b => b.id === 'left-1')?.vel.y).toBeGreaterThan(0);
  });

  it('resolves the planning turn early only after every connected player is ready', () => {
    const s = createInitialState('READY', 3);
    addPlayer(s, 'l1', 'Left One', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r1', 'Right One', 'tigers', 'right');
    addPlayer(s, 'r2', 'Right Two', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(setPlayerReady(s, 'l1', 1000)).toBe(true);
    expect(setPlayerReady(s, 'l2', 1001)).toBe(true);
    expect(setPlayerReady(s, 'r1', 1002)).toBe(true);
    expect(s.phase).toBe('planning');
    expect(s.readyPlayerIds.sort()).toEqual(['l1', 'l2', 'r1']);

    expect(setPlayerReady(s, 'r2', 1003)).toBe(true);

    expect(s.phase).toBe('resolving');
    expect(s.resolvingStartedAt).toBe(1003);
    expect(s.readyPlayerIds).toEqual([]);
  });

  it('does not resolve on partial ready votes before the timer deadline', () => {
    const s = createInitialState('PARTIAL', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(setPlayerReady(s, 'l', 1000)).toBe(true);
    stepGame(s, {}, s.turnDeadlineAt - 1, seq([0.5]));

    expect(s.phase).toBe('planning');
    expect(s.readyPlayerIds).toEqual(['l']);
  });

  it('removes disconnected players from ready voting and resolves when the remaining players are unanimous', () => {
    const s = createInitialState('DISCO', 3);
    addPlayer(s, 'l1', 'Left One', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(setPlayerReady(s, 'l1', 1000)).toBe(true);
    expect(setPlayerReady(s, 'l2', 1001)).toBe(true);
    removePlayer(s, 'l2');
    expect(s.readyPlayerIds).toEqual([]);

    expect(setPlayerReady(s, 'l1', 1002)).toBe(true);
    expect(setPlayerReady(s, 'r', 1002)).toBe(true);

    expect(s.phase).toBe('resolving');
    expect(s.readyPlayerIds).toEqual([]);
  });

  it('clears a player ready vote when they re-aim before resolution', () => {
    const s = createInitialState('CLEAR', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(setPlayerReady(s, 'l', 1000)).toBe(true);
    expect(s.readyPlayerIds).toEqual(['l']);
    expect(launchBabble(s, 'l', { babbleId: 'left-1', aimAngle: 0, impulse: 250 }, 1001)).toBe(true);

    expect(s.phase).toBe('planning');
    expect(s.readyPlayerIds).toEqual([]);
  });

  it('still falls back to the planning timer when ready votes are not unanimous', () => {
    const s = createInitialState('TIMER', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(launchBabble(s, 'l', { babbleId: 'left-1', aimAngle: 0, impulse: 600 }, 999)).toBe(true);
    expect(setPlayerReady(s, 'l', 1000)).toBe(true);
    stepGame(s, {}, s.turnDeadlineAt, seq([0.5]));

    expect(s.phase).toBe('resolving');
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
      for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
      for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: 0, impulse: 1 }, 1000);
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
    s.boxes = [{ id: 'box-1', type, anchor: 'topMid', pos: { ...s.babbles[0].pos }, spawnedAt: 1000 }];

    collectPowerBox(s, s.babbles[0], 1000);

    expect(s.boxes).toHaveLength(0);
    expect(s.powerPlayInventories.left).toEqual([{ type, availableTurn: 2, holderId: 'l' }]);
    expect(usePowerPlay(s, 'l', { type, targetBabbleId: 'left-1' }, 1000)).toBe(false);

    s.turn = 2;
    expect(usePowerPlay(s, 'l', { type, targetBabbleId: 'left-1' }, 2000)).toBe(true);
    expect(s.powerPlayInventories.left).toHaveLength(0);
    expect(s.babbles[0].effects.map(e => e.type)).toContain('bigHead');
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
    expect(s.powerPlayInventories.left).toEqual([{ type: 'boost', availableTurn: 2, holderId: 'l' }]);
    expect(s.powerPlayInventories.right).toHaveLength(0);
  });

  it('allows power plays to target any player on either team', () => {
    const s = createInitialState('ANY', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'bigHead', availableTurn: 1 });

    expect(usePowerPlay(s, 'l', { type: 'bigHead', targetBabbleId: 'right-2' }, 1000)).toBe(true);

    expect(s.babbles.find(b => b.id === 'right-2')?.effects.map(e => e.type)).toContain('bigHead');
    expect(s.babbles.find(b => b.id === 'left-1')?.effects.map(e => e.type)).not.toContain('bigHead');
  });

  it('locks formation selection except kickoff and the first turn after a goal', () => {
    const s = createInitialState('FORM', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    expect(applyFormation(s, 'left', 'box')).toBe(true);
    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
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

  it('distributes four babbles across four teammates and resolves when all eight are aimed', () => {
    const s = createInitialState('EIGHT', 1);
    for (let i = 0; i < 4; i++) addPlayer(s, `l${i}`, `Left ${i}`, 'pigs', 'left');
    for (let i = 0; i < 4; i++) addPlayer(s, `r${i}`, `Right ${i}`, 'parrots', 'right');
    startGame(s, seq([0.5]));
    for (let i = 0; i < 4; i++) expect(s.players[`l${i}`].controlledBabbleIds).toEqual([`left-${i + 1}`]);
    for (let i = 0; i < 4; i++) expect(s.players[`r${i}`].controlledBabbleIds).toEqual([`right-${i + 1}`]);
    for (let i = 1; i <= 4; i++) launchBabble(s, `l${i - 1}`, { babbleId: `left-${i}`, aimAngle: 0, impulse: 50 }, 1000);
    for (let i = 1; i <= 4; i++) launchBabble(s, `r${i - 1}`, { babbleId: `right-${i}`, aimAngle: Math.PI, impulse: 50 }, 1000);
    stepGame(s, {}, 1000, seq([0.5]));
    expect(s.phase).toBe('planning');
    expect(Object.keys(s.pendingIntents)).toHaveLength(8);
    stepGame(s, {}, 1000 + s.config.allAimedResolveGraceMs, seq([0.5]));
    expect(s.phase).toBe('resolving');
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

    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 1 }, 2000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: Math.PI, impulse: 1 }, 2000);
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
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeLessThanOrEqual(MAX_SPEED); // clamped
    expect(s.bumperEvents.length).toBeGreaterThanOrEqual(1);
    expect(s.bumperEvents[0].pos).toEqual({ x: BUMPERS[0].x, y: BUMPERS[0].y });
  });

  it('bumpers guarantee a strong minimum exit speed even on weak grazes', () => {
    expect(BUMPER_MIN_EXIT_BALL).toBeGreaterThanOrEqual(400);
    expect(BUMPER_MIN_EXIT_BABBLE).toBeGreaterThanOrEqual(300);
    const s = createInitialState('MINEXIT', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    // park babbles away from the bumper so only the ball interacts with it
    s.babbles.forEach((b, i) => { b.pos = { x: 400 + i * 60, y: 310 }; b.vel = { x: 0, y: 0 }; });
    s.ball.pos = { x: BUMPERS[0].x + 51, y: BUMPERS[0].y };
    s.ball.vel = { x: -40, y: 0 }; // barely creeping into the bumper
    stepGame(s, {}, 1033, seq([0.5]));
    expect(Math.hypot(s.ball.vel.x, s.ball.vel.y)).toBeGreaterThanOrEqual(BUMPER_MIN_EXIT_BALL * 0.95);
    expect(s.ball.vel.x).toBeGreaterThan(0); // reflected away from the corner
  });

  it(`allows up to ${MAX_RESOLVE_MS / 1000} seconds of resolution and zeroes all velocities before the next turn`, () => {
    expect(MAX_RESOLVE_MS).toBe(8000);
    const s = createInitialState('TIME', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    for (let now = 1033; now < 1000 + MAX_RESOLVE_MS; now += 33) {
      s.babbles[0].vel = { x: 500, y: 0 }; // keep an object perpetually fast
      stepGame(s, {}, now, seq([0.5]));
      expect(s.phase).toBe('resolving'); // still resolving before the failsafe cap
    }
    s.babbles[0].vel = { x: 500, y: 0 };
    stepGame(s, {}, 1001 + MAX_RESOLVE_MS, seq([0.5]));
    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(s.ball.vel).toEqual({ x: 0, y: 0 });
    for (const b of s.babbles) expect(b.vel).toEqual({ x: 0, y: 0 }); // no physics carryover
  }, 20000); // ~300 Rapier ticks; parallel test workers pay WASM warmup

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
    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: 0, impulse: 1 }, 1000);
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

  it('boost pads give a controlled but noticeable acceleration', () => {
    expect(BOOST_PAD_ACCEL).toBeGreaterThanOrEqual(2800);
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
    expect(s.ball.vel.x).toBeGreaterThan(80); // visibly accelerated in one tick
  });

  it('big bumpers hit far harder than normal bumpers', () => {
    expect(BIG_BUMPER_BOOST_MULT).toBeGreaterThanOrEqual(2);
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
    expect(big).toBeGreaterThan(normal + 80);
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

describe('goal mouth scoring is airtight', () => {
  const setup = (mode: 1 | 3 = 3) => {
    const s = createInitialState('MOUTH', mode);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    return s;
  };

  it('scores the moment the ball overlaps the goal mouth so it can never rest inside a gate', () => {
    const s = setup();
    s.ball.pos = { x: 2, y: FIELD.goalY + 40 }; // stationary, overlapping the left mouth
    s.ball.vel = { x: 0, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.score.right).toBe(1); // ball in the left gate credits the right team
    expect(s.ball.pos).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 }); // kickoff reset, nothing lingers in the gate
  });

  it('scores a stalled ball overlapping the right mouth too', () => {
    const s = setup();
    s.ball.pos = { x: FIELD.width - 2, y: FIELD.goalY + FIELD.goalHeight - 30 };
    s.ball.vel = { x: 0, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.score.left).toBe(1);
  });

  it('does not score while the ball only touches the mouth plane from the field side', () => {
    const s = setup();
    s.ball.pos = { x: s.ball.radius, y: FIELD.goalY + 40 }; // resting against the line, not across it
    s.ball.vel = { x: 0, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.score).toEqual({ left: 0, right: 0 });
    expect(s.turn).toBe(2); // turn settled normally instead
  });

  it('does not score outside the mouth height even when far past the line', () => {
    const s = setup();
    s.ball.pos = { x: 2, y: FIELD.goalY - 40 };
    s.ball.vel = { x: 0, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.score).toEqual({ left: 0, right: 0 });
  });

  it('credits the defending side while Swap Goals is active', () => {
    const s = setup();
    s.swappedGoalsUntilTurn = s.turn;
    s.ball.pos = { x: 2, y: FIELD.goalY + 40 }; // left gate while swapped
    s.ball.vel = { x: 0, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.score.left).toBe(1);
    expect(s.score.right).toBe(0);
  });
});

describe('one box per player (server-enforced)', () => {
  it('replaces the controlling player held box on pickup', () => {
    const s = createInitialState('REBOX', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'l' });
    s.boxes = [{ id: 'box-1', type: 'bigHead', anchor: 'topMid', pos: { ...s.babbles[0].pos }, spawnedAt: 1000 }];

    expect(collectPowerBox(s, s.babbles[0], 1000)).toBe(true);

    expect(s.boxes).toHaveLength(0);
    expect(s.powerPlayInventories.left).toEqual([{ type: 'bigHead', availableTurn: 2, holderId: 'l' }]);
  });

  it('keeps one visible box per teammate by replacing an existing holder item', () => {
    const s = createInitialState('ONEBOX2', 3);
    addPlayer(s, 'l1', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    const babbleOf = (pid: string) => s.babbles.find(b => s.players[pid].controlledBabbleIds.includes(b.id))!;

    s.boxes = [{ id: 'box-1', type: 'boost', anchor: 'topMid', pos: { ...babbleOf('l1').pos }, spawnedAt: 1000 }];
    expect(collectPowerBox(s, babbleOf('l1'), 1000)).toBe(true);
    expect(s.powerPlayInventories.left).toEqual([{ type: 'boost', availableTurn: 2, holderId: 'l1' }]);

    s.boxes = [{ id: 'box-2', type: 'ghosted', anchor: 'topMid', pos: { ...babbleOf('l2').pos }, spawnedAt: 1100 }];
    expect(collectPowerBox(s, babbleOf('l2'), 1100)).toBe(true);
    expect(s.powerPlayInventories.left).toHaveLength(2);

    s.boxes = [{ id: 'box-3', type: 'swapGoals', anchor: 'topMid', pos: { ...babbleOf('l1').pos }, spawnedAt: 1200 }];
    expect(collectPowerBox(s, babbleOf('l1'), 1200)).toBe(true);
    expect(s.boxes).toHaveLength(0);
    expect(s.powerPlayInventories.left).toEqual([
      { type: 'swapGoals', availableTurn: 2, holderId: 'l1' },
      { type: 'ghosted', availableTurn: 2, holderId: 'l2' }
    ]);
  });

  it('assigns ball pickups to a teammate with a free slot and never reveals the type publicly', () => {
    const s = createInitialState('BALLONE', 3);
    addPlayer(s, 'l1', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'l1' });
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.pos = { x: FIELD.width / 2, y: FIELD.height / 2 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.lastTouchedBy = 'left';
    s.boxes = [{ id: 'ball-box', type: 'bigHead', anchor: 'topMid', pos: { ...s.ball.pos }, spawnedAt: 1000, untilTurn: s.turn + 2 }];

    stepGame(s, {}, 1033, seq([0.5]));

    expect(s.powerPlayInventories.left).toContainEqual({ type: 'bigHead', availableTurn: 2, holderId: 'l2' });
    expect(s.events.some(e => /grabbed a mystery box/.test(e.message))).toBe(true);
    expect(s.events.some(e => /Big Head/.test(e.message))).toBe(false); // type stays team-private
  });

  it('ball pickups replace a held box when no teammate has a free slot', () => {
    const s = createInitialState('BALLREPLACE', 3);
    addPlayer(s, 'l1', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.turn = 2; // avoid the automatic even-turn spawn obscuring pickup assertions
    s.powerPlayInventories.left.push(
      { type: 'boost', availableTurn: 1, holderId: 'l1' },
      { type: 'ghosted', availableTurn: 1, holderId: 'l2' }
    );
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.ball.pos = { x: FIELD.width / 2, y: FIELD.height / 2 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.lastTouchedBy = 'left';
    s.boxes = [{ id: 'ball-box', type: 'bigHead', anchor: 'topMid', pos: { ...s.ball.pos }, spawnedAt: 1000, untilTurn: s.turn + 2 }];

    stepGame(s, {}, 1033, seq([0.5]));

    expect(s.boxes).toHaveLength(0);
    expect(s.powerPlayInventories.left).toEqual([
      { type: 'bigHead', availableTurn: 3, holderId: 'l1' },
      { type: 'ghosted', availableTurn: 1, holderId: 'l2' }
    ]);
  });

  it('only the holding player can spend a held power play', () => {
    const s = createInitialState('HOLDER', 3);
    addPlayer(s, 'l1', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'l2', 'Left Two', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'bigHead', availableTurn: 1, holderId: 'l1' });

    expect(usePowerPlay(s, 'l2', { type: 'bigHead', targetBabbleId: 'left-1' }, 1000)).toBe(false);
    expect(usePowerPlay(s, 'r', { type: 'bigHead', targetBabbleId: 'left-1' }, 1000)).toBe(false);
    expect(usePowerPlay(s, 'l1', { type: 'bigHead', targetBabbleId: 'left-1' }, 1000)).toBe(true);
    expect(s.powerPlayInventories.left).toHaveLength(0);
  });

  it('redacts opponent inventory details but exposes box counts to everyone', () => {
    const s = createInitialState('REDACT', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    s.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'l' });
    s.powerPlayInventories.right.push({ type: 'ghosted', availableTurn: 1, holderId: 'r' }, { type: 'bigHead', availableTurn: 2, holderId: 'r' });

    const forLeft = redactStateFor(s, 'l');
    expect(forLeft.powerPlayInventories.left).toEqual([{ type: 'boost', availableTurn: 1, holderId: 'l' }]);
    expect(forLeft.powerPlayInventories.right).toEqual([]);
    expect(forLeft.powerPlayCounts).toEqual({ left: 1, right: 2 });

    const forRight = redactStateFor(s, 'r');
    expect(forRight.powerPlayInventories.left).toEqual([]);
    expect(forRight.powerPlayInventories.right).toHaveLength(2);
    expect(forRight.powerPlayCounts).toEqual({ left: 1, right: 2 });

    const spectator = redactStateFor(s, 'not-in-room');
    expect(spectator.powerPlayInventories.left).toEqual([]);
    expect(spectator.powerPlayInventories.right).toEqual([]);
    expect(spectator.powerPlayCounts).toEqual({ left: 1, right: 2 });
  });
});

describe('ramp launch events', () => {
  it('records a ramp launch event for the ball so the client can animate the hop', () => {
    const s = createInitialState('RAMPEV', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.fieldObjects = [{ id: 'ramp-1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    s.ball.pos = { x: 505, y: 330 };
    s.ball.vel = { x: 150, y: -60 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.rampEvents.length).toBeGreaterThanOrEqual(1);
    expect(s.rampEvents[0]).toMatchObject({ mover: 'ball', pos: { x: 550, y: 310 } });
    // debounced: the same mover riding the ramp on the next tick does not spam events
    stepGame(s, {}, 1066, seq([0.5]));
    expect(s.rampEvents.filter(e => e.mover === 'ball')).toHaveLength(1);
  });

  it('records babble ramp launches with the specific babble id', () => {
    const s = createInitialState('RAMPEV2', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.phase = 'resolving';
    s.resolvingStartedAt = 1000;
    s.fieldObjects = [{ id: 'ramp-1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 505, y: 310 };
    b.vel = { x: 120, y: 0 };
    s.ball.pos = { x: 900, y: 100 }; // keep the ball away from the ramp
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.rampEvents.some(e => e.mover === 'babble' && e.moverId === 'left-1')).toBe(true);
  });

  it('boost pads are launch-day strong', () => {
    expect(BOOST_PAD_ACCEL).toBeGreaterThanOrEqual(2800);
    expect(RAMP_LAUNCH_SPEED).toBeGreaterThanOrEqual(550);
  });
});

describe('reconnect seat reclaim', () => {
  it('lets a returning player reclaim their disconnected seat with babbles and held box', () => {
    const s = createInitialState('RECON', 3);
    addPlayer(s, 'old-sock', 'Dana', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    s.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'old-sock' });
    const babbles = [...s.players['old-sock'].controlledBabbleIds];
    expect(babbles.length).toBeGreaterThan(0);

    removePlayer(s, 'old-sock');
    expect(s.players['old-sock'].connected).toBe(false);

    const seat = findDisconnectedSeat(s, 'Dana');
    expect(seat?.id).toBe('old-sock');
    const reclaimed = reclaimPlayer(s, seat!.id, 'new-sock');
    expect(reclaimed).not.toBeNull();
    expect(s.players['old-sock']).toBeUndefined();
    expect(s.players['new-sock']).toMatchObject({ name: 'Dana', side: 'left', connected: true, controlledBabbleIds: babbles });
    expect(s.powerPlayInventories.left[0].holderId).toBe('new-sock');
    expect(usePowerPlay(s, 'new-sock', { type: 'boost', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(true);
  });

  it('never reclaims connected seats or unknown names', () => {
    const s = createInitialState('RECON2', 3);
    addPlayer(s, 'a', 'Dana', 'pigs', 'left');
    expect(findDisconnectedSeat(s, 'Dana')).toBeNull(); // still connected
    expect(findDisconnectedSeat(s, 'Nobody')).toBeNull();
    expect(reclaimPlayer(s, 'a', 'b')).toBeNull(); // connected seats stay put
  });
});

describe('using a box never blocks babble control', () => {
  const setup = () => {
    const s = createInitialState('CTRL', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));
    return s;
  };

  it('keeps controlledBabbleIds and same-turn launching intact after every power play type', () => {
    for (const type of BOX_TYPE_IDS) {
      const s = setup();
      const before = [...s.players.l.controlledBabbleIds];
      expect(before).toHaveLength(4);
      s.powerPlayInventories.left.push({ type, availableTurn: 1, holderId: 'l' });
      expect(usePowerPlay(s, 'l', { type, targetBabbleId: 'left-2', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(true);
      expect(s.players.l.controlledBabbleIds).toEqual(before);
      expect(s.phase).toBe('planning');
      for (const id of before) {
        expect(launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 100 }, 1000)).toBe(true);
      }
    }
  });

  it('still allows launching controlled babbles on the turn after a box was used', () => {
    const s = setup();
    s.powerPlayInventories.left.push({ type: 'ghosted', availableTurn: 1, holderId: 'l' });
    expect(usePowerPlay(s, 'l', { type: 'ghosted', targetBabbleId: 'left-1' }, 1000)).toBe(true);
    for (const id of ['left-1', 'left-2', 'left-3', 'left-4']) launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 1 }, 1000);
    for (const id of ['right-1', 'right-2', 'right-3', 'right-4']) launchBabble(s, 'r', { babbleId: id, aimAngle: Math.PI, impulse: 1 }, 1000);
    for (let i = 0; i < 400 && s.turn === 1; i++) stepGame(s, {}, 1000 + i * 33, seq([0.5]));
    expect(s.turn).toBe(2);
    expect(s.phase).toBe('planning');
    expect(s.players.l.controlledBabbleIds).toHaveLength(4);
    for (const id of s.players.l.controlledBabbleIds) {
      expect(launchBabble(s, 'l', { babbleId: id, aimAngle: 0, impulse: 100 }, 20000)).toBe(true);
    }
  });

  it('redacted state preserves players, controlled babbles and your own inventory holders', () => {
    const s = setup();
    s.powerPlayInventories.left.push({ type: 'boost', availableTurn: 1, holderId: 'l' });
    const view = redactStateFor(s, 'l');
    expect(view.players).toEqual(s.players);
    expect(view.players.l.controlledBabbleIds).toEqual(s.players.l.controlledBabbleIds);
    expect(view.powerPlayInventories.left).toEqual([{ type: 'boost', availableTurn: 1, holderId: 'l' }]);
    expect(view.babbles).toEqual(s.babbles);
    // after spending the box, the viewer still owns the same babbles
    expect(usePowerPlay(s, 'l', { type: 'boost', position: { x: 500, y: 300 }, angle: 0 }, 1000)).toBe(true);
    const after = redactStateFor(s, 'l');
    expect(after.players.l.controlledBabbleIds).toEqual(view.players.l.controlledBabbleIds);
    expect(after.powerPlayInventories.left).toHaveLength(0);
  });
});

describe('move ball ability', () => {
  it('teleports the ball to the clicked spot, clamped inside the field, and stops it dead', () => {
    const s = createInitialState('MOVEB', 3);
    addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
    addPlayer(s, 'r', 'Righty', 'tigers', 'right');
    startGame(s, seq([0.5]));

    s.powerPlayInventories.left.push({ type: 'moveBall', availableTurn: 1, holderId: 'l' });
    s.ball.vel = { x: 300, y: -200 };
    expect(usePowerPlay(s, 'l', { type: 'moveBall', position: { x: -400, y: 99999 } }, 1000)).toBe(true);
    expect(s.ball.pos).toEqual({ x: FIELD.ballRadius, y: FIELD.height - FIELD.ballRadius });
    expect(s.ball.vel).toEqual({ x: 0, y: 0 });
    expect(s.ball.lastTouchedBy).toBeNull();

    s.powerPlayInventories.left.push({ type: 'moveBall', availableTurn: 1, holderId: 'l' });
    expect(usePowerPlay(s, 'l', { type: 'moveBall', position: { x: 640, y: 222 } }, 1100)).toBe(true);
    expect(s.ball.pos).toEqual({ x: 640, y: 222 });

    s.powerPlayInventories.left.push({ type: 'moveBall', availableTurn: 1, holderId: 'l' });
    expect(usePowerPlay(s, 'l', { type: 'moveBall', position: { x: Number.NaN, y: 10 } }, 1200)).toBe(true);
    expect(s.ball.pos).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 }); // bogus input falls back to center
  });
});
