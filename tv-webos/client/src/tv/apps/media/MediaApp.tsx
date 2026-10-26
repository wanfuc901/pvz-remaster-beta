/**
 * Video and music player. Opens a server file (its folder becomes the playlist), a TV-local file
 * (local media becomes the playlist) or, with no arguments, the whole library. Registers a media
 * controller so phone remotes can drive playback and mirror its state.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FastForward, ListVideo, Music, Pause, Play, Rewind, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import type { MediaCommand } from '@tvwebos/shared/constants';
import type { TvMediaState } from '@tvwebos/shared';
import { clamp, formatDuration } from '../../../common/format';
import { emitMediaChange, registerMedia } from '../../os/bus';
import { indexServer, kindOf, listLocal, localObjectUrl, serverFileWithSiblings, type ServerEntry } from '../../os/files';
import { navKeyOf } from '../../os/keys';
import { focusEl } from '../../os/spatialNav';
import { os, useOs } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { useAsync, useBack } from '../common';

type MediaKind = 'video' | 'audio';

interface Track {
  key: string;
  name: string;
  url: string;
  kind: MediaKind;
}

interface Playlist {
  tracks: Track[];
  /** -1 when opened without a file: the playlist is shown and nothing plays yet. */
  start: number;
}

const SEEK_STEP_S = 10;
const FAST_STEP_S = 30;
const RESTART_THRESHOLD_S = 3;
const CONTROLS_HIDE_MS = 4000;
const OSD_MS = 1200;
/** Remotes mirror the playhead; one update per second keeps the socket quiet during playback. */
const TIME_PUBLISH_STEP_S = 1;

const byName = (a: Track, b: Track) => a.name.localeCompare(b.name, undefined, { numeric: true });

function playableKind(name: string): MediaKind | null {
  const kind = kindOf(name);
  return kind === 'video' || kind === 'audio' ? kind : null;
}

function serverTracks(entries: ServerEntry[]): Track[] {
  const tracks: Track[] = [];
  for (const e of entries) {
    const kind = playableKind(e.name);
    if (e.type === 'file' && e.url && kind) tracks.push({ key: e.path, name: e.name, url: e.url, kind });
  }
  return tracks;
}

async function serverPlaylist(path: string): Promise<Playlist> {
  const { file, siblings } = await serverFileWithSiblings(path);
  if (!file?.url) throw new Error('Không tìm thấy tệp trên server');
  const tracks = serverTracks(siblings).sort(byName);
  return { tracks, start: Math.max(0, tracks.findIndex((t) => t.key === file.path)) };
}

async function localTracks(keep: (release: () => void) => void): Promise<Track[]> {
  const tracks: Track[] = [];
  for (const f of await listLocal()) {
    const kind = playableKind(f.name);
    if (!kind) continue;
    const { url, release } = localObjectUrl(f);
    keep(release);
    tracks.push({ key: `local:${f.id}`, name: f.name, url, kind });
  }
  return tracks;
}

async function localPlaylist(localId: string, keep: (release: () => void) => void): Promise<Playlist> {
  const tracks = await localTracks(keep);
  const start = tracks.findIndex((t) => t.key === `local:${localId}`);
  if (start < 0) throw new Error('Tệp không còn trong bộ nhớ TV');
  return { tracks, start };
}

async function libraryPlaylist(online: boolean, keep: (release: () => void) => void): Promise<Playlist> {
  const tracks: Track[] = [];
  if (online) {
    const [videos, audio] = await Promise.all([indexServer('video'), indexServer('audio')]);
    tracks.push(...serverTracks([...videos, ...audio]).sort(byName));
  }
  try {
    tracks.push(...(await localTracks(keep)));
  } catch {
    // IndexedDB unavailable: server tracks only
  }
  if (!online && !tracks.length) throw new Error('Chưa kết nối tới server.');
  return { tracks, start: -1 };
}

/** Some TV engines return undefined from play(); newer ones reject when playback is refused. */
function safePlay(el: HTMLMediaElement, onError: (message: string) => void): void {
  const pending = el.play() as Promise<void> | undefined;
  pending?.catch((err: Error) => {
    if (err.name !== 'AbortError') onError(`Không phát được: ${err.message}`);
  });
}

function Seekbar({ time, duration, buffered, onSeek }: { time: number; duration: number; buffered: number; onSeek: (t: number) => void }) {
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

function PlaylistPanel({ tracks, current, onPick }: { tracks: Track[]; current: number; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = ref.current?.querySelectorAll<HTMLElement>('.pl-item');
    const target = items?.[Math.max(0, current)] ?? null;
    if (target) {
      focusEl(target);
      target.scrollIntoView({ block: 'center' });
    }
    // Focus once when the panel opens; later track changes must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="playlist" ref={ref} data-nav-scope>
      <h3>Danh sách phát ({tracks.length})</h3>
      {!tracks.length && <p className="muted">Không có video hoặc nhạc nào.</p>}
      {tracks.map((t, i) => (
        <button key={t.key} className={`pl-item ${i === current ? 'current' : ''}`} onClick={() => onPick(i)} title={t.name}>
          {t.kind === 'video' ? <ListVideo /> : <Music />}
          <span>{t.name}</span>
        </button>
      ))}
    </div>
  );
}

interface Playback {
  playing: boolean;
  time: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
}

const IDLE: Playback = { playing: false, time: 0, duration: 0, buffered: 0, volume: 1, muted: false };

function readPlayback(el: HTMLMediaElement): Playback {
  const end = el.buffered.length ? el.buffered.end(el.buffered.length - 1) : 0;
  return {
    playing: !el.paused && !el.ended,
    time: el.currentTime || 0,
    duration: Number.isFinite(el.duration) ? el.duration : 0,
    buffered: end,
    volume: el.volume,
    muted: el.muted,
  };
}

export default function MediaApp({ win }: WindowProps) {
  const online = useOs((s) => s.link.status === 'online' && !!s.link.apiToken);
  const mediaRef = useRef<HTMLVideoElement>(null);
  const releases = useRef<Array<() => void>>([]);
  const [index, setIndex] = useState(-1);
  const [playback, setPlayback] = useState<Playback>(IDLE);
  const [message, setMessage] = useState<string | null>(null);
  const [osd, setOsd] = useState<string | null>(null);
  const [controlsShown, setControlsShown] = useState(true);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const osdTimer = useRef<number | null>(null);
  const lastPublishedTime = useRef(-1);

  const keep = (release: () => void) => releases.current.push(release);
  const path = typeof win.args.path === 'string' ? win.args.path : null;
  const localId = typeof win.args.localId === 'string' ? win.args.localId : null;

  const list = useAsync<Playlist>(async () => {
    releases.current.forEach((r) => r());
    releases.current = [];
    if (path) return serverPlaylist(path);
    if (localId) return localPlaylist(localId, keep);
    return libraryPlaylist(online, keep);
    // A new file from Files / the phone arrives as new args with a fresh _nonce.
  }, [path, localId, online, win.args._nonce]);

  useEffect(() => () => releases.current.forEach((r) => r()), []);

  const tracks = list.data?.tracks ?? [];
  const track = index >= 0 ? (tracks[index] ?? null) : null;

  useEffect(() => {
    if (!list.data) return;
    setIndex(list.data.start);
    setPlaylistOpen(list.data.start < 0);
  }, [list.data]);

  useEffect(() => {
    os.get().setWindowTitle(win.id, track ? track.name : 'Trình phát');
  }, [track, win.id]);

  const flashOsd = (text: string) => {
    setOsd(text);
    if (osdTimer.current !== null) clearTimeout(osdTimer.current);
    osdTimer.current = window.setTimeout(() => setOsd(null), OSD_MS);
  };

  const wakeControls = () => {
    setControlsShown(true);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (mediaRef.current && !mediaRef.current.paused) setControlsShown(false);
    }, CONTROLS_HIDE_MS);
  };

  useEffect(
    () => () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
      if (osdTimer.current !== null) clearTimeout(osdTimer.current);
    },
    [],
  );

  const seekTo = (t: number) => {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = clamp(t, 0, Math.max(0, el.duration - 0.25));
  };

  const step = (delta: number) => {
    if (!tracks.length) return;
    setMessage(null);
    setIndex((i) => (Math.max(i, 0) + delta + tracks.length) % tracks.length);
  };

  const toggle = () => {
    const el = mediaRef.current;
    if (!el || !track) return;
    if (el.paused || el.ended) safePlay(el, setMessage);
    else el.pause();
  };

  const command = (cmd: MediaCommand, value?: number) => {
    const el = mediaRef.current;
    if (!el) return;
    wakeControls();
    switch (cmd) {
      case 'toggle':
        return toggle();
      case 'play':
        return safePlay(el, setMessage);
      case 'pause':
        return el.pause();
      case 'stop':
        el.pause();
        return seekTo(0);
      case 'seek':
        return value === undefined ? undefined : seekTo(value);
      case 'seek-by': {
        const by = value ?? SEEK_STEP_S;
        flashOsd(`${by > 0 ? '+' : ''}${by}s`);
        return seekTo(el.currentTime + by);
      }
      case 'next':
        return step(1);
      case 'prev':
        return el.currentTime > RESTART_THRESHOLD_S ? seekTo(0) : step(-1);
      case 'volume':
        if (value === undefined) return;
        el.volume = clamp(value, 0, 1);
        el.muted = false;
        return flashOsd(`Âm lượng ${Math.round(el.volume * 100)}%`);
      case 'mute':
        el.muted = !el.muted;
        return flashOsd(el.muted ? 'Tắt tiếng' : 'Bật tiếng');
    }
  };

  // Remotes and media keys always reach the latest closure without re-registering.
  const commandRef = useRef(command);
  commandRef.current = command;
  const stateRef = useRef<TvMediaState | null>(null);
  stateRef.current = track
    ? { title: track.name.slice(0, 256), kind: track.kind, playing: playback.playing, time: playback.time, duration: playback.duration, volume: playback.volume, muted: playback.muted }
    : null;

  useEffect(
    () =>
      registerMedia({
        windowId: win.id,
        getState: () => stateRef.current,
        command: (cmd, value) => commandRef.current(cmd, value),
      }),
    [win.id],
  );

  // Load and start the chosen track.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    lastPublishedTime.current = -1;
    if (!track) {
      el.removeAttribute('src');
      el.load();
      setPlayback(IDLE);
      emitMediaChange();
      return;
    }
    setMessage(null);
    el.src = track.url;
    safePlay(el, setMessage);
    wakeControls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.key]);

  const sync = (publish: boolean) => {
    const el = mediaRef.current;
    if (!el) return;
    const next = readPlayback(el);
    setPlayback(next);
    if (publish || Math.abs(next.time - lastPublishedTime.current) >= TIME_PUBLISH_STEP_S) {
      lastPublishedTime.current = next.time;
      emitMediaChange();
    }
  };

  useBack(win.id, () => {
    if (!playlistOpen || !track) return false;
    setPlaylistOpen(false);
    return true;
  });

  const onKeyDown = (e: KeyboardEvent) => {
    wakeControls();
    const key = navKeyOf(e.nativeEvent);
    const actions: Partial<Record<string, () => void>> = {
      MediaPlayPause: toggle,
      MediaStop: () => command('stop'),
      MediaRewind: () => command('seek-by', -FAST_STEP_S),
      MediaFastForward: () => command('seek-by', FAST_STEP_S),
    };
    const run = key ? actions[key] : undefined;
    if (!run) return;
    e.preventDefault();
    run();
  };

  return (
    <div className="app">
      <div className="player" onKeyDown={onKeyDown} onMouseMove={wakeControls}>
        <video
          ref={mediaRef}
          playsInline
          preload="metadata"
          onPlay={() => sync(true)}
          onPause={() => {
            sync(true);
            setControlsShown(true);
          }}
          onLoadedMetadata={() => sync(true)}
          onTimeUpdate={() => sync(false)}
          onProgress={() => sync(false)}
          onVolumeChange={() => sync(true)}
          onEnded={() => (tracks.length > 1 ? step(1) : sync(true))}
          onError={() => track && setMessage('Không phát được tệp này: TV không hỗ trợ định dạng hoặc codec, hoặc mất kết nối tới server.')}
          onClick={toggle}
        />
        {track?.kind === 'audio' && (
          <div className="player-audio-art" onClick={toggle}>
            <Music />
            <h2>{track.name}</h2>
          </div>
        )}
        {list.loading && <div className="player-message">Đang tải danh sách…</div>}
        {list.error && <div className="player-message">{list.error}</div>}
        {message && <div className="player-message">{message}</div>}
        {!list.loading && !list.error && !track && !playlistOpen && <div className="player-message">Chọn một video hoặc bài nhạc trong danh sách phát.</div>}
        {osd && <div className="player-osd">{osd}</div>}

        <div className={`player-controls ${controlsShown || playlistOpen ? '' : 'hidden'}`} data-nav-scope {...(playlistOpen ? { 'data-nav-hidden': '' } : {})}>
          <div className="player-title">{track?.name ?? 'Trình phát'}</div>
          <Seekbar time={playback.time} duration={playback.duration} buffered={playback.buffered} onSeek={seekTo} />
          <div className="player-row">
            <span className="time">
              {formatDuration(playback.time)} / {formatDuration(playback.duration)}
            </span>
            <div className="player-buttons">
              <button className="p-btn" onClick={() => command('prev')} title="Bài trước" disabled={!tracks.length}>
                <SkipBack />
              </button>
              <button className="p-btn" onClick={() => command('seek-by', -SEEK_STEP_S)} title={`Lùi ${SEEK_STEP_S} giây`} disabled={!track}>
                <Rewind />
              </button>
              <button className="p-btn main" onClick={toggle} title={playback.playing ? 'Tạm dừng' : 'Phát'} disabled={!track} data-nav-default>
                {playback.playing ? <Pause /> : <Play />}
              </button>
              <button className="p-btn" onClick={() => command('seek-by', SEEK_STEP_S)} title={`Tiến ${SEEK_STEP_S} giây`} disabled={!track}>
                <FastForward />
              </button>
              <button className="p-btn" onClick={() => command('next')} title="Bài tiếp" disabled={!tracks.length}>
                <SkipForward />
              </button>
            </div>
            <div className="player-buttons">
              <button className="p-btn" onClick={() => command('mute')} title={playback.muted ? 'Bật tiếng' : 'Tắt tiếng'} disabled={!track}>
                {playback.muted ? <VolumeX /> : <Volume2 />}
              </button>
              <button className="p-btn" onClick={() => setPlaylistOpen(true)} title="Danh sách phát" disabled={!tracks.length}>
                <ListVideo />
              </button>
            </div>
          </div>
        </div>

        {playlistOpen && list.data && (
          <PlaylistPanel
            tracks={tracks}
            current={index}
            onPick={(i) => {
              setIndex(i);
              setPlaylistOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}
