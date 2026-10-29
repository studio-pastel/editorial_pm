const { makeWorld, jstDate } = require('./gasmock.js');
const fs = require('fs'), path = require('path');
const assert = require('assert');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const CLIENT = '89787741926-q2oegplkho4ulh38cpj9p8grkg718til.apps.googleusercontent.com';
const tok = (email, name, extra) => Object.assign({ aud: CLIENT, email, email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600), name }, extra || {});
const W = makeWorld({
  owner: 'owner@example.com',
  tokens: {
    T_OWNER: tok('Owner@Example.com', '制作 太郎'), T_CLIENT: tok('client@example.ac.jp', '大学 担当'), T_EXT: tok('designer@example.com', 'デザイナー'),
    T_STRANGER: tok('who@example.com', '誰か'), T_OTHERAPP: tok('client@example.ac.jp', 'x', { aud: 'someone-else' }), T_UNVERIFIED: tok('client@example.ac.jp', 'x', { email_verified: 'false' })
  }
});
const SID = 'TESTSHEET000000000000000000000000000000000A', FOLDER = 'TESTFOLDER00000000000000000000000';
const daiwari = [['頁', '左右', 'セクション', '種別', '内容', '備考', '初校', '再校', '原稿種別'], ['表1', '単', '', '表紙', '', '', '調整中', '', '未定'], ['001', '右', '', '扉', '', '', '未／待ち', '', '昨年原稿'], ['002', '左', 'SEC0', 'イントロ', 'メインコピー', '', '未／着手OK', '', '新規']];
const ss = W.addSheet(SID, 'サンプル冊子2028_台割', [
  { title: '台割／表', cells: daiwari, validation: { 6: ['未／待ち', '未／着手OK', '調整中', '確定'] } },
  { title: '設定', cells: [['項目', '値'], ['デザインフォルダ', 'https://drive.google.com/drive/folders/' + FOLDER], ['台割タブ', '台割／表']] }
], 'PARENTFOLDER');
W.folders.ROOT = { name: 'マイドライブ' }; W.folders.PARENTFOLDER = { name: '案件' }; W.folders[FOLDER] = { name: '_design', parent: 'PARENTFOLDER' }; W.folders.OTHER = { name: 'other' };
const pdf = fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'test6.pdf'));
W.files.PDFINFOLDER0000000000 = { name: 'DESIGN-01.pdf', mime: 'application/pdf', bytes: pdf, parents: [FOLDER] };
W.files.SECRETFILE00000000000 = { name: 'secret.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF secret'), parents: ['OTHER'] };

/* ---- auth ---- */
let r = W.call({ action: 'auth', idToken: 'T_OWNER', sheet: SID });
ok(r.ok && r.key === 'staff' && r.email === 'owner@example.com', 'owner signs in as 社内 (email case-folded)');
ok(ss.getSheetByName('メンバー') && ss.getSheetByName('メンバー').cells[1][0] === 'owner@example.com', 'メンバー tab created with the owner');
const S_OWNER = r.session;
r = W.call({ action: 'auth', idToken: 'T_STRANGER', sheet: SID }); ok(!r.ok && r.code === 'not_member', 'non-member refused: ' + r.message);
r = W.call({ action: 'auth', idToken: 'T_OTHERAPP', sheet: SID }); ok(!r.ok && r.code === 'auth', 'token for another app refused');
r = W.call({ action: 'auth', idToken: 'T_UNVERIFIED', sheet: SID }); ok(!r.ok && r.code === 'auth', 'unverified email refused');
r = W.call({ action: 'auth', idToken: 'BOGUS', sheet: SID }); ok(!r.ok && r.code === 'auth', 'bogus token refused');
r = W.call({ action: 'load', session: S_OWNER.slice(0, -2) + 'xx', sheet: SID }); ok(!r.ok && r.code === 'auth', 'tampered session refused');
r = W.call({ action: 'load', session: S_OWNER, sheet: 'bad' }); ok(!r.ok && (r.code === 'bad_request' || r.code === 'auth'), 'bad sheet id refused (' + r.code + ')');

/* ---- members ---- */
r = W.call({ action: 'memberSave', session: S_OWNER, sheet: SID, email: 'Client@example.ac.jp', name: '大学 担当', role: 'クライアント' });
ok(r.ok, 'add client');
r = W.call({ action: 'memberSave', session: S_OWNER, sheet: SID, email: 'designer@example.com', name: '=HYPERLINK("x")', role: '外部スタッフ' });
ok(r.ok && !W.formulas.length, 'add external; name that looks like a formula stored as text');
ok(ss.getSheetByName('メンバー').cells[3][1] === "'=HYPERLINK(\"x\")", 'formula-looking text kept with apostrophe');
r = W.call({ action: 'memberSave', session: S_OWNER, sheet: SID, email: 'owner@example.com', role: 'クライアント' }); ok(!r.ok, 'cannot demote self');
const S_CLIENT = W.call({ action: 'auth', idToken: 'T_CLIENT', sheet: SID }).session;
const S_EXT = W.call({ action: 'auth', idToken: 'T_EXT', sheet: SID }).session;
ok(S_CLIENT && S_EXT, 'client and external sign in after being added');

/* ---- load per role ---- */
r = W.call({ action: 'load', session: S_OWNER, sheet: SID });
ok(r.ok && r.tab === '台割／表' && r.daiwari.length === 4 && r.members.length === 4 && Array.isArray(r.expenses), 'owner load: 台割, members, expenses');
ok(JSON.stringify(r.statusOptions) === JSON.stringify({ 6: ['未／待ち', '未／着手OK', '調整中', '確定'] }), 'dropdown choices of 初校 returned: ' + JSON.stringify(r.statusOptions));
ok(r.folder && r.folder.files.length === 1 && r.folder.files[0].name === 'DESIGN-01.pdf', 'design folder listing');
r = W.call({ action: 'load', session: S_CLIENT, sheet: SID }); ok(r.ok && r.me.key === 'client' && Array.isArray(r.expenses) && !r.members, 'client load: expenses yes, members no');
r = W.call({ action: 'load', session: S_EXT, sheet: SID }); ok(r.ok && r.me.key === 'ext' && !r.expenses && !r.members, 'external load: no expenses, no members');

/* ---- progress ---- */
const st = (s, extra) => W.call(Object.assign({ action: 'status', session: s, sheet: SID, tab: '台割／表', headerRow: 1, pageCol: 1, row: 3, col: 7, page: '001', value: '調整中' }, extra || {}));
r = st(S_EXT); ok(r.ok && ss.getSheetByName('台割／表').cells[2][6] === '調整中', 'external updates 初校 of 001');
r = st(S_CLIENT); ok(!r.ok && r.code === 'forbidden', 'client cannot update progress');
r = st(S_EXT, { page: '002' }); ok(!r.ok && r.code === 'stale', 'stale row refused');
r = st(S_EXT, { col: 5, value: 'x' }); ok(!r.ok && r.code === 'forbidden', 'non-progress column refused');

/* ---- comments + mail ---- */
r = W.call({ action: 'commentAdd', session: S_CLIENT, sheet: SID, page: 'P1', text: '扉の写真、差し替え希望です', origin: 'https://studio-pastel.github.io/editorial_pm/' });
ok(r.ok && r.notified === 1 && W.mails[0].to === 'owner@example.com', 'client comment mails 社内 only: ' + JSON.stringify(W.mails.map((m) => m.to)));
ok(/editorial_pm\/\?sheet=TESTSHEET.*&page=P1/.test(W.mails[0].body) && /大学 担当/.test(W.mails[0].subject), 'mail has link to page');
const cid = r.comment[0];
r = W.call({ action: 'commentAdd', session: S_EXT, sheet: SID, page: 'P1', text: '=IMPORTXML("http://evil","//a")', origin: 'https://evil.example/' });
ok(r.ok && !W.formulas.length && W.mails.length === 3 && !/evil\.example/.test(W.mails[1].body), 'external reply: mails owner + earlier commenter, no formula, no foreign link');
r = W.call({ action: 'commentState', session: S_EXT, sheet: SID, id: cid, state: '対応済' }); ok(!r.ok && r.code === 'forbidden', 'cannot resolve someone else\'s comment');
r = W.call({ action: 'commentState', session: S_CLIENT, sheet: SID, id: cid, state: '対応済' }); ok(r.ok && ss.getSheetByName('コメント').cells[1][7] === '対応済', 'author resolves own comment');
r = W.call({ action: 'commentDelete', session: S_OWNER, sheet: SID, id: cid }); ok(r.ok && ss.getSheetByName('コメント').getLastRow() === 2, '社内 deletes a comment');

/* ---- figures ---- */
r = W.call({ action: 'figureSave', session: S_EXT, sheet: SID, values: { 'ページ': 'P2', '図版番号': '2-1', '種別': '写真', '内容': 'キャンパス全景', '手配状況': '依頼中' } });
ok(r.ok && r.row[1] === 'P2' && r.row[10] === '=HYPERLINK("x")', 'external adds a figure (updater recorded as their member name)');
const fid = r.id;
r = W.call({ action: 'figureSave', session: S_OWNER, sheet: SID, id: fid, values: { '手配状況': '確定' } });
ok(r.ok && r.row[5] === '確定' && r.row[4] === 'キャンパス全景', 'update keeps other fields');
r = W.call({ action: 'figureSave', session: S_CLIENT, sheet: SID, values: { 'ページ': 'P3' } }); ok(!r.ok && r.code === 'forbidden', 'client cannot add figures');

/* ---- expenses ---- */
r = W.call({ action: 'expenseSave', session: S_OWNER, sheet: SID, values: { '日付': '2026/10/27', '区分': '撮影費', '内容': 'キャンパス撮影', '支払先': '写真家A', '金額（税込）': '¥55,000円' } });
ok(r.ok && ss.getSheetByName('経費').cells[1][5] === 55000, 'amount stored as number');
r = W.call({ action: 'expenseSave', session: S_CLIENT, sheet: SID, values: { '内容': 'x' } }); ok(!r.ok && r.code === 'forbidden', 'client cannot write expenses');
r = W.call({ action: 'load', session: S_CLIENT, sheet: SID }); ok(r.expenses.length === 2, 'client reads expenses');

/* ---- files ---- */
r = W.call({ action: 'fileMeta', session: S_EXT, sheet: SID, id: 'PDFINFOLDER0000000000' }); ok(r.ok && r.size === pdf.length, 'file meta in design folder');
r = W.call({ action: 'fileMeta', session: S_OWNER, sheet: SID, id: 'SECRETFILE00000000000' }); ok(!r.ok && r.code === 'forbidden', 'file outside folders refused');
let got = []; let off = 0;
while (off < pdf.length) { r = W.call({ action: 'fileChunk', session: S_CLIENT, sheet: SID, id: 'PDFINFOLDER0000000000', offset: off, length: 10000 }); got.push(Buffer.from(r.data, 'base64')); off += 10000; }
ok(Buffer.concat(got).equals(pdf), 'chunked download reassembles the PDF');

/* ---- upload ---- */
const big = Buffer.alloc(9 * 1024 * 1024 + 123, 7);
r = W.call({ action: 'uploadInit', session: S_EXT, sheet: SID, name: 'x.pdf', size: big.length, mime: 'application/pdf' }); ok(!r.ok && r.code === 'forbidden', 'external cannot upload designs');
r = W.call({ action: 'uploadInit', session: S_OWNER, sheet: SID, name: 'DESIGN-02.pdf', size: big.length, mime: 'application/pdf' });
ok(r.ok && r.chunk === 4 * 1024 * 1024 && r.folderId === FOLDER, 'upload init into design folder');
const up = r.uploadId; let done = null;
for (let o = 0; o < big.length; o += r.chunk) {
  const q = W.call({ action: 'uploadChunk', session: S_OWNER, sheet: SID, uploadId: up, offset: o, data: big.slice(o, o + r.chunk).toString('base64') });
  if (!q.ok) { console.log(q); break; } if (q.done) done = q.file;
}
ok(done && W.files[done.id].bytes.equals(big) && W.files[done.id].parents[0] === FOLDER, 'chunked upload stored in the folder (' + (done && done.id) + ')');
r = W.call({ action: 'uploadInit', session: S_OWNER, sheet: SID, name: 'receipt.jpg', size: 1000, mime: 'image/jpeg', target: 'receipt' });
const rf = W.G.settingsMap_ ? null : null;
ok(r.ok && W.folders[r.folderId] && W.folders[r.folderId].name === 'サンプル冊子2028_台割_領収書' && ss.getSheetByName('設定').cells.some((c) => c[0] === '領収書フォルダ'), 'receipt folder created next to the sheet and recorded');

/* ---- settings + designs ---- */
r = W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: [['項目', '値'], ['判型幅（mm）', '210'], ['デザインフォルダ', 'https://drive.google.com/drive/folders/' + FOLDER]] });
ok(r.ok && ss.getSheetByName('設定').cells.some((c) => c[0] === '領収書フォルダ'), 'settings save keeps 領収書フォルダ');
r = W.call({ action: 'settingsSave', session: S_CLIENT, sheet: SID, rows: [] }); ok(!r.ok && r.code === 'forbidden', 'client cannot change settings');
r = W.call({ action: 'designAppend', session: S_OWNER, sheet: SID, rows: [['https://drive.google.com/file/d/PDFINFOLDER0000000000/view', 'DESIGN-01.pdf', 1, 6, '表1']] });
ok(r.ok && ss.getSheetByName('デザイン').cells[1][4] === '表1', 'design row appended');
r = W.call({ action: 'designUpdate', session: S_OWNER, sheet: SID, row: 2, id: 'WRONGID00000000000000', from: 1, to: 6, start: '3' }); ok(!r.ok && r.code === 'stale', 'design update with wrong file refused');
r = W.call({ action: 'designUpdate', session: S_OWNER, sheet: SID, row: 2, id: 'PDFINFOLDER0000000000', from: 1, to: 6, start: '3' }); ok(r.ok && ss.getSheetByName('デザイン').cells[1][4] === '3', 'design update');
r = W.call({ action: 'designDelete', session: S_OWNER, sheet: SID, row: 2, id: 'PDFINFOLDER0000000000' }); ok(r.ok && ss.getSheetByName('デザイン').getLastRow() === 1, 'design delete');

/* ---- regression: editing an expense keeps 登録日時 as a date ---- */
{
  const eid = ss.getSheetByName('経費').cells[1][0];
  const before = ss.getSheetByName('経費').getRange(2, 11).getDisplayValue();
  r = W.call({ action: 'expenseSave', session: S_OWNER, sheet: SID, id: eid, values: { '承認': '承認済' } });
  const after = ss.getSheetByName('経費').getRange(2, 11).getDisplayValue();
  ok(r.ok && before === after && ss.getSheetByName('経費').cells[1][10] instanceof Date, 'expense edit keeps 登録日時 (' + before + ' → ' + after + ')');
}

/* ---- 案件名 ---- */
const SCHED = 'TESTSCHEDULE00000000000000000000000000000000';
const setRows = (extra) => [['項目', '値'], ['デザインフォルダ', 'https://drive.google.com/drive/folders/' + FOLDER], ['台割タブ', '台割／表'], ['案件名', 'サンプル冊子2028'], ['スケジュールシート', 'https://docs.google.com/spreadsheets/d/' + SCHED + '/edit?usp=sharing']].concat(extra || []);
r = W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: setRows() }); ok(r.ok, 'save 案件名 and スケジュールシート');
r = W.call({ action: 'load', session: S_EXT, sheet: SID });
ok(r.ok && r.title === 'サンプル冊子2028' && r.sheetName === 'サンプル冊子2028_台割' && r.features.indexOf('tasks') >= 0, 'title is 案件名; sheet name kept separately');
ok(r.schedule === undefined, 'external staff gets no schedule');
ok(Array.isArray(r.people) && r.people.some((p) => p.name === '大学 担当' && p.email === 'client@example.ac.jp'), 'everyone gets the member list for assigning');
W.mails.length = 0;
W.call({ action: 'commentAdd', session: S_CLIENT, sheet: SID, page: 'P2', text: 'テスト', origin: 'https://studio-pastel.github.io/editorial_pm/' });
ok(W.mails.length && W.mails[0].subject.indexOf('［サンプル冊子2028］') === 0, 'mail subject uses 案件名: ' + (W.mails[0] || {}).subject);

/* ---- schedule (separate spreadsheet) ---- */
const D = (y, m, d) => jstDate(y, m, d, 0, 0, false, 'MM/dd');
const sx = W.addSheet(SCHED, 'サンプル冊子_スケジュール案', [{ title: '制作スケジュール', cells: [
  [], ['サンプル冊子 2028 制作スケジュール'], ['2026/10/13時点'], [],
  ['内容', '開始日', '終了日', '日数', '2026年10月'], ['', '', '', '', D(2026, 10, 1)], ['', '', '', '', '木'],
  ['キックオフ', D(2026, 9, 29), D(2026, 9, 29), 1],
  ['初校提出', '12/18', '12/18', 1],
  ['初校CB（貴学）', '01/04', '01/20', 17],
  ['', '', '', ''],
  ['納品', D(2027, 4, 1), D(2027, 4, 1), 1]
] }], 'OTHER');
r = W.call({ action: 'load', session: S_CLIENT, sheet: SID });
const sc = r.schedule;
ok(sc && !sc.error && sc.title === 'サンプル冊子 2028 制作スケジュール' && sc.asOf === '2026/10/13時点' && sc.items.length === 4, 'client reads the schedule: ' + JSON.stringify(sc && (sc.error || sc.items.length)));
ok(sc.items[0].start === '2026-09-29' && sc.items[1].start === '2026-12-18' && sc.items[2].start === '2027-01-04' && sc.items[2].end === '2027-01-20' && sc.items[3].end === '2027-04-01', 'dates resolved incl. year for text MM/dd: ' + sc.items.map((i) => i.start + '~' + i.end).join(' '));
ok(sc.items[0].row === 8 && sc.items[3].row === 12, 'rows point at the sheet');
r = W.call({ action: 'scheduleSave', session: S_CLIENT, sheet: SID, row: 8, name: 'キックオフ', start: '2026-09-30', end: '2026-09-30' }); ok(!r.ok && r.code === 'forbidden', 'client cannot edit the schedule');
r = W.call({ action: 'scheduleSave', session: S_OWNER, sheet: SID, row: 8, name: '別の項目', start: '2026-09-30', end: '2026-09-30' }); ok(!r.ok && r.code === 'stale', 'stale schedule row refused');
r = W.call({ action: 'scheduleSave', session: S_OWNER, sheet: SID, row: 8, name: 'キックオフ', start: '2026-10-02', end: '2026-10-01' }); ok(!r.ok && r.code === 'bad_request', 'end before start refused');
r = W.call({ action: 'scheduleSave', session: S_OWNER, sheet: SID, row: 8, name: 'キックオフ', start: '2026-09-30', end: '2026-10-01' });
const cell = sx.getSheetByName('制作スケジュール').cells[7];
ok(r.ok && r.schedule.items[0].start === '2026-09-30' && r.schedule.items[0].end === '2026-10-01' && cell[1] instanceof Date && cell[1].disp === '09/30', '社内 edits dates; cell stays a date shown as MM/dd (' + (cell[1] && cell[1].disp) + ')');
r = W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: setRows().map((x) => (x[0] === 'スケジュールシート' ? [x[0], 'https://docs.google.com/spreadsheets/d/NOSUCHSHEET00000000000000000/edit'] : x)) });
r = W.call({ action: 'load', session: S_OWNER, sheet: SID }); ok(r.ok && r.schedule && /開けませんでした/.test(r.schedule.error), 'unreadable schedule reported without breaking load');
W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: setRows() });

/* ---- 議事録 ---- */
r = W.call({ action: 'minuteSave', session: S_EXT, sheet: SID, values: { '日付': '2026-10-09', 'タイトル': 'x' }, body: 'x' }); ok(!r.ok && r.code === 'forbidden', 'external cannot write minutes');
const md = '## 決定事項\n- 表紙は案Bで進める\n- [ ] 撮影リストを共有（10/23）\n\n| 項目 | 担当 |\n|---|---|\n| 撮影 | A |';
r = W.call({ action: 'minuteSave', session: S_CLIENT, sheet: SID, values: { '日付': '2026/10/9', 'タイトル': '対面お打ち合わせ', '出席者': '大学 担当, 制作', 'タグ': '#打合せ、デザイン, 打合せ' }, body: md });
ok(r.ok && r.row[1] === '2026/10/09' && r.row[4] === '打合せ, デザイン' && r.body === md, 'client writes minutes (date normalized, tags deduped): ' + JSON.stringify(r.row && r.row.slice(1, 5)));
const mid = r.id, mfolderUrl = (ss.getSheetByName('設定').cells.find((c) => c[0] === '議事録フォルダ') || []).slice();
const mfile = W.files[r.row[5].match(/\/d\/([^/]+)/)[1]];
ok(mfolderUrl && W.folders[mfolderUrl[1].split('/').pop()].name === 'サンプル冊子2028_台割_議事録' && mfile.name === '2026-10-09_対面お打ち合わせ.md', 'md file saved in the 議事録 folder next to the sheet: ' + (mfile && mfile.name));
ok(mfile.bytes.toString('utf8').indexOf('---\ntitle: "対面お打ち合わせ"\ndate: "2026-10-09"') === 0 && mfile.bytes.toString('utf8').indexOf(md) > 0, 'md file has front matter + body');
W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: setRows([['議事録フォルダ', ''], ['領収書フォルダ', '']]) });
ok(ss.getSheetByName('設定').cells.find((c) => c[0] === '議事録フォルダ')[1] === mfolderUrl[1] && ss.getSheetByName('設定').cells.find((c) => c[0] === '領収書フォルダ')[1], 'saving settings from a stale browser keeps the folders the relay created');
r = W.call({ action: 'minuteGet', session: S_EXT, sheet: SID, id: mid }); ok(r.ok && r.body === md, 'external reads the body');
const base = W.call({ action: 'load', session: S_OWNER, sheet: SID }).minutes[1][11];
r = W.call({ action: 'minuteSave', session: S_OWNER, sheet: SID, id: mid, base: base, values: { '日付': '2026-10-09', 'タイトル': '対面お打ち合わせ（確定版）', '出席者': '大学 担当, 制作', 'タグ': '打合せ' }, body: md + '\n\n追記' });
ok(r.ok && mfile.name === '2026-10-09_対面お打ち合わせ（確定版）.md' && /追記\n$/.test(mfile.bytes.toString('utf8')) && r.row[7] === '大学 担当' && r.row[10] === '制作 太郎', 'staff updates: file renamed and rewritten; creator kept');
r = W.call({ action: 'minuteSave', session: S_CLIENT, sheet: SID, id: mid, base: base + 'x', values: { '日付': '2026-10-09', 'タイトル': 'y' }, body: 'y' });
ok(!r.ok && r.code === 'conflict' && /追記/.test(mfile.bytes.toString('utf8')), 'edit based on an old version refused, file untouched');
r = W.call({ action: 'minuteBodies', session: S_EXT, sheet: SID }); ok(r.ok && /追記/.test(r.bodies[mid]), 'bodies for search');
r = W.call({ action: 'minuteSave', session: S_OWNER, sheet: SID, values: { '日付': '2026/13/40', 'タイトル': 'x' }, body: '' }); ok(!r.ok && r.code === 'bad_request', 'invalid date refused');
const m2 = W.call({ action: 'minuteSave', session: S_OWNER, sheet: SID, values: { '日付': '2026-10-13', 'タイトル': '=社内メモ' }, body: '' });
ok(m2.ok && !W.formulas.length, 'title starting with = stored as text');
r = W.call({ action: 'minuteDelete', session: S_CLIENT, sheet: SID, id: m2.id }); ok(!r.ok && r.code === 'forbidden', 'client cannot delete minutes written by others');
r = W.call({ action: 'minuteDelete', session: S_CLIENT, sheet: SID, id: mid }); ok(r.ok && mfile.trashed && ss.getSheetByName('議事録').getLastRow() === 2, 'author deletes own minutes (file to trash)');

/* ---- タスク ---- */
r = W.call({ action: 'taskSave', session: S_EXT, sheet: SID, values: { 'タスク': '撮影リストを作る', '担当': '大学 担当', '期限': '2026-11-20' } });
ok(r.ok && r.row[2] === '大学 担当' && r.row[3] === 'client@example.ac.jp' && r.row[4] === '2026/11/20' && r.row[5] === '未着手' && r.row[8] === 'designer@example.com', 'external creates a task assigned to a member: ' + JSON.stringify(r.row));
const tid = r.id;
r = W.call({ action: 'taskSave', session: S_EXT, sheet: SID, values: { 'タスク': '見積り依頼', '担当': '印刷会社A' } });
ok(r.ok && r.row[2] === '印刷会社A' && r.row[3] === '' && r.row[4] === '', 'free-text assignee without email');
const t2 = r.id;
r = W.call({ action: 'taskSave', session: S_CLIENT, sheet: SID, id: tid, values: { '状態': '完了' } }); ok(r.ok && r.row[5] === '完了' && r.row[1] === '撮影リストを作る' && r.row[4] === '2026/11/20', 'client updates status only; other fields kept');
r = W.call({ action: 'taskSave', session: S_CLIENT, sheet: SID, id: tid, values: { '状態': 'done' } }); ok(!r.ok && r.code === 'bad_request', 'unknown state refused');
r = W.call({ action: 'taskSave', session: S_CLIENT, sheet: SID, id: tid, values: { '期限': '11/31' } }); ok(!r.ok && r.code === 'bad_request', 'bad due date refused');
r = W.call({ action: 'taskSave', session: S_CLIENT, sheet: SID, id: tid, values: { '担当メール': 'designer@example.com', '担当': '' } }); ok(r.ok && r.row[2] === '=HYPERLINK("x")' && r.row[3] === 'designer@example.com', 'reassign by email uses the member name');
r = W.call({ action: 'taskDelete', session: S_CLIENT, sheet: SID, id: t2 }); ok(!r.ok && r.code === 'forbidden', 'client cannot delete a task created by someone else');
r = W.call({ action: 'taskDelete', session: S_EXT, sheet: SID, id: t2 }); ok(r.ok, 'creator deletes own task');
r = W.call({ action: 'load', session: S_EXT, sheet: SID }); ok(r.ok && r.tasks.length === 2 && r.minutes.length === 2, 'everyone loads tasks and minutes');

/* ---- someone else's spreadsheet is never served (2026-10-29 fix) ---- */
{
  const EVIL = 'EVILSHEET0000000000000000000000000000000000';
  const evil = W.addSheet(EVIL, 'attacker', [{ title: 'メンバー', cells: [['メール', '名前', '役割', 'メモ'], ['who@example.com', '攻撃者', '社内', '']] }, { title: '設定', cells: [['項目', '値']] }], 'OTHER');
  evil.ownerEmail = 'who@example.com';
  r = W.call({ action: 'auth', idToken: 'T_STRANGER', sheet: EVIL }); ok(!r.ok && r.code === 'not_found', 'sign-in on a sheet not owned by the script owner refused');
  W.mails.length = 0;
  r = W.call({ action: 'commentAdd', session: S_OWNER, sheet: EVIL, page: 'P1', text: 'spam' }); ok(!r.ok && W.mails.length === 0, 'no relay action (or mail) on a foreign sheet even with a valid session');
  const shared = W.addSheet('SHAREDSHEET00000000000000000000000000000000', 'shared to owner', [{ title: 'メンバー', cells: [['メール', '名前', '役割'], ['who@example.com', 'x', '社内']] }], 'OTHER');
  shared.ownerEmail = null;
  r = W.call({ action: 'auth', idToken: 'T_STRANGER', sheet: 'SHAREDSHEET00000000000000000000000000000000' }); ok(!r.ok && r.code === 'not_found', 'sheet without an owner (shared drive) refused');
  // session is bound to one spreadsheet
  const OTHER2 = 'OWNERSHEET2000000000000000000000000000000000';
  W.addSheet(OTHER2, '別案件', [{ title: 'メンバー', cells: [['メール', '名前', '役割'], ['client@example.ac.jp', '大学 担当', '社内']] }], 'PARENTFOLDER');
  r = W.call({ action: 'load', session: S_CLIENT, sheet: OTHER2 }); ok(!r.ok && r.code === 'auth', 'a session from one project cannot be used on another');
  const s2 = W.call({ action: 'auth', idToken: 'T_CLIENT', sheet: OTHER2 }).session;
  r = W.call({ action: 'load', session: s2, sheet: OTHER2 }); ok(r.ok && r.me.key === 'staff', 'signing in to the other project works (role from that sheet)');
  r = W.call({ action: 'load', session: s2, sheet: SID }); ok(!r.ok && r.code === 'auth', '…and that session does not open the first project');
  // old sessions without a sheet are refused
  const legacyPayload = W.G.Utilities.base64EncodeWebSafe(JSON.stringify({ e: 'owner@example.com', x: Date.now() + 864e5 }), 'utf8');
  r = W.call({ action: 'load', session: legacyPayload + '.' + W.G.sign_(legacyPayload), sheet: SID }); ok(!r.ok && r.code === 'auth', 'sessions issued before the fix must sign in again');
  // schedule sheet owned by someone else is not read or written
  const SC2 = 'FOREIGNSCHED000000000000000000000000000000000';
  const fs2 = W.addSheet(SC2, 'foreign', [{ title: 's', cells: [['内容', '開始日', '終了日'], ['x', '2026/10/01', '2026/10/02']] }], 'OTHER');
  fs2.ownerEmail = 'who@example.com';
  W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: setRows().map((x) => (x[0] === 'スケジュールシート' ? [x[0], SC2] : x)) });
  r = W.call({ action: 'load', session: S_OWNER, sheet: SID }); ok(r.ok && r.schedule && /オーナー/.test(r.schedule.error), 'schedule sheet not owned by the script owner is not read');
  r = W.call({ action: 'scheduleSave', session: S_OWNER, sheet: SID, row: 2, name: 'x', start: '2026-10-01', end: '2026-10-03' }); ok(!r.ok && fs2.getSheetByName('s').cells[1][2] === '2026/10/02', 'and not written');
  W.call({ action: 'settingsSave', session: S_OWNER, sheet: SID, rows: setRows() });
}
/* ---- role name: チームメンバー (former 外部スタッフ still accepted) ---- */
r = W.call({ action: 'load', session: S_EXT, sheet: SID }); ok(r.ok && r.me.key === 'ext' && r.me.role === 'チームメンバー', 'a member stored as 外部スタッフ is shown as チームメンバー');
r = W.call({ action: 'memberSave', session: S_OWNER, sheet: SID, email: 'writer@example.com', name: 'ライター', role: 'チームメンバー' });
ok(r.ok && ss.getSheetByName('メンバー').cells.some((c) => c[0] === 'writer@example.com' && c[2] === 'チームメンバー'), 'new members saved as チームメンバー');
r = W.call({ action: 'memberSave', session: S_OWNER, sheet: SID, email: 'x@example.com', role: 'メンバー' }); ok(!r.ok && /チームメンバー/.test(r.message), 'unknown role refused, message names チームメンバー');
W.mails.length = 0;
W.call({ action: 'commentAdd', session: S_CLIENT, sheet: SID, page: 'P9', text: '確認', origin: 'https://studio-pastel.github.io/editorial_pm/' });
ok(W.mails.length && W.mails[0].name === 'エディトリアルPM' && /エディトリアルPMで開く/.test(W.mails[0].body) && !/台割ボード/.test(W.mails[0].body), 'mail sent as エディトリアルPM');
r = W.call({ action: 'memberDelete', session: S_OWNER, sheet: SID, email: 'designer@example.com' }); ok(r.ok, 'remove external member');
r = W.call({ action: 'load', session: S_EXT, sheet: SID }); ok(!r.ok && r.code === 'not_member', 'removed member loses access immediately');
ok(!W.formulas.length, 'no value was ever written as a formula');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
