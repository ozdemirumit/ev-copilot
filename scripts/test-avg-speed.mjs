// Ortalama hız testi: yol / sürüş süresi (örnek hız ortalaması değil), duruş ayrımı, GPS zaman damgası doğrulaması,
// arka plan/GPS boşlukları ve sıçramalar sayılmaz, sürüş oturumu park sonrası sıfırlanır, navigasyon oturumu başlatışta sıfırlanır.
// Kullanım: node scripts/test-avg-speed.mjs
import { readFileSync } from 'node:fs';
import { createTripAvg, setNavTrip, tripFix, navTrip, driveTrip, MIN_SHOW_MS, PARK_RESET_MS } from '../js/nav/avgSpeed.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const near = (a, b, tol) => a != null && Math.abs(a - b) <= tol;

// Kuzeye doğru düz yol: enlem derecesi ~111.195 km
const LAT0 = 41, LON0 = 29;
const KM_PER_DEG = 111.195;
const T0 = 1_700_000_000_000;
/** Sabit hızla sürüş: n saniye, her saniye bir konum. pos: { km, t } güncellenir. */
function drive(trip, pos, n, kmh, { speed = true, acc = 5 } = {}) {
  for (let i = 0; i < n; i++) {
    pos.t += 1000;
    pos.km += kmh / 3600;
    trip.fix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc, speedKmh: speed ? kmh : null }, pos.t + 200);
  }
}
function still(trip, pos, n, { jitterM = 3, speed = true } = {}) {
  for (let i = 0; i < n; i++) {
    pos.t += 1000;
    const j = (i % 2 ? 1 : -1) * jitterM / 1000; // duran araçta konum titrer
    trip.fix({ lat: LAT0 + (pos.km + j) / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 8, speedKmh: speed ? 0 : null }, pos.t + 200);
  }
}

// 1) Yol / süre: 60 km/s ile 2 dk, 120 km/s ile 2 dk → 6 km / 4 dk = 90 km/s (zaman ağırlıklı; örnek ortalaması da 90 olurdu)
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5, speedKmh: 0 }, pos.t + 200);
  drive(trip, pos, 120, 60);
  drive(trip, pos, 120, 120);
  const s = trip.snapshot();
  ok('mesafe/süre ortalaması 90 km/s', near(s.kmh, 90, 0.5), JSON.stringify(s));
  ok('yol ~6 km', near(s.km, 6, 0.02), s.km);
}

// 2) Mesafe ağırlığı: aynı YOLU 30 ve 90 km/s ile → harmonik ortalama 45 (örnek hızlarının ortalaması 60 olurdu)
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5, speedKmh: 0 }, pos.t + 200);
  drive(trip, pos, 360, 30); // 3 km
  drive(trip, pos, 120, 90); // 3 km
  ok('ortalama yol/süre: 45 km/s (aritmetik ortalama değil)', near(trip.snapshot().kmh, 45, 0.5), trip.snapshot().kmh);
}

// 3) Kısa duruş (kırmızı ışık) ortalamaya girer, uzun duruş (şarj, park) girmez; titreşim yola eklenmez (cihaz hızı yokken de)
for (const speed of [true, false]) {
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 120, 60, { speed });
  still(trip, pos, 90, { speed });
  drive(trip, pos, 120, 60, { speed });
  const s = trip.snapshot();
  const tag = `(cihaz hızı ${speed ? 'var' : 'yok'})`;
  ok(`1,5 dk kırmızı ışık beklemesi ortalamaya girer: 4 km / 5,5 dk ≈ 43,6 km/s ${tag}`, near(s.kmh, 4 / (330 / 3600), speed ? 1 : 2), JSON.stringify(s));
  ok(`yalnızca hareket süresine göre ayrıca ~60 km/s ${tag}`, near(s.movingKmh, 60, speed ? 1 : 1.5), s.movingKmh);
  ok(`bekleme süresi ~1,5 dk ${tag}`, near(s.waitMs, 90_000, speed ? 2000 : 8000), s.waitMs);
  ok(`titreşim yola eklenmez ${tag}`, near(s.km, 4, speed ? 0.02 : 0.04), s.km); // cihaz hızı yokken duruşa geçişte ~3 sn pencere gecikmesi
  ok(`tüm duruşlu genel ortalama de aynı (duruş kısa) ${tag}`, near(s.overallKmh, 4 / (330 / 3600), 2), s.overallKmh);
}
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 120, 60);
  still(trip, pos, 60);
  ok('şu an ışıkta beklerken ortalama düşer: 2 km / 3 dk ≈ 40 km/s', near(trip.snapshot().kmh, 40, 1), JSON.stringify(trip.snapshot()));
}
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 120, 60);
  still(trip, pos, 600); // 10 dk şarj/park molası
  drive(trip, pos, 120, 60);
  const s = trip.snapshot();
  ok('10 dk şarj/park molası ortalamaya girmez: 60 km/s kalır', near(s.kmh, 60, 1.5), JSON.stringify(s));
  ok('uzun duruş bekleme sayılmaz, ayrıca duruş olarak kaydedilir', s.waitMs === 0 && s.stoppedMs >= 590_000, JSON.stringify(s));
}

// 4) Yeterli veri yokken gösterilmez
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, Math.floor(MIN_SHOW_MS / 1000) - 5, 50);
  ok('1 dk sürüşten önce ortalama yok', trip.snapshot().kmh == null);
  drive(trip, pos, 10, 50);
  ok('1 dk sonra ortalama var', near(trip.snapshot().kmh, 50, 0.5));
}

// 5) Arka plan boşluğu: 5 dk konum yok, araç 5 km gitti → ne yol ne süre sayılır; ortalama bozulmaz
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 120, 60);
  pos.t += 300_000; pos.km += 5; // arka plan
  const r = trip.fix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 5, speedKmh: 60 }, pos.t + 200);
  ok('uzun boşluk "gap" olarak işaretlenir', r === 'gap', r);
  drive(trip, pos, 120, 60);
  const s = trip.snapshot();
  ok('boşluktaki yol sayılmaz', near(s.km, 4, 0.02), s.km);
  ok('boşluk süresi sürüş/duruşa yazılmaz', near(s.movingMs, 240_000, 1000) && s.stoppedMs === 0, JSON.stringify(s));
  ok('boşluk ayrıca kaydedilir', s.gaps === 1 && s.gapMs >= 300_000);
}

// 6) Dışarıdan bildirilen boşluk (driveGuard: arka plandan dönüş): kısa olsa da önceki konumla birleştirilmez
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 120, 60);
  const before = trip.snapshot().km;
  trip.gap();
  pos.t += 3000; pos.km += 1; // 3 sn'de 1 km olamaz ama sıçrama kuralına da gelmeden çapa yenilenir
  ok('gap sonrası ilk konum çapa olur', trip.fix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 5, speedKmh: 60 }, pos.t + 200) === 'start');
  ok('gap sonrası yol eklenmez', trip.snapshot().km === before);
}

// 7) Zaman damgası doğrulaması: eski (önbellek), yinelenen, geri giden, toplu teslim (GPS zamanı ile varış zamanı ayrışır)
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 70, 60);
  const k = trip.snapshot().km;
  ok('30 sn eski konum reddedilir', trip.fix({ lat: LAT0 + 0.01, lon: LON0, ts: pos.t - 30_000, acc: 5 }, pos.t + 1000) === 'reject');
  ok('aynı zaman damgası reddedilir', trip.fix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 900) === 'reject');
  ok('zaman damgası olmayan konum reddedilir', trip.fix({ lat: LAT0, lon: LON0, ts: NaN }, pos.t) === 'reject');
  ok('doğruluğu 80 m olan konum reddedilir', trip.fix({ lat: LAT0 + (pos.km + 0.017) / KM_PER_DEG, lon: LON0, ts: pos.t + 1000, acc: 80 }, pos.t + 1200) === 'reject');
  // Arka planda biriken konumlar dönüşte art arda gelir: GPS farkı 1 sn, varış farkı 6 sn → boşluk
  pos.t += 1000; pos.km += 60 / 3600;
  const r = trip.fix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 5, speedKmh: 60 }, pos.t + 200 + 6000);
  ok('GPS/varış zamanı ayrışınca boşluk', r === 'gap', r);
  ok('reddedilen ve boşluk konumları yol eklemez', trip.snapshot().km === k);
}

// 8) GPS sıçraması: tek aykırı konum reddedilir, iz sürer; art arda sıçramada çapa yenilenir (yol eklemeden)
{
  const trip = createTripAvg();
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 70, 60);
  const k = trip.snapshot().km;
  const r = trip.fix({ lat: LAT0 + (pos.km + 2) / KM_PER_DEG, lon: LON0, ts: pos.t + 1000, acc: 5, speedKmh: 60 }, pos.t + 1200);
  ok('2 km sıçrama reddedilir', r === 'reject', r);
  pos.t += 1000; // sıçramanın saniyesi geçti
  drive(trip, pos, 10, 60);
  ok('sıçrama yola eklenmez, iz sürer', near(trip.snapshot().km - k, (10 * 60) / 3600, 0.003), trip.snapshot().km - k);
  const k2 = trip.snapshot().km;
  trip.fix({ lat: LAT0 + 1, lon: LON0, ts: pos.t + 1000, acc: 5 }, pos.t + 1200);
  const r2 = trip.fix({ lat: LAT0 + 1.00001, lon: LON0, ts: pos.t + 2000, acc: 5 }, pos.t + 2200);
  ok('art arda sıçramada çapa yenilenir', r2 === 'gap', r2);
  ok('çapa yenilenirken yol eklenmez', trip.snapshot().km === k2);
}

// 9) Sürüş oturumu: 20 dk park → ortalama gizlenir, sonraki hareketle yeni sürüş başlar
{
  const trip = createTripAvg({ parkResetMs: PARK_RESET_MS });
  const pos = { km: 0, t: T0 };
  trip.fix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5 }, pos.t + 200);
  drive(trip, pos, 300, 100);
  ok('ilk sürüş ~100 km/s', near(trip.snapshot().kmh, 100, 0.5));
  still(trip, pos, PARK_RESET_MS / 1000 + 5);
  ok('parkta ortalama gizlenir', trip.snapshot().kmh == null && trip.snapshot().parked);
  drive(trip, pos, 120, 40);
  const s = trip.snapshot();
  ok('yeni sürüş sıfırdan: 40 km/s', near(s.kmh, 40, 0.5), JSON.stringify(s));
  ok('yeni sürüşte eski duruş yok', s.stoppedMs === 0);
  // Uzun konumsuzluk (uygulama arka planda saatlerce) da yeni sürüş
  pos.t += PARK_RESET_MS + 60_000; pos.km += 30;
  trip.fix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 5, speedKmh: 70 }, pos.t + 200);
  drive(trip, pos, 120, 70);
  ok('uzun boşluk sonrası yeni sürüş: 70 km/s', near(trip.snapshot().kmh, 70, 0.5), trip.snapshot().kmh);
  // Kısa duruş (kırmızı ışık) oturumu sıfırlamaz
  still(trip, pos, 90);
  drive(trip, pos, 60, 40);
  ok('kısa duruş oturumu sıfırlamaz', near(trip.snapshot().km, (120 * 70 + 60 * 40) / 3600, 0.02), trip.snapshot().km);
}

// 10) Navigasyon oturumu: yalnızca açıkken sayar, başlatışta sıfırlanır, kapanınca donar; sürüş oturumu kesintisiz
{
  const pos = { km: 0, t: Date.now() - 3600_000 };
  const feed = (n, kmh) => { for (let i = 0; i < n; i++) { pos.t += 1000; pos.km += kmh / 3600; tripFix({ lat: LAT0 + pos.km / KM_PER_DEG, lon: LON0, ts: pos.t, acc: 5, speedKmh: kmh }, pos.t + 200); } };
  tripFix({ lat: LAT0, lon: LON0, ts: pos.t, acc: 5, speedKmh: 0 }, pos.t + 200);
  feed(120, 50);
  ok('navigasyon kapalıyken nav sayacı boş', navTrip.snapshot().km === 0);
  setNavTrip(true, pos.t);
  feed(120, 80);
  ok('navigasyon ortalaması başlangıçtan beri: 80', near(navTrip.snapshot().kmh, 80, 0.5), navTrip.snapshot().kmh);
  ok('sürüş ortalaması tüm sürüş: 65', near(driveTrip.snapshot().kmh, 65, 0.5), driveTrip.snapshot().kmh);
  setNavTrip(true, pos.t); // aynı navigasyonda yeniden çağrı (ör. yeniden rota) sıfırlamaz
  ok('açıkken yeniden bildirim sıfırlamaz', near(navTrip.snapshot().kmh, 80, 0.5));
  setNavTrip(false);
  feed(120, 20);
  ok('kapanınca nav sayacı donar', near(navTrip.snapshot().kmh, 80, 0.5));
  setNavTrip(true, pos.t);
  ok('yeniden başlatınca sıfırlanır', navTrip.snapshot().km === 0 && navTrip.snapshot().kmh == null);
  feed(5, 30);
  tripFix({ lat: LAT0 + (pos.km + 0.1) / KM_PER_DEG, lon: LON0, ts: pos.t + 1500, acc: 5, speedKmh: 30 }, pos.t + 1700, { gap: true });
  ok('driveGuard boşluğu iki oturuma da iletilir', near(navTrip.snapshot().km, 4 * 30 / 3600, 0.002), navTrip.snapshot().km);
}

// 11) Yapı: panel öğeleri, gps.js beslemesi, SW önbelleği, i18n
{
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  ok('rotasız panelde ortalama hız öğesi (başta gizli)', /id="socbar-avg"[^>]*/.test(html) && /class="socbar-avg hidden"/.test(html));
  ok('navigasyon şeridinde ortalama hız hücresi', html.includes('id="nh-avg"') && html.includes('id="nh-avg-v"'));
  const gps = readFileSync(new URL('../js/sensors/gps.js', import.meta.url), 'utf8');
  ok('gps.js taze konumları GPS zaman damgasıyla besler', /tripFix\(\{[^}]*ts: pos\.timestamp/.test(gps) && gps.indexOf('tripFix(') > gps.indexOf('if (!g.fresh)'));
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok('SW önbelleğinde yeni dosyalar', sw.includes('./js/nav/avgSpeed.js') && sw.includes('./js/ui/avgSpeedView.js'));
  const keys = JSON.parse(readFileSync(new URL('../i18n/keys.extra.json', import.meta.url), 'utf8'));
  ok('i18n anahtarları', keys.includes('Ortalama hız') && keys.includes('Ortalama hız: {0} km yol, {1} dk sürüş, {2} dk duruş'));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
