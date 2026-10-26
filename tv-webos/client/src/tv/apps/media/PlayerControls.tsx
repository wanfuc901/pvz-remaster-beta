/**
 * Player chrome shared by the media player and the YouTube app: auto-hiding controls with a seekbar,
 * an on-screen display for short feedback, and the TV remote's media keys. Everything goes through
 * one `command` callback, the same entry point phone remotes use, so all inputs behave alike.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FastForward, Pause, Play, Rewind, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MediaCommand } from '@tvwebos/shared/constants';
import type { TvMediaState } from '@tvwebos/shared';
import { clamp, formatDuration } from '../../../common/format';
import { emitMediaChange, registerMedia } from '../../os/bus';
import { navKeyOf } from '../../os/keys';

export const SEEK_STEP_S = 10;
const FAST_STEP_S = 30;
const CONTROLS_HIDE_MS = 4000;
const OSD_MS = 1200;
const TIME_PUBLISH_STEP_S = 1;

export type MediaCommandFn = (cmd: MediaCommand, value?: number) => void;

export interface Playback {
  playing: boolean;
  time: number;
  duration: number;
  buffered: number;
  /** 0..1 */
  volume: number;
  muted: boolean;
}

export const IDLE_PLAYBACK: Playback = { playing: false, time: 0, duration: 0, buffered: 0, volume: 1, muted: false };

/** Controls that hide after a few seconds of playback, and a transient OSD message. */
export function usePlayerChrome(isPlaying: () => boolean) {
  const [controlsShown, setControlsShown] = useState(true);
  const [osd, setOsd] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);
  const osdTimer = useRef<number | null>(null);
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;

  useEffect(
    () => () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      if (osdTimer.current !== null) clearTimeout(osdTimer.current);
    },
    [],
  );

  const wake = () => {
    setControlsShown(true);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (playingRef.current()) setControlsShown(false);
    }, CONTROLS_HIDE_MS);
  };

  const flash = (text: string) => {
    setOsd(text);
    if (osdTimer.current !== null) clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(null), OSD_MS);
  };

  return { controlsShown, showControls: () => setControlsShown(true), wake, osd, flash };
}

/**
 * Expose a player to phone remotes. Registered once per window; state and command are read through a ref,
 * so the remote always reaches the latest closure. `publish` re-sends state, at most once per second for
 * playhead moves (`force` for play/pause/volume/track changes) to keep the socket quiet during playback.
 */
export function useMediaController(windowId: string, state: TvMediaState | null, command: MediaCommandFn) {
  const latest = useRef({ state, command });
  latest.current = { state, command };
  const lastTime = useRef(-1);

  useEffect(
    () =>
      registerMedia({
        windowId,
        getState: () => latest.current.state,
        command: (cmd, value) => latest.current.command(cmd, value),
      }),
    [windowId],
  );

  return {
    publish(time: number, force: boolean) {
      if (!force && Math.abs(time - lastTime.current) < TIME_PUBLISH_STEP_S) return;
      lastTime.current = time;
      emitMediaChange();
    },
  };
}

const MEDIA_KEYS: Partial<Record<string, [MediaCommand, number?]>> = {
  MediaPlayPause: ['toggle'],
  MediaStop: ['stop'],
  MediaRewind: ['seek-by', -FAST_STEP_S],
  MediaFastForward: ['seek-by', FAST_STEP_S],
};

/** Map the TV remote's media keys onto commands. Returns true when the key was consumed. */
export function handleMediaKey(e: KeyboardEvent, command: MediaCommandFn): boolean {
  const key = navKeyOf(e.nativeEvent);
  const entry = key ? MEDIA_KEYS[key] : undefined;
  if (!entry) return false;
  e.preventDefault();
  command(entry[0], entry[1]);
  return true;
}

function Seekbar({ playback, onSeek }: { playback: Playback; onSeek: (t: number) => void }) {
  const { time, duration, buffered } = playback;
  const pct = (v: number) => `${duration > 0 ? clamp((v / duration) * 100, 0, 100) : 0}%`;
  return (
    <div
      className="seekbar"
      role="slider"
      aria-label="Tua"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      tabIndex={0}
      data-focusable
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onSeek(time + (e.key === 'ArrowLeft' ? -SEEK_STEP_S : SEEK_STEP_S));
      }}
      onMouseDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (duration > 0 && r.width > 0) onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
    >
      <div className="track">
        <div className="buffered" style={{ width: pct(buffered) }} />
        <div className="fill" style={{ width: pct(time) }} />
        <div className="knob" style={{ left: pct(time) }} />
      </div>
    </div>
  );
}

interface PlayerControlsProps {
  title: string;
  playback: Playback;
  /** A track is loaded, so play/seek/mute make sense. */
  active: boolean;
  /** Previous / next are available. */
  canStep: boolean;
  hidden: boolean;
  /** Removed from D-pad navigation while an overlay (playlist) owns focus. */
  navHidden?: boolean;
  command: MediaCommandFn;
  /** App-specific buttons shown after mute. */
  extra?: ReactNode;
}

export function PlayerControls({ title, playback, active, canStep, hidden, navHidden, command, extra }: PlayerControlsProps) {
  return (
    <div className={`player-controls ${hidden ? 'hidden' : ''}`} data-nav-scope {...(navHidden ? { 'data-nav-hidden': '' } : {})}>
      <div className="player-title">{title}</div>
      <Seekbar playback={playback} onSeek={(t) => command('seek', t)} />
      <div className="player-row">
        <span className="time">
          {formatDuration(playback.time)} / {formatDuration(playback.duration)}
        </span>
        <div className="player-buttons">
          <button className="p-btn" onClick={() => command('prev')} title="Trước" disabled={!canStep}>
            <SkipBack />
          </button>
          <button className="p-btn" onClick={() => command('seek-by', -SEEK_STEP_S)} title={`Lùi ${SEEK_STEP_S} giây`} disabled={!active}>
            <Rewind />
          </button>
          <button className="p-btn main" onClick={() => command('toggle')} title={playback.playing ? 'Tạm dừng' : 'Phát'} disabled={!active} data-nav-default>
            {playback.playing ? <Pause /> : <Play />}
          </button>
          <button className="p-btn" onClick={() => command('seek-by', SEEK_STEP_S)} title={`Tiến ${SEEK_STEP_S} giây`} disabled={!active}>
            <FastForward />
          </button>
          <button className="p-btn" onClick={() => command('next')} title="Tiếp" disabled={!canStep}>
            <SkipForward />
          </button>
        </div>
        <div className="player-buttons">
          <button className="p-btn" onClick={() => command('mute')} title={playback.muted ? 'Bật tiếng' : 'Tắt tiếng'} disabled={!active}>
            {playback.muted ? <VolumeX /> : <Volume2 />}
          </button>
          {extra}
        </div>
      </div>
    </div>
  );
}
