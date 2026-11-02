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
const BIG = 'PDFBIG000000000000000AA';
const big = Buffer.concat([fs.readFileSync(path.join(__dirname, 'fixtures', 'test6.pdf')), Buffer.alloc(31 * 1024 * 1024, 0x20)]);
W.files[BIG] = { name: 'Layout-00-big.pdf', mime: 'application/pdf', bytes: big, parents: [FOLDER] };
const CH = { calls: 0, failNext: 0, failAlways: false, delay: 700 };
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
        const body = JSON.parse(req.postData());
        if (body.action === 'fileChunk' && body.id === BIG) {
          CH.calls++;
          if (CH.failNext > 0) { CH.failNext--; return route.fulfill({ status: 500, contentType: 'text/html', body: 'Service unavailable' }); }
          if (CH.failAlways) return route.fulfill({ status: 500, contentType: 'text/html', body: 'Service unavailable' });
          await new Promise((r) => setTimeout(r, CH.delay));
        }
        const out = W.G.doPost({ postData: { contents: req.postData() } }).content;
        return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: out });
      }
      return route.abort();
    });
    return ctx;
  };
  const open = async (ctx, q) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|404|status of 500/.test(m.text())) errs.push(m.text()); }); await p.goto('https://studio-pastel.github.io/editorial_pm/?sheet=' + SID + (q || '')); await p.waitForTimeout(800); return p; };
  const login = async (p) => { await p.click('#mockGsi'); await p.waitForTimeout(2500); };
  const vis = (p, sel) => p.isVisible(sel);

  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'メンバー', [['メール', '名前', '役割', 'メモ'], ['owner@example.com', '制作 太郎', '社内', '']]));
  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'デザイン', [['ファイル', 'ファイル名', 'PDFページ開始', 'PDFページ終了', '割当開始', '登録日時'], ['https://drive.google.com/file/d/' + BIG + '/view', 'Layout-00-big.pdf', 1, 2, '40', '']]));
  const c = await mkctx('T_OWNER');
  CH.failNext = 1;                                   // the first piece of the big file fails once
  let p = await open(c); await login(p);
  await p.click('[data-panel="panelDesign"]');
  await p.waitForTimeout(3000);
  const st = await p.evaluate((id) => { const s = S.sources.get(id); return { prog: s && s.progress, pdf: !!(s && s.pdf) }; }, BIG);
  const smallDone = await p.evaluate(() => [...S.sources.values()].filter((s) => s.id !== 'PDFBIG000000000000000AA' && s.pdf).length);
  ok(typeof st.prog === 'number' && !st.pdf && smallDone === 2, 'while the 31MB file is still loading, the two small PDFs are already open: ' + JSON.stringify(st) + ' small=' + smallDone);
  const thumbsSmall = await p.evaluate(() => [...S.thumbs.keys()].filter((k) => { const a = S.assign.get(k); return a && a.src !== 'PDFBIG000000000000000AA'; }).length);
  ok(thumbsSmall >= 3, 'pages of the small PDFs are drawn without waiting: ' + thumbsSmall);
  ok(/読み込み中 \d+%/.test(await p.textContent('#designList')), 'progress shown in the design list');
  ok(/PDF読み込み中 \d+%/.test(await p.evaluate(() => (document.querySelector('.tile .ld') || {}).textContent || '')), 'progress shown on the page tile');
  ok(/大きいため、表示に時間がかかります/.test(await p.textContent('#designList')), 'size warning for a PDF over 30MB');
  await p.screenshot({ path: path.join(__dirname, 'out', 'pdfload_progress.png') });
  for (let i = 0; i < 40 && !(await p.evaluate((id) => !!(S.sources.get(id) || {}).pdf, BIG)); i++) await p.waitForTimeout(500);
  ok(await p.evaluate((id) => !!S.sources.get(id).pdf, BIG) && CH.calls === 9, 'big file finishes after one retried piece (calls ' + CH.calls + ')');
  await p.waitForTimeout(1500);
  ok(await p.evaluate(() => document.querySelectorAll('.tile .ld').length) === 0, 'progress labels gone when done');
  // a file that keeps failing: message + 再試行
  await p.evaluate((id) => { const s = S.sources.get(id); s.blob = null; s.pdf = null; s.err = ''; blobLoads.delete(id); pdfLoads.delete(id); return idb.del(id + ':' + '1761600000000-' + 0); }, BIG);
  await p.evaluate(async (id) => { const all = await idb.all(); for (const r of all || []) if (r.id === id) await idb.del(r.k); }, BIG);
  CH.failAlways = true;
  await p.evaluate((id) => retrySource(S.sources.get(id)), BIG);
  for (let i = 0; i < 40 && !(await p.evaluate((id) => !!S.sources.get(id).err, BIG)); i++) await p.waitForTimeout(500);
  await p.waitForTimeout(600);
  ok(/最後まで読み込めませんでした|応答を読めませんでした/.test(await p.textContent('#designList')) && await p.locator('#designList button:has-text("再試行")').count() === 1, 'persistent failure: reason + 再試行 button');
  ok(/PDFを読み込めません/.test(await p.evaluate(() => [...document.querySelectorAll('.tile .ld')].map((e) => e.textContent).join())), 'failed pages say so on the tile');
  CH.failAlways = false; CH.delay = 50;
  await p.click('#designList button:has-text("再試行")');
  for (let i = 0; i < 40 && !(await p.evaluate((id) => !!S.sources.get(id).pdf, BIG)); i++) await p.waitForTimeout(500);
  ok(await p.evaluate((id) => !!S.sources.get(id).pdf, BIG) && await p.locator('#designList button:has-text("再試行")').count() === 0, '再試行 loads it');
  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
