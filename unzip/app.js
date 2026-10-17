import { Zip, ZipPassThrough } from './vendor/fflate.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

/* ---------------- Định dạng & kiểu tệp ---------------- */

const FORMATS = [
  ['ZIP', 1], ['RAR', 1], ['7Z', 1], ['TAR', 1], ['GZ', 0], ['TGZ', 0], ['BZ2', 0], ['XZ', 0], ['ZST', 0], ['LZMA', 0],
  ['ISO', 1], ['DMG', 0], ['CAB', 0], ['WIM', 0], ['LZH', 0], ['ARJ', 0], ['CPIO', 0], ['Z', 0], ['XAR/PKG', 0],
  ['RPM', 0], ['DEB', 0], ['MSI', 0], ['VHD', 0], ['SquashFS', 0], ['APK/IPA/JAR', 0], ['EPUB/DOCX', 0],
];

const EXT = {
  image: 'jpg jpeg png gif webp heic heif avif bmp svg ico tif tiff',
  video: 'mp4 m4v mov webm 3gp',
  audio: 'mp3 m4a aac wav flac ogg oga opus aif aiff caf',
  pdf: 'pdf',
  text: 'txt md markdown csv tsv log ini cfg conf nfo srt ass ssa vtt rtf readme license',
  code: 'json xml html htm css js mjs ts tsx jsx py rb php java kt c h cpp hpp cs go rs swift sh bat ps1 yml yaml toml sql lua gradle plist properties',
  archive: '7z zip rar tar gz tgz bz2 tbz tbz2 xz txz zst tzst lzma iso dmg cab wim lzh lha arj cpio z xar pkg rpm deb msi vhd vhdx squashfs apk ipa jar r00 001',
  app: 'exe dll app ipa apk msi',
};
const EXT_KIND = {};
for (const k of Object.keys(EXT)) for (const e of EXT[k].split(' ')) if (!EXT_KIND[e]) EXT_KIND[e] = k;
// Các tệp nén "hiển nhiên" có thể mở lồng bên trong
const NESTABLE = new Set('7z zip rar tar gz tgz bz2 tbz tbz2 xz txz zst tzst lzma iso dmg cab wim lzh lha arj cpio z xar pkg rpm deb vhd vhdx squashfs apk ipa jar epub'.split(' '));
const STREAM_TYPES = new Set(['gzip', 'bzip2', 'xz', 'zstd', 'lzma', 'lzma86', 'z', 'lz', 'lz4', 'brotli']);

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', zip: 'application/zip', '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar', gz: 'application/gzip', tar: 'application/x-tar', epub: 'application/epub+zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf', srt: 'text/plain', log: 'text/plain', ipa: 'application/octet-stream',
};

const extOf = (name) => {
  const n = name.toLowerCase();
  const i = n.lastIndexOf('.');
  if (i <= 0) return n === 'readme' || n === 'license' ? n : '';
  return n.slice(i + 1);
};
const kindOf = (name) => EXT_KIND[extOf(name)] || 'file';
const mimeOf = (name) => MIME[extOf(name)] || 'application/octet-stream';
const KIND_ICON = { image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', text: 'text', code: 'code', archive: 'archive', app: 'app', file: 'file', folder: 'folder' };

function fmtSize(n) {
  if (!n) return '0 byte';
  if (n < 1024) return n + ' byte';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)).replace('.', ',') + ' ' + u[i];
}
function parseDate(s) {
  const m = s && s.match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)(?::(\d\d))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return isNaN(d) ? null : d;
}
function fmtDate(d) {
  if (!d) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

/* ---------------- Engine (Web Worker) ---------------- */

const ERR_TEXT = {
  NOT_ARCHIVE: 'Không nhận ra định dạng tệp nén này, hoặc đây không phải tệp nén.',
  CORRUPT: 'Tệp nén bị hỏng hoặc thiếu phần. Với tệp chia phần, hãy chọn đủ tất cả các phần cùng một lúc.',
  PASSWORD: 'Sai mật khẩu.',
  PASSWORD_OR_CORRUPT: 'Không mở được tệp: có thể cần mật khẩu, hoặc tệp bị hỏng.',
  MEMORY: 'Không đủ bộ nhớ. Hãy thử lấy ra từng thư mục hoặc từng tệp thay vì toàn bộ.',
  UNKNOWN: 'Đã có lỗi xảy ra.',
  CANCELLED: 'Đã huỷ.',
};

class EngineError extends Error {
  constructor(kind, detail) { super(ERR_TEXT[kind] || ERR_TEXT.UNKNOWN); this.kind = kind; this.detail = detail || ''; }
}

const engine = {
  worker: null,
  seq: 0,
  pending: new Map(),
  get() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const { id, progress, result } = e.data;
        const p = this.pending.get(id);
        if (!p) return;
        if (progress !== undefined) { p.onProgress && p.onProgress(progress); return; }
        this.pending.delete(id);
        p.resolve(result);
      };
      this.worker.onerror = (e) => {
        e.preventDefault && e.preventDefault();
        this.reset(new EngineError('UNKNOWN', e.message || 'worker error'));
      };
    }
    return this.worker;
  },
  call(op, payload, onProgress) {
    const id = ++this.seq;
    const w = this.get();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      w.postMessage({ id, op, payload });
    });
  },
  reset(err) {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(err || new EngineError('CANCELLED'));
    this.pending.clear();
  },
};

/* ---------------- Trạng thái ---------------- */

const state = {
  stack: [], // các tệp nén đang mở (lồng nhau)
  selecting: false,
  selected: new Set(),
  query: '',
  sort: 'name', // name | size | date
};
const cur = () => state.stack[state.stack.length - 1];

function buildTree(entries) {
  const root = { name: '', path: '', isDir: true, children: new Map(), size: 0, count: 0 };
  const ensureDir = (parts) => {
    let node = root;
    let p = '';
    for (const part of parts) {
      p = p ? p + '/' + part : part;
      let c = node.children.get(part);
      if (!c) {
        c = { name: part, path: p, isDir: true, children: new Map(), size: 0, count: 0, implicit: true, parent: node };
        node.children.set(part, c);
      } else if (!c.isDir) {
        break;
      }
      node = c;
    }
    return node;
  };
  const files = [];
  for (const e of entries) {
    const clean = e.path.replace(/^\.\/+/, '').replace(/\/+$/, '');
    if (!clean || clean === '.') continue;
    const parts = clean.split('/').filter((x) => x && x !== '.');
    if (!parts.length) continue;
    const name = parts.pop();
    const parent = ensureDir(parts);
    if (e.isDir) {
      const d = ensureDir([...parts, name]);
      d.implicit = false;
      d.mtime = parseDate(e.mtime);
      d.rawPath = e.path;
    } else {
      const f = { name, path: clean, rawPath: e.path, isDir: false, size: e.size, packed: e.packed, mtime: parseDate(e.mtime), encrypted: e.encrypted, link: e.link, parent };
      parent.children.set(name, f);
      files.push(f);
    }
  }
  // Tổng kích thước và số tệp của mỗi thư mục
  const agg = (n) => {
    let size = 0, count = 0;
    for (const c of n.children.values()) {
      if (c.isDir) { agg(c); size += c.size; count += c.count; } else { size += c.size; count += 1; }
    }
    n.size = size; n.count = count;
  };
  agg(root);
  return { root, files };
}

function filesUnder(node) {
  if (!node.isDir) return [node];
  const out = [];
  const walk = (n) => { for (const c of n.children.values()) c.isDir ? walk(c) : out.push(c); };
  walk(node);
  return out;
}

/* ---------------- Mở tệp ---------------- */

const VOL_RE = /(\.part0*\d+\.rar|\.r\d\d|\.z\d\d|\.\d{3})$/i;
function stemOf(name) {
  return name.toLowerCase().replace(VOL_RE, '').replace(/\.(rar|zip|7z)$/i, '');
}
function pickMain(files) {
  if (files.length === 1) return { main: files[0], files };
  const stems = new Set(files.map((f) => stemOf(f.name)));
  if (stems.size > 1) return { main: files[0], files: [files[0]], multi: true };
  const by = (re) => files.find((f) => re.test(f.name));
  const main = by(/\.part0*1\.rar$/i) || by(/\.001$/) || by(/\.rar$/i) || by(/\.zip$/i) || by(/\.7z$/i) || [...files].sort((a, b) => collator.compare(a.name, b.name))[0];
  return { main, files };
}

// Tên trong WORKERFS phải duy nhất
function uniqueFiles(files) {
  const seen = new Set();
  return files.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)));
}

async function openFiles(list, { nestedFrom, silentFail } = {}) {
  let files = uniqueFiles(Array.from(list || []).filter(Boolean));
  if (!files.length) return;
  const pick = pickMain(files);
  files = pick.files;
  const main = pick.main;
  if (pick.multi) toast('Đã chọn nhiều tệp khác nhau, đang mở tệp đầu tiên.');

  let password = '';
  let res;
  hud.show('Đang đọc ' + (files.length > 1 ? files.length + ' phần' : 'tệp'), main.name);
  try {
    for (let attempt = 0; ; attempt++) {
      res = await engine.call('list', { files, main: main.name, password });
      if (res.ok) break;
      if (res.kind === 'PASSWORD' || res.kind === 'PASSWORD_OR_CORRUPT') {
        hud.hide();
        const pw = await askPassword(main.name, attempt > 0 ? 'Sai mật khẩu, hãy thử lại.' : (res.kind === 'PASSWORD_OR_CORRUPT' ? 'Tệp này có thể được mã hoá cả danh sách tệp. Nhập mật khẩu để mở.' : ''));
        if (pw === null) return;
        password = pw;
        hud.show('Đang mở', main.name);
        continue;
      }
      throw new EngineError(res.kind, res.message);
    }
  } catch (e) {
    hud.hide();
    if (e.kind !== 'CANCELLED' && !silentFail) toast(e.message, true);
    return;
  }
  hud.hide();

  const { root, files: allFiles } = buildTree(res.entries);
  const ctx = {
    name: main.name, files, main, password,
    type: res.type, method: res.method, solid: res.solid, warning: res.warning,
    root, all: allFiles, cwd: root,
    encrypted: allFiles.some((f) => f.encrypted),
    cache: new Map(), cacheBytes: 0,
    nestedFrom: nestedFrom || null,
  };

  // .tar.gz, .tar.xz...: mở luôn lớp tar bên trong
  const t = (res.type || '').toLowerCase();
  if (STREAM_TYPES.has(t) && allFiles.length === 1) {
    const inner = allFiles[0];
    const ie = extOf(inner.name);
    if (ie === 'tar' || NESTABLE.has(ie) || !ie) {
      try {
        const [f] = await extractNodes(ctx, [inner], { label: 'Đang giải nén lớp ngoài', quiet: true });
        if (f) {
          const innerFile = new File([f.blob], inner.name, { type: f.blob.type });
          const before = state.stack.length;
          await openFiles([innerFile], { nestedFrom: nestedFrom || null, silentFail: true });
          if (state.stack.length > before) {
            cur().displayName = main.name;
            cur().outerType = res.type;
            render(); return;
          }
        }
      } catch (_) { /* tiếp tục hiện lớp ngoài */ }
    }
  }

  pushArchive(ctx);
}

function pushArchive(ctx) {
  state.stack.push(ctx);
  state.query = '';
  $('q').value = '';
  exitSelect();
  navPush();
  showBrowser();
  render('in');
}

/* ---------------- Giải nén ---------------- */

const CACHE_LIMIT = 300 * 1024 * 1024;
function cachePut(ctx, path, blob) {
  if (ctx.cache.has(path)) return;
  ctx.cache.set(path, blob);
  ctx.cacheBytes += blob.size;
  for (const [k, v] of ctx.cache) {
    if (ctx.cacheBytes <= CACHE_LIMIT) break;
    ctx.cache.delete(k); ctx.cacheBytes -= v.size;
  }
}

async function ensurePassword(ctx, nodes) {
  if (ctx.password || !nodes.some((n) => n.encrypted)) return true;
  const pw = await askPassword(ctx.displayName || ctx.name, 'Các tệp bên trong được mã hoá.');
  if (pw === null) return false;
  ctx.password = pw;
  return true;
}

// Trả về [{node, path, blob}]
// raw: trả về Uint8Array (dùng để đóng gói ZIP nhanh, không qua Blob)
async function extractNodes(ctx, nodes, { label = 'Đang giải nén', quiet = false, onProgress, raw = false } = {}) {
  const out = [];
  const need = [];
  for (const n of nodes) {
    const b = ctx.cache.get(n.path);
    if (b) out.push({ node: n, path: n.path, blob: b }); else need.push(n);
  }
  if (!need.length) return out;
  if (!(await ensurePassword(ctx, need))) throw new EngineError('CANCELLED');

  const all = need.length === ctx.all.length;
  const total = need.reduce((s, n) => s + n.size, 0);
  const useHud = !onProgress;
  for (let attempt = 0; ; attempt++) {
    if (useHud) hud.show(label, need.length === 1 ? need[0].name : `${need.length} tệp · ${fmtSize(total)}`, true);
    let res;
    try {
      res = await engine.call('extract', {
        files: ctx.files, main: ctx.main.name, password: ctx.password,
        paths: all ? null : need.map((n) => n.rawPath || n.path),
      }, (p) => (onProgress ? onProgress(p) : hud.progress(p)));
    } finally {
      if (useHud) hud.hide();
    }
    if (!res.ok && res.kind === 'PASSWORD' && !quiet) {
      const pw = await askPassword(ctx.displayName || ctx.name, 'Sai mật khẩu, hãy thử lại.');
      if (pw === null) throw new EngineError('CANCELLED');
      ctx.password = pw;
      continue;
    }
    if (!res.ok) throw new EngineError(res.kind, res.message);
    const byPath = new Map();
    for (const f of res.files) byPath.set(f.path.replace(/^\.\/+/, ''), f.data);
    for (const n of need) {
      let data = byPath.get(n.path) || byPath.get(n.rawPath);
      if (!data && need.length === 1 && res.files.length === 1) data = res.files[0].data;
      if (!data) continue;
      if (raw) { out.push({ node: n, path: n.path, data, size: data.length }); continue; }
      const blob = new Blob([data], { type: mimeOf(n.name) });
      cachePut(ctx, n.path, blob);
      out.push({ node: n, path: n.path, blob });
    }
    if (res.partialError) toast((ERR_TEXT[res.partialError] || ERR_TEXT.UNKNOWN) + ' Một số tệp không lấy ra được.', true);
    if (!out.length) throw new EngineError(res.partialError || 'UNKNOWN', res.message);
    return out;
  }
}

async function buildZip(items, onProgress) {
  const parts = [];
  let chunks = [];
  let failed = null;
  const zip = new Zip((err, chunk) => { if (err) failed = err; else chunks.push(chunk); });
  let done = 0, pending = 0, lastYield = performance.now();
  const total = items.reduce((s, i) => s + (i.data ? i.data.length : i.blob.size), 0) || 1;
  for (const it of items) {
    const f = new ZipPassThrough(it.zipPath);
    const y = it.node.mtime ? it.node.mtime.getFullYear() : 0;
    if (y >= 1980 && y <= 2099) f.mtime = it.node.mtime;
    zip.add(f);
    const buf = it.data || new Uint8Array(await it.blob.arrayBuffer());
    it.data = null;
    f.push(buf, true);
    done += buf.length;
    pending += buf.length;
    // Gom thành Blob theo lô để trả bớt bộ nhớ mà không tạo quá nhiều Blob nhỏ
    if (pending > 16 * 1024 * 1024) { parts.push(new Blob(chunks)); chunks = []; pending = 0; }
    if (failed) throw failed;
    if (performance.now() - lastYield > 50) {
      onProgress && onProgress(Math.round((done / total) * 100));
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  }
  zip.end();
  if (chunks.length) parts.push(new Blob(chunks));
  if (failed) throw failed;
  return new Blob(parts, { type: 'application/zip' });
}

/* ---------------- Lưu / chia sẻ ---------------- */

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function toFiles(items) {
  return items.map((it) => new File([it.blob], it.name || it.node.name, { type: it.blob.type || mimeOf(it.name || it.node.name), lastModified: it.node && it.node.mtime ? +it.node.mtime : Date.now() }));
}
function canShareFiles(files) {
  try { return !!(navigator.canShare && navigator.canShare({ files })); } catch (_) { return false; }
}
async function shareFiles(files) {
  if (canShareFiles(files)) {
    try { await navigator.share({ files }); return true; }
    catch (e) {
      if (e && e.name === 'AbortError') return true;
      // Một số loại tệp bị từ chối: thử lại với kiểu chung
      try {
        const generic = files.map((f) => new File([f], f.name, { type: 'application/octet-stream' }));
        await navigator.share({ files: generic }); return true;
      } catch (e2) { if (e2 && e2.name === 'AbortError') return true; }
    }
  }
  return false;
}
function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = el('a');
  a.href = url; a.download = file.name; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ---------------- Giao diện: danh sách ---------------- */

let renderToken = 0;
let io = null;

function visibleItems() {
  const ctx = cur();
  if (state.query) {
    const q = fold(state.query.trim());
    const res = [];
    const walk = (n) => {
      for (const c of n.children.values()) {
        if (fold(c.name).includes(q)) res.push(c);
        if (c.isDir) walk(c);
      }
    };
    walk(ctx.cwd);
    return sortItems(res);
  }
  return sortItems([...ctx.cwd.children.values()]);
}
function sortItems(items) {
  const s = state.sort;
  return items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    if (s === 'size') return b.size - a.size || collator.compare(a.name, b.name);
    if (s === 'date') return (b.mtime ? +b.mtime : 0) - (a.mtime ? +a.mtime : 0) || collator.compare(a.name, b.name);
    return collator.compare(a.name, b.name);
  });
}

function rowHTML(n, showPath) {
  const k = n.isDir ? 'folder' : kindOf(n.name);
  const meta = n.isDir
    ? `${n.count} tệp · ${fmtSize(n.size)}`
    : [fmtSize(n.size), fmtDate(n.mtime)].filter(Boolean).join(' · ');
  const where = showPath && n.parent && n.parent.path ? ` · ${esc(n.parent.path)}` : '';
  return `<span class="sel-box">${icon('check')}</span>`
    + `<span class="ic ${k}">${icon(KIND_ICON[k])}${n.encrypted ? `<span class="lock">${icon('lock')}</span>` : ''}</span>`
    + `<span class="r-main"><span class="r-name">${esc(n.name)}</span><span class="r-meta">${meta}${where}</span></span>`
    + `<span class="r-end">${n.isDir ? `<span class="chev">${icon('chev')}</span>` : ''}</span>`;
}

function render(dir) {
  const ctx = cur();
  if (!ctx) return;
  const token = ++renderToken;
  const list = $('list');
  const items = visibleItems();
  const searching = !!state.query;

  // Tiêu đề
  const atRoot = ctx.cwd === ctx.root;
  $('title').textContent = atRoot ? (ctx.displayName || ctx.name) : ctx.cwd.name;
  $('subtitle').textContent = atRoot
    ? `${(ctx.outerType ? ctx.outerType + ' + ' : '') + (ctx.type || 'Tệp nén')} · ${fmtSize(ctx.main.size)}`
    : '/' + ctx.cwd.path;
  let backLabel = 'Đóng';
  if (!atRoot) backLabel = ctx.cwd.parent && ctx.cwd.parent !== ctx.root ? ctx.cwd.parent.name : (ctx.displayName || ctx.name);
  else if (state.stack.length > 1) backLabel = 'Quay lại';
  $('back-label').textContent = backLabel;

  // Dòng thông tin
  const info = $('info');
  const scope = ctx.cwd;
  info.innerHTML = searching
    ? `<span>${items.length >= 500 ? 'Hơn 500' : items.length} kết quả cho “${esc(state.query)}”</span>`
    : `<span>${scope.count} tệp · ${fmtSize(scope.size)}${atRoot && ctx.main.size ? ` · nén ${fmtSize(ctx.main.size)}` : ''}</span>`
      + (atRoot && ctx.encrypted ? `<span class="badge">${icon('lock')} Có mật khẩu</span>` : '')
      + (atRoot && ctx.solid ? `<span class="badge">Solid</span>` : '')
      + (atRoot && ctx.warning ? `<span class="warn">${esc(ctx.warning)}</span>` : '');
  $('extract-label').textContent = atRoot ? 'Giải nén tất cả' : 'Giải nén thư mục';
  $('extract-all').disabled = scope.count === 0;

  list.innerHTML = '';
  if (io) { io.disconnect(); io = null; }
  if (!items.length) {
    list.innerHTML = `<li class="empty">${searching ? 'Không tìm thấy tệp nào.' : 'Thư mục trống.'}</li>`;
  } else {
    const shown = searching ? items.slice(0, 500) : items;
    let i = 0;
    const CHUNK = 120;
    const addChunk = () => {
      if (token !== renderToken) return;
      const frag = document.createDocumentFragment();
      const end = Math.min(i + CHUNK, shown.length);
      for (; i < end; i++) {
        const n = shown[i];
        const li = el('li', 'row' + (state.selected.has(n) ? ' sel' : ''), rowHTML(n, searching));
        li._node = n;
        frag.appendChild(li);
      }
      list.appendChild(frag);
      if (i < shown.length) {
        io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); addChunk(); } }, { rootMargin: '800px' });
        io.observe(list.lastElementChild);
      }
    };
    addChunk();
  }
  if (dir) {
    list.classList.remove('slide-in', 'slide-back');
    void list.offsetWidth;
    list.classList.add(dir === 'in' ? 'slide-in' : 'slide-back');
  }
  updateSelUI();
}

function showBrowser() {
  $('home').hidden = true;
  $('browser').hidden = false;
}
function showHome() {
  $('browser').hidden = true;
  $('home').hidden = false;
  exitSelect();
}

/* ---------------- Điều hướng & lịch sử ---------------- */

// Mỗi bước vào thư mục / tệp nén đẩy 1 mục lịch sử, để vuốt "quay lại" hoạt động
let navDepth = 0;
function navPush() { navDepth++; history.pushState({ d: navDepth }, ''); }
function goBack() { history.back(); }
window.addEventListener('popstate', () => {
  closeSheet();
  navDepth = Math.max(0, navDepth - 1);
  popLevel();
});
function popLevel() {
  const ctx = cur();
  if (!ctx) { showHome(); return; }
  state.query = ''; $('q').value = ''; $('q-clear').hidden = true;
  exitSelect();
  if (ctx.cwd !== ctx.root) {
    ctx.cwd = ctx.cwd.parent || ctx.root;
    render('back');
    return;
  }
  state.stack.pop();
  if (!state.stack.length) { showHome(); return; }
  render('back');
}
function enterDir(node) {
  const ctx = cur();
  ctx.cwd = node;
  state.query = ''; $('q').value = ''; $('q-clear').hidden = true;
  navPush();
  render('in');
  window.scrollTo(0, 0);
}

/* ---------------- Chọn nhiều ---------------- */

function enterSelect() { state.selecting = true; state.selected.clear(); $('browser').classList.add('selecting'); updateSelUI(); }
function exitSelect() {
  state.selecting = false; state.selected.clear();
  $('browser').classList.remove('selecting');
  for (const r of document.querySelectorAll('.row.sel')) r.classList.remove('sel');
  updateSelUI();
}
function updateSelUI() {
  let files = 0, size = 0;
  for (const n of state.selected) { const fs = filesUnder(n); files += fs.length; size += fs.reduce((s, f) => s + f.size, 0); }
  $('sel-count').textContent = state.selected.size ? `${files} tệp · ${fmtSize(size)}` : 'Chưa chọn';
  $('sel-go').disabled = files === 0;
}

/* ---------------- Sheet ---------------- */

let sheetCleanup = null;
function openSheet(html, onMount) {
  const wrap = $('sheet-wrap');
  const body = $('sheet-body');
  if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
  body.innerHTML = html;
  body.scrollTop = 0;
  wrap.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  if (onMount) sheetCleanup = onMount(body) || null;
}
function closeSheet() {
  const wrap = $('sheet-wrap');
  if (wrap.hidden) return false;
  wrap.classList.remove('open');
  const sheet = wrap.querySelector('.sheet');
  sheet.style.transform = '';
  setTimeout(() => {
    if (!wrap.classList.contains('open')) {
      wrap.hidden = true;
      if (sheetCleanup) { sheetCleanup(); sheetCleanup = null; }
      $('sheet-body').innerHTML = '';
    }
  }, 320);
  return false;
}
$('sheet-wrap').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

// Kéo grabber xuống để đóng
(() => {
  const sheet = document.querySelector('.sheet');
  const grab = document.querySelector('.grabber');
  let y0 = null, dy = 0;
  grab.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; sheet.style.transition = 'none'; }, { passive: true });
  grab.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
  grab.addEventListener('touchend', () => {
    sheet.style.transition = '';
    if (dy > 90) closeSheet(); else sheet.style.transform = '';
    y0 = null;
  });
})();

function headHTML(n, sub) {
  const k = n.isDir ? 'folder' : kindOf(n.name);
  return `<div class="sh-head"><span class="ic ${k}">${icon(KIND_ICON[k])}</span>`
    + `<div><div class="sh-name">${esc(n.name)}</div><div class="sh-meta">${sub}</div></div>`
    + `<button class="sh-close" data-close aria-label="Đóng">${icon('x')}</button></div>`;
}

async function readTextPreview(blob) {
  const max = 512 * 1024;
  const buf = new Uint8Array(await blob.slice(0, max).arrayBuffer());
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (_) {
    if (buf.length === max) { try { text = new TextDecoder('utf-8').decode(buf); } catch (_) {} }
    if (text === undefined) {
      let bin = 0;
      for (let i = 0; i < Math.min(buf.length, 4096); i++) if (buf[i] === 0) bin++;
      if (bin > 4) return null;
      text = new TextDecoder('windows-1258').decode(buf);
    }
  }
  return text + (blob.size > max ? '\n\n… (chỉ hiện 512 KB đầu)' : '');
}

function openFileSheet(node) {
  const ctx = cur();
  const k = kindOf(node.name);
  const sub = [fmtSize(node.size), fmtDate(node.mtime), node.parent && node.parent.path ? '/' + node.parent.path : ''].filter(Boolean).map(esc).join(' · ');
  const nestable = NESTABLE.has(extOf(node.name));
  openSheet(
    headHTML(node, sub)
    + `<div class="preview" id="pv"><div class="pv-loading"><div class="bar indet" id="pv-bar"><i></i></div><span id="pv-txt">Đang giải nén…</span></div></div>`
    + `<div class="actions">`
    + (nestable ? `<button class="btn primary" id="a-open" disabled>${icon('archive')}Mở tệp nén bên trong</button>` : '')
    + `<button class="btn ${nestable ? '' : 'primary'}" id="a-share" disabled>${icon('share')}Lưu / Chia sẻ</button>`
    + `<button class="btn" id="a-dl" disabled>${icon('down')}Tải xuống</button>`
    + `</div><p class="note">“Lưu / Chia sẻ” mở bảng chia sẻ của iOS: chọn “Lưu vào Tệp”, “Lưu ảnh/video” hoặc gửi sang ứng dụng khác.</p>`,
    (body) => {
      let alive = true;
      let url = null;
      let file = null;
      const pv = body.querySelector('#pv');
      const enable = () => body.querySelectorAll('.btn').forEach((b) => (b.disabled = false));
      (async () => {
        let got;
        try {
          [got] = await extractNodes(ctx, [node], {
            onProgress: (p) => {
              const bar = body.querySelector('#pv-bar');
              if (!bar) return;
              bar.classList.remove('indet');
              bar.firstElementChild.style.width = p + '%';
              body.querySelector('#pv-txt').textContent = `Đang giải nén… ${p}%`;
            },
          });
        } catch (e) {
          if (!alive) return;
          if (e.kind === 'CANCELLED') { closeSheet(); return; }
          pv.innerHTML = `<div class="ph"><span class="big" style="color:var(--red)">${icon('x')}</span>${esc(e.message)}</div>`;
          return;
        }
        if (!alive || !got) return;
        file = new File([got.blob], node.name, { type: got.blob.type, lastModified: node.mtime ? +node.mtime : Date.now() });
        enable();
        url = URL.createObjectURL(file);
        if (k === 'image') pv.innerHTML = `<img alt="" src="${url}">`;
        else if (k === 'video') pv.innerHTML = `<video src="${url}" controls playsinline preload="metadata"></video>`;
        else if (k === 'audio') pv.innerHTML = `<audio src="${url}" controls preload="metadata"></audio>`;
        else if (k === 'pdf') pv.innerHTML = `<iframe src="${url}" title="PDF"></iframe>`;
        else if (k === 'text' || k === 'code' || (file.size < 2_000_000 && k === 'file')) {
          const t = await readTextPreview(file);
          if (!alive) return;
          if (t !== null) { pv.innerHTML = `<pre class="${k === 'code' ? 'mono' : ''}"></pre>`; pv.firstChild.textContent = t; }
          else pv.innerHTML = `<div class="ph"><span class="big">${icon('file')}</span>Không xem trước được loại tệp này.</div>`;
        } else {
          pv.innerHTML = `<div class="ph"><span class="big">${icon(KIND_ICON[k])}</span>${nestable ? 'Đây là tệp nén, có thể mở tiếp ngay trong ứng dụng.' : 'Không xem trước được loại tệp này.'}</div>`;
        }
        const img = pv.querySelector('img');
        if (img) img.onerror = () => { pv.innerHTML = `<div class="ph"><span class="big">${icon('image')}</span>Safari không hiển thị được ảnh này, nhưng vẫn lưu được.</div>`; };
      })();
      body.querySelector('#a-share').onclick = async () => {
        if (!file) return;
        if (!(await shareFiles([file]))) { downloadFile(file); }
      };
      body.querySelector('#a-dl').onclick = () => file && downloadFile(file);
      const ob = body.querySelector('#a-open');
      if (ob) ob.onclick = () => {
        if (!file) return;
        const f = file;
        closeSheet();
        openFiles([f], { nestedFrom: ctx });
      };
      return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    },
  );
}

// Sheet hành động khi giải nén nhiều tệp
function openExtractMenu(nodes, title) {
  const files = nodes.flatMap(filesUnder);
  const size = files.reduce((s, f) => s + f.size, 0);
  const many = files.length > 60;
  openSheet(
    `<div class="sh-head"><span class="ic archive">${icon('archive')}</span><div><div class="sh-name">${esc(title)}</div><div class="sh-meta">${files.length} tệp · ${fmtSize(size)}</div></div><button class="sh-close" data-close aria-label="Đóng">${icon('x')}</button></div>`
    + `<div class="menu">`
    + `<button class="mi" id="m-zip"><span class="f-ic f-green">${icon('zip')}</span><div><b>Lưu thành tệp ZIP</b><small>Giữ nguyên thư mục. Ứng dụng Tệp mở ZIP được ngay.</small></div></button>`
    + `<button class="mi" id="m-share"><span class="f-ic f-blue">${icon('share')}</span><div><b>Lưu từng tệp</b><small>${many ? 'Nhiều tệp: nên dùng ZIP. ' : ''}Lưu vào Tệp, Ảnh hoặc gửi đi (không giữ thư mục).</small></div></button>`
    + `</div>`
    + (size > 1.5 * 1024 ** 3 ? `<p class="note" style="color:var(--orange)">Dung lượng lớn (${fmtSize(size)}) có thể vượt quá bộ nhớ Safari cho phép. Nếu lỗi, hãy lấy ra từng thư mục.</p>` : ''),
    (body) => {
      body.querySelector('#m-zip').onclick = () => runBatch(files, 'zip', title);
      body.querySelector('#m-share').onclick = () => runBatch(files, 'share', title);
    },
  );
}

async function runBatch(files, mode, title) {
  const ctx = cur();
  closeSheet();
  let got;
  try {
    got = await extractNodes(ctx, files, { label: 'Đang giải nén', raw: mode === 'zip' });
  } catch (e) {
    if (e.kind !== 'CANCELLED') toast(e.message, true);
    return;
  }
  const base = ctx.cwd === ctx.root || !ctx.cwd.path ? '' : ctx.cwd.path + '/';
  const rel = (p) => (base && p.startsWith(base) ? p.slice(base.length) : p);
  let outFiles;
  if (mode === 'zip') {
    let blob;
    hud.show('Đang tạo ZIP', `${got.length} tệp`, true, false);
    for (const g of got) g.zipPath = rel(g.path);
    const items = got;
    got = null; // để buildZip giải phóng từng tệp ngay sau khi đóng gói
    try {
      blob = await buildZip(items, (p) => hud.progress(p));
    } catch (e) {
      hud.hide();
      toast('Không tạo được ZIP: ' + (e.message || e), true);
      return;
    }
    hud.hide();
    const stem = (ctx.displayName || ctx.name).replace(VOL_RE, '').replace(/\.(tar\.)?[^.]+$/i, '') || 'giai-nen';
    const name = (title && title !== (ctx.displayName || ctx.name) ? `${stem} - ${title}` : stem).replace(/[\\/:*?"<>|]/g, '_') + '.zip';
    outFiles = [new File([blob], name, { type: 'application/zip' })];
  } else {
    outFiles = toFiles(got.map((g) => ({ ...g, name: g.node.name })));
  }
  showReady(outFiles, mode);
}

// Bảng chia sẻ cần một lần chạm mới của người dùng, nên hiện sheet "Sẵn sàng"
function showReady(files, mode) {
  const size = files.reduce((s, f) => s + f.size, 0);
  const one = files.length === 1;
  openSheet(
    `<div class="sh-head"><span class="ic ${one ? kindOf(files[0].name) : 'archive'}" style="${one ? '' : ''}">${icon(one ? KIND_ICON[kindOf(files[0].name)] : 'archive')}</span>`
    + `<div><div class="sh-name">${one ? esc(files[0].name) : files.length + ' tệp đã sẵn sàng'}</div><div class="sh-meta">${fmtSize(size)}</div></div>`
    + `<button class="sh-close" data-close aria-label="Đóng">${icon('x')}</button></div>`
    + `<div class="actions"><button class="btn primary" id="r-share">${icon('share')}${one ? 'Lưu / Chia sẻ' : 'Lưu ' + files.length + ' tệp'}</button>`
    + (one ? `<button class="btn" id="r-dl">${icon('down')}Tải xuống</button>` : '')
    + `</div><p class="note">${mode === 'zip' ? 'Chọn “Lưu vào Tệp”. Sau đó chạm vào tệp ZIP trong ứng dụng Tệp để iOS tự giải nén.' : 'Chọn “Lưu vào Tệp” hoặc “Lưu ảnh/video”.'}</p>`,
    (body) => {
      body.querySelector('#r-share').onclick = async () => {
        const ok = await shareFiles(files);
        if (!ok) {
          if (one) downloadFile(files[0]);
          else toast('Thiết bị không cho chia sẻ nhiều tệp như vậy. Hãy dùng “Lưu thành ZIP”.', true);
        }
      };
      const dl = body.querySelector('#r-dl');
      if (dl) dl.onclick = () => downloadFile(files[0]);
    },
  );
}

/* ---------------- HUD tiến trình ---------------- */

const hud = {
  show(label, sub = '', determinate = false, cancellable = true) {
    $('hud-label').textContent = label;
    $('hud-sub').textContent = sub;
    $('hud-pct').textContent = determinate ? '0%' : '';
    $('ring').style.strokeDashoffset = 169.65;
    document.querySelector('.hud').classList.toggle('indet', !determinate);
    $('hud-cancel').hidden = !cancellable;
    clearTimeout(this._t);
    // Hoãn một chút để thao tác nhanh không bị nháy
    this._t = setTimeout(() => { $('hud').hidden = false; }, 150);
  },
  progress(p) {
    document.querySelector('.hud').classList.remove('indet');
    $('hud-pct').textContent = p + '%';
    $('ring').style.strokeDashoffset = 169.65 * (1 - p / 100);
  },
  hide() { clearTimeout(this._t); $('hud').hidden = true; },
};
$('hud-cancel').onclick = () => { engine.reset(new EngineError('CANCELLED')); hud.hide(); };

/* ---------------- Hộp mật khẩu ---------------- */

function askPassword(name, msg) {
  return new Promise((resolve) => {
    const wrap = $('pw-wrap');
    const input = $('pw');
    $('pw-title').textContent = 'Cần mật khẩu';
    const m = $('pw-msg');
    m.textContent = msg || `“${name}” được bảo vệ bằng mật khẩu.`;
    m.classList.toggle('err', /^Sai/.test(msg || ''));
    input.value = '';
    input.type = 'password';
    $('pw-eye').classList.remove('on');
    wrap.hidden = false;
    setTimeout(() => input.focus(), 50);
    const done = (v) => {
      wrap.hidden = true;
      $('pw-form').onsubmit = null;
      $('pw-cancel').onclick = null;
      input.blur();
      resolve(v);
    };
    $('pw-form').onsubmit = (e) => { e.preventDefault(); if (input.value) done(input.value); };
    $('pw-cancel').onclick = () => done(null);
  });
}
$('pw-eye').onclick = () => {
  const i = $('pw');
  i.type = i.type === 'password' ? 'text' : 'password';
  $('pw-eye').classList.toggle('on', i.type === 'text');
};

/* ---------------- Toast ---------------- */

let toastT;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), err ? 4500 : 2600);
}
$('toast').onclick = () => ($('toast').hidden = true);

/* ---------------- Sự kiện ---------------- */

$('pick').onclick = () => $('file').click();
$('file').onchange = (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  openFiles(files);
};

$('back').onclick = () => goBack();

$('list').addEventListener('click', (e) => {
  const li = e.target.closest('.row');
  if (!li || !li._node) return;
  const n = li._node;
  if (state.selecting) {
    if (state.selected.has(n)) state.selected.delete(n); else state.selected.add(n);
    li.classList.toggle('sel');
    updateSelUI();
    return;
  }
  if (n.isDir) enterDir(n);
  else openFileSheet(n);
});

// Nhấn giữ: vào chế độ chọn
(() => {
  let t = null, startX = 0, startY = 0, fired = false;
  const list = $('list');
  list.addEventListener('touchstart', (e) => {
    const li = e.target.closest('.row');
    if (!li || !li._node) return;
    fired = false;
    startX = e.touches[0].clientX; startY = e.touches[0].clientY;
    t = setTimeout(() => {
      fired = true;
      if (!state.selecting) enterSelect();
      if (!state.selected.has(li._node)) { state.selected.add(li._node); li.classList.add('sel'); updateSelUI(); }
    }, 480);
  }, { passive: true });
  list.addEventListener('touchmove', (e) => {
    if (!t) return;
    const dx = e.touches[0].clientX - startX, dy = e.touches[0].clientY - startY;
    if (dx * dx + dy * dy > 100) { clearTimeout(t); t = null; }
  }, { passive: true });
  list.addEventListener('touchend', (e) => { clearTimeout(t); t = null; if (fired) { e.preventDefault(); fired = false; } });
  list.addEventListener('contextmenu', (e) => { if (e.target.closest('.row')) e.preventDefault(); });
})();

$('select').onclick = () => enterSelect();
$('sel-cancel').onclick = () => exitSelect();
$('sel-all').onclick = () => {
  const rows = $('list').querySelectorAll('.row');
  const items = visibleItems();
  const allSel = items.length && items.every((n) => state.selected.has(n));
  state.selected.clear();
  if (!allSel) for (const n of items) state.selected.add(n);
  rows.forEach((r) => r._node && r.classList.toggle('sel', state.selected.has(r._node)));
  updateSelUI();
};
$('sel-go').onclick = () => {
  const nodes = [...state.selected];
  if (!nodes.length) return;
  const files = nodes.flatMap(filesUnder);
  if (files.length === 1) { exitSelect(); openFileSheet(files[0]); return; }
  openExtractMenu(nodes, nodes.length === 1 ? nodes[0].name : `${nodes.length} mục đã chọn`);
};
$('extract-all').onclick = () => {
  const ctx = cur();
  const atRoot = ctx.cwd === ctx.root;
  openExtractMenu([ctx.cwd], atRoot ? (ctx.displayName || ctx.name) : ctx.cwd.name);
};

const SORT_LABEL = { name: 'Tên', size: 'Kích thước', date: 'Ngày sửa' };
$('sort').onclick = () => {
  state.sort = state.sort === 'name' ? 'size' : state.sort === 'size' ? 'date' : 'name';
  try { localStorage.setItem('sort', state.sort); } catch (_) {}
  toast('Sắp xếp theo ' + SORT_LABEL[state.sort]);
  render();
};
try { const s = localStorage.getItem('sort'); if (SORT_LABEL[s]) state.sort = s; } catch (_) {}

let qT;
$('q').addEventListener('input', (e) => {
  clearTimeout(qT);
  $('q-clear').hidden = !e.target.value;
  qT = setTimeout(() => { state.query = e.target.value; render(); }, 120);
});
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('q-clear').onclick = () => { $('q').value = ''; $('q-clear').hidden = true; state.query = ''; render(); };

// Kéo thả (iPad / máy tính)
(() => {
  let depth = 0;
  const hint = $('drop-hint');
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; hint.hidden = false; e.preventDefault(); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) hint.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; hint.hidden = true;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) openFiles(files);
  });
})();

/* ---------------- Khởi động ---------------- */

$('formats').innerHTML = FORMATS.map(([f, hot]) => `<span class="chip${hot ? ' hot' : ''}">${f}</span>`).join('');
if (isIOS && !isStandalone()) $('install').hidden = false;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}
// Nạp sẵn WASM khi rảnh để lần mở đầu tiên nhanh hơn
const warm = () => engine.call('warmup', {}).catch(() => {});
if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2000 }); else setTimeout(warm, 800);
