import { io } from 'socket.io-client';

const url = process.env.BOBBLE_URL || 'http://127.0.0.1:3117';
const timeoutMs = Number(process.env.BETABOTS_TIMEOUT_MS || 120000);
const requireGoal = process.env.BETABOTS_REQUIRE_GOAL !== '0';
const botCount = Number(process.env.BETABOTS_COUNT || 8);

function connectBot(name) {
  const socket = io(url, { reconnection: false, timeout: 5000 });
  let state = null;
  let you = '';
  const errors = [];
  socket.on('game:state', (s, id) => { state = s; if (id) you = id; });
  socket.on('room:error', e => errors.push(e));
  return { name, socket, get state() { return state; }, get you() { return you; }, errors };
}
function emitAck(socket, event, payload) { return new Promise(resolve => socket.emit(event, payload, resolve)); }
function waitFor(predicate, label, timeout = timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try { if (predicate()) return resolve(true); } catch {}
      if (Date.now() - start > timeout) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 40);
    };
    tick();
  });
}
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function chooseLaunch(state, side, bobbleId) {
  const bobble = state.bobbles.find(b => b.id === bobbleId);
  if (!bobble) return null;
  const ball = state.ball.pos;
  const goal = side === 'left' ? { x: 1142, y: 310 } : { x: -42, y: 310 };
  // Opening play: four players on each side flick together toward the center ball.
  if (Math.abs(ball.x - 550) < 12 && Math.abs(ball.y - 310) < 12) {
    const target = { x: 550, y: 310 };
    return { bobbleId, aimAngle: Math.atan2(target.y - bobble.pos.y, target.x - bobble.pos.x), impulse: bobble.id.endsWith('2') || bobble.id.endsWith('3') ? 900 : 620 };
  }
  const toGoal = { x: goal.x - ball.x, y: goal.y - ball.y };
  const len = Math.hypot(toGoal.x, toGoal.y) || 1;
  const contactBehindBall = { x: ball.x - (toGoal.x / len) * 46, y: ball.y - (toGoal.y / len) * 46 };
  // If far from ball, send outer bobbles on bank-support lines instead of all chasing same point.
  const target = dist(bobble.pos, ball) < 260 ? contactBehindBall : { x: ball.x - (side === 'left' ? 120 : -120), y: ball.y + (bobble.pos.y < ball.y ? -70 : 70) };
  return { bobbleId, aimAngle: Math.atan2(target.y - bobble.pos.y, target.x - bobble.pos.x), impulse: 900 };
}
async function main() {
  if (botCount !== 8) throw new Error('This gate is intentionally configured for 8 Betabots: 4 per team.');
  const bots = Array.from({ length: botCount }, (_, i) => connectBot(`Betabot ${i + 1}`));
  await waitFor(() => bots.every(b => b.socket.connected), 'all 8 bot sockets connected', 10000);
  const created = await emitAck(bots[0].socket, 'room:create', { name: bots[0].name, team: 'pigs', mode: 1 });
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  for (let i = 1; i < bots.length; i++) {
    const team = i % 2 === 0 ? 'pigs' : 'parrots';
    const joined = await emitAck(bots[i].socket, 'room:join', { roomCode: created.roomCode, name: bots[i].name, team });
    if (!joined.ok) throw new Error(`join ${i} failed: ${joined.error}`);
  }
  for (const bot of bots) bot.socket.emit('player:formation', 'forward');
  bots[0].socket.emit('game:start');
  await waitFor(() => bots[0].state?.phase === 'planning' && bots[0].state.bobbles.length === 8, 'planning state with 8 bobbles');
  await waitFor(() => Object.values(bots[0].state.players).filter(p => p.connected).length === 8, '8 connected players');
  const sideCounts = Object.values(bots[0].state.players).reduce((acc, p) => (acc[p.side]++, acc), { left: 0, right: 0 });
  if (sideCounts.left !== 4 || sideCounts.right !== 4) throw new Error(`expected 4v4, saw ${JSON.stringify(sideCounts)}`);
  const distribution = Object.values(bots[0].state.players).map(p => `${p.name}:${p.side}:${p.controlledBobbleIds.join(',')}`);
  for (const p of Object.values(bots[0].state.players)) if (p.controlledBobbleIds.length !== 1) throw new Error(`expected each 4v4 player to control one bobble: ${distribution.join(' | ')}`);

  const transcript = [`distribution ${distribution.join(' | ')}`];
  let lastTurn = 0;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = bots[0].state;
    if (!state) continue;
    if (state.phase === 'finished') {
      transcript.push(`finished winner=${state.winner} score=${state.score.left}-${state.score.right} turn=${state.turn}`);
      if (requireGoal && state.score.left + state.score.right === 0) throw new Error(`Betabots finished without a goal: score=${state.score.left}-${state.score.right} turn=${state.turn}`);
      const errors = bots.flatMap(b => b.errors.map(e => `${b.name}:${e}`));
      if (errors.length) throw new Error(`Betabots saw room errors: ${errors.join('|')}`);
      console.log(JSON.stringify({ ok: true, roomCode: state.roomCode, bots: bots.length, sideCounts, distribution, winner: state.winner, score: state.score, turn: state.turn, transcript, errors }, null, 2));
      bots.forEach(b => b.socket.disconnect());
      return;
    }
    if (state.phase === 'planning' && state.turn !== lastTurn) {
      lastTurn = state.turn;
      let launched = 0;
      for (const bot of bots) {
        const player = state.players[bot.you];
        if (!player) continue;
        for (const bobbleId of player.controlledBobbleIds) {
          const intent = chooseLaunch(state, player.side, bobbleId);
          if (intent) { bot.socket.emit('player:launch', intent); launched++; }
        }
      }
      transcript.push(`turn ${state.turn}: all ${launched} controlled bobbles aimed`);
    }
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`Betabots did not finish within ${timeoutMs}ms. Transcript: ${transcript.join(' | ')}. Last state: ${JSON.stringify(bots[0].state && {phase: bots[0].state.phase, turn: bots[0].state.turn, score: bots[0].state.score, pending: Object.keys(bots[0].state.pendingIntents).length, ball: bots[0].state.ball})}`);
}
main().catch(err => { console.error(err); process.exit(1); });
