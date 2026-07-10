// Focused tests for the Rapier 3D physics core (shared/physics.ts) as wired
// into the shared rules (shared/game.ts): goal scoring, wall/gate handling,
// body collisions, ghosting, blocks, boxes, ramps/boosts, settling, and a
// full 8-betabot scripted match completing by goal.
import { describe, expect, it } from 'vitest';
import { addPlayer, createInitialState, launchBabble, MAX_RESOLVE_MS, resetGame, startGame, stepGame } from '../shared/game';
import { clampMotorParameter, clampRestitution, stepPhysics } from '../shared/physics';
import { BUMPERS, FIELD, GameState, MapId, PlayerSide, Vec } from '../shared/types';
import { BALL_REST_HEIGHT, babbleRestHeight, ballRestHeight } from '../shared/airborne';

const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

function setup(mode: 1 | 3 = 3, mapId: MapId = 'stadium') {
  const s = createInitialState('PHYS', mode, mapId);
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
  it('keeps a partially crossed ball live so it can be cleared', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 8, y: FIELD.goalY + FIELD.goalHeight / 2 };
    s.ball.vel = { x: 0, y: 0 };
    stepGame(s, {}, 1033, seq([0.5]));
    expect(s.score).toEqual({ left: 0, right: 0 });
    expect(s.ball.pos.x).toBeLessThan(s.ball.radius);
  });

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
      s.ball.vel = { x: Math.cos(angle) * 1250, y: Math.sin(angle) * 1250 };
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

  it('lets babbleheads enter the open goal pocket and contains them at its back wall', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 90, y: FIELD.goalY + FIELD.goalHeight / 2 };
    b.vel = { x: -600, y: 0 };
    s.ball.pos = { x: 900, y: 100 };
    for (let i = 0; i < 40; i++) stepPhysics(s, 1 / 30);
    expect(b.pos.x).toBeLessThan(-b.radius);
    expect(b.pos.x).toBeGreaterThan(-FIELD.goalDepth - 2);
    expect(s.score).toEqual({ left: 0, right: 0 });
  });

  it('lets a goalie get behind a near-line ball and physically push it back out', () => {
    const s = setup();
    park(s, ['left-1']);
    const goalie = s.babbles.find(x => x.id === 'left-1')!;
    const mouthY = FIELD.goalY + FIELD.goalHeight / 2;
    goalie.pos = { x: -65, y: mouthY };
    goalie.vel = { x: 500, y: 0 };
    s.ball.pos = { x: 28, y: mouthY };
    s.ball.vel = { x: 0, y: 0 };
    for (let i = 0; i < 20; i++) stepPhysics(s, 1 / 30);
    expect(s.ball.pos.x).toBeGreaterThan(28);
    expect(s.ball.vel.x).toBeGreaterThan(0);
  });

  it('keeps the spaces above and below each goal mouth physically walled off', () => {
    for (const y of [FIELD.goalY - 35, FIELD.goalY + FIELD.goalHeight + 35]) {
      const s = setup();
      park(s, ['left-1']);
      const b = s.babbles.find(x => x.id === 'left-1')!;
      b.pos = { x: 70, y };
      b.vel = { x: -700, y: 0 };
      s.ball.pos = { x: 900, y: 100 };
      for (let i = 0; i < 30; i++) stepPhysics(s, 1 / 30);
      expect(b.pos.x).toBeGreaterThan(-2);
    }
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
    expect(s.ball.vel.x).toBeGreaterThan(240); // physical transfer from the lighter rolling base
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
    const ballR = ballRestHeight(s.ball.radius);
    const babbleR = b.radius / 50;
    const verticalOffset = ballRestHeight(s.ball.radius) - babbleR;
    const physicalContact = Math.sqrt((ballR + babbleR) ** 2 - verticalOffset ** 2) * 50 - 1;
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
  it('clamps hostile physical material and motor overrides to valid ranges', () => {
    expect(clampRestitution(-0.25)).toBe(0);
    expect(clampRestitution(0.75)).toBe(0.75);
    expect(clampRestitution(1.7)).toBe(1);
    expect(clampMotorParameter(-100)).toBe(0);
    expect(clampMotorParameter(1800)).toBe(1800);
  });
  it('replays authoritative rigid-body state tick-for-tick deterministically', () => {
    const make = () => {
      const s = setup(3, 'originalGlide');
      park(s, ['left-1', 'right-1']);
      const left = s.babbles.find(b => b.id === 'left-1')!;
      const right = s.babbles.find(b => b.id === 'right-1')!;
      left.pos = { x: 440, y: 290 }; left.vel = { x: 780, y: 120 };
      right.pos = { x: 660, y: 340 }; right.vel = { x: -720, y: -80 };
      s.ball.pos = { x: 550, y: 310 }; s.ball.vel = { x: 0, y: 0 };
      return s;
    };
    const a = make();
    const b = make();
    for (let i = 0; i < 120; i++) {
      stepPhysics(a, 1 / 30);
      stepPhysics(b, 1 / 30);
      expect({ ball: a.ball, babbles: a.babbles }).toEqual({ ball: b.ball, babbles: b.babbles });
    }
  });

  it('replays spring-motor bumper contacts deterministically', () => {
    const make = () => {
      const s = setup();
      park(s);
      s.ball.pos = { x: BUMPERS[0].x + 70, y: BUMPERS[0].y };
      s.ball.vel = { x: -420, y: 0 };
      return s;
    };
    const a = make();
    const b = make();
    for (let i = 0; i < 90; i++) {
      stepPhysics(a, 1 / 30);
      stepPhysics(b, 1 / 30);
      expect(a.ball).toEqual(b.ball);
    }
  });

  it('clears compressed bumper spring state at the turn boundary', () => {
    const resetProbe = (s: GameState) => {
      s.ball.pos = { x: BUMPERS[0].x + 70, y: BUMPERS[0].y };
      s.ball.vel = { x: -220, y: 0 };
      s.ball.height = ballRestHeight(s.ball.radius);
      s.ball.verticalVelocity = 0;
      s.ball.rotation = { x: 0, y: 0, z: 0, w: 1 };
      s.ball.angularVelocity = { x: 0, y: 0, z: 0 };
      s.ball.lastTouchedBy = null;
      s.ball.lastTouchedBabbleId = null;
      s.ball.lastTouchedPlayerId = null;
    };
    const carried = setup();
    park(carried);
    resetProbe(carried);
    for (let i = 0; i < 4; i++) stepPhysics(carried, 1 / 30); // compress the plunger
    carried.turn += 1;
    park(carried);
    resetProbe(carried);

    const fresh = setup();
    park(fresh);
    fresh.turn = carried.turn;
    resetProbe(fresh);
    for (let i = 0; i < 20; i++) {
      stepPhysics(carried, 1 / 30);
      stepPhysics(fresh, 1 / 30);
    }
    expect(carried.ball.pos.x).toBeCloseTo(fresh.ball.pos.x, 1);
    expect(carried.ball.pos.y).toBeCloseTo(fresh.ball.pos.y, 1);
    expect(carried.ball.vel.x).toBeCloseTo(fresh.ball.vel.x, 0);
    expect(carried.ball.vel.y).toBeCloseTo(fresh.ball.vel.y, 0);
    expect(carried.ball.height).toBeCloseTo(fresh.ball.height, 2);
  });

  it('clears compressed bumper state across reset and rematch at turn one', () => {
    const resetProbe = (s: GameState) => {
      park(s);
      s.phase = 'resolving';
      s.resolvingStartedAt = 1000;
      s.ball.pos = { x: BUMPERS[0].x + 70, y: BUMPERS[0].y };
      s.ball.vel = { x: -220, y: 0 };
      s.ball.height = ballRestHeight(s.ball.radius);
      s.ball.verticalVelocity = 0;
      s.ball.rotation = { x: 0, y: 0, z: 0, w: 1 };
      s.ball.angularVelocity = { x: 0, y: 0, z: 0 };
    };
    const rematch = setup();
    resetProbe(rematch);
    for (let i = 0; i < 4; i++) stepPhysics(rematch, 1 / 30);
    resetGame(rematch, 3, seq([0.5]));
    startGame(rematch, seq([0.5]));
    resetProbe(rematch);

    const fresh = setup();
    resetProbe(fresh);
    for (let i = 0; i < 20; i++) {
      stepPhysics(rematch, 1 / 30);
      stepPhysics(fresh, 1 / 30);
    }
    expect(rematch.ball.pos.x).toBeCloseTo(fresh.ball.pos.x, 1);
    expect(rematch.ball.pos.y).toBeCloseTo(fresh.ball.pos.y, 1);
    expect(rematch.ball.vel.x).toBeCloseTo(fresh.ball.vel.x, 0);
    expect(rematch.ball.vel.y).toBeCloseTo(fresh.ball.vel.y, 0);
  });

  it('safely synchronizes radius-only collider changes and expiry', () => {
    const s = setup();
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    stepPhysics(s, 1 / 30);
    b.radius = FIELD.babbleRadius * 1.45;
    for (let i = 0; i < 12; i++) stepPhysics(s, 1 / 30);
    expect(b.height).toBeGreaterThanOrEqual(babbleRestHeight(b.radius) - 0.03);
    expect([b.pos.x, b.pos.y, b.height, b.vel.x, b.vel.y, b.verticalVelocity].every(Number.isFinite)).toBe(true);
    b.radius = FIELD.babbleRadius;
    stepPhysics(s, 1 / 30);
    expect([b.pos.x, b.pos.y, b.height, b.vel.x, b.vel.y, b.verticalVelocity].every(Number.isFinite)).toBe(true);

    s.ball.radius = FIELD.ballRadius * 1.6;
    for (let i = 0; i < 12; i++) stepPhysics(s, 1 / 30);
    expect(s.ball.height).toBeGreaterThanOrEqual(ballRestHeight(s.ball.radius) - 0.03);
    s.ball.radius = FIELD.ballRadius;
    stepPhysics(s, 1 / 30);
    expect([s.ball.pos.x, s.ball.pos.y, s.ball.height, s.ball.vel.x, s.ball.vel.y, s.ball.verticalVelocity].every(Number.isFinite)).toBe(true);
  });

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

  it('projects Rapier ball quaternion and three-axis angular velocity into authoritative state', () => {
    const s = setup();
    park(s);
    const ball = s.ball as typeof s.ball & {
      rotation?: { x: number; y: number; z: number; w: number };
      angularVelocity?: { x: number; y: number; z: number };
    };
    ball.pos = { x: 550, y: 310 };
    ball.vel = { x: 200, y: -80 };
    ball.rotation = { x: 0, y: 0, z: 0, w: 1 };
    ball.angularVelocity = { x: 4, y: 7, z: -3 };

    stepPhysics(s, 1 / 30);

    expect(ball.rotation).toBeDefined();
    expect(Math.abs(ball.rotation!.x) + Math.abs(ball.rotation!.y) + Math.abs(ball.rotation!.z)).toBeGreaterThan(0.05);
    expect(ball.angularVelocity).toBeDefined();
    expect(Math.abs(ball.angularVelocity!.x)).toBeGreaterThan(1);
    expect(Math.abs(ball.angularVelocity!.y)).toBeGreaterThan(1);
    expect(Math.abs(ball.angularVelocity!.z)).toBeGreaterThan(1);
    expect(Math.hypot(ball.angularVelocity!.x, ball.angularVelocity!.y, ball.angularVelocity!.z)).toBeLessThan(Math.hypot(4, 7, -3));
  });

  it('produces original-range yaw and compound rotation from a glancing ball impact', () => {
    const s = setup(3, 'originalGlide');
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 480, y: 294 };
    b.vel = { x: 800, y: 0 };
    s.ball.pos = { x: 550, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    let maxYaw = 0;
    let maxAngularSpeed = 0;
    let maxRotationVector = 0;

    run(s, 12, 1000, () => {
      const a = s.ball.angularVelocity!;
      const q = s.ball.rotation!;
      maxYaw = Math.max(maxYaw, Math.abs(a.y));
      maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(a.x, a.y, a.z));
      maxRotationVector = Math.max(maxRotationVector, Math.hypot(q.x, q.y, q.z));
    });

    // Original capture: total angular p95 7.41rad/s, yaw p99 7.23rad/s,
    // yaw maximum 9.55rad/s. This glancing shot should land in that active range.
    expect(maxAngularSpeed).toBeGreaterThan(5);
    expect(maxAngularSpeed).toBeLessThan(10);
    expect(maxYaw).toBeGreaterThan(5);
    expect(maxYaw).toBeLessThan(10);
    expect(maxRotationVector).toBeGreaterThan(0.1);
  });

  it('physically bounces after landing and keeps the resolving phase alive', () => {
    const s = setup(3, 'originalGlide');
    park(s);
    s.ball.pos = { x: 550, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    s.ball.height = 1.2;
    s.ball.verticalVelocity = -1;
    let bounceCount = 0;
    let previousVy = s.ball.verticalVelocity;

    for (let i = 1; i <= 40 && s.phase === 'resolving'; i++) {
      stepGame(s, {}, 1000 + i * 33, seq([0.5]));
      if (previousVy <= 0 && s.ball.verticalVelocity > 0.2) bounceCount++;
      previousVy = s.ball.verticalVelocity;
      if (bounceCount >= 2) break;
    }

    expect(bounceCount).toBeGreaterThanOrEqual(2);
    expect(s.phase).toBe('resolving');
    expect(s.ball.height).toBeGreaterThan(ballRestHeight(s.ball.radius) - 0.02);
  });

  it('uses one physical damping coefficient in air and on the floor without creating speed', () => {
    const speedAfter = (airborne: boolean) => {
      const s = setup(3, 'originalGlide');
      park(s);
      s.ball.pos = { x: 550, y: 310 };
      s.ball.vel = { x: 400, y: 0 };
      s.ball.height = ballRestHeight(s.ball.radius) + (airborne ? 0.7 : 0);
      s.ball.verticalVelocity = 0;
      for (let i = 0; i < 10; i++) stepPhysics(s, 1 / 30);
      return Math.hypot(s.ball.vel.x, s.ball.vel.y);
    };

    const grounded = speedAfter(false);
    const airborne = speedAfter(true);
    expect(airborne).toBeGreaterThan(300);
    expect(airborne).toBeLessThan(400);
    expect(grounded).toBeGreaterThan(0);
    expect(grounded).toBeLessThanOrEqual(400);
  });

  it('does not clamp rigid bodies to scripted normal or Giant Ball height ceilings', () => {
    const runHigh = (giant: boolean) => {
      const s = setup();
      park(s);
      if (giant) { s.beachBallUntilTurn = s.turn; s.ball.radius = FIELD.ballRadius * 1.6; }
      s.ball.pos = { x: 550, y: 310 };
      s.ball.vel = { x: 0, y: 0 };
      s.ball.height = 1.19;
      s.ball.verticalVelocity = 3;
      stepPhysics(s, 1 / 30);
      return s.ball.height;
    };

    expect(runHigh(false)).toBeGreaterThan(1.2);
    expect(runHigh(true)).toBeGreaterThan(1.2);
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

    expect(b.height).toBeCloseTo(restHeight, 2);
    expect(b.verticalVelocity).toBeCloseTo(0, 2);
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

  it('makes a full-strength Original B impact reach the observed normal-ball jump peak', () => {
    const s = setup(3, 'originalGlide');
    park(s, ['left-1']);
    const b = s.babbles.find(x => x.id === 'left-1')!;
    b.pos = { x: 500, y: 310 };
    b.vel = { x: 800, y: 0 };
    s.ball.pos = { x: 550, y: 310 };
    s.ball.vel = { x: 0, y: 0 };
    let maxHeight = s.ball.height;

    run(s, 30, 1000, () => { maxHeight = Math.max(maxHeight, s.ball.height); });

    expect(maxHeight).toBeGreaterThanOrEqual(0.84);
    expect(maxHeight).toBeLessThanOrEqual(0.98);
  });

  it('resolves opposing multi-direction impacts without scripted lift bonuses', () => {
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

    const single = maxLift(false);
    const opposed = maxLift(true);
    expect(single).toBeGreaterThan(BALL_REST_HEIGHT);
    expect(opposed).toBeGreaterThan(BALL_REST_HEIGHT);
    expect(opposed).not.toBeCloseTo(single, 3);
  });

  it('lets beach ball impacts pop much higher and float longer than normal impacts', () => {
    const runImpact = (beachy: boolean) => {
      const s = setup();
      park(s, ['left-1', 'right-1']);
      const b = s.babbles.find(x => x.id === 'left-1')!;
      const opposing = s.babbles.find(x => x.id === 'right-1')!;
      if (beachy) {
        s.beachBallUntilTurn = s.turn;
        s.ball.radius = FIELD.ballRadius * 1.6;
        s.ball.height = ballRestHeight(s.ball.radius);
      }
      b.pos = { x: 410, y: 150 };
      b.vel = { x: 1050, y: 0 };
      opposing.pos = { x: 520, y: 150 };
      opposing.vel = { x: -1050, y: 0 };
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
    expect(normal.maxHeight).toBeLessThan(2);
    expect(beachy.maxHeight).toBeGreaterThan(normal.maxHeight + 0.5);
    expect(beachy.maxHeight).toBeGreaterThan(1.8);
    expect(beachy.airborneTicks).toBeGreaterThan(normal.airborneTicks);
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

  it('stops applying Boost force immediately after the pad expires', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 550, y: 150 };
    s.ball.vel = { x: 0, y: 0 };
    s.fieldObjects = [{ id: 'boost', type: 'boost', owner: 'left', pos: { x: 550, y: 150 }, angle: 0, untilTurn: 99 }];
    stepPhysics(s, 1 / 30);
    const boosted = s.ball.vel.x;
    expect(boosted).toBeGreaterThan(0);
    s.fieldObjects = [];
    stepPhysics(s, 1 / 30);
    expect(s.ball.vel.x).toBeLessThan(boosted);
  });

  it('keeps rendered and physical ramp facing aligned at rotated angles', () => {
    const run = (angle: number) => {
      const s = setup();
      park(s, ['left-2']);
      const b = s.babbles.find(x => x.id === 'left-2')!;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      b.pos = { x: 550 - dir.x * 75, y: 310 - dir.y * 75 };
      b.vel = { x: dir.x * 190, y: dir.y * 190 };
      s.fieldObjects = [{ id: `ramp-${angle}`, type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle, untilTurn: 99 }];
      let maxHeight = b.height;
      for (let i = 0; i < 14; i++) {
        stepPhysics(s, 1 / 30);
        maxHeight = Math.max(maxHeight, b.height);
      }
      const progress = (b.pos.x - (550 - dir.x * 75)) * dir.x + (b.pos.y - (310 - dir.y * 75)) * dir.y;
      return { maxHeight, progress, rest: babbleRestHeight(b.radius) };
    };
    for (const angle of [Math.PI / 2, -Math.PI / 4]) {
      const result = run(angle);
      expect(result.maxHeight).toBeGreaterThan(result.rest + 0.06);
      expect(result.progress).toBeGreaterThan(15);
    }
  });

  it('converts a babble’s incoming momentum into physical ramp elevation without boosting speed', () => {
    const s = setup();
    park(s, ['left-2']);
    const b = s.babbles.find(x => x.id === 'left-2')!;
    b.pos = { x: 470, y: 320 };
    b.vel = { x: 250, y: -40 };
    const incoming = Math.hypot(b.vel.x, b.vel.y);
    s.ball.pos = { x: 900, y: 100 };
    s.fieldObjects = [{ id: 'r1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    let maxHeight = b.height;
    let maxPlanarSpeed = incoming;
    run(s, 12, 1000, () => {
      maxHeight = Math.max(maxHeight, b.height);
      maxPlanarSpeed = Math.max(maxPlanarSpeed, Math.hypot(b.vel.x, b.vel.y));
    });
    expect(s.rampEvents.some(e => e.mover === 'babble' && e.moverId === 'left-2')).toBe(true);
    expect(maxHeight).toBeGreaterThan(babbleRestHeight(b.radius) + 0.05);
    expect(maxPlanarSpeed).toBeLessThan(incoming * 1.08);
  });

  it('ramps lift the ball through authoritative Rapier vertical state only', () => {
    const s = setup();
    park(s);
    s.ball.pos = { x: 470, y: 320 };
    s.ball.vel = { x: 250, y: -40 };
    const incoming = Math.hypot(s.ball.vel.x, s.ball.vel.y);
    s.fieldObjects = [{ id: 'r1', type: 'ramp', owner: 'left', pos: { x: 550, y: 310 }, angle: 0, untilTurn: 99 }];
    let maxHeight = s.ball.height;
    let maxPlanarSpeed = incoming;
    run(s, 12, 1000, () => {
      maxHeight = Math.max(maxHeight, s.ball.height);
      maxPlanarSpeed = Math.max(maxPlanarSpeed, Math.hypot(s.ball.vel.x, s.ball.vel.y));
    });

    expect(s.rampEvents.some(e => e.mover === 'ball')).toBe(true);
    expect(maxHeight).toBeGreaterThan(BALL_REST_HEIGHT + 0.05);
    expect(maxPlanarSpeed).toBeLessThan(incoming * 1.08);
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
