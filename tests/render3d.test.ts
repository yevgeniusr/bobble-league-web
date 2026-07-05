import { describe, expect, it } from 'vitest';
import { BUMPERS, FIELD } from '../shared/types';
import { BUMPER_WORLD_POSITIONS, fieldToWorld, fieldRadiusToWorld, worldToField } from '../client/src/render3d';

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
});
