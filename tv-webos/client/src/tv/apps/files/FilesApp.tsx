import { useEffect, useState } from 'react';
import {
  ArrowUp,
  Download,
  File,
  FileText,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  Image as ImageIcon,
  Music,
  Pencil,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import { formatBytes, formatDate } from '../../../common/format';
import { launch } from '../../os/apps';
import {
  copyToLocal,
  deleteLocal,
  kindOf,
  listLocal,
  listServer,
  localObjectUrl,
  renameLocal,
  serverOps,
  type FileKind,
  type LocalFile,
  type ServerEntry,
} from '../../os/files';
import { os, useOs } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { AppModal, PromptModal, useAsync, useBack } from '../common';

type Volume = 'server' | 'local';

interface Item {
  key: string;
  name: string;
  kind: FileKind;
  size: number;
  mtime: number;
  isDir: boolean;
  server?: ServerEntry;
  local?: LocalFile;
}

const KIND_ICON: Record<FileKind, typeof File> = {
  dir: Folder,
  video: Film,
  audio: Music,
  image: ImageIcon,
  text: FileText,
  other: File,
};

const MAX_THUMBS = 60;

function Thumb({ item, showImage }: { item: Item; showImage: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!showImage || item.kind !== 'image') return;
    if (item.server?.url) {
      setSrc(item.server.url);
      return;
    }
    if (item.local) {
      const { url, release } = localObjectUrl(item.local);
      setSrc(url);
      return release;
    }
  }, [item, showImage]);
  const Icon = KIND_ICON[item.kind];
  return (
    <div className={`thumb ${item.isDir ? 'dir' : ''}`}>{src ? <img src={src} alt="" loading="lazy" /> : <Icon strokeWidth={1.6} />}</div>
  );
}

type Modal =
  | { type: 'mkdir' }
  | { type: 'rename'; item: Item }
  | { type: 'delete'; item: Item }
  | null;

export default function FilesApp({ win }: WindowProps) {
  const initialVolume = (win.args.volume as Volume) || 'server';
  const [volume, setVolume] = useState<Volume>(initialVolume);
  const [path, setPath] = useState<string>(typeof win.args.path === 'string' ? win.args.path : '');
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const linkOnline = useOs((s) => s.link.status === 'online' && !!s.link.apiToken);

  // Navigation requests from other apps (e.g. "open folder" in a notification).
  useEffect(() => {
    if (win.args._nonce) {
      if (win.args.volume) setVolume(win.args.volume as Volume);
      if (typeof win.args.path === 'string') setPath(win.args.path);
    }
  }, [win.args]);

  useEffect(() => {
    os.get().setWindowArgs(win.id, { volume, path });
    const title = volume === 'local' ? 'Tệp - Bộ nhớ TV' : `Tệp - ${path ? path.split('/').pop() : 'Thư viện media'}`;
    os.get().setWindowTitle(win.id, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, path]);

  const listing = useAsync<{ items: Item[]; readonly: boolean }>(async () => {
    if (volume === 'local') {
      const files = await listLocal();
      return {
        readonly: false,
        items: files.map((f) => ({ key: f.id, name: f.name, kind: kindOf(f.name), size: f.size, mtime: f.mtime, isDir: false, local: f })),
      };
    }
    if (!linkOnline) throw new Error('Chưa kết nối tới server.');
    const res = await listServer(path);
    return {
      readonly: res.readonly,
      items: res.entries.map((e) => ({
        key: e.path,
        name: e.name,
        kind: e.type === 'dir' ? 'dir' : (e.kind as FileKind),
        size: e.size,
        mtime: e.mtime,
        isDir: e.type === 'dir',
        server: e,
      })),
    };
  }, [volume, path, linkOnline]);

  const items = listing.data?.items ?? [];
  const readonly = listing.data?.readonly ?? true;
  const current = items.find((i) => i.key === selected) ?? null;
  const showImages = items.filter((i) => i.kind === 'image').length <= MAX_THUMBS;

  const goUp = () => {
    if (volume === 'server' && path) {
      setPath(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
      return true;
    }
    return false;
  };
  useBack(win.id, () => {
    if (modal) return false;
    return goUp();
  });

  const open = (item: Item) => {
    if (item.isDir && item.server) {
      setPath(item.server.path);
      setSelected(null);
      return;
    }
    const args = item.server ? { path: item.server.path } : { localId: item.local!.id };
    switch (item.kind) {
      case 'video':
      case 'audio':
        launch('media', args);
        break;
      case 'image':
        launch('gallery', args);
        break;
      case 'text':
        launch('viewer', args);
        break;
      default:
        os.get().notify({ title: 'Không có ứng dụng mở được tệp này', body: item.name, level: 'warning' });
    }
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) os.get().notify({ title: ok, level: 'success' });
      listing.reload();
    } catch (err) {
      os.get().notify({ title: 'Thao tác thất bại', body: err instanceof Error ? err.message : String(err), level: 'error' });
    } finally {
      setBusy(false);
      setModal(null);
    }
  };

  const crumbs = path ? path.split('/') : [];
  const canWrite = volume === 'local' || !readonly;

  return (
    <div className="app">
      <div className="app-split">
        <div className="app-sidebar" data-nav-scope>
          <div className="side-label">Vị trí</div>
          <button
            className={`side-item ${volume === 'server' && !path ? 'active' : ''}`}
            onClick={() => {
              setVolume('server');
              setPath('');
            }}
          >
            <Server /> Thư viện media
          </button>
          <button
            className={`side-item ${volume === 'server' && path === 'Uploads' ? 'active' : ''}`}
            onClick={() => {
              setVolume('server');
              setPath('Uploads');
            }}
          >
            <Upload /> Tệp nhận từ điện thoại
          </button>
          <button className={`side-item ${volume === 'local' ? 'active' : ''}`} onClick={() => setVolume('local')}>
            <HardDrive /> Bộ nhớ TV
          </button>
          <div className="side-label">Mở nhanh</div>
          <button className="side-item" onClick={() => launch('gallery')}>
            <ImageIcon /> Tất cả ảnh
          </button>
          <button className="side-item" onClick={() => launch('media')}>
            <Film /> Video và nhạc
          </button>
        </div>
        <div className="app" style={{ flex: 1, minWidth: 0 }}>
          <div className="app-toolbar">
            <button className="btn icon-only" title="Lên một cấp" onClick={goUp} disabled={volume !== 'server' || !path}>
              <ArrowUp />
            </button>
            <div className="breadcrumbs grow">
              {volume === 'local' ? (
                <span className="crumb">Bộ nhớ TV</span>
              ) : (
                <>
                  <button className="crumb" onClick={() => setPath('')}>
                    Thư viện media
                  </button>
                  {crumbs.map((c, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center' }}>
                      <span className="crumb-sep">/</span>
                      <button className="crumb" onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}>
                        {c}
                      </button>
                    </span>
                  ))}
                </>
              )}
            </div>
            {volume === 'server' && (
              <button className="btn icon-only" title="Thư mục mới" disabled={!canWrite || busy} onClick={() => setModal({ type: 'mkdir' })}>
                <FolderPlus />
              </button>
            )}
            {volume === 'server' && current && !current.isDir && (
              <button className="btn icon-only" title="Lưu vào bộ nhớ TV" disabled={busy} onClick={() => run(() => copyToLocal(current.server!), 'Đã lưu vào bộ nhớ TV')}>
                <Download />
              </button>
            )}
            <button className="btn icon-only" title="Đổi tên" disabled={!current || !canWrite || busy} onClick={() => current && setModal({ type: 'rename', item: current })}>
              <Pencil />
            </button>
            <button className="btn icon-only" title="Xóa" disabled={!current || !canWrite || busy} onClick={() => current && setModal({ type: 'delete', item: current })}>
              <Trash2 />
            </button>
            <button className="btn icon-only" title="Tải lại" onClick={listing.reload}>
              <RefreshCw />
            </button>
          </div>
          <div className="app-content" data-nav-scope>
            {listing.loading && !listing.data && <div className="spinner" style={{ margin: '3rem auto' }} />}
            {listing.error && <div className="error-box">{listing.error}</div>}
            {listing.data && items.length === 0 && (
              <div className="app-empty" style={{ height: 'auto', paddingTop: '4rem' }}>
                <h2>Thư mục trống</h2>
                <p>
                  {volume === 'local'
                    ? 'Lưu tệp từ thư viện media vào TV bằng nút Tải xuống.'
                    : 'Sao chép tệp vào thư mục media trên máy chạy server, hoặc gửi tệp từ điện thoại.'}
                </p>
              </div>
            )}
            <div className="file-grid">
              {items.map((item, i) => (
                <button
                  key={item.key}
                  className={`file-item ${selected === item.key ? 'selected' : ''}`}
                  onFocus={() => setSelected(item.key)}
                  onClick={() => {
                    if (selected === item.key) open(item);
                    else setSelected(item.key);
                  }}
                  onDoubleClick={() => open(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      open(item);
                    }
                  }}
                  {...(i === 0 ? { 'data-nav-default': '' } : {})}
                >
                  <Thumb item={item} showImage={showImages} />
                  <span className="name">{item.name}</span>
                  <span className="meta">{item.isDir ? 'Thư mục' : formatBytes(item.size)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="status-bar">
            <span>
              {items.length} mục{readonly && volume === 'server' ? ' · chỉ đọc' : ''}
            </span>
            <span>{current ? `${current.name} · ${formatDate(current.mtime)}` : 'OK: mở · nhấn lần nữa để mở bằng chuột'}</span>
          </div>
        </div>
      </div>

      {modal?.type === 'mkdir' && (
        <PromptModal
          windowId={win.id}
          title="Thư mục mới"
          placeholder="Tên thư mục"
          confirmLabel="Tạo"
          onClose={() => setModal(null)}
          onSubmit={(name) => run(() => serverOps.mkdir(path ? `${path}/${name}` : name))}
        />
      )}
      {modal?.type === 'rename' && (
        <PromptModal
          windowId={win.id}
          title="Đổi tên"
          initial={modal.item.name}
          confirmLabel="Đổi tên"
          onClose={() => setModal(null)}
          onSubmit={(name) =>
            run(() => (modal.item.local ? renameLocal(modal.item.local.id, name) : serverOps.rename(modal.item.server!.path, name)))
          }
        />
      )}
      {modal?.type === 'delete' && (
        <AppModal
          windowId={win.id}
          title={`Xóa "${modal.item.name}"?`}
          onClose={() => setModal(null)}
          actions={[
            { label: 'Hủy', run: () => setModal(null) },
            {
              label: 'Xóa',
              danger: true,
              run: () => run(() => (modal.item.local ? deleteLocal(modal.item.local.id) : serverOps.remove(modal.item.server!.path))),
            },
          ]}
        >
          <p className="muted">
            {modal.item.isDir ? 'Thư mục và toàn bộ nội dung bên trong sẽ bị xóa vĩnh viễn.' : 'Tệp sẽ bị xóa vĩnh viễn.'}
          </p>
        </AppModal>
      )}
    </div>
  );
}
