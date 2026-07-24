import { describe, expect, it, vi } from 'vitest';
import { updateLaunchDrag } from '../client/src/launchInput';

describe('held launch input', () => {
  it('submits the latest meaningful drag before pointer release', () => {
    const submit = vi.fn();
    const start = { x: 100, y: 100 };

    const first = updateLaunchDrag({ kind: 'launch', babbleId: 'left-1', start, current: start }, { x: 60, y: 100 }, submit);
    const latest = updateLaunchDrag(first, { x: 100, y: 40 }, submit);

    expect(submit).toHaveBeenNthCalledWith(1, {
      babbleId: 'left-1',
      aimAngle: 0,
      impulse: 240
    });
    expect(submit).toHaveBeenNthCalledWith(2, {
      babbleId: 'left-1',
      aimAngle: Math.PI / 2,
      impulse: 360
    });
    expect(latest.current).toEqual({ x: 100, y: 40 });
  });

  it('does not submit accidental clicks below the drag threshold', () => {
    const submit = vi.fn();
    const mode = { kind: 'launch' as const, babbleId: 'left-1', start: { x: 100, y: 100 }, current: { x: 100, y: 100 } };

    updateLaunchDrag(mode, { x: 96, y: 100 }, submit);

    expect(submit).not.toHaveBeenCalled();
  });
});
