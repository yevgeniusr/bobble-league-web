import { FIELD, Vec } from './types';

export const ARENA_WALL_HEIGHT = 5;
export const ARENA_WALL_THICKNESS = 20;
export const GOAL_COLLISION_CLEARANCE = FIELD.ballRadius;
export const GOAL_COLLISION_TOP = FIELD.goalY - GOAL_COLLISION_CLEARANCE;
export const GOAL_COLLISION_BOTTOM = FIELD.goalY + FIELD.goalHeight + GOAL_COLLISION_CLEARANCE;

export type ArenaSurfaceTone = 'frame' | 'leftGoal' | 'rightGoal';

export type ArenaRect = {
  id: string;
  center: Vec;
  halfSize: Vec;
};

export type ArenaBarrier = ArenaRect & {
  height: number;
  tone: ArenaSurfaceTone;
};

const rect = (id: string, minX: number, maxX: number, minY: number, maxY: number): ArenaRect => ({
  id,
  center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  halfSize: { x: (maxX - minX) / 2, y: (maxY - minY) / 2 }
});

const barrier = (
  id: string,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  tone: ArenaSurfaceTone = 'frame'
): ArenaBarrier => ({ ...rect(id, minX, maxX, minY, maxY), height: ARENA_WALL_HEIGHT, tone });

const t = ARENA_WALL_THICKNESS;
const goalBackLeft = -FIELD.goalDepth;
const goalBackRight = FIELD.width + FIELD.goalDepth;

// These rectangles are the complete solid arena. Both Rapier and Three.js
// consume them, so no reachable collision face can exist without a mesh.
export const ARENA_BARRIERS: readonly ArenaBarrier[] = [
  barrier('outer-top', goalBackLeft, goalBackRight, -t, 0),
  barrier('outer-bottom', goalBackLeft, goalBackRight, FIELD.height, FIELD.height + t),
  barrier('left-front-upper', -t, 0, 0, GOAL_COLLISION_TOP),
  barrier('left-front-lower', -t, 0, GOAL_COLLISION_BOTTOM, FIELD.height),
  barrier('right-front-upper', FIELD.width, FIELD.width + t, 0, GOAL_COLLISION_TOP),
  barrier('right-front-lower', FIELD.width, FIELD.width + t, GOAL_COLLISION_BOTTOM, FIELD.height),
  barrier('left-goal-back', goalBackLeft - t, goalBackLeft, GOAL_COLLISION_TOP, GOAL_COLLISION_BOTTOM, 'leftGoal'),
  barrier('right-goal-back', goalBackRight, goalBackRight + t, GOAL_COLLISION_TOP, GOAL_COLLISION_BOTTOM, 'rightGoal'),
  barrier('left-goal-upper', goalBackLeft, 0, GOAL_COLLISION_TOP - t, GOAL_COLLISION_TOP, 'leftGoal'),
  barrier('left-goal-lower', goalBackLeft, 0, GOAL_COLLISION_BOTTOM, GOAL_COLLISION_BOTTOM + t, 'leftGoal'),
  barrier('right-goal-upper', FIELD.width, goalBackRight, GOAL_COLLISION_TOP - t, GOAL_COLLISION_TOP, 'rightGoal'),
  barrier('right-goal-lower', FIELD.width, goalBackRight, GOAL_COLLISION_BOTTOM, GOAL_COLLISION_BOTTOM + t, 'rightGoal')
] as const;

export const ARENA_FLOORS: readonly ArenaRect[] = [
  rect('field', 0, FIELD.width, 0, FIELD.height),
  rect('left-goal-pocket', goalBackLeft, 0, GOAL_COLLISION_TOP, GOAL_COLLISION_BOTTOM),
  rect('right-goal-pocket', FIELD.width, goalBackRight, GOAL_COLLISION_TOP, GOAL_COLLISION_BOTTOM)
] as const;
