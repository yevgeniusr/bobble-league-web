import { io } from 'socket.io-client';

const url = process.env.BOBBLE_URL || 'http://127.0.0.1:3117';
const timeoutMs = Number(process.env.BETABOTS_TIMEOUT_MS || 120000);

function connectBot(name) {
  const socket = io(url, { reconnection: false, timeout: 5000 });
  let state = null;
  let you = '';
  const errors = [];
  socket.on('game:state', (s, id) => { state = s; if (id) you = id; });
  socket.on('room:error', e => errors.push(e));
  return { name, socket, get state() { return state; }, get you() { return you; }, errors };
}
function emitAck(socket, event, payload) {
  return new Promise(resolve => socket.emit(event, payload, resolve));
}
function waitFor(predicate, label, timeout = timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try { if (predicate()) return resolve(true); } catch {}
      if (Date.now() - start > timeout) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function chooseLaunch(state, side, controlled) {
  const bobbles = state.bobbles.filter(b => controlled.includes(b.id));
  const goal = side === 'left' ? { x: 1135, y: 310 } : { x: -35, y: 310 };
  const ball = state.ball;
  const sorted = [...bobbles].sort((a,b)=>dist(a.pos, ball)-dist(b.pos, ball));
  const bobble = sorted[0] || bobbles[0];
  const toGoal = { x: goal.x - ball.x, y: goal.y - ball.y };
  const len = Math.hypot(toGoal.x, toGoal.y) || 1;
  // Aim at the contact point just behind the ball so the launch transfers momentum goalward.
  const target = { x: ball.x - (toGoal.x / len) * 44, y: ball.y - (toGoal.y / len) * 44 };
  const aimAngle = Math.atan2(target.y - bobble.pos.y, target.x - bobble.pos.x);
  return { bobbleId: bobble.id, aimAngle, impulse: 900 };
}
async function main() {
  const alpha = connectBot('Betabot Alpha');
  const beta = connectBot('Betabot Beta');
  await waitFor(() => alpha.socket.connected && beta.socket.connected, 'both bot sockets connected', 10000);
  const created = await emitAck(alpha.socket, 'room:create', { name: 'Betabot Alpha', team: 'pigs', mode: 1 });
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  const joined = await emitAck(beta.socket, 'room:join', { roomCode: created.roomCode, name: 'Betabot Beta', team: 'parrots' });
  if (!joined.ok) throw new Error(`join failed: ${joined.error}`);
  alpha.socket.emit('player:formation', 'slant');
  beta.socket.emit('player:formation', 'box');
  alpha.socket.emit('game:start');
  await waitFor(() => alpha.state?.phase === 'planning' && alpha.state.bobbles.length === 8, 'planning state with 8 bobbles');

  const transcript = [];
  let lastTurn = 0;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = alpha.state;
    if (!state) continue;
    if (state.phase === 'finished') {
      transcript.push(`finished winner=${state.winner} score=${state.score.left}-${state.score.right} turn=${state.turn}`);
      console.log(JSON.stringify({ ok: true, roomCode: state.roomCode, winner: state.winner, score: state.score, turn: state.turn, transcript, alphaErrors: alpha.errors, betaErrors: beta.errors }, null, 2));
      alpha.socket.disconnect(); beta.socket.disconnect();
      return;
    }
    if (state.phase === 'planning' && state.turn !== lastTurn) {
      lastTurn = state.turn;
      const leftPlayer = Object.values(state.players).find(p => p.side === 'left');
      const rightPlayer = Object.values(state.players).find(p => p.side === 'right');
      // Let Alpha attack most turns; Beta blocks every third turn so both bots participate.
      if (state.turn % 3 === 0 && rightPlayer) {
        const intent = chooseLaunch(state, 'right', rightPlayer.controlledBobbleIds);
        beta.socket.emit('player:launch', intent);
        transcript.push(`turn ${state.turn}: beta launched ${intent.bobbleId}`);
      } else if (leftPlayer) {
        const intent = chooseLaunch(state, 'left', leftPlayer.controlledBobbleIds);
        alpha.socket.emit('player:launch', intent);
        transcript.push(`turn ${state.turn}: alpha launched ${intent.bobbleId}`);
      }
    }
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(`Betabots did not finish within ${timeoutMs}ms. Last state: ${JSON.stringify(alpha.state && {phase: alpha.state.phase, turn: alpha.state.turn, score: alpha.state.score, ball: alpha.state.ball})}`);
}
main().catch(err => { console.error(err); process.exit(1); });
