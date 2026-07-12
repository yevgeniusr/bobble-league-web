# Clerk Accounts And Guests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clerk accounts without blocking guest play, preserve a browser guest's canonical Unicup identity when it upgrades to Clerk, and use that identity for gameplay analytics and Loyalty.

**Architecture:** The Express server resolves every visitor to a canonical account ID. Signed-out visitors receive an HMAC-signed HttpOnly guest cookie; a Clerk user adopts that guest ID on first sign-in through Clerk private metadata, so later devices resolve to the same ID. The client obtains the canonical session before connecting Socket.IO, and the server independently verifies the Clerk token or guest cookie for API and socket requests.

**Tech Stack:** React/Vite, Clerk React and Backend SDKs, Express, Socket.IO, TypeScript, Vitest, Xtremepush Loyalty.

## Global Constraints

- Clerk application: `app_3GPaOBdF5BlHKSNaupSsOe7Lsp0`.
- Guests can create and join matches without signing in.
- `CLERK_SECRET_KEY` remains server-only; `VITE_CLERK_PUBLISHABLE_KEY` is the only Clerk client key.
- Display names are profile data, never identity keys.
- Existing signed guest cookies remain accepted.
- Do not read or print `.env` values.

---

### Task 1: Canonical Identity Service

**Files:**
- Create: `server/identity.ts`
- Modify: `server/loyalty.ts`
- Test: `tests/identity.test.ts`

**Interfaces:**
- Produces: `createIdentityService(options)` with `resolve({ authorization, cookieHeader })` returning `{ accountId, kind, clerkUserId?, guestCookie? }`.
- Produces: `issueTokenForUser(accountId, nowSeconds)` in the Loyalty service.

- [ ] Write failing tests for stable guests, verified Clerk users, guest-to-Clerk adoption, and invalid token fallback.
- [ ] Run `npm test -- --run tests/identity.test.ts` and confirm missing-service failures.
- [ ] Implement signed guest resolution and injected Clerk verification/metadata persistence.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Server API, Socket, Analytics, And Loyalty Identity

**Files:**
- Modify: `server/index.ts`
- Modify: `server/xtremepush.ts`
- Modify: `shared/types.ts`
- Modify: `shared/game.ts`
- Modify: `shared/analytics.ts`
- Test: `tests/analytics.test.ts`
- Test: `tests/identity.test.ts`

**Interfaces:**
- Consumes: the canonical identity service from Task 1.
- Produces: `GET /api/identity`, authenticated Socket.IO `socket.data.accountId`, and analytics payload `accountId`.

- [ ] Write failing tests proving canonical IDs override nickname-derived Xtremepush IDs.
- [ ] Run focused tests and confirm the old nickname behavior fails them.
- [ ] Add `accountId` to players and analytics; verify API/socket tokens server-side.
- [ ] Make `/api/loyalty/token` sign the canonical account ID.
- [ ] Run focused analytics and identity tests.

### Task 3: Clerk React And Guest-Friendly Controls

**Files:**
- Create: `client/src/auth.tsx`
- Modify: `client/src/main.tsx`
- Modify: `client/src/styles.css`
- Modify: `client/src/vite-env.d.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `AuthSessionProvider`, `useUnicupIdentity()`, and `AccountControls`.
- Supplies: `{ accountId, kind, getToken }` before room actions and Loyalty mounting.

- [ ] Write failing tests for guest headers and signed-in bearer headers.
- [ ] Run the focused tests and confirm missing helpers fail.
- [ ] Wrap the app in `ClerkProvider`, delay socket connection until identity resolution, and add sign-in/sign-up/user controls.
- [ ] Keep guest play as the primary immediate action and show account creation as progress protection.
- [ ] Run focused tests and browser-check desktop/mobile layouts.

### Task 4: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `deploy.intent.yaml`

**Interfaces:**
- Documents: required public and secret Clerk deployment variables and the guest-upgrade lifecycle.

- [ ] Run `clerk doctor` without exposing environment values.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
- [ ] Start the application and test guest room entry plus visible Clerk controls.
- [ ] Record any Clerk Dashboard or production-domain configuration still requiring user action.
