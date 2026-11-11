// Gidiş yönü yukarı (course-up) testi: GPS yön süzgeci (js/nav/course.js), rotasız sürüş takip kararı (js/nav/freeDrive.js) ve
// harita/navigasyon bağlantıları (kaynak denetimi). Kullanım: node scripts/test-course-up.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCourseFilter, turnDelta, MIN_COURSE_KMH } from '../js/nav/course.js';
import { followDecision, zoomForSpeed, START_KMH, PARK_MS } from '../js/nav/freeDrive.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const near = (a, b, tol = 1) => a != null && Math.abs(turnDelta(a, b)) <= tol;

// --- Yön süzgeci ---
ok('kısa dönüş: 350→10 = +20', turnDelta(350, 10) === 20 && turnDelta(10, 350) === -20);
{
  const f = createCourseFilter();
  ok('ölçüm yokken yön yok (kuzeye kilitlenmez)', f.push({ heading: null, speedKmh: 50, acc: 5 }) === null);
  ok('düşük hızda ilk yön alınmaz', f.push({ heading: 90, speedKmh: MIN_COURSE_KMH - 1, acc: 5 }) === null);
  ok('ilk güvenilir yön doğrudan alınır', f.push({ heading: 90, speedKmh: 40, acc: 5 }) === 90);
  ok('duran araçta (hız 0) yön korunur', f.push({ heading: 270, speedKmh: 0, acc: 5 }) === 90);
  ok('hız bilinmiyorsa yön korunur', f.push({ heading: 200, speedKmh: null, acc: 5 }) === 90);
  ok('doğruluk kötüyse (80 m) yön korunur', f.push({ heading: 180, speedKmh: 60, acc: 80 }) === 90);
  ok('negatif (geçersiz) yön yok sayılır', f.push({ heading: -1, speedKmh: 60, acc: 5 }) === 90);
  const v = f.push({ heading: 110, speedKmh: 40, acc: 5 });
  ok('güvenilir ölçüm yumuşatılır (90 ile 110 arası)', v > 90 && v < 110);
}
{
  // Düşük hızda titreşim: 8-15 km/h, ±15° gürültü; çıkış sapması gürültüden belirgin küçük olmalı
  const f = createCourseFilter();
  f.push({ heading: 0, speedKmh: 30, acc: 5 });
  let maxDev = 0;
  for (let i = 0; i < 40; i++) {
    const noise = (i % 2 ? 1 : -1) * 15;
    const v = f.push({ heading: (360 + noise) % 360, speedKmh: 9 + (i % 5), acc: 10 });
    if (i > 3) maxDev = Math.max(maxDev, Math.abs(turnDelta(0, v)));
  }
  ok(`yavaşta ±15° titreşim bastırılır (en çok ${maxDev.toFixed(1)}°)`, maxDev < 10);
}
{
  // Yavaşken tek seferlik GPS sıçraması (180°) yönü çevirmez; iki ardışık ölçüm aynı yönde ise (U dönüşü) kabul edilir
  const f = createCourseFilter();
  f.push({ heading: 45, speedKmh: 20, acc: 5 });
  ok('yavaşta tek sıçrama yok sayılır', f.push({ heading: 225, speedKmh: 15, acc: 5 }) === 45);
  ok('sonraki ölçüm normalse yön yerinde', near(f.push({ heading: 45, speedKmh: 15, acc: 5 }), 45));
  f.push({ heading: 225, speedKmh: 12, acc: 5 });
  ok('iki ardışık ters ölçüm: U dönüşü kabul', f.push({ heading: 230, speedKmh: 12, acc: 5 }) === 230);
}
{
  // Kuzeyden geçen dönüş (350→10) kısa yoldan yumuşatılır, 180 üzerinden dönmez
  const f = createCourseFilter();
  f.push({ heading: 350, speedKmh: 60, acc: 5 });
  const v = f.push({ heading: 10, speedKmh: 60, acc: 5 });
  ok('350→10 kısa yoldan (sonuç 350..10 arası)', near(v, 0, 10.01));
  // Hızda yeni ölçüme daha çok güvenilir
  const slow = createCourseFilter(); slow.push({ heading: 0, speedKmh: 10, acc: 5 });
  const fast = createCourseFilter(); fast.push({ heading: 0, speedKmh: 90, acc: 5 });
  ok('yüksek hızda dönüş daha hızlı izlenir', fast.push({ heading: 60, speedKmh: 90, acc: 5 }) > slow.push({ heading: 60, speedKmh: 10, acc: 5 }));
  // Sürekli dönüş sonunda hedefe yakınsar
  const f2 = createCourseFilter(); f2.push({ heading: 0, speedKmh: 40, acc: 5 });
  let v2 = 0; for (let i = 0; i < 10; i++) v2 = f2.push({ heading: 90, speedKmh: 40, acc: 5 });
  ok('kararlı yöne yakınsar (90°)', near(v2, 90, 1));
}

// --- Rotasız sürüş takip kararı ---
const base = { navActive: false, live: true, speed: 50, blocked: false, on: false, stillMs: 0 };
ok('hareket eden araçta takip başlar', followDecision(base) === 'start');
ok(`yavaşta (<${START_KMH} km/h) takip başlamaz`, followDecision({ ...base, speed: START_KMH - 1 }) === 'idle');
ok('istasyon kartı açıkken takip başlamaz', followDecision({ ...base, blocked: true }) === 'idle');
ok('navigasyon açıkken takip etmez (navigator devralır)', followDecision({ ...base, navActive: true }) === 'idle' && followDecision({ ...base, navActive: true, on: true }) === 'stop');
ok('Test Modu/canlı GPS yokken takip etmez', followDecision({ ...base, live: false }) === 'idle');
ok('kırmızı ışıkta (kısa duruş) takip sürer', followDecision({ ...base, on: true, speed: 0, stillMs: 60_000 }) === 'keep');
ok('park edince takip biter', followDecision({ ...base, on: true, speed: 0, stillMs: PARK_MS }) === 'stop');
ok('hıza göre zoom', zoomForSpeed(20) === 17 && zoomForSpeed(60) === 16 && zoomForSpeed(110) === 15);

// --- Bağlantılar (kaynak denetimi) ---
const gps = read('js/sensors/gps.js');
const map = read('js/ui/mapView.js');
const nav = read('js/nav/navigator.js');
const fd = read('js/nav/freeDrive.js');
const app = read('js/app.js');
const sw = read('sw.js');
ok('gps.js yönü süzgeçten verir', /createCourseFilter\(\)/.test(gps) && /course\.push\(/.test(gps));
ok('pusula (deviceorientation) kullanılmaz', !/deviceorientation|webkitCompassHeading/.test(gps + map + nav + fd));
ok('rotasız takipte harita da ileri bakar (araç ekranın altında)', /\(navOn \|\| driveOn\) && headingUp/.test(map));
ok('rotasız takipte araç ok olarak çizilir', /navOn \|\| driveOn \? meArrow : meDot/.test(map));
ok('yön-yukarıda ok ekranın üstünü gösterir', /rotate\(\$\{headingUp \? 0 :/.test(map));
ok('dönüş yumuşatılır (follow ve kare kamera)', /delta \* 0\.6/.test(map) && /d \* 0\.14/.test(map));
ok('freeDrive yön ayarına uyar ve follow ile yön verir', /up \? e\.heading : null/.test(fd));
ok('navigasyonda rota yönü ya da GPS yönü kullanılır', /routeHeading \?\? /.test(nav));
ok('app.js freeDrive başlatır', /initFreeDrive\(\)/.test(app));
ok('sw.js yeni dosyaları önbelleğe alır', sw.includes("'./js/nav/freeDrive.js'") && sw.includes("'./js/nav/course.js'"));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
