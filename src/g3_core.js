/* ===== core: constants, parsing, spread logic (pure, no DOM) ===== */
const MAX_PAGES = 250;
const KEY_LABEL = { F: '表1', IF: '表2', IB: '表3', B: '表4', S: '背' };
const TRIMS = [
  { id: 'A4', name: 'A4 (210×297)', w: 210, h: 297 },
  { id: 'B5', name: 'B5 (182×257)', w: 182, h: 257 },
  { id: 'A5', name: 'A5 (148×210)', w: 148, h: 210 },
  { id: 'kiku', name: '菊判 (150×220)', w: 150, h: 220 },
  { id: 'B6', name: 'B6 (128×182)', w: 128, h: 182 },
  { id: 'shiroku', name: '四六判 (127×188)', w: 127, h: 188 },
  { id: 'shinsho', name: '新書判 (112×173)', w: 112, h: 173 },
  { id: 'A6', name: 'A6・文庫 (105×148)', w: 105, h: 148 },
  { id: 'sq210', name: 'A4正方形 (210×210)', w: 210, h: 210 },
  { id: 'custom', name: '任意サイズ', w: 0, h: 0 }
];
const PAPERS = [
  { id: 'jou70', name: '上質紙 70kg（目安）', t: 0.09 },
  { id: 'jou90', name: '上質紙 90kg（目安）', t: 0.11 },
  { id: 'jou110', name: '上質紙 110kg（目安）', t: 0.14 },
  { id: 'coat90', name: 'コート 90kg（目安）', t: 0.08 },
  { id: 'matte90', name: 'マットコート 90kg（目安）', t: 0.09 },
  { id: 'book', name: '書籍用紙 72.5kg（目安）', t: 0.12 },
  { id: 'custom', name: '任意の厚み', t: 0 }
];
const DEFAULTS = {
  trim: 'A4', w: 210, h: 297, binding: 'L', bindType: 'perfect',
  paper: 'jou90', t: 0.11, c: 0.4, bleed: 3, title: '', color: '#27474f',
  sheetUrl: '', tab: '', range: 'A1:Z600', colMap: null
};

function z2h(s) {
  return String(s == null ? '' : s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－−‐‑‒–—]/g, '-').replace(/[〜～~]/g, '~').replace(/[，、・／/]/g, ',').replace(/\s+/g, ' ').trim();
}

function parseKeyText(s) {
  const t = z2h(s).replace(/^p\.?\s*/i, '').replace(/\s*(p|ページ|頁)$/i, '');
  if (!t) return null;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (/^(表1|表紙|オモテ|表一|cover|front)$/i.test(t)) return 'F';
  if (/^(表2|表二|見返し|見返し前|表紙裏)$/i.test(t)) return 'IF';
  if (/^(表3|表三|見返し後)$/i.test(t)) return 'IB';
  if (/^(表4|表四|裏表紙|裏|back)$/i.test(t)) return 'B';
  if (/^(背|背表紙|spine)$/i.test(t)) return 'S';
  return null;
}

/** "12" "12-15" "表1" "3,4" -> array of keys (numbers or F/IF/IB/B/S) */
function parsePageSpec(s) {
  const t = z2h(s);
  if (!t) return [];
  const out = [];
  t.split(',').forEach(part => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(?:p\.?\s*)?(\d+)\s*(?:p|ページ|頁)?\s*[-~]\s*(?:p\.?\s*)?(\d+)\s*(?:p|ページ|頁)?$/i);
    if (m) {
      let a = +m[1], b = +m[2];
      if (b < a) { const x = a; a = b; b = x; }
      if (b - a > 400) b = a + 400;
      for (let i = a; i <= b; i++) out.push(i);
      return;
    }
    const k = parseKeyText(part);
    if (k !== null) out.push(k);
  });
  return out;
}

function keyLabel(k) { return typeof k === 'number' ? 'P' + k : (KEY_LABEL[k] || String(k)); }

/* ---- CSV / TSV ---- */
function parseDelimited(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length && /\t/.test(text) ? '\t' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/* ---- header detection ---- */
const HEAD_RULES = [
  ['count', /ページ数|頁数|枚数|P数|ボリューム|分量|count/i],
  ['page', /^(ページ|頁|p|pp|page|no\.?|ノンブル|ページ番号|頁番号|台割|ページ割)$/i],
  ['title', /内容|タイトル|見出し|題|項目|コンテンツ|title|テーマ|記事|企画|コーナー/i],
  ['section', /区分|セクション|章|カテゴリ|分類|部門|section|category|chapter|パート|ブロック/i],
  ['kind', /^(種別|ページ種別|種類|タイプ|type|形式)$/i],
  ['note', /備考|メモ|note|コメント|memo|補足|担当/i],
  ['status', /状態|ステータス|進捗|status|進行|初校|再校|校正/i]
];
const EMPTY_MAP = () => ({ page: -1, title: -1, kind: -1, section: -1, note: -1, status: -1, count: -1 });
function detectColumns(rows) {
  let hi = -1, best = 0, map = null;
  const lim = Math.min(rows.length, 12);
  for (let r = 0; r < lim; r++) {
    const m = EMPTY_MAP();
    let hit = 0;
    rows[r].forEach((cell, ci) => {
      const t = z2h(cell);
      if (!t) return;
      for (const [k, re] of HEAD_RULES) {
        if (m[k] === -1 && re.test(t) && !Object.values(m).includes(ci)) { m[k] = ci; hit++; break; }
      }
    });
    if (hit > best) { best = hit; hi = r; map = m; }
  }
  if (best === 0) {
    const m = EMPTY_MAP();
    const first = rows[0] || [];
    if (first.length > 1 && parsePageSpec(first[0]).length) { m.page = 0; m.title = 1; if (first.length > 2) m.section = 2; }
    else { m.title = 0; if (first.length > 1) m.section = 1; }
    return { headerRow: -1, map: m };
  }
  if (map.title === -1) {
    const used = new Set(Object.values(map));
    const c = (rows[hi] || []).findIndex((_, i) => !used.has(i) && z2h(rows[hi][i]));
    if (c >= 0) map.title = c;
  }
  return { headerRow: hi, map };
}

/* ---- build the dummy model ---- */
function buildModel(rows, map, headerRow) {
  const pages = new Map();      // key -> {key,title,section,note,status,row}
  const sections = [];          // names in order
  let curSection = '', cursor = 1, maxN = 0;
  const cell = (r, c) => (c >= 0 && c < r.length ? String(r[c] == null ? '' : r[c]).trim() : '');
  for (let ri = headerRow + 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const title = cell(r, map.title), kind = cell(r, map.kind), note = cell(r, map.note), status = cell(r, map.status);
    let sec = cell(r, map.section);
    let keys = [];
    if (map.page >= 0) {
      keys = parsePageSpec(cell(r, map.page));
      if (!keys.length) {
        if (title && !sec && !note && !status && !kind && !cell(r, map.count)) { curSection = title; if (!sections.includes(curSection)) sections.push(curSection); }
        continue;
      }
    } else if (map.count >= 0) {
      const n = parseInt(z2h(cell(r, map.count)).replace(/[^\d]/g, ''), 10);
      const special = parseKeyText(title);
      if (typeof special === 'string') keys = [special];
      else if (n > 0) { for (let i = 0; i < n && cursor <= 400; i++) keys.push(cursor++); }
      else continue;
    } else {
      if (!title && !sec && !note) continue;
      const special = parseKeyText(title);
      if (typeof special === 'string') keys = [special]; else keys = [cursor++];
    }
    if (sec) curSection = sec;
    sec = sec || curSection;
    if (sec && !sections.includes(sec)) sections.push(sec);
    const nums = keys.filter(k => typeof k === 'number');
    keys.forEach((k, idx) => {
      if (typeof k === 'number') { if (k > maxN) maxN = k; if (k > 400) return; }
      pages.set(k, { key: k, title, kind, section: sec, note, status, span: keys.length > 1 ? nums.length : 1, row: ri });
    });
    if (map.page >= 0 && nums.length) cursor = Math.max(cursor, Math.max(...nums) + 1);
  }
  const missing = [];
  for (let i = 1; i <= maxN; i++) if (!pages.has(i)) missing.push(i);
  return { pages, sections, n: maxN, missing };
}

/* ---- spreads ---- */
function paddedN(N) { return N % 2 ? N + 1 : N; }
function leafCount(N) { return Math.max(1, paddedN(N) / 2); }   // body leaves m (each leaf = 1 sheet = 2 pages)
function spreadCount(N) { return leafCount(N) + 2; }              // s = 0 .. m+1
function backOf(i) { return i === 0 ? 'IF' : 2 * i; }
function frontOf(i) { return i === 0 ? 'F' : 2 * i - 1; }
/** screen-order pair for spread s. binding 'L' (spine left) or 'R' (spine right) */
function spreadKeys(s, N, binding) {
  const m = leafCount(N);
  let origin, other;
  if (s <= 0) { origin = 'F'; other = null; }
  else if (s <= m) { other = backOf(s - 1); origin = frontOf(s); }
  else { other = backOf(m); origin = 'IB'; }
  return binding === 'R' ? { left: origin, right: other } : { left: other, right: origin };
}
function spreadOfKey(k, N) {
  const m = leafCount(N);
  if (k === 'F') return 0;
  if (k === 'IF') return 1;
  if (k === 'IB' || k === 'B') return m + 1;
  if (typeof k === 'number') return k % 2 ? (k + 1) / 2 : k / 2 + 1;
  return 0;
}
function orderKeys(N) {
  const out = ['F', 'IF'];
  for (let i = 1; i <= paddedN(N); i++) out.push(i);
  out.push('IB', 'B');
  return out;
}
function spineWidthMM(N, t, c) { return +(leafCount(N) * t + 2 * c).toFixed(2); }
function signatureNote(N, type) {
  if (!N) return '';
  const Np = paddedN(N);
  if (type === 'saddle') return Np % 4 === 0 ? '中綴じ：4の倍数でOK' : '中綴じは4の倍数が必要（あと' + (4 - Np % 4) + 'P）';
  const up = (u) => Math.ceil(Np / u) * u;
  if (Np % 16 === 0) return '16P単位でOK';
  const a = Np % 8 === 0 ? '8P単位でOK' : '8P単位まであと' + (up(8) - Np) + 'P';
  return a + '／16P単位まであと' + (up(16) - Np) + 'P';
}
function sectionHue(i) { return Math.round((i * 137.508 + 188) % 360); }


/* ---- column letters ---- */
function colName(i) { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; }
function colIndex(letters) {
  const t = String(letters || '').trim().toUpperCase();
  if (!/^[A-Z]{1,2}$/.test(t)) return -1;
  let n = 0; for (const ch of t) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/* ---- Google IDs ---- */
function extractSheetId(s) {
  s = String(s || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{25,}$/.test(s) ? s : '';
}
function extractDriveId(s) {
  s = String(s || '').trim();
  let m = s.match(/\/(?:file\/d|folders|document\/d|spreadsheets\/d)\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

/* ---- 「設定」tab: two columns, 項目 | 値 ---- */
const SETTING_KEYS = [
  ['w', '判型幅（mm）'], ['h', '判型高さ（mm）'], ['binding', '綴じ'], ['bindType', '製本'],
  ['t', '本文紙の厚み（mm）'], ['c', '表紙の厚み（mm）'], ['bleed', '塗り足し（mm）'],
  ['name', '案件名'], ['title', '書名'], ['color', '背と表紙の色'], ['folder', 'デザインフォルダ'], ['tab', '台割タブ'], ['receiptFolder', '領収書フォルダ'],
  ['schedule', 'スケジュールシート'], ['scheduleTab', 'スケジュールタブ'], ['minutesFolder', '議事録フォルダ'],
  ['col_page', 'ページ列'], ['col_title', '内容列'], ['col_kind', '種別列'], ['col_section', '区分列'],
  ['col_note', '備考列'], ['col_status', '状態列'], ['col_count', 'ページ数列']
];
const COL_KEYS = ['page', 'title', 'kind', 'section', 'note', 'status', 'count'];
function parseSettingsRows(rows) {
  const byLabel = {};
  (rows || []).forEach((r) => { if (r && r[0] != null) byLabel[String(r[0]).trim()] = r[1] == null ? '' : String(r[1]).trim(); });
  const out = {}, cols = {};
  SETTING_KEYS.forEach(([k, label]) => {
    const v = byLabel[label];
    if (v === undefined || v === '') return;
    if (k.startsWith('col_')) { if (/^(-|なし|使わない)$/.test(v)) { cols[k.slice(4)] = -1; return; } const i = colIndex(v); if (i >= 0) cols[k.slice(4)] = i; return; }
    if (['w', 'h', 't', 'c', 'bleed'].includes(k)) { const n = parseFloat(z2h(v)); if (isFinite(n) && n >= 0) out[k] = n; return; }
    if (k === 'binding') { out.binding = /右/.test(v) ? 'R' : 'L'; return; }
    if (k === 'bindType') { out.bindType = /中/.test(v) ? 'saddle' : 'perfect'; return; }
    if (k === 'color') { if (/^#[0-9a-f]{6}$/i.test(v)) out.color = v; return; }
    out[k] = v;
  });
  return { set: out, cols };
}
function settingsToRows(set, cols) {
  const val = {
    w: set.w, h: set.h, binding: set.binding === 'R' ? '右綴じ' : '左綴じ', bindType: set.bindType === 'saddle' ? '中綴じ' : '無線綴じ',
    t: set.t, c: set.c, bleed: set.bleed, title: set.title || '', color: set.color || '', folder: set.folder || '', tab: set.tab || '', receiptFolder: set.receiptFolder || '',
    name: set.name || '', schedule: set.schedule || '', scheduleTab: set.scheduleTab || '', minutesFolder: set.minutesFolder || ''
  };
  COL_KEYS.forEach((k) => { const c = cols ? cols[k] : undefined; val['col_' + k] = c === undefined ? '' : (c < 0 ? 'なし' : colName(c)); });
  return [['項目', '値']].concat(SETTING_KEYS.map(([k, label]) => [label, val[k] === undefined || val[k] === null ? '' : String(val[k])]));
}

/* ---- 「デザイン」tab: ファイル | ファイル名 | PDFページ開始 | PDFページ終了 | 割当開始 | 登録日時 ---- */
const DESIGN_HEADER = ['ファイル', 'ファイル名', 'PDFページ開始', 'PDFページ終了', '割当開始', '登録日時'];
function parseDesignRows(rows) {
  const list = [];
  (rows || []).forEach((r, i) => {
    if (!r) return;
    const id = extractDriveId(r[0]);
    if (!id) return;   // header or blank
    const from = parseInt(z2h(r[2]), 10), to = parseInt(z2h(r[3]), 10);
    const start = parseKeyText(r[4]);
    list.push({
      row: i + 1, id, name: String(r[1] || '').trim(),
      from: from > 0 ? from : 1, to: to > 0 ? to : null,
      start: start === null ? 1 : start, startText: String(r[4] || '').trim(), date: String(r[5] || '').trim()
    });
  });
  return list;
}
/** later rows win on overlap. pageCount(id) -> number|null used when 終了 is blank */
function computeAssignments(designs, N, pageCount, autos) {
  const assign = new Map(), order = orderKeys(Math.max(N, 2));
  designs.forEach((d) => {
    let to = d.to;
    if (!to) { const pc = pageCount(d.id); to = pc || d.from; }
    if (to < d.from) return;
    if (d.start === 'S') { assign.set('S', { src: d.id, page: d.from, half: null }); return; }
    let i = order.findIndex((k) => String(k) === String(d.start));
    if (i < 0) return;
    for (let p = d.from; p <= to && i < order.length; p++, i++) assign.set(String(order[i]), { src: d.id, page: p, half: null, row: d.row });
  });
  // PDFs that sit in the design folder but have no row: name order, into the free body pages from P1
  let cur = 1;
  (autos || []).forEach((f) => {
    const n = pageCount(f.id);
    if (!n) return;
    for (let p = 1; p <= n; p++) {
      while (cur <= N && assign.has(String(cur))) cur++;
      if (cur > N) return;
      assign.set(String(cur), { src: f.id, page: p, half: null, auto: true });
      cur++;
    }
  });
  return assign;
}
function naturalSort(list) { return list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja', { numeric: true, sensitivity: 'base' })); }

if (typeof module !== 'undefined') {
  module.exports = { DESIGN_HEADER, parseKeyText, parsePageSpec, detectColumns, buildModel, spreadKeys, spreadOfKey, orderKeys, leafCount, spreadCount, spineWidthMM, signatureNote, paddedN, colName, colIndex, extractSheetId, extractDriveId, parseSettingsRows, settingsToRows, parseDesignRows, computeAssignments, naturalSort };
}
