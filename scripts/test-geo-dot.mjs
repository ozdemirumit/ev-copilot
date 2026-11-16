// Konum noktası tekilliği (v0.99.90): normal haritada tam BİR yeşil konum noktası, navigasyonda nokta yok (yalnız araç oku),
// navigasyon bitince tek nokta geri gelir. İki kök neden:
//  (1) "Konumum" başlangıç iğnesi (yeşil) yalnız setPoint anında gizleniyordu; GPS sonradan gelirse iğne + araç noktası = iki yeşil nokta.
//  (2) navView(false) içindeki updateMe() son kamera karesinden <500 ms sonra erken dönüyordu; ok noktaya dönmüyordu.
// Saf karar işlevleri + küçük işaret simülasyonu + mapView.js bağlantı (kaynak) denetimi. Ağ/DOM yok.
// Kullanım: node scripts/test-geo-dot.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as mv from '../js/ui/mapView.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const { startPinStep } = mv;
// Araç işareti biçimi mapView.updateMe'deki kuralın aynısı (aşağıda kaynakta da denetlenir): navOn || driveOn ? ok : nokta
const meMarkerKind = ({ navOn = false, driveOn = false } = {}) => (navOn || driveOn ? 'arrow' : 'dot');
ok('updateMe kuralı kaynakta (ok/nokta seçimi tek ifade)', /const content = navOn \|\| driveOn \? meArrow : meDot;/.test(readFileSync(join(root, 'js/ui/mapView.js'), 'utf8')));
ok('startPinStep dışa aktarılır', typeof startPinStep === 'function');

const car = { lat: 39.9, lon: 32.8 };
const konumum = { lat: 39.9, lon: 32.8, label: 'Konumum', auto: true };
const chosen = { lat: 41.0, lon: 29.0, label: 'Kadıköy' };

{
  ok('normal harita: nokta', meMarkerKind({ navOn: false, driveOn: false }) === 'dot');
  ok('navigasyon: ok (nokta değil)', meMarkerKind({ navOn: true, driveOn: false }) === 'arrow');
  ok('rotasız sürüş takibi: ok', meMarkerKind({ navOn: false, driveOn: true }) === 'arrow');
  ok('navigasyon + sürüş: ok', meMarkerKind({ navOn: true, driveOn: true }) === 'arrow');
  ok('girdi yok: nokta, hata atmaz', meMarkerKind() === 'dot');
}
if (typeof startPinStep === 'function') {
  ok('Konumum iğnesi var, araç konumu geldi: kaldır', startPinStep(true, konumum, car) === 'remove');
  ok('Konumum iğnesi yok, araç biliniyor: değişiklik yok', startPinStep(false, konumum, car) === null);
  ok('Konumum iğnesi yok, araç bilinmiyor: ekle (yer işareti kalır)', startPinStep(false, konumum, null) === 'add');
  ok('Konumum iğnesi var, araç bilinmiyor: değişiklik yok', startPinStep(true, konumum, null) === null);
  ok('seçilmiş başlangıç iğnesi araç varken korunur', startPinStep(true, chosen, car) === null);
  ok('seçilmiş başlangıç iğnesi yoksa eklenir', startPinStep(false, chosen, car) === 'add');
  ok('başlangıç yok, iğne var: kaldır', startPinStep(true, null, car) === 'remove');
  ok('başlangıç yok, iğne yok: değişiklik yok', startPinStep(false, null, car) === null);
}

// --- Senaryo simülasyonu: haritadaki yeşil konum noktası sayısı (araç noktası + Konumum iğnesi) ---
if (typeof startPinStep === 'function') {
  const map = { me: null, startPin: false, routeLine: false };
  const greenDots = () => (map.me === 'dot' ? 1 : 0) + (map.startPin && map.start === konumum ? 1 : 0);
  const sync = (navOn, vehicle) => {
    if (vehicle) map.me = meMarkerKind({ navOn, driveOn: false });
    const step = startPinStep(map.startPin, map.start, vehicle);
    if (step === 'add') map.startPin = true;
    if (step === 'remove') map.startPin = false;
  };
  // Açılış: GPS yokken varsayılan "Konumum" başlangıcı kayıtlı plandan gelir → iğne çizilir
  map.start = konumum; map.startPin = true;
  ok('S1 GPS yokken: tek yeşil nokta (Konumum iğnesi)', greenDots() === 1);
  sync(false, car); // GPS ilk konumu
  ok('S2 GPS gelince normal harita: tam bir yeşil nokta', greenDots() === 1 && map.me === 'dot' && !map.startPin);
  map.routeLine = true; sync(true, car); // navigasyon başladı
  ok('S3 navigasyonda: konum noktası yok, araç oku var, rota korunur', greenDots() === 0 && map.me === 'arrow' && map.routeLine);
  sync(false, car); // navigasyon durdu
  ok('S4 navigasyon bitince: tek yeşil nokta geri gelir', greenDots() === 1 && map.me === 'dot');
}

// --- Bağlantı (kaynak denetimi) ---
{
  const src = readFileSync(join(root, 'js/ui/mapView.js'), 'utf8');
  const body = (from, to) => { const i = src.indexOf(from); const j = src.indexOf(to, i + 1); return i < 0 || j < 0 ? '' : src.slice(i, j); };
  const upd = body('function updateMe()', 'subscribe([');
  ok('updateMe başlangıç iğnesini kare kamera beklemesinden ÖNCE uzlaştırır', /function updateMe\(\) \{\s*syncStartPin\(\);\s*if \(performance\.now\(\) - glideAt < 500\) return;/.test(upd));
  ok('başlangıç iğnesi konum değişince yeniden değerlendirilir (updateMe live/sim aboneliği; yeni dinleyici yok)', /subscribe\(\['live', 'sim'\], updateMe\)/.test(src) && !/subscribe\([^)]*syncStartPin/.test(src));
  ok('harita hazır olunca da başlangıç iğnesi uzlaştırılır (readyHooks updateMe)', /readyHooks\.push\(updateMe\)/.test(src));
  ok('syncStartPin startPinStep kullanır', /function syncStartPin\(\)[\s\S]{0,400}startPinStep\(/.test(src));
  const nv = body('mapApi.navView = ', 'mapApi.driveView');
  ok('navView(false) kare kamera beklemesini sıfırlar (ok → nokta hemen)', /if \(!on\) glideAt = 0;/.test(nv) && /if \(!on\) navPan = false;/.test(nv) && nv.indexOf('glideAt = 0') < nv.lastIndexOf('updateMe()'));
  ok('navView sonunda updateMe çağrılır', /updateMe\(\);\s*\};/.test(nv));
  ok('tek araç işareti: me yalnız bir kez oluşturulur (iki yerde ??= değil if (!me))', (src.match(/if \(!me\) me = marker\(/g) || []).length === 2 && !/\bme = marker\([^)]*\);\s*\n\s*me = marker/.test(src));
  ok('kare kamera (cam) aracı ok olarak çizer, nokta eklemez', /mapApi\.cam = [\s\S]{0,600}me\.setContent\(meArrow\)/.test(src));
}

console.log(`\ntest-geo-dot: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
