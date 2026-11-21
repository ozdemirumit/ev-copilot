// Kamera önizlemesi yakınlaştırma + kaydırma (görünüm) testleri (bağımsız, düz node): node scripts/test-cam-view.mjs
// Kural: görünüm YALNIZ ekrandaki görüntüyü büyütür/kaydırır. OCR'ın okuduğu bölge (ROI, sahne oranları) ve roiToVideoRect eşlemesi değişmez;
// ROI kutusu görüntüyle birlikte hareket eder. Saf matematik + denetleyici (sahte sahne, sentetik işaretçi olayları) + kablolama.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

globalThis.document ??= { createElement: () => ({ getContext: () => null }) }; // preprocess.js modül düzeyinde tuval açar (test-camera-lifecycle ile aynı taklit)
const V = await import('../js/ui/camView.js');
const { roiToVideoRect } = await import('../js/sensors/preprocess.js');

// ---- A) saf matematik ----
ok('A sabitler: 1×–5×, kimlik görünümü dondurulmuş', V.Z_MIN === 1 && V.Z_MAX === 5 && Object.isFrozen(V.IDENTITY) && V.IDENTITY.z === 1 && V.IDENTITY.cx === 0.5 && V.IDENTITY.cy === 0.5);
ok('A clampView: z sınırlanır, merkez pencereyi çerçevede tutar', (() => {
  const a = V.clampView({ z: 99, cx: -3, cy: 9 }); const b = V.clampView({ z: 0.2, cx: 0.9, cy: 0.1 });
  return a.z === 5 && near(a.cx, 0.1) && near(a.cy, 0.9) && b.z === 1 && b.cx === 0.5 && b.cy === 0.5;
})());
ok('A clampView: bozuk girdi → kimlik', (() => { for (const x of [null, undefined, {}, { z: 'x', cx: NaN, cy: Infinity }, 5]) { const r = V.clampView(x); if (r.z !== 1 || r.cx !== 0.5 || r.cy !== 0.5) return false; } return true; })());
ok('A z=1: ekran = taban (kimlik eşlemesi), CSS dönüşümü yok', (() => { const p = V.toScreen(V.IDENTITY, 0.3, 0.8); return near(p.x, 0.3) && near(p.y, 0.8) && V.transformCss(V.IDENTITY) === 'none'; })());
ok('A toScreen ↔ toBase gidiş-dönüş', (() => { const v = V.clampView({ z: 3, cx: 0.4, cy: 0.6 }); const s = V.toScreen(v, 0.45, 0.55); const b = V.toBase(v, s.x, s.y); return near(b.x, 0.45) && near(b.y, 0.55); })());
ok('A zoomAt: odak noktasının altındaki görüntü noktası yerinde kalır', (() => {
  const v0 = V.clampView({ z: 2, cx: 0.45, cy: 0.55 });
  const fx = 0.7, fy = 0.3;
  const b = V.toBase(v0, fx, fy);
  const v1 = V.zoomAt(v0, 1.6, fx, fy);
  const s = V.toScreen(v1, b.x, b.y);
  return v1.z > v0.z && near(s.x, fx, 1e-9) && near(s.y, fy, 1e-9);
})());
ok('A zoomAt: 5×\'i aşmaz, 1×\'in altına inmez, 1×\'e dönünce merkezlenir', (() => {
  let v = V.IDENTITY; for (let i = 0; i < 20; i++) v = V.zoomAt(v, 1.5, 0.9, 0.9);
  const hi = v.z === 5;
  for (let i = 0; i < 30; i++) v = V.zoomAt(v, 0.7, 0.1, 0.1);
  return hi && v.z === 1 && v.cx === 0.5 && v.cy === 0.5;
})());
ok('A panBy: içerik parmakla birlikte kayar (sağa çek → görüntü sağa), kenarda durur', (() => {
  const v0 = V.clampView({ z: 2, cx: 0.5, cy: 0.5 });
  const v1 = V.panBy(v0, 0.2, 0); // parmak ekranın %20'si sağa
  const moved = V.toScreen(v1, 0.5, 0.5).x - V.toScreen(v0, 0.5, 0.5).x;
  const edge = V.panBy(v0, 5, -5); // aşırı çekiş
  return near(moved, 0.2, 1e-9) && near(edge.cx, 0.25) && near(edge.cy, 0.75);
})());
ok('A panBy: z=1\'de kaydırma yok (merkez sabit)', (() => { const v = V.panBy(V.IDENTITY, 0.4, -0.4); return v.cx === 0.5 && v.cy === 0.5; })());
ok('A pinch: iki parmak oranı z\'yi, orta nokta hareketi kaydırmayı verir; odak yerinde', (() => {
  const v0 = V.clampView({ z: 1.5, cx: 0.5, cy: 0.5 });
  const m0 = { x: 0.6, y: 0.4 }, m1 = { x: 0.6, y: 0.4 };
  const b = V.toBase(v0, m0.x, m0.y);
  const v1 = V.pinch(v0, 0.2, 0.4, m0, m1); // mesafe iki katına
  const s = V.toScreen(v1, b.x, b.y);
  return near(v1.z, 3) && near(s.x, m1.x, 1e-9) && near(s.y, m1.y, 1e-9);
})());
ok('A pinch: sıfır/negatif mesafe → görünüm değişmez', (() => { const v0 = V.clampView({ z: 2, cx: 0.4, cy: 0.6 }); const v = V.pinch(v0, 0, 0.3, { x: .5, y: .5 }, { x: .5, y: .5 }); return v.z === v0.z && v.cx === v0.cx; })());
ok('A transformCss: kaydırma/ölçek yüzdeleri tutarlı (sol-üst köken)', (() => {
  const v = V.clampView({ z: 2, cx: 0.5, cy: 0.5 });
  return V.transformCss(v) === 'translate(-50%, -50%) scale(2)';
})());
ok('A transformCss: sağ-alt köşeye kaydırılmış görünüm', (() => {
  const v = V.clampView({ z: 2, cx: 0.75, cy: 0.75 });
  return V.transformCss(v) === 'translate(-100%, -100%) scale(2)';
})());

// ---- B) ROI kutusu: ekran konumu + sürükleme dönüşümü ----
ok('B boxStyle z=1: ROI oranları aynen (yüzde)', (() => { const s = V.boxStyle(V.IDENTITY, { x: 0.2, y: 0.3, w: 0.4, h: 0.1 }); return s.left === '20%' && s.top === '30%' && s.width === '40%' && s.height === '10%'; })());
ok('B boxStyle: yakınlaşınca kutu görüntüyle birlikte büyür ve kayar', (() => {
  const v = V.clampView({ z: 2, cx: 0.5, cy: 0.5 });
  const roi = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
  const s = V.boxStyle(v, roi);
  const a = V.toScreen(v, roi.x, roi.y);
  return near(parseFloat(s.left), a.x * 100, 1e-6) && near(parseFloat(s.top), a.y * 100, 1e-6) && near(parseFloat(s.width), 40, 1e-6) && near(parseFloat(s.height), 40, 1e-6);
})());
ok('B ekran farkı → taban farkı (ROI sürükleme/boyutlandırma): bölü z', V.screenToBaseDelta(V.clampView({ z: 4, cx: .5, cy: .5 }), 0.2, -0.1).dx === 0.05 && V.screenToBaseDelta(V.clampView({ z: 4, cx: .5, cy: .5 }), 0.2, -0.1).dy === -0.025 && V.screenToBaseDelta(V.IDENTITY, 0.2, 0.1).dx === 0.2);

// ---- C) OCR eşlemesi görünümden bağımsız ----
{
  const video = { videoWidth: 1280, videoHeight: 720, dataset: {} };
  const stage = { clientWidth: 400, clientHeight: 250 };
  const roi = { x: 0.3, y: 0.4, w: 0.2, h: 0.15 };
  const before = JSON.stringify(roiToVideoRect(video, stage, roi));
  let v = V.IDENTITY; v = V.zoomAt(v, 3, 0.8, 0.2); v = V.panBy(v, 0.1, 0.1); V.boxStyle(v, roi); V.transformCss(v);
  ok('C roiToVideoRect görünüm işlemlerinden etkilenmez (aynı ROI → aynı kaynak kesiti)', JSON.stringify(roiToVideoRect(video, stage, roi)) === before);
  ok('C görünüm matematiği ROI nesnesini değiştirmez', JSON.stringify(roi) === JSON.stringify({ x: 0.3, y: 0.4, w: 0.2, h: 0.15 }));
  const src = read('js/sensors/preprocess.js');
  ok('C preprocess.js görünümü hiç bilmez (camView içe aktarılmaz)', !/camView/.test(src) && !/camView/.test(read('js/sensors/ocr.js')));
}

// ---- D) denetleyici (sahte sahne, sentetik işaretçi olayları) ----
function fakeStage() {
  const st = new EventTarget();
  st.rect = { left: 0, top: 0, width: 400, height: 250 };
  st.getBoundingClientRect = () => st.rect;
  st.closest = () => null;
  st.setPointerCapture = () => {};
  st.releasePointerCapture = () => {};
  st.style = {};
  st.classList = { toggle() {}, add() {}, remove() {} };
  return st;
}
const el = () => ({ style: {}, textContent: '', disabled: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {}, classList: { toggle() {} } });
const fire = (target, type, props = {}) => { const e = Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientX: 0, clientY: 0, button: 0, ...props }); target.dispatchEvent(e); return e; };
{
  const stage = fakeStage();
  const media = [el(), el()];
  const ui = { zoomIn: el(), zoomOut: el(), reset: el() };
  const c = V.attachCamView(stage, { media, ...ui });
  ok('D başlangıç: kimlik görünümü, medya dönüşümü yok', c.get().z === 1 && media.every((m) => m.style.transform === 'none' || m.style.transform === ''));
  let n = 0; const off = c.onChange(() => { n++; });
  ui.zoomIn.listeners.click();
  ok('D + düğmesi: yakınlaşır, medyaya dönüşüm uygulanır, dinleyici çağrılır', c.get().z > 1 && /scale\(/.test(media[0].style.transform) && media[0].style.transformOrigin === '0 0' && n === 1 && /×/.test(ui.reset.textContent));
  const zIn = c.get().z;
  ui.zoomOut.listeners.click();
  ok('D − düğmesi: uzaklaşır', c.get().z < zIn);
  for (let i = 0; i < 12; i++) ui.zoomIn.listeners.click();
  ok('D düğmelerle 5×\'te durur; + düğmesi pasif', c.get().z === 5 && ui.zoomIn.disabled === true);
  ui.reset.listeners.click();
  ok('D sıfırla: 1×, merkez; − ve sıfırla pasif', c.get().z === 1 && c.get().cx === 0.5 && ui.zoomOut.disabled === true && ui.zoomIn.disabled === false);

  // tek parmak kaydırma: z=1'de etkisiz, z>1'de görüntü parmakla kayar
  fire(stage, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 125 });
  fire(stage, 'pointermove', { pointerId: 1, clientX: 260, clientY: 125 });
  fire(stage, 'pointerup', { pointerId: 1, clientX: 260, clientY: 125 });
  ok('D z=1\'de tek parmak sürükleme görünümü değiştirmez', c.get().z === 1 && c.get().cx === 0.5);
  ui.zoomIn.listeners.click(); ui.zoomIn.listeners.click(); // ≈ 1.56×
  const z2 = c.get().z, cx0 = c.get().cx;
  fire(stage, 'pointerdown', { pointerId: 1, clientX: 200, clientY: 125 });
  fire(stage, 'pointermove', { pointerId: 1, clientX: 240, clientY: 125 }); // +%10 sağa
  fire(stage, 'pointerup', { pointerId: 1, clientX: 240, clientY: 125 });
  ok('D z>1: sağa çekince merkez sola gider (görüntü sağa kayar), z aynı', c.get().z === z2 && near(c.get().cx, Math.max(0.5 / z2, cx0 - 0.1 / z2), 1e-9) && c.get().cx < cx0);

  // iki parmak (pinch)
  ui.reset.listeners.click();
  fire(stage, 'pointerdown', { pointerId: 1, clientX: 150, clientY: 125 });
  fire(stage, 'pointerdown', { pointerId: 2, clientX: 250, clientY: 125 });
  fire(stage, 'pointermove', { pointerId: 1, clientX: 100, clientY: 125 });
  fire(stage, 'pointermove', { pointerId: 2, clientX: 300, clientY: 125 }); // mesafe 100 → 200: ≈ 2×
  ok('D iki parmak açılınca yakınlaşır (≈ 2×)', near(c.get().z, 2, 0.05));
  fire(stage, 'pointerup', { pointerId: 2 }); fire(stage, 'pointerup', { pointerId: 1 });
  const zp = c.get().z;
  fire(stage, 'pointermove', { pointerId: 1, clientX: 10, clientY: 10 });
  ok('D parmaklar kalkınca hareket olayı görünümü değiştirmez', c.get().z === zp);

  // tekerlek
  ui.reset.listeners.click();
  const w = fire(stage, 'wheel', { clientX: 300, clientY: 60, deltaY: -200 });
  ok('D tekerlek yukarı: yakınlaştırır ve sayfa kaydırmasını engeller', c.get().z > 1 && w.defaultPrevented === true);
  const wd = fire(stage, 'wheel', { clientX: 300, clientY: 60, deltaY: 4000 });
  ok('D tekerlek aşağı: 1×\'e kadar uzaklaşır', c.get().z === 1 && wd.defaultPrevented === true);

  // çift dokunuş / çift tık
  ui.reset.listeners.click();
  fire(stage, 'pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
  fire(stage, 'pointerup', { pointerId: 1, clientX: 100, clientY: 100 });
  fire(stage, 'pointerdown', { pointerId: 1, clientX: 102, clientY: 101 });
  fire(stage, 'pointerup', { pointerId: 1, clientX: 102, clientY: 101 });
  ok('D çift dokunuş: 1× iken 2×\'e yakınlaşır', c.get().z === 2);
  ui.reset.listeners.click();
  ok('D çift dokunuşta ikinci dokunuş uzaktaysa yakınlaşma yok', (() => {
    fire(stage, 'pointerdown', { pointerId: 1, clientX: 50, clientY: 50 }); fire(stage, 'pointerup', { pointerId: 1, clientX: 50, clientY: 50 });
    fire(stage, 'pointerdown', { pointerId: 1, clientX: 300, clientY: 200 }); fire(stage, 'pointerup', { pointerId: 1, clientX: 300, clientY: 200 });
    return c.get().z === 1;
  })());

  // ROI/düğme üzerinde başlayan sürükleme görüntüyü kaydırmaz (roiBox kendi işler)
  ui.zoomIn.listeners.click(); ui.zoomIn.listeners.click();
  const before = c.get();
  const onRoi = new EventTarget(); onRoi.closest = (s) => (/roi/.test(s) ? onRoi : null);
  const e1 = Object.assign(new Event('pointerdown', { bubbles: true }), { pointerId: 1, clientX: 100, clientY: 100, button: 0 });
  Object.defineProperty(e1, 'target', { value: onRoi });
  stage.dispatchEvent(e1);
  fire(stage, 'pointermove', { pointerId: 1, clientX: 180, clientY: 100 });
  ok('D ROI üzerinde başlayan sürükleme görüntüyü kaydırmaz', JSON.stringify(c.get()) === JSON.stringify(before));

  // reset + kapatma
  c.reset();
  ok('D reset(): 1× ve dinleyiciler haberdar', c.get().z === 1 && n >= 1);
  off();
  const n2 = n; ui.zoomIn.listeners.click();
  ok('D dinleyici kaldırılınca çağrılmaz', n === n2);
  c.reset();
}

// ---- E) kablolama ----
{
  const html = read('index.html'), css = read('css/styles.css'), sw = read('sw.js'), app = read('js/app.js'), box = read('js/ui/roiBox.js'), panel = read('js/ui/cameraPanel.js'), ver = read('version.js');
  ok('E index.html: yakınlaştırma düğmeleri sahnenin içinde', /id="cam-view-in"/.test(html) && /id="cam-view-out"/.test(html) && /id="cam-view-reset"/.test(html) && /class="cam-viewctl"/.test(html) && html.indexOf('id="cam-view-in"') > html.indexOf('id="cam-stage"') && html.indexOf('id="cam-view-in"') < html.indexOf('id="btn-cam"'));
  ok('E index.html: kısa kullanım notu (iki parmak / sürükle; okuma ayarı bozulmaz)', /[İi]ki parmak/.test(html) && /okuma/i.test(html.slice(html.indexOf('cam-view-hint'), html.indexOf('cam-view-hint') + 400)));
  ok('E CSS: .cam-viewctl konumlu, düğmeler ≥ 40 px, sol-üst köken', /\.cam-viewctl\b/.test(css) && /\.cam-viewctl button[^}]*min-width:\s*4\d?px|\.cam-viewctl button[^}]*width:\s*4\d?px/.test(css));
  ok('E sw.js kabuğunda camView.js', sw.includes("'./js/ui/camView.js'"));
  ok('E app.js: görünüm başlatılır', /camView\.js/.test(app) || /camView\.js/.test(box) || /camView\.js/.test(panel));
  ok('E roiBox.js: konum boxStyle ile, sürükleme screenToBaseDelta ile (taban koordinatlarda saklar)', /boxStyle\(/.test(box) && /screenToBaseDelta\(/.test(box) && /onView\(|getView\(/.test(box));
  ok('E cameraPanel.js: kamera açılıp kapanınca görünüm sıfırlanır', /resetView\(\)/.test(panel));
  ok('E sürüm 0.99.119', /self\.APP_VERSION = '0\.99\.119';/.test(ver) && /v: '0\.99\.119'/.test(ver));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
