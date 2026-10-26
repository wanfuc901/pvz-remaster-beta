import { useEffect } from 'react';
import { getLocal, serverFileWithSiblings } from '../../os/files';
import { os } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { useAsync } from '../common';

const MAX_CHARS = 1_000_000;

/** Blob.text() needs Chromium 76; FileReader works on every supported TV engine. */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('Không đọc được tệp'));
    r.readAsText(blob);
  });
}

const SCROLL_KEYS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };

export default function TextViewerApp({ win }: WindowProps) {
  const doc = useAsync(async () => {
    if (typeof win.args.localId === 'string') {
      const f = await getLocal(win.args.localId);
      if (!f) throw new Error('Tệp không còn trong bộ nhớ TV');
      return { name: f.name, text: await readBlobText(f.blob.slice(0, MAX_CHARS * 4)) };
    }
    if (typeof win.args.path === 'string') {
      const { file } = await serverFileWithSiblings(win.args.path);
      if (!file?.url) throw new Error('Không tìm thấy tệp trên server');
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`Không đọc được tệp (HTTP ${res.status})`);
      return { name: file.name, text: await res.text() };
    }
    throw new Error('Không có tệp để hiển thị');
  }, [win.args.path, win.args.localId]);

  useEffect(() => {
    if (doc.data) os.get().setWindowTitle(win.id, doc.data.name);
  }, [doc.data, win.id]);

  return (
    <div className="app">
      {/* Focusable so D-pad users can scroll with the arrow keys. */}
      <div
        className="app-content"
        tabIndex={0}
        data-focusable
        data-nav-default
        style={{ padding: 0 }}
        onKeyDown={(e) => {
          const step = SCROLL_KEYS[e.key];
          if (!step) return;
          const el = e.currentTarget;
          const atEdge = step < 0 ? el.scrollTop <= 0 : el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          if (atEdge && Math.abs(step) === 1) return; // let focus leave the viewer
          e.preventDefault();
          el.scrollTop += step * 80;
        }}
      >
        {doc.loading && <div className="spinner" style={{ margin: '3rem auto' }} />}
        {doc.error && <div className="error-box">{doc.error}</div>}
        {doc.data && (
          <pre className="text-view">
            {doc.data.text.length > MAX_CHARS ? doc.data.text.slice(0, MAX_CHARS) + '\n\n[... đã cắt bớt]' : doc.data.text}
          </pre>
        )}
      </div>
    </div>
  );
}
