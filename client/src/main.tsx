import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { BOX_TYPE_IDS, BOX_TYPES, BoxType, ClientToServerEvents, FIELD, FieldObjectType, FORMATION_IDS, FORMATIONS, GameMode, GameState, InventoryItem, PlayerSide, ROTATABLE_FIELD_OBJECTS, ServerToClientEvents, TEAM_IDS, TEAMS, Vec } from '../../shared/types';
import { BabbleLeague3DRenderer, PlacingGhost } from './render3d';
import './styles.css';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const socket: Sock = io();

// Developer console API (no cheat UI ships in the app). Available in dev
// builds, with ?dev=1, or after localStorage.setItem('babble:devtools', '1').
// Production servers reject these events unless ENABLE_CHEATS=true; every
// successful grant publicly warns the whole room.
const devtoolsEnabled =
  import.meta.env.DEV ||
  new URLSearchParams(location.search).has('dev') ||
  localStorage.getItem('babble:devtools') === '1';
if (devtoolsEnabled) {
  (window as unknown as { __babbleDev?: unknown }).__babbleDev = {
    listTypes: () => [...BOX_TYPE_IDS],
    grantBox: (type: BoxType) => {
      if (!BOX_TYPE_IDS.includes(type)) throw new Error(`Unknown box type "${type}". Try listTypes().`);
      socket.emit('player:cheatBox', { type });
      return `requested ${type} (server may reject; the whole room is warned)`;
    },
    grantAll: () => {
      socket.emit('player:cheatBoxes');
      return 'requested every box type (server may reject; the whole room is warned)';
    }
  };
}

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
      <div className="heroGlow one" aria-hidden="true"/>
      <div className="heroGlow two" aria-hidden="true"/>
      <div className="starSprinkle" aria-hidden="true"><span/><span/><span/><span/><span/></div>
      <div className="heroLeft">
        <p className="eyebrow">arcade tabletop soccer</p>
        <h1>Babble<br/>League</h1>
        <p className="sub">Drag-launch cute babbleheads through a candy-bright arena, bank off corner bumpers, and steal the match with mystery Power Plays.</p>
        <div className="showcase">
          <AnimeCatMascot/>
          <ArenaPreview/>
        </div>
        <div className="powerTiles">{POWER_PREVIEW.map(t=><div key={t} className="powerTile" style={{background: BOX_TYPES[t].color}} title={BOX_TYPES[t].description}><span className="powerIcon">{POWER_ICONS[t] ?? '★'}</span>{BOX_TYPES[t].label}</div>)}</div>
      </div>
      <div className="heroRight">
        <section className="lobbyCard">
          <div className="cardRibbon">meow match desk</div>
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

function AnimeCatMascot() {
  return <div className="catMascot" aria-hidden="true">
    <div className="catTail"/>
    <div className="catBody">
      <div className="catScarf"/>
      <div className="catFace">
        <div className="catEar left"/><div className="catEar right"/>
        <div className="catEye left"/><div className="catEye right"/>
        <div className="catBlush left"/><div className="catBlush right"/>
        <div className="catMouth"/>
      </div>
      <div className="catPaw left"/><div className="catPaw right"/>
    </div>
    <div className="catBall"/>
  </div>;
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

// Ability icon: generated art from public/assets/abilities with an emoji
// fallback if the asset is missing or fails to load.
function AbilityIcon({ type }: { type: BoxType }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) return <span className="abilityEmoji" aria-hidden="true">{POWER_ICONS[type]}</span>;
  return <img className="abilityImg" src={`/assets/abilities/${type}.png`} alt="" draggable={false} onError={() => setFailed(true)}/>;
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  return <section className="gameShell">
    <Game3D state={state} you={you} placing={placing} setPlacing={setPlacing} aiming={aiming} setAiming={setAiming}/>
    <TopHud state={state} menuOpen={menuOpen} onToggleMenu={()=>setMenuOpen(v=>!v)}/>
    {menuOpen && <SettingsMenu state={state} you={you} mode={mode} setMode={setMode} onLeave={onLeave} onClose={()=>setMenuOpen(false)}/>}
    <BottomActionBar state={state} you={you} placing={placing} setPlacing={setPlacing} aiming={aiming} setAiming={setAiming}/>
    {error && <section className="panel error" role="alert" title="Click to dismiss" onClick={onDismissError}>{error}<span className="errorClose"> ✕</span></section>}
  </section>;
}

function TeamScorePill({ state, side }: { state: GameState; side: PlayerSide }) {
  const team = TEAMS[state.sideTeams[side]];
  return <div className={`scorePill ${side}`} style={{ borderColor: team.primary }}>
    <span className="pillTeam" style={{ background: team.primary, color: team.secondary }}>{team.emoji}</span>
    <b>{side === 'left' ? 'Left' : 'Right'}</b>
    <span className="pillScore">{state.score[side]}</span>
  </div>;
}

// Compact top HUD: score pills flanking the live match status. The status
// string keeps the exact "turn X/Y · phase · Ns · aimed n/m" format that the
// smoke checks and match tooling parse.
function TopHud({ state, menuOpen, onToggleMenu }: { state: GameState; menuOpen: boolean; onToggleMenu: ()=>void }) {
  const secs = Math.max(0, Math.ceil((state.turnDeadlineAt - Date.now()) / 1000));
  return <header className="topHud">
    <TeamScorePill state={state} side="left"/>
    <div className="matchStatus">
      <b>{state.config.length} · first to {state.config.goalTarget}</b>
      <small>turn {state.turn}/{state.config.maxTurns} · {state.phase} · {secs}s · aimed {Object.keys(state.pendingIntents).length}/{state.babbles.length}</small>
    </div>
    <div className="topRight">
      <TeamScorePill state={state} side="right"/>
      <div className="roomChip"><span className="roomCodeLabel">Room</span><b className="roomCodeValue">{state.roomCode}</b></div>
      <button type="button" className={menuOpen ? 'menuToggle selected' : 'menuToggle'} title="Room, teams & match settings" onClick={onToggleMenu}>⚙</button>
    </div>
  </header>;
}

// Everything app-like (room sharing, players/teams, match admin) lives behind
// the ⚙ menu so the live match screen stays board-first.
function SettingsMenu({ state, you, mode, setMode, onLeave, onClose }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; onLeave: ()=>void; onClose: ()=>void }) {
  const [copied, setCopied] = React.useState<'code' | 'invite' | null>(null);
  const copy = (text: string, kind: 'code' | 'invite') => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(kind); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  };
  const me = state.players[you];
  const connected = Object.values(state.players).filter(p => p.connected);
  return <aside className="settingsMenu">
    <div className="menuHead"><b>Match settings</b><button type="button" onClick={onClose}>✕</button></div>
    <section className="menuSection">
      <b>Room</b>
      <div className="menuRoomRow">
        <span className="menuRoomCode">{state.roomCode}</span>
        <button type="button" onClick={()=>copy(state.roomCode, 'code')}>{copied === 'code' ? 'Copied!' : 'Copy code'}</button>
        <button type="button" onClick={()=>copy(`Join my Babble League match! Room code: ${state.roomCode} → ${location.origin}`, 'invite')}>{copied === 'invite' ? 'Copied!' : 'Copy invite'}</button>
      </div>
    </section>
    <section className="menuSection">
      <b>Teams</b>
      {(['left','right'] as const).map(side => {
        const team = TEAMS[state.sideTeams[side]];
        const players = connected.filter(p => p.side === side);
        const mine = me?.side === side;
        const inv = state.powerPlayInventories[side] ?? [];
        const boxCount = state.powerPlayCounts?.[side] ?? inv.length;
        return <div key={side} className="sidePreview" style={{ borderColor: team.primary }}>
          <div className="sideHeader"><span>{side.toUpperCase()}</span>{boxCount > 0 && <span className="boxBadge" title={mine ? 'Boxes held by your team' : 'Opponents hold hidden boxes'}>📦×{boxCount}</span>}<strong>{team.emoji} {team.label}</strong></div>
          {mine && <div className="miniMascots">{TEAM_IDS.map(id => <button key={id} type="button" className={state.sideTeams[side]===id?'selected':''} title={TEAMS[id].label} style={{ background: TEAMS[id].primary, color: TEAMS[id].secondary }} onClick={()=>socket.emit('player:team', id)}>{TEAMS[id].emoji}</button>)}</div>}
          <div className="playerPreview">{players.length ? players.map(p => {
            // teammates see exactly who holds which box; opponents get nothing (server redacts)
            const held = mine ? inv.find(i => i.holderId === p.id) : undefined;
            return <span key={p.id} className={p.id===you?'you':''}>{p.name}{p.id===you?' (you)':''}{held ? ` 📦 ${BOX_TYPES[held.type].label}` : ''}</span>;
          }) : <span>Waiting…</span>}</div>
        </div>; })}
    </section>
    <section className="menuSection">
      <b>Match</b>
      <div className="menuActions">
        <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage</option><option value={3}>Qualifier</option><option value={5}>Champion</option></select>
        <button type="button" onClick={()=>socket.emit('game:start')}>{state.phase === 'lobby' ? 'Start match' : 'Restart kickoff'}</button>
        <button type="button" onClick={()=>socket.emit('game:reset', mode)}>Reset</button>
        <button type="button" onClick={onLeave} title="Leave the match and return to the main menu">Main menu</button>
      </div>
    </section>
  </aside>;
}

// Bottom action bar: your chip on the left, ability buttons in the middle,
// one contextual hint / cancel on the right. No match admin, no long copy.
function BottomActionBar({ state, you, placing, setPlacing, aiming, setAiming }: { state: GameState; you: string; placing: PlacingGhost | null; setPlacing: (p: PlacingGhost | null)=>void; aiming: AbilityAim | null; setAiming: (a: AbilityAim | null)=>void }) {
  const me = state.players[you];
  const inventory = me ? state.powerPlayInventories[me.side] : [];
  const oppSide: PlayerSide = me?.side === 'left' ? 'right' : 'left';
  const oppCount = state.powerPlayCounts?.[oppSide] ?? 0;
  const myTeam = me ? TEAMS[me.team] : null;
  const formationOpen = me && (state.phase === 'lobby' || state.formationSelectionTurn === state.turn);
  const onAbility = (type: BoxType) => {
    if (!me) return;
    const m = abilityMode(type);
    if (m === 'place') { setAiming(null); setPlacing({ type: type as FieldObjectType, pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: me.side === 'left' ? 0 : Math.PI }); return; }
    if (m === 'instant') { setAiming(null); setPlacing(null); socket.emit('player:power', { type }); return; }
    setPlacing(null);
    setAiming(aiming?.type === type ? null : { type, mode: m });
  };
  return <footer className="actionBar">
    {formationOpen && <div className="formationRow">{FORMATION_IDS.map(id=><button key={id} type="button" className={state.formations[me!.side]===id?'selected':''} onClick={()=>socket.emit('player:formation', id)} title={FORMATIONS[id].description}>{FORMATIONS[id].label}</button>)}</div>}
    <div className="actionBarRow">
      <div className="barLeft">
        {me && myTeam
          ? <span className="youChip" style={{ background: myTeam.primary, color: myTeam.secondary }}>{myTeam.emoji} {me.name}</span>
          : <span className="youChip spectator">Spectating</span>}
        {oppCount > 0 && <span className="oppChip" title={`Opponents hold ${oppCount} hidden box${oppCount === 1 ? '' : 'es'}`}>📦×{oppCount}</span>}
      </div>
      <div className="barCenter inventory">
        {state.phase === 'lobby' && <button type="button" className="primary" onClick={()=>socket.emit('game:start')}>Start match</button>}
        {me && state.phase !== 'lobby' && (inventory.length ? inventory.map((item: InventoryItem, i: number) => {
          const holder = item.holderId ? state.players[item.holderId] : undefined;
          const mine = !item.holderId || item.holderId === you;
          const locked = item.availableTurn > state.turn;
          const active = (aiming?.type === item.type || placing?.type === item.type) && mine;
          return <button key={`${item.type}-${i}`} type="button" className={active ? 'abilityBtn selected' : 'abilityBtn'} disabled={locked || !mine} title={mine ? BOX_TYPES[item.type].description : `Held by teammate ${holder?.name ?? '?'} — only they can use it.`} onClick={()=>onAbility(item.type as BoxType)}>
            <AbilityIcon type={item.type as BoxType}/>
            <span>{BOX_TYPES[item.type].label}{locked ? ` (turn ${item.availableTurn})` : ''}</span>
          </button>;
        }) : <small className="noPlays">No Power Plays — grab a ? box</small>)}
      </div>
      <div className="barRight">
        {aiming && <><small>{POWER_ICONS[aiming.type]} Targeting {BOX_TYPES[aiming.type].label} · {aiming.mode === 'babble' ? 'click a babblehead' : 'click a field spot'} · Esc cancels</small><button type="button" onClick={()=>setAiming(null)}>Cancel</button></>}
        {placing && <><small>{POWER_ICONS[placing.type as BoxType]} Placing {BOX_TYPES[placing.type as BoxType].label} · drag to aim · R rotates · Esc cancels</small><button type="button" onClick={()=>setPlacing(null)}>Cancel</button></>}
        {!placing && !aiming && state.phase === 'planning' && <small className="controlsHint">Hold a babblehead & drag back to aim, release to launch</small>}
      </div>
    </div>
  </footer>;
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
    let timer = 0;
    let stopped = false;
    const tick = () => {
      const f = frame.current;
      const started = performance.now();
      rendererRef.current?.render({ state: f.state, you: f.you, drag: f.drag, placing: f.placing, rotatingPad: f.rotatingPad });
      const cost = performance.now() - started;
      if (stopped) return;
      // Adaptive pump: on weak/software WebGL a frame can take hundreds of ms.
      // Back-to-back rAF would then starve React commits, socket events and
      // pointer input (the HUD would never appear). After any slow frame,
      // yield to the event loop at least as long as the frame took.
      if (cost > 50) timer = window.setTimeout(() => { raf = requestAnimationFrame(tick); }, Math.min(1000, cost * 1.5));
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); };
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
