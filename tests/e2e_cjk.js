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
const CMAP = { n: 0 };
W.files.PDFCJK0000000000000C = { name: 'Layout-00-cjk.pdf', mime: 'application/pdf', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'cjk_test.pdf')), parents: [FOLDER] };
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
      const cm = u.match(/pdfjs-dist@3\.11\.174\/(cmaps|standard_fonts)\/(.+)$/);
      if (cm) { CMAP.n++; return route.fulfill({ body: fs.readFileSync(path.join(NM, 'pdfjs-dist', cm[1], cm[2])) }); }
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

  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'メンバー', [['メール', '名前', '役割', 'メモ'], ['owner@example.com', '制作 太郎', '社内', '']]));
  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'デザイン', [['ファイル', 'ファイル名', 'PDFページ開始', 'PDFページ終了', '割当開始', '登録日時'], ['https://drive.google.com/file/d/PDFCJK0000000000000C/view', 'Layout-00-cjk.pdf', 1, 1, '30', '']]));
  const c = await mkctx('T_OWNER');
  const p = await open(c); await login(p); await p.waitForTimeout(3000);
  // draw the page that has Japanese CID text (non-embedded HeiseiKakuGo / HeiseiMin, UniJIS CMap) and count ink in the heading line
  const ink = await p.evaluate(async () => {
    const cv = await queueRender(() => renderAssigned(S.assign.get('30'), 600), true);
    const g = cv.getContext('2d'), y0 = Math.round(cv.height * 0.12), y1 = Math.round(cv.height * 0.30);
    const d = g.getImageData(0, y0, cv.width, y1 - y0).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
    return n;
  });
  ok(CMAP.n > 0, 'character maps (CMap) requested: ' + CMAP.n);
  ok(ink > 1500, 'kanji/kana lines are drawn (dark pixels ' + ink + ')');
  await p.evaluate(async () => { const cv = await queueRender(() => renderAssigned(S.assign.get('30'), 600), true); const a = document.createElement('img'); a.id = 'shot'; a.src = cv.toDataURL(); a.style.cssText = 'position:fixed;left:0;top:0;width:600px;z-index:999;background:#fff'; document.body.appendChild(a); });
  await p.waitForTimeout(300);
  await p.locator('#shot').screenshot({ path: path.join(__dirname, 'out', 'cjk_page.png') });
  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
