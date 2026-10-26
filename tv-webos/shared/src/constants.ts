/** Protocol version. Bump when message shapes change incompatibly. */
export const PROTOCOL_VERSION = 1;

/** WebSocket endpoint path on the server. */
export const WS_PATH = '/ws';

/** Max size of a single WebSocket frame accepted by the server (bytes). */
export const MAX_WS_PAYLOAD = 64 * 1024;

/** Pairing token lifetime (QR code). */
export const PAIR_TOKEN_TTL_MS = 2 * 60 * 1000;

/** Interval at which clients send application-level pings. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** A connection that has not been heard from within this window is considered dead. */
export const HEARTBEAT_TIMEOUT_MS = 30_000;

/** Bit positions of the virtual gamepad buttons (standard gamepad layout order). */
export const GamepadButton = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  L1: 4,
  R1: 5,
  SELECT: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

/** Navigation keys a remote can send. Names follow KeyboardEvent.key where one exists. */
export const NAV_KEYS = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Back',
  'Backspace',
  'Tab',
  'Escape',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ColorRed',
  'ColorGreen',
  'ColorYellow',
  'ColorBlue',
  'MediaPlayPause',
  'MediaStop',
  'MediaRewind',
  'MediaFastForward',
] as const;
export type NavKey = (typeof NAV_KEYS)[number];

/** System commands a remote can ask the TV shell to perform. */
export const SHELL_COMMANDS = [
  'home',
  'launcher',
  'switcher',
  'notifications',
  'pairing',
  'show-desktop',
  'launch-app',
  'focus-window',
  'close-window',
  'minimize-window',
  'maximize-window',
  'snap-left',
  'snap-right',
] as const;
export type ShellCommand = (typeof SHELL_COMMANDS)[number];

export const MEDIA_COMMANDS = ['toggle', 'play', 'pause', 'stop', 'seek', 'seek-by', 'next', 'prev', 'volume', 'mute', 'fullscreen'] as const;
export type MediaCommand = (typeof MEDIA_COMMANDS)[number];

/** Error codes the server can return. */
export const ERROR_CODES = [
  'bad_request',
  'rate_limited',
  'auth_invalid',
  'pair_invalid',
  'pair_expired',
  'pair_rejected',
  'pair_timeout',
  'too_many_remotes',
  'tv_offline',
  'replaced',
  'revoked',
  'server_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
