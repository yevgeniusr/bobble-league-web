# Bobble League Visual Comparison

Reference sources used:

- Discord App Directory static API for app `947957217959759964`.
- Public directory screenshots:
  - `https://app-directory-assets.discordactivities.com/bobble-league/directory_02.png`
  - `https://app-directory-assets.discordactivities.com/bobble-league/directory_03.png`
  - `https://app-directory-assets.discordactivities.com/bobble-league/directory_04.png`
  - `https://app-directory-assets.discordactivities.com/bobble-league/directory_01.gif`

## Original gameplay characteristics observed

- Full-screen 16:9 cartoon 3D tabletop board.
- Split blue/red background outside the play surface.
- Cream/yellow rounded raised board rim around a cyan/turquoise striped field.
- Top HUD with left score, right score, central turns counter, small Bobble League logo, settings button.
- Bottom brown action/timeline bar with cream buttons.
- Curved red/pink goal hoops at both ends.
- Round corner bumpers.
- Bobbles are squat 3D mascot cylinders with shadows; team colors appear on the base/body.
- Ball uses soccer-ball visuals and shadow.
- Aiming uses drag trajectory/arrow lines.
- Power Play boxes are glossy raised square/rectangular objects.

## Current clone status

Implemented to match the public reference composition closely while using original drawn assets:

- Full-screen 16:9 field view.
- Blue/red split background.
- Cream/yellow rounded field rim and cyan striped playfield.
- Top score/turn/logo/settings HUD drawn directly on canvas.
- Bottom action bar drawn directly on canvas.
- Curved goal hoops and corner bumpers.
- Squat 3D-style bobbles with shadows and team-color bases.
- Soccer ball with shadow.
- Drag-launch planning/resolving turn flow, formations, 4 bobbles/team, Power Plays, and game lengths.

## Known non-1:1 limitations

The implementation intentionally does **not** copy proprietary Discord/Bobble League art assets, models, sounds, or exact logo files. It recreates the layout, composition, and mechanics with original canvas-drawn visuals. Exact pixel-level identity would require licensed access to the original art/model/audio assets and deeper physics calibration from source or frame-accurate gameplay capture.
