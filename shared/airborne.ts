import { FIELD } from './types';
import type { Vec } from './types';

export const BALL_REST_HEIGHT = 0.5;
export const BALL_MAX_HEIGHT = 2.66;
export const BALL_GRAVITY = 5.4;
export const BEACH_BALL_GRAVITY = 2.35;
export const BALL_LANDING_BOUNCE = 0.34;
export const BEACH_BALL_LANDING_BOUNCE = 0.48;
export const BALL_LANDING_REST_VELOCITY = 0.42;
export const BEACH_BALL_ACTIVATION_VERTICAL_VELOCITY = 4.1;

const PX_PER_METER = 50;

export const BABBLE_REST_HEIGHT = 0.5;
export const BABBLE_MAX_HEIGHT = 1.03;
export const BABBLE_GRAVITY = 9.5;
export const BABBLE_LANDING_REST_VELOCITY = 0.35;
export const BABBLE_IMPACT_MAX_VERTICAL_VELOCITY = 2.15;

export type BallVerticalState = {
  height: number;
  verticalVelocity: number;
};

export type BallImpactObservation = {
  babbleId: string;
  side: 'left' | 'right';
  impactSpeed: number;
  normal: Vec;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finiteOr = (v: number | undefined, fallback: number) => Number.isFinite(v) ? v as number : fallback;

export function ballRestHeight(radius: number = FIELD.ballRadius): number {
  return BALL_REST_HEIGHT * clamp(radius / FIELD.ballRadius, 1, 2);
}

export function babbleRestHeight(radius: number = FIELD.babbleRadius): number {
  return Math.max(BABBLE_REST_HEIGHT, radius / PX_PER_METER);
}

export function ballGravity(beachy: boolean): number {
  return beachy ? BEACH_BALL_GRAVITY : BALL_GRAVITY;
}

export function ballLandingBounce(beachy: boolean): number {
  return beachy ? BEACH_BALL_LANDING_BOUNCE : BALL_LANDING_BOUNCE;
}

export function normalizeBallVertical(radius: number, height?: number, verticalVelocity?: number): BallVerticalState {
  const rest = ballRestHeight(radius);
  return {
    height: clamp(finiteOr(height, rest), rest, BALL_MAX_HEIGHT),
    verticalVelocity: finiteOr(verticalVelocity, 0)
  };
}

export function ballImpactLiftVelocity(impacts: readonly BallImpactObservation[], beachy: boolean): number {
  if (impacts.length === 0) return 0;
  const maxSpeed = Math.max(...impacts.map(i => i.impactSpeed));
  if (maxSpeed < 260) return 0;

  const normalized = clamp((maxSpeed - 260) / 760, 0, 1);
  // A measured full launch is ~16m/s (800px/s in our scale). The original
  // normal ball reaches roughly 0.90m from a 0.49m rest center, which needs
  // about 2.08m/s of vertical velocity under the observed 5.4m/s² gravity.
  const base = beachy
    ? 1.65 + normalized * 2.15
    : Math.min(2.08, 0.9 + normalized * 1.66);
  const multiBonus = Math.min(0.9, Math.max(0, impacts.length - 1) * (beachy ? 0.42 : 0.24));
  let oppositionBonus = 0;
  for (let i = 0; i < impacts.length; i++) {
    for (let j = i + 1; j < impacts.length; j++) {
      const dot = impacts[i].normal.x * impacts[j].normal.x + impacts[i].normal.y * impacts[j].normal.y;
      if (dot < -0.45) oppositionBonus = Math.max(oppositionBonus, beachy ? 0.78 : 0.42);
    }
  }
  return base + multiBonus + oppositionBonus;
}

export function integrateBallVertical(
  state: BallVerticalState,
  radius: number,
  dt: number,
  beachy: boolean
): BallVerticalState {
  const rest = ballRestHeight(radius);
  let height = clamp(finiteOr(state.height, rest), rest, BALL_MAX_HEIGHT);
  let verticalVelocity = finiteOr(state.verticalVelocity, 0);
  if (dt <= 0) return { height, verticalVelocity };

  verticalVelocity -= ballGravity(beachy) * dt;
  height += verticalVelocity * dt;

  if (height >= BALL_MAX_HEIGHT) {
    height = BALL_MAX_HEIGHT;
    if (verticalVelocity > 0) verticalVelocity = 0;
  }

  if (height <= rest) {
    height = rest;
    if (verticalVelocity < -BALL_LANDING_REST_VELOCITY) verticalVelocity = -verticalVelocity * ballLandingBounce(beachy);
    else verticalVelocity = 0;
  }

  return { height, verticalVelocity };
}

export function normalizeBabbleVertical(height?: number, verticalVelocity?: number, radius: number = FIELD.babbleRadius) {
  const rest = babbleRestHeight(radius);
  return {
    height: clamp(finiteOr(height, rest), rest, BABBLE_MAX_HEIGHT),
    verticalVelocity: finiteOr(verticalVelocity, 0)
  };
}

export function integrateBabbleVertical(height: number | undefined, verticalVelocity: number | undefined, dt: number, radius: number = FIELD.babbleRadius) {
  const rest = babbleRestHeight(radius);
  const normalized = normalizeBabbleVertical(height, verticalVelocity, radius);
  let h = normalized.height;
  let v = normalized.verticalVelocity;
  if (dt <= 0) return { height: h, verticalVelocity: v };
  v -= BABBLE_GRAVITY * dt;
  h += v * dt;
  if (h >= BABBLE_MAX_HEIGHT) {
    h = BABBLE_MAX_HEIGHT;
    if (v > 0) v = 0;
  }
  if (h <= rest) {
    h = rest;
    if (v < -BABBLE_LANDING_REST_VELOCITY) v = -v * 0.2;
    else v = 0;
  }
  return { height: h, verticalVelocity: v };
}
