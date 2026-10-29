/* ===== 3D book (three.js r128): textures ===== */
const TEX_W = 1024, PH_W = 512;
const V = {
  ok: false, renderer: null, scene: null, camera: null, book: null,
  p: 0, target: 0, dirty: true, raf: 0, last: 0,
  th: 0.5, ph: 0.7, r: 600, tth: 0.5, tph: 0.7, tr: 600, camTween: false, tx: 0, ty: 0, tz: 0,
  objs: null, inUse: new Set()
};
const texCache = new Map();   // kstr -> {tex, hi, hiReq, canvas}
function colr(hex) { const c = new THREE.Color(hex); return c.convertSRGBToLinear ? c.convertSRGBToLinear() : c; }

function gutterOnRight(k) {
  const R = S.set.binding === 'R';
  if (typeof k === 'number') return R ? k % 2 === 1 : k % 2 === 0;
  if (k === 'IF') return !R;
  if (k === 'IB') return R;
  return null;
}
function addGutter(cv, k) {
  const right = gutterOnRight(k);
  if (right === null) return;
  const g = cv.getContext('2d'), w = cv.width, h = cv.height, gw = w * 0.1;
  const x0 = right ? w - gw : 0, x1 = right ? w : gw;
  const gr = g.createLinearGradient(right ? x0 : x1, 0, right ? x1 : x0, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.20)');
  g.fillStyle = gr; g.fillRect(x0, 0, gw, h);
}
function wrapText(g, text, maxW, maxLines) {
  const lines = []; let cur = '', cut = false;
  const chars = Array.from(String(text).replace(/\s*\n\s*/g, ' '));
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (g.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur); cur = ch;
      if (lines.length >= maxLines) { cut = true; break; }
    } else cur += ch;
  }
  if (!cut && cur) lines.push(cur);
  if (cut && lines.length) { let last = lines[lines.length - 1]; while (last && g.measureText(last + '…').width > maxW) last = last.slice(0, -1); lines[lines.length - 1] = last + '…'; }
  return lines;
}
function drawPlaceholder(k, w) {
  const h = Math.round(w * S.set.h / S.set.w), cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), info = S.model.pages.get(k), N = NS();
  const isCover = k === 'F' || k === 'B';
  const sec = info && info.section ? 'hsl(' + sectionHue(Math.max(0, S.model.sections.indexOf(info.section))) + ',56%,48%)' : '#9aa9ae';
  g.fillStyle = isCover ? S.set.color : '#f8f7f3'; g.fillRect(0, 0, w, h);
  const fg = isCover ? '#ffffff' : '#1d2a2e', mute = isCover ? 'rgba(255,255,255,.7)' : '#6b7a7f';
  if (!isCover) { g.fillStyle = sec; g.fillRect(0, 0, w, h * 0.022); }
  g.textBaseline = 'top';
  // one column, measured top to bottom, so nothing overlaps; long text is cut with …
  const u = w / 30, x = w * 0.08, maxW = w * 0.84, limit = h * 0.86;
  const JP = '"Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
  let y = h * 0.05;
  const block = (text, weight, size, color, maxLines, gapAfter) => {
    if (!text || y > limit) return;
    g.font = weight + ' ' + size + 'px ' + JP; g.fillStyle = color;
    const lh = size * 1.4, room = Math.max(1, Math.floor((limit - y) / lh));
    wrapText(g, text, maxW, Math.min(maxLines, room)).forEach((ln) => { g.fillText(ln, x, y); y += lh; });
    y += gapAfter;
  };
  g.fillStyle = mute; g.font = '500 ' + (u * 1.05) + 'px "IBM Plex Mono", monospace';
  g.fillText(keyLabel(k), x, y); y += u * 1.6;
  if (info && info.section) block(info.section, 500, u * 0.75, mute, 2, u * 0.9);
  else y += u * 0.6;
  let title = info ? (info.title || info.kind) : '';
  if (typeof k === 'number' && k > N) title = '（調整用の白ページ）';
  if (k === 'F' && !title) title = S.set.title;
  block(title, 700, u * 1.55, fg, 4, u * 0.5);
  if (info && info.title && info.kind && info.kind !== info.title) block(info.kind, 500, u * 0.85, mute, 1, u * 0.5);
  if (info && info.note) block(info.note, 400, u * 0.8, mute, 8, 0);
  const cs = typeof currentStage === 'function' ? currentStage(k) : null;
  g.font = '400 ' + (u * 0.8) + 'px ' + JP; g.fillStyle = mute;
  if (cs) g.fillText(cs.name + '：' + cs.value, x, h * 0.895);
  if (!S.assign.has(kstr(k)) && k !== 'S') g.fillText('デザイン未割当', x, h * 0.935);
  addGutter(cv, k);
  return cv;
}
function mkTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  if (V.renderer) t.anisotropy = Math.min(8, V.renderer.capabilities.getMaxAnisotropy());
  return t;
}
function spineSize() {
  const N = Math.max(NS(), 2), T = Math.max(0.6, spineWidthMM(N, S.set.t, S.set.c)), H = S.set.h;
  const ch = Math.min(2048, Math.round(H * 8)), cw = Math.max(24, Math.round(ch * T / H));
  return { cw, ch, T };
}
async function drawSpine(cv, withDesign) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  const a = S.assign.get('S');
  if (withDesign && a && S.sources.has(a.src)) {
    const src = S.sources.get(a.src);
    if (src.kind === 'img') { g.drawImage(await getBitmap(src), 0, 0, w, h); return true; }
    const pdf = await getPdf(src), page = await pdf.getPage(a.page || 1), v1 = page.getViewport({ scale: 1 });
    const sc = Math.min(3000 / v1.width, 3000 / v1.height, Math.max(w / v1.width, h / v1.height) * 1.5);
    const vp = page.getViewport({ scale: sc }), tmp = document.createElement('canvas');
    tmp.width = Math.ceil(vp.width); tmp.height = Math.ceil(vp.height);
    await page.render({ canvasContext: tmp.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
    g.drawImage(tmp, 0, 0, tmp.width, tmp.height, 0, 0, w, h); return true;
  }
  g.fillStyle = S.set.color; g.fillRect(0, 0, w, h);
  const T = spineSize().T;
  if (S.set.title && T >= 2.5) {
    const chars = Array.from(S.set.title), fs = Math.min(w * 0.62, (h * 0.8) / Math.max(chars.length, 1));
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 ' + fs + 'px "Zen Kaku Gothic New", "Hiragino Kaku Gothic ProN", sans-serif';
    chars.forEach((ch, i) => g.fillText(ch, w / 2, h * 0.1 + fs * (i + 0.5) * 1.02));
  }
  return false;
}
function texFor(k) {
  const key = kstr(k);
  V.inUse.add(key);
  let ent = texCache.get(key);
  if (ent) return ent.tex;
  let cv;
  if (key === 'S') { const sz = spineSize(); cv = document.createElement('canvas'); cv.width = sz.cw; cv.height = sz.ch; drawSpine(cv, false); }
  else cv = drawPlaceholder(k, PH_W);
  ent = { tex: mkTex(cv), hi: false, hiReq: false };
  texCache.set(key, ent);
  if (texCache.size > 22) texEvict();
  const a = S.assign.get(key);
  if (a && !ent.hiReq) {
    ent.hiReq = true;
    queueRender(async () => {
      try {
        if (texCache.get(key) !== ent) return;
        let out;
        if (key === 'S') { const sz = spineSize(); out = document.createElement('canvas'); out.width = sz.cw; out.height = sz.ch; if (!(await drawSpine(out, true))) return; }
        else { out = await renderAssigned(a, TEX_W); if (!out) return; addGutter(out, k); }
        if (texCache.get(key) !== ent) return;
        ent.tex.image = out; ent.tex.needsUpdate = true; ent.hi = true; invalidate();
      } catch (e) { if (S.onRenderError) S.onRenderError(key, e); }
    }, true);
  }
  return ent.tex;
}
function texEvict() {
  for (const [key, ent] of texCache) {
    if (texCache.size <= 18) break;
    if (V.inUse.has(key)) continue;
    ent.tex.dispose(); texCache.delete(key);
  }
}
function texDrop(k) {
  const key = kstr(k), ent = texCache.get(key);
  if (ent) { ent.tex.dispose(); texCache.delete(key); }
  if (V.ok) invalidate();
}
function texClearAll() {
  texCache.forEach((e) => e.tex.dispose()); texCache.clear();
  if (V.ok) invalidate();
}
function gotoCurrentTextures() { if (V.ok) invalidate(); }
