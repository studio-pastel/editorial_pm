/* ===== work: schedule (Gantt from a separate sheet), tasks, minutes (Markdown) ===== */
const H_TASK = ['ID', 'タスク', '担当', '担当メール', '期限', '状態', 'メモ', '作成者', '作成者メール', '作成日時', '更新者', '更新日時'];
const H_MINUTE = ['ID', '日付', 'タイトル', '出席者', 'タグ', 'ファイル', '文字数', '作成者', '作成者メール', '作成日時', '更新者', '更新日時'];
const TASK_STATES = ['未着手', '進行中', '確認待ち', '完了'];
const TASK_CLASS = { '未着手': 'todo', '進行中': 'doing', '確認待ち': 'ready', '完了': 'done' };
const MARKED_URL = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js';
const PURIFY_URL = 'https://cdn.jsdelivr.net/npm/dompurify@3.1.7/dist/purify.min.js';
const MIN_TEMPLATE = '## 議題\n- \n\n## 決定事項\n- \n\n## TODO\n- [ ] \n\n## 次回\n- \n';
const RELAY_OLD = '中継スクリプトの更新が必要です（社内の担当者が「デプロイを管理」から新しいバージョンを公開すると使えます）。';

/* ---- dates ---- */
const pad2 = (n) => String(n).padStart(2, '0');
const ymdLocal = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const todayIso = () => ymdLocal(new Date());
function isoOf(s) { const m = String(s || '').trim().match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/); return m ? m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]) : ''; }
const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
const WD = '日月火水木金土';
function fmtMD(iso, withYear) {
  if (!iso) return '—';
  const d = new Date(dayNum(iso) * 864e5);
  return (withYear ? d.getUTCFullYear() + '/' : '') + (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '（' + WD[d.getUTCDay()] + '）';
}
const meEmail = () => (S.me ? String(S.me.email || '').toLowerCase() : '');
const createdByMe = (row) => String(row['作成者メール'] || '').toLowerCase() === meEmail();

/* ================= schedule ================= */
let schEditing = null;
function renderSchedule() {
  const sc = S.schedule, g = $('gantt'), hint = $('schHint');
  g.textContent = ''; $('schEdit').textContent = ''; $('schLegend').textContent = '';
  $('schLink').hidden = true; $('schAsOf').textContent = ''; $('schTitle').textContent = 'スケジュール';
  hint.className = 'hint';
  if (!hasFeature('schedule')) { hint.textContent = RELAY_OLD; return; }
  if (!sc) { hint.textContent = isStaff() ? 'スケジュールのシートが未設定です。「台割・3D」→「案件・列」でURLを登録してください。' : 'スケジュールはまだ登録されていません。'; return; }
  if (sc.url && isStaff()) { $('schLink').href = sc.url; $('schLink').hidden = false; }
  if (sc.error) { hint.textContent = sc.error; hint.className = 'msg err'; return; }
  $('schTitle').textContent = sc.title || 'スケジュール';
  $('schAsOf').textContent = sc.asOf || '';
  const items = (sc.items || []).filter((i) => i.start || i.end);
  const undated = (sc.items || []).filter((i) => !i.start && !i.end && i.name);
  hint.textContent = (isStaff() ? '項目を押すと開始日・終了日を変更できます（スケジュールのシートに直接保存されます）。' : 'スケジュールの変更は社内メンバーが行います。') +
    (undated.length ? '　日付が読み取れない項目：' + undated.map((i) => i.name).join('、') : '');
  if (!items.length) { g.appendChild(el('p', { class: 'muted', text: '日付の入った項目がありません' })); return; }
  $('schLegend').append(
    el('span', null, el('i', { class: 'lg g-done' }), '済'),
    el('span', null, el('i', { class: 'lg g-now' }), '進行中'),
    el('span', null, el('i', { class: 'lg g-next' }), 'これから'),
    el('span', null, el('i', { class: 'lg lg-ms' }), '1日だけの項目'),
    el('span', null, el('i', { class: 'lg lg-today' }), '今日'));
  const editing = items.find((i) => i.row === schEditing);
  if (editing && isStaff()) $('schEdit').appendChild(schEditForm(editing));
  drawGantt(items);
}
function drawGantt(items) {
  const g = $('gantt');
  const today = dayNum(todayIso());
  const spans = items.map((i) => { const a = dayNum(i.start || i.end), b = dayNum(i.end || i.start); return [Math.min(a, b), Math.max(a, b)]; });
  const loD = new Date(Math.min(...spans.map((s) => s[0])) * 864e5), hiD = new Date(Math.max(...spans.map((s) => s[1])) * 864e5);
  const lo = Date.UTC(loD.getUTCFullYear(), loD.getUTCMonth(), 1) / 864e5;
  const hi = Date.UTC(hiD.getUTCFullYear(), hiD.getUTCMonth() + 1, 1) / 864e5 - 1;
  const n = hi - lo + 1;
  const avail = g.clientWidth || 1000;
  const LW = avail < 700 ? 150 : 320;
  const dw = Math.max(4, Math.min(28, (avail - LW - 2) / n));
  const W = Math.ceil(n * dw), x = (d) => ((d - lo) * dw).toFixed(1) + 'px';
  g.style.setProperty('--lw', LW + 'px');
  const inner = el('div', { class: 'g-inner', style: 'width:' + (LW + W) + 'px' });
  const months = el('div', { class: 'g-track g-months', style: 'width:' + W + 'px' });
  for (let d = lo; d <= hi;) {
    const D = new Date(d * 864e5), y = D.getUTCFullYear(), m = D.getUTCMonth(), end = Date.UTC(y, m + 1, 1) / 864e5;
    months.appendChild(el('span', { style: 'left:' + x(d) + ';width:' + ((end - d) * dw).toFixed(1) + 'px', text: (m === 0 || d === lo ? y + '年' : '') + (m + 1) + '月' }));
    d = end;
  }
  const weeks = el('div', { class: 'g-track g-weeks', style: 'width:' + W + 'px' });
  const grid = el('div', { class: 'g-grid', style: 'left:' + LW + 'px;width:' + W + 'px', 'aria-hidden': 'true' });
  for (let d = lo; d <= hi; d++) {
    const D = new Date(d * 864e5);
    if (D.getUTCDate() === 1) grid.appendChild(el('i', { class: 'g-mline', style: 'left:' + x(d) }));
    else if (D.getUTCDay() === 1) grid.appendChild(el('i', { class: 'g-wline', style: 'left:' + x(d) }));
    if (D.getUTCDay() === 1 && dw * 7 >= 20) weeks.appendChild(el('span', { style: 'left:' + x(d), text: String(D.getUTCDate()) }));
  }
  if (today >= lo && today <= hi) grid.appendChild(el('i', { class: 'g-today', style: 'left:' + ((today - lo + 0.5) * dw).toFixed(1) + 'px' }, el('b', { text: '今日' })));
  inner.append(
    el('div', { class: 'g-row g-headrow' }, el('div', { class: 'g-label g-hl', text: '項目' }), months),
    el('div', { class: 'g-row g-headrow' }, el('div', { class: 'g-label g-hl', text: '期間（週の数字は月曜日）' }), weeks),
    grid);
  items.forEach((it) => {
    const s = Math.min(dayNum(it.start || it.end), dayNum(it.end || it.start)), e = Math.max(dayNum(it.start || it.end), dayNum(it.end || it.start));
    const state = e < today ? 'done' : (s <= today ? 'now' : 'next');
    const span = e - s + 1;
    const period = fmtMD(it.start || it.end) + (span > 1 ? '〜' + fmtMD(it.end || it.start) + '　' + span + '日' : '');
    const chip = state === 'now' ? el('span', { class: 'chip st-doing', text: '進行中' }) : state === 'done' ? el('span', { class: 'chip st-done', text: '済' }) : null;
    const lab = el(isStaff() ? 'button' : 'div', { class: 'g-label g-item', title: isStaff() ? '日程を変更' : null },
      el('span', { class: 'g-name' }, it.name, chip ? ' ' : null, chip), el('span', { class: 'g-when', text: period }));
    const tip = it.name + '\n' + period + (it.owner ? '\n担当：' + it.owner : '') + (it.note ? '\n' + it.note : '');
    const bar = span === 1
      ? el('i', { class: 'g-ms g-' + state, style: 'left:' + ((s - lo + 0.5) * dw).toFixed(1) + 'px', title: tip })
      : el('i', { class: 'g-bar g-' + state, style: 'left:' + x(s) + ';width:' + Math.max(3, span * dw - 1).toFixed(1) + 'px', title: tip });
    const row = el('div', { class: 'g-row' + (schEditing === it.row ? ' sel' : '') + (state === 'done' ? ' is-done' : '') }, lab, el('div', { class: 'g-track', style: 'width:' + W + 'px' }, bar));
    if (isStaff()) { const open = () => { schEditing = it.row; renderSchedule(); $('schEdit').scrollIntoView({ block: 'nearest' }); }; lab.addEventListener('click', open); bar.addEventListener('click', open); }
    inner.appendChild(row);
  });
  g.appendChild(inner);
  if (!g.dataset.scrolled && today >= lo && today <= hi) { g.scrollLeft = Math.max(0, (today - lo) * dw - (avail - LW) / 3); g.dataset.scrolled = '1'; }
}
function schEditForm(it) {
  const a = el('input', { type: 'date', value: it.start || it.end, 'aria-label': '開始日' });
  const b = el('input', { type: 'date', value: it.end || it.start, 'aria-label': '終了日' });
  const save = el('button', { class: 'btn primary' }, '保存');
  save.addEventListener('click', async () => {
    if (!a.value || !b.value) { toast('開始日と終了日を入力してください', 'err'); return; }
    if (b.value < a.value) { toast('終了日が開始日より前になっています', 'err'); return; }
    const r = await busy(save, () => relay('scheduleSave', { row: it.row, name: it.name, start: a.value, end: b.value }));
    if (!r) return;
    S.schedule = r.schedule; schEditing = null;
    toast(it.name + 'の日程を保存しました'); renderSchedule();
  });
  return el('div', { class: 'form schform' },
    el('div', { class: 'field wide' }, el('span', { text: '日程を変更（スケジュールのシートに保存）' }), el('b', { text: it.name })),
    el('label', { class: 'field' }, el('span', { text: '開始日' }), a),
    el('label', { class: 'field' }, el('span', { text: '終了日' }), b),
    el('div', { class: 'formacts' }, save, el('button', { class: 'btn', onclick: () => { schEditing = null; renderSchedule(); } }, 'やめる')));
}

/* ================= tasks ================= */
let taskEditing = null;   // task ID, or 'new'
let taskFormEl = null;     // the open form, reused while it stays open
const taskWho = (t) => String(t['担当'] || '').trim();
const isMyTask = (t) => !!S.me && ((t['担当メール'] && String(t['担当メール']).toLowerCase() === meEmail()) || (!t['担当メール'] && taskWho(t) && taskWho(t) === S.me.name));
const taskOverdue = (t) => { const d = isoOf(t['期限']); return !!d && t['状態'] !== '完了' && d < todayIso(); };
/** assignee straight from the list: members, plus a non-member name already set */
function taskWhoSelect(t) {
  const sel = el('select', { class: 'whosel', 'aria-label': (t['タスク'] || '') + 'の担当' });
  sel.appendChild(el('option', { value: '', text: '（なし）' }));
  (S.people || []).forEach((p) => sel.appendChild(el('option', { value: 'm:' + p.email, text: p.name })));
  const em = String(t['担当メール'] || '').toLowerCase(), who = taskWho(t);
  let cur = '';
  if (em && (S.people || []).some((p) => p.email === em)) cur = 'm:' + em;
  else if (who) { sel.appendChild(el('option', { value: 'n:' + who, text: who })); cur = 'n:' + who; }
  sel.value = cur;
  sel.addEventListener('change', () => {
    const v = sel.value, p = v.indexOf('m:') === 0 ? (S.people || []).find((x) => x.email === v.slice(2)) : null;
    saveTask(t, { '担当': p ? p.name : (v.indexOf('n:') === 0 ? v.slice(2) : ''), '担当メール': p ? p.email : '' }, sel);
  });
  return sel;
}
function taskStateSelect(t) {
  const sel = el('select', { class: 'stsel st-' + (TASK_CLASS[t['状態']] || 'todo'), 'aria-label': (t['タスク'] || '') + 'の状態' });
  TASK_STATES.forEach((s) => sel.appendChild(el('option', { value: s, text: s })));
  sel.value = TASK_STATES.indexOf(t['状態']) >= 0 ? t['状態'] : '未着手';
  sel.addEventListener('change', () => saveTask(t, { '状態': sel.value }, sel));
  return sel;
}
async function saveTask(t, values, btn) {
  const r = await busy(btn, () => relay('taskSave', { id: t ? t.ID : '', base: t ? t['更新日時'] : null, values, origin: entryUrl() }));
  if (!r) { renderTasks(); return false; }
  const obj = rowObj(H_TASK, r.row);
  const i = S.tasks.findIndex((x) => x.ID === obj.ID);
  if (i >= 0) S.tasks[i] = obj; else S.tasks.push(obj);
  toast(t ? 'タスクを更新しました' : 'タスクを追加しました');
  renderTasks();
  return true;
}
function taskForm(t) {
  t = t || {};
  const F = {
    'タスク': el('input', { type: 'text', value: t['タスク'] || '', 'aria-label': 'タスク' }),
    '担当': el('input', { type: 'text', value: t['担当'] || '', list: 'peopleList', placeholder: 'メンバーを選ぶか名前を入力', 'aria-label': '担当' }),
    '期限': el('input', { type: 'date', value: isoOf(t['期限']), 'aria-label': '期限' }),
    '状態': (() => { const s = el('select', { 'aria-label': '状態' }); TASK_STATES.forEach((k) => s.appendChild(el('option', { value: k, text: k }))); s.value = t['状態'] || '未着手'; return s; })(),
    'メモ': el('textarea', { rows: 2, 'aria-label': 'メモ' })
  };
  F['メモ'].value = t['メモ'] || '';
  const save = el('button', { class: 'btn primary' }, t.ID ? '保存' : '追加');
  save.addEventListener('click', async () => {
    const name = F['タスク'].value.trim();
    if (!name) { toast('タスクの内容を入力してください', 'err'); F['タスク'].focus(); return; }
    const who = F['担当'].value.trim(), p = (S.people || []).find((x) => x.name === who);
    const values = { 'タスク': name, '担当': who, '担当メール': p ? p.email : '', '期限': F['期限'].value, '状態': F['状態'].value, 'メモ': F['メモ'].value };
    if (await saveTask(t.ID ? t : null, values, save)) { taskEditing = null; taskFormEl = null; renderTasks(); }
  });
  const acts = el('div', { class: 'formacts' }, save, el('button', { class: 'btn', onclick: () => { taskEditing = null; taskFormEl = null; renderTasks(); } }, 'やめる'));
  if (t.ID && (isStaff() || createdByMe(t))) acts.appendChild(armButton(el('button', { class: 'btn' }), '削除', 'もう一度押すと削除', async () => {
    const r = await busy(null, () => relay('taskDelete', { id: t.ID }));
    if (!r) return;
    S.tasks = S.tasks.filter((x) => x.ID !== t.ID); taskEditing = null; taskFormEl = null; toast('タスクを削除しました'); renderTasks();
  }));
  const box = el('div', { class: 'form' }, Object.keys(F).map((k) => el('label', { class: 'field' + (k === 'タスク' || k === 'メモ' ? ' wide' : '') }, el('span', { text: k }), F[k])), acts);
  F['タスク'].addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } });
  setTimeout(() => F['タスク'].focus(), 0);   // only when the form is first made
  return box;
}
function renderTasks() {
  const t = $('taskTable');
  t.textContent = '';
  if (!hasFeature('tasks')) { t.appendChild(el('li', { class: 'muted', text: RELAY_OLD })); $('taskAddPanel').hidden = true; return; }
  $('taskAddPanel').hidden = false;
  const dl = $('peopleList'); dl.textContent = '';
  (S.people || []).forEach((p) => dl.appendChild(el('option', { value: p.name, label: p.role || '' })));
  // filters
  const aSel = $('tAssignee'), curA = aSel.value || 'all';
  const names = [];
  (S.people || []).forEach((p) => { if (p.name && names.indexOf(p.name) < 0) names.push(p.name); });
  S.tasks.forEach((x) => { const w = taskWho(x); if (w && names.indexOf(w) < 0) names.push(w); });
  aSel.textContent = '';
  [['all', 'すべて'], ['me', '自分'], ['none', '未割当']].concat(names.map((n) => ['n:' + n, n])).forEach(([v, l]) => aSel.appendChild(el('option', { value: v, text: l })));
  aSel.value = [...aSel.options].some((o) => o.value === curA) ? curA : 'all';
  const sSel = $('tState');
  if (!sSel.options.length) { [['open', '未完了'], ['all', 'すべて']].concat(TASK_STATES.map((s) => [s, s])).forEach(([v, l]) => sSel.appendChild(el('option', { value: v, text: l }))); sSel.value = 'open'; }
  // the open form is kept as it is across redraws (refresh, another row's change), so nothing typed is lost
  const formFor = (key) => {
    if (taskEditing !== key) return null;
    if (!taskFormEl || taskFormEl.dataset.key !== key) {
      const t = key === 'new' ? null : S.tasks.find((x) => x.ID === key);
      if (key !== 'new' && !t) { taskEditing = null; taskFormEl = null; return null; }
      taskFormEl = taskForm(t); taskFormEl.dataset.key = key;
    }
    return taskFormEl;
  };
  const nb = $('taskFormBox'), nf = formFor('new');
  if (nf) { if (nf.parentNode !== nb) { nb.textContent = ''; nb.appendChild(nf); } } else nb.textContent = '';
  // list
  const q = ($('tSearch').value || '').trim().toLowerCase(), A = aSel.value, St = sSel.value;
  const list = S.tasks.filter((x) => {
    if (A === 'me' && !isMyTask(x)) return false;
    if (A === 'none' && taskWho(x)) return false;
    if (A.indexOf('n:') === 0 && taskWho(x) !== A.slice(2)) return false;
    if (St === 'open' && x['状態'] === '完了') return false;
    if (St !== 'open' && St !== 'all' && (x['状態'] || '未着手') !== St) return false;
    return !q || [x['タスク'], x['担当'], x['メモ']].join(' ').toLowerCase().indexOf(q) >= 0;
  }).sort((a, b) => (a['状態'] === '完了') - (b['状態'] === '完了') || (isoOf(a['期限']) || '9999') .localeCompare(isoOf(b['期限']) || '9999') || String(a['作成日時']).localeCompare(String(b['作成日時'])));
  // one row per task: state | title + who/when/memo | edit — wraps cleanly at any width
  list.forEach((x) => {
    const due = isoOf(x['期限']), over = taskOverdue(x), who = taskWho(x);
    t.appendChild(el('li', { class: 'trow' + (x['状態'] === '完了' ? ' is-done' : '') },
      el('div', { class: 'tstate' }, taskStateSelect(x)),
      el('div', { class: 'tmain' },
        el('b', { class: 'ttitle', text: x['タスク'] }),
        el('div', { class: 'tmeta' },
          el('label', { class: 'twho' }, el('span', { class: 'muted', text: '担当 ' }), taskWhoSelect(x)),
          el('span', { class: over ? 'bad' : '' }, el('span', { class: 'muted', text: '期限 ' }), due ? fmtMD(due) : 'なし', over ? el('b', { class: 'overdue', text: ' 期限切れ' }) : null),
          el('span', { class: 'muted small', text: '更新 ' + [x['更新者'], String(x['更新日時'] || '').replace(/^\d{4}\//, '').replace(/:\d{2}$/, '')].filter(Boolean).join(' ') })),
        x['メモ'] ? el('p', { class: 'tmemo', text: x['メモ'] }) : null),
      el('div', { class: 'tacts' }, el('button', { class: 'btn xs', 'aria-expanded': String(taskEditing === x.ID), onclick: () => { taskEditing = taskEditing === x.ID ? null : x.ID; renderTasks(); } }, taskEditing === x.ID ? '閉じる' : '編集'))));
    const f = formFor(x.ID);
    if (f) t.appendChild(el('li', { class: 'trow-edit' }, f));
  });
  if (!list.length) t.appendChild(el('li', { class: 'muted tempty', text: S.tasks.length ? '条件に合うタスクはありません' : 'タスクはまだありません。上の欄に入力して Enter で登録できます' }));
  // quick add: assignee choices
  const qw = $('qaWho'), cur = qw.value;
  qw.textContent = ''; qw.appendChild(el('option', { value: '', text: '（なし）' }));
  (S.people || []).forEach((p) => qw.appendChild(el('option', { value: p.email, text: p.name })));
  qw.value = [...qw.options].some((o) => o.value === cur) ? cur : '';
}

/* ---- quick add: 「表紙案の作成 @デザイナーA 11/20」 ---- */
const WDAYS = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
const z2hNum = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/／/g, '/').replace(/＠/g, '@');
function parseQuickTask(raw, today) {
  let text = ' ' + z2hNum(raw) + ' ', due = '', who = '';
  const t0 = today || new Date(), base = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
  const iso = (d) => ymdLocal(d);
  const add = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  const take = (re, fn) => { const m = text.match(re); if (m) { const v = fn(m); if (v) { text = text.replace(m[0], ' '); return v; } } return ''; };
  due = take(/\s(?:(\d{4})[\/\-年])?(\d{1,2})[\/月](\d{1,2})日?(?=\s)/, (m) => {
    let y = m[1] ? +m[1] : base.getFullYear(); const mo = +m[2], d = +m[3];
    let dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) return '';
    if (!m[1] && dt < add(-60)) dt = new Date(y + 1, mo - 1, d);   // 1/10 written in November means next January
    return iso(dt);
  }) || take(/\s(今日|きょう|明日|あした|明後日|あさって)(?=\s)/, (m) => iso(add(/今日|きょう/.test(m[1]) ? 0 : /明後日|あさって/.test(m[1]) ? 2 : 1)))
    || take(/\s(今週|来週)?([日月火水木金土])曜日?(?=\s)/, (m) => {
      const w = WDAYS[m[2]], cur = base.getDay();
      const mon = add(-((cur + 6) % 7));                                  // Monday of this week
      const d = new Date(mon); d.setDate(mon.getDate() + ((w + 6) % 7) + (m[1] === '来週' ? 7 : 0));
      if (!m[1] && d < base) d.setDate(d.getDate() + 7);                  // 「金曜」 = the next Friday
      return iso(d);
    });
  who = take(/\s@(\S+)(?=\s)/, (m) => m[1]);
  return { title: text.replace(/\s+/g, ' ').trim(), due, who };
}
function matchPerson(token) {
  if (!token) return null;
  const key = (s) => String(s || '').replace(/\s+/g, '').toLowerCase(), k = key(token), ps = S.people || [];
  return ps.find((p) => key(p.name) === k) || ps.find((p) => key(p.email).split('@')[0] === k) || ps.find((p) => key(p.name).indexOf(k) === 0) || null;
}
async function quickAdd(e) {
  if (e) e.preventDefault();
  const inp = $('qaText'), q = parseQuickTask(inp.value);
  if (!q.title) { toast('タスクの内容を入力してください', 'err'); inp.focus(); return; }
  const sel = $('qaWho').value, person = sel ? (S.people || []).find((p) => p.email === sel) : matchPerson(q.who);
  const values = { 'タスク': q.title, '担当': person ? person.name : (q.who || ''), '担当メール': person ? person.email : '', '期限': $('qaDue').value || q.due, '状態': '未着手' };
  if (await saveTask(null, values, $('qaAdd'))) {
    inp.value = ''; $('qaDue').value = ''; $('qaWho').value = '';
    toast('タスクを追加しました' + (values['担当'] ? '（担当：' + values['担当'] + '）' : '') + (values['期限'] ? '（期限：' + fmtMD(isoOf(values['期限'])) + '）' : ''));
    inp.focus();
  }
}

/* ================= minutes ================= */
let minSel = null, minEditing = null, minTag = '', minAllLoadedAt = 0, mdLib = null;
const minBodies = new Map();   // ID -> { u: 更新日時, body }
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); }); }
function loadMd() {
  if (!mdLib) mdLib = Promise.all([loadScript(MARKED_URL), loadScript(PURIFY_URL)]).then(() => {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => { if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); } });
    return true;
  }).catch(() => false);
  return mdLib;
}
async function renderMdInto(box, text) {
  const ok = await loadMd();
  box.textContent = '';
  if (!String(text || '').trim()) { box.appendChild(el('p', { class: 'muted', text: '本文はまだありません' })); return; }
  if (ok && window.marked && window.DOMPurify) box.innerHTML = DOMPurify.sanitize(marked.parse(String(text), { gfm: true, breaks: true }));
  else box.appendChild(el('pre', { class: 'md-raw', text: String(text) }));
}
const minTags = (m) => String(m['タグ'] || '').split(/[,、]\s*/).map((t) => t.trim()).filter(Boolean);
const minSorted = () => S.minutes.slice().sort((a, b) => (isoOf(b['日付']) || '').localeCompare(isoOf(a['日付']) || '') || String(b['作成日時']).localeCompare(String(a['作成日時'])));
async function minuteBody(m) {
  const c = minBodies.get(m.ID);
  if (c && c.u === m['更新日時']) return c.body;
  const r = await relay('minuteGet', { id: m.ID });
  minBodies.set(m.ID, { u: m['更新日時'], body: r.body });
  return r.body;
}
async function ensureAllBodies() {
  if (minAllLoadedAt === S.loadedAt || !S.minutes.length) return;
  const r = await relay('minuteBodies', {});
  Object.keys(r.bodies || {}).forEach((id) => { const m = S.minutes.find((x) => x.ID === id); minBodies.set(id, { u: m ? m['更新日時'] : '', body: r.bodies[id] }); });
  minAllLoadedAt = S.loadedAt;
}
function renderMinutes() {
  $('btnMinAdd').hidden = !hasFeature('minutes') || !canWriteMinutes();
  renderMinList();
  if (!minEditing) drawMinDoc();
}
function renderMinList() {
  const ul = $('minList'), tb = $('mTags');
  ul.textContent = ''; tb.textContent = '';
  if (!hasFeature('minutes')) { ul.appendChild(el('li', { class: 'muted', text: RELAY_OLD })); return; }
  const all = [];
  S.minutes.forEach((m) => minTags(m).forEach((t) => { if (all.indexOf(t) < 0) all.push(t); }));
  if (minTag && all.indexOf(minTag) < 0) minTag = '';
  all.sort((a, b) => a.localeCompare(b, 'ja')).forEach((t) => tb.appendChild(el('button', { class: 'chip tag' + (t === minTag ? ' on' : ''), 'aria-pressed': String(t === minTag), onclick: () => { minTag = minTag === t ? '' : t; renderMinList(); } }, '#' + t)));
  const q = ($('mSearch').value || '').trim().toLowerCase();
  const list = minSorted().filter((m) => {
    if (minTag && minTags(m).indexOf(minTag) < 0) return false;
    if (!q) return true;
    const b = minBodies.get(m.ID);
    return [m['タイトル'], m['出席者'], m['タグ'], b ? b.body : ''].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  list.forEach((m) => ul.appendChild(el('li', null, el('button', { class: 'mitem' + (m.ID === minSel ? ' on' : ''), 'aria-current': m.ID === minSel ? 'true' : null, onclick: () => selectMinute(m.ID) },
    el('span', { class: 'mdate', text: fmtMD(isoOf(m['日付']), true) }),
    el('b', { class: 'mtitle', text: m['タイトル'] }),
    m['出席者'] ? el('span', { class: 'muted small', text: m['出席者'] }) : null,
    minTags(m).length ? el('span', { class: 'mtags' }, minTags(m).map((t) => el('span', { class: 'chip tag', text: '#' + t }))) : null))));
  if (!list.length) ul.appendChild(el('li', { class: 'muted', text: S.minutes.length ? '条件に合う議事録はありません' : 'まだ議事録はありません' }));
}
function selectMinute(id) {
  if (minEditing) { toast('編集中です。保存するか「やめる」を押してください', 'err'); return; }
  minSel = id; renderMinList(); drawMinDoc();
  if (window.matchMedia('(max-width: 900px)').matches) $('minDoc').scrollIntoView({ block: 'start' });
}
async function drawMinDoc() {
  const box = $('minDoc'); box.textContent = '';
  if (!hasFeature('minutes')) { box.appendChild(el('p', { class: 'muted', text: RELAY_OLD })); return; }
  const m = S.minutes.find((x) => x.ID === minSel);
  if (!m) { box.appendChild(el('p', { class: 'muted', text: S.minutes.length ? '左の一覧から議事録を選んでください。' : 'まだ議事録はありません。' + (canWriteMinutes() ? '「新規作成」から書き始められます。' : '') })); return; }
  const acts = el('div', { class: 'cacts' });
  if (canWriteMinutes()) acts.appendChild(el('button', { class: 'btn sm primary', onclick: () => editMinute(m) }, '編集'));
  if (isStaff() && m['ファイル']) acts.appendChild(el('a', { class: 'btn sm', href: m['ファイル'], target: '_blank', rel: 'noopener' }, 'ドライブで開く（.md）'));
  if (isStaff() || createdByMe(m)) acts.appendChild(armButton(el('button', { class: 'btn sm' }), '削除', 'もう一度押すと削除', () => deleteMinute(m)));
  const bodyBox = el('div', { class: 'md-body' }, el('p', { class: 'muted', text: '読み込み中…' }));
  box.append(
    el('div', { class: 'mhead' },
      el('span', { class: 'mdate', text: fmtMD(isoOf(m['日付']), true) }),
      el('h2', { class: 'mdoc-title', text: m['タイトル'] }),
      m['出席者'] ? el('p', { class: 'small' }, el('span', { class: 'muted', text: '出席者　' }), m['出席者']) : null,
      minTags(m).length ? el('p', { class: 'mtags' }, minTags(m).map((t) => el('span', { class: 'chip tag', text: '#' + t }))) : null,
      el('p', { class: 'muted small', text: '作成 ' + [m['作成者'], m['作成日時']].filter(Boolean).join(' ') + (m['更新日時'] && m['更新日時'] !== m['作成日時'] ? '　更新 ' + [m['更新者'], m['更新日時']].filter(Boolean).join(' ') : '') }),
      acts),
    bodyBox);
  try {
    const body = await minuteBody(m);
    if (minSel !== m.ID || minEditing) return;
    await renderMdInto(bodyBox, body);
  } catch (e) { bodyBox.textContent = ''; bodyBox.appendChild(el('p', { class: 'msg err', text: e.message })); }
}
async function deleteMinute(m) {
  const r = await busy(null, () => relay('minuteDelete', { id: m.ID }));
  if (!r) return;
  S.minutes = S.minutes.filter((x) => x.ID !== m.ID); minBodies.delete(m.ID); minSel = null;
  toast('議事録を削除しました（.mdファイルはドライブのゴミ箱に移しました）'); renderMinutes();
}
async function editMinute(m) {
  if (minEditing) return;
  let body = MIN_TEMPLATE;
  if (m) { try { body = await minuteBody(m); } catch (e) { toast(e.message, 'err'); return; } }
  minEditing = { id: m ? m.ID : '', base: m ? m['更新日時'] : null };
  const box = $('minDoc'); box.textContent = '';
  const F = {
    '日付': el('input', { type: 'date', value: m ? isoOf(m['日付']) : todayIso(), 'aria-label': '日付' }),
    'タイトル': el('input', { type: 'text', value: m ? m['タイトル'] : '', placeholder: '例：初校チェックバック打合せ', 'aria-label': 'タイトル' }),
    '出席者': el('input', { type: 'text', value: m ? m['出席者'] : '', placeholder: '例：田中、佐藤', 'aria-label': '出席者' }),
    'タグ': el('input', { type: 'text', value: m ? m['タグ'] : '', placeholder: '例：打合せ, デザイン（カンマ区切り）', 'aria-label': 'タグ' })
  };
  const ta = el('textarea', { class: 'md-src', spellcheck: 'false', 'aria-label': '本文（Markdown）' });
  ta.value = body;
  const pv = el('div', { class: 'md-body md-preview', 'aria-live': 'off' });
  let pvTimer = 0;
  const preview = () => { clearTimeout(pvTimer); pvTimer = setTimeout(() => renderMdInto(pv, ta.value), 150); };
  ta.addEventListener('input', preview);
  const snapshot = () => JSON.stringify([Object.keys(F).map((k) => F[k].value), ta.value]);
  const start = snapshot();
  const save = el('button', { class: 'btn primary' }, '保存');
  const doSave = async () => {
    if (!F['日付'].value) { toast('日付を入力してください', 'err'); return; }
    if (!F['タイトル'].value.trim()) { toast('タイトルを入力してください', 'err'); F['タイトル'].focus(); return; }
    const values = {}; Object.keys(F).forEach((k) => { values[k] = F[k].value; });
    const r = await busy(save, () => relay('minuteSave', { id: minEditing.id, base: minEditing.base, values, body: ta.value, origin: entryUrl() }));
    if (!r) return;
    const obj = rowObj(H_MINUTE, r.row);
    const i = S.minutes.findIndex((x) => x.ID === obj.ID);
    if (i >= 0) S.minutes[i] = obj; else S.minutes.push(obj);
    minBodies.set(obj.ID, { u: obj['更新日時'], body: r.body });
    minEditing = null; minSel = obj.ID;
    toast(m ? '議事録を保存しました' : '議事録を登録しました'); renderMinutes();
  };
  save.addEventListener('click', doSave);
  const cancel = el('button', { class: 'btn' }, 'やめる');
  let armed = 0;
  cancel.addEventListener('click', () => {
    if (snapshot() !== start && !armed) { cancel.textContent = '変更を捨ててやめる'; armed = setTimeout(() => { armed = 0; cancel.textContent = 'やめる'; }, 3000); return; }
    clearTimeout(armed); minEditing = null; renderMinutes();
  });
  box.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && minEditing) { e.preventDefault(); doSave(); } });
  box.append(
    el('h2', { class: 'mdoc-edit', text: m ? '議事録を編集' : '議事録を作成' }),
    el('div', { class: 'form mform' }, Object.keys(F).map((k) => el('label', { class: 'field' + (k === 'タイトル' ? ' wide' : '') }, el('span', { text: k }), F[k]))),
    el('div', { class: 'mdedit' },
      el('label', { class: 'field' }, el('span', { text: '本文（Markdown）' }), ta),
      el('div', { class: 'field' }, el('span', { text: 'プレビュー' }), pv)),
    el('p', { class: 'hint', text: '見出し「## 」、箇条書き「- 」、チェック「- [ ] 」、表「| 項目 | 内容 |」が使えます。保存するとドライブの議事録フォルダに .md ファイルとしても保存されます（Ctrl／⌘＋S でも保存）。' }),
    el('div', { class: 'formacts' }, save, cancel));
  renderMdInto(pv, ta.value);
  (m ? ta : F['タイトル']).focus();
}

/* ---- wiring ---- */
function wireWork() {
  $('tAssignee').addEventListener('change', renderTasks);
  $('tState').addEventListener('change', renderTasks);
  $('tSearch').addEventListener('input', renderTasks);
  $('btnTaskAdd').addEventListener('click', () => { taskEditing = 'new'; taskFormEl = null; renderTasks(); });
  $('qaForm').addEventListener('submit', quickAdd);
  $('btnMinAdd').addEventListener('click', () => { if (minEditing) { toast('編集中です。保存するか「やめる」を押してください', 'err'); return; } editMinute(null); });
  let sTimer = 0;
  $('mSearch').addEventListener('input', () => {
    clearTimeout(sTimer);
    sTimer = setTimeout(async () => {
      if ($('mSearch').value.trim() && minAllLoadedAt !== S.loadedAt) {
        try { await ensureAllBodies(); } catch (e) { toast('本文を読み込めませんでした：' + e.message, 'err'); }
      }
      renderMinList();
    }, 250);
  });
  let rTimer = 0;
  window.addEventListener('resize', () => { if (curView !== 'schedule') return; clearTimeout(rTimer); rTimer = setTimeout(renderSchedule, 150); });
}

/* ================= notices (bell) ================= */
const NOTICE_VIEW = { 'タスク': 'tasks', '議事録': 'minutes' };
function renderBell() {
  const ok = hasFeature('notices');
  $('btnBell').hidden = !ok || !S.me || role() === 'client';
  const n = (S.notices || []).filter((x) => !x.read).length;
  const b = $('badgeBell'); b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
  $('btnBell').setAttribute('aria-label', '通知' + (n ? '（未読 ' + n + '件）' : ''));
  if (!$('bellPanel').hidden) renderBellList();
}
function renderBellList() {
  const ul = $('bellList'); ul.textContent = '';
  const list = S.notices || [];
  $('btnBellAll').disabled = !list.some((x) => !x.read);
  if (!list.length) { ul.appendChild(el('li', { class: 'muted', text: '通知はまだありません' })); return; }
  list.forEach((x) => ul.appendChild(el('li', null, el('button', { class: 'bellitem' + (x.read ? '' : ' unread'), onclick: () => openNotice(x) },
    el('span', { class: 'bmeta' }, el('span', { class: 'chip', text: x.kind }), x.page ? el('b', { text: x.page }) : null, el('span', { text: x.by }), el('span', { text: String(x.at) })),
    el('span', { class: 'btext', text: x.text })))));
}
async function markNotices(ids) {
  (S.notices || []).forEach((x) => { if (!ids || ids.indexOf(x.id) >= 0) x.read = true; });
  renderBell();
  try { await relay('noticeRead', ids ? { ids } : {}); } catch (e) { /* the next refresh shows the truth */ }
}
async function openNotice(x) {
  $('bellPanel').hidden = true; $('btnBell').setAttribute('aria-expanded', 'false');
  if (!x.read) markNotices([x.id]);
  if (NOTICE_VIEW[x.kind] && Date.now() - (S.loadedAt || 0) > 15000) await loadProject();   // bring in the task / minutes it points to
  if (x.page) { const k = keyOfLabel(x.page); if (k !== null) { setView('board'); selectPage(k); return; } }
  const v = NOTICE_VIEW[x.kind];
  if (v) {
    if (v === 'minutes') { const m = String(x.link || '').match(/[?&]minute=([^&]+)/); if (m) minSel = decodeURIComponent(m[1]); }
    setView(v);
  }
}
async function refreshNotices() {
  if (!S.loaded || !hasFeature('notices')) return;
  try { const r = await relay('notices', {}, { quiet: true }); S.notices = r.notices || []; renderBell(); } catch (e) { /* ignore */ }
}
function wireBell() {
  $('btnBell').addEventListener('click', () => {
    const p = $('bellPanel'); p.hidden = !p.hidden; $('btnBell').setAttribute('aria-expanded', String(!p.hidden));
    p.style.top = window.innerWidth <= 700 ? Math.round($('btnBell').getBoundingClientRect().bottom + 6) + 'px' : '';   // on a phone the panel is fixed just under the button
    if (!p.hidden) { renderBellList(); refreshNotices(); }
  });
  $('btnBellAll').addEventListener('click', () => markNotices(null));
  $('btnBellClose').addEventListener('click', () => { $('bellPanel').hidden = true; $('btnBell').setAttribute('aria-expanded', 'false'); $('btnBell').focus(); });
  document.addEventListener('click', (e) => { const p = $('bellPanel'); if (!p.hidden && !e.target.closest('.bellwrap')) { p.hidden = true; $('btnBell').setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('bellPanel').hidden) { $('bellPanel').hidden = true; $('btnBell').focus(); } });
  setInterval(() => { if (!document.hidden) refreshNotices(); }, 180000);
}
