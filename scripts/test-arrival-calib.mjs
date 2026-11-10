// Şarj durağına varış kalibrasyonu: istem koşulları (saf), kayıt ve bağlantılar (kaynak denetimi).
// Kullanım: node scripts/test-arrival-calib.mjs
import { readFileSync } from 'node:fs';
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const A = await import('../js/physics/arrivals.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// nearestWithin
const stations = [{ id: 'a', name: 'A', lat: 40.0, lon: 30.0 }, { id: 'b', name: 'B', lat: 40.001, lon: 30.0 }, { id: 'c', name: 'C', lat: 40.5, lon: 30.5 }];
ok('150 m içindeki en yakın istasyon', A.nearestWithin(stations, { lat: 40.0004, lon: 30.0 })?.id === 'a');
ok('daha yakın olan seçilir', A.nearestWithin(stations, { lat: 40.0009, lon: 30.0 })?.id === 'b');
ok('150 m dışında istasyon yok', A.nearestWithin(stations, { lat: 40.01, lon: 30.0 }) === null);
ok('konum ya da liste yoksa null', A.nearestWithin(stations, {}) === null && A.nearestWithin(null, { lat: 1, lon: 1 }) === null);

// shouldPrompt
const base = { station: stations[0], speed: 0, stoppedMs: 30_000, driven: 40, lastForStation: undefined, now: 1_000_000 };
ok('durak, duruyor, yol almış: sorulur', A.shouldPrompt(base));
ok('istasyon yoksa sorulmaz', !A.shouldPrompt({ ...base, station: null }));
ok('hareket halinde sorulmaz', !A.shouldPrompt({ ...base, speed: 20 }));
ok('GPS gürültüsü (5 km/s) durma sayılır', A.shouldPrompt({ ...base, speed: 5 }));
ok('yeni durmuşsa (kavşak) sorulmaz', !A.shouldPrompt({ ...base, stoppedMs: 5_000 }));
ok('yeterli yol alınmadıysa (evin yanı) sorulmaz', !A.shouldPrompt({ ...base, driven: 2 }));
ok('aynı durak için bekleme süresi içinde sorulmaz', !A.shouldPrompt({ ...base, lastForStation: base.now - 10 * 60e3 }));
ok('bekleme süresi geçince tekrar sorulur', A.shouldPrompt({ ...base, lastForStation: base.now - 2 * 60 * 60e3 }));
ok('hız bilinmiyorsa (null) duruyor sayılır', A.shouldPrompt({ ...base, speed: null }));

// addArrival
const r = A.addArrival({ station: 'Astor - Berceste 1', lat: 40.12346, lon: 30.54324, est: 27.4, actual: 24, plan: 27.2 });
ok('kayıt: tahmin, gerçek, fark (gerçek − tahmin)', r.est === 27 && r.actual === 24 && r.err === -3, JSON.stringify(r));
ok('plan farkı (gerçek − plan)', r.plan === 27 && r.planErr === -3);
ok('konum 4 basamak', r.lat === 40.1235 && r.lon === 30.5432);
ok('günlükte saklanır', A.arrivalLog().length === 1 && A.arrivalLog()[0].id === r.id);
const r2 = A.addArrival({ station: null, lat: null, lon: null, est: 50, actual: 55 });
ok('plan yoksa planErr null; gerçek tahminden yüksekse fark +', r2.plan === null && r2.planErr === null && r2.err === 5);
for (let i = 0; i < 210; i++) A.addArrival({ station: 'x', est: 50, actual: 50 });
ok('günlük en çok 200 kayıt', A.arrivalLog().length === 200);

// Bağlantılar
const html = read('index.html');
const ui = read('js/ui/arrivalCalib.js');
const dlg = html.slice(html.indexOf('<dialog id="arrival-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="arrival-dialog"')));
ok('istem penceresi: metin, plan, sayı kutusu, ±, Kaydet, Şimdi değil, kapat', ['arrival-text', 'arrival-plan', 'arrival-soc', 'arrival-plus', 'arrival-minus', 'arrival-save', 'arrival-skip', 'arrival-x'].every((id) => dlg.includes(`id="${id}"`)));
ok('geçmiş kartında varış kalibrasyonları listesi', html.includes('id="h-arrivals"'));
ok('kaydedince elle pil olarak girilir (tüketim öğrenmeye katılır)', /addArrival\(\{[^}]*\}\);\s*\n\s*setManual\(v\)/.test(ui));
ok('kamera canlı okuyorsa sorulmaz', /if \(isOnline\(\)\)/.test(ui));
ok('Test Modu\'nda sorulmaz', /getState\('sim'\)\.enabled/.test(ui));
ok('başka pencere açıkken bölünmez', /querySelector\('dialog\[open\]'\)/.test(ui));
ok('geç/kapat da bir sonraki istemi geciktirir (yol sayacı sıfırlanır)', /const finish = \(\) => \{[^}]*lastAt\.set\([^}]*lastOdo = odometerKm\(\)/s.test(ui));
ok('Esc ile kapatma da geçmek sayılır', /addEventListener\('cancel'/.test(ui));
ok('başlangıçta çağrılır', /initArrivalCalib\(\)/.test(read('js/app.js')) && /import \{ initArrivalCalib \}/.test(read('js/app.js')));
const sw = read('sw.js');
ok('çevrimdışı kabukta yeni dosyalar', sw.includes("'./js/physics/arrivals.js'") && sw.includes("'./js/ui/arrivalCalib.js'"));
const hp = read('js/ui/historyPanel.js');
ok('geçmiş paneli varışları çizer ve olayla yenilenir', /function paintArrivals\(\)/.test(hp) && /arrivals-changed/.test(hp) && /paintArrivals\(\);/.test(hp));
ok('history.js gidilen yolu verir', /export const odometerKm = \(\) => odo;/.test(read('js/physics/history.js')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
