/* ===== relay: every read and write goes through the Apps Script relay; sign-in = Google ID token ===== */
const CONFIG = { relayUrl: '__RELAY_URL__', clientId: '__CLIENT_ID__' };

class RelayError extends Error { constructor(code, message) { super(message); this.code = code; } }
const AUTH = { session: '', email: '', name: '' };
/* one sign-in per spreadsheet: the relay binds each session to the sheet it was issued for */
const sessionKey = () => 'dandori.session.' + (S.sheetId || '');
function loadSession() {
  try {
    localStorage.removeItem('dandori.session');   // sessions from before 2026-10-29 are no longer accepted
    const j = JSON.parse(localStorage.getItem(sessionKey()) || 'null'); if (j && j.session) Object.assign(AUTH, j);
  } catch (e) { /* none */ }
}
function saveSession() { try { localStorage.setItem(sessionKey(), JSON.stringify(AUTH)); } catch (e) { /* this browser keeps no memory */ } }
function clearSession() { AUTH.session = ''; AUTH.email = ''; AUTH.name = ''; try { localStorage.removeItem(sessionKey()); } catch (e) { /* ignore */ } }
const signedIn = () => !!AUTH.session;

async function relay(action, params, opts) {
  opts = opts || {};
  const body = Object.assign({ action, sheet: S.sheetId, session: AUTH.session }, params || {});
  let res;
  try { res = await fetch(CONFIG.relayUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow' }); }
  catch (e) { throw new RelayError('network', '中継スクリプトに接続できませんでした（ネットワークを確認してください）'); }
  let j;
  try { j = await res.json(); }
  catch (e) { throw new RelayError('server', '中継スクリプトの応答を読めませんでした（' + res.status + '）。デプロイの設定「アクセスできるユーザー：全員」を確認してください'); }
  if (!j || !j.ok) {
    const err = new RelayError((j && j.code) || 'server', (j && j.message) || '中継スクリプトでエラーが起きました');
    if (err.code === 'auth' && !opts.quiet) { clearSession(); showLogin(err.message); }
    throw err;
  }
  return j;
}

/* ---- sign-in with Google (identity only: no Drive or Sheets permission is asked) ---- */
function loadGis() {
  if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new RelayError('network', 'Googleのログイン画面を読み込めませんでした'));
    document.head.appendChild(s);
  });
}
let gisReady = false;
async function showLogin(msg) {
  document.body.classList.add('locked');
  $('login').hidden = false; $('landing').hidden = true;
  // the project's name is never shown before sign-in
  S.sheetTitle = ''; document.title = 'エディトリアルPM';
  $('brandTitle').textContent = 'エディトリアルPM'; $('projTitle').textContent = '';
  $('loginTitle').textContent = 'エディトリアルPM';
  setMsg('loginMsg', msg || '', msg ? 'err' : '');
  try {
    await loadGis();
    if (!gisReady) {
      google.accounts.id.initialize({ client_id: CONFIG.clientId, callback: onCredential, auto_select: false, cancel_on_tap_outside: true, use_fedcm_for_prompt: true });
      gisReady = true;
    }
    $('gsiBtn').textContent = '';
    google.accounts.id.renderButton($('gsiBtn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', locale: 'ja', width: 280 });
  } catch (e) { setMsg('loginMsg', e.message, 'err'); }
}
async function onCredential(resp) {
  setMsg('loginMsg', '確認中…');
  try {
    const r = await relay('auth', { idToken: resp && resp.credential }, { quiet: true });
    Object.assign(AUTH, { session: r.session, email: r.email, name: r.name });
    saveSession();
    $('login').hidden = true; document.body.classList.remove('locked');
    await loadProject();
  } catch (e) {
    setMsg('loginMsg', e.message, 'err');
    $('btnSwitch').hidden = e.code !== 'not_member';
  }
}
function signOut() {
  clearSession();
  try { google.accounts.id.disableAutoSelect(); } catch (e) { /* not loaded */ }
  location.reload();
}

/* ---- files through the relay ---- */
function b64ToBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new RelayError('read', 'ファイルを読めませんでした')); r.readAsDataURL(blob); });
}
async function relayFileMeta(id) { return relay('fileMeta', { id }); }
async function relayDownload(meta, onProgress) {
  const parts = []; let off = 0;
  while (off < meta.size) {
    const r = await relay('fileChunk', { id: meta.id, offset: off, length: 4 * 1024 * 1024 });
    const b = b64ToBytes(r.data);
    if (!b.length) break;
    parts.push(b); off += b.length;
    if (onProgress) onProgress(off / meta.size);
  }
  if (off < meta.size) throw new RelayError('drive', 'ファイルを最後まで読み込めませんでした');
  return new Blob(parts, { type: meta.mime || 'application/pdf' });
}
async function relayUpload(file, target, onProgress) {
  const init = await relay('uploadInit', { name: file.name, size: file.size, mime: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : ''), target: target || 'design' });
  let off = 0, done = null;
  while (off < file.size) {
    const part = file.slice(off, off + init.chunk);
    const r = await relay('uploadChunk', { uploadId: init.uploadId, offset: off, data: await blobToBase64(part) });
    off += part.size;
    if (onProgress) onProgress(off / file.size);
    if (r.done) done = r.file;
  }
  if (!done) throw new RelayError('drive', 'アップロードが完了しませんでした');
  return done;
}
