# Bobble League Web Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a production-ready web multiplayer bobble soccer game with Bobble League-style mechanics, original assets, and Coolify deployment.

**Architecture:** React/Vite canvas client connects to an authoritative Node/Express/Socket.IO server. Shared TypeScript rules define physics, scoring, teams, game modes, and box effects. Docker deploys a single web process exposing `/healthz` and static assets.

**Tech Stack:** TypeScript, React, Vite, Socket.IO, Express, Vitest, Docker, Coolify.

---

## Tasks

1. Scaffold project in `/Users/mac/projects/personal/bobble-league-web` with package scripts, Dockerfile, Vite, TS config.
2. Implement shared game rules: field, teams, first-to-1/3/5 modes, players, physics, scoring, box spawn/effects.
3. Implement Socket.IO server: rooms, joins, host start/reset, authoritative tick loop, health check, static serving.
4. Implement React canvas client: lobby, room code, team/mode selection, keyboard controls, game/HUD rendering.
5. Add Vitest coverage for box spawn cadence, modes, and all effects.
6. Build and smoke-test locally.
7. Create public GitHub repo and push `main`.
8. Deploy to Coolify at `bobble.rachkovan.com` and verify `/healthz` + live page.

## Acceptance Criteria

- `npm test` and `npm run build` pass.
- Two browser clients can join the same room and move/kick in real time.
- A mystery box spawns on every even kickoff turn at a random top or bottom lane.
- Ten box effects are implemented: speed, slow, big, tiny, freeze, ghost, magnet, bomb, shield, swap.
- Teams include pigs and parrots plus additional original teams.
- Modes support first to 1, 3, and 5 goals.
- Docker image runs on port 3000 and `/healthz` returns `{ ok: true }`.
