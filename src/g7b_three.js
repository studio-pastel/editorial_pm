/* ===== 3D book: scene, layout, orbit, animation ===== */
function invalidate() { V.dirty = true; if (!V.raf) { V.last = performance.now(); V.raf = requestAnimationFrame(tick); } }

function edgeTex(vertical) {
  const cv = document.createElement('canvas');
  cv.width = vertical ? 2 : 32; cv.height = vertical ? 32 : 2;
  const g = cv.getContext('2d');
  for (let i = 0; i < 32; i++) {
    g.fillStyle = i % 2 ? '#e6e2d8' : '#f7f5ef';
    if (vertical) g.fillRect(0, i, 2, 1); else g.fillRect(i, 0, 1, 2);
  }
  const t = new THREE.CanvasTexture(cv); t.encoding = THREE.sRGBEncoding; t.generateMipmaps = false;
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; return t;
}
function faceMat() { return new THREE.MeshBasicMaterial({ color: 0xffffff }); }
function bindMat(mat, key) {
  if (key === null || key === undefined) { if (mat.map) { mat.map = null; mat.needsUpdate = true; } mat.userData.key = null; return; }
  const t = texFor(key);
  if (mat.map !== t) { const had = !!mat.map; mat.map = t; if (!had) mat.needsUpdate = true; }
  mat.userData.key = kstr(key);
}

function initThree() {
  if (!window.THREE) { $('stagePh').textContent = '3Dライブラリを読み込めませんでした。エディトリアルPMはそのまま使えます。'; return; }
  try {
    const host = $('view3d');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    host.insertBefore(renderer.domElement, host.firstChild);
    V.renderer = renderer;
    V.scene = new THREE.Scene();
    V.camera = new THREE.PerspectiveCamera(32, 1, 5, 20000);
    V.camera.up.set(0, 1, 0);
    V.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dl = new THREE.DirectionalLight(0xffffff, 0.45); dl.position.set(-300, 400, 800); V.scene.add(dl);
    V.ok = true;
    const ro = new ResizeObserver(() => { resize(); });
    ro.observe(host);
    bindOrbit(host);
    resize();
    setBg();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { setBg(); invalidate(); });
    new MutationObserver(() => { setBg(); invalidate(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) {
    V.ok = false; $('stagePh').textContent = 'この環境では3D表示を開始できませんでした（' + (e && e.message ? e.message : 'WebGL') + '）。';
  }
}
function setBg() {
  if (!V.scene) return;
  const c = getComputedStyle($('view3d')).backgroundColor;
  V.scene.background = new THREE.Color(c);
}
function resize() {
  if (!V.ok) return;
  const host = $('view3d'), w = Math.max(200, host.clientWidth), h = Math.max(200, host.clientHeight);
  V.renderer.setSize(w, h, false);
  V.camera.aspect = w / h; V.camera.updateProjectionMatrix();
  invalidate();
}

function disposeBook() {
  if (!V.book) return;
  V.scene.remove(V.book);
  V.book.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach((m) => { if (m.userData && m.userData.own && m.map) m.map.dispose(); m.dispose(); });
  });
  V.book = null; V.objs = null;
}

/** (re)build geometry for the current trim / binding / thickness */
function buildBook() {
  if (!V.ok) return;
  disposeBook(); texClearAll();
  const N = NS();
  $('stagePh').hidden = N > 0;
  if (!N) { invalidate(); return; }
  const sp = S.set, W = sp.w, H = sp.h, dir = sp.binding === 'R' ? -1 : 1;
  const book = new THREE.Group();
  const sideMat = new THREE.MeshLambertMaterial({ color: colr(sp.color) });
  const edgeA = new THREE.MeshLambertMaterial({ map: edgeTex(false) }), edgeB = new THREE.MeshLambertMaterial({ map: edgeTex(true) });
  edgeA.userData.own = true; edgeB.userData.own = true;
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const mkBox = (mats, shiftX) => { const g = unit.clone(); if (shiftX) g.translate(shiftX, 0, 0); return g; };
  void mkBox;
  // back cover (origin side, static): +z = 表3, -z = 表4
  const backMats = [sideMat, sideMat, sideMat, sideMat, faceMat(), faceMat()];
  const back = new THREE.Mesh(unit, backMats); back.scale.set(W, H, sp.c); back.position.set(dir * W / 2, 0, sp.c / 2);
  // body stacks: sides use edge stripes, top uses page texture
  const oMats = [edgeA, edgeA, edgeB, edgeB, faceMat(), edgeA];
  const fMats = [edgeA, edgeA, edgeB, edgeB, faceMat(), edgeA];
  const bodyO = new THREE.Mesh(unit, oMats), bodyF = new THREE.Mesh(unit, fMats);
  // leaves: pivot group at the spine; mesh offset by half width
  const leafGeo = unit.clone(); leafGeo.translate(dir * 0.5, 0, 0);
  const coverMats = [sideMat, sideMat, sideMat, sideMat, faceMat(), faceMat()];
  const coverGrp = new THREE.Group(), coverMesh = new THREE.Mesh(leafGeo, coverMats); coverMesh.scale.set(W, H, sp.c); coverGrp.add(coverMesh);
  const leafMats = [edgeA, edgeA, edgeB, edgeB, faceMat(), faceMat()];
  const leafGrp = new THREE.Group(), leafMesh = new THREE.Mesh(leafGeo, leafMats); leafMesh.scale.set(W, H, sp.t); leafGrp.add(leafMesh);
  // spine plane
  const spineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const spine = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spineMat); spine.rotation.y = -dir * Math.PI / 2;
  // soft shadow under the book
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const sg = sc.getContext('2d'), gr = sg.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.38)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sg.fillStyle = gr; sg.fillRect(0, 0, 128, 128);
  const shMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }); shMat.userData.own = true;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 2.5, H * 1.35), shMat); shadow.position.set(0, 0, -0.4);
  book.add(shadow, back, bodyO, bodyF, coverGrp, leafGrp, spine);
  V.scene.add(book); V.book = book;
  V.objs = { dir, back, backMats, bodyO, oMats, bodyF, fMats, coverGrp, coverMesh, coverMats, leafGrp, leafMesh, leafMats, spine, spineMat };
  const sl = $('spreadSlider'); sl.max = String(spreadCount(Math.max(N, 2)) - 1);
  const mx = spreadCount(Math.max(N, 2)) - 1; V.p = Math.min(V.p, mx); V.target = Math.min(V.target, mx);
  fitCamera(false);
  invalidate();
}

function layout() {
  const o = V.objs; if (!o) return;
  V.inUse.clear();
  const N = Math.max(NS(), 2), m = leafCount(N), L = m + 1, sp = S.set, W = sp.w, H = sp.h, t = sp.t, c = sp.c, dir = o.dir;
  const p = Math.max(0, Math.min(L, V.p)), r = Math.round(p);
  let F, part = -1, frac = 0;
  if (Math.abs(p - r) < 1e-4) F = r; else { F = Math.floor(p); part = F; frac = p - F; }
  const firstO = Math.max(1, part >= 0 ? part + 1 : F);
  const nBO = Math.max(0, m - firstO + 1), nBF = Math.max(0, F - 1);
  const lerp = (a, b, x) => a + (b - a) * x;
  // back cover
  bindMat(o.backMats[4], 'IB'); bindMat(o.backMats[5], 'B');
  // origin stack
  o.bodyO.visible = nBO > 0;
  if (nBO > 0) { const th = nBO * t; o.bodyO.scale.set(W, H, th); o.bodyO.position.set(dir * W / 2, 0, c + th / 2); bindMat(o.oMats[4], frontOf(firstO)); }
  // flipped stack (top shows the back of leaf F-1)
  o.bodyF.visible = nBF > 0;
  if (nBF > 0) { const th = nBF * t; o.bodyF.scale.set(W, H, th); o.bodyF.position.set(-dir * W / 2, 0, c + th / 2); bindMat(o.fMats[4], backOf(F - 1)); }
  // cover leaf
  bindMat(o.coverMats[4], 'F'); bindMat(o.coverMats[5], 'IF');
  let cTheta, cz;
  if (part === 0) { cTheta = frac * Math.PI; cz = lerp(c + m * t + c / 2, c / 2, frac); }
  else if (F >= 1) { cTheta = Math.PI; cz = c / 2; }
  else { cTheta = 0; cz = c + nBO * t + c / 2; }
  o.coverGrp.rotation.y = -dir * cTheta; o.coverGrp.position.z = cz;
  // partial body leaf
  const bodyPart = part >= 1;
  o.leafGrp.visible = bodyPart;
  if (bodyPart) {
    const i = part;
    bindMat(o.leafMats[4], frontOf(i)); bindMat(o.leafMats[5], backOf(i));
    o.leafGrp.rotation.y = -dir * frac * Math.PI;
    o.leafGrp.position.z = lerp(c + (m - i) * t + t / 2, c + (i - 1) * t + t / 2, frac);
  }
  // spine
  const topO = c + nBO * t + (F === 0 || part === 0 ? c : 0) + (bodyPart ? t : 0);
  const topF = c + nBF * t + (bodyPart ? t : 0);
  const sTop = Math.max(c, topO, topF), T0 = Math.max(0.6, spineWidthMM(N, t, c));
  o.spine.scale.set(sTop, H, 1); o.spine.position.set(-dir * 0.02, 0, sTop / 2);
  const st = texFor('S'); if (o.spineMat.map !== st) { o.spineMat.map = st; o.spineMat.needsUpdate = true; }
  st.repeat.set(Math.min(1, sTop / T0), 1);
  texEvict();
  // camera target follows the book centre
  V.tx = dir * (W / 2) * (1 - Math.min(1, p)); V.tz = Math.min(sTop, T0) / 2;
}

/* ---- camera ---- */
function fitDistance(openW) {
  const f = THREE.MathUtils.degToRad(V.camera.fov) / 2, asp = V.camera.aspect;
  const halfH = S.set.h * 0.62, halfW = openW * 0.58;
  return Math.max(halfH / Math.tan(f), halfW / (Math.tan(f) * asp)) * 1.05;
}
function applyCamera() {
  const o = V.objs; if (!o) return;
  const sph = Math.sin(V.ph), x = V.tx + V.r * sph * Math.sin(V.th), y = V.ty - V.r * sph * Math.cos(V.th), z = V.tz + V.r * Math.cos(V.ph);
  V.camera.position.set(x, y, z);
  V.camera.lookAt(V.tx, V.ty, V.tz);
}
function fitCamera(animate) {
  const open = V.p >= 0.5;
  V.tr = fitDistance(open ? S.set.w * 2 : S.set.w * 1.1);
  if (!animate) { V.r = V.tr; V.th = V.tth; V.ph = V.tph; } else V.camTween = true;
  invalidate();
}
const CAMS = {
  oblique: (d) => [-0.42 * d, 0.62, 'auto'], top: () => [0, 0.001, 'auto'],
  fore: (d) => [d * Math.PI / 2, 1.2, 'auto'], spine: (d) => [-d * Math.PI / 2, 1.2, 'closed'],
  closed: (d) => [-0.42 * d, 0.62, 'closed'], back: (d) => [-0.3 * d, Math.PI - 0.62, 'closed']
};
function setCam(name) {
  if (!V.ok || !V.objs) return;
  const dir = V.objs.dir, [th, ph, mode] = CAMS[name](dir);
  V.tth = th; V.tph = ph;
  if (mode === 'closed') V.target = 0;
  else if (name === 'top' && V.target < 1) V.target = 1;
  V.tr = fitDistance(mode === 'closed' || V.target < 1 ? S.set.w * 1.1 : S.set.w * 2); V.lastOpen = V.target >= 1;
  V.camTween = true; invalidate(); syncControls();
}

function bindOrbit(host) {
  const ptrs = new Map(); let moved = 0, pinch = 0, startX = 0, startY = 0;
  host.addEventListener('pointerdown', (e) => {
    host.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { moved = 0; startX = e.clientX; startY = e.clientY; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  host.addEventListener('pointermove', (e) => {
    const pt = ptrs.get(e.pointerId); if (!pt) return;
    const dx = e.clientX - pt.x, dy = e.clientY - pt.y; pt.x = e.clientX; pt.y = e.clientY;
    if (ptrs.size === 1) {
      moved += Math.abs(dx) + Math.abs(dy);
      V.th -= dx * 0.008; V.ph = Math.max(0.001, Math.min(Math.PI - 0.001, V.ph - dy * 0.008));
      V.tth = V.th; V.tph = V.ph; V.tr = V.r; V.camTween = false; invalidate();
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) { V.r = Math.max(60, Math.min(6000, V.r * pinch / d)); V.tr = V.r; V.camTween = false; invalidate(); }
      pinch = d; moved += 10;
    }
  });
  const up = (e) => {
    const wasSingle = ptrs.size === 1;
    ptrs.delete(e.pointerId);
    if (wasSingle && moved < 5 && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) clickTurn(e, host);
  };
  host.addEventListener('pointerup', up); host.addEventListener('pointercancel', (e) => ptrs.delete(e.pointerId));
  host.addEventListener('wheel', (e) => { e.preventDefault(); V.r = Math.max(60, Math.min(6000, V.r * Math.exp(e.deltaY * 0.0012))); V.tr = V.r; V.camTween = false; invalidate(); }, { passive: false });
}
function clickTurn(e, host) {
  if (!V.objs) return;
  const rect = host.getBoundingClientRect(), nx = ((e.clientX - rect.left) / rect.width) * 2 - 1, ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera({ x: nx, y: ny }, V.camera);
  const pt = new THREE.Vector3();
  if (!rc.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -S.set.c), pt)) return;
  const side = pt.x * V.objs.dir;
  if (Math.abs(pt.x) > S.set.w * 1.1 || Math.abs(pt.y) > S.set.h * 0.6) return;
  setSpread(Math.round(V.target) + (side >= 0 ? 1 : -1), true);
}

/* ---- spreads ---- */
function maxSpread() { return spreadCount(Math.max(NS(), 2)) - 1; }
function setSpread(s, scroll) {
  s = Math.max(0, Math.min(maxSpread(), Math.round(s)));
  V.target = s; markCurrent(s); syncControls();
  if (scroll) { const w = document.querySelector('.spread-wrap[data-s="' + s + '"]'); if (w && w.scrollIntoView) w.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  if (V.ok) {
    const open = s >= 1;
    if (open !== V.lastOpen) { V.lastOpen = open; V.tr = fitDistance(open ? S.set.w * 2 : S.set.w * 1.1); V.camTween = true; }
    invalidate();
  }
}
function goToKey(k) {
  const N = NS(); if (!N) return;
  if (k === 'B') { setCam('back'); markCurrent('back'); return; }
  if (k === 'S') { setCam('spine'); return; }
  setSpread(spreadOfKey(k, N), false);
  if (V.ok && V.tph > 1.5) { V.tth = -0.42 * (S.set.binding === 'R' ? -1 : 1); V.tph = 0.62; V.camTween = true; invalidate(); }
}
function syncControls() {
  const N = NS(), s = Math.round(V.target);
  const sl = $('spreadSlider'); sl.max = String(maxSpread()); sl.value = String(s);
  if (!N) { $('spreadLabel').textContent = '—'; return; }
  const k = spreadKeys(s, N, S.set.binding), part = [k.left, k.right].filter((x) => x !== null).map(keyLabel);
  $('spreadLabel').textContent = s + '／' + maxSpread() + '　' + part.join(' | ');
  $('btnPrev').disabled = s <= 0; $('btnNext').disabled = s >= maxSpread();
}

/* ---- loop ---- */
function tick(now) {
  V.raf = 0;
  if (!V.ok) return;
  const dt = Math.min(0.05, (now - V.last) / 1000); V.last = now;
  let busy = false;
  if (V.p !== V.target) {
    const diff = V.target - V.p, speed = Math.max(3.2, Math.min(14, Math.abs(diff) * 2.6));
    const stepv = speed * dt;
    V.p = Math.abs(diff) <= stepv ? V.target : V.p + Math.sign(diff) * stepv;
    busy = true;
  }
  if (V.camTween) {
    const k = 1 - Math.exp(-dt * 9);
    V.th += (V.tth - V.th) * k; V.ph += (V.tph - V.ph) * k; V.r += (V.tr - V.r) * k;
    if (Math.abs(V.tth - V.th) + Math.abs(V.tph - V.ph) < 0.002 && Math.abs(V.tr - V.r) < 0.5) { V.th = V.tth; V.ph = V.tph; V.r = V.tr; V.camTween = false; }
    else busy = true;
  }
  layout(); applyCamera();
  V.renderer.render(V.scene, V.camera);
  V.dirty = false;
  if (busy) { V.last = now; V.raf = requestAnimationFrame(tick); }
}
