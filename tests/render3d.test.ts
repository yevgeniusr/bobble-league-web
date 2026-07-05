import { describe, expect, it } from 'vitest';
import { BUMPERS, FIELD } from '../shared/types';
import { ballSpinToRotation, BUMPER_WORLD_POSITIONS, fieldToWorld, fieldRadiusToWorld, GOAL_COLORS, goalDisplayColors, worldToField } from '../client/src/render3d';

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

  it('swaps visible gate colours while Swap Goals is active', () => {
    expect(goalDisplayColors(false)).toEqual({ left: GOAL_COLORS.left, right: GOAL_COLORS.right });
    expect(goalDisplayColors(true)).toEqual({ left: GOAL_COLORS.right, right: GOAL_COLORS.left });
    expect(GOAL_COLORS.left).not.toBe(GOAL_COLORS.right);
  });
});
