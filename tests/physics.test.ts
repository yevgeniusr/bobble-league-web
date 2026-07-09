// Focused tests for the Rapier 3D physics core (shared/physics.ts) as wired
// into the shared rules (shared/game.ts): goal scoring, wall/gate handling,
// body collisions, ghosting, blocks, boxes, ramps/boosts, settling, and a
// full 8-betabot scripted match completing by goal.
import { describe, expect, it } from 'vitest';
import { addPlayer, createInitialState, launchBabble, MAX_RESOLVE_MS, MAX_SPEED, startGame, stepGame } from '../shared/game';
import { stepPhysics } from '../shared/physics';
import { FIELD, GameState, PlayerSide, Vec } from '../shared/types';
import { BALL_MAX_HEIGHT, BALL_REST_HEIGHT, babbleRestHeight, ballRestHeight } from '../shared/airborne';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

function setup(mode: 1 | 3 = 3) {
  const s = createInitialState('PHYS', mode);
  addPlayer(s, 'l', 'Lefty', 'pigs', 'left');
  addPlayer(s, 'r', 'Righty', 'tigers', 'right');
  startGame(s, seq([0.5]));
  s.phase = 'resolving';
  s.resolvingStartedAt = 1000;
  return s;
}

// Park all babbles except the listed ids along the top rail, away from
// bumpers, walls, lanes and each other, so tests control exactly one actor.
function park(s: GameState, except: string[] = []) {
  let i = 0;
  for (const b of s.babbles) {
    if (except.includes(b.id)) continue;
    b.pos = { x: 170 + i * 60, y: 30 };
    b.vel = { x: 0, y: 0 };
    i++;
  }
}

function run(s: GameState, ticks: number, from = 1000, onTick?: (tick: number) => void) {
  for (let i = 1; i <= ticks; i++) {
    stepGame(s, {}, from + i * 33, seq([0.5]));
    onTick?.(i);
  }
}

describe('Rapier physics: goals and gates', () => {
  it('scores a fast straight shot into the right goal mouth', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: FIELD.width / 2, y: FIELD.goalY + FIELD.goalHeight / 2 };
    s.ball.vel = { x: 1500, y: 0 };
    run(s, 60);
    expect(s.score.left).toBe(1);
    expect(s.ball.pos).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 }); // kickoff reset
  });

  it('scores a fast diagonal shot into the left goal mouth', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 400, y: 150 };
    const target = { x: 0, y: FIELD.goalY + FIELD.goalHeight * 0.6 };
    const len = Math.hypot(target.x - s.ball.pos.x, target.y - s.ball.pos.y);
    s.ball.vel = { x: ((target.x - s.ball.pos.x) / len) * 1400, y: ((target.y - s.ball.pos.y) / len) * 1400 };
    run(s, 80);
    expect(s.score.right).toBe(1);
  });

  it('never lets a max-speed ball escape the arena or rest inside a gate', () => {
    for (let k = 0; k < 16; k++) {
      const s = setup();
      park(s);
      const angle = (k / 16) * Math.PI * 2;
      s.ball.pos = { x: FIELD.width / 2, y: FIELD.height / 2 };
      s.ball.vel = { x: Math.cos(angle) * MAX_SPEED, y: Math.sin(angle) * MAX_SPEED };
      // Transient bounds allow brief penetration into the thick (50px) walls
      // while restitution resolves a max-speed impact; never past a wall.
      run(s, 320, 1000, () => {
        expect(s.ball.pos.x).toBeGreaterThan(-FIELD.goalDepth - s.ball.radius - 40);
        expect(s.ball.pos.x).toBeLessThan(FIELD.width + FIELD.goalDepth + s.ball.radius + 40);
        expect(s.ball.pos.y).toBeGreaterThan(-40);
        expect(s.ball.pos.y).toBeLessThan(FIELD.height + 40);
      });
      // Every run must end the turn cleanly: either a goal reset the ball to
      // kickoff or the ball settled somewhere on the field, never in a gate.
      expect(s.phase).toBe('planning');
      expect(s.ball.pos.x).toBeGreaterThanOrEqual(s.ball.radius - 0.5);
      expect(s.ball.pos.x).toBeLessThanOrEqual(FIELD.width - s.ball.radius + 0.5);
    }
  }, 30000);

  it('stops babbleheads on the goal line: only the ball may enter the gate', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 200, y: FIELD.goalY + FIELD.goalHeight / 2 };
    b.vel = { x: -1300, y: 0 };
    s.ball.pos = { x: 900, y: 100 };
    run(s, 120);
    expect(b.pos.x).toBeGreaterThanOrEqual(b.radius - 1);
    expect(s.score).toEqual({ left: 0, right: 0 });
  });
});

describe('Rapier physics: walls and body collisions', () => {
  it('reflects the ball off the top wall', () => {
    const s = setup();
    park(s);
    // x=750 keeps the rising ball clear of the babbles parked along the top rail
    s.ball.pos = { x: 750, y: 60 };
    s.ball.vel = { x: 0, y: -500 };
    run(s, 10);
    expect(s.ball.vel.y).toBeGreaterThan(150); // bounced downward, lively
    expect(s.ball.pos.y).toBeGreaterThan(s.ball.radius - 1);
  });

  it('reflects babbleheads off walls with a duller bounce than the ball', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 550, y: FIELD.height - 70 };
    b.vel = { x: 0, y: 500 };
    s.ball.pos = { x: 900, y: 100 };
    run(s, 10);
    expect(b.vel.y).toBeLessThan(-100); // bounced back up
    expect(b.pos.y).toBeLessThan(FIELD.height - b.radius + 1);
  });

  it('transfers momentum from a flicked babble to the ball and records the touch', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 400, y: 310 };
    b.vel = { x: 600, y: 0 };
    s.ball.pos = { x: 470, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    run(s, 10);
    expect(s.ball.vel.x).toBeGreaterThan(300); // light ball rockets ahead
    expect(s.ball.vel.x).toBeGreaterThan(b.vel.x); // faster than the babble
    expect(s.ball.lastTouchedBy).toBe('left');
    expect(s.ball.lastTouchedBabbleId).toBe('left-1');
    expect(s.ball.lastTouchedPlayerId).toBe('l');
  });

  it('keeps crediting a dribbling babble after attribution is wiped mid-contact', () => {
    const s = setup();
    park(s, ['right-1']);
    const b = s.babbles.find(x => x.id === 'right-1')!;
    // Start in contact, make first touch, then wipe attribution while the
    // babble keeps chasing the ball: the persistent world must re-credit the
    // dribble even though the original contact "started" event is long gone.
    b.pos = { x: 500 - b.radius - s.ball.radius + 1, y: 310 };
    b.vel = { x: 200, y: 0 };
    s.ball.pos = { x: 500, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    run(s, 1);
    expect(s.ball.lastTouchedBy).toBe('right'); // first touch registered
    expect(s.ball.lastTouchedBabbleId).toBe('right-1');
    expect(s.ball.lastTouchedPlayerId).toBe('r');
    s.ball.lastTouchedBy = null; // wiped mid-dribble
    s.ball.lastTouchedBabbleId = null;
    s.ball.lastTouchedPlayerId = null;
    run(s, 10, 1033, () => { b.vel = { x: 300, y: 0 }; }); // keep pressing
    expect(s.ball.vel.x).toBeGreaterThan(50); // ball is being pushed along
    expect(s.ball.lastTouchedBy).toBe('right'); // dribble re-credited
    expect(s.ball.lastTouchedBabbleId).toBe('right-1');
    expect(s.ball.lastTouchedPlayerId).toBe('r');
  });

  it('keeps crediting dribbles at the 3D sphere contact distance', () => {
    const s = setup();
    park(s, ['right-1']);
    const b = s.babbles.find(x => x.id === 'right-1')!;
    const physicalContact = (ballRestHeight(s.ball.radius) + babbleRestHeight(b.radius)) * 50 - 1;
    b.pos = { x: 500 - physicalContact, y: 310 };
    b.vel = { x: 0, y: 0 };
    s.ball.pos = { x: 500, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    stepPhysics(s, 1 / 30);
    expect(s.ball.lastTouchedBy).toBe('right');
    s.ball.lastTouchedBy = null;
    s.ball.lastTouchedBabbleId = null;
    s.ball.lastTouchedPlayerId = null;

    stepPhysics(s, 1 / 30);

    expect(s.ball.lastTouchedBy).toBe('right');
    expect(s.ball.lastTouchedBabbleId).toBe('right-1');
    expect(s.ball.lastTouchedPlayerId).toBe('r');
  });

  it('bounces babbleheads off each other without overlap', () => {
    const s = setup();
    park(s, ['left-1', 'right-1']);
    const a = s.babbles.find(x => x.id === 'left-1')!;
    const b = s.babbles.find(x => x.id === 'right-1')!;
    a.pos = { x: 400, y: 310 };
    a.vel = { x: 700, y: 0 };
    b.pos = { x: 520, y: 310 };
    b.vel = { x: 0, y: 0 };
    s.ball.pos = { x: 900, y: 100 };
    run(s, 12);
    expect(b.vel.x).toBeGreaterThan(150); // shoved forward
    expect(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y)).toBeGreaterThanOrEqual(a.radius + b.radius - 1);
  });

  it('lets ghosted babbleheads pass through babbles, the ball and blocks, but not walls', () => {
    const s = setup();
    park(s, ['left-1', 'right-1']);
    const ghost = s.babbles.find(x => x.id === 'left-1')!;
    ghost.effects.push({ type: 'ghosted', untilTurn: s.turn });
    ghost.pos = { x: 300, y: 310 };
    ghost.vel = { x: 900, y: 0 };
    const foe = s.babbles.find(x => x.id === 'right-1')!;
    foe.pos = { x: 450, y: 310 };
    foe.vel = { x: 0, y: 0 };
    s.ball.pos = { x: 560, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    s.fieldObjects = [{ id: 'blk', type: 'block', owner: 'right', pos: { x: 680, y: 310 }, angle: Math.PI / 2, untilTurn: 99 }];
    run(s, 40);
    expect(ghost.pos.x).toBeGreaterThan(620); // sailed through foe, ball and block under the controlled drag tune
    expect(foe.pos.x).toBeCloseTo(450, 3); // untouched (f32 round-trip only)
    expect(foe.pos.y).toBeCloseTo(310, 3);
    expect(s.ball.vel).toEqual({ x: 0, y: 0 });
    expect(s.ball.lastTouchedBy).toBeNull();
    expect(ghost.pos.x).toBeLessThanOrEqual(FIELD.width - ghost.radius + 1); // wall still holds
  });

  it('bounces a normal babble off a placed block wall', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 470, y: 310 };
    b.vel = { x: 750, y: 0 };
    s.ball.pos = { x: 900, y: 100 };
    s.fieldObjects = [{ id: 'blk', type: 'block', owner: 'right', pos: { x: 600, y: 310 }, angle: Math.PI / 2, untilTurn: 99 }];
    run(s, 20);
    expect(b.vel.x).toBeLessThan(0);
    expect(b.pos.x).toBeLessThan(600 - 14);
  });

  it('deflects an airborne ball off a placed block wall', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 470, y: 310 };
    s.ball.vel = { x: 750, y: 0 };
    s.ball.height = 1.4;
    s.ball.verticalVelocity = 0;
    s.fieldObjects = [{ id: 'blk', type: 'block', owner: 'right', pos: { x: 600, y: 310 }, angle: Math.PI / 2, untilTurn: 99 }];

    run(s, 20);

    expect(s.ball.vel.x).toBeLessThan(0);
    expect(s.ball.pos.x).toBeLessThan(600 - 14);
  });
});

describe('Rapier physics: power-play interplay', () => {
  it('projects ball height and vertical velocity directly from the Rapier 3D body', () => {
    const s = setup();
    park(s);
    const startHeight = ballRestHeight(s.ball.radius) + 1;
    s.ball.pos = { x: 550, y: 150 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.height = startHeight;
    s.ball.verticalVelocity = 0;

    stepPhysics(s, 1 / 30);

    expect(s.ball.height).toBeLessThan(startHeight);
    expect(s.ball.height).toBeGreaterThan(ballRestHeight(s.ball.radius));
    expect(s.ball.verticalVelocity).toBeLessThan(-0.05);
  });

  it('projects babble height from the Rapier 3D sphere center while gravity lands it on the floor', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    const restHeight = babbleRestHeight(b.radius);
    b.pos = { x: 550, y: 310 };
    b.vel = { x: 0, y: 0 };
    b.height = restHeight + 0.35;
    b.verticalVelocity = 0;
    s.ball.pos = { x: 900, y: 100 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.height = ballRestHeight(s.ball.radius);
    s.ball.verticalVelocity = 0;

    stepPhysics(s, 1 / 30);

    expect(b.height).toBeLessThan(restHeight + 0.35);
    expect(b.verticalVelocity).toBeLessThan(-0.05);

    for (let i = 0; i < 120; i++) stepPhysics(s, 1 / 30);

    expect(b.height).toBeCloseTo(restHeight, 3);
    expect(b.verticalVelocity).toBeCloseTo(0, 3);
  });

  it('keeps a flat ball at the authoritative rest height without drifting', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 550, y: 150 };
    s.ball.vel = { x: 0, y: 0 };

    run(s, 6);

    expect(s.ball.height).toBeCloseTo(BALL_REST_HEIGHT, 5);
    expect(s.ball.verticalVelocity).toBe(0);
  });

  it('adds vertical lift when a babble hard-impacts the ball, then gravity lands it', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 410, y: 310 };
    b.vel = { x: 950, y: 0 };
    s.ball.pos = { x: 465, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    let maxHeight = s.ball.height;

    run(s, 150, 1000, () => { maxHeight = Math.max(maxHeight, s.ball.height); });

    expect(maxHeight).toBeGreaterThan(BALL_REST_HEIGHT + 0.18);
    expect(s.ball.height).toBeCloseTo(ballRestHeight(s.ball.radius), 5);
    expect(s.ball.verticalVelocity).toBe(0);
  });

  it('gives opposing multi-direction ball impacts more lift than one hard impact', () => {
    const maxLift = (opposed: boolean) => {
      const s = setup();
      park(s, opposed ? ['left-1', 'right-1'] : ['left-1']);
      const left = s.babbles.find(x => x.id === 'left-1')!;
      left.pos = { x: 490, y: 310 };
      left.vel = { x: 780, y: 0 };
      if (opposed) {
        const right = s.babbles.find(x => x.id === 'right-1')!;
        right.pos = { x: 610, y: 310 };
        right.vel = { x: -780, y: 0 };
      }
      s.ball.pos = { x: 550, y: 310 };
      s.ball.vel = { x: 0, y: 0 };
      let maxHeight = s.ball.height;
      run(s, 24, 1000, () => { maxHeight = Math.max(maxHeight, s.ball.height); });
      return maxHeight;
    };

    expect(maxLift(true)).toBeGreaterThan(maxLift(false) + 0.16);
  });

  it('lets beach ball impacts pop much higher and float longer than normal impacts', () => {
    const runImpact = (beachy: boolean) => {
      const s = setup();
      park(s, ['left-1']);
      const b = s.babbles.find(x => x.id === 'left-1')!;
      if (beachy) { s.beachBallUntilTurn = s.turn; s.ball.radius = FIELD.ballRadius * 1.6; }
      b.pos = { x: 410, y: 150 };
      b.vel = { x: 1050, y: 0 };
      s.ball.pos = { x: 465, y: 150 };
      s.ball.vel = { x: 0, y: 0 };
      let maxHeight = s.ball.height;
      let airborneTicks = 0;
      run(s, 150, 1000, () => {
        maxHeight = Math.max(maxHeight, s.ball.height);
        if (s.ball.height > ballRestHeight(s.ball.radius) + 0.05) airborneTicks++;
      });
      return { maxHeight, airborneTicks };
    };

    const normal = runImpact(false);
    const beachy = runImpact(true);
    expect(normal.maxHeight).toBeGreaterThan(0.78);
    expect(normal.maxHeight).toBeLessThan(1.25);
    expect(beachy.maxHeight).toBeGreaterThan(normal.maxHeight + 0.85);
    expect(beachy.maxHeight).toBeGreaterThan(2.45);
    expect(beachy.maxHeight).toBeLessThanOrEqual(BALL_MAX_HEIGHT);
    expect(beachy.airborneTicks).toBeGreaterThan(normal.airborneTicks + 8);
  });

  it('collects a mystery box when a babble drives over it', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 500, y: 310 };
    b.vel = { x: 450, y: 0 };
    s.ball.pos = { x: 900, y: 100 };
    s.boxes = [{ id: 'box-1', type: 'ramp', anchor: 'topMid', pos: { x: 600, y: 310 }, spawnedAt: 1000, untilTurn: s.turn + 2 }];
    run(s, 20);
    expect(s.boxes).toHaveLength(0);
    expect(s.powerPlayInventories.left).toEqual([{ type: 'ramp', availableTurn: s.turn + 1, holderId: 'l' }]);
  });

  it('slingshots a rolling ball crossing a boost pad beyond a padless control run', () => {
    // Run at y=150 (off the goal mouth, so nothing scores) and compare the
    // farthest x reached, since a boosted ball can reach the wall and rebound.
    const runBall = (withPad: boolean) => {
      const s = setup();
      park(s);
      if (withPad) s.fieldObjects = [{ id: 'b1', type: 'boost', owner: 'left', pos: { x: 620, y: 150 }, angle: 0, untilTurn: 99 }];
      s.ball.pos = { x: 480, y: 150 };
      s.ball.vel = { x: 320, y: 0 };
      let maxX = 0;
      run(s, 30, 1000, () => { maxX = Math.max(maxX, s.ball.pos.x); });
      return maxX;
    };
    expect(runBall(true)).toBeGreaterThan(runBall(false) + 120);
  });

  it('launches a babble riding a ramp at full launch speed off the lip', () => {
    const s = setup();
    park(s, ['left-2']);
    const b = s.babbles.find(x => x.id === 'left-2')!;
    b.pos = { x: 470, y: 320 };
    b.vel = { x: 250, y: -40 };
    s.ball.pos = { x: 900, y: 100 };
    s.fieldObjects = [{ id: 'r1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    run(s, 6);
    expect(s.rampEvents.some(e => e.mover === 'babble' && e.moverId === 'left-2')).toBe(true);
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeGreaterThan(500); // visibly launched
  });

  it('ramps launch the ball through authoritative vertical state', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 470, y: 320 };
    s.ball.vel = { x: 250, y: -40 };
    s.fieldObjects = [{ id: 'r1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];

    run(s, 3);

    expect(s.rampEvents.some(e => e.mover === 'ball')).toBe(true);
    expect(s.ball.height).toBeGreaterThan(BALL_REST_HEIGHT + 0.2);
    expect(s.ball.verticalVelocity).toBeGreaterThan(0);
  });

  it('resets vertical ball state when the beach ball effect expires', () => {
    const s = setup();
    park(s);
    s.beachBallUntilTurn = s.turn;
    s.ball.radius = FIELD.ballRadius * 1.6;
    s.ball.height = 2.2;
    s.ball.verticalVelocity = -0.4;
    s.resolvingStartedAt = 1000 - MAX_RESOLVE_MS;

    stepGame(s, {}, 1033, seq([0.5]));

    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(s.ball.radius).toBe(FIELD.ballRadius);
    expect(s.ball.height).toBeCloseTo(BALL_REST_HEIGHT, 5);
    expect(s.ball.verticalVelocity).toBe(0);
  });

  it('makes the beach ball float farther than the regular ball', () => {
    const roll = (beachy: boolean) => {
      const s = setup();
      park(s);
      if (beachy) { s.beachBallUntilTurn = s.turn; s.ball.radius = FIELD.ballRadius * 1.6; }
      s.ball.pos = { x: 250, y: 310 };
      s.ball.vel = { x: 420, y: 0 };
      run(s, 45);
      return s.ball.pos.x;
    };
    expect(roll(true)).toBeGreaterThan(roll(false) + 40);
  });
});

describe('Rapier physics: settling and full matches', () => {
  it('settles a gentle turn back to planning with all velocities zeroed', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 400, y: 310 };
    b.vel = { x: 220, y: 40 };
    s.ball.pos = { x: 900, y: 100 };
    run(s, 300);
    expect(s.phase).toBe('planning');
    expect(s.turn).toBe(2);
    expect(s.ball.vel).toEqual({ x: 0, y: 0 });
    for (const babble of s.babbles) expect(babble.vel).toEqual({ x: 0, y: 0 });
  });

  it('completes a full 8-betabot scripted match with a goal', () => {
    const s = createInitialState('BOTS', 1);
    for (let i = 0; i < 4; i++) addPlayer(s, `l${i}`, `Left ${i}`, 'pigs', 'left');
    for (let i = 0; i < 4; i++) addPlayer(s, `r${i}`, `Right ${i}`, 'parrots', 'right');
    startGame(s, seq([0.5]));

    // Same policy as scripts/betabots-match.mjs chooseLaunch.
    const aim = (side: PlayerSide, babblePos: Vec, babbleId: string) => {
      const ball = s.ball.pos;
      const goal = side === 'left' ? { x: 1142, y: 310 } : { x: -42, y: 310 };
      if (side !== 'left') {
        const clearX = side === 'right' ? 970 : 130;
        const clearY = babblePos.y < 310 ? 92 : 528;
        return { babbleId, aimAngle: Math.atan2(clearY - babblePos.y, clearX - babblePos.x), impulse: 680 };
      }
      if (Math.abs(ball.x - 550) < 12 && Math.abs(ball.y - 310) < 12) {
        const impulse = babbleId.endsWith('2') || babbleId.endsWith('3') ? 900 : 620;
        return { babbleId, aimAngle: Math.atan2(310 - babblePos.y, 550 - babblePos.x), impulse };
      }
      const toGoal = { x: goal.x - ball.x, y: goal.y - ball.y };
      const len = Math.hypot(toGoal.x, toGoal.y) || 1;
      const contact = { x: ball.x - (toGoal.x / len) * 46, y: ball.y - (toGoal.y / len) * 46 };
      const near = Math.hypot(babblePos.x - ball.x, babblePos.y - ball.y) < 260;
      const target = near ? contact : { x: ball.x - (side === 'left' ? 120 : -120), y: ball.y + (babblePos.y < ball.y ? -70 : 70) };
      return { babbleId, aimAngle: Math.atan2(target.y - babblePos.y, target.x - babblePos.x), impulse: 900 };
    };

    let now = 1000;
    let guard = 0;
    while (s.phase !== 'finished' && guard++ < 40000) {
      if (s.phase === 'planning') {
        for (const p of Object.values(s.players)) {
          for (const babbleId of p.controlledBabbleIds) {
            const babble = s.babbles.find(b => b.id === babbleId)!;
            if (babble.lastLaunchedTurn === s.turn) continue;
            launchBabble(s, p.id, aim(p.side, babble.pos, babbleId), now);
          }
        }
      }
      now += 33;
      stepGame(s, {}, now, seq([0.31, 0.72, 0.5]));
    }
    expect(s.phase).toBe('finished');
    expect(s.score.left + s.score.right).toBeGreaterThanOrEqual(1);
  }, 30000);
});
