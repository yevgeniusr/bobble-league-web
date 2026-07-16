import React from 'react';
import { BOX_TYPE_IDS, BOX_TYPES, BoxType, GameState, MAP_IDS, MAPS, RobotShape, TEAM_IDS, TEAMS } from '../../shared/types';
import { COUNTRIES } from '../../shared/countries';
import { authHeaders, ClerkTokenGetter } from './auth';

export const ROUND_TIME_MILESTONES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;
const INVITE_CODE_PATTERN = /^[A-Z0-9]{3,8}$/;

export function parseInviteCode(url: string): string | null {
  try {
    const code = new URL(url).searchParams.get('invite')?.trim().toUpperCase() ?? '';
    return INVITE_CODE_PATTERN.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function buildInviteUrl(origin: string, roomCode: string): string {
  const url = new URL(origin);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('invite', roomCode.trim().toUpperCase());
  return url.toString();
}

export function visibleRoundTimeSeconds(phase: GameState['phase'], localValue: number, serverValue: number) {
  return phase === 'lobby' ? localValue : serverValue;
}

export function RoundTimeControl({ value, onChange, disabled = false }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  const progress = (value - 2) / 58 * 100;
  return <div className="roundTimeControl" style={{ '--round-progress': `${progress}%` } as React.CSSProperties}>
    <input
      type="range"
      min="2"
      max="60"
      step="1"
      list="round-time-milestones"
      aria-label="Round time"
      value={value}
      disabled={disabled}
      onChange={event=>onChange(Number(event.target.value))}
    />
    <datalist id="round-time-milestones">{ROUND_TIME_MILESTONES.map(seconds=><option key={seconds} value={seconds}/>)}</datalist>
    <span className="roundTimeScale" aria-hidden="true">
      {ROUND_TIME_MILESTONES.map(seconds=><i
        key={seconds}
        className="roundTimeMilestone"
        style={{ '--milestone': `${(seconds - 2) / 58 * 100}%` } as React.CSSProperties}
      ><b/><small>{seconds}</small></i>)}
    </span>
  </div>;
}

function PowerupCard({ type }: { type: BoxType }) {
  const [open, setOpen] = React.useState(false);
  const powerup = BOX_TYPES[type];
  const duration = powerup.durationTurns === 0 ? 'Immediate' : 'This turn';
  return <button
    type="button"
    className={`powerupCard ${open ? 'isOpen' : ''}`}
    aria-expanded={open}
    aria-label={`${open ? 'Close' : 'Open'} ${powerup.label} dossier`}
    onClick={()=>setOpen(value=>!value)}
    style={{ '--power-color': powerup.color } as React.CSSProperties}
  >
    <span className="powerupCardInner">
      <span className="powerupFace powerupFront">
        <span className="powerupIndex">P-{String(BOX_TYPE_IDS.indexOf(type) + 1).padStart(2, '0')}</span>
        <PowerupArt type={type}/>
        <strong>{powerup.label}</strong>
        <span className="powerupMeta"><b>{powerup.category}</b><b>{duration}</b></span>
      </span>
      <span className="powerupFace powerupBack" aria-hidden={!open}>
        <span className="powerupIndex">Unicap field note</span>
        <strong>{powerup.label}</strong>
        <p>{powerup.description}</p>
        <span className="powerupRule">{powerup.category === 'instant' ? 'No placement required' : powerup.category === 'field' ? 'Place on the arena' : 'Choose a robot'}</span>
      </span>
    </span>
  </button>;
}

function PowerupArt({ type }: { type: BoxType }) {
  const [failed, setFailed] = React.useState(false);
  if (type === 'blindness') return <span className="archiveBlindnessGlyph" aria-hidden="true"><i/></span>;
  if (type === 'yellowCard' || type === 'redCard') {
    return <span className={`archivePenaltyGlyph ${type}`} aria-hidden="true"><i>!</i></span>;
  }
  if (type === 'readPlay') return <span className="archiveReadPlayGlyph" aria-hidden="true"><i/></span>;
  if (failed) return <span className="archiveFallbackGlyph" aria-hidden="true">U</span>;
  return <img
    src={`/assets/abilities/${type}.png`}
    alt=""
    loading="eager"
    decoding="async"
    onError={()=>setFailed(true)}
  />;
}

function RobotSchematic({ shape }: { shape: RobotShape }) {
  return <div className={`robotSchematic robotSchematic-${shape}`} aria-hidden="true">
    <i className="schematicAxis schematicAxisX"/><i className="schematicAxis schematicAxisY"/>
    <span className="schematicBody"><i className="schematicEye"/></span>
    <span className="schematicBase"><i/><i/><i/></span>
    <b>FRONT</b><em>CONTACT BODY</em>
  </div>;
}

export function TournamentArchive() {
  return <div className="tournamentArchive">
    <section className="archiveBand powerupArchive" id="powerups" aria-labelledby="powerupArchiveTitle">
      <header className="archiveHeader">
        <p className="sectionLabel">Unicap equipment archive / 15 legal anomalies</p>
        <h2 id="powerupArchiveTitle">Power plays, decoded.</h2>
        <p>Mystery boxes are earned on the field. Every effect is temporary, physical, and visible to the players it affects.</p>
      </header>
      <div className="powerupGrid">{BOX_TYPE_IDS.map(type=><PowerupCard key={type} type={type}/>)}</div>
    </section>

    <section className="archiveBand teamArchive" id="teams" aria-labelledby="teamArchiveTitle">
      <header className="archiveHeader">
        <p className="sectionLabel">Robot registration office / four bodies</p>
        <h2 id="teamArchiveTitle">Meet the machines.</h2>
        <p>Each team brings a different chassis into contact with the ball. Shape, mass, and rebound are part of the choice.</p>
      </header>
      <div className="teamDossierGrid">{TEAM_IDS.map((id, index)=>{
        const team = TEAMS[id];
        return <article className="teamDossier" key={id} style={{ '--team-primary': team.primary, '--team-secondary': team.secondary } as React.CSSProperties}>
          <div className="teamDossierTop"><span>BODY 0{index + 1}</span><b>{team.robot.shape.toUpperCase()}</b></div>
          <div className="teamVisual">
            <img src={team.crest} alt={`${team.label} robot`} loading="lazy" decoding="async"/>
            <RobotSchematic shape={team.robot.shape}/>
          </div>
          <div className="teamDossierCopy">
            <p>{team.shortLabel} / Unicup registered team</p>
            <h3>{team.label}</h3>
            <strong>{team.robot.trait}</strong>
            <p>{team.lore}</p>
          </div>
          <dl className="robotStats">
            <div><dt>Mass</dt><dd>{Math.round(team.robot.density * 100)}%</dd></div>
            <div><dt>Rebound</dt><dd>{Math.round(team.robot.restitution * 100)}%</dd></div>
            <div><dt>Body</dt><dd>{team.robot.width.toFixed(2)} x {team.robot.depth.toFixed(2)}</dd></div>
          </dl>
        </article>;
      })}</div>
    </section>

    <section className="archiveBand mapArchive" id="maps" aria-labelledby="mapArchiveTitle">
      <header className="archiveHeader">
        <p className="sectionLabel">PlanetBall broadcast atlas / original-calibrated physics</p>
        <h2 id="mapArchiveTitle">Four worlds. Four kinds of gravity.</h2>
        <p>Every arena begins with the Original physics model, then changes gravity, density, drag, and rebound to fit its world.</p>
      </header>
      <div className="mapDossierGrid">{MAP_IDS.map((id, index)=>{
        const map = MAPS[id];
        return <article className="mapDossier" key={id}>
          <div className="mapImage">
            <img src={map.art.fieldTexture} alt={`${map.label} field schematic`} loading="lazy" decoding="async"/>
            <span>ARENA 0{index + 1}</span><b>{map.layout.bumpers.length} BUMPERS</b>
          </div>
          <div className="mapDossierCopy">
            <p>{map.shortLabel} / field transmission</p>
            <h3>{map.label}</h3>
            <strong>{map.physicsSummary}</strong>
            <p>{map.lore}</p>
          </div>
          <dl className="mapStats">
            <div><dt>Gravity</dt><dd>{Math.round(map.physics.gravity * 100)}%</dd></div>
            <div><dt>Launch</dt><dd>{Math.round(map.physics.babbleImpulseScale * 100)}%</dd></div>
            <div><dt>Ball rebound</dt><dd>{Math.round(map.physics.ballRestitution * 100)}%</dd></div>
            <div><dt>Boost</dt><dd>{Math.round(map.physics.boostPadAccel * 100)}%</dd></div>
          </dl>
        </article>;
      })}</div>
    </section>
  </div>;
}

export function CountrySelector({ country, getToken, onSaved }: { country?: string; getToken: ClerkTokenGetter; onSaved: () => void }) {
  const [value, setValue] = React.useState(country ?? '');
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  React.useEffect(()=>setValue(country ?? ''), [country]);

  const save = async (next: string) => {
    const previous = value;
    setValue(next);
    setStatus('saving');
    try {
      const response = await fetch('/api/account/country', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...await authHeaders(getToken) },
        body: JSON.stringify({ country: next || null })
      });
      if (!response.ok) throw new Error('Country update failed');
      setStatus('saved');
      onSaved();
      window.setTimeout(()=>setStatus('idle'), 1800);
    } catch {
      setValue(previous);
      setStatus('error');
    }
  };

  return <label className="countrySelector">Representing
    <span>
      <select value={value} onChange={event=>void save(event.target.value)} disabled={status === 'saving'} aria-label="Account country">
        <option value="">Choose country</option>
        {COUNTRIES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
      </select>
      <small aria-live="polite">{status === 'saving' ? 'Saving' : status === 'saved' ? 'Saved' : status === 'error' ? 'Could not save' : 'Country XP'}</small>
    </span>
  </label>;
}
