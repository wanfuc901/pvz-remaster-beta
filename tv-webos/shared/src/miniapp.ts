/**
 * Mini-app manifest format (tvwebos.json / manifest.json).
 *
 * Kept free of runtime dependencies so both the server (catalog) and the TV
 * client (install from URL) can validate manifests the same way.
 */

export const MINIAPP_PERMISSIONS = ['storage', 'notifications', 'gamepad', 'pointer', 'text-input'] as const;
export type MiniAppPermission = (typeof MINIAPP_PERMISSIONS)[number];

export const MINIAPP_CATEGORIES = ['games', 'tools', 'media', 'productivity', 'other'] as const;
export type MiniAppCategory = (typeof MINIAPP_CATEGORIES)[number];

export interface MiniAppManifest {
  /** Reverse-DNS id, e.g. "org.tvwebos.snake". */
  id: string;
  name: string;
  /** Semantic version "major.minor.patch". */
  version: string;
  description: string;
  author: string;
  /** URL of the HTML entry, relative to the manifest URL. */
  entry: string;
  /** URL of an icon (SVG or PNG), relative to the manifest URL. */
  icon?: string;
  /** Tile background colour (#rrggbb). */
  color?: string;
  category: MiniAppCategory;
  permissions: MiniAppPermission[];
  /** Minimum host API version this app needs. */
  minApi?: number;
}

/** Host SDK API version exposed to mini-apps. */
export const MINIAPP_API_VERSION = 1;

export type ManifestResult = { ok: true; manifest: MiniAppManifest } | { ok: false; error: string };

const ID_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,6}$/;
const VERSION_RE = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** Validate an untrusted manifest object. Unknown keys are dropped. */
export function validateManifest(input: unknown): ManifestResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Manifest must be a JSON object' };
  const m = input as Record<string, unknown>;
  if (!isStr(m.id, 128) || !ID_RE.test(m.id)) return { ok: false, error: 'id must be reverse-DNS, e.g. org.example.app' };
  if (!isStr(m.name, 48)) return { ok: false, error: 'name is required (max 48 chars)' };
  if (!isStr(m.version, 20) || !VERSION_RE.test(m.version)) return { ok: false, error: 'version must look like 1.2.3' };
  if (!isStr(m.entry, 512)) return { ok: false, error: 'entry is required' };
  if (/^\s*(javascript|data|vbscript):/i.test(m.entry)) return { ok: false, error: 'entry must be an http(s) or relative URL' };
  if (m.icon !== undefined && (!isStr(m.icon, 512) || /^\s*(javascript|vbscript):/i.test(m.icon))) {
    return { ok: false, error: 'icon must be a URL' };
  }
  if (m.color !== undefined && (typeof m.color !== 'string' || !COLOR_RE.test(m.color))) {
    return { ok: false, error: 'color must be #rrggbb' };
  }
  const permissions = m.permissions === undefined ? [] : m.permissions;
  if (!Array.isArray(permissions) || permissions.some((p) => !(MINIAPP_PERMISSIONS as readonly string[]).includes(p))) {
    return { ok: false, error: `permissions must be a subset of: ${MINIAPP_PERMISSIONS.join(', ')}` };
  }
  const category = m.category === undefined ? 'other' : m.category;
  if (!(MINIAPP_CATEGORIES as readonly unknown[]).includes(category)) {
    return { ok: false, error: `category must be one of: ${MINIAPP_CATEGORIES.join(', ')}` };
  }
  if (m.minApi !== undefined && (typeof m.minApi !== 'number' || !Number.isInteger(m.minApi))) {
    return { ok: false, error: 'minApi must be an integer' };
  }
  if (typeof m.minApi === 'number' && m.minApi > MINIAPP_API_VERSION) {
    return { ok: false, error: `This app needs host API ${m.minApi}, this TV WebOS provides ${MINIAPP_API_VERSION}` };
  }
  return {
    ok: true,
    manifest: {
      id: m.id,
      name: m.name,
      version: m.version,
      description: typeof m.description === 'string' ? m.description.slice(0, 500) : '',
      author: typeof m.author === 'string' ? m.author.slice(0, 100) : '',
      entry: m.entry,
      icon: m.icon as string | undefined,
      color: m.color as string | undefined,
      category: category as MiniAppCategory,
      permissions: [...new Set(permissions as MiniAppPermission[])],
      minApi: m.minApi as number | undefined,
    },
  };
}

/** Compare two "a.b.c" versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}
