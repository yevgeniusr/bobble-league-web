# Bobble League Web Production Architecture

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Production-ready browser multiplayer physics soccer game with authoritative real-time rooms, lobby/team selection, power-up spawning, configurable first-to-goal modes, and Docker/Coolify deployment.

**Architecture:** TypeScript monorepo with a Vite/React/PixiJS browser client and an authoritative Node.js real-time game server. The server owns all simulation, collision, scoring, RNG, and room state; clients send input commands only and render interpolated snapshots with optional local prediction. Persistent data is intentionally minimal for v1: ephemeral in-memory rooms, optional Redis for horizontal scale/session coordination.

**Tech Stack:** pnpm workspaces, TypeScript, React + Vite, PixiJS renderer, planck.js/Box2D physics on server, Socket.IO or uWebSockets transport, Fastify HTTP API, Zod schemas, Vitest, Playwright, k6/Artillery, Docker, Coolify.

---

## 1. System Components

### Browser client
- Connects to lobby/server over WebSocket.
- Sends timestamped input frames: left/right/jump/kick/boost/power-up activation.
- Never sends position, velocity, score, spawn, or collision truth.
- Renders server snapshots with interpolation buffer of ~100 ms.
- Uses client-side prediction only for the local player's movement; reconciles to authoritative snapshots.
- Provides screens:
  - Home/create-or-join room.
  - Room lobby: room code, player list, ready state, team select, game mode first-to-1/3/5.
  - Match scene.
  - Post-match scoreboard/rematch.

### Authoritative game server
- Owns all room lifecycle and match state.
- Runs fixed timestep simulation, e.g. 60 Hz physics, 20 Hz network snapshots.
- Validates all inputs against player identity, room membership, rate limits, and match phase.
- Computes goals, kickoff/reset, timer, team scores, power-up boxes, power-up effects, and winner.
- Broadcasts compact snapshots with monotonically increasing tick numbers.
- Maintains replay/debug ring buffer per room for production incident diagnosis.

### HTTP/API server
- Health endpoints for deploy checks.
- Room create/join metadata endpoint if needed, though WebSocket can handle all lobby commands.
- Static client can be served separately by CDN/Coolify static service or bundled behind Fastify for single-container v1.

### Optional infrastructure for scale
- Redis adapter for multi-instance WebSocket pub/sub and room registry.
- Sticky WebSocket sessions at reverse proxy/load balancer.
- Postgres only if accounts, stats, cosmetics, leaderboards, or audit persistence are added.

---

## 2. Real-Time Protocol

Use a single versioned message protocol shared between client and server.

```ts
// packages/shared/src/protocol.ts
export type ClientToServer =
  | { t: 'room:create'; name: string; mode: 1 | 3 | 5 }
  | { t: 'room:join'; code: string; name: string }
  | { t: 'lobby:setTeam'; team: 'blue' | 'red' | 'spectator' }
  | { t: 'lobby:setReady'; ready: boolean }
  | { t: 'match:input'; seq: number; tick?: number; input: PlayerInput }
  | { t: 'match:usePowerUp'; seq: number };

export type ServerToClient =
  | { t: 'room:state'; room: LobbyState }
  | { t: 'match:start'; seed: string; mode: 1 | 3 | 5; assignedPlayerId: string }
  | { t: 'match:snapshot'; tick: number; state: Snapshot; ackInputSeqByPlayer: Record<string, number> }
  | { t: 'match:event'; event: MatchEvent }
  | { t: 'error'; code: string; message: string };
```

Rules:
- Validate every message with Zod at the server edge.
- Include protocol version in Socket.IO auth/query or initial hello.
- Reject stale clients with explicit `upgrade_required` error.
- Inputs are idempotent by `(playerId, seq)` and ignored if duplicated or too far ahead.

---

## 3. Game Simulation Design

### Match phases
1. `lobby`
2. `countdown`
3. `kickoff`
4. `playing`
5. `goal_scored`
6. `match_over`
7. `rematch_vote`

### Fixed timestep loop
- Physics timestep: `1 / 60` seconds.
- Snapshot broadcast: every 3 physics ticks, approximately 20 Hz.
- Input queue: each player has ordered input buffer keyed by sequence.
- Server applies latest valid input each tick; if no new input, reuse previous input for a short grace window, then neutral input.

### Physics entities
- Arena: static boundaries, goals, top/bottom spawn lanes.
- Ball: dynamic circle body.
- Player bobbles: dynamic bodies with movement constraints and kick impulse.
- Power-up boxes: sensor fixtures or simple AABB trigger zones.

### Power-up and box spawning
- Define `turnNumber` as the kickoff segment number. It starts at 1 when the match starts and increments after every goal/reset kickoff.
- At the start of every even turn (`turnNumber % 2 === 0`), spawn one box.
- Spawn location:
  - Side: seeded RNG chooses `top` or `bottom`.
  - X coordinate: seeded RNG chooses within safe horizontal arena bounds, excluding goal mouths and player/ball reset zones.
  - Y coordinate: fixed lane y for top/bottom, e.g. `POWERUP_TOP_Y` or `POWERUP_BOTTOM_Y`.
- Server publishes spawn event and includes box in snapshots.
- Box despawns when collected, on goal reset, or after configured TTL.
- Use seeded room RNG so incidents/replays can reproduce spawns.

### Game modes
- Lobby host selects `targetGoals: 1 | 3 | 5` before ready state locks.
- Match ends when `blueScore >= targetGoals || redScore >= targetGoals`.
- Server rejects mode changes after countdown starts.

### Anti-cheat baseline
- Server authoritative positions/velocities/scores.
- Input rate limit per socket.
- Clamp input shape to booleans/normalized axes.
- Ignore physically impossible action cadence, e.g. kick cooldown/power-up cooldown violations.
- Short reconnect grace tied to room player token, not just socket id.

---

## 4. Proposed Repository Structure

```text
/Users/mac/projects/personal/bobble-league-web/
  package.json
  pnpm-workspace.yaml
  turbo.json                         # optional task runner
  .env.example
  .gitignore
  Dockerfile
  docker-compose.yml
  coolify.md
  docs/
    architecture.md
    protocol.md
    operations.md
    plans/
      2026-07-05-production-architecture.md
  packages/
    shared/
      package.json
      src/
        constants.ts
        protocol.ts
        schemas.ts
        types.ts
        rng.ts
        math.ts
    physics/
      package.json
      src/
        world.ts
        entities.ts
        simulateTick.ts
        collisions.ts
        powerups.ts
        scoring.ts
      tests/
        scoring.test.ts
        powerups.test.ts
        determinism.test.ts
    server/
      package.json
      src/
        index.ts
        config.ts
        http.ts
        sockets.ts
        rooms/
          RoomManager.ts
          GameRoom.ts
          LobbyState.ts
        net/
          rateLimit.ts
          validation.ts
          snapshotCodec.ts
        observability/
          logger.ts
          metrics.ts
      tests/
        roomLifecycle.test.ts
        protocolValidation.test.ts
        matchIntegration.test.ts
    client/
      package.json
      index.html
      src/
        main.tsx
        app/App.tsx
        net/socketClient.ts
        state/gameStore.ts
        screens/HomeScreen.tsx
        screens/LobbyScreen.tsx
        screens/MatchScreen.tsx
        render/PixiStage.ts
        render/interpolation.ts
        input/inputManager.ts
        ui/
      tests/
        interpolation.test.ts
        inputManager.test.ts
  e2e/
    playwright.config.ts
    lobby-and-match.spec.ts
  load/
    artillery-websocket.yml
  scripts/
    smoke.sh
    seed-replay.ts
```

---

## 5. Implementation Milestones

### Milestone A: Foundations
- Create pnpm monorepo and strict TypeScript configs.
- Add shared protocol/types/constants and Zod validation.
- Add CI-friendly scripts: `lint`, `typecheck`, `test`, `build`.
- Add Dockerfile and `.env.example` early so deploy constraints shape design.

### Milestone B: Deterministic server simulation
- Build physics world factory and fixed tick loop.
- Add player and ball movement.
- Add scoring and kickoff reset.
- Add seeded RNG and deterministic replay test.
- Add power-up box spawning on even turns at top/bottom lanes.

### Milestone C: Rooms and lobby
- Create room codes, join/leave, host, ready state, team selection.
- Lock teams/mode when countdown starts.
- Add reconnect grace and room cleanup TTL.

### Milestone D: Multiplayer networking
- Implement socket protocol validation.
- Add input sequencing and server snapshots.
- Add client interpolation/prediction/reconciliation.
- Add disconnect/resync behavior.

### Milestone E: Game UX
- Build screens and Pixi match renderer.
- Add scoreboard, match-over/rematch flow.
- Add power-up visual pickup/effect indicators.

### Milestone F: Production hardening
- Add observability, health checks, structured logs.
- Add load tests and network degradation tests.
- Add Docker/Coolify deployment docs.
- Add security/rate-limit review.

---

## 6. Testing Checklist

### Unit tests
- `packages/shared`
  - Protocol schema accepts valid messages and rejects malformed payloads.
  - RNG produces stable sequences for a given seed.
- `packages/physics`
  - Goal detection increments only the correct team score.
  - First-to-1/3/5 match-end conditions.
  - Turn counter increments exactly once per kickoff segment.
  - Power-up box spawns only on even turns.
  - Spawn side is top or bottom only.
  - Spawn positions stay inside safe bounds and outside exclusions.
  - Collision handlers collect boxes once and apply effects once.
  - Determinism replay: same seed + same input stream => same final snapshot hash.
- `packages/server`
  - Room code uniqueness and cleanup TTL.
  - Team balancing/team change rules.
  - Host mode changes rejected after countdown.
  - Input seq deduplication and rate limiting.
  - Disconnect/reconnect restores player identity within grace window.
- `packages/client`
  - Input manager emits stable sequence numbers.
  - Interpolation handles missing/out-of-order snapshots.
  - Reconciliation snaps or blends within configured thresholds.

### Integration tests
- Start server in test mode, connect two socket clients, create room, join, choose teams, ready, start match.
- Simulate input stream until goal and assert authoritative score snapshot.
- Assert first-to-1 ends immediately and first-to-3/5 does not end early.
- Assert even-turn power-up spawn event is broadcast to all clients.
- Validate reconnect during match receives current authoritative snapshot.

### Browser E2E tests
- Two Playwright browser contexts create/join same room.
- Verify lobby team selection and ready buttons.
- Verify match canvas loads and scoreboard updates after scripted server test event or deterministic simulation helper.
- Verify match-over screen and rematch flow.

### Load/performance tests
- Artillery/k6 WebSocket scenario:
  - 50 rooms x 4 players for baseline.
  - 100 rooms x 4 players for stress.
  - Track p95 message latency, event loop lag, memory, CPU.
- Soak test for 2+ hours with room churn.
- Acceptance targets for v1:
  - Server tick loop p95 under 16 ms per room batch budget.
  - Snapshot p95 delivery under 150 ms on expected hosting region.
  - No unbounded memory growth after room cleanup.

### Network chaos/manual QA
- Browser throttling: 100 ms latency, 2% packet loss, reconnect.
- Duplicate input messages do not duplicate kicks/power-ups.
- Client clock skew does not affect scoring or spawns.
- Mobile viewport smoke test if supported.

### Security tests
- Fuzz socket payloads with invalid shapes/types/oversized data.
- Verify CORS origins and allowed transport config.
- Verify room code brute-force rate limiting.
- Verify no secrets are baked into client bundle.

---

## 7. Deployment Checklist: Docker + Coolify

### App configuration
- Required env:
  - `NODE_ENV=production`
  - `PORT=3000`
  - `PUBLIC_SERVER_URL=https://<domain>` if client is separate.
  - `CORS_ORIGIN=https://<domain>`
  - `REDIS_URL=` optional for multi-instance.
  - `LOG_LEVEL=info`
- Provide `.env.example` with safe defaults and comments.

### Dockerfile requirements
- Multi-stage build:
  1. `deps`: install pnpm and dependencies with frozen lockfile.
  2. `build`: run typecheck/tests/build.
  3. `runtime`: non-root user, copy built server/client assets only.
- Expose one port, e.g. `3000`.
- Add healthcheck hitting `/healthz`.
- Use `node:22-alpine` or Debian slim if native/WASM dependencies require it.

### Coolify setup
- Create new Docker app from repository.
- Set build pack to Dockerfile.
- Configure domain and HTTPS.
- Enable WebSocket support/proxy upgrade headers if configurable.
- Set env vars in Coolify, not in git.
- Set healthcheck path `/healthz`.
- Start with one replica. If scaling beyond one replica:
  - Add Redis.
  - Enable Socket.IO Redis adapter.
  - Ensure sticky sessions or route all room traffic to owning instance.
- Confirm deploy logs include server version/git SHA and listening port.

### Smoke verification after deploy
Run from a local machine or CI runner:

```bash
curl -fsS https://<domain>/healthz
pnpm --filter @bobble/e2e test -- --project=chromium --grep @smoke
```

Manual production smoke:
- Open two browser windows on the deployed domain.
- Create a room in one, join with code in the other.
- Select opposite teams and first-to-1.
- Ready both players and start match.
- Score one goal.
- Verify winner screen appears and room can rematch or return to lobby.

---

## 8. Production Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Physics nondeterminism or drift | Replays/debugging hard, client prediction jitter | Server is source of truth; deterministic replay hash test for server only; clients interpolate rather than own truth |
| WebSocket scaling across instances | Players in same room split across workers | Single instance for v1; Redis adapter + sticky sessions before horizontal scale |
| Event loop overload with many rooms | Tick lag and bad gameplay | Fixed tick budget metrics, room caps per instance, load tests, autoscaling plan |
| Cheating via position/score injection | Broken competitive integrity | Inputs only protocol, schema validation, cooldown/rate limits, server-owned state |
| Poor network conditions | Rubber-banding/disconnects | Interpolation buffer, input prediction, reconnect grace, resync snapshots |
| Power-up spawn disputes | Inconsistent client views | Server-only seeded RNG; spawn events included in snapshots; replayable seed/input log |
| Coolify proxy/WebSocket misconfig | Clients fail to connect after deploy | Explicit health/smoke tests, websocket upgrade check, documented env/domain config |
| Memory leaks from stale rooms | Server degradation | Room idle TTL, cleanup tests, soak tests, metrics |
| Large snapshots | Bandwidth/latency issues | Compact snapshot codec, send only dynamic state, tune snapshot Hz |

---

## 9. Definition of Done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass locally and in CI.
- Deterministic simulation replay test passes for seeded match fixtures.
- Two-player Playwright E2E can complete a first-to-1 match.
- Load test baseline meets p95 latency and memory targets.
- Docker image builds and runs locally with `/healthz` passing.
- Coolify deployment serves client and WebSocket match successfully over HTTPS.
- Production docs cover env vars, scaling caveats, smoke tests, and rollback.
