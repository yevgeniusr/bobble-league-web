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
  const grad = ctx.createLinearGradient(0,0,FIELD.width,FIELD.height); grad.addColorStop(0,'#166534'); grad.addColorStop(1,'#0f3d2e'); ctx.fillStyle=grad; ctx.fillRect(0,0,FIELD.width,FIELD.height);
  ctx.strokeStyle='rgba(255,255,255,.28)'; ctx.lineWidth=4; ctx.strokeRect(8,8,FIELD.width-16,FIELD.height-16); ctx.beginPath(); ctx.arc(FIELD.width/2,FIELD.height/2,88,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(FIELD.width/2,8); ctx.lineTo(FIELD.width/2,FIELD.height-8); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.16)'; ctx.fillRect(0, FIELD.goalY, 42, FIELD.goalHeight); ctx.fillRect(FIELD.width-42, FIELD.goalY, 42, FIELD.goalHeight);
  for (const obj of state.fieldObjects) { if (obj.pos.x < 0) continue; ctx.save(); ctx.translate(obj.pos.x, obj.pos.y); ctx.rotate(obj.angle); ctx.fillStyle = obj.type === 'stickyGoo' ? 'rgba(132,204,22,.55)' : obj.type === 'block' ? '#cbd5e1' : obj.type === 'ramp' ? '#a78bfa' : '#38bdf8'; roundRect(ctx,-28,-14,56,28,6); ctx.fill(); ctx.restore(); }
  for (const box of state.boxes) { const spec=BOX_TYPES[box.type]; ctx.fillStyle=spec.color; ctx.shadowColor=spec.color; ctx.shadowBlur=18; roundRect(ctx, box.pos.x-17, box.pos.y-17,34,34,8); ctx.fill(); ctx.shadowBlur=0; ctx.fillStyle='#111827'; ctx.font='bold 18px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('?', box.pos.x, box.pos.y); }
  for (const b of state.bobbles) {
    const player = Object.values(state.players).find(p => p.side === b.side && p.controlledBobbleIds.includes(b.id)) ?? Object.values(state.players).find(p => p.side === b.side);
    const t = TEAMS[player?.team ?? 'pigs']; ctx.save(); ctx.fillStyle = t.primary; ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.radius,0,Math.PI*2); ctx.fill(); ctx.lineWidth = state.players[you]?.controlledBobbleIds.includes(b.id) ? 6 : 3; ctx.strokeStyle = state.players[you]?.controlledBobbleIds.includes(b.id) ? '#fef08a' : t.secondary; ctx.stroke(); ctx.font = `${Math.max(20,b.radius)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t.emoji,b.pos.x,b.pos.y+1); ctx.font='700 12px Inter, sans-serif'; ctx.fillStyle='#fff'; ctx.fillText(b.id,b.pos.x,b.pos.y-b.radius-10); for (const e of b.effects) ctx.fillText(BOX_TYPES[e.type].label,b.pos.x,b.pos.y+b.radius+13); ctx.restore();
  }
  if (drag) { ctx.strokeStyle='#fef08a'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(drag.start.x, drag.start.y); ctx.lineTo(drag.current.x, drag.current.y); ctx.stroke(); }
  const ball = state.ball; ctx.fillStyle='#f8fafc'; ctx.beginPath(); ctx.arc(ball.pos.x,ball.pos.y,ball.radius,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#111827'; ctx.lineWidth=2; ctx.stroke();
  if (state.phase==='finished') { ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,FIELD.width,FIELD.height); ctx.fillStyle='#fff'; ctx.font='800 56px Inter,sans-serif'; ctx.textAlign='center'; ctx.fillText(state.winner ? `${state.winner.toUpperCase()} WINS!` : 'DRAW!',FIELD.width/2,FIELD.height/2); }
}
function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

createRoot(document.getElementById('root')!).render(<App />);
