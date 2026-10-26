/*
 * Packaged webOS launcher for TV WebOS.
 *
 * This page runs as a real webOS app. It shows the desktop (served by the TV
 * WebOS server) in a full-screen iframe and answers a small, allow-listed set
 * of platform requests from it over postMessage:
 *
 *   hello       - handshake so the desktop knows it runs inside the launcher
 *   deviceInfo  - webOS.deviceInfo()                   (webOSTV.js)
 *   launch      - luna://com.webos.applicationManager  method "launch"
 *   exit        - webOS.platformBack()
 *
 * Requests are accepted only from the configured server origin. Nothing else
 * from the Luna bus is exposed. webOSTV.js must be downloaded from LG's
 * developer site and placed next to this file (see docs/WEBOS.md).
 */
(function () {
  'use strict';
  var KEY = 'tvwebos.launcher.server';
  var TAG = 'tvwebos-bridge';
  var frame = document.getElementById('frame');
  var setup = document.getElementById('setup');
  var addr = document.getElementById('addr');
  var err = document.getElementById('err');
  var origin = null;

  function normalize(v) {
    v = (v || '').trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
    var m = /^(https?:\/\/[^\/?#]+)/i.exec(v);
    return m ? m[1] : null;
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function start(server) {
    origin = server;
    setup.style.display = 'none';
    frame.style.display = 'block';
    frame.src = server + '/';
    frame.focus();
  }

  function showSetup(message) {
    frame.style.display = 'none';
    setup.style.display = 'flex';
    err.textContent = message || '';
    addr.value = stored() || window.TVWEBOS_SERVER || '';
    addr.focus();
  }

  function check(server, cb) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', server + '/api/info');
    xhr.timeout = 5000;
    xhr.onload = function () {
      try { cb(JSON.parse(xhr.responseText).name === 'TV WebOS'); } catch (e) { cb(false); }
    };
    xhr.onerror = xhr.ontimeout = function () { cb(false); };
    xhr.send();
  }

  document.getElementById('go').addEventListener('click', function () {
    var server = normalize(addr.value);
    if (!server) { err.textContent = 'Địa chỉ không hợp lệ.'; return; }
    err.textContent = 'Đang kiểm tra...';
    check(server, function (ok) {
      if (!ok) { err.textContent = 'Không kết nối được tới server TV WebOS tại ' + server; return; }
      try { localStorage.setItem(KEY, server); } catch (e) { /* ignore */ }
      start(server);
    });
  });
  addr.addEventListener('keydown', function (e) { if (e.keyCode === 13) document.getElementById('go').click(); });

  function reply(source, id, ok, result, error) {
    source.postMessage({ tag: TAG, id: id, ok: ok, result: result, error: error }, origin);
  }

  window.addEventListener('message', function (e) {
    if (!origin || e.origin !== origin || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.tag !== TAG || typeof d.id !== 'number') return;
    var w = window.webOS;
    switch (d.method) {
      case 'hello':
        reply(e.source, d.id, true, { webOSTV: !!w });
        break;
      case 'deviceInfo':
        if (!w || !w.deviceInfo) return reply(e.source, d.id, false, null, 'webOSTV.js is not loaded');
        w.deviceInfo(function (info) { reply(e.source, d.id, true, info); });
        break;
      case 'launch':
        var p = d.params || {};
        if (typeof p.id !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(p.id)) return reply(e.source, d.id, false, null, 'Invalid app id');
        if (!w || !w.service) return reply(e.source, d.id, false, null, 'webOSTV.js is not loaded');
        var params = {};
        if (p.params && typeof p.params === 'object') {
          Object.keys(p.params).forEach(function (k) { if (typeof p.params[k] === 'string') params[k] = p.params[k]; });
        }
        w.service.request('luna://com.webos.applicationManager', {
          method: 'launch',
          parameters: { id: p.id, params: params },
          onSuccess: function () { reply(e.source, d.id, true); },
          onFailure: function (r) { reply(e.source, d.id, false, null, (r && r.errorText) || 'Launch failed'); }
        });
        break;
      case 'exit':
        if (w && w.platformBack) { w.platformBack(); reply(e.source, d.id, true); }
        else reply(e.source, d.id, false, null, 'webOSTV.js is not loaded');
        break;
      default:
        reply(e.source, d.id, false, null, 'Method not allowed');
    }
  });

  // Keep keyboard focus in the desktop frame (remote keys go to the focused document).
  window.addEventListener('focus', function () { if (frame.style.display === 'block') frame.focus(); });

  var server = normalize(stored() || window.TVWEBOS_SERVER);
  if (!server) return showSetup();
  check(server, function (ok) {
    if (ok) start(server);
    else showSetup('Không kết nối được tới ' + server + '. Kiểm tra server đang chạy và cùng mạng.');
  });
})();
