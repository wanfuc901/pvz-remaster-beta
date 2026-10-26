import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Monitor, Moon, Search, Sparkles, Sun, Trash2, X } from 'lucide-react';
import { appDescriptor, launch, useAllApps } from '../os/apps';
import { os, useOs } from '../os/store';
import { focusScope } from '../os/spatialNav';
import { timeAgo } from '../../common/format';
import type { OsNotification } from '../os/types';
import { AppIcon } from './AppIcon';

function useAutoFocus(selector: string, deps: unknown[] = []) {
  useEffect(() => {
    const t = setTimeout(() => focusScope(document.querySelector(selector)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const KIND_LABEL = { builtin: 'Hệ thống', miniapp: 'Mini-app', tvapp: 'Ứng dụng TV' } as const;

export function Launcher() {
  const apps = useAllApps();
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? apps.filter((a) => a.name.toLowerCase().includes(n) || (a.description ?? '').toLowerCase().includes(n)) : apps;
  }, [apps, q]);
  useAutoFocus('[data-launcher] .launcher-grid');
  return (
    <>
      <div className="overlay-backdrop" onClick={() => os.get().setOverlay('none')} />
      <div className="launcher glass" data-nav-scope data-nav-trap data-launcher>
        <div className="launcher-search">
          <Search />
          <input
            className="text-input"
            placeholder="Tìm ứng dụng"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) launch(filtered[0].id);
            }}
          />
        </div>
        <div className="launcher-grid" data-nav-scope>
          {filtered.map((app, i) => (
            <button key={app.id} className="launcher-item" onClick={() => launch(app.id)} {...(i === 0 ? { 'data-nav-default': '' } : {})}>
              <AppIcon app={app} />
              <span>{app.name}</span>
              <small>{KIND_LABEL[app.kind]}</small>
            </button>
          ))}
          {!filtered.length && <div className="muted">Không có ứng dụng phù hợp.</div>}
        </div>
        <div className="launcher-footer">
          <span>Phím đỏ: mở/đóng · Phím xanh lá: chuyển cửa sổ · Phím vàng: thông báo · Phím xanh dương: ghép nối</span>
          <button className="btn" onClick={() => launch('store')}>
            App Store
          </button>
        </div>
      </div>
    </>
  );
}

export function Switcher() {
  const windows = useOs((s) => s.windows);
  const focusedId = useOs((s) => s.focusedId);
  const ordered = [...windows].sort((a, b) => b.z - a.z);
  useAutoFocus('[data-switcher]');
  return (
    <>
      <div className="overlay-backdrop" onClick={() => os.get().setOverlay('none')} />
      <div className="switcher" data-nav-scope data-nav-trap data-switcher>
        <h2>{windows.length ? 'Cửa sổ đang mở' : 'Chưa có cửa sổ nào'}</h2>
        <div className="switcher-row">
          {ordered.map((w, i) => (
            <button
              key={w.id}
              className="switch-card"
              onClick={() => {
                os.get().focusWindow(w.id);
                os.get().setOverlay('none');
              }}
              // The second window is the natural "switch to" target, like Alt+Tab.
              {...((ordered.length > 1 ? i === 1 : i === 0) ? { 'data-nav-default': '' } : {})}
            >
              <AppIcon app={appDescriptor(w.appId)} />
              <div className="title">{w.title}</div>
              <div className="state">
                {w.id === focusedId ? 'Đang dùng' : w.mode === 'minimized' ? 'Đã thu nhỏ' : 'Đang mở'}
              </div>
            </button>
          ))}
        </div>
        <div className="btn-row switcher-actions">
          <button
            className="btn"
            onClick={() => {
              os.get().minimizeAll();
              os.get().setOverlay('none');
            }}
          >
            <Monitor /> Hiện màn hình chính
          </button>
          {focusedId && (
            <button
              className="btn danger"
              onClick={() => {
                os.get().closeWindow(focusedId);
              }}
            >
              <X /> Đóng cửa sổ hiện tại
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function NotificationItem({ n, compact }: { n: OsNotification; compact?: boolean }) {
  return (
    <div className={`notif ${n.level} ${compact ? 'toast' : ''}`}>
      <div className="notif-head">
        <span className="notif-title">{n.title}</span>
        <span className="notif-time">{timeAgo(n.time)}</span>
      </div>
      {n.body && <div className="notif-body">{n.body}</div>}
      {n.actions && n.actions.length > 0 && (
        <div className="btn-row notif-actions">
          {n.actions.map((a) => (
            <button
              key={a.label}
              className="btn"
              onClick={() => {
                a.run();
                os.get().removeNotification(n.id);
                os.get().setOverlay('none');
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotificationCenter() {
  const list = useOs((s) => s.notifications);
  const dnd = useOs((s) => s.dnd);
  const theme = useOs((s) => s.settings.theme);
  const motion = useOs((s) => s.settings.motion);
  useAutoFocus('[data-notif-center]');
  useEffect(() => {
    os.get().markAllRead();
  }, [list.length]);
  const s = os.get();
  return (
    <>
      <div className="overlay-backdrop" onClick={() => s.setOverlay('none')} />
      <div className="side-panel glass" data-nav-scope data-nav-trap data-notif-center>
        <div className="side-panel-header">
          <h2>Trung tâm điều khiển</h2>
          <button className="btn icon-only ghost" onClick={() => s.setOverlay('none')} title="Đóng">
            <X />
          </button>
        </div>
        <div className="quick-grid">
          <button className={`quick-tile ${dnd ? 'on' : ''}`} onClick={() => s.setDnd(!dnd)} data-nav-default>
            {dnd ? <BellOff /> : <Bell />} Không làm phiền
          </button>
          <button
            className={`quick-tile ${theme === 'light' ? 'on' : ''}`}
            onClick={() => s.updateSettings({ theme: theme === 'light' ? 'dark' : 'light' })}
          >
            {theme === 'light' ? <Sun /> : <Moon />} {theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối'}
          </button>
          <button
            className={`quick-tile ${motion === 'off' || motion === 'reduced' ? 'on' : ''}`}
            onClick={() => s.updateSettings({ motion: motion === 'reduced' || motion === 'off' ? 'auto' : 'reduced' })}
          >
            <Sparkles /> Giảm hiệu ứng
          </button>
          <button className="quick-tile" onClick={() => launch('settings')}>
            <Monitor /> Cài đặt
          </button>
        </div>
        <div className="side-panel-header" style={{ paddingTop: 0 }}>
          <h2 style={{ fontSize: '1.1rem' }}>Thông báo</h2>
          {list.length > 0 && (
            <button className="btn ghost" onClick={() => s.clearNotifications()}>
              <Trash2 /> Xóa hết
            </button>
          )}
        </div>
        <div className="notif-list">
          {list.length === 0 && <div className="muted">Không có thông báo.</div>}
          {list.map((n) => (
            <NotificationItem key={n.id} n={n} />
          ))}
        </div>
      </div>
    </>
  );
}

const TOAST_MS = 5000;

function Toast({ n }: { n: OsNotification }) {
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (n.sticky || n.actions?.length) return;
    timer.current = window.setTimeout(() => os.get().dismissToast(n.id), TOAST_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [n]);
  // Toasts with actions stay a little longer but still go away.
  useEffect(() => {
    if (!n.actions?.length) return;
    const t = window.setTimeout(() => os.get().dismissToast(n.id), TOAST_MS * 2);
    return () => clearTimeout(t);
  }, [n]);
  return <NotificationItem n={n} compact />;
}

export function Toasts() {
  const toasts = useOs((s) => s.toasts);
  const notifications = useOs((s) => s.notifications);
  const overlay = useOs((s) => s.overlay);
  if (overlay === 'notifications') return null;
  const items = toasts.map((id) => notifications.find((n) => n.id === id)).filter(Boolean) as OsNotification[];
  return (
    <div className="toasts" data-nav-skip>
      {items.map((n) => (
        <Toast key={n.id} n={n} />
      ))}
    </div>
  );
}
