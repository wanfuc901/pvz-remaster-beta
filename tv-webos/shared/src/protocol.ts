/**
 * Wire protocol between TV, server and remote.
 *
 * Every frame is a JSON object with a `t` (type) discriminator. The schemas
 * below are the single source of truth: the server validates every incoming
 * frame with them, and the clients use the inferred types (type-only import,
 * so zod is not shipped to browsers).
 */
import { z } from 'zod';
import { MEDIA_COMMANDS, NAV_KEYS, SHELL_COMMANDS } from './constants.js';

const id = z.string().min(1).max(128);
const shortText = z.string().max(256);
const finite = z.number().finite();
const delta = finite.min(-5000).max(5000);

// ---------------------------------------------------------------------------
// Input events (remote -> server -> TV)
// ---------------------------------------------------------------------------

export const InputEventSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('move'), dx: delta, dy: delta }),
  z.object({
    k: z.literal('button'),
    b: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    a: z.enum(['down', 'up', 'click', 'dblclick']),
  }),
  z.object({ k: z.literal('scroll'), dx: delta, dy: delta }),
  z.object({ k: z.literal('key'), key: z.enum(NAV_KEYS), a: z.enum(['down', 'up', 'press']) }),
  /** `set` replaces the focused field's value; `submit` presses Enter in it. */
  z.object({ k: z.literal('text'), op: z.enum(['set', 'submit']), value: z.string().max(10_000).optional() }),
  z.object({
    k: z.literal('gamepad'),
    buttons: z.number().int().min(0).max(0xffff),
    axes: z.array(finite.min(-1).max(1)).max(4),
  }),
  z.object({ k: z.literal('command'), cmd: z.enum(SHELL_COMMANDS), arg: shortText.optional() }),
  z.object({ k: z.literal('media'), cmd: z.enum(MEDIA_COMMANDS), value: finite.optional() }),
]);
export type InputEvent = z.infer<typeof InputEventSchema>;

// ---------------------------------------------------------------------------
// Shared data shapes
// ---------------------------------------------------------------------------

export const RemoteInfoSchema = z.object({
  id,
  name: shortText,
  platform: shortText,
  createdAt: z.number(),
  lastSeenAt: z.number(),
  online: z.boolean(),
});
export type RemoteInfo = z.infer<typeof RemoteInfoSchema>;

export const TvSettingsSchema = z.object({
  /** Require on-screen confirmation for QR pairing. Manual code pairing always requires it. */
  requireConfirm: z.boolean(),
  maxRemotes: z.number().int().min(1).max(16),
});
export type TvSettings = z.infer<typeof TvSettingsSchema>;

const WindowStateSchema = z.object({
  id,
  appId: id,
  title: shortText,
  state: z.enum(['normal', 'minimized', 'maximized']),
  focused: z.boolean(),
});

const AppEntrySchema = z.object({ id, name: shortText, kind: z.enum(['builtin', 'miniapp', 'tvapp']) });

const TextFocusSchema = z.object({
  value: z.string().max(10_000),
  inputType: z.string().max(32),
  placeholder: shortText,
  multiline: z.boolean(),
});

const MediaStateSchema = z.object({
  title: shortText,
  kind: z.enum(['video', 'audio']),
  playing: z.boolean(),
  time: finite,
  duration: finite,
  volume: finite,
  muted: z.boolean(),
});

/** Snapshot of the TV shell that remotes mirror. */
export const TvStateSchema = z.object({
  windows: z.array(WindowStateSchema).max(64),
  apps: z.array(AppEntrySchema).max(256),
  text: TextFocusSchema.nullable(),
  media: MediaStateSchema.nullable(),
  overlay: z.enum(['none', 'launcher', 'switcher', 'notifications', 'pairing', 'dialog']),
  /** Whether the focused app wants raw gamepad input. */
  gamepadApp: z.boolean(),
});
export type TvState = z.infer<typeof TvStateSchema>;
export type TvWindowState = z.infer<typeof WindowStateSchema>;
export type TvAppEntry = z.infer<typeof AppEntrySchema>;
export type TvMediaState = z.infer<typeof MediaStateSchema>;
export type TvTextFocus = z.infer<typeof TextFocusSchema>;

/** Small one-off events from the TV to remotes. */
export const TvEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('haptic'), pattern: z.array(z.number().int().min(0).max(1000)).max(8) }),
  z.object({ type: z.literal('toast'), message: shortText }),
]);
export type TvEvent = z.infer<typeof TvEventSchema>;

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export const ClientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ping'), ts: z.number() }),

  // TV
  z.object({
    t: z.literal('tv.hello'),
    v: z.number().int(),
    deviceId: id.optional(),
    secret: z.string().max(256).optional(),
    name: shortText,
  }),
  z.object({ t: z.literal('tv.pair.create') }),
  z.object({ t: z.literal('tv.pair.decide'), requestId: id, approve: z.boolean() }),
  z.object({ t: z.literal('tv.remote.revoke'), remoteId: id }),
  z.object({ t: z.literal('tv.settings'), settings: TvSettingsSchema.partial() }),
  z.object({ t: z.literal('tv.rename'), name: shortText.min(1) }),
  z.object({ t: z.literal('tv.state'), state: TvStateSchema }),
  z.object({ t: z.literal('tv.event'), to: id.optional(), event: TvEventSchema }),

  // Remote
  z.object({
    t: z.literal('remote.pair'),
    v: z.number().int(),
    token: z.string().max(128).optional(),
    code: z.string().regex(/^\d{6}$/).optional(),
    name: shortText,
    platform: shortText,
  }),
  z.object({ t: z.literal('remote.resume'), v: z.number().int(), remoteId: id, token: z.string().max(256) }),
  z.object({ t: z.literal('remote.unpair') }),
  z.object({ t: z.literal('input'), e: InputEventSchema }),
  z.object({ t: z.literal('inputs'), e: z.array(InputEventSchema).max(32) }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ---------------------------------------------------------------------------
// Server -> client (not validated at runtime by the clients; typed only)
// ---------------------------------------------------------------------------

export interface PairCode {
  token: string;
  code: string;
  /** URL to encode in the QR code. The token is carried in the fragment so it never reaches access logs. */
  url: string;
  /** Base URL of the remote page, for manual entry. */
  baseUrl: string;
  qrSvg: string;
  expiresAt: number;
}

export interface PairRequest {
  requestId: string;
  name: string;
  platform: string;
  ip: string;
  verifyCode: string;
  method: 'qr' | 'code';
  expiresAt: number;
}

export type ServerMessage =
  | { t: 'pong'; ts: number; now: number }
  | { t: 'error'; code: import('./constants.js').ErrorCode; message: string; ref?: string }
  // to TV
  | {
      t: 'tv.welcome';
      deviceId: string;
      secret: string;
      name: string;
      settings: TvSettings;
      remotes: RemoteInfo[];
      apiToken: string;
    }
  | ({ t: 'tv.pair.code' } & PairCode)
  | ({ t: 'tv.pair.request' } & PairRequest)
  | { t: 'tv.pair.resolved'; requestId: string; approved: boolean; reason?: string }
  | { t: 'tv.remotes'; remotes: RemoteInfo[] }
  | { t: 'tv.settings'; settings: TvSettings }
  | { t: 'tv.input'; from: string; e: InputEvent[] }
  | { t: 'tv.file.received'; from: string; name: string; path: string; size: number }
  // to remote
  | { t: 'remote.pending'; requestId: string; verifyCode: string; tvName: string; expiresAt: number }
  | {
      t: 'remote.paired';
      remoteId: string;
      token: string;
      tvId: string;
      tvName: string;
    }
  | { t: 'remote.welcome'; remoteId: string; tvId: string; tvName: string; tvOnline: boolean; apiToken: string }
  | { t: 'remote.tv.status'; online: boolean; tvName: string }
  | { t: 'remote.tv.state'; state: TvState }
  | { t: 'remote.tv.event'; event: TvEvent }
  | { t: 'remote.revoked'; reason: string };
