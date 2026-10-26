import { Bell, BellOff, LayoutGrid, QrCode, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { appDescriptor, launch } from '../os/apps';
import { runCommand } from '../os/shell';
import { os, useOs } from '../os/store';
import { AppIcon } from './AppIcon';
import { ClockText, formatLongDate, useNow } from './Clock';

function ConnectionTray() {
  const status = useOs((s) => s.link.status);
  const latency = useOs((s) => s.link.latencyMs);
  const online = status === 'online';
  const label =
    status === 'online'
      ? `Đã kết nối server${latency !== null ? ` (${latency} ms)` : ''}`
      : status === 'connecting'
        ? 'Đang kết nối server...'
        : 'Mất kết nối server';
  return (
    <button
      className={`tray-btn ${online ? '' : status === 'connecting' ? 'warn' : 'bad'}`}
      title={label}
      onClick={() => launch('settings', { page: 'network' })}
    >
      {online ? <Wifi /> : <WifiOff />}
    </button>
  );
}

function RemotesTray() {
  const remotes = useOs((s) => s.link.remotes);
  const online = remotes.filter((r) => r.online).length;
  return (
    <button className="tray-btn" title="Ghép nối điện thoại" onClick={() => runCommand('pairing')}>
      {online ? <Smartphone /> : <QrCode />}
      <span>{online ? online : 'Ghép nối'}</span>
    </button>
  );
}

function NotifTray() {
  const unread = useOs((s) => s.notifications.filter((n) => !n.read).length);
  const dnd = useOs((s) => s.dnd);
  return (
    <button className="tray-btn" title="Thông báo" onClick={() => runCommand('notifications')}>
      {dnd ? <BellOff /> : <Bell />}
      {unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

function DateText() {
  const now = useNow(60_000);
  return <span className="d">{formatLongDate(now).replace(/, \d{4}$/, '')}</span>;
}

export function Taskbar() {
  const pinned = useOs((s) => s.pinned);
  const windows = useOs((s) => s.windows);
  const focusedId = useOs((s) => s.focusedId);
  const overlay = useOs((s) => s.overlay);
  useOs((s) => s.miniapps);

  // Pinned apps first, then running apps that are not pinned.
  const running = new Map<string, string[]>();
  for (const w of windows) running.set(w.appId, [...(running.get(w.appId) ?? []), w.id]);
  const ids = [...pinned.filter((id) => appDescriptor(id)), ...[...running.keys()].filter((id) => !pinned.includes(id))];
  const focusedApp = windows.find((w) => w.id === focusedId)?.appId;

  const onItem = (appId: string) => {
    const wins = running.get(appId);
    const s = os.get();
    if (!wins?.length) {
      launch(appId);
      return;
    }
    // Clicking the focused app minimises it; otherwise bring its topmost window forward (cycling).
    const ordered = s.windows.filter((w) => wins.includes(w.id)).sort((a, b) => b.z - a.z);
    const top = ordered[0];
    if (top.id === s.focusedId && top.mode !== 'minimized') {
      if (ordered.length > 1) s.focusWindow(ordered[ordered.length - 1].id);
      else s.minimizeWindow(top.id);
    } else {
      s.focusWindow(top.id);
    }
    s.setOverlay('none');
  };

  return (
    <div className="taskbar" data-taskbar data-nav-scope>
      <div className="taskbar-side">
        <ConnectionTray />
        <RemotesTray />
      </div>
      <div className="taskbar-center">
        <button
          className={`tb-item tb-start ${overlay === 'launcher' ? 'active' : ''}`}
          title="Ứng dụng"
          onClick={() => runCommand('launcher')}
        >
          <LayoutGrid strokeWidth={1.8} />
        </button>
        <div className="tb-sep" />
        {ids.map((id) => {
          const app = appDescriptor(id);
          if (!app) return null;
          const isRunning = running.has(id);
          return (
            <button
              key={id}
              className={`tb-item ${isRunning ? 'running' : ''} ${focusedApp === id ? 'active' : ''}`}
              title={app.name}
              onClick={() => onItem(id)}
            >
              <AppIcon app={app} />
              {isRunning && <span className="dot" />}
            </button>
          );
        })}
      </div>
      <div className="taskbar-side right">
        <NotifTray />
        <button className="tray-btn tray-clock" onClick={() => runCommand('notifications')}>
          <ClockText className="t" />
          <DateText />
        </button>
      </div>
    </div>
  );
}
