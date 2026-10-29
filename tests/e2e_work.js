const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const { makeWorld, jstDate } = require('../relay/gasmock.js');
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
  const SCHED = 'TESTSCHEDULE00000000000000000000000000000000';
  const D = (y, m, d) => jstDate(y, m, d, 0, 0, false, 'MM/dd');
  const rows = [['キックオフ', D(2026, 9, 29), D(2026, 9, 29)], ['印刷会社見積り（2社程度）', D(2026, 9, 30), D(2026, 10, 9)], ['イントロダクション及び台割CB（貴学）', D(2026, 10, 13), D(2026, 10, 30)],
    ['取材・撮影リスト作成', D(2026, 10, 19), D(2026, 10, 23)], ['アンケート、取材内容の確定', D(2026, 11, 1), D(2026, 12, 11)], ['デザインフォーマット／デザイン制作', D(2026, 11, 1), D(2026, 12, 18)],
    ['初校提出', D(2026, 12, 18), D(2026, 12, 18)], ['初校CB（貴学）', D(2027, 1, 4), D(2027, 1, 20)], ['2校ご提出／五月雨のお戻しを予想', D(2027, 1, 11), D(2027, 1, 29)],
    ['最終校ご確認（貴学）', D(2027, 2, 22), D(2027, 2, 26)], ['校了→入稿', D(2027, 3, 1), D(2027, 3, 1)], ['印刷工程進行', D(2027, 3, 15), D(2027, 3, 30)], ['納品', D(2027, 4, 1), D(2027, 4, 1)]];
  W.addSheet(SCHED, 'サンプル冊子_スケジュール案', [{ title: '制作スケジュール', cells: [[], ['サンプル冊子 2028 制作スケジュール'], ['2026/10/13時点'], [], ['内容', '開始日', '終了日', '日数', '2026年10月'], ['', '', '', '', D(2026, 10, 1)], ['', '', '', '', '木']].concat(rows.map((r) => r.concat([1]))) }], 'OTHER');
  W.folders.OTHER = { name: 'other' };
  ss.sheets.push(new (ss.sheets[0].constructor)(ss, 'メンバー', [['メール', '名前', '役割', 'メモ'], ['owner@example.com', '制作 太郎', '社内', ''], ['client@example.ac.jp', '大学 担当', 'クライアント', ''], ['designer@example.com', 'デザイナーA', '外部スタッフ', '']]));

  /* ---------- owner ---------- */
  const cOwner = await mkctx('T_OWNER');
  let p = await open(cOwner); await login(p);
  ok(await p.evaluate(() => S.me && S.me.key === 'staff'), 'owner signed in');
  ok(await vis(p, '#vt-schedule') && await vis(p, '#vt-tasks') && await vis(p, '#vt-minutes'), '社内 sees スケジュール・タスク・議事録 tabs');
  await p.click('[data-panel="panelProject"]');
  await p.fill('#projName', 'サンプル冊子2028');
  await p.fill('#schedUrl', 'https://docs.google.com/spreadsheets/d/' + SCHED + '/edit?usp=sharing');
  await p.click('#btnSaveProj'); await p.waitForTimeout(2500);
  ok(await p.title() === 'サンプル冊子2028' && await p.textContent('#brandTitle') === 'サンプル冊子2028', 'page title and header show 案件名: ' + await p.title());
  ok(ss.getSheetByName('設定').cells.some((c) => c[0] === '案件名' && c[1] === 'サンプル冊子2028') && ss.getSheetByName('設定').cells.some((c) => c[0] === 'スケジュールシート'), '案件名 and スケジュールシート saved in 設定');
  // schedule
  await p.click('#vt-schedule'); await p.waitForTimeout(500);
  ok(await p.textContent('#schTitle') === 'サンプル冊子 2028 制作スケジュール' && await p.textContent('#schAsOf') === '2026/10/13時点', 'schedule title and 時点');
  ok(await p.locator('#gantt .g-row:not(.g-headrow)').count() === rows.length, 'one Gantt row per item');
  ok(await p.locator('#gantt .g-ms').count() === 4 && await p.locator('#gantt .g-bar').count() === rows.length - 4, '1-day items as markers, the rest as bars');
  const wide = await p.evaluate(() => { const g = $('gantt'); return [g.scrollWidth, g.clientWidth]; });
  ok(wide[0] <= wide[1] + 1, 'Gantt fits the width at 1440px: ' + wide);
  await p.screenshot({ path: path.join(__dirname, 'out', 'w_schedule.png') });
  await p.click('#gantt .g-row:not(.g-headrow) >> nth=6 >> .g-label'); await p.waitForTimeout(200);
  ok(await vis(p, '#schEdit .schform') && /初校提出/.test(await p.textContent('#schEdit')), 'clicking an item opens the date editor');
  await p.fill('#schEdit input[aria-label="開始日"]', '2026-12-21'); await p.fill('#schEdit input[aria-label="終了日"]', '2026-12-21');
  await p.click('#schEdit button:has-text("保存")'); await p.waitForTimeout(800);
  const c = W.sheets[SCHED].getSheetByName('制作スケジュール').cells[13];
  ok(c[0] === '初校提出' && c[1] instanceof Date && c[1].disp === '12/21' && !(await vis(p, '#schEdit .schform')), 'date saved to the schedule sheet (shown as ' + (c[1] && c[1].disp) + ')');
  // tasks
  await p.click('#vt-tasks'); await p.click('#btnTaskAdd');
  await p.fill('#taskFormBox input[aria-label="タスク"]', '撮影リストを大学に共有');
  await p.fill('#taskFormBox input[aria-label="担当"]', '大学 担当');
  await p.fill('#taskFormBox input[aria-label="期限"]', '2026-10-23');
  await p.click('#taskFormBox button:has-text("追加")'); await p.waitForTimeout(700);
  await p.click('#btnTaskAdd');
  await p.fill('#taskFormBox input[aria-label="タスク"]', '印刷会社に見積り依頼');
  await p.fill('#taskFormBox input[aria-label="担当"]', '印刷会社A');
  await p.fill('#taskFormBox input[aria-label="期限"]', '2099-01-10');
  await p.click('#taskFormBox button:has-text("追加")'); await p.waitForTimeout(700);
  const tk = ss.getSheetByName('タスク').cells;
  ok(tk.length === 3 && tk[1][3] === 'client@example.ac.jp' && tk[2][2] === '印刷会社A' && tk[2][3] === '', 'two tasks saved (member and free-text assignee)');
  ok(await p.locator('#taskTable tbody tr').count() === 2 && /期限切れ/.test(await p.textContent('#taskTable')), 'list shows both, the past due one flagged');
  ok(/大学 担当/.test(await p.textContent('#taskPeople')) && /印刷会社A/.test(await p.textContent('#taskPeople')), 'counts per assignee');
  await p.locator('#taskTable tbody tr').nth(1).locator('select').selectOption('完了'); await p.waitForTimeout(700);
  ok(ss.getSheetByName('タスク').cells[2][5] === '完了' && await p.locator('#taskTable tbody tr').count() === 1, 'status changed inline; 完了 hidden by the 未完了 filter');
  await p.screenshot({ path: path.join(__dirname, 'out', 'w_tasks.png') });
  // minutes
  await p.click('#vt-minutes'); await p.click('#btnMinAdd'); await p.waitForTimeout(300);
  await p.fill('#minDoc input[aria-label="日付"]', '2026-10-09');
  await p.fill('#minDoc input[aria-label="タイトル"]', '対面お打ち合わせ');
  await p.fill('#minDoc input[aria-label="出席者"]', '大学 担当、制作');
  await p.fill('#minDoc input[aria-label="タグ"]', '打合せ, 台割');
  await p.fill('#minDoc textarea', '## 決定事項\n- 表紙は**案B**で進める\n- [ ] 撮影リスト共有\n\n| 項目 | 担当 |\n|---|---|\n| 撮影 | カメラマンA |\n\n<img src=x onerror="window.__xss=1">');
  await p.waitForTimeout(800);
  ok(await p.locator('#minDoc .md-preview h2').count() === 1 && await p.locator('#minDoc .md-preview table').count() === 1 && await p.locator('#minDoc .md-preview input[type=checkbox]').count() === 1, 'live preview renders headings, tables, checkboxes');
  await p.screenshot({ path: path.join(__dirname, 'out', 'w_minutes_edit.png') });
  await p.click('#minDoc button:has-text("保存")'); await p.waitForTimeout(900);
  ok(await p.evaluate(() => !window.__xss), 'script in Markdown is not executed');
  const mfile = Object.values(W.files).find((f) => /\.md$/.test(f.name));
  ok(mfile && mfile.name === '2026-10-09_対面お打ち合わせ.md' && ss.getSheetByName('議事録').cells[1][2] === '対面お打ち合わせ', 'saved: row in 議事録 + .md file in Drive');
  ok(await vis(p, '#minDoc .md-body strong') && /案B/.test(await p.textContent('#minDoc .md-body')), 'saved minutes displayed rendered');
  await p.click('#btnMinAdd'); await p.waitForTimeout(300);
  await p.fill('#minDoc input[aria-label="タイトル"]', '社内メモ'); await p.fill('#minDoc input[aria-label="タグ"]', '社内');
  await p.fill('#minDoc textarea', 'ノンブルの位置を確認');
  await p.click('#minDoc button:has-text("保存")'); await p.waitForTimeout(900);
  ok(await p.locator('#minList li').count() === 2, 'two minutes listed');
  await p.evaluate(() => { minBodies.clear(); });
  await p.fill('#mSearch', 'ノンブル'); await p.waitForTimeout(1200);
  ok(await p.locator('#minList li').count() === 1 && /社内メモ/.test(await p.textContent('#minList')), 'search finds text inside the body');
  await p.fill('#mSearch', ''); await p.waitForTimeout(400);
  await p.click('#mTags button:has-text("#台割")'); await p.waitForTimeout(200);
  ok(await p.locator('#minList li').count() === 1 && /対面/.test(await p.textContent('#minList')), 'tag filter');
  await p.click('#minList .mitem'); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(__dirname, 'out', 'w_minutes.png') });

  /* ---------- client ---------- */
  const cClient = await mkctx('T_CLIENT');
  p = await open(cClient); await login(p);
  ok(await p.title() === 'サンプル冊子2028', 'client sees the 案件名 title');
  await p.click('#vt-schedule'); await p.waitForTimeout(300);
  ok(await p.locator('#gantt .g-row:not(.g-headrow)').count() === rows.length && await p.locator('#gantt button.g-label').count() === 0 && !(await vis(p, '#schLink')), 'client sees the schedule read-only');
  await p.click('#vt-minutes'); await p.waitForTimeout(300);
  ok(await vis(p, '#btnMinAdd'), 'client can write minutes');
  await p.click('#minList .mitem >> nth=0'); await p.waitForTimeout(600);
  ok(await p.locator('#minDoc button:has-text("編集")').count() === 1 && await p.locator('#minDoc button:has-text("削除")').count() === 0, 'client can edit minutes by others but not delete them');
  await p.click('#vt-tasks'); await p.waitForTimeout(200);
  await p.selectOption('#tAssignee', 'me'); await p.waitForTimeout(200);
  ok(await p.locator('#taskTable tbody tr').count() === 1 && /撮影リスト/.test(await p.textContent('#taskTable')), '「自分」filter shows the task assigned to the client');

  /* ---------- external ---------- */
  const cExt = await mkctx('T_EXT');
  p = await open(cExt); await login(p);
  ok(!(await vis(p, '#vt-schedule')) && await vis(p, '#vt-tasks') && await vis(p, '#vt-minutes'), 'external: no スケジュール tab; タスク and 議事録 visible');
  ok(await p.textContent('#userChip') === 'デザイナーA（チームメンバー）', 'role shown as チームメンバー (stored as 外部スタッフ): ' + await p.textContent('#userChip'));
  await p.click('#vt-minutes'); await p.waitForTimeout(300);
  ok(!(await vis(p, '#btnMinAdd')), 'external cannot write minutes');
  await p.click('#minList .mitem >> nth=0'); await p.waitForTimeout(600);
  ok(/決定事項|ノンブル/.test(await p.textContent('#minDoc .md-body')) && await p.locator('#minDoc button:has-text("編集")').count() === 0, 'external reads minutes');
  await p.click('#vt-tasks'); await p.click('#btnTaskAdd');
  await p.fill('#taskFormBox input[aria-label="タスク"]', 'P12 レイアウト修正'); await p.fill('#taskFormBox input[aria-label="担当"]', 'デザイナーA');
  await p.click('#taskFormBox button:has-text("追加")'); await p.waitForTimeout(700);
  ok(ss.getSheetByName('タスク').cells[3][1] === 'P12 レイアウト修正' && ss.getSheetByName('タスク').cells[3][3] === 'designer@example.com', 'external creates a task');
  await p.selectOption('#tState', 'all'); await p.waitForTimeout(200);
  await p.locator('#taskTable tbody tr', { hasText: '撮影リスト' }).locator('button:has-text("編集")').click(); await p.waitForTimeout(200);
  ok(await p.locator('#taskFormBox button:has-text("削除")').count() === 0, 'external cannot delete a task created by 社内');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('#taskFormBox button:has-text("やめる")');
  const ow = await p.evaluate(() => document.documentElement.scrollWidth); ok(ow <= 390, 'no horizontal page scroll at 390px: ' + ow);
  await p.screenshot({ path: path.join(__dirname, 'out', 'w_tasks_mobile.png'), fullPage: false });

  console.log('ERRORS:', errs.length ? errs.slice(0, 8).join('\n') : 'none');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
