/* ===== board: 台割 grid, stats, drag & drop ===== */
const tileEls = new Map();   // kstr -> element
let curSpread = 0;

function secColor(name) {
  const i = S.model.sections.indexOf(name);
  return i < 0 ? 'var(--line)' : 'hsl(' + sectionHue(i) + ' 56% 48%)';
}
function pageInfo(k) {
  const info = S.model.pages.get(k);
  if (info) return info;
  return null;
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function makeTile(k) {
  const N = NS(), el = document.createElement('div');
  const info = pageInfo(k), isPad = typeof k === 'number' && k > N;
  el.className = 'tile'; el.dataset.k = kstr(k); el.tabIndex = 0;
  if (info && info.section) el.style.setProperty('--sec', secColor(info.section));
  const label = keyLabel(k);
  const title = isPad ? '（調整用の白ページ）' : (info ? (info.title || info.kind) : '');
  const noteTxt = info ? [info.title ? info.kind : '', info.section, info.note].filter(Boolean).join(' ／ ') : '';
  const cs = typeof currentStage === 'function' ? currentStage(k) : null;
  const nC = typeof openComments === 'function' ? openComments(label) : 0;
  el.innerHTML = '<div class="bar"></div><div class="no"><span>' + esc(label) + '</span>' + (nC ? '<b class="cbadge" title="未対応のコメント">' + nC + '</b>' : '') + '</div>' +
    '<div class="tt">' + esc(title) + '</div><div class="note">' + esc(noteTxt) + '</div>' +
    (cs ? '<span class="tchip st-' + stateClass(cs.value) + '" title="' + esc(cs.name + '：' + cs.value) + '">' + esc(cs.name + ' ' + cs.value) + '</span>' : '') + '<i class="st"></i>';
  if (!info && !isPad && typeof k === 'number') el.querySelector('.tt').style.color = 'var(--mute)';
  el.title = label + (title ? '：' + title : '');
  el.addEventListener('click', () => selectPage(k));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPage(k); } });
  el.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); el.classList.add('over'); } });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); dropOnTile([...e.dataTransfer.files], k); });
  tileEls.set(kstr(k), el);
  applyTileImage(el, kstr(k));
  return el;
}
function hasFiles(e) { return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'); }
function applyTileImage(el, key) {
  if (key === 'S') { const tt = el.querySelector('.tt'); if (tt) tt.textContent = S.assign.has('S') ? '割当済' : ''; return; }
  const url = S.thumbs.get(key);
  let img = el.querySelector('img');
  if (url) {
    if (!img) { img = document.createElement('img'); img.alt = ''; img.draggable = false; el.insertBefore(img, el.querySelector('.st')); }
    img.src = url; el.classList.add('hasimg');
  } else { if (img) img.remove(); el.classList.remove('hasimg'); }
}
function refreshTile(key) { const el = tileEls.get(kstr(key)); if (el) applyTileImage(el, kstr(key)); renderStats(); }

function emptyTile() { const e = document.createElement('div'); e.className = 'tile empty'; return e; }

function renderBoard() {
  const board = $('board'); tileEls.clear(); board.textContent = '';
  const N = NS();
  const sp = S.set;
  board.style.setProperty('--ar', (sp.w / sp.h).toFixed(4));
  board.style.setProperty('--tw', $('tileSize').value + 'px');
  if (!N) {
    board.innerHTML = '<div class="panel" style="margin:0"><h2>' + (S.loading ? '読み込み中…' : '台割がありません') + '</h2><p style="margin:0">' + (S.loading ? 'スプレッドシートを読み込んでいます。' : '公開用スプレッドシートの「台割」タブにページ列と内容を入れ、「再読み込み」を押してください。') + '</p></div>';
    renderLegend(); renderStats(); return;
  }
  const m = leafCount(N);
  // cover row: 表1 + 背
  {
    const wrap = document.createElement('div'); wrap.className = 'spread-wrap'; wrap.dataset.s = '0';
    wrap.innerHTML = '<div class="spread-label">表紙まわり</div>';
    const row = document.createElement('div'); row.className = 'sidepair';
    row.appendChild(makeTile('F'));
    const sp2 = makeTile('S'); sp2.classList.add('spine-tile'); sp2.style.aspectRatio = 'auto'; sp2.style.height = 'calc(var(--tw) / var(--ar))';
    row.appendChild(sp2);
    wrap.appendChild(row); board.appendChild(wrap);
  }
  for (let s = 1; s <= m + 1; s++) {
    const keys = spreadKeys(s, N, sp.binding);
    const wrap = document.createElement('div'); wrap.className = 'spread-wrap'; wrap.dataset.s = String(s);
    const a = keys.left, b = keys.right;
    const lab = [a, b].map((k) => (k === null ? '' : keyLabel(k))).filter(Boolean).join(' | ');
    wrap.innerHTML = '<div class="spread-label">見開き ' + s + '　' + esc(lab) + '</div>';
    const sc = document.createElement('div'); sc.className = 'spread-scroll';
    const row = document.createElement('div'); row.className = 'spread';
    row.appendChild(a === null ? emptyTile() : makeTile(a));
    row.appendChild(b === null ? emptyTile() : makeTile(b));
    sc.appendChild(row); wrap.appendChild(sc); board.appendChild(wrap);
  }
  {
    const wrap = document.createElement('div'); wrap.className = 'spread-wrap'; wrap.dataset.s = 'back';
    wrap.innerHTML = '<div class="spread-label">裏表紙</div>';
    const row = document.createElement('div'); row.className = 'sidepair'; row.appendChild(makeTile('B'));
    wrap.appendChild(row); board.appendChild(wrap);
  }
  S.assign.forEach((_, k) => { if (!S.thumbs.has(k)) makeThumb(k); });
  renderLegend(); renderStats(); markCurrent(curSpread);
}

function renderLegend() {
  const lg = $('legend'); lg.textContent = '';
  S.model.sections.forEach((name) => {
    const s = document.createElement('span');
    s.innerHTML = '<i style="background:' + secColor(name) + '"></i>' + esc(name);
    lg.appendChild(s);
  });
}

function markCurrent(s) {
  curSpread = s;
  document.querySelectorAll('.spread-wrap.cur').forEach((e) => e.classList.remove('cur'));
  const w = document.querySelector('.spread-wrap[data-s="' + s + '"]');
  if (w) w.classList.add('cur');
}

function renderStats() {
  const N = NS(), st = $('stats'), sp = S.set;
  if (!N) { st.innerHTML = '<span>本文 <b>—</b></span>'; $('boardInfo').textContent = ''; $('spineInfo').textContent = '背幅の目安：本文ページ数が決まると計算します。'; return; }
  const Np = paddedN(N), spine = spineWidthMM(N, sp.t, sp.c);
  const total = Np + 4, placed = S.assign.size;
  const bits = ['<span>本文 <b>' + N + 'P</b></span>'];
  if (Np !== N) bits.push('<span class="warn">奇数ページのため ' + Np + 'P に調整</span>');
  bits.push('<span>見開き <b>' + (leafCount(N) + 1) + '</b></span>');
  bits.push('<span>背幅 <b>' + spine + 'mm</b></span>');
  bits.push('<span>' + esc(signatureNote(N, sp.bindType)) + '</span>');
  if (N > MAX_PAGES) bits.push('<span class="warn">目安の' + MAX_PAGES + 'Pを超えています</span>');
  if (S.model.missing.length) bits.push('<span class="warn">未記入 ' + S.model.missing.length + 'P</span>');
  bits.push('<span>デザイン <b>' + placed + '</b>／' + total + '</span>');
  st.innerHTML = bits.join('');
  $('boardInfo').textContent = '本文 ' + N + 'P（' + (sp.binding === 'L' ? '左綴じ' : '右綴じ') + '・' + (sp.bindType === 'saddle' ? '中綴じ' : '無線綴じ') + '）';
  $('spineInfo').textContent = '背幅の目安 ' + spine + ' mm＝（' + leafCount(N) + '枚×' + sp.t + 'mm）＋表紙 ' + sp.c + 'mm×2　※糊代・ミゾの分は含みません';
}

