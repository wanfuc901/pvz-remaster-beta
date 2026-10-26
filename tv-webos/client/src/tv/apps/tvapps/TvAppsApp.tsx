import { useState } from 'react';
import { Play, Plus, Trash2, Tv } from 'lucide-react';
import { launch } from '../../os/apps';
import { saveTvApps } from '../../os/miniapps';
import { os, useOs } from '../../os/store';
import { uid } from '../../../common/format';
import type { WindowProps } from '../../os/types';
import { platformCaps } from '../../TvApp';
import { describeMode } from '../../platform/webos';
import { AppModal } from '../common';

const COLORS = ['#0ea5e9', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

/**
 * Only this id is pre-filled because it appears in LG's own Application
 * Manager documentation. Ids of other installed apps differ per app/model
 * and must be entered by the user.
 */
const PRESETS = [{ name: 'Trình duyệt web của TV', webosAppId: 'com.webos.app.browser' }];

export default function TvAppsApp({ win }: WindowProps) {
  const apps = useOs((s) => s.tvApps);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [appId, setAppId] = useState('');
  const caps = platformCaps;
  const can = !!caps?.launchApps;

  const add = async (n: string, id: string) => {
    if (!n.trim() || !/^[a-zA-Z0-9._-]{1,128}$/.test(id.trim())) return;
    await saveTvApps([...apps, { id: uid(), name: n.trim(), webosAppId: id.trim(), color: COLORS[apps.length % COLORS.length] }]);
    os.get().notify({ title: `Đã thêm lối tắt ${n.trim()}`, level: 'success' });
  };

  return (
    <div className="app" style={{ position: 'relative' }}>
      <div className="app-toolbar">
        <div className="grow" style={{ fontWeight: 600 }}>
          Lối tắt tới ứng dụng đã cài trên TV
        </div>
        <button className="btn primary" onClick={() => setAdding(true)} data-nav-default>
          <Plus /> Thêm lối tắt
        </button>
      </div>
      <div className="app-content" data-nav-scope>
        <div className="info-box" style={{ marginBottom: '1.2rem' }}>
          <div>
            <strong>Chế độ hiện tại:</strong> {caps ? describeMode(caps.mode) : 'đang kiểm tra...'}
          </div>
          {can ? (
            <div style={{ marginTop: '0.4rem' }}>
              Lối tắt mở ứng dụng bằng API chính thức <code>luna://com.webos.applicationManager/launch</code>. Nếu TV từ
              chối (sai ID hoặc thiếu quyền), lỗi sẽ được báo lại.
            </div>
          ) : (
            <div style={{ marginTop: '0.4rem' }}>
              Trang web chạy trong trình duyệt không được phép mở ứng dụng khác trên TV. Hãy cài TV WebOS dưới dạng ứng dụng
              webOS (xem docs/WEBOS.md) để dùng lối tắt. Bạn vẫn có thể tạo lối tắt trước.
            </div>
          )}
          <div style={{ marginTop: '0.4rem' }}>
            Không có API công khai để liệt kê ứng dụng đã cài, nên ID ứng dụng cần được nhập thủ công.
          </div>
        </div>
        {!apps.length && <div className="muted">Chưa có lối tắt nào.</div>}
        <div className="bookmark-grid">
          {apps.map((a) => (
            <div key={a.id} className="bookmark" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <div className="app-glyph" style={{ background: a.color }}>
                  <Tv />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="t">{a.name}</div>
                  <div className="u">{a.webosAppId}</div>
                </div>
              </div>
              <div className="btn-row">
                <button className="btn icon-only" title="Mở" disabled={!can} onClick={() => launch(`tvapp:${a.id}`)}>
                  <Play />
                </button>
                <button className="btn icon-only" title="Xóa" onClick={() => void saveTvApps(apps.filter((x) => x.id !== a.id))}>
                  <Trash2 />
                </button>
              </div>
            </div>
          ))}
        </div>
        <h3 style={{ margin: '1.6rem 0 0.6rem' }}>Gợi ý</h3>
        <div className="btn-row">
          {PRESETS.filter((p) => !apps.some((a) => a.webosAppId === p.webosAppId)).map((p) => (
            <button key={p.webosAppId} className="btn" onClick={() => void add(p.name, p.webosAppId)}>
              <Plus /> {p.name}
            </button>
          ))}
        </div>
      </div>
      {adding && (
        <AppModal
          windowId={win.id}
          title="Thêm lối tắt ứng dụng TV"
          onClose={() => setAdding(false)}
          actions={[
            { label: 'Hủy', run: () => setAdding(false) },
            {
              label: 'Thêm',
              primary: true,
              disabled: !name.trim() || !/^[a-zA-Z0-9._-]{1,128}$/.test(appId.trim()),
              run: () => {
                void add(name, appId);
                setAdding(false);
                setName('');
                setAppId('');
              },
            },
          ]}
        >
          <input className="text-input" style={{ width: '100%', marginBottom: '0.8rem' }} placeholder="Tên hiển thị" value={name} onChange={(e) => setName(e.target.value)} data-nav-default />
          <input className="text-input" style={{ width: '100%' }} placeholder="ID ứng dụng webOS (ví dụ com.webos.app.browser)" value={appId} onChange={(e) => setAppId(e.target.value)} />
        </AppModal>
      )}
    </div>
  );
}
