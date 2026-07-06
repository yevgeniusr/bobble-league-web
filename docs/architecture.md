# Babble League Web Architecture

## Recommended stack

Use a production TypeScript browser/game stack:

- **Client:** Vite + React + PixiJS canvas renderer.
- **Server:** Node.js + Fastify/Express + Socket.IO for WebSocket rooms.
- **Simulation:** authoritative server-side fixed timestep physics. Rigid-body integration and collisions use Rapier 2D (`@dimforge/rapier2d-deterministic-compat`: WASM inlined for Node/test/Docker compatibility, deterministic build for reproducible server simulation) in `shared/physics.ts`; game-feel rules (bumpers, boosts, goo, ramps, boxes, goals, settling) remain plain TypeScript in `shared/game.ts`. Clients render snapshots only and never load the physics WASM.
- **Shared code:** TypeScript message schemas, constants, room/game types, selectable map config (`MAPS`), seeded RNG helpers.
- **Tests:** Vitest for unit/integration, Playwright for browser flows, Artillery/k6 for WebSocket load.
- **Deploy:** Docker image deployed by Coolify, with `/healthz`, HTTPS, WebSocket proxy support, and optional Redis when scaling beyond one instance.

## Core architecture

```text
Browser clients
  ├─ React screens: home, lobby, team select, match, match over
  ├─ Pixi renderer: interpolation/prediction from snapshots
  └─ Socket client: sends input commands only
        │
        ▼
Node realtime server
  ├─ HTTP: static app, healthz, metrics-ready endpoint
  ├─ Socket gateway: room/create/join, lobby commands, match input
  ├─ Room manager: room code lifecycle, cleanup TTL, reconnect grace
  └─ Game room: authoritative physics, scoring, power-ups, snapshots
        │
        ▼
Optional infra
  ├─ Redis: multi-instance room/session coordination
  └─ Postgres: only if accounts/stats/leaderboards are added
```

## Authoritative multiplayer model

- Clients **never** send positions, velocity, score, collisions, or spawn results.
- Clients send `{ seq, input }` messages: movement axis/buttons, kick, boost, use power-up.
- Server validates identity, room membership, sequence order, rate limits, cooldowns, and match phase.
- Server runs a fixed timestep, e.g. 60 Hz physics and 20 Hz snapshot broadcasts.
- Snapshots contain tick, scores, ball/player transforms, active boxes, power-up state, match phase, and acknowledged input sequence.
- Client rendering uses a small interpolation buffer (~100 ms). Prediction/reconciliation is limited to the local player for responsiveness.

## Room/lobby/game flow

1. Player creates room with mode `firstTo: 1 | 3 | 5`.
2. Others join by short room code.
3. Lobby supports teams: `blue`, `red`, `spectator`.
4. Players toggle ready; host can change mode until countdown starts.
5. Players can change the room map only while still in `lobby`; map choice is
   included in every snapshot and locks after kickoff until reset/new room.
6. Server starts countdown once rules are satisfied.
7. Match runs until one team reaches target goals.
8. Match-over screen supports rematch or return to lobby.
9. Empty rooms are destroyed after a short TTL.

## Power-up spawning rule

- Define a **turn** as one kickoff segment. `turnNumber = 1` at match start and increments after each goal/reset kickoff.
- On every even turn (`turnNumber % 2 === 0`), the authoritative server spawns one box.
- Spawn side is chosen by seeded room RNG: `top` or `bottom`.
- Spawn x is random within safe arena bounds, excluding goal mouths and reset zones.
- Spawn y is fixed by side: `POWERUP_TOP_Y` or `POWERUP_BOTTOM_Y`.
- Box is included in snapshots and despawns on collection, goal reset, or TTL.
- Use seeded RNG so replay tests can reproduce spawn decisions.

## Proposed file structure

```text
bobble-league-web/
  package.json
  tsconfig.json
  vite.config.ts
  Dockerfile
  docker-compose.yml
  .env.example
  docs/
    architecture.md
    protocol.md
    operations.md
    plans/2026-07-05-production-architecture.md
  src/
    client/
      main.tsx
      app/App.tsx
      screens/HomeScreen.tsx
      screens/LobbyScreen.tsx
      screens/MatchScreen.tsx
      render/PixiStage.ts
      render/interpolation.ts
      input/inputManager.ts
      net/socketClient.ts
      state/gameStore.ts
    server/
      index.ts
      config.ts
      http.ts
      sockets.ts
      rooms/RoomManager.ts
      rooms/GameRoom.ts
      rooms/LobbyState.ts
      net/validation.ts
      net/rateLimit.ts
      net/snapshotCodec.ts
      observability/logger.ts
    shared/
      constants.ts
      protocol.ts
      schemas.ts
      types.ts
      rng.ts
    physics/
      world.ts
      entities.ts
      simulateTick.ts
      scoring.ts
      powerups.ts
  tests/
    unit/
    integration/
  e2e/
    lobby-and-match.spec.ts
  load/
    artillery-websocket.yml
  scripts/
    smoke.sh
```

If the project grows, split `src/client`, `src/server`, `src/shared`, and `src/physics` into pnpm workspace packages. For the current lightweight skeleton, the single-package structure above is simpler.

## Testing checklist

### Unit
- Protocol schemas accept valid messages and reject malformed/oversized payloads.
- Seeded RNG returns stable sequences.
- Goal detection increments the correct team only once.
- `firstTo` 1/3/5 modes end at exactly the configured score.
- Turn counter increments once per kickoff segment.
- Power-up boxes spawn only on even turns.
- Top/bottom spawn selection and bounds exclusions are valid.
- Same seed + same input stream produces same final server snapshot hash.
- Input sequence dedupe ignores duplicate inputs.
- Rate limits reject spammy socket messages.

### Integration
- Two socket clients can create/join room, pick teams, ready, and start.
- Simulated inputs can score a goal and update snapshots.
- First-to-1 ends immediately; first-to-3/5 continue correctly.
- Even-turn power-up spawn event reaches all clients.
- Disconnect/reconnect within grace receives current authoritative state.

### E2E
- Two Playwright browser contexts create and join a room.
- Lobby team selection/ready state is reflected on both clients.
- Match canvas loads and scoreboard is visible.
- Scripted/deterministic goal reaches match-over screen.
- Rematch/return-to-lobby flow works.

### Load/performance
- Baseline: 50 rooms x 4 players.
- Stress: 100 rooms x 4 players.
- Track p95 snapshot latency, event loop lag, memory, CPU, dropped sockets.
- Run a 2+ hour soak test with room churn.
- Assert stale rooms are cleaned and memory does not grow unbounded.

### Security/cheat resistance
- Fuzz socket payloads.
- Verify clients cannot set position, velocity, score, spawn, cooldowns, or inventory.
- Verify room-code brute-force rate limits.
- Verify CORS origin config and no secrets in client bundle.

## Docker/Coolify deployment checklist

- Add `.env.example` with `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `PUBLIC_SERVER_URL`, optional `REDIS_URL`, `LOG_LEVEL`.
- Multi-stage Dockerfile:
  - install dependencies with lockfile,
  - run typecheck/tests/build,
  - copy only built assets and production deps,
  - run as non-root user,
  - expose `PORT`,
  - healthcheck `/healthz`.
- Coolify:
  - deploy from repository Dockerfile,
  - configure domain + HTTPS,
  - set env vars in Coolify UI,
  - confirm WebSocket upgrade support,
  - set healthcheck path `/healthz`,
  - start with one replica.
- Scaling beyond one replica requires Redis adapter and sticky WebSocket sessions or a room-owner routing strategy.
- Post-deploy smoke:
  - `curl -fsS https://<domain>/healthz`,
  - open two browsers, create/join room, pick teams, first-to-1, score, verify match over.

## Main risks

- **Physics tick lag:** add tick-duration metrics, load tests, and per-instance room caps.
- **Horizontal WebSocket scaling:** keep one instance for v1; add Redis/sticky sessions before scaling.
- **Network jitter:** interpolation buffer, local prediction, reconnect grace, periodic full snapshots.
- **Cheating:** input-only protocol, server authority, schema validation, cooldown/rate limits.
- **Power-up disputes:** server-only seeded RNG and replayable match logs.
- **Coolify proxy mismatch:** explicit WebSocket smoke test after every deploy.
- **Memory leaks:** room cleanup TTL, soak tests, heap monitoring.

## Definition of done

- `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` pass.
- Deterministic replay tests pass for seeded match fixtures.
- Two-player E2E can complete a first-to-1 match.
- Docker image builds and `/healthz` passes locally.
- Coolify deployment works over HTTPS/WebSocket.
- Production docs cover env vars, smoke tests, scaling caveats, and rollback.
