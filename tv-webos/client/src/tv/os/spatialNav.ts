/**
 * Spatial (D-pad) navigation.
 *
 * Focusable elements are found inside "scopes" (`data-nav-scope`). Navigation
 * first looks for a candidate in the innermost scope that contains the
 * current focus and then widens to parent scopes, unless a scope is a trap
 * (`data-nav-trap`, used by dialogs and overlays). Elements inside
 * `[data-nav-hidden]` (minimised windows, inactive tabs) are skipped.
 *
 * Content of windows other than the focused one (`data-window-inactive`) is
 * skipped too: switching windows is done from the taskbar or the switcher.
 *
 * Elements can opt out with `data-nav-skip`, and a container can pick its
 * entry point with `data-nav-default` on a child.
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [data-focusable]';

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[data-nav-hidden], [data-nav-skip], [data-window-inactive]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  return true;
}

export function focusablesIn(root: ParentNode): HTMLElement[] {
  const all = Array.prototype.slice.call(root.querySelectorAll(FOCUSABLE)) as HTMLElement[];
  return all.filter(isVisible);
}

/** The scope chain from the innermost scope around `el` outwards, ending at a trap or the document. */
function scopeChain(el: Element | null): ParentNode[] {
  const chain: ParentNode[] = [];
  const trap = activeTrap();
  let node = el ? el.closest('[data-nav-scope]') : null;
  while (node) {
    chain.push(node);
    if (node.hasAttribute('data-nav-trap') || node === trap) return chain;
    node = node.parentElement ? node.parentElement.closest('[data-nav-scope]') : null;
  }
  chain.push(trap ?? document);
  return chain;
}

/** The topmost visible trap scope (dialog / overlay), if any. */
export function activeTrap(): HTMLElement | null {
  const traps = Array.prototype.slice.call(document.querySelectorAll('[data-nav-trap]')) as HTMLElement[];
  const visible = traps.filter((t) => !t.closest('[data-nav-hidden]') && t.getBoundingClientRect().width > 0);
  return visible.length ? visible[visible.length - 1] : null;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
}

/**
 * Score a candidate: distance along the direction plus a weighted
 * perpendicular offset; candidates overlapping on the perpendicular axis win.
 */
function score(from: Rect, to: Rect, dir: Direction): number | null {
  const EPS = 2;
  let main: number;
  let cross: number;
  let overlap: number;
  switch (dir) {
    case 'right':
      if (to.left < from.right - EPS && to.cx <= from.cx) return null;
      main = Math.max(0, to.left - from.right);
      overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
      cross = Math.abs(to.cy - from.cy);
      break;
    case 'left':
      if (to.right > from.left + EPS && to.cx >= from.cx) return null;
      main = Math.max(0, from.left - to.right);
      overlap = Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top);
      cross = Math.abs(to.cy - from.cy);
      break;
    case 'down':
      if (to.top < from.bottom - EPS && to.cy <= from.cy) return null;
      main = Math.max(0, to.top - from.bottom);
      overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
      cross = Math.abs(to.cx - from.cx);
      break;
    case 'up':
      if (to.bottom > from.top + EPS && to.cy >= from.cy) return null;
      main = Math.max(0, from.top - to.bottom);
      overlap = Math.min(from.right, to.right) - Math.max(from.left, to.left);
      cross = Math.abs(to.cx - from.cx);
      break;
  }
  const aligned = overlap > 0;
  return main + (aligned ? cross * 0.3 : cross * 2 + 200);
}

function pickDefault(scope: ParentNode): HTMLElement | null {
  const preferred = (scope as Element).querySelector?.('[data-nav-default]') as HTMLElement | null;
  if (preferred && isVisible(preferred)) return preferred;
  const list = focusablesIn(scope);
  return list[0] ?? null;
}

export function focusEl(el: HTMLElement | null): boolean {
  if (!el) return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  scrollIntoViewIfNeeded(el);
  return document.activeElement === el;
}

function scrollIntoViewIfNeeded(el: HTMLElement): void {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    const scrollY = /(auto|scroll)/.test(style.overflowY) && parent.scrollHeight > parent.clientHeight;
    const scrollX = /(auto|scroll)/.test(style.overflowX) && parent.scrollWidth > parent.clientWidth;
    if (scrollY || scrollX) {
      const pr = parent.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      const margin = 24;
      if (scrollY) {
        if (er.top < pr.top + margin) parent.scrollTop -= pr.top + margin - er.top;
        else if (er.bottom > pr.bottom - margin) parent.scrollTop += er.bottom - pr.bottom + margin;
      }
      if (scrollX) {
        if (er.left < pr.left + margin) parent.scrollLeft -= pr.left + margin - er.left;
        else if (er.right > pr.right - margin) parent.scrollLeft += er.right - pr.right + margin;
      }
    }
    parent = parent.parentElement;
  }
}

/**
 * Move focus in a direction. Returns true when focus moved.
 * `fallbackScope` is used when nothing is focused yet.
 */
export function navigate(dir: Direction, fallbackScope?: ParentNode | null): boolean {
  const current = document.activeElement as HTMLElement | null;
  const hasFocus = current && current !== document.body && isVisible(current);
  if (!hasFocus) {
    const scope = activeTrap() ?? fallbackScope ?? document;
    return focusEl(pickDefault(scope));
  }
  const from = rectOf(current!);
  for (const scope of scopeChain(current)) {
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of focusablesIn(scope)) {
      if (el === current || el.contains(current) || current!.contains(el)) continue;
      const s = score(from, rectOf(el), dir);
      if (s !== null && s < bestScore) {
        bestScore = s;
        best = el;
      }
    }
    if (best) return focusEl(best);
  }
  return false;
}

/** Focus the default element of a scope (e.g. when a window or dialog opens). */
export function focusScope(scope: ParentNode | null): boolean {
  if (!scope) return false;
  return focusEl(pickDefault(scope));
}

export function focusableAncestor(el: Element | null): HTMLElement | null {
  return el ? (el.closest(FOCUSABLE) as HTMLElement | null) : null;
}
