import { useState } from 'react';
import { Download, Link, Package, Pin, PinOff, Play, RefreshCw, Trash2 } from 'lucide-react';
import { compareVersions, type MiniAppManifest, type MiniAppPermission } from '@tvwebos/shared/miniapp';
import { launch } from '../../os/apps';
import { absUrl } from '../../os/api';
import { checkUpdates, fetchCatalog, fetchManifest, install, uninstall } from '../../os/miniapps';
import { os, useOs } from '../../os/store';
import type { AppDescriptor, WindowProps } from '../../os/types';
import { AppIcon } from '../../shell/AppIcon';
import { AppModal, useAsync } from '../common';

const PERMISSION_TEXT: Record<MiniAppPermission, string> = {
  storage: 'Lưu dữ liệu trên TV',
  notifications: 'Gửi thông báo',
  gamepad: 'Nhận tay cầm từ điện thoại',
  pointer: 'Nhận con trỏ',
  'text-input': 'Nhận văn bản từ điện thoại',
};

type Tab = 'catalog' | 'installed' | 'url';

function descriptorOf(m: MiniAppManifest, iconUrl?: string): AppDescriptor {
  return { id: m.id, name: m.name, kind: 'miniapp', color: m.color ?? '#334155', iconUrl, singleton: true };
}

function Perms({ list }: { list: MiniAppPermission[] }) {
  if (!list.length) return <div className="perm-list muted small">Không yêu cầu quyền nào</div>;
  return (
    <div className="perm-list">
      {list.map((p) => (
        <span key={p} className="chip">
          {PERMISSION_TEXT[p]}
        </span>
      ))}
    </div>
  );
}

export default function StoreApp({ win }: WindowProps) {
  const [tab, setTab] = useState<Tab>('catalog');
  const installed = useOs((s) => s.miniapps);
  const pinned = useOs((s) => s.pinned);
  const online = useOs((s) => s.link.status === 'online' && !!s.link.apiToken);
  const [busy, setBusy] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Map<string, MiniAppManifest>>(new Map());
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<{ manifest: MiniAppManifest; url: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MiniAppManifest | null>(null);

  const catalog = useAsync(async () => {
    if (!online) throw new Error('Chưa kết nối tới server.');
    return fetchCatalog();
  }, [online]);

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try {
      await fn();
      os.get().notify({ title: ok, level: 'success' });
    } catch (err) {
      os.get().notify({ title: 'Thao tác thất bại', body: err instanceof Error ? err.message : String(err), level: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const togglePin = (appId: string) => {
    const id = `miniapp:${appId}`;
    const s = os.get();
    s.setPinned(s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id]);
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'catalog', label: 'Khám phá' },
    { id: 'installed', label: `Đã cài (${installed.length})` },
    { id: 'url', label: 'Cài từ URL' },
  ];

  return (
    <div className="app" style={{ position: 'relative' }}>
      <div className="app-toolbar">
        <div className="segmented">
          {tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} {...(t.id === 'catalog' ? { 'data-nav-default': '' } : {})}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="grow" />
        {tab === 'installed' && (
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() =>
              act('check', async () => {
                const u = await checkUpdates();
                setUpdates(u);
                if (!u.size) throw new Error('Tất cả ứng dụng đều là bản mới nhất');
              }, 'Có bản cập nhật')
            }
          >
            <RefreshCw /> Kiểm tra cập nhật
          </button>
        )}
        {tab === 'catalog' && (
          <button className="btn" onClick={catalog.reload}>
            <RefreshCw /> Tải lại
          </button>
        )}
      </div>

      <div className="app-content" data-nav-scope>
        {tab === 'catalog' && (
          <>
            {catalog.loading && <div className="spinner" style={{ margin: '3rem auto' }} />}
            {catalog.error && <div className="error-box">{catalog.error}</div>}
            {catalog.data && catalog.data.length === 0 && <div className="muted">Server chưa có mini-app nào trong thư mục catalog.</div>}
            <div className="store-grid">
              {catalog.data?.map(({ manifest, manifestUrl }) => {
                const inst = installed.find((a) => a.manifest.id === manifest.id);
                const newer = inst && compareVersions(manifest.version, inst.manifest.version) > 0;
                const iconUrl = manifest.icon ? new URL(manifest.icon, absUrl(manifestUrl)).href : undefined;
                return (
                  <div className="store-card" key={manifest.id}>
                    <AppIcon app={descriptorOf(manifest, iconUrl)} />
                    <div className="info">
                      <h3>{manifest.name}</h3>
                      <div className="meta">
                        {manifest.author || 'Không rõ tác giả'} · v{manifest.version}
                        {inst ? ` · đã cài v${inst.manifest.version}` : ''}
                      </div>
                      <p>{manifest.description}</p>
                      <Perms list={manifest.permissions} />
                      <div className="btn-row">
                        {!inst && (
                          <button className="btn primary" disabled={busy !== null} onClick={() => act(manifest.id, () => install(manifestUrl, 'catalog'), `Đã cài ${manifest.name}`)}>
                            <Download /> {busy === manifest.id ? 'Đang cài...' : 'Cài đặt'}
                          </button>
                        )}
                        {newer && (
                          <button className="btn primary" disabled={busy !== null} onClick={() => act(manifest.id, () => install(manifestUrl, 'catalog'), `Đã cập nhật ${manifest.name}`)}>
                            <RefreshCw /> Cập nhật
                          </button>
                        )}
                        {inst && (
                          <button className="btn" onClick={() => launch(`miniapp:${manifest.id}`)}>
                            <Play /> Mở
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'installed' && (
          <>
            {!installed.length && (
              <div className="app-empty" style={{ height: 'auto', paddingTop: '3rem' }}>
                <Package style={{ width: '3rem', height: '3rem' }} />
                <h2 style={{ marginTop: '1rem' }}>Chưa cài mini-app nào</h2>
              </div>
            )}
            <div className="store-grid">
              {installed.map((app) => {
                const m = app.manifest;
                const update = updates.get(m.id);
                const isPinned = pinned.includes(`miniapp:${m.id}`);
                return (
                  <div className="store-card" key={m.id}>
                    <AppIcon app={descriptorOf(m, app.iconUrl)} />
                    <div className="info">
                      <h3>{m.name}</h3>
                      <div className="meta">
                        v{m.version} · {app.source === 'catalog' ? 'Từ App Store' : 'Cài từ URL'}
                        {update ? ` · có bản v${update.version}` : ''}
                      </div>
                      <p className="small" style={{ wordBreak: 'break-all' }}>
                        {app.manifestUrl}
                      </p>
                      <Perms list={m.permissions} />
                      <div className="btn-row">
                        <button className="btn" onClick={() => launch(`miniapp:${m.id}`)}>
                          <Play /> Mở
                        </button>
                        {update && (
                          <button className="btn primary" disabled={busy !== null} onClick={() => act(m.id, () => install(app.manifestUrl, app.source), `Đã cập nhật ${m.name}`)}>
                            <RefreshCw /> Cập nhật
                          </button>
                        )}
                        <button className="btn icon-only" title={isPinned ? 'Bỏ ghim' : 'Ghim vào thanh tác vụ'} onClick={() => togglePin(m.id)}>
                          {isPinned ? <PinOff /> : <Pin />}
                        </button>
                        <button className="btn icon-only danger" title="Gỡ cài đặt" onClick={() => setConfirmRemove(m)}>
                          <Trash2 />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'url' && (
          <div style={{ maxWidth: '52rem' }}>
            <p className="muted" style={{ lineHeight: 1.5 }}>
              Nhập địa chỉ tệp manifest (JSON) của mini-app. Máy chủ chứa manifest phải cho phép CORS. Mini-app chạy trong
              khung sandbox, không đọc được dữ liệu của TV WebOS và chỉ dùng được các quyền khai báo trong manifest.
            </p>
            <form
              className="setup-form"
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  'preview',
                  async () => setPreview(await fetchManifest(url.trim())),
                  'Đã đọc manifest',
                );
              }}
            >
              <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/app/manifest.json" inputMode="url" />
              <button className="btn primary" type="submit" disabled={!/^https?:\/\//i.test(url.trim()) || busy !== null}>
                <Link /> Đọc manifest
              </button>
            </form>
          </div>
        )}
      </div>

      {preview && (
        <AppModal
          windowId={win.id}
          title={`Cài "${preview.manifest.name}"?`}
          onClose={() => setPreview(null)}
          actions={[
            { label: 'Hủy', run: () => setPreview(null) },
            {
              label: 'Cài đặt',
              primary: true,
              run: () => {
                const p = preview;
                setPreview(null);
                void act(p.manifest.id, () => install(p.url, 'url'), `Đã cài ${p.manifest.name}`);
              },
            },
          ]}
        >
          <p className="muted">
            {preview.manifest.author || 'Không rõ tác giả'} · v{preview.manifest.version}
          </p>
          <p style={{ margin: '0.6rem 0' }}>{preview.manifest.description}</p>
          <div className="muted small">Quyền yêu cầu:</div>
          <Perms list={preview.manifest.permissions} />
          <p className="small muted" style={{ marginTop: '0.8rem', wordBreak: 'break-all' }}>
            Nguồn: {preview.url}
          </p>
        </AppModal>
      )}
      {confirmRemove && (
        <AppModal
          windowId={win.id}
          title={`Gỡ "${confirmRemove.name}"?`}
          onClose={() => setConfirmRemove(null)}
          actions={[
            { label: 'Hủy', run: () => setConfirmRemove(null) },
            {
              label: 'Gỡ cài đặt',
              danger: true,
              run: () => {
                const m = confirmRemove;
                setConfirmRemove(null);
                void act(m.id, () => uninstall(m.id), `Đã gỡ ${m.name}`);
              },
            },
          ]}
        >
          <p className="muted">Dữ liệu ứng dụng lưu trên TV cũng sẽ bị xóa.</p>
        </AppModal>
      )}
    </div>
  );
}
