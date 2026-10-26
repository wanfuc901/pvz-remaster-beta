/**
 * Virtual cursor driven by the phone touchpad.
 *
 * The phone sends relative movement; the cursor position lives here (not in
 * React state) and is painted with a transform once per animation frame.
 * Pointer actions are turned into DOM mouse events dispatched at the element
 * under the cursor, so ordinary onClick / onMouseDown handlers work. Events
 * for sandboxed mini-app frames are forwarded over postMessage instead,
 * because a parent page cannot dispatch events into a cross-origin frame.
 *
 * Limitation: content of third-party iframes (Browser app) cannot be clicked
 * with the virtual cursor. The LG Magic Remote pointer is a real mouse and
 * works everywhere.
 */
import { frameForElement } from './bus';
import { focusEl, focusableAncestor } from './spatialNav';
import { isTextField } from './keys';
import { useOs } from './store';

const HIDE_AFTER_MS = 5000;

let x = window.innerWidth / 2;
let y = window.innerHeight / 2;
let el: HTMLElement | null = null;
let rafPending = false;
let hideTimer: number | null = null;
let hoverEl: Element | null = null;
let pressed: { button: number; target: Element } | null = null;

export function mountCursor(node: HTMLElement): void {
  el = node;
  paint();
  // A real pointer (Magic Remote, mouse) takes over from the virtual one.
  window.addEventListener(
    'mousemove',
    (e) => {
      if (e.isTrusted && useOs.getState().cursorVisible) useOs.getState().setCursorVisible(false);
    },
    true,
  );
  window.addEventListener('resize', () => {
    x = Math.min(x, window.innerWidth - 1);
    y = Math.min(y, window.innerHeight - 1);
    paint();
  });
}

export function cursorPosition(): { x: number; y: number } {
  return { x, y };
}

function paint(): void {
  if (!el) return;
  el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  el.classList.toggle('is-pressed', pressed !== null);
}

function schedulePaint(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    paint();
    updateHover();
  });
}

function show(): void {
  const s = useOs.getState();
  if (!s.cursorVisible) s.setCursorVisible(true);
  if (hideTimer !== null) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!pressed) useOs.getState().setCursorVisible(false);
  }, HIDE_AFTER_MS);
}

function targetAt(px: number, py: number): Element | null {
  return document.elementFromPoint(px, py);
}

function mouseInit(button: number, extra: Partial<MouseEventInit> = {}): MouseEventInit {
  return {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button,
    buttons: pressed ? 1 << (pressed.button === 2 ? 1 : pressed.button === 1 ? 2 : 0) : 0,
    ...extra,
  };
}

function fire(target: Element, type: string, button = 0, extra: Partial<MouseEventInit> = {}): boolean {
  const ev = new MouseEvent(type, mouseInit(button, extra));
  return target.dispatchEvent(ev);
}

/** Forward a pointer event into a mini-app frame, in frame coordinates. */
function forwardToFrame(target: Element, type: string, payload: Record<string, unknown> = {}): boolean {
  const frame = frameForElement(target);
  if (!frame) return false;
  const r = frame.iframe.getBoundingClientRect();
  frame.post({ type: 'pointer', event: type, x: x - r.left, y: y - r.top, ...payload });
  return true;
}

function updateHover(): void {
  const target = targetAt(x, y);
  if (!target) return;
  if (forwardToFrame(target, 'move', { buttons: pressed ? 1 : 0 })) {
    hoverEl = target;
    return;
  }
  fire(target, 'mousemove', 0);
  if (target !== hoverEl) {
    if (hoverEl) fire(hoverEl, 'mouseout', 0, { relatedTarget: target });
    fire(target, 'mouseover', 0, { relatedTarget: hoverEl });
    hoverEl = target;
    // tvOS-style: the pointer drives focus, so D-pad and pointer share one highlight.
    if (!pressed) {
      const f = focusableAncestor(target);
      if (f && f !== document.activeElement && !isTextField(f) && f.tagName !== 'IFRAME') focusEl(f);
    }
  }
}

export function moveBy(dx: number, dy: number): void {
  x = Math.max(0, Math.min(window.innerWidth - 1, x + dx));
  y = Math.max(0, Math.min(window.innerHeight - 1, y + dy));
  show();
  schedulePaint();
}

export function moveTo(nx: number, ny: number): void {
  x = nx;
  y = ny;
  schedulePaint();
}

export function button(b: 0 | 1 | 2, action: 'down' | 'up' | 'click' | 'dblclick'): void {
  show();
  const target = targetAt(x, y);
  if (!target) return;
  if (action === 'click') {
    button(b, 'down');
    button(b, 'up');
    return;
  }
  if (action === 'dblclick') {
    button(b, 'click');
    button(b, 'click');
    if (!forwardToFrame(target, 'dblclick')) fire(target, 'dblclick', b, { detail: 2 });
    return;
  }
  if (action === 'down') {
    pressed = { button: b, target };
    paint();
    if (forwardToFrame(target, 'down', { button: b })) return;
    const ok = fire(target, 'mousedown', b);
    // Like a real click, pressing focuses the element (unless the handler cancelled it).
    if (ok) {
      const f = isTextField(target) ? (target as HTMLElement) : focusableAncestor(target);
      if (f) focusEl(f);
    }
    return;
  }
  // up
  const down = pressed;
  pressed = null;
  paint();
  if (forwardToFrame(target, 'up', { button: b })) return;
  fire(target, 'mouseup', b);
  if (down && (down.target === target || down.target.contains(target) || target.contains(down.target))) {
    if (b === 2) {
      fire(target, 'contextmenu', 2);
    } else if (b === 0) {
      const clickTarget = down.target.contains(target) ? target : down.target;
      // HTMLElement.click() also triggers default actions (checkbox toggle, link follow).
      if (clickTarget instanceof HTMLElement) clickTarget.click();
      else fire(clickTarget, 'click', 0, { detail: 1 });
    }
  }
}

function scrollableAncestor(start: Element | null, dx: number, dy: number): Element | null {
  let node = start;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      const canY = dy !== 0 && /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
      const canX = dx !== 0 && /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
      if (canY || canX) return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function scroll(dx: number, dy: number): void {
  show();
  const target = targetAt(x, y);
  if (!target) return;
  if (forwardToFrame(target, 'scroll', { dx, dy })) return;
  const wheel = new WheelEvent('wheel', { ...mouseInit(0), deltaX: dx, deltaY: dy, deltaMode: 0 });
  if (!target.dispatchEvent(wheel)) return;
  const scroller = scrollableAncestor(target, dx, dy);
  if (scroller) scroller.scrollBy(dx, dy);
}

export function isDragging(): boolean {
  return pressed !== null;
}
