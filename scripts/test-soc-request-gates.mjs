// G1b — Q-SOC-1 / Q-SOC-2: güvenilmeyen pil (tahmin/eski/varsayılan/yok) DIŞ İSTEK tetiklemez, düşük pil güvenliği (uyarı + ses + yerel
// eko-hız tavsiyesi) sürer. Kullanım: node scripts/test-soc-request-gates.mjs
//  1) js/advisor/fallback.js check(): tüketim yedeği replanFrom (yeniden plan → olası Valhalla erişim sorgusu) yalnızca güvenilir pil
//     (socTrust.js: 'live', 'manual', Test Modu 'sim') ile; güvenilmeyende eko-hız tavsiyesi + ses, soğuma (60 sn) harcanmaz.
//  2) js/nav/nearby.js: düşük pilin kendisi yakın istasyon araması (fetchAround: ücretli arama sağlayıcıları) ve canlı doluluk
//     (fetchAvailability → /v1/occupancy) tetiklemesi yalnızca güvenilir pil ile; güvenilmeyende uyarı paneli ve ses sürer.
//     Kullanıcının elle yenilemesi (refreshNearby) kapsam dışıdır ve çalışmaya devam eder.
// Deterministik, çevrimdışı: fetch yasak, tüm ağ modülleri bellek içi sahte, saat sanal; gerçek anahtar yok, ücretli API yok.
import { registerHooks } from 'node:module';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
const fakeEl = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === 'children' || k === 'childNodes' ? [] : fakeEl()),
  set: () => true,
  apply: () => fakeEl(),
});
globalThis.document = { getElementById: () => fakeEl(), querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl(), addEventListener: () => {} };

const S = (globalThis.__sgStub = {
  // fallback.js
  state: {}, eff: {}, src: 'live', replans: [], patches: [], speaks: [], eco: 0,
  // nearby.js
  nsrc: 'live', stations: [], around: 0, occ: 0, nspeaks: [], via: 0,
});
const g = 'globalThis.__sgStub';
const STUBS = {
  '/js/advisor/fallback.js': {
    '../state.js': `
      export const getState = (k) => ${g}.state[k];
      export const effective = () => ${g}.eff;
      export const patch = (k, v) => { ${g}.patches.push([k, v]); };`,
    '../config.js': 'export const VEHICLE = { batteryNetKwh: 100 }; export const PLANNER = { detourKwhPerKm: 0.2, chargerMinArrival: 10, hardMinArrival: 5 };',
    '../routing/controller.js': `export const replanFrom = (o) => { ${g}.replans.push(o); return true; };`,
    './ecoSpeed.js': `export const safeSpeed = () => { ${g}.eco++; return { speed: 90 }; };`,
    '../routing/planner.js': 'export const usable = () => true;',
    './voice.js': `export const speak = (m, o) => { ${g}.speaks.push(o?.key); };`,
    '../physics/socEstimate.js': `export const socSource = () => ${g}.src;`,
  },
  '/js/nav/nearby.js': {
    '../providers/index.js': `export const fetchAround = async () => { ${g}.around++; return { stations: ${g}.stations.map((s) => ({ ...s })), errors: [], cached: false }; };`,
    '../routing/controller.js': `export const planTrip = () => { ${g}.via++; return new Promise(() => {}); };`,
    '../ui/mapView.js': 'export const mapApi = new Proxy({}, { get: () => () => {} });',
    '../ui/toast.js': 'export const toast = () => {};',
    '../advisor/voice.js': `export const speak = (m, o) => { ${g}.nspeaks.push(o?.key); };`,
    '../routing/occupancyClient.js': `export const fetchAvailability = async () => { ${g}.occ++; return new Map(); };`,
    '../net/proxy.js': 'export const proxyHas = (k) => k === "occupancy";', // Premium: doluluk sorgusu açık (en kötü durum)
    './navigator.js': 'export const startNav = () => {}; export const syncTopPanel = () => {};',
    '../ui/icons.js': 'export const icon = () => "";',
    '../ui/moreToggle.js': 'export const paintMore = () => {};',
    '../routing/planner.js': 'export const brandOk = () => true;',
    '../routing/powerFilter.js': 'export const loosenPower = () => ({ min: 0, from: 0, loosened: false }); export const paintPowerNote = () => {};',
    '../physics/socEstimate.js': `export const socSource = () => ${g}.nsrc; export const measuredSoc = (e) => e.soc;`,
  },
};
registerHooks({
  resolve(spec, ctx, next) {
    const parent = ctx.parentURL?.split('?')[0] || '';
    for (const [file, map] of Object.entries(STUBS)) {
      if (parent.endsWith(file) && spec in map) return { url: 'data:text/javascript,' + encodeURIComponent(map[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const realNow = Date.now;
let now = 1e12;
Date.now = () => now;
const realSetInterval = globalThis.setInterval;
/** init*() zamanlayıcılarını yakala (gerçek zamanlayıcı kurulmaz). */
function captureTimers(init) {
  const timers = [];
  globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return 0; };
  try { init(); } finally { globalThis.setInterval = realSetInterval; }
  return timers;
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); }; // setTimeout(0) Windows'ta ~15 ms: test yavaşlar

// =====================================================================================================================
// 1) Q-SOC-1 — advisor/fallback.js
// =====================================================================================================================
let fbN = 0;
async function fallbackRun({ src, sim = false, ticks = 1, gapMs = 5000 }) {
  const FB = await import('../js/advisor/fallback.js?f=' + fbN++); // her senaryo yeni modül: lastFallback sıfır
  const check = captureTimers(FB.initAdvisor).find((x) => x.ms === 5000)?.fn;
  S.src = src; S.replans = []; S.patches = []; S.speaks = []; S.eco = 0;
  // Plan: 10. km'de %20 pil; varış 300. km (km başına 0,2 puan → %58 gerek) → yetmez. 150. km'de uygun istasyon (%30 gerek → %20'den
  // %-10; ulaşılamaz) yerine 40. km'deki istasyon (%6 gerek → %14 ≥ hardMin 5) "bir önceki uygun istasyon" olur.
  S.state = {
    plan: { profile: { totalKm: 300, energyBetween: (a, b, k) => (b - a) * 0.2 * k }, status: 'ready', stops: [],
      stations: [{ id: 'a', name: 'Ara İstasyon', km: 40, offKm: 0 }] },
    engine: { routeKm: 10, offRouteKm: 0, k: 1 },
    sim: { enabled: sim, play: false },
    route: { minArrivalSoc: 10, cruise: 120 },
  };
  S.eff = { source: sim ? 'sim' : 'live', soc: 20, speed: 100 };
  const out = [];
  for (let i = 0; i < ticks; i++) { now += gapMs; check(); out.push({ replans: S.replans.length, level: S.patches.at(-1)?.[1]?.level }); }
  return { check, out, replans: S.replans.length, speaks: [...S.speaks], eco: S.eco, last: S.patches.at(-1)?.[1] };
}

{
  const FB0 = await import('../js/advisor/fallback.js?f=probe');
  ok('fallback: initAdvisor API korunuyor', typeof FB0.initAdvisor === 'function');
  const t = captureTimers(FB0.initAdvisor);
  ok('fallback: 5 sn denetim zamanlayıcısı (CHECK_MS) değişmedi', t.length === 1 && t[0].ms === 5000);
}
for (const src of ['live', 'manual']) {
  const r = await fallbackRun({ src });
  ok(`Q-SOC-1 güvenilir '${src}': yedek istasyona replanFrom çağrılır (davranış korunur)`, r.replans === 1, String(r.replans));
  ok(`Q-SOC-1 güvenilir '${src}': sesli "rota güncellendi" uyarısı`, r.speaks.includes('fallback'), JSON.stringify(r.speaks));
}
{
  const r = await fallbackRun({ src: 'estimate', sim: true });
  ok("Q-SOC-1 Test Modu 'sim' (socSource tahmin olsa da): replanFrom çağrılır", r.replans === 1, String(r.replans));
}
for (const src of ['estimate', 'stale', 'default', 'none']) {
  const r = await fallbackRun({ src, ticks: 30 }); // 30 × 5 sn = 150 sn (soğuma 60 sn'nin 2 katından uzun)
  ok(`Q-SOC-1 güvenilmez '${src}': 150 sn boyunca replanFrom HİÇ çağrılmaz (dış istek yok)`, r.replans === 0, String(r.replans));
  ok(`Q-SOC-1 güvenilmez '${src}': güvenlik sürer — eko-hız tavsiyesi hesaplanır`, r.eco >= 1, String(r.eco));
  ok(`Q-SOC-1 güvenilmez '${src}': güvenlik sürer — sesli tavsiye + panel uyarısı`, r.speaks.some((k) => String(k).startsWith('eco')) && r.last?.level === 'warn' && /90/.test(r.last?.text || ''), JSON.stringify([r.speaks.slice(0, 2), r.last]));
}
{
  // Güvenilmeyen pilde soğuma harcanmaz: kaynak 'live' olunca beklemeden yeniden plan
  const FB = await import('../js/advisor/fallback.js?f=' + fbN++);
  const check = captureTimers(FB.initAdvisor).find((x) => x.ms === 5000)?.fn;
  S.replans = []; S.speaks = []; S.patches = []; S.eco = 0;
  S.state = {
    plan: { profile: { totalKm: 300, energyBetween: (a, b, k) => (b - a) * 0.2 * k }, status: 'ready', stops: [], stations: [{ id: 'a', name: 'Ara İstasyon', km: 40, offKm: 0 }] },
    engine: { routeKm: 10, offRouteKm: 0, k: 1 }, sim: { enabled: false, play: false }, route: { minArrivalSoc: 10, cruise: 120 },
  };
  S.eff = { source: 'live', soc: 20, speed: 100 };
  S.src = 'estimate'; now += 5000; check();
  const afterEstimate = S.replans.length;
  S.src = 'live'; now += 5000; check();
  ok('Q-SOC-1 tahmin → canlı kamera: soğuma harcanmamış, ilk güvenilir denetimde replanFrom', afterEstimate === 0 && S.replans.length === 1, JSON.stringify([afterEstimate, S.replans.length]));
  now += 5000; check();
  ok('Q-SOC-1 güvenilir kaynakta 60 sn soğuma aynen korunur (5 sn sonra ikinci replanFrom yok)', S.replans.length === 1, String(S.replans.length));
}
{
  const r = await fallbackRun({ src: 'live', ticks: 30 });
  ok('Q-SOC-1 güvenilir: 150 sn\'de replanFrom en çok 3 (60 sn soğuma)', r.replans >= 2 && r.replans <= 3, String(r.replans));
}

// =====================================================================================================================
// 2) Q-SOC-2 — nav/nearby.js (gerçek state.js/chargePick.js/nearSort.js; ağ/harita/ses/planlayıcı sahte)
// =====================================================================================================================
const { patch, getState } = await import('../js/state.js');
const HERE = { lat: 39.9, lon: 32.85 };
S.stations = [{ id: 'st-1', name: 'Hızlı İstasyon', lat: 39.918, lon: 32.85, kw: 180, price: 10, brand: 'X', slow: false }];

let nbN = 0;
/**
 * Yeni nearby.js örneği + initNearby zamanlayıcıları. Park hâlinde (hız 0, navigasyon kapalı) %12 pil: aramayı/doluluğu tetikleyen
 * TEK neden düşük pildir (sürüş/navigasyon kadansı devre dışı).
 */
async function nearby({ src, sim = false, list = false }) {
  S.nsrc = src; S.around = 0; S.occ = 0; S.nspeaks = []; S.via = 0;
  patch('sim', { enabled: sim, soc: 12, speed: 0, lat: HERE.lat, lon: HERE.lon, play: false });
  patch('live', { soc: 12, speed: 0, lat: HERE.lat, lon: HERE.lon });
  patch('nav', { active: false, lowSoc: 20, alert: null });
  patch('advisor', { level: 'ok' });
  patch('plan', { stops: [], status: 'ok', profile: null, steps: [] });
  const nb = await import('../js/nav/nearby.js?n=' + nbN++);
  const timers = captureTimers(nb.initNearby);
  const watch = timers.find((x) => x.ms === 30000)?.fn;
  const low = timers.find((x) => x.ms === 5000)?.fn;
  if (list) { await nb.refreshNearby({ force: true, silent: true }); await flush(); } // kullanıcı Yenile'ye dokundu (elle; kapı dışı)
  const base = { around: S.around, occ: S.occ };
  S.around = 0; S.occ = 0;
  return { nb, watch, low, base };
}
async function drive(r, minutes) {
  for (let s = 5; s <= minutes * 60; s += 5) {
    now += 5000;
    r.low();
    if (s % 30 === 0) r.watch();
    await flush();
  }
}

{
  const r = await nearby({ src: 'live' });
  ok('nearby: initNearby zamanlayıcıları korunuyor (30 sn watch, 5 sn checkLow)', typeof r.watch === 'function' && typeof r.low === 'function');
}
// a) Liste boş (henüz arama yok): düşük pil kendiliğinden arar mı?
for (const src of ['live', 'manual']) {
  const r = await nearby({ src });
  await drive(r, 3);
  ok(`Q-SOC-2 güvenilir '${src}', liste boş: düşük pil yakın aramayı tetikler (davranış korunur)`, S.around >= 1, String(S.around));
  ok(`Q-SOC-2 güvenilir '${src}': uyarı paneli gösterilir`, !!getState('nav').alert);
}
{
  const r = await nearby({ src: 'estimate', sim: true });
  await drive(r, 3);
  ok("Q-SOC-2 Test Modu 'sim': düşük pil yakın aramayı tetikler", S.around >= 1, String(S.around));
}
for (const src of ['estimate', 'stale', 'default', 'none']) {
  const r = await nearby({ src });
  await drive(r, 10);
  ok(`Q-SOC-2 güvenilmez '${src}', liste boş: 10 dk boyunca yakın arama (fetchAround) YOK`, S.around === 0, String(S.around));
  ok(`Q-SOC-2 güvenilmez '${src}', liste boş: doluluk (fetchAvailability) YOK`, S.occ === 0, String(S.occ));
  const a = getState('nav').alert;
  ok(`Q-SOC-2 güvenilmez '${src}', liste boş: düşük pil uyarısı yine gösterilir ("aranıyor" denmez)`, !!a && /Pil %12/.test(JSON.stringify(a)) && !/aranıyor/.test(JSON.stringify(a)), JSON.stringify(a)?.slice(0, 120));
}
// b) Liste var (kullanıcı elle yeniledi): kritik pilde dakikada bir doluluk + dar yarıçaptan genişletme araması
for (const src of ['live', 'manual']) {
  const r = await nearby({ src, list: true });
  ok(`Q-SOC-2 güvenilir '${src}': elle yenileme arar`, r.base.around >= 1, String(r.base.around));
  await drive(r, 5);
  ok(`Q-SOC-2 güvenilir '${src}', liste var: kritik pilde doluluk yenilenir (5 dk'da ≥ 3)`, S.occ >= 3, String(S.occ));
  ok(`Q-SOC-2 güvenilir '${src}': sesli düşük pil önerisi`, S.nspeaks.some((k) => String(k).startsWith('low')), JSON.stringify(S.nspeaks));
}
for (const src of ['estimate', 'stale', 'default', 'none']) {
  const r = await nearby({ src, list: true });
  ok(`Q-SOC-2 güvenilmez '${src}': kullanıcının elle yenilemesi yine arar (kapı yalnız düşük pil tetikleyicisinde)`, r.base.around >= 1, String(r.base.around));
  await drive(r, 10);
  ok(`Q-SOC-2 güvenilmez '${src}', liste var: 10 dk boyunca düşük pil kaynaklı yakın arama YOK`, S.around === 0, String(S.around));
  ok(`Q-SOC-2 güvenilmez '${src}', liste var: 10 dk boyunca doluluk sorgusu YOK`, S.occ === 0, String(S.occ));
  ok(`Q-SOC-2 güvenilmez '${src}': güvenlik sürer — uyarı paneli mevcut listeden istasyon önerir`, /st-1|Hızlı İstasyon/.test(JSON.stringify(getState('nav').alert)), JSON.stringify(getState('nav').alert)?.slice(0, 120));
  ok(`Q-SOC-2 güvenilmez '${src}': güvenlik sürer — sesli düşük pil önerisi`, S.nspeaks.some((k) => String(k).startsWith('low')), JSON.stringify(S.nspeaks));
  ok(`Q-SOC-2 güvenilmez '${src}': rota kendiliğinden değişmez (BL-P0-05 korunur)`, S.via === 0, String(S.via));
}
{
  // Sürüş/navigasyon kadansı (düşük pilden bağımsız) güvenilmez pilde de çalışır: 15 dk'da bir liste tazelenir (5 dk değil)
  const r = await nearby({ src: 'estimate', list: true });
  patch('live', { speed: 80 }); patch('nav', { active: true });
  await drive(r, 14);
  ok('Q-SOC-2 güvenilmez + navigasyon: düşük pil sıklığı (5 dk) uygulanmaz — 14 dk\'da arama yok', S.around === 0, String(S.around));
  await drive(r, 2);
  ok('Q-SOC-2 güvenilmez + navigasyon: normal 15 dk tazeleme sürer', S.around >= 1, String(S.around));
}

Date.now = realNow;
ok('gerçek ağ çağrısı yapılmadı', netCalls === 0, String(netCalls));
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
