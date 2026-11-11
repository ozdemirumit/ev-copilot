// Navigasyon takip kamerası testi (v0.99.33): araç görünür harita alanının alt kenarından ~%10 yukarıda (js/ui/navCamera.js),
// eğimli kamerada ileri uzaklık, elle kaydırmada takibin yalnızca Ortala ile dönmesi (kaynak denetimi). Kullanım: node scripts/test-nav-follow-cam.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { followAnchorPx, groundAheadPx } from '../js/ui/navCamera.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
// aracın ekrandaki y'si (haritanın üstünden)
const yOf = (o) => o.mapH / 2 + followAnchorPx(o);

// --- Yerleşim: görünür alanın üstten %90'ı ---
{
  const o = { mapH: 1000, top: 0, bottom: 0 };
  ok('örtü yok: araç alttan %10 (y=900)', near(yOf(o), 900));
  const p = { mapH: 800, top: 200, bottom: 0 };
  ok('üst panel 200 px: görünür alan 200-800, araç y=740 (alttan 60 = %10)', near(yOf(p), 740));
  const q = { mapH: 800, top: 200, bottom: 100 };
  ok('alt düğmeler 100 px: araç y=650 (görünür 200-700, alttan %10)', near(yOf(q), 650));
  ok('araç hiçbir zaman eski %72 öneriye (0.22 H) ya da %25-30 alt boşluğa dönmez', yOf(o) / o.mapH > 0.85);
}
// --- Ok örtülmez: küçük ekran / büyük alt örtü ---
for (const [mapH, top, bottom] of [[560, 150, 0], [640, 260, 60], [360, 120, 0], [700, 0, 300], [844, 230, 0], [932, 260, 0], [1024, 200, 0]]) {
  const y = yOf({ mapH, top, bottom });
  const visBot = mapH - bottom;
  ok(`H=${mapH} üst=${top} alt=${bottom}: ok (noktanın 15 px altına taşar) görünür alt kenarın 10 px üstünde kalır`, y + 15 + 10 <= visBot + 1e-9);
  ok(`H=${mapH} üst=${top} alt=${bottom}: araç merkezden yukarı çıkmaz, görünür alanın alt yarısında`, y >= mapH / 2 && y >= top + (visBot - top) / 2 - 1e-9);
}
ok('çok küçük görünür alan: merkezin üstüne çıkmaz (0)', followAnchorPx({ mapH: 400, top: 0, bottom: 380 }) === 0);
ok('geçersiz yükseklik: 0', followAnchorPx({ mapH: 0 }) === 0 && followAnchorPx({ mapH: NaN }) === 0);

// --- Eğim: ileri uzaklık ---
ok('eğim 0: zemin uzaklığı = ekran uzaklığı', near(groundAheadPx(400, 1000, 0), 400, 1e-6));
{
  const g = groundAheadPx(400, 1000, 40);
  ok('3B (40°): ileri uzaklık düz hesaptan büyük, kısaltmasız (1/cos) üst sınırdan küçük', g > 400 && g < 400 / Math.cos((40 * Math.PI) / 180));
}
ok('dy 0 → 0; eğim artınca uzaklık artar', groundAheadPx(0, 1000, 40) === 0 && groundAheadPx(300, 1000, 50) > groundAheadPx(300, 1000, 20));

// --- Bağlantılar (kaynak denetimi) ---
const map = read('js/ui/mapView.js');
const nav = read('js/nav/navigator.js');
ok('mapView navigasyonda followAnchorPx + groundAheadPx kullanır (follow ve kare kamera)', /followAnchorPx\(/.test(map) && /groundAheadPx\(/.test(map) && (map.match(/navAhead\(mpp\)/g) || []).length === 2);
ok('rotasız sürüş eski ~%22 ileri bakışı korur', /navOn \? navAhead\(mpp\) : mapEl\.clientHeight \* 0\.22 \* mpp/.test(map));
ok('örtü ölçümü: üst panel (hudtop), harita düğmeleri, istasyon kartı', /'hudtop'/.test(map) && /#mapui button, #station-card/.test(map));
ok('eğim navView kararından alınır', /tiltNow = cam\.tilt/.test(map));
ok('yalnızca kamera merkezi kayar: araç işareti gerçek konumda (setPosition({ lat, lon }))', /me\.setPosition\(\{ lat, lon \}\)/.test(map));
ok('navigasyonda kaydırma navPan kurar; takip süreyle dönmez', /onDragStart\(\(\) => \{[^}]*if \(navOn\) navPan = true;/.test(map) && /const held = \(\) => navPan \|\| /.test(map));
ok('follow ve kare kamera held() ile durur; dragged() = held()', /!force && held\(\)/.test(map) && /if \(held\(\)\) return;/.test(map) && /mapApi\.dragged = \(\) => held\(\)/.test(map));
ok('recenter ve navigasyon kapanışı navPan siler', /lastDrag = 0; navPan = false;/.test(map) && /if \(!on\) navPan = false;/.test(map));
ok('navigator: kaydırılmışken zoom değişimi zorlamaz, yeniden rota ortalamaz', /change && !mapApi\.dragged\(\)/.test(nav) && /if \(!mapApi\.dragged\?\.\(\)\) mapApi\.recenter\?\.\(\)/.test(nav));
ok('Ortala düğmesi recenter çağırır ve kaydırılmışken görünür', /nh-recenter'\)\.addEventListener\('click', \(\) => \{ mapApi\.recenter\(\);/.test(nav) && /nh-recenter'\)\.classList\.toggle\('hidden', !mapApi\.dragged\(\)\)/.test(nav));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
