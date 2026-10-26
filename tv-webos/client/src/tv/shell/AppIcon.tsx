import { useState, type CSSProperties } from 'react';
import type { AppDescriptor } from '../os/types';
import { FallbackGlyph } from '../os/apps';

/** Rounded app glyph: built-in icon, mini-app image, or the first letter as a fallback. */
export function AppIcon({ app, size, style }: { app: AppDescriptor | null; size?: string; style?: CSSProperties }) {
  const [broken, setBroken] = useState(false);
  const s: CSSProperties = { background: app?.color ?? '#334155', ...(size ? { width: size, height: size } : {}), ...style };
  let content;
  if (!app) content = <FallbackGlyph />;
  else if (app.iconUrl && !broken) content = <img src={app.iconUrl} alt="" onError={() => setBroken(true)} />;
  else if (app.glyph) content = app.glyph;
  else content = <span className="letter">{app.name.slice(0, 1).toUpperCase()}</span>;
  return (
    <div className="app-glyph" style={s}>
      {content}
    </div>
  );
}
