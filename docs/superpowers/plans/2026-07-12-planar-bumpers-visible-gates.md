# Planar Bumpers and Visible Gates

## Goal

Make bumper outcomes deterministic and competitive: normal bumpers add a strong planar impulse without lifting the ball, and super bumpers add exactly five times that impulse. Eliminate hidden arena collisions by deriving Rapier barriers and their Three.js meshes from one shared layout.

## Root Causes

- `shared/physics.ts` models bumpers as moving `roundCone` bodies. Their sloped normals convert the spring motor's energy into vertical velocity, while the independent motor/restitution settings do not produce a 5:1 power ratio.
- Arena colliders are hand-authored in `shared/physics.ts`, while rim and goal meshes are independently sized in `client/src/render3d.ts`. Near each goal, physical side-wall segments and pocket overhangs extend well beyond the visible rim/net geometry.

## Files

- Create `shared/arena.ts`: field-space barrier rectangles and common dimensions.
- Modify `shared/physics.ts`: consume shared barriers; replace spring cones with swept-circle planar reflection and one-shot acceleration.
- Modify `shared/physicsConfig.ts`: replace spring tuning with one normal planar impulse value; derive super power from the fixed 5x multiplier.
- Modify `shared/types.ts`: rename the obsolete map bumper restitution multiplier to a common bumper power multiplier.
- Modify `client/src/render3d.ts`: render every shared barrier rectangle as a solid rail plus cached outline, expose the bumper interaction height, and remove duplicate hand-sized rim pieces near goals.
- Modify `tests/game.test.ts`, `tests/physics.test.ts`, and `tests/render3d.test.ts`: cover planar force, 5x scaling, deterministic contacts, and render/collider parity.
- Modify `README.md`: document the new bumper tuning variable.

## TDD Sequence

1. Replace the trampoline assertions with a grounded hit test that requires strong outward planar speed and no positive vertical velocity.
2. Add a pure power-ratio assertion and integration probes using radius-adjusted contact positions.
3. Add shared arena-layout assertions proving all 12 required barriers are finite, non-overlapping with the playable goal mouth, and converted to render coordinates without independent dimensions.
4. Run the focused tests and confirm they fail for the current cone/motor and hand-sized rim implementation.
5. Implement the minimum physics and renderer changes, then rerun focused tests.

## Verification

- `npm test -- tests/game.test.ts tests/physics.test.ts tests/render3d.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- Start the local server and use Playwright at desktop and mobile sizes to inspect both goals, every wall transition, normal bumpers, and active super bumpers.
