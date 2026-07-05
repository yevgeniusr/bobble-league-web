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
    {!state && <section className="panel hero">
      <div><p className="eyebrow">arcade tabletop soccer</p><h1>Bobble<br/>League</h1><p className="sub">Choose a mascot, invite players, pick the match length, then drag-launch bobbles and Power Plays.</p></div>
      <div className="roomBadge">CREATE OR JOIN</div>
      <section className="panel lobby">
        <label>Your name <input value={name} onChange={e=>setName(e.target.value)} maxLength={18}/></label>
        <label>Team <select value={team} onChange={e=>setTeam(e.target.value as TeamId)}>{TEAM_IDS.map(id=><option key={id} value={id}>{TEAMS[id].emoji} {TEAMS[id].label}</option>)}</select></label>
        <label>Game length <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage: 1 goal / 30 turns</option><option value={3}>Qualifier: 3 goals / 90 turns</option><option value={5}>Champion: 5 goals / 150 turns</option></select></label>
        <button onClick={createRoom}>Create room</button>
        <label>Room code <input value={roomCode} onChange={e=>setRoomCode(e.target.value)} maxLength={8}/></label>
        <button onClick={joinRoom}>Join room</button>
      </section>
      {error && <p className="error">{error}</p>}
    </section>}
    {state && <section className="gameShell"><GameCanvas state={state} you={you}/><HUD state={state} you={you} mode={mode} setMode={setMode}/>{error && <section className="panel error">{error}</section>}</section>}
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
  const actors = [
    ...state.bobbles.map(b => ({ kind: 'bobble' as const, y: b.pos.y, bobble: b })),
    { kind: 'ball' as const, y: state.ball.pos.y, bobble: null }
  ].sort((a, b) => a.y - b.y);
  for (const actor of actors) {
    if (actor.kind === 'ball') {
      const ball = state.ball;
      drawSoccerBall(ctx, ball.pos.x, ball.pos.y, ball.radius);
      continue;
    }
    const b = actor.bobble;
    const player = Object.values(state.players).find(p => p.side === b.side && p.controlledBobbleIds.includes(b.id)) ?? Object.values(state.players).find(p => p.side === b.side);
    const t = TEAMS[player?.team ?? 'pigs'];
    const selected = state.players[you]?.controlledBobbleIds.includes(b.id) ?? false;
    drawBobble3D(ctx, b.pos.x, b.pos.y, b.radius, t.primary, t.secondary, t.emoji, selected, b.side);
    const label = player?.name?.slice(0, 10).toUpperCase() ?? b.id.toUpperCase();
    ctx.font='900 18px Fredoka, sans-serif'; ctx.textAlign='center'; ctx.fillStyle='rgba(255,255,255,.38)'; ctx.fillText(label,b.pos.x,b.pos.y+b.radius+28);
    for (const e of b.effects) ctx.fillText(BOX_TYPES[e.type].label,b.pos.x,b.pos.y+b.radius+48);
  }
  if (drag) {
    ctx.strokeStyle='#fef08a'; ctx.lineWidth=5; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.moveTo(drag.start.x, drag.start.y); ctx.lineTo(drag.current.x, drag.current.y); ctx.stroke(); ctx.setLineDash([]);
    drawShadow(ctx, drag.start.x, drag.start.y + 24, 30, 8, .25);
  }
  drawTopHud(ctx, state);
  if (state.phase==='finished') { ctx.fillStyle='rgba(0,0,0,.55)'; ctx.fillRect(0,0,FIELD.width,FIELD.height); ctx.fillStyle='#fff'; ctx.font='800 56px Inter,sans-serif'; ctx.textAlign='center'; ctx.fillText(state.winner ? `${state.winner.toUpperCase()} WINS!` : 'DRAW!',FIELD.width/2,FIELD.height/2); }
}
function drawArena3D(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#5a6ed6'; ctx.fillRect(0,0,FIELD.width/2,FIELD.height);
  ctx.fillStyle = '#f05d48'; ctx.fillRect(FIELD.width/2,0,FIELD.width/2,FIELD.height);
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,.26)'; ctx.shadowBlur=18; ctx.shadowOffsetY=9;
  roundRect(ctx, 46, 82, FIELD.width-92, FIELD.height-112, 54); ctx.fillStyle='#fff6bf'; ctx.fill();
  ctx.shadowColor='transparent';
  roundRect(ctx, 76, 112, FIELD.width-152, FIELD.height-172, 38); ctx.fillStyle='#f8b33e'; ctx.fill();
  roundRect(ctx, 94, 130, FIELD.width-188, FIELD.height-208, 30); ctx.fillStyle='#57c4d6'; ctx.fill();
  ctx.restore();
  for (let i=0;i<8;i++) { ctx.fillStyle = i%2 ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.035)'; ctx.fillRect(94+i*(FIELD.width-188)/8,130,(FIELD.width-188)/8,FIELD.height-208); }
  ctx.strokeStyle='rgba(255,255,255,.86)'; ctx.lineWidth=5; ctx.beginPath(); ctx.moveTo(FIELD.width/2,130); ctx.lineTo(FIELD.width/2,FIELD.height-78); ctx.stroke();
  ctx.beginPath(); ctx.arc(FIELD.width/2,FIELD.height/2,74,0,Math.PI*2); ctx.stroke();
  ctx.strokeRect(94, FIELD.goalY-10, 150, FIELD.goalHeight+20); ctx.strokeRect(FIELD.width-244, FIELD.goalY-10, 150, FIELD.goalHeight+20);
  ctx.fillStyle='rgba(74,90,214,.82)'; roundRect(ctx, 0, FIELD.goalY-38, 88, FIELD.goalHeight+76, 18); ctx.fill();
  ctx.fillStyle='rgba(240,93,72,.82)'; roundRect(ctx, FIELD.width-88, FIELD.goalY-38, 88, FIELD.goalHeight+76, 18); ctx.fill();
  ctx.strokeStyle='#b95363'; ctx.lineWidth=12; ctx.beginPath(); ctx.moveTo(8,FIELD.goalY+FIELD.goalHeight+42); ctx.bezierCurveTo(60,FIELD.goalY+FIELD.goalHeight-20,60,FIELD.goalY+20,8,FIELD.goalY-42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(FIELD.width-8,FIELD.goalY+FIELD.goalHeight+42); ctx.bezierCurveTo(FIELD.width-60,FIELD.goalY+FIELD.goalHeight-20,FIELD.width-60,FIELD.goalY+20,FIELD.width-8,FIELD.goalY-42); ctx.stroke();
  for (const [x,y] of [[118,110],[FIELD.width-118,110]]) { ctx.fillStyle='#c94d5b'; ctx.beginPath(); ctx.arc(x,y,34,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#7a3e45'; ctx.lineWidth=5; ctx.stroke(); ctx.fillStyle='#f4d3b0'; ctx.beginPath(); ctx.arc(x,y,18,0,Math.PI*2); ctx.fill(); }
}
function drawTopHud(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.save();
  ctx.fillStyle='#7a524e'; ctx.strokeStyle='#fff6bf'; ctx.lineWidth=8;
  roundRect(ctx, 252, -18, 228, 86, 18); ctx.fill(); ctx.stroke();
  roundRect(ctx, 620, -18, 228, 86, 18); ctx.fill(); ctx.stroke();
  roundRect(ctx, 468, -8, 164, 98, 14); ctx.fillStyle='#fff6bf'; ctx.fill(); ctx.strokeStyle='#7a524e'; ctx.lineWidth=5; ctx.stroke();
  ctx.font='900 46px Fredoka, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillStyle='#6679de'; ctx.fillText(String(state.score.left), 430, 38);
  ctx.fillStyle='#f05d48'; ctx.fillText(String(state.score.right), 670, 38);
  ctx.fillStyle='#f7b43a'; ctx.fillText(`${state.turn}/${state.config.maxTurns}`, 550, 34);
  ctx.font='900 18px Fredoka, sans-serif'; ctx.fillStyle='#8b4b43'; ctx.fillText('TURNS', 550, 70);
  ctx.font='900 36px Fredoka, sans-serif'; ctx.fillStyle='#fff6bf'; ctx.textAlign='right'; ctx.fillText('Bobble', FIELD.width-90, 34); ctx.fillText('League', FIELD.width-80, 62);
  ctx.fillStyle='#fff6bf'; roundRect(ctx, FIELD.width-58, 18, 40, 40, 10); ctx.fill(); ctx.fillStyle='#8b4b43'; ctx.font='900 30px Fredoka'; ctx.textAlign='center'; ctx.fillText('⚙', FIELD.width-38, 40);
  ctx.fillStyle='rgba(122,82,78,.95)'; roundRect(ctx, 330, FIELD.height-72, 440, 54, 12); ctx.fill();
  ctx.strokeStyle='#f7b43a'; ctx.lineWidth=8; ctx.stroke();
  ctx.fillStyle='#fff6bf'; roundRect(ctx, 294, FIELD.height-70, 44, 50, 8); ctx.fill(); roundRect(ctx, 762, FIELD.height-70, 44, 50, 8); ctx.fill();
  ctx.font='900 18px Fredoka'; ctx.fillStyle='#8b4b43'; ctx.fillText('✓', 784, FIELD.height-43); ctx.fillText('••', 316, FIELD.height-43);
  ctx.restore();
}
function drawSoccerBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  drawShadow(ctx, x, y + r + 10, r * 1.2, 5, .35);
  ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#111'; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(x,y,r*.38,0,Math.PI*2); ctx.fill();
  for (let i=0;i<5;i++){const a=i*Math.PI*2/5-Math.PI/2; ctx.beginPath(); ctx.arc(x+Math.cos(a)*r*.78,y+Math.sin(a)*r*.78,r*.22,0,Math.PI*2); ctx.fill();}
}
function drawBobble3D(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, primary: string, secondary: string, emoji: string, selected: boolean, side: 'left' | 'right') {
  drawShadow(ctx, x, y + r * 1.35, r * 1.25, r * .34, .34);
  const base = side === 'left' ? '#e25a4c' : '#5147a8';
  ctx.fillStyle=base; ctx.beginPath(); ctx.ellipse(x, y+r*.42, r*.82, r*.34, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle=secondary; ctx.beginPath(); ctx.ellipse(x, y+r*.22, r*.78, r*.28, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle=base; ctx.fillRect(x-r*.78, y-r*.10, r*1.56, r*.38);
  const body = ctx.createRadialGradient(x - r*.35, y - r*.75, 2, x, y-r*.55, r*1.15);
  body.addColorStop(0, '#ffffff'); body.addColorStop(.14, secondary); body.addColorStop(.52, primary); body.addColorStop(1, '#73332f');
  ctx.fillStyle=body; ctx.beginPath(); ctx.ellipse(x, y-r*.42, r*.74, r*.88, 0, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = selected ? 5 : 3; ctx.strokeStyle = selected ? '#ffe86a' : 'rgba(65,45,45,.35)'; ctx.stroke();
  ctx.font = `${Math.max(22,r*1.05)}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(emoji,x,y-r*.48);
}
function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number) { ctx.save(); ctx.fillStyle=`rgba(0,0,0,${alpha})`; ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill(); ctx.restore(); }
function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}

createRoot(document.getElementById('root')!).render(<App />);
