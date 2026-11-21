// HERKESE AÇIK ÜCRETSİZ BETA (public-free) — fail-closed kabul testleri.
// node scripts/test-public-beta-mode.mjs   (çevrimdışı; gerçek ağ YOK, gerçek anahtar YOK, ücretli API YOK; saat sanal + kısa gerçek bekleme)
//
// Kaynakta mod 'paused' kalır; yalnız `node scripts/build-beta.mjs --public-free <klasör>` çıktısında 'public-free' olur. Bu testte mod
// setProviderMode('public-free') ile açılır ve uygulamanın GERÇEK modülleri sahte fetch ile çalıştırılır.
// Bölümler: A kaynak varsayılanı · B mod ayrıştırma · C ağ izin listesi (izin/ret tablosu) · D paylaşılan canlı sunucuya SIFIR istek ·
// E yeniden deneme tavanları / geri çekilme / günlük tavan (sanal saat) · F harita · G rota/istasyon/hava/arama gerçek modüllerle ·
// H çevrimdışı (her istek ağ hatası) · I herkese açık derleme + yayın kapısı · J kaynak/arayüz değişmezleri.
import { readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (r) => readFileSync(join(ROOT, r), 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ------------------------------------------------------------------------------------------------------------------ sahte dünya
// Alttaki (gerçek) fetch hiçbir zaman ağa çıkmaz: her çağrıyı kaydeder, ana makineye göre sahte yanıt döner.
const innerCalls = [];
const allCalls = []; // test boyunca hiç sıfırlanmaz (Z1)
let netMode = 'ok'; // 'ok' | 'offline' | '503'
const json = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
const fakeFetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  const hdr = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : { ...(init.headers || {}) };
  innerCalls.push({ url, method: String(init.method || 'GET').toUpperCase(), headers: hdr, t: Date.now() });
  allCalls.push(url);
  if (netMode === 'offline') return Promise.reject(new TypeError('Failed to fetch (sahte: çevrimdışı)'));
  if (netMode === '503') return Promise.resolve(json(503, {}));
  const u = new URL(url);
  if (u.hostname === 'valhalla1.openstreetmap.de') return Promise.resolve(json(400, { error: 'sahte: rota yok' }));
  if (u.hostname === 'photon.komoot.io') return Promise.resolve(json(200, { features: [{ geometry: { coordinates: [32.85, 39.92] }, properties: { name: 'Ankara' } }] }));
  if (u.hostname === 'api.open-meteo.com') return Promise.resolve(json(200, {}));
  if (/overpass/.test(u.hostname)) return Promise.resolve(json(200, { elements: [] }));
  return Promise.resolve(json(404, {}));
};
globalThis.fetch = fakeFetch;
for (const k of ['XMLHttpRequest', 'WebSocket', 'EventSource']) globalThis[k] = class { constructor() { throw new Error(k + ' yasak (test)'); } };
globalThis.navigator ??= {};
try { globalThis.navigator.sendBeacon = () => { throw new Error('sendBeacon yasak (test)'); }; } catch { /* salt okunur */ }
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k), key: (i) => [...stored.keys()][i] ?? null, get length() { return stored.size; } };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const timersSet = [];
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms, ...a) => { timersSet.push(ms); return realSetInterval(() => {}, 1e9); }; // kayıt; gerçek işi çalıştırmaz
const docListeners = [];
globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener: (t) => docListeners.push(t), dispatchEvent() {}, documentElement: { lang: 'tr', classList: { add() {} } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
console.warn = () => {};
console.info = () => {};
// EN KÖTÜ DURUM: cihazda eski Beta'dan kalmış oturum, yönetici kodu, sunucu yetenekleri, Premium plan ve kişisel sahte anahtarlar var.
const ORIGIN = 'https://ozdemirumit.github.io';
const SHARED = 'https://evcopilot.duckdns.org';
stored.set('evcp.session', JSON.stringify({ token: 'FAKE-SESSION-TOKEN', email: 'x@example.invalid' }));
stored.set('evcp.proxyCode', JSON.stringify('FAKE-ACCESS-CODE'));
stored.set('evcp.proxyCaps', JSON.stringify({ mapbox: true, here: true, ocm: true, overpass: true, occupancy: true, occupancyLocked: true, tomtom: true, googleStations: true }));
stored.set('evcp.proxyPlan', JSON.stringify({ premium: true }));
stored.set('evcp.mbKey', JSON.stringify('pk.FAKEFAKEFAKEFAKE.FAKEFAKEFAKEFAKE'));
stored.set('evcp.ocmKey', JSON.stringify('FAKE-OCM-KEY'));
stored.set('evcp.abrpToken', JSON.stringify('FAKE-ABRP'));

const gate = await import('../js/net/providerGate.js');
const { blockedReason, installProviderGate, createFreeLimiter, ProviderPausedError, freeMapRequest, BLOCKED_MAP_URL } = gate;

// ================================================================================================ A) kaynak varsayılanı değişmedi
ok('A1 kaynak: PROVIDER_MODE_BUILD = \'beta-full\' (v0.99.112; public-free yalnız build-beta --public-free çıktısında)', gate.PROVIDER_MODE_BUILD === 'beta-full' && gate.providerMode() === 'beta-full');
gate.setProviderMode('paused'); // A2/A3 'paused' modunun (bayraksız derleme) davranışını aynen sınar
ok('A2 paused modu: providerMode() paused, publicFreeMode() false', gate.providerMode() === 'paused' && gate.publicFreeMode() === false && gate.freeOnlyMode() === false);
ok('A3 paused modunda paylaşılan sunucunun sağlayıcı yolu kesik, /v1/config bugünkü gibi izinli', blockedReason(SHARED + '/mapbox/x', { origin: ORIGIN, proxyBase: SHARED }) === 'proxy-provider' && blockedReason(SHARED + '/v1/config', { origin: ORIGIN, proxyBase: SHARED }) === null);

// ================================================================================================ B) mod ayrıştırma (fail-closed)
for (const v of ['public-free', 'free-only']) ok(`B1 '${v}' tam eşleşmeyle açılır`, gate.parseProviderMode(v) === v);
for (const v of ['Public-Free', ' public-free', 'public-free ', 'public', 'publicfree', 'open', '', null, undefined, 1, {}]) ok(`B2 belirsiz mod ${JSON.stringify(v)} → paused`, gate.parseProviderMode(v) === 'paused');
gate.setProviderMode('public-free');
ok('B3 public-free: providerMode/publicFreeMode/freeOnlyMode doğru, küresel duraklatma yerine izin listesi', gate.providerMode() === 'public-free' && gate.publicFreeMode() && gate.freeOnlyMode() && gate.providerRequestsPaused() === false);

// ================================================================================================ C) ağ izin listesi
const R = (url, method = 'GET', proxyBase = SHARED) => blockedReason(url, { origin: ORIGIN, proxyBase, method });
const ALLOW = [
  ['https://tiles.openfreemap.org/styles/liberty', 'GET'], ['https://tiles.openfreemap.org/planet/20260101/1/1/1.pbf', 'GET'],
  ['https://valhalla1.openstreetmap.de/route', 'POST'], ['https://valhalla1.openstreetmap.de/height', 'POST'],
  ['https://api.open-meteo.com/v1/forecast?latitude=1', 'GET'], ['https://api.open-meteo.com/v1/elevation?latitude=1', 'GET'],
  ['https://photon.komoot.io/api/?q=a', 'GET'], ['https://photon.komoot.io/reverse?lat=1&lon=2', 'GET'],
  ['https://overpass.private.coffee/api/interpreter', 'POST'],
  [ORIGIN + '/EV-Route-Finder/version.js', 'GET'], ['data:application/json,{}', 'GET'], ['blob:' + ORIGIN + '/x', 'GET'],
];
for (const [u, m] of ALLOW) ok(`C1 izinli: ${m} ${u.split('?')[0]}`, R(u, m) === null, String(R(u, m)));
const NOT_ALLOWED = [
  ['https://nominatim.openstreetmap.org/search?q=a', 'GET', 'Nominatim (toplam kullanıcı sınırı)'],
  ['https://nominatim.openstreetmap.org/reverse?lat=1', 'GET', 'Nominatim ters'],
  ['https://overpass-api.de/api/interpreter', 'POST', 'overpass-api.de (toplam kullanıcı)'],
  ['https://overpass.kumi.systems/api/interpreter', 'POST', 'kumi.systems (aynı hizmet, eski ad)'],
  ['https://valhalla1.openstreetmap.de/locate', 'POST', 'Valhalla /locate (arka plan yoklaması)'],
  ['https://valhalla1.openstreetmap.de/route', 'GET', 'Valhalla yanlış yöntem'],
  ['https://customer-api.open-meteo.com/v1/forecast', 'GET', 'Open-Meteo ticari uç'],
  ['http://tiles.openfreemap.org/styles/liberty', 'GET', 'http'],
  ['https://tiles.openfreemap.org:8443/styles/liberty', 'GET', 'standart dışı port'],
  ['https://u:p@photon.komoot.io/api/', 'GET', 'kimlik bilgili adres'],
  ['https://tile.openstreetmap.org/1/1/1.png', 'GET', 'OSM karo sunucusu'],
  ['https://user-webhook.example.invalid/hook', 'POST', 'kullanıcı webhook\'u'],
];
for (const [u, m, why] of NOT_ALLOWED) ok(`C2 ret not-allowlisted: ${why}`, R(u, m) === 'not-allowlisted', String(R(u, m)));
const PAID = ['https://api.mapbox.com/directions/v5/x', 'https://events.mapbox.com/x', 'https://maps.googleapis.com/maps/api/js', 'https://places.googleapis.com/v1/x', 'https://www.google.com/x',
  'https://fonts.gstatic.com/x', 'https://api.tomtom.com/routing/1/x', 'https://router.hereapi.com/v8/x', 'https://api.iternio.com/1/tlm/send', 'https://server.arcgisonline.com/ArcGIS/rest/x', 'https://api.openchargemap.io/v3/poi/'];
for (const u of PAID) ok(`C3 ret paid-provider: ${new URL(u).host}`, R(u) === 'paid-provider' && R(u, 'POST') === 'paid-provider', String(R(u)));
// v0.99.94 (kullanıcı kararı: herkese açık Beta'da hesap/Google girişi geri gelir): paylaşılan sunucuda YALNIZ hesap yolları izinli.
const ACCOUNT_PATHS = ['/v1/auth/poll?nonce=x', '/v1/auth/logout', '/v1/me', '/v1/sync', '/v1/sync/places', '/v1/history/trips', '/v1/history/charges', '/v1/price', '/v1/presence'];
for (const p of ACCOUNT_PATHS) ok(`C4a hesap yolu izinli: ${p}`, R(SHARED + p, 'GET') === null && R(SHARED + p, 'POST') === null, String(R(SHARED + p)));
const SHARED_PATHS = ['/v1/config?v=1', '/health', '/v1/station/info', '/v1/station/photo/1', '/v1/station/rate', '/v1/tariffs', '/v1/providers', '/v1/status',
  '/v1/occupancy', '/v1/speedlimits', '/v1/tesla', '/v1/map/config', '/mapbox/x', '/overpass', '/ocm/poi', '/tomtom/route', '/google/stations', '/here/stations', '/',
  '/admin', '/admin/login', '/v1/me/x', '/v1/auth/poll/x', '/v1/sync/a/b', '/v1/history', '/v1/history/../mapbox', '/x/v1/me', '/v1/pricex'];
for (const p of SHARED_PATHS) ok(`C4 ret shared-server: ${p}`, R(SHARED + p, 'GET') === 'shared-server' && R(SHARED + p, 'POST') === 'shared-server', String(R(SHARED + p)));
ok('C4b hesap yolu yalnız https + standart port: http / :8443 / kimlik bilgili adres reddedilir', R('http://evcopilot.duckdns.org/v1/me') === 'shared-server' && R(SHARED + ':8443/v1/me') === 'shared-server' && R('https://u:p@evcopilot.duckdns.org/v1/me') === 'shared-server');
ok('C4c kullanıcı ayarlı başka ara sunucuda hesap yolu da reddedilir (yalnız paylaşılan ana makine)', R('https://my-proxy.example.invalid/v1/me', 'GET', 'https://my-proxy.example.invalid') === 'shared-server');
ok('C5 kullanıcı ayarlı başka ara sunucu kökeni de shared-server (yol fark etmez)', R('https://my-proxy.example.invalid/v1/config', 'GET', 'https://my-proxy.example.invalid') === 'shared-server');
ok('C6 proxyBase boş olsa da paylaşılan ana makine reddedilir', R(SHARED + '/v1/config', 'GET', '') === 'shared-server');
ok('C7 çözümlenemeyen adres reddedilir (fail-closed)', blockedReason({ url: 'http://[bozuk' }, { origin: ORIGIN }) !== null);
gate.setProviderMode('free-only');
ok('C8 regresyon: kapalı test free-only modu değişmedi (Nominatim ve /v1/config izinli)', R('https://nominatim.openstreetmap.org/search?q=a') === null && R(SHARED + '/v1/config') === null && R('https://overpass-api.de/api/interpreter', 'POST') === null);
gate.setProviderMode('public-free');

// ================================================================================================ D) paylaşılan sunucuya SIFIR istek
// Gerçek modüller: proxy.js (proxyFetch, proxyFetchRetry, serverConfig, refreshCaps, watchCaps, testProxy) + ücretli/sunucu kaynaklı modüller.
let T = 10_000_000_000; // sanal saat (kapının sayaçları)
const realStart = Date.now();
const clock = () => T + (Date.now() - realStart);
const dayStore = new Map();
const store = { getItem: (k) => (dayStore.has(k) ? dayStore.get(k) : null), setItem: (k, v) => dayStore.set(k, String(v)) };
const blocks = [];
installProviderGate(globalThis, { getOrigin: () => ORIGIN, getProxyBase: () => SHARED, now: clock, store, onBlock: (r, u) => blocks.push({ r, u }) });
const sharedCalls = () => innerCalls.filter((c) => { try { return new URL(c.url).hostname === 'evcopilot.duckdns.org'; } catch { return false; } });
{
  const proxy = await import('../js/net/proxy.js');
  ok('D1 hesap oturumu okunur (giriş geri geldi), eski yönetici erişim kodu yine okunmaz', proxy.getSession()?.token === 'FAKE-SESSION-TOKEN' && proxy.proxyCode() === '' && proxy.proxyReady() === true);
  for (const c of ['mapbox', 'here', 'ocm', 'overpass', 'occupancy', 'occupancyLocked', 'tomtom', 'googleStations']) ok(`D2 proxyHas('${c}') false`, proxy.proxyHas(c) === false);
  innerCalls.length = 0;
  for (const p of ['/v1/station/info', '/v1/tariffs', '/v1/occupancy', '/v1/speedlimits', '/v1/tesla', '/v1/map/config', '/overpass', '/mapbox/x', '/health', '/v1/config']) {
    let e1 = null; try { await proxy.proxyFetch(p, { method: 'POST', body: '{}' }); } catch (e) { e1 = e; }
    ok(`D3 hesap dışı yol ${p}: proxyFetch ağa çıkmadan ProviderPausedError(shared-server)`, e1 instanceof ProviderPausedError && e1.reason === 'shared-server' && innerCalls.length === 0, String(e1?.message));
  }
  await proxy.proxyFetch('/v1/sync', { method: 'POST', body: '{}' });
  const sc0 = innerCalls[0];
  ok('D3b hesap yolu /v1/sync oturum belirteciyle gider; yönetici kodu başlığı gönderilmez', innerCalls.length === 1 && sc0.url === SHARED + '/v1/sync' && sc0.headers.authorization === 'Bearer FAKE-SESSION-TOKEN' && !('x-access-code' in sc0.headers), JSON.stringify(sc0?.headers));
  innerCalls.length = 0;
  let e2 = null; try { await proxy.proxyFetchRetry('/overpass', { method: 'POST' }, { retries: 3, delayMs: 1, jitterMs: 0, sleep: async () => {} }); } catch (e) { e2 = e; }
  ok('D4 proxyFetchRetry yeniden deneme turu başlatmaz, istek 0', e2?.reason === 'shared-server' && innerCalls.length === 0);
  ok('D5 serverConfig() → null, /v1/config sorulmaz (anonim cihaz sayımı yok)', (await proxy.serverConfig()) === null && innerCalls.length === 0);
  const rc = await proxy.refreshCaps();
  ok('D6 refreshCaps() oturumla yalnız /v1/me sorar (/health, /v1/config yok)', rc.ok === false && innerCalls.length === 1 && innerCalls[0].url === SHARED + '/v1/me', innerCalls.map((c) => c.url).join(' '));
  for (const c of ['mapbox', 'here', 'ocm', 'overpass', 'occupancy', 'tomtom', 'googleStations']) ok(`D6b oturum + sunucu yetenekleri olsa da proxyHas('${c}') false (ücretli sağlayıcı kapalı)`, proxy.proxyHas(c) === false);
  const sess = stored.get('evcp.session');
  stored.delete('evcp.session');
  innerCalls.length = 0;
  const rc2 = await proxy.refreshCaps();
  ok('D6c oturumsuz refreshCaps(): istek 0 (anonim /v1/config sayımı ve /health yok), premiumAccess false', rc2.ok === false && innerCalls.length === 0 && proxy.premiumAccess() === false);
  stored.set('evcp.session', sess);
  innerCalls.length = 0;
  const tBefore = timersSet.length;
  proxy.watchCaps();
  await new Promise((r) => setTimeout(r, 20));
  ok('D7 watchCaps(): plan tazelemesi kurulur ve yalnız /v1/me sorar', timersSet.length === tBefore + 1 && innerCalls.every((c) => c.url === SHARED + '/v1/me'), innerCalls.map((c) => c.url).join(' '));
  innerCalls.length = 0;
  stored.set('evcp.proxyUrl', JSON.stringify('https://my-proxy.example.invalid'));
  const tp = await proxy.testProxy('https://my-proxy.example.invalid', 'FAKE');
  ok('D8 gelişmiş ayarla girilen sunucu da sınanmaz (istek 0)', tp.ok === false && innerCalls.length === 0);
  stored.delete('evcp.proxyUrl');
  // ham fetch ile paylaşılan sunucu (auth.js /v1/auth/poll gibi) kapıda kesilir
  let e3 = null; try { await fetch(SHARED + '/v1/config?v=1'); } catch (e) { e3 = e; }
  let e4 = null; try { await fetch(SHARED + '/v1/station/info', { method: 'POST' }); } catch (e) { e4 = e; }
  ok('D9 ham fetch(paylaşılan sunucu, hesap dışı yol) kapıda kesilir, alttaki fetch\'e ulaşmaz', e3?.reason === 'shared-server' && e4?.reason === 'shared-server' && innerCalls.length === 0);
  await fetch(SHARED + '/v1/auth/poll?nonce=x');
  ok('D9b giriş yoklaması (auth.js ham fetch /v1/auth/poll) kapıdan geçer', innerCalls.length === 1 && innerCalls[0].url === SHARED + '/v1/auth/poll?nonce=x');
  innerCalls.length = 0;
  // sunucu kaynaklı veri modülleri: tarife, Tesla, doluluk, hız limiti spanları → istek 0
  const prov = await import('../js/providers/index.js');
  const tr = await prov.fetchTrafficAhead({ lat: 39.92, lon: 32.85 }, { lat: 41.01, lon: 28.97 }).catch((e) => e);
  ok('D10 canlı trafik: ücretli kaynak denenmez, sonuç null', tr === null, String(tr?.message || tr));
  const occ = await import('../js/routing/occupancyClient.js');
  await Promise.resolve(occ.fetchAvailability?.([{ id: 'x', lat: 39.9, lon: 32.8 }], 1, 50)).catch(() => null);
  const tesla = await import('../js/routing/tesla.js');
  await Promise.resolve(tesla.teslaAround?.(39.9, 32.8, 10)).catch(() => null);
  ok('D11 doluluk ve Tesla (sunucu) çağrıları ağa çıkmaz', sharedCalls().length === 0 && innerCalls.length === 0, innerCalls.map((c) => c.url).join(' '));
}

// ================================================================================================ E) tavanlar / geri çekilme (sanal saat)
{
  const host = 'valhalla1.openstreetmap.de';
  const t0 = { v: 0 };
  const lim = createFreeLimiter({ now: () => t0.v, store: { getItem: () => null, setItem() {} } });
  const U = `https://${host}/route`;
  ok('E1 ilk istek izinli', lim.take(U, 'POST') === null);
  lim.result(U, 'POST', ORIGIN, { ok: false, http: true });
  ok('E2 429/5xx sonrası aynı ana makine 30 sn geri çekilir (istek ağa çıkmaz)', lim.take(U, 'POST') === 'backoff' && lim.cooling(host).until === 30e3);
  t0.v = 30e3;
  ok('E3 süre dolunca yeniden izinli', lim.take(U, 'POST') === null);
  const seq = [];
  for (let n = 2; n <= 8; n++) { lim.result(U, 'POST', ORIGIN, { ok: false, http: true }); const c = lim.cooling(host); seq.push(c.until - t0.v); t0.v = c.until; lim.take(U, 'POST'); }
  ok(`E4 ardışık hatada üstel: 60→120→240→480 sn, tavan 10 dk (${seq.map((d) => d / 1e3).join(',')})`, seq[0] === 60e3 && seq[1] === 120e3 && seq[3] === 480e3 && seq.slice(4).every((d) => d === 600e3));
  lim.result(U, 'POST', ORIGIN, { ok: true });
  ok('E5 başarı geri çekilmeyi sıfırlar', lim.cooling(host) === null && lim.take(U, 'POST') === null);
  lim.result(U, 'POST', ORIGIN, { ok: false });
  ok('E6 ağ hatası/zaman aşımı: 15 sn', lim.cooling(host).until - t0.v === 15e3);
  t0.v += 15e3; lim.result(U, 'POST', ORIGIN, { ok: true });
  lim.result(U, 'POST', ORIGIN, { ok: false, http: true, retryAfterMs: 1800e3 });
  ok('E7 Retry-After (30 dk) uyulur', lim.cooling(host).until - t0.v === 1800e3);
  lim.result(U, 'POST', ORIGIN, { ok: false, http: true, retryAfterMs: 50 * 3600e3 });
  ok('E8 Retry-After en çok 1 sa (aşırı değer kısılır)', lim.cooling(host).until - t0.v === 3600e3);
  ok('E9 geri çekilme başka ana makineyi etkilemez', lim.take('https://api.open-meteo.com/v1/forecast', 'GET') === null);

  // E10: fırtına — çağıran her 1 sn'de dener, ana makine 60 dk sürekli 503 → ağa çıkan istek ≤ 12 (eskiden kova: 240)
  const t1 = { v: 0 };
  const lim2 = createFreeLimiter({ now: () => t1.v, store: { getItem: () => null, setItem() {} } });
  let sent = 0;
  for (t1.v = 0; t1.v < 3600e3; t1.v += 1000) if (lim2.take(U, 'POST') === null) { sent++; lim2.result(U, 'POST', ORIGIN, { ok: false, http: true }); }
  ok(`E10 sürekli 503'te 60 dk / saniyede 1 deneme → ağa çıkan ≤ 12: ${sent}`, sent >= 5 && sent <= 12, String(sent));
  // E11: başarılı ama aşırı istek — saatlik ve günlük tavan (cihazda kalıcı)
  const t2 = { v: Date.UTC(2026, 10, 17, 0, 0, 0) };
  const persist = new Map();
  const st = { getItem: (k) => (persist.has(k) ? persist.get(k) : null), setItem: (k, v) => persist.set(k, v) };
  let lim3 = createFreeLimiter({ now: () => t2.v, store: st });
  const perHour = [];
  let hourN = 0, total = 0;
  for (let s = 0; s < 8 * 3600; s++) {
    if (s && s % 3600 === 0) { perHour.push(hourN); hourN = 0; }
    if (s === 3 * 3600) lim3 = createFreeLimiter({ now: () => t2.v, store: st }); // sayfa yeniden yüklendi
    if (lim3.take(U, 'POST') === null) { hourN++; total++; lim3.result(U, 'POST', ORIGIN, { ok: true }); }
    t2.v += 1000;
  }
  perHour.push(hourN);
  const vh = gate.PUBLIC_FREE_ENDPOINTS.find((e) => e.id === 'valhalla');
  ok(`E11 Valhalla saatlik ≤ ${vh.perHour} (${perHour.join(',')}) ve günlük ≤ ${vh.perDay} (yeniden yüklemede sıfırlanmaz): ${total}`, perHour.every((n) => n <= vh.perHour + 1) && total <= vh.perDay && total >= vh.perDay - 5, `${perHour} ${total}`);
  t2.v = Date.UTC(2026, 10, 18, 0, 0, 1);
  ok('E12 ertesi gün günlük sayaç sıfırlanır', lim3.take(U, 'POST') === null);
  ok('E13 günlük sayaç yalnız sayı tutar (adres/konum yok)', [...persist.values()].every((v) => !/https?:|lat|lon|\d+\.\d{3,}/.test(v)), [...persist.values()].join(' '));
  for (const e of gate.PUBLIC_FREE_ENDPOINTS) {
    const base = gate.FREE_ENDPOINTS.find((x) => x.id === e.id);
    ok(`E14 ${e.id}: herkese açık tavanlar kapalı test tavanlarından gevşek değil + günlük tavan var`, e.perHour <= base.perHour && e.burst <= base.burst && e.gapMs >= base.gapMs && e.perDay > 0 && e.perDay <= 24 * e.perHour);
  }
  ok('E15 izin listesinde Nominatim yok, Overpass yalnız overpass.private.coffee', !gate.PUBLIC_FREE_ENDPOINTS.some((e) => e.id === 'nominatim') && JSON.stringify(gate.PUBLIC_FREE_ENDPOINTS.find((e) => e.id === 'overpass').hosts) === '["overpass.private.coffee"]');
}

// ================================================================================================ F) harita
{
  ok('F1 OpenFreeMap karo/stil isteği geçer', freeMapRequest('https://tiles.openfreemap.org/planet/1/2/3.pbf').url.startsWith('https://tiles.openfreemap.org/'));
  for (const u of ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1', 'https://api.mapbox.com/v4/x.pbf', 'https://api.tomtom.com/map/1/tile/x', 'https://tile.openstreetmap.org/1/1/1.png', 'http://tiles.openfreemap.org/x', SHARED + '/v1/map/config'])
    ok(`F2 harita Worker isteği boş yerel adrese çevrilir: ${new URL(u).host}`, freeMapRequest(u).url === BLOCKED_MAP_URL);
  const mv = strip(read('js/ui/mapView.js'));
  const i = mv.indexOf('async function openAdapter()'), f = mv.indexOf('freeOnlyMode()', i), r = mv.indexOf('resolveProvider()', i);
  ok('F3 mapView: freeOnlyMode (public-free dahil) dalı /v1/map/config (resolveProvider) ÖNCESİNDE doğrudan OpenFreeMap açar', i > 0 && f > i && r > f && /freeOnly: true/.test(mv.slice(f, r)));
}

// ================================================================================================ G) gerçek modüller: rota / istasyon / hava / arama
const hostsOf = (list = innerCalls) => [...new Set(list.map((c) => { try { return new URL(c.url).host; } catch { return c.url; } }))];
{
  const prov = await import('../js/providers/index.js');
  T += 3600e3; innerCalls.length = 0;
  let rErr = null;
  try { await prov.fetchRoute({ lat: 39.92, lon: 32.85 }, { lat: 41.01, lon: 28.97 }); } catch (e) { rErr = e; }
  ok(`G1 rota: yalnız Valhalla /route (${hostsOf().join(',')})`, innerCalls.length >= 1 && innerCalls.every((c) => c.url === 'https://valhalla1.openstreetmap.de/route'), String(rErr?.message || ''));
  ok('G2 rota: X-Client-Id tanıtıcısı gönderilir (Valhalla demo sunucusu koşulu)', innerCalls.length >= 1 && innerCalls.every((c) => c.headers['X-Client-Id'] === gate.PUBLIC_CLIENT_ID));
  ok('G3 tanıtıcı kişisel veri içermez (e-posta/cihaz kimliği yok)', !/@|d_[A-Za-z0-9_-]{16}/.test(gate.PUBLIC_CLIENT_ID));
  // istasyon (çevre araması): yalnız overpass.private.coffee, tek deneme
  T += 3600e3; innerCalls.length = 0;
  const st = await prov.fetchAround(39.92, 32.85, 10, true).catch((e) => e);
  ok(`G4 istasyon: yalnız overpass.private.coffee (${hostsOf().join(',')})`, innerCalls.length === 1 && hostsOf()[0] === 'overpass.private.coffee', String(st?.message || ''));
  // istasyon (rota boyu): parçalar SIRAYLA ve ≥ kova aralığı arayla (gerçek saat; 3 parça ≈ 6 sn)
  T += 3600e3; innerCalls.length = 0;
  const ch = await import('../js/osm/chargers.js');
  const pts = Array.from({ length: 22 }, (_, k) => ({ lat: 39.0, lon: 30 + (k * 8) / 86.5, km: k * 8 }));
  const prof = { totalKm: 168, project: () => ({ km: 0, offKm: 0 }) };
  await ch.fetchChargers(pts, prof).catch(() => null);
  const ov = innerCalls.filter((c) => /overpass/.test(c.url));
  const gaps = ov.map((c) => c.t).map((t, k, a) => (k ? t - a[k - 1] : null)).filter((x) => x != null);
  const gapMs = gate.PUBLIC_FREE_ENDPOINTS.find((e) => e.id === 'overpass').gapMs;
  ok(`G5 rota boyu istasyon: yalnız overpass.private.coffee, ≥ 3 parça (${ov.length}), hepsi sıralı ve ≥ ${gapMs} ms arayla (${gaps.join(',')})`, ov.length >= 3 && hostsOf(ov).join() === 'overpass.private.coffee' && gaps.every((d) => d >= gapMs), String(gaps));
  ok('G6 rota boyu istasyonda kova reddi yok (tempo kovaya uyar)', !blocks.some((b) => /overpass/.test(b.u) && b.r === 'rate-limit'), JSON.stringify(blocks.slice(-3)));
  // hava
  T += 3600e3; innerCalls.length = 0;
  await prov.fetchWeather([{ lat: 39.92, lon: 32.85, t: Date.now() + 3600e3 }]).catch(() => null);
  ok(`G7 hava: yalnız api.open-meteo.com /v1/forecast (${hostsOf().join(',')})`, innerCalls.length >= 1 && innerCalls.every((c) => c.url.startsWith('https://api.open-meteo.com/v1/forecast')));
  // yükselti
  T += 3600e3; innerCalls.length = 0;
  await prov.fetchElevations([{ lat: 39.9, lon: 32.8 }, { lat: 40.0, lon: 32.9 }, { lat: 40.1, lon: 33.0 }]).catch(() => null);
  ok(`G8 yükselti: yalnız Valhalla /height ya da Open-Meteo elevation (${hostsOf().join(',')})`, innerCalls.length >= 1 && hostsOf().every((h) => h === 'valhalla1.openstreetmap.de' || h === 'api.open-meteo.com'));
  // arama: Photon var, Nominatim hiç denenmez (onMore verilse de)
  T += 3600e3; innerCalls.length = 0;
  const search = await import('../js/osm/search.js');
  let more = 0;
  const res = await search.searchPlaces('Ankara', null, null, () => { more++; });
  await new Promise((r) => setTimeout(r, 2000));
  ok(`G9 arama: yalnız Photon (${hostsOf().join(',')}), Nominatim isteği 0, sonuç geldi`, res.length === 1 && hostsOf().join() === 'photon.komoot.io' && more === 0);
  const rv = await search.reverseLabel(39.9, 32.8);
  ok('G10 ters adres: Photon /reverse', innerCalls.some((c) => c.url.startsWith('https://photon.komoot.io/reverse')) && typeof rv === 'string');
  // yol hız limiti: Valhalla /locate ve sunucu /v1/speedlimits istek atmaz
  T += 3600e3; innerCalls.length = 0;
  await prov.fetchSpeedLimit?.({ lat: 39.9, lon: 32.8, heading: 90 }).catch(() => null);
  ok('G11 yol hız limiti: /locate ve /v1/speedlimits ağa çıkmaz', innerCalls.length === 0, innerCalls.map((c) => c.url).join(' '));
}

// ================================================================================================ H) çevrimdışı
{
  netMode = 'offline';
  const prov = await import('../js/providers/index.js');
  T += 3600e3; innerCalls.length = 0;
  let n = 0, errs = 0;
  // çağıran (ör. N-1 eski davranış) 10 dk boyunca her 5 sn'de rota ister: ağa çıkan deneme geri çekilmeyle sınırlı
  for (let s = 0; s < 600; s += 5) { T += 5000; n++; try { await prov.fetchRoute({ lat: 39.92, lon: 32.85 }, { lat: 41.01, lon: 28.97 }); } catch { errs++; } }
  const vh = innerCalls.filter((c) => c.url.includes('valhalla1'));
  ok(`H1 çevrimdışı 10 dk / 120 rota denemesi → ağa çıkan Valhalla isteği ≤ 6 (15→30→60→120→240 sn): ${vh.length}`, vh.length >= 2 && vh.length <= 6 && errs === n, `${vh.length}/${n}`);
  T += 3600e3; innerCalls.length = 0;
  const around = await prov.fetchAround(39.92, 32.85, 10, true).catch((e) => ({ errors: [e.message], stations: [] }));
  ok('H2 çevrimdışı istasyon araması hata dizisiyle döner (atmaz), tek deneme', Array.isArray(around.errors) && around.errors.length >= 1 && innerCalls.length <= 1);
  T += 3600e3; innerCalls.length = 0;
  await prov.fetchWeather([{ lat: 39.92, lon: 32.85, t: Date.now() + 3600e3 }]).catch(() => null);
  await prov.fetchWeather([{ lat: 39.93, lon: 32.86, t: Date.now() + 3600e3 }]).catch(() => null);
  ok('H3 çevrimdışı hava: ikinci deneme geri çekilmede ağa çıkmaz', innerCalls.filter((c) => c.url.includes('open-meteo')).length === 1);
  const sw = strip(read('sw.js'));
  ok('H4 servis çalışanı çapraz kökenli isteğe dokunmaz (çevrimdışı önbellek yalnız aynı köken)', /if \(url\.origin !== location\.origin\) return;/.test(sw));
  ok('H5 offline.html mevcut', existsSync(join(ROOT, 'offline.html')));
  netMode = 'ok';
}

// tüm A–H boyunca
const ALLOWED_HOSTS = new Set(gate.PUBLIC_FREE_ENDPOINTS.flatMap((e) => e.hosts));
const leaked = allCalls.filter((u) => { try { const x = new URL(u); return !ALLOWED_HOSTS.has(x.hostname) && !(x.origin === SHARED && gate.publicFreeAccountPath(x.pathname)); } catch { return true; } });
ok(`Z1 testin TAMAMINDA alttaki fetch'e yalnız herkese açık izin listesindeki ana makineler ve paylaşılan sunucunun HESAP yolları ulaştı (${allCalls.length} istek; ücretli / sunucu sağlayıcı yolu / Nominatim / overpass-api.de 0)`, allCalls.length > 0 && leaked.length === 0, leaked.join(' '));

// ================================================================================================ I) herkese açık derleme + yayın kapısı
{
  const BUILDER = join(ROOT, 'scripts', 'build-beta.mjs');
  const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [BUILDER, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  const gateFile = JSON.parse(read('docs/public-beta-gate.json'));
  const openConds = gateFile.conditions.filter((c) => c.status !== 'met').map((c) => c.id);
  ok(`I0 yayın kapısı dosyası okunur; kullanıcı koşulları açık (${openConds.join(',')})`, gateFile.target === 'https://ozdemirumit.github.io/EV-Route-Finder/' && openConds.length >= 1);
  const tmp = mkdtempSync(join(tmpdir(), 'evrf-pubfree-'));
  try {
    const out = join(tmp, 'build');
    const r = run(['--public-free', out]);
    ok('I1 --public-free depo dışı, git olmayan klasöre derlenir', r.code === 0 && existsSync(join(out, 'index.html')), r.out.slice(-300));
    const pg = readFileSync(join(out, 'js', 'net', 'providerGate.js'), 'utf8');
    ok('I2 çıktıda PROVIDER_MODE_BUILD = \'public-free\' (tam bir kez), kaynak \'beta-full\' kaldı', (pg.match(/export const PROVIDER_MODE_BUILD = 'public-free';/g) || []).length === 1 && /export const PROVIDER_MODE_BUILD = 'beta-full';/.test(read('js/net/providerGate.js')));
    ok('I3 kapı kapalı: PUBLIC-BETA-GATE-BLOCKED.txt işareti yazıldı', existsSync(join(out, 'PUBLIC-BETA-GATE-BLOCKED.txt')) && openConds.every((id) => readFileSync(join(out, 'PUBLIC-BETA-GATE-BLOCKED.txt'), 'utf8').includes(id)));
    ok('I4 başlık "(Beta – ücretsiz)", offline.html Beta adresine döner', readFileSync(join(out, 'index.html'), 'utf8').includes('<title>EV Route Finder (Beta – ücretsiz)</title>') && readFileSync(join(out, 'offline.html'), 'utf8').includes('https://ozdemirumit.github.io/EV-Route-Finder/'));
    ok('I5 çıktıda server/, .env, docs/, scripts/ yok', !existsSync(join(out, 'server')) && !existsSync(join(out, '.env')) && !existsSync(join(out, 'docs')) && !existsSync(join(out, 'scripts')));
    const files = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
    walk(out);
    const SECRET = /pk\.eyJ[A-Za-z0-9_-]{10,}|sk\.eyJ[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
    const hits = files.filter((p) => /\.(js|html|json|webmanifest|css|txt)$/.test(p) && SECRET.test(readFileSync(p, 'utf8')));
    ok(`I6 çıktıda anahtar/belirteç deseni 0 (${files.length} dosya)`, hits.length === 0, hits.join(' '));
    ok('I7 Beta adları: depolama öneki evcpb., günlük sayaç anahtarı evcpb.freeDay', pg.includes("'evcpb.freeDay'") && !/'evcp\./.test(pg));
    const built = await import(pathToFileURL(join(out, 'js', 'net', 'providerGate.js')).href);
    ok('I8 derlenmiş kapı modülü public-free modunda açılır', built.providerMode() === 'public-free' && built.publicFreeMode() && built.blockedReason(SHARED + '/v1/config', { origin: ORIGIN }) === 'shared-server');
    // kapı kapalıyken git deposuna (yayın deposu dahil) YAZILAMAZ; klasör dokunulmadan kalır
    const repo = join(tmp, 'fake-publish-repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, 'SENTINEL.txt'), 'dokunulmamalı');
    const r2 = run(['--public-free', repo]);
    ok('I9 kapı kapalı + git deposu hedefi → çıkış 2, BLOCKED', r2.code === 2 && /BLOCKED/.test(r2.out), `${r2.code} ${r2.out.slice(-200)}`);
    ok('I10 reddedilen hedef klasör değişmedi (index.html yazılmadı, mevcut dosya silinmedi)', existsSync(join(repo, 'SENTINEL.txt')) && !existsSync(join(repo, 'index.html')));
    ok('I11 klasörsüz --public-free reddedilir (varsayılan yayın deposu kullanılmaz)', run(['--public-free']).code !== 0);
    ok('I12 --public-free ile --free-only birlikte reddedilir', run(['--public-free', '--free-only', join(tmp, 'x')]).code !== 0);
    ok('I13 bilinmeyen bayrak reddedilir', run(['--public-freee', join(tmp, 'y')]).code !== 0);
    ok('I14 proje içi klasör reddedilir', run(['--public-free', join(ROOT, 'tmp-public-build')]).code !== 0 && !existsSync(join(ROOT, 'tmp-public-build')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ================================================================================================ J) kaynak / arayüz değişmezleri
{
  const inst = strip(read('js/net/providerGateInstall.js'));
  ok('J1 providerGateInstall: public-free\'de <html class="public-free"> konur', /publicFreeMode\(\)\) globalThis\.document\?\.documentElement\?\.classList\.add\('public-free'\)/.test(inst));
  const css = read('css/styles.css');
  const html = read('index.html');
  ok('J2a #account-card (davet + Google girişi, Ücretsiz/Premium) herkese açık Beta\'da GİZLENMEZ', html.includes('id="account-card"') && html.includes('id="acc-google"') && !/html\.public-free #account-card\b/.test(css));
  ok('J2b atıf satırı artık "hesap yoktur" demez', !/Bu sürümde hesap/.test(html));
  for (const id of ['fab-sat', 'own-keys', 'data-src-note', 'bd-abrp', 'bd-traffic', 'premium-hint'])
    ok(`J2 #${id}: index.html'de var ve herkese açık Beta'da gizli`, html.includes(`id="${id}"`) && new RegExp(`html\\.public-free #${id}\\b`).test(css));
  ok('J3 trafik kartı (t-level) gizli', html.includes('id="t-level"') && /html\.public-free \.card:has\(> dl #t-level\)/.test(css));
  ok('J4 kaynak/atıf satırı yalnız herkese açık Beta\'da görünür', /class="small muted public-free-only" id="pub-src-note"/.test(html) && /\.public-free-only \{ display: none !important; \}/.test(css) && /html\.public-free \.public-free-only \{ display: block !important; \}/.test(css));
  ok('J5 atıf satırı OpenFreeMap/OSM/Open-Meteo CC BY 4.0 içerir', /OpenStreetMap katkıcıları.*Open-Meteo\.com \(CC BY 4\.0\)/.test(html));
  const sc = strip(read('js/ui/stationCard.js'));
  ok('J6 istasyon kartı: herkese açık Beta\'da doluluk/puan/fotoğraf (sunucu) yüklenmez, giriş istemi yok', /if \(publicFreeMode\(\)\) \{ live\.classList\.add\('hidden'\); info\.classList\.add\('hidden'\); return; \}/.test(sc));
  const se = strip(read('js/osm/search.js'));
  ok('J7 arama: Nominatim dalı publicFreeMode ile kapalı', /if \(onMore && !publicFreeMode\(\)\)/.test(se));
  ok('J8 sürüm 0.99.118', /self\.APP_VERSION = '0\.99\.118';/.test(read('version.js')));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
