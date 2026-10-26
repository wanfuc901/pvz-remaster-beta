/**
 * Key normalisation for TV remotes, keyboards and synthetic events from the phone.
 *
 * LG webOS remote key codes (from LG's webOS TV developer documentation):
 *   Back 461, Red 403, Green 404, Yellow 405, Blue 406,
 *   Play 415, Pause 19, Stop 413, Rewind 412, Fast-forward 417.
 * The Home key is handled by the TV system and never reaches web content.
 */
import type { NavKey } from '@tvwebos/shared/constants';

const BY_CODE: Record<number, NavKey> = {
  37: 'ArrowLeft',
  38: 'ArrowUp',
  39: 'ArrowRight',
  40: 'ArrowDown',
  13: 'Enter',
  8: 'Backspace',
  9: 'Tab',
  27: 'Escape',
  46: 'Delete',
  36: 'Home',
  35: 'End',
  33: 'PageUp',
  34: 'PageDown',
  461: 'Back',
  10009: 'Back', // Tizen-style back, harmless elsewhere
  403: 'ColorRed',
  404: 'ColorGreen',
  405: 'ColorYellow',
  406: 'ColorBlue',
  415: 'MediaPlayPause',
  19: 'MediaPlayPause',
  179: 'MediaPlayPause',
  413: 'MediaStop',
  178: 'MediaStop',
  412: 'MediaRewind',
  417: 'MediaFastForward',
};

const BY_KEY: Record<string, NavKey> = {
  ArrowLeft: 'ArrowLeft',
  ArrowUp: 'ArrowUp',
  ArrowRight: 'ArrowRight',
  ArrowDown: 'ArrowDown',
  Left: 'ArrowLeft',
  Up: 'ArrowUp',
  Right: 'ArrowRight',
  Down: 'ArrowDown',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Escape: 'Escape',
  Esc: 'Escape',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  GoBack: 'Back',
  BrowserBack: 'Back',
  ColorF0Red: 'ColorRed',
  ColorF1Green: 'ColorGreen',
  ColorF2Yellow: 'ColorYellow',
  ColorF3Blue: 'ColorBlue',
  MediaPlayPause: 'MediaPlayPause',
  MediaPlay: 'MediaPlayPause',
  MediaPause: 'MediaPlayPause',
  MediaStop: 'MediaStop',
  MediaRewind: 'MediaRewind',
  MediaFastForward: 'MediaFastForward',
};

export const KEY_CODES: Record<NavKey, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  Back: 461,
  Backspace: 8,
  Tab: 9,
  Escape: 27,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ColorRed: 403,
  ColorGreen: 404,
  ColorYellow: 405,
  ColorBlue: 406,
  MediaPlayPause: 415,
  MediaStop: 413,
  MediaRewind: 412,
  MediaFastForward: 417,
};

/** Synthetic events from the phone carry the NavKey here. */
export const NAV_KEY_PROP = '__tvwebosNavKey';

export function navKeyOf(e: KeyboardEvent): NavKey | null {
  const tagged = (e as unknown as Record<string, unknown>)[NAV_KEY_PROP];
  if (typeof tagged === 'string') return tagged as NavKey;
  if (e.key && BY_KEY[e.key]) return BY_KEY[e.key];
  const code = e.keyCode || e.which;
  return BY_CODE[code] ?? null;
}

/** True for Back-like keys (remote Back, Escape). */
export function isBackKey(key: NavKey | null): boolean {
  return key === 'Back' || key === 'Escape';
}

/** Create a KeyboardEvent that looks like a physical key press to our handlers. */
export function syntheticKey(type: 'keydown' | 'keyup', key: NavKey): KeyboardEvent {
  const domKey = key === 'Back' ? 'GoBack' : key;
  const ev = new KeyboardEvent(type, { key: domKey, bubbles: true, cancelable: true });
  const code = KEY_CODES[key];
  // keyCode/which cannot be set through the constructor in Chromium.
  try {
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    Object.defineProperty(ev, 'which', { get: () => code });
  } catch {
    // ignore
  }
  (ev as unknown as Record<string, unknown>)[NAV_KEY_PROP] = key;
  return ev;
}

export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'email', 'password', 'number', 'tel'].includes(t) && !el.readOnly && !el.disabled;
  }
  return (el as HTMLElement).isContentEditable === true;
}
