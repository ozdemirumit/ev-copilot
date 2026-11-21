// Kamera önizlemesi yakınlaştırma + kaydırma (görünüm; v0.99.119). YALNIZ ekrandaki görüntüyü büyütür/kaydırır:
// OCR'ın okuduğu bölge (ROI, sahne oranları) ve sensors/preprocess.js roiToVideoRect eşlemesi DEĞİŞMEZ; okuma ayarı (kalibrasyon) korunur.
// ROI kutusu görüntüyle birlikte büyür/kayar (js/ui/roiBox.js konumu boxStyle ile çizer; sürüklemeyi screenToBaseDelta ile taban oranına çevirir).
// Görünüm kalıcı değildir (kamera açılıp kapanınca sıfırlanır). Çözünürlük artmaz: bu bir ekran büyüteçidir, optik/dijital okuma yakınlaştırması değildir.
//
// Matematik: görünüm { z, cx, cy } — z yakınlaştırma (1–5), (cx, cy) ekranda görünen pencerenin TABAN (sahne oranı) merkezi.
//   ekran = (taban − merkez)·z + 0,5 ; pencere sahnenin dışına taşmaz (merkez [0,5/z, 1−0,5/z] aralığında).
export const Z_MIN = 1;
export const Z_MAX = 5;
export const IDENTITY = Object.freeze({ z: 1, cx: 0.5, cy: 0.5 });
const STEP = 1.25; // + / − düğmesi çarpanı
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 30;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (x, d) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const r4 = (x) => +x.toFixed(4);
const pct = (x) => `${r4(x * 100)}%`;

/** Görünümü geçerli aralığa getirir (z 1–5; merkez pencereyi çerçevede tutar). Bozuk girdi → kimlik. */
export function clampView(v) {
  const z = clamp(num(v?.z, 1), Z_MIN, Z_MAX);
  const half = 0.5 / z;
  return { z, cx: clamp(num(v?.cx, 0.5), half, 1 - half), cy: clamp(num(v?.cy, 0.5), half, 1 - half) };
}

export const toScreen = (v, bx, by) => ({ x: (bx - v.cx) * v.z + 0.5, y: (by - v.cy) * v.z + 0.5 });
export const toBase = (v, sx, sy) => ({ x: (sx - 0.5) / v.z + v.cx, y: (sy - 0.5) / v.z + v.cy });

/** (fx, fy) ekran noktasının altındaki görüntü noktası yerinde kalacak biçimde factor kadar yakınlaştırır. */
export function zoomAt(v, factor, fx, fy) {
  const z = clamp(v.z * num(factor, 1), Z_MIN, Z_MAX);
  const b = toBase(v, fx, fy);
  return clampView({ z, cx: b.x - (fx - 0.5) / z, cy: b.y - (fy - 0.5) / z });
}

/** Ekranda (sahne oranı) dsx, dsy kadar çekme: içerik parmakla birlikte kayar. */
export function panBy(v, dsx, dsy) {
  return clampView({ z: v.z, cx: v.cx - num(dsx, 0) / v.z, cy: v.cy - num(dsy, 0) / v.z });
}

/** İki parmak: başlangıç görünümü v0, mesafe d0 → d1, orta nokta mid0 → mid1 (hepsi sahne oranı). Odak yerinde kalır. */
export function pinch(v0, d0, d1, mid0, mid1) {
  if (!(d0 > 0) || !(d1 > 0)) return v0;
  const z = clamp(v0.z * (d1 / d0), Z_MIN, Z_MAX);
  const b = toBase(v0, mid0.x, mid0.y);
  return clampView({ z, cx: b.x - (mid1.x - 0.5) / z, cy: b.y - (mid1.y - 0.5) / z });
}

/** Video/tuvale uygulanacak CSS (sol-üst köken: transformOrigin '0 0'). Kimlikte 'none'. */
export function transformCss(v) {
  if (v.z === 1) return 'none';
  return `translate(${pct(0.5 - v.cx * v.z)}, ${pct(0.5 - v.cy * v.z)}) scale(${r4(v.z)})`;
}

/** ROI'nin (taban oranı) ekrandaki konumu: yüzde olarak { left, top, width, height }. */
export function boxStyle(v, roi) {
  const s = toScreen(v, roi.x, roi.y);
  return { left: pct(s.x), top: pct(s.y), width: pct(roi.w * v.z), height: pct(roi.h * v.z) };
}

/** Ekrandaki sürükleme farkını (sahne oranı) taban oranına çevirir (ROI taşıma/boyutlandırma). */
export const screenToBaseDelta = (v, dsx, dsy) => ({ dx: dsx / v.z, dy: dsy / v.z });

/**
 * Sahneye dokunmatik/fare denetimi bağlar. media: dönüşüm uygulanacak elemanlar (video, yansıtma tuvali); zoomIn/zoomOut/reset: düğmeler.
 * Tek parmak/fare sürükleme (z>1) kaydırır; iki parmak yakınlaştırır; tekerlek imleç etrafında yakınlaştırır; çift dokunuş/tık 2× ↔ 1×.
 * ROI kutusu ve düğmeler üzerinde başlayan işaretçiler yok sayılır (roiBox.js kendi işler).
 */
export function attachCamView(stage, { media = [], zoomIn = null, zoomOut = null, reset = null } = {}) {
  let view = IDENTITY;
  const listeners = new Set();
  const pointers = new Map(); // id → { x, y } (client)
  let pinchStart = null;
  let lastTap = null;

  const frac = (cx, cy) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left) / (r.width || 1), y: (cy - r.top) / (r.height || 1) }; };
  const paint = () => {
    for (const m of media) { if (!m) continue; m.style.transformOrigin = '0 0'; m.style.transform = transformCss(view); }
    if (stage.style) stage.style.cursor = view.z > 1 ? 'grab' : '';
    if (zoomIn) zoomIn.disabled = view.z >= Z_MAX;
    if (zoomOut) zoomOut.disabled = view.z <= Z_MIN;
    if (reset) { reset.textContent = `${view.z.toFixed(1)}×`; reset.disabled = view.z <= Z_MIN; }
  };
  const set = (next) => {
    const v = clampView(next);
    if (v.z === view.z && v.cx === view.cx && v.cy === view.cy) return;
    view = v;
    paint();
    listeners.forEach((fn) => fn(view));
  };

  const blocked = (e) => !!e.target?.closest?.('.roi, .cam-viewctl');
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  stage.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || blocked(e)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
    try { stage.setPointerCapture?.(e.pointerId); } catch { /* yakalama desteklenmiyor: yok say */ }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const r = stage.getBoundingClientRect();
      pinchStart = { view, d: Math.hypot(a.x - b.x, a.y - b.y) / (r.width || 1), mid: frac((a.x + b.x) / 2, (a.y + b.y) / 2) };
      lastTap = null;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const r = stage.getBoundingClientRect();
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
    if (pointers.size >= 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const d1 = Math.hypot(a.x - b.x, a.y - b.y) / (r.width || 1);
      set(pinch(pinchStart.view, pinchStart.d, d1, pinchStart.mid, frac((a.x + b.x) / 2, (a.y + b.y) / 2)));
      return;
    }
    if (view.z > 1) set(panBy(view, (p.x - px) / (r.width || 1), (p.y - py) / (r.height || 1)));
  });

  const end = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    pinchStart = null;
    for (const q of pointers.values()) { q.x0 = q.x; q.y0 = q.y; q.moved = true; } // kalan parmak aniden atlamasın; tek dokunuş sayılmaz
    if (e.type !== 'pointerup' || p.moved) return;
    const t = now();
    if (lastTap && t - lastTap.t <= DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= DOUBLE_TAP_PX) {
      lastTap = null;
      const f = frac(p.x, p.y);
      set(view.z > 1 ? IDENTITY : zoomAt(view, 2, f.x, f.y));
    } else lastTap = { t, x: p.x, y: p.y };
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault(); // sayfa kaydırması/tarayıcı yakınlaştırması yerine görüntü yakınlaşır
    const f = frac(e.clientX, e.clientY);
    set(zoomAt(view, Math.exp(-num(e.deltaY, 0) * 0.0015), f.x, f.y));
  }, { passive: false });

  zoomIn?.addEventListener('click', () => set(zoomAt(view, STEP, 0.5, 0.5)));
  zoomOut?.addEventListener('click', () => set(zoomAt(view, 1 / STEP, 0.5, 0.5)));
  reset?.addEventListener('click', () => set(IDENTITY));
  paint();

  return {
    get: () => view,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    reset: () => { pointers.clear(); pinchStart = null; lastTap = null; set(IDENTITY); },
  };
}

// ---- Uygulama için paylaşılan tek görünüm (roiBox.js ve cameraPanel.js kullanır) ----
let shared = null;
const early = new Set(); // init'ten önce eklenen dinleyiciler

/** Sahneye (index.html #cam-stage) görünüm denetimini bağlar; bir kez çağrılır. */
export function initCamView() {
  if (shared) return shared;
  const $ = (id) => document.getElementById(id);
  const stage = $('cam-stage');
  if (!stage) return null;
  shared = attachCamView(stage, { media: [$('cam-video'), $('cam-mirror')], zoomIn: $('cam-view-in'), zoomOut: $('cam-view-out'), reset: $('cam-view-reset') });
  for (const fn of early) shared.onChange(fn);
  early.clear();
  return shared;
}
export const getView = () => (shared ? shared.get() : IDENTITY);
export function onView(fn) {
  if (shared) return shared.onChange(fn);
  early.add(fn);
  return () => early.delete(fn);
}
export const resetView = () => shared?.reset();
