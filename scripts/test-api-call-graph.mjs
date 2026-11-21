// R5 G0 — TÜM SAĞLAYICI API İSTEK YÖNETİŞİMİ: kanıta dayalı çağrı grafiği + gereksiz ağ çağrısı regresyon kapısı.
// node scripts/test-api-call-graph.mjs   (çevrimdışı; gerçek ağ yok, gerçek anahtar yok; uygulama davranışı DEĞİŞTİRİLMEZ)
//
// Belge: docs/api-call-graph.md (bu testin her bölümü oradaki tabloların kanıtıdır).
// D2-T0 envanteri (scripts/test-d2-quota-inventory.mjs: koruma sabitleri, SOC güven kapısı, duraklatma kapıları, sunucu sayaçları)
// burada TEKRARLANMAZ; bu dosya onun üstüne üç kilit ve bir davranış simülasyonu ekler:
//   A) SINK MANİFESTOSU — js/** + sw.js içindeki her ağ ilkel çağrısı (fetch/proxyFetch/proxyFetchRetry/mbfetch/XHR/WebSocket/
//      EventSource/sendBeacon/importScripts) dosya başına SAYIYLA sabitlenir. Yeni çağrı noktası ya da yeni dosya → FAIL: önce
//      docs/api-call-graph.md'de tetikleyici + koruma ile sınıflandırılır, sonra manifest güncellenir (mekanik, iki yönlü eşitlik).
//   B) SICAK YOL KAPANIŞI — GPS (gps.js), OCR (ocr.js/ocrLoop.js), SOC (socEstimate.js), state.js, driveGuard/course/avgSpeed modüllerinden
//      statik içe aktarma kapanışında ulaşılabilen ağ dosyaları tam olarak beklenen küme (yalnız meter.js → proxy.js proxyBase).
//   C) DİNLEYİCİ KİLİDİ — subscribe('live'|'sim'|'ocr') kayıtları dosya başına sayıyla sabitlenir; dinleyici dosyalarında ağ ilkeli yok.
//   D) DAVRANIŞ — sanal saatle 30 dk sürüş: GPS 1 Hz, OCR kabulü 5 sn, menzil motoru 1 sn, ABRP telemetrisi; fetch sayılır.
//   E) KNOWN-GAP — bugün kanıtlanan gereksiz istek yolları (düzelten görev knownGap satırını ok(...) kabul denetimine çevirir).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0, gaps = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const knownGap = (id, name, present, extra = '') => {
  if (present) { pass++; gaps++; console.log(`ok  KNOWN-GAP ${id}: ${name}${extra ? ' (' + extra + ')' : ''}`); } else { fail++; console.log(`FAIL GAP CLOSED ${id}: ${name} — knownGap satırını kabul denetimine (ok) çevirin${extra ? ' — ' + extra : ''}`); }
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const read = (r) => readFileSync(join(ROOT, r), 'utf8');
/** Yorumlar çıkarılır (blok yorumlar + yalnız yorum olan satırlar); dizgelerdeki "//" (URL) korunur. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
const APP_FILES = [...walk(join(ROOT, 'js')).filter((p) => !rel(p).startsWith('js/i18n/lang/')), join(ROOT, 'sw.js')].map(rel).sort();

// =====================================================================================================================
// A) SINK MANİFESTOSU
// =====================================================================================================================
const SINKS = {
  fetch: /(?<![\w.$])fetch\(/g, // çıplak fetch( (window.fetch = … sarmalayıcı ataması sayılmaz)
  proxyFetch: /(?<!function )\bproxyFetch\(/g,
  proxyFetchRetry: /(?<!function )\bproxyFetchRetry\(/g,
  mbfetch: /(?<!function )\bmbfetch\(/g,
  xhr: /\bXMLHttpRequest\b/g,
  websocket: /\bnew WebSocket\b/g,
  eventsource: /\bEventSource\b/g,
  beacon: /\bsendBeacon\b/g,
  importScripts: /\bimportScripts\(/g,
};
// dosya → { ilkel: sayı } ; sınıf/tetikleyici/koruma için docs/api-call-graph.md §2
const MANIFEST = {
  'js/abrp/telemetry.js': { fetch: 3 }, // ABRP iternio + kullanıcı webhook'u; 60 sn zamanlayıcı, Premium + açık + kullanıcı token'ı
  'js/account/auth.js': { fetch: 1, proxyFetch: 2 }, // kendi sunucu: giriş yoklaması, /v1/auth/logout, /v1/me
  'js/account/community.js': { proxyFetch: 1 }, // kendi sunucu: topluluk bildirimi (kullanıcı eylemi)
  'js/account/historySync.js': { proxyFetch: 1 }, // kendi sunucu: /v1/history
  'js/account/stationInfo.js': { proxyFetch: 6 }, // kendi sunucu: /v1/station/info, /v1/station/photo (kart açılınca / kullanıcı)
  'js/account/sync.js': { proxyFetch: 2 }, // kendi sunucu: /v1/sync (SYNC_KEYS sessiz olmayan kayıt → 4 sn gecikmeli; 10 dk çekme)
  'js/google/chargers.js': { proxyFetchRetry: 1 }, // ücretli: /google/stations (Premium)
  'js/here/chargers.js': { proxyFetchRetry: 1 }, // ücretli: /here/stations
  'js/mapbox/api.js': { fetch: 1, proxyFetch: 1, proxyFetchRetry: 1 }, // ücretli: api.mapbox.com (kişisel mbKey) ya da /mapbox/
  'js/mapbox/chargers.js': { mbfetch: 2 }, // ücretli: Mapbox arama
  'js/mapbox/route.js': { mbfetch: 1 }, // ücretli: Mapbox rota (R4 Premium kapısı)
  'js/mapbox/test.js': { mbfetch: 2 }, // ücretli: ayarlarda anahtar sınama (kullanıcı eylemi)
  'js/nav/limitSpans.js': { proxyFetch: 1 }, // sunucu üzerinden sağlayıcı: /v1/speedlimits
  'js/net/mapConfig.js': { proxyFetch: 1 }, // /v1/map/config
  'js/net/proxy.js': { fetch: 2, proxyFetch: 2 }, // taban sarmalayıcı + /v1/config
  'js/osm/chargers.js': { fetch: 2, proxyFetchRetry: 2 }, // Overpass / OCM (doğrudan ya da /overpass, /ocm/poi)
  'js/osm/elevation.js': { fetch: 1 }, // açık servis: yükselti
  'js/osm/search.js': { fetch: 2 }, // Photon / Nominatim (kullanıcı yazınca, haritadan seçince)
  'js/osm/valhalla.js': { fetch: 1 }, // Valhalla: rota, durak erişim sorgusu, hız limiti
  'js/osm/weather.js': { fetch: 1 }, // Open-Meteo
  'js/routing/occupancyClient.js': { proxyFetch: 1 }, // /v1/occupancy
  'js/routing/tariffs.js': { proxyFetch: 1 }, // kendi sunucu: /v1/tariffs (önbellek)
  'js/routing/tesla.js': { proxyFetch: 1 }, // /v1/tesla
  'js/tomtom/route.js': { proxyFetch: 1 }, // ücretli: /tomtom/route (Premium)
  'js/ui/historyPanel.js': { proxyFetch: 1 }, // kendi sunucu: /v1/price (kullanıcı eylemi)
  'js/ui/mapChoice.js': { proxyFetch: 2 }, // kendi sunucu: /v1/providers (salt okunur katalog) + /v1/map/choice (kullanıcı eylemi; yalnızca Premium kartı)
  'js/ui/stationCard.js': { proxyFetch: 1 }, // kendi sunucu: /v1/price (kullanıcı eylemi)
  'js/ui/versionInfo.js': { fetch: 1 }, // aynı köken: version.js
  'sw.js': { fetch: 2, importScripts: 1 }, // service worker: aynı köken önbellek/geçiş
};
const found = {};
const srcCache = new Map();
const appSrc = (f) => { if (!srcCache.has(f)) srcCache.set(f, strip(read(f))); return srcCache.get(f); };
for (const f of APP_FILES) {
  const c = {};
  for (const [k, re] of Object.entries(SINKS)) { const n = (appSrc(f).match(re) || []).length; if (n) c[k] = n; }
  if (Object.keys(c).length) found[f] = c;
}
ok(`taranan uygulama dosyası > 150 (js/** + sw.js, i18n dil tabloları hariç): ${APP_FILES.length}`, APP_FILES.length > 150);
for (const f of Object.keys(found)) ok(`sink ${f} manifestoda ve sayılar eşit ${JSON.stringify(found[f])}`, JSON.stringify(found[f]) === JSON.stringify(MANIFEST[f]), `manifest ${JSON.stringify(MANIFEST[f] || null)} — yeni/değişen ağ çağrısı: docs/api-call-graph.md §2'de sınıflandırıp manifesti güncelleyin`);
for (const f of Object.keys(MANIFEST)) if (!found[f]) ok(`manifest satırı ${f} hâlâ ağ ilkeli içeriyor`, false, 'çağrı kaldırıldıysa manifest ve belge güncellenmeli');
ok('manifest dosya sayısı = bulunan (29)', Object.keys(found).length === Object.keys(MANIFEST).length && Object.keys(MANIFEST).length === 29, `${Object.keys(found).length}/${Object.keys(MANIFEST).length}`);
ok('XHR / WebSocket / EventSource / sendBeacon hiçbir uygulama dosyasında yok (yalnız fetch ailesi)', !Object.values(found).some((c) => c.xhr || c.websocket || c.eventsource || c.beacon));
// fetch sarmalayıcıları (window.fetch = …): yalnız sayaç ve kota kapısı; ikisi de isteği çoğaltmaz
const WRAP = /\b(?:window|target)\.fetch\s*=/;
const wrappers = APP_FILES.filter((f) => WRAP.test(appSrc(f)));
ok(`fetch sarmalayıcıları tam olarak meter.js + providerGate.js: ${wrappers.join(', ')}`, wrappers.join() === 'js/net/meter.js,js/net/providerGate.js');
ok('meter.js sarmalayıcısı isteği bir kez iletir (origFetch tek çağrı, tekrar yok)', (appSrc('js/net/meter.js').match(/origFetch\(/g) || []).length === 1);
ok('providerGate sarmalayıcısı engellenen isteği alttaki fetch\'e iletmez (reject önce, inner.call sonra)', /if \(reason\) \{[\s\S]*?return Promise\.reject\(err\);\s*\}\s*return inner\.call\(target, input, init\);/.test(appSrc('js/net/providerGate.js')));
// tüm harici kökenler kod içinde sabit (tek yer): yeni ana makine eklenirse belge güncellenir
const HOSTS = new Set();
for (const f of APP_FILES) for (const m of appSrc(f).matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/'"`?])/g)) HOSTS.add(m[1]);
// Tam küme (iki yönlü): yeni köken eklenirse ya da biri kalkarsa docs/api-call-graph.md §2 ile birlikte güncellenir.
const EXPECTED_HOSTS = ['api.iternio.com', 'api.mapbox.com', 'api.open-meteo.com', 'api.openchargemap.io', 'api.tomtom.com', 'evcopilot.duckdns.org', 'maps.googleapis.com', 'maps.hereapi.com', 'nominatim.openstreetmap.org', 'overpass-api.de', 'overpass.kumi.systems', 'overpass.private.coffee', 'photon.komoot.io', 'server.arcgisonline.com', 'tiles.openfreemap.org', 'valhalla1.openstreetmap.de', 'www.google.com'];
const hostList = [...HOSTS].sort();
ok(`koddaki https ana makineleri tam olarak beklenen ${EXPECTED_HOSTS.length} köken`, hostList.join() === EXPECTED_HOSTS.join(), hostList.join(' '));

// =====================================================================================================================
// B) SICAK YOL KAPANIŞI (statik içe aktarma grafiği)
// =====================================================================================================================
const importsOf = (f) => [...appSrc(f).matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm)]
  .map((m) => m[1] || m[2] || m[3]).filter((s) => s.startsWith('.')).map((s) => rel(resolve(dirname(join(ROOT, f)), s)));
function closure(roots) {
  const seen = new Set(); const st = [...roots];
  while (st.length) { const f = st.pop(); if (seen.has(f)) continue; seen.add(f); try { st.push(...importsOf(f)); } catch { /* yoksa atla */ } }
  return seen;
}
const HOT = {
  'js/sensors/gps.js': [], 'js/state.js': [], 'js/sensors/driveGuard.js': [], 'js/nav/course.js': [], 'js/nav/avgSpeed.js': [],
  'js/sensors/ocrLoop.js': [], 'js/sensors/ocrConsensus.js': [], 'js/sensors/outlierFilter.js': [], 'js/sensors/digitRecognizer.js': [],
  'js/sensors/binarize.js': [], 'js/sensors/frameQuality.js': [], 'js/sensors/preprocess.js': [],
  'js/sensors/ocr.js': ['js/net/proxy.js'], 'js/physics/socEstimate.js': ['js/net/proxy.js'],
};
for (const [root, expect] of Object.entries(HOT)) {
  const reach = [...closure([root])].filter((f) => found[f] || MANIFEST[f]).sort();
  ok(`sıcak yol ${root}: ulaşılan ağ dosyaları = [${expect.join(', ')}]`, reach.join() === expect.join(), reach.join(', '));
}
ok('OCR→ağ tek köprü: ocr.js meter.js\'ten yalnız countOcrEngineOnce alır (yerel tahmin, istek yok)', /import \{ countOcrEngineOnce \} from '\.\.\/net\/meter\.js';/.test(appSrc('js/sensors/ocr.js')) && !/fetch|proxyBase/.test(appSrc('js/sensors/ocr.js').replace(/import[^\n]*\n/g, '')));
ok('meter.js proxy.js\'ten yalnız proxyBase alır (sınıflandırma; istek atmaz)', /import \{ proxyBase \} from '\.\/proxy\.js';/.test(appSrc('js/net/meter.js')) && !/proxyFetch/.test(appSrc('js/net/meter.js')));
ok('countOcrEngineOnce: yalnız yerel sayaç (load/save/addEstimate), ağ yok', (() => { const b = appSrc('js/net/meter.js'); const i = b.indexOf('export function countOcrEngineOnce'); const body = b.slice(i, b.indexOf('\n}', i)); return i > 0 && !/fetch|proxy/i.test(body); })());
ok('OCR motoru (Tesseract) yerel vendor/ dosyalarından, CDN yok; işçi tek kez kurulur (workerPromise ||=)', /new URL\('\.\.\/\.\.\/vendor\/tesseract\/', import\.meta\.url\)/.test(appSrc('js/sensors/ocr.js')) && /workerPromise \|\|= /.test(appSrc('js/sensors/ocr.js')));
ok('SOC tahmini kalıcı kaydı sessiz (hesap eşitlemesi tetiklemez)', /save\(STORE_KEY, [^\n]*\{ silent: true \}\);/.test(appSrc('js/physics/socEstimate.js')));
ok('son konum kaydı (mapView lastPos) sessiz ve 30 sn seyrek', /Date\.now\(\) - lastSaved < 30000\) return;[\s\S]{0,200}save\(LAST_POS, [^\n]*\{ silent: true \}\);/.test(appSrc('js/ui/mapView.js')));

// =====================================================================================================================
// C) DİNLEYİCİ KİLİDİ — GPS/Test Modu/OCR durum değişimini dinleyen her kayıt (dosya → kayıt sayısı)
// =====================================================================================================================
const LISTEN = {};
for (const f of APP_FILES) {
  for (const m of appSrc(f).matchAll(/\bsubscribe\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
    const slices = m[1].match(/[A-Za-z]+/g) || [];
    if (slices.some((s) => s === 'live' || s === 'sim' || s === 'ocr')) LISTEN[f] = (LISTEN[f] || 0) + 1;
  }
}
const EXPECTED_LISTEN = {
  'js/nav/freeDrive.js': 1, 'js/physics/socEstimate.js': 1, 'js/ui/abrpPanel.js': 1, 'js/ui/avgSpeedView.js': 1, 'js/ui/cameraPanel.js': 2,
  'js/ui/cards.js': 1, 'js/ui/defaultStart.js': 1, 'js/ui/gpsControl.js': 1, 'js/ui/mapView.js': 2, 'js/ui/roiBox.js': 2, 'js/ui/routeForm.js': 1,
  'js/ui/shell.js': 1, 'js/ui/socBar.js': 1, 'js/ui/socInput.js': 1, 'js/ui/statusBadges.js': 3, 'js/ui/testPanel.js': 1,
};
const sortObj = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
ok(`live/sim/ocr dinleyicileri sabit (${Object.keys(LISTEN).length} dosya); yeni dinleyici → belge §3'te ağ etkisi incelenip eklenir`, sortObj(LISTEN) === sortObj(EXPECTED_LISTEN), sortObj(LISTEN));
const listenNet = Object.keys(LISTEN).filter((f) => MANIFEST[f]);
ok('dinleyici dosyalarının hiçbiri ağ ilkeli içermez', listenNet.length === 0, listenNet.join(', '));
ok('defaultStart: Konumum A noktası 100 m altı değişimde yeniden yazılmaz, plan/nav/Test Modu sırasında donuk', /haversineKm\(last, e\) < 0\.1/.test(appSrc('js/ui/defaultStart.js')) && /const frozen = \(\) =>/.test(appSrc('js/ui/defaultStart.js')));
ok('rota değişimi plan yokken ağ çağırmaz (controller.refresh: !raw → dön; yerel computePlan)', /function refresh\(\) \{\s*if \(!raw \|\| getState\('plan'\)\.status === 'loading'\) return;/.test(appSrc('js/routing/controller.js')));
ok('ters adres (reverseLabel) yalnız haritaya dokunuşta (onMapClick), GPS setPoint yolunda yok', (appSrc('js/ui/mapView.js').match(/reverseLabel\(/g) || []).length === 1 && /function onMapClick[\s\S]*?reverseLabel\(/.test(appSrc('js/ui/mapView.js')));

// =====================================================================================================================
// D) DAVRANIŞ — sanal saat, sahte DOM/konum, fetch sayacı. GPS 1 Hz + OCR 5 sn + menzil motoru 1 sn + ABRP 60 sn.
// =====================================================================================================================
const realSetImmediate = setImmediate;
let now = Date.UTC(2026, 10, 16, 8, 0, 0);
Date.now = () => now;
Object.defineProperty(globalThis, 'performance', { value: { now: () => now, mark() {}, measure() {} }, configurable: true, writable: true });
const timers = new Map(); let tseq = 1;
globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = tseq++; timers.set(id, { fn, at: now + Math.max(0, +ms || 0), every: 0, a }); return id; };
globalThis.setInterval = (fn, ms = 0, ...a) => { const id = tseq++; const every = Math.max(1, +ms || 1); timers.set(id, { fn, at: now + every, every, a }); return id; };
globalThis.clearTimeout = globalThis.clearInterval = (id) => { timers.delete(id); };
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => realSetImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
    if (!next) { now = end; await flush(); return; }
    const [id, t] = next;
    now = t.at;
    if (t.every) t.at += t.every; else timers.delete(id);
    try { await t.fn(...t.a); } catch (err) { console.log('   (zamanlayıcı hatası) ' + err.message); }
    await flush();
  }
}

const calls = []; // { host, path, t }
let weatherMode = 'ok';
const fakeHourly = () => { const h0 = Math.floor(now / 3600e3) * 3600; const time = Array.from({ length: 72 }, (_, i) => h0 + i * 3600); return { time, temperature_2m: time.map(() => 12), precipitation: time.map(() => 0), wind_speed_10m: time.map(() => 5), wind_direction_10m: time.map(() => 270), weather_code: time.map(() => 1) }; };
globalThis.fetch = async (input, init = {}) => {
  const u = new URL(typeof input === 'string' ? input : input.url, 'http://app.test/');
  calls.push({ host: u.host, path: u.pathname, t: now });
  if (u.host === 'api.open-meteo.com') {
    if (weatherMode === 'fail') throw new TypeError('fetch failed (sahte: ağ yok)');
    const n = (u.searchParams.get('latitude') || '').split(',').length;
    const body = n > 1 ? Array.from({ length: n }, () => ({ hourly: fakeHourly() })) : { hourly: fakeHourly() };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (u.host === 'api.iternio.com') return new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
};
for (const k of ['XMLHttpRequest', 'WebSocket', 'EventSource']) globalThis[k] = class { constructor() { calls.push({ host: k, path: '', t: now }); throw new Error(k + ' yasak'); } };

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; }, clear: () => store.clear() };
const noop = () => {};
let premium = false;
const fakeEl = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, getContext: () => null, append: noop, appendChild: noop, addEventListener: noop, setAttribute: noop, remove: noop, width: 0, height: 0 });
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.location = { origin: 'http://app.test', href: 'http://app.test/', protocol: 'http:', host: 'app.test', hostname: 'app.test', search: '' };
globalThis.document = {
  visibilityState: 'visible', hidden: false,
  body: { classList: { contains: (c) => c === 'is-premium' && premium, add: noop, remove: noop, toggle: noop }, append: noop, appendChild: noop },
  head: { append: noop, appendChild: noop }, documentElement: { lang: 'tr', dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, style: { setProperty: noop } },
  createElement: fakeEl, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, dispatchEvent: () => true,
};
let gpsCb = null;
Object.defineProperty(globalThis, 'navigator', { value: { geolocation: { watchPosition(cb) { gpsCb = cb; return 1; }, clearWatch: noop, getCurrentPosition: noop }, userAgent: 'node-test', language: 'tr', languages: ['tr'] }, configurable: true, writable: true });

const realWarn = console.warn; let warns = 0;
console.warn = () => { warns++; };
const { getState, patch } = await import('../js/state.js');
const { onSave } = await import('../js/utils/storage.js');
const { SYNC_KEYS } = { SYNC_KEYS: ['places', 'recentDest', 'vehicle', 'consAdj', 'chargerMin', 'minStopAdd', 'tolerance', 'maxChargeTo', 'allowSlow', 'minArrival', 'cruise', 'planMode', 'voiceOn', 'lowSoc', 'speedAlert', 'headingUp', 'limitOn', 'operators', 'kCal', 'hist', 'customStations', 'stationOps', 'nearRadius', 'nearAc', 'brandPref'] };
ok('SYNC_KEYS kopyası account/sync.js ile aynı (eşitleme tetikleyen anahtarlar)', appSrc('js/account/sync.js').includes(SYNC_KEYS.map((k) => `'${k}'`).slice(0, 11).join(', ')) && (appSrc('js/account/sync.js').match(/export const SYNC_KEYS = \[([\s\S]*?)\];/)?.[1].match(/'[^']+'/g) || []).length === SYNC_KEYS.length);
const syncSaves = {};
onSave((k) => { if (SYNC_KEYS.includes(k)) syncSaves[k] = (syncSaves[k] || 0) + 1; });
const { startGps } = await import('../js/sensors/gps.js');
const { initSocEstimate } = await import('../js/physics/socEstimate.js');
const { initRangeEngine } = await import('../js/physics/rangeEngine.js');
const { initTelemetry } = await import('../js/abrp/telemetry.js');
initSocEstimate();
initRangeEngine();
initTelemetry();
startGps();
ok('sahte konum izleyicisi bağlandı', typeof gpsCb === 'function');

// sürüş: enlem 41, doğuya 90 km/h (≈ 0.0002976°/sn), pil her 240 sn'de (≈ 6 km) %1 düşer; OCR her 5 sn aynı değeri kabul eder
let lon = 29, soc = 80, tDrive = 0, gpsOn = true, moving = true;
setInterval(() => {
  if (!gpsOn) return;
  tDrive++;
  if (moving) lon += 0.0002976;
  gpsCb({ timestamp: now, coords: { latitude: 41, longitude: lon, accuracy: 6, altitude: 100, speed: moving ? 25 : 0, heading: moving ? 90 : null } });
}, 1000);
let ocrReads = 0;
setInterval(() => {
  if (!gpsOn) return;
  if (tDrive > 0 && tDrive % 240 === 0) soc--;
  ocrReads++;
  patch('ocr', { raw: soc, accepted: soc, status: 'ok', lastOkAt: now, readAt: now, stale: false, reliability: 1 });
  patch('live', { soc });
}, 5000);

// D1: 30 dk, oturum yok, ABRP kapalı, hava başarılı
const c0 = calls.length;
await advance(30 * 60e3);
const d1 = calls.slice(c0);
const byHost = (list) => list.reduce((m, c) => ((m[c.host] = (m[c.host] || 0) + 1), m), {});
console.log(`   D1: ${tDrive} GPS konumu, ${ocrReads} OCR kabulü, istekler ${JSON.stringify(byHost(d1))}, SYNC kayıtları ${JSON.stringify(syncSaves)}`);
ok('D1 sürüş gerçekten aktı (≥ 1790 GPS konumu, ≥ 355 OCR kabulü, ≥ 40 km)', tDrive >= 1790 && ocrReads >= 355 && (lon - 29) * 84 >= 40, `${tDrive}/${ocrReads}/${((lon - 29) * 84).toFixed(1)}`);
ok('D1 GPS + OCR/SOC akışı yalnız hava isteği üretir (başka ana makine yok)', d1.every((c) => c.host === 'api.open-meteo.com'), JSON.stringify(byHost(d1)));
const wx1 = d1.filter((c) => c.host === 'api.open-meteo.com').length;
ok(`D1 hava (rangeEngine): 30 dk / ~45 km'de 1..3 istek (15 dk / 25 km koruması; 1800 tick'e rağmen): ${wx1}`, wx1 >= 1 && wx1 <= 3, String(wx1));
ok('D1 hava isteği OCR kabulüne bağlı değil (istek sayısı ≪ OCR sayısı)', wx1 * 100 < ocrReads);
const otherSync = Object.keys(syncSaves).filter((k) => k !== 'kCal' && k !== 'hist');
ok('D1 hesap eşitlemesi tetikleyen kayıtlar yalnız kCal/hist (SOC kenarına bağlı), başka ayar yok', otherSync.length === 0, otherSync.join());
ok(`D1 kCal kaydı ≤ SOC düşüş kenarı sayısı (${80 - soc}); 5 sn OCR'a bağlı değil: ${syncSaves.kCal || 0}`, (syncSaves.kCal || 0) <= 80 - soc);
ok(`D1 hist kaydı ≤ yol/5 km: ${syncSaves.hist || 0}`, (syncSaves.hist || 0) <= Math.ceil(((lon - 29) * 84) / 5));

// D2: ABRP açık (Premium + sahte token), 10 dk: gönderim 60 sn'de bir; GPS 1 Hz / OCR 5 sn sıklığı artırmaz
premium = true;
localStorage.setItem('evcp.abrp', JSON.stringify({ token: 'fake-token-0000', apikey: 'fake-apikey-0000' }));
patch('abrp', { enabled: true });
const c1 = calls.length; const ocr1 = ocrReads;
await advance(10 * 60e3);
const tl = calls.slice(c1).filter((c) => c.host === 'api.iternio.com').length;
ok(`D2 ABRP telemetrisi 10 dk'da 9..11 istek (60 sn aralık; ${ocrReads - ocr1} OCR + 600 GPS olayına rağmen): ${tl}`, tl >= 9 && tl <= 11, String(tl));
ok('D2 başka sağlayıcıya istek yok (yalnız iternio + hava)', calls.slice(c1).every((c) => c.host === 'api.iternio.com' || c.host === 'api.open-meteo.com'), JSON.stringify(byHost(calls.slice(c1))));
patch('abrp', { enabled: false });
premium = false;

// D3: araç park (hız 0, konum sabit), ABRP kapalı, 14 dk: GPS 1 Hz ve OCR 5 sn sürer; hava 15 dk korumasıyla en çok 1, başka istek yok
moving = false;
const c2 = calls.length;
await advance(14 * 60e3);
const d3 = calls.slice(c2);
ok(`D3 14 dk park, ABRP kapalı: hava ≤ 1, başka istek yok: ${JSON.stringify(byHost(d3))}`, d3.filter((c) => c.host === 'api.open-meteo.com').length <= 1 && d3.every((c) => c.host === 'api.open-meteo.com'));
moving = true;

// =====================================================================================================================
// E) KNOWN-GAP — kanıtlanan gereksiz istek yolları (W-1 G1a'da kapandı → kabul denetimleri; yeni boşluk knownGap ile eklenir)
// =====================================================================================================================
// W-1 (G1a ile KAPANDI): rangeEngine.maybeRefreshWeather hata yolunda eskiden weather.at = (önceki || 0) yazıyordu; hiç başarı yoksa
// at = 0 → koruma (w.at && …) atlanıyor ve 1 sn'lik her menzil tick'i yeni Open-Meteo isteği atıyordu (60 sn'de 60 istek).
// Şimdi: ardışık hatada üstel geri çekilme (60 sn → 2 → 4 → 8 dk, en çok 10 dk); başarı sayacı sıfırlar; 15 dk / 25 km tazelik aynı.
// Aşağıdaki denetimler sanal saatle (gerçek ağ yok) bu kabul ölçütlerini kanıtlar.
const { clearCache } = await import('../js/utils/cache.js');
const { wxRetryDelayMs, WX_RETRY_MIN_MS, WX_RETRY_MAX_MS } = await import('../js/physics/rangeEngine.js');
ok('W-1 geri çekilme sabitleri: en az 60 sn, en çok 10 dk', WX_RETRY_MIN_MS === 60e3 && WX_RETRY_MAX_MS === 10 * 60e3);
ok('W-1 wxRetryDelayMs: 0 hata → 0; 1..5 → 60/120/240/480/600 sn; 50 → 600 sn (taşma yok)',
  typeof wxRetryDelayMs === 'function' && wxRetryDelayMs(0) === 0 && [1, 2, 3, 4, 5].map(wxRetryDelayMs).join() === [60e3, 120e3, 240e3, 480e3, 600e3].join() && wxRetryDelayMs(50) === 600e3 && wxRetryDelayMs(1e6) === 600e3,
  typeof wxRetryDelayMs === 'function' ? [0, 1, 2, 3, 4, 5, 50].map(wxRetryDelayMs).join() : 'yok');
clearCache();
weatherMode = 'fail';
moving = true;
patch('weather', { temp: null, rain: null, at: 0, lat: null, lon: null });
const wxCalls = (from) => calls.slice(from).filter((c) => c.host === 'api.open-meteo.com');
const c3 = calls.length;
await advance(60e3);
const storm = wxCalls(c3).length;
ok(`W-1 hiç başarı yokken hata: 60 sn'de en çok 2 Open-Meteo isteği (eskiden 60): ${storm}`, storm >= 1 && storm <= 2, String(storm));
// 30 dk kesinti, araç hareketli (≈ 45 km, 25 km eşiği defalarca aşılır): istek sayısı üstel takvimle sınırlı
const c4 = calls.length;
await advance(30 * 60e3);
const out30 = wxCalls(c4);
const gaps30 = out30.slice(1).map((c, i) => c.t - out30[i].t);
ok(`W-1 30 dk kesinti + hareket: Open-Meteo ≤ 6 istek (eskiden ~1800): ${out30.length}`, out30.length >= 2 && out30.length <= 6, String(out30.length));
ok(`W-1 ardışık hata istekleri arası ≥ 60 sn ve azalmayan (üstel), ≤ 10 dk + 1 tick: ${gaps30.slice(0, 12).map((g) => g / 1e3).join('/')} sn`,
  gaps30.every((g, i) => g >= 60e3 && g <= 10 * 60e3 + 1e3 && (i === 0 || g >= gaps30[i - 1])), gaps30.slice(0, 12).join() + (gaps30.length > 12 ? ` … (+${gaps30.length - 12})` : ''));
// tekilleştirme: aynı anda yalnız bir istek (wxBusy) — aynı tick zamanına iki hava isteği düşmez
const tAll = wxCalls(c3).map((c) => c.t);
ok('W-1 tekilleştirme: aynı anda iki hava isteği yok', new Set(tAll).size === tAll.length);
// ağ döner: tazelik korunur — en geç bir geri çekilme süresi (≤ 10 dk) içinde yeniden istenir ve başarı kaydedilir
weatherMode = 'ok';
const c5 = calls.length; const tBack = now;
await advance(10 * 60e3 + 2e3);
const rec = wxCalls(c5);
ok(`W-1 ağ dönünce ≤ 10 dk içinde hava yeniden alınır (tazelik): ${rec.length} istek, ilk ${rec[0] ? (rec[0].t - tBack) / 1e3 + ' sn' : '-'}`, rec.length >= 1 && rec[0].t - tBack <= 10 * 60e3 + 1e3);
ok('W-1 başarı weather.at alanını yazar', getState('weather').at >= tBack);
// başarı sonrası sayaç sıfırlanır: yeni tek hata yine 60 sn bekletir (10 dk değil), sonra normal 15 dk / 25 km koruması işler
moving = false;
const tOk = getState('weather').at;
clearCache(); // 30 dk hücre önbelleği tazelemeyi ağsız karşılamasın: 15 dk dolunca istek gerçekten sahte ağa gider (ve düşer)
weatherMode = 'fail';
const c6 = calls.length;
await advance(17 * 60e3 - (now - tOk)); // tOk + 15 dk: tazeleme hatası → 60 sn bekleme → tOk + 16 dk: ikinci hata → 120 sn
const after = wxCalls(c6).map((c) => c.t);
const aGaps = after.slice(1).map((t, i) => t - after[i]);
ok(`W-1 başarıdan sonra ilk hata yeniden 60 sn'den başlar (sayaç sıfırlandı; ilk hata tOk + 15 dk): ${aGaps.slice(0, 12).map((g) => g / 1e3).join('/')} sn`, after.length >= 2 && after[0] - tOk >= 15 * 60e3 && after[0] - tOk <= 15 * 60e3 + 1e3 && aGaps[0] >= 60e3 && aGaps[0] <= 61e3, `${after.length} istek`);
ok(`W-1 bayat hava ile hata: 15 dk koruma dolduktan sonra her tick yerine geri çekilme (2 dk içinde ≤ 2 istek): ${after.length}`, after.length <= 2, String(after.length));
weatherMode = 'ok';
moving = true;

console.warn = realWarn;
ok('gerçek ağ çağrısı yok: tüm istekler sahte fetch\'e gitti, XHR/WebSocket/EventSource denenmedi', !calls.some((c) => ['XMLHttpRequest', 'WebSocket', 'EventSource'].includes(c.host)));
console.log(`\nözet: ${Object.keys(MANIFEST).length} ağ dosyası, ${Object.values(MANIFEST).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0)} çağrı noktası; dinleyici ${Object.keys(EXPECTED_LISTEN).length} dosya; bilinen boşluk ${gaps}; uyarı ${warns}`);
console.log(`${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
