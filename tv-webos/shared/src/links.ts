/**
 * Link helpers shared by the remote (labelling a link before sending it) and the TV (routing it to an app).
 * Pure functions: no DOM, no zod, so they run in browsers, the server and tests alike.
 */

export const MAX_LINK_LENGTH = 2048;

export interface YouTubeTarget {
  /** 11-character video id, or null for a playlist link without a video. */
  videoId: string | null;
  listId: string | null;
  /** Start offset in seconds. */
  start: number;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'youtu.be', 'youtube-nocookie.com']);
const PATH_VIDEO_PREFIXES = ['shorts', 'live', 'embed', 'v'];

/** The first http(s) URL inside shared text such as "Xem cái này https://youtu.be/abc ...". */
export function firstHttpUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;
  const url = match[0].replace(/[),.;!?]+$/, '');
  return url.length <= MAX_LINK_LENGTH ? url : null;
}

export function isHttpUrl(value: string): boolean {
  if (value.length > MAX_LINK_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else -> 0. */
function parseStart(raw: string | null): number {
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (!m || !m[0]) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

function videoIdFromPath(host: string, segments: string[]): string | null {
  if (host === 'youtu.be') return segments[0] ?? null;
  const [first, second] = segments;
  return first && second && PATH_VIDEO_PREFIXES.includes(first) ? second : null;
}

/** Video / playlist behind a YouTube link (watch, youtu.be, shorts, live, embed, playlist, music.youtube.com). */
export function parseYouTube(raw: string): YouTubeTarget | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const candidate = url.searchParams.get('v') ?? videoIdFromPath(host, segments);
  const videoId = candidate && VIDEO_ID.test(candidate) ? candidate : null;
  const list = url.searchParams.get('list');
  const listId = list && LIST_ID.test(list) ? list : null;
  if (!videoId && !listId) return null;
  return { videoId, listId, start: parseStart(url.searchParams.get('t') ?? url.searchParams.get('start')) };
}
