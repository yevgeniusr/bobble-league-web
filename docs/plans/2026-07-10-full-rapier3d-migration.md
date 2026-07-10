# Full Rapier 3D Migration Plan

User goal: migrate Babble League from Rapier 2D + custom 2.5D vertical layer to full Rapier 3D so ball/player vertical motion, contacts, gravity, angular velocity, and airborne behavior align more closely with the original game logs in `/Users/mac/Downloads/events4-2.json`.

## Original-log target evidence

From `events4-2.json`:

- Ball and athletes have true 3D state:
  - `Position: [x, y, z]`
  - `LinearVelocity: [x, y, z]`
  - `AngularVelocity: [x, y, z]`
  - `Rotation: [x, y, z, w]`
- Movement requests are planar (`x/z`, vertical near zero), but collision response can produce vertical motion.
- Ball resting height is about `0.49–0.50` original units.
- Normal ball max height in sample is about `0.90`.
- Giant ball max height in sample is exactly about `2.66`.
- Athlete/player resting height is about `0.49–0.50`; max is about `1.03`, much smaller than giant ball.

## Migration requirements

1. Replace `@dimforge/rapier2d-deterministic-compat` physics core with Rapier 3D (`@dimforge/rapier3d-deterministic-compat` preferred; fallback `@dimforge/rapier3d-compat` only if deterministic package fails).
2. Keep the public GameState protocol mostly compatible:
   - existing `pos: {x,y}` remains the field plane position.
   - existing `vel: {x,y}` remains field-plane velocity.
   - existing `height`/`verticalVelocity` remain exposed, but become read/write projections of the Rapier 3D body `translation.y` / `linvel.y` rather than a separate custom integrator.
3. Use a consistent coordinate mapping:
   - field `pos.x` -> Rapier world `x`
   - field `pos.y` -> Rapier world `z`
   - `height` -> Rapier world `y`
4. World gravity should point down in `y`.
5. Ball and babbles should be sphere colliders. Ball should be allowed to roll/rotate; players may lock or damp rotation if needed but must still have true vertical contact.
6. Arena has floor + walls + deep goal-pocket side/back walls as 3D cuboids. Goal mouths are open to both ball and babbles so goalies can enter and push a near-line ball out from behind.
7. Blocks/ramps/boost/goo/bumpers must remain functional. Ramps should use true vertical launch/geometry/impulse rather than only fake height state. If ramp mesh collider is too risky, keep planar ramp trigger but apply real vertical velocity to the Rapier 3D body.
8. Bumpers should be 3D cylinder/ball/capsule-ish static colliders or equivalent with true impulse response.
9. Remove the separate custom `integrateAirborne` loop from gameplay once Rapier 3D owns vertical integration. Retain helper constants/functions only if they define target heights or comparison thresholds.
10. Tests and scripts must be updated:
   - test that flat ball rests at rest height with gravity/floor.
   - test impact lift comes from Rapier 3D vertical velocity/height.
   - test beach/giant ball reaches original-like max height (~2.66) and lands.
   - test players hop less than ball.
   - existing goal/wall/body/ghost/block/ramp/box tests pass.
   - `npm run compare:original` passes.
11. Renderer must still render based on `ball.height` and babble `height`; now those values come from physics.
12. Full validation gate before deploy:
   - `npm test`
   - `npm run build`
   - `npm run compare:original`
   - `BABBLE_MAP=stadium npm run smoke`
   - `BABBLE_MAP=moon npm run smoke`
   - `BABBLE_MAP=volcano npm run smoke`
   - `BABBLE_MAP=saturn npm run smoke`
   - `BABBLE_MAP=saturn npm run render-check`
   - `npm run box-check`
   - `node scripts/cheat-gate-check.mjs`
   - `node scripts/capture-hud.mjs`
13. Deploy only after green local validation; then verify live `/healthz`, bundle symbols, Betabots, multiplayer, and browser console.

## Safety/compat constraints

- Do not expose or commit secrets.
- Preserve current live features: Saturn, XP backend env integration, browser smoke hardening, red/yellow cards, wall formation, target power aliases, exact last-touch tracking.
- Keep cheating gated.
- Avoid breaking Socket.IO clients by renaming top-level GameState fields.
