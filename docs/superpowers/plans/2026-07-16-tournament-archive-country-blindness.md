# Tournament Archive, Country XP, and Blindness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browsable landing-page archives for powerups, robot teams, and maps; fix the home-only Loyalty surface; add Blindness; persist account country and aggregate XP by country; and polish robot bodies without losing their physical identities.

**Architecture:** Shared game configuration remains the content source for archive cards and authoritative gameplay. Clerk private metadata stores the ISO country code, the authenticated socket copies it into `PlayerState`, and the server fans each player XP event out to a second `unicup-country:<ISO-2>` profile. Blindness is a side-scoped turn effect in `GameState`; only the affected client renders an interaction-blocking black veil.

**Tech Stack:** React, TypeScript, Socket.IO, Express, Clerk Backend, Xtremepush, Three.js, deterministic Rapier 3D, Vitest, Playwright, Betabots.

## Global Constraints

- Loyalty is mounted only on the landing page and its panel is anchored to the right-side trigger.
- Country is account-only, validated as ISO 3166-1 alpha-2, and never accepted from gameplay event payloads.
- Every server-authoritative player XP event is mirrored to the configured country profile.
- Blindness ends when the current turn ends and never hides the intentional-effect warning.
- Robot visuals and colliders remain distinct; Vector Wedges use a vertical ramp profile and Halo Walkers expose a rotating base.
- Landing archive controls must work with keyboard, touch, and 320px-wide mobile viewports without horizontal page overflow.

---

### Task 1: Shared Archive and Blindness Contracts

**Files:**
- Modify: `shared/types.ts`
- Modify: `shared/game.ts`
- Test: `tests/brand.test.ts`
- Test: `tests/game.test.ts`

**Interfaces:**
- Produces: `BOX_TYPES.blindness`, `GameState.blindnessUntilTurn`, map lore fields, team robot behavior metadata, and `usePowerPlay` blindness behavior.

- [ ] Add failing tests asserting archive-ready copy exists for every powerup, team, and map.
- [ ] Add a failing test asserting Blindness targets only the opposing side through the end of the current turn.
- [ ] Run the focused tests and confirm the missing contracts fail.
- [ ] Add the minimal shared data and server-authoritative effect transition.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Country Account Persistence and XP Fan-out

**Files:**
- Create: `shared/countries.ts`
- Modify: `server/identity.ts`
- Modify: `server/index.ts`
- Modify: `shared/types.ts`
- Modify: `shared/game.ts`
- Modify: `shared/analytics.ts`
- Modify: `server/xtremepush.ts`
- Modify: `client/src/auth.ts`
- Test: `tests/identity.test.ts`
- Test: `tests/analytics.test.ts`

**Interfaces:**
- Produces: `CountryCode`, `ResolvedIdentity.country`, `GET/PUT /api/account/country`, `PlayerState.country`, and `countryAnalyticsEvent(event)`.

- [ ] Add failing normalization, identity metadata, route, and event-fan-out tests.
- [ ] Run focused tests and confirm country behavior is missing.
- [ ] Persist country through the authenticated Clerk adapter and copy it into socket/player state.
- [ ] Fan out player events with `xpSubjectId: unicup-country:<ISO-2>` while preserving the source account in payload metadata.
- [ ] Run focused tests and confirm both account and country event bodies are correct.

### Task 3: Landing Tournament Archive and Account Country UI

**Files:**
- Create: `client/src/landingArchive.tsx`
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Test: `tests/brand.test.ts`
- Test: `scripts/main-menu-check.mjs`

**Interfaces:**
- Consumes: `BOX_TYPES`, `TEAMS`, `MAPS`, `COUNTRIES`, `authHeaders`.
- Produces: accessible `PowerupArchive`, `TeamArchive`, `MapArchive`, and `CountrySelector` UI.

- [ ] Add failing DOM/source contract assertions for archive headings, flip semantics, and account-only country controls.
- [ ] Build three responsive full-width archive bands using actual ability, robot, and field assets.
- [ ] Make powerup cards toggle with buttons using `aria-expanded` and non-animated reduced-motion behavior.
- [ ] Add the country selector with pending, success, failure, and guest-hidden states.
- [ ] Extend the landing browser check for mobile overflow, archive interaction, and persistence.

### Task 4: Home-only Right-anchored Loyalty Surface

**Files:**
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Test: `scripts/main-menu-check.mjs`

**Interfaces:**
- Produces: a visible home trigger, right-anchored panel, dedicated close control, and embedded `mountLoyalty(width, height, host)` lifecycle.

- [ ] Reproduce the floating mount and document that omitting the host creates the left-side vendor overlay.
- [ ] Mount Loyalty into a dedicated panel host only while the landing component is open.
- [ ] Keep the close control outside the cross-origin iframe and reserve header space so balances cannot overlap it.
- [ ] Assert no loyalty trigger or iframe remains after entering a room.

### Task 5: Cute Smooth Robots with Real Motion and Ramp Physics

**Files:**
- Modify: `client/src/render3d.ts`
- Modify: `shared/physics.ts`
- Modify: `public/assets/robots/*.jpg`
- Test: `tests/render3d.test.ts`
- Test: `tests/physics.test.ts`

**Interfaces:**
- Produces: rounded robot geometry, face/antenna details, `robotMotionProfile`, `wedgeColliderVertices`, rotating Halo base, and sloped Vector collider.

- [ ] Add failing profile tests for smoothness, rotating-base ownership, and vertical wedge slope.
- [ ] Replace harsh block geometry with rounded/capsule forms and add compact expressive face elements.
- [ ] Animate Halo base markers from render time while keeping the chassis readable.
- [ ] Build the Vector collider from a six-point vertical wedge and make the renderer match it.
- [ ] Generate and apply softer high-resolution metal surface maps, then inspect every result.

### Task 6: Blindness and Full Verification

**Files:**
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Modify: `public/assets/abilities/blindness.png`
- Modify: `public/assets/manifest.json`
- Modify: `.betabots/cohorts/unicup-archive.json`
- Create: `.betabots/runs/<timestamp>/audience-research.md`

**Interfaces:**
- Consumes: the shared blindness state and all new landing/account controls.
- Produces: the affected-side veil, generated ability art, browser evidence, and Betabots findings.

- [ ] Generate and inspect the Blindness icon.
- [ ] Render the full black veil above all match controls for the affected side, with only the intentional-effect warning visible.
- [ ] Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`.
- [ ] Run multiplayer, all-map render, box, menu, and responsive screenshot checks.
- [ ] Run a research-weighted real-browser Betabots cohort with LLM minds against the local production server.
- [ ] Patch only repeated or high-severity usability failures and rerun the affected journeys.
