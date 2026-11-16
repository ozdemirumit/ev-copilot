// D2-T0 SAĞLAYICI KOTA ENVANTERİ (salt okunur tanı + sahte veriyle davranış): node scripts/test-d2-quota-inventory.mjs
// Hangi olay (GPS konumu, OCR/SOC değişimi, zamanlayıcı, kullanıcı) hangi sağlayıcı isteğini tetikler ve isteği hangi koruma sınırlar —
// deterministik, çevrimdışı. HİÇBİR davranışı DEĞİŞTİRMEZ; server/proxy.mjs içe AKTARILMAZ (sunucu başlatır); ağ yoktur (fetch sahte),
// gerçek anahtar yoktur (sahte değerler). Kota DEĞERİ uydurulmaz: yazılan sayılar yalnızca kaynaktaki varsayılanlardır, sağlayıcı
// sayfasıyla doğrulanmamıştır; kotanın ne olması gerektiği kullanıcı kararıdır (D2-T2).
//
// Bölümler: A) tetikleyici envanteri (kaynak sabitleri; değişirse envanter güncellenmeli)  B) SOC güven kapısı (saf)
//           C) erişim sorgusu tekilleştirme (sahte probe)  D) duraklatma kapıları (istemci + sunucu, sahte fetch)
//           E) kullanıcının kendi mbKey yolu (sahte fetch; davranış sabitlenir, değiştirilmez)  F) sunucu kota sayaçları (statik)
//           G) KNOWN-GAP: bugünkü boşluklar (düzelten görev ilgili satırı ok(...) kabul denetimine çevirir; silinmez/gevşetilmez).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0, gaps = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const knownGap = (id, name, present) => {
  if (present) { pass++; gaps++; console.log(`ok  KNOWN-GAP ${id}: ${name}`); } else { fail++; console.log(`FAIL GAP CLOSED ${id}: ${name} — knownGap satırını kabul denetimine (ok) çevirin`); }
};

// ---- ağ yasak + tarayıcı taklidi (yalnız bellek) ----
let realNetCalls = 0;
const netBan = () => { realNetCalls++; throw new Error('ağ yasak'); };
globalThis.fetch = netBan;
// caps modül yüklenirken okunur: sunucu Mapbox'ı bildiriyor, ama kimlik yokken proxyHas false (E bölümü kimlikle yolu değiştirir)
const store = new Map([['evcp.proxyUrl', JSON.stringify('http://proxy.test')], ['evcp.proxyCaps', JSON.stringify({ mapbox: true })], ['evcp.deviceId', JSON.stringify('d_fakefakefakefakefake')]]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.document = { dispatchEvent() { return true; }, addEventListener() {}, getElementById() { return null; } };

const src = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
/** `const NAME = <ifade>;` → sayısal değer (yalnız sayı, *, +, e gösterimi); yoksa NaN. */
function constNum(text, name) {
  const m = text.match(new RegExp(`(?:^|\\n)\\s*(?:export )?const ${name} = ([0-9e.*+ ()]+);`));
  if (!m) return NaN;
  return Function(`return (${m[1]});`)();
}
/** `function name(` gövdesi (bir sonraki üst düzey tanıma kadar); yoksa ''. */
function fnBody(text, name) {
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return '';
  const rest = text.slice(i + 1);
  const j = rest.search(/\n(?:async )?function |\nexport |\nconst [A-Za-z_]+ = /);
  return j < 0 ? rest : rest.slice(0, j);
}

// =====================================================================================================================
// A) TETİKLEYİCİ ENVANTERİ — hiçbir GPS konumu ya da OCR okuması doğrudan istek atmaz; istekler zamanlayıcılardan gelir.
// Her satır: dosya, koruma sabiti, beklenen kaynak değeri. Sabit değişirse (ya da silinirse) bu test düşer → envanter güncellenir.
// =====================================================================================================================
const INVENTORY = [
  // [dosya, sabit, değer, tetikleyici → istek]
  ['js/routing/livePlan.js', 'CHECK_MS', 5000, 'SOC/konum zamanlayıcısı → replanFrom (yerel) → olası Valhalla erişim sorgusu'],
  ['js/routing/livePlan.js', 'COOLDOWN_MS', 45000, 'yeniden plan arası en az süre'],
  ['js/routing/livePlan.js', 'REFRESH_KM', 25, 'plan tazeleme mesafesi'],
  ['js/routing/livePlan.js', 'SOC_TOLERANCE', 4, 'SOC sapma eşiği (yalnız güvenilir kaynakta)'],
  ['js/routing/livePlan.js', 'AVAIL_EVERY_MS', 5 * 60e3, '30 sn zamanlayıcı → /v1/occupancy (Free 5 dk)'],
  ['js/routing/livePlan.js', 'AVAIL_LOW_SOC', 20, 'Premium kritik pil → 1 dk doluluk'],
  ['js/nav/navigator.js', 'OFF_ROUTE_MS', 6000, 'GPS rota dışı → rerouteFromHere (rota+yükselti+hava+istasyon)'],
  ['js/nav/navigator.js', 'FAR_OFF_KM', 0.4, 'beklemeden yeniden rota mesafesi'],
  ['js/nav/navigator.js', 'REROUTE_COOLDOWN_MS', 45000, 'yeniden rota soğuma'],
  ['js/nav/navigator.js', 'RETRY_MS', 12000, 'başarısız yeniden rota tekrar aralığı'],
  ['js/nav/ahead.js', 'CHECK_MS', 5000, 'navigasyon zamanlayıcısı'],
  ['js/nav/ahead.js', 'WEATHER_EVERY_MS', 10 * 60e3, '→ Open-Meteo yağış'],
  ['js/nav/ahead.js', 'TRAFFIC_EVERY_MS', 10 * 60e3, '→ ücretli rota isteği (TomTom/Mapbox) trafik'],
  ['js/nav/ahead.js', 'PROFILE_WX_EVERY_MS', 20 * 60e3, '→ Open-Meteo plan havası'],
  ['js/nav/speedLimit.js', 'EVERY_MS', 20000, 'GPS (hız>5) → OSM hız limiti'],
  ['js/nav/speedLimit.js', 'MOVE_KM', 1.0, 'hız limiti sorgu mesafesi'],
  ['js/nav/speedLimit.js', 'BACKOFF_MS', 10 * 60e3, 'hata sonrası bekleme'],
  ['js/nav/limitSpans.js', 'BLOCK_MS', 3600e3, '/v1/speedlimits 401/402/403/429/501 sonrası kesinti'],
  ['js/nav/nearby.js', 'REFRESH_MS', 15 * 60e3, 'yakın istasyon araması (HERE/Mapbox/Overpass/Google/OCM/Tesla)'],
  ['js/nav/nearby.js', 'REFRESH_KM', 10, 'yakın arama mesafesi'],
  ['js/nav/nearby.js', 'LOW_REFRESH_MS', 5 * 60e3, 'düşük pilde yakın arama'],
  ['js/nav/nearby.js', 'OCC_EVERY_MS', 60e3, 'düşük pilde /v1/occupancy'],
  ['js/nav/nearby.js', 'OCC_BATCH', 6, 'istek başına istasyon'],
  ['js/advisor/fallback.js', 'FALLBACK_COOLDOWN_MS', 60000, 'tüketim yedeği → replanFrom'],
  ['js/routing/stopAccess.js', 'RETRY_MS', 120000, 'başarısız Valhalla erişim sorgusu tekrar aralığı'],
  ['js/net/proxy.js', 'DOWN_COOLDOWN_MS', 20000, 'ara sunucu kapalı: yeniden deneme kesintisi'],
];
const files = new Map();
for (const [f, name, val, why] of INVENTORY) {
  if (!files.has(f)) files.set(f, src(f));
  const got = constNum(files.get(f), name);
  ok(`envanter ${f} ${name} = ${val} (${why})`, got === val, String(got));
}

const GPS = src('js/sensors/gps.js');
const SOCE = src('js/physics/socEstimate.js');
ok('GPS konum işleyicisi ağ çağırmaz (gps.js fetch/proxyFetch yok)', !/\bfetch\(|proxyFetch|mbfetch|valhalla\(/.test(GPS));
ok('OCR→SOC tahmini ağ çağırmaz (socEstimate.js fetch/proxyFetch yok)', !/\bfetch\(|proxyFetch|mbfetch|valhalla\(/.test(SOCE));
const RANGE = src('js/physics/rangeEngine.js');
const wxBody = fnBody(RANGE, 'maybeRefreshWeather');
ok('hava tazeleme (rangeEngine): yalnız canlı GPS, meşgul bayrağı, 15 dk / 25 km koruması', /wxBusy \|\| e\.source !== 'live'/.test(wxBody) && /Date\.now\(\) - w\.at < 15 \* 60e3 && moved < 25/.test(wxBody));
const CTRL = src('js/routing/controller.js');
const replanBody = fnBody(CTRL, 'replanFrom');
ok('replanFrom yerel: computePlan + applyPlan, doğrudan ağ yok', /computePlan\(/.test(replanBody) && !/fetch|await/.test(replanBody));
ok('applyPlan doğrulanmamış ileri durakta verifyStopAccess çağırır (Valhalla sorgusu tek yol)', /verifyStopAccess\(\)/.test(fnBody(CTRL, 'applyPlan')));
ok('verifyStopAccess aynı plan için tek çalışma (accessRun anahtarı)', /if \(accessRun\?\.key === key\) return accessRun\.p;/.test(CTRL));

// =====================================================================================================================
// B) SOC güven kapısı: güvenilmeyen pil kaynağı SOC sapmasıyla TEK BAŞINA yeniden plan (dolayısıyla istek) tetiklemez.
// =====================================================================================================================
const { shouldReplan, socTrusted, TRUSTED_SOC_SOURCES } = await import('../js/routing/socTrust.js');
ok('güvenilir kaynaklar tam olarak live/manual/sim', JSON.stringify(TRUSTED_SOC_SOURCES) === '["live","manual","sim"]');
for (const s of ['stale', 'estimate', 'default', 'none', undefined, 'ocr-raw']) {
  ok(`SOC sapması 30 puan, kaynak ${s}: yeniden plan YOK`, shouldReplan({ drift: 30, tolerance: 4, source: s }) === false && !socTrusted(s));
}
for (const s of ['live', 'manual', 'sim']) {
  ok(`kaynak ${s}: eşik altı (4) tetiklemez, üstü (4.1) tetikler`, shouldReplan({ drift: 4, tolerance: 4, source: s }) === false && shouldReplan({ drift: 4.1, tolerance: 4, source: s }) === true);
}
ok('geçilen durak / 25 km tazeleme kaynaktan bağımsız tetikler', shouldReplan({ passed: true, source: 'default' }) && shouldReplan({ far: true, source: 'estimate' }));
const LIVE = src('js/routing/livePlan.js');
ok('livePlan.check kapıyı kullanır: shouldReplan({ ..., source }) ve COOLDOWN_MS', /shouldReplan\(\{ passed, far, drift, tolerance: SOC_TOLERANCE, source \}\)/.test(LIVE) && /Date\.now\(\) - lastReplan < COOLDOWN_MS/.test(LIVE));
const NEAR = src('js/nav/nearby.js');
ok('nearby otomatik ara durak (goTo) socTrusted ile kapılı', /const socOk = socTrusted\(/.test(NEAR) && /planBroken && socOk && nav\.active/.test(NEAR));

// =====================================================================================================================
// C) Durak erişim sorgusu (Valhalla) tekilleştirme — sahte probe, sahte saat.
// =====================================================================================================================
const SA = await import('../js/routing/stopAccess.js');
const coords = Array.from({ length: 201 }, (_, i) => [29 + i * 0.005, 41]); // ~84 km doğu-batı düz rota (lon, lat)
const stops = [{ km: 30, station: { id: 'st-a', name: 'A', lat: 41.0005, lon: 29 + 0.005 * 71 } }, { km: 60, station: { id: 'st-b', name: 'B', lat: 41.0005, lon: 29 + 0.005 * 142 } }];
let probeCalls = 0, probeFail = false, clock = 1_000_000;
const probe = async ({ a, b }) => { probeCalls++; if (probeFail) throw new Error('sahte hata'); return 6.1; };
const book = SA.createAccessBook();
const r1 = await SA.verifyStops({ coords, stops, fromKm: 0, book, probe, now: () => clock });
ok('ilk doğrulama: iki ileri durak → 2 sorgu', probeCalls === 2 && r1.checked === 2, `${probeCalls}/${r1.checked}`);
const r2 = await SA.verifyStops({ coords, stops, fromKm: 0, book, probe, now: () => clock });
ok('aynı yön tekrar: kayıt var → 0 yeni sorgu', probeCalls === 2 && r2.checked === 0, String(probeCalls));
const r3 = await SA.verifyStops({ coords, stops, fromKm: 45, book, probe, now: () => clock });
ok('geride kalan durak sorgulanmaz', r3.checked === 0);
const book2 = SA.createAccessBook();
probeCalls = 0; probeFail = true;
await SA.verifyStops({ coords, stops, fromKm: 0, book: book2, probe, now: () => clock });
probeFail = false;
clock += SA.RETRY_MS - 1;
const r4 = await SA.verifyStops({ coords, stops, fromKm: 0, book: book2, probe, now: () => clock });
ok('başarısız sorgu RETRY_MS dolmadan tekrarlanmaz', probeCalls === 2 && r4.checked === 0, String(probeCalls));
clock += 1;
const r5 = await SA.verifyStops({ coords, stops, fromKm: 0, book: book2, probe, now: () => clock });
ok('RETRY_MS dolunca tekrar sorgulanır (durak başına 1)', probeCalls === 4 && r5.checked === 2, String(probeCalls));

// =====================================================================================================================
// D) Duraklatma kapıları (ücretsiz kota koruması) — istemci ve sunucu; alttaki fetch'e ulaşan istek sayılır.
// =====================================================================================================================
const CG = await import('../js/net/providerGate.js');
const SG = await import('../server/providerGate.mjs');
ok('istemci varsayılanı duraklatılmış (PROVIDER_REQUESTS_PAUSED_DEFAULT true)', CG.PROVIDER_REQUESTS_PAUSED_DEFAULT === true && CG.providerRequestsPaused() === true);
ok('sunucu varsayılanı duraklatılmış (env tanımsız → true; yalnız 0/false/off/no açar)', SG.providerPaused({}) === true && SG.providerPaused({ PROVIDER_REQUESTS_PAUSED: '1' }) === true && SG.providerPaused({ PROVIDER_REQUESTS_PAUSED: '0' }) === false);
ok('istemci PAUSED_PROXY_PATHS = sunucu PAUSED_ROUTES (aynı 10 yol)', CG.PAUSED_PROXY_PATHS.map(String).join() === SG.PAUSED_ROUTES.map(String).join() && SG.PAUSED_ROUTES.length === 10);
const PAID_PROXY = ['/mapbox/directions/v5/mapbox/driving-traffic/29,41;30,41', '/mapbox/search/searchbox/v1/category/ev_charging_station', '/here/stations', '/google/stations', '/ocm/poi', '/tomtom/route', '/overpass', '/v1/occupancy', '/v1/speedlimits', '/v1/tesla', '/v1/map/config'];
for (const p of PAID_PROXY) ok(`sağlayıcı yolu duraklatılır: ${p.split('?')[0].slice(0, 40)}`, SG.pausedRoute(p) && CG.blockedReason('http://proxy.test' + p, { origin: 'http://app.test', proxyBase: 'http://proxy.test' }) === 'proxy-provider');
for (const p of ['/v1/me', '/health', '/v1/sync', '/v1/station/info']) ok(`sağlayıcıya gitmeyen yol açık: ${p}`, !SG.pausedRoute(p) && CG.blockedReason('http://proxy.test' + p, { origin: 'http://app.test', proxyBase: 'http://proxy.test' }) === null);
const EXTERNAL = ['https://api.mapbox.com/directions/v5/x', 'https://api.tomtom.com/routing/1/x', 'https://valhalla1.openstreetmap.de/route', 'https://api.open-meteo.com/v1/forecast', 'https://overpass-api.de/api/interpreter', 'https://api.openchargemap.io/v3/poi', 'https://router.hereapi.com/v8/routes', 'https://places.googleapis.com/v1/x'];
for (const u of EXTERNAL) ok(`istemci harici sağlayıcıyı keser: ${new URL(u).host}`, CG.blockedReason(u, { origin: 'http://app.test', proxyBase: 'http://proxy.test' }) === 'external');
{
  let inner = 0; const blocked = [];
  const target = { fetch: async () => { inner++; return new Response('{}'); }, location: { origin: 'http://app.test' } };
  CG.installProviderGate(target, { getProxyBase: () => 'http://proxy.test', onBlock: (r) => blocked.push(r) });
  const outs = await Promise.allSettled([...EXTERNAL.map((u) => target.fetch(u)), target.fetch('http://proxy.test/tomtom/route'), target.fetch('http://app.test/version.js')]);
  ok('istemci kapısı: 9 sağlayıcı isteği reddedildi, alttaki fetch yalnız 1 kez (aynı köken)', inner === 1 && blocked.length === 9 && outs.filter((o) => o.status === 'rejected' && o.reason?.code === 'provider_paused').length === 9, `${inner}/${blocked.length}`);
}
{
  let inner = 0;
  const target = { fetch: async () => { inner++; return new Response('{}'); } };
  SG.installServerFetchGuard(target, { paused: true });
  const outs = await Promise.allSettled([...EXTERNAL.map((u) => target.fetch(u)), target.fetch('http://127.0.0.1:1/x')]);
  ok('sunucu kapısı: 8 sağlayıcı isteği üst sunucuya ulaşmadı, döngü-içi 1 geçti', inner === 1 && outs.filter((o) => o.status === 'rejected').length === 8, String(inner));
}

// =====================================================================================================================
// E) Kullanıcının kendi Mapbox anahtarı (mbKey) — davranış SABİTLENİR (değiştirilmez): sunucuda Mapbox yoksa istek doğrudan
// api.mapbox.com'a kullanıcının anahtarıyla gider (sunucu kotası uygulanmaz); 429 iç döngüde yeniden denenmez.
// =====================================================================================================================
const FAKE_PK = 'pk.FAKEFAKEFAKEFAKE.FAKEFAKEFAKEFAKE'; // sahte, biçim olarak geçerli
store.set('evcp.mbKey', JSON.stringify(FAKE_PK));
const MB = await import('../js/mapbox/api.js');
{
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(String(u)); return new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json', 'retry-after': '2' } }); };
  let err = null;
  try { await MB.mbfetch('/directions/v5/mapbox/driving/29,41;30,41', { overview: 'full' }); } catch (e) { err = e; }
  ok('mbKey (sunucuda Mapbox yok): tek istek, doğrudan api.mapbox.com', seen.length === 1 && seen[0].startsWith('https://api.mapbox.com/directions/'), seen.join());
  ok('mbKey 429: MapboxError, ölümcül değil, retryAfterMs 2000, iç tekrar yok', err?.status === 429 && err.fatal === false && err.retryAfterMs === 2000 && seen.length === 1);
  ok('hata iletisinde anahtar yok', !String(err?.message).includes(FAKE_PK));
  globalThis.fetch = netBan;
}
{
  store.set('evcp.proxyCode', JSON.stringify('fake-code-0000000000')); // sahte yönetici kodu → kimlik var
  const P = await import('../js/net/proxy.js');
  ok('kimlik + caps.mapbox: proxyHas(mapbox) true, mapboxKey "proxy"', P.proxyHas('mapbox') === true && MB.mapboxKey() === 'proxy');
  const seen = [];
  globalThis.fetch = async (u) => { seen.push(String(u)); return new Response('{"error":"premium_required"}', { status: 402, headers: { 'Content-Type': 'application/json' } }); };
  let err = null;
  try { await MB.mbfetch('/directions/v5/mapbox/driving-traffic/29,41;30,41', {}); } catch (e) { err = e; }
  ok('sunucu yolu: tek istek http://proxy.test/mapbox/…, mbKey ve access_token gitmez', seen.length === 1 && seen[0].startsWith('http://proxy.test/mapbox/directions/') && !seen[0].includes('access_token') && !seen[0].includes(FAKE_PK), seen.join());
  ok('sunucu 402: ölümcül, tek istek (Mapbox\'sız ücretsiz yola düşülür)', err?.status === 402 && err.fatal === true && seen.length === 1, `${err?.status}/${err?.fatal}/${seen.length}`);
  globalThis.fetch = netBan;
}

// =====================================================================================================================
// F) Sunucu kota sayaçları (statik; proxy.mjs içe aktarılmaz). Değerler kaynak varsayılanıdır, sağlayıcıyla DOĞRULANMADI.
// =====================================================================================================================
const PROXY = src('server/proxy.mjs');
const daily = PROXY.match(/const DAILY = \{([^\n]*)\};/)?.[1] || '';
for (const [kind, envName] of [['mapbox', 'MAPBOX_DAILY_PER_USER'], ['ocm', 'OCM_DAILY_PER_USER'], ['overpass', 'OVERPASS_DAILY_PER_USER'], ['occupancy', 'OCCUPANCY_DAILY_PER_USER'], ['google', 'GOOGLE_DAILY_PER_USER'], ['gsearch', 'GOOGLE_STATIONS_DAILY_PER_USER'], ['here', 'HERE_DAILY_PER_USER'], ['map', 'MAP_DAILY_PER_USER'], ['slimit', 'SPEEDLIMIT_DAILY_PER_USER'], ['tomtom', 'TOMTOM_ROUTE_DAILY_PER_USER']]) {
  ok(`günlük kullanıcı hakkı ${kind} ortamdan ayarlanabilir (${envName})`, new RegExp(`${kind}: Number\\(env\\.${envName} \\|\\| \\d+\\)`).test(daily));
}
const overQ = fnBody(PROXY, 'overQuota');
// G2a: overQuota biçimi değişti (ret sayılmaz); yönetici/kod "sayılır ama engellenmez" kuralı aynı güçte sabitlenir (davranış: test-server-quota B1, test-map-provider 11b)
ok('overQuota: yönetici ve eski erişim kodu sayılır ama engellenmez', /const limited = id\.kind === 'user' && !id\.admin;/.test(overQ) && /if \(limited && [^\n]*\) return true;\s*dailyUsage\.add\(key, kind\);\s*return false;/.test(overQ));
ok('aylık sayaçlar kalıcı: MAPBOX_MONTHLY_CAP (mbUsage), HERE_MONTHLY_CAP (hereUsage)', /const MB_CAP_CFG = parseMonthlyCap\(env\.MAPBOX_MONTHLY_CAP, \d+\);/.test(PROXY) && /const HERE_CAP_CFG = parseMonthlyCap\(env\.HERE_MONTHLY_CAP, \d+\);/.test(PROXY) && /c\.mapbox = \{ month: ym/.test(PROXY) && /c\.here = \{ month: ym, n: 0 \}; store\.save\(\);/.test(PROXY));
for (const fn of ['tomtomRouteRoute', 'googleStationsRoute']) ok(`${fn} premiumOk(id) ile kapılı`, /premiumOk\(id\)/.test(fnBody(PROXY, fn)));
ok('duraklatma 503, Mapbox dağıtıcısından önce', PROXY.indexOf('pausedRoute(') > 0 && PROXY.indexOf('pausedRoute(') < PROXY.indexOf('return await mapbox(req, res, url, id)'));
{
  const TT = await import('../server/tomtom.mjs');
  const prev = process.env.TOMTOM_DAILY_CAP;
  process.env.TOMTOM_DAILY_CAP = 'abc';
  ok('TomTom günlük tavanı geçersiz değerde kapanır (fail-closed: used < NaN false)', TT.tomtomAllowed() === false);
  if (prev === undefined) delete process.env.TOMTOM_DAILY_CAP; else process.env.TOMTOM_DAILY_CAP = prev;
}

// =====================================================================================================================
// G) KNOWN-GAP — bugünkü davranış (D2-T1/T2/T3 ya da ayrı görev düzeltir; kararlar kullanıcıda). Mapbox rota Premium kapısı (M1/M1b)
// ve aylık rota sınırı (M2/M2b) test-mapbox-route-gate.mjs içinde sabitli; burada TEKRARLANMAZ.
// =====================================================================================================================
const FB = src('js/advisor/fallback.js');
// Q-SOC-1 / Q-SOC-2 G1b ile KAPANDI → kabul denetimi; davranış testi scripts/test-soc-request-gates.mjs (sanal saat, sahte ağ).
ok('Q-SOC-1 kapandı: advisor/fallback.js check() replanFrom yalnızca socTrusted (Test Modu sim ya da socSource) ile', /replanFrom\(/.test(fnBody(FB, 'check')) && /if \(prev && socTrusted\(e\.source === 'sim' \? 'sim' : socSource\(\)\)\)/.test(fnBody(FB, 'check')));
ok('Q-SOC-2 kapandı: nearby.js checkLow() refreshOccupancy + her autoSearch yalnızca güvenilir pilde (socOk); watch() düşük pil sıklığı da', (() => {
  const body = fnBody(NEAR, 'checkLow');
  const calls = body.split('\n').filter((l) => /autoSearch\(/.test(l));
  return /if \(socOk\) refreshOccupancy\(\);/.test(body) && body.indexOf('const socOk = socTrusted(') < body.indexOf('refreshOccupancy(')
    && calls.length === 3 && calls.every((l) => /socOk\)? (?:&&[^;]*\) )?autoSearch\(|if \(socOk\) autoSearch\(/.test(l))
    && /const lowNow = inTrouble\(e, nav\) && socTrusted\(e\.source === 'sim' \? 'sim' : socSource\(\)\);/.test(fnBody(NEAR, 'watch'));
})());
// Q-SRV-1/2/3 G2a ile KAPANDI → kabul denetimi; davranış testi scripts/test-server-quota.mjs (alt süreç sunucu, sahte üst sunucu, yeniden başlatma, gün sınırı).
ok('Q-SRV-1 kapandı: overQuota önce denetler, yalnız izin verilen isteği sayar (ret sayacı artırmaz); aylık sınırlar günlük haktan önce', (() => {
  const chk = overQ.indexOf('dailyUsage.get(key, kind) < DAILY[kind]'), add = overQ.indexOf('dailyUsage.add(key, kind)');
  const order = (fn, a, b) => { const f = fnBody(PROXY, fn); return f.indexOf(a) > 0 && f.indexOf(b) > f.indexOf(a); };
  return chk > 0 && add > chk && !/usage\.set\(/.test(overQ)
    && order('mapbox', 'mbUsage().n >= MB_CAP', "overQuota(id, 'mapbox')") && order('hereStations', 'hereAllowed()', "overQuota(id, 'here')") && order('speedLimitsRoute', 'hereAllowed()', "overQuota(id, 'slimit')");
})());
ok('Q-SRV-2 kapandı: MAPBOX_MONTHLY_CAP / HERE_MONTHLY_CAP parseMonthlyCap (boş → eski varsayılan 4800 / 20000, geçersiz → 0 fail-closed)', await (async () => {
  const { parseMonthlyCap } = await import('../server/quotaCounters.mjs');
  return /const MB_CAP_CFG = parseMonthlyCap\(env\.MAPBOX_MONTHLY_CAP, 4800\);/.test(PROXY) && /const HERE_CAP_CFG = parseMonthlyCap\(env\.HERE_MONTHLY_CAP, 20000\);/.test(PROXY)
    && !/Number\(env\.(MAPBOX|HERE)_MONTHLY_CAP/.test(PROXY) && parseMonthlyCap('', 4800).cap === 4800 && parseMonthlyCap('abc', 4800).cap === 0 && 5 >= parseMonthlyCap('abc', 4800).cap;
})());
ok('Q-SRV-3 kapandı: günlük kullanıcı sayacı bellekte değil, db.json\'da (createDailyUsage(store) → dailyUsage)', !/const usage = new Map\(\)/.test(PROXY) && /const dailyUsage = createDailyUsage\(store\);/.test(PROXY) && /store\.data\.dailyUsage/.test(src('server/quotaCounters.mjs')));
// Q-CLI-1 D2-T1 (R4 feb985dc) ile KAPANDI → kabul denetimi; davranış testi scripts/test-mapbox-premium-gate.mjs D bölümü.
ok('Q-CLI-1 kapandı: mapbox/api.js sunucu 402 premium_required → "Premium gerektirir", diğer 402 → "aylık hakkı doldu"', /code === 'premium_required' \? 'Mapbox rotası Premium gerektirir/.test(src('js/mapbox/api.js')) && !/res\.status === 402\) throw new MapboxError\('Mapbox aylık hakkı doldu/.test(src('js/mapbox/api.js')));

ok('gerçek ağ çağrısı yapılmadı', realNetCalls === 0, String(realNetCalls));
console.log(`\nözet: envanter ${INVENTORY.length} koruma sabiti; bilinen boşluk ${gaps} (D2, açık); kota değerleri kaynak varsayılanıdır, doğrulanmadı`);
console.log(`${pass} geçti, ${fail} kaldı`);
if (fail) process.exit(1);
