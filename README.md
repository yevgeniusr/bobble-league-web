# Unicup Web

A production-oriented, web-based multiplayer Universe Cup played by handless bobbleheads on PlanetBall. It uses an authoritative Node/Socket.IO server, a React/Vite canvas client, deterministic shared game rules, multiple teams, first-to-1/3/5 game modes, and mystery box power-ups.

> This implementation recreates the requested mechanics with original code, UI, and vector/emoji-rendered teams. It does not copy proprietary assets.

## Features

- Real-time multiplayer rooms with shareable room codes.
- Authoritative server simulation at 30 ticks/sec.
- Pre-start map selection: Unicap Qualifier, Moon Base, Coral Foundry, Saturn,
  or one of three Ball Office calibration arenas. The selected
  map is included in snapshots and locks after kickoff until reset/new room.
- Teams: Signal Stingers, Coral Flyers, Cobalt Bruisers, Aqua Circuit, Pink
  Pilots, Whitehorn United, Meteor Eleven, Polar Caps, Broadcast Birds, and
  Stripe Squad.
- Match modes: first to 1, 3, or 5 goals.
- Goals are deep, roofless physical pockets: goalies can enter from the open mouth, and scoring occurs as soon as the ball centre crosses the front gate line.
- Unicup soccer mechanics: drag-launch, bounce, score goals.
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
babbleheads, walls, open goal pockets, blocks, and Trampolines use 3D colliders.
Bumpers run through a deterministic swept-circle resolver after each Rapier
step: it reflects and accelerates only field-plane velocity while preserving the
exact Rapier height and vertical velocity. Public `GameState` remains the stable
network snapshot boundary and receives projected physics state after each step.
The browser never imports the physics module; it renders server state only, so
no Rapier WASM ships in the client bundle.

### Maps

Map config lives in `shared/types.ts` (`MAPS`, `MAP_IDS`, `MapId`) so client,
server, tests, and scripts share one registry.

- `stadium`: PlanetBall's Unicap Qualifier with the classic four corner bumpers.
- `moon`: a low-orbit relay with crater bumpers and floatier physics.
- `volcano`: the Coral Foundry, with offset bumpers and faster hazard bounces.
- `saturn`: a heavy orbital final with ring markings and dense collisions.
- `original*`: three Ball Office calibration profiles retained for physics comparison.

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
BABBLE_BUMPER_PLANAR_DELTA_SPEED=450 npm run render-check
```

Smoke and bot scripts accept `BABBLE_MAP=stadium|moon|volcano|saturn|original|originalGlide|originalBounce`:

```bash
BABBLE_MAP=moon npm run smoke
BABBLE_MAP=volcano npm run betabots
BABBLE_MAP=moon node scripts/stage2-render-check.mjs
BABBLE_MAP=volcano npm run box-check
```

Common knobs:

- `BABBLE_IMPULSE_SCALE`: babble launch force multiplier.

- `BABBLE_BALL_DENSITY`: ball weight in Rapier collisions.
- `BABBLE_GIANT_BALL_MASS_SCALE`: Giant Ball mass relative to the normal ball.
- `BABBLE_BOOST_PAD_ACCEL`: boost pad acceleration.
- `BABBLE_BUMPER_RESTITUTION`: planar bumper reflection coefficient, clamped to `[0,1]`.
- `BABBLE_BUMPER_PLANAR_DELTA_SPEED`: normal bumper delta velocity in field px/s; super bumpers always derive exactly `5x` this power.
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

## Clerk accounts and guests

The project is linked to the Unicup Clerk application through `clerk init`.
Configure Clerk locally with `clerk env pull`; do not expose the secret key to
the browser. Production requires:

```bash
CLERK_PUBLISHABLE_KEY=pk_...    # public, returned through /api/config
CLERK_SECRET_KEY=sk_...         # server-only Clerk verification and metadata
UNICUP_GUEST_SECRET=...         # server-only random secret, at least 16 bytes
```

Every visitor can play immediately. Signed-out players receive a persistent,
HMAC-signed HttpOnly guest identity. On that browser's first Clerk sign-in, the
server stores the same canonical Unicup account ID in Clerk private metadata;
the guest's gameplay and Loyalty identity therefore continue after registration
and on later devices. Clerk session tokens are verified on the server for both
HTTP and Socket.IO requests. Nicknames remain editable display data and are
never used as account identifiers.

## Xtremepush analytics

Set the Xtremepush server/runtime configuration:

```bash
XTREMEPUSH_APP_TOKEN=...                       # server-side analytics token
XTREMEPUSH_SDK_KEY=...                         # public web SDK key
XTREMEPUSH_LOYALTY_ENDPOINT=p1234.p.loyalty.eu.xtremepush.com
XTREMEPUSH_LOYALTY_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\n...'
XTREMEPUSH_LOYALTY_PUBLIC_KEY='-----BEGIN PUBLIC KEY-----\n...'
XTREMEPUSH_LOYALTY_KEY_ID=primary              # optional JWT kid
XTREMEPUSH_LOYALTY_TOKEN_TTL=300
PUBLIC_HOSTNAME=unicup.rachkovan.com             # browser SDK is exposed only here
XTREMEPUSH_ALLOW_LOCAL=false                    # opt in only for local SDK QA
```

Local development reads these values from `.env` when they are not already in the process environment. The SDK key and Loyalty endpoint are public browser configuration; the RSA private key remains server-only. The backend verifies that the configured private/public keys match before enabling `/api/loyalty/token`, then signs short-lived RS256 tokens whose `sub` is the server-resolved canonical Unicup account ID. The same ID is used for gameplay events, so Loyalty progress belongs to the correct guest or Clerk account rather than a nickname. `private.key`, `public.key`, and `*.pem` are gitignored and must be configured as deployment secrets rather than committed.

The browser loads the Xtremepush Web SDK asynchronously from the same-origin `/api/xtremepush/sdk.js` route. The server proxies the configured Xtremepush CDN SDK with a timeout, content-type check, and size cap; upstream failures return a non-success response so the client cannot mistake an inert queue for a working SDK. The Loyalty integration sets `user_id`, `loyalty_endpoint`, and its short-lived `loyalty_token` before calling `mountLoyalty` in Xtremepush's native floating-overlay mode; expired tokens are refreshed through the backend. Without complete browser/Loyalty configuration, gameplay remains available.

Tracked events:

- `gamePlayed`: emitted once to every match participant when the match finishes.
  Each user's payload includes their own `outcome` (`won`, `loss`, or `draw`),
  player/opponent score, side/team/name, room, mode/length, winner, timestamp,
  and map ID.
- `abilityUsed`: emitted only after a Power Play successfully applies. Payload
  includes room code, player/holder id, side/team, ability type, target babble,
  target side/team/position, placement position/angle, field object id when
  applicable, turn, phase, score, match mode/length, winner, timestamp, and
  `mapId`.
- `boxPickup`: emitted when a box is assigned or replaces a held box. Payload
  includes holder id, holder side/team, collector babble id, pickup method,
  box id/type/anchor/position, available turn, replaced ability type, turn,
  phase, score, match mode/length, winner, timestamp, and `mapId`.
- `goalScored`: emitted only to the player whose babblehead last touched the
  ball. Payload includes that player's identity, scoring and conceding sides,
  last-touch details, ball position, updated score, turn, phase, match
  mode/length, winner, timestamp, and map ID. Untouched goals do not emit it.

Gameplay context is carried in each event's `value`; it is not written into
global Xtremepush user attributes. Profile import currently sets only the
stable `user_id` and `first_name` fields.

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
