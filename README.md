# Babble League Web

A production-oriented, web-based multiplayer babble soccer game inspired by Discord party sports games. It uses an authoritative Node/Socket.IO server, a React/Vite canvas client, deterministic shared game rules, multiple teams, first-to-1/3/5 game modes, and mystery box power-ups.

> This implementation recreates the requested mechanics with original code, UI, and vector/emoji-rendered teams. It does not copy proprietary assets.

## Features

- Real-time multiplayer rooms with shareable room codes.
- Authoritative server simulation at 30 ticks/sec.
- Pre-start map selection: Stadium, Moon Base, or Volcano Bowl. The selected
  map is included in snapshots and locks after kickoff until reset/new room.
- Teams: Pigs, Parrots, Penguins, Tigers, Frogs, Foxes.
- Match modes: first to 1, 3, or 5 goals.
- Goals are deep, roofless physical pockets: goalies can enter from the open mouth, and scoring occurs as soon as the ball centre crosses the front gate line.
- Babble soccer mechanics: drag-launch, bounce, score goals.
- Box spawning: every second kickoff turn creates one random top/bottom lane box.
- Power Play boxes: Beach Ball, Move Ball, Swap Goals, Big Bumpers, Boost,
  Sticky Goo, Ramp, Block, Big Head, Ghosted, and Move Player.
- Responsive web UI and Docker/Coolify-ready deployment.

## Physics engine

Rigid-body physics runs on **Rapier 3D** via
`@dimforge/rapier3d-deterministic-compat`. Field X/Y map to Rapier X/Z and
height maps to Rapier Y. During resolution the persistent Rapier world is
authoritative: explicit launches use `applyImpulse`, Boost pads use `addForce`,
Sticky Goo changes rigid-body damping, and teleports/resizes synchronize once.
Rapier then owns gravity, floor contacts, lift, landing, bounce, carry, collision
response, and quaternion/angular motion until the turn settles. The ball,
babbleheads, walls, open goal pockets, blocks, physical corner bumpers, and
Trampolines all use 3D colliders. Public `GameState` remains the stable network
snapshot boundary and receives projected Rapier state after each step. The
browser never imports the physics module; it renders server state only, so no
Rapier WASM ships in the client bundle.

### Maps

Map config lives in `shared/types.ts` (`MAPS`, `MAP_IDS`, `MapId`) so client,
server, tests, and scripts share one registry.

- `stadium`: default/current layout and physics, with the classic four corner
  bumpers.
- `moon`: lunar colors, crater-style round bumper layout, lower-grip/floatier
  damping, and sci-fi gates.
- `volcano`: lava colors, offset volcanic bumpers, faster hazard-like bounces,
  and volcanic gates.

Players can choose the map while creating a room or from the in-room settings
menu while the room is still in `lobby`. The server rejects `room:map` after
kickoff; use Reset or create a new room to change maps.

### Local physics tuning

All tunable physics constants live in `shared/physicsConfig.ts`. Edit that file
for durable local defaults, then run:

```bash
npm test
npm run build
npm run smoke
```

For quick server/test experiments, set environment overrides without editing
source. Examples:

```bash
BABBLE_IMPULSE_SCALE=1.0 BABBLE_BALL_DENSITY=0.86 npm run smoke
BABBLE_BIG_BUMPER_MOTOR_STIFFNESS=4200 npm run render-check
```

Smoke and bot scripts accept `BABBLE_MAP=stadium|moon|volcano|saturn|original|originalGlide|originalBounce`:

```bash
BABBLE_MAP=moon npm run smoke
BABBLE_MAP=volcano npm run betabots
BABBLE_MAP=moon node scripts/stage2-render-check.mjs
BABBLE_MAP=volcano node scripts/box-control-check.mjs
```

Common knobs:

- `BABBLE_IMPULSE_SCALE`: babble launch force multiplier.

- `BABBLE_BALL_DENSITY`: ball weight in Rapier collisions.
- `BABBLE_GIANT_BALL_MASS_SCALE`: Giant Ball mass relative to the normal ball.
- `BABBLE_BOOST_PAD_ACCEL`: boost pad acceleration.
- `BABBLE_BUMPER_RESTITUTION` / `BABBLE_BIG_BUMPER_RESTITUTION`: physical material elasticity, clamped to Rapier's `[0,1]` range.
- `BABBLE_BUMPER_MOTOR_STIFFNESS` / `BABBLE_BIG_BUMPER_MOTOR_STIFFNESS`: spring-plunger motor strength.
- Trampolines use physical Rapier 3D wedge geometry and have no artificial boost/minimum exit-speed knob.
- `BABBLE_BALL_DRAG_PER_TICK`, `BABBLE_DRAG_PER_TICK`: damping feel.

## Controls

- Move: `WASD` or arrow keys
- Kick/Dash: `Space`

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

Open http://localhost:3000 in two browser windows and join the same room code.

## Xtremepush analytics

Set the public Xtremepush web SDK key in the server environment:

```bash
XTREMEPUSH_SDK_KEY=your-public-web-sdk-key
```

Local development also reads this value from `.env` if it is not already set in
the process environment. The server exposes only the public web SDK key at
`GET /api/config`; it never logs the key or requires it for gameplay. If the key
is missing, config loading fails, or the SDK script fails to load, analytics
events become a resilient no-op.

The browser loads the Xtremepush Web SDK asynchronously from the same-origin
`/api/xtremepush/sdk.js` route. The server fetches the configured Xtremepush CDN
SDK and serves a no-op command queue fallback if the upstream SDK is unavailable,
so CDN failures do not surface as gameplay or smoke-test failures. Events are
sent with the SDK queue as `xtremepush('event', eventName, payload)`.

Tracked events:

- `gamePlayer`: room create/join/reconnect/leave/disconnect, match start, and
  match reset lifecycle. Payload includes lifecycle, room code, player socket
  id, player side/team/name, babble ids, connected/total players, phase, turn,
  score, match mode/length, winner, timestamp, and future-compatible `mapId`.
- `abilityUsed`: emitted only after a Power Play successfully applies. Payload
  includes room code, player/holder id, side/team, ability type, target babble,
  target side/team/position, placement position/angle, field object id when
  applicable, turn, phase, score, match mode/length, winner, timestamp, and
  `mapId`.
- `boxPickup`: emitted when a box is assigned or replaces a held box. Payload
  includes holder id, holder side/team, collector babble id, pickup method,
  box id/type/anchor/position, available turn, replaced ability type, turn,
  phase, score, match mode/length, winner, timestamp, and `mapId`.
- `goalScored`: emitted when a goal is scored. Payload includes scoring side,
  scoring team, conceding side, last touched side/team, ball position, updated
  score, turn, phase, match mode/length, winner, timestamp, and `mapId`.

## Developer console (testing hooks)

There is no cheat UI in the app. For testing, a developer console API is
attached to the page as `window.__babbleDev` when any of these is true:

- dev build (`import.meta.env.DEV`)
- the page URL has `?dev=1`
- `localStorage.setItem('babble:devtools', '1')`

API (run in the browser devtools console while in a room):

```js
window.__babbleDev.listTypes();        // all Power Play box type ids
window.__babbleDev.grantBox('boost');  // grant one testing copy of a type
window.__babbleDev.grantAll();         // grant one of every type
```

These emit real socket events; every successful grant publicly announces
`CHEAT MODE: …` to the whole room. The server **rejects** cheat events when
`NODE_ENV=production` unless `ENABLE_CHEATS=true` is set, and rate limits them
(one grant per ~0.8s, one grant-all per 5s). The Playwright box-control check
(`scripts/box-control-check.mjs`) enables both gates for its own test server.

## Assets

Generated art lives in `public/assets` (served at `/assets/...`):

- `/assets/abilities/<boxType>.png` — ability icons (`boost.png`, `ghosted.png`,
  …, plus `mysteryBox.png` and `ability-spritesheet.png`). The bottom action
  bar uses these for Power Play buttons and falls back to emoji/procedural
  icons if an image is missing.
- `/assets/sprites/ball-texture.png`, `goal-gates.png`, `field-props.png` —
  texture/reference sheets for the renderer.
- `/assets/models/*.obj` — placeholder meshes for future 3D models.
- `/assets/manifest.json` — stable asset paths.

## Production

```bash
npm ci
npm run build
PORT=3000 NODE_ENV=production npm start
```

Health check: `GET /healthz`.

## Docker

```bash
# Image tag intentionally matches the existing package/repo name for deploy compatibility.
docker build -t bobble-league-web .
docker run --rm -p 3000:3000 bobble-league-web
```
