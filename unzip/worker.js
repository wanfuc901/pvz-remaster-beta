// Worker chạy 7-Zip (WASM). Mỗi lệnh dùng một instance mới để giải phóng bộ nhớ sạch sẽ.
import SevenZip from './vendor/7zz.es6.js';

const NO_PW = '__no_password__';
let wasmModulePromise = null;

function getWasm() {
  if (!wasmModulePromise) {
    const url = new URL('./vendor/7zz.wasm', import.meta.url);
    wasmModulePromise = (async () => {
      if (WebAssembly.compileStreaming) {
        try { return await WebAssembly.compileStreaming(fetch(url)); } catch (_) { /* fallback */ }
      }
      const buf = await (await fetch(url)).arrayBuffer();
      return WebAssembly.compile(buf);
    })();
  }
  return wasmModulePromise;
}

const decoder = () => new TextDecoder('utf-8');

async function createInstance(onProgress) {
  const mod = await getWasm();
  const outBytes = [];
  const errBytes = [];
  let progBuf = '';
  let lastSent = 0;
  const sz = await SevenZip({
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(mod, imports).then((inst) => done(inst));
      return {};
    },
    stdout: (c) => { outBytes.push(c); },
    stderr: (c) => {
      errBytes.push(c);
      if (!onProgress) return;
      // 7-Zip in tiến trình dạng "  42%\b\b\b\b" ra stderr với -bsp2
      if (c === 8) {
        const m = progBuf.match(/(\d{1,3})%/);
        if (m) {
          const now = Date.now();
          if (now - lastSent > 80) { lastSent = now; onProgress(Math.min(100, +m[1])); }
        }
        progBuf = '';
      } else if (c < 128) {
        progBuf += String.fromCharCode(c);
        if (progBuf.length > 64) progBuf = progBuf.slice(-64);
      }
    },
  });
  const text = (arr) => decoder().decode(new Uint8Array(arr));
  return {
    sz,
    out: () => text(outBytes),
    err: () => text(errBytes).replace(/[\b]/g, ''),
  };
}

// WORKERFS gốc gọi FileReaderSync cho mỗi lần đọc nhỏ (rất chậm với tệp nén nhiều tệp con).
// Đọc theo khối 4 MB và giữ lại khối gần nhất.
const BLOCK = 4 * 1024 * 1024;
function patchWorkerFS(sz) {
  const ops = sz.WORKERFS.stream_ops;
  if (ops._patched) return;
  const reader = new FileReaderSync();
  ops.read = function (stream, buffer, offset, length, position) {
    const node = stream.node;
    if (position >= node.size) return 0;
    const size = Math.min(node.size - position, length);
    if (size >= BLOCK) {
      buffer.set(new Uint8Array(reader.readAsArrayBuffer(node.contents.slice(position, position + size))), offset);
      return size;
    }
    let done = 0;
    while (done < size) {
      const pos = position + done;
      let c = node._block;
      if (!c || pos < c.start || pos >= c.start + c.data.length) {
        const start = pos - (pos % BLOCK);
        const data = new Uint8Array(reader.readAsArrayBuffer(node.contents.slice(start, Math.min(node.size, start + BLOCK))));
        c = node._block = { start, data };
      }
      const n = Math.min(size - done, c.start + c.data.length - pos);
      buffer.set(c.data.subarray(pos - c.start, pos - c.start + n), offset + done);
      done += n;
    }
    return size;
  };
  ops._patched = true;
}

function mountInputs(sz, files) {
  patchWorkerFS(sz);
  sz.FS.mkdir('/in');
  sz.FS.mount(sz.WORKERFS, { files }, '/in');
}

function run(inst, args) {
  try {
    const code = inst.sz.callMain(args);
    return { code: typeof code === 'number' ? code : 0, threw: false };
  } catch (e) {
    // 7-Zip ném ngoại lệ C++ (con trỏ số) khi gặp lỗi nghiêm trọng, ví dụ sai mật khẩu ở header
    return { code: typeof e?.status === 'number' ? e.status : 2, threw: true };
  }
}

function classifyError(text, threw, stage) {
  const t = text || '';
  if (/wrong password|password/i.test(t)) return 'PASSWORD';
  if (/cannot open the file as archive|can not open the file as archive|is not archive/i.test(t)) return 'NOT_ARCHIVE';
  if (/unexpected end|missing volume|there are some data after|unavailable/i.test(t)) return 'CORRUPT';
  if (/data error|crc failed|headers error/i.test(t)) return 'CORRUPT';
  if (/memory|alloc/i.test(t)) return 'MEMORY';
  if (threw && stage === 'list') return 'PASSWORD_OR_CORRUPT';
  return 'UNKNOWN';
}

function parseList(out) {
  const lines = out.split(/\r?\n/);
  const info = {};
  const entries = [];
  let i = 0;
  // phần thông tin archive: sau dòng "--"
  for (; i < lines.length; i++) if (lines[i] === '--') { i++; break; }
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/^-{5,}$/.test(l)) { i++; break; }
    const m = l.match(/^([^=]+?) = (.*)$/);
    if (m && !(m[1] in info)) info[m[1]] = m[2];
  }
  let cur = null;
  const flush = () => {
    if (cur && cur.Path !== undefined) {
      const attr = cur.Attributes || '';
      const isDir = cur.Folder === '+' || /^D/.test(attr);
      entries.push({
        path: cur.Path,
        isDir,
        size: Number(cur.Size) || 0,
        packed: Number(cur['Packed Size']) || 0,
        mtime: cur.Modified || '',
        encrypted: cur.Encrypted === '+',
        link: /^l/.test(attr.trim().split(' ').pop() || '') ? true : false,
      });
    }
    cur = null;
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l === '') { flush(); continue; }
    const m = l.match(/^([^=]+?) = ?(.*)$/);
    if (!m) continue;
    if (!cur) cur = {};
    if (!(m[1] in cur)) cur[m[1]] = m[2];
  }
  flush();
  return { type: info.Type || '', physicalSize: Number(info['Physical Size']) || 0, method: info.Method || '', solid: info.Solid === '+', entries };
}

function walk(sz, dir, base, acc) {
  for (const name of sz.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const full = dir + '/' + name;
    const rel = base ? base + '/' + name : name;
    let st;
    try { st = sz.FS.lstat(full); } catch (_) { continue; }
    if (sz.FS.isDir(st.mode)) walk(sz, full, rel, acc);
    else if (sz.FS.isFile(st.mode)) acc.push({ full, rel, size: st.size });
  }
  return acc;
}

async function opList({ files, main, password }) {
  const inst = await createInstance(null);
  mountInputs(inst.sz, files);
  const args = ['l', '-slt', '-bsp0', '-sccUTF-8', '-p' + (password || NO_PW), '/in/' + main];
  const r = run(inst, args);
  const out = inst.out();
  const err = inst.err();
  const parsed = parseList(out);
  if (r.threw || (!parsed.type && !parsed.entries.length)) {
    const kind = classifyError(err + '\n' + out, r.threw, 'list');
    return { ok: false, kind: password && kind.startsWith('PASSWORD') ? 'PASSWORD' : kind, message: err.trim().split('\n').filter(Boolean).slice(-2).join(' ') };
  }
  return { ok: true, ...parsed, warning: /ERROR|WARNING/.test(err) ? err.trim().split('\n').filter(Boolean).slice(-2).join(' ') : '' };
}

async function opExtract({ files, main, password, paths }, id) {
  const inst = await createInstance((p) => postMessage({ id, progress: p }));
  mountInputs(inst.sz, files);
  const args = ['x', '-y', '-o/out', '-bsp2', '-bb0', '-sccUTF-8', '-spd', '-p' + (password || NO_PW), '/in/' + main];
  if (paths && paths.length) args.push('--', ...paths);
  const r = run(inst, args);
  const err = inst.err();
  let found = [];
  try { found = walk(inst.sz, '/out', '', []); } catch (_) { found = []; }
  const failed = r.threw || r.code >= 2 || /ERROR/.test(err);
  if (failed && !found.length) {
    return { ok: false, kind: classifyError(err, r.threw, 'extract'), message: err.trim().split('\n').filter(Boolean).slice(-2).join(' ') };
  }
  // Gửi từng file ra luồng chính rồi xoá khỏi bộ nhớ worker
  const results = [];
  const transfer = [];
  for (const f of found) {
    const data = inst.sz.FS.readFile(f.full);
    try { inst.sz.FS.unlink(f.full); } catch (_) {}
    results.push({ path: f.rel, data });
    transfer.push(data.buffer);
  }
  postMessage({ id, result: { ok: true, files: results, partialError: failed ? classifyError(err, r.threw, 'extract') : '', message: failed ? err.trim().split('\n').filter(Boolean).slice(-2).join(' ') : '' } }, transfer);
  return null;
}

self.onmessage = async (e) => {
  const { id, op, payload } = e.data;
  try {
    let result;
    if (op === 'warmup') { await getWasm(); result = { ok: true }; }
    else if (op === 'list') result = await opList(payload);
    else if (op === 'extract') result = await opExtract(payload, id);
    else result = { ok: false, kind: 'UNKNOWN', message: 'unknown op' };
    if (result) postMessage({ id, result });
  } catch (err) {
    postMessage({ id, result: { ok: false, kind: /memory|alloc|range/i.test(String(err)) ? 'MEMORY' : 'UNKNOWN', message: String(err && err.message || err) } });
  }
};
