import { describe, expect, it } from 'vitest';
import { FIELD } from '../shared/types';
import { fieldToWorld, fieldRadiusToWorld, worldToField } from '../client/src/render3d';

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
});
