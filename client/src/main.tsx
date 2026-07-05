import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { BOX_TYPES, ClientToServerEvents, FIELD, GameMode, GameState, PlayerInput, ServerToClientEvents, TEAM_IDS, TEAMS, TeamId } from '../../shared/types';
import './styles.css';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const socket: Sock = io();
const emptyInput: PlayerInput = { up: false, down: false, left: false, right: false, kick: false };

function App() {
  const [state, setState] = React.useState<GameState | null>(null);
  const [you, setYou] = React.useState('');
  const [name, setName] = React.useState(() => localStorage.getItem('bobble:name') || `Player${Math.floor(Math.random()*99)}`);
  const [team, setTeam] = React.useState<TeamId>('pigs');
  const [mode, setMode] = React.useState<GameMode>(3);
  const [roomCode, setRoomCode] = React.useState('');
  const [error, setError] = React.useState('');
  const inputRef = React.useRef<PlayerInput>({ ...emptyInput });

  React.useEffect(() => {
    socket.on('game:state', (s, playerId) => { setState(s); if (playerId) setYou(playerId); });
    socket.on('room:error', setError);
    return () => { socket.off('game:state'); socket.off('room:error'); };
  }, []);

  React.useEffect(() => {
    const mapKey = (key: string, down: boolean) => {
      const input = inputRef.current;
      if (key === 'w' || key === 'ArrowUp') input.up = down;
      if (key === 's' || key === 'ArrowDown') input.down = down;
      if (key === 'a' || key === 'ArrowLeft') input.left = down;
      if (key === 'd' || key === 'ArrowRight') input.right = down;
      if (key === ' ') input.kick = down;
    };
    const down = (e: KeyboardEvent) => { mapKey(e.key, true); if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault(); };
    const up = (e: KeyboardEvent) => mapKey(e.key, false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    const timer = setInterval(() => socket.emit('player:input', inputRef.current), 1000 / 30);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); clearInterval(timer); };
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
      <div><p className="eyebrow">real-time party soccer</p><h1>Bobble League</h1><p className="sub">Kick, bounce, grab mystery boxes, and race to {state?.mode ?? mode} goals.</p></div>
      <div className="roomBadge">{state ? `ROOM ${state.roomCode}` : 'CREATE OR JOIN'}</div>
    </section>
    {!state && <section className="panel lobby">
      <label>Your name <input value={name} onChange={e=>setName(e.target.value)} maxLength={18}/></label>
      <label>Team <select value={team} onChange={e=>setTeam(e.target.value as TeamId)}>{TEAM_IDS.map(id=><option key={id} value={id}>{TEAMS[id].emoji} {TEAMS[id].label}</option>)}</select></label>
      <label>Game mode <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>First to 1</option><option value={3}>First to 3</option><option value={5}>First to 5</option></select></label>
      <button onClick={createRoom}>Create room</button>
      <label>Room code <input value={roomCode} onChange={e=>setRoomCode(e.target.value)} maxLength={8}/></label>
      <button onClick={joinRoom}>Join room</button>
      {error && <p className="error">{error}</p>}
    </section>}
    {state && <><GameCanvas state={state} you={you}/><HUD state={state} you={you} mode={mode} setMode={setMode}/></>}
  </main>;
}

function HUD({ state, you, mode, setMode }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void }) {
  const players = Object.values(state.players);
  const leftScore = Math.max(0, ...players.filter(p=>p.side==='left').map(p=>p.score));
  const rightScore = Math.max(0, ...players.filter(p=>p.side==='right').map(p=>p.score));
  return <section className="panel hud">
    <div className="score"><b>Left</b><span>{leftScore}</span><small>first to {state.mode}</small><span>{rightScore}</span><b>Right</b></div>
    <div className="actions"><button onClick={()=>socket.emit('game:start')}>{state.phase === 'playing' ? 'Restart kickoff' : 'Start match'}</button><select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>to 1</option><option value={3}>to 3</option><option value={5}>to 5</option></select><button onClick={()=>socket.emit('game:reset', mode)}>Reset</button></div>
    <div className="players">{players.map(p=><div key={p.id} className={p.id===you?'me':''}>{TEAMS[p.team].emoji} {p.name} <small>{p.side}</small> {p.effects.map(e=><em key={e.type}>{BOX_TYPES[e.type].label}</em>)}</div>)}</div>
    <div className="events">{state.events.map((e,i)=><p key={i}>{e.message}</p>)}</div>
  </section>;
}

function GameCanvas({ state, you }: { state: GameState; you: string }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const canvas = ref.current; if (!canvas) return; const dpr = window.devicePixelRatio || 1;
    canvas.width = FIELD.width * dpr; canvas.height = FIELD.height * dpr; canvas.style.aspectRatio = `${FIELD.width}/${FIELD.height}`;
    const ctx = canvas.getContext('2d'); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(ctx, state, you);
  }, [state, you]);
  return <canvas className="field" ref={ref} aria-label="Bobble League field"/>;
}

function draw(ctx: CanvasRenderingContext2D, state: GameState, you: string) {
  ctx.clearRect(0,0,FIELD.width,FIELD.height);
  const grad = ctx.createLinearGradient(0,0,FIELD.width,FIELD.height); grad.addColorStop(0,'#166534'); grad.addColorStop(1,'#0f3d2e'); ctx.fillStyle=grad; ctx.fillRect(0,0,FIELD.width,FIELD.height);
  ctx.strokeStyle='rgba(255,255,255,.28)'; ctx.lineWidth=4; ctx.strokeRect(8,8,FIELD.width-16,FIELD.height-16); ctx.beginPath(); ctx.arc(FIELD.width/2,FIELD.height/2,88,0,Math.PI*2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(FIELD.width/2,8); ctx.lineTo(FIELD.width/2,FIELD.height-8); ctx.stroke();
  ctx.fillStyle='rgba(255,255,255,.16)'; ctx.fillRect(0, FIELD.goalY, 42, FIELD.goalHeight); ctx.fillRect(FIELD.width-42, FIELD.goalY, 42, FIELD.goalHeight);
  for (const p of Object.values(state.players)) {
    const t = TEAMS[p.team]; ctx.save(); ctx.globalAlpha = p.connected ? 1 : .35; ctx.fillStyle = t.primary; ctx.beginPath(); ctx.arc(p.pos.x,p.pos.y,p.radius,0,Math.PI*2); ctx.fill(); ctx.lineWidth = p.id===you ? 6 : 3; ctx.strokeStyle = p.id===you ? '#fef08a' : t.secondary; ctx.stroke(); ctx.font = `${Math.max(20,p.radius)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(t.emoji,p.pos.x,p.pos.y+1); ctx.font='700 13px Inter, sans-serif'; ctx.fillStyle='#fff'; ctx.fillText(p.name,p.pos.x,p.pos.y-p.radius-12); ctx.restore();
    if (p.effects.some(e=>e.type==='shield')) { ctx.strokeStyle=t.secondary; ctx.lineWidth=10; const x=p.side==='left'?30:FIELD.width-30; ctx.beginPath(); ctx.moveTo(x,FIELD.goalY); ctx.lineTo(x,FIELD.goalY+FIELD.goalHeight); ctx.stroke(); }
  }
  for (const box of state.boxes) { const spec=BOX_TYPES[box.type]; ctx.fillStyle=spec.color; ctx.shadowColor=spec.color; ctx.shadowBlur=18; roundRect(ctx, box.pos.x-17, box.pos.y-17,34,34,8); ctx.fill(); ctx.shadowBlur=0; ctx.fillStyle='#111827'; ctx.font='bold 18px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('?', box.pos.x, box.pos.y); }
  const b = state.ball; ctx.fillStyle='#f8fafc'; ctx.beginPath(); ctx.arc(b.pos.x,b.pos.y,b.radius,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#111827'; ctx.lineWidth=2; ctx.stroke();
  if (state.phase==='finished') { ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,FIELD.width,FIELD.height); ctx.fillStyle='#fff'; ctx.font='800 56px Inter,sans-serif'; ctx.textAlign='center'; ctx.fillText(`${state.winner?.toUpperCase()} WINS!`,FIELD.width/2,FIELD.height/2); }
}
function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

createRoot(document.getElementById('root')!).render(<App />);
