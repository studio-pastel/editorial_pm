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

  /* ---------- owner ---------- */
  const cOwner = await mkctx('T_OWNER');
  let p = await open(cOwner);
  ok(await vis(p, '#login') && !(await vis(p, '#view-board')), 'first visit shows only the Google sign-in');
  await login(p);
  ok(!(await vis(p, '#login')) && await vis(p, '#view-board'), 'signed in as owner');
  ok(await p.evaluate(() => NS() === 128 && S.me.key === 'staff'), 'loaded 128 pages through the relay');
  ok(await vis(p, '#vt-expenses') && await vis(p, '#vt-members'), '社内 sees 経費 and メンバー tabs');
  ok(await p.textContent('#userChip') === '制作 太郎（社内）', 'user chip: ' + await p.textContent('#userChip'));
  await p.waitForTimeout(5000);
  ok(await p.evaluate(() => [...S.assign].filter(([, v]) => v.src.startsWith('PDF')).length === 10), 'folder PDFs downloaded via relay and placed (10 pages)');
  // members
  await p.click('#vt-members');
  for (const [e, n, r] of [['client@example.ac.jp', '大学 担当', 'クライアント'], ['designer@example.com', 'デザイナーA', '外部スタッフ']]) {
    await p.fill('#mEmail', e); await p.fill('#mName', n); await p.selectOption('#mRole', r); await p.click('#btnMemAdd'); await p.waitForTimeout(400);
  }
  ok(ss.getSheetByName('メンバー').cells.length === 4, 'two members added to メンバー tab (header + owner + 2)');
  // page detail: progress + comment + figure
  await p.click('#vt-board'); await p.click('.tile[data-k="2"]'); await p.waitForTimeout(500);
  ok(await vis(p, '#detail') && /P2/.test(await p.textContent('#dTitle')), 'clicking a page opens its detail: ' + await p.textContent('#dTitle'));
  const sel = p.locator('#dBody .stage select').first();
  await sel.selectOption('確定'); await p.waitForTimeout(800);
  const rowP2 = ss.getSheetByName('台割／表').cells.findIndex((r) => r[0] === '002');
  ok(ss.getSheetByName('台割／表').cells[rowP2][6] === '確定', '初校 of P2 saved to the sheet');
  ok(/初校 確定/.test(await p.textContent('.tile[data-k="2"] .tchip')), 'tile shows the stage chip');
  await p.fill('#dBody .cform textarea', '写真のトリミングを確認してください'); await p.click('#dBody .cform button'); await p.waitForTimeout(800);
  ok(ss.getSheetByName('コメント').cells[1][5] === '写真のトリミングを確認してください', 'comment saved');
  await p.click('#dBody button:has-text("図版を追加")'); await p.waitForTimeout(200);
  await p.locator('#dBody .form input[aria-label="図版番号"]').fill('2-1');
  await p.locator('#dBody .form textarea[aria-label="内容"]').fill('キャンパス全景（夕景）');
  await p.locator('#dBody .form select[aria-label="手配状況"]').selectOption('依頼中');
  await p.click('#dBody .form button:has-text("追加")'); await p.waitForTimeout(800);
  ok(ss.getSheetByName('図版').cells[1][1] === 'P2' && ss.getSheetByName('図版').cells[1][4] === 'キャンパス全景（夕景）', 'figure saved for P2');
  await p.screenshot({ path: path.join(__dirname, 'out', 'pm_detail.png') });
  // expenses
  await p.click('#dClose'); await p.click('#vt-expenses'); await p.click('#btnExpAdd');
  await p.locator('#expFormBox input[aria-label="内容"]').fill('キャンパス撮影'); await p.locator('#expFormBox input[aria-label="支払先"]').fill('写真家A');
  await p.locator('#expFormBox input[aria-label="金額（税込）"]').fill('55,000'); await p.click('#expFormBox button:has-text("追加")'); await p.waitForTimeout(800);
  ok(ss.getSheetByName('経費').cells[1][5] === 55000 && /¥55,000/.test(await p.textContent('#expSummary')), 'expense saved and totalled');
  await p.screenshot({ path: path.join(__dirname, 'out', 'pm_expenses.png') });
  // progress view
  await p.click('#vt-progress'); await p.waitForTimeout(400);
  ok(await p.locator('#progTable thead th').allTextContents().then((h) => h.includes('初校') && h.includes('再校')), 'progress view shows 初校 and 再校 columns');
  await p.screenshot({ path: path.join(__dirname, 'out', 'pm_progress.png') });
  // upload through relay (chunks)
  await p.click('#vt-board'); await p.click('[data-panel="panelDesign"]');
  await p.fill('#upStart', '表1');
  await p.setInputFiles('#designFile', path.join(__dirname, 'fixtures', 'test6.pdf')); await p.waitForTimeout(6000);
  ok(ss.getSheetByName('デザイン') && ss.getSheetByName('デザイン').cells[1] && ss.getSheetByName('デザイン').cells[1][4] === '表1', 'upload via relay recorded in デザイン: ' + await p.textContent('#designMsg'));
  ok(await p.evaluate(() => S.assign.get('F') && !S.assign.get('F').src.startsWith('PDF')), 'uploaded PDF placed on 表1');

  /* ---------- client ---------- */
  const cClient = await mkctx('T_CLIENT');
  p = await open(cClient); await login(p);
  ok(await p.evaluate(() => S.me && S.me.key === 'client'), 'client signed in');
  ok(await vis(p, '#vt-expenses') && !(await vis(p, '#vt-members')), 'client sees 経費 but not メンバー');
  await p.click('.tile[data-k="2"]'); await p.waitForTimeout(400);
  ok(await p.locator('#dBody .stage select').first().isDisabled(), 'client cannot change progress');
  await p.fill('#dBody .cform textarea', '承知しました。差し替え写真を送ります'); await p.click('#dBody .cform button'); await p.waitForTimeout(800);
  ok(W.mails.length === 1 && W.mails[0].to === 'owner@example.com' && /page=P2/.test(W.mails[0].body), 'client comment emailed to 社内 with a link to P2');
  await p.click('#dClose'); await p.click('#vt-expenses'); await p.waitForTimeout(300);
  ok(!(await vis(p, '#btnExpAdd')) && /¥55,000/.test(await p.textContent('#expSummary')), 'client reads expenses, cannot add');

  /* ---------- external ---------- */
  const cExt = await mkctx('T_EXT');
  p = await open(cExt, '&page=P2'); await login(p); await p.waitForTimeout(500);
  ok(!(await vis(p, '#vt-expenses')) && !(await vis(p, '#vt-members')), 'external sees neither 経費 nor メンバー');
  ok(await vis(p, '#detail') && /P2/.test(await p.textContent('#dTitle')), '?page=P2 opens the page detail');
  ok(!(await p.locator('#dBody .stage select').first().isDisabled()), 'external can change progress');
  await p.locator('#dBody .stage select').nth(1).selectOption('調整中'); await p.waitForTimeout(800);
  ok(ss.getSheetByName('台割／表').cells[rowP2][7] === '調整中', 'external updated 再校');
  ok(W.mails.length === 1, 'no mail for status changes');
  await p.fill('#dBody .cform textarea', '再校の修正を入れました'); await p.click('#dBody .cform button'); await p.waitForTimeout(800);
  ok(W.mails.length === 3 && W.mails.slice(1).map((m) => m.to).sort().join(',') === 'client@example.ac.jp,owner@example.com', 'external comment mails 社内 + earlier commenter on P2');
  await p.click('#vt-comments'); await p.waitForTimeout(300);
  ok((await p.locator('#commentList > li').count()) === 3, 'comments view lists the 3 open comments');

  /* ---------- stranger ---------- */
  const cStr = await mkctx('T_STRANGER');
  p = await open(cStr); await login(p);
  ok(/メンバーに登録されていません/.test(await p.textContent('#loginMsg')) && await vis(p, '#btnSwitch'), 'stranger told they are not a member');

  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
