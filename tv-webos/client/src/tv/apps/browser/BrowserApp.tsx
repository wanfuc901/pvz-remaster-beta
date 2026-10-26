import { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Globe, House, RefreshCw } from 'lucide-react';
import { local } from '../../../common/storage';
import { platformCaps } from '../../TvApp';
import { launchTvApp, WEBOS_BROWSER_ID } from '../../platform/webos';
import { os } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { useBack } from '../common';

interface Bookmark {
  title: string;
  url: string;
}

const BOOKMARKS_KEY = 'tvwebos.bookmarks';
const DEFAULT_BOOKMARKS: Bookmark[] = [
  { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
  { title: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html' },
];

function normalize(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v)) return 'https://' + v;
  return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return true;
  }
}

export default function BrowserApp({ win }: WindowProps) {
  const [url, setUrl] = useState<string | null>(typeof win.args.url === 'string' ? win.args.url : null);
  const [input, setInput] = useState(url ?? '');
  const [nonce, setNonce] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => local.getJson(BOOKMARKS_KEY, DEFAULT_BOOKMARKS));
  const canLaunch = !!platformCaps?.launchApps;

  useEffect(() => {
    os.get().setWindowArgs(win.id, url ? { url } : {});
    let host = 'Trình duyệt';
    if (url) {
      try {
        host = new URL(url).host;
      } catch {
        host = url;
      }
    }
    os.get().setWindowTitle(win.id, host);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useBack(win.id, () => {
    if (url) {
      setUrl(null);
      return true;
    }
    return false;
  });

  const go = (raw: string) => {
    const n = normalize(raw);
    if (!n) return;
    setUrl(n);
    setInput(n);
  };

  const openExternally = (target: string) => {
    launchTvApp(WEBOS_BROWSER_ID, { target }).catch((err: Error) =>
      os.get().notify({ title: 'Không mở được trình duyệt của TV', body: err.message, level: 'error' }),
    );
  };

  const addBookmark = () => {
    if (!url || bookmarks.some((b) => b.url === url)) return;
    let title = url;
    try {
      title = new URL(url).host;
    } catch {
      // keep url
    }
    const next = [...bookmarks, { title, url }];
    setBookmarks(next);
    local.setJson(BOOKMARKS_KEY, next);
  };

  return (
    <div className="app">
      <form
        className="app-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          go(input);
        }}
      >
        <button type="button" className="btn icon-only" title="Trang bắt đầu" onClick={() => setUrl(null)}>
          {url ? <ArrowLeft /> : <House />}
        </button>
        <button type="button" className="btn icon-only" title="Tải lại" onClick={() => setNonce(nonce + 1)} disabled={!url}>
          <RefreshCw />
        </button>
        <input className="text-input grow" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Nhập địa chỉ hoặc từ khóa" inputMode="url" />
        <button type="submit" className="btn primary">
          Đi
        </button>
        {url && (
          <button type="button" className="btn" onClick={addBookmark}>
            Lưu
          </button>
        )}
        {url && canLaunch && (
          <button type="button" className="btn" onClick={() => openExternally(url)} title="Mở bằng trình duyệt của TV">
            <ExternalLink />
          </button>
        )}
      </form>
      {url ? (
        <div className="browser-frame">
          <iframe
            key={nonce}
            src={url}
            title="web"
            referrerPolicy="no-referrer"
            // Pages from the desktop's own origin must not get allow-same-origin: they could read its storage.
            sandbox={isSameOrigin(url) ? 'allow-scripts allow-forms' : 'allow-scripts allow-forms allow-same-origin allow-popups'}
          />
        </div>
      ) : (
        <div className="app-content browser-start" data-nav-scope>
          <h2 style={{ fontSize: '1.5rem' }}>Trang đã lưu</h2>
          <div className="bookmark-grid">
            {bookmarks.map((b, i) => (
              <button key={b.url} className="bookmark" onClick={() => go(b.url)} {...(i === 0 ? { 'data-nav-default': '' } : {})}>
                <div className="app-glyph" style={{ background: '#10b981' }}>
                  <Globe />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{b.title}</div>
                  <div className="u">{b.url}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="info-box" style={{ marginTop: '1.6rem' }}>
            <strong>Giới hạn của trình duyệt nhúng.</strong> Trang web được mở trong khung (iframe) bên trong TV WebOS.
            Nhiều trang (Google, YouTube, Facebook, ngân hàng...) chặn việc nhúng bằng X-Frame-Options hoặc CSP và sẽ
            hiện trang trắng hoặc báo lỗi; đây là cơ chế bảo mật của trang đó, TV WebOS không thể và không vượt qua.
            Con trỏ ảo từ điện thoại cũng không bấm được vào bên trong trang nhúng; hãy dùng Magic Remote hoặc
            {canLaunch ? ' nút "Mở bằng trình duyệt của TV".' : ' mở trang bằng trình duyệt của TV (chỉ khả dụng khi chạy dưới dạng ứng dụng webOS đã cài).'}
          </div>
          {canLaunch && (
            <button className="btn" style={{ marginTop: '1rem' }} onClick={() => openExternally(normalize(input) ?? 'about:blank')}>
              <ExternalLink /> Mở trình duyệt của TV
            </button>
          )}
        </div>
      )}
    </div>
  );
}
