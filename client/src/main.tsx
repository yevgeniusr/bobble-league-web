import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { BOX_TYPES, ClientToServerEvents, FIELD, FORMATION_IDS, FORMATIONS, GameMode, GameState, PowerPlayUse, ServerToClientEvents, TEAM_IDS, TEAMS, TeamId, Vec } from '../../shared/types';
import { BobbleLeague3DRenderer } from './render3d';
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
    {state && <section className="gameShell"><Game3D state={state} you={you}/><HUD state={state} you={you} mode={mode} setMode={setMode}/>{error && <section className="panel error">{error}</section>}</section>}
  </main>;
}

function HUD({ state, you, mode, setMode }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void }) {
  const me = state.players[you];
  const inventory = me ? state.powerPlayInventories[me.side] : [];
  return <section className="panel gameHud">
    <div className="domScore"><b>Left</b><span>{state.score.left}</span><small>{state.config.length}: first to {state.config.goalTarget}, turn {state.turn}/{state.config.maxTurns} · {state.phase}</small><span>{state.score.right}</span><b>Right</b></div>
    <div className="actions"><button onClick={()=>socket.emit('game:start')}>{state.phase === 'lobby' ? 'Start match' : 'Restart kickoff'}</button><select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage</option><option value={3}>Qualifier</option><option value={5}>Champion</option></select><button onClick={()=>socket.emit('game:reset', mode)}>Reset</button></div>
    {me && <div className="actions formations">{FORMATION_IDS.map(id=><button key={id} className={state.formations[me.side]===id?'selected':''} onClick={()=>socket.emit('player:formation', id)} title={FORMATIONS[id].description}>{FORMATIONS[id].label}</button>)}</div>}
    {me && <div className="inventory"><b>Power Plays</b>{inventory.length ? inventory.map((item, i)=><button key={`${item.type}-${i}`} disabled={item.availableTurn > state.turn} onClick={()=>useInventory(item.type as keyof typeof BOX_TYPES, state, me.side)}>{BOX_TYPES[item.type].label}{item.availableTurn > state.turn ? ` (turn ${item.availableTurn})` : ''}</button>) : <small>No Power Plays yet. Run a bobble into the ? box.</small>}</div>}
  </section>;
}

function useInventory(type: keyof typeof BOX_TYPES, state: GameState, side: 'left' | 'right') {
  const own = state.bobbles.find(b => b.side === side);
  const use: PowerPlayUse = { type, targetBobbleId: own?.id, position: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: side === 'left' ? 0 : Math.PI };
  socket.emit('player:power', use);
}

function Game3D({ state, you }: { state: GameState; you: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rendererRef = React.useRef<BobbleLeague3DRenderer | null>(null);
  const [drag, setDrag] = React.useState<{ bobbleId: string; start: Vec; current: Vec } | null>(null);
  const me = state.players[you];

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new BobbleLeague3DRenderer(canvas);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    rendererRef.current?.render({ state, you, drag });
  }, [state, you, drag]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => rendererRef.current?.pointFromClient(e.clientX, e.clientY) ?? null;
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!me || state.phase !== 'planning') return;
    const p = point(e);
    if (!p) return;
    const bobble = state.bobbles.find(b => me.controlledBobbleIds.includes(b.id) && Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 16);
    if (bobble) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ bobbleId: bobble.id, start: bobble.pos, current: p });
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    if (drag && p) setDrag({ ...drag, current: p });
  };
  const up = () => {
    if (!drag) return;
    const dx = drag.start.x - drag.current.x;
    const dy = drag.start.y - drag.current.y;
    socket.emit('player:launch', { bobbleId: drag.bobbleId, aimAngle: Math.atan2(dy, dx), impulse: Math.min(900, Math.max(1, Math.hypot(dx, dy) * 6)) });
    setDrag(null);
  };

  return <canvas className="field threeField" ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>setDrag(null)} aria-label="3D Bobble League field"/>;
}

createRoot(document.getElementById('root')!).render(<App />);
