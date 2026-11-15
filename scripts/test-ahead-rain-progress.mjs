// Yol önü YAĞIŞ uyarısı kalan mesafesi, ahead.js üzerinden uçtan uca: node scripts/test-ahead-rain-progress.mjs
// v0.99.56 (99e8d77) "~3 km sonra" metninin donma hatasını düzeltti; saf hesap test-ahead-events.mjs'de, trafik uçtan uca
// test-traffic-guard.mjs'de sınanıyor. Bu dosya eksik kalan yolu sınar: refreshRain → anchorRain → check()/paintEvents geri sayımı,
// istek sürerken konum ilerlemesi, rota dışı, ve 10 dk'lık yağış yenilemesinde D1 davranışı (GAP-1/2/3, v0.99.77 düzeltmesi).
// ahead.js'in içe aktardığı her şey (saf aheadEvents.js/trafficGuard.js hariç) bellek içi sahtedir. Ağ engellidir; anahtar/sır yoktur.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

const H = (globalThis.__ar = { state: null, wx: [], traffic: 0, speak: [], interval: null });
const STUBS = {
  '../state.js': `const H = globalThis.__ar;
    export const getState = (k) => H.state[k];
    export const patch = (k, v) => { H.state[k] = { ...H.state[k], ...v }; };
    export const subscribe = () => {};
    export const effective = () => H.state.eff;`,
  '../utils/storage.js': 'export const save = () => {}; export const load = () => null;',
  '../providers/index.js': `const H = globalThis.__ar;
    export const fetchWeather = (pts) => new Promise((res, rej) => H.wx.push({ pts, res, rej }));
    export const fetchTrafficAhead = () => { H.traffic++; return new Promise(() => {}); };`,
  // Çağrı anı (sahte saat) diziye .t olarak eklenir; voice.js'in anahtar+bekleme kapısı aşağıda (GAP-3) bununla taklit edilir
  '../advisor/voice.js': 'export const speak = (...a) => globalThis.__ar.speak.push(Object.assign(a, { t: Date.now() }));',
  './speedLimit.js': 'export const currentLimit = () => null;',
  '../routing/controller.js': 'export const updateAhead = () => {};',
  '../routing/aheadUpdate.js': 'export const wxQueryKms = () => [];',
  '../ui/mapView.js': 'export const mapApi = { setTraffic: () => {} };',
  './track.js': 'export const buildTrack = (c) => c; export const locate = () => ({ offKm: 0 });',
  '../net/activeMap.js': "export const activeMap = () => 'osm';",
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/nav/ahead.js') && spec in STUBS) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});
const asrc = readFileSync(new URL('../js/nav/ahead.js', import.meta.url), 'utf8');
const unstubbed = [...asrc.matchAll(/from '(\.\.?\/[^']+)'/g)].map((m) => m[1]).filter((s) => !(s in STUBS) && s !== './trafficGuard.js' && s !== './aheadEvents.js');
ok('ahead.js içe aktarmalarının tamamı sahte (saf trafficGuard/aheadEvents hariç)', unstubbed.length === 0, unstubbed.join(', '));
// Mevcut sabitler (değişirse bu testteki senaryo varsayımları da gözden geçirilmeli)
ok('statik: WX_AHEAD_KM ilk örnek 10 km', /const WX_AHEAD_KM = \[10, 25, 50,/.test(asrc));
ok('statik: yağış yenilemesi 10 dk', /const WEATHER_EVERY_MS = 10 \* 60e3;/.test(asrc));
ok('statik: paintEvents check() içinde, yenilemelerden önce', /paintEvents\(\);[\s\S]*refreshRain\(km\)/.test(asrc.slice(asrc.indexOf('function check()'))));

const el = () => ({ value: 0, textContent: '', classList: { toggle() {} }, replaceChildren() {}, addEventListener() {} });
globalThis.document = { getElementById: () => el(), createElement: () => ({}) };
globalThis.setInterval = (fn) => { H.interval = fn; return 1; };
let clock = 1_700_000_000_000;
Date.now = () => clock;

const A = await import('../js/nav/ahead.js');
H.state = { nav: { speedAlert: 0, ahead: {} } };
A.initAhead();
const check = H.interval;
ok('initAhead check() zamanlayıcısını kurar', typeof check === 'function');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
let pid = 0;
function freshPlan(km = 10) {
  H.state = {
    eff: { lat: 40, lon: 28, speed: 25 },
    nav: { active: true, speedAlert: 0, ahead: { rain: null, traffic: null, speed: null, grade: null, cam: null }, liveRemain: null },
    plan: { planId: 'r' + ++pid, profile: { totalKm: 300, pointAt: (k) => ({ lat: 40 + k / 1000, lon: 28 }), timeBetween: () => 0 }, route: null },
    engine: { routeKm: km, offRouteKm: 0 },
    route: { end: null }, // trafik isteği yok: yalnızca yağış yolu
  };
  H.wx = []; H.speak = [];
}
const rain = () => H.state.nav.ahead.rain;
const kmOf = (t) => (t && /~(\d+) km sonra/.exec(t) ? Number(/~(\d+) km sonra/.exec(t)[1]) : null);
const at = (km, { off = 0, dtMs = 5000 } = {}) => { H.state.engine = { routeKm: km, offRouteKm: off }; clock += dtMs; check(); return rain(); };
/** Yağış yanıtı: örnek noktalarının km'si (plan rotasında) yağışlı kümede ise 1,2 mm/sa. */
const answer = (req, wetKm) => req.res(req.pts.map((p) => {
  const k = Math.round((p.lat - 40) * 1000);
  return { rain: wetKm(k) ? 1.2 : 0, temp: 9 };
}));

// ---------------------------------------------------------------- 1) Temel geri sayım: 20. km'deki yağış, 10. km'den
{
  freshPlan(10);
  clock += 11 * 60e3;
  check(); // yeni plan → wxAt=0 → refreshRain(10)
  ok('yeni planda tek yağış isteği', H.wx.length === 1 && H.wx[0].pts.length === 7 && H.wx[0].pts[0].d === 10);
  answer(H.wx[0], (k) => k === 20);
  await flush();
  ok('ilk metin ~10 km sonra', kmOf(rain()) === 10, rain());
  ok('ilk sesli uyarı bir kez', H.speak.length === 1 && /10 kilometre sonra yağmur/.test(H.speak[0][0]));
  const seq = [12, 14, 15.5, 17, 18, 18.6].map((k) => kmOf(at(k)));
  ok('ilerledikçe kalan mesafe azalır: 8, 6, 5→(4.5 yuvarlama), 3, 2, 1', JSON.stringify(seq) === JSON.stringify([8, 6, 5, 3, 2, 1]), JSON.stringify(seq));
  ok('"~3 km sonra" 17. km\'de görülür ve 18. km\'de 2\'ye iner', seq[3] === 3 && seq[4] === 2);
  ok('noktaya 1 km kala "Bu bölgede"', /^🌧️ Bu bölgede yağmur/.test(at(19.1)));
  ok('5 sn\'lik check() adımlarında yeni yağış isteği yok', H.wx.length === 1);
  ok('5 sn\'lik adımlarda ek ses yok', H.speak.length === 1);
}

// ---------------------------------------------------------------- 2) İstek sürerken araç ilerler: alınma km'sine bağlanır
{
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  H.state.engine = { routeKm: 13, offRouteKm: 0 }; // yanıt gelmeden 3 km ilerledi
  answer(H.wx[0], (k) => k === 20);
  await flush();
  ok('yanıt geç gelince kalan = 20 − 13 = ~7 km (alınma anı 10 değil)', kmOf(rain()) === 7, rain());
}

// ---------------------------------------------------------------- 3) Rota dışı / GPS geri sıçraması / yeniden rota
{
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  answer(H.wx[0], (k) => k === 35);
  await flush();
  ok('35. km yağışı: ~25 km', kmOf(rain()) === 25, rain());
  ok('rota dışında "mesafe belirsiz", sayı yok', /mesafe belirsiz/.test(at(14, { off: 2 })) && kmOf(rain()) === null);
  ok('rotaya dönünce geri sayım sürer (~20 km)', kmOf(at(15)) === 20);
  at(25.0);
  ok('GPS −0,1 km geri sıçraması sayıyı büyütmez', kmOf(at(24.9)) === 10);
  H.state.plan = { ...H.state.plan, planId: 'reroute-' + pid };
  clock += 5000; check();
  ok('yeniden rotada eski yağış metni kalmaz', rain() === null);
  ok('yeniden rotada yeni planın yağış isteği hemen açılır', H.wx.length === 2);
  answer(H.wx[1], () => false); // isteği kapat (busyWx bırakılır)
  await flush();
  ok('yeni planda yağış yoksa metin boş kalır', rain() === null);
}

// ---------------------------------------------------------------- 4) GAP-1/2 — D1 (v0.99.77) düzeltildi; davranış burada sabitlenir
// Yenileme örnekleri yalnızca güncel km + [10, 25, ...] noktalarında (ek/yakın örnek yok, istek sıklığı aynı). Önceki olay bu
// yenilemenin örneklemediği yakın bantta (alınma km'si .. ilk örnek) ve hâlâ öndeyse: ilk örnek de yağışlıysa (alan banda uzanıyor)
// olay konumu korunur, veri tazelenir, mesafe güncel konumdan yeniden hesaplanır (10 km'ye sıçrama yok, yeni ses yok); değilse
// veri onu ne doğrular ne yalanlar → mesafesiz "belirsiz", ses yok. Örneklenen bölgedeki olay için yeni veri esastır (körlemesine koruma yok).
const vague = (t) => typeof t === 'string' && /mesafe belirsiz/.test(t) && kmOf(t) === null;
{
  // GAP-1: geniş yağış alanı → 17. km'de yenileme (örnekler 27, 42, ... yağışlı) "~3 km sonra" kalır
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  const wide = (k) => k >= 20 && k <= 200;
  answer(H.wx[0], wide);
  await flush();
  at(13); at(15); at(17);
  const before = kmOf(rain());
  H.state.engine = { routeKm: 17, offRouteKm: 0 };
  clock += 10 * 60e3 + 1; check(); // 10 dk doldu → refreshRain(17): örnekler 27, 42, ...
  ok('GAP-1 ön koşul: yenilemeden önce ~3 km sonra', before === 3);
  ok('GAP-1 ön koşul: 10 dk sonunda tek yeni yağış isteği, aynı 7 nokta, ilk örnek 27. km', H.wx.length === 2 && H.wx[1].pts.length === 7 && H.wx[1].pts[0].d === 10 && Math.round((H.wx[1].pts[0].lat - 40) * 1000) === 27);
  answer(H.wx[1], wide);
  await flush();
  const after = kmOf(rain());
  ok('GAP-1 (D1): yenilemeden sonra hâlâ ~3 km sonra (10\'a sıçramaz)', after === 3, rain());
  ok('GAP-1 (D1): yenileme yeni sesli uyarı istemez (yalnızca ilk duyuru)', H.speak.length === 1, String(H.speak.length));
  ok('GAP-1 (D1): geri sayım güncel konumdan sürer (18 → ~2, 18,6 → ~1)', kmOf(at(18)) === 2 && kmOf(at(18.6)) === 1, rain());
  ok('GAP-1 (D1): noktaya varınca "Bu bölgede"', /^🌧️ Bu bölgede yağmur/.test(at(19.5)));
  // Tazelenen olay yenileme anından eskir (ilk alınmadan değil): ilk veriden 35+ dk sonra hâlâ gösterilir
  // (25 dk ileri sarınca plan hava yenilemesi de [refreshProfileWx, 20 dk; sahte wxQueryKms → boş nokta] aynı fetchWeather'a düşer: ayrı sayılır)
  const isRainReq = (q) => q.pts.length > 0 && q.pts[0].d != null;
  const t2 = H.wx.filter(isRainReq).length, n2 = H.wx.length;
  ok('GAP-1 (D1): veri yenileme anıyla tazelenir (ilk alınmadan 35 dk sonra bile eskimiş sayılmaz)', /^🌧️ Bu bölgede yağmur/.test(at(19.8, { dtMs: 25 * 60e3 })), String(rain()));
  const newReq = H.wx.slice(n2);
  ok('GAP-1 (D1): 10 dk dolunca tek normal yağış isteği, aynı 7 nokta (sıklık/boyut değişmedi)', H.wx.filter(isRainReq).length === t2 + 1 && newReq.filter(isRainReq).length === 1 && newReq.find(isRainReq).pts.length === 7, String(newReq.length));
  ok('GAP-1 (D1): yağış dışındaki tek istek plan hava yenilemesi (boş nokta, sahte)', newReq.filter((q) => !isRainReq(q)).every((q) => q.pts.length === 0));
  for (const q of newReq) answer(q, () => false);
  await flush();
  console.log(`GAP-1 gözlem: yenileme öncesi ~${before} km, sonrası ~${after} km; ses isteği ${H.speak.length}`);

  // GAP-2: yağış yalnızca 20. km'de; 17. km'de yenileme 27+ örnekler kuru → silinmez, mesafesiz "belirsiz"
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  const narrow = (k) => k === 20;
  answer(H.wx[0], narrow);
  await flush();
  at(13); at(15);
  const before2 = kmOf(at(17));
  clock += 10 * 60e3 + 1; check();
  answer(H.wx[H.wx.length - 1], narrow);
  await flush();
  ok('GAP-2 ön koşul: yenilemeden önce ~3 km sonra', before2 === 3);
  ok('GAP-2 (D1): 3 km ilerideki uyarı yenilemede silinmez, "mesafe belirsiz" olur (eski mesafe gösterilmez)', vague(rain()), String(rain()));
  ok('GAP-2 (D1): belirsiz durum seslendirilmez', H.speak.length === 1, String(H.speak.length));
  ok('GAP-2 (D1): sonraki check() eski mesafeyi geri getirmez', vague(at(18)) && vague(at(19)), String(rain()));
  ok('GAP-2 (D1): olay noktası geçilince (20 + 10 km) belirsiz uyarı kalkar', at(30.5) === null, String(rain()));
  ok('GAP-2 (D1): ek yağış isteği yok', H.wx.length === 2, String(H.wx.length));
  console.log(`GAP-2 gözlem: yenileme öncesi ~${before2} km, sonrası "mesafe belirsiz"`);

  // GAP-2b: önceki olay yakın bantta, ilk örnek kuru ama daha ileride yağış var → yine belirsiz (uzak olayın mesafesi yakını gizlemez)
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  answer(H.wx[0], (k) => k === 20 || k >= 42);
  await flush();
  at(17);
  clock += 10 * 60e3 + 1; check(); // örnekler 27 (kuru), 42 (yağışlı)
  answer(H.wx[H.wx.length - 1], (k) => k === 20 || k >= 42);
  await flush();
  ok('GAP-2b (D1): yakın olay doğrulanmazsa "belirsiz"; 42. km\'nin ~25 km\'si gösterilmez', vague(rain()), String(rain()));
  ok('GAP-2b (D1): ses yok', H.speak.length === 1, String(H.speak.length));

  // Karşı örnek (körlemesine koruma yok): önceki olay örneklenen bölgede (35. km, 15. km'de yenileme: örnekler 25, 40, ...) ve yeni veri kuru → kalkar
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  answer(H.wx[0], (k) => k === 35);
  await flush();
  at(15);
  clock += 10 * 60e3 + 1; check();
  answer(H.wx[H.wx.length - 1], () => false);
  await flush();
  ok('karşı örnek (D1): örneklenen bölgede yeni veri kuruysa eski uyarı korunmaz (rain=null)', rain() === null, String(rain()));
  ok('karşı örnek (D1): sonraki check() eski olayı geri getirmez', at(16) === null, String(rain()));

  // Örneklenen bölgede yeni veri başka yerde yağış bulursa mesafe güncel konum + güncel olay konumundan yeniden hesaplanır
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  answer(H.wx[0], (k) => k === 35);
  await flush();
  at(15);
  clock += 10 * 60e3 + 1; check(); // örnekler 25, 40, 65, ...
  answer(H.wx[H.wx.length - 1], (k) => k === 65);
  await flush();
  ok('yeniden hesap (D1): yeni olay 65. km → 15. km\'den ~50 km sonra', kmOf(rain()) === 50, rain());
}

// ---------------------------------------------------------------- 4b) GAP-3 — D1 (v0.99.77) düzeltildi
// Yağış sesi yalnızca YENİ olayda istenir (mergeEvent ya da yakın bant tazelemesiyle süren olay yeniden seslendirilmez); anahtar+bekleme
// kapısı voice.js'te kalır. Hava isteği reddedilirse hâlâ geçerli olay mesafesiz "belirsiz"e döner (silinmez, eski mesafe gösterilmez/seslendirilmez).
{
  const vsrc = readFileSync(new URL('../js/advisor/voice.js', import.meta.url), 'utf8');
  ok('statik: voice.js speak kapısı anahtar + bekleme süresi', /if \(now - \(lastSpoken\.get\(key\) \|\| 0\) < cooldownMs\) return false;\s*lastSpoken\.set\(key, now\);/.test(vsrc));
  ok('statik: yağış ses anahtarı 50 km dilimi, 30 dk bekleme', /key: 'rain@' \+ Math\.round\(rainEv\.alongKm \/ 50\), cooldownMs: 30 \* 60e3/.test(asrc));
  /** voice.js kapısının taklidi (yalnızca anahtar+bekleme; ses motoru/ayar yok sayılır): gerçekten seslendirilecek çağrılar. */
  const voiced = (calls) => {
    const last = new Map();
    return calls.filter((c) => {
      const { key, cooldownMs } = c[1];
      if (c.t - (last.get(key) || 0) < cooldownMs) return false;
      last.set(key, c.t);
      return true;
    });
  };

  // (1) Eskiden dilim değişince ikinci uyarı: 20. km (rain@0) → 17. km'de yenileme (geniş alan). Artık olay sürer, ikinci istek yok
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  const wide = (k) => k >= 20 && k <= 200;
  answer(H.wx[0], wide);
  await flush();
  at(13); at(15); at(17);
  clock += 10 * 60e3 + 1; check();
  answer(H.wx[H.wx.length - 1], wide);
  await flush();
  const k1 = H.speak.map((c) => c[1].key);
  ok('GAP-3 (1) (D1): tek yağış sesi isteği (rain@0), dilim değişimi yok', JSON.stringify(k1) === '["rain@0"]', JSON.stringify(k1));
  ok('GAP-3 (1) (D1): 30 dk içinde ikinci sesli uyarı yok', voiced(H.speak).length === 1, String(voiced(H.speak).length));
  ok('GAP-3 (1) (D1): sıfırlanmış "10 kilometre sonra" ikinci duyurusu yok', H.speak.every((c, j) => j === 0 || !/10 kilometre sonra/.test(c[0])));
  ok('GAP-3 (1) (D1): metin ~3 km sonra', kmOf(rain()) === 3, rain());

  // (2) Aynı dilim: 90. km → 87. km'de yenileme. Olay sürer (~3 km), ahead.js ikinci kez speak istemez
  freshPlan(80);
  clock += 11 * 60e3;
  check();
  const wide2 = (k) => k >= 90 && k <= 250;
  answer(H.wx[0], wide2);
  await flush();
  ok('GAP-3 (2) ön koşul: ilk metin ~10 km sonra', kmOf(rain()) === 10, rain());
  at(83); at(85); at(87);
  clock += 10 * 60e3 + 1; check();
  answer(H.wx[H.wx.length - 1], wide2);
  await flush();
  ok('GAP-3 (2) (D1): yenilemeden sonra ~3 km sonra (97. km\'ye yeniden bağlanmaz)', kmOf(rain()) === 3, rain());
  const k2 = H.speak.map((c) => c[1].key);
  ok('GAP-3 (2) (D1): ahead.js yalnızca bir kez speak ister (rain@2)', JSON.stringify(k2) === '["rain@2"]', JSON.stringify(k2));
  ok('GAP-3 (2) (D1): 30 dk içinde yeniden sesli uyarı yok', voiced(H.speak).length === 1, String(voiced(H.speak).length));

  // (3) Hava isteği reddedilir → hâlâ ileride olan uyarı mesafesiz "belirsiz"; ses yok; istek sıklığı aynı; veri gelince yeniden hesap
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  answer(H.wx[0], (k) => k === 35);
  await flush();
  at(15);
  ok('GAP-3 (3) ön koşul: ret öncesi ~20 km sonra', kmOf(rain()) === 20, rain());
  const warn = console.warn; let warned = 0;
  console.warn = () => { warned++; };
  clock += 10 * 60e3 + 1; check();
  const nReq = H.wx.length;
  H.wx[nReq - 1].rej(new Error('sahte ağ hatası'));
  await flush();
  console.warn = warn;
  ok('GAP-3 (3) (D1): ret sonrası uyarı silinmez, "mesafe belirsiz" (eski ~20 km gösterilmez)', vague(rain()), String(rain()));
  ok('GAP-3 (3): ret uyarı günlüğüne yazılır, ses yok', warned === 1 && H.speak.length === 1, `warn=${warned} speak=${H.speak.length}`);
  H.state.nav = { ...H.state.nav, ahead: { ...H.state.nav.ahead, rain: 'SENTINEL' } };
  ok('GAP-3 (3) (D1): sonraki check() belirsiz metni yeniden yazar, mesafe uydurmaz', vague(at(16)), String(rain()));
  ok('GAP-3 (3): ret sonrası 10 dk dolmadan yeni yağış isteği yok', H.wx.length === nReq, String(H.wx.length));
  clock += 10 * 60e3; check(); // 16. km: örnekler 26, 41, 66, ...
  const isRainReq = (q) => q.pts.length > 0 && q.pts[0].d != null; // plan hava yenilemesi (20 dk, sahte boş nokta) ayrı sayılır
  const newReq = H.wx.slice(nReq);
  ok('GAP-3 (3): 10 dk sonra tek yeni yağış isteği, aynı 7 nokta (sıklık değişmedi)', newReq.filter(isRainReq).length === 1 && newReq.find(isRainReq).pts.length === 7, String(newReq.length));
  for (const q of newReq) answer(q, (k) => k >= 35 && k <= 100);
  await flush();
  ok('GAP-3 (3) (D1): veri gelince mesafe güncel konum + güncel olaydan (41. km → ~25 km)', kmOf(rain()) === 25, rain());

  // (4) Ret, önceki olay yokken: metin boş kalır (uydurma uyarı yok)
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  console.warn = () => {};
  H.wx[0].rej(new Error('sahte ağ hatası'));
  await flush();
  console.warn = warn;
  ok('GAP-3 (4): önceki olay yokken ret → rain=null, ses yok', rain() === null && H.speak.length === 0, String(rain()));

  // (5) Ret, önceki olay geçilmişken: belirsiz uyarı üretilmez
  freshPlan(10);
  clock += 11 * 60e3;
  check();
  answer(H.wx[0], (k) => k === 20);
  await flush();
  at(31);
  clock += 10 * 60e3 + 1; check();
  console.warn = () => {};
  H.wx[H.wx.length - 1].rej(new Error('sahte ağ hatası'));
  await flush();
  console.warn = warn;
  ok('GAP-3 (5): geçilmiş olay retle geri gelmez (rain=null)', rain() === null, String(rain()));
}

// ---------------------------------------------------------------- 5) Görüntü yolu (statik): navigator.js uyarı satırı nav.ahead.rain'i her boyamada okur
{
  const nsrc = readFileSync(new URL('../js/nav/navigator.js', import.meta.url), 'utf8');
  const body = nsrc.slice(nsrc.indexOf('function paintAlert('), nsrc.indexOf('function paintHud('));
  ok('statik: paintAlert nav.ahead\'i her çağrıda okur (önbellek yok)', /const a = nav\.ahead;/.test(body) && /a\.traffic, a\.rain/.test(body));
  ok('statik: nav değişince paintAlert yeniden çağrılır', /subscribe\('nav', \(\) => \{[\s\S]{0,120}paintAlert\(false\)/.test(nsrc));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
ok('trafik isteği yapılmadı (route.end yok)', H.traffic === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
