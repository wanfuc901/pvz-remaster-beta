/**
 * Video and music player. Opens a server file (its folder becomes the playlist), a TV-local file
 * (local media becomes the playlist) or, with no arguments, the whole library. Registers a media
 * controller so phone remotes can drive playback and mirror its state.
 */
import { useEffect, useRef, useState } from 'react';
import { ListVideo, Music } from 'lucide-react';
import type { MediaCommand } from '@tvwebos/shared/constants';
import { clamp } from '../../../common/format';
import { indexServer, kindOf, listLocal, localObjectUrl, serverFileWithSiblings, type ServerEntry } from '../../os/files';
import { focusEl } from '../../os/spatialNav';
import { os, useOs } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { useAsync, useBack } from '../common';
import { handleMediaKey, IDLE_PLAYBACK, PlayerControls, SEEK_STEP_S, useMediaController, usePlayerChrome, useWindowFullscreen, type Playback } from './PlayerControls';

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

const RESTART_THRESHOLD_S = 3;

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
  const [playback, setPlayback] = useState<Playback>(IDLE_PLAYBACK);
  const [message, setMessage] = useState<string | null>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const chrome = usePlayerChrome(() => !!mediaRef.current && !mediaRef.current.paused);
  const full = useWindowFullscreen(win.id);

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

  const command = (cmd: MediaCommand, value?: number) => {
    const el = mediaRef.current;
    if (!el) return;
    chrome.wake();
    switch (cmd) {
      case 'toggle':
        if (!track) return;
        return el.paused || el.ended ? safePlay(el, setMessage) : el.pause();
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
        chrome.flash(`${by > 0 ? '+' : ''}${by}s`);
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
        return chrome.flash(`Âm lượng ${Math.round(el.volume * 100)}%`);
      case 'mute':
        el.muted = !el.muted;
        return chrome.flash(el.muted ? 'Tắt tiếng' : 'Bật tiếng');
      case 'fullscreen':
        return full.toggle();
    }
  };

  const remote = useMediaController(
    win.id,
    track
      ? { title: track.name.slice(0, 256), kind: track.kind, playing: playback.playing, time: playback.time, duration: playback.duration, volume: playback.volume, muted: playback.muted, fullscreen: full.fullscreen }
      : null,
    command,
  );

  // Load and start the chosen track.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (!track) {
      el.removeAttribute('src');
      el.load();
      setPlayback(IDLE_PLAYBACK);
      remote.publish(0, true);
      return;
    }
    setMessage(null);
    el.src = track.url;
    safePlay(el, setMessage);
    chrome.wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.key]);

  const sync = (force: boolean) => {
    const el = mediaRef.current;
    if (!el) return;
    const next = readPlayback(el);
    setPlayback(next);
    remote.publish(next.time, force);
  };

  useBack(win.id, () => {
    if (!playlistOpen || !track) return false;
    setPlaylistOpen(false);
    return true;
  });

  return (
    <div className="app">
      <div
        className="player"
        onKeyDown={(e) => {
          chrome.wake();
          handleMediaKey(e, command);
        }}
        onMouseMove={chrome.wake}
      >
        <video
          ref={mediaRef}
          playsInline
          preload="metadata"
          onPlay={() => sync(true)}
          onPause={() => {
            sync(true);
            chrome.showControls();
          }}
          onLoadedMetadata={() => sync(true)}
          onTimeUpdate={() => sync(false)}
          onProgress={() => sync(false)}
          onVolumeChange={() => sync(true)}
          onEnded={() => (tracks.length > 1 ? step(1) : sync(true))}
          onError={() => track && setMessage('Không phát được tệp này: TV không hỗ trợ định dạng hoặc codec, hoặc mất kết nối tới server.')}
          onClick={() => command('toggle')}
        />
        {track?.kind === 'audio' && (
          <div className="player-audio-art" onClick={() => command('toggle')}>
            <Music />
            <h2>{track.name}</h2>
          </div>
        )}
        {list.loading && <div className="player-message">Đang tải danh sách…</div>}
        {list.error && <div className="player-message">{list.error}</div>}
        {message && <div className="player-message">{message}</div>}
        {!list.loading && !list.error && !track && !playlistOpen && <div className="player-message">Chọn một video hoặc bài nhạc trong danh sách phát.</div>}
        {chrome.osd && <div className="player-osd">{chrome.osd}</div>}

        <PlayerControls
          title={track?.name ?? 'Trình phát'}
          playback={playback}
          active={!!track}
          canStep={tracks.length > 0}
          hidden={!chrome.controlsShown && !playlistOpen}
          navHidden={playlistOpen}
          fullscreen={full.fullscreen}
          command={command}
          extra={
            <button className="p-btn" onClick={() => setPlaylistOpen(true)} title="Danh sách phát" disabled={!tracks.length}>
              <ListVideo />
            </button>
          }
        />

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
