/**
 * Turns input events from paired phones into actions on the TV.
 */
import type { InputEvent } from '@tvwebos/shared';
import { GamepadButton, type NavKey } from '@tvwebos/shared/constants';
import { activeMedia, frameForWindow, gamepadListenerFor } from './bus';
import * as cursor from './cursor';
import { syntheticKey } from './keys';
import { runCommand } from './shell';
import { os } from './store';
import { appDescriptor } from './apps';
import { applyText, submitText } from './textBridge';

/** Send a key to whatever is focused (forwarded into a mini-app frame when it has focus). */
export function dispatchNavKey(key: NavKey, action: 'down' | 'up' | 'press'): void {
  const active = document.activeElement;
  if (active && active.tagName === 'IFRAME') {
    const frame = frameForWindow(os.get().focusedId);
    if (frame && frame.iframe === active) {
      frame.post({ type: 'key', key, action });
      return;
    }
  }
  const target = active && active !== document.body ? active : document.body;
  if (action === 'down' || action === 'press') target.dispatchEvent(syntheticKey('keydown', key));
  if (action === 'up' || action === 'press') target.dispatchEvent(syntheticKey('keyup', key));
}

// ---- Gamepad -----------------------------------------------------------------

let lastButtons = 0;
let repeatTimer: number | null = null;

const PAD_TO_KEY: Array<[number, NavKey]> = [
  [GamepadButton.UP, 'ArrowUp'],
  [GamepadButton.DOWN, 'ArrowDown'],
  [GamepadButton.LEFT, 'ArrowLeft'],
  [GamepadButton.RIGHT, 'ArrowRight'],
  [GamepadButton.A, 'Enter'],
  [GamepadButton.B, 'Back'],
];

function handleGamepad(from: string, buttons: number, axes: number[]): void {
  const s = os.get();
  const focused = s.windows.find((w) => w.id === s.focusedId);
  const app = focused ? appDescriptor(focused.appId) : null;

  // Apps that asked for gamepad input get the raw state.
  if (focused && app?.wantsGamepad && s.overlay === 'none') {
    const frame = frameForWindow(focused.id);
    if (frame) frame.post({ type: 'gamepad', buttons, axes });
    gamepadListenerFor(focused.id)?.({ buttons, axes, from });
    lastButtons = buttons;
    return;
  }

  // Otherwise the pad drives the UI like a D-pad, with auto-repeat on directions.
  const pressed = buttons & ~lastButtons;
  lastButtons = buttons;
  if (pressed & (1 << GamepadButton.START)) runCommand('launcher');
  if (pressed & (1 << GamepadButton.SELECT)) runCommand('switcher');
  for (const [bit, key] of PAD_TO_KEY) {
    if (pressed & (1 << bit)) dispatchNavKey(key, 'press');
  }
  if (repeatTimer !== null) {
    clearTimeout(repeatTimer);
    repeatTimer = null;
  }
  const held = PAD_TO_KEY.slice(0, 4).find(([bit]) => buttons & (1 << bit));
  if (held) {
    const repeat = (delay: number) => {
      repeatTimer = window.setTimeout(() => {
        if (!(lastButtons & (1 << held[0]))) return;
        dispatchNavKey(held[1], 'press');
        repeat(110);
      }, delay);
    };
    repeat(400);
  }
}

// ---- Entry point ---------------------------------------------------------------

export function handleRemoteInput(from: string, events: InputEvent[]): void {
  for (const e of events) {
    switch (e.k) {
      case 'move':
        cursor.moveBy(e.dx, e.dy);
        break;
      case 'button':
        cursor.button(e.b, e.a);
        break;
      case 'scroll':
        cursor.scroll(e.dx, e.dy);
        break;
      case 'key':
        dispatchNavKey(e.key, e.a);
        break;
      case 'text':
        if (e.op === 'set') applyText(e.value ?? '');
        else submitText();
        break;
      case 'gamepad':
        handleGamepad(from, e.buttons, e.axes);
        break;
      case 'command':
        runCommand(e.cmd, e.arg);
        break;
      case 'media': {
        const ctrl = activeMedia(os.get().focusedId);
        ctrl?.command(e.cmd, e.value);
        break;
      }
    }
  }
}
