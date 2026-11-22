// G2b — NAVİGASYON AÇIKKEN SAĞLAYICI BAŞINA SAATLİK İSTEK BÜTÇESİ + İSTASYON HATA YOLLARI + HARİTA KAROSU/YÜKLEME DENETİMİ.
// node scripts/test-g2b-request-budget.mjs   (çevrimdışı; gerçek ağ yok, gerçek anahtar yok, ücretli API yok; saat sanal)
// Belge: docs/api-call-graph.md §4/§5 (G2). R5 G0 (test-api-call-graph) GPS/OCR/SOC sıcak yolunu kilitler; bu dosya navigasyon
// modüllerinin GERÇEK kodunu (ağ uçları sahte) 60 sanal dakika boyunca çalıştırıp çağrı sayar:
//   A) İSTASYON HATA YOLLARI — js/nav/nearby.js: fetchAround reddedince (throw: ör. sunucu Mapbox 402/401 → categoryId fatal) ve hata
//      dizisiyle döndüğünde otomatik yeniden arama sınırlı mı; elle Yenile her zaman çalışır; başarı geri çekilmeyi sıfırlar.
//   B) SAATLİK BÜTÇE — ahead.js (yağış/plan havası/trafik), livePlan.js (doluluk + yeniden plan), speedLimit.js (yol limiti),
//      roadWarnings.js (hız kameraları), navigator.js (rotadan çıkınca yeniden rota): sağlayıcı başarılı / ağ hatası / fatal.
//   C) HARİTA KAROSU / HARİTA YÜKLEMESİ — karolar MapLibre Web Worker'ında yüklenir (fetch sayacı görmez); burada sayılabilen
//      kod değişmezleri kilitlenir: sayfa başına tek harita nesnesi, açılış hatasında kendiliğinden yeniden açılış yok, kimlik
//      hatasında oturum boyu OpenFreeMap (yenileme döngüsü yok), uydu = setStyle (yeni harita değil), takip kamerası durunca hareket yok.
// Gerçek cihazdaki karo sayısı ve sağlayıcı faturalama modeli burada DOĞRULANMAZ (G3: cihaz + ağ günlüğü, kullanıcı onayı).
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0, gaps = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const knownGap = (id, name, present, extra = '') => {
  if (present) { pass++; gaps++; console.log(`ok  KNOWN-GAP ${id}: ${name}${extra ? ' (' + extra + ')' : ''}`); } else { fail++; console.log(`FAIL GAP CLOSED ${id}: ${name} — knownGap satırını kabul denetimine (ok) çevirin${extra ? ' — ' + extra : ''}`); }
};
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (r) => readFileSync(join(ROOT, r), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// =====================================================================================================================
// Sahte dünya: ağ yasak, sanal saat, sahte DOM (dinleyiciler kimliğe göre yakalanır), ağ uçları tek sayaçta.
// =====================================================================================================================
const realFetchCalls = [];
globalThis.fetch = (u) => { realFetchCalls.push(String(u)); return Promise.reject(new Error('ağ yasak (test)')); };
for (const k of ['XMLHttpRequest', 'WebSocket', 'EventSource']) globalThis[k] = class { constructor() { realFetchCalls.push(k); throw new Error(k + ' yasak'); } };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k), key: (i) => [...stored.keys()][i] ?? null, get length() { return stored.size; }, clear: () => stored.clear() };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const listeners = {}; // 'kimlik:olay' → işleyici
const fakeEl = (id = '') => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => '';
    if (k === 'then') return undefined;
    if (k === 'children' || k === 'childNodes') return [];
    if (k === 'addEventListener') return (type, fn) => { listeners[`${id}:${type}`] = fn; };
    if (k === 'getBoundingClientRect') return () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
    return fakeEl();
  },
  set: () => true,
  apply: () => fakeEl(),
});
globalThis.window = globalThis;
globalThis.requestAnimationFrame = () => 0;
globalThis.document = {
  hidden: false, visibilityState: 'visible',
  getElementById: (id) => fakeEl(id), querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeEl(),
  addEventListener: (type, fn) => { listeners[`document:${type}`] = fn; }, body: fakeEl(), head: fakeEl(), documentElement: fakeEl(),
};
console.warn = () => {}; // modüllerin "alınamadı" günlükleri (beklenen) çıktıyı boğmasın

const G = (globalThis.__G = {
  st: {}, eff: {}, src: 'live', proxy: new Set(), premium: false, map: 'osm',
  calls: [], // { kind, t }
  mode: {}, // kind → 'ok' | 'fail' | 'fatal' | 'errors'
  storm: 0, // aynı sanal anda üst üste çağrı (fırtına) sayacı
  net: null,
});
const g = 'globalThis.__G';
const STUBS = {
  '/js/state.js': `
    export const getState = (k) => (${g}.st[k] ??= {});
    export const patch = (k, v) => { ${g}.st[k] = { ...(${g}.st[k] || {}), ...v }; };
    export const subscribe = () => () => {};
    export const effective = () => ${g}.eff;`,
  '/js/utils/storage.js': 'export const load = (k, d) => d; export const save = () => {}; export const remove = () => {}; export const onSave = () => {};',
  '/js/advisor/voice.js': 'export const speak = (s, o) => { (globalThis.__spoken ||= []).push((o && o.key) || s); }; export const stopSpeech = () => {}; export const testVoice = () => {}; export const unlockVoice = () => {}; export const voiceUnlocked = () => true;',
  '/js/ui/mapView.js': 'export const mapApi = new Proxy({}, { get: () => () => {} });',
  '/js/ui/toast.js': 'export const toast = () => {};',
  '/js/i18n/index.js': 'export const t = (s, ...a) => String(s).replace(/\\{(\\d)\\}/g, (m, i) => a[i]); export const locale = () => "tr";',
  '/js/providers/index.js': `
    export const fetchWeather = (...a) => ${g}.net('weather', a);
    export const fetchTrafficAhead = (...a) => ${g}.net('traffic', a);
    export const fetchAvailability = (...a) => ${g}.net('occupancy', a);
    export const fetchAround = (...a) => ${g}.net('around', a);
    export const fetchSpeedLimit = (...a) => ${g}.net('speedlimit', a);`,
  '/js/routing/controller.js': `
    export const replanFrom = (o) => { ${g}.net('replan', [o]); const p = ${g}.st.plan; if (p) { p.fromKm = o.km; p.fromSoc = o.soc; } return true; };
    export const updateAhead = () => {};
    export const previewSocReplan = (o) => { ${g}.net('socPreview', [o]); return { ok: false, reason: 'stub' }; };
    export const planTrip = () => new Promise(() => {});
    export const rerouteFromHere = () => ${g}.net('reroute', []);
    export const clearTrip = () => {};`,
  '/js/net/proxy.js': `
    export const proxyHas = (k) => ${g}.proxy.has(k);
    export const premiumAccess = () => ${g}.premium;
    export const proxyReady = () => false;
    export const proxyBase = () => '';
    export const proxyFetch = (...a) => ${g}.net('proxy', a);
    export const proxyFetchRetry = (...a) => ${g}.net('proxy', a);`,
  '/js/net/activeMap.js': `export const activeMap = () => ${g}.map; export const setActiveMap = () => {};`,
  '/js/physics/socEstimate.js': `export const socSource = () => ${g}.src; export const measuredSoc = (e) => e.soc;`,
  '/js/osm/cameras.js': `export const fetchCameras = (...a) => ${g}.net('cameras', a);`,
  '/js/osm/roadExtras.js': `export const roadExtrasFor = (...a) => ${g}.net('roadExtras', a);`,
  '/js/routing/occupancyClient.js': `export const fetchAvailability = (...a) => ${g}.net('occupancy', a);`,
  '/js/nav/navigator.js': 'export const startNav = () => {}; export const syncTopPanel = () => {};',
  '/js/nav/speedLimit.js': 'export const currentLimit = () => null; export const limitInfo = () => null;',
  '/js/nav/limitSpans.js': 'export const limitSpans = { ensure() {}, limitAt: () => null, loading: () => false, status: () => ({}) };',
  '/js/nav/freeDrive.js': 'export const stopRecenter = () => {};',
  '/js/nav/lanes.js': 'export const lanesToShow = () => null; export const addLaneHint = () => {};',
  '/js/ui/icons.js': 'export const icon = () => ""; export const setManeuverIcon = () => {};',
  '/js/ui/moreToggle.js': 'export const paintMore = () => {};',
  '/js/routing/planner.js': 'export const brandOk = () => true; export const usable = () => true;',
  '/js/routing/powerFilter.js': 'export const loosenPower = () => ({ min: 0, from: 0, loosened: false }); export const paintPowerNote = () => {};',
};
registerHooks({
  resolve(spec, ctx, next) {
    const parent = (ctx.parentURL || '').split('?')[0];
    const r = next(spec, ctx);
    if (!/\/js\//.test(parent)) return r; // testin kendi içe aktardığı modül gerçek; yalnız uygulama modüllerinin bağımlılıkları sahte
    const file = r.url.split('?')[0];
    for (const [suffix, src] of Object.entries(STUBS)) if (file.endsWith(suffix)) return { url: 'data:text/javascript,' + encodeURIComponent(src), format: 'module', shortCircuit: true };
    return r;
  },
});

// ---- sanal saat (test-api-call-graph ile aynı yöntem; Windows'ta setTimeout(0) ~15 ms olduğundan flush setImmediate ile) ----
const realSetImmediate = setImmediate;
let now = Date.UTC(2026, 10, 16, 8, 0, 0);
Date.now = () => now;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now, mark() {}, measure() {} }, configurable: true, writable: true });
const timers = new Map(); let tseq = 1;
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = tseq++; timers.set(id, { fn, at: now + Math.max(0, +ms || 0), every: 0, a }); return id; };
globalThis.setInterval = (fn, ms = 0, ...a) => { const id = tseq++; const every = Math.max(1, +ms || 1); timers.set(id, { fn, at: now + every, every, a }); return id; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => realSetImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
    if (!next) { now = end; await flush(); return; }
    const [id, t] = next;
    now = t.at;
    if (t.every) t.at += t.every; else timers.delete(id);
    try { await t.fn(...t.a); } catch { /* modül hatası zamanlayıcıyı durdurmaz (tarayıcıdaki gibi) */ }
    await flush();
  }
}

// ---- ağ ucu: tek sayaç; tür başına mod. Aynı sanal anda > 25 çağrı = fırtına: sonsuz mikro görev döngüsünü kırmak için asılı söz döner ----
const sameInstant = { t: -1, n: 0 };
G.net = (kind, args) => {
  G.calls.push({ kind, t: now });
  if (sameInstant.t === now) sameInstant.n++; else { sameInstant.t = now; sameInstant.n = 1; }
  if (sameInstant.n > 25) { G.storm = Math.max(G.storm, sameInstant.n); return new Promise(() => {}); }
  const mode = G.mode[kind] || 'ok';
  if (mode === 'fail') return Promise.reject(Object.assign(new TypeError('fetch failed (sahte: ağ yok)'), { status: 0 }));
  if (mode === 'fatal') return Promise.reject(Object.assign(new Error('Mapbox aylık hakkı doldu (sahte 402)'), { fatal: true, status: 402 }));
  if (kind === 'weather') return Promise.resolve(args[0].map(() => ({ rain: 0, temp: 12, wind: 5, windDir: 270 })));
  if (kind === 'traffic') return Promise.resolve({ jam: null, delayMin: 0, remainH: 1, trafficSource: 'mapbox', rt: null });
  if (kind === 'occupancy') return Promise.resolve(new Map());
  if (kind === 'speedlimit') return Promise.resolve(90);
  if (kind === 'cameras') return Promise.resolve([]);
  if (kind === 'roadExtras') return Promise.resolve(null);
  if (kind === 'reroute') return Promise.resolve(false); // yeniden rota alınamadı (internet yok / sağlayıcı hatası)
  if (kind === 'around') {
    if (mode === 'errors') return Promise.resolve({ stations: [], errors: ['İstasyon kaynağına ulaşılamadı (sahte)'], cached: false });
    return Promise.resolve({ stations: G.stations || [], errors: [], cached: false });
  }
  return Promise.resolve(null);
};
const count = (kind, from = 0, to = Infinity) => G.calls.filter((c) => c.kind === kind && c.t >= from && c.t < to).length;
const maxSameInstant = (kind) => { const m = new Map(); for (const c of G.calls) if (c.kind === kind) m.set(c.t, (m.get(c.t) || 0) + 1); return Math.max(0, ...m.values()); };

// ---- sahte plan: enlem 41, doğuya düz 300 km; 90 km/h ----
const LAT = 41, LON0 = 29, KPD = 111.32 * Math.cos((LAT * Math.PI) / 180); // km / boylam derecesi
const at = (km) => ({ lat: LAT, lon: LON0 + km / KPD });
const station = (id, km) => ({ id, name: 'İstasyon ' + id, ...at(km), kw: 150, hasDc: true, dcKw: 150, reachable: true, arrive: 30 });
function mkPlan(planId = 'p1') {
  const coords = Array.from({ length: 301 }, (_, i) => [at(i).lon, LAT]);
  const s1 = station('s1', 120), s2 = station('s2', 240);
  return {
    status: 'ready', planId, fromKm: 0, fromSoc: 80, startSoc: 80, kInfo: { k: 1 },
    profile: { totalKm: 300, pointAt: at, timeBetween: (a, b) => (b - a) / 90, energyBetween: (a, b, k = 1) => (b - a) * 0.18 * k, segs: [] },
    route: { coords, durationH: 300 / 90, routeMeta: { provider: 'mapbox' } },
    steps: [{ km: 300, type: 'arrive' }],
    stops: [{ km: 120, station: s1, minutes: 20, overheadMin: 3 }, { km: 240, station: s2, minutes: 20, overheadMin: 3 }],
    stations: [s1, s2],
  };
}
let km = 0, offKm = 0;
function resetWorld({ soc = 70, active = true, src = 'live', premium = false } = {}) {
  timers.clear(); stored.clear();
  G.calls = []; G.mode = {}; G.storm = 0; G.src = src; G.premium = premium; G.proxy = new Set(premium ? ['occupancy', 'mapbox'] : []);
  km = 5; offKm = 0;
  G.st = {
    plan: mkPlan(), engine: { routeKm: km, offRouteKm: 0, k: 1 }, live: { gps: 'on' }, sim: { enabled: false, play: false },
    nav: { active, ahead: {}, speedAlert: 0, limitOn: true, lowSoc: 15, headingUp: true, voice: false, liveRemain: null, limit: null },
    route: { end: at(300), via: null, minArrivalSoc: 10, cruise: 120 }, advisor: { level: 'ok' },
  };
  G.eff = { ...at(km), soc, speed: 90, heading: 90, source: 'live' };
}
/** 1 Hz sürüş: 90 km/h (0,025 km/sn). offRoute: araç rotanın 2 km kuzeyine çıkar (rota üstü km ilerlemez). */
function startDriving({ offRoute = false } = {}) {
  setInterval(() => {
    km += 0.025;
    const p = at(km);
    if (offRoute) { offKm = 2; G.eff = { ...G.eff, lat: p.lat + 2 / 111.2, lon: p.lon }; } else G.eff = { ...G.eff, ...p };
    G.st.engine = { ...G.st.engine, routeKm: offRoute ? G.st.engine.routeKm : km, offRouteKm: offKm };
  }, 1000);
}
const HOUR = 3600e3;
let modN = 0;
const fresh = (p) => import(`${p}?g2b=${modN++}`); // her senaryo yeni modül örneği: modül içi sayaçlar sıfır
const budget = {}; // rapor: senaryo → istek sayısı

// =====================================================================================================================
// A) İSTASYON HATA YOLLARI — js/nav/nearby.js (gerçek kod)
// =====================================================================================================================
async function nearbyRun({ mode, soc = 12, src = 'live', active = true, minutes = 60, stations = [], noPlan = false }) {
  resetWorld({ soc, src, active });
  G.st.plan = noPlan ? { status: 'none' } : { ...G.st.plan, stops: [] };
  G.stations = stations;
  G.mode.around = mode;
  const N = await fresh('../js/nav/nearby.js');
  N.initNearby();
  startDriving();
  const t0 = now;
  await advance(minutes * 60e3);
  return { N, t0, n: count('around'), same: maxSameInstant('around'), storm: G.storm };
}

{ // A1: atılan hata (throw), güvenilir düşük pil (%12, kamera), navigasyon açık, istasyon listesi boş → en kötü durum
  const r = await nearbyRun({ mode: 'fatal' });
  budget['A1 nearby throw + düşük güvenilir pil'] = r.n;
  ok(`A1 nearby throw: aynı anda üst üste yeniden arama YOK (fırtına; eskiden checkLow→autoSearch→refreshNearby beklemesiz döngü): en çok ${r.same}/an`, r.same <= 1 && r.storm === 0, `aynı anda ${r.same}, fırtına ${r.storm}`);
  ok(`A1 nearby throw: 60 dk'da otomatik arama üstel geri çekilmeyle sınırlı (≤ 12; 60 sn → 2 → 4 → 8 → 10 dk): ${r.n}`, r.n >= 2 && r.n <= 12, String(r.n));
  const gaps1 = G.calls.filter((c) => c.kind === 'around').map((c) => c.t).map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x != null);
  ok('A1 nearby throw: ardışık denemeler arası süre büyür, en çok 10 dk (+ 30 sn denetim aralığı)', gaps1.length >= 1 && gaps1.every((d, i) => d >= 60e3 && d <= 10.5 * 60e3 && (i === 0 || d >= gaps1[i - 1] - 30e3)), JSON.stringify(gaps1.map((d) => Math.round(d / 1000))));
  // A1b: elle Yenile geri çekilme sırasında da hemen çalışır (kullanıcı isteği engellenmez)
  const before = count('around');
  await listeners['near-refresh:click']?.();
  await flush();
  ok('A1b elle Yenile geri çekilme sırasında hemen bir arama yapar', count('around') === before + 1, `${before} → ${count('around')}`);
  // A1c: kaynak düzelince başarı geri çekilmeyi sıfırlar; yeni tek hata yine ~60 sn sonra (10 dk değil) yeniden denenir
  // Kurgu: elle Yenile başarılı ama istasyonsuz döner (meta.at yazılır, liste boş) → güvenilir düşük pil 45 sn sonra autoSearch yapar;
  // bu otomatik deneme hata atar (failN 1) → bir sonraki otomatik deneme ≈ 60 sn sonra olmalı (A1'de birikmiş 10 dk değil).
  G.mode.around = 'ok'; G.stations = [];
  const tOk = now;
  await listeners['near-refresh:click']?.(); await flush();
  G.mode.around = 'fatal';
  await advance(4 * 60e3);
  const auto = G.calls.filter((c) => c.kind === 'around' && c.t > tOk).map((c) => c.t);
  const gap = auto.length >= 2 ? auto[1] - auto[0] : null;
  ok(`A1c başarı geri çekilmeyi sıfırlar: başarıdan sonraki ilk hata → yeniden deneme ≈ 60 sn sonra (10 dk değil): ${JSON.stringify(auto.map((t) => Math.round((t - tOk) / 1000)))}`, gap != null && gap >= 60e3 && gap <= 95e3);
}
{ // A2: atılan hata, pil normal (%70), navigasyon açık: watch() 30 sn'de bir yeniliyordu (meta.at yazılmadığı için yaş hep büyük)
  const r = await nearbyRun({ mode: 'fatal', soc: 70 });
  budget['A2 nearby throw + normal pil'] = r.n;
  ok(`A2 nearby throw, normal pil: 60 dk'da otomatik arama ≤ 12 (eskiden 30 sn'de bir ≈ 120): ${r.n}`, r.n >= 1 && r.n <= 12, String(r.n));
}
{ // A3: güvenilmeyen pil (tahmin) + throw: düşük pil araması tetiklenmez (G1b Q-SOC-2), normal sürüş tazelemesi de geri çekilir
  const r = await nearbyRun({ mode: 'fatal', src: 'estimate' });
  budget['A3 nearby throw + tahmini düşük pil'] = r.n;
  ok(`A3 nearby throw, tahmini pil: 60 dk'da ≤ 12 ve fırtına yok: ${r.n}`, r.n <= 12 && r.same <= 1, `${r.n}/${r.same}`);
}
{ // A4: hata DİZİSİYLE dönüş (throw değil: Overpass/Mapbox ulaşılamadı) — meta.at yazılır; 45 sn koruması (mevcut tasarım) sınırlar
  const r = await nearbyRun({ mode: 'errors' });
  budget['A4 nearby hata dizisi + düşük güvenilir pil'] = r.n;
  ok(`A4 nearby hata dizisi, güvenilir düşük pil: fırtına yok ve 60 dk'da ≤ 80 (45 sn autoSearch koruması): ${r.n}`, r.same <= 1 && r.n <= 80, `${r.n}/${r.same}`);
  // S-1 (v0.99.93, eskiden KNOWN-GAP: 45 sn sabit ≈ 80/saat): hata dizisi + boş sonuçta otomatik arama 45 → 90 → 180 → en çok 300 sn geri çekilir
  ok(`A4 S-1 hata dizisi: otomatik yeniden arama geri çekilir, 60 dk'da ≤ 15 (eskiden ≈ 80): ${r.n}`, r.n >= 2 && r.n <= 15, `${r.n}/saat`);
  const g4 = G.calls.filter((c) => c.kind === 'around').map((c) => c.t).map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x != null);
  ok('A4 S-1: ardışık aralıklar büyür (ilk ≥ 45 sn), en çok 5 dk + 30 sn, tavana ulaşır', g4.length >= 3 && g4.every((d, i) => d >= 45e3 && d <= 5.5 * 60e3 && (i === 0 || d >= g4[i - 1] - 30e3)) && Math.max(...g4) >= 4.5 * 60e3, JSON.stringify(g4.map((d) => Math.round(d / 1000))));
  const b4 = count('around');
  await listeners['near-refresh:click']?.(); await flush();
  ok('A4b S-1: elle Yenile geri çekilme sırasında hemen bir arama yapar', count('around') === b4 + 1, `${b4} → ${count('around')}`);
}
{ // A4c S-1b: önce istasyonlu başarılı arama, sonra kaynak hata dizisiyle döner → son iyi liste SİLİNMEZ (uyarı aynı istasyonu gösterir)
  const r = await nearbyRun({ mode: 'ok', stations: [station('n1', 9), station('n2', 14)], minutes: 2, noPlan: true });
  const before = G.st.nav.alert;
  G.mode.around = 'errors';
  await listeners['near-refresh:click']?.(); await flush();
  await advance(10e3);
  const after = G.st.nav.alert;
  ok(`A4c S-1b: hata dizisi son iyi listeyi silmez (uyarı istasyonu korunur: ${before?.id} → ${after?.id})`, !!before?.id && after?.id === before.id && r.n >= 1, JSON.stringify({ before, after }));
}
{ // A5: başarılı arama, normal pil, navigasyon açık, 90 km/h: 15 dk / 10 km tazelemesi
  const r = await nearbyRun({ mode: 'ok', soc: 70, stations: [station('n1', 3), station('n2', 9)] });
  budget['A5 nearby başarılı sürüş'] = r.n;
  ok(`A5 nearby başarılı, 90 km/h: 60 dk'da ≤ 10 arama (10 km / 15 dk tazelemesi): ${r.n}`, r.n >= 1 && r.n <= 10, String(r.n));
}

// =====================================================================================================================
// B) SAATLİK BÜTÇE — navigasyon açık, plan yüklü, 90 km/h, 60 sanal dakika
// =====================================================================================================================
async function aheadRun(mode) {
  resetWorld();
  for (const k of ['weather', 'traffic']) G.mode[k] = mode;
  const A = await fresh('../js/nav/ahead.js');
  A.initAhead();
  startDriving();
  await advance(HOUR);
  return { weather: count('weather'), traffic: count('traffic'), same: Math.max(maxSameInstant('weather'), maxSameInstant('traffic')) };
}
for (const mode of ['ok', 'fail', 'fatal']) {
  const r = await aheadRun(mode);
  budget[`B1 ahead hava (${mode})`] = r.weather; budget[`B1 ahead trafik (${mode})`] = r.traffic;
  // yağış 10 dk + plan havası 20 dk (ikisi de fetchWeather / Open-Meteo) → ≤ 7 + 3; trafik (ücretli rota isteği) 10 dk → ≤ 7
  ok(`B1 ahead (${mode}): Open-Meteo 60 dk'da ≤ 10 (yağış 10 dk + plan havası 20 dk): ${r.weather}`, r.weather >= 1 && r.weather <= 10, String(r.weather));
  ok(`B1 ahead (${mode}): trafik (ücretli rota isteği) 60 dk'da ≤ 7 (10 dk): ${r.traffic}`, r.traffic >= 1 && r.traffic <= 7, String(r.traffic));
  ok(`B1 ahead (${mode}): aynı anda üst üste istek yok`, r.same <= 2, String(r.same)); // yağış + plan havası aynı tick'e düşebilir
}

async function livePlanRun({ mode = 'ok', premium = false, soc = 70 }) {
  resetWorld({ premium, soc });
  G.mode.occupancy = mode; G.mode.replan = 'ok';
  const L = await fresh('../js/routing/livePlan.js');
  L.initLivePlan();
  startDriving();
  // pil plan beklentisini izler (sapma yok): yeniden plan yalnız 25 km tazelemesiyle
  setInterval(() => { const p = G.st.plan; G.eff = { ...G.eff, soc: Math.max(5, (p.fromSoc ?? 80) - ((km - (p.fromKm ?? 0)) * 0.18 / 73) * 100) }; }, 5000);
  await advance(HOUR);
  return { occ: count('occupancy'), replan: count('replan') };
}
for (const [label, o, maxOcc] of [['ücretsiz', {}, 13], ['Premium', { premium: true }, 31], ['Premium düşük pil', { premium: true, soc: 15 }, 61]]) {
  for (const mode of ['ok', 'fail']) {
    const r = await livePlanRun({ ...o, mode });
    budget[`B2 livePlan doluluk ${label} (${mode})`] = r.occ;
    ok(`B2 livePlan ${label} (${mode}): doluluk 60 dk'da ≤ ${maxOcc}: ${r.occ}`, r.occ >= 1 && r.occ <= maxOcc, String(r.occ));
    if (mode === 'ok' && label === 'ücretsiz') {
      budget['B2 livePlan yeniden plan (25 km)'] = r.replan;
      ok(`B2 livePlan: sapmasız 90 km'de yeniden plan ≤ 4 (25 km tazelemesi, 45 sn soğuma): ${r.replan}`, r.replan >= 1 && r.replan <= 4, String(r.replan));
    }
  }
}

async function speedLimitRun(mode) {
  resetWorld();
  G.mode.speedlimit = mode;
  now += 7 * HOUR; // cache.js bellek önbelleği modül örnekleri arasında ortak: önceki senaryonun hücreleri (TTL.long 6 sa) düşsün
  const S = await fresh('../js/nav/speedLimit.js');
  S.initSpeedLimit();
  startDriving();
  await advance(HOUR);
  return count('speedlimit');
}
for (const [mode, max] of [['ok', 90], ['fail', 90], ['fatal', 7]]) {
  const n = await speedLimitRun(mode);
  budget[`B3 yol limiti (${mode})`] = n;
  ok(`B3 speedLimit (${mode}): 60 dk / 90 km'de ≤ ${max} sorgu (20 sn + 1 km${mode === 'fatal' ? ' + fatalde 10 dk bekleme' : ''}): ${n}`, n >= 1 && n <= max, String(n));
}

async function roadWarnRun(mode) {
  resetWorld();
  G.mode.cameras = mode;
  const W = await fresh('../js/nav/roadWarnings.js');
  W.initRoadWarnings();
  startDriving();
  await advance(HOUR);
  return count('cameras');
}
for (const mode of ['ok', 'fail']) {
  const n = await roadWarnRun(mode);
  budget[`B4 hız kameraları (${mode})`] = n;
  ok(`B4 roadWarnings (${mode}): rota başına tek kamera sorgusu (hata yeniden denenmez): ${n}`, n === 1, String(n));
}
async function roadExtrasRun(mode) { // v0.99.118: OSM ekstraları (köprü/alt geçit/gişe) rota başına en çok BİR toplu sorgu; hata yeniden denenmez
  resetWorld();
  G.mode.roadExtras = mode;
  const W = await fresh('../js/nav/roadWarnings.js');
  W.initRoadWarnings();
  startDriving();
  await advance(HOUR);
  return count('roadExtras');
}
for (const mode of ['ok', 'fail']) {
  const n = await roadExtrasRun(mode);
  budget[`B4b yol ekstraları (${mode})`] = n;
  ok(`B4b roadWarnings (${mode}): rota başına tek ekstra (köprü/alt geçit/gişe) sorgusu (hata yeniden denenmez): ${n}`, n === 1, String(n));
}

{ // B5: rotadan çıkınca yeniden rota, rota sağlayıcısı sürekli başarısız (internet yok / sağlayıcı hatası)
  resetWorld();
  globalThis.__spoken = [];
  G.mode.reroute = 'ok'; // stub false döner: "alınamadı"
  const Nv = await fresh('../js/nav/navigator.js');
  let inited = true;
  try { Nv.initNavigator(); } catch (err) { inited = false; console.log('   (initNavigator) ' + err.message); }
  ok('B5 navigator gerçek kodu sahte DOM ile başlatıldı', inited);
  startDriving({ offRoute: true });
  await advance(HOUR);
  const n = count('reroute');
  budget['B5 yeniden rota (sürekli başarısız)'] = n;
  ok(`B5 navigator: yeniden rota aynı anda üst üste yok ve ≤ 300/saat (12 sn yeniden deneme tavanı): ${n}`, maxSameInstant('reroute') <= 1 && n <= 300, String(n));
  // N-1 (v0.99.93, eskiden KNOWN-GAP: 12 sn sabit ≈ 277/saat): 12 → 24 → 48 → en çok 60 sn; ses sapma bölümü başına bir kez
  ok(`B5 N-1: başarısız yeniden rota geri çekilir, 60 dk'da ≤ 65 (eskiden ≈ 277): ${n}`, n >= 30 && n <= 65, `${n}/saat`);
  const g5 = G.calls.filter((c) => c.kind === 'reroute').map((c) => c.t).map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x != null);
  ok('B5 N-1: ardışık aralıklar 12 sn\'den büyür, en çok 60 sn (+1 sn tik)', g5.length >= 3 && g5[0] >= 12e3 && g5[0] <= 13e3 && g5.every((d, i) => d <= 61e3 && (i === 0 || d >= g5[i - 1] - 1e3)) && Math.max(...g5) >= 59e3, JSON.stringify(g5.slice(0, 6).map((d) => Math.round(d / 1000))));
  const said = globalThis.__spoken.filter((k) => k === 'reroute').length;
  ok(`B5 N-1b: "Rota yeniden hesaplanıyor" sesi sapma bölümü başına 1 (eskiden her denemede): ${said}`, said === 1, String(said));
}

ok('A/B bölümlerinde gerçek ağ (fetch/XHR/WebSocket/EventSource) çağrısı yok', realFetchCalls.length === 0, realFetchCalls.slice(0, 3).join(', '));

// =====================================================================================================================
// C) HARİTA KAROSU / HARİTA YÜKLEMESİ — kod değişmezleri (karolar Worker'da: sayılamaz, gerçek sayım G3 cihazda)
// =====================================================================================================================
{
  const mv = strip(read('js/ui/mapView.js'));
  const eng = strip(read('js/ui/maps/mapEngine.js'));
  const maps = ['mapbox', 'google', 'tomtom', 'here', 'maplibre'].map((n) => [n, strip(read(`js/ui/maps/${n}.js`))]);
  ok('C1 vektör harita nesnesi tek yerde oluşturulur (mapEngine.js: tek `new lib.Map`)', (eng.match(/new lib\.Map\(/g) || []).length === 1 && maps.every(([n, s]) => n === 'google' || !/new [A-Za-z.]*Map\(/.test(s)));
  ok('C1 Google haritası tek `new GMap(` (bağdaştırıcıda)', (maps.find(([n]) => n === 'google')[1].match(/new GMap\(/g) || []).length === 1);
  ok('C2 harita açılışı sayfa başına bir kez: boot() hazırsa çıkar, eşzamanlı çağrı aynı sözü paylaşır (booting ??=)', /boot = async \(\) => \{\s*if \(adapter\) return;\s*booting \?\?=/.test(mv));
  ok('C2 boot() yalnız initMap sonunda bir kez çağrılır (zamanlayıcı/olayla yeniden açılış yok)', (mv.match(/\bboot\(\)/g) || []).length === 1 && !/set(Interval|Timeout)\([^)]*boot/.test(mv));
  ok('C3 ücretli harita kimlik hatası → oturum boyu OpenFreeMap (forceOsm) + en çok bir yenileme; mapConfig osmForced ise sunucuya sorulmaz',
    (mv.match(/fallBackToOsm\(\); if \(shown\) setTimeout\(\(\) => location\.reload\(\), 1500\)/g) || []).length === 4 && /if \(osmForced\(\) \|\| !hasCreds\(\)\) return/.test(strip(read('js/net/mapConfig.js'))));
  ok('C4 uydu aç/kapa yeni harita oluşturmaz: Mapbox/TomTom setStyle, aynı değerde yeniden yüklenmez', ['mapbox', 'tomtom', 'here'].every((n) => { const s = maps.find(([m]) => m === n)[1]; return /if \(!!want === on\) return;/.test(s) && /map\.setStyle\(/.test(s); }));
  ok('C5 harita bağdaştırıcılarında zamanlayıcıyla periyodik yeniden yükleme yok (setInterval yok)', maps.every(([, s]) => !/setInterval\(/.test(s)) && !/setInterval\(/.test(eng));
  ok('C6 takip kamerası araç durunca (≤ 2 m, dönüş/zoom yok) haritayı oynatmaz → yeni karo isteği tetiklemez', /if \(still\) return;/.test(mv) && /< 2 && Math\.abs\(center\.lon - lf\.lon\)/.test(mv));
  ok('C7 kota duraklatmasında yerel boş stil (createMapLibreMap paused): sağlayıcı betiği/karosu ve /v1/map/config istenmez', /if \(providerRequestsPaused\(\)\) \{[\s\S]{0,300}createMapLibreMap\(mapEl, \{ paused: true \}\)/.test(mv));
  ok('C8 kayıtlı sağlayıcı osm iken açılış sunucuyu beklemez (arka planda yalnız ad tazelenir)', /if \(savedProvider\(\) === 'osm'\) \{/.test(strip(read('js/net/mapConfig.js'))));
}

// ---------------------------------------------------------------------------------------------------------------------
console.log('\n   Saatlik istek bütçesi (60 sanal dk, 90 km/h, navigasyon açık; sağlayıcı sahte):');
for (const [k, v] of Object.entries(budget)) console.log(`     ${k.padEnd(48)} ${String(v).padStart(4)}`);
console.log(`\n${pass} geçti, ${fail} kaldı${gaps ? ` (${gaps} KNOWN-GAP)` : ''}`);
process.exit(fail ? 1 : 0);
