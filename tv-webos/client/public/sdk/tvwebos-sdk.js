/*!
 * TV WebOS mini-app SDK (API version 1)
 *
 * Include in a mini-app page:
 *   <script src="/sdk/tvwebos-sdk.js"></script>
 *
 * The SDK makes the page controllable from the TV WebOS desktop: the phone's
 * virtual cursor, D-pad keys, gamepad and text input are forwarded into the
 * sandboxed frame, and it exposes `window.tvwebos` for apps:
 *
 *   tvwebos.ready.then(function (info) { ... })    // { appId, permissions, theme }
 *   tvwebos.storage.get(key) / set(key, value) / remove(key) / keys()   ("storage")
 *   tvwebos.notify(title, body)                                        ("notifications")
 *   tvwebos.onGamepad(function (state) { ... })     // { buttons, axes }  ("gamepad")
 *   tvwebos.onKey(function (key, action) { return true if handled })
 *   tvwebos.onBack(function () { return true if handled })
 *   tvwebos.setTitle(text) / tvwebos.close()
 *   tvwebos.Buttons  // gamepad bit indexes
 *
 * Written in ES5 so it runs on every supported TV engine without a build step.
 */
(function () {
  'use strict';
  if (window.tvwebos) return;

  var parentWin = window.parent;
  var embedded = parentWin && parentWin !== window;
  var nextId = 1;
  var pending = {};
  var keyHandlers = [];
  var backHandlers = [];
  var gamepadHandlers = [];
  var focusHandlers = [];
  var resolveReady;
  var info = null;
  var pressedTarget = null;

  var KEY_CODES = {
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Back: 461,
    Backspace: 8, Tab: 9, Escape: 27, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
    ColorRed: 403, ColorGreen: 404, ColorYellow: 405, ColorBlue: 406,
    MediaPlayPause: 415, MediaStop: 413, MediaRewind: 412, MediaFastForward: 417
  };
  var CODE_TO_KEY = {};
  Object.keys(KEY_CODES).forEach(function (k) { CODE_TO_KEY[KEY_CODES[k]] = k; });
  CODE_TO_KEY[19] = 'MediaPlayPause';
  var KEY_ALIASES = { Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape', GoBack: 'Back' };

  function post(msg) {
    if (!embedded) return;
    msg.tvwebos = 1;
    parentWin.postMessage(msg, '*');
  }

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      if (!embedded) {
        reject(new Error('Not running inside TV WebOS'));
        return;
      }
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'request', id: id, method: method, params: params || {} });
    });
  }

  function navKeyOf(e) {
    if (e.__tvwebosNavKey) return e.__tvwebosNavKey;
    if (e.key && KEY_CODES[e.key]) return e.key;
    if (e.key && KEY_ALIASES[e.key]) return KEY_ALIASES[e.key];
    return CODE_TO_KEY[e.keyCode || e.which] || null;
  }

  function makeKeyEvent(type, key) {
    var ev;
    try {
      ev = new KeyboardEvent(type, { key: key === 'Back' ? 'GoBack' : key, bubbles: true, cancelable: true });
    } catch (err) {
      ev = document.createEvent('Event');
      ev.initEvent(type, true, true);
    }
    var code = KEY_CODES[key] || 0;
    try {
      Object.defineProperty(ev, 'keyCode', { get: function () { return code; } });
      Object.defineProperty(ev, 'which', { get: function () { return code; } });
    } catch (err) { /* ignore */ }
    ev.__tvwebosNavKey = key;
    return ev;
  }

  // ---- Focus navigation inside the app ------------------------------------

  var FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [data-focusable]';

  function focusables() {
    var all = document.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var r = all[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(all[i]);
    }
    return out;
  }

  function navigate(dir) {
    var list = focusables();
    var cur = document.activeElement;
    if (!cur || cur === document.body || list.indexOf(cur) < 0) {
      if (list[0]) { list[0].focus(); return true; }
      return false;
    }
    var a = cur.getBoundingClientRect();
    var ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var b = el.getBoundingClientRect();
      var bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2;
      var main, cross;
      if (dir === 'right') { if (bx <= ax + 1) continue; main = bx - ax; cross = Math.abs(by - ay); }
      else if (dir === 'left') { if (bx >= ax - 1) continue; main = ax - bx; cross = Math.abs(by - ay); }
      else if (dir === 'down') { if (by <= ay + 1) continue; main = by - ay; cross = Math.abs(bx - ax); }
      else { if (by >= ay - 1) continue; main = ay - by; cross = Math.abs(bx - ax); }
      var score = main + cross * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      best.focus();
      if (best.scrollIntoView) {
        try { best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { best.scrollIntoView(false); }
      }
      return true;
    }
    return false;
  }

  var DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (el.tagName === 'INPUT') {
      var t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'email', 'password', 'number', 'tel'].indexOf(t) >= 0 && !el.readOnly && !el.disabled;
    }
    return false;
  }

  /** Default handling for keys the app did not consume. */
  function defaultKey(e, key) {
    for (var i = keyHandlers.length - 1; i >= 0; i--) {
      if (keyHandlers[i](key, e.type === 'keydown' ? 'down' : 'up') === true) { e.preventDefault(); return; }
    }
    if (e.type !== 'keydown' || e.defaultPrevented) return;
    if (key === 'Back' || key === 'Escape') {
      e.preventDefault();
      runBack();
      return;
    }
    var dir = DIRS[key];
    if (dir) {
      if (isTextField(document.activeElement) && (dir === 'left' || dir === 'right') && e.isTrusted) return;
      e.preventDefault();
      if (!navigate(dir)) request('system.key', { key: key });
      return;
    }
    if (key === 'Enter') {
      var a = document.activeElement;
      if (a && a !== document.body && !e.isTrusted && !isTextField(a)) { e.preventDefault(); a.click(); }
      return;
    }
    if (key.indexOf('Color') === 0) {
      e.preventDefault();
      request('system.key', { key: key });
    }
  }

  function runBack() {
    for (var i = backHandlers.length - 1; i >= 0; i--) {
      if (backHandlers[i]() === true) return;
    }
    if (isTextField(document.activeElement)) { document.activeElement.blur(); return; }
    request('system.back');
  }

  window.addEventListener('keydown', function (e) {
    var key = navKeyOf(e);
    if (key) defaultKey(e, key);
  });
  window.addEventListener('keyup', function (e) {
    var key = navKeyOf(e);
    if (!key) return;
    for (var i = keyHandlers.length - 1; i >= 0; i--) {
      if (keyHandlers[i](key, 'up') === true) { e.preventDefault(); return; }
    }
  });

  // ---- Pointer injection ----------------------------------------------------

  function fireMouse(target, type, x, y, button, buttons) {
    var ev;
    try {
      ev = new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: button || 0, buttons: buttons || 0 });
    } catch (err) {
      ev = document.createEvent('MouseEvents');
      ev.initMouseEvent(type, true, true, window, 1, x, y, x, y, false, false, false, false, button || 0, null);
    }
    return target.dispatchEvent(ev);
  }

  function focusableAncestor(el) {
    while (el && el !== document.body) {
      if (el.matches && el.matches(FOCUSABLE)) return el;
      el = el.parentElement;
    }
    return null;
  }

  var hover = null;
  function onPointer(d) {
    var x = d.x, y = d.y;
    var target = document.elementFromPoint(x, y) || document.body;
    if (d.event === 'move') {
      fireMouse(target, 'mousemove', x, y, 0, d.buttons || 0);
      if (target !== hover) {
        if (hover) fireMouse(hover, 'mouseout', x, y);
        fireMouse(target, 'mouseover', x, y);
        hover = target;
        if (!pressedTarget) {
          var f = focusableAncestor(target);
          if (f && f !== document.activeElement && !isTextField(f)) f.focus();
        }
      }
    } else if (d.event === 'down') {
      pressedTarget = target;
      if (fireMouse(target, 'mousedown', x, y, d.button, 1)) {
        var fa = isTextField(target) ? target : focusableAncestor(target);
        if (fa) fa.focus();
      }
    } else if (d.event === 'up') {
      fireMouse(target, 'mouseup', x, y, d.button, 0);
      var down = pressedTarget;
      pressedTarget = null;
      if (down && (down === target || down.contains(target) || target.contains(down))) {
        if (d.button === 2) fireMouse(target, 'contextmenu', x, y, 2);
        else if (typeof target.click === 'function') (down.contains(target) ? target : down).click();
      }
    } else if (d.event === 'dblclick') {
      fireMouse(target, 'dblclick', x, y);
    } else if (d.event === 'scroll') {
      var node = target;
      while (node && node !== document.documentElement) {
        var s = getComputedStyle(node);
        if ((/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight) ||
            (/(auto|scroll)/.test(s.overflowX) && node.scrollWidth > node.clientWidth)) {
          node.scrollTop += d.dy; node.scrollLeft += d.dx; return;
        }
        node = node.parentElement;
      }
      window.scrollBy(d.dx, d.dy);
    }
  }

  // ---- Text fields ----------------------------------------------------------

  var textEl = null;
  document.addEventListener('focusin', function (e) {
    if (isTextField(e.target)) {
      textEl = e.target;
      request('text.focus', {
        value: textEl.value, inputType: textEl.tagName === 'TEXTAREA' ? 'textarea' : textEl.type,
        placeholder: textEl.placeholder || '', multiline: textEl.tagName === 'TEXTAREA'
      }).catch(function () {});
    }
  });
  document.addEventListener('focusout', function (e) {
    if (e.target === textEl) {
      textEl = null;
      setTimeout(function () { if (!textEl) request('text.blur').catch(function () {}); }, 0);
    }
  });

  function applyText(d) {
    var el = textEl;
    if (!el) return;
    if (d.op === 'set') {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, d.value); else el.value = d.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      var ok = el.dispatchEvent(makeKeyEvent('keydown', 'Enter'));
      el.dispatchEvent(makeKeyEvent('keyup', 'Enter'));
      if (ok && el.form) el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }

  // ---- Messages from the host ---------------------------------------------

  window.addEventListener('message', function (e) {
    if (e.source !== parentWin) return;
    var d = e.data;
    if (!d || d.tvwebos !== 1) return;
    switch (d.type) {
      case 'init':
        info = { appId: d.appId, apiVersion: d.apiVersion, permissions: d.permissions || [], theme: d.theme };
        if (d.theme) {
          document.documentElement.setAttribute('data-theme', d.theme.mode);
          document.documentElement.style.setProperty('--tvwebos-accent', d.theme.accent);
        }
        resolveReady(info);
        break;
      case 'response':
        var p = pending[d.id];
        if (!p) return;
        delete pending[d.id];
        if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error || 'Request failed'));
        break;
      case 'pointer':
        onPointer(d);
        break;
      case 'key':
        var target = document.activeElement || document.body;
        if (d.action === 'down' || d.action === 'press') target.dispatchEvent(makeKeyEvent('keydown', d.key));
        if (d.action === 'up' || d.action === 'press') target.dispatchEvent(makeKeyEvent('keyup', d.key));
        break;
      case 'gamepad':
        for (var i = 0; i < gamepadHandlers.length; i++) gamepadHandlers[i]({ buttons: d.buttons, axes: d.axes || [] });
        break;
      case 'text':
        applyText(d);
        break;
      case 'back':
        runBack();
        break;
      case 'visibility':
        for (var j = 0; j < focusHandlers.length; j++) focusHandlers[j](!!d.focused);
        break;
    }
  });

  var ready = new Promise(function (resolve) { resolveReady = resolve; });

  window.tvwebos = {
    version: 1,
    embedded: embedded,
    ready: ready,
    info: function () { return info; },
    storage: {
      get: function (key) { return request('storage.get', { key: String(key) }); },
      set: function (key, value) { return request('storage.set', { key: String(key), value: value }); },
      remove: function (key) { return request('storage.remove', { key: String(key) }); },
      keys: function () { return request('storage.keys'); }
    },
    notify: function (title, body) { return request('notify', { title: title, body: body }); },
    setTitle: function (title) { return request('setTitle', { title: String(title) }); },
    close: function () { return request('close'); },
    onKey: function (fn) { keyHandlers.push(fn); },
    onBack: function (fn) { backHandlers.push(fn); },
    onGamepad: function (fn) { gamepadHandlers.push(fn); },
    onFocusChange: function (fn) { focusHandlers.push(fn); },
    Buttons: { A: 0, B: 1, X: 2, Y: 3, L1: 4, R1: 5, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 },
    isPressed: function (state, bit) { return (state.buttons & (1 << bit)) !== 0; }
  };

  post({ type: 'ready' });
})();
