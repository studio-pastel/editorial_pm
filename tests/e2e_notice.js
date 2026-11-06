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

  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'メンバー', [['メール', '名前', '役割', 'メモ'], ['owner@example.com', '制作 太郎', '社内', ''], ['client@example.ac.jp', '大学 担当', 'クライアント', ''], ['designer@example.com', 'デザイナーA', 'チームメンバー', '']]));
  const cClient = await mkctx('T_CLIENT');
  let p = await open(cClient); await login(p);
  await p.click('.tile[data-k="2"]'); await p.waitForTimeout(400);
  await p.fill('#dBody .cform textarea', '写真の差し替えをお願いします'); await p.click('#dBody .cform button'); await p.waitForTimeout(800);
  ok(W.mails.length === 0 && /まとめて届きます/.test(await p.textContent('#toast')), 'comment: no mail at once; toast says it will be batched');
  // 社内 assigns a task to the client, and changes progress
  const cOwner = await mkctx('T_OWNER');
  const po = await open(cOwner); await login(po);
  ok(await po.textContent('#badgeBell') === '1', 'owner sees 1 unread (the comment)');
  await po.click('#btnBell'); await po.waitForTimeout(400);
  ok(/写真の差し替え/.test(await po.textContent('#bellList')) && /P2/.test(await po.textContent('#bellList')), 'bell lists the comment with its page');
  await po.screenshot({ path: path.join(__dirname, 'out', 'notice_bell.png') });
  await po.click('#bellList .bellitem'); await po.waitForTimeout(600);
  ok(await vis(po, '#detail') && /P2/.test(await po.textContent('#dTitle')) && !(await vis(po, '#badgeBell')), 'clicking opens P2 and marks it read');
  await po.click('#dClose');
  await po.click('#vt-tasks'); await po.click('#btnTaskAdd');
  await po.fill('#taskFormBox input[aria-label="タスク"]', '撮影リストの確認'); await po.fill('#taskFormBox input[aria-label="担当"]', 'デザイナーA');
  await po.click('#taskFormBox button:has-text("追加")'); await po.waitForSelector('#taskFormBox .form', { state: 'detached', timeout: 20000 }); await po.waitForTimeout(300);
  // クライアント: no bell at all; the チームメンバー gets the task
  ok(!(await vis(p, '#btnBell')), 'クライアント sees no bell');
  const cExt = await mkctx('T_EXT');
  p = await open(cExt); await login(p);
  await p.click('#btnBell'); await p.waitForTimeout(900);
  ok(/撮影リストの確認/.test(await p.textContent('#bellList')), 'チームメンバー gets the task notice');
  await p.click('#bellList .bellitem >> nth=0'); await p.waitForTimeout(500);
  ok(await vis(p, '#view-tasks'), 'task notice opens the タスク tab');
  // batched mail
  W.G.flushAll_(Date.now() + 61 * 60000);   // tasks are mailed hourly
  const toOwner = W.mails.filter((m) => m.to === 'owner@example.com'), toExt = W.mails.filter((m) => m.to === 'designer@example.com');
  ok(toOwner.length === 1 && toExt.length === 1 && /&view=tasks/.test(toExt[0].body) && !W.mails.some((m) => m.to === 'client@example.ac.jp'), 'after the quiet time: one mail each to 社内 and チームメンバー, none to クライアント');
  // link from the mail opens the right view
  const pl = await open(cExt, '&view=tasks'); await pl.waitForTimeout(1500);
  ok(await vis(pl, '#view-tasks'), '?view=tasks opens the タスク tab');
  // mark all read
  await po.click('#vt-tasks'); await po.click('#btnTaskAdd');
  await po.fill('#taskFormBox input[aria-label="タスク"]', '原稿の確認'); await po.fill('#taskFormBox input[aria-label="担当"]', 'デザイナーA');
  await po.click('#taskFormBox button:has-text("追加")'); await po.waitForSelector('#taskFormBox .form', { state: 'detached', timeout: 20000 }); await po.waitForTimeout(300);
  await p.click('#btnBell'); await p.waitForTimeout(900);
  ok(await p.locator('#bellList .bellitem.unread').count() === 1, 'new unread appears on opening the bell');
  await p.click('#btnBellAll'); await p.waitForTimeout(500);
  ok(!(await vis(p, '#badgeBell')) && await p.locator('#bellList .bellitem.unread').count() === 0, 'すべて既読にする');
  await p.keyboard.press('Escape'); await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => window.scrollTo(0, 0));
  await p.click('#btnBell'); await p.waitForTimeout(300); if (!(await vis(p, '#bellPanel'))) { await p.click('#btnBell'); await p.waitForTimeout(300); }
  const rect = await p.evaluate(() => { const r = document.getElementById('bellPanel').getBoundingClientRect(); return [r.left, r.right]; });
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390 && rect[0] >= 0 && rect[1] <= 390, 'bell panel fits a phone: ' + rect);
  const tshown = await p.locator('#bellList .bmeta').first().textContent();
  ok(/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(tshown), 'time shown as M/d HH:mm: ' + tshown);
  await p.screenshot({ path: path.join(__dirname, 'out', 'notice_mobile.png') });
  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
