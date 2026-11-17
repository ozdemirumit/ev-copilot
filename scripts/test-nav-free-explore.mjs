// Navigasyonda serbest gezinme (v0.99.101): pinch/tekerlek/çift dokunma/döndürme/eğme dahil her kullanıcı hareketi yalnızca kamera
// takibini durdurur (yalnızca Ortala/konum düğmesi geri getirir); Ortala navigasyon zoom'unu, yönünü ve eğimini zorla geri kurar.
// Programatik kamera hareketleri (jumpTo/easeTo) takibi durdurmaz. Kullanım: node scripts/test-nav-free-explore.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDomUserGesture, isEngineUserGesture, watchMapGestures, bindEngineGestures, DOM_GESTURE_EVENTS } from '../js/ui/mapGesture.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

// --- DOM hareket sınıflandırması (tüm sağlayıcılar: MapLibre/Mapbox/TomTom/Google) ---
ok('iki parmak dokunuş (pinch başlangıcı) kullanıcı hareketidir', isDomUserGesture('touchstart', { touches: { length: 2 } }));
ok('tek parmak dokunuş (dokunma/tıklama) hareket sayılmaz: sürükleme dragstart ile gelir', !isDomUserGesture('touchstart', { touches: { length: 1 } }));
ok('touches yoksa hareket sayılmaz', !isDomUserGesture('touchstart', {}) && !isDomUserGesture('touchstart', null));
ok('fare tekerleği / dokunmatik yüzey zoom kullanıcı hareketidir', isDomUserGesture('wheel', {}));
ok('iOS Safari gesturestart kullanıcı hareketidir', isDomUserGesture('gesturestart', {}));
ok('çift tıklama zoom kullanıcı hareketidir', isDomUserGesture('dblclick', {}));
ok('ilgisiz olaylar hareket değildir (click, touchend, mousemove)', !isDomUserGesture('click', {}) && !isDomUserGesture('touchend', { touches: { length: 2 } }) && !isDomUserGesture('mousemove', {}));
ok('izlenen DOM olayları: touchstart, wheel, gesturestart, dblclick', ['touchstart', 'wheel', 'gesturestart', 'dblclick'].every((t) => DOM_GESTURE_EVENTS.includes(t)));

// --- Harita motoru olayları: yalnız kullanıcı kaynaklı (originalEvent) ---
ok('dragstart her zaman kullanıcı sürüklemesidir', isEngineUserGesture('dragstart', {}));
for (const t of ['zoomstart', 'rotatestart', 'pitchstart']) {
  ok(`${t} originalEvent ile (pinch/çift dokunma/döndürme) kullanıcı hareketidir`, isEngineUserGesture(t, { originalEvent: { type: 'touchmove' } }));
  ok(`${t} originalEvent olmadan (programatik jumpTo/easeTo) hareket DEĞİLDİR`, !isEngineUserGesture(t, {}) && !isEngineUserGesture(t, undefined));
}
ok('movestart (her harekette, programatik dahil) izlenmez', !isEngineUserGesture('movestart', { originalEvent: {} }));

// --- watchMapGestures: gerçek EventTarget üzerinde ---
{
  const el = new EventTarget();
  const seen = [];
  const off = watchMapGestures(el, (t) => seen.push(t));
  const fire = (type, extra = {}) => { const e = new Event(type); Object.assign(e, extra); el.dispatchEvent(e); };
  fire('touchstart', { touches: { length: 1 } });
  ok('tek parmak: geri çağrı yok', seen.length === 0);
  fire('touchstart', { touches: { length: 2 } });
  fire('wheel');
  fire('gesturestart');
  fire('dblclick');
  fire('click');
  ok('pinch/tekerlek/gesturestart/dblclick geri çağırır, click çağırmaz', JSON.stringify(seen) === JSON.stringify(['touchstart', 'wheel', 'gesturestart', 'dblclick']));
  off();
  fire('wheel');
  ok('kaldırınca dinleme biter', seen.length === 4);
}
{ // dinleyiciler pasif + yakalama (harita kaydırmasını engellemez, iç öğeler olayı yutsa da yakalanır)
  const opts = [];
  const el = { addEventListener: (t, fn, o) => opts.push(o), removeEventListener() {} };
  watchMapGestures(el, () => {});
  ok('DOM dinleyicileri passive:true, capture:true', opts.length === DOM_GESTURE_EVENTS.length && opts.every((o) => o && o.passive === true && o.capture === true));
  ok('element yoksa hata yok', typeof watchMapGestures(null, () => {}) === 'function');
}

// --- bindEngineGestures: sahte MapLibre/Mapbox olay yayıcısı ---
{
  const handlers = {};
  const fakeMap = { on: (t, fn) => { (handlers[t] ||= []).push(fn); } };
  const seen = [];
  bindEngineGestures(fakeMap, (e) => seen.push(e));
  const emit = (t, e) => (handlers[t] || []).forEach((fn) => fn(e));
  emit('zoomstart', {}); // programatik (navigasyon kamerasının jumpTo'su)
  emit('rotatestart', {});
  emit('pitchstart', {});
  ok('programatik zoom/döndürme/eğme takibi durdurmaz', seen.length === 0);
  emit('dragstart', {});
  emit('zoomstart', { originalEvent: { type: 'touchmove' } });
  emit('rotatestart', { originalEvent: { type: 'touchmove' } });
  emit('pitchstart', { originalEvent: { type: 'touchmove' } });
  ok('kullanıcı sürükleme/pinch/döndürme/eğme takibi durdurur (4 olay)', seen.length === 4);
}

// --- Bağlantılar (kaynak denetimi) ---
const map = read('js/ui/mapView.js');
const nav = read('js/nav/navigator.js');
const engine = read('js/ui/maps/mapEngine.js');
const google = read('js/ui/maps/google.js');
const shell = read('js/ui/shell.js');
ok('MapLibre/Mapbox/TomTom bağdaştırıcısı onDragStart ile motor hareketlerini bağlar', /onDragStart: \(fn\) => bindEngineGestures\(map, fn\)/.test(engine));
ok('Google bağdaştırıcısı dragstart yanında çift tıklama/dokunma zoom\'unu da bildirir', /onDragStart: \(fn\) => \{[^}]*'dragstart'[^}]*'dblclick'/.test(google));
ok('mapView harita kabında DOM hareketlerini izler ve navigasyonda navPan kurar', /watchMapGestures\(mapEl, \(\) => \{[^}]*if \(navOn\) navPan = true;/.test(map));
ok('hareket olunca keşif kancaları (Ortala düğmesi) hemen çalışır', (map.match(/exploreHooks\.forEach\(\(fn\) => fn\(\)\)/g) || []).length === 2 && /mapApi\.onExplore = /.test(map));
ok('kare kamera ve follow held() iken haritayı değiştirmez (elle zoom korunur)', /if \(held\(\)\) return;/.test(map) && /!force && held\(\)/.test(map));
ok('navigator: hareket olunca Ortala düğmesi hemen görünür', /mapApi\.onExplore\?\.\(/.test(nav) && /nh-recenter'\)\.classList\.remove\('hidden'\)/.test(nav));
ok('navigator: Ortala bir sonraki takipte navigasyon zoom\'unu zorla geri kurar (araç durmuşken de)', /restoreView \? zoomNow : null|change \|\| restore \? zoomNow : null/.test(nav) && /\|\| restore,/.test(nav));
ok('navigator: geri kurma bayrağı yalnızca Ortala anındaki tick içinde geçerli (eski bayrak sonraki harekete taşınmaz)', /restoreView = true;\s*try \{ tick\(\); \} finally \{ restoreView = false; \}/.test(nav));
ok('navigator: Ortala sonrası düğme tick\'ten bağımsız hemen gizlenir', /finally \{ restoreView = false; \}\s*\$\('nh-recenter'\)\.classList\.toggle\('hidden', !mapApi\.dragged\(\)\);/.test(nav));
ok('navigator: Ortala düğmesi recenter + geri kurma', /nh-recenter'\)\.addEventListener\('click', \(\) => \{ mapApi\.recenter\(\); restoreFollow\(\); \}\)/.test(nav));
ok('navigator: recenterNav dışa açık; konum düğmesi navigasyonda onu kullanır (tahmini doğruluk zoom\'u değil)', /export function recenterNav\(\)/.test(nav) && /getState\('nav'\)\.active\) \{ recenterNav\(\); return true; \}/.test(shell));
ok('navigasyon durdurma akışı değişmedi (dragged okunur, navView(false), stopRecenter)', /const panned = !!mapApi\.dragged\?\.\(\);/.test(nav) && /mapApi\.navView\(false\);/.test(nav) && /stopRecenter\(\{ source: e\.source/.test(nav));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
