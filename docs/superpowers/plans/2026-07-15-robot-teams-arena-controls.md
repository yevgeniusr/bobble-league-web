# Robot Teams, Arena, and Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic player presentation with four physically distinct robot teams, simplify the arena to its high-fidelity playable surface, and make abilities and formations immediate on desktop and mobile.

**Architecture:** Keep the existing stable team IDs and authoritative server model, but attach a robot visual/physics profile to each team. The Three.js renderer consumes the visual profile, Rapier consumes the collider/density/restitution profile, and the React HUD consumes the same labels, traits, ability inventory, and formation layout data. Generated robot surface maps remain raster assets; formation diagrams are rendered from authoritative layout coordinates so they cannot drift from gameplay.

**Tech Stack:** TypeScript, React, Three.js, Rapier 3D, Socket.IO, Vitest, Playwright, image generation, Betabots.

## Global Constraints

- Preserve the four stable internal team IDs for protocol compatibility.
- Each player holds at most one Power Play; a new pickup replaces their previous item.
- Team physics differences must be visible, bounded, and available to every player before kickoff.
- Remove decorative outer deck, skyline buildings, and pylons from the match scene.
- Keep all authoritative barriers, goals, bumpers, and field coordinates unchanged.
- Formation selection must be available without opening settings.
- Mobile must have no horizontal overflow and must keep ability, formation, and turn controls tappable.
- Finish with a real-browser Betabots cohort and save its evidence under `.betabots/runs/`.

---

### Task 1: Shared Robot and Formation Contracts

**Files:**
- Modify: `shared/types.ts`
- Modify: `shared/game.ts`
- Test: `tests/brand.test.ts`
- Test: `tests/game.test.ts`

**Interfaces:**
- Produces: `RobotShape`, `RobotProfile`, `TEAMS[team].robot`, and exported `FORMATION_LAYOUTS`.
- Consumes: Existing `TeamId`, `FormationId`, and `Vec` contracts.

- [ ] **Step 1: Write failing tests** asserting four unique robot shapes, unique texture paths, bounded density/restitution values, useful trait copy, and shared formation coordinates for all seven formations.
- [ ] **Step 2: Run targeted tests** with `npm test -- tests/brand.test.ts tests/game.test.ts` and confirm failures describe the missing robot profiles/layout export.
- [ ] **Step 3: Add robot profiles and formation layouts** while keeping stable IDs; update team names to robot-team names and make `placeFormation` consume `FORMATION_LAYOUTS`.
- [ ] **Step 4: Run targeted tests** and confirm they pass.

### Task 2: Robot Physics

**Files:**
- Modify: `shared/physics.ts`
- Test: `tests/physics.test.ts`

**Interfaces:**
- Consumes: `TEAMS[state.sideTeams[babble.side]].robot`.
- Produces: `robotColliderKind(state, babble)` and team-aware Rapier collider creation.

- [ ] **Step 1: Write failing tests** proving cache identity changes with team selection and all four collider kinds are reachable.
- [ ] **Step 2: Run the physics test file** and confirm failures occur because every babble still uses a sphere and team is absent from the cache key.
- [ ] **Step 3: Implement colliders** for orb, rounded block, wedge prism, and elongated capsule footprint; apply bounded team density and restitution multipliers.
- [ ] **Step 4: Run physics tests** and the full game suite.

### Task 3: Generated Robot Surface Assets

**Files:**
- Create: `public/assets/robots/*.jpg`
- Create: `public/assets/teams/*-robot.webp`
- Modify: `public/assets/manifest.json`
- Modify: `public/assets/README.md`

**Interfaces:**
- Produces: Four 1:1 robot portrait/material assets referenced by `TEAMS`.

- [ ] **Step 1: Generate four robot concepts** with distinct silhouettes and close-up metal panel detail using built-in image generation.
- [ ] **Step 2: Convert selected outputs** to optimized JPEG material maps and WebP roster portraits in the workspace.
- [ ] **Step 3: Validate dimensions and file sizes** and register stable public paths.

### Task 4: Three.js Robot Rendering and Compact Arena

**Files:**
- Modify: `client/src/render3d.ts`
- Test: `tests/render3d.test.ts`

**Interfaces:**
- Consumes: Team robot profile and generated surface map.
- Produces: Four geometry builders aligned with the four Rapier footprints.

- [ ] **Step 1: Write failing renderer tests** requiring no skyline/pylon props, a narrow court presentation envelope, and four unique robot silhouettes.
- [ ] **Step 2: Run renderer tests** and confirm the current exterior geometry/shared humanoid expectations fail.
- [ ] **Step 3: Remove outer decks, skyline, pylons, and floating chest crests;** retain only a thin textured frame around the field, goals, barriers, and bumpers.
- [ ] **Step 4: Build textured robots** for orb, block, wedge, and walker silhouettes, including distinct heads, bases, and surface maps.
- [ ] **Step 5: Tighten camera framing** and enlarge robot presentation in portrait view without changing field coordinates.
- [ ] **Step 6: Run renderer tests** and capture all four teams in a real browser.

### Task 5: Immediate Ability and Formation Controls

**Files:**
- Create: `client/src/gameUiModel.ts`
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Test: `tests/gameUiModel.test.ts`
- Modify: `scripts/capture-hud.mjs`

**Interfaces:**
- Produces: `heldPowerPlayForPlayer(state, playerId)` and `FormationDock`.
- Consumes: `FORMATION_LAYOUTS`, player-owned inventory item, and existing power-use flow.

- [ ] **Step 1: Write failing UI-model tests** requiring exactly the current player's item, ignoring teammate items, and exposing the locked-until-turn state.
- [ ] **Step 2: Run the UI-model test** and confirm the helper is missing.
- [ ] **Step 3: Replace the mystery-box toggle** with the held item icon; a single click immediately uses instant powers or enters placement/target mode.
- [ ] **Step 4: Add the formation dock** to the bottom center during lobby/formation-selection turns with tactical diagrams derived from `FORMATION_LAYOUTS`.
- [ ] **Step 5: Remove formation selection from settings** and enforce `overflow-x: hidden` plus shrinkable settings rows.
- [ ] **Step 6: Enlarge mobile HUD, robots, ability control, formation buttons, and turn control.**
- [ ] **Step 7: Restyle the central timer module** as a dark tournament command crest with stronger score/turn hierarchy.

### Task 6: Verification and Betabots

**Files:**
- Modify: `scripts/stage2-render-check.mjs`
- Create: `.betabots/runs/<timestamp>/audience-research.md`
- Create: `.betabots/runs/<timestamp>/cohort.json`
- Create: `.betabots/runs/<timestamp>/raw/*.md`
- Create: `.betabots/runs/<timestamp>/summary.json`
- Create: `.betabots/runs/<timestamp>/analysis.md`
- Create: `.betabots/runs/<timestamp>/changes.md`
- Create: `.betabots/runs/<timestamp>/rerun.md`

**Interfaces:**
- Consumes: Production server URL and browser-visible UI only.
- Produces: Build/test evidence, screenshots, pixel checks, and persona-grounded UX findings.

- [ ] **Step 1: Run unit, lint, typecheck, and build checks.**
- [ ] **Step 2: Run multiplayer and all-map render checks.**
- [ ] **Step 3: Capture desktop and mobile screenshots** and assert no horizontal overflow, no blank canvas, visible formation dock, and direct held-ability icon.
- [ ] **Step 4: Write audience assumptions** for mobile-first casual multiplayer players and create a weighted cohort.
- [ ] **Step 5: Run real-browser Betabots** against the local production server with LLM minds enabled.
- [ ] **Step 6: Patch repeated high-severity issues** and rerun the affected cohort journeys.
