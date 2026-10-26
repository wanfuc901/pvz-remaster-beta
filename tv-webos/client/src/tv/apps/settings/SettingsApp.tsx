import { useEffect, useState } from 'react';
import { Info, Monitor, Palette, Server, ShieldCheck, Smartphone } from 'lucide-react';
import { formatBytes, timeAgo } from '../../../common/format';
import { idb } from '../../../common/idb';
import { normalizeServerUrl, setServerBase } from '../../../common/server';
import { reconnectLink, sendToServer } from '../../os/link';
import { runCommand } from '../../os/shell';
import { DEFAULT_SETTINGS, os, useOs } from '../../os/store';
import type { WindowProps } from '../../os/types';
import { platformCaps } from '../../TvApp';
import { describeMode, getDeviceInfo, type DeviceInfo } from '../../platform/webos';
import { AppModal, PromptModal, Segmented, SettingRow, Switch } from '../common';

type Page = 'appearance' | 'devices' | 'network' | 'system' | 'about';

const ACCENTS = ['#4f8cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6'];
const WALLPAPERS: Array<{ id: string; name: string }> = [
  { id: 'aurora', name: 'Cực quang' },
  { id: 'ocean', name: 'Đại dương' },
  { id: 'sunset', name: 'Hoàng hôn' },
  { id: 'forest', name: 'Rừng' },
  { id: 'graphite', name: 'Than chì' },
  { id: 'daylight', name: 'Ban ngày' },
];

function Appearance() {
  const s = useOs((st) => st.settings);
  const update = os.get().updateSettings;
  return (
    <div className="settings-section">
      <h2>Giao diện</h2>
      <SettingRow label="Chủ đề">
        <Segmented
          value={s.theme}
          options={[
            { value: 'dark', label: 'Tối' },
            { value: 'light', label: 'Sáng' },
          ]}
          onChange={(theme) => update({ theme })}
        />
      </SettingRow>
      <SettingRow label="Màu nhấn">
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button key={c} className={`swatch ${s.accent === c ? 'active' : ''}`} style={{ background: c }} onClick={() => update({ accent: c })} aria-label={c} />
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Hình nền">
        <div className="wallpaper-grid">
          {WALLPAPERS.map((w) => (
            <button key={w.id} className={`wp-thumb wallpaper wp-${w.id} ${s.wallpaper === w.id ? 'active' : ''}`} style={{ position: 'relative' }} title={w.name} onClick={() => update({ wallpaper: w.id })} />
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Hiệu ứng" desc="Tự động giảm hiệu ứng trên TV cấu hình thấp hoặc trình duyệt cũ. Tắt hẳn để mượt nhất.">
        <Segmented
          value={s.motion}
          options={[
            { value: 'auto', label: 'Tự động' },
            { value: 'full', label: 'Đầy đủ' },
            { value: 'reduced', label: 'Giảm' },
            { value: 'off', label: 'Tắt' },
          ]}
          onChange={(motion) => update({ motion })}
        />
      </SettingRow>
      <SettingRow label="Cỡ giao diện">
        <Segmented
          value={s.scale}
          options={[
            { value: 0.85, label: 'Nhỏ' },
            { value: 1, label: 'Vừa' },
            { value: 1.15, label: 'Lớn' },
            { value: 1.3, label: 'Rất lớn' },
          ]}
          onChange={(scale) => update({ scale })}
        />
      </SettingRow>
      <SettingRow label="Vùng an toàn (overscan)" desc="Thu nhỏ vùng hiển thị nếu mép màn hình bị TV cắt mất.">
        <Segmented
          value={s.safeArea}
          options={[
            { value: 0, label: '0%' },
            { value: 2.5, label: '2,5%' },
            { value: 5, label: '5%' },
          ]}
          onChange={(safeArea) => update({ safeArea })}
        />
      </SettingRow>
      <SettingRow label="Đồng hồ 24 giờ">
        <Switch on={s.clock24h} onChange={(clock24h) => update({ clock24h })} label="Đồng hồ 24 giờ" />
      </SettingRow>
      <SettingRow label="Hiện giây trên đồng hồ">
        <Switch on={s.showSeconds} onChange={(showSeconds) => update({ showSeconds })} label="Hiện giây" />
      </SettingRow>
    </div>
  );
}

function Devices({ windowId }: { windowId: string }) {
  const remotes = useOs((s) => s.link.remotes);
  const server = useOs((s) => s.link.serverSettings);
  const autoKb = useOs((s) => s.settings.remoteAutoKeyboard);
  const [revoke, setRevoke] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="settings-section">
      <h2>Điện thoại điều khiển</h2>
      <SettingRow label="Ghép nối điện thoại mới" desc="Hiện mã QR và mã 6 số (phím xanh dương trên remote).">
        <button className="btn primary" onClick={() => runCommand('pairing')}>
          Hiện mã QR
        </button>
      </SettingRow>
      <SettingRow
        label="Xác nhận trên TV khi quét QR"
        desc="Khuyến nghị bật. Ghép nối bằng mã 6 số luôn cần xác nhận, bất kể tùy chọn này."
      >
        <Switch on={server?.requireConfirm ?? true} onChange={(v) => sendToServer({ t: 'tv.settings', settings: { requireConfirm: v } })} label="Xác nhận" />
      </SettingRow>
      <SettingRow label="Số điện thoại tối đa">
        <Segmented
          value={server?.maxRemotes ?? 4}
          options={[1, 2, 4, 8].map((n) => ({ value: n, label: String(n) }))}
          onChange={(n) => sendToServer({ t: 'tv.settings', settings: { maxRemotes: n } })}
        />
      </SettingRow>
      <SettingRow label="Tự mở bàn phím trên điện thoại" desc="Khi một ô nhập liệu trên TV được chọn.">
        <Switch on={autoKb} onChange={(v) => os.get().updateSettings({ remoteAutoKeyboard: v })} label="Tự mở bàn phím" />
      </SettingRow>
      <h2 style={{ marginTop: '1.6rem' }}>Thiết bị đã ghép nối</h2>
      {remotes.length === 0 && <p className="muted">Chưa có thiết bị nào.</p>}
      {remotes.map((r) => (
        <SettingRow
          key={r.id}
          label={r.name}
          desc={`${r.platform || 'Không rõ'} · ${r.online ? 'đang kết nối' : `dùng lần cuối ${timeAgo(r.lastSeenAt)}`} · ghép nối ${timeAgo(r.createdAt)}`}
        >
          <button className="btn danger" onClick={() => setRevoke({ id: r.id, name: r.name })}>
            Gỡ ghép nối
          </button>
        </SettingRow>
      ))}
      {revoke && (
        <AppModal
          windowId={windowId}
          title={`Gỡ "${revoke.name}"?`}
          onClose={() => setRevoke(null)}
          actions={[
            { label: 'Hủy', run: () => setRevoke(null) },
            {
              label: 'Gỡ ghép nối',
              danger: true,
              run: () => {
                sendToServer({ t: 'tv.remote.revoke', remoteId: revoke.id });
                setRevoke(null);
              },
            },
          ]}
        >
          <p className="muted">Thiết bị sẽ bị ngắt ngay và phải quét lại mã QR để điều khiển.</p>
        </AppModal>
      )}
    </div>
  );
}

function Network({ windowId }: { windowId: string }) {
  const link = useOs((s) => s.link);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState('');
  const statusText: Record<string, string> = {
    online: 'Đã kết nối',
    connecting: 'Đang kết nối',
    offline: 'Mất kết nối, đang thử lại',
    replaced: 'Phiên bị thay thế bởi cửa sổ khác',
    idle: 'Chưa kết nối',
    'no-server': 'Chưa cấu hình',
  };
  return (
    <div className="settings-section">
      <h2>Server và mạng</h2>
      <SettingRow label="Địa chỉ server" desc={link.serverBase ?? 'Chưa cấu hình'}>
        <button className="btn" onClick={() => setEditing(true)}>
          Đổi
        </button>
      </SettingRow>
      <SettingRow label="Trạng thái" desc={link.latencyMs !== null ? `Độ trễ ${link.latencyMs} ms` : undefined}>
        <span style={{ marginRight: '1rem', fontWeight: 600 }}>{statusText[link.status]}</span>
        <button className="btn" onClick={() => reconnectLink()}>
          Kết nối lại
        </button>
      </SettingRow>
      <SettingRow label="Mã TV" desc="Định danh của TV này trên server">
        <span className="muted small">{link.deviceId ?? '-'}</span>
      </SettingRow>
      {err && <div className="error-box">{err}</div>}
      {editing && (
        <PromptModal
          windowId={windowId}
          title="Địa chỉ server TV WebOS"
          initial={link.serverBase ?? ''}
          placeholder="192.168.1.10:8686"
          confirmLabel="Lưu và tải lại"
          onClose={() => setEditing(false)}
          onSubmit={(v) => {
            const n = normalizeServerUrl(v);
            if (!n) {
              setErr('Địa chỉ không hợp lệ');
              return;
            }
            setServerBase(n);
            location.reload();
          }}
        />
      )}
    </div>
  );
}

function System({ windowId }: { windowId: string }) {
  const name = useOs((s) => s.link.tvName || s.settings.deviceName);
  const restore = useOs((s) => s.settings.restoreSession);
  const [renaming, setRenaming] = useState(false);
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [infoErr, setInfoErr] = useState('');
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [reset, setReset] = useState(false);
  const caps = platformCaps;

  useEffect(() => {
    if (caps?.deviceInfo) getDeviceInfo().then(setInfo, (e: Error) => setInfoErr(e.message));
    void idb.estimate().then(setStorage);
  }, [caps]);

  return (
    <div className="settings-section">
      <h2>Hệ thống</h2>
      <SettingRow label="Tên TV" desc="Hiển thị trên điện thoại khi ghép nối.">
        <span style={{ marginRight: '1rem', fontWeight: 600 }}>{name}</span>
        <button className="btn" onClick={() => setRenaming(true)}>
          Đổi tên
        </button>
      </SettingRow>
      <SettingRow label="Khôi phục phiên làm việc" desc="Mở lại các cửa sổ đang dùng khi khởi động.">
        <Switch on={restore} onChange={(v) => os.get().updateSettings({ restoreSession: v })} label="Khôi phục phiên" />
      </SettingRow>
      <SettingRow label="Bộ nhớ trình duyệt" desc="Ứng dụng đã cài, tệp lưu trên TV, dữ liệu mini-app.">
        <span className="muted">{storage ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}` : 'Không rõ'}</span>
      </SettingRow>
      <SettingRow label="Khôi phục cài đặt giao diện">
        <button className="btn danger" onClick={() => setReset(true)}>
          Đặt lại
        </button>
      </SettingRow>

      <h2 style={{ marginTop: '1.6rem' }}>Nền tảng</h2>
      <table className="kv-table">
        <tbody>
          <tr>
            <td>Chế độ chạy</td>
            <td>{caps ? describeMode(caps.mode) : '-'}</td>
          </tr>
          <tr>
            <td>Mở ứng dụng TV</td>
            <td>{caps?.launchApps ? 'Có (API applicationManager)' : 'Không'}</td>
          </tr>
          <tr>
            <td>User agent</td>
            <td style={{ wordBreak: 'break-all' }}>{navigator.userAgent}</td>
          </tr>
          <tr>
            <td>Độ phân giải CSS</td>
            <td>
              {window.innerWidth} x {window.innerHeight} (tỉ lệ điểm ảnh {window.devicePixelRatio})
            </td>
          </tr>
          {info &&
            Object.entries(info).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{String(v)}</td>
              </tr>
            ))}
          {infoErr && (
            <tr>
              <td>Thông tin thiết bị</td>
              <td>{infoErr}</td>
            </tr>
          )}
        </tbody>
      </table>

      {renaming && (
        <PromptModal
          windowId={windowId}
          title="Tên TV"
          initial={name}
          confirmLabel="Lưu"
          onClose={() => setRenaming(false)}
          onSubmit={(v) => {
            sendToServer({ t: 'tv.rename', name: v.slice(0, 64) });
            os.get().updateSettings({ deviceName: v.slice(0, 64) });
            os.get().setLink({ tvName: v.slice(0, 64) });
            setRenaming(false);
          }}
        />
      )}
      {reset && (
        <AppModal
          windowId={windowId}
          title="Đặt lại cài đặt giao diện?"
          onClose={() => setReset(false)}
          actions={[
            { label: 'Hủy', run: () => setReset(false) },
            {
              label: 'Đặt lại',
              danger: true,
              run: () => {
                os.get().updateSettings({ ...DEFAULT_SETTINGS, deviceName: os.get().settings.deviceName });
                setReset(false);
              },
            },
          ]}
        >
          <p className="muted">Thiết bị đã ghép nối và ứng dụng đã cài không bị ảnh hưởng.</p>
        </AppModal>
      )}
    </div>
  );
}

function About() {
  return (
    <div className="settings-section">
      <h2>Giới thiệu và giới hạn</h2>
      <p className="muted" style={{ lineHeight: 1.6, marginBottom: '1rem' }}>
        TV WebOS là môi trường desktop chạy trên trình duyệt của Smart TV, điều khiển bằng remote TV hoặc điện thoại. Nó
        không thay thế hệ điều hành của TV và chỉ dùng các quyền mà trình duyệt hoặc API webOS chính thức cho phép.
      </p>
      <div className="info-box">
        <strong>Những việc trang web không làm được</strong>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          <li>Đổi âm lượng hệ thống, nguồn vào (HDMI), kênh TV, tắt/bật TV.</li>
          <li>Nhận nút Home của remote (TV luôn xử lý nút này).</li>
          <li>Đọc tệp trên USB/bộ nhớ của TV; TV WebOS dùng thư viện media trên server và bộ nhớ của trình duyệt.</li>
          <li>Mở ứng dụng TV khác khi chạy trong trình duyệt; cần cài bản ứng dụng webOS (xem docs/WEBOS.md).</li>
          <li>Điều khiển nội dung trong trang web nhúng của bên thứ ba bằng con trỏ ảo (dùng Magic Remote thay thế).</li>
          <li>Ngăn TV tự bật bảo vệ màn hình hay tắt khi không thao tác.</li>
        </ul>
      </div>
    </div>
  );
}

const PAGES: Array<{ id: Page; label: string; icon: typeof Palette }> = [
  { id: 'appearance', label: 'Giao diện', icon: Palette },
  { id: 'devices', label: 'Điện thoại', icon: Smartphone },
  { id: 'network', label: 'Server và mạng', icon: Server },
  { id: 'system', label: 'Hệ thống', icon: Monitor },
  { id: 'about', label: 'Giới hạn', icon: ShieldCheck },
];

export default function SettingsApp({ win }: WindowProps) {
  const [page, setPage] = useState<Page>((win.args.page as Page) || 'appearance');
  useEffect(() => {
    if (win.args._nonce && win.args.page) setPage(win.args.page as Page);
  }, [win.args]);
  return (
    <div className="app-split">
      <div className="app-sidebar" data-nav-scope>
        {PAGES.map((p) => (
          <button key={p.id} className={`side-item ${page === p.id ? 'active' : ''}`} onClick={() => setPage(p.id)} {...(page === p.id ? { 'data-nav-default': '' } : {})}>
            <p.icon /> {p.label}
          </button>
        ))}
        <div className="side-label" style={{ marginTop: '2rem' }}>
          <Info style={{ display: 'inline', width: '0.9rem', height: '0.9rem', verticalAlign: '-0.1rem' }} /> TV WebOS 0.1.0
        </div>
      </div>
      <div className="app-content" data-nav-scope>
        {page === 'appearance' && <Appearance />}
        {page === 'devices' && <Devices windowId={win.id} />}
        {page === 'network' && <Network windowId={win.id} />}
        {page === 'system' && <System windowId={win.id} />}
        {page === 'about' && <About />}
      </div>
    </div>
  );
}
