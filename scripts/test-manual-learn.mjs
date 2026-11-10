// Kamerasız tüketim öğrenme: elle girilen pil de ölçüm penceresi sayılır (physics/history.js: manualStep / noteManualSoc).
// Kullanım: node scripts/test-manual-learn.mjs
import { readFileSync } from 'node:fs';
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const H = await import('../js/physics/history.js');
const { getState, patch } = await import('../js/state.js');
const { PHYSICS } = await import('../js/config.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// Sürüşü taklit et: km yol, kwh100 model tüketimi, v km/h
const drive = (km, { v = 100, model = 20 } = {}) => {
  const step = v / 3600;
  const n = Math.round(km / step);
  for (let i = 0; i < n; i++) H.feed({ dKm: step, dt: 1, moving: true, modelStepKwh: step * (model / 100), soc: null, temp: 10, headwind: 0, grade: 0 });
};
const before = () => H.records().length;

H.__test.reset();
patch('engine', { k: 1 });

// 1) İlk giriş yalnızca referans olur
H.__test.commit(90);
ok('ilk giriş kayıt üretmez, referans olur', before() === 0 && H.__test.anchor()?.soc === 90);

// 2) 60 km sonra pil 70: ölçülen 17,7 kWh, model 12 kWh → k ≈ 1,48
drive(60);
H.__test.commit(70);
const r = H.records().at(-1);
ok('geçerli pencere kayıt üretir', before() === 1 && r, JSON.stringify(r));
ok('kayıt ölçülen kWh/100 km: 20 puan × 88,5 ÷ 60 km', r && Math.abs(r.kwh100 - 29.5) < 0.2, String(r?.kwh100));
ok('kayıt k (ölçülen/model) ≈ 1,48', r && Math.abs(r.kBase - 1.475) < 0.03, String(r?.kBase));
ok('kayıt hız ve mesafe', r && Math.abs(r.dist - 60) < 0.5 && r.v === 100);
ok('yeni referans son giriş', H.__test.anchor()?.soc === 70);
const k1 = getState('engine').k;
ok('canlı k yumuşak karışımla yükselir (1 → ≈1,19)', Math.abs(k1 - (0.6 + 0.4 * (r.kBase / PHYSICS.consScale))) < 0.01, String(k1));
ok('kalibrasyon kalıcı (kCal)', stored.has('evcp.kCal') || [...stored.keys()].some((x) => x.endsWith('kCal')));
ok('geçmiş toplamı (overall) bu kaydı kullanır', H.overall()?.km >= 59);
ok('hız bandında görünür (90–110)', H.byBand().find((b) => b.label === '90–110')?.km >= 59);

// 3) Pil yükselirse (şarj/düzeltme) pencere geçersiz: referans yeni değer
const n1 = before();
drive(5);
H.__test.commit(95);
ok('pil yükselince kayıt yok, referans sıfırlanır', before() === n1 && H.__test.anchor()?.soc === 95);

// 4) Küçük düşüş (3 puan, 15 km): beklenir, referans korunur
drive(15);
H.__test.commit(92);
ok('küçük düşüşte beklenir (kayıt yok, referans 95)', before() === n1 && H.__test.anchor()?.soc === 95);

// 5) Yol almadan büyük atlama (elle düzeltme): referans yeni değer, kayıt yok
H.__test.commit(70);
ok('yol almadan 20+ puan atlama: referans sıfırlanır', before() === n1 && H.__test.anchor()?.soc === 70);

// 6) Çok kısa mesafe, küçük fark: referans korunur
drive(3);
H.__test.commit(69);
ok('3 km ve 1 puan: referans korunur', before() === n1 && H.__test.anchor()?.soc === 70);

// 7) Çok uzun aralık (araya şarj girmiş olabilir): geçersiz
drive(520, { v: 110 });
H.__test.commit(10);
ok('500 km üstü aralık geçersiz, referans sıfırlanır', before() === n1 && H.__test.anchor()?.soc === 10);

// 8) İmkânsız oran (k ≫ 2): reddedilir (20 km'de 50 puan = 44 kWh, model 4 kWh)
H.__test.reset();
H.__test.commit(90);
drive(20);
H.__test.commit(40);
ok('imkânsız k reddedilir, referans sıfırlanır', before() === n1 && H.__test.anchor()?.soc === 40);

// 9) Aşırı iyimser oran (k ≪ 0,5): reddedilir
H.__test.reset();
H.__test.commit(90);
drive(60);
H.__test.commit(88); // 2 puan: eşik altı, beklenir
ok('eşik altı düşüş beklenir', before() === n1 && H.__test.anchor()?.soc === 90);
H.__test.commit(85); // 5 puan / 60 km: ≈ 7,4 kWh/100 km → k ≈ 0,37
ok('k < 0,5 reddedilir, referans sıfırlanır', before() === n1 && H.__test.anchor()?.soc === 85);

// 10) Test Modu ölçüm değildir
H.__test.reset();
patch('sim', { enabled: true });
H.__test.commit(80);
ok('Test Modu: referans tutulmaz', H.__test.anchor() === null && before() === n1);
patch('sim', { enabled: false });

// 11) Sürgü sürüklenirken ara değerler sayılmaz: yalnızca bekleme sonrası son değer
H.__test.reset();
H.__test.commit(90);
drive(40);
H.noteManualSoc(97); H.noteManualSoc(94); H.noteManualSoc(80);
ok('sürükleme sırasında değerlendirme yok', before() === n1 && H.__test.anchor()?.soc === 90);
await new Promise((res) => setTimeout(res, 3300));
ok('bekleme sonrası yalnızca son değer (80) değerlendirilir', before() === n1 + 1 && H.__test.anchor()?.soc === 80 && H.records().at(-1).drop === 10, `${before()} ${H.__test.anchor()?.soc}`);

// Bağlantılar (kaynak denetimi)
const soc = read('js/physics/socEstimate.js');
ok('setManual tahmin (guess) değerini ölçüme katmaz', /export function setManual\(v, \{ guess = false \} = \{\}\)/.test(soc) && /if \(!guess\) noteManualSoc\(est\)/.test(soc));
ok('pil bilinmiyorken %80 varsayımı guess', /setManual\(80, \{ guess: true \}\)/.test(read('js/routing/controller.js')));
ok('öğrenilince bildirim', /consumption-learned/.test(read('js/ui/historyPanel.js')) && /consumption-learned/.test(read('js/physics/history.js')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
