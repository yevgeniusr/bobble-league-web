import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { BOX_TYPE_IDS, BOX_TYPES, BoxType, ClientToServerEvents, FIELD, FieldObjectType, FORMATION_IDS, FORMATIONS, GameMode, GameState, InventoryItem, PlayerSide, ROTATABLE_FIELD_OBJECTS, ServerToClientEvents, TEAM_IDS, TEAMS, Vec } from '../../shared/types';
import { BabbleLeague3DRenderer, PlacingGhost } from './render3d';
import './styles.css';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const socket: Sock = io();

function App() {
  const [state, setState] = React.useState<GameState | null>(null);
  const [you, setYou] = React.useState('');
  // 'bobble:name' is the legacy pre-rename localStorage key, read only for migration; new writes use 'babble:name'.
  const [name, setName] = React.useState(() => localStorage.getItem('babble:name') || localStorage.getItem('bobble:name') || `Player${Math.floor(Math.random()*99)}`);
  const [mode, setMode] = React.useState<GameMode>(3);
  const [roomCode, setRoomCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [conn, setConn] = React.useState<'connected' | 'reconnecting'>('connected');
  const stateRef = React.useRef<GameState | null>(null);
  const nameRef = React.useRef(name);
  stateRef.current = state;
  nameRef.current = name;

  React.useEffect(() => {
    socket.on('game:state', (s, playerId) => { setState(s); if (playerId) setYou(playerId); });
    socket.on('room:error', setError);
    // reconnect robustness: on transport loss show a banner, then automatically
    // rejoin the same room; the server reclaims the old seat by display name.
    const onDisconnect = () => setConn('reconnecting');
    const onConnect = () => {
      setConn('connected');
      const s = stateRef.current;
      if (s?.roomCode) {
        socket.emit('room:join', { roomCode: s.roomCode, name: nameRef.current }, res => {
          if (!res.ok) { setState(null); setYou(''); setError(`Reconnect failed: ${res.error}`); }
        });
      }
    };
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect', onConnect);
    return () => { socket.off('game:state'); socket.off('room:error'); socket.off('disconnect', onDisconnect); socket.io.off('reconnect', onConnect); };
  }, []);

  // toasts should never linger forever
  React.useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(t);
  }, [error]);

  function createRoom() {
    localStorage.setItem('babble:name', name);
    socket.emit('room:create', { name, mode }, res => res.ok ? (setRoomCode(res.roomCode), setError('')) : setError(res.error));
  }
  function joinRoom() {
    localStorage.setItem('babble:name', name);
    socket.emit('room:join', { roomCode: roomCode.toUpperCase(), name }, res => res.ok ? (setError(''), setRoomCode(res.roomCode)) : setError(res.error));
  }

  return <main>
    {!state && <section className="panel hero">
      <div className="heroLeft">
        <p className="eyebrow">arcade tabletop soccer</p>
        <h1>Babble<br/>League</h1>
        <p className="sub">Drag-launch your babbleheads, smash corner bumpers, and grab mystery Power Plays in turn-based arcade soccer.</p>
        <ArenaPreview/>
        <div className="powerTiles">{POWER_PREVIEW.map(t=><div key={t} className="powerTile" style={{background: BOX_TYPES[t].color}} title={BOX_TYPES[t].description}><span className="powerIcon">{POWER_ICONS[t] ?? '★'}</span>{BOX_TYPES[t].label}</div>)}</div>
      </div>
      <div className="heroRight">
        <section className="lobbyCard">
          <h2>Create or join</h2>
          <label>Your name <input value={name} onChange={e=>setName(e.target.value)} maxLength={18}/></label>
          <p className="fieldLabel">Pick mascots after joining the room with your team</p>
          <div className="lobbyMascotPreview">{(['left','right'] as const).map(side=>{ const id = side === 'left' ? 'pigs' : 'tigers'; const t = TEAMS[id]; return <div key={side} className="teamPreviewCard" style={{ background: t.primary, color: t.secondary }}><span>{side === 'left' ? 'Left' : 'Right'}</span><b>{t.emoji} {t.label}</b></div>; })}</div>
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
    {state && <GameScreen state={state} you={you} mode={mode} setMode={setMode} error={error} onDismissError={()=>setError('')} onLeave={()=>{ socket.emit('room:leave'); setState(null); setYou(''); setRoomCode(''); setError(''); }}/>}
    {conn === 'reconnecting' && <div className="connBanner" role="status">Connection lost — reconnecting…</div>}
  </main>;
}

const POWER_PREVIEW: readonly BoxType[] = ['beachBall', 'bigBumpers', 'boost', 'stickyGoo', 'ghosted', 'swapGoals'];
// One icon per Power Play, reused across the lobby preview, HUD buttons and hints.
const POWER_ICONS: Record<BoxType, string> = {
  beachBall: '🏖', moveBall: '🎯', swapGoals: '🔄', bigBumpers: '💥', boost: '⚡',
  stickyGoo: '🟢', ramp: '⛰️', block: '🧱', bigHead: '🗣️', ghosted: '👻', movePlayer: '🚚'
};

function ArenaPreview() {
  const babbles: { x: number; y: number; c: string; s: string }[] = [
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
      {babbles.map((b,i)=><g key={i}>
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
    <button type="button" onClick={()=>copy(`Join my Babble League match! Room code: ${code} → ${location.origin}`, 'invite')}>{copied === 'invite' ? 'Copied!' : 'Copy invite'}</button>
  </div>;
}

const PLACEABLE: readonly BoxType[] = ['boost', 'stickyGoo', 'ramp', 'block'];
const TARGET_BABBLE: readonly BoxType[] = ['bigHead', 'ghosted', 'movePlayer'];

// Ability flow: nothing is targetable until an ability button is clicked.
// place  -> drag a ghost onto the field (Esc cancels)
// babble -> click a babblehead to apply immediately (Esc/Cancel aborts)
// point  -> click a field spot to apply immediately (Esc/Cancel aborts)
// instant-> applies on button click
export type AbilityAim = { type: BoxType; mode: 'babble' | 'point' };
export function abilityMode(type: BoxType): 'place' | 'babble' | 'point' | 'instant' {
  if (PLACEABLE.includes(type)) return 'place';
  if (TARGET_BABBLE.includes(type)) return 'babble';
  if (type === 'moveBall') return 'point';
  return 'instant';
}

function GameScreen({ state, you, mode, setMode, error, onDismissError, onLeave }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; error: string; onDismissError: ()=>void; onLeave: ()=>void }) {
  const [placing, setPlacing] = React.useState<PlacingGhost | null>(null);
  const [aiming, setAiming] = React.useState<AbilityAim | null>(null);
  const [showHud, setShowHud] = React.useState(true);
  return <section className="gameShell">
    <Game3D state={state} you={you} placing={placing} setPlacing={setPlacing} aiming={aiming} setAiming={setAiming}/>
    <RoomCodeBadge code={state.roomCode}/>
    <RoomPanel state={state} you={you}/>
    {showHud && <HUD state={state} you={you} mode={mode} setMode={setMode} placing={placing} setPlacing={setPlacing} aiming={aiming} setAiming={setAiming} onLeave={onLeave}/>}
    <button className="hudToggle" type="button" onClick={()=>setShowHud(v=>!v)}>{showHud ? 'Hide panel ▾' : 'Show panel ▴'}</button>
    {error && <section className="panel error" role="alert" title="Click to dismiss" onClick={onDismissError}>{error}<span className="errorClose"> ✕</span></section>}
  </section>;
}

function RoomPanel({ state, you }: { state: GameState; you: string }) {
  const me = state.players[you];
  const connected = Object.values(state.players).filter(p => p.connected);
  const sides = ['left','right'] as const;
  return <aside className="roomPanel">
    <b>Room teams</b>
    {sides.map(side => {
      const team = TEAMS[state.sideTeams[side]];
      const players = connected.filter(p => p.side === side);
      const mine = me?.side === side;
      const inv = state.powerPlayInventories[side] ?? [];
      const boxCount = state.powerPlayCounts?.[side] ?? inv.length;
      return <section key={side} className="sidePreview" style={{ borderColor: team.primary }}>
      <div className="sideHeader"><span>{side.toUpperCase()}</span>{boxCount > 0 && <span className="boxBadge" title={mine ? 'Boxes held by your team' : 'Opponents hold hidden boxes'}>📦×{boxCount}</span>}<strong>{team.emoji} {team.label}</strong></div>
      {mine && <div className="miniMascots">{TEAM_IDS.map(id => <button key={id} type="button" className={state.sideTeams[side]===id?'selected':''} title={TEAMS[id].label} style={{ background: TEAMS[id].primary, color: TEAMS[id].secondary }} onClick={()=>socket.emit('player:team', id)}>{TEAMS[id].emoji}</button>)}</div>}
      <div className="playerPreview">{players.length ? players.map(p => {
        // teammates see exactly who holds which box; opponents get nothing (server redacts)
        const held = mine ? inv.find(i => i.holderId === p.id) : undefined;
        return <span key={p.id} className={p.id===you?'you':''}>{p.name}{p.id===you?' (you)':''}{held ? ` 📦 ${BOX_TYPES[held.type].label}` : ''}</span>;
      }) : <span>Waiting…</span>}</div>
    </section>; })}
  </aside>;
}

function HUD({ state, you, mode, setMode, placing, setPlacing, aiming, setAiming, onLeave }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; placing: PlacingGhost | null; setPlacing: (p: PlacingGhost | null)=>void; aiming: AbilityAim | null; setAiming: (a: AbilityAim | null)=>void; onLeave: ()=>void }) {
  const [cheatOpen, setCheatOpen] = React.useState(false);
  const me = state.players[you];
  const inventory = me ? state.powerPlayInventories[me.side] : [];
  const oppSide: PlayerSide = me?.side === 'left' ? 'right' : 'left';
  const oppCount = state.powerPlayCounts?.[oppSide] ?? 0;
  const ownRotatable = me ? state.fieldObjects.filter(o => o.owner === me.side && o.untilTurn >= state.turn && ROTATABLE_FIELD_OBJECTS.includes(o.type)) : [];
  const formationOpen = state.phase === 'lobby' || state.formationSelectionTurn === state.turn;
  const toggleCheat = () => { const next = !cheatOpen; setCheatOpen(next); if (next) socket.emit('player:cheatPanel'); };
  const onAbility = (type: BoxType) => {
    if (!me) return;
    const m = abilityMode(type);
    if (m === 'place') { setAiming(null); setPlacing({ type: type as FieldObjectType, pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: me.side === 'left' ? 0 : Math.PI }); return; }
    if (m === 'instant') { setAiming(null); setPlacing(null); socket.emit('player:power', { type }); return; }
    setPlacing(null);
    setAiming(aiming?.type === type ? null : { type, mode: m });
  };
  return <section className="panel gameHud">
    <div className="domScore"><b>Left</b><span>{state.score.left}</span><small>{state.config.length}: first to {state.config.goalTarget}, turn {state.turn}/{state.config.maxTurns} · {state.phase} · {Math.max(0, Math.ceil((state.turnDeadlineAt - Date.now())/1000))}s · aimed {Object.keys(state.pendingIntents).length}/{state.babbles.length}</small><span>{state.score.right}</span><b>Right</b></div>
    <div className="actions"><button onClick={()=>socket.emit('game:start')}>{state.phase === 'lobby' ? 'Start match' : 'Restart kickoff'}</button><select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage</option><option value={3}>Qualifier</option><option value={5}>Champion</option></select><button onClick={()=>socket.emit('game:reset', mode)}>Reset</button><button className={cheatOpen ? 'cheat selected' : 'cheat'} title="Testing only: opening this list warns all users" onClick={toggleCheat}>{cheatOpen ? 'Close cheats ⚠' : 'Cheat panel ⚠'}</button><button onClick={onLeave} title="Leave the match and return to the main menu">Main menu</button></div>
    {cheatOpen && me && <div className="inventory cheatPanel"><b>⚠ Cheat boosters</b><small className="cheatWarn">Testing only — all players are warned on every grant. One copy each, single-use.</small>{BOX_TYPE_IDS.map(type => { const owned = inventory.some(i => i.type === type); return <button key={type} disabled={owned} title={BOX_TYPES[type].description} onClick={()=>socket.emit('player:cheatBox', { type })}>{POWER_ICONS[type]} {BOX_TYPES[type].label}{owned ? ' ✓' : ''}</button>; })}</div>}
    {me && <div className="actions formations">{formationOpen ? FORMATION_IDS.map(id=><button key={id} className={state.formations[me.side]===id?'selected':''} onClick={()=>socket.emit('player:formation', id)} title={FORMATIONS[id].description}>{FORMATIONS[id].label}</button>) : <small>Position selection locked until the next goal.</small>}</div>}
    {me && <div className="inventory"><b>Power Plays</b>{inventory.length ? inventory.map((item: InventoryItem, i: number) => {
      const holder = item.holderId ? state.players[item.holderId] : undefined;
      const mine = !item.holderId || item.holderId === you;
      const locked = item.availableTurn > state.turn;
      const active = (aiming?.type === item.type || placing?.type === item.type) && mine;
      return <button key={`${item.type}-${i}`} className={active ? 'selected' : ''} disabled={locked || !mine} title={mine ? BOX_TYPES[item.type].description : `Held by teammate ${holder?.name ?? '?'} — only they can use it.`} onClick={()=>onAbility(item.type as BoxType)}>{POWER_ICONS[item.type as BoxType]} {BOX_TYPES[item.type].label}{holder ? ` 📦 ${mine ? 'you' : holder.name}` : ''}{locked ? ` (turn ${item.availableTurn})` : ''}</button>;
    }) : <small>No Power Plays yet. Run a babblehead or the last-touched ball into the ? box. One box per player.</small>}
    <small className="oppBoxes">Opponents hold {oppCount} hidden box{oppCount === 1 ? '' : 'es'}.</small></div>}
    {aiming && <div className="inventory hint aimingHint"><b>{POWER_ICONS[aiming.type]} Targeting {BOX_TYPES[aiming.type].label}</b><small>{aiming.mode === 'babble' ? 'Click any babblehead on the field to apply it instantly' : 'Click any spot on the field to teleport the ball there'} · Esc cancels</small><button type="button" onClick={()=>setAiming(null)}>Cancel</button></div>}
    {placing && <div className="inventory hint"><b>{POWER_ICONS[placing.type as BoxType]} Placing {BOX_TYPES[placing.type as BoxType].label}</b><small>Hold left mouse and drag to aim the facing · release to place · R rotates 45° · Esc cancels</small><button type="button" onClick={()=>setPlacing(null)}>Cancel</button></div>}
    {!placing && !aiming && state.phase === 'planning' && <div className="inventory hint controlsHint"><small>Hold LMB on your babblehead and drag back to aim, release to launch{ownRotatable.length > 0 ? ' · hold & drag a ⟳ pad to rotate it toward the cursor' : ''}.</small></div>}
  </section>;
}

type PointerMode =
  | { kind: 'launch'; babbleId: string; start: Vec; current: Vec }
  | { kind: 'place'; anchor: Vec; angle: number }
  | { kind: 'rotatePad'; id: string; center: Vec; angle: number };

function Game3D({ state, you, placing, setPlacing, aiming, setAiming }: { state: GameState; you: string; placing: PlacingGhost | null; setPlacing: (p: PlacingGhost | null)=>void; aiming: AbilityAim | null; setAiming: (a: AbilityAim | null)=>void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rendererRef = React.useRef<BabbleLeague3DRenderer | null>(null);
  const [mode, setMode] = React.useState<PointerMode | null>(null);
  const lastRotateSent = React.useRef(0);
  const [renderError, setRenderError] = React.useState('');
  const me = state.players[you];
  const drag = mode?.kind === 'launch' ? { babbleId: mode.babbleId, start: mode.start, current: mode.current } : null;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: BabbleLeague3DRenderer | null = null;
    try {
      renderer = new BabbleLeague3DRenderer(canvas);
      rendererRef.current = renderer;
      setRenderError('');
    } catch (err) {
      rendererRef.current = null;
      setRenderError('3D renderer unavailable in this browser; gameplay state still loads.');
    }
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, []);

  const rotatingPad = mode?.kind === 'rotatePad' ? { id: mode.id, angle: mode.angle } : null;
  // animation pump: keeps ball rolling, box spin, boost chevrons and launch hops
  // moving smoothly even between server state frames
  const frame = React.useRef<{ state: GameState; you: string; drag: typeof drag; placing: PlacingGhost | null; rotatingPad: { id: string; angle: number } | null }>({ state, you, drag, placing, rotatingPad });
  frame.current = { state, you, drag, placing, rotatingPad };
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const f = frame.current;
      rendererRef.current?.render({ state: f.state, you: f.you, drag: f.drag, placing: f.placing, rotatingPad: f.rotatingPad });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // if placement is cancelled from the HUD mid-drag, drop the stale place mode
  // immediately so the next pointer press controls babbles again
  React.useEffect(() => {
    if (!placing) setMode(m => (m?.kind === 'place' ? null : m));
  }, [placing]);

  React.useEffect(() => {
    if (!placing && !aiming) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && placing) setPlacing({ ...placing, angle: placing.angle + Math.PI / 4 });
      if (e.key === 'Escape') { setPlacing(null); setAiming(null); setMode(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, setPlacing, aiming, setAiming]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => rendererRef.current?.pointFromClient(e.clientX, e.clientY) ?? null;
  const clampPos = (p: Vec): Vec => ({ x: Math.min(FIELD.width - 40, Math.max(40, p.x)), y: Math.min(FIELD.height - 40, Math.max(40, p.y)) });
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!me) return;
    const p = point(e);
    if (!p) return;
    if (aiming) {
      // ability targeting: the very next click applies the ability immediately
      if (aiming.mode === 'point') {
        socket.emit('player:power', { type: aiming.type, position: p });
        setAiming(null);
        return;
      }
      const target = state.babbles.find(b => Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 20);
      if (target) {
        socket.emit('player:power', { type: aiming.type, targetBabbleId: target.id });
        setAiming(null);
      }
      return; // clicking empty turf keeps targeting active; Esc/Cancel aborts
    }
    if (placing) {
      // hold LMB: anchor the pad here, drag to aim its facing, release to place
      const anchor = clampPos(p);
      e.currentTarget.setPointerCapture(e.pointerId);
      setPlacing({ ...placing, pos: anchor });
      setMode({ kind: 'place', anchor, angle: placing.angle });
      return;
    }
    if (state.phase === 'planning') {
      const babble = state.babbles.find(b => me.controlledBabbleIds.includes(b.id) && Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 16);
      if (babble) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setMode({ kind: 'launch', babbleId: babble.id, start: babble.pos, current: p });
        return;
      }
    }
    // hold & drag one of your placed pads to rotate it toward the cursor
    if (state.phase === 'planning') {
      const pad = state.fieldObjects.find(o => o.owner === me.side && o.untilTurn >= state.turn && ROTATABLE_FIELD_OBJECTS.includes(o.type) && Math.hypot(o.pos.x - p.x, o.pos.y - p.y) <= 70);
      if (pad) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setMode({ kind: 'rotatePad', id: pad.id, center: pad.pos, angle: pad.angle });
      }
    }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    if (!p) return;
    if (mode?.kind === 'place' && placing) {
      const dx = p.x - mode.anchor.x, dy = p.y - mode.anchor.y;
      if (Math.hypot(dx, dy) > 12) {
        const angle = Math.atan2(dy, dx);
        setMode({ ...mode, angle });
        setPlacing({ ...placing, pos: mode.anchor, angle });
      }
      return;
    }
    if (mode?.kind === 'rotatePad') {
      const angle = Math.atan2(p.y - mode.center.y, p.x - mode.center.x);
      setMode({ ...mode, angle });
      const now = performance.now();
      if (now - lastRotateSent.current > 50) {
        lastRotateSent.current = now;
        socket.emit('player:fieldRotate', { id: mode.id, angle });
      }
      return;
    }
    if (mode?.kind === 'launch') { setMode({ ...mode, current: p }); return; }
    if (placing) setPlacing({ ...placing, pos: clampPos(p) });
  };
  const up = () => {
    if (mode?.kind === 'place' && placing) {
      socket.emit('player:power', { type: placing.type, position: mode.anchor, angle: mode.angle });
      setPlacing(null);
    } else if (mode?.kind === 'rotatePad') {
      socket.emit('player:fieldRotate', { id: mode.id, angle: mode.angle });
    } else if (mode?.kind === 'launch') {
      const dx = mode.start.x - mode.current.x;
      const dy = mode.start.y - mode.current.y;
      const pull = Math.hypot(dx, dy);
      // a click with no pull is ignored so a launch is never wasted by accident
      if (pull >= 8) socket.emit('player:launch', { babbleId: mode.babbleId, aimAngle: Math.atan2(dy, dx), impulse: Math.min(900, Math.max(1, pull * 6)) });
    }
    // always drop the pointer mode: a stale mode must never block later launches
    setMode(null);
  };

  return <>
    <canvas className="field threeField" ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>setMode(null)} aria-label="3D Babble League field"/>
    {renderError && <div className="renderFallback"><b>3D preview unavailable</b><span>{renderError}</span></div>}
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
