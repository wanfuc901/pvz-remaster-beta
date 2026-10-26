/**
 * Registries that connect OS services (input, link) with running apps,
 * without routing everything through React state.
 */
import type { MediaCommand } from '@tvwebos/shared/constants';
import type { TvMediaState } from '@tvwebos/shared';

// ---- Back handlers -------------------------------------------------------

type BackHandler = () => boolean;
const backHandlers = new Map<string, BackHandler[]>();

/** Register a Back handler for a window. Return true from it when Back was consumed. */
export function addBackHandler(windowId: string, fn: BackHandler): () => void {
  const list = backHandlers.get(windowId) ?? [];
  list.push(fn);
  backHandlers.set(windowId, list);
  return () => {
    const l = backHandlers.get(windowId);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) backHandlers.delete(windowId);
  };
}

export function runBackHandlers(windowId: string): boolean {
  const list = backHandlers.get(windowId);
  if (!list) return false;
  // Most recently registered (innermost view) first.
  for (let i = list.length - 1; i >= 0; i--) if (list[i]()) return true;
  return false;
}

// ---- Media controllers -----------------------------------------------------

export interface MediaController {
  windowId: string;
  getState: () => TvMediaState | null;
  command: (cmd: MediaCommand, value?: number) => void;
}

const mediaControllers: MediaController[] = [];
const mediaListeners = new Set<() => void>();

export function registerMedia(ctrl: MediaController): () => void {
  mediaControllers.push(ctrl);
  emitMediaChange();
  return () => {
    const i = mediaControllers.indexOf(ctrl);
    if (i >= 0) mediaControllers.splice(i, 1);
    emitMediaChange();
  };
}

/** The controller of the focused window, else the most recently registered one that is playing, else the newest. */
export function activeMedia(focusedWindowId: string | null): MediaController | null {
  const focused = mediaControllers.find((c) => c.windowId === focusedWindowId);
  if (focused) return focused;
  for (let i = mediaControllers.length - 1; i >= 0; i--) {
    if (mediaControllers[i].getState()?.playing) return mediaControllers[i];
  }
  return mediaControllers[mediaControllers.length - 1] ?? null;
}

export function emitMediaChange(): void {
  mediaListeners.forEach((fn) => fn());
}

export function onMediaChange(fn: () => void): () => void {
  mediaListeners.add(fn);
  return () => mediaListeners.delete(fn);
}

// ---- Gamepad / pointer routing into mini-app frames ------------------------

export interface FrameTarget {
  windowId: string;
  iframe: HTMLIFrameElement;
  wantsGamepad: boolean;
  post: (msg: unknown) => void;
}

const frames = new Map<string, FrameTarget>();

export function registerFrame(target: FrameTarget): () => void {
  frames.set(target.windowId, target);
  return () => {
    if (frames.get(target.windowId) === target) frames.delete(target.windowId);
  };
}

export function frameForWindow(windowId: string | null): FrameTarget | null {
  return windowId ? (frames.get(windowId) ?? null) : null;
}

export function frameForElement(el: Element | null): FrameTarget | null {
  if (!el || el.tagName !== 'IFRAME') return null;
  for (const f of frames.values()) if (f.iframe === el) return f;
  return null;
}

// ---- Built-in gamepad consumers --------------------------------------------

export interface GamepadSnapshot {
  buttons: number;
  axes: number[];
  from: string;
}

type GamepadListener = (state: GamepadSnapshot) => void;
const gamepadListeners = new Map<string, GamepadListener>();

export function onGamepad(windowId: string, fn: GamepadListener): () => void {
  gamepadListeners.set(windowId, fn);
  return () => {
    if (gamepadListeners.get(windowId) === fn) gamepadListeners.delete(windowId);
  };
}

export function gamepadListenerFor(windowId: string | null): GamepadListener | null {
  return windowId ? (gamepadListeners.get(windowId) ?? null) : null;
}
