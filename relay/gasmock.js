// Minimal in-memory Google Apps Script runtime for testing Code.gs in Node.
const vm = require('vm'), fs = require('fs'), crypto = require('crypto'), path = require('path');

const toSigned = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const toBuf = (arr) => Buffer.from(Array.from(arr, (b) => (b < 0 ? b + 256 : b)));

const fmt = (d, tz, f) => {
  const x = new Date(d.getTime() + (tz === 'Asia/Tokyo' ? 9 * 3600e3 : 0)), p = (n) => String(n).padStart(2, '0');
  return String(f || 'yyyy/MM/dd HH:mm').replace('yyyy', x.getUTCFullYear()).replace('MM', p(x.getUTCMonth() + 1)).replace('dd', p(x.getUTCDate())).replace('HH', p(x.getUTCHours())).replace('mm', p(x.getUTCMinutes()));
};
/** a Sheets date cell: JST wall time; display like ja_JP Sheets */
const jstDate = (y, mo, d, h, mi, withTime, dispFmt) => {
  const t = new Date(Date.UTC(y, mo - 1, d, h || 0, mi || 0) - 9 * 3600e3);
  t.disp = dispFmt ? fmt(t, 'Asia/Tokyo', dispFmt) : (withTime ? y + '/' + String(mo).padStart(2, '0') + '/' + String(d).padStart(2, '0') + ' ' + (h || 0) + ':' + String(mi || 0).padStart(2, '0') + ':00' : fmt(t, 'Asia/Tokyo', 'yyyy/MM/dd'));
  if (dispFmt) t.dispFmt = dispFmt;
  return t;
};
function makeWorld(opts) {
  const W = {
    owner: opts.owner, tokens: opts.tokens || {}, mails: [], formulas: [], props: {}, cache: {}, uploads: {}, nextId: 1,
    sheets: {}, folders: {}, files: {}, fetches: []
  };
  /* ---------- Spreadsheet ---------- */
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    raw(i, j) { const row = this.sh.cells[this.r - 1 + i] || []; const v = row[this.c - 1 + j]; return v === undefined ? '' : v; }
    getValues() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this.raw(i, j))); }
    getDisplayValues() { return this.getValues().map((row) => row.map((v) => { if (v instanceof Date) return v.disp || fmt(v, 'Asia/Tokyo', 'yyyy/MM/dd'); if (typeof v === 'string' && v.startsWith("'")) return v.slice(1); return v === '' || v === null ? '' : String(v); })); }
    getDisplayValue() { return this.getDisplayValues()[0][0]; }
    setValues(vals) {
      if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error('setValues: dimensions mismatch ' + this.nr + 'x' + this.nc + ' vs ' + vals.length + 'x' + (vals[0] || []).length);
      vals.forEach((row, i) => row.forEach((v, j) => {
        if (typeof v === 'string' && /^[=+\-@]/.test(v)) W.formulas.push(v);   // Sheets would evaluate this as a formula
        const R = this.r - 1 + i; this.sh.cells[R] = this.sh.cells[R] || [];
        if (typeof v === 'string') {
          const m = v.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?: (\d{1,2}):(\d{2}))?$/);
          if (m) { v = jstDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), m[4] !== undefined); const keep = (this.sh.cells[R][this.c - 1 + j] || {}).dispFmt; if (keep) { v.dispFmt = keep; v.disp = fmt(v, 'Asia/Tokyo', keep); } }
        }
        this.sh.cells[R][this.c - 1 + j] = v;
      }));
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) { const row = this.sh.cells[this.r - 1 + i]; if (row) row[this.c - 1 + j] = ''; } return this; }
    getDataValidation() {
      const v = this.sh.validation && this.sh.validation[this.c - 1];
      if (!v) return null;
      return { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [v] };
    }
  }
  class Sheet {
    constructor(ss, name, cells) { this.ss = ss; this.name = name; this.cells = cells || []; this.validation = {}; }
    getName() { return this.name; }
    lastRow() { let n = this.cells.length; while (n > 0 && !(this.cells[n - 1] || []).some((c) => c !== '' && c !== undefined && c !== null)) n--; return n; }
    getLastRow() { return this.lastRow(); }
    getLastColumn() { return Math.max(0, ...this.cells.slice(0, this.lastRow()).map((r) => { let n = (r || []).length; while (n > 0 && (r[n - 1] === '' || r[n - 1] === undefined)) n--; return n; })); }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.lastRow()), Math.max(1, this.getLastColumn())); }
    getRange(r, c, nr, nc) { if (r < 1 || c < 1) throw new Error('bad range'); return new Range(this, r, c, nr || 1, nc || 1); }
    deleteRow(r) { this.cells.splice(r - 1, 1); }
    setFrozenRows() {}
  }
  class SS {
    constructor(id, title, tabs, parent) { this.id = id; this.title = title; this.parent = parent; this.sheets = tabs.map((t) => { const s = new Sheet(this, t.title, t.cells.map((r) => r.slice())); s.validation = t.validation || {}; return s; }); }
    getId() { return this.id; } getName() { return this.title; } getSpreadsheetTimeZone() { return 'Asia/Tokyo'; }
    getSheets() { return this.sheets; }
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(this, n, []); this.sheets.push(s); return s; }
  }
  /* ---------- Drive ---------- */
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const fileObj = (id) => {
    const f = W.files[id]; if (!f) throw new Error('No item with the given ID could be found');
    return {
      getId: () => id, getName: () => f.name, getSize: () => f.bytes.length, getMimeType: () => f.mime, getLastUpdated: () => new Date(f.updated || 1761600000000), getParents: () => iter((f.parents || []).map(folderObj)),
      setContent: (c) => { f.bytes = Buffer.from(String(c), 'utf8'); f.updated = (f.updated || 1761600000000) + 1000; }, setName: (n) => { f.name = n; },
      getBlob: () => ({ getDataAsString: (cs) => f.bytes.toString(cs === 'UTF-8' ? 'utf8' : 'latin1') }), setTrashed: (b) => { f.trashed = !!b; if (b) f.parents = []; }
    };
  };
  const folderObj = (id) => {
    const d = W.folders[id]; if (!d) throw new Error('No item with the given ID could be found');
    return {
      getId: () => id, getName: () => d.name,
      getFilesByType: (mime) => iter(Object.keys(W.files).filter((k) => W.files[k].parents.includes(id) && W.files[k].mime === mime).map(fileObj)),
      createFolder: (name) => { const nid = 'FOLDERNEW' + String(W.nextId++).padStart(16, '0'); W.folders[nid] = { name, parent: id }; return folderObj(nid); },
      createFile: (name, content, mime) => { const fid = 'FILEMD' + String(W.nextId++).padStart(18, '0'); W.files[fid] = { name, mime: mime || 'text/plain', bytes: Buffer.from(String(content), 'utf8'), parents: [id] }; return fileObj(fid); }
    };
  };
  /* ---------- globals for Code.gs ---------- */
  const G = {
    console: { log() {}, warn() {}, error: (...a) => W.lastError = a.join(' ') },
    JSON, Math, Date, Number, String, Object, Array, Error, isFinite, encodeURIComponent, decodeURIComponent, RegExp,
    SpreadsheetApp: {
      openById: (id) => { const ss = W.sheets[id]; if (!ss) throw new Error('not found'); return ss; },
      DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST', VALUE_IN_RANGE: 'VALUE_IN_RANGE' }
    },
    DriveApp: {
      getFolderById: folderObj, getFileById: (id) => {
        const ss = W.sheets[id]; if (ss) return { getId: () => id, getMimeType: () => 'application/vnd.google-apps.spreadsheet', getOwner: () => (ss.ownerEmail === null ? null : { getEmail: () => ss.ownerEmail || W.owner }), getParents: () => iter(ss.parent ? [folderObj(ss.parent)] : []) };
        return fileObj(id);
      },
      getRootFolder: () => folderObj('ROOT')
    },
    MimeType: { PDF: 'application/pdf', PLAIN_TEXT: 'text/plain', GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' },
    Session: { getEffectiveUser: () => ({ getEmail: () => W.owner }) },
    ScriptApp: { getOAuthToken: () => 'owner-token' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => W.props[k] || null, setProperty: (k, v) => { W.props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (W.cache[k] !== undefined ? W.cache[k] : null), put: (k, v) => { W.cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    MailApp: { sendEmail: (o) => W.mails.push(o), getRemainingDailyQuota: () => 100 },
    ContentService: { createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: fmt,
      Charset: { UTF_8: 'utf8' },
      base64Encode: (bytes) => toBuf(bytes).toString('base64'),
      base64Decode: (s) => toSigned(Buffer.from(s, 'base64')),
      base64EncodeWebSafe: (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : toBuf(data)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', k).update(v, 'utf8').digest()),
      newBlob: (bytes) => ({ getDataAsString: () => toBuf(bytes).toString('utf8') })
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        o = o || {}; W.fetches.push((o.method || 'get') + ' ' + url.split('?')[0]);
        const res = (code, body, headers) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)), getContent: () => toSigned(Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))), getAllHeaders: () => headers || {} });
        if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
          const t = decodeURIComponent(url.split('id_token=')[1]); const info = W.tokens[t];
          return info ? res(200, info) : res(400, { error: 'invalid_token' });
        }
        const auth = (o.headers || {}).Authorization === 'Bearer owner-token';
        let m = url.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)\?alt=media/);
        if (m) {
          if (!auth) return res(401, {});
          const f = W.files[m[1]]; if (!f) return res(404, {});
          const rg = String(o.headers.Range || '').match(/bytes=(\d+)-(\d+)/);
          return rg ? res(206, f.bytes.slice(+rg[1], +rg[2] + 1)) : res(200, f.bytes);
        }
        if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable')) {
          if (!auth) return res(401, {});
          const meta = JSON.parse(o.payload), sid = 'U' + W.nextId++;
          W.uploads[sid] = { meta, size: +o.headers['X-Upload-Content-Length'], parts: [] };
          return res(200, '', { Location: 'https://upload.mock/session/' + sid });
        }
        m = url.match(/^https:\/\/upload\.mock\/session\/(\w+)$/);
        if (m) {
          const up = W.uploads[m[1]], cr = o.headers['Content-Range'].match(/bytes (\d+)-(\d+)\/(\d+)/);
          const got = up.parts.reduce((n, p) => n + p.length, 0);
          if (+cr[1] !== got) return res(400, { error: 'bad offset' });
          up.parts.push(toBuf(o.payload));
          if (+cr[2] + 1 < up.size) return res(308, '');
          const id = 'FILEUP' + String(W.nextId++).padStart(18, '0');
          W.files[id] = { name: up.meta.name, mime: up.meta.mimeType, bytes: Buffer.concat(up.parts), parents: up.meta.parents };
          return res(200, { id, name: up.meta.name });
        }
        if (url.startsWith('https://www.googleapis.com/drive/v3/about')) return res(200, { user: {} });
        return res(404, { error: 'unmocked ' + url });
      }
    }
  };
  vm.createContext(G);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), G, { filename: 'Code.gs' });
  W.G = G;
  W.addSheet = (id, title, tabs, parent) => { W.sheets[id] = new SS(id, title, tabs, parent); return W.sheets[id]; };
  W.call = (req) => JSON.parse(G.doPost({ postData: { contents: JSON.stringify(req) } }).content);
  return W;
}
module.exports = { makeWorld, jstDate };
