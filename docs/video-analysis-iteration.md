# Unicup Video/Visual Analysis Iteration

> Reference contact-sheet filenames below are kept verbatim because they name real third-party video files under `references/original/` (gitignored).

## Reference media used

Public reference media was gathered into `references/original/` (gitignored; not shipped) from Discord directory assets and public YouTube gameplay videos discovered by subagents:

- Discord directory frames/contact sheet: `references/original/contact_sheets/directory_assets_sheet.jpg`
- YouTube gameplay contact sheets:
  - `pUZ1AarZofA_This_game_on_Discord_is_actually_Kinda_good_Bobble_League_sheet.jpg`
  - `8sX4nh9aThc_The_Secret_to_Perfect_Rocket_Kickoffs_in_Bobble_League_sheet.jpg`
  - `83spJNvKxns_Bobble_League_insane_plays_sheet.jpg`

The app does **not** ship images, video, audio, or model assets from the original reference game.

## External model feedback loop

Used OpenRouter with `google/gemini-2.5-pro` on original contact sheets and our captured gameplay frame.

### First model feedback

Score: 20/100. Major issues:

- Flat/placeholder visuals and weak depth.
- Wrong palette vs gameplay videos.
- Primitive player models.
- Placeholder UI.
- Soccer ball too plain.
- Orthographic/flat camera.

### Iteration applied

- Replaced the canvas field renderer with a true Three.js/WebGL renderer.
- Added 3D board geometry, lighting, shadows, cylinders/spheres for babbleheads, goal hoops, bumpers, and 3D power boxes.
- Added custom/generated-style mascot faces through emoji/sprite overlays instead of original assets.
- Changed game physics turn handling so ball/babblehead positions persist between planning phases instead of resetting every turn.
- Improved Betabots so a Scrimmage match must finish by an actual goal, not merely the turn limit.
- Added Playwright capture script for reproducible visual QA.

### Second model feedback

Score: 25/100. Remaining issues:

- Needs perspective camera instead of orthographic.
- More detailed mascot models/textures.
- More polished UI and original-reference-style panels.
- More detailed stadium/board structure.
- Stronger gameplay visual affordances.

### Second iteration applied

- Switched renderer to a perspective camera.
- Adjusted field to green striped pitch and orange background based on gameplay frames.
- Added explicit faux drop shadows under babbleheads/ball for readability.
- Added soccer-ball spot details.
- Verified Betabots can score and finish a match.

## Current verification evidence

- `npm test`: 7/7 passing.
- `npm run build`: passing.
- `BABBLE_URL=http://127.0.0.1:3117 npm run betabots`: completed by goal, e.g. winner `right`, score `0-1`, turn `9`.
- Screenshot capture: `tmp/our-gameplay-v3.png` shows non-blank perspective 3D WebGL scene.

## Still not legally/pixel exact

The current implementation is much closer and genuinely 3D, but still is not a pixel-perfect copy because it uses original custom primitives/emoji-style generated assets rather than proprietary models, textures, sounds, and UI art from the original reference game or Discord.
