import { Component, memo, Suspense, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Maximize2, Minimize2, Minus, PanelLeft, PanelRight, X } from 'lucide-react';
import { appDescriptor, builtinComponent } from '../os/apps';
import { clamp } from '../../common/format';
import { os } from '../os/store';
import type { Bounds, Snap, WindowInstance } from '../os/types';
import { AppIcon } from './AppIcon';

class AppErrorBoundary extends Component<{ children: ReactNode; onClose: () => void }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed', error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="app-empty">
          <h2>Ứng dụng gặp lỗi</h2>
          <p>{this.state.error.message}</p>
          <div className="btn-row" style={{ marginTop: '1.2rem' }}>
            <button className="btn" onClick={() => this.setState({ error: null })} data-nav-default>
              Thử lại
            </button>
            <button className="btn danger" onClick={this.props.onClose}>
              Đóng
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function geometry(win: WindowInstance): { left: string; top: string; width: string; height: string } {
  if (win.mode === 'maximized') return { left: '0', top: '0', width: '100%', height: '100%' };
  if (win.snap === 'left') return { left: '0', top: '0', width: '50%', height: '100%' };
  if (win.snap === 'right') return { left: '50%', top: '0', width: '50%', height: '100%' };
  const b = win.bounds;
  return { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` };
}

const MIN_W = 0.22;
const MIN_H = 0.25;

/** Edge zones (fraction of the work area) that snap a dragged window. */
function snapZone(px: number, py: number, area: DOMRect): Snap | 'max' | null {
  const fx = (px - area.left) / area.width;
  const fy = (py - area.top) / area.height;
  if (fy < 0.02) return 'max';
  if (fx < 0.015) return 'left';
  if (fx > 0.985) return 'right';
  return null;
}

function WindowFrameImpl({ win, focused, fullscreen }: { win: WindowInstance; focused: boolean; fullscreen: boolean }) {
  const app = appDescriptor(win.appId);
  const Content = builtinComponent(win.appId);
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Snap | 'max' | null>(null);

  const close = () => os.get().closeWindow(win.id);

  const startDrag = (e: React.MouseEvent, kind: 'move' | 'resize') => {
    if (e.button !== 0 || win.mode === 'maximized' && kind === 'resize') return;
    const target = e.target as HTMLElement;
    if (kind === 'move' && target.closest('button')) return;
    const area = ref.current?.parentElement?.getBoundingClientRect();
    if (!area) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    // Dragging a maximised/snapped window restores it under the pointer first.
    let base: Bounds = { ...win.bounds };
    if (kind === 'move' && (win.mode === 'maximized' || win.snap)) {
      const fx = (e.clientX - area.left) / area.width;
      base = { ...base, x: clamp(fx - base.w / 2, 0, 1 - base.w), y: 0 };
      os.get().setBounds(win.id, base);
      if (win.mode === 'maximized') os.get().toggleMaximize(win.id);
    }
    setDragging(true);
    let raf = 0;
    let last = start;
    let zone: Snap | 'max' | null = null;
    const apply = () => {
      raf = 0;
      const dx = (last.x - start.x) / area.width;
      const dy = (last.y - start.y) / area.height;
      if (kind === 'move') {
        os.get().setBounds(win.id, {
          ...base,
          x: clamp(base.x + dx, -base.w + 0.08, 0.92),
          y: clamp(base.y + dy, 0, 0.94),
        });
      } else {
        os.get().setBounds(win.id, {
          ...base,
          w: clamp(base.w + dx, MIN_W, 1 - base.x),
          h: clamp(base.h + dy, MIN_H, 1 - base.y),
        });
      }
    };
    const onMove = (ev: MouseEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (kind === 'move') {
        const z = snapZone(ev.clientX, ev.clientY, area);
        if (z !== zone) {
          zone = z;
          setPreview(z);
        }
      }
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (raf) cancelAnimationFrame(raf);
      apply();
      setDragging(false);
      setPreview(null);
      if (zone === 'max') os.get().toggleMaximize(win.id);
      else if (zone) os.get().snapWindow(win.id, zone);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const cls = ['window', win.mode, focused ? 'focused' : 'inactive', dragging ? 'dragging' : '', fullscreen ? 'fullscreen' : ''].join(' ');
  const geo = fullscreen ? { left: '0', top: '0', width: '100%', height: '100%' } : geometry(win);

  return (
    <>
      {preview && (
        <div
          className="snap-preview"
          style={
            preview === 'max'
              ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: win.z }
              : { left: preview === 'left' ? 0 : '50%', top: 0, width: '50%', height: '100%', zIndex: win.z }
          }
        />
      )}
      <div
        ref={ref}
        className={cls}
        style={{ ...geo, zIndex: win.z }}
        data-window={win.id}
        data-nav-scope
        {...(win.mode === 'minimized' ? { 'data-nav-hidden': '' } : {})}
        {...(!focused && win.mode !== 'minimized' ? { 'data-window-inactive': '' } : {})}
        onMouseDownCapture={() => {
          if (!focused) os.get().focusWindow(win.id);
        }}
        aria-hidden={win.mode === 'minimized'}
      >
        <div
          className="window-titlebar"
          onMouseDown={(e) => startDrag(e, 'move')}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest('button')) os.get().toggleMaximize(win.id);
          }}
        >
          <AppIcon app={app} />
          <div className="window-title">{win.title}</div>
          <div className="window-controls">
            <button className="wc-btn" title="Ghim trái" onClick={() => os.get().snapWindow(win.id, win.snap === 'left' ? null : 'left')}>
              <PanelLeft />
            </button>
            <button className="wc-btn" title="Ghim phải" onClick={() => os.get().snapWindow(win.id, win.snap === 'right' ? null : 'right')}>
              <PanelRight />
            </button>
            <button className="wc-btn" title="Thu nhỏ" onClick={() => os.get().minimizeWindow(win.id)}>
              <Minus />
            </button>
            <button className="wc-btn" title={win.mode === 'maximized' ? 'Khôi phục' : 'Phóng to'} onClick={() => os.get().toggleMaximize(win.id)}>
              {win.mode === 'maximized' ? <Minimize2 /> : <Maximize2 />}
            </button>
            <button className="wc-btn close" title="Đóng" onClick={close}>
              <X />
            </button>
          </div>
        </div>
        <div className="window-body" data-window-body data-nav-scope>
          <AppErrorBoundary onClose={close}>
            <Suspense
              fallback={
                <div className="window-loading">
                  <div className="spinner" />
                </div>
              }
            >
              {Content ? <Content win={win} /> : <div className="app-empty">Không có nội dung cho {win.appId}</div>}
            </Suspense>
          </AppErrorBoundary>
        </div>
        {win.mode === 'normal' && !win.snap && <div className="window-resize" onMouseDown={(e) => startDrag(e, 'resize')} />}
      </div>
    </>
  );
}

export const WindowFrame = memo(WindowFrameImpl);
