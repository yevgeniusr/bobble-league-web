// Local physics tuning knobs for the authoritative server/test simulation.
//
// Units are field pixels and seconds unless noted. Defaults are intentionally
// controlled and heavier than the launch-day arcade tune: babbles and the ball
// move slower, while corner bumpers/mega bumpers are strong enough to feel like
// intentional playfield features instead of soft wall nudges.
//
// Server/test override examples:
//   BABBLE_BALL_DENSITY=0.86 npm run smoke
//
// Browser clients render server state only and do not import this module.
const envNumber = (name: string, fallback: number) => {
  const raw = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const PHYSICS_CONFIG = {
  babbleImpulseScale: envNumber('BABBLE_IMPULSE_SCALE', 1.1),
  settleSpeed: envNumber('BABBLE_SETTLE_SPEED', 24),
  // Bumpers add one deterministic planar delta-speed on contact. Super power
  // is derived from the normal value so the competitive 5x contract cannot
  // drift through a second tuning knob.
  bumperRestitution: envNumber('BABBLE_BUMPER_RESTITUTION', 0.98),
  bumperPlanarDeltaSpeed: envNumber('BABBLE_BUMPER_PLANAR_DELTA_SPEED', 400),
  superBumperPowerMultiplier: 5,

  boostPadAccel: envNumber('BABBLE_BOOST_PAD_ACCEL', 4300),

  // Rapier material tuning. Drag values are the legacy per-30Hz-tick decay
  // converted to continuous damping in shared/physics.ts.
  babbleDragPerTick: envNumber('BABBLE_DRAG_PER_TICK', 0.92),
  ballDragPerTick: envNumber('BABBLE_BALL_DRAG_PER_TICK', 0.94),
  beachBallDragPerTick: envNumber('BABBLE_BEACH_BALL_DRAG_PER_TICK', 0.97),
  babbleRestitution: envNumber('BABBLE_RESTITUTION', 0.66),
  ballRestitution: envNumber('BABBLE_BALL_RESTITUTION', 0.9),
  wallRestitution: envNumber('BABBLE_WALL_RESTITUTION', 0.87),
  blockRestitution: envNumber('BABBLE_BLOCK_RESTITUTION', 0.58),
  babbleDensity: envNumber('BABBLE_DENSITY', 1),
  ballDensityBase: envNumber('BABBLE_BALL_DENSITY', 0.7),
  giantBallMassScale: envNumber('BABBLE_GIANT_BALL_MASS_SCALE', 0.72)
} as const;
