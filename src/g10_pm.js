/* ===== project management: views, page detail, progress, comments, figures, expenses, members ===== */
const H_COMMENT = ['ID', 'ページ', '投稿者', '名前', '日時', '本文', '返信先', '状態'];
const H_FIGURE = ['ID', 'ページ', '図版番号', '種別', '内容', '手配状況', '提供元・撮影者', 'クレジット', 'ファイル', 'メモ', '更新者', '更新日時'];
const H_EXPENSE = ['ID', '日付', '区分', '内容', '支払先', '金額（税込）', '支払者', '領収書', '精算', '登録者', '登録日時', '備考'];   // 7th/9th were 担当/承認 before; same places
const FIG_KINDS = ['写真', 'イラスト', '図', 'ロゴ', 'その他'];
const FIG_STATES = ['未定', '依頼中', '入稿済', '確定'];
const EXP_KINDS = ['交通費', '印刷費', '物品購入', '食費', '宿泊費', 'その他'];
const DEFAULT_STAGE_STATES = ['未／待ち', '未／着手OK', '調整中', '確定'];
const rowObj = (head, arr) => { const o = {}; head.forEach((k, i) => { o[k] = arr[i] == null ? '' : String(arr[i]); }); return o; };

/* ---- tiny DOM helper ---- */
function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach((k) => {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  });
  kids.flat().forEach((c) => { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
  return e;
}
let toastTimer = 0;
function toast(text, cls) {
  const t = $('toast'); t.textContent = text; t.className = 'toast' + (cls ? ' ' + cls : ''); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, cls === 'err' ? 6000 : 2600);
}
function armButton(btn, label, armedLabel, fn) {
  let armed = 0;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    if (!armed) { btn.textContent = armedLabel; armed = setTimeout(() => { armed = 0; btn.textContent = label; }, 3000); return; }
    clearTimeout(armed); armed = 0; btn.textContent = label; fn();
  });
  return btn;
}
/** while fn runs: the control is disabled and shows that it is working (a spinner and 「保存中…」 on buttons, a pulse on selects) */
const BUSY_WORDS = { '保存': '保存中…', '追加': '追加中…', '削除': '削除中…', '登録': '登録中…', '更新': '更新中…', '送信': '送信中…' };
function busyOn(btn) {
  if (!btn) return null;
  const was = { html: btn.tagName === 'BUTTON' ? btn.innerHTML : null };
  btn.disabled = true; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true');
  if (was.html !== null) {
    const t = btn.textContent.trim(), w = BUSY_WORDS[t] || (/(を)?保存$/.test(t) ? '保存中…' : t);
    btn.textContent = ''; btn.append(el('span', { class: 'spin', 'aria-hidden': 'true' }), w);
  }
  return was;
}
function busyOff(btn, was) {
  if (!btn) return;
  btn.disabled = false; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy');
  if (was && was.html !== null) btn.innerHTML = was.html;
}
async function busy(btn, fn) {
  const was = busyOn(btn);
  try { return await fn(); } catch (e) { toast(e.message, 'err'); if (e.code === 'stale') loadProject(); return null; } finally { busyOff(btn, was); }
}

/* ---- views ---- */
const VIEWS = ['board', 'progress', 'schedule', 'tasks', 'minutes', 'comments', 'figures', 'expenses', 'members'];
let curView = 'board';
function setView(v) {
  if (VIEWS.indexOf(v) < 0 || $('vt-' + v).hidden) v = 'board';
  curView = v;
  VIEWS.forEach((x) => { $('view-' + x).hidden = x !== v; $('vt-' + x).classList.toggle('on', x === v); });
  try { sessionStorage.setItem('dandori.view', v); } catch (e) { /* ignore */ }
  renderView(v);
  if (v === 'board' && V.ok) { resize(); invalidate(); }
}
function renderViews() { renderBadges(); renderView(curView); if (S.detailKey !== undefined && !$('detail').hidden) renderDetail(); }
function renderView(v) {
  if (!S.loaded) return;
  if (v === 'progress') renderProgress();
  else if (v === 'comments') renderComments();
  else if (v === 'figures') renderFigures();
  else if (v === 'expenses') renderExpenses();
  else if (v === 'members') renderMembers();
  else if (v === 'schedule') renderSchedule();
  else if (v === 'tasks') renderTasks();
  else if (v === 'minutes') renderMinutes();
}
function renderBadges() {
  const n = S.comments.filter((c) => !c['返信先'] && c['状態'] !== '対応済').length;
  const b = $('badgeComments'); b.hidden = !n; b.textContent = n;
}

/* ---- pages ---- */
const pageLabel = (k) => keyLabel(k);
const keyOfLabel = (label) => { const k = parseKeyText(label); return k === null ? null : k; };
function pageKeys() { return orderKeys(Math.max(NS(), 2)).filter((k) => S.model.pages.has(k)); }
function pageTitle(k) { const i = S.model.pages.get(k); return i ? (i.title || i.kind || '') : ''; }
function stageCols() {
  if (S.headerRow < 0) return [];
  const h = S.rows[S.headerRow] || [];
  const out = [];
  h.forEach((name, i) => { if (/校/.test(String(name))) out.push({ col: i, name: String(name).trim() }); });
  return out;
}
function stageOptions(col) {
  const fromSheet = S.statusOptions[col] || S.statusOptions[String(col)];
  const base = fromSheet && fromSheet.length ? fromSheet.slice() : DEFAULT_STAGE_STATES.slice();
  S.rows.slice(S.headerRow + 1).forEach((r) => { const v = String(r[col] || '').trim(); if (v && base.indexOf(v) < 0) base.push(v); });
  return base;
}
function stateClass(v) {
  v = String(v || '').trim();
  if (!v) return 'none';
  if (/確定|完了|校了|済|^ok$|^ＯＫ$/i.test(v)) return 'done';
  if (/着手ok|着手ＯＫ/i.test(v)) return 'ready';
  if (/調整|作業|確認|修正|進行|対応中/.test(v)) return 'doing';
  if (/未|待/.test(v)) return 'todo';
  return 'other';
}
function pageStages(k) {
  const info = S.model.pages.get(k);
  if (!info) return [];
  const row = S.rows[info.row] || [];
  return stageCols().map((s) => Object.assign({}, s, { value: String(row[s.col] || '').trim() }));
}
function currentStage(k) { const st = pageStages(k); for (let i = st.length - 1; i >= 0; i--) if (st[i].value) return st[i]; return null; }
function stageChip(st, short) {
  if (!st) return null;
  return el('span', { class: 'chip st-' + stateClass(st.value), title: st.name + '：' + st.value }, short ? st.name : st.name + ' ' + st.value);
}
function openComments(label) { return S.comments.filter((c) => c['ページ'] === label && !c['返信先'] && c['状態'] !== '対応済').length; }
async function setStage(k, col, value, sel) {
  const info = S.model.pages.get(k);
  if (!info || S.map.page < 0) { toast('ページ列がない台割では進捗を変更できません', 'err'); return; }
  const row = S.rows[info.row];
  await busy(sel, async () => {
    const r = await relay('status', { tab: S.tabName, headerRow: S.headerRow + 1, pageCol: S.map.page + 1, row: info.row + 1, col: col + 1, page: row[S.map.page], value, origin: entryUrl() });
    row[col] = r.value;
    toast(pageLabel(k) + '：' + (S.rows[S.headerRow][col]) + 'を「' + r.value + '」にしました');
    renderBoard(); renderViews();
  });
}
function stageSelect(k, st) {
  const sel = el('select', { class: 'stsel st-' + stateClass(st.value), 'aria-label': pageLabel(k) + 'の' + st.name, disabled: !canProgress() });
  sel.appendChild(el('option', { value: '', text: '—' }));
  stageOptions(st.col).forEach((o) => sel.appendChild(el('option', { value: o, text: o })));
  sel.value = st.value;
  sel.addEventListener('change', () => setStage(k, st.col, sel.value, sel));
  return sel;
}

/* ---- selecting a page ---- */
function selectPage(k) {
  if (k === null || k === undefined) return;
  goToKey(k);
  openDetail(k);
}
function openPageFromUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get('view') && !q.get('page')) { if (q.get('minute')) minSel = q.get('minute'); setView(q.get('view')); return; }
  const p = q.get('page');
  if (!p) return;
  const k = keyOfLabel(p);
  if (k !== null) { setView('board'); selectPage(k); }
}

/* ---- page detail drawer ---- */
function openDetail(k) {
  S.detailKey = k; $('detail').hidden = false; document.body.classList.add('has-detail');
  renderDetail();
  if (V.ok) { resize(); }
}
/** the open detail panel follows the book: turning to another spread shows that spread's first page */
function followSpread(s) {
  if ($('detail').hidden || !NS()) return;
  const sk = spreadKeys(s, NS(), S.set.binding), keys = [sk.left, sk.right].filter((x) => x !== null && x !== undefined);
  if (!keys.length || keys.some((x) => kstr(x) === kstr(S.detailKey))) return;
  const order = orderKeys(Math.max(NS(), 2)).map(kstr);
  keys.sort((a, b) => order.indexOf(kstr(a)) - order.indexOf(kstr(b)));
  S.detailKey = keys[0]; renderDetail();
}
function closeDetail() { $('detail').hidden = true; document.body.classList.remove('has-detail'); if (V.ok) resize(); }
function stepDetail(d) {
  const keys = orderKeys(Math.max(NS(), 2));
  let i = keys.findIndex((k) => kstr(k) === kstr(S.detailKey));
  i = Math.max(0, Math.min(keys.length - 1, i + d));
  selectPage(keys[i]);
}
function renderDetail() {
  const k = S.detailKey, body = $('dBody'), label = pageLabel(k), info = S.model.pages.get(k);
  $('dTitle').textContent = label + (pageTitle(k) ? '　' + pageTitle(k) : '');
  body.textContent = '';
  // 台割の内容
  const head = S.rows[S.headerRow >= 0 ? S.headerRow : 0] || [];
  const stageIdx = stageCols().map((s) => s.col);
  if (info) {
    const row = S.rows[info.row] || [];
    const dl = el('dl', { class: 'kvlist' });
    head.forEach((h, i) => { if (i === S.map.page || stageIdx.indexOf(i) >= 0) return; const v = String(row[i] || '').trim(); if (!h || !v) return; dl.append(el('dt', { text: h }), el('dd', { text: v })); });
    body.appendChild(el('section', { class: 'dsec' }, el('h3', { text: '台割の内容' }), dl.children.length ? dl : el('p', { class: 'muted', text: '記入がありません' })));
  } else body.appendChild(el('p', { class: 'muted', text: typeof k === 'number' && k > NS() ? '調整用の白ページです' : '台割にこのページの行がありません' }));
  // 進捗
  const st = pageStages(k);
  if (st.length) {
    const box = el('div', { class: 'stages' });
    st.forEach((s) => box.appendChild(el('label', { class: 'stage' }, el('span', { text: s.name }), stageSelect(k, s))));
    body.appendChild(el('section', { class: 'dsec' }, el('h3', { text: '進捗' }), box, canProgress() ? null : el('p', { class: 'hint', text: '進捗の変更は社内とチームメンバーが行えます' })));
  }
  // デザイン
  const a = S.assign.get(kstr(k));
  const src = a && S.sources.get(a.src);
  body.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'デザイン' }),
    a ? el('p', null, (src && src.name ? src.name : 'PDF') + ' の ' + a.page + 'ページ目', ' ', el('button', { class: 'btn sm', onclick: () => { setView('board'); goToKey(k); } }, '3Dで見る')) : el('p', { class: 'muted', text: 'まだPDFが貼られていません' })));
  // コメント
  body.appendChild(commentSection(label));
  // 図版
  body.appendChild(figureSection(label));
}

/* ---- comments ---- */
async function addComment(label, text, replyTo, btn) {
  text = String(text || '').trim();
  if (!text) { toast('コメントを入力してください', 'err'); return false; }
  const r = await busy(btn, () => relay('commentAdd', { page: label, text, replyTo: replyTo || '', origin: location.origin + location.pathname }));
  if (!r) return false;
  S.comments.push(rowObj(H_COMMENT, r.comment));
  toast(r.notified ? 'コメントしました（' + r.notified + '人に通知。メールは18時にまとめて届きます）' : 'コメントしました');
  if (r.notified) refreshNotices();
  renderBoard(); renderViews();
  return true;
}
async function setCommentState(c, state, btn) {
  const r = await busy(btn, () => relay('commentState', { id: c.ID, state }));
  if (!r) return;
  c['状態'] = state; renderBoard(); renderViews();
}
async function deleteComment(c) {
  const r = await busy(null, () => relay('commentDelete', { id: c.ID }));
  if (!r) return;
  S.comments = S.comments.filter((x) => x !== c && x['返信先'] !== c.ID);
  toast('コメントを削除しました'); renderBoard(); renderViews();
}
const mineOrStaff = (c) => isStaff() || String(c['投稿者']).toLowerCase() === String(S.me && S.me.email).toLowerCase();
function commentItem(c, withPage) {
  const replies = S.comments.filter((x) => x['返信先'] === c.ID);
  const done = c['状態'] === '対応済';
  const li = el('li', { class: 'citem' + (done ? ' done' : '') });
  const k = keyOfLabel(c['ページ']);
  li.appendChild(el('div', { class: 'cmeta' },
    withPage ? el('button', { class: 'pagelink', onclick: () => { setView('board'); selectPage(k); } }, c['ページ'] + (k !== null && pageTitle(k) ? ' ' + pageTitle(k) : '')) : null,
    el('b', { text: c['名前'] || c['投稿者'] }), el('span', { class: 'muted', text: c['日時'] }),
    done ? el('span', { class: 'chip st-done', text: '対応済' }) : el('span', { class: 'chip st-doing', text: '未対応' })));
  li.appendChild(el('p', { class: 'ctext', text: c['本文'] }));
  replies.forEach((rp) => li.appendChild(el('div', { class: 'reply' }, el('div', { class: 'cmeta' }, el('b', { text: rp['名前'] || rp['投稿者'] }), el('span', { class: 'muted', text: rp['日時'] }),
    mineOrStaff(rp) ? armButton(el('button', { class: 'btn xs' }), '削除', 'もう一度押すと削除', () => deleteComment(rp)) : null), el('p', { class: 'ctext', text: rp['本文'] }))));
  const acts = el('div', { class: 'cacts' });
  const replyBox = el('div', { class: 'replybox', hidden: true });
  const ta = el('textarea', { rows: 2, placeholder: '返信を書く', 'aria-label': '返信' });
  const send = el('button', { class: 'btn sm primary' }, '返信する');
  send.addEventListener('click', async () => { if (await addComment(c['ページ'], ta.value, c.ID, send)) { ta.value = ''; } });
  replyBox.append(ta, send);
  acts.appendChild(el('button', { class: 'btn xs', onclick: () => { replyBox.hidden = !replyBox.hidden; if (!replyBox.hidden) ta.focus(); } }, '返信'));
  if (mineOrStaff(c)) {
    const t = el('button', { class: 'btn xs' }, done ? '未対応に戻す' : '対応済にする');
    t.addEventListener('click', () => setCommentState(c, done ? '未対応' : '対応済', t));
    acts.appendChild(t);
    acts.appendChild(armButton(el('button', { class: 'btn xs' }), '削除', 'もう一度押すと削除', () => deleteComment(c)));
  }
  li.append(acts, replyBox);
  return li;
}
function commentSection(label) {
  const list = S.comments.filter((c) => c['ページ'] === label && !c['返信先']);
  const ul = el('ul', { class: 'clist' }, list.map((c) => commentItem(c, false)));
  const ta = el('textarea', { rows: 3, placeholder: 'このページへのコメント（投稿すると社内メンバーにメールで通知されます）', 'aria-label': 'コメント' });
  const send = el('button', { class: 'btn primary' }, 'コメントする');
  send.addEventListener('click', async () => { if (await addComment(label, ta.value, '', send)) ta.value = ''; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send.click(); } });
  return el('section', { class: 'dsec' }, el('h3', { text: 'コメント（' + list.length + '）' }), list.length ? ul : el('p', { class: 'muted', text: 'まだコメントはありません' }), el('div', { class: 'cform' }, ta, send));
}
let cFilter = 'open';
function renderComments() {
  const q = ($('cSearch').value || '').trim().toLowerCase();
  const list = S.comments.filter((c) => !c['返信先'])
    .filter((c) => cFilter === 'all' || c['状態'] !== '対応済')
    .filter((c) => !q || [c['本文'], c['ページ'], c['名前'], pageTitle(keyOfLabel(c['ページ']))].join(' ').toLowerCase().indexOf(q) >= 0)
    .slice().reverse();
  const ul = $('commentList'); ul.textContent = '';
  if (!list.length) ul.appendChild(el('li', { class: 'muted', text: cFilter === 'open' ? '未対応のコメントはありません' : 'コメントはありません' }));
  list.forEach((c) => ul.appendChild(commentItem(c, true)));
}

/* ---- figures ---- */
function figureForm(f, label, onDone) {
  f = f || {};
  const inp = (name, attrs) => el('input', Object.assign({ type: 'text', value: f[name] || '', 'aria-label': name }, attrs || {}));
  const sel = (name, opts) => { const s = el('select', { 'aria-label': name }); opts.forEach((o) => s.appendChild(el('option', { value: o, text: o }))); s.value = f[name] || opts[0]; return s; };
  const pageSel = el('select', { 'aria-label': 'ページ' });
  pageKeys().concat(orderKeys(Math.max(NS(), 2)).filter((k) => !S.model.pages.has(k))).forEach((k) => pageSel.appendChild(el('option', { value: pageLabel(k), text: pageLabel(k) + (pageTitle(k) ? ' ' + pageTitle(k) : '') })));
  pageSel.value = f['ページ'] || label || pageLabel(pageKeys()[0] || 1);
  const F = { 'ページ': pageSel, '図版番号': inp('図版番号'), '種別': sel('種別', FIG_KINDS), '内容': el('textarea', { rows: 2, 'aria-label': '内容' }), '手配状況': sel('手配状況', FIG_STATES), '提供元・撮影者': inp('提供元・撮影者'), 'クレジット': inp('クレジット'), 'ファイル': inp('ファイル', { placeholder: 'ドライブなどのURL' }), 'メモ': el('textarea', { rows: 2, 'aria-label': 'メモ' }) };
  F['内容'].value = f['内容'] || ''; F['メモ'].value = f['メモ'] || '';
  const save = el('button', { class: 'btn primary' }, f.ID ? '保存' : '追加');
  const box = el('div', { class: 'form' }, Object.keys(F).map((k) => el('label', { class: 'field' + (k === '内容' || k === 'メモ' ? ' wide' : '') }, el('span', { text: k }), F[k])),
    el('div', { class: 'formacts' }, save, el('button', { class: 'btn', onclick: () => onDone(false) }, 'やめる')));
  save.addEventListener('click', async () => {
    const values = {}; Object.keys(F).forEach((k) => { values[k] = F[k].value; });
    const r = await busy(save, () => relay('figureSave', { id: f.ID || '', values }));
    if (!r) return;
    const obj = rowObj(H_FIGURE, r.row);
    const i = S.figures.findIndex((x) => x.ID === obj.ID);
    if (i >= 0) S.figures[i] = obj; else S.figures.push(obj);
    toast(f.ID ? '図版を更新しました' : '図版を追加しました'); onDone(true);
  });
  return box;
}
async function deleteFigure(f) {
  const r = await busy(null, () => relay('figureDelete', { id: f.ID }));
  if (!r) return;
  S.figures = S.figures.filter((x) => x !== f); toast('図版を削除しました'); renderViews();
}
function figStateChip(v) { const c = v === '確定' ? 'done' : v === '入稿済' ? 'ready' : v === '依頼中' ? 'doing' : 'todo'; return el('span', { class: 'chip st-' + c, text: v || '未定' }); }
function fileLink(url) { if (!url) return null; return /^https?:\/\//.test(url) ? el('a', { href: url, target: '_blank', rel: 'noopener', text: 'ファイル' }) : el('span', { text: url }); }
function figureSection(label) {
  const list = S.figures.filter((f) => f['ページ'] === label);
  const sec = el('section', { class: 'dsec' }, el('h3', { text: '図版（' + list.length + '）' }));
  const box = el('div');
  const draw = () => {
    box.textContent = '';
    list.forEach((f) => {
      const card = el('div', { class: 'fcard' },
        el('div', { class: 'cmeta' }, el('b', { text: (f['図版番号'] ? f['図版番号'] + ' ' : '') + (f['種別'] || '') }), figStateChip(f['手配状況'])),
        f['内容'] ? el('p', { text: f['内容'] }) : null,
        el('p', { class: 'muted' }, [f['提供元・撮影者'], f['クレジット'] ? '© ' + f['クレジット'] : ''].filter(Boolean).join('　'), ' ', fileLink(f['ファイル'])),
        f['メモ'] ? el('p', { class: 'muted', text: f['メモ'] }) : null);
      if (canFigures()) {
        const acts = el('div', { class: 'cacts' }, el('button', { class: 'btn xs', onclick: () => { card.replaceWith(figureForm(f, label, (ch) => { if (ch) renderViews(); else draw(); })); } }, '編集'),
          armButton(el('button', { class: 'btn xs' }), '削除', 'もう一度押すと削除', () => deleteFigure(f)));
        card.appendChild(acts);
      }
      box.appendChild(card);
    });
    if (!list.length) box.appendChild(el('p', { class: 'muted', text: '図版は登録されていません' }));
    if (canFigures()) box.appendChild(el('button', { class: 'btn sm', onclick: (e) => { e.target.replaceWith(figureForm(null, label, (ch) => { if (ch) renderViews(); else draw(); })); } }, '図版を追加'));
  };
  draw(); sec.appendChild(box);
  return sec;
}
/* sort of the figure list: a column header toggles 昇順 → 降順; ties fall back to page order */
let figSort = { key: 'ページ', dir: 1 };
const FIG_SORTABLE = { 'ページ': 'ページ', '番号': '図版番号', '種別': '種別', '手配状況': '手配状況', '提供元・撮影者': '提供元・撮影者', 'クレジット': 'クレジット', '更新': '更新日時' };
/** links shown at the top of the 図版 tab, from the 設定 row 「図版タブのリンク」: one per line, 「ラベル URL」 */
function figTabLinks() {
  const row = (S.settingsRows || []).find((r) => r && /^図版(タブの)?リンク$/.test(String(r[0] || '').trim()));
  if (!row) return [];
  return String(row[1] || '').split(/\r?\n/).map((line) => {
    const m = line.match(/https?:\/\/[^\s　]+/);
    if (!m) return null;
    const label = line.replace(m[0], '').replace(/[|｜:：]\s*$/, '').trim();
    return { url: m[0], label: label || m[0] };
  }).filter(Boolean);
}
function renderFigLinks() {
  const box = $('figLinks'), links = figTabLinks();
  box.textContent = ''; box.hidden = !links.length;
  links.forEach((l) => box.appendChild(el('a', { href: l.url, target: '_blank', rel: 'noopener' }, el('span', { class: 'ico', 'aria-hidden': 'true', text: '📅' }), l.label, el('span', { class: 'ext', 'aria-hidden': 'true', text: ' ↗' }))));
}
function renderFigures() {
  renderFigLinks();
  const fsel = $('figFilter');
  if (!fsel.options.length) { fsel.appendChild(el('option', { value: '', text: 'すべて' })); FIG_STATES.forEach((s) => fsel.appendChild(el('option', { value: s, text: s }))); }
  const want = fsel.value;
  // 提供元・撮影者: the names in use (rebuilt each time, keeping the choice), plus 「（未設定）」
  const ssel = $('figSource'), pick = ssel.value;
  const names = [...new Set(S.figures.map((f) => String(f['提供元・撮影者'] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  ssel.textContent = '';
  ssel.appendChild(el('option', { value: '', text: 'すべて' }));
  names.forEach((n) => ssel.appendChild(el('option', { value: 'n:' + n, text: n })));
  ssel.appendChild(el('option', { value: '-', text: '（未設定）' }));
  ssel.value = [...ssel.options].some((o) => o.value === pick) ? pick : '';
  const src = ssel.value, srcOk = (f) => { const v = String(f['提供元・撮影者'] || '').trim(); return !src || (src === '-' ? !v : v === src.slice(2)); };
  const order = orderKeys(Math.max(NS(), 2)).map(pageLabel);
  const byPage = (a, b) => order.indexOf(a['ページ']) - order.indexOf(b['ページ']) || String(a['図版番号']).localeCompare(String(b['図版番号']), 'ja', { numeric: true });
  const col = figSort.key;
  const cmp = (a, b) => {
    if (col === 'ページ') return figSort.dir * byPage(a, b);
    const x = String((col === '手配状況' ? a[col] || '未定' : a[col]) || '').trim(), y = String((col === '手配状況' ? b[col] || '未定' : b[col]) || '').trim();
    if (!x !== !y) return x ? -1 : 1;                        // blanks always last
    return figSort.dir * x.localeCompare(y, 'ja', { numeric: true }) || byPage(a, b);
  };
  const list = S.figures.filter((f) => (!want || (f['手配状況'] || '未定') === want) && srcOk(f)).slice().sort(cmp);
  const t = $('figTable'); t.textContent = '';
  const head = (h) => {
    const key = FIG_SORTABLE[h];
    if (!key) return el('th', { text: h });
    const on = figSort.key === key;
    return el('th', { 'aria-sort': on ? (figSort.dir > 0 ? 'ascending' : 'descending') : 'none' },
      el('button', { class: 'sorth' + (on ? ' on' : ''), type: 'button', title: h + 'で並べ替え', onclick: () => { figSort = on ? { key, dir: -figSort.dir } : { key, dir: 1 }; renderFigures(); } },
        h, el('span', { class: 'sortmark', 'aria-hidden': 'true', text: on ? (figSort.dir > 0 ? '▲' : '▼') : '↕' })));
  };
  t.appendChild(el('thead', null, el('tr', null, ['ページ', '番号', '種別', '内容', '手配状況', '提供元・撮影者', 'クレジット', 'ファイル', '更新', ''].map(head))));
  const tb = el('tbody');
  list.forEach((f) => {
    const k = keyOfLabel(f['ページ']);
    const tr = el('tr', null,
      el('td', null, el('button', { class: 'pagelink', onclick: () => { setView('board'); selectPage(k); } }, f['ページ'])),
      el('td', { text: f['図版番号'] }), el('td', { text: f['種別'] }), el('td', { class: 'wrap', text: f['内容'] }), el('td', null, figStateChip(f['手配状況'])),
      el('td', { text: f['提供元・撮影者'] }), el('td', { text: f['クレジット'] }), el('td', null, fileLink(f['ファイル'])), el('td', { class: 'muted', text: [f['更新者'], f['更新日時']].filter(Boolean).join(' ') }),
      el('td', null, canFigures() ? el('button', { class: 'btn xs', onclick: () => showFigForm(f) }, '編集') : null));
    tb.appendChild(tr);
  });
  if (!list.length) tb.appendChild(el('tr', null, el('td', { colspan: 10, class: 'muted', text: '図版は登録されていません' })));
  t.appendChild(tb);
  $('btnFigAdd').hidden = !canFigures();
}
function showFigForm(f) {
  const box = $('figFormBox'); box.textContent = '';
  box.appendChild(figureForm(f, f ? f['ページ'] : '', (ch) => { box.textContent = ''; if (ch) renderViews(); }));
  if (f && canFigures()) box.firstChild.querySelector('.formacts').appendChild(armButton(el('button', { class: 'btn' }), '削除', 'もう一度押すと削除', () => { box.textContent = ''; deleteFigure(f); }));
  box.scrollIntoView({ block: 'nearest' });
}

/* ---- progress view ---- */
function renderProgress() {
  const stages = stageCols(), keys = pageKeys();
  const sum = $('progSummary'); sum.textContent = '';
  $('progHint').textContent = stages.length ? (canProgress() ? '状態を選ぶと、すぐにシートへ保存されます。' : '進捗の変更は社内とチームメンバーが行えます。') : '台割に「初校」「再校」など「〜校」で終わる列があると、工程として表示されます。';
  if (!stages.length) sum.appendChild(el('p', { class: 'muted', text: '工程の列が見つかりません（台割の見出しに「初校」などの列を追加してください）' }));
  const classes = ['done', 'doing', 'ready', 'todo', 'other', 'none'], names = { done: '確定', doing: '調整中', ready: '着手OK', todo: '未・待ち', other: 'その他', none: '空欄' };
  stages.forEach((s) => {
    const cnt = {}; classes.forEach((c) => { cnt[c] = 0; });
    keys.forEach((k) => { cnt[stateClass(pageStages(k).find((x) => x.col === s.col).value)]++; });
    const bar = el('div', { class: 'sbar', role: 'img', 'aria-label': s.name + '：' + classes.map((c) => names[c] + cnt[c]).join('、') }, classes.filter((c) => cnt[c]).map((c) => el('i', { class: 'st-' + c, style: 'flex:' + cnt[c], title: names[c] + ' ' + cnt[c] + 'P' })));
    sum.appendChild(el('div', { class: 'srow' }, el('b', { text: s.name }), bar, el('span', { class: 'muted', text: classes.filter((c) => cnt[c]).map((c) => names[c] + ' ' + cnt[c]).join('　') })));
  });
  if (stages.length) sum.appendChild(el('div', { class: 'legend2' }, classes.slice(0, 5).map((c) => el('span', null, el('i', { class: 'st-' + c }), names[c]))));
  // table
  const ssel = $('progSection');
  const cur = ssel.value;
  ssel.textContent = ''; ssel.appendChild(el('option', { value: '', text: 'すべて' }));
  S.model.sections.forEach((s) => ssel.appendChild(el('option', { value: s, text: s })));
  ssel.value = S.model.sections.indexOf(cur) >= 0 ? cur : '';
  const onlyOpen = $('progOpen').checked;
  const t = $('progTable'); t.textContent = '';
  t.appendChild(el('thead', null, el('tr', null, el('th', { text: 'ページ' }), el('th', { text: '内容' }), el('th', { text: 'セクション' }), stages.map((s) => el('th', { text: s.name })), el('th', { text: 'コメント' }), el('th', { text: '図版' }))));
  const tb = el('tbody');
  keys.forEach((k) => {
    const info = S.model.pages.get(k);
    if (ssel.value && info.section !== ssel.value) return;
    const st = pageStages(k);
    if (onlyOpen && st.length && stateClass(st[st.length - 1].value) === 'done') return;
    const label = pageLabel(k), nC = openComments(label), nF = S.figures.filter((f) => f['ページ'] === label).length;
    tb.appendChild(el('tr', null,
      el('td', null, el('button', { class: 'pagelink', onclick: () => { setView('board'); selectPage(k); } }, label)),
      el('td', { class: 'wrap', text: pageTitle(k) }), el('td', { class: 'muted', text: info.section || '' }),
      st.map((s) => el('td', null, stageSelect(k, s))),
      el('td', null, nC ? el('span', { class: 'chip st-doing', text: '未対応 ' + nC }) : ''), el('td', { class: 'muted', text: nF || '' })));
  });
  t.appendChild(tb);
}

/* ---- expenses ---- */
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
/** any digits typed (全角・カンマ・円・¥ included) → a plain half-width number string */
const toHalfDigits = (v) => String(v || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^\d]/g, '');
const amount = (e) => { const n = Number(toHalfDigits(e['金額（税込）'])); return isFinite(n) ? n : 0; };
const ymdSlash = (d) => d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0');
/* 支払者 and 精算 (a sheet made before may still say 担当／承認 until the relay renames them) */
const payerOf = (e) => String(e['支払者'] != null ? e['支払者'] : (e['担当'] || ''));
const settledOf = (e) => (e['精算'] != null ? e['精算'] : e['承認']) === '精算済';
const isoOfSlash = (v) => { const m = String(v || '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/); return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : ''; };
function renderExpenses() {
  const list = (S.expenses || []).slice();
  const sum = $('expSummary'); sum.textContent = '';
  const total = list.reduce((a, e) => a + amount(e), 0);
  const ym = ymdSlash(new Date()).slice(0, 7);
  const month = list.filter((e) => isoOfSlash(e['日付']).slice(0, 7).replace('-', '/') === ym).reduce((a, e) => a + amount(e), 0);
  sum.appendChild(el('div', { class: 'kpis' },
    el('div', { class: 'kpi' }, el('span', { text: '合計' }), el('b', { text: yen(total) })),
    el('div', { class: 'kpi' }, el('span', { text: '今月' }), el('b', { text: yen(month) })),
    el('div', { class: 'kpi warn' }, el('span', { text: '未精算' }), el('b', { text: yen(list.filter((e) => !settledOf(e)).reduce((a, e) => a + amount(e), 0)) })),
    el('div', { class: 'kpi' }, el('span', { text: '件数' }), el('b', { text: list.length + '件' }))));
  const byKind = {}; list.forEach((e) => { const k = e['区分'] || '未分類'; byKind[k] = (byKind[k] || 0) + amount(e); });
  const max = Math.max(1, ...Object.values(byKind));
  sum.appendChild(el('div', { class: 'bars' }, Object.keys(byKind).sort((a, b) => byKind[b] - byKind[a]).map((k) => el('div', { class: 'brow' }, el('span', { text: k }), el('div', { class: 'btrack' }, el('i', { style: 'width:' + (byKind[k] / max * 100).toFixed(1) + '%' })), el('b', { text: yen(byKind[k]) })))));
  const owe = {}; list.filter((e) => !settledOf(e)).forEach((e) => { const k = payerOf(e) || '（支払者なし）'; owe[k] = (owe[k] || 0) + amount(e); });
  if (Object.keys(owe).length) {
    sum.appendChild(el('h3', { class: 'subh', text: '支払者別の未精算' }));
    sum.appendChild(el('div', { class: 'owe' }, Object.keys(owe).sort((a, b) => owe[b] - owe[a]).map((k) => el('div', { class: 'owerow' }, el('span', { text: k }), el('b', { text: yen(owe[k]) })))));
  }
  const t = $('expTable'); t.textContent = '';
  t.appendChild(el('thead', null, el('tr', null, ['日付', '区分', '内容', '支払先', '金額（税込）', '支払者', '精算', '領収書', ''].map((h) => el('th', { text: h, class: h === '金額（税込）' ? 'num' : '' })))));
  const tb = el('tbody');
  list.sort((a, b) => isoOfSlash(b['日付']).localeCompare(isoOfSlash(a['日付']))).forEach((e) => {
    tb.appendChild(el('tr', null, el('td', { class: 'nowrap', text: e['日付'] }), el('td', null, e['区分'] ? el('span', { class: 'chip', text: e['区分'] }) : ''), el('td', { class: 'wrap' }, e['内容'] || '', e['備考'] ? el('div', { class: 'note', text: e['備考'] }) : null), el('td', { text: e['支払先'] }), el('td', { class: 'num' }, String(e['金額（税込）'] == null ? '' : e['金額（税込）']).trim() !== '' ? yen(amount(e)) : el('span', { class: 'chip st-todo', text: '金額未入力' })), el('td', { text: payerOf(e) }),
      el('td', null, settleChip(e)),
      el('td', null, e['領収書'] ? el('button', { class: 'btn xs', onclick: (ev) => openReceipt(e['領収書'], ev.target) }, '表示') : ''),
      el('td', null, isStaff() ? el('button', { class: 'btn xs', onclick: () => showExpForm(e) }, '編集') : null)));
  });
  if (!list.length) tb.appendChild(el('tr', null, el('td', { colspan: 9, class: 'muted', text: '経費は登録されていません' })));
  t.appendChild(tb);
}
/** 精算 in the list: 社内 switches it with one click */
function settleChip(e) {
  const done = settledOf(e), label = done ? '精算済' : '未精算';
  if (!isStaff()) return el('span', { class: 'chip ' + (done ? 'st-done' : 'st-todo'), text: label });
  const b = el('button', { type: 'button', class: 'chip chipbtn ' + (done ? 'st-done' : 'st-todo'), title: done ? '押すと未精算に戻します' : '押すと精算済にします' }, label);
  b.addEventListener('click', async () => {
    const next = done ? '未精算' : '精算済';
    const r = await busy(b, () => relay('expenseSave', { id: e.ID, values: { '精算': next, '承認': next } }));
    if (!r) return;
    const obj = rowObj(S.expenseHead || H_EXPENSE, r.row), i = S.expenses.findIndex((x) => x.ID === obj.ID);
    if (i >= 0) S.expenses[i] = obj;
    toast(next + 'にしました'); renderExpenses();
  });
  return b;
}
async function openReceipt(url, btn) {
  const id = extractDriveId(url);
  if (!id) { window.open(url, '_blank', 'noopener'); return; }
  const w = window.open('', '_blank');
  await busy(btn, async () => {
    const meta = await relayFileMeta(id);
    const blob = await relayDownload(meta);
    const u = URL.createObjectURL(blob);
    if (w) w.location = u; else window.open(u, '_blank');
  });
}
/** ¥-prefixed amount box: whatever is typed becomes half-width digits with thousands separators */
function yenInput(value) {
  const inp = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', lang: 'en', 'aria-label': '金額（税込）', placeholder: '0' });
  const fmt = () => { const d = toHalfDigits(inp.value).replace(/^0+(?=\d)/, ''); const out = d ? Number(d).toLocaleString('ja-JP') : ''; if (inp.value !== out) inp.value = out; };
  inp.value = value === '' || value == null ? '' : String(value);
  fmt();
  inp.addEventListener('input', (ev) => { if (!ev.isComposing) fmt(); });
  inp.addEventListener('compositionend', fmt);
  inp.addEventListener('blur', fmt);
  return el('div', { class: 'yen' }, el('span', { class: 'yen-mark', 'aria-hidden': 'true', text: '¥' }), inp);
}
function showExpForm(e) {
  e = e || {};
  const box = $('expFormBox'); box.textContent = '';
  // 区分: one tap
  let kind = EXP_KINDS.indexOf(e['区分']) >= 0 ? e['区分'] : (e['区分'] || EXP_KINDS[0]);
  const kinds = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '区分' });
  const kindList = EXP_KINDS.indexOf(kind) >= 0 ? EXP_KINDS : EXP_KINDS.concat([kind]);   // an old 区分 stays choosable
  const drawKinds = () => { kinds.textContent = ''; kindList.forEach((k) => kinds.appendChild(el('button', { type: 'button', class: 'segb' + (k === kind ? ' on' : ''), role: 'radio', 'aria-checked': String(k === kind), onclick: () => { kind = k; drawKinds(); } }, k))); };
  drawKinds();
  // 支払者: members
  const who = el('select', { 'aria-label': '支払者' });
  const people = (S.people && S.people.length ? S.people : (S.members || []).map((m) => ({ name: m['名前'] || m.name, email: m['メール'] || m.email }))).filter((p) => p && p.name);
  who.appendChild(el('option', { value: '', text: '（未選択）' }));
  people.forEach((p) => who.appendChild(el('option', { value: p.name, text: p.name })));
  const meName = (() => { const em = String((S.me && S.me.email) || AUTH.email || '').toLowerCase(); const p = people.find((x) => String(x.email || '').toLowerCase() === em); return p ? p.name : ((S.me && S.me.name) || AUTH.name || ''); })();
  const curWho = e.ID ? payerOf(e) : meName;     // a new expense: the signed-in person
  if (curWho && !people.some((p) => p.name === curWho)) who.appendChild(el('option', { value: curWho, text: curWho + '（メンバー外）' }));
  who.value = curWho;
  const date = el('input', { type: 'date', 'aria-label': '日付', value: isoOfSlash(e['日付']) || isoOfSlash(ymdSlash(new Date())) });
  // the calendar opens from the field itself, the button, or a quick 今日／昨日
  const openPicker = () => { try { if (date.showPicker) date.showPicker(); else date.focus(); } catch (err) { date.focus(); } };
  date.addEventListener('click', openPicker);
  const dayShift = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoOfSlash(ymdSlash(d)); };
  const dateBox = el('div', { class: 'datebox' },
    el('div', { class: 'datein' }, date, el('button', { type: 'button', class: 'calbtn', title: 'カレンダーから選ぶ', 'aria-label': 'カレンダーから選ぶ', onclick: openPicker }, '📅')),
    el('div', { class: 'quick' }, el('button', { type: 'button', class: 'linklike', onclick: () => { date.value = dayShift(0); } }, '今日'), el('button', { type: 'button', class: 'linklike', onclick: () => { date.value = dayShift(1); } }, '昨日')));
  const what = el('input', { type: 'text', 'aria-label': '内容', value: e['内容'] || '', placeholder: '例：撮影機材の運搬（タクシー）' });
  const payee = el('input', { type: 'text', 'aria-label': '支払先', value: e['支払先'] || '', placeholder: '例：〇〇交通' });
  const memo = el('textarea', { 'aria-label': '備考', rows: 2, placeholder: '算出方法や予約番号など' });
  memo.value = e['備考'] || '';
  const money = yenInput(e['金額（税込）'] !== undefined && e['金額（税込）'] !== '' ? amount(e) : '');
  // 領収書: upload (or a link), shown as a state rather than a raw URL
  let receipt = e['領収書'] || '';
  const recBox = el('div', { class: 'rec' });
  const file = el('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true });
  const drawRec = () => {
    recBox.textContent = '';
    if (receipt) {
      recBox.appendChild(el('span', { class: 'chip st-done', text: '添付済み' }));
      recBox.appendChild(el('button', { type: 'button', class: 'btn xs', onclick: (ev) => openReceipt(receipt, ev.target) }, '表示'));
      recBox.appendChild(el('button', { type: 'button', class: 'linklike', onclick: () => { receipt = ''; drawRec(); } }, '外す'));
    } else {
      const up = el('button', { type: 'button', class: 'btn sm', onclick: () => file.click() }, '領収書をアップロード');
      recBox.appendChild(up);
      recBox.appendChild(el('button', { type: 'button', class: 'linklike', onclick: () => { const u = window.prompt('領収書のURL（Googleドライブなど）'); if (u && /^https?:\/\//.test(u.trim())) { receipt = u.trim(); drawRec(); } } }, 'URLで指定'));
      recBox.appendChild(el('span', { class: 'hint', text: 'PDF・画像' }));
      file.onchange = async () => {
        const f = file.files[0]; if (!f) return;
        const done = await busy(up, () => relayUpload(f, 'receipt', (p) => { up.textContent = 'アップロード中 ' + Math.round(p * 100) + '%'; }));
        file.value = '';
        if (done) { receipt = fileUrl(done.id); toast('領収書をアップロードしました'); }
        drawRec();
      };
    }
  };
  drawRec();
  // 精算: 未精算 / 精算済
  let settled = e.ID ? settledOf(e) : false;
  const settle = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '精算' });
  const drawSettle = () => { settle.textContent = ''; [['未精算', false], ['精算済', true]].forEach(([k, v]) => settle.appendChild(el('button', { type: 'button', class: 'segb' + (v === settled ? ' on' : ''), role: 'radio', 'aria-checked': String(v === settled), onclick: () => { settled = v; drawSettle(); } }, k))); };
  drawSettle();
  const save = el('button', { class: 'btn primary' }, e.ID ? '保存' : '追加');
  save.addEventListener('click', async () => {
    const n = toHalfDigits(money.querySelector('input').value);
    const iso = date.value;
    const values = { '日付': iso ? iso.replace(/-/g, '/') : '', '区分': kind, '内容': what.value.trim(), '支払先': payee.value.trim(), '金額（税込）': n, '支払者': who.value, '担当': who.value, '領収書': receipt, '精算': settled ? '精算済' : '未精算', '備考': memo.value.trim() };
    values['承認'] = values['精算'];        // a relay older than 2026-11-23 knows only the old names
    const r = await busy(save, () => relay('expenseSave', { id: e.ID || '', values }));
    if (!r) return;
    const obj = rowObj(S.expenseHead || H_EXPENSE, r.row);
    const i = S.expenses.findIndex((x) => x.ID === obj.ID);
    if (i >= 0) S.expenses[i] = obj; else S.expenses.push(obj);
    box.textContent = ''; toast(e.ID ? '経費を更新しました' : '経費を追加しました'); renderExpenses();
  });
  const acts = el('div', { class: 'formacts' }, save, el('button', { class: 'btn', onclick: () => { box.textContent = ''; } }, 'やめる'));
  if (e.ID) acts.appendChild(armButton(el('button', { class: 'btn' }), '削除', 'もう一度押すと削除', async () => {
    const r = await busy(null, () => relay('expenseDelete', { id: e.ID }));
    if (!r) return;
    S.expenses = S.expenses.filter((x) => x.ID !== e.ID); box.textContent = ''; toast('経費を削除しました'); renderExpenses();
  }));
  const f = (label, node, cls) => el('label', { class: 'field' + (cls ? ' ' + cls : '') }, el('span', { text: label }), node);
  box.appendChild(el('div', { class: 'expform' },
    el('h3', { text: e.ID ? '経費を編集' : '経費を追加' }),
    el('div', { class: 'field' }, el('span', { text: '区分' }), kinds),
    el('div', { class: 'exprow' }, el('div', { class: 'field' }, el('span', { text: '日付' }), dateBox), f('内容', what, 'grow')),
    el('div', { class: 'exprow' }, f('支払先', payee), f('金額（税込）', money, 'amt'), f('支払者', who)),
    el('div', { class: 'exprow' }, el('div', { class: 'field grow' }, el('span', { text: '領収書' }), recBox), el('div', { class: 'field' }, el('span', { text: '精算' }), settle)),
    el('div', { class: 'exprow' }, f('備考', memo, 'full')),
    file, acts));
  box.scrollIntoView({ block: 'nearest' });
  setTimeout(() => what.focus(), 0);
}

/* ---- members ---- */
function renderMembers() {
  const t = $('memTable'); t.textContent = '';
  t.appendChild(el('thead', null, el('tr', null, ['メールアドレス', '名前', '役割', 'メモ', ''].map((h) => el('th', { text: h })))));
  const tb = el('tbody');
  S.members.forEach((m) => {
    const name = el('input', { type: 'text', value: m['名前'] || '', 'aria-label': '名前' });
    const roleSel = el('select', { 'aria-label': '役割' }); ['社内', 'クライアント', 'チームメンバー'].forEach((r) => roleSel.appendChild(el('option', { value: r, text: r }))); roleSel.value = /社内/.test(m['役割']) ? '社内' : /クライアント/.test(m['役割']) ? 'クライアント' : 'チームメンバー';
    const memo = el('input', { type: 'text', value: m['メモ'] || '', 'aria-label': 'メモ' });
    const save = el('button', { class: 'btn xs' }, '保存');
    save.addEventListener('click', async () => {
      const r = await busy(save, () => relay('memberSave', { orig: m['メール'], email: m['メール'], name: name.value, role: roleSel.value, memo: memo.value }));
      if (r) { m['名前'] = name.value; m['役割'] = roleSel.value; m['メモ'] = memo.value; toast('保存しました'); }
    });
    const del = armButton(el('button', { class: 'btn xs' }), '削除', 'もう一度押すと削除', async () => {
      const r = await busy(del, () => relay('memberDelete', { email: m['メール'] }));
      if (r) { S.members = S.members.filter((x) => x !== m); toast('削除しました'); renderMembers(); }
    });
    const me = S.me && String(m['メール']).toLowerCase() === S.me.email;
    if (me) { roleSel.disabled = true; del.disabled = true; }
    const inv = el('button', { class: 'btn xs', title: '入口のURLと開き方を、このメールアドレスに送ります' }, '招待を送る');
    inv.addEventListener('click', async () => {
      const r = await busy(inv, () => relay('memberInvite', { email: m['メール'], origin: entryUrl() }));
      if (r) toast(m['メール'] + ' に招待メールを送りました');
    });
    tb.appendChild(el('tr', null, el('td', { text: m['メール'] + (me ? '（あなた）' : '') }), el('td', null, name), el('td', null, roleSel), el('td', null, memo), el('td', null, save, ' ', me ? null : inv, me ? null : ' ', del)));
  });
  t.appendChild(tb);
}
async function addMember(btn) {
  const email = $('mEmail').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast('メールアドレスを確認してください', 'err'); return; }
  const invite = $('mInvite').checked;
  const r = await busy(btn, () => relay('memberSave', { email, name: $('mName').value.trim(), role: $('mRole').value, memo: $('mMemo').value.trim(), invite, origin: entryUrl() }));
  if (!r) return;
  S.members.push({ 'メール': email.toLowerCase(), '名前': $('mName').value.trim(), '役割': $('mRole').value, 'メモ': $('mMemo').value.trim() });
  ['mEmail', 'mName', 'mMemo'].forEach((id) => { $(id).value = ''; });
  $('mInvite').checked = true;
  if (r.invited) toast(email + ' を追加し、招待メールを送りました');
  else if (invite && r.inviteError) toast(email + ' を追加しましたが、招待メールを送れませんでした：' + r.inviteError + '（一覧の「招待を送る」で送り直せます）', 'err');
  else toast(email + ' を追加しました。このアドレスのGoogleアカウントでログインできます');
  renderMembers();
}

/* ---- wiring for this module ---- */
function wirePM() {
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('dClose').addEventListener('click', closeDetail);
  $('dPrev').addEventListener('click', () => stepDetail(-1));
  $('dNext').addEventListener('click', () => stepDetail(1));
  document.querySelectorAll('[data-cfilter]').forEach((b) => b.addEventListener('click', () => {
    cFilter = b.dataset.cfilter; document.querySelectorAll('[data-cfilter]').forEach((x) => x.classList.toggle('on', x === b)); renderComments();
  }));
  $('cSearch').addEventListener('input', renderComments);
  $('figFilter').addEventListener('change', renderFigures);
  $('figSource').addEventListener('change', renderFigures);
  $('btnFigAdd').addEventListener('click', () => showFigForm(null));
  $('progSection').addEventListener('change', renderProgress);
  $('progOpen').addEventListener('change', renderProgress);
  $('btnExpAdd').addEventListener('click', () => showExpForm(null));
  $('btnMemAdd').addEventListener('click', (e) => addMember(e.target));
  $('btnSwitch').addEventListener('click', signOut);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('detail').hidden) closeDetail(); });
  // others' changes: refresh quietly when coming back to the tab after a while
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.loaded && Date.now() - (S.loadedAt || 0) > 120000) loadProject(); });
}
