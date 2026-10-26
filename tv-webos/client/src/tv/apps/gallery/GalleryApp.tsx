import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw, X } from 'lucide-react';
import { getLocal, indexServer, kindOf, listLocal, localObjectUrl } from '../../os/files';
import { os, useOs } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { useAsync, useBack } from '../common';
import { focusEl } from '../../os/spatialNav';

interface Photo {
  key: string;
  name: string;
  url: string;
  mtime: number;
}

const SLIDE_MS = 5000;
const PAGE = 96;

function Viewer({
  windowId,
  photos,
  start,
  onClose,
}: {
  windowId: string;
  photos: Photo[];
  start: number;
  onClose: (index: number) => void;
}) {
  const [i, setI] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const photo = photos[i];
  const go = (d: number) => {
    setLoaded(false);
    setI((x) => (x + d + photos.length) % photos.length);
  };

  useBack(windowId, () => {
    onClose(i);
    return true;
  });
  useEffect(() => {
    focusEl(ref.current);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const t = window.setTimeout(() => go(1), SLIDE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, i]);
  useEffect(() => {
    os.get().setWindowTitle(windowId, `${photo?.name ?? ''} (${i + 1}/${photos.length})`);
  }, [i, photo, photos.length, windowId]);

  // Preload the next image so slideshows do not flash.
  useEffect(() => {
    const next = photos[(i + 1) % photos.length];
    if (next) new Image().src = next.url;
  }, [i, photos]);

  if (!photo) return null;
  return (
    <div
      className="viewer"
      ref={ref}
      tabIndex={0}
      data-focusable
      data-nav-scope
      data-nav-trap
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          if (e.target !== ref.current) return;
          e.preventDefault();
          go(e.key === 'ArrowLeft' ? -1 : 1);
        } else if (e.key === 'Enter' && e.target === ref.current) {
          e.preventDefault();
          setPlaying(!playing);
        }
      }}
    >
      <img src={photo.url} alt={photo.name} style={{ opacity: loaded ? 1 : 0.3 }} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
      <div className="viewer-bar">
        <span className="caption">
          {photo.name} · {i + 1}/{photos.length}
        </span>
        <div className="btn-row">
          <button className="btn icon-only" onClick={() => go(-1)} title="Ảnh trước">
            <ChevronLeft />
          </button>
          <button className="btn" onClick={() => setPlaying(!playing)}>
            {playing ? <Pause /> : <Play />} {playing ? 'Dừng' : 'Trình chiếu'}
          </button>
          <button className="btn icon-only" onClick={() => go(1)} title="Ảnh tiếp">
            <ChevronRight />
          </button>
          <button className="btn icon-only" onClick={() => onClose(i)} title="Đóng">
            <X />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GalleryApp({ win }: WindowProps) {
  const online = useOs((s) => s.link.status === 'online' && !!s.link.apiToken);
  const [viewing, setViewing] = useState<number | null>(null);
  // Old TV engines ignore loading="lazy", so render thumbnails in pages.
  const [limit, setLimit] = useState(PAGE);
  const releases = useRef<Array<() => void>>([]);
  const gridRef = useRef<HTMLDivElement>(null);

  const lib = useAsync<Photo[]>(async () => {
    releases.current.forEach((r) => r());
    releases.current = [];
    const out: Photo[] = [];
    if (online) {
      const server = await indexServer('image');
      out.push(...server.map((e) => ({ key: e.path, name: e.name, url: e.url!, mtime: e.mtime })));
    }
    try {
      for (const f of await listLocal()) {
        if (kindOf(f.name) !== 'image') continue;
        const { url, release } = localObjectUrl(f);
        releases.current.push(release);
        out.push({ key: `local:${f.id}`, name: f.name, url, mtime: f.mtime });
      }
    } catch {
      // IndexedDB unavailable
    }
    if (!online && !out.length) throw new Error('Chưa kết nối tới server.');
    return out.sort((a, b) => b.mtime - a.mtime);
  }, [online]);

  useEffect(() => () => releases.current.forEach((r) => r()), []);

  // Open a specific image passed by Files / a notification.
  useEffect(() => {
    if (!lib.data) return;
    const target = typeof win.args.path === 'string' ? win.args.path : typeof win.args.localId === 'string' ? `local:${win.args.localId}` : null;
    if (!target) return;
    const idx = lib.data.findIndex((p) => p.key === target);
    if (idx >= 0) setViewing(idx);
    else if (typeof win.args.localId === 'string') {
      void getLocal(win.args.localId).then((f) => {
        if (!f) return;
        const { url, release } = localObjectUrl(f);
        releases.current.push(release);
        lib.data!.unshift({ key: target, name: f.name, url, mtime: f.mtime });
        setViewing(0);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.data, win.args.path, win.args.localId, win.args._nonce]);

  useEffect(() => {
    if (viewing === null) os.get().setWindowTitle(win.id, 'Thư viện ảnh');
  }, [viewing, win.id]);

  const photos = lib.data ?? [];
  return (
    <div className="app" style={{ position: 'relative' }}>
      <div className="app-toolbar">
        <div className="grow" style={{ fontWeight: 600, fontSize: '1.1rem' }}>
          {photos.length} ảnh
        </div>
        <button className="btn" onClick={lib.reload}>
          <RefreshCw /> Tải lại
        </button>
        <button className="btn primary" onClick={() => photos.length && setViewing(0)} disabled={!photos.length}>
          <Play /> Trình chiếu
        </button>
      </div>
      <div className="app-content" data-nav-scope ref={gridRef} {...(viewing !== null ? { 'data-nav-hidden': '' } : {})}>
        {lib.loading && <div className="spinner" style={{ margin: '3rem auto' }} />}
        {lib.error && <div className="error-box">{lib.error}</div>}
        {lib.data && !photos.length && (
          <div className="app-empty" style={{ height: 'auto', paddingTop: '4rem' }}>
            <h2>Chưa có ảnh</h2>
            <p>Thêm ảnh vào thư mục media trên server, hoặc gửi ảnh từ điện thoại.</p>
          </div>
        )}
        <div className="gallery-grid">
          {photos.slice(0, limit).map((p, i) => (
            <button key={p.key} className="g-item" onClick={() => setViewing(i)} title={p.name} {...(i === 0 ? { 'data-nav-default': '' } : {})}>
              <img src={p.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
        {photos.length > limit && (
          <div style={{ textAlign: 'center', marginTop: '1.2rem' }}>
            <button className="btn" onClick={() => setLimit(limit + PAGE)}>
              Xem thêm ({photos.length - limit})
            </button>
          </div>
        )}
      </div>
      {viewing !== null && photos.length > 0 && (
        <Viewer
          windowId={win.id}
          photos={photos}
          start={Math.min(viewing, photos.length - 1)}
          onClose={(idx) => {
            setViewing(null);
            setTimeout(() => {
              const el = gridRef.current?.querySelectorAll<HTMLElement>('.g-item')[idx];
              if (el) focusEl(el);
            }, 0);
          }}
        />
      )}
    </div>
  );
}
