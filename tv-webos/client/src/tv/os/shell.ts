/**
 * Shell-level behaviour: system commands, the Back chain and global key handling.
 *
 * Key event pipeline (physical remote, keyboard and synthetic phone keys alike):
 *  1. capture phase on window: colour keys (global shortcuts) and Back while
 *     an overlay is open are handled here first;
 *  2. the focused element / app sees the event and may preventDefault();
 *  3. bubble phase on window: unhandled arrows move focus spatially, Enter
 *     activates the focused element, Back runs the Back chain.
 */
import type { NavKey, ShellCommand } from '@tvwebos/shared/constants';
import { launch } from './apps';
import { runBackHandlers } from './bus';
import { isBackKey, isTextField, navKeyOf } from './keys';
import { activeTrap, focusScope, navigate } from './spatialNav';
import { os, useOs } from './store';

export function runCommand(cmd: ShellCommand, arg?: string): void {
  const s = os.get();
  switch (cmd) {
    case 'home':
    case 'launcher':
      s.toggleOverlay('launcher');
      return;
    case 'switcher':
      s.toggleOverlay('switcher');
      return;
    case 'notifications':
      s.toggleOverlay('notifications');
      return;
    case 'pairing':
      s.toggleOverlay('pairing');
      return;
    case 'show-desktop':
      s.setOverlay('none');
      s.minimizeAll();
      return;
    case 'launch-app':
      if (arg) launch(arg);
      return;
    case 'focus-window':
      if (arg && s.windows.some((w) => w.id === arg)) {
        s.focusWindow(arg);
        s.setOverlay('none');
      }
      return;
    case 'close-window': {
      const id = arg ?? s.focusedId;
      if (id) s.closeWindow(id);
      return;
    }
    case 'minimize-window': {
      const id = arg ?? s.focusedId;
      if (id) s.minimizeWindow(id);
      return;
    }
    case 'maximize-window': {
      const id = arg ?? s.focusedId;
      if (id) s.toggleMaximize(id);
      return;
    }
    case 'snap-left':
    case 'snap-right': {
      const id = arg ?? s.focusedId;
      if (id) s.snapWindow(id, cmd === 'snap-left' ? 'left' : 'right');
      return;
    }
  }
}

/** Back: close overlay > let the focused app go back > leave a text field > minimise the window. */
export function goBack(): boolean {
  const s = os.get();
  if (s.overlay !== 'none') {
    s.setOverlay('none');
    return true;
  }
  if (document.querySelector('[data-dialog-open]')) return false; // dialogs handle Back themselves
  const active = document.activeElement;
  if (isTextField(active)) {
    (active as HTMLElement).blur();
    return true;
  }
  if (s.focusedId) {
    if (runBackHandlers(s.focusedId)) return true;
    s.minimizeWindow(s.focusedId);
    return true;
  }
  return false;
}

function onKeyCapture(e: KeyboardEvent): void {
  const key = navKeyOf(e);
  if (!key) return;
  switch (key) {
    case 'ColorRed':
      runCommand('launcher');
      break;
    case 'ColorGreen':
      runCommand('switcher');
      break;
    case 'ColorYellow':
      runCommand('notifications');
      break;
    case 'ColorBlue':
      runCommand('pairing');
      break;
    default:
      if (isBackKey(key) && os.get().overlay !== 'none') break;
      return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (isBackKey(key)) os.get().setOverlay('none');
}

function isNativelyActivated(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return true;
  return false;
}

const ARROWS: Partial<Record<NavKey, 'up' | 'down' | 'left' | 'right'>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

function onKeyBubble(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const key = navKeyOf(e);
  if (!key) return;
  const active = document.activeElement as HTMLElement | null;
  const dir = ARROWS[key];
  if (dir) {
    if (isTextField(active) && (dir === 'left' || dir === 'right')) {
      const input = active as HTMLInputElement;
      let atEdge = true;
      try {
        const pos = input.selectionStart ?? 0;
        atEdge = dir === 'left' ? pos === 0 : pos === input.value.length;
      } catch {
        atEdge = true;
      }
      if (!atEdge && e.isTrusted) return; // let the caret move
    }
    if (navigate(dir, defaultScope())) e.preventDefault();
    return;
  }
  if (key === 'Enter') {
    if (!active || active === document.body) return;
    // Trusted Enter on buttons/links already clicks; synthetic events have no default action.
    if (!e.isTrusted || !isNativelyActivated(active)) {
      if (isTextField(active)) return;
      e.preventDefault();
      active.click();
    }
    return;
  }
  if (isBackKey(key)) {
    if (goBack()) e.preventDefault();
    return;
  }
  if (key === 'MediaPlayPause' || key === 'MediaStop' || key === 'MediaRewind' || key === 'MediaFastForward') {
    window.dispatchEvent(new CustomEvent('tvwebos:mediakey', { detail: key }));
    e.preventDefault();
  }
}

/** Where focus goes when nothing is focused: the focused window, else the desktop. */
export function defaultScope(): ParentNode | null {
  const trap = activeTrap();
  if (trap) return trap;
  const id = os.get().focusedId;
  if (id) {
    const win = document.querySelector(`[data-window="${id}"] [data-window-body]`);
    if (win) return win;
  }
  return document.querySelector('[data-desktop-home]') ?? document.querySelector('[data-taskbar]');
}

export function initShellKeys(): void {
  window.addEventListener('keydown', onKeyCapture, true);
  window.addEventListener('keydown', onKeyBubble, false);

  // When the focused window changes, move keyboard focus into it.
  let lastFocused: string | null = null;
  useOs.subscribe((s) => {
    if (s.focusedId === lastFocused) return;
    lastFocused = s.focusedId;
    if (!s.focusedId) return;
    const id = s.focusedId;
    // Wait for the window (and possibly its lazy content) to render.
    let tries = 0;
    const tick = () => {
      const active = document.activeElement;
      const body = document.querySelector(`[data-window="${id}"] [data-window-body]`);
      if (active && body?.contains(active)) return;
      if (body && focusScope(body)) return;
      if (++tries < 20) setTimeout(tick, 50);
    };
    setTimeout(tick, 0);
  });
}
