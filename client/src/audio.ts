export type AudioSettings = {
  musicVolume: number;
  sfxVolume: number;
};

export type SfxName =
  | 'uiClick'
  | 'launch'
  | 'ballKick'
  | 'bumper'
  | 'megaBumper'
  | 'boxPickup'
  | 'abilityUse'
  | 'ready'
  | 'goal'
  | 'gameOver';

const AUDIO_KEY = 'babble:audio';
const DEFAULT_SETTINGS: AudioSettings = { musicVolume: 0.42, sfxVolume: 0.72 };
const MUSIC_SRC = '/assets/audio/music-clunky-anime-loop.mp3';
const SFX_SRC: Record<SfxName, string> = {
  uiClick: '/assets/audio/ui-click.mp3',
  launch: '/assets/audio/babble-launch.mp3',
  ballKick: '/assets/audio/ball-kick.mp3',
  bumper: '/assets/audio/bumper-hit.mp3',
  megaBumper: '/assets/audio/mega-bumper-hit.mp3',
  boxPickup: '/assets/audio/box-pickup.mp3',
  abilityUse: '/assets/audio/ability-use.mp3',
  ready: '/assets/audio/ready.mp3',
  goal: '/assets/audio/goal-scored.mp3',
  gameOver: '/assets/audio/game-over.mp3'
};

const clampVolume = (v: unknown, fallback: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      musicVolume: clampVolume(parsed.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: clampVolume(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume)
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveAudioSettings(settings: AudioSettings) {
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(settings)); } catch {}
}

class BabbleAudioManager {
  private settings = DEFAULT_SETTINGS;
  private music?: HTMLAudioElement;
  private unlocked = false;
  private lastPlayed = new Map<SfxName, number>();

  setSettings(settings: AudioSettings) {
    this.settings = settings;
    if (this.music) this.music.volume = this.settings.musicVolume;
    if (this.unlocked && this.settings.musicVolume > 0) void this.startMusic();
  }

  async unlock() {
    this.unlocked = true;
    await this.startMusic();
  }

  async startMusic() {
    if (typeof Audio === 'undefined' || this.settings.musicVolume <= 0) return;
    const music = this.music ?? new Audio(MUSIC_SRC);
    if (!this.music) {
      music.loop = true;
      music.preload = 'auto';
      this.music = music;
    }
    music.volume = this.settings.musicVolume;
    try { await music.play(); } catch {}
  }

  stopMusic() {
    if (!this.music) return;
    this.music.pause();
    this.music.currentTime = 0;
  }

  play(name: SfxName, opts: { force?: boolean; volume?: number } = {}) {
    if (typeof Audio === 'undefined' || this.settings.sfxVolume <= 0) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (!opts.force && now - last < 90) return;
    this.lastPlayed.set(name, now);
    const sfx = new Audio(SFX_SRC[name]);
    sfx.preload = 'auto';
    sfx.volume = Math.max(0, Math.min(1, this.settings.sfxVolume * (opts.volume ?? 1)));
    void sfx.play().catch(() => {});
  }
}

export const audioManager = new BabbleAudioManager();
