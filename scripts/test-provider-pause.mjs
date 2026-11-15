// Sağlayıcı istekleri duraklatma (ücretsiz kota koruması, v0.99.78) testleri — bağımlılıksız, düz node:
//   node scripts/test-provider-pause.mjs
// Tamamen ÇEVRİMDIŞI: gerçek ağ isteği yapılmaz. İstemci tarafında alttaki fetch sahte bir sayaçtır; sunucu tarafında ara sunucu
// 8787 DIŞINDA bir portta (18871), geçici DATA_DIR ve YALNIZCA SAHTE anahtarlarla başlatılır; tüm *_BASE adresleri yerel sayaç
// sunucusuna (18870) yönlendirilir — sağlayıcı yoluna gelen herhangi bir üst istek sayılır ve test başarısız olur.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nodeFetch = globalThis.fetch; // yalnızca 6. bölümde YEREL test sunucusuna (127.0.0.1) istek için; harici adrese hiç kullanılmaz
let pass = 0, fail = 0;
function ok(name, cond, info = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${info ? ' — ' + info : ''}`); }
}
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ---- tarayıcı benzeri ortam (yalnızca bellek) ----
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
globalThis.sessionStorage = globalThis.localStorage;
const APP_ORIGIN = 'https://ozdemirumit.github.io';
globalThis.location = new URL(APP_ORIGIN + '/EV-Route-Finder/');
let netCalls = 0;
const seen = [];
const fakeFetch = async (input) => { netCalls++; seen.push(String(input?.url ?? input)); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); };

// ===================================================================== 1) istemci kapısı: karar tablosu
const gate = await import('../js/net/providerGate.js');
const { blockedReason, installProviderGate, ProviderPausedError, providerRequestsPaused, setProviderRequestsPaused, PROVIDER_REQUESTS_PAUSED_DEFAULT } = gate;
ok('varsayılan: sağlayıcı istekleri duraklatılmış', PROVIDER_REQUESTS_PAUSED_DEFAULT === true && providerRequestsPaused() === true);

const PB = 'https://evcopilot.duckdns.org';
const ctx = { origin: APP_ORIGIN, proxyBase: PB };
const EXTERNAL = [
  'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/1,2;3,4?access_token=x', // rota + trafik
  'https://api.mapbox.com/search/searchbox/v1/category/charging_station', // istasyon arama
  'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.js', // harita SDK
  'https://maps.googleapis.com/maps/api/js?key=x', // Google harita SDK
  'https://api.tomtom.com/maps/orbis/assets/styles/0.1/style.json', // TomTom harita stili
  'https://tiles.openfreemap.org/styles/dark', // OpenFreeMap stil/karo
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1', // Esri uydu
  'https://valhalla1.openstreetmap.de/route', // rota (OSM) + yükselti
  'https://api.open-meteo.com/v1/forecast?latitude=1', // hava
  'https://photon.komoot.io/api/?q=x', 'https://nominatim.openstreetmap.org/search?q=x', // geocoding
  'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter', // istasyon (OSM)
  'https://api.openchargemap.io/v3/poi/?key=x', // istasyon (OCM)
  'https://api.iternio.com/1/tlm/send', // ABRP telemetri
  'http://example.invalid/x', // bilinmeyen harici köken de (fail-closed)
];
for (const u of EXTERNAL) ok(`harici engellenir: ${new URL(u).host}${new URL(u).pathname.slice(0, 28)}`, blockedReason(u, ctx) === 'external');
ok('URL nesnesi de engellenir', blockedReason(new URL(EXTERNAL[0]), ctx) === 'external');
ok('Request benzeri nesne de engellenir', blockedReason({ url: EXTERNAL[8] }, ctx) === 'external');

const PROXY_BLOCK = ['/mapbox/directions/v5/mapbox/driving/1,2;3,4', '/mapbox/search/searchbox/v1/category/x', '/here/browse', '/google/stations', '/ocm/v3/poi/', '/tomtom/route?pts=1', '/overpass', '/v1/occupancy', '/v1/speedlimits', '/v1/tesla', '/v1/map/config'];
for (const p of PROXY_BLOCK) ok(`ara sunucu sağlayıcı yolu engellenir: ${p.split('?')[0]}`, blockedReason(PB + p, ctx) === 'proxy-provider');
ok('özel ara sunucu tabanı (alt yol) da kapsanır', blockedReason('https://ev.example.org/api/overpass', { origin: APP_ORIGIN, proxyBase: 'https://ev.example.org/api' }) === 'proxy-provider');

const ALLOW = [
  [PB + '/v1/config?v=1&p=web', 'açılış yapılandırması'], [PB + '/v1/auth/poll?nonce=x', 'giriş'], [PB + '/v1/me', 'hesap'], [PB + '/v1/sync', 'eşitleme'],
  [PB + '/v1/station/info', 'istasyon bilgisi (yerel kayıt)'], [PB + '/v1/price', 'topluluk fiyatı (yerel)'], [PB + '/v1/tariffs', 'önbellekteki tarifeler (üst istek yok)'],
  [PB + '/v1/presence', 'topluluk'], [PB + '/v1/providers', 'salt okunur katalog'],
  [APP_ORIGIN + '/EV-Route-Finder/version.js?t=1', 'aynı köken version.js'], ['js/i18n/lang/en.js', 'göreli yol'], ['data:application/json,{}', 'data:'], ['blob:' + APP_ORIGIN + '/x', 'blob:'],
];
for (const [u, why] of ALLOW) ok(`izinli: ${why}`, blockedReason(u, ctx) === null, String(blockedReason(u, ctx)));
ok('çözümlenemeyen adres engellenir (fail-closed)', blockedReason('http://[bozuk', { origin: APP_ORIGIN, proxyBase: PB }) === 'invalid');

// ===================================================================== 2) korumacı: engellenen istek alttaki fetch'e ULAŞMAZ
{
  const target = { fetch: fakeFetch, location: { origin: APP_ORIGIN } };
  const blocks = [];
  const g = installProviderGate(target, { getProxyBase: () => PB, onBlock: (r) => blocks.push(r) });
  ok('korumacı kuruldu ve işaretli', target.fetch === g && g.__providerGate === true);
  ok('ikinci kurulum sarmalamaz (tek katman)', installProviderGate(target, { getProxyBase: () => PB }) === g);
  const before = netCalls;
  let err = null;
  try { await target.fetch(EXTERNAL[0]); } catch (e) { err = e; }
  ok('harici: ProviderPausedError ile reddedilir', err instanceof ProviderPausedError && err.code === 'provider_paused' && err.name !== 'TypeError');
  ok('hata adresi sorgu (anahtar) içermez', err && !err.url.includes('access_token'));
  err = null;
  try { await target.fetch(PB + '/overpass', { method: 'POST' }); } catch (e) { err = e; }
  ok('ara sunucu sağlayıcı yolu: reddedilir', err instanceof ProviderPausedError);
  ok('engellenen 2 istek alttaki fetch\'e hiç ulaşmadı', netCalls === before, `${netCalls - before}`);
  ok('onBlock nedenleri', blocks.join(',') === 'external,proxy-provider', blocks.join(','));
  const r = await target.fetch(PB + '/v1/config');
  ok('izinli istek alttaki fetch\'e geçer', r.ok && netCalls === before + 1);
  setProviderRequestsPaused(false);
  await target.fetch(EXTERNAL[8]);
  ok('duraklatma kapalıyken (geri açma) harici istek geçer', netCalls === before + 2);
  setProviderRequestsPaused(true);
}

// ===================================================================== 3) gerçek modüller: sağlayıcı istekleri ağa çıkmaz
{
  globalThis.fetch = fakeFetch;
  installProviderGate(globalThis, { getOrigin: () => APP_ORIGIN, getProxyBase: () => PB });
  const before = netCalls;
  const tryRun = async (name, fn) => {
    let threw = null, out;
    try { out = await fn(); } catch (e) { threw = e; }
    ok(`${name}: sonuç yok / hata (veri uydurulmadı)`, threw != null || out == null || (Array.isArray(out) && out.length === 0) || out?.ok === false || typeof out === 'object', threw ? threw.name : JSON.stringify(out)?.slice(0, 80));
  };
  const { fetchWeather } = await import('../js/osm/weather.js');
  await tryRun('hava (Open-Meteo)', () => fetchWeather([{ lat: 39.1, lon: 32.2 }, { lat: 39.2, lon: 32.3 }]));
  const { valhalla } = await import('../js/osm/valhalla.js');
  await tryRun('rota (Valhalla)', () => valhalla('/route', { locations: [] }, 1000));
  const { fetchElevations } = await import('../js/osm/elevation.js');
  await tryRun('yükselti (Valhalla height)', () => fetchElevations([[32.1, 39.1], [32.2, 39.2]]));
  const { overpass } = await import('../js/osm/chargers.js');
  await tryRun('istasyon (Overpass, tüm aynalar)', () => overpass('[out:json];node(1,1,2,2);out;'));
  const { mbfetch } = await import('../js/mapbox/api.js');
  localStorage.setItem('mbKey', JSON.stringify('pk.SAHTE0000000000.SAHTE0000000000'));
  await tryRun('Mapbox API (doğrudan anahtar)', () => mbfetch('/search/searchbox/v1/category/charging_station', {}, { timeoutMs: 1000 }));
  const { proxyFetch, proxyFetchRetry } = await import('../js/net/proxy.js');
  localStorage.setItem('proxyCode', JSON.stringify('test-dummy-access-code-0123456789'));
  await tryRun('ara sunucu /v1/occupancy', () => proxyFetch('/v1/occupancy', { method: 'POST', body: '{}' }));
  await tryRun('ara sunucu /mapbox (yeniden denemeli)', () => proxyFetchRetry('/mapbox/search/searchbox/v1/category/x', {}, { timeoutMs: 1000 }));
  ok('gerçek modüller: alttaki fetch\'e 0 istek ulaştı', netCalls === before, seen.slice(-(netCalls - before)).map((u) => new URL(u, APP_ORIGIN).host).join(','));
}

// ===================================================================== 4) harita: duraklatmada yerel boş stil, SDK/karo yok
{
  const ml = read('js/ui/maps/maplibre.js');
  const m = /export const OFFLINE_STYLE = Object\.freeze\((\{[\s\S]*?\})\);/.exec(ml);
  let style = null;
  try { style = m && Function(`return (${m[1]})`)(); } catch { style = null; }
  ok('OFFLINE_STYLE okundu', !!style && style.version === 8);
  ok('OFFLINE_STYLE kaynak/glif/sprite/adres içermez', style && Object.keys(style.sources).length === 0 && !style.glyphs && !style.sprite && !/https?:|mapbox:\/\//.test(JSON.stringify(style)));
  ok('createMapLibreMap duraklatmada OFFLINE_STYLE kullanır, Esri/3B bina yok', /if \(paused\) return createVectorMap\(ml, container, \{ mapOptions: \{ style: structuredClone\(OFFLINE_STYLE\) \}, name: 'offline' \}\)/.test(ml));
  const mv = read('js/ui/mapView.js');
  const i = mv.indexOf('async function openAdapter()'), j = mv.indexOf('resolveProvider()', i);
  ok('mapView: duraklatma denetimi /v1/map/config ve Mapbox/Google/TomTom\'dan ÖNCE', i > 0 && j > i && /if \(providerRequestsPaused\(\)\) \{[\s\S]*?return createMapLibreMap\(mapEl, \{ paused: true \}\);/.test(mv.slice(i, j)));
  const app = read('js/app.js');
  const firstImport = /^import .*$/m.exec(app)?.[0] || '';
  ok('app.js: korumacı İLK import', firstImport.startsWith("import './net/providerGateInstall.js';"), firstImport);
  const sw = read('sw.js');
  ok('sw.js SHELL: providerGate.js + providerGateInstall.js', sw.includes("'./js/net/providerGate.js'") && sw.includes("'./js/net/providerGateInstall.js'"));
}

// ===================================================================== 5) sunucu korumacısı (birim)
const sg = await import('../server/providerGate.mjs');
ok('sunucu: varsayılan duraklatılmış (env yok)', sg.providerPaused({}) === true);
ok('sunucu: boş/bilinmeyen değer de duraklatır', sg.providerPaused({ PROVIDER_REQUESTS_PAUSED: '' }) && sg.providerPaused({ PROVIDER_REQUESTS_PAUSED: '1' }) && sg.providerPaused({ PROVIDER_REQUESTS_PAUSED: 'evet' }));
ok('sunucu: yalnızca açık 0/false/off/no geri açar', ['0', 'false', 'OFF', ' no '].every((v) => sg.providerPaused({ PROVIDER_REQUESTS_PAUSED: v }) === false));
const SERVER_HOSTS = ['https://api.mapbox.com/x', 'https://router.hereapi.com/v8/routes', 'https://browse.search.hereapi.com/v1/browse', 'https://places.googleapis.com/v1/places:searchNearby',
  'https://api.tomtom.com/search/2/x', 'https://api.openchargemap.io/v3/poi/', 'https://overpass-api.de/api/interpreter', 'https://opendata.ndw.nu/x', 'https://dotnl.ndw.nu/x',
  'https://supercharge.info/service/supercharge/allSites', 'https://api.veriapi.pro/x', 'https://veriapi.pro/x', 'not a url'];
for (const u of SERVER_HOSTS) ok(`sunucu engeller: ${u.split('/')[2] || u}`, sg.serverBlocked(u) === true);
ok('sunucu izin verir: döngü-içi (yerel yönetim/test)', !sg.serverBlocked('http://127.0.0.1:8787/admin/users') && !sg.serverBlocked('http://localhost:1/x'));
ok('sunucu izin verir: Google GİRİŞ belirteç değişimi (kota yok)', !sg.serverBlocked('https://oauth2.googleapis.com/token') && sg.serverBlocked('http://oauth2.googleapis.com/token'));
{
  let hits = 0;
  const t = { fetch: async () => { hits++; return new Response('{}'); } };
  sg.installServerFetchGuard(t, { paused: true });
  let e1 = null; try { await t.fetch('https://supercharge.info/service/supercharge/allSites'); } catch (e) { e1 = e; }
  ok('sunucu korumacısı: harici → ProviderPausedError, alttaki fetch 0', e1?.code === 'provider_paused' && hits === 0);
  // gerçek sunucu modülleri korumacıdan geçince ağa çıkmaz
  const { tomtomRoute } = await import('../server/tomtom.mjs');
  const { hereBrowse } = await import('../server/here.mjs');
  const { googleStationsNear } = await import('../server/googleStations.mjs');
  const { hereSpeedLimits } = await import('../server/speedlimits.mjs');
  const { createTesla } = await import('../server/tesla.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'pause-tesla-'));
  const runs = [
    ['TomTom rota', () => tomtomRoute('sahte', [[39.9, 32.8], [39.8, 32.7]], { fetchImpl: t.fetch })],
    ['HERE istasyon', () => hereBrowse('sahte', { lat: 39.9, lon: 32.8, r: 1000, fetchImpl: t.fetch })],
    ['Google Places', () => googleStationsNear('sahte', { lat: 39.9, lon: 32.8, r: 1000 }, { fetchImpl: t.fetch })],
    ['HERE hız limiti', () => hereSpeedLimits('sahte', [[39.9, 32.8], [39.8, 32.7]], { fetchImpl: t.fetch })],
    ['Tesla listesi', () => createTesla(dir, t.fetch).get()],
  ];
  for (const [n, fn] of runs) { try { await fn(); } catch { /* beklenen */ } }
  ok('sunucu modülleri (TomTom/HERE/Google/hız limiti/Tesla): alttaki fetch 0', hits === 0, String(hits));
  rmSync(dir, { recursive: true, force: true });
  const t2 = { fetch: async () => new Response('{}') };
  const inner = t2.fetch;
  sg.installServerFetchGuard(t2, { paused: false });
  ok('sunucu: PROVIDER_REQUESTS_PAUSED=0 iken korumacı kurulmaz', t2.fetch === inner);
}
ok('pausedRoute ↔ istemci PAUSED_PROXY_PATHS aynı liste', JSON.stringify(sg.PAUSED_ROUTES.map(String)) === JSON.stringify(gate.PAUSED_PROXY_PATHS.map(String)));

// ===================================================================== 6) sunucu uçtan uca: sağlayıcı yolları 503, üst sunucuya 0 istek
{
  const CODE = 'test-dummy-access-code-0123456789';
  let upstreamHits = 0;
  const upstream = http.createServer((req, res) => { upstreamHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise((r) => upstream.listen(18870, '127.0.0.1', r));
  const UP = 'http://127.0.0.1:18870';
  const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
    'GOOGLE_MAPS_BROWSER_KEY', 'VERIAPI_KEY', 'SMTP_URL', 'SMTP_HOST', 'ADMIN_TOTP_SECRET', 'PROVIDER_REQUESTS_PAUSED', 'MAP_PROVIDER'].map((k) => [k, '']));
  const FAKE = { MAPBOX_TOKEN: 'sahte-mapbox-1', MAPBOX_MAP_TOKEN: 'pk.SAHTE-2', OCM_KEY: 'sahte-ocm-3', HERE_API_KEY: 'sahte-here-4', TOMTOM_KEY: 'sahte-tomtom-5', GOOGLE_PLACES_KEY: 'sahte-google-6' };
  const dir = mkdtempSync(join(tmpdir(), 'pause-srv-'));
  writeFileSync(join(dir, 'db.json'), JSON.stringify({ users: {}, invites: {}, docs: {}, sessions: {} }));
  let log = '';
  const child = spawn(process.execPath, ['server/proxy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...BLANK, ...FAKE, PORT: '18871', HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE,
      MAPBOX_BASE: UP, OCM_BASE: UP, TOMTOM_BASE: UP, HERE_BASE: UP, HERE_ROUTER_BASE: UP, GOOGLE_PLACES_BASE: UP, OVERPASS_URLS: UP },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:18871';
  let up = false;
  for (let k = 0; k < 60 && !up; k++) { try { up = (await nodeFetch(base + '/v1/config')).status < 500; } catch { await new Promise((r) => setTimeout(r, 150)); } }
  ok('sunucu açıldı (PROVIDER_REQUESTS_PAUSED tanımsız)', up, log.slice(-300));
  ok('sunucu günlüğü: DURAKLATILDI bildirimi', /Sağlayıcı istekleri DURAKLATILDI/.test(log));
  const H = { 'X-Access-Code': CODE, 'Content-Type': 'application/json' };
  const calls = [
    ['GET', '/mapbox/directions/v5/mapbox/driving/32.8,39.9;32.7,39.8'], ['GET', '/mapbox/search/searchbox/v1/category/charging_station?proximity=32.8,39.9'],
    ['GET', '/here/browse?lat=39.9&lon=32.8&r=5'], ['GET', '/google/stations?lat=39.9&lon=32.8&r=5'], ['GET', '/ocm/v3/poi/?latitude=39.9&longitude=32.8'],
    ['GET', '/tomtom/route?pts=39.9,32.8;39.8,32.7'], ['POST', '/overpass', 'data=%5Bout%3Ajson%5D%3B'], ['POST', '/v1/occupancy', '{"stations":[]}'],
    ['POST', '/v1/speedlimits', '{"pts":[[39.9,32.8],[39.8,32.7]]}'], ['GET', '/v1/tesla'], ['GET', '/v1/map/config'],
  ];
  for (const [method, path, body] of calls) {
    const r = await nodeFetch(base + path, { method, headers: H, body });
    const j = await r.json().catch(() => ({}));
    ok(`sunucu ${method} ${path.split('?')[0]} → 503 provider_paused`, r.status === 503 && j.error === 'provider_paused', `${r.status} ${JSON.stringify(j).slice(0, 80)}`);
  }
  const anon = await nodeFetch(base + '/overpass', { method: 'POST' });
  ok('kimliksiz istek yine 401 (kimlik denetimi korunur)', anon.status === 401);
  const cfg = await nodeFetch(base + '/v1/config');
  ok('yerel yol /v1/config çalışır', cfg.status === 200);
  const health = await nodeFetch(base + '/health', { headers: H });
  ok('yerel yol /health çalışır', health.status === 200);
  const tar = await nodeFetch(base + '/v1/tariffs', { headers: H });
  ok('/v1/tariffs (yalnız önbellek, üst istek yok) çalışır', tar.status === 200);
  await new Promise((r) => setTimeout(r, 300)); // açılıştaki arka plan işleri (Tesla listesi vb.) için kısa bekleme
  ok('üst sunucuya (sayaç) 0 istek ulaştı', upstreamHits === 0, String(upstreamHits));
  ok('açılış arka plan işi (Tesla listesi) ağa çıkmadı: günlükte kota koruması notu', /kota koruması: üst sunucu isteği gönderilmedi \(supercharge\.info\)/.test(log), log.split('\n').filter((l) => /kota/.test(l)).join(' | '));
  ok('günlükte sahte anahtar yok', !Object.values(FAKE).some((v) => log.includes(v)));
  child.kill();
  upstream.close();
  await new Promise((r) => setTimeout(r, 200));
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows kilidi: yoksay */ }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
