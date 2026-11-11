// Arka plan / ön plan (iPhone Chrome) sürüş ölçümü koruması testi: js/sensors/driveGuard.js çekirdeği, tüketim penceresinin
// kırılması ve yaşam döngüsü bağlantıları (kaynak denetimi). Kullanım: node scripts/test-drive-guard.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriveGuard, STEP_GAP_MS, STALE_FIX_MS, FRESH_SKEW_MS } from '../js/sensors/driveGuard.js';
import { createTracker } from '../js/physics/consumption.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const P0 = { lat: 41.0, lon: 29.0 };
const P1 = { lat: 41.0, lon: 29.0 + 0.012 }; // ~1 km doğu

// --- Normal sürüş: her saniye adım ve konum ---
{
  const g = createDriveGuard();
  let t = 1_000_000;
  g.fix({ ...P0, ts: t }, t);
  let sum = 0;
  for (let i = 0; i < 5; i++) { t += 1000; g.fix({ ...P0, ts: t }, t); const s = g.step(t); if (s.integrate) sum += s.dt; }
  ok('normal sürüşte her adım toplanır (5 sn)', Math.abs(sum - 5) < 1e-9);
}

// --- Arka plan: gizliyken toplanmaz, dönüşte eski konum yok sayılır, taze konumla sürer ---
{
  const g = createDriveGuard();
  let t = 2_000_000;
  g.fix({ ...P0, ts: t }, t); g.step(t);
  t += 1000; g.hide(t);
  const h = g.step(t);
  ok('gizlenince adım toplanmaz ve pencere kırılır (bir kez)', !h.integrate && h.dt === 0 && h.gap === true);
  ok('aynı boşlukta pencere ikinci kez kırılmaz', g.step(t + 500).gap === false);
  ok('gizliyken gelen konum taze değil', g.fix({ ...P1, ts: t + 600 }, t + 600).fresh === false);
  t += 120_000; // iOS'ta 2 dk askıda: zamanlayıcı yok
  g.show(t);
  const s1 = g.step(t + 1000);
  ok('dönüşte taze konum gelene dek toplanmaz (son hızla 2 dk yazılmaz)', !s1.integrate && s1.dt === 0);
  const old = g.fix({ ...P0, ts: t - 120_000 }, t + 1100); // önbellekten eski konum
  ok('dönüşteki eski zaman damgalı (önbellek) konum taze sayılmaz', old.fresh === false);
  ok('eski konumdan sonra da toplanmaz', g.step(t + 2000).integrate === false);
  ok('dönüşte pencere ikinci kez kırılmaz (boşluk zaten açık)', g.step(t + 2050).gap === false);
  const fr = g.fix({ ...P1, ts: t + 2100 }, t + 2100);
  ok('dönüşten yeni zaman damgalı konum taze, boşluğu kapatır', fr.fresh && fr.closed);
  ok('kuş uçuşu tahmini (~1 km) verilir', fr.catchup && fr.catchup.km > 0.9 && fr.catchup.km < 1.1 && fr.catchup.gapMs >= 120_000);
  const s2 = g.step(t + 3100);
  ok('boşluk kapandıktan sonra toplama sürer, boşluk süresi adıma yazılmaz', s2.integrate && s2.dt <= 1.01);
}

// --- Olay ile adım arasında kapanan boşluk: kırma bildirimi kaybolmaz ---
{
  const g = createDriveGuard();
  g.fix({ ...P0, ts: 0 }, 0); g.step(0);
  g.hide(500); g.show(30_000); // aradaki adımlar hiç çalışmadı (iOS askı)
  g.fix({ ...P1, ts: 30_100 }, 30_100);
  const s = g.step(31_000);
  ok('adım gelmeden kapanan boşlukta da pencere kırılır', s.gap === true && s.integrate);
}

// --- Damgasız/eski iki konum: ikinci konum taze sayılır (sonsuza dek beklenmez) ---
{
  const g = createDriveGuard();
  let t = 3_000_000;
  g.fix({ ...P0, ts: t }, t);
  g.hide(t + 1000); g.show(t + 60_000);
  ok('ilk eski konum yok sayılır', g.fix({ ...P0, ts: t }, t + 60_500).fresh === false);
  ok('ikinci konum taze sayılır', g.fix({ ...P0, ts: NaN }, t + 61_500).fresh === true);
  ok('sınırdaki damga (dönüşten FRESH_SKEW_MS önce) kabul', (() => { const h = createDriveGuard(); h.hide(0); h.show(10_000); return h.fix({ ...P0, ts: 10_000 - FRESH_SKEW_MS }, 10_100).fresh; })());
}

// --- Görünürken focus/pageshow tekrarı: ölçüm kesilmez ---
{
  const g = createDriveGuard();
  let t = 4_000_000;
  g.fix({ ...P0, ts: t }, t); g.step(t);
  g.show(t + 500); // görünürken gelen focus/pageshow
  t += 1000; g.fix({ ...P0, ts: t }, t);
  const s = g.step(t);
  ok('görünürken gelen focus/pageshow toplamayı durdurmaz', s.integrate && !s.gap);
}

// --- Zamanlayıcı durması (olay gelmeden askı) ---
{
  const g = createDriveGuard();
  let t = 5_000_000;
  g.fix({ ...P0, ts: t }, t); g.step(t);
  const s = g.step(t + STEP_GAP_MS + 1000);
  ok('adımlar arası uzun boşluk: toplanmaz, pencere kırılır', !s.integrate && s.gap);
  ok('saat geri giderse toplanmaz', (() => { const h = createDriveGuard(); h.step(10_000); return !h.step(9_000).integrate; })());
  const f = g.fix({ ...P1, ts: t + STEP_GAP_MS + 1500 }, t + STEP_GAP_MS + 1500);
  ok('taze konum boşluğu kapatır', f.fresh && f.closed);
}

// --- GPS susması: hareket halindeyse toplanmaz, duran araçta boşluk değil ---
{
  const g = createDriveGuard();
  let t = 6_000_000;
  g.fix({ ...P0, ts: t }, t);
  for (let i = 1; i <= 9; i++) g.step(t + i * 1000, { still: true });
  ok('duran araçta konum gelmemesi boşluk sayılmaz', g.step(t + 10_000, { still: true }).integrate === true);
  const s = g.step(t + 11_000, { still: false });
  ok(`hareketliyken ${STALE_FIX_MS / 1000} sn konum yok: toplanmaz, pencere kırılır`, !s.integrate && s.gap);
}

// --- Kuş uçuşu tahmini sıçramada verilmez ---
{
  const g = createDriveGuard();
  g.fix({ ...P0, ts: 0 }, 0);
  g.hide(1000); g.show(11_000);
  const far = g.fix({ lat: 42.0, lon: 29.0, ts: 11_000 }, 11_000); // 10 sn'de ~111 km
  ok('olanaksız hız (GPS sıçraması): tahmin yok', far.fresh && far.catchup === null);
}

// --- Tüketim penceresi boşlukta kırılır ---
{
  const tr = createTracker({ windowKm: 1, minDrop: 1, battery: 50 });
  tr.addSoc(80); tr.addDistance(2, 0.3); tr.addSoc(79);
  tr.gap();
  tr.addDistance(0.1, 0.02); tr.addSoc(70); // boşlukta düşen pil kısa yola bölünmemeli
  const st = tr.stats();
  ok('boşluktan sonra pil düşüşü kısa mesafeye bölünüp aşırı tüketim üretmez', !st || st.kwh100 == null || st.kwh100 < 100);
}

// --- Bağlantılar (kaynak denetimi) ---
{
  const dg = read('js/sensors/driveGuard.js');
  for (const ev of ['visibilitychange', 'pagehide', 'pageshow', 'focus', 'freeze', 'resume']) ok(`driveGuard ${ev} dinler`, dg.includes(`'${ev}'`));
  const gps = read('js/sensors/gps.js');
  ok('gps.js taze olmayan konumu hız/yön hesabına sokmaz', /if \(!g\.fresh\)[\s\S]{0,200}return;/.test(gps));
  for (const ev of ['visibilitychange', 'pageshow', 'focus']) ok(`gps.js dönüşte izlemeyi denetler (${ev})`, gps.includes(`'${ev}', onShown`));
  const re = read('js/physics/rangeEngine.js');
  ok('menzil motoru gerçek GPS adımını korumadan geçirir', re.includes("e.source === 'live'") && re.includes('guard.step(Date.now()'));
  ok('menzil motoru boşlukta pencereleri kırar', re.includes('tracker.gap()') && re.includes('breakWindow()'));
  const ocr = read('js/sensors/ocr.js');
  for (const ev of ['visibilitychange', 'pageshow', 'focus', 'pagehide']) ok(`OCR durumu ${ev} ile yeniden denetlenir`, ocr.includes(`'${ev}'`));
  const cam = read('js/sensors/camera.js');
  for (const ev of ['visibilitychange', 'pageshow', 'focus']) ok(`kamera izi ${ev} ile yeniden denetlenir`, cam.includes(`'${ev}'`));
  ok('app.js driveGuard başlatır', read('js/app.js').includes('initDriveGuard()'));
  ok('sw.js önbelleğinde driveGuard var', read('sw.js').includes('./js/sensors/driveGuard.js'));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
