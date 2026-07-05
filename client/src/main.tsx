import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { BOX_TYPES, ClientToServerEvents, FIELD, FORMATION_IDS, FORMATIONS, FormationId, GameMode, GameState, PowerPlayUse, ServerToClientEvents, TEAM_IDS, TEAMS, TeamId, Vec } from '../../shared/types';
import './styles.css';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const socket: Sock = io();

function App() {
  const [state, setState] = React.useState<GameState | null>(null);
  const [you, setYou] = React.useState('');
  const [name, setName] = React.useState(() => localStorage.getItem('bobble:name') || `Player${Math.floor(Math.random()*99)}`);
  const [team, setTeam] = React.useState<TeamId>('pigs');
  const [mode, setMode] = React.useState<GameMode>(3);
  const [roomCode, setRoomCode] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    socket.on('game:state', (s, playerId) => { setState(s); if (playerId) setYou(playerId); });
    socket.on('room:error', setError);
    return () => { socket.off('game:state'); socket.off('room:error'); };
  }, []);

  function createRoom() {
    localStorage.setItem('bobble:name', name);
    socket.emit('room:create', { name, team, mode }, res => res.ok ? (setRoomCode(res.roomCode), setError('')) : setError(res.error));
  }
  function joinRoom() {
    localStorage.setItem('bobble:name', name);
    socket.emit('room:join', { roomCode: roomCode.toUpperCase(), name, team }, res => res.ok ? (setError(''), setRoomCode(res.roomCode)) : setError(res.error));
  }

  return <main>
    <section className="panel hero">
      <div><p className="eyebrow">turn-based drag-launch bobble soccer</p><h1>Bobble League Classic</h1><p className="sub">Four bobbles per side, formations, Power Plays, and {state?.config.length ?? 'qualifier'} match rules.</p></div>
      <div className="roomBadge">{state ? `ROOM ${state.roomCode}` : 'CREATE OR JOIN'}</div>
    </section>
    {!state && <section className="panel lobby">
      <label>Your name <input value={name} onChange={e=>setName(e.target.value)} maxLength={18}/></label>
      <label>Team <select value={team} onChange={e=>setTeam(e.target.value as TeamId)}>{TEAM_IDS.map(id=><option key={id} value={id}>{TEAMS[id].emoji} {TEAMS[id].label}</option>)}</select></label>
      <label>Game length <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage: 1 goal / 30 turns</option><option value={3}>Qualifier: 3 goals / 90 turns</option><option value={5}>Champion: 5 goals / 150 turns</option></select></label>
      <button onClick={createRoom}>Create room</button>
      <label>Room code <input value={roomCode} onChange={e=>setRoomCode(e.target.value)} maxLength={8}/></label>
      <button onClick={joinRoom}>Join room</button>
      {error && <p className="error">{error}</p>}
    </section>}
    {state && <><GameCanvas state={state} you={you}/><HUD state={state} you={you} mode={mode} setMode={setMode}/>{error && <section className="panel error">{error}</section>}</>}
  </main>;
}

function HUD({ state, you, mode, setMode }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void }) {
  const players = Object.values(state.players);
  const me = state.players[you];
  const inventory = me ? state.powerPlayInventories[me.side] : [];
  return <section className="panel hud">
    <div className="score"><b>Left</b><span>{state.score.left}</span><small>{state.config.length}: first to {state.config.goalTarget}, turn {state.turn}/{state.config.maxTurns} · {state.phase}</small><span>{state.score.right}</span><b>Right</b></div>
    <div className="actions"><button onClick={()=>socket.emit('game:start')}>{state.phase === 'lobby' ? 'Start match' : 'Restart kickoff'}</button><select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage</option><option value={3}>Qualifier</option><option value={5}>Champion</option></select><button onClick={()=>socket.emit('game:reset', mode)}>Reset</button></div>
    {me && <div className="actions formations">Formation {FORMATION_IDS.map(id=><button key={id} className={state.formations[me.side]===id?'selected':''} onClick={()=>socket.emit('player:formation', id)} title={FORMATIONS[id].description}>{FORMATIONS[id].label}</button>)}</div>}
    {me && <div className="inventory"><b>Power Plays</b>{inventory.length ? inventory.map((item, i)=><button key={`${item.type}-${i}`} disabled={item.availableTurn > state.turn} onClick={()=>useInventory(item.type as keyof typeof BOX_TYPES, state, me.side)}>{BOX_TYPES[item.type].label}{item.availableTurn > state.turn ? ` (turn ${item.availableTurn})` : ''}</button>) : <small>No Power Plays yet. Run a bobble into the ? box.</small>}</div>}
    <div className="players">{players.map(p=><div key={p.id} className={p.id===you?'me':''}>{TEAMS[p.team].emoji} {p.name} <small>{p.side}</small> <small>{p.controlledBobbleIds.join(', ') || 'spectating'}</small></div>)}</div>
    <div className="events">{state.events.map((e,i)=><p key={i}>{e.message}</p>)}</div>
  </section>;
}

function useInventory(type: keyof typeof BOX_TYPES, state: GameState, side: 'left' | 'right') {
  const own = state.bobbles.find(b => b.side === side);
  const use: PowerPlayUse = { type, targetBobbleId: own?.id, position: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: side === 'left' ? 0 : Math.PI };
  socket.emit('player:power', use);
}

function GameCanvas({ state, you }: { state: GameState; you: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = React.useState<{ bobbleId: string; start: Vec; current: Vec } | null>(null);
  const me = state.players[you];

  React.useEffect(() => {
    const canvas = ref.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1;
    canvas.width = FIELD.width * dpr; canvas.height = FIELD.height * dpr; canvas.style.aspectRatio = `${FIELD.width}/${FIELD.height}`;
    const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(ctx, state, you, drag);
  }, [state, you, drag]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * FIELD.width, y: ((e.clientY - rect.top) / rect.height) * FIELD.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!me || state.phase !== 'planning') return;
    const p = point(e);
    const bobble = state.bobbles.find(b => me.controlledBobbleIds.includes(b.id) && Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 10);
    if (bobble) { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ bobbleId: bobble.id, start: bobble.pos, current: p }); }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => { if (drag) setDrag({ ...drag, current: point(e) }); };
  const up = () => {
    if (!drag) return;
    const dx = drag.start.x - drag.current.x, dy = drag.start.y - drag.current.y;
    const impulse = Math.min(900, Math.max(1, Math.hypot(dx, dy) * 6));
    socket.emit('player:launch', { bobbleId: drag.bobbleId, aimAngle: Math.atan2(dy, dx), impulse });
    setDrag(null);
  };
  return <canvas className="field" ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>setDrag(null)} aria-label="Bobble League field"/>;
}

function draw(ctx: CanvasRenderingContext2D, state: GameState, you: string, drag: { bobbleId: string; start: Vec; current: Vec } | null) {
  ctx.clearRect(0,0,FIELD.width,FIELD.height);
  drawArena3D(ctx);
  for (const obj of state.fieldObjects) {
    if (obj.pos.x < 0) continue;
    ctx.save();
    ctx.translate(obj.pos.x, obj.pos.y);
    ctx.rotate(obj.angle);
    drawShadow(ctx, 0, 12, 38, 12, .22);
    const fill = obj.type === 'stickyGoo' ? 'rgba(132,204,22,.70)' : obj.type === 'block' ? '#dbeafe' : obj.type === 'ramp' ? '#a78bfa' : '#38bdf8';
    ctx.fillStyle = fill; roundRect(ctx,-30,-16,60,30,7); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.35)'; roundRect(ctx,-25,-13,50,8,4); ctx.fill();
    ctx.restore();
  }
  for (const box of state.boxes) {
    const spec=BOX_TYPES[box.type];
    drawShadow(ctx, box.pos.x, box.pos.y + 18, 25, 8, .32);
    const g = ctx.createLinearGradient(box.pos.x-18, box.pos.y-20, box.pos.x+18, box.pos.y+20);
    g.addColorStop(0, '#fff7'); g.addColorStop(.18, spec.color); g.addColorStop(1, '#111827');
    ctx.fillStyle=g; ctx.shadowColor=spec.color; ctx.shadowBlur=20; roundRect(ctx, box.pos.x-19, box.pos.y-22,38,38,9); ctx.fill(); ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(255,255,255,.65)'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#fff'; ctx.font='900 20px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('?', box.pos.x, box.pos.y-2);
  }
  for (const b of state.bobbles) {
    const player = Object.values(state.players).find(p => p.side === b.side && p.controlledBobbleIds.includes(b.id)) ?? Object.values(state.players).find(p => p.side === b.side);
    const t = TEAMS[player?.team ?? 'pigs'];
    const selected = state.players[you]?.controlledBobbleIds.includes(b.id) ?? false;
    drawBobble3D(ctx, b.pos.x, b.pos.y, b.radius, t.primary, t.secondary, t.emoji, selected);
    ctx.font='800 12px Inter, sans-serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,.95)'; ctx.fillText(b.id,b.pos.x,b.pos.y-b.radius-15);
    for (const e of b.effects) ctx.fillText(BOX_TYPES[e.type].label,b.pos.x,b.pos.y+b.radius+17);
  }
  if (drag) {
    ctx.strokeStyle='#fef08a'; ctx.lineWidth=5; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(drag.start.x, drag.start.y); ctx.lineTo(drag.current.x, drag.current.y); ctx.stroke(); ctx.setLineDash([]);
    drawShadow(ctx, drag.start.x, drag.start.y + 24, 30, 8, .25);
  }
  const ball = state.ball;
  drawShadow(ctx, ball.pos.x, ball.pos.y + ball.radius + 8, ball.radius * 1.15, 5, .28);
  const ballGrad = ctx.createRadialGradient(ball.pos.x - 6, ball.pos.y - 8, 2, ball.pos.x, ball.pos.y, ball.radius + 5);
  ballGrad.addColorStop(0, '#ffffff'); ballGrad.addColorStop(.65, '#e5e7eb'); ballGrad.addColorStop(1, '#64748b');
  ctx.fillStyle=ballGrad; ctx.beginPath(); ctx.arc(ball.pos.x,ball.pos.y,ball.radius,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#111827'; ctx.lineWidth=2; ctx.stroke();
  if (state.phase==='finished') { ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,FIELD.width,FIELD.height); ctx.fillStyle='#fff'; ctx.font='800 56px Inter,sans-serif'; ctx.textAlign='center'; ctx.fillText(state.winner ? `${state.winner.toUpperCase()} WINS!` : 'DRAW!',FIELD.width/2,FIELD.height/2); }
}
function drawArena3D(ctx: CanvasRenderingContext2D) {
  const grad = ctx.createLinearGradient(0,0,FIELD.width,FIELD.height); grad.addColorStop(0,'#22a05a'); grad.addColorStop(.55,'#13753f'); grad.addColorStop(1,'#0b3b2e'); ctx.fillStyle=grad; ctx.fillRect(0,0,FIELD.width,FIELD.height);
  ctx.fillStyle='rgba(0,0,0,.24)'; ctx.fillRect(0,0,FIELD.width,34); ctx.fillRect(0,FIELD.height-34,FIELD.width,34);
  for (let y=64; y<FIELD.height; y+=82) { ctx.fillStyle = y % 164 === 64 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.035)'; ctx.fillRect(0,y,FIELD.width,41); }
  ctx.strokeStyle='rgba(255,255,255,.38)'; ctx.lineWidth=5; ctx.strokeRect(14,14,FIELD.width-28,FIELD.height-28); ctx.beginPath(); ctx.arc(FIELD.width/2,FIELD.height/2,88,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(FIELD.width/2,14); ctx.lineTo(FIELD.width/2,FIELD.height-14); ctx.stroke();
  ctx.fillStyle='rgba(2,6,23,.34)'; ctx.fillRect(0, FIELD.goalY-10, 52, FIELD.goalHeight+20); ctx.fillRect(FIELD.width-52, FIELD.goalY-10, 52, FIELD.goalHeight+20);
  ctx.strokeStyle='rgba(255,255,255,.22)'; ctx.lineWidth=2; ctx.strokeRect(52, FIELD.goalY-50, 120, FIELD.goalHeight+100); ctx.strokeRect(FIELD.width-172, FIELD.goalY-50, 120, FIELD.goalHeight+100);
}
function drawBobble3D(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, primary: string, secondary: string, emoji: string, selected: boolean) {
  drawShadow(ctx, x, y + r * .82, r * 1.08, r * .30, .34);
  const body = ctx.createRadialGradient(x - r*.35, y - r*.42, 2, x, y, r*1.15);
  body.addColorStop(0, '#ffffff'); body.addColorStop(.12, secondary); body.addColorStop(.45, primary); body.addColorStop(1, '#111827');
  ctx.fillStyle=body; ctx.beginPath(); ctx.ellipse(x, y, r, r*1.03, 0, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = selected ? 6 : 3; ctx.strokeStyle = selected ? '#fef08a' : 'rgba(255,255,255,.55)'; ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(x-r*.24, y-r*.38, r*.24, r*.12, -.45, 0, Math.PI*2); ctx.fill();
  ctx.font = `${Math.max(20,r)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(emoji,x,y+1);
}
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number) { ctx.save(); ctx.fillStyle=`rgba(0,0,0,${alpha})`; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); ctx.restore(); }
function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

createRoot(document.getElementById('root')!).render(<App />);
