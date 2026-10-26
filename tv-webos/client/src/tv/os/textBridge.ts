/**
 * Mirrors the focused text field to phones and applies text typed on them.
 *
 * The phone always sends the full value ("set"), which avoids caret and IME
 * synchronisation problems and works for any language input on the phone.
 */
import type { TvTextFocus } from '@tvwebos/shared';
import { isTextField, syntheticKey } from './keys';

let current: HTMLInputElement | HTMLTextAreaElement | null = null;
const listeners = new Set<(focus: TvTextFocus | null) => void>();

/** Text supplied by a mini-app frame (its field lives in another document). */
let frameText: { focus: TvTextFocus; apply: (value: string) => void; submit: () => void } | null = null;

function describe(el: HTMLInputElement | HTMLTextAreaElement): TvTextFocus {
  return {
    value: el.value.slice(0, 10_000),
    inputType: el instanceof HTMLTextAreaElement ? 'textarea' : (el.type || 'text').toLowerCase(),
    placeholder: (el.placeholder || el.getAttribute('aria-label') || '').slice(0, 256),
    multiline: el instanceof HTMLTextAreaElement,
  };
}

function emit(): void {
  const focus = frameText ? frameText.focus : current ? describe(current) : null;
  listeners.forEach((fn) => fn(focus));
}

export function onTextFocus(fn: (focus: TvTextFocus | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentTextFocus(): TvTextFocus | null {
  return frameText ? frameText.focus : current ? describe(current) : null;
}

export function initTextBridge(): void {
  document.addEventListener('focusin', (e) => {
    const t = e.target as Element;
    if (isTextField(t) && !(t as HTMLElement).isContentEditable) {
      current = t as HTMLInputElement | HTMLTextAreaElement;
      frameText = null;
      emit();
    } else if (t.tagName !== 'IFRAME') {
      if (current || frameText) {
        current = null;
        frameText = null;
        emit();
      }
    }
  });
  document.addEventListener('focusout', (e) => {
    if (e.target === current) {
      current = null;
      // Defer: focus may be moving to another field.
      setTimeout(() => {
        if (!current) emit();
      }, 0);
    }
  });
  // Keep phones in sync when the value changes on the TV (on-screen keyboard, app logic).
  document.addEventListener('input', (e) => {
    if (e.target === current && !applying) emit();
  });
}

export function setFrameText(
  value: { focus: TvTextFocus; apply: (value: string) => void; submit: () => void } | null,
): void {
  frameText = value;
  emit();
}

let applying = false;

/** Set the value of the focused field the way React expects (native setter + input event). */
export function applyText(value: string): boolean {
  if (frameText) {
    frameText.apply(value);
    frameText = { ...frameText, focus: { ...frameText.focus, value } };
    return true;
  }
  const el = current;
  if (!el || !el.isConnected) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const maxLength = el.maxLength > 0 ? el.maxLength : Infinity;
  const v = value.slice(0, maxLength);
  applying = true;
  try {
    if (setter) setter.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      el.setSelectionRange(v.length, v.length);
    } catch {
      // number/email inputs do not support selection
    }
  } finally {
    applying = false;
  }
  return true;
}

/** "Enter" on the phone keyboard. */
export function submitText(): boolean {
  if (frameText) {
    frameText.submit();
    return true;
  }
  const el = current;
  if (!el || !el.isConnected) return false;
  const notCancelled = el.dispatchEvent(syntheticKey('keydown', 'Enter'));
  el.dispatchEvent(syntheticKey('keyup', 'Enter'));
  if (notCancelled && el instanceof HTMLInputElement && el.form) {
    if (typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
    else el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  return true;
}
