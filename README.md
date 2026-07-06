# Babble League Web

A production-oriented, web-based multiplayer babble soccer game inspired by Discord party sports games. It uses an authoritative Node/Socket.IO server, a React/Vite canvas client, deterministic shared game rules, multiple teams, first-to-1/3/5 game modes, and mystery box power-ups.

> This implementation recreates the requested mechanics with original code, UI, and vector/emoji-rendered teams. It does not copy proprietary assets.

## Features

- Real-time multiplayer rooms with shareable room codes.
- Authoritative server simulation at 30 ticks/sec.
- Teams: Pigs, Parrots, Penguins, Tigers, Frogs, Foxes.
- Match modes: first to 1, 3, or 5 goals.
- Babble soccer mechanics: run, dash/kick, bounce, score goals.
- Box spawning: every second kickoff turn creates one random top/bottom lane box.
- Box effects: speed, slow, big, tiny, freeze, ghost, magnet, bomb, shield, swap.
- Responsive web UI and Docker/Coolify-ready deployment.

## Physics engine

Rigid-body physics (ball/babble integration and damping, wall and goal-mouth
collisions, placed block walls) runs on **Rapier 2D** via
`@dimforge/rapier2d-deterministic-compat`: the `-compat` build inlines the WASM
blob so it loads in plain Node (tsx, vitest, Docker) with no bundler wiring,
and the `-deterministic` build keeps the authoritative server simulation
reproducible across platforms. `shared/physics.ts` owns the Rapier world (one
persistent world per `GameState`, `GameState` stays the source of truth);
game-feel rules — corner bumpers, boost pads, sticky goo, ramps, box pickups,
goal detection, settling — stay as explicit rule code in `shared/game.ts`. The
browser client never imports the physics module; it renders server state only,
so no WASM ships in the client bundle.

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
BABBLE_MAX_SPEED=1450 npm test
BABBLE_IMPULSE_SCALE=1.0 BABBLE_BALL_DENSITY=0.86 npm run smoke
BABBLE_BUMPER_BOOST=270 BABBLE_RAMP_LAUNCH_SPEED=740 npm run render-check
```

Common knobs:

- `BABBLE_IMPULSE_SCALE`: babble launch force multiplier.
- `BABBLE_MAX_SPEED`: clamp for ball and babble velocity.
- `BABBLE_BALL_DENSITY`: ball weight in Rapier collisions.
- `BABBLE_BOOST_PAD_ACCEL`: boost pad acceleration.
- `BABBLE_BUMPER_BOOST`, `BABBLE_BUMPER_MIN_EXIT_BALL`,
  `BABBLE_BIG_BUMPER_MULT`: corner bumper strength.
- `BABBLE_RAMP_LAUNCH_SPEED`: minimum ramp exit speed.
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
