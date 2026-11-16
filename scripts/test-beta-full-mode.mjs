// TAM BETA (beta-full) derleme modu — kabul testleri. Kullanıcı kararı (2026-11-16): Beta'da public-free ile kapatılan/gizlenen tüm mevcut
// özellikler (hesap, Premium, sağlayıcı bağdaştırıcıları, uydu, canlı trafik, doluluk/fiyat, eşitleme, telemetri, kimlikli sunucu) geri gelir.
// node scripts/test-beta-full-mode.mjs   (çevrimdışı; gerçek ağ YOK, gerçek anahtar YOK, ücretli API YOK; sahte fetch + sanal saat)
//
// Kaynakta mod 'paused' kalır; yalnız `node scripts/build-beta.mjs --beta-full [klasör]` çıktısında 'beta-full' olur.
// beta-full = istemcide küresel duraklatma YOK, public-free gizleme/kesme YOK (eski 0.99.61 Beta mimarisi: Free/Premium ve kota kararı
// paylaşılan sunucuda). Korunan: topluluk servislerine (FREE_ENDPOINTS) cihaz başı jeton kovası + saatlik tavan + yanıt geri çekilmesi.
// Bölümler: A kaynak varsayılanı · B mod ayrıştırma · C ağ kararı (hiçbir mevcut özellik kesilmez) · D topluluk servisi tavanı/geri çekilme ·
// E proxy.js kimlikli sunucu entegrasyonu ve Free/Premium kapısı · F harita/uydu · G arayüz (public-free sınıfı yok) · H derleme.
import { readFileSync, mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (r) => readFileSync(join(ROOT, r), 'utf8');

// ---- sahte dünya: alttaki fetch ağa çıkmaz, her çağrıyı kaydeder ----
const innerCalls = [];
let netMode = 'ok'; // 'ok' | '503' | 'offline'
const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[String(k).toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });
globalThis.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  const hdr = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : { ...(init.headers || {}) };
  innerCalls.push({ url, method: String(init.method || 'GET').toUpperCase(), headers: hdr });
  if (netMode === 'offline') return Promise.reject(new TypeError('Failed to fetch (sahte)'));
  if (netMode === '503') return Promise.resolve(res(503, {}));
  const u = new URL(url);
  if (u.pathname === '/v1/me') return Promise.resolve(res(200, { user: { premium: false }, caps: { mapbox: true, here: true, ocm: true, overpass: true, occupancy: true, tomtom: true, googleStations: true } }));
  return Promise.resolve(res(200, {}));
};
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k), key: (i) => [...stored.keys()][i] ?? null, get length() { return stored.size; } };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window = globalThis;
const htmlClasses = new Set();
globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {}, dispatchEvent() {}, documentElement: { lang: 'tr', classList: { add: (c) => htmlClasses.add(c) } }, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
console.info = () => {};
const ORIGIN = 'https://ozdemirumit.github.io';
const SHARED = 'https://evcopilot.duckdns.org';
stored.set('evcp.session', JSON.stringify({ token: 'FAKE-SESSION-TOKEN', email: 'x@example.invalid' }));

const gate = await import('../js/net/providerGate.js');
const { blockedReason, installProviderGate } = gate;

// ============================================================================ A) kaynak varsayılanı değişmedi (Production/diğer derlemeler)
ok('A1 kaynak: PROVIDER_MODE_BUILD = \'paused\' (beta-full yalnız build-beta --beta-full çıktısında)', gate.PROVIDER_MODE_BUILD === 'paused' && gate.providerMode() === 'paused');
ok('A2 kaynak: betaFullMode() false, küresel duraklatma açık', typeof gate.betaFullMode === 'function' && gate.betaFullMode() === false && gate.providerRequestsPaused() === true);

// ============================================================================ B) mod ayrıştırma (fail-closed)
ok('B1 \'beta-full\' tam eşleşmeyle açılır', gate.parseProviderMode('beta-full') === 'beta-full');
for (const v of ['Beta-Full', ' beta-full', 'beta-full ', 'betafull', 'full', 'open']) ok(`B2 belirsiz mod ${JSON.stringify(v)} → paused`, gate.parseProviderMode(v) === 'paused');
gate.setProviderMode('beta-full');
ok('B3 beta-full: providerMode beta-full, duraklatma yok, free-only/public-free kısıtı yok', gate.providerMode() === 'beta-full' && gate.betaFullMode() && !gate.providerRequestsPaused() && !gate.freeOnlyMode() && !gate.publicFreeMode());

// ============================================================================ C) ağ kararı: hiçbir mevcut özellik istemcide kesilmez
const R = (url, method = 'GET') => blockedReason(url, { origin: ORIGIN, proxyBase: SHARED, method });
const OPEN = [
  [SHARED + '/v1/config?v=1', 'kimliksiz cihaz sayımı / giriş sağlayıcıları'], [SHARED + '/v1/me', 'hesap/plan'], [SHARED + '/v1/auth/poll?nonce=x', 'Google girişi'],
  [SHARED + '/v1/sync/places', 'eşitleme'], [SHARED + '/v1/history/trips', 'geçmiş'], [SHARED + '/v1/price', 'fiyat bildirimi'], [SHARED + '/v1/presence', 'varlık'],
  [SHARED + '/v1/occupancy', 'canlı doluluk'], [SHARED + '/v1/tariffs', 'tarife/fiyat'], [SHARED + '/v1/station/info', 'istasyon bilgisi'], [SHARED + '/v1/station/photo/1', 'fotoğraf'],
  [SHARED + '/v1/map/config', 'harita sağlayıcı yapılandırması'], [SHARED + '/v1/speedlimits', 'hız limiti'], [SHARED + '/v1/tesla', 'Tesla katmanı'],
  [SHARED + '/mapbox/route', 'Mapbox rota (Premium, sunucu kapısı)'], [SHARED + '/tomtom/route', 'TomTom canlı trafik rota'], [SHARED + '/here/stations', 'HERE'], [SHARED + '/google/stations', 'Google'],
  [SHARED + '/ocm/poi', 'OpenChargeMap'], [SHARED + '/overpass', 'sunucu Overpass'], [SHARED + '/health', 'eski yönetici kodu sağlığı'],
  ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/1/1/1', 'uydu'], ['https://api.mapbox.com/styles/v1/x', 'Mapbox harita (sunucu belirteci)'],
  ['https://maps.googleapis.com/maps/api/js', 'Google Maps (Premium)'], ['https://api.tomtom.com/map/1/x', 'TomTom harita (Premium)'], ['https://api.iternio.com/1/tlm/send', 'ABRP telemetri'],
  ['https://nominatim.openstreetmap.org/search?q=a', 'Nominatim'], ['https://overpass-api.de/api/interpreter', 'overpass-api.de'], ['https://valhalla1.openstreetmap.de/locate', 'Valhalla /locate'],
];
for (const [u, why] of OPEN) ok(`C1 kesilmez: ${why}`, R(u) === null && R(u, 'POST') === null, String(R(u)));

// ============================================================================ D) topluluk servisi: cihaz başı tavan + yanıt geri çekilmesi korunur
let T = 20_000_000_000;
const clock = () => T;
const blocks = [];
installProviderGate(globalThis, { getOrigin: () => ORIGIN, getProxyBase: () => SHARED, now: clock, store: { getItem: () => null, setItem() {} }, onBlock: (r) => blocks.push(r) });
{
  innerCalls.length = 0;
  const NOM = 'https://nominatim.openstreetmap.org/search?q=a';
  await fetch(NOM);
  let second = null;
  try { await fetch(NOM); } catch (e) { second = e; }
  ok('D1 Nominatim art arda ikinci istek ağa çıkmadan reddedilir (jeton kovası, 1 istek/1,1 sn)', innerCalls.length === 1 && second?.code === 'provider_paused' && second?.reason === 'rate-limit', `${innerCalls.length} ${second?.reason}`);
  T += 60e3;
  innerCalls.length = 0;
  netMode = '503';
  const OVP = 'https://overpass-api.de/api/interpreter';
  await fetch(OVP, { method: 'POST' });
  T += 5e3;
  let third = null;
  try { await fetch(OVP, { method: 'POST' }); } catch (e) { third = e; }
  ok('D2 Overpass 503 sonrası ana makine geri çekilir: 5 sn sonraki istek ağa çıkmaz (backoff)', innerCalls.length === 1 && third?.reason === 'backoff', `${innerCalls.length} ${third?.reason}`);
  T += 31e3;
  netMode = 'ok';
  await fetch(OVP, { method: 'POST' });
  ok('D3 geri çekilme süresi (30 sn) bitince yeniden denenir', innerCalls.length === 2);
  // paylaşılan sunucu ve ücretli/anahtarlı uçlar topluluk kovasına girmez (sunucu kendi kota/Premium kararını verir)
  innerCalls.length = 0;
  netMode = 'ok';
  for (let i = 0; i < 20; i++) await fetch(SHARED + '/v1/occupancy?x=' + i);
  ok('D4 sunucu yolları istemci kovasıyla kesilmez (20/20 ağa çıktı; tavan sunucuda)', innerCalls.length === 20);
  netMode = '503';
  await fetch(SHARED + '/v1/occupancy');
  netMode = 'ok';
  innerCalls.length = 0;
  await fetch(SHARED + '/v1/occupancy');
  ok('D5 sunucu 503 istemci ana makine geri çekilmesi başlatmaz (sunucu yeniden denemesi proxy.js ortak kapısında)', innerCalls.length === 1);
}

// ============================================================================ E) proxy.js: kimlikli sunucu entegrasyonu, Free/Premium sunucu kararı
{
  const proxy = await import('../js/net/proxy.js');
  stored.set('evcp.proxyCode', JSON.stringify('FAKE-ACCESS-CODE'));
  ok('E1 oturum okunur; eski yönetici erişim kodu okunur (public-free kısıtı yok)', proxy.getSession()?.token === 'FAKE-SESSION-TOKEN' && proxy.proxyCode() === 'FAKE-ACCESS-CODE');
  innerCalls.length = 0;
  const r = await proxy.refreshCaps();
  ok('E2 refreshCaps /v1/me Authorization ile sorulur', r.ok === true && innerCalls.some((c) => c.url === SHARED + '/v1/me' && c.headers.authorization === 'Bearer FAKE-SESSION-TOKEN'));
  ok('E3 Free hesap: Mapbox/HERE/OCM/Overpass sunucu yolları açık, TomTom/Google/doluluk Premium kapısında kapalı (occupancyLocked)',
    proxy.proxyHas('mapbox') && proxy.proxyHas('ocm') && proxy.proxyHas('overpass') && !proxy.proxyHas('tomtom') && !proxy.proxyHas('googleStations') && !proxy.proxyHas('occupancy') && proxy.proxyHas('occupancyLocked'));
  innerCalls.length = 0;
  await proxy.proxyFetch('/v1/occupancy?ids=1');
  ok('E4 proxyFetch sunucuya gider (shared-server reddi yok), X-Device-Id + Authorization', innerCalls.length === 1 && innerCalls[0].headers['x-device-id'] && innerCalls[0].headers.authorization === 'Bearer FAKE-SESSION-TOKEN');
  innerCalls.length = 0;
  const cfg = await proxy.serverConfig();
  ok('E5 serverConfig /v1/config sorar (giriş sağlayıcıları)', cfg !== null && innerCalls.some((c) => c.url.startsWith(SHARED + '/v1/config')));
  const { mapboxKey } = await import('../js/mapbox/api.js');
  ok('E6 Mapbox anahtarı sunucudan (proxy), kişisel anahtar okunabilir durumda', mapboxKey() === 'proxy');
}

// ============================================================================ F) harita / uydu
{
  const mv = read('js/ui/mapView.js');
  ok('F1 mapView: beta-full\'de providerRequestsPaused/freeOnlyMode false → /v1/map/config + sağlayıcı seçimi yolu', gate.providerRequestsPaused() === false && gate.freeOnlyMode() === false && /providerRequestsPaused\(\)/.test(mv));
}

// ============================================================================ G) arayüz: public-free sınıfı eklenmez (hesap/uydu/trafik/Premium gizlenmez)
await import('../js/net/providerGateInstall.js');
ok('G1 <html> public-free sınıfı almaz', !htmlClasses.has('public-free'));
ok('G2 stationCard public-free dalı yalnız publicFreeMode()\'da (beta-full\'de doluluk/puan/fotoğraf açık)', /if \(publicFreeMode\(\)\)/.test(read('js/ui/stationCard.js')) && gate.publicFreeMode() === false);

// ============================================================================ H) derleme
{
  const BUILDER = join(ROOT, 'scripts', 'build-beta.mjs');
  const run = (args) => { try { return { code: 0, out: execFileSync(process.execPath, [BUILDER, ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  const tmp = mkdtempSync(join(tmpdir(), 'evrf-betafull-'));
  try {
    const out = join(tmp, 'build');
    const r = run(['--beta-full', out]);
    ok('H1 --beta-full derlenir', r.code === 0 && existsSync(join(out, 'index.html')), r.out.slice(-300));
    const pg = readFileSync(join(out, 'js', 'net', 'providerGate.js'), 'utf8');
    ok('H2 çıktıda PROVIDER_MODE_BUILD = \'beta-full\' tam bir kez, kaynak \'paused\' kaldı', (pg.match(/export const PROVIDER_MODE_BUILD = 'beta-full';/g) || []).length === 1 && /export const PROVIDER_MODE_BUILD = 'paused';/.test(read('js/net/providerGate.js')));
    ok('H3 başlık "(Beta)", kapı/yerel test işareti yok', readFileSync(join(out, 'index.html'), 'utf8').includes('<title>EV Route Finder (Beta)</title>') && !existsSync(join(out, 'PUBLIC-BETA-GATE-BLOCKED.txt')) && !existsSync(join(out, 'FREE-ONLY-LOCAL-TEST.txt')));
    ok('H4 çıktıda server/, .env, docs/, scripts/ yok', !existsSync(join(out, 'server')) && !existsSync(join(out, '.env')) && !existsSync(join(out, 'docs')) && !existsSync(join(out, 'scripts')));
    const built = await import(pathToFileURL(join(out, 'js', 'net', 'providerGate.js')).href);
    ok('H5 derlenmiş kapı modülü beta-full modunda açılır (duraklatma yok)', built.providerMode() === 'beta-full' && built.providerRequestsPaused() === false && built.blockedReason(SHARED + '/v1/occupancy', { origin: ORIGIN, proxyBase: SHARED }) === null);
    const repo = join(tmp, 'fake-publish-repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(join(repo, 'README.md'), 'korunur');
    const r2 = run(['--beta-full', repo]);
    ok('H6 --beta-full yayın deposu (git) hedefine yazabilir, README/.git korunur', r2.code === 0 && existsSync(join(repo, 'index.html')) && existsSync(join(repo, 'README.md')) && existsSync(join(repo, '.git')), r2.out.slice(-200));
    ok('H7 --beta-full ile --public-free / --free-only birlikte reddedilir', run(['--beta-full', '--public-free', join(tmp, 'x')]).code !== 0 && run(['--beta-full', '--free-only', join(tmp, 'y')]).code !== 0);
    ok('H8 proje içi klasör reddedilir', run(['--beta-full', join(ROOT, 'tmp-betafull-build')]).code !== 0 && !existsSync(join(ROOT, 'tmp-betafull-build')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
