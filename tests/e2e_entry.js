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

  const ROOT = 'https://studio-pastel.github.io/editorial_pm/';
  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'メンバー', [['メール', '名前', '役割', 'メモ'], ['owner@example.com', '制作 太郎', '社内', '']]));
  ss.getSheetByName('設定').cells.push(['案件名', 'サンプル冊子2028']);
  const P2 = 'SECONDPROJECT0000000000000000000000000000000';
  const ss2 = W.addSheet(P2, '別の冊子_台割', [{ title: '台割', cells: [['頁', '内容'], ['001', '扉'], ['002', '目次']] }, { title: 'メンバー', cells: [['メール', '名前', '役割'], ['owner@example.com', '制作 太郎', '社内']] }, { title: '設定', cells: [['項目', '値'], ['案件名', '別の冊子']] }], 'PARENT');
  const openRoot = async (ctx, q) => { const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto(ROOT + (q || '')); await p.waitForTimeout(800); return p; };

  /* ---------- owner: entry page, add the project, invite ---------- */
  const cOwner = await mkctx('T_OWNER');
  let p = await openRoot(cOwner);
  ok(await vis(p, '#login') && !(await vis(p, '#landing')), 'entry page shows the sign-in, not a URL form');
  await login(p);
  ok(await vis(p, '#landing') && await vis(p, '#projAdd') && /まだ案件がありません/.test(await p.textContent('#landingMsg')), 'owner with no project yet: empty list + 案件を追加');
  await p.fill('#openUrl', 'https://docs.google.com/spreadsheets/d/' + SID + '/edit#gid=0'); await p.click('#btnOpen'); await p.waitForTimeout(900);
  ok(await p.locator('#projList li').count() === 1 && /サンプル冊子2028/.test(await p.textContent('#projList')) && /社内/.test(await p.textContent('#projList')), 'project added and listed with its 案件名 and role');
  await p.click('#projList a'); await p.waitForTimeout(2500);
  ok(await vis(p, '#view-board') && !(await vis(p, '#login')) && await p.evaluate(() => S.me && S.me.key === 'staff'), 'opens the project without signing in again');
  ok(await vis(p, '#btnProjects'), '社内 sees the 案件一覧 button');
  await p.click('#vt-members');
  await p.fill('#mEmail', 'client@example.ac.jp'); await p.fill('#mName', '大学 担当'); await p.selectOption('#mRole', 'クライアント');
  ok(await p.isChecked('#mInvite'), '「招待メールを送る」 is checked by default');
  await p.click('#btnMemAdd'); await p.waitForTimeout(700);
  const inv = W.mails.find((m) => m.to === 'client@example.ac.jp');
  ok(inv && inv.replyTo === 'owner@example.com' && inv.body.indexOf('   ' + ROOT + '\n') > 0 && /大学 担当様/.test(inv.body), 'invite mailed with the entry URL, reply-to the inviter');
  await p.fill('#mEmail', 'designer@example.com'); await p.fill('#mName', 'デザイナーA'); await p.selectOption('#mRole', 'チームメンバー'); await p.uncheck('#mInvite');
  const before = W.mails.length;
  await p.click('#btnMemAdd'); await p.waitForTimeout(700);
  ok(W.mails.length === before, 'no invite when unchecked');
  await p.locator('#memTable tr', { hasText: 'designer@example.com' }).locator('button:has-text("招待を送る")').click(); await p.waitForTimeout(700);
  ok(W.mails.length === before + 1 && W.mails[W.mails.length - 1].to === 'designer@example.com', '「招待を送る」 sends it later');
  await p.screenshot({ path: path.join(__dirname, 'out', 'entry_members.png') });

  /* ---------- client: one project → straight in ---------- */
  const cClient = await mkctx('T_CLIENT');
  p = await openRoot(cClient); await login(p); await p.waitForTimeout(2500);
  ok(p.url().indexOf('?sheet=' + SID) > 0 && await vis(p, '#view-board') && !(await vis(p, '#login')) && await p.evaluate(() => S.me && S.me.key === 'client'), 'member of one project goes straight in after the entry sign-in');
  ok(!(await vis(p, '#btnProjects')), 'no 案件一覧 button for a client with one project');

  /* ---------- client in two projects → list ---------- */
  ss2.getSheetByName('メンバー').cells.push(['client@example.ac.jp', '大学 担当', 'チームメンバー']);
  const pOwner2 = await openRoot(cOwner, '?sheet=' + P2); await login(pOwner2);   // a project not added yet asks for its own sign-in; opening it registers it
  ok(JSON.parse(W.props.PROJECTS).indexOf(P2) >= 0, 'opening a project registers it');
  p = await openRoot(cClient); await p.waitForTimeout(1500);
  ok(await vis(p, '#landing') && await p.locator('#projList li').count() === 2 && !(await vis(p, '#projAdd')), 'two projects → list (no 案件を追加 for a client)');
  ok(/別の冊子/.test(await p.textContent('#projList')) && /チームメンバー/.test(await p.textContent('#projList')), 'role shown per project');
  await p.screenshot({ path: path.join(__dirname, 'out', 'entry_list.png') });
  await p.click('#projList a:has-text("別の冊子")'); await p.waitForTimeout(2000);
  ok(p.url().indexOf('?sheet=' + P2) > 0 && await vis(p, '#view-board') && await p.evaluate(() => S.me && S.me.key === 'ext'), 'picked project opens with that project role');
  ok(await vis(p, '#btnProjects'), 'with two projects the 案件一覧 button appears');
  // a project link with only the entry sign-in (e.g. a notification mail opened later)
  await p.evaluate((id) => localStorage.removeItem('dandori.session.' + id), SID);
  await p.goto(ROOT + '?sheet=' + SID + '&page=P2'); await p.waitForTimeout(2500);
  ok(!(await vis(p, '#login')) && await vis(p, '#detail') && /P2/.test(await p.textContent('#dTitle')), 'project link opens without a second sign-in when the entry sign-in is there');
  // logout clears every sign-in
  await p.goto(ROOT + '?list=1'); await p.waitForTimeout(1500);
  await p.click('#btnDirOut'); await p.waitForTimeout(1200);
  ok(await vis(p, '#login') && await p.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf('dandori.session.') === 0).length) === 0, 'ログアウト on the entry page clears all sign-ins');

  /* ---------- stranger ---------- */
  const cStr = await mkctx('T_STRANGER');
  p = await openRoot(cStr); await login(p); await p.waitForTimeout(800);
  ok(await vis(p, '#landing') && /どの案件のメンバーにも登録されていません/.test(await p.textContent('#landingMsg')) && await p.locator('#projList li').count() === 0 && !(await vis(p, '#projAdd')), 'non-member: told to ask, sees nothing');
  const bodyText = await p.evaluate(() => document.body.innerText);
  ok(!/サンプル冊子|別の冊子/.test(bodyText), 'non-member sees no project name');
  await p.setViewportSize({ width: 390, height: 844 });
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'entry page fits a phone');

  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
