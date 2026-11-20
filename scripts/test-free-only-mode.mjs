// YALNIZ ÜCRETSİZ (free-only) BETA SAĞLAYICI MODU — kapalı cihaz testi içindir, herkese açık yayın İÇİN DEĞİL.
// node scripts/test-free-only-mode.mjs   (çevrimdışı; gerçek ağ yok, gerçek anahtar yok, ücretli API yok; saat sanal)
//
// Bayraksız build-beta çıktısı (güvenli varsayılan) 'paused' kalır ve küresel duraklatma sürer (kaynak v0.99.112'den beri 'beta-full'). Yalnız `node scripts/build-beta.mjs --free-only <depo-dışı-klasör>` ile üretilen YEREL çıktıda mod 'free-only'
// olur: küresel duraklatmanın yerine kesin izin listesi (OpenFreeMap karoları, herkese açık Valhalla, Open-Meteo hava/yükselti,
// Photon/Nominatim, Overpass aynaları). Mapbox/Google/TomTom/HERE/Iternio(ABRP)/ArcGIS/OpenChargeMap ve ara sunucunun sağlayıcı
// yolları reddedilir; ücretsiz servislerin adil kullanım sınırları istemcide jeton kovası + saatlik tavanla korunur (kuyruk yok,
// fazla istek reddedilir → fırtına yok). Belirsiz/bilinmeyen mod değeri → 'paused' (fail-closed).
//
// Bölümler: A varsayılan değişmedi · B mod ayrıştırma fail-closed · C izin/ret tablosu · D kota (sanal saat) + ücretli istek 0 ·
// E harita (OpenFreeMap, Esri/ArcGIS yok, /v1/map/config yok) · F rota/istasyon/hava gerçek modüllerle (sahte fetch) ·
// G build-beta --free-only (geçici klasör; varsayılan yayın deposu ve git deposu reddedilir) · H kaynak değişmezleri.
import { readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (r) => readFileSync(join(ROOT, r), 'utf8');

// ---------------------------------------------------------------------------------------------------------------- sahte dünya
// Gerçek ağ yasak: alttaki fetch her çağrıyı kaydeder ve sahte yanıt döner; hiçbir istek makineden çıkmaz.
const innerCalls = [];
const fakeFetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  innerCalls.push({ url, method: String(init.method || 'GET').toUpperCase() });
  return Promise.resolve({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
};
globalThis.fetch = fakeFetch;
for (const k of ['XMLHttpRequest', 'WebSocket', 'EventSource']) globalThis[k] = class { constructor() { throw new Error(k + ' yasak (test)'); } };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k), key: (i) => [...stored.keys()][i] ?? null, get length() { return stored.size; } };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {}, dispatchEvent() {}, documentElement: { lang: 'tr' }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
console.warn = () => {};
console.info = () => {};
// En kötü durum: ücretli sağlayıcıların hepsi "açık" görünür (sahte erişim kodu, sunucu yetenekleri, kişisel sahte anahtarlar).
const PROXY = 'https://proxy.invalid.test';
const ORIGIN = 'http://localhost:8080';
stored.set('evcp.proxyUrl', JSON.stringify(PROXY));
stored.set('evcp.proxyCode', JSON.stringify('FAKE-ACCESS-CODE'));
stored.set('evcp.proxyCaps', JSON.stringify({ mapbox: true, here: true, ocm: true, overpass: true, occupancy: true, occupancyLocked: true, tomtom: true, googleStations: true }));
stored.set('evcp.proxyPlan', JSON.stringify({ premium: true }));
stored.set('evcp.mbKey', JSON.stringify('pk.FAKEFAKEFAKEFAKE.FAKEFAKEFAKEFAKE'));
stored.set('evcp.ocmKey', JSON.stringify('FAKE-OCM-KEY'));

const gate = await import('../js/net/providerGate.js');
const { blockedReason, installProviderGate, ProviderPausedError } = gate;

// =============================================================================================== A) varsayılan (kaynak) değişmedi
ok('A1 kaynak: PROVIDER_REQUESTS_PAUSED_DEFAULT hâlâ true', gate.PROVIDER_REQUESTS_PAUSED_DEFAULT === true);
ok('A2 kaynak: PROVIDER_MODE_BUILD = \'beta-full\' (v0.99.112; free-only yalnız build-beta --free-only çıktısında)', gate.PROVIDER_MODE_BUILD === 'beta-full' && gate.providerMode() === 'beta-full');
gate.setProviderMode('paused'); // A3/A4 'paused' modunun (bayraksız derleme) davranışını aynen sınar
ok('A3 paused modu: providerMode() paused, freeOnlyMode() false, providerRequestsPaused() true',
  typeof gate.providerMode === 'function' && gate.providerMode() === 'paused' && gate.freeOnlyMode?.() === false && gate.providerRequestsPaused() === true);
ok('A4 kaynak duraklatmada ücretsiz servis de reddedilir (bugünkü davranış)', blockedReason('https://api.open-meteo.com/v1/forecast?x=1', { origin: ORIGIN }) === 'external');

// =============================================================================================== B) mod ayrıştırma fail-closed
const pm = gate.parseProviderMode || (() => 'x');
ok('B1 yalnız tam \'free-only\' free-only olur', pm('free-only') === 'free-only');
for (const v of ['FREE-ONLY', ' free-only', 'free-only ', 'free', 'open', 'off', '0', 'false', '', null, undefined, 1, {}, 'paused'])
  ok(`B2 belirsiz değer → paused: ${JSON.stringify(v)}`, pm(v) === 'paused');

// =============================================================================================== C) izin/ret tablosu
gate.setProviderMode?.('free-only');
ok('C0 test: free-only etkin (providerRequestsPaused false, freeOnlyMode true)', gate.freeOnlyMode?.() === true && gate.providerRequestsPaused() === false && gate.providerMode() === 'free-only');
const R = (url, method = 'GET') => blockedReason(url, { origin: ORIGIN, proxyBase: PROXY, method });
const ALLOW = [
  ['https://tiles.openfreemap.org/styles/dark', 'GET'],
  ['https://tiles.openfreemap.org/planet', 'GET'],
  ['https://tiles.openfreemap.org/planet/20251112_001001_pt/10/600/390.pbf', 'GET'],
  ['https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf', 'GET'],
  ['https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json', 'GET'],
  ['https://valhalla1.openstreetmap.de/route', 'POST'],
  ['https://valhalla1.openstreetmap.de/height', 'POST'],
  ['https://valhalla1.openstreetmap.de/locate', 'POST'],
  ['https://api.open-meteo.com/v1/forecast?latitude=39.9&longitude=32.8&hourly=temperature_2m', 'GET'],
  ['https://api.open-meteo.com/v1/elevation?latitude=39.9&longitude=32.8', 'GET'],
  ['https://photon.komoot.io/api/?q=ankara&limit=8', 'GET'],
  ['https://photon.komoot.io/reverse?lat=39.9&lon=32.8', 'GET'],
  ['https://nominatim.openstreetmap.org/search?q=ankara&format=jsonv2', 'GET'],
  ['https://overpass-api.de/api/interpreter', 'POST'],
  ['https://overpass.private.coffee/api/interpreter', 'POST'],
  ['https://overpass.kumi.systems/api/interpreter', 'POST'],
  [ORIGIN + '/version.js', 'GET'],
  [ORIGIN + '/js/app.js', 'GET'],
  ['data:application/json,{}', 'GET'],
  [PROXY + '/v1/config?v=1', 'GET'],
  [PROXY + '/v1/tariffs', 'GET'],
];
for (const [u, m] of ALLOW) ok(`C1 izinli ${m} ${u.split('?')[0]}`, R(u, m) === null, String(R(u, m)));
const PAID = [
  'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/1,2;3,4', 'https://events.mapbox.com/events/v2', 'https://api.mapbox.com/search/searchbox/v1/category/ev_charging_station',
  'https://maps.googleapis.com/maps/api/js?key=FAKE', 'https://www.google.com/maps/dir/', 'https://places.googleapis.com/v1/places:searchNearby', 'https://maps.gstatic.com/x.png',
  'https://api.tomtom.com/routing/1/calculateRoute/1,2:3,4/json', 'https://router.hereapi.com/v8/routes', 'https://discover.search.hereapi.com/v1/discover',
  'https://api.iternio.com/1/tlm/send', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1',
  'https://services.arcgis.com/x', 'https://api.openchargemap.io/v3/poi/?key=FAKE',
];
for (const u of PAID) { const r = R(u); ok(`C2 ücretli/izinsiz reddedilir: ${new URL(u).host}`, r === 'paid-provider', String(r)); }
const NOT_LISTED = [
  ['http://api.open-meteo.com/v1/forecast', 'GET', 'https değil'],
  ['https://api.open-meteo.com:8443/v1/forecast', 'GET', 'standart dışı port'],
  ['https://user:pw@api.open-meteo.com/v1/forecast', 'GET', 'kimlik bilgili adres'],
  ['https://customer-api.open-meteo.com/v1/forecast?apikey=FAKE', 'GET', 'Open-Meteo ticari (ücretli) uç'],
  ['https://api.open-meteo.com.evil.example/v1/forecast', 'GET', 'benzer ad (sonek)'],
  ['https://xapi.open-meteo.com/v1/forecast', 'GET', 'benzer ad (önek)'],
  ['https://api.open-meteo.com/v1/air-quality', 'GET', 'listede olmayan yol'],
  ['https://valhalla1.openstreetmap.de/optimized_route', 'POST', 'listede olmayan Valhalla yolu'],
  ['https://valhalla1.openstreetmap.de/route', 'DELETE', 'listede olmayan yöntem'],
  ['https://photon.komoot.io/other', 'GET', 'listede olmayan Photon yolu'],
  ['https://nominatim.openstreetmap.org/details', 'GET', 'listede olmayan Nominatim yolu'],
  ['https://tile.openstreetmap.org/1/1/1.png', 'GET', 'OSM karo sunucusu (izin listesinde değil)'],
  ['https://example.com/', 'GET', 'rastgele köken'],
  ['https://evcopilot.duckdns.org/v1/config', 'GET', 'canlı sunucu (proxyBase değilken)'],
];
for (const [u, m, why] of NOT_LISTED) { const r = R(u, m); ok(`C3 izin listesi dışı reddedilir (${why})`, r === 'not-allowlisted', String(r)); }
for (const p of ['/mapbox/directions', '/here/stations', '/google/stations', '/tomtom/route', '/ocm/poi?x=1', '/overpass', '/v1/occupancy', '/v1/speedlimits', '/v1/tesla', '/v1/map/config'])
  ok(`C4 ara sunucunun sağlayıcı yolu reddedilir: ${p}`, R(PROXY + p) === 'proxy-provider', String(R(PROXY + p)));
ok('C5 çözümlenemeyen adres reddedilir (fail-closed)', R('https://[bad') === 'invalid');
ok('C6 FREE_ENDPOINTS dondurulmuş, kimlik başına tek satır', Object.isFrozen(gate.FREE_ENDPOINTS || {}) && (gate.FREE_ENDPOINTS || []).map((e) => e.id).join() === 'openfreemap,valhalla,open-meteo,photon,nominatim,overpass');
ok('C7 izin listesinde ücretli sağlayıcı yok', (gate.FREE_ENDPOINTS || []).every((e) => e.hosts.every((h) => !/mapbox|google|gstatic|tomtom|here|iternio|arcgis|openchargemap|customer-api/.test(h))));

// =============================================================================================== D) kota + ücretli istek 0 (sanal saat)
{
  let T = 1_000_000;
  const calls = [];
  const target = { fetch: (input, init) => { calls.push(String(typeof input === 'string' ? input : input.url)); return Promise.resolve({ ok: true, status: 200 }); }, location: { origin: ORIGIN } };
  const blocks = [];
  installProviderGate(target, { getProxyBase: () => PROXY, now: () => T, onBlock: (reason, url) => blocks.push([reason, url]) });
  const hit = async (u, init) => { try { await target.fetch(u, init); return null; } catch (e) { return e; } };
  // ücretli: alttaki fetch'e hiç ulaşmaz
  for (const u of PAID) {
    const e = await hit(u, { method: 'POST' });
    ok(`D1 ücretli ${new URL(u).host}: ProviderPausedError, ağa çıkmadı`, e instanceof ProviderPausedError && e.name !== 'TypeError' && e.reason === 'paid-provider');
  }
  for (const p of ['/mapbox/x', '/tomtom/route', '/v1/occupancy', '/v1/map/config']) {
    const e = await hit(PROXY + p, { method: 'POST' });
    ok(`D1b ara sunucu sağlayıcı yolu ${p} ağa çıkmadı`, e instanceof ProviderPausedError && e.reason === 'proxy-provider');
  }
  ok('D2 ücretli/sağlayıcı yollarında alttaki fetch çağrısı 0', calls.length === 0, calls.join(' '));
  ok('D2b engel bildirimi sorgu dizgesini (anahtar olabilir) taşımaz', blocks.length > 0 && blocks.every(([, u]) => !u.includes('?')));
  // Nominatim: en çok saniyede 1 (kullanım politikası), saatte 60
  const NOM = 'https://nominatim.openstreetmap.org/search?q=a&format=jsonv2';
  ok('D3 Nominatim ilk istek geçer', (await hit(NOM)) === null);
  const e2 = await hit(NOM);
  ok('D3b Nominatim 1 sn içinde ikinci istek reddedilir (rate-limit, kuyruk yok)', e2 instanceof ProviderPausedError && e2.reason === 'rate-limit' && e2.name !== 'TypeError');
  T += 1100;
  ok('D3c 1,1 sn sonra yeniden geçer', (await hit(NOM)) === null);
  let okN = 2, rej = 0;
  for (let i = 0; i < 80; i++) { T += 1200; (await hit(NOM)) === null ? okN++ : rej++; }
  ok(`D4 Nominatim saatlik tavan 60 (82 denemede geçen ${okN}, reddedilen ${rej})`, okN === 60 && rej === 22);
  T += 3600e3;
  ok('D4b bir saat sonra pencere boşalır, yeniden geçer', (await hit(NOM)) === null);
  // Valhalla: kısa patlama (rota + yükselti + erişim sorgusu) sonra saniyede 1
  const VH = 'https://valhalla1.openstreetmap.de/route';
  let burst = 0;
  for (let i = 0; i < 10; i++) if ((await hit(VH, { method: 'POST' })) === null) burst++;
  ok(`D5 Valhalla aynı anda en çok 5 istek (geçen ${burst}/10)`, burst === 5);
  T += 1000;
  ok('D5b 1 sn sonra 1 jeton dolar', (await hit(VH, { method: 'POST' })) === null && (await hit(VH, { method: 'POST' })) instanceof ProviderPausedError);
  // 60 sn boyunca saniyede 20 deneme (fırtına) → en çok ~60 istek ağa çıkar
  const before = calls.length;
  for (let s = 0; s < 60; s++) { T += 1000; for (let k = 0; k < 20; k++) await hit(VH, { method: 'POST' }); }
  const vhStorm = calls.length - before;
  ok(`D6 fırtına sınırlanır: 60 sn × 20/sn deneme → ağa çıkan ${vhStorm} (≤ 61)`, vhStorm <= 61 && vhStorm >= 55);
  // Overpass: ayna başına ayrı kova; listede olmayan aynaya geçilemez
  const OP = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  T += 3600e3;
  const perMirror = OP.map(() => 0);
  for (const [j, u] of OP.entries()) for (let i = 0; i < 5; i++) if ((await hit(u, { method: 'POST' })) === null) perMirror[j]++;
  ok(`D7 Overpass ayna başına en çok 2 eşzamanlı (adil kullanım): ${perMirror.join('/')}`, perMirror.every((n) => n === 2));
  // Open-Meteo yükselti 100 noktalık parçalar: 10 parça patlaması geçer
  let om = 0;
  for (let i = 0; i < 12; i++) if ((await hit('https://api.open-meteo.com/v1/elevation?latitude=1&longitude=2')) === null) om++;
  ok(`D8 Open-Meteo patlama 10 (yükselti parçaları), sonrası reddedilir: ${om}/12`, om === 10);
  // her uçta saatlik tavan sonlu ve politika notu var
  ok('D9 her ücretsiz uçta burst ≥ 1, gapMs > 0, perHour sonlu, terms notu', (gate.FREE_ENDPOINTS || []).every((e) => e.burst >= 1 && e.gapMs > 0 && Number.isFinite(e.perHour) && e.perHour > 0 && typeof e.terms === 'string' && e.terms.length > 10));
  const nomE = (gate.FREE_ENDPOINTS || []).find((e) => e.id === 'nominatim');
  ok('D9b Nominatim: burst 1 ve aralık ≥ 1000 ms (en çok 1 istek/sn)', nomE?.burst === 1 && nomE?.gapMs >= 1000);
  // duraklatma modunda limiter devre dışı ve her harici reddedilir (A ile tutarlı)
  gate.setProviderMode('paused');
  const eP = await hit('https://api.open-meteo.com/v1/forecast?x');
  ok('D11 paused moduna dönünce ücretsiz servis de reddedilir (external)', eP instanceof ProviderPausedError && eP.reason === 'external');
  gate.setProviderMode('free-only');
}

// =============================================================================================== E) harita
{
  const fm = gate.freeMapRequest || (() => ({ url: 'x' }));
  const BLOCKED = gate.BLOCKED_MAP_URL;
  ok('E1 MapLibre isteği: OpenFreeMap karosu aynen geçer', fm('https://tiles.openfreemap.org/planet/1/2/3.pbf').url === 'https://tiles.openfreemap.org/planet/1/2/3.pbf');
  for (const u of ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1', 'https://api.mapbox.com/v4/x.vector.pbf', 'https://api.tomtom.com/map/1/tile/basic/main/1/1/1.pbf', 'https://tile.openstreetmap.org/1/1/1.png', 'http://tiles.openfreemap.org/planet/1/1/1.pbf'])
    ok(`E2 MapLibre (Worker) isteği engellenir → boş data: adresi: ${new URL(u).host}`, typeof BLOCKED === 'string' && BLOCKED.startsWith('data:') && fm(u).url === BLOCKED);
  const ml = read('js/ui/maps/maplibre.js');
  ok('E3 maplibre.js: duraklatma dalı aynen (OFFLINE_STYLE, Esri/3B yok)', /if \(paused\) return createVectorMap\(ml, container, \{ mapOptions: \{ style: structuredClone\(OFFLINE_STYLE\) \}, name: 'offline' \}\)/.test(ml));
  ok('E4 maplibre.js: free-only dalı OpenFreeMap STYLE + transformRequest: freeMapRequest, uydu (Esri) YOK', /if \(freeOnly\) return createVectorMap\(ml, container, \{ mapOptions: \{ style: STYLE, transformRequest: freeMapRequest \}, name: 'osm', buildings: BUILDINGS \}\)/.test(ml));
  const fo = ml.slice(ml.indexOf('if (freeOnly)'), ml.indexOf('\n', ml.indexOf('if (freeOnly)')));
  ok('E4b free-only satırında esriSatellite yok', fo.length > 10 && !/esriSatellite|satellite/.test(fo));
  ok('E5 maplibre.js: duraklatma free-only\'den ÖNCE denetlenir (ikisi birden → boş stil)', ml.indexOf('if (paused) return') > 0 && ml.indexOf('if (paused) return') < ml.indexOf('if (freeOnly) return'));
  const mv = read('js/ui/mapView.js');
  const i = mv.indexOf('async function openAdapter()'), j = mv.indexOf('resolveProvider()', i);
  const head = mv.slice(i, j);
  ok('E6 mapView: free-only dalı /v1/map/config (resolveProvider) ve Mapbox/Google/TomTom\'dan ÖNCE, doğrudan OpenFreeMap', i > 0 && j > i && /if \(freeOnlyMode\(\)\) \{[\s\S]*?return createMapLibreMap\(mapEl, \{ paused: false, freeOnly: true \}\);/.test(head));
  ok('E7 mapView: duraklatma dalı korunur ve free-only\'den önce', /if \(providerRequestsPaused\(\)\) \{[\s\S]*?return createMapLibreMap\(mapEl, \{ paused: true \}\);/.test(head) && head.indexOf('providerRequestsPaused()') < head.indexOf('freeOnlyMode()'));
}

// =============================================================================================== F) rota / istasyon / hava (gerçek modüller)
{
  let T = 5_000_000;
  innerCalls.length = 0;
  const realNow = Date.now;
  installProviderGate(globalThis, { getOrigin: () => ORIGIN, getProxyBase: () => PROXY, now: () => T });
  const proxy = await import('../js/net/proxy.js');
  ok('F0 sahte dünyada sunucu yetenekleri "açık" görünür (kapı olmasa ücretli seçilirdi)', proxy.premiumAccess() === true);
  for (const c of ['mapbox', 'here', 'ocm', 'overpass', 'occupancy', 'occupancyLocked', 'tomtom', 'googleStations'])
    ok(`F1 free-only: proxyHas('${c}') false (ücretli/ara sunucu sağlayıcı yolu seçilmez)`, proxy.proxyHas(c) === false);
  const mb = await import('../js/mapbox/api.js');
  ok('F2 free-only: kişisel Mapbox anahtarı kullanılmaz (mapboxKey boş)', mb.mapboxKey() === '');
  const ch = await import('../js/osm/chargers.js');
  ok('F3 free-only: OpenChargeMap anahtarı kullanılmaz (ocmKey boş)', ch.ocmKey() === '');
  const prov = await import('../js/providers/index.js');
  // rota
  innerCalls.length = 0;
  let rErr = null;
  try { await prov.fetchRoute({ lat: 39.92, lon: 32.85 }, { lat: 41.01, lon: 28.97 }); } catch (e) { rErr = e; }
  const hostsOf = () => [...new Set(innerCalls.map((c) => { try { return new URL(c.url).host; } catch { return c.url; } }))];
  ok(`F4 rota: yalnız Valhalla'ya gidildi (${hostsOf().join(',')})`, innerCalls.length >= 1 && hostsOf().every((h) => h === 'valhalla1.openstreetmap.de'), String(rErr?.message || ''));
  // trafik (ücretli tek kaynak) → istek yok
  innerCalls.length = 0;
  T += 60e3;
  const tr = await prov.fetchTrafficAhead({ lat: 39.92, lon: 32.85 }, { lat: 41.01, lon: 28.97 }).catch((e) => e);
  ok('F5 trafik: ücretli kaynak denenmez, sonuç null, istek 0', tr === null && innerCalls.length === 0, String(tr?.message || tr));
  // istasyon (çevre araması)
  innerCalls.length = 0;
  T += 60e3;
  const st = await prov.fetchAround(39.92, 32.85, 10, true).catch((e) => e);
  const sh = hostsOf();
  ok(`F6 istasyon: yalnız Overpass aynaları (${sh.join(',')})`, sh.length >= 1 && sh.every((h) => /^overpass(-api\.de|\.private\.coffee|\.kumi\.systems)$/.test(h)), String(st?.message || ''));
  ok('F6b istasyon: Overpass aynası en çok 3 kez denendi (fırtına yok)', innerCalls.length <= 3, String(innerCalls.length));
  // hava
  innerCalls.length = 0;
  T += 60e3;
  await prov.fetchWeather([{ lat: 39.92, lon: 32.85, t: Date.now() + 3600e3 }]).catch(() => null);
  ok(`F7 hava: yalnız api.open-meteo.com (${hostsOf().join(',')})`, innerCalls.length >= 1 && hostsOf().every((h) => h === 'api.open-meteo.com'));
  // yükselti
  innerCalls.length = 0;
  T += 60e3;
  await prov.fetchElevations([{ lat: 39.9, lon: 32.8 }, { lat: 40.0, lon: 32.9 }, { lat: 40.1, lon: 33.0 }]).catch(() => null);
  ok(`F8 yükselti: Valhalla /height, yedek Open-Meteo elevation (${hostsOf().join(',')})`, innerCalls.length >= 1 && hostsOf().every((h) => h === 'valhalla1.openstreetmap.de' || h === 'api.open-meteo.com'));
  Date.now = realNow;
}
const leaked = innerCalls.filter((c) => /mapbox|google|tomtom|here|iternio|arcgis|openchargemap|proxy\.invalid\.test\/(mapbox|here|google|tomtom|ocm|overpass|v1\/(occupancy|speedlimits|tesla|map))/.test(c.url));
ok('F10 tüm test boyunca ücretli/sağlayıcı yolu isteği 0', leaked.length === 0, leaked.map((c) => c.url).join(' '));

// =============================================================================================== G) build-beta --free-only
{
  const BUILDER = join(ROOT, 'scripts', 'build-beta.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'evrf-freeonly-'));
  const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [BUILDER, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  try {
    const out = join(tmp, 'out');
    const r1 = run(['--free-only', out]);
    ok('G1 build-beta --free-only geçici klasöre üretir', r1.code === 0 && existsSync(join(out, 'js', 'net', 'providerGate.js')), r1.out.slice(-400));
    const built = existsSync(join(out, 'js', 'net', 'providerGate.js')) ? readFileSync(join(out, 'js', 'net', 'providerGate.js'), 'utf8') : '';
    ok('G2 çıktıda PROVIDER_MODE_BUILD = \'free-only\' (tek satır)', (built.match(/export const PROVIDER_MODE_BUILD = 'free-only';/g) || []).length === 1);
    ok('G3 kaynak providerGate.js değişmedi (beta-full)', /export const PROVIDER_MODE_BUILD = 'beta-full';/.test(read('js/net/providerGate.js')));
    if (built) {
      const bg = await import(pathToFileURL(join(out, 'js', 'net', 'providerGate.js')).href + '?b=' + Date.now());
      ok('G4 üretilen modül: freeOnlyMode() true, providerRequestsPaused() false', bg.freeOnlyMode() === true && bg.providerRequestsPaused() === false);
      ok('G4b üretilen modül: Mapbox reddedilir, Open-Meteo geçer', bg.blockedReason('https://api.mapbox.com/x', { origin: ORIGIN }) === 'paid-provider' && bg.blockedReason('https://api.open-meteo.com/v1/forecast', { origin: ORIGIN }) === null);
    }
    ok('G5 çıktıda yerel test işareti (FREE-ONLY-LOCAL-TEST.txt) ve başlık', existsSync(join(out, 'FREE-ONLY-LOCAL-TEST.txt')) && /<title>EV Route Finder \(Beta – yerel ücretsiz test\)<\/title>/.test(existsSync(join(out, 'index.html')) ? readFileSync(join(out, 'index.html'), 'utf8') : ''));
    const r2 = run(['--free-only']);
    ok('G6 --free-only klasörsüz reddedilir (varsayılan ../ev-copilot-beta yayın deposuna ASLA yazılmaz)', r2.code !== 0 && /free-only/.test(r2.out));
    // Gerçek yayın deposu yolu ASLA çalıştırılmaz (test-package-parity ile aynı kural): ret statik denetlenir; o klasörde .git
    // olduğu için G8'deki git deposu reddi de onu ayrıca korur.
    const bb = read('scripts/build-beta.mjs');
    const iOut = bb.indexOf('const out = resolve(');
    ok('G7 --free-only yayın deposu (../ev-copilot-beta) ve git deposu reddi, klasör silme/yazmadan ÖNCE', iOut > 0
      && /if \(FREE_ONLY && out\.toLowerCase\(\) === PUBLIC_REPO\.toLowerCase\(\)\) throw/.test(bb) && /if \(FREE_ONLY && existsSync\(join\(out, '\.git'\)\)\) throw/.test(bb)
      && bb.indexOf("existsSync(join(out, '.git'))") < bb.indexOf('mkdirSync(out') && bb.indexOf('PUBLIC_REPO.toLowerCase()') < bb.indexOf('rmSync(join(out'));
    const gitDir = join(tmp, 'repo');
    mkdirSync(join(gitDir, '.git'), { recursive: true });
    const r4 = run(['--free-only', gitDir]);
    ok('G8 --free-only git deposu olan klasör reddedilir (push edilemesin)', r4.code !== 0 && existsSync(join(gitDir, '.git')) && !existsSync(join(gitDir, 'js')));
    const r5 = run(['--free-only', join(ROOT, 'tmp-out')]);
    ok('G9 proje içi klasör reddedilir', r5.code !== 0 && !existsSync(join(ROOT, 'tmp-out')));
    const r6 = run(['--free', join(tmp, 'x')]);
    ok('G10 bilinmeyen bayrak reddedilir (fail-closed)', r6.code !== 0 && !existsSync(join(tmp, 'x', 'js')));
    const out2 = join(tmp, 'plain');
    const r7 = run([out2]);
    const plain = existsSync(join(out2, 'js', 'net', 'providerGate.js')) ? readFileSync(join(out2, 'js', 'net', 'providerGate.js'), 'utf8') : '';
    ok('G11 bayraksız build-beta bugünkü gibi: paused kalır, işaret dosyası yok', r7.code === 0 && /PROVIDER_MODE_BUILD = 'paused';/.test(plain) && !existsSync(join(out2, 'FREE-ONLY-LOCAL-TEST.txt')));

    // ============================================================================================= I) yerel test sunucusu
    const sv = await import('./serve-local-test.mjs');
    const thr = (fn) => { try { fn(); return null; } catch (e) { return e; } };
    ok('I1 sunucu: klasörsüz, bilinmeyen bayrak, 0.0.0.0, sertifikasız --https, düşük port reddedilir',
      !!thr(() => sv.parseArgs([])) && !!thr(() => sv.parseArgs([out, '--public'])) && !!thr(() => sv.parseArgs([out, '--host', '0.0.0.0']))
      && !!thr(() => sv.parseArgs([out, '--https'])) && !!thr(() => sv.parseArgs([out, '--port', '80'])));
    const d = sv.parseArgs([out]);
    ok('I2 sunucu varsayılanı yalnız 127.0.0.1:8080 (adb reverse), https 8443', d.host === '127.0.0.1' && d.port === 8080 && sv.parseArgs([out, '--https', '--cert', 'c', '--key', 'k', '--host', '192.168.1.20']).port === 8443);
    let refused = null;
    try { await sv.startServer({ ...d, dir: out2, port: 0 }); } catch (e) { refused = e; }
    ok('I3 sunucu --free-only olmayan derlemeyi sunmaz (işaret dosyası yok)', !!refused && /FREE-ONLY-LOCAL-TEST/.test(refused.message));
    const srv = await sv.startServer({ ...d, dir: out, port: 0 });
    const port = srv.address().port;
    const { request } = await import('node:http');
    const get = (path) => new Promise((ok2) => { const rq = request({ host: '127.0.0.1', port, path, method: 'GET' }, (rs) => { let b = ''; rs.on('data', (c) => (b += c)); rs.on('end', () => ok2({ status: rs.statusCode, type: rs.headers['content-type'], body: b })); }); rq.on('error', (e) => ok2({ status: 0, body: String(e) })); rq.end(); });
    try {
      const v = await get('/version.js');
      const gpb = await get('/js/net/providerGate.js');
      const tr = await get('/..%2f..%2fpackage.json');
      const idx = await get('/');
      ok('I4 sunucu yerel derlemeyi sunar: version.js + free-only providerGate.js + index.html', v.status === 200 && /APP_VERSION/.test(v.body) && /PROVIDER_MODE_BUILD = 'free-only'/.test(gpb.body) && /javascript/.test(gpb.type || '') && idx.status === 200 && /yerel ücretsiz test/.test(idx.body));
      ok('I5 sunucu klasör dışına çıkamaz (yol aşımı 403/404)', tr.status === 403 || tr.status === 404, String(tr.status));
    } finally { srv.close(); }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// =============================================================================================== H) kaynak değişmezleri
{
  const pg = read('js/net/providerGate.js');
  ok('H1 providerGate: harici adresler https:// öneksiz ana makine adı (çağrı grafiği köken kümesi değişmez)', !/https:\/\//.test(pg) && /'valhalla1\.openstreetmap\.de'/.test(pg));
  ok('H2 sunucu dosyalarına dokunulmadı (server/providerGate.mjs varsayılanı duraklatılmış)', /providerPaused/.test(read('server/providerGate.mjs')));
  ok('H3 proxy.js: proxyHas free-only\'de false', /export const proxyHas = \(what\) => !freeOnlyMode\(\) && !!\(hasCreds\(\) && caps\?\.\[what\]\);/.test(read('js/net/proxy.js')));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
