# PlanetBall Brand Redesign

## Product Direction

Unicup, short for Universe Cup, is a competitive, handless future sport rather than a generic cute tabletop game. The visual identity combines a flat pop-up storybook composition with anime character energy and toy-like obstacle design. PlanetBall is the recurring silhouette: a huge cobalt soccer-ball world rising into an unbroken signal-yellow sky. Coral tournament infrastructure, aqua broadcast technology, white clouds, and charcoal outlines provide the remaining palette. Generated artwork is original and avoids recognizable third-party characters, logos, or UI.

The memorable promise is **No hands. No weapons. All skill.** It expresses both the lore and the competitive standard. The second narrative hook is the climb: players enter Unicap's fair-looking resource tournaments, climb the leaderboard, reach the Ball Office, and uncover why the supposedly neutral organization is accumulating control. The public tone stays funny and optimistic while the copy introduces institutional tension.

## Landing Experience

The first viewport remains the actual game entry point. On desktop, a full-bleed PlanetBall scene occupies the main canvas and a single flat Tournament Desk occupies the right edge. The title, fair-play promise, and climb objective sit directly on the illustrated sky. The desk preserves nickname, match length, map, audio, room creation, room joining, errors, and exactly one Loyalty widget mount. On mobile, portrait artwork leads into the same desk as a full-width band; the page scrolls instead of compressing controls.

Below the playable first screen, full-bleed sections explain Unicap's origin, the leaderboard climb, future planets and arenas, and the cosmetics-only business model. These are not card grids. Each section uses large color fields, editorial type, illustration, and hard transitions in the grammar of the supplied Refero reference.

## Game Presentation

Three.js remains authoritative only for rendering server snapshots. Physics, collider footprints, camera, picking height, map IDs, and map layouts do not change. The arena becomes a PlanetBall broadcast table through new flat map themes, clean ink-like contrast, Unicap-adjacent exterior architecture, resource pylons, flag shapes, a white-and-cobalt tournament ball, ticket-like power capsules, and more expressive handless player faces and kit details. Team IDs remain stable; safe labels, colors, and emoji presentation can change.

The HUD becomes a sports-broadcast layer: compact scoreboard at the top, strong clock hierarchy, a readable bottom command dock, and a flat settings sheet. Existing class names and button text used by smoke tests remain available. Large controls are constrained so inventories scroll horizontally and never cover the play field incoherently.

## Reliability And Verification

The Loyalty component retains its config fetch, nickname debounce, browser-bound token request, Xtremepush command order, single expiry handler, iframe load path, strict postMessage validation, five-second readiness fallback, and unavailable/error states. The redesign must never render duplicate widget instances.

Verification covers the brand contract, existing unit tests, typecheck, lint, production build, main-menu smoke flow, desktop and mobile landing screenshots, a live match screenshot, and a canvas nonblank/pixel-variance check. Generated assets are stored under `public/assets/brand` and referenced through a typed brand registry so missing or renamed files fail visibly during development.
