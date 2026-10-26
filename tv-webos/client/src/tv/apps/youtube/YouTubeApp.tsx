/**
 * YouTube on the TV desktop. Plays a video or playlist sent from the phone (share sheet or pasted link)
 * in YouTube's embedded player, driven by the same controls, media keys and phone remote as the media
 * player. When the TV runs as the packaged webOS app, the TV's own YouTube app is one button away and
 * takes over automatically for videos whose owner disabled embedding.
 *
 * The embed is controlled over postMessage (the protocol YouTube's iframe_api uses under the hood)
 * instead of loading iframe_api into this page: third-party script here would run with the desktop's
 * origin and could read its pairing credentials.
 */
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Youtube } from 'lucide-react';
import type { MediaCommand } from '@tvwebos/shared/constants';
import { clamp } from '../../../common/format';
import { platformCaps } from '../../TvApp';
import { launchTvApp, YOUTUBE_TV_APP_ID } from '../../platform/webos';
import { os } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { handleMediaKey, IDLE_PLAYBACK, PlayerControls, SEEK_STEP_S, useMediaController, usePlayerChrome, type Playback } from '../media/PlayerControls';

const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
/** The embed only starts reporting after it hears "listening"; YouTube's own API retries the same way. */
const LISTEN_RETRY_MS = 250;
const LISTEN_MAX_TRIES = 40;
/** onError codes: 101 and 150 mean the owner does not allow playback in embedded players. */
const EMBED_BLOCKED = new Set([101, 150]);
const ERROR_TEXT: Record<number, string> = {
  2: 'Liên kết video không hợp lệ.',
  5: 'Trình duyệt của TV không phát được video này.',
  100: 'Video không tồn tại hoặc đã bị gỡ / để riêng tư.',
};
/** YT.PlayerState values reported by the embed. */
const PLAYING = 1;
const BUFFERING = 3;

interface Target {
  videoId: string | null;
  listId: string | null;
  start: number;
}

interface EmbedInfo {
  currentTime?: number;
  duration?: number;
  playerState?: number;
  volume?: number;
  muted?: boolean;
  videoLoadedFraction?: number;
  videoData?: { title?: string };
}

function readTarget(args: Record<string, unknown>): Target | null {
  const videoId = typeof args.videoId === 'string' && args.videoId ? args.videoId : null;
  const listId = typeof args.listId === 'string' && args.listId ? args.listId : null;
  if (!videoId && !listId) return null;
  return { videoId, listId, start: typeof args.start === 'number' ? Math.max(0, Math.floor(args.start)) : 0 };
}

function embedUrl({ videoId, listId, start }: Target): string {
  const params = new URLSearchParams({
    enablejsapi: '1',
    autoplay: '1',
    // Our own controls drive the player: the D-pad cannot reach inside a cross-origin frame.
    controls: '0',
    disablekb: '1',
    fs: '0',
    rel: '0',
    iv_load_policy: '3',
    playsinline: '1',
    origin: location.origin,
  });
  if (start) params.set('start', String(start));
  if (listId) params.set('list', listId);
  return `${EMBED_ORIGIN}/embed/${videoId ?? 'videoseries'}?${params.toString()}`;
}

/** Deep link into the TV's YouTube app; the TV reports an error if the app or the format is not supported. */
function openInTvApp(target: Target | null): Promise<void> {
  const params: Record<string, string> = {};
  if (target?.videoId) params.contentTarget = `https://www.youtube.com/tv?v=${target.videoId}${target.listId ? `&list=${target.listId}` : ''}`;
  return launchTvApp(YOUTUBE_TV_APP_ID, params);
}

function toPlayback(prev: Playback, info: EmbedInfo): Playback {
  const duration = info.duration ?? prev.duration;
  return {
    playing: info.playerState === undefined ? prev.playing : info.playerState === PLAYING || info.playerState === BUFFERING,
    time: info.currentTime ?? prev.time,
    duration,
    buffered: info.videoLoadedFraction === undefined ? prev.buffered : info.videoLoadedFraction * duration,
    volume: info.volume === undefined ? prev.volume : info.volume / 100,
    muted: info.muted ?? prev.muted,
  };
}

function StartScreen({ canLaunch }: { canLaunch: boolean }) {
  return (
    <div className="app-empty yt-start" data-nav-scope>
      <Youtube className="yt-start-icon" />
      <h2>Phát YouTube từ điện thoại</h2>
      <p>
        Trong ứng dụng YouTube trên điện thoại (đã đăng nhập tài khoản của bạn), chọn video, bấm <strong>Chia sẻ</strong> rồi chọn
        <strong> TV Remote</strong>. Nếu không thấy mục đó (iPhone), chọn <strong>Sao chép đường liên kết</strong> rồi dán vào tab
        <strong> Media</strong> của remote.
      </p>
      {canLaunch && (
        <button
          className="btn primary"
          data-nav-default
          onClick={() => openInTvApp(null).catch((err: Error) => os.get().notify({ title: 'Không mở được YouTube của TV', body: err.message, level: 'error' }))}
        >
          <ExternalLink /> Mở ứng dụng YouTube của TV
        </button>
      )}
    </div>
  );
}

export default function YouTubeApp({ win }: WindowProps) {
  const canLaunch = !!platformCaps?.launchApps;
  const target = readTarget(win.args);
  const targetKey = target ? `${target.videoId}|${target.listId}|${target.start}|${String(win.args._nonce ?? '')}` : '';
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [playback, setPlayback] = useState<Playback>(IDLE_PLAYBACK);
  const [title, setTitle] = useState('YouTube');
  const [message, setMessage] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const chrome = usePlayerChrome(() => playbackRef.current.playing);

  const post = (func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args, id: win.id, channel: 'widget' }), EMBED_ORIGIN);
  };

  const handOver = () => {
    openInTvApp(target).catch((err: Error) => setMessage(`Không mở được ứng dụng YouTube của TV: ${err.message}`));
  };

  const command = (cmd: MediaCommand, value?: number) => {
    if (!target) return;
    chrome.wake();
    const p = playbackRef.current;
    switch (cmd) {
      case 'toggle':
        return post(p.playing ? 'pauseVideo' : 'playVideo');
      case 'play':
        return post('playVideo');
      case 'pause':
        return post('pauseVideo');
      case 'stop':
        return post('stopVideo');
      case 'seek':
        return value === undefined ? undefined : post('seekTo', [clamp(value, 0, p.duration || value), true]);
      case 'seek-by': {
        const by = value ?? SEEK_STEP_S;
        chrome.flash(`${by > 0 ? '+' : ''}${by}s`);
        return post('seekTo', [Math.max(0, p.time + by), true]);
      }
      case 'next':
        return post('nextVideo');
      case 'prev':
        return post('previousVideo');
      case 'volume':
        if (value === undefined) return;
        post('unMute');
        post('setVolume', [Math.round(clamp(value, 0, 1) * 100)]);
        return chrome.flash(`Âm lượng ${Math.round(clamp(value, 0, 1) * 100)}%`);
      case 'mute':
        post(p.muted ? 'unMute' : 'mute');
        return chrome.flash(p.muted ? 'Bật tiếng' : 'Tắt tiếng');
    }
  };

  const remote = useMediaController(
    win.id,
    target ? { title: title.slice(0, 256), kind: 'video', playing: playback.playing, time: playback.time, duration: playback.duration, volume: playback.volume, muted: playback.muted } : null,
    command,
  );

  useEffect(() => {
    os.get().setWindowTitle(win.id, title);
  }, [title, win.id]);

  // A new link resets the player state; the iframe reloads because its key changes.
  useEffect(() => {
    setPlayback(IDLE_PLAYBACK);
    setTitle('YouTube');
    setMessage(null);
    setConnected(false);
    remote.publish(0, true);
    chrome.wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Say "listening" until the embed answers, then subscribe to state changes and errors.
  useEffect(() => {
    if (!target || connected) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: win.id, channel: 'widget' }), EMBED_ORIGIN);
      if (tries >= LISTEN_MAX_TRIES) {
        clearInterval(timer);
        setMessage('Không kết nối được tới YouTube. Kiểm tra mạng của TV rồi gửi lại liên kết.');
      }
    }, LISTEN_RETRY_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, connected]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== EMBED_ORIGIN || e.source !== frameRef.current?.contentWindow || typeof e.data !== 'string') return;
      let msg: { event?: string; info?: unknown };
      try {
        msg = JSON.parse(e.data) as { event?: string; info?: unknown };
      } catch {
        return;
      }
      if (!connected) {
        setConnected(true);
        post('addEventListener', ['onStateChange']);
        post('addEventListener', ['onError']);
      }
      if (msg.event === 'onError' && typeof msg.info === 'number') {
        if (EMBED_BLOCKED.has(msg.info) && canLaunch) {
          setMessage('Chủ video không cho phát nhúng, đang mở bằng ứng dụng YouTube của TV…');
          handOver();
        } else {
          setMessage(EMBED_BLOCKED.has(msg.info) ? 'Chủ video không cho phát trong trình phát nhúng. Hãy xem bằng ứng dụng YouTube của TV.' : (ERROR_TEXT[msg.info] ?? `YouTube báo lỗi ${msg.info}.`));
        }
        return;
      }
      if ((msg.event === 'infoDelivery' || msg.event === 'initialDelivery') && msg.info && typeof msg.info === 'object') {
        const info = msg.info as EmbedInfo;
        if (info.videoData?.title) setTitle(info.videoData.title);
        const next = toPlayback(playbackRef.current, info);
        const changed = next.playing !== playbackRef.current.playing || next.muted !== playbackRef.current.muted || next.volume !== playbackRef.current.volume;
        setPlayback(next);
        if (!next.playing) chrome.showControls();
        remote.publish(next.time, changed);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, connected, canLaunch]);

  if (!target) {
    return (
      <div className="app">
        <StartScreen canLaunch={canLaunch} />
      </div>
    );
  }

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
        <iframe
          key={targetKey}
          ref={frameRef}
          className="yt-frame"
          src={embedUrl(target)}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          // Never a D-pad stop: focus inside a cross-origin frame would swallow the remote's keys.
          tabIndex={-1}
          data-nav-skip
        />
        {message && <div className="player-message">{message}</div>}
        {chrome.osd && <div className="player-osd">{chrome.osd}</div>}
        <PlayerControls
          title={title}
          playback={playback}
          active={connected}
          canStep={!!target.listId}
          hidden={!chrome.controlsShown}
          command={command}
          extra={
            canLaunch && (
              <button className="p-btn" onClick={handOver} title="Mở bằng ứng dụng YouTube của TV">
                <ExternalLink />
              </button>
            )
          }
        />
      </div>
    </div>
  );
}
