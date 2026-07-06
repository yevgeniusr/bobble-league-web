import { describe, expect, it } from 'vitest';
import { BUMPERS, FIELD, RampEvent } from '../shared/types';
import { babbleGhosted, ballSpinToRotation, BUMPER_WORLD_POSITIONS, fieldToWorld, fieldRadiusToWorld, GHOST_OPACITY, GOAL_COLORS, goalDisplayColors, latestRampEvent, RAMP_HOP_SECONDS, rampHopOffset, ROLL_TELEPORT_FIELD_DIST, rollDelta, worldToField } from '../client/src/render3d';

describe('3D renderer coordinate mapping', () => {
  it('maps 2D game coordinates onto a centered XZ WebGL field and back', () => {
    expect(fieldToWorld({ x: FIELD.width / 2, y: FIELD.height / 2 })).toEqual({ x: 0, z: 0 });
    expect(fieldToWorld({ x: 0, y: 0 })).toEqual({ x: -FIELD.width / 100, z: -FIELD.height / 100 });
    expect(fieldToWorld({ x: FIELD.width, y: FIELD.height })).toEqual({ x: FIELD.width / 100, z: FIELD.height / 100 });
    expect(worldToField({ x: 0, z: 0 })).toEqual({ x: FIELD.width / 2, y: FIELD.height / 2 });
  });

  it('scales gameplay radii consistently into model units', () => {
    expect(fieldRadiusToWorld(50)).toBe(1);
  });

  it('renders all four corner bumpers at the physics collider positions', () => {
    expect(BUMPER_WORLD_POSITIONS).toHaveLength(4);
    BUMPER_WORLD_POSITIONS.forEach((w, i) => {
      expect(w).toEqual(fieldToWorld(BUMPERS[i]));
    });
    const quadrants = BUMPER_WORLD_POSITIONS.map(w => `${w.x < 0 ? 'L' : 'R'}${w.z < 0 ? 'T' : 'B'}`).sort();
    expect(quadrants).toEqual(['LB', 'LT', 'RB', 'RT']);
  });

  it('derives ball roll rotation from authoritative spin so it matches travel direction', () => {
    const rest = ballSpinToRotation({ x: 0, y: 0 });
    expect(rest.x).toBeCloseTo(0);
    expect(rest.z).toBeCloseTo(0);
    // travelling along +field-x rolls about world -z (forward roll to the right)
    const rollX = ballSpinToRotation({ x: 1.5, y: 0 });
    expect(rollX.x).toBeCloseTo(0);
    expect(rollX.z).toBeCloseTo(-1.5);
    // travelling along +field-y (world +z) rolls about world +x
    const rollY = ballSpinToRotation({ x: 0, y: 0.8 });
    expect(rollY.x).toBeCloseTo(0.8);
    expect(rollY.z).toBeCloseTo(0);
  });

  it('rolls the ball about the axis perpendicular to its actual travel delta', () => {
    const r = fieldRadiusToWorld(FIELD.ballRadius);
    // travelling +field-x: axis is world -z, angle = distance / radius
    const rollX = rollDelta({ x: 50, y: 0 }, r);
    expect(rollX.axis).toEqual({ x: 0, y: 0, z: -1 });
    expect(rollX.angle).toBeCloseTo(1 / r);
    // travelling +field-y (world +z): axis is world +x
    const rollY = rollDelta({ x: 0, y: 50 }, r);
    expect(rollY.axis.x).toBeCloseTo(1);
    expect(rollY.axis.y).toBeCloseTo(0);
    expect(rollY.axis.z).toBeCloseTo(0);
    expect(rollY.angle).toBeCloseTo(1 / r);
    // diagonal travel: axis normalized and perpendicular to the motion
    const diag = rollDelta({ x: 30, y: 40 }, r);
    expect(Math.hypot(diag.axis.x, diag.axis.y, diag.axis.z)).toBeCloseTo(1);
    expect(diag.axis.x * 30 + diag.axis.z * 40).toBeCloseTo(0); // axis ⟂ travel
    // no movement: no rotation
    expect(rollDelta({ x: 0, y: 0 }, r).angle).toBe(0);
    // goal resets / Move Ball teleports exceed the roll threshold
    expect(ROLL_TELEPORT_FIELD_DIST).toBeGreaterThan(100);
  });

  it('animates a parabolic ramp hop only within the hop window', () => {
    expect(rampHopOffset(-0.1)).toBe(0);
    expect(rampHopOffset(0)).toBeCloseTo(0);
    expect(rampHopOffset(RAMP_HOP_SECONDS / 2)).toBeGreaterThan(1);
    expect(rampHopOffset(RAMP_HOP_SECONDS)).toBeCloseTo(0);
    expect(rampHopOffset(RAMP_HOP_SECONDS + 0.1)).toBe(0);
  });

  it('finds the freshest ramp event for exactly the requested mover', () => {
    const now = 10000;
    const events: RampEvent[] = [
      { pos: { x: 1, y: 1 }, at: now - 100, mover: 'ball' },
      { pos: { x: 2, y: 2 }, at: now - 50, mover: 'babble', moverId: 'left-1' },
      { pos: { x: 3, y: 3 }, at: now - 60_000, mover: 'babble', moverId: 'left-2' } // stale
    ];
    expect(latestRampEvent(events, 'ball', undefined, now)?.pos).toEqual({ x: 1, y: 1 });
    expect(latestRampEvent(events, 'babble', 'left-1', now)?.pos).toEqual({ x: 2, y: 2 });
    expect(latestRampEvent(events, 'babble', 'left-2', now)).toBeNull();
    expect(latestRampEvent(events, 'babble', 'right-1', now)).toBeNull();
    expect(latestRampEvent(undefined, 'ball', undefined, now)).toBeNull();
  });

  it('renders ghosted babbles translucent only while the effect is active', () => {
    // ghosted babbles must be clearly see-through but still visible
    expect(GHOST_OPACITY).toBeGreaterThan(0.1);
    expect(GHOST_OPACITY).toBeLessThan(0.6);
    expect(babbleGhosted([{ type: 'ghosted', untilTurn: 3 }], 3)).toBe(true);
    expect(babbleGhosted([{ type: 'ghosted', untilTurn: 4 }], 3)).toBe(true);
    expect(babbleGhosted([{ type: 'ghosted', untilTurn: 2 }], 3)).toBe(false); // expired
    expect(babbleGhosted([{ type: 'bigHead', untilTurn: 9 }], 3)).toBe(false); // other effects
    expect(babbleGhosted([], 3)).toBe(false);
    expect(babbleGhosted(undefined, 3)).toBe(false);
  });

  it('swaps visible gate colours while Swap Goals is active', () => {
    expect(goalDisplayColors(false)).toEqual({ left: GOAL_COLORS.left, right: GOAL_COLORS.right });
    expect(goalDisplayColors(true)).toEqual({ left: GOAL_COLORS.right, right: GOAL_COLORS.left });
    expect(GOAL_COLORS.left).not.toBe(GOAL_COLORS.right);
  });
});
