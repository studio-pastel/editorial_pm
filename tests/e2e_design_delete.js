const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { makeWorld } = require('../relay/gasmock.js');
const NM = path.join(__dirname, 'node_modules');
const LIBS = { 'three.js/r128/three.min.js': NM + '/three/build/three.min.js', 'pdf.js/3.11.174/pdf.min.js': NM + '/pdfjs-dist/build/pdf.min.js', 'pdf.js/3.11.174/pdf.worker.min.js': NM + '/pdfjs-dist/build/pdf.worker.min.js', 'marked@12.0.2/marked.min.js': NM + '/marked/marked.min.js', 'dompurify@3.1.7/dist/purify.min.js': NM + '/dompurify/dist/purify.min.js' };
const HTML = fs.readFileSync(path.join(__dirname, 'test_index.html'), 'utf8');
const CLIENT = '89787741926-q2oegplkho4ulh38cpj9p8grkg718til.apps.googleusercontent.com';
const tok = (email, name) => ({ aud: CLIENT, email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), name });
const W = makeWorld({ owner: 'owner@example.com', tokens: { T_OWNER: tok('owner@example.com', '制作 太郎'), T_CLIENT: tok('client@example.ac.jp', '大学 担当'), T_EXT: tok('designer@example.com', 'デザイナーA'), T_STRANGER: tok('who@example.com', '誰か') } });
const SID = 'TESTSHEET000000000000000000000000000000000A', FOLDER = 'TESTFOLDER00000000000000000000000';
const daiwari = require('./fixtures/daiwari.js')();
daiwari[0].splice(7, 0, '再校'); daiwari.slice(1).forEach((r) => r.splice(7, 0, ''));      // a second proof round
const ss = W.addSheet(SID, 'サンプル冊子2028_台割', [
  { title: '台割／表', cells: daiwari, validation: { 6: ['未／待ち', '未／着手OK', '調整中', '確定'] } },
  { title: '設定', cells: [['項目', '値'], ['デザインフォルダ', 'https://drive.google.com/drive/folders/' + FOLDER], ['台割タブ', '台割／表']] }
], 'PARENT');
W.folders.ROOT = { name: 'root' }; W.folders.PARENT = { name: '案件' }; W.folders[FOLDER] = { name: '_design', parent: 'PARENT' };
W.files.PDFMARKS0000000000000A = { name: 'Layout-01.pdf', mime: 'application/pdf', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'marks.pdf')), parents: [FOLDER] };
W.files.PDFSIX00000000000000B = { name: 'Layout-02.pdf', mime: 'application/pdf', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'test6.pdf')), parents: [FOLDER] };
const GIS = `window.google = { accounts: { id: {
  initialize(cfg) { window.__gis = cfg; },
  renderButton(el) { const b = document.createElement('button'); b.id = 'mockGsi'; b.textContent = 'Googleでログイン'; b.onclick = () => window.__gis.callback({ credential: window.__TOKEN || 'T_OWNER' }); el.appendChild(b); },
  disableAutoSelect() {} } } };`;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  const mkctx = async (token) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addInitScript((t) => { window.__TOKEN = t; }, token);
    await ctx.route('**/*', async (route) => {
      const req = route.request(), u = req.url();
      if (u.startsWith('https://studio-pastel.github.io/')) return route.fulfill({ contentType: 'text/html', body: HTML });
      for (const k in LIBS) if (u.includes(k)) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(LIBS[k]) });
      if (u.startsWith('https://accounts.google.com/gsi/client')) return route.fulfill({ contentType: 'application/javascript', body: GIS });
      if (u.startsWith('https://relay.test/exec')) {
        const out = W.G.doPost({ postData: { contents: req.postData() } }).content;
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: out });
      }
      return route.abort();
    });
    return ctx;
  };
  const open = async (ctx, q) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|404/.test(m.text())) errs.push(m.text()); }); await p.goto('https://studio-pastel.github.io/editorial_pm/?sheet=' + SID + (q || '')); await p.waitForTimeout(800); return p; };
  const login = async (p) => { await p.click('#mockGsi'); await p.waitForTimeout(2500); };
  const vis = (p, sel) => p.isVisible(sel);

  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'メンバー', [['メール', '名前', '役割', 'メモ'], ['owner@example.com', '制作 太郎', '社内', ''], ['designer@example.com', 'デザイナーA', 'チームメンバー', '']]));
  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'デザイン', [['ファイル', 'ファイル名', 'PDFページ開始', 'PDFページ終了', '割当開始', '登録日時'], ['https://drive.google.com/file/d/PDFSIX00000000000000B/view', 'Layout-02.pdf', 1, 6, '20', '']]));
  const c = await mkctx('T_OWNER');
  let p = await open(c); await login(p);
  await p.click('[data-panel="panelDesign"]'); await p.waitForTimeout(3000);
  ok(await p.locator('#designList button:has-text("削除")').count() === 2, '社内: each PDF (registered and auto-placed) has 削除');
  const btn = p.locator('#designList li', { hasText: 'Layout-02.pdf' }).locator('button:has-text("削除")');
  await btn.click(); await p.waitForTimeout(300);
  ok(/もう一度押すと削除/.test(await p.textContent('#designList')) && !W.files.PDFSIX00000000000000B.trashed, 'first press only asks to confirm');
  await p.locator('#designList li', { hasText: 'Layout-02.pdf' }).locator('button:has-text("もう一度押すと削除")').click(); await p.waitForTimeout(2500);
  ok(W.files.PDFSIX00000000000000B.trashed && !ss.getSheetByName('デザイン').cells.some((r) => r && String(r[0]).indexOf('PDFSIX') >= 0), 'second press: file to trash, row removed');
  ok(!/Layout-02\.pdf/.test(await p.textContent('#designList')) && /ゴミ箱/.test(await p.textContent('#designMsg')), 'gone from the list; message mentions the trash');
  ok(await p.evaluate(() => ![...S.assign.values()].some((a) => a.src === 'PDFSIX00000000000000B')), 'its pages are cleared on the board');
  await p.screenshot({ path: path.join(__dirname, 'out', 'design_delete.png') });
  const c2 = await mkctx('T_EXT');
  const p2 = await open(c2); await login(p2);
  await p2.click('[data-panel="panelDesign"]'); await p2.waitForTimeout(1500);
  ok(await p2.locator('#designList button:has-text("削除")').count() === 0, 'チームメンバー: no 削除');
  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
