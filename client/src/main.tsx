import React from 'react';
import { createRoot } from 'react-dom/client';
import { io, Socket } from 'socket.io-client';
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton, useAuth, useUser } from '@clerk/react';
import { BOX_TYPE_IDS, BOX_TYPES, BoxType, BoxTypeInput, ClientToServerEvents, FIELD, FieldObjectType, FORMATION_IDS, FORMATION_LAYOUTS, FORMATIONS, FormationId, GameMode, GameState, MAPS, MAP_IDS, MapId, PlayerSide, ROTATABLE_FIELD_OBJECTS, ServerToClientEvents, TEAM_IDS, TEAMS, Vec, normalizeBoxType } from '../../shared/types';
import { initXtremepush, normalizeEmbeddedLoyaltyMount, trackAnalyticsEvent, xtremepushCommand } from './analytics';
import { AudioSettings, audioManager, loadAudioSettings, saveAudioSettings } from './audio';
import { UNICUP_BRAND } from './brand';
import { readableTextColor } from './color';
import { buildMatchEndSummary } from './matchEnd';
import { authHeaders, ClerkTokenGetter, fetchUnicupIdentity, UnicupIdentity } from './auth';
import { BabbleLeague3DRenderer, PlacingGhost } from './render3d';
import { heldPowerPlayForPlayer } from './gameUiModel';
import { CountrySelector, RoundTimeControl, TournamentArchive, visibleRoundTimeSeconds } from './landingArchive';
import './styles.css';

type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;
const socket: Sock = io({ autoConnect: false });
let refreshLoyaltyToken: (() => void) | null = null;
let loyaltyExpiryHandlerInstalled = false;
const MAP_SELECT_HINTS: Record<MapId, string> = {
  stadium: 'classic',
  moon: 'low gravity',
  volcano: 'lava',
  saturn: 'heavy rings'
};

// Developer console API (no cheat UI ships in the app). It is available in
// every build; the server remains authoritative and warns the whole room after
// every successful grant.
(window as unknown as { __babbleDev?: unknown }).__babbleDev = {
  listTypes: () => [...BOX_TYPE_IDS],
  grantBox: (type: BoxTypeInput) => {
    const normalized = normalizeBoxType(type);
    if (!normalized) throw new Error(`Unknown box type "${type}". Try listTypes().`);
    socket.emit('player:cheatBox', { type: normalized });
    return `requested ${normalized} (server may reject; the whole room is warned)`;
  },
  grantAll: () => {
    socket.emit('player:cheatBoxes');
    return 'requested every box type (server may reject; the whole room is warned)';
  }
};

type AppAuth = { isLoaded: boolean; userId: string | null; getToken: ClerkTokenGetter };

function App({ auth, accountControls, suggestedName, playerAvatarUrl }: { auth: AppAuth; accountControls: React.ReactNode; suggestedName?: string; playerAvatarUrl?: string }) {
  const [state, setState] = React.useState<GameState | null>(null);
  const [you, setYou] = React.useState('');
  // 'bobble:name' is the legacy pre-rename localStorage key, read only for migration; new writes use 'babble:name'.
  const [name, setName] = React.useState(() => localStorage.getItem('babble:name') || localStorage.getItem('bobble:name') || `Player${Math.floor(Math.random()*99)}`);
  const [mode, setMode] = React.useState<GameMode>(3);
  const [mapId, setMapId] = React.useState<MapId>('stadium');
  const [roundTimeSeconds, setRoundTimeSeconds] = React.useState(20);
  const [roomCode, setRoomCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [conn, setConn] = React.useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [identity, setIdentity] = React.useState<UnicupIdentity | null>(null);
  const [identityVersion, setIdentityVersion] = React.useState(0);
  const [audioSettings, setAudioSettings] = React.useState<AudioSettings>(() => loadAudioSettings());
  const stateRef = React.useRef<GameState | null>(null);
  const leavingRef = React.useRef(false);
  const nameRef = React.useRef(name);
  stateRef.current = state;
  nameRef.current = name;

  React.useEffect(() => {
    socket.on('game:state', (s, playerId) => { if (leavingRef.current) return; setState(s); if (playerId) setYou(playerId); });
    socket.on('room:error', setError);
    socket.on('analytics:event', trackAnalyticsEvent);
    // On transport loss, reconnect with the current verified account/guest
    // identity so the server can reclaim the same seat safely.
    const onDisconnect = () => setConn('reconnecting');
    const onConnect = () => {
      setConn('connected');
      const s = stateRef.current;
      if (s?.roomCode) {
        socket.emit('room:join', { roomCode: s.roomCode, name: nameRef.current, avatarUrl: playerAvatarUrl }, res => {
          if (!res.ok) { setState(null); setYou(''); setError(`Reconnect failed: ${res.error}`); }
        });
      }
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => { socket.off('game:state'); socket.off('room:error'); socket.off('analytics:event', trackAnalyticsEvent); socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); };
  }, [playerAvatarUrl]);

  React.useEffect(() => {
    if (!auth.isLoaded) return;
    let active = true;
    setIdentity(null);
    setConn('connecting');
    void (async () => {
      try {
        const resolved = await fetchUnicupIdentity(fetch, auth.getToken);
        if (!active) return;
        const token = await auth.getToken();
        if (!active) return;
        setIdentity(resolved);
        socket.auth = token ? { token } : {};
        if (socket.connected) socket.disconnect();
        socket.connect();
      } catch {
        if (active) setError('Could not establish your player identity.');
      }
    })();
    return () => { active = false; };
  }, [auth.isLoaded, auth.userId, identityVersion]);

  React.useEffect(() => () => { socket.disconnect(); }, []);

  React.useEffect(() => {
    if (!suggestedName || localStorage.getItem('babble:name') || localStorage.getItem('bobble:name')) return;
    setName(suggestedName.slice(0, 18));
  }, [suggestedName]);

  React.useEffect(() => {
    audioManager.setSettings(audioSettings);
    saveAudioSettings(audioSettings);
  }, [audioSettings]);

  React.useEffect(() => {
    const unlock = () => { void audioManager.unlock(); };
    const clickSfx = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest('button,select,input')) audioManager.play('uiClick', { volume: 0.55 });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('click', clickSfx, true);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('click', clickSfx, true); };
  }, []);

  React.useEffect(() => {
    if (state?.mapId) setMapId(state.mapId);
  }, [state?.mapId]);

  // toasts should never linger forever
  React.useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const patchAudio = (patch: Partial<AudioSettings>) => setAudioSettings(s => ({ ...s, ...patch }));

  function createRoom() {
    if (!identity || !socket.connected) return setError('Player identity is still connecting.');
    leavingRef.current = false;
    localStorage.setItem('babble:name', name);
    socket.emit('room:create', { name, avatarUrl: playerAvatarUrl, mode, mapId, roundTimeSeconds }, res => res.ok ? (setRoomCode(res.roomCode), setError('')) : setError(res.error));
  }
  function joinRoom() {
    if (!identity || !socket.connected) return setError('Player identity is still connecting.');
    leavingRef.current = false;
    localStorage.setItem('babble:name', name);
    socket.emit('room:join', { roomCode: roomCode.toUpperCase(), name, avatarUrl: playerAvatarUrl }, res => res.ok ? (setError(''), setRoomCode(res.roomCode)) : setError(res.error));
  }

  const entryReady = identity !== null && conn === 'connected';

  return <main>
    {!state && <LandingPage
      name={name}
      setName={setName}
      mode={mode}
      setMode={setMode}
      mapId={mapId}
      setMapId={setMapId}
      roundTimeSeconds={roundTimeSeconds}
      setRoundTimeSeconds={setRoundTimeSeconds}
      roomCode={roomCode}
      setRoomCode={setRoomCode}
      audioSettings={audioSettings}
      onAudioChange={patchAudio}
      onCreateRoom={createRoom}
      onJoinRoom={joinRoom}
      error={error}
      accountControls={accountControls}
      identity={identity}
      ready={entryReady}
      getToken={auth.getToken}
      onIdentityRefresh={()=>setIdentityVersion(value=>value + 1)}
    />}
    {state && <GameScreen state={state} you={you} mode={mode} setMode={setMode} mapId={mapId} setMapId={setMapId} roundTimeSeconds={roundTimeSeconds} setRoundTimeSeconds={setRoundTimeSeconds} audioSettings={audioSettings} onAudioChange={patchAudio} error={error} onDismissError={()=>setError('')} onLeave={()=>{ leavingRef.current = true; socket.emit('room:leave'); setState(null); setYou(''); setRoomCode(''); setError(''); }}/>}
    {conn === 'reconnecting' && <div className="connBanner" role="status">Connection lost — reconnecting…</div>}
  </main>;
}

type LandingPageProps = {
  name: string;
  setName: React.Dispatch<React.SetStateAction<string>>;
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  mapId: MapId;
  setMapId: (mapId: MapId) => void;
  roundTimeSeconds: number;
  setRoundTimeSeconds: (seconds: number) => void;
  roomCode: string;
  setRoomCode: React.Dispatch<React.SetStateAction<string>>;
  audioSettings: AudioSettings;
  onAudioChange: (patch: Partial<AudioSettings>) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  error: string;
  accountControls: React.ReactNode;
  identity: UnicupIdentity | null;
  ready: boolean;
  getToken: ClerkTokenGetter;
  onIdentityRefresh: () => void;
};

function LandingPage({ name, setName, mode, setMode, mapId, setMapId, roundTimeSeconds, setRoundTimeSeconds, roomCode, setRoomCode, audioSettings, onAudioChange, onCreateRoom, onJoinRoom, error, accountControls, identity, ready, getToken, onIdentityRefresh }: LandingPageProps) {
  const [deskView, setDeskView] = React.useState<'host' | 'join'>('host');
  const hostTabRef = React.useRef<HTMLButtonElement>(null);
  const joinTabRef = React.useRef<HTMLButtonElement>(null);
  const onDeskTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = event.key === 'ArrowRight' || event.key === 'End'
      ? 'join'
      : event.key === 'ArrowLeft' || event.key === 'Home'
        ? 'host'
        : null;
    if (!next) return;
    event.preventDefault();
    setDeskView(next);
    (next === 'host' ? hostTabRef : joinTabRef).current?.focus();
  };

  return <div className="landing" id="top">
    <section className="landingHero" aria-label="PlanetBall tournament entry">
      <div className="heroScene">
        <picture className="heroArt" aria-hidden="true">
          <source media="(max-width: 720px)" srcSet={UNICUP_BRAND.art.heroMobile}/>
          <img src={UNICUP_BRAND.art.heroDesktop} alt=""/>
        </picture>
        <header className="siteHeader">
          <a className="brandMark" href="#top" aria-label={`${UNICUP_BRAND.name} home`}><img src={UNICUP_BRAND.art.logo} alt=""/></a>
          <nav aria-label="Landing navigation">
            <a href="#powerups">Power plays</a>
            <a href="#teams">Teams</a>
            <a href="#maps">Maps</a>
            <a className="navPlay" href="#play">Play</a>
          </nav>
          {accountControls}
        </header>
        <div className="heroCopy">
          <p className="heroKicker">The Universe Cup / PlanetBall season 01</p>
          <h1 aria-label={UNICUP_BRAND.name}><img src={UNICUP_BRAND.art.logo} alt=""/></h1>
          <p className="heroTagline">{UNICUP_BRAND.tagline}</p>
          <p className="heroMission">{UNICUP_BRAND.mission}</p>
          <a className="heroCta" href="#play">Enter tournament <span aria-hidden="true">&#8594;</span></a>
          <p className="heroRule"><span aria-hidden="true">&#10022;</span> {UNICUP_BRAND.principles[0]}</p>
        </div>
        <div className="seasonSeal" aria-hidden="true"><span>01</span><b>UNI<br/>CUP</b></div>
      </div>

      <aside className="tournamentDesk" id="play" aria-labelledby="deskTitle">
        <div className="deskHead">
          <div><p>Unicap entry terminal / T-01</p><h2 id="deskTitle">Create or join</h2></div>
          <span className="deskLive"><i/> Live</span>
        </div>

        <div className={`identityStrip ${identity?.kind ?? 'loading'}`}>
          <span><i/>{identity?.kind === 'account' ? 'Account progress protected' : identity?.kind === 'guest' ? 'Playing as guest' : 'Connecting player'}</span>
          {identity?.kind === 'guest' && <small>Sign up anytime to keep this progress across devices.</small>}
        </div>
        {identity?.kind === 'account' && <CountrySelector country={identity.country} getToken={getToken} onSaved={onIdentityRefresh}/>}

        <label className="deskField">Player name
          <input value={name} onChange={e=>setName(e.target.value)} maxLength={18} autoComplete="nickname"/>
        </label>

        <div className="deskTabs" role="tablist" aria-label="Tournament entry mode">
          <button ref={hostTabRef} id="desk-tab-host" type="button" role="tab" aria-controls="desk-panel-host" aria-selected={deskView === 'host'} tabIndex={deskView === 'host' ? 0 : -1} className={deskView === 'host' ? 'selected' : ''} onClick={()=>setDeskView('host')} onKeyDown={onDeskTabKeyDown}>Host match</button>
          <button ref={joinTabRef} id="desk-tab-join" type="button" role="tab" aria-controls="desk-panel-join" aria-selected={deskView === 'join'} tabIndex={deskView === 'join' ? 0 : -1} className={deskView === 'join' ? 'selected' : ''} onClick={()=>setDeskView('join')} onKeyDown={onDeskTabKeyDown}>Join room</button>
        </div>

        {deskView === 'host' ? <div id="desk-panel-host" className="deskPanel" role="tabpanel" aria-labelledby="desk-tab-host">
          <label className="deskField">Tournament format
            <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}>
              <option value={1}>Scrimmage / 1 goal / 30 turns</option>
              <option value={3}>Qualifier / 3 goals / 90 turns</option>
              <option value={5}>Champion / 5 goals / 150 turns</option>
            </select>
          </label>
          <label className="deskField">Planet arena
            <select className="mapSelect" value={mapId} onChange={e=>setMapId(e.target.value as MapId)}>
              {MAP_IDS.map(id => <option key={id} value={id}>{MAPS[id].label} / {MAP_SELECT_HINTS[id]}</option>)}
            </select>
          </label>
          <label className="deskField roundTimeField">Round time <span>{roundTimeSeconds}s</span>
            <RoundTimeControl value={roundTimeSeconds} onChange={setRoundTimeSeconds}/>
          </label>
          <button type="button" className="primary deskSubmit" onClick={onCreateRoom} disabled={!ready}>Create room <span aria-hidden="true">&#8594;</span></button>
        </div> : <div id="desk-panel-join" className="deskPanel" role="tabpanel" aria-labelledby="desk-tab-join">
          <label className="deskField">Room code
            <input className="codeInput" value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} maxLength={8} placeholder="ABC12" autoComplete="off"/>
          </label>
          <button type="button" className="primary deskSubmit" onClick={onJoinRoom} disabled={!ready}>Join room <span aria-hidden="true">&#8594;</span></button>
          <p className="deskNote">Your team and tournament kit are selected inside the room.</p>
        </div>}

        <AudioControls settings={audioSettings} onChange={onAudioChange}/>
        <LoyaltyWidget nickname={name} getToken={getToken}/>
        {error && <p className="lobbyError" role="alert">{error}</p>}
      </aside>
    </section>

    <TournamentArchive/>

    <section className="originScene" id="origin">
      <div className="sectionLabel">The origin / year very very far away</div>
      <div className="originLead">
        <p>Peace finally won.</p>
        <h2>So humanity<br/>got goofy.</h2>
      </div>
      <div className="originBeats">
        <article><span>01</span><h3>One button too many</h3><p>Everyone became powerful enough to erase everyone else. The next generations destroyed the weapons for good.</p></article>
        <article><span>02</span><h3>Hands were history</h3><p>To make sure nobody could build them again, people engineered themselves without hands. Awkward. Effective.</p></article>
        <article><span>03</span><h3>Unicap took the keys</h3><p>The nonprofit received every resource in the universe, with one rule: distribute everything and use nothing itself.</p></article>
        <article><span>04</span><h3>The fairest game</h3><p>Income, debate, and history all caused conflict. Tournaments did not. Soccer became Unicup, the first great resource league.</p></article>
      </div>
    </section>

    <section className="climbScene" id="ball-office">
      <img src={UNICUP_BRAND.art.roadToBallOffice} alt="Handless Unicup athletes climbing the PlanetBall tournament road toward the Unicap Ball Office" loading="lazy" decoding="async"/>
      <div className="climbCopy">
        <p className="sectionLabel">Your season objective</p>
        <h2>Climb the board.<br/>Reach the office.</h2>
        <p>Unicap stopped obeying its only rule. Resources now grow its control. Win through the league, reach the Ball Office, and find out who changed the game.</p>
      </div>
    </section>

    <section className="fairPlayScene" id="fair-play">
      <div className="fairPlayStatement">
        <p className="sectionLabel">The competitive oath</p>
        <h2>Power is earned.<br/><span>Style is yours.</span></h2>
      </div>
      <div className="fairPlayCopy">
        <p>Unicup is built for cybersport. Competition stays readable, learnable, and fair across every season.</p>
        <strong>{UNICUP_BRAND.principles[0]}</strong>
        <p>Personalization lives in tournament kits, colors, celebrations, ball finishes, banners, and PlanetBall style. Money never buys match power.</p>
      </div>
    </section>

    <section className="futureScene" aria-labelledby="futureTitle">
      <p className="sectionLabel">The universe keeps rolling</p>
      <h2 id="futureTitle">A league bigger than one planet.</h2>
      <div className="futureTrack">{UNICUP_BRAND.future.map((item, index)=><span key={item}><b>{String(index + 1).padStart(2, '0')}</b>{item}</span>)}</div>
      <a className="futureCta" href="#play">Take the first kick <span aria-hidden="true">&#8593;</span></a>
    </section>

    <footer className="landingFooter"><img src={UNICUP_BRAND.art.logo} alt="Unicup"/><span>Universe Cup transmission / PlanetBall season 01</span><a href="#top">Back to orbit &#8593;</a></footer>
  </div>;
}

function LoyaltyWidget({ nickname, getToken }: { nickname: string; getToken: ClerkTokenGetter }) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const generationRef = React.useRef(0);
  const [config, setConfig] = React.useState<{ loyaltyEnabled: boolean; loyaltyEndpoint: string | null } | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    fetch('/api/config', { signal: AbortSignal.timeout(10_000) }).then(r => {
      if (!r.ok) throw new Error('Config unavailable');
      return r.json();
    }).then(value => {
      if (!active) return;
      const next = value as { loyaltyEnabled?: boolean; loyaltyEndpoint?: string | null };
      setConfig({ loyaltyEnabled: Boolean(next.loyaltyEnabled), loyaltyEndpoint: next.loyaltyEndpoint ?? null });
    }).catch(() => { if (active) setConfig({ loyaltyEnabled: false, loyaltyEndpoint: null }); });
    return () => { active = false; };
  }, []);

  React.useEffect(() => {
    const endpoint = config?.loyaltyEndpoint;
    const cleanName = nickname.trim();
    if (!open || !config?.loyaltyEnabled || !endpoint || !cleanName || !hostRef.current) return;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    let installedRefresh: (() => void) | null = null;
    let mountObserver: MutationObserver | null = null;
    const timer = window.setTimeout(async () => {
      try {
        const sdkReady = await initXtremepush();
        if (!sdkReady || controller.signal.aborted || generation !== generationRef.current) throw new Error('SDK unavailable');
        const response = await fetch('/api/loyalty/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...await authHeaders(getToken) },
          body: JSON.stringify({ nickname: cleanName }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error('Token unavailable');
        const session = await response.json() as { token: string; userId: string };
        if (controller.signal.aborted || generation !== generationRef.current) return;
        xtremepushCommand('set', 'user_id', session.userId);
        xtremepushCommand('set', 'loyalty_endpoint', `https://${endpoint}`);
        xtremepushCommand('set', 'loyalty_token', session.token);
        refreshLoyaltyToken = () => {
          void authHeaders(getToken).then(headers => fetch('/api/loyalty/token', {
            method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ nickname: cleanName }), signal: controller.signal
          })).then(r => r.ok ? r.json() : Promise.reject()).then((fresh: { token: string }) => {
            if (generation === generationRef.current && !controller.signal.aborted) xtremepushCommand('set', 'loyalty_token', fresh.token);
          }).catch(() => undefined);
        };
        installedRefresh = refreshLoyaltyToken;
        if (!loyaltyExpiryHandlerInstalled) {
          xtremepushCommand('on', 'loyalty_token_expired', () => refreshLoyaltyToken?.());
          loyaltyExpiryHandlerInstalled = true;
        }
        const host = hostRef.current;
        if (!host) return;
        host.replaceChildren();
        const width = Math.max(280, Math.min(420, host.clientWidth));
        const height = Math.max(360, Math.min(580, window.innerHeight - 190));
        const captureEmbeddedFrame = () => {
          if (generation !== generationRef.current) return;
          iframeRef.current = normalizeEmbeddedLoyaltyMount(host);
        };
        mountObserver = new MutationObserver(captureEmbeddedFrame);
        mountObserver.observe(host, { childList: true, subtree: true });
        xtremepushCommand('mountLoyalty', width, height, host);
        captureEmbeddedFrame();
      } catch { /* The game remains usable when Loyalty is unavailable. */ }
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      mountObserver?.disconnect();
      iframeRef.current = null;
      hostRef.current?.replaceChildren();
      document.getElementById('loyalty-widget-button')?.remove();
      document.getElementById('loyalty-frame-container')?.remove();
      if (refreshLoyaltyToken === installedRefresh) refreshLoyaltyToken = null;
    };
  }, [config, nickname, getToken, open]);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  React.useEffect(() => {
    const endpoint = config?.loyaltyEndpoint;
    if (!endpoint) return;
    const onMessage = (event: MessageEvent) => {
      const mountedFrame = iframeRef.current ?? hostRef.current?.querySelector<HTMLIFrameElement>('iframe') ?? null;
      if (mountedFrame) iframeRef.current = mountedFrame;
      if (event.origin !== `https://${endpoint}` || event.source !== mountedFrame?.contentWindow || !event.data || event.data.source !== 'Scrimmage') return;
      if (event.data.type === 'error') console.warn('Xtremepush Loyalty widget error', event.data.payload?.type ?? 'unknown');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [config?.loyaltyEndpoint]);

  if (!config?.loyaltyEnabled || !config.loyaltyEndpoint) return null;
  return <div className="loyaltyHome">
    {open && <aside className="loyaltyHomePanel" aria-label="Unicup loyalty program">
      <header><span><small>Unicap season account</small><b>Rewards &amp; XP</b></span><button type="button" onClick={()=>setOpen(false)} aria-label="Close rewards" title="Close">&#215;</button></header>
      <div className="loyaltyEmbed" ref={hostRef}/>
    </aside>}
    <button type="button" className="loyaltyHomeTrigger" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span aria-hidden="true">&#10022;</span> Rewards</button>
  </div>;
}
// One icon per Power Play, reused across HUD buttons and hints.
const POWER_ICONS: Record<BoxType, string> = {
  beachBall: '🏖', moveBall: '🎯', swapGoals: '🔄', bigBumpers: '💥', boost: '⚡',
  stickyGoo: '🟢', ramp: '⛰️', block: '🧱', bigHead: '🗣️', ghosted: '👻', movePlayer: '🚚',
  yellowCard: '🟨', redCard: '🟥', readPlay: '◉', blindness: '●'
};

// Ability icon: generated art from public/assets/abilities with an emoji
// fallback if the asset is missing or fails to load.
function AbilityIcon({ type }: { type: BoxType }) {
  const [failed, setFailed] = React.useState(false);
  if (type === 'blindness') return <span className="abilityBlindnessGlyph" aria-hidden="true"><i/></span>;
  if (failed) return <span className="abilityEmoji" aria-hidden="true">{POWER_ICONS[type]}</span>;
  return <img className="abilityImg" src={`/assets/abilities/${type}.png`} alt="" draggable={false} onError={() => setFailed(true)}/>;
}

// Ability flow: nothing is targetable until an ability button is clicked.
// place  -> drag a ghost onto the field (Esc cancels)
// babble -> click a babblehead to apply immediately (Esc/Cancel aborts)
// point  -> click a field spot to apply immediately (Esc/Cancel aborts)
// instant-> applies on button click
export type AbilityAim = { type: BoxType; mode: 'babble' | 'point' };
export function abilityMode(type: BoxType): 'place' | 'babble' | 'point' | 'instant' {
  if (type === 'moveBall') return 'point';
  if (BOX_TYPES[type].category === 'field') return 'place';
  if (BOX_TYPES[type].category === 'babble') return 'babble';
  return 'instant';
}

function AudioControls({ settings, onChange }: { settings: AudioSettings; onChange: (patch: Partial<AudioSettings>) => void }) {
  return <div className="audioControls" aria-label="Audio settings">
    <b>Audio</b>
    <label>Music <span>{Math.round(settings.musicVolume * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={settings.musicVolume} onChange={e=>onChange({ musicVolume: Number(e.target.value) })}/></label>
    <label>SFX <span>{Math.round(settings.sfxVolume * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={settings.sfxVolume} onChange={e=>onChange({ sfxVolume: Number(e.target.value) })}/></label>
  </div>;
}

function GameScreen({ state, you, mode, setMode, mapId, setMapId, roundTimeSeconds, setRoundTimeSeconds, audioSettings, onAudioChange, error, onDismissError, onLeave }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; mapId: MapId; setMapId: (m: MapId)=>void; roundTimeSeconds: number; setRoundTimeSeconds: (seconds: number)=>void; audioSettings: AudioSettings; onAudioChange: (patch: Partial<AudioSettings>)=>void; error: string; onDismissError: ()=>void; onLeave: ()=>void }) {
  const [placing, setPlacing] = React.useState<PlacingGhost | null>(null);
  const [aiming, setAiming] = React.useState<AbilityAim | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [burst, setBurst] = React.useState<{ kind: 'goal'; side: PlayerSide | null; nonce: number } | null>(null);
  const prevRef = React.useRef<GameState | null>(null);

  React.useEffect(() => {
    const prev = prevRef.current;
    if (prev) {
      const scoreChanged = state.score.left !== prev.score.left || state.score.right !== prev.score.right;
      const scoredSide: PlayerSide | null = state.score.left > prev.score.left ? 'left' : state.score.right > prev.score.right ? 'right' : null;
      if (scoreChanged) {
        audioManager.play('goal', { force: true });
        setBurst({ kind: 'goal', side: scoredSide, nonce: Date.now() });
      }
      if (state.winner && state.winner !== prev.winner) {
        window.setTimeout(() => audioManager.play('gameOver', { force: true }), scoreChanged ? 650 : 0);
      }
      const prevBumperAt = Math.max(0, ...prev.bumperEvents.map(e => e.at));
      if (state.bumperEvents.some(e => e.at > prevBumperAt)) audioManager.play(state.bigBumpersUntilTurn && state.bigBumpersUntilTurn >= state.turn ? 'megaBumper' : 'bumper');
      const invTotal = (s: GameState) => s.powerPlayInventories.left.length + s.powerPlayInventories.right.length;
      if (invTotal(state) > invTotal(prev)) audioManager.play('boxPickup');
    }
    prevRef.current = state;
  }, [state]);

  React.useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(null), 2400);
    return () => window.clearTimeout(t);
  }, [burst]);

  React.useEffect(() => {
    if (state.phase === 'planning') return;
    setPlacing(null);
    setAiming(null);
    if (state.phase === 'finished') setMenuOpen(false);
  }, [state.phase]);

  const matchFinished = state.phase === 'finished';
  const yourSide = state.players[you]?.side;
  const blindnessTurn = yourSide ? state.blindnessUntilTurn?.[yourSide] : null;
  const blinded = blindnessTurn !== null && blindnessTurn !== undefined && blindnessTurn >= state.turn;

  return <section className="gameShell" style={{ backgroundImage: `url(${MAPS[state.mapId].art.surroundings})` }}>
    <Game3D state={state} you={you} placing={placing} setPlacing={setPlacing} aiming={aiming} setAiming={setAiming}/>
    {!matchFinished && <TopHud state={state} you={you} menuOpen={menuOpen} onToggleMenu={()=>setMenuOpen(v=>!v)}/>}
    {!matchFinished && menuOpen && <SettingsMenu state={state} you={you} mode={mode} setMode={setMode} mapId={mapId} setMapId={setMapId} roundTimeSeconds={roundTimeSeconds} setRoundTimeSeconds={setRoundTimeSeconds} audioSettings={audioSettings} onAudioChange={onAudioChange} onLeave={onLeave} onClose={()=>setMenuOpen(false)}/>}
    {!matchFinished && <BottomActionBar state={state} you={you} placing={placing} setPlacing={setPlacing} aiming={aiming} setAiming={setAiming}/>}
    {matchFinished && <MatchEndOverlay state={state} onPlayAgain={()=>socket.emit('game:start')} onBackToLobby={()=>socket.emit('game:reset', state.mode)} onLeave={onLeave}/>}
    {burst && <CelebrationOverlay key={`${burst.kind}-${burst.nonce}`} kind={burst.kind} side={burst.side} state={state}/>}
    {error && <section className="panel error" role="alert" title="Click to dismiss" onClick={onDismissError}>{error}<span className="errorClose"> ✕</span></section>}
    {blinded && <div className="blindnessVeil" role="alert" aria-live="assertive"><span>Opponent power play</span><strong>Blindness</strong><p>Your screen is intentionally hidden until this turn ends.</p><small>Turn {state.turn} / {state.config.maxTurns}</small></div>}
  </section>;
}

function PlayerAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return avatarUrl
    ? <img className="playerAvatar" src={avatarUrl} alt="" referrerPolicy="no-referrer"/>
    : <span className="playerAvatar fallback" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || '?'}</span>;
}

function TeamRoster({ state, side, you }: { state: GameState; side: PlayerSide; you: string }) {
  const team = TEAMS[state.sideTeams[side]];
  const players = Object.values(state.players).filter(player => player.connected && player.side === side);
  return <section className={`teamRoster ${side}`} style={{ '--team': team.primary } as React.CSSProperties} aria-label={`${team.label} roster`}>
    <div className="rosterIdentity">
      <img src={team.crest} alt=""/>
      <span><b>{team.shortLabel}</b><small>{players.length}/4 players</small></span>
      <strong>{state.score[side]}</strong>
    </div>
    <div className="rosterPlayers">
      {Array.from({ length: 4 }, (_, index) => {
        const player = players[index];
        return player
          ? <div key={player.id} className={`rosterPlayer ${player.id === you ? 'you' : ''}`}>
              <PlayerAvatar name={player.name} avatarUrl={player.avatarUrl}/>
              <span><b>{player.name}</b><small>{player.controlledBabbleIds.length} babble{player.controlledBabbleIds.length === 1 ? '' : 's'}</small></span>
            </div>
          : <div key={`open-${index}`} className="rosterPlayer open"><span className="playerAvatar fallback">+</span><span><b>Open slot</b><small>Waiting</small></span></div>;
      })}
    </div>
  </section>;
}

function MatchEndOverlay({ state, onPlayAgain, onBackToLobby, onLeave }: { state: GameState; onPlayAgain: ()=>void; onBackToLobby: ()=>void; onLeave: ()=>void }) {
  const summary = buildMatchEndSummary(state);
  const leftTeam = TEAMS[state.sideTeams.left];
  const rightTeam = TEAMS[state.sideTeams.right];
  return <section className="matchEndLayer" aria-live="polite" aria-label="Match finished">
    <div className="matchEndCard" role="dialog" aria-modal="false" aria-labelledby="matchEndTitle" style={summary.winnerTeamColor ? { borderColor: summary.winnerTeamColor } : undefined}>
      <p className="matchEndKicker">Final whistle</p>
      <h2 id="matchEndTitle">{summary.title}</h2>
      <p className="matchEndSub">{summary.winnerSideLabel} takes the match</p>
      <div className="matchEndScore" aria-label={`Final score ${summary.scoreline}`}>
        <span style={{ background: leftTeam.primary, color: readableTextColor(leftTeam.primary) }}><b>Left</b><strong>{state.score.left}</strong></span>
        <em>vs</em>
        <span style={{ background: rightTeam.primary, color: readableTextColor(rightTeam.primary) }}><b>Right</b><strong>{state.score.right}</strong></span>
      </div>
      <dl className="matchEndStats">{summary.stats.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      <div className="matchEndActions">
        <button type="button" className="primary" onClick={onPlayAgain}>Play again</button>
        <button type="button" onClick={onBackToLobby}>Back to lobby</button>
        <button type="button" onClick={onLeave}>Main menu</button>
      </div>
    </div>
  </section>;
}

function CelebrationOverlay({ kind, side, state }: { kind: 'goal'; side: PlayerSide | null; state: GameState }) {
  const team = side ? TEAMS[state.sideTeams[side]] : null;
  const label = 'GOOOAL!';
  return <div className={`celebrationOverlay ${kind}`} aria-live="polite">
    <div className="confetti" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <span key={i} style={{ '--i': i } as React.CSSProperties}/>)}</div>
    <div className="celebrationCard" style={team ? { borderColor: team.primary } : undefined}>
      <span className="celebrationEmoji">⚽✨</span>
      <strong>{label}</strong>
      <small>{side === 'left' ? 'Left' : 'Right'} side scored!</small>
    </div>
  </div>;
}

// Compact top HUD: score pills flanking the live match status. The status
// string keeps the exact "turn X/Y · phase · Ns · aimed n/m" format that the
// smoke checks and match tooling parse.
function TopHud({ state, you, menuOpen, onToggleMenu }: { state: GameState; you: string; menuOpen: boolean; onToggleMenu: ()=>void }) {
  const secs = Math.max(0, Math.ceil((state.turnDeadlineAt - (state.serverNowAt ?? Date.now())) / 1000));
  return <header className="topHud">
    <TeamRoster state={state} side="left" you={you}/>
    <div className="matchStatus">
      <b className="matchMap">{MAPS[state.mapId].shortLabel} · first to {state.config.goalTarget}</b>
      <span className="timerBadge" aria-label={`${secs} seconds remaining`}><strong>{secs}</strong><em>sec</em></span>
      <span className="turnCounter">Turn {state.turn}<b>/{state.config.maxTurns}</b></span>
      <small>turn {state.turn}/{state.config.maxTurns} · {state.phase} · {secs}s · aimed {Object.keys(state.pendingIntents).length}/{state.babbles.length}</small>
      <span className="roomInline">Room <b>{state.roomCode}</b></span>
    </div>
    <TeamRoster state={state} side="right" you={you}/>
    <button type="button" className={menuOpen ? 'menuToggle selected' : 'menuToggle'} aria-label="Match settings" title="Room, teams and match settings" onClick={onToggleMenu}>⚙</button>
  </header>;
}

// Everything app-like (room sharing, players/teams, match admin) lives behind
// the ⚙ menu so the live match screen stays board-first.
function SettingsMenu({ state, you, mode, setMode, mapId, setMapId, roundTimeSeconds, setRoundTimeSeconds, audioSettings, onAudioChange, onLeave, onClose }: { state: GameState; you: string; mode: GameMode; setMode: (m: GameMode)=>void; mapId: MapId; setMapId: (m: MapId)=>void; roundTimeSeconds: number; setRoundTimeSeconds: (seconds: number)=>void; audioSettings: AudioSettings; onAudioChange: (patch: Partial<AudioSettings>)=>void; onLeave: ()=>void; onClose: ()=>void }) {
  const [copied, setCopied] = React.useState<'code' | 'invite' | null>(null);
  const copy = (text: string, kind: 'code' | 'invite') => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(kind); setTimeout(() => setCopied(null), 1600); }).catch(() => {});
  };
  const me = state.players[you];
  const connected = Object.values(state.players).filter(p => p.connected);
  return <aside className="settingsMenu">
    <div className="menuHead"><b>Match settings</b><button type="button" aria-label="Close settings" title="Close settings" onClick={onClose}>✕</button></div>
    <section className="menuSection">
      <b>Room</b>
      <div className="menuRoomRow">
        <span className="menuRoomCode">{state.roomCode}</span>
        <button type="button" onClick={()=>copy(state.roomCode, 'code')}>{copied === 'code' ? 'Copied!' : 'Copy code'}</button>
        <button type="button" onClick={()=>copy(`Join my Unicup match! Room code: ${state.roomCode} -> ${location.origin}`, 'invite')}>{copied === 'invite' ? 'Copied!' : 'Copy invite'}</button>
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
          <div className="sideHeader"><span>{side.toUpperCase()}</span>{boxCount > 0 && <span className="boxBadge" title={mine ? 'Boxes held by your team' : 'Opponents hold hidden boxes'}>Box ×{boxCount}</span>}<strong><img src={team.crest} alt=""/><span>{team.label}</span></strong></div>
          <small className="teamTrait">{team.robot.shape} chassis · {team.robot.trait}</small>
          {mine && state.phase === 'lobby' && <div className="miniMascots">{TEAM_IDS.map(id => <button key={id} type="button" className={state.sideTeams[side]===id?'selected':''} aria-label={TEAMS[id].label} title={TEAMS[id].label} style={{ background: TEAMS[id].primary }} onClick={()=>socket.emit('player:team', id)}><img src={TEAMS[id].crest} alt=""/></button>)}</div>}
          <div className="playerPreview">{players.length ? players.map(p => {
            // teammates see exactly who holds which box; opponents get nothing (server redacts)
            const held = mine ? inv.find(i => i.holderId === p.id) : undefined;
            return <span key={p.id} className={p.id===you?'you':''}><PlayerAvatar name={p.name} avatarUrl={p.avatarUrl}/>{p.name}{p.id===you?' (you)':''}{held ? ` · ${BOX_TYPES[held.type].label}` : ''}</span>;
          }) : <span>Waiting…</span>}</div>
          {state.phase === 'lobby' && <button type="button" className={mine ? 'sideChoice selected' : 'sideChoice'} disabled={mine} onClick={()=>socket.emit('player:side', side)}>{mine ? 'Your side' : `Join ${side}`}</button>}
        </div>; })}
    </section>
    <section className="menuSection">
      <AudioControls settings={audioSettings} onChange={onAudioChange}/>
    </section>
    <section className="menuSection">
      <b>Match</b>
      <label>Map
        <select className="mapSelect" value={state.phase === 'lobby' ? mapId : state.mapId} disabled={state.phase !== 'lobby'} onChange={e => { const next = e.target.value as MapId; setMapId(next); socket.emit('room:map', next); }}>
          {MAP_IDS.map(id => <option key={id} value={id}>{MAPS[id].label}</option>)}
        </select>
      </label>
      {state.phase !== 'lobby' && <small className="menuNote">{MAPS[state.mapId].label} is locked until reset.</small>}
      <label>Round time <span>{visibleRoundTimeSeconds(state.phase, roundTimeSeconds, state.config.roundTimeSeconds)}s</span>
        <RoundTimeControl value={state.phase === 'lobby' ? roundTimeSeconds : state.config.roundTimeSeconds} disabled={state.phase !== 'lobby'} onChange={next => { setRoundTimeSeconds(next); socket.emit('room:roundTime', next); }}/>
      </label>
      <div className="menuActions">
        <select value={mode} onChange={e=>setMode(Number(e.target.value) as GameMode)}><option value={1}>Scrimmage</option><option value={3}>Qualifier</option><option value={5}>Champion</option></select>
        <button type="button" onClick={()=>socket.emit('game:start')}>{state.phase === 'lobby' ? 'Start match' : 'Restart kickoff'}</button>
        <button type="button" onClick={()=>socket.emit('game:reset', mode)}>Reset</button>
        <button type="button" onClick={onLeave} title="Leave the match and return to the main menu">Main menu</button>
      </div>
    </section>
  </aside>;
}

function FormationGlyph({ formation }: { formation: FormationId }) {
  return <svg className="formationGlyph" viewBox="0 0 48 30" aria-hidden="true">
    <rect x="1" y="1" width="46" height="28" rx="2"/>
    <path d="M24 1v28M1 15h46"/>
    {FORMATION_LAYOUTS[formation].map((point, index) => <circle key={index} cx={4 + point.x / FIELD.width * 40} cy={3 + point.y / FIELD.height * 24} r="2.4"/>)}
  </svg>;
}

function FormationDock({ state, me }: { state: GameState; me: GameState['players'][string] }) {
  const kickoffSelection = state.phase === 'planning' && state.formationSelectionTurn === state.turn;
  if (!me || (state.phase !== 'lobby' && !kickoffSelection)) return null;
  const selected = state.formations[me.side];
  return <div className="formationDock" aria-label="Team formation">
    <div className="formationFocus" aria-live="polite">
      <FormationGlyph formation={selected}/>
      <b>{FORMATIONS[selected].label}</b>
    </div>
    {FORMATION_IDS.map(id => <button key={id} type="button" className={state.formations[me.side] === id ? 'selected' : ''} aria-label={FORMATIONS[id].label} title={`${FORMATIONS[id].label}: ${FORMATIONS[id].description}`} onClick={() => socket.emit('player:formation', id)}>
      <FormationGlyph formation={id}/>
      <span>{FORMATIONS[id].label}</span>
    </button>)}
  </div>;
}

function BottomActionBar({ state, you, placing, setPlacing, aiming, setAiming }: { state: GameState; you: string; placing: PlacingGhost | null; setPlacing: (p: PlacingGhost | null)=>void; aiming: AbilityAim | null; setAiming: (a: AbilityAim | null)=>void }) {
  const me = state.players[you];
  const held = heldPowerPlayForPlayer(state, you);
  const oppSide: PlayerSide = me?.side === 'left' ? 'right' : 'left';
  const oppCount = state.powerPlayCounts?.[oppSide] ?? 0;
  const readyTotal = Object.values(state.players).filter(p => p.connected).length;
  const readyCount = state.readyPlayerIds.filter(id => state.players[id]?.connected).length;
  const ready = Boolean(me && state.readyPlayerIds.includes(me.id));
  const onAbility = (type: BoxType) => {
    if (!me || state.phase !== 'planning') return;
    const m = abilityMode(type);
    if (m === 'place') { setAiming(null); setPlacing({ type: type as FieldObjectType, pos: { x: FIELD.width / 2, y: FIELD.height / 2 }, angle: me.side === 'left' ? 0 : Math.PI }); return; }
    if (m === 'instant') { setAiming(null); setPlacing(null); audioManager.play('abilityUse'); socket.emit('player:power', { type }); return; }
    setPlacing(null);
    setAiming(aiming?.type === type ? null : { type, mode: m });
  };
  return <footer className="actionControls">
    <FormationDock state={state} me={me}/>
    <div className="abilityCluster">
      <button type="button" className={`abilityTrigger ${held ? 'held' : 'empty'} ${(held && (aiming?.type === held.type || placing?.type === held.type)) ? 'selected' : ''}`} disabled={!held || held.locked || state.phase !== 'planning'} aria-label={held ? `Use ${BOX_TYPES[held.type].label}` : 'No Power Play held'} title={held ? `${BOX_TYPES[held.type].label}: ${BOX_TYPES[held.type].description}` : 'Pick up a box to hold one Power Play'} onClick={() => held && onAbility(held.type)}>
        {held ? <AbilityIcon type={held.type}/> : <img src="/assets/abilities/mysteryBox.png" alt=""/>}
        {held?.locked && <span>{held.availableTurn}</span>}
      </button>
      {oppCount > 0 && <span className="oppChip" title={`Opponents hold ${oppCount} hidden box${oppCount === 1 ? '' : 'es'}`}>? ×{oppCount}</span>}
      {(aiming || placing) && <button type="button" className="cancelAbility" onClick={()=>{ setAiming(null); setPlacing(null); }} aria-label="Cancel Power Play" title="Cancel Power Play">×</button>}
    </div>
    <div className="turnCluster">
      {state.phase === 'lobby' && <button type="button" className="startMatchBtn" onClick={()=>socket.emit('game:start')}>Start match</button>}
      {me && state.phase === 'planning' && <button type="button" className={ready ? 'readyBtn selected' : 'readyBtn'} disabled={ready} title="Finish planning when everyone is ready" onClick={()=>{ audioManager.play('ready'); socket.emit('player:ready'); }}>
        <span>{ready ? 'Ready' : 'End turn'}</span><small>{readyCount}/{readyTotal}</small>
      </button>}
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
    } catch {
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
  const frame = React.useRef<{ state: GameState; you: string; drag: typeof drag; placing: PlacingGhost | null; targetingBabbles: boolean; rotatingPad: { id: string; angle: number } | null }>({ state, you, drag, placing, targetingBabbles: aiming?.mode === 'babble', rotatingPad });
  frame.current = { state, you, drag, placing, targetingBabbles: aiming?.mode === 'babble', rotatingPad };
  React.useEffect(() => {
    let raf = 0;
    let timer = 0;
    let stopped = false;
    const tick = () => {
      const f = frame.current;
      const started = performance.now();
      rendererRef.current?.render({ state: f.state, you: f.you, drag: f.drag, placing: f.placing, targetingBabbles: f.targetingBabbles, rotatingPad: f.rotatingPad });
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
    if (state.phase !== 'planning') setMode(null);
  }, [state.phase]);

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
    if (!me || state.phase !== 'planning') return;
    const p = point(e);
    if (!p) return;
    if (aiming) {
      // ability targeting: the very next click applies the ability immediately
      if (aiming.mode === 'point') {
        audioManager.play('abilityUse');
        socket.emit('player:power', { type: aiming.type, position: p });
        setAiming(null);
        return;
      }
      const target = state.babbles.find(b => Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 20)
        ?? rendererRef.current?.babbleFromClient(state, e.clientX, e.clientY);
      if (target) {
        audioManager.play('abilityUse');
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
      const babble = state.babbles.find(b => me.controlledBabbleIds.includes(b.id) && Math.hypot(b.pos.x - p.x, b.pos.y - p.y) <= b.radius + 16)
        ?? rendererRef.current?.babbleFromClient(state, e.clientX, e.clientY, me.controlledBabbleIds);
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
    if (state.phase !== 'planning') { setMode(null); return; }
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
    if (state.phase !== 'planning') { setMode(null); return; }
    if (mode?.kind === 'place' && placing) {
      audioManager.play('abilityUse');
      socket.emit('player:power', { type: placing.type, position: mode.anchor, angle: mode.angle });
      setPlacing(null);
    } else if (mode?.kind === 'rotatePad') {
      socket.emit('player:fieldRotate', { id: mode.id, angle: mode.angle });
    } else if (mode?.kind === 'launch') {
      const dx = mode.start.x - mode.current.x;
      const dy = mode.start.y - mode.current.y;
      const pull = Math.hypot(dx, dy);
      // a click with no pull is ignored so a launch is never wasted by accident
      if (pull >= 8) {
        audioManager.play('launch');
        audioManager.play('ballKick', { volume: 0.45 });
        socket.emit('player:launch', { babbleId: mode.babbleId, aimAngle: Math.atan2(dy, dx), impulse: Math.min(900, Math.max(1, pull * 6)) });
      }
    }
    // always drop the pointer mode: a stale mode must never block later launches
    setMode(null);
  };

  return <>
    <canvas className="field threeField" ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>setMode(null)} aria-label="3D Unicup field"/>
    {renderError && <div className="renderFallback"><b>3D preview unavailable</b><span>{renderError}</span></div>}
  </>;
}

function ClerkAccountControls() {
  return <div className="accountControls" aria-label="Player account">
    <Show when="signed-out">
      <SignInButton mode="modal"><button type="button" className="accountSignIn">Sign in</button></SignInButton>
      <SignUpButton mode="modal"><button type="button" className="accountSignUp">Create account</button></SignUpButton>
    </Show>
    <Show when="signed-in"><UserButton showName/></Show>
  </div>;
}

function ClerkConnectedApp() {
  const { isLoaded, userId, getToken } = useAuth();
  const { user } = useUser();
  const suggestedName = user?.username ?? user?.firstName ?? undefined;
  return <App auth={{ isLoaded, userId: userId ?? null, getToken }} accountControls={<ClerkAccountControls/>} suggestedName={suggestedName} playerAvatarUrl={user?.imageUrl}/>;
}

function AuthRoot() {
  const [publishableKey, setPublishableKey] = React.useState<string | null | undefined>();
  React.useEffect(() => {
    let active = true;
    fetch('/api/config').then(response => response.ok ? response.json() : Promise.reject()).then((config: { clerkPublishableKey?: string | null }) => {
      if (active) setPublishableKey(config.clerkPublishableKey ?? null);
    }).catch(() => { if (active) setPublishableKey(null); });
    return () => { active = false; };
  }, []);
  if (publishableKey === undefined) return <main className="authBoot" aria-busy="true"><img src={UNICUP_BRAND.art.logo} alt="Unicup"/><span>Connecting player identity</span></main>;
  if (publishableKey) return <ClerkProvider publishableKey={publishableKey}><ClerkConnectedApp/></ClerkProvider>;
  return <App auth={{ isLoaded: true, userId: null, getToken: async () => null }} accountControls={<div className="accountControls guestOnly">Guest mode</div>}/>;
}

createRoot(document.getElementById('root')!).render(<AuthRoot/>);
