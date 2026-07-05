import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { BOX_TYPES, BoxType, ClientToServerEvents, FIELD, FieldObjectType, FORMATION_IDS, FORMATIONS, GameMode, GameState, PowerPlayUse, ROTATABLE_FIELD_OBJECTS, ServerToClientEvents, TEAM_IDS, TEAMS, TeamId, Vec } from '../../shared/types';
import { BobbleLeague3DRenderer, PlacingGhost } from './render3d';
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
      <div className="heroLeft">
        <p className="eyebrow">arcade tabletop soccer</p>
        <h1>Bobble<br/>League</h1>
        <p className="sub">Drag-launch your bobbleheads, smash corner bumpers, and grab mystery Power Plays in turn-based arcade soccer.</p>
        <ArenaPreview/>
        <div className="powerTiles">{POWER_PREVIEW.map(t=><div key={t} className="powerTile" style={{background: BOX_TYPES[t].color}} title={BOX_TYPES[t].description}><span className="powerIcon">{POWER_ICONS[t] ?? '★'}</span>{BOX_TYPES[t].label}</div>)}</div>
      </div>
      <div className="heroRight">
        <section className="lobbyCard">
          <h2>Suit up</h2>
          <label>Your name <input value={name} onChange={e=>setName(e.target.value)} maxLength={18}/></label>
          <p className="fieldLabel">Pick a mascot</p>
          <div className="mascotGrid">{TEAM_IDS.map(id=><button key={id} type="button" className={`mascot ${team===id?'selected':''}`} style={{ background: TEAMS[id].primary, color: TEAMS[id].secondary }} onClick={()=>setTeam(id)}><span className="mEmoji">{TEAMS[id].emoji}</span><span className="mName">{TEAMS[id].label}</span></button>)}</div>
          <div className="lobbySplit">
            <div className="lobbyCol">
              <p className="fieldLabel">Host a match</p>
              <label>Game length <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage: 1 goal / 30 turns</option><option value={3}>Qualifier: 3 goals / 90 turns</option><option value={5}>Champion: 5 goals / 150 turns</option></select></label>
              <button className="primary" onClick={createRoom}>Create room</button>
            </div>
            <div className="lobbyDivider"><span>or</span></div>
            <div className="lobbyCol">
              <p className="fieldLabel">Join friends</p>
              <label>Room code <input className="codeInput" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} maxLength={8} placeholder="ABC12"/></label>
              <button onClick={joinRoom}>Join room</button>
            </div>
          </div>
          {error && <p className="lobbyError">{error}</p>}
        </section>
      </div>
    </section>}
    {state && <GameScreen state={state} you={you} mode={mode} setMode={setMode} error={error}/>}
  </main>;
}

const POWER_PREVIEW: readonly BoxType[] = ['beachBall', 'bigBumpers', 'boost', 'stickyGoo', 'ghosted', 'swapGoals'];
const POWER_ICONS: Partial<Record<BoxType, string>> = { beachBall: '🏖', bigBumpers: '💥', boost: '⚡', stickyGoo: '🟢', ghosted: '👻', swapGoals: '🔄' };

function ArenaPreview() {
  const bobbles: { x: number; y: number; c: string; s: string }[] = [
    { x: 96, y: 78, c: '#f8b196', s: '#5b2135' }, { x: 132, y: 130, c: '#f8b196', s: '#5b2135' },
    { x: 96, y: 182, c: '#f8b196', s: '#5b2135' }, { x: 168, y: 104, c: '#f8b196', s: '#5b2135' },
    { x: 344, y: 78, c: '#f77f00', s: '#111827' }, { x: 308, y: 130, c: '#f77f00', s: '#111827' },
    { x: 344, y: 182, c: '#f77f00', s: '#111827' }, { x: 272, y: 156, c: '#f77f00', s: '#111827' }
  ];
  return <div className="arenaWrap" aria-hidden="true">
    <svg className="arenaPreview" viewBox="0 0 440 260">
      <defs>
        <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#39b96e"/><stop offset="1" stopColor="#1f8f4e"/></linearGradient>
        <radialGradient id="ballShine" cx="0.35" cy="0.3" r="1"><stop offset="0" stopColor="#ffffff"/><stop offset="1" stopColor="#cbd5e1"/></radialGradient>
      </defs>
      <rect x="8" y="8" width="424" height="244" rx="26" fill="url(#turf)" stroke="#f8bd45" strokeWidth="8"/>
      {[0,1,2,3,4].map(i=><rect key={i} x={20+i*84} y="14" width="42" height="232" fill="#ffffff" opacity="0.06"/>)}
      <line x1="220" y1="14" x2="220" y2="246" stroke="#fff8cf" strokeWidth="3" opacity="0.7"/>
      <circle cx="220" cy="130" r="42" fill="none" stroke="#fff8cf" strokeWidth="3" opacity="0.7"/>
      <rect x="8" y="90" width="26" height="80" fill="#fff8cf" opacity="0.85" rx="4"/>
      <rect x="406" y="90" width="26" height="80" fill="#fff8cf" opacity="0.85" rx="4"/>
      {[[42,42],[398,42],[42,218],[398,218]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="16" fill="#f97316" stroke="#fff8cf" strokeWidth="4"/><circle cx={x} cy={y} r="6" fill="#fff8cf"/></g>)}
      <rect x="204" y="52" width="30" height="30" rx="6" fill="#facc15" stroke="#92400e" strokeWidth="3" transform="rotate(12 219 67)"/>
      <text x="219" y="74" textAnchor="middle" fontSize="18" fontWeight="900" fill="#92400e">?</text>
      {bobbles.map((b,i)=><g key={i}>
        <ellipse cx={b.x} cy={b.y+16} rx="14" ry="5" fill="#000" opacity="0.25"/>
        <circle cx={b.x} cy={b.y} r="15" fill={b.c} stroke={b.s} strokeWidth="3"/>
        <circle cx={b.x-5} cy={b.y-3} r="2.6" fill={b.s}/><circle cx={b.x+5} cy={b.y-3} r="2.6" fill={b.s}/>
        <path d={`M ${b.x-4} ${b.y+5} Q ${b.x} ${b.y+9} ${b.x+4} ${b.y+5}`} stroke={b.s} strokeWidth="2" fill="none"/>
      </g>)}
      <ellipse cx="228" cy="146" rx="10" ry="4" fill="#000" opacity="0.25"/>
      <circle cx="228" cy="134" r="11" fill="url(#ballShine)" stroke="#334155" strokeWidth="2.5"/>
    </svg>
  </div>;
}

function RoomCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = React.useState<'code' | 'invite' | null>(null);
  const copy = (text: string, kind: 'code' | 'invite') => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 1600);
    }).catch(() => {});
  };
  return <div className="roomCode">
    <span className="roomCodeLabel">Room</span>
    <b className="roomCodeValue">{code}</b>
    <button type="button" onClick={()=>copy(code, 'code')}>{copied === 'code' ? 'Copied!' : 'Copy code'}</button>
    <button type="button" onClick={()=>copy(`Join my Bobble League match! Room code: ${code} → ${location.origin}`, 'invite')}>{copied === 'invite' ? 'Copied!' : 'Copy invite'}</button>
  </div>;
}

const PLACEABLE: readonly BoxType[] = ['boost', 'stickyGoo', 'ramp', 'block'];

function GameScreen({ state, you, mode, setMode, error }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; error: string }) {
  const [placing, setPlacing] = React.useState<PlacingGhost | null>(null);
  return <section className="gameShell">
    <Game3D state={state} you={you} placing={placing} setPlacing={setPlacing}/>
    <RoomCodeBadge code={state.roomCode}/>
    <HUD state={state} you={you} mode={mode} setMode={setMode} placing={placing} setPlacing={setPlacing}/>
    {error && <section className="panel error">{error}</section>}
  </section>;
}

function HUD({ state, you, mode, setMode, placing, setPlacing }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; placing: PlacingGhost | null; setPlacing: (p: PlacingGhost | null)=>void }) {
  const me = state.players[you];
  const inventory = me ? state.powerPlayInventories[me.side] : [];
  const ownRotatable = me ? state.fieldObjects.filter(o => o.owner === me.side && o.untilTurn >= state.turn && ROTATABLE_FIELD_OBJECTS.includes(o.type)) : [];
  return <section className="panel gameHud">
    <div className="domScore"><b>Left</b><span>{state.score.left}</span><small>{state.config.length}: first to {state.config.goalTarget}, turn {state.turn}/{state.config.maxTurns} · {state.phase} · {Math.max(0, Math.ceil((state.turnDeadlineAt - Date.now())/1000))}s · aimed {Object.keys(state.pendingIntents).length}/{state.bobbles.length}</small><span>{state.score.right}</span><b>Right</b></div>
    <div className="actions"><button onClick={()=>socket.emit('game:start')}>{state.phase === 'lobby' ? 'Start match' : 'Restart kickoff'}</button><select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage</option><option value={3}>Qualifier</option><option value={5}>Champion</option></select><button onClick={()=>socket.emit('game:reset', mode)}>Reset</button></div>
    {me && <div className="actions formations">{FORMATION_IDS.map(id=><button key={id} className={state.formations[me.side]===id?'selected':''} onClick={()=>socket.emit('player:formation', id)} title={FORMATIONS[id].description}>{FORMATIONS[id].label}</button>)}</div>}
    {me && <div className="inventory"><b>Power Plays</b>{inventory.length ? inventory.map((item, i)=><button key={`${item.type}-${i}`} disabled={item.availableTurn > state.turn} title={BOX_TYPES[item.type].description} onClick={()=>useInventory(item.type as BoxType, state, me.side, setPlacing)}>{BOX_TYPES[item.type].label}{item.availableTurn > state.turn ? ` (turn ${item.availableTurn})` : ''}</button>) : <small>No Power Plays yet. Run a bobble into the ? box.</small>}</div>}
    {placing && <div className="inventory hint"><b>Placing {BOX_TYPES[placing.type as BoxType].label}</b><small>Move mouse to aim · R rotates · click to place · Esc cancels</small></div>}
    {!placing && ownRotatable.length > 0 && state.phase === 'planning' && <div className="inventory hint"><small>Tip: click your placed pads to rotate them 45°.</small></div>}
  </section>;
}

function useInventory(type: BoxType, state: GameState, side: 'left' | 'right', setPlacing: (p: PlacingGhost | null)=>void) {
  if (PLACEABLE.includes(type)) {
    setPlacing({ type: type as FieldObjectType, pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: side === 'left' ? 0 : Math.PI });
    return;
  }
  const own = state.bobbles.find(b => b.side === side);
  const use: PowerPlayUse = { type, targetBobbleId: own?.id, position: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: side === 'left' ? 0 : Math.PI };
  socket.emit('player:power', use);
}

function Game3D({ state, you, placing, setPlacing }: { state: GameState; you: string; placing: PlacingGhost | null; setPlacing: (p: PlacingGhost | null)=>void }) {
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
    rendererRef.current?.render({ state, you, drag, placing });
  }, [state, you, drag, placing]);

  React.useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') setPlacing({ ...placing, angle: placing.angle + Math.PI / 4 });
      if (e.key === 'Escape') setPlacing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, setPlacing]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => rendererRef.current?.pointFromClient(e.clientX, e.clientY) ?? null;
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!me) return;
    const p = point(e);
    if (!p) return;
    if (placing) {
      const clamped = { x: Math.min(FIELD.width - 40, Math.max(40, p.x)), y: Math.min(FIELD.height - 40, Math.max(40, p.y)) };
      socket.emit('player:power', { type: placing.type, position: clamped, angle: placing.angle });
      setPlacing(null);
      return;
    }
    if (state.phase !== 'planning') return;
    const bobble = state.bobbles.find(b => me.controlledBobbleIds.includes(b.id) && Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 16);
    if (bobble) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ bobbleId: bobble.id, start: bobble.pos, current: p });
      return;
    }
    // rotate one of your placed pads by clicking it
    const pad = state.fieldObjects.find(o => o.owner === me.side && o.untilTurn >= state.turn && ROTATABLE_FIELD_OBJECTS.includes(o.type) && Math.hypot(o.pos.x - p.x, o.pos.y - p.y) <= 70);
    if (pad) socket.emit('player:fieldRotate', { id: pad.id });
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    if (!p) return;
    if (placing) { setPlacing({ ...placing, pos: p }); return; }
    if (drag) setDrag({ ...drag, current: p });
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
