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
