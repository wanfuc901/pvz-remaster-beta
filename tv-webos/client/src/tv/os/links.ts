/**
 * Route a link sent from a phone: YouTube links play in the YouTube app, anything else opens in the
 * built-in browser, or in the TV's own browser when asked (only possible as the packaged webOS app).
 */
import { parseYouTube } from '@tvwebos/shared/links';
import { launchTvApp, WEBOS_BROWSER_ID } from '../platform/webos';
import { launch } from './apps';
import { os } from './store';

export type LinkTarget = 'auto' | 'tv-browser';

export function openLink(url: string, target: LinkTarget = 'auto'): void {
  const youtube = target === 'auto' ? parseYouTube(url) : null;
  if (youtube) {
    // The nonce makes a re-sent link restart playback in the already-open YouTube window.
    launch('youtube', { videoId: youtube.videoId ?? '', listId: youtube.listId ?? '', start: youtube.start, _nonce: Date.now() });
    return;
  }
  if (target === 'tv-browser') {
    launchTvApp(WEBOS_BROWSER_ID, { target: url }).catch((err: Error) => {
      os.get().notify({ title: 'Không mở được trình duyệt của TV, đã mở trong trình duyệt nhúng', body: err.message, level: 'warning' });
      launch('browser', { url });
    });
    return;
  }
  launch('browser', { url });
}
