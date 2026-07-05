# Bobble League Mechanics Analysis

## Sources

Reference media under `references/original/` (gitignored, not shipped):

- Discord directory GIF/screenshots from `app-directory-assets.discordactivities.com/bobble-league`.
- YouTube gameplay/contact sheets:
  - `https://www.youtube.com/watch?v=pUZ1AarZofA`
  - `https://www.youtube.com/watch?v=8sX4nh9aThc`
  - `https://www.youtube.com/watch?v=83spJNvKxns`

A video-capable vision model (`google/gemini-2.5-pro` via OpenRouter) reviewed the contact sheets and produced mechanic guidance in `tmp/openrouter-mechanics-qa.json`.

## Model observations

- Bobble League is turn-based: aim/flick phase, then physics resolution until objects settle.
- There is a per-turn aiming timer in addition to the match turn counter.
- Gameplay uses puck/billiards-like 2D physics under a 3D tabletop presentation: circular bobble/ball colliders, damped motion, bouncy rebounds.
- Corner geometry behaves like rounded bumpers to prevent stuck balls and enable bank shots.
- A goal scores when the ball fully enters/crosses through the goal mouth/trigger, then play resets or ends depending on match target.
- Shared-team behavior from video is ambiguous; current user requirement is stronger than model inference, so implementation follows the user: every character/bobble is assigned to a teammate and all bobbles are aimed each turn. In solo, the lone player controls all four bobbles on that side.

## Implementation changes from this pass

- Added `turnDeadlineAt` and `turnDurationMs` to authoritative game state.
- `player:launch` now records an aim intent instead of immediately resolving one bobble.
- The turn resolves only when all 8 bobbles have submitted intents or the timer expires.
- Bobbles are distributed round-robin among connected teammates:
  - 1 player on a side controls all 4 bobbles.
  - 2 players: 2 bobbles each.
  - 4 players: 1 bobble each.
- Added physics corner bumpers as static circular colliders at all four arena corners.
- Added unit tests for 4v4 distribution/all-bobble turn resolution and goal-mouth scoring.
- Updated Betabots to run 8 independent Socket.IO clients, verify 4v4 distribution, make all 8 bobbles act each turn, and require an actual goal finish.

## Verification evidence

Local:

- `npm test`: 9/9 tests passed.
- `npm run build`: passed.
- `BOBBLE_URL=http://127.0.0.1:3117 BETABOTS_TIMEOUT_MS=180000 npm run betabots`: 8 Betabots completed by actual goal.

Example bot result:

```json
{
  "bots": 8,
  "sideCounts": { "left": 4, "right": 4 },
  "winner": "right",
  "score": { "left": 0, "right": 1 },
  "turn": 2
}
```
