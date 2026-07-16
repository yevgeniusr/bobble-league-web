# Unicup Cheat Sheet

Unicup cheats are developer tools for testing Power Play boxes. They are
available only from the browser console and have no in-game cheat menu. The API
is available in local and production builds.

## Use

1. Start the app:

   ```sh
   npm run dev
   ```

2. Open the app, create or join a room, and open the browser developer console.
3. List the supported box IDs:

   ```js
   window.__babbleDev.listTypes()
   ```

4. Give your current player one box:

   ```js
   window.__babbleDev.grantBox('swapGoals')
   ```

5. Use the box from the Power Play control in the match HUD. Boxes that need a
   field position or robot target will prompt for that target normally.

To grant every box for a broad interaction test:

```js
window.__babbleDev.grantAll()
```

`grantAll()` deliberately bypasses the normal one-box pickup rule and should be
used only for testing. `grantBox()` will not add a duplicate while the same
unused box is already in your inventory.

## Box IDs

| ID | Power Play |
| --- | --- |
| `beachBall` | Beach Ball |
| `moveBall` | Move Ball |
| `swapGoals` | Swap Goals |
| `bigBumpers` | Big Bumpers |
| `boost` | Boost |
| `stickyGoo` | Sticky Goo |
| `ramp` | Trampoline |
| `block` | Block |
| `bigHead` | Big Head |
| `ghosted` | Ghosted |
| `movePlayer` | Move Player |
| `yellowCard` | Yellow Card |
| `redCard` | Red Card |
| `readPlay` | Read the Play |
| `blindness` | Blindness |

Accepted legacy aliases are `giantball`, `bumppadboost`, `sticky`, `ghost`,
`goalswap`, `bighead`, `yellowcard`, and `redcard`.

## Production

`window.__babbleDev` is exposed in every client build. The public Unicup server
is configured with `ENABLE_CHEATS=true`, so `grantBox()` and `grantAll()` work
there as well as locally. A separately hosted production-mode server must set
the same environment variable to accept grant requests.

## Safeguards

- A player must already be in a room before requesting a box.
- Every successful grant posts a visible `CHEAT MODE` warning to the room.
- Single-box grants are limited to one request every 800 ms per connection.
- Grant-all requests are limited to one request every 5 seconds per connection.
- Swap Goals, Yellow Card, and Red Card reset the planning timer when used.

## Automated checks

Run the complete Power Play browser flow, including disruptive timer resets:

```sh
npm run box-check
```

Confirm that production mode rejects cheats when `ENABLE_CHEATS` is absent:

```sh
node scripts/cheat-gate-check.mjs
```
