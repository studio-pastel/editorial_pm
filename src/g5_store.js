/* ===== state, PDF cache, rendering ===== */
const $ = (id) => document.getElementById(id);
const S = {
  set: Object.assign({}, DEFAULTS, { folder: '', tab: '' }),
  colOverride: {},              // from 「設定」: key -> column index
  sheetId: '', sheetTitle: '', tabs: [], tabName: '',
  rows: null, headerRow: -1, map: null,
  model: { pages: new Map(), sections: [], n: 0, missing: [] },
  designs: [],                  // rows of 「デザイン」
  me: null, members: [], comments: [], figures: [], expenses: null, statusOptions: {}, settingsRows: [],
  folderFiles: [], folderErr: '', // PDFs in the design folder
  sources: new Map(),           // drive file id -> {id,name,kind:'pdf',blob,numPages,pdf,err}
  assign: new Map(),            // kstr -> {src, page, half}
  thumbs: new Map(),            // kstr -> data url
  loading: false
};
const kstr = (k) => String(k);
const NS = () => S.model.n;

/* ---- IndexedDB: downloaded PDFs, keyed by file id + checksum ---- */
const idb = {
  db: null,
  open() {
    return new Promise((res) => {
      try {
        const rq = indexedDB.open('dandori-pages', 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore('pdf', { keyPath: 'k' }); };
        rq.onsuccess = () => { idb.db = rq.result; res(true); };
        rq.onerror = () => res(false);
        rq.onblocked = () => res(false);
      } catch (e) { res(false); }
    });
  },
  tx(mode, fn) {
    return new Promise((res) => {
      if (!idb.db) return res(null);
      try {
        const t = idb.db.transaction('pdf', mode);
        const r = fn(t.objectStore('pdf'));
        t.oncomplete = () => res(r && r.result !== undefined ? r.result : true);
        t.onerror = () => res(null); t.onabort = () => res(null);
      } catch (e) { res(null); }
    });
  },
  get(k) { return idb.tx('readonly', (os) => os.get(k)); },
  all() { return idb.tx('readonly', (os) => os.getAll()); },
  put(v) { return idb.tx('readwrite', (os) => os.put(v)); },
  del(k) { return idb.tx('readwrite', (os) => os.delete(k)); }
};
async function cachePrune(keep) {
  const all = await idb.all();
  if (!Array.isArray(all) || all.length <= keep) return;
  all.sort((a, b) => (a.t || 0) - (b.t || 0));
  for (const r of all.slice(0, all.length - keep)) await idb.del(r.k);
}

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function srcFor(id, name) {
  let s = S.sources.get(id);
  if (!s) { s = { id, name: name || '', kind: 'pdf', blob: null, numPages: 0, pdf: null, err: '' }; S.sources.set(id, s); }
  if (name && !s.name) s.name = name;
  return s;
}
const blobLoads = new Map();
/** bytes from this browser's cache (same version) or through the relay */
function loadBlob(src) {
  if (src.blob) return Promise.resolve(src.blob);
  if (blobLoads.has(src.id)) return blobLoads.get(src.id);
  const p = (async () => {
    let meta;
    try { meta = await relayFileMeta(src.id); } catch (e) { src.err = e.message; throw new Error(src.err); }
    if (meta.name && !src.name) src.name = meta.name;
    const k = src.id + ':' + meta.v;
    const hit = await idb.get(k);
    if (hit && hit.blob) { src.blob = hit.blob; idb.put(Object.assign({}, hit, { t: Date.now() })); return src.blob; }
    try { src.blob = await relayDownload(meta); } catch (e) { src.err = e.message; throw new Error(src.err); }
    await idb.put({ k, id: src.id, blob: src.blob, t: Date.now() });
    cachePrune(40);
    return src.blob;
  })();
  blobLoads.set(src.id, p);
  p.catch(() => blobLoads.delete(src.id));
  return p;
}
async function getPdf(src) {
  if (src.pdf) return src.pdf;
  if (!window.pdfjsLib) throw new Error('PDFライブラリを読み込めませんでした');
  const blob = await loadBlob(src);
  if (src.pdf) return src.pdf;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  src.pdf = pdf; src.numPages = pdf.numPages; src.err = '';
  return pdf;
}
async function getBitmap(src) { throw new Error('画像には対応していません'); }

/* ---- region geometry: which part of the source page becomes the book page ---- */
function regionFor(nw, nh, half, pt) {
  const W = S.set.w, H = S.set.h;
  if (pt && !half) {
    // PDF page in points: a page larger than the trim by an even margin (bleed, crop marks) is cut to the trim, centred
    const wmm = nw * 25.4 / 72, hmm = nh * 25.4 / 72, bx = (wmm - W) / 2, by = (hmm - H) / 2;
    if (bx > -0.8 && by > -0.8 && bx < 30 && by < 30 && Math.abs(bx - by) < 2) {
      const k = 72 / 25.4, x = Math.max(0, bx) * k, y = Math.max(0, by) * k;
      return { x, y, w: Math.min(nw - 2 * x, W * k), h: Math.min(nh - 2 * y, H * k) };
    }
  }
  const b = Math.max(0, S.set.bleed || 0);
  let x0 = 0, x1 = nw, y0 = 0, y1 = nh;
  if (b > 0) {
    const fy = b / (H + 2 * b);
    y0 = nh * fy; y1 = nh * (1 - fy);
    if (!half) { const fx = b / (W + 2 * b); x0 = nw * fx; x1 = nw * (1 - fx); }
    else {
      const fx = b / (2 * W + 2 * b);
      if (half === 'L') { x0 = nw * fx; x1 = nw / 2; } else { x0 = nw / 2; x1 = nw * (1 - fx); }
    }
  } else if (half) { if (half === 'L') x1 = nw / 2; else x0 = nw / 2; }
  // cover-fit to trim aspect
  const ar = W / H, rw = x1 - x0, rh = y1 - y0;
  if (rw / rh > ar) { const nw2 = rh * ar, d = (rw - nw2) / 2; x0 += d; x1 -= d; }
  else { const nh2 = rw / ar, d = (rh - nh2) / 2; y0 += d; y1 -= d; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/* one render at a time; 3D textures (hi) jump ahead of board thumbnails (lo) */
const RQ = { hi: [], lo: [], running: false };
function queueRender(fn, hi) {
  return new Promise((res) => {
    (hi ? RQ.hi : RQ.lo).push(async () => { try { res(await fn()); } catch (e) { res(undefined); } });
    pumpRender();
  });
}
async function pumpRender() {
  if (RQ.running) return;
  RQ.running = true;
  try {
    while (RQ.hi.length || RQ.lo.length) { const job = RQ.hi.length ? RQ.hi.shift() : RQ.lo.shift(); await job(); }
  } finally { RQ.running = false; }
}

/** Draw the assigned design for a key into a new canvas of width px (null if none/fails). */
async function renderAssigned(a, widthPx) {
  const src = S.sources.get(a.src);
  if (!src) return null;
  const outW = Math.max(16, Math.round(widthPx)), outH = Math.round(outW * S.set.h / S.set.w);
  const out = document.createElement('canvas'); out.width = outW; out.height = outH;
  const g = out.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, outW, outH);
  if (src.kind === 'img') {
    const bmp = await getBitmap(src);
    const r = regionFor(bmp.width, bmp.height, a.half);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, outW, outH);
    return out;
  }
  const pdf = await getPdf(src);
  const page = await pdf.getPage(a.page || 1);
  const v1 = page.getViewport({ scale: 1 });
  const r = regionFor(v1.width, v1.height, a.half, true);
  let scale = outW / r.w;
  const maxSide = 4096;
  if (v1.width * scale > maxSide || v1.height * scale > maxSide) scale = Math.min(maxSide / v1.width, maxSide / v1.height);
  const vp = page.getViewport({ scale });
  const tmp = document.createElement('canvas'); tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
  await page.render({ canvasContext: tmp.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
  g.imageSmoothingQuality = 'high';
  g.drawImage(tmp, r.x * scale, r.y * scale, r.w * scale, r.h * scale, 0, 0, outW, outH);
  tmp.width = tmp.height = 0;
  return out;
}

/* ---- thumbnails (data: URLs for the board — blob: images may be refused by the viewer's CSP) ---- */
const thumbBusy = new Set();
function dropThumb(k) { S.thumbs.delete(k); }
function makeThumb(k) {
  const a = S.assign.get(k);
  if (!a || thumbBusy.has(k)) return;
  if (k === 'S') { refreshTile(k); return; }
  thumbBusy.add(k);
  queueRender(async () => {
    try {
      const cur = S.assign.get(k);
      if (!cur) return;
      const cv = await renderAssigned(cur, 260);
      if (!cv) return;
      const url = cv.toDataURL('image/jpeg', 0.82);
      if (S.assign.get(k) !== cur) return;
      S.thumbs.set(k, url);
      refreshTile(k);
    } catch (e) {
      S.thumbErr = (S.thumbErr || 0) + 1;
      if (S.onRenderError) S.onRenderError(k, e);
    } finally { thumbBusy.delete(k); }
  });
}


/* ---- assignments come from the 「デザイン」 tab ---- */
function applyAssignments(next) {
  const changed = new Set();
  S.assign.forEach((v, k) => { const n = next.get(k); if (!n || n.src !== v.src || n.page !== v.page) changed.add(k); });
  next.forEach((v, k) => { if (!S.assign.has(k)) changed.add(k); });
  S.assign = next;
  changed.forEach((k) => { dropThumb(k); texDrop(k); makeThumb(k); refreshTile(k); });
  return changed.size;
}
