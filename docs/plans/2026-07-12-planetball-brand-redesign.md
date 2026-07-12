# PlanetBall Brand Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brand Unicup around PlanetBall and Unicap, rebuild the playable landing, and reskin the procedural game presentation without changing multiplayer behavior.

**Architecture:** Add a typed client-side brand registry for canonical copy and generated asset paths. Recompose the existing React menu around one playable Tournament Desk, then replace the accumulated stylesheet with a coherent responsive system. Keep server state and physics contracts stable while changing only safe `MapConfig.theme` values and render-only Three.js geometry/materials.

**Tech Stack:** React, TypeScript, Vite, Three.js, Socket.IO, Vitest, Playwright, generated PNG artwork.

## Global Constraints

- Preserve all Socket.IO event names, payloads, map IDs, team IDs, ability IDs, physics, collider geometry, camera framing, and pointer semantics.
- Preserve exactly one Xtremepush Loyalty widget mount and every security/readiness behavior in `LoyaltyWidget`.
- Keep `Create room`, `Join room`, `Start match`, `Main menu`, `.roomCodeValue`, `.menuRoomCode`, `.mapSelect`, `.codeInput`, `.loyaltyCard`, `.menuToggle`, `canvas.threeField`, `.inventory`, and `.readyBtn` compatible with current browser checks.
- Monetization language must state cosmetics only and no pay-to-win power.
- Generated art must contain no text, watermark, copied character, weapon, arm, or hand.

---

### Task 1: Brand Contract And Assets

**Files:**
- Create: `client/src/brand.ts`
- Create: `tests/brand.test.ts`
- Create: `public/assets/brand/planetball-hero-desktop.png`
- Create: `public/assets/brand/planetball-hero-mobile.png`
- Create: `public/assets/brand/road-to-ball-office.png`
- Modify: `public/assets/manifest.json`

**Interfaces:**
- Produces: `UNICUP_BRAND` with `name`, `tagline`, `mission`, `art`, `principles`, and `future` fields.

- [ ] **Step 1: Write a failing test** asserting the canonical name, no-pay-to-win promise, and three `/assets/brand/*.png` paths.
- [ ] **Step 2: Run `npm test -- tests/brand.test.ts`** and confirm failure because `client/src/brand.ts` does not exist.
- [ ] **Step 3: Add the typed registry and copy the three generated PNGs** into `public/assets/brand`.
- [ ] **Step 4: Update `public/assets/manifest.json`** with stable brand-art paths.
- [ ] **Step 5: Run `npm test -- tests/brand.test.ts`** and confirm the contract passes.

### Task 2: Playable Landing And Lore

**Files:**
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Modify: `client/index.html`
- Modify: `scripts/main-menu-check.mjs`

**Interfaces:**
- Consumes: `UNICUP_BRAND` from Task 1.
- Produces: one responsive landing containing `LandingHero`, `TournamentDesk`, `LoreSections`, and the existing single `LoyaltyWidget` instance.

- [ ] **Step 1: Extend the main-menu browser check** to require the `Unicup` H1 and `No hands. No weapons. All skill.` copy.
- [ ] **Step 2: Run `npm run menu-check`** and confirm the new assertions fail against the old Babble landing.
- [ ] **Step 3: Recompose the no-state branch in `main.tsx`** while retaining every input, selector, handler, storage key, error state, and Loyalty mount.
- [ ] **Step 4: Replace the legacy CSS cascade** with the flat PlanetBall responsive design and constrained desktop/mobile layouts.
- [ ] **Step 5: Update document metadata and run `npm run menu-check`** until the interaction and brand assertions pass.

### Task 3: World And Arena Reskin

**Files:**
- Modify: `shared/types.ts`
- Modify: `client/src/render3d.ts`
- Modify: `tests/render3d.test.ts`

**Interfaces:**
- Consumes: existing `MapConfig.theme`, `TEAMS`, renderer coordinate helpers, and collider-derived metrics.
- Produces: lore-facing map/team labels and render-only PlanetBall arena, character, ball, mystery capsule, and exterior decoration changes.

- [ ] **Step 1: Add failing render tests** for decorative geometry helpers that keep skyline props outside the field and resource pylons behind the far rim.
- [ ] **Step 2: Run `npm test -- tests/render3d.test.ts`** and confirm the helper exports are missing.
- [ ] **Step 3: Update safe map labels/descriptions/themes and team presentation** without changing IDs, layouts, physics, or ability contracts.
- [ ] **Step 4: Implement renderer-only decorations and material changes** while preserving goal metrics, bumper footprints, player head center, and camera.
- [ ] **Step 5: Run `npm test -- tests/render3d.test.ts`** and confirm all renderer contracts pass.

### Task 4: Verification And Visual QA

**Files:**
- Modify only if a verification failure identifies a defect.
- Create screenshots under: `output/playwright/`

**Interfaces:**
- Consumes: the complete redesign.
- Produces: reproducible verification evidence and desktop/mobile/game screenshots.

- [ ] **Step 1: Run `npm test`.** Expected: all Vitest tests pass.
- [ ] **Step 2: Run `npm run typecheck && npm run lint && npm run build`.** Expected: all commands exit zero.
- [ ] **Step 3: Run `npm run menu-check`.** Expected: room creation, one-click main-menu return, brand copy, and Loyalty container all pass.
- [ ] **Step 4: Capture 1440x900 and 390x844 landing screenshots** and verify no horizontal overflow, clipped controls, or overlapping text.
- [ ] **Step 5: Create a room, start a match, capture the arena/HUD, and verify the WebGL canvas has nontrivial pixel variance.**
- [ ] **Step 6: Review `git diff --check`, `git status --short`, and the final diff** for unrelated or secret-bearing changes.
