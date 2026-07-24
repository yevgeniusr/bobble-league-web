import type { TurnIntent, Vec } from '../../shared/types';

export type LaunchDrag = {
  kind: 'launch';
  babbleId: string;
  start: Vec;
  current: Vec;
};

export function launchIntentForDrag(mode: LaunchDrag): TurnIntent | null {
  const dx = mode.start.x - mode.current.x;
  const dy = mode.start.y - mode.current.y;
  const pull = Math.hypot(dx, dy);
  if (pull < 8) return null;
  return {
    babbleId: mode.babbleId,
    aimAngle: Math.atan2(dy, dx),
    impulse: Math.min(900, Math.max(1, pull * 6))
  };
}

export function updateLaunchDrag(mode: LaunchDrag, current: Vec, submit: (intent: TurnIntent) => void): LaunchDrag {
  const next = { ...mode, current };
  const intent = launchIntentForDrag(next);
  if (intent) submit(intent);
  return next;
}
