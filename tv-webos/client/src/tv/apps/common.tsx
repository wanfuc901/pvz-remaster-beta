/** Small building blocks shared by built-in apps. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { addBackHandler } from '../os/bus';
import { focusScope } from '../os/spatialNav';
import { useOs } from '../os/store';

/** Register a Back handler for as long as the component is mounted. */
export function useBack(windowId: string, handler: () => boolean): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => addBackHandler(windowId, () => ref.current()), [windowId]);
}

/** True while this window is the focused one. */
export function useWindowFocused(windowId: string): boolean {
  return useOs((s) => s.focusedId === windowId);
}

/** Run an async loader and expose loading / error / data. Re-runs when `deps` change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (err: Error) => alive && setState({ data: null, error: err.message || String(err), loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

interface ModalProps {
  windowId: string;
  title: string;
  children?: ReactNode;
  onClose: () => void;
  actions: Array<{ label: string; primary?: boolean; danger?: boolean; run: () => void; disabled?: boolean }>;
}

/** Modal inside a window; traps D-pad focus and closes on Back. */
export function AppModal({ windowId, title, children, onClose, actions }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useBack(windowId, () => {
    onClose();
    return true;
  });
  useEffect(() => {
    const t = setTimeout(() => focusScope(ref.current), 0);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="app-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="app-modal" ref={ref} data-nav-scope data-nav-trap>
        <h3>{title}</h3>
        {children}
        <div className="btn-row">
          {actions.map((a, i) => (
            <button
              key={a.label}
              className={`btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`}
              onClick={a.run}
              disabled={a.disabled}
              {...(i === actions.length - 1 && !children ? { 'data-nav-default': '' } : {})}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Modal with one text field. */
export function PromptModal(props: {
  windowId: string;
  title: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial ?? '');
  const submit = () => {
    if (value.trim()) props.onSubmit(value.trim());
  };
  return (
    <AppModal
      windowId={props.windowId}
      title={props.title}
      onClose={props.onClose}
      actions={[
        { label: 'Hủy', run: props.onClose },
        { label: props.confirmLabel ?? 'OK', primary: true, run: submit, disabled: !value.trim() },
      ]}
    >
      <input
        className="text-input"
        value={value}
        placeholder={props.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        data-nav-default
      />
    </AppModal>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function SettingRow({ label, desc, children }: { label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="label">{label}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}
