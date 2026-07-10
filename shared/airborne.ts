import { FIELD } from './types';


export const BALL_REST_HEIGHT = 0.5;

const PX_PER_METER = 50;

export const BABBLE_REST_HEIGHT = 0.5;
export const BABBLE_GRAVITY = 9.5;

export type BallVerticalState = {
  height: number;
  verticalVelocity: number;
};


const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: number | undefined, fallback: number) => Number.isFinite(v) ? v as number : fallback;

export function ballRestHeight(radius: number = FIELD.ballRadius): number {
  return BALL_REST_HEIGHT * clamp(radius / FIELD.ballRadius, 1, 2);
}

export function babbleRestHeight(radius: number = FIELD.babbleRadius): number {
  return Math.max(BABBLE_REST_HEIGHT, radius / PX_PER_METER);
}

export function normalizeBallVertical(radius: number, height?: number, verticalVelocity?: number): BallVerticalState {
  const rest = ballRestHeight(radius);
  return {
    height: finiteOr(height, rest),
    verticalVelocity: finiteOr(verticalVelocity, 0)
  };
}

export function normalizeBabbleVertical(height?: number, verticalVelocity?: number, radius: number = FIELD.babbleRadius) {
  const rest = babbleRestHeight(radius);
  return {
    height: finiteOr(height, rest),
    verticalVelocity: finiteOr(verticalVelocity, 0)
  };
}
