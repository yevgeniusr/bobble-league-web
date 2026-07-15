import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUMPERS, FIELD, MAPS, MAP_IDS, TEAM_IDS } from '../shared/types';
import { ARENA_BARRIER_SCREEN_PRIMITIVE, ARENA_FRAME_SCREEN_OPACITY, ARENA_GOAL_SCREEN_OPACITY, arenaBarrierScreenObject, arenaBarrierVisualProfile, arenaBarrierWorldLayout, arenaCameraFitEnvelope, arenaFloorWorldLayout, arenaSkylineLayout, arenaSkylinePositions, authoritativeBallQuaternion, ballRenderElevation, ballVisualProfile, babbleContactBaseMetrics, babbleContactShadowRadius, babbleGhosted, babbleIndicatorRingRadius, ballSpinToRotation, BUMPER_WORLD_POSITIONS, bumperColliderVisualProfile, bumperVisualFootprint, bumperVisualRadii, cameraLayoutForViewport, fieldToWorld, fieldRadiusToWorld, GHOST_OPACITY, GOAL_COLORS, goalDisplayColors, goalVisualMetrics, mapBumperWorldPositions, resourcePylonLayout, resourcePylonPositions, robotVisualProfile, ROLL_TELEPORT_FIELD_DIST, rollDelta, worldToField } from '../client/src/render3d';
import { ARENA_WALL_HEIGHT } from '../shared/arena';
import { BALL_REST_HEIGHT } from '../shared/airborne';

function playableEnvelope(): THREE.Vector3[] {
  return arenaCameraFitEnvelope();
}

function projectedEnvelope(width: number, height: number): THREE.Vector3[] {
  const layout = cameraLayoutForViewport(width, height);
  const camera = new THREE.PerspectiveCamera(layout.fov, width / height, 0.1, 200);
  camera.position.set(layout.position.x, layout.position.y, layout.position.z);
  camera.lookAt(layout.target.x, layout.target.y, layout.target.z);
  camera.updateMatrixWorld();
  return playableEnvelope().map(point => point.project(camera));
}

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

  it('uses tighter broadcast framing while fitting the playable court', () => {
    const layout = cameraLayoutForViewport(1600, 900);
    expect(layout.fov).toBe(42);
    expect(layout.target).toEqual({ x: 0, y: 0.4, z: 0 });
    expect(layout.position.y).toBeLessThan(24);
    expect(layout.position.z).toBeLessThan(12);
  });

  it.each([
    ['16:9 desktop', 1600, 900, 0.98],
    ['16:10 desktop', 1440, 900, 0.98],
    ['4:3 tablet', 1024, 768, 0.98],
    ['square', 844, 844, 0.98],
    ['portrait', 390, 844, 0.98]
  ])('frames the complete field and goals at %s', (_label, width, height, maxHorizontalNdc) => {
    for (const projected of projectedEnvelope(width, height)) {
      expect(Math.abs(projected.x)).toBeLessThanOrEqual(maxHorizontalNdc);
      expect(Math.abs(projected.y)).toBeLessThanOrEqual(0.9);
    }
  });

  it.each([
    ['the 16:10 fit threshold', 1599, 1601, 1000],
    ['the square aspect ratio', 990, 1010, 1000]
  ])('changes continuously across %s', (_label, narrowerWidth, widerWidth, height) => {
    const narrower = cameraLayoutForViewport(narrowerWidth, height);
    const wider = cameraLayoutForViewport(widerWidth, height);

    expect(Math.abs(narrower.fov - wider.fov)).toBeLessThan(1);
    expect(Math.abs(narrower.position.y - wider.position.y)).toBeLessThan(0.5);
    expect(Math.abs(narrower.position.z - wider.position.z)).toBeLessThan(0.5);
  });

  it('renders all four corner bumpers at the physics collider positions', () => {
    expect(BUMPER_WORLD_POSITIONS).toHaveLength(4);
    BUMPER_WORLD_POSITIONS.forEach((w, i) => {
      expect(w).toEqual(fieldToWorld(BUMPERS[i]));
    });
    const quadrants = BUMPER_WORLD_POSITIONS.map(w => `${w.x < 0 ? 'L' : 'R'}${w.z < 0 ? 'T' : 'B'}`).sort();
    expect(quadrants).toEqual(['LB', 'LT', 'RB', 'RT']);
  });

  it('maps every selectable map bumper layout from shared config', () => {
    for (const mapId of MAP_IDS) {
      const positions = mapBumperWorldPositions(mapId);
      expect(positions).toHaveLength(MAPS[mapId].layout.bumpers.length);
      positions.forEach((w, i) => expect(w).toEqual(fieldToWorld(MAPS[mapId].layout.bumpers[i])));
    }
    expect(mapBumperWorldPositions('moon')).not.toEqual(BUMPER_WORLD_POSITIONS);
    expect(mapBumperWorldPositions('volcano')).not.toEqual(BUMPER_WORLD_POSITIONS);
  });

  it('does not render decorative skyline geometry outside the playable field', () => {
    expect(arenaSkylineLayout()).toEqual([]);
    expect(arenaSkylinePositions()).toEqual([]);
  });

  it('does not render decorative resource pylons outside the playable field', () => {
    expect(resourcePylonLayout()).toEqual([]);
    expect(resourcePylonPositions()).toEqual([]);
  });

  it('uses four visibly different robot silhouettes and generated surface maps', () => {
    const profiles = TEAM_IDS.map(robotVisualProfile);
    expect(new Set(profiles.map(profile => profile.shape)).size).toBe(4);
    expect(new Set(profiles.map(profile => profile.texture)).size).toBe(4);
    expect(new Set(profiles.map(profile => `${profile.width}:${profile.depth}:${profile.height}`)).size).toBe(4);
  });

  it('keeps babble contact shadows and control rings close to the real babble radius', () => {
    const radius = fieldRadiusToWorld(FIELD.babbleRadius);
    const base = babbleContactBaseMetrics(FIELD.babbleRadius);
    expect(base.radius).toBeCloseTo(radius);
    expect(base.topRadius).toBeLessThanOrEqual(base.radius);
    expect(base.height).toBeLessThanOrEqual(0.18);

    const shadow = babbleContactShadowRadius(FIELD.babbleRadius);
    expect(shadow).toBeGreaterThan(radius);
    expect(shadow).toBeLessThanOrEqual(radius * 1.22);

    const controlRing = babbleIndicatorRingRadius(FIELD.babbleRadius, 'control');
    const targetRing = babbleIndicatorRingRadius(FIELD.babbleRadius, 'target');
    expect(controlRing).toBeGreaterThan(radius);
    expect(controlRing).toBeLessThanOrEqual(radius + 0.26);
    expect(targetRing).toBeGreaterThan(controlRing);
    expect(targetRing).toBeLessThanOrEqual(radius + 0.42);
  });

  it('derives normal and big bumper visuals from each map collider radius', () => {
    for (const mapId of MAP_IDS) {
      const normal = bumperVisualRadii(mapId, false);
      const big = bumperVisualRadii(mapId, true);
      expect(normal.collider).toBeCloseTo(fieldRadiusToWorld(MAPS[mapId].layout.bumperRadius));
      expect(big.collider).toBeCloseTo(fieldRadiusToWorld(MAPS[mapId].layout.bigBumperRadius));
      expect(normal.energyRing).toBeCloseTo(normal.collider);
      expect(big.energyRing).toBeCloseTo(big.collider);
      const footprint = bumperVisualFootprint(mapId);
      expect(footprint.rectangularPlateLongestSide).toBe(0);
      expect(footprint.maxRoundBaseRadius).toBeLessThanOrEqual(normal.collider + 0.12);
      expect(normal.drum).toBeGreaterThanOrEqual(normal.collider * 0.88);
      expect(normal.drum).toBeLessThanOrEqual(normal.collider * 1.04);
      expect(big.drum).toBeGreaterThanOrEqual(big.collider * 0.88);
      expect(big.drum).toBeLessThanOrEqual(big.collider * 1.04);
      expect(normal.socket).toBeLessThanOrEqual(normal.collider + 0.22);
      expect(big.socket).toBeLessThanOrEqual(big.collider + 0.24);
      expect(bumperColliderVisualProfile(mapId, false)).toEqual({
        radius: normal.collider,
        height: ARENA_WALL_HEIGHT,
        wireframe: true
      });
      expect(bumperColliderVisualProfile(mapId, true)).toEqual({
        radius: big.collider,
        height: ARENA_WALL_HEIGHT,
        wireframe: true
      });
    }
  });

  it('derives rectangular goal visuals from the authoritative goal mouth and depth', () => {
    const metrics = goalVisualMetrics();
    expect(metrics.leftGoalLineX).toBeCloseTo(-FIELD.width / 100);
    expect(metrics.rightGoalLineX).toBeCloseTo(FIELD.width / 100);
    expect(metrics.mouthTopZ).toBeCloseTo(fieldToWorld({ x: 0, y: FIELD.goalY }).z);
    expect(metrics.mouthBottomZ).toBeCloseTo(fieldToWorld({ x: 0, y: FIELD.goalY + FIELD.goalHeight }).z);
    expect(metrics.mouthHalfHeight).toBeCloseTo(fieldRadiusToWorld(FIELD.goalHeight) / 2);
    expect(metrics.depth).toBeCloseTo(fieldRadiusToWorld(FIELD.goalDepth));
    expect(metrics.pocketFloorDepth).toBeCloseTo(metrics.depth);
    expect(metrics.collisionTopZ).toBeCloseTo(fieldToWorld({ x: 0, y: FIELD.goalY - FIELD.ballRadius }).z);
    expect(metrics.collisionBottomZ).toBeCloseTo(fieldToWorld({ x: 0, y: FIELD.goalY + FIELD.goalHeight + FIELD.ballRadius }).z);
    expect(metrics.pocketFloorWidth).toBeCloseTo(fieldRadiusToWorld(FIELD.goalHeight + FIELD.ballRadius * 2));
    expect(metrics.sideWallLength).toBeCloseTo(metrics.depth);
  });

  it('exposes a visible world-space surface for every authoritative arena barrier', () => {
    const barriers = arenaBarrierWorldLayout();
    const floors = arenaFloorWorldLayout();
    expect(barriers).toHaveLength(12);
    expect(new Set(barriers.map(barrier => barrier.id)).size).toBe(barriers.length);
    expect(floors.map(floor => floor.id).sort()).toEqual(['field', 'left-goal-pocket', 'right-goal-pocket']);
    for (const barrier of barriers) {
      expect([barrier.x, barrier.z, barrier.width, barrier.depth, barrier.height].every(Number.isFinite)).toBe(true);
      expect(barrier.width).toBeGreaterThan(0);
      expect(barrier.depth).toBeGreaterThan(0);
      expect(barrier.height).toBe(5);
    }

    const leftUpperPocket = barriers.find(barrier => barrier.id === 'left-goal-upper')!;
    expect(leftUpperPocket.width).toBeCloseTo(fieldRadiusToWorld(FIELD.goalDepth));
    expect(leftUpperPocket.z + leftUpperPocket.depth / 2).toBeCloseTo(fieldToWorld({ x: 0, y: FIELD.goalY - FIELD.ballRadius }).z);
    expect(ARENA_BARRIER_SCREEN_PRIMITIVE).toBe('lineSegments');
    expect(ARENA_FRAME_SCREEN_OPACITY).toBeGreaterThanOrEqual(0.1);
    expect(ARENA_GOAL_SCREEN_OPACITY).toBeGreaterThanOrEqual(ARENA_FRAME_SCREEN_OPACITY);
    for (const barrier of barriers) {
      expect(arenaBarrierVisualProfile(barrier)).toEqual({
        baseHeight: 0.36,
        screenHeight: 1.14,
        primitive: 'lineSegments'
      });
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    const material = new THREE.LineBasicMaterial();
    const screen = arenaBarrierScreenObject(geometry, material, ARENA_BARRIER_SCREEN_PRIMITIVE);
    expect(screen).toBeInstanceOf(THREE.LineSegments);
    expect(screen).not.toBeInstanceOf(THREE.Mesh);
    geometry.dispose();
    material.dispose();
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

  it('normalizes authoritative Rapier ball quaternions for full three-axis rendering', () => {
    const q = authoritativeBallQuaternion({ rotation: { x: 1, y: 2, z: 3, w: 4 } });
    expect(q).not.toBeNull();
    expect(Math.hypot(q!.x, q!.y, q!.z, q!.w)).toBeCloseTo(1, 6);
    expect(q!.x).not.toBe(0);
    expect(q!.y).not.toBe(0); // yaw/twist from glancing impacts is preserved
    expect(q!.z).not.toBe(0);
    expect(authoritativeBallQuaternion({ rotation: { x: Number.NaN, y: 0, z: 0, w: 1 } })).toBeNull();
    expect(authoritativeBallQuaternion({ rotation: { x: 0, y: 0, z: 0, w: 0 } })).toBeNull();
    expect(authoritativeBallQuaternion({})).toBeNull();
  });

  it('uses a single textured ball surface and never doubles real and blob shadows', () => {
    expect(ballVisualProfile(false)).toEqual({
      surface: 'proceduralTexture',
      geometricPatches: false,
      seamRings: false,
      blobShadow: false
    });
    expect(ballVisualProfile(true).blobShadow).toBe(true);
  });

  it('renders elevated balls above a turf-anchored shadow', () => {
    const rest = ballRenderElevation({ radius: FIELD.ballRadius, height: BALL_REST_HEIGHT });
    const high = ballRenderElevation({ radius: FIELD.ballRadius, height: BALL_REST_HEIGHT + 1.1 });

    expect(rest.centerYAboveTurf).toBeCloseTo(BALL_REST_HEIGHT);
    expect(rest.shadowYAboveTurf).toBeLessThan(0.04);
    expect(high.centerYAboveTurf).toBeGreaterThan(rest.centerYAboveTurf + 1);
    expect(high.shadowYAboveTurf).toBe(rest.shadowYAboveTurf);
    expect(high.shadowOpacity).toBeLessThan(rest.shadowOpacity);
    expect(high.shadowRadius).toBeGreaterThan(rest.shadowRadius);
  });

  it('renders arbitrary authoritative Rapier height without a visual ceiling', () => {
    const beach = ballRenderElevation({ radius: FIELD.ballRadius * 1.6, height: 3.4 });

    expect(beach.centerYAboveTurf).toBeCloseTo(3.4);
    expect(beach.shadowRadius).toBeGreaterThan(fieldRadiusToWorld(FIELD.ballRadius * 1.6));
    expect(beach.shadowOpacity).toBeLessThan(0.1);
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
