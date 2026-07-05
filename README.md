# Bobble League Web

A production-oriented, web-based multiplayer bobble soccer game inspired by Discord party sports games. It uses an authoritative Node/Socket.IO server, a React/Vite canvas client, deterministic shared game rules, multiple teams, first-to-1/3/5 game modes, and mystery box power-ups.

> This implementation recreates the requested mechanics with original code, UI, and vector/emoji-rendered teams. It does not copy proprietary assets.

## Features

- Real-time multiplayer rooms with shareable room codes.
- Authoritative server simulation at 30 ticks/sec.
- Teams: Pigs, Parrots, Penguins, Tigers, Frogs, Foxes.
- Match modes: first to 1, 3, or 5 goals.
- Bobble soccer mechanics: run, dash/kick, bounce, score goals.
- Box spawning: every second kickoff turn creates one random top/bottom lane box.
- Box effects: speed, slow, big, tiny, freeze, ghost, magnet, bomb, shield, swap.
- Responsive web UI and Docker/Coolify-ready deployment.

## Controls

- Move: `WASD` or arrow keys
- Kick/Dash: `Space`

## Development

```bash
npm install
npm run dev
npm test
npm run build
```

Open http://localhost:3000 in two browser windows and join the same room code.

## Production

```bash
npm ci
npm run build
PORT=3000 NODE_ENV=production npm start
```

Health check: `GET /healthz`.

## Docker

```bash
docker build -t bobble-league-web .
docker run --rm -p 3000:3000 bobble-league-web
```
