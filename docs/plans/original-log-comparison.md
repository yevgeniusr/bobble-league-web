# Original Log Comparison

Generated from `/Users/mac/Downloads/events4-2.json`.

## Original metrics to preserve

- Records: 353.
- Main state snapshots: event `45`, 135 records.
- Original physics state is 3D-ish: ball and athletes expose position, velocity, angular velocity, and quaternion rotation.
- Ball rest height: ~0.49–0.50.
- Original non-giant ball max in sample: ~0.90.
- Original giant ball max in sample: 2.66.
- Athlete/player rest height: ~0.49–0.50.
- Athlete/player max in sample: ~1.03, much smaller than giant ball.
- Formations include `wall`, `option`, `zone`, `forward`, `slant`.
- Power ids include `ramp`, `yellowcard`, `giantball`, `block`, `sticky`, `ghost`, `bumppadboost`, `redcard`, `boost`, `bighead`, `goalswap`.

## Scripts

```bash
npm run analyze:original
npm run compare:original
```

`analyze:original` prints raw metrics from the downloaded original log.

`compare:original` runs deterministic clone scenarios and checks high-level parity gates:

- Saturn map exists.
- Wall formation exists.
- Ball has vertical state.
- Beach/Giant ball lofts materially higher than normal ball.
- Beach/Giant ball reaches an original-like airborne range.
- Babble/player hop remains much subtler than giant ball lift.
- Exact last-touch babble/player tracking works.
- Target-style power aliases are represented.

Current expected comparison output includes:

```txt
normal.maxBall ≈ 0.92
beach.maxBall  = 2.66
lastTouchedBabbleId = left-1
```
