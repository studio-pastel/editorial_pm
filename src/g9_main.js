/* ===== self-check, wiring, startup ===== */
function makeSamplePdf(n) {
  const W = (S.set.w * 72 / 25.4).toFixed(2), H = (S.set.h * 72 / 25.4).toFixed(2);
  const cols = ['0.75 0.22 0.17', '0.16 0.50 0.73', '0.15 0.68 0.38', '0.56 0.27 0.68'];
  const kids = [], pages = [];
  let id = 4;
  for (let i = 0; i < n; i++) {
    const fs = Math.round(W / 5);
    const stream = cols[i % cols.length] + ' rg 0 0 ' + W + ' ' + H + ' re f 1 1 1 rg BT /F1 ' + fs + ' Tf ' + (W * 0.12).toFixed(2) + ' ' + (H * 0.5).toFixed(2) + ' Td (TEST ' + (i + 1) + ') Tj ET';
    pages.push({ page: id, content: id + 1, stream }); kids.push(id + ' 0 R'); id += 2;
  }
  let pdf = '%PDF-1.4\n';
  const offs = [];
  const add = (num, body) => { offs[num] = pdf.length; pdf += num + ' 0 obj\n' + body + '\nendobj\n'; };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
  add(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  pages.forEach((p) => {
    add(p.page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + p.content + ' 0 R >>');
    add(p.content, '<< /Length ' + p.stream.length + ' >>\nstream\n' + p.stream + '\nendstream');
  });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + id + '\n0000000000 65535 f \n' + offs.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += 'trailer\n<< /Size ' + id + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}
async function runDiagnosis() {
  const box = $('diagBox'), out = $('diagOut'), cv = $('diagCanvas');
  box.hidden = false;
  const lines = [];
  const t0 = performance.now();
  lines.push('3D表示: ' + (V.ok ? 'OK' : 'NG（WebGLを開始できません）'));
  lines.push('PDFライブラリ: ' + (window.pdfjsLib ? 'OK ' + (pdfjsLib.version || '') : 'NG（読み込めていません）'));
  lines.push('ログイン: ' + (S.me ? S.me.email + '（' + S.me.role + '）' : 'なし'));
  lines.push('台割: ' + (S.tabName || '—') + '・本文 ' + NS() + 'P');
  lines.push('デザイン登録: ' + S.designs.length + '件 ／ 割当: ' + S.assign.size + '枠');
  S.designs.forEach((d) => { const s = S.sources.get(d.id) || {}; lines.push('  ・' + (d.name || d.id) + '：' + (s.err ? 'NG ' + s.err : (s.pdf ? 'OK ' + s.numPages + 'P' : '未読込'))); });
  let hi = 0; texCache.forEach((e) => { if (e.hi) hi++; });
  lines.push('3Dに貼られたページ: ' + hi + '枚（現在の見開き ' + Math.round(V.target) + '）');
  out.textContent = lines.join('\n') + '\nPDF描画テスト: 実行中…';
  try {
    const tmp = srcFor('__diag', 'test'); tmp.blob = makeSamplePdf(2);
    let c;
    try { c = await queueRender(() => renderAssigned({ src: '__diag', page: 2, half: null }, 168), true); }
    finally { if (tmp.pdf && tmp.pdf.destroy) try { tmp.pdf.destroy(); } catch (e) { /* ignore */ } S.sources.delete('__diag'); }
    if (!c) throw new Error('描画結果が空でした');
    const px = c.getContext('2d').getImageData(Math.round(c.width / 2), 4, 1, 1).data;
    cv.width = 84; cv.height = Math.round(84 * c.height / c.width);
    cv.getContext('2d').drawImage(c, 0, 0, cv.width, cv.height);
    lines.push('PDF描画テスト: ' + (px[2] > 120 && px[0] < 120 ? 'OK' : '要確認（rgb ' + px[0] + ',' + px[1] + ',' + px[2] + '）') + '（' + Math.round(performance.now() - t0) + 'ms）');
  } catch (e) { lines.push('PDF描画テスト: NG — ' + (e && e.message ? e.message : String(e))); }
  if (S.lastRenderErr) lines.push('直近の描画エラー: ' + S.lastRenderErr);
  out.textContent = lines.join('\n');
}

function wire() {
  document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => {
    const p = $(b.dataset.panel); p.hidden = !p.hidden; b.classList.toggle('on', !p.hidden);
  }));
  $('btnReload').addEventListener('click', async () => {
    const b = $('btnReload'); b.disabled = true;
    S.sources.forEach((s) => { if (!s.blob || !s.pdf) s.err = ''; });
    blobLoads.clear();
    await loadProject({ tab: S.tabName });
    b.disabled = false;
  });
  let logoutArmed = 0;
  $('userChip').addEventListener('click', () => {
    const u = $('userChip');
    if (!logoutArmed) { u.dataset.label = u.textContent; u.textContent = 'ログアウトする'; logoutArmed = setTimeout(() => { logoutArmed = 0; u.textContent = u.dataset.label; }, 3000); return; }
    clearTimeout(logoutArmed); signOut();
  });
  $('btnOpen').addEventListener('click', () => openSheetFromInput('openUrl', 'landingMsg'));
  $('openUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') openSheetFromInput('openUrl', 'landingMsg'); });
  $('btnOpen2').addEventListener('click', () => openSheetFromInput('openUrl2', 'projMsg'));
  $('btnCopyUrl').addEventListener('click', () => {
    const t = $('shareUrl').textContent;
    const done = () => setMsg('projMsg', '共有用URLをコピーしました。', 'ok');
    try { navigator.clipboard.writeText(t).then(done, () => { selectText($('shareUrl')); setMsg('projMsg', '選択しました。コピーしてください。'); }); }
    catch (e) { selectText($('shareUrl')); }
  });
  $('tabSelect').addEventListener('change', () => loadProject({ tab: $('tabSelect').value }).then(() => setMsg('projMsg', '台割のタブを切り替えました。「設定をシートに保存」で全員に反映されます。')));
  $('tileSize').addEventListener('input', () => { $('board').style.setProperty('--tw', $('tileSize').value + 'px'); });
  $('btnSaveSet').addEventListener('click', () => saveSettings('bookMsg'));
  $('btnSaveProj').addEventListener('click', () => saveSettings('projMsg'));
  $('btnPick').addEventListener('click', () => $('designFile').click());
  $('designFile').addEventListener('change', (e) => { uploadFiles([...e.target.files]); e.target.value = ''; });
  const dz = $('dropZone');
  dz.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); dz.classList.add('over'); } });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dz.classList.remove('over'); uploadFiles([...e.dataTransfer.files]); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });
  $('btnDiag').addEventListener('click', runDiagnosis);
  const setWide = (on) => {
    document.body.classList.toggle('wide', on);
    $('btnWide').textContent = on ? '台割と並べて表示' : '3Dだけを表示'; $('btnWide').setAttribute('aria-pressed', String(on));
    try { localStorage.setItem('dandori.wide', on ? '1' : ''); } catch (e) { /* ignore */ }
    if (V.ok) { resize(); fitCamera(true); }
  };
  $('btnWide').addEventListener('click', () => setWide(!document.body.classList.contains('wide')));
  try { if (localStorage.getItem('dandori.wide')) setWide(true); } catch (e) { /* ignore */ }
  $('btnPrev').addEventListener('click', () => setSpread(Math.round(V.target) - 1, true));
  $('btnNext').addEventListener('click', () => setSpread(Math.round(V.target) + 1, true));
  $('spreadSlider').addEventListener('input', (e) => setSpread(parseInt(e.target.value, 10), true));
  document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => setCam(b.dataset.cam)));
  document.addEventListener('keydown', (e) => {
    const t = e.target && e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const fwd = (e.key === 'ArrowRight') === (S.set.binding !== 'R');
    setSpread(Math.round(V.target) + (fwd ? 1 : -1), true); e.preventDefault();
  });
  S.onRenderError = (k, err) => {
    S.lastRenderErr = keyLabel(isNaN(+k) ? k : +k) + '：' + (err && err.message ? err.message : String(err));
    renderDesignListSoon();
  };
}
function selectText(el) { try { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) { /* ignore */ } }

async function start() {
  initSettingsUI(); wire(); wirePM(); wireWork(); initThree(); syncControls(); applyRole();
  await idb.open();
  if (CONFIG.relayUrl.startsWith('__')) { setTop('中継スクリプトのURLが設定されていません。', 'err'); return; }
  const id = extractSheetId(new URLSearchParams(location.search).get('sheet') || '');
  if (!id) {
    document.body.classList.add('locked');
    $('landing').hidden = false;
    renderRecent(); return;
  }
  S.sheetId = id;
  loadSession();
  let v = 'board'; try { v = sessionStorage.getItem('dandori.view') || 'board'; } catch (e) { /* ignore */ }
  if (!signedIn()) { showLogin(); return; }
  if (await loadProject()) { if (!new URLSearchParams(location.search).get('page')) setView(v); }
}
start();
