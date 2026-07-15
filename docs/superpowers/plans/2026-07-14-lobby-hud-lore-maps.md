# Unicup Lobby, HUD, Lore, And Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver synchronized configurable rounds, visible lobby seating, pre-match side choice, four canonical teams and maps, opponent-move vision, and a mobile-first broadcast HUD with original visual assets.

**Architecture:** Keep all rules authoritative in `shared/game.ts` and validate every lobby mutation in `server/index.ts`. Put canonical team/map/ability metadata in `shared/types.ts`, send a server timestamp with each private snapshot, and redact opponent intents unless the viewer's vision effect is active. Keep Three.js responsible for field rendering while React owns the roster HUD and compact action controls.

**Tech Stack:** TypeScript, React, Socket.IO, Three.js, Rapier 3D, Vitest, Playwright, generated PNG assets.

## Global Constraints

- Round time is an integer from 1 through 60 seconds and defaults to 20 seconds.
- Team and side changes are accepted only while the room is in `lobby`.
- Public maps are exactly PlanetBall, Moon, Coral Foundry, and Saturn.
- Every public map derives its physics multipliers from the selected Original calibration profile.
- Opponent launch intents remain private unless Read the Play is active for the viewer's side.
- The game field remains fully usable on desktop and mobile without a full-width bottom panel.

---

### Task 1: Authoritative Match Configuration And Lobby Rules

**Files:**
- Modify: `shared/types.ts`
- Modify: `shared/game.ts`
- Modify: `server/index.ts`
- Test: `tests/game.test.ts`

**Interfaces:**
- `createInitialState(roomCode, mode, mapId, roundTimeSeconds?)`
- `setRoundTime(state, seconds): boolean`
- `setPlayerSide(state, playerId, side): boolean`
- `redactStateFor(state, viewerId, serverNowAt?)`

- [ ] Add failing tests for the 1/60-second bounds, 20-second default, snapshot server time, lobby-only side changes, lobby babble ownership, four public maps, and private/revealed intents.
- [ ] Run `npm test -- tests/game.test.ts` and confirm the new assertions fail for missing behavior.
- [ ] Add the shared config fields and lobby mutation functions, validate new socket payloads, and include `serverNowAt` in emitted snapshots.
- [ ] Run `npm test -- tests/game.test.ts` and confirm the rule tests pass.

### Task 2: Canonical Teams, Arenas, And Read The Play

**Files:**
- Modify: `shared/types.ts`
- Modify: `shared/game.ts`
- Modify: `client/src/render3d.ts`
- Modify: `public/assets/manifest.json`
- Create: `public/assets/teams/*.png`
- Create: `public/assets/maps/*.png`
- Create: `public/assets/abilities/readPlay.png`
- Test: `tests/brand.test.ts`
- Test: `tests/render3d.test.ts`

**Interfaces:**
- `TEAMS[teamId].crest`
- `MAPS[mapId].art.fieldTexture` and `MAPS[mapId].art.surroundings`
- `GameState.moveVisionUntilTurn`

- [ ] Add failing tests for exactly four crest-backed teams, four art-backed maps, Original-derived physics, and the new Read the Play ability.
- [ ] Generate and save distinct team crests, field textures, surroundings, and the ability icon.
- [ ] Apply Read the Play to intent redaction and render revealed opposing arrows with a distinct treatment.
- [ ] Load map art in the Three.js surface/exterior path with procedural fallback.
- [ ] Run the brand, renderer, and game tests.

### Task 3: Broadcast Roster HUD And Compact Actions

**Files:**
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Modify: `client/src/auth.ts`
- Modify: `server/index.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Create payload fields: `roundTimeSeconds`, optional `avatarUrl`
- Join payload field: optional `avatarUrl`
- Player state field: optional `avatarUrl`

- [ ] Add the host round-time slider and send it during room creation.
- [ ] Replace team emoji selectors with crest buttons and add lobby-only side-choice controls.
- [ ] Redesign the top HUD as two live rosters around the score/clock, including nickname, connection state, avatar or initials, and controlled-piece count.
- [ ] Add in-world nickname labels over controlled babbles.
- [ ] Replace the full-width bottom bar with a lower-left ability button/tray and lower-right finish-turn button.
- [ ] Make settings and both action clusters safe-area aware and responsive at 390x844.

### Task 4: Verification And Documentation

**Files:**
- Modify: `README.md`
- Modify: `public/assets/README.md`

- [ ] Run `npm test`.
- [ ] Run `npm run lint`, `npm run typecheck`, and `npm run build`.
- [ ] Run the multiplayer smoke script against the local server.
- [ ] Use Playwright to capture desktop and mobile lobby/match states, inspect overlap, and verify the WebGL canvas is nonblank.
- [ ] Update documentation for the four maps, four teams, configurable rounds, side selection, and Read the Play.
