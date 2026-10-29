/**
 * 台割ボード 中継スクリプト
 * 台割ボード（GitHub Pages）からの読み書きを、このスクリプトの所有者の権限で行います。
 * ログインしたGoogleアカウントが、そのスプレッドシートの「メンバー」タブに登録されているかを毎回確かめます。
 *
 * デプロイ：「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *           次のユーザーとして実行：自分 ／ アクセスできるユーザー：全員
 *
 * 安全のための決まり
 * ・扱うスプレッドシートは、このスクリプトの所有者が「オーナー」のものだけ（スケジュールのシートも同じ）
 * ・ログインはスプレッドシートごと。ある案件でのログインは、ほかの案件では使えません
 */
const VERSION = '2026-10-29';
const FEATURES = ['projectName', 'schedule', 'minutes', 'tasks'];
const CLIENT_ID = '89787741926-q2oegplkho4ulh38cpj9p8grkg718til.apps.googleusercontent.com';
const ALLOWED_ORIGINS = ['https://studio-pastel.github.io'];
const SESSION_DAYS = 30;
const CHUNK = 4 * 1024 * 1024;                 // multiple of 256 KiB (Drive resumable upload unit)

const TAB = { member: 'メンバー', comment: 'コメント', figure: '図版', expense: '経費', design: 'デザイン', setting: '設定', minute: '議事録', task: 'タスク' };
const HEAD = {
  member: ['メール', '名前', '役割', 'メモ'],
  comment: ['ID', 'ページ', '投稿者', '名前', '日時', '本文', '返信先', '状態'],
  figure: ['ID', 'ページ', '図版番号', '種別', '内容', '手配状況', '提供元・撮影者', 'クレジット', 'ファイル', 'メモ', '更新者', '更新日時'],
  expense: ['ID', '日付', '区分', '内容', '支払先', '金額（税込）', '担当', '領収書', '承認', '登録者', '登録日時'],
  design: ['ファイル', 'ファイル名', 'PDFページ開始', 'PDFページ終了', '割当開始', '登録日時'],
  setting: ['項目', '値'],
  minute: ['ID', '日付', 'タイトル', '出席者', 'タグ', 'ファイル', '文字数', '作成者', '作成者メール', '作成日時', '更新者', '更新日時'],
  task: ['ID', 'タスク', '担当', '担当メール', '期限', '状態', 'メモ', '作成者', '作成者メール', '作成日時', '更新者', '更新日時']
};
const TASK_STATES = ['未着手', '進行中', '確認待ち', '完了'];
const ROLE_LABEL = { staff: '社内', client: 'クライアント', ext: '外部スタッフ' };
const CAN = {
  load: ['staff', 'client', 'ext'],
  file: ['staff', 'client', 'ext'],
  comment: ['staff', 'client', 'ext'],
  status: ['staff', 'ext'],
  figure: ['staff', 'ext'],
  expenseRead: ['staff', 'client'],
  expenseWrite: ['staff'],
  schedule: ['staff', 'client'],
  scheduleWrite: ['staff'],
  minuteWrite: ['staff', 'client'],
  task: ['staff', 'client', 'ext'],
  manage: ['staff']                                 // settings, designs, uploads, members
};

/* ================= entry points ================= */
function doGet() { return out_({ ok: true, app: 'dandori-relay', version: VERSION }); }
function doPost(e) {
  let req;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : ''); }
  catch (err) { return out_({ ok: false, code: 'bad_request', message: '要求を読めませんでした' }); }
  try { return out_(handle_(req)); }
  catch (err) {
    if (err && err.code) return out_({ ok: false, code: err.code, message: err.message });
    console.error(err && err.stack || err);
    return out_({ ok: false, code: 'server', message: '中継スクリプトでエラーが起きました：' + (err && err.message ? err.message : String(err)) });
  }
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(code, message) { const e = new Error(message); e.code = code; throw e; }

function handle_(req) {
  if (!req || typeof req.action !== 'string') fail_('bad_request', '要求が正しくありません');
  if (req.action === 'auth') return auth_(req);
  const user = checkSession_(req.session, req.sheet);
  const ss = openSheet_(req.sheet);
  const me = memberOf_(ss, user.email, '');
  const need = (cap) => { if (CAN[cap].indexOf(me.key) < 0) fail_('forbidden', 'この操作の権限がありません（' + me.role + '）'); };
  switch (req.action) {
    case 'load': need('load'); return load_(ss, me, req);
    case 'fileMeta': need('file'); return fileMeta_(ss, me, req);
    case 'fileChunk': need('file'); return fileChunk_(ss, me, req);
    case 'status': need('status'); return withLock_(() => status_(ss, me, req));
    case 'commentAdd': need('comment'); return withLock_(() => commentAdd_(ss, me, req));
    case 'commentState': need('comment'); return withLock_(() => commentState_(ss, me, req));
    case 'commentDelete': need('comment'); return withLock_(() => commentDelete_(ss, me, req));
    case 'figureSave': need('figure'); return withLock_(() => recordSave_(ss, me, 'figure', req));
    case 'figureDelete': need('figure'); return withLock_(() => recordDelete_(ss, 'figure', req.id));
    case 'expenseSave': need('expenseWrite'); return withLock_(() => recordSave_(ss, me, 'expense', req));
    case 'expenseDelete': need('expenseWrite'); return withLock_(() => recordDelete_(ss, 'expense', req.id));
    case 'memberSave': need('manage'); return withLock_(() => memberSave_(ss, me, req));
    case 'memberDelete': need('manage'); return withLock_(() => memberDelete_(ss, me, req));
    case 'settingsSave': need('manage'); return withLock_(() => settingsSave_(ss, req));
    case 'designAppend': need('manage'); return withLock_(() => designAppend_(ss, req));
    case 'designUpdate': need('manage'); return withLock_(() => designUpdate_(ss, req));
    case 'designDelete': need('manage'); return withLock_(() => designDelete_(ss, req));
    case 'scheduleSave': need('scheduleWrite'); return withLock_(() => scheduleSave_(ss, req));
    case 'minuteGet': need('load'); return minuteGet_(ss, req);
    case 'minuteBodies': need('load'); return minuteBodies_(ss);
    case 'minuteSave': need('minuteWrite'); return withLock_(() => minuteSave_(ss, me, req));
    case 'minuteDelete': need('minuteWrite'); return withLock_(() => minuteDelete_(ss, me, req));
    case 'taskSave': need('task'); return withLock_(() => taskSave_(ss, me, req));
    case 'taskDelete': need('task'); return withLock_(() => taskDelete_(ss, me, req));
    case 'uploadInit': need(req.target === 'receipt' ? 'expenseWrite' : 'manage'); return uploadInit_(ss, me, req);
    case 'uploadChunk': return uploadChunk_(me, req);
    default: fail_('bad_request', '不明な操作です：' + req.action);
  }
}

/* ================= sign-in ================= */
function auth_(req) {
  const tok = verifyIdToken_(req.idToken);
  const ss = openSheet_(req.sheet);
  const me = memberOf_(ss, tok.email, tok.name);
  return { ok: true, session: makeSession_(tok.email, ss.getId()), email: tok.email, name: me.name, role: me.role, key: me.key };
}
function verifyIdToken_(t) {
  if (!t) fail_('auth', 'ログインが必要です');
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(t), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) fail_('auth', 'Googleのログイン情報を確認できませんでした。もう一度ログインしてください');
  const j = JSON.parse(r.getContentText());
  if (j.aud !== CLIENT_ID) fail_('auth', 'このツール用のログインではありません');
  if (String(j.email_verified) !== 'true') fail_('auth', 'メールアドレスが確認されていないGoogleアカウントです');
  if (Number(j.exp) * 1000 < Date.now()) fail_('auth', 'ログインの期限が切れました。もう一度ログインしてください');
  return { email: String(j.email || '').toLowerCase(), name: String(j.name || '') };
}
function secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SESSION_SECRET', s); }
  return s;
}
function sign_(payload) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())); }
function makeSession_(email, sheetId) {
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, s: sheetId, x: Date.now() + SESSION_DAYS * 864e5 }), Utilities.Charset.UTF_8);
  return payload + '.' + sign_(payload);
}
function checkSession_(s, sheetId) {
  if (typeof s !== 'string' || s.indexOf('.') < 0) fail_('auth', 'ログインが必要です');
  const i = s.lastIndexOf('.'), payload = s.slice(0, i), sig = s.slice(i + 1);
  if (sign_(payload) !== sig) fail_('auth', 'ログインし直してください');
  const j = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payload, Utilities.Charset.UTF_8)).getDataAsString('UTF-8'));
  if (!j.e || j.x < Date.now()) fail_('auth', 'ログインの期限が切れました。もう一度ログインしてください');
  if (!j.s || j.s !== String(sheetId || '')) fail_('auth', 'この案件のログインではありません。もう一度ログインしてください');
  return { email: String(j.e).toLowerCase() };
}

/* ================= sheet + members ================= */
function openSheet_(id) {
  if (!/^[A-Za-z0-9_-]{25,}$/.test(String(id || ''))) fail_('bad_request', 'スプレッドシートの指定が正しくありません');
  if (!ownedByOwner_(id)) fail_('not_found', 'スプレッドシートを開けませんでした（スクリプトの所有者がオーナーのスプレッドシートだけを扱えます）');
  try { return SpreadsheetApp.openById(id); }
  catch (e) { fail_('not_found', 'スプレッドシートを開けませんでした（スクリプトの所有者がオーナーのスプレッドシートだけを扱えます）'); }
}
/** true only when the script owner is the file's owner (files merely shared with the owner, or on shared drives, are refused) */
function ownedByOwner_(id) {
  const cache = CacheService.getScriptCache(), ck = 'own:' + id, hit = cache.get(ck);
  if (hit === '1') return true;
  if (hit === '0') return false;
  let ok = false;
  try {
    const f = DriveApp.getFileById(id), o = f.getOwner();
    ok = f.getMimeType() === MimeType.GOOGLE_SHEETS && !!o && String(o.getEmail() || '').toLowerCase() === ownerEmail_();
  } catch (e) { ok = false; }
  cache.put(ck, ok ? '1' : '0', ok ? 3600 : 300);
  return ok;
}
function ownerEmail_() { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); }
function roleKey_(v) {
  v = String(v || '');
  if (/社内/.test(v)) return 'staff';
  if (/クライアント/.test(v)) return 'client';
  if (/外部/.test(v)) return 'ext';
  return '';
}
function memberOf_(ss, email, nameHint) {
  const owner = ownerEmail_();
  let sh = ss.getSheetByName(TAB.member);
  if (!sh && email === owner) { sh = ensureTab_(ss, 'member'); writeRow_(sh, sh.getLastRow() + 1, [owner, nameHint || '', ROLE_LABEL.staff, 'スクリプトの所有者']); }
  const rows = sh ? sh.getDataRange().getDisplayValues() : [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toLowerCase() !== email) continue;
    const key = roleKey_(rows[i][2]);
    if (!key) fail_('not_member', '役割が設定されていません（社内／クライアント／外部スタッフのいずれかを「メンバー」タブに入れてください）');
    return { email, name: rows[i][1] || nameHint || email, role: ROLE_LABEL[key], key, row: i + 1 };
  }
  if (email === owner) return { email, name: nameHint || email, role: ROLE_LABEL.staff, key: 'staff' };
  fail_('not_member', 'このアカウント（' + email + '）はこの案件のメンバーに登録されていません。社内の担当者に追加を依頼してください');
}
function ensureTab_(ss, kind) {
  let sh = ss.getSheetByName(TAB[kind]);
  if (sh) return sh;
  sh = ss.insertSheet(TAB[kind]);
  sh.getRange(1, 1, 1, HEAD[kind].length).setValues([HEAD[kind]]);
  sh.setFrozenRows(1);
  return sh;
}
function readTab_(ss, name) { const sh = ss.getSheetByName(name); return sh ? sh.getDataRange().getDisplayValues() : []; }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('busy', '混み合っています。少し待ってからもう一度お試しください');
  try { return fn(); } finally { lock.releaseLock(); }
}
/** text that would start a formula is stored as plain text */
function clean_(v, max) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  let s = String(v).replace(/\r\n?/g, '\n').slice(0, max || 5000).trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function writeRow_(sh, row, values) { sh.getRange(row, 1, 1, values.length).setValues([values.map((v) => clean_(v))]); }
function now_(ss) { return Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'); }
function newId_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 10); }
function findById_(sh, id) {
  if (!id) return -1;
  const ids = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getDisplayValues();
  for (let i = 1; i < ids.length; i++) if (ids[i][0] === String(id)) return i + 1;
  return -1;
}
function settingsMap_(rows) { const m = {}; (rows || []).forEach((r) => { if (r && r[0]) m[String(r[0]).trim()] = String(r[1] || '').trim(); }); return m; }
function driveId_(s) {
  s = String(s || '');
  let m = s.match(/\/(?:folders|file\/d)\/([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : '';
}
function pickTab_(names, wanted) {
  if (wanted && names.indexOf(wanted) >= 0) return wanted;
  const special = Object.keys(TAB).map((k) => TAB[k]);
  return names.filter((n) => /台割/.test(n))[0] || names.filter((n) => special.indexOf(n) < 0)[0] || '';
}

/* ================= load ================= */
function load_(ss, me, req) {
  const names = ss.getSheets().map((s) => s.getName());
  const settings = readTab_(ss, TAB.setting), set = settingsMap_(settings);
  const tab = pickTab_(names, req.tab || set['台割タブ']);
  const sh = tab ? ss.getSheetByName(tab) : null;
  const daiwari = sh ? sh.getDataRange().getDisplayValues() : [];
  const res = {
    ok: true, version: VERSION,
    me: { email: me.email, name: me.name, role: me.role, key: me.key },
    features: FEATURES, title: set['案件名'] || ss.getName(), sheetName: ss.getName(), tabs: names, tab, daiwari, settings,
    designs: readTab_(ss, TAB.design), comments: readTab_(ss, TAB.comment), figures: readTab_(ss, TAB.figure),
    statusOptions: sh ? statusOptions_(sh, daiwari) : {},
    folder: folderListing_(driveId_(set['デザインフォルダ']))
  };
  if (CAN.expenseRead.indexOf(me.key) >= 0) res.expenses = readTab_(ss, TAB.expense);
  if (me.key === 'staff') res.members = readTab_(ss, TAB.member);
  res.people = memberList_(ss);
  res.minutes = readTab_(ss, TAB.minute);
  res.tasks = readTab_(ss, TAB.task);
  if (CAN.schedule.indexOf(me.key) >= 0) {
    try { res.schedule = scheduleRead_(ss, set); } catch (e) { res.schedule = { error: 'スケジュールを読み込めませんでした：' + (e && e.message ? e.message : String(e)) }; }
  }
  return res;
}
/** dropdown choices set on the proof columns (初校・再校…) of the 台割 tab */
function statusOptions_(sh, rows) {
  const out = {};
  let head = 0;
  for (let r = 0; r < Math.min(rows.length, 12); r++) if (rows[r].some((c) => /^(頁|ページ|印刷頁|ノンブル)$/.test(String(c).trim()))) { head = r; break; }
  (rows[head] || []).forEach((h, c) => {
    if (!/校/.test(String(h))) return;
    if (rows.length < head + 2) return;
    const dv = sh.getRange(head + 2, c + 1).getDataValidation();
    if (!dv) return;
    const t = dv.getCriteriaType(), v = dv.getCriteriaValues();
    if (t === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) out[c] = (v[0] || []).map(String);
    else if (t === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE && v[0]) out[c] = v[0].getDisplayValues().map((x) => String(x[0])).filter(Boolean);
  });
  return out;
}
function folderListing_(id) {
  if (!id) return null;
  try {
    const f = DriveApp.getFolderById(id), it = f.getFilesByType(MimeType.PDF), files = [];
    while (it.hasNext() && files.length < 500) { const x = it.next(); files.push({ id: x.getId(), name: x.getName(), size: x.getSize(), v: x.getLastUpdated().getTime() + '-' + x.getSize() }); }
    return { id, name: f.getName(), files };
  } catch (e) { return { id, error: 'デザインフォルダを開けませんでした（削除されたか、スクリプト所有者の権限がありません）', files: [] }; }
}

/* ================= files (read) ================= */
/** only files inside this project's design folder (everyone) or receipt folder (expense readers) are served */
function allowedFile_(ss, me, id) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(id || ''))) fail_('bad_request', 'ファイルの指定が正しくありません');
  const cache = CacheService.getScriptCache(), ck = 'ok:' + ss.getId() + ':' + me.key + ':' + id;
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  const set = settingsMap_(readTab_(ss, TAB.setting));
  const folders = [driveId_(set['デザインフォルダ'])];
  if (CAN.expenseRead.indexOf(me.key) >= 0) folders.push(driveId_(set['領収書フォルダ']));
  let file;
  try { file = DriveApp.getFileById(id); } catch (e) { fail_('not_found', 'ファイルが見つかりません'); }
  const parents = file.getParents(); let inside = false;
  while (parents.hasNext()) if (folders.indexOf(parents.next().getId()) >= 0) { inside = true; break; }
  if (!inside) fail_('forbidden', 'このファイルは案件のフォルダの外にあるため表示できません（デザインフォルダに移してください）');
  const meta = { id, name: file.getName(), size: file.getSize(), mime: file.getMimeType(), v: file.getLastUpdated().getTime() + '-' + file.getSize() };
  cache.put(ck, JSON.stringify(meta), 600);
  return meta;
}
function fileMeta_(ss, me, req) { return Object.assign({ ok: true }, allowedFile_(ss, me, req.id)); }
function fileChunk_(ss, me, req) {
  const meta = allowedFile_(ss, me, req.id);
  const from = Math.max(0, Math.floor(Number(req.offset) || 0)), len = Math.min(CHUNK, Math.max(1, Math.floor(Number(req.length) || CHUNK)));
  if (from >= meta.size) return { ok: true, data: '', total: meta.size };
  const to = Math.min(meta.size, from + len) - 1;
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + meta.id + '?alt=media&supportsAllDrives=true', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + from + '-' + to }, muteHttpExceptions: true
  });
  const code = r.getResponseCode();
  if (code !== 206 && code !== 200) fail_('drive', 'ファイルを読み込めませんでした（' + code + '）');
  let bytes = r.getContent();
  if (code === 200 && (from > 0 || bytes.length > to - from + 1)) bytes = bytes.slice(from, to + 1);
  return { ok: true, data: Utilities.base64Encode(bytes), total: meta.size, offset: from };
}

/* ================= uploads (resumable, relayed in chunks) ================= */
function projectFolder_(ss, label, suffix) {
  const sh = ensureTab_(ss, 'setting');
  const rows = sh.getDataRange().getDisplayValues(), set = settingsMap_(rows);
  const id = driveId_(set[label]);
  if (id) { try { DriveApp.getFolderById(id); return id; } catch (e) { fail_('not_found', label + 'を開けませんでした'); } }
  const parents = DriveApp.getFileById(ss.getId()).getParents();
  const parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const folder = parent.createFolder(ss.getName() + suffix);
  const url = 'https://drive.google.com/drive/folders/' + folder.getId();
  let r = -1;
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === label) { r = i + 1; break; }
  writeRow_(sh, r > 0 ? r : sh.getLastRow() + 1, [label, url]);
  return folder.getId();
}
function uploadInit_(ss, me, req) {
  const size = Math.floor(Number(req.size) || 0), name = String(req.name || '').slice(0, 200) || 'file';
  const mime = /^(application\/pdf|image\/(png|jpeg|gif|webp|heic))$/.test(String(req.mime)) ? String(req.mime) : 'application/octet-stream';
  if (size <= 0 || size > 200 * 1024 * 1024) fail_('bad_request', 'ファイルの大きさが正しくありません（200MBまで）');
  if (req.target !== 'receipt' && mime !== 'application/pdf') fail_('bad_request', 'デザインはPDFだけを登録できます');
  const folderId = req.target === 'receipt' ? withLock_(() => projectFolder_(ss, '領収書フォルダ', '_領収書')) : withLock_(() => projectFolder_(ss, 'デザインフォルダ', '_デザイン'));
  const r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify({ name, parents: [folderId], mimeType: mime }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    muteHttpExceptions: true
  });
  const h = r.getAllHeaders(), loc = h.Location || h.location;
  if (r.getResponseCode() !== 200 || !loc) fail_('drive', 'アップロードを開始できませんでした（' + r.getResponseCode() + '）');
  const uploadId = newId_() + newId_();
  CacheService.getScriptCache().put('up:' + uploadId, JSON.stringify({ loc, size, email: me.email, folderId }), 21600);
  return { ok: true, uploadId, chunk: CHUNK, folderId };
}
function uploadChunk_(me, req) {
  const raw = CacheService.getScriptCache().get('up:' + String(req.uploadId || ''));
  if (!raw) fail_('expired', 'アップロードの期限が切れました。もう一度アップロードしてください');
  const st = JSON.parse(raw);
  if (st.email !== me.email) fail_('forbidden', '別のアカウントのアップロードです');
  const bytes = Utilities.base64Decode(String(req.data || ''));
  const from = Math.floor(Number(req.offset) || 0), to = from + bytes.length - 1;
  if (!bytes.length || to >= st.size) fail_('bad_request', 'アップロードの区切りが正しくありません');
  const r = UrlFetchApp.fetch(st.loc, { method: 'put', contentType: 'application/octet-stream', payload: bytes, headers: { 'Content-Range': 'bytes ' + from + '-' + to + '/' + st.size }, muteHttpExceptions: true });
  const code = r.getResponseCode();
  if (code === 308) return { ok: true, done: false, next: to + 1 };
  if (code === 200 || code === 201) { const f = JSON.parse(r.getContentText()); return { ok: true, done: true, file: { id: f.id, name: f.name } }; }
  fail_('drive', 'アップロードに失敗しました（' + code + '）');
}

/* ================= 台割: progress ================= */
function status_(ss, me, req) {
  const sh = ss.getSheetByName(String(req.tab || ''));
  if (!sh) fail_('not_found', '台割のタブが見つかりません');
  const row = Math.floor(Number(req.row)), col = Math.floor(Number(req.col)), head = Math.floor(Number(req.headerRow));
  if (!(row > head && head >= 1 && col >= 1 && Number(req.pageCol) >= 1)) fail_('bad_request', '位置の指定が正しくありません');
  if (!/校/.test(sh.getRange(head, col).getDisplayValue())) fail_('forbidden', 'この列は進捗の列ではありません');
  const page = sh.getRange(row, Math.floor(Number(req.pageCol))).getDisplayValue();
  if (String(page).trim() !== String(req.page || '').trim()) fail_('stale', 'シートが更新されています。再読み込みしてからもう一度変更してください');
  try { sh.getRange(row, col).setValue(clean_(req.value, 100)); }
  catch (e) { fail_('invalid', 'シートの入力規則に合わない値です'); }
  return { ok: true, value: sh.getRange(row, col).getDisplayValue() };
}

/* ================= comments ================= */
function commentAdd_(ss, me, req) {
  const text = String(req.text || '').trim();
  if (!text) fail_('bad_request', 'コメントが空です');
  const sh = ensureTab_(ss, 'comment');
  const row = [newId_(), clean_(req.page, 40), me.email, me.name, now_(ss), text, clean_(req.replyTo, 40), '未対応'];
  writeRow_(sh, sh.getLastRow() + 1, row);
  let notified = 0;
  try { notified = notify_(ss, me, String(req.page || ''), text, String(req.origin || '')); } catch (e) { console.warn(e); }
  return { ok: true, comment: sh.getRange(sh.getLastRow(), 1, 1, HEAD.comment.length).getDisplayValues()[0], notified };
}
function commentRow_(ss, me, id) {
  const sh = ss.getSheetByName(TAB.comment);
  const r = sh ? findById_(sh, id) : -1;
  if (r < 0) fail_('not_found', 'コメントが見つかりません');
  const author = String(sh.getRange(r, 3).getDisplayValue()).toLowerCase();
  if (author !== me.email && me.key !== 'staff') fail_('forbidden', '自分のコメントだけを変更できます');
  return { sh, r };
}
function commentState_(ss, me, req) {
  const c = commentRow_(ss, me, req.id);
  c.sh.getRange(c.r, 8).setValue(req.state === '対応済' ? '対応済' : '未対応');
  return { ok: true };
}
function commentDelete_(ss, me, req) {
  const c = commentRow_(ss, me, req.id);
  c.sh.deleteRow(c.r);
  return { ok: true };
}
function notify_(ss, me, page, text, origin) {
  const members = readTab_(ss, TAB.member).slice(1).filter((r) => r[0]);
  const known = {}; members.forEach((r) => { known[String(r[0]).trim().toLowerCase()] = r; });
  const staff = members.filter((r) => roleKey_(r[2]) === 'staff').map((r) => String(r[0]).trim().toLowerCase());
  const prior = readTab_(ss, TAB.comment).slice(1).filter((r) => r[1] === page).map((r) => String(r[2]).toLowerCase());
  const to = staff.concat(prior).filter((e, i, a) => e && a.indexOf(e) === i && e !== me.email && known[e]);
  if (!to.length) return 0;
  const okOrigin = ALLOWED_ORIGINS.some((o) => origin.indexOf(o + '/') === 0);
  const link = okOrigin ? origin.split('?')[0] + '?sheet=' + ss.getId() + '&page=' + encodeURIComponent(page) : '';
  const subject = '［' + projectName_(ss) + '］' + page + ' に ' + me.name + ' さんからコメント';
  const body = me.name + ' さんが ' + page + ' にコメントしました。\n\n' + text + '\n\n' + (link ? '台割ボードで開く：\n' + link + '\n' : '') + '\n—\nこのメールは台割ボードから自動で送信されています。';
  let sent = 0;
  for (const addr of to) {
    if (MailApp.getRemainingDailyQuota() < 1) break;
    MailApp.sendEmail({ to: addr, subject, body, name: '台割ボード' });
    sent++;
  }
  return sent;
}

/* ================= 図版 / 経費 (records with an ID column) ================= */
const FIELDS = {
  figure: ['ページ', '図版番号', '種別', '内容', '手配状況', '提供元・撮影者', 'クレジット', 'ファイル', 'メモ'],
  expense: ['日付', '区分', '内容', '支払先', '金額（税込）', '担当', '領収書', '承認'],
  minute: ['日付', 'タイトル', '出席者', 'タグ', 'ファイル', '文字数'],
  task: ['タスク', '担当', '担当メール', '期限', '状態', 'メモ']
};
function recordSave_(ss, me, kind, req) {
  const sh = ensureTab_(ss, kind);
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), HEAD[kind].length)).getDisplayValues()[0];
  const v = req.values || {};
  let r = req.id ? findById_(sh, req.id) : -1;
  if (req.id && r < 0) fail_('not_found', '対象の行が見つかりません（削除された可能性があります）');
  const id = r > 0 ? String(req.id) : newId_();
  const current = r > 0 ? sh.getRange(r, 1, 1, head.length).getValues()[0] : head.map(() => '');
  checkBase_(sh, r, req.base);
  const row = head.map((h, i) => {
    if (h === 'ID') return id;
    if (h === '登録者' || h === '作成者') return r > 0 ? current[i] : me.name;
    if (h === '作成者メール') return r > 0 ? current[i] : me.email;
    if (h === '登録日時' || h === '作成日時') return r > 0 ? current[i] : now_(ss);
    if (h === '更新者') return me.name;
    if (h === '更新日時') return now_(ss);
    if (FIELDS[kind].indexOf(h) >= 0 && Object.prototype.hasOwnProperty.call(v, h)) {
      if (h === '金額（税込）') { const n = Number(String(v[h]).replace(/[,，円¥￥\s]/g, '')); return isFinite(n) && String(v[h]).trim() !== '' ? n : ''; }
      return v[h];
    }
    return current[i];
  });
  writeRow_(sh, r > 0 ? r : sh.getLastRow() + 1, row);
  return { ok: true, id, row: sh.getRange(r > 0 ? r : sh.getLastRow(), 1, 1, head.length).getDisplayValues()[0] };
}
function recordDelete_(ss, kind, id) {
  const sh = ss.getSheetByName(TAB[kind]);
  const r = sh ? findById_(sh, id) : -1;
  if (r < 0) fail_('not_found', '対象の行が見つかりません');
  sh.deleteRow(r);
  return { ok: true };
}

/* ================= members ================= */
function memberSave_(ss, me, req) {
  const email = String(req.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail_('bad_request', 'メールアドレスが正しくありません');
  const key = roleKey_(req.role);
  if (!key) fail_('bad_request', '役割は 社内／クライアント／外部スタッフ から選んでください');
  const sh = ensureTab_(ss, 'member');
  const rows = sh.getDataRange().getDisplayValues();
  const orig = String(req.orig || email).toLowerCase();
  let r = -1;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === orig) { r = i + 1; break; }
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === email && i + 1 !== r) fail_('bad_request', 'このメールアドレスはすでに登録されています');
  if (orig === me.email && key !== 'staff') fail_('bad_request', '自分の役割は社内から変更できません');
  writeRow_(sh, r > 0 ? r : sh.getLastRow() + 1, [email, String(req.name || ''), ROLE_LABEL[key], String(req.memo || '')]);
  return { ok: true };
}
function memberDelete_(ss, me, req) {
  const email = String(req.email || '').trim().toLowerCase();
  if (email === me.email) fail_('bad_request', '自分自身は削除できません');
  if (email === ownerEmail_()) fail_('bad_request', 'スクリプトの所有者は削除できません');
  const sh = ss.getSheetByName(TAB.member);
  const rows = sh ? sh.getDataRange().getDisplayValues() : [];
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]).trim().toLowerCase() === email) { sh.deleteRow(i + 1); return { ok: true }; }
  fail_('not_found', 'メンバーが見つかりません');
}

/* ================= settings + designs ================= */
function settingsSave_(ss, req) {
  const rows = (req.rows || []).filter((r) => Array.isArray(r) && r.length >= 2).slice(0, 60).map((r) => [String(r[0]).slice(0, 60), r[1]]);
  const sh = ensureTab_(ss, 'setting');
  const keep = settingsMap_(sh.getDataRange().getDisplayValues());
  // folders the relay created itself are never blanked by a browser that loaded the settings before they existed
  ['領収書フォルダ', '議事録フォルダ'].forEach((k) => {
    if (!keep[k]) return;
    const i = rows.findIndex((r) => String(r[0]).trim() === k);
    if (i < 0) rows.push([k, keep[k]]); else if (!String(rows[i][1] || '').trim()) rows[i][1] = keep[k];
  });
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).clearContent();
  sh.getRange(1, 1, rows.length, 2).setValues(rows.map((r) => [clean_(r[0], 60), clean_(r[1], 500)]));
  return { ok: true };
}
function designAppend_(ss, req) {
  const sh = ensureTab_(ss, 'design');
  (req.rows || []).slice(0, 50).forEach((r) => writeRow_(sh, sh.getLastRow() + 1, [r[0], r[1], r[2], r[3], r[4], now_(ss)]));
  return { ok: true };
}
function designRow_(ss, req) {
  const sh = ss.getSheetByName(TAB.design);
  const r = Math.floor(Number(req.row));
  if (!sh || r < 2 || r > sh.getLastRow()) fail_('not_found', '「デザイン」タブの行が見つかりません');
  if (driveId_(sh.getRange(r, 1).getDisplayValue()) !== String(req.id)) fail_('stale', '「デザイン」タブが更新されています。再読み込みしてください');
  return { sh, r };
}
function designUpdate_(ss, req) {
  const d = designRow_(ss, req);
  d.sh.getRange(d.r, 3, 1, 3).setValues([[clean_(req.from), clean_(req.to), clean_(req.start, 20)]]);
  return { ok: true };
}
function designDelete_(ss, req) { const d = designRow_(ss, req); d.sh.deleteRow(d.r); return { ok: true }; }

/* ================= shared helpers ================= */
function projectName_(ss) { return settingsMap_(readTab_(ss, TAB.setting))['案件名'] || ss.getName(); }
function memberList_(ss) {
  return readTab_(ss, TAB.member).slice(1).filter((r) => r[0] && roleKey_(r[2]))
    .map((r) => ({ email: String(r[0]).trim().toLowerCase(), name: String(r[1] || r[0]).trim(), role: ROLE_LABEL[roleKey_(r[2])] }));
}
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function validYmd_(y, m, d) { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
/** 2026-11-20 / 2026/11/20 / 2026年11月20日 → '2026/11/20'; '' when empty and allowed; null when invalid */
function normDate_(v, allowEmpty) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy/MM/dd');
  const s = String(v === undefined || v === null ? '' : v).trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  if (!s) return allowEmpty ? '' : null;
  const m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?$/);
  if (!m || !validYmd_(+m[1], +m[2], +m[3])) return null;
  return m[1] + '/' + pad2_(+m[2]) + '/' + pad2_(+m[3]);
}
function checkBase_(sh, r, base) {
  if (r < 0 || base === undefined || base === null) return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0], iu = head.indexOf('更新日時');
  if (iu >= 0 && String(sh.getRange(r, iu + 1).getDisplayValue()) !== String(base)) fail_('conflict', 'ほかの人が先に更新しました。再読み込みして内容を確かめてから、もう一度保存してください');
}
function cellByHead_(sh, r, name) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0], i = head.indexOf(name);
  return i < 0 ? '' : String(sh.getRange(r, i + 1).getDisplayValue());
}
const mineOrStaff_ = (sh, r, me) => me.key === 'staff' || cellByHead_(sh, r, '作成者メール').toLowerCase() === me.email;

/* ================= schedule (a separate spreadsheet) ================= */
function sheetIdOf_(s) {
  s = String(s || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{25,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{25,}$/.test(s) ? s : '';
}
const SCH_COLS = { name: /^(内容|項目|工程|作業|タスク|スケジュール)/, start: /開始/, end: /終了|締切|期限|完了日/, days: /日数|期間/, owner: /担当/, note: /備考|メモ/ };
function scheduleLayout_(sh) {
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return null;
  const top = sh.getRange(1, 1, Math.min(lastRow, 30), Math.min(lastCol, 40)).getDisplayValues();
  for (let r = 0; r < top.length; r++) {
    const cols = {};
    top[r].forEach((v, c) => {
      v = String(v).trim();
      if (!v) return;
      Object.keys(SCH_COLS).forEach((k) => { if (cols[k] === undefined && SCH_COLS[k].test(v)) cols[k] = c; });
    });
    if (cols.name !== undefined && cols.start !== undefined && cols.end !== undefined) {
      const width = Math.max.apply(null, Object.keys(cols).map((k) => cols[k])) + 1;
      return { headerRow: r + 1, cols, top, lastRow, width };
    }
  }
  return null;
}
function scheduleSheet_(sx, wanted) {
  const tabs = sx.getSheets();
  const order = wanted ? tabs.filter((t) => t.getName() === wanted).concat(tabs.filter((t) => t.getName() !== wanted)) : tabs;
  for (const sh of order) { const lay = scheduleLayout_(sh); if (lay) return { sh, lay }; }
  return null;
}
/** a cell of 開始日/終了日 → 'yyyy-MM-dd'. Text without a year takes the year that keeps it near the previous date. */
function schedDate_(v, text, tz, st) {
  if (v instanceof Date && !isNaN(v)) { const iso = Utilities.formatDate(v, tz, 'yyyy-MM-dd'); const p = iso.split('-'); st.ref = Date.UTC(+p[0], +p[1] - 1, +p[2]); return iso; }
  const s = String(text || '').trim().replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  let y, mo, d, m = s.match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/^(\d{1,2})[\/\-.月](\d{1,2})/);
    if (!m) return '';
    mo = +m[1]; d = +m[2];
    const floor = st.ref - 120 * 864e5;
    y = new Date(floor).getUTCFullYear();
    if (Date.UTC(y, mo - 1, d) < floor) y++;
  }
  if (!validYmd_(y, mo, d)) return '';
  st.ref = Date.UTC(y, mo - 1, d);
  return y + '-' + pad2_(mo) + '-' + pad2_(d);
}
function scheduleRead_(ss, set) {
  const id = sheetIdOf_(set['スケジュールシート']);
  if (!id) return null;
  let sx;
  if (!ownedByOwner_(id)) return { error: 'スケジュールのスプレッドシートを開けませんでした（スクリプトの所有者がオーナーのスプレッドシートだけを読み込めます）' };
  try { sx = SpreadsheetApp.openById(id); }
  catch (e) { return { error: 'スケジュールのスプレッドシートを開けませんでした（URLと、スクリプト所有者の閲覧権限を確認してください）' }; }
  const found = scheduleSheet_(sx, set['スケジュールタブ']);
  const url = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
  if (!found) return { error: '「内容」「開始日」「終了日」の見出しが見つかりませんでした', url, fileName: sx.getName() };
  const sh = found.sh, lay = found.lay, c = lay.cols, tz = sx.getSpreadsheetTimeZone() || 'Asia/Tokyo';
  let title = '', asOf = '';
  lay.top.slice(0, lay.headerRow - 1).forEach((row) => row.forEach((v) => {
    v = String(v).trim();
    if (!v) return;
    if (/時点|現在|更新/.test(v)) { if (!asOf) asOf = v; } else if (!title) title = v;
  }));
  const st = { ref: Date.now() };
  const am = asOf.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (am && validYmd_(+am[1], +am[2], +am[3])) st.ref = Date.UTC(+am[1], +am[2] - 1, +am[3]);
  const n = lay.lastRow - lay.headerRow, items = [];
  if (n > 0) {
    const rg = sh.getRange(lay.headerRow + 1, 1, n, lay.width), vals = rg.getValues(), disp = rg.getDisplayValues();
    for (let i = 0; i < n; i++) {
      const name = String(disp[i][c.name] || '').trim();
      const start = schedDate_(vals[i][c.start], disp[i][c.start], tz, st);
      const end = schedDate_(vals[i][c.end], disp[i][c.end], tz, st);
      if (!name && !start && !end) continue;
      items.push({
        row: lay.headerRow + 1 + i, name, start, end,
        startText: String(disp[i][c.start] || ''), endText: String(disp[i][c.end] || ''),
        owner: c.owner !== undefined ? String(disp[i][c.owner] || '') : '', note: c.note !== undefined ? String(disp[i][c.note] || '') : ''
      });
    }
  }
  return { url, fileName: sx.getName(), tab: sh.getName(), title: title || sx.getName(), asOf, items };
}
function scheduleSave_(ss, req) {
  const set = settingsMap_(readTab_(ss, TAB.setting));
  const id = sheetIdOf_(set['スケジュールシート']);
  if (!id) fail_('not_found', 'スケジュールのシートが設定されていません');
  let sx;
  if (!ownedByOwner_(id)) fail_('not_found', 'スケジュールのシートを開けませんでした（スクリプトの所有者がオーナーのスプレッドシートだけを扱えます）');
  try { sx = SpreadsheetApp.openById(id); } catch (e) { fail_('not_found', 'スケジュールのシートを開けませんでした'); }
  const found = scheduleSheet_(sx, set['スケジュールタブ']);
  if (!found) fail_('not_found', 'スケジュールの見出しが見つかりません');
  const lay = found.lay, c = lay.cols, row = Math.floor(Number(req.row));
  if (!(row > lay.headerRow && row <= lay.lastRow)) fail_('bad_request', '行の指定が正しくありません');
  if (String(found.sh.getRange(row, c.name + 1).getDisplayValue()).trim() !== String(req.name || '').trim()) fail_('stale', 'スケジュールが更新されています。再読み込みしてからもう一度変更してください');
  const a = normDate_(req.start), b = normDate_(req.end);
  if (!a || !b) fail_('bad_request', '開始日と終了日を正しく入力してください');
  if (b < a) fail_('bad_request', '終了日が開始日より前になっています');
  found.sh.getRange(row, c.start + 1).setValue(a);
  found.sh.getRange(row, c.end + 1).setValue(b);
  return { ok: true, schedule: scheduleRead_(ss, set) };
}

/* ================= 議事録 (list in the sheet, body as .md in Drive) ================= */
function normTags_(v) { return String(v || '').split(/[,、，\s]+/).map((t) => t.replace(/^#/, '').trim()).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 20).join(', '); }
function mdName_(date, title) { return (String(date).replace(/\//g, '-') + '_' + String(title)).replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(0, 120) + '.md'; }
function mdContent_(v, body) {
  const tags = v['タグ'] ? v['タグ'].split(', ') : [];
  return '---\ntitle: ' + JSON.stringify(v['タイトル']) + '\ndate: ' + JSON.stringify(String(v['日付']).replace(/\//g, '-')) +
    '\nattendees: ' + JSON.stringify(v['出席者']) + '\ntags: ' + JSON.stringify(tags) + '\n---\n\n' + body + (body.slice(-1) === '\n' ? '' : '\n');
}
function stripFront_(text) {
  text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (text.indexOf('---\n') === 0) {
    const i = text.indexOf('\n---\n', 3);
    if (i >= 0) text = text.slice(i + 5);
    else if (/\n---$/.test(text)) text = '';
  }
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}
function minuteFile_(ss, sh, r) {
  const fid = driveId_(cellByHead_(sh, r, 'ファイル'));
  if (!fid) return null;
  let f;
  try { f = DriveApp.getFileById(fid); } catch (e) { return null; }
  const folder = driveId_(settingsMap_(readTab_(ss, TAB.setting))['議事録フォルダ']);
  const parents = f.getParents(); let inside = false;
  while (parents.hasNext()) if (parents.next().getId() === folder) { inside = true; break; }
  if (!inside) fail_('forbidden', '議事録のファイルが「議事録フォルダ」の外にあるため開けません');
  return f;
}
function minuteText_(f) {
  const cache = CacheService.getScriptCache(), ck = 'md:' + f.getId() + ':' + f.getLastUpdated().getTime();
  const hit = cache.get(ck);
  if (hit !== null && hit !== undefined) return hit;
  const body = stripFront_(f.getBlob().getDataAsString('UTF-8'));
  if (body.length < 30000) cache.put(ck, body, 21600);
  return body;
}
function minuteGet_(ss, req) {
  const sh = ss.getSheetByName(TAB.minute), r = sh ? findById_(sh, req.id) : -1;
  if (r < 0) fail_('not_found', '議事録が見つかりません（削除された可能性があります）');
  const f = minuteFile_(ss, sh, r);
  if (!f) fail_('not_found', '本文のファイルが見つかりません（ドライブで削除された可能性があります）');
  return { ok: true, id: String(req.id), body: minuteText_(f) };
}
function minuteBodies_(ss) {
  const sh = ss.getSheetByName(TAB.minute), out = {};
  if (!sh) return { ok: true, bodies: out };
  const ids = sh.getRange(1, 1, Math.max(1, sh.getLastRow()), 1).getDisplayValues();
  for (let i = 1; i < ids.length && i <= 300; i++) {
    if (!ids[i][0]) continue;
    try { const f = minuteFile_(ss, sh, i + 1); if (f) out[ids[i][0]] = minuteText_(f); } catch (e) { /* skip unreadable */ }
  }
  return { ok: true, bodies: out };
}
function minuteSave_(ss, me, req) {
  const v = req.values || {};
  const date = normDate_(v['日付']);
  if (!date) fail_('bad_request', '日付を正しく入力してください');
  const title = String(v['タイトル'] || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!title) fail_('bad_request', 'タイトルを入力してください');
  const body = String(req.body || '').replace(/\r\n?/g, '\n');
  if (body.length > 200000) fail_('bad_request', '本文が長すぎます（20万字まで）');
  const sh = ensureTab_(ss, 'minute');
  const r = req.id ? findById_(sh, req.id) : -1;
  if (req.id && r < 0) fail_('not_found', '議事録が見つかりません（削除された可能性があります）');
  checkBase_(sh, r, req.base);
  const vals = { '日付': date, 'タイトル': title, '出席者': String(v['出席者'] || '').replace(/\s+/g, ' ').trim().slice(0, 500), 'タグ': normTags_(v['タグ']) };
  const content = mdContent_(vals, body), name = mdName_(date, title);
  let f = r > 0 ? minuteFile_(ss, sh, r) : null;
  if (f) { f.setContent(content); f.setName(name); }
  else f = DriveApp.getFolderById(projectFolder_(ss, '議事録フォルダ', '_議事録')).createFile(name, content, MimeType.PLAIN_TEXT);
  vals['ファイル'] = 'https://drive.google.com/file/d/' + f.getId() + '/view';
  vals['文字数'] = body.length;
  const res = recordSave_(ss, me, 'minute', { id: r > 0 ? String(req.id) : '', values: vals });
  return Object.assign(res, { body: stripFront_(content) });
}
function minuteDelete_(ss, me, req) {
  const sh = ss.getSheetByName(TAB.minute), r = sh ? findById_(sh, req.id) : -1;
  if (r < 0) fail_('not_found', '議事録が見つかりません');
  if (!mineOrStaff_(sh, r, me)) fail_('forbidden', '議事録を削除できるのは、作成した人と社内メンバーです');
  let f = null;
  try { f = minuteFile_(ss, sh, r); } catch (e) { f = null; }
  if (f) f.setTrashed(true);
  sh.deleteRow(r);
  return { ok: true };
}

/* ================= タスク ================= */
function taskSave_(ss, me, req) {
  const v = {};
  const src = req.values || {};
  FIELDS.task.forEach((k) => { if (Object.prototype.hasOwnProperty.call(src, k)) v[k] = src[k]; });
  if (!req.id && !String(v['タスク'] || '').trim()) fail_('bad_request', 'タスクの内容を入力してください');
  if (v['タスク'] !== undefined) { v['タスク'] = String(v['タスク']).trim().slice(0, 500); if (!v['タスク']) fail_('bad_request', 'タスクの内容を入力してください'); }
  if (!req.id && v['状態'] === undefined) v['状態'] = TASK_STATES[0];
  if (v['状態'] !== undefined && TASK_STATES.indexOf(v['状態']) < 0) fail_('bad_request', '状態は ' + TASK_STATES.join('／') + ' から選んでください');
  if (v['期限'] !== undefined) { const d = normDate_(v['期限'], true); if (d === null) fail_('bad_request', '期限の日付が正しくありません'); v['期限'] = d; }
  if (v['担当'] !== undefined || v['担当メール'] !== undefined) {
    const people = memberList_(ss), em = String(v['担当メール'] || '').trim().toLowerCase(), nm = String(v['担当'] || '').trim().slice(0, 100);
    const hit = people.filter((p) => em && p.email === em)[0] || people.filter((p) => nm && p.name === nm)[0];
    v['担当'] = hit ? hit.name : nm; v['担当メール'] = hit ? hit.email : '';
  }
  const sh = ensureTab_(ss, 'task');
  checkBase_(sh, req.id ? findById_(sh, req.id) : -1, req.base);
  return recordSave_(ss, me, 'task', { id: req.id || '', values: v });
}
function taskDelete_(ss, me, req) {
  const sh = ss.getSheetByName(TAB.task), r = sh ? findById_(sh, req.id) : -1;
  if (r < 0) fail_('not_found', 'タスクが見つかりません');
  if (!mineOrStaff_(sh, r, me)) fail_('forbidden', 'タスクを削除できるのは、作成した人と社内メンバーです');
  sh.deleteRow(r);
  return { ok: true };
}

/** 初回だけ手動で実行して、Googleの権限を許可するための関数 */
function authorize() {
  DriveApp.getRootFolder(); MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  console.log('権限の許可が完了しました。所有者：' + ownerEmail_());
}
