# Original Physics Candidate Maps

Source evidence: `/Users/mac/Downloads/events4-2.json` (353 records, 135 authoritative snapshots, original turns 22–28).

The telemetry strongly identifies launch speed, drag, vertical ranges, planning time, and typical resolve duration. It does not uniquely identify restitution, density, bumper forces, or ramp material values. The three maps share Stadium geometry so playtest differences come from physics rather than layout.

## Observed targets

- Full athlete launch: `16.0 m/s` in 40/48 moving launches → approximately `800 px/s` at `50 px/m`.
- High-speed athlete drag: `0.971–0.974` retained per 30 Hz tick.
- Mid/low-speed athlete retention: `0.950–0.962`. The clone represents this with Rapier damping plus floor friction; there is no low-speed brake.
- Normal-ball drag proxy: `0.982–0.995`; central estimate `0.990`.
- Beach-ball drag target: approximately `0.994–0.995`.
- Ball rest height: `0.49–0.50 m`.
- Normal-ball maximum observed height: `~0.90 m`; the clone's full Original B impact reaches the same range from the physical offset between the bobblehead rolling-base collider and the larger ball. There is no impact-lift formula or height ceiling.
- Landing and repeated bounce arcs are solved by Rapier floor contact, collider restitution, friction, gravity, and damping. No landing-velocity rewrite exists.
- Each rigid body has one physical damping coefficient in air and on the floor. Floor friction/contact naturally changes grounded carry; there is no airborne branch or speed creation.
- Ball angular speed is genuinely 3D: captured maximum `20.55 rad/s`, with X/Y/Z component maxima `15.39 / 9.55 / 12.87 rad/s`; using the analyzer’s `floor(n × p)` percentile definition, p95 total angular speed is `7.41 rad/s`.
- Giant-ball observed rest/max: `1.0 m / 2.661 m`. A physical Giant Ball mass scale of `0.65` currently produces approximately `2.60 m` in the repeatable compound-impact comparison, with no launch or height cap.
- Athlete rest/max: `~0.50 m / 1.035 m`.
- Planning deadline: `20.010–20.014 s`; production default is therefore `20 s`.
- Typical no-goal resolve: approximately `2.8–6.2 s`; the existing 8 s safety cap remains appropriate.
- Goals are deep physical pockets with open mouths. A score occurs only after the whole ball crosses the line, leaving partially crossed balls live for a goalie clearance.

## Candidate maps

| Map | Purpose | Effective babble drag/tick | Effective ball drag/tick | Effective ball restitution |
|---|---|---:|---:|---:|
| Original A · Tight | Geometry-normalized for the smaller clone field | `0.9614` | `0.9823` | `0.855` |
| Original B · Empirical | Recommended direct conversion of captured telemetry | `0.9724` | `0.9898` | `0.945` |
| Original C · Glide | Lively upper bound for unresolved glide/bounce | `0.9780` | `0.9945` | `0.972` |

Effective values are global `PHYSICS_CONFIG` defaults multiplied by each map profile. Start with **Original B · Empirical**.

## Playtest protocol

Use the same formation and repeat these actions on A, B, and C:

1. Straight maximum pull with no collision.
2. Straight maximum pull into the untouched ball.
3. Glancing ball hit at approximately 45°.
4. Two opposing players striking the ball.
5. Ball collision with a side wall and corner bumper.
6. Slow and fast traversal of a Trampoline.
7. Giant Ball collision and landing.

Report which map has the closest:

- full-launch travel distance;
- low-speed glide and stopping point;
- player-to-ball momentum transfer;
- wall and collision bounce;
- Trampoline speed preservation.

After selecting one, retain it as the production Original map and hide/remove the rejected candidates.

## Corrected power rules

- **Trampoline:** real Rapier 3D convex wedge; no artificial speed or vertical injection; lasts its placement turn; multiple placements create independent colliders; contact events are cosmetic only.
- **Red Card:** user selects a babblehead; that exact babblehead teleports to exact field center with motion cleared; invalid/missing targets are rejected before inventory consumption.
- **Yellow Card:** no target selection; the ball teleports to exact field center with motion and last-touch attribution cleared.
