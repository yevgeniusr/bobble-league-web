# Original Game Log Insights Project

Source: `/Users/mac/Downloads/events4-2.json` (353 decoded records, orders 1056–1408).

## Evidence from original logs

- Original game state stores true 3D physics state for ball and athletes:
  - `CurPhysState.Position: [x, y, z]`
  - `CurPhysState.LinearVelocity: [x, y, z]`
  - `CurPhysState.AngularVelocity: [x, y, z]`
  - `CurPhysState.Rotation: [x, y, z, w]`
- Movement requests remain planar: `MoveVector: [x, ~0, z]` with norm near 1.
- Ball vertical height range in sample: resting ~0.49, max 2.66.
- Giant ball (`IsGiant`) is the most visible air/float case: height ~1.0–2.66.
- Athletes have smaller hops: resting ~0.49, rare max ~1.03.
- Match config in sample: first to 3, max 90 turns, 4 athletes per team.
- State tracks exact `GoalScoredThisTurn.LastTouchAthleteId`.
- Formations include `wall`, `option`, `zone`, `forward`, `slant`.
- Powers include `ramp`, `yellowcard`, `giantball`, `block`, `sticky`, `ghost`, `bumppadboost`, `redcard`, `boost`, `bighead`, `goalswap`.
- `redcard` is athlete-targeted; `yellowcard` appears in selection weights.

## Project goals

1. Make the clone feel closer to original by adding real airborne ball behavior (2.5D) without destabilizing current deterministic 2D field movement.
2. Make beach ball behave like original `giantball`: bigger, lofted, floatier, with clear shadow separation and landing.
3. Add subtle player/babble hop visuals/state for strong impacts while keeping players mostly grounded.
4. Add target parity features:
   - `wall` formation.
   - `redCard`/`yellowCard` powers.
   - exact last-touch babble/athlete tracking for goals/analytics.
   - alias target power names in analytics/debug payloads.
5. Add original-log comparison tooling/tests, checking observable ranges and schemas:
   - ball `height` max in beach/giant scenario approaches original max scale.
   - baseline ball rest height/floor state is stable.
   - player hops are much smaller than ball hops.
   - target power/formation names are represented.

## Implementation constraints

- Keep the authoritative network protocol backward compatible where possible.
- Avoid a full Rapier 3D migration in this sprint; implement 2.5D vertical state layered on top of the existing Rapier 2D field physics.
- Existing map/playtest changes (bigger ball, smaller players, Saturn, corner bumpers, XP env default) are baseline and must be preserved.
- Full validation required before deploy: `npm test`, `npm run build`, smokes for all maps, render/box/cheat checks, visual screenshot inspection, and original-log comparison script.
