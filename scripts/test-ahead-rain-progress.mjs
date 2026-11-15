// Yol önü YAĞIŞ uyarısı kalan mesafesi, ahead.js üzerinden uçtan uca: node scripts/test-ahead-rain-progress.mjs
// v0.99.56 (99e8d77) "~3 km sonra" metninin donma hatasını düzeltti; saf hesap test-ahead-events.mjs'de, trafik uçtan uca
// test-traffic-guard.mjs'de sınanıyor. Bu dosya eksik kalan yolu sınar: refreshRain → anchorRain → check()/paintEvents geri sayımı,
// istek sürerken konum ilerlemesi, rota dışı, ve 10 dk'lık yağış yenilemesinin mevcut davranışı (GAP olarak sabitlenir, düzeltilmez).
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

// ---------------------------------------------------------------- 4) GAP (mevcut davranış sabitlenir, düzeltme DEĞİL)
// Kök: refreshRain her 10 dk'da örnekleri YALNIZCA güncel km + [10, 25, ...] noktalarında alır ve bağlı olayı
// yenisiyle değiştirir (mergeEvent yalnızca ±1 km'de birleştirir). Hâlâ geçerli ve daha yakın olay dikkate alınmaz.
{
  // GAP-1: geniş yağış alanı → 10 dk'lık yenilemede "~3 km sonra" tekrar "~10 km sonra"ya sıçrar (geri sayım sıfırlanır)
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
  ok('GAP-1 ön koşul: 10 dk sonunda yeni yağış isteği, ilk örnek 27. km', H.wx.length === 2 && H.wx[1].pts[0].d === 10 && Math.round((H.wx[1].pts[0].lat - 40) * 1000) === 27);
  answer(H.wx[1], wide);
  await flush();
  const after = kmOf(rain());
  ok('GAP-1 (mevcut): yenilemeden sonra ~10 km sonra (3 → 10 sıçrama)', after === 10, rain());
  console.log(`GAP-1 gözlem: yenileme öncesi ~${before} km, sonrası ~${after} km; ses kaydı ${H.speak.length}`);

  // GAP-2: yağış yalnızca 20. km'de; 17. km'de yenileme 27+ örnekler kuru → hâlâ 3 km ilerideki uyarı silinir
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
  ok('GAP-2 (mevcut): 3 km ilerideki yağış uyarısı yenilemede silinir (rain=null)', rain() === null, String(rain()));
  console.log(`GAP-2 gözlem: yenileme öncesi ~${before2} km, sonrası ${JSON.stringify(rain())}`);
}

// ---------------------------------------------------------------- 4b) GAP-3 (mevcut davranış sabitlenir, düzeltme DEĞİL)
// Yağış sesi ahead.js'te her başarılı yenilemede speak(..., { key: 'rain@' + round(alongKm/50), cooldownMs: 30 dk }) ile istenir;
// tekrar süzgeci yalnızca voice.js'teki anahtar+bekleme kapısıdır. Yenileme olayı yeniden bağlayınca 50 km'lik anahtar dilimi
// değişirse 30 dk dolmadan ikinci sesli uyarı çıkar; aynı dilimde kalırsa çıkmaz. Hava isteği reddedilirse rainEv=null olur.
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

  // (1) Dilim değişir → ikinci uyarı: 20. km (rain@0) → 17. km'de yenileme, geniş alan 27. km'ye bağlanır (rain@1)
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
  ok('GAP-3 (1) ön koşul: iki yağış sesi isteği, anahtarlar rain@0 → rain@1', JSON.stringify(k1) === '["rain@0","rain@1"]', JSON.stringify(k1));
  ok('GAP-3 (1) ön koşul: iki istek arası 30 dk bekleme süresinden kısa', H.speak[1].t - H.speak[0].t < 30 * 60e3);
  const v1 = voiced(H.speak);
  ok('GAP-3 (1) (mevcut): dilim değişince 30 dk dolmadan ikinci sesli uyarı verilir', v1.length === 2, String(v1.length));
  ok('GAP-3 (1) (mevcut): ikinci uyarı "10 kilometre sonra" der (geri sayım sıfırlanmış)', /10 kilometre sonra yağmur/.test(H.speak[1][0]), H.speak[1][0]);

  // (2) Karşı örnek, aynı dilim → yeniden uyarı yok: 90. km (round(1.8)=2) → 87. km'de yenileme 97. km (round(1.94)=2)
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
  ok('GAP-3 (2) ön koşul: yenileme 97. km\'ye bağlandı (~10 km sonra)', kmOf(rain()) === 10, rain());
  const k2 = H.speak.map((c) => c[1].key);
  ok('GAP-3 (2) ön koşul: ahead.js iki kez speak ister, ikisi de rain@2', JSON.stringify(k2) === '["rain@2","rain@2"]', JSON.stringify(k2));
  ok('GAP-3 (2) (mevcut): aynı dilimde 30 dk içinde yeniden sesli uyarı verilmez (yalnızca ilk)', voiced(H.speak).length === 1, String(voiced(H.speak).length));

  // (3) Hava isteği reddedilir → rainEv=null (mevcut): önceki geçerli uyarı silinir, olay boyamadan da kalkar, hemen yeniden denenmez
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
  ok('GAP-3 (3) (mevcut): ret sonrası rain=null (hâlâ ileride olan uyarı silinir)', rain() === null, String(rain()));
  ok('GAP-3 (3): ret uyarı günlüğüne yazılır, ses yok', warned === 1 && H.speak.length === 1, `warn=${warned} speak=${H.speak.length}`);
  H.state.nav = { ...H.state.nav, ahead: { ...H.state.nav.ahead, rain: 'SENTINEL' } };
  at(16);
  ok('GAP-3 (3) (mevcut): rainEv=null — sonraki check() metni yeniden yazmaz (olay yok)', rain() === 'SENTINEL', String(rain()));
  ok('GAP-3 (3) (mevcut): ret sonrası 10 dk dolmadan yeni yağış isteği yok', H.wx.length === nReq, String(H.wx.length));
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
