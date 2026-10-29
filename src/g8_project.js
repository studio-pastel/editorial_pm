/* ===== project: load through the relay, roles, settings, design PDFs ===== */
const fileUrl = (id) => 'https://drive.google.com/file/d/' + id + '/view';

function setTop(t, cls) { const e = $('topMsg'); if (!t) { e.hidden = true; return; } e.hidden = false; e.textContent = t; e.className = 'msg banner' + (cls ? ' ' + cls : ''); }
function setMsg(id, t, cls) { const e = $(id); if (!e) return; e.textContent = t || ''; e.className = 'msg' + (cls ? ' ' + cls : ''); }
function openPanel(id) { const p = $(id); p.hidden = false; const b = document.querySelector('[data-panel="' + id + '"]'); if (b) b.classList.add('on'); }
function startFieldText(k) { return typeof k === 'number' ? String(k) : (KEY_LABEL[k] || '1'); }
function nextKeyAfter(start, count) {
  const order = orderKeys(Math.max(NS(), 2));
  const i = order.findIndex((k) => kstr(k) === kstr(start));
  return i < 0 ? null : (order[i + count] === undefined ? null : order[i + count]);
}
function tableObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const h = rows[0].map((x) => String(x).trim());
  return rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => { const o = {}; h.forEach((k, i) => { if (k) o[k] = r[i] == null ? '' : String(r[i]); }); return o; });
}

/* ---- roles ---- */
const role = () => (S.me && S.me.key) || '';
const isStaff = () => role() === 'staff';
const canProgress = () => role() === 'staff' || role() === 'ext';
const canFigures = canProgress;
const canSeeExpenses = () => role() === 'staff' || role() === 'client';
const canSeeSchedule = canSeeExpenses;
const canWriteMinutes = canSeeExpenses;
const hasFeature = (f) => (S.features || []).indexOf(f) >= 0;
function applyRole() {
  const k = role();
  document.body.classList.toggle('editor', k === 'staff');
  ['staff', 'client', 'ext'].forEach((x) => document.body.classList.toggle('role-' + x, k === x));
  document.body.classList.toggle('can-fig', canFigures());
  document.querySelectorAll('.ed').forEach((el) => { el.disabled = k !== 'staff'; });
  $('tabSelect').disabled = k !== 'staff';
  $('colHint').textContent = k === 'staff' ? '（変更後「判型・製本」の「設定をシートに保存」で全員に反映）' : '（自動判別）';
  $('vt-expenses').hidden = !canSeeExpenses();
  $('vt-members').hidden = k !== 'staff';
  $('vt-schedule').hidden = !canSeeSchedule();
  const u = $('userChip'); u.hidden = !S.me; u.textContent = S.me ? (S.me.name || S.me.email) + '（' + S.me.role + '）' : '';
}

/* ---- load ---- */
async function loadProject(opts) {
  opts = opts || {};
  if (!S.sheetId) return false;
  if (!signedIn()) { showLogin(); return false; }
  const first = !S.loaded;
  if (first) { S.loading = true; renderBoard(); }
  setTop('');
  let r;
  try { r = await relay('load', { tab: opts.tab || '' }); }
  catch (e) {
    S.loading = false; renderBoard();
    if (e.code === 'not_member') showNotMember(e.message);
    else if (e.code !== 'auth') setTop(e.message, 'err');
    return false;
  }
  S.loading = false; S.loaded = true;
  const sig = () => JSON.stringify([S.tabName, S.settingsRows, S.designs.map((d) => [d.id, d.from, d.to, d.startText]), (S.folderFiles || []).map((f) => f.id + ':' + f.v), NS()]);
  const before = sig();
  applyLoad(r);
  const heavy = first || opts.full || before !== sig();
  document.title = S.sheetTitle || 'エディトリアルPM';
  rememberProject();
  applyRole(); pushSettingsToUI(); renderProjectUI();
  if (heavy) S.thumbs.clear();
  texClearAll(); renderBoard(); buildBook(); renderStats(); syncControls();
  renderViews();
  if (heavy) await refreshAssignments(); else renderDesignList();
  if (first) openPageFromUrl();
  S.loadedAt = Date.now();
  return true;
}
function applyLoad(r) {
  S.me = r.me; S.sheetTitle = r.title; S.sheetName = r.sheetName || r.title; S.features = r.features || []; S.tabs = (r.tabs || []).map((t) => ({ title: t })); S.tabName = r.tab || '';
  S.rows = r.daiwari || []; S.settingsRows = r.settings || [];
  const ps = parseSettingsRows(S.settingsRows);
  S.set = Object.assign({}, DEFAULTS, { folder: '', tab: '', receiptFolder: '' }, ps.set);
  const trim = TRIMS.find((x) => x.w === S.set.w && x.h === S.set.h); S.set.trim = trim ? trim.id : 'custom';
  const paper = PAPERS.find((x) => x.t && Math.abs(x.t - S.set.t) < 1e-6); S.set.paper = paper ? paper.id : 'custom';
  S.colOverride = ps.cols;
  rebuildRows();
  S.designs = parseDesignRows(r.designs || []);
  S.folderErr = r.folder && r.folder.error ? r.folder.error : '';
  S.folderFiles = r.folder && !r.folder.error ? naturalSort(r.folder.files || []) : [];
  S.statusOptions = r.statusOptions || {};
  S.comments = tableObjects(r.comments); S.figures = tableObjects(r.figures);
  S.expenses = r.expenses ? tableObjects(r.expenses) : null;
  S.members = r.members ? tableObjects(r.members) : [];
  S.people = r.people || S.members.map((m) => ({ email: String(m['メール'] || '').toLowerCase(), name: m['名前'] || m['メール'], role: m['役割'] }));
  S.minutes = tableObjects(r.minutes);
  S.tasks = tableObjects(r.tasks);
  S.schedule = r.schedule;
}
function rebuildRows() {
  const d = detectColumns(S.rows);
  S.headerRow = d.headerRow;
  S.map = Object.assign(d.map, S.colOverride);
  S.model = buildModel(S.rows, S.map, S.headerRow);
}
function showNotMember(msg) {
  showLogin();
  setMsg('loginMsg', msg, 'err');
  $('btnSwitch').hidden = false;
}
const reloadDesigns = () => loadProject();
const autoFiles = () => S.folderFiles.filter((f) => !S.designs.some((d) => d.id === f.id));
function recompute() {
  const next = computeAssignments(S.designs, NS(), (id) => { const s = S.sources.get(id); return (s && s.numPages) || null; }, autoFiles());
  applyAssignments(next);
  renderStats(); renderDesignListSoon();
  if (V.ok) invalidate();
}
async function refreshAssignments() {
  S.designs.forEach((d) => srcFor(d.id, d.name));
  autoFiles().forEach((f) => srcFor(f.id, f.name));
  recompute();
  const need = S.designs.filter((x) => !x.to).map((d) => d.id).concat(autoFiles().map((f) => f.id));
  for (const id of need) {
    const s = S.sources.get(id);
    if (s.pdf) continue;
    try { await getPdf(s); } catch (e) { /* shown in the list */ }
    recompute();
  }
  renderDesignList();
}
function placedRange(id) {
  const ks = orderKeys(Math.max(NS(), 2)).filter((k) => { const a = S.assign.get(kstr(k)); return a && a.src === id; });
  if (!ks.length) return '';
  return ks.length === 1 ? keyLabel(ks[0]) : keyLabel(ks[0]) + '〜' + keyLabel(ks[ks.length - 1]);
}
async function pinAutoFile(f) {
  const s = S.sources.get(f.id) || {};
  const ks = orderKeys(Math.max(NS(), 2)).filter((k) => { const a = S.assign.get(kstr(k)); return a && a.src === f.id; });
  if (!ks.length || !s.numPages) { setMsg('designMsg', 'このPDFはまだ読み込めていません。', 'err'); return; }
  setMsg('designMsg', '記録中…');
  try {
    await relay('designAppend', { rows: [[fileUrl(f.id), f.name, 1, s.numPages, startFieldText(ks[0])]] });
    await reloadDesigns();
    setMsg('designMsg', '「デザイン」タブに記録しました。貼る位置を変えられます。', 'ok');
  } catch (e) { setMsg('designMsg', e.message, 'err'); }
}

/* ---- recent projects (this browser only) ---- */
function recentList() { try { return JSON.parse(localStorage.getItem('dandori.recent') || '[]'); } catch (e) { return []; } }
function rememberProject() {
  try {
    const l = recentList().filter((r) => r.id !== S.sheetId);
    l.unshift({ id: S.sheetId, title: S.sheetTitle, t: Date.now() });
    localStorage.setItem('dandori.recent', JSON.stringify(l.slice(0, 8)));
  } catch (e) { /* ignore */ }
}
function projectUrl(id) { return location.origin + location.pathname + '?sheet=' + encodeURIComponent(id); }
function renderRecent() {
  const ul = $('recentList'); ul.textContent = '';
  recentList().forEach((r) => {
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = projectUrl(r.id); a.textContent = r.title || r.id; li.appendChild(a); ul.appendChild(li);
  });
}
function openSheetFromInput(inputId, msgId) {
  const id = extractSheetId($(inputId).value);
  if (!id) { setMsg(msgId, 'スプレッドシートのURLを貼ってください。', 'err'); return; }
  location.href = projectUrl(id);
}

/* ---- 案件 panel ---- */
const COLDEFS = [['page', 'ページ列'], ['title', '内容列'], ['kind', '種別列'], ['section', '区分列'], ['note', '備考列'], ['status', '状態列'], ['count', 'ページ数列']];
function renderProjectUI() {
  $('brandTitle').textContent = S.sheetTitle || 'エディトリアルPM';
  $('projTitle').textContent = S.sheetTitle ? 'エディトリアルPM' : '';
  const a = $('sheetLink'); a.href = 'https://docs.google.com/spreadsheets/d/' + S.sheetId + '/edit'; a.textContent = S.sheetName || S.sheetId;
  $('shareUrl').textContent = projectUrl(S.sheetId);
  const sel = $('tabSelect'); sel.textContent = '';
  const special = ['デザイン', '設定', 'メンバー', 'コメント', '図版', '経費', '議事録', 'タスク'];
  S.tabs.filter((t) => special.indexOf(t.title) < 0).forEach((t) => { const o = document.createElement('option'); o.value = t.title; o.textContent = t.title; sel.appendChild(o); });
  sel.value = S.tabName; sel.disabled = !isStaff();
  renderColMap();
}
function renderColMap() {
  const box = $('colMap'); box.textContent = '';
  if (!S.rows || !S.rows.length) return;
  const width = Math.min(26, Math.max(1, ...S.rows.slice(0, 20).map((r) => r.length)));
  const head = S.rows[S.headerRow >= 0 ? S.headerRow : 0] || [];
  COLDEFS.forEach(([key, label]) => {
    const f = document.createElement('label'); f.className = 'field';
    const sp = document.createElement('span'); sp.textContent = label;
    const sel = document.createElement('select'); sel.id = 'col_' + key; sel.disabled = !isStaff();
    const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
    add('auto', '自動'); add('-1', '使わない');
    for (let i = 0; i < width; i++) { const h = String(head[i] == null ? '' : head[i]).trim(); add(String(i), colName(i) + (h ? '：' + h.slice(0, 14) : '')); }
    sel.value = key in S.colOverride ? String(S.colOverride[key]) : 'auto';
    if (!(key in S.colOverride)) sel.options[0].textContent = '自動（' + (S.map[key] >= 0 ? colName(S.map[key]) : 'なし') + '）';
    sel.addEventListener('change', () => {
      if (sel.value === 'auto') delete S.colOverride[key]; else S.colOverride[key] = parseInt(sel.value, 10);
      rebuildRows(); renderColMap(); renderBoard(); buildBook(); refreshAssignments(); renderViews();
      setMsg('projMsg', '変更しました。「判型・製本」の「設定をシートに保存」で全員に反映されます。');
    });
    f.append(sp, sel); box.appendChild(f);
  });
}

/* ---- 判型・製本 panel ---- */
function initSettingsUI() {
  const tp = $('trimPreset'); TRIMS.forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; tp.appendChild(o); });
  const pp = $('paperPreset'); PAPERS.forEach((t) => { const o = document.createElement('option'); o.value = t.id; o.textContent = t.name; pp.appendChild(o); });
  tp.addEventListener('change', () => { const t = TRIMS.find((x) => x.id === tp.value); if (t && t.w) { $('trimW').value = t.w; $('trimH').value = t.h; } readSettingsFromUI(); onSettingsChanged(); });
  pp.addEventListener('change', () => { const p = PAPERS.find((x) => x.id === pp.value); if (p && p.t) $('paperT').value = p.t; readSettingsFromUI(); onSettingsChanged(); });
  ['trimW', 'trimH', 'binding', 'bindType', 'paperT', 'coverT', 'bleed', 'bookTitle', 'coverColor'].forEach((id) => $(id).addEventListener('input', () => { readSettingsFromUI(); onSettingsChanged(); }));
  $('folderUrl').addEventListener('change', () => { S.set.folder = $('folderUrl').value.trim(); });
  pushSettingsToUI();
}
function pushSettingsToUI() {
  const s = S.set;
  $('trimPreset').value = s.trim; $('trimW').value = s.w; $('trimH').value = s.h;
  $('binding').value = s.binding; $('bindType').value = s.bindType;
  $('paperPreset').value = s.paper; $('paperT').value = s.t; $('coverT').value = s.c; $('bleed').value = s.bleed;
  $('bookTitle').value = s.title || ''; $('coverColor').value = s.color || '#27474f'; $('folderUrl').value = s.folder || '';
  $('projName').value = s.name || ''; $('schedUrl').value = s.schedule || '';
  document.querySelectorAll('.ed').forEach((el) => { el.disabled = !isStaff(); });
}
function readSettingsFromUI() {
  const s = S.set, num = (id, d, lo, hi) => { const v = parseFloat($(id).value); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  s.w = num('trimW', s.w, 40, 600); s.h = num('trimH', s.h, 40, 800);
  const hit = TRIMS.find((x) => x.w === s.w && x.h === s.h); s.trim = hit ? hit.id : 'custom'; $('trimPreset').value = s.trim;
  s.binding = $('binding').value; s.bindType = $('bindType').value;
  s.t = num('paperT', s.t, 0.02, 0.5);
  const ph = PAPERS.find((x) => x.t && Math.abs(x.t - s.t) < 1e-6); s.paper = ph ? ph.id : 'custom'; $('paperPreset').value = s.paper;
  s.c = num('coverT', s.c, 0.1, 8); s.bleed = num('bleed', s.bleed, 0, 10);
  s.title = $('bookTitle').value; s.color = $('coverColor').value; s.folder = $('folderUrl').value.trim();
  s.name = $('projName').value.trim(); s.schedule = $('schedUrl').value.trim();
}
let settingsTimer = 0;
function onSettingsChanged() {
  setMsg('bookMsg', '未保存の変更があります。', '');
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => { S.thumbs.clear(); texClearAll(); renderBoard(); buildBook(); renderStats(); }, 220);
}
async function saveSettings(msgId) {
  msgId = typeof msgId === 'string' ? msgId : 'bookMsg';
  if (!isStaff()) return false;
  const sched = $('schedUrl').value.trim();
  if (sched && !extractSheetId(sched)) { setMsg(msgId, 'スケジュールのURLが正しくありません（https://docs.google.com/spreadsheets/d/… の形）。', 'err'); return false; }
  readSettingsFromUI(); S.set.tab = S.tabName;
  const rows = settingsToRows(S.set, S.colOverride);
  setMsg(msgId, '保存中…');
  try {
    await relay('settingsSave', { rows });
    setMsg(msgId, 'シートの「設定」タブに保存しました。', 'ok');
    if (msgId === 'projMsg') await loadProject();
    return true;
  } catch (e) { setMsg(msgId, e.message, 'err'); return false; }
}

/* ---- デザインPDF list ---- */
let listTimer = 0;
function renderDesignListSoon() { clearTimeout(listTimer); listTimer = setTimeout(renderDesignList, 300); }
function renderDesignList() {
  const ul = $('designList');
  if (ul.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { renderDesignListSoon(); return; }
  ul.textContent = '';
  const ed = isStaff();
  const note = (cls, text) => { const li = document.createElement('li'); const s = document.createElement('span'); s.className = cls; s.textContent = text; li.appendChild(s); ul.appendChild(li); };
  if (S.folderErr) note('err', S.folderErr);
  else if (!extractDriveId(S.set.folder)) note('nm muted', 'デザインフォルダが未設定です（初回のアップロード時に自動で作成されます）。');
  if (!S.designs.length && !autoFiles().length && !S.folderErr && extractDriveId(S.set.folder)) note('nm muted', 'デザインフォルダにPDFがありません');
  S.designs.forEach((d) => {
    const src = S.sources.get(d.id) || {};
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = d.name || src.name || d.id; nm.title = nm.textContent;
    li.appendChild(nm);
    if (ed) {
      const mk = (val, title, w) => { const i = document.createElement('input'); i.type = 'text'; i.value = val; i.title = title; i.setAttribute('aria-label', title); i.style.width = w; return i; };
      const f = mk(String(d.from), 'PDFのページ（開始）', '3.5em'), t = mk(d.to ? String(d.to) : '', 'PDFのページ（終了・空欄＝最後まで）', '3.5em'), s = mk(d.startText || startFieldText(d.start), '台割のどのページから貼るか', '4.5em');
      const lab = (txt) => { const e = document.createElement('span'); e.className = 'meta'; e.textContent = txt; return e; };
      li.append(lab('PDFの'), f, lab('〜'), t, lab('ページを、台割の'), s, lab('から'));
      const save = () => {
        if (f.value === String(d.from) && t.value === (d.to ? String(d.to) : '') && s.value === (d.startText || startFieldText(d.start))) return;
        editDesignRow(d, f.value, t.value, s.value);
      };
      [f, t, s].forEach((i) => { i.addEventListener('change', save); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } }); });
      const del = document.createElement('button'); del.className = 'btn sm'; del.textContent = '外す';
      del.title = '「デザイン」タブからこの行を消します。PDFがデザインフォルダにあれば、名前順の自動配置に戻ります';
      let armed = 0;
      del.addEventListener('click', () => {
        if (!armed) { del.textContent = 'もう一度押すと外します'; armed = setTimeout(() => { armed = 0; del.textContent = '外す'; }, 3000); return; }
        clearTimeout(armed); deleteDesignRow(d);
      });
      li.append(del);
    } else {
      const m = document.createElement('span'); m.className = 'meta';
      m.textContent = 'PDF p' + d.from + '〜' + (d.to || (src.numPages || '末尾')) + ' → ' + keyLabel(d.start) + 'から';
      li.appendChild(m);
    }
    if (src.err) { const er = document.createElement('span'); er.className = 'err'; er.textContent = src.err; li.appendChild(er); }
    ul.appendChild(li);
  });
  autoFiles().forEach((f) => {
    const src = S.sources.get(f.id) || {};
    const li = document.createElement('li');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = f.name; nm.title = f.name;
    const m = document.createElement('span'); m.className = 'meta';
    const r = placedRange(f.id);
    m.textContent = 'フォルダから自動' + (src.numPages ? '・' + src.numPages + 'P' : '') + (r ? ' → ' + r : (src.pdf ? ' → 空きページなし' : ' → 読み込み中'));
    li.append(nm, m);
    if (ed) {
      const pin = document.createElement('button'); pin.className = 'btn sm'; pin.textContent = '位置を指定';
      pin.title = '今の位置で「デザイン」タブに記録し、貼る位置を変えられるようにします';
      pin.addEventListener('click', () => pinAutoFile(f));
      li.appendChild(pin);
    }
    if (src.err) { const er = document.createElement('span'); er.className = 'err'; er.textContent = src.err; li.appendChild(er); }
    ul.appendChild(li);
  });
}
async function editDesignRow(d, fromTxt, toTxt, startTxt) {
  const from = parseInt(z2h(fromTxt), 10), to = toTxt.trim() ? parseInt(z2h(toTxt), 10) : '';
  const start = parseKeyText(startTxt);
  if (!(from > 0) || (to !== '' && !(to >= from)) || start === null) { setMsg('designMsg', 'PDFのページ範囲か貼る位置が正しくありません（1／表1／表2／表3／表4／背）。', 'err'); return; }
  setMsg('designMsg', '保存中…');
  try {
    await relay('designUpdate', { row: d.row, id: d.id, from, to, start: startFieldText(start) });
    await reloadDesigns();
    setMsg('designMsg', (d.name || 'PDF') + 'を' + keyLabel(start) + 'から貼るように保存しました。', 'ok'); goToKey(start);
  } catch (e) { setMsg('designMsg', e.message, 'err'); }
}
async function deleteDesignRow(d) {
  setMsg('designMsg', '外しています…');
  try {
    await relay('designDelete', { row: d.row, id: d.id });
    await reloadDesigns();
    setMsg('designMsg', '指定を外しました。PDFがデザインフォルダにある場合は、名前順の自動配置に戻ります（台割から消すには、PDFをフォルダの外へ移してください）。', 'ok');
  } catch (e) { setMsg('designMsg', e.message, 'err'); }
}

/* ---- upload (社内) ---- */
function dropOnTile(files, key) {
  if (!isStaff()) { toast('PDFの登録は社内メンバーだけが行えます', 'err'); return; }
  uploadFiles(files, key);
}
let uploading = false;
async function uploadFiles(files, startKey) {
  if (uploading) { setMsg('designMsg', '前のアップロードが終わるまでお待ちください。', 'err'); return; }
  setView('board'); openPanel('panelDesign');
  if (!isStaff()) { setMsg('designMsg', 'PDFの登録は社内メンバーだけが行えます。', 'err'); return; }
  if (!NS()) { setMsg('designMsg', '先に台割を読み込んでください。', 'err'); return; }
  const pdfs = files.filter((f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)));
  const skipped = files.length - pdfs.length;
  if (!pdfs.length) { setMsg('designMsg', 'PDFを選んでください。', 'err'); return; }
  let cursor = startKey !== undefined && startKey !== null ? startKey : parseKeyText($('upStart').value);
  if (cursor === null) cursor = 1;
  const first = cursor, rows = [], notes = [];
  uploading = true; $('upProg').hidden = false; $('upBar').style.width = '0%';
  try {
    for (let i = 0; i < pdfs.length; i++) {
      const f = pdfs[i];
      if (cursor === null) { notes.push(f.name + 'は台割の末尾を超えるため登録しませんでした'); continue; }
      setMsg('designMsg', 'アップロード中（' + (i + 1) + '／' + pdfs.length + '）：' + f.name);
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
      const n = pdf.numPages;
      const up = await relayUpload(f, 'design', (p) => { $('upBar').style.width = Math.round(((i + p) / pdfs.length) * 100) + '%'; });
      const s = srcFor(up.id, f.name); s.blob = f; s.pdf = pdf; s.numPages = n; s.err = '';
      rows.push([fileUrl(up.id), f.name, 1, n, startFieldText(cursor)]);
      cursor = cursor === 'S' ? null : nextKeyAfter(cursor, n);
    }
    if (rows.length) await relay('designAppend', { rows });
    $('upBar').style.width = '100%';
    await reloadDesigns();
    if (cursor !== null && startKey === undefined) $('upStart').value = startFieldText(cursor);
    const tail = (skipped ? ' PDF以外の' + skipped + 'ファイルは除外しました。' : '') + (notes.length ? ' ' + notes.join(' ／ ') : '');
    setMsg('designMsg', rows.length + '件を登録し、' + keyLabel(first) + 'から貼りました。' + (cursor !== null ? ' 次の貼り始め：' + startFieldText(cursor) : '') + tail, notes.length ? 'err' : 'ok');
    if (rows.length) goToKey(first);
  } catch (e) {
    setMsg('designMsg', e.message + (rows.length ? '（' + rows.length + '件はドライブに保存済み・シート未記録）' : ''), 'err');
  } finally {
    uploading = false; setTimeout(() => { $('upProg').hidden = true; }, 800);
  }
}
