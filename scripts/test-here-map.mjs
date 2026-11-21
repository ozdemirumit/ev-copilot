// HERE haritası (Premium harita sağlayıcısı) testleri (bağımsız, düz node): node scripts/test-here-map.mjs
// Kapsam: server/maps.mjs (HERE_MAP_KEY ayrı tarayıcı anahtarı; HERE_API_KEY asla tarayıcıya gitmez), katalog (yalnızca harita bağlı; rota/trafik coming-soon),
// istemci bağdaştırıcısı js/ui/maps/here.js (raster karo adresi, uydu stratejisi, kimlik hatası), kablolama ve gerçek sunucu uçtan uca (alt süreç, YALNIZCA SAHTE anahtar,
// ücretli çağrı yok). Portlar 18890-18892.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const { createMaps, PROVIDERS } = await import('../server/maps.mjs');
const { buildCatalog, catalogEntry } = await import('../server/providerCatalog.mjs');
const mk = (env, settings = {}) => createMaps({ data: { users: {}, settings }, save() {} }, env);

const HK = 'SAHTE-here-harita-anahtari-0123';
const HSRV = 'SAHTE-here-sunucu-anahtari-9999';

// ---- A) server/maps.mjs ----
ok('A PROVIDERS here içerir', PROVIDERS.includes('here') && PROVIDERS.slice(0, 4).join() === 'osm,mapbox,google,tomtom');
{
  const m = mk({ HERE_MAP_KEY: HK });
  ok('A anahtar varsa available.here true', m.available().here === true);
  ok('A premium: config yalnızca harita anahtarını taşır', JSON.stringify(m.config({ mapProvider: 'here' }, true)) === JSON.stringify({ provider: 'here', key: HK }));
  ok('A premium değilse osm', JSON.stringify(m.config({ mapProvider: 'here' }, false)) === '{"provider":"osm"}');
  ok('A effective here', m.effective({ mapProvider: 'here' }, true) === 'here');
  const u = {}; m.setUser(u, 'here');
  ok('A kullanıcı here seçebilir', u.mapProvider === 'here');
  m.setDefault('here');
  ok('A yönetici varsayılanı here olabilir', m.getDefault() === 'here' && m.config({}, true).provider === 'here');
  ok('A varsayılan yalnızca anahtar var diye HERE olmaz (yönetici seçmedikçe osm)', mk({ HERE_MAP_KEY: HK }).getDefault() === 'osm');
  ok('A TomTom anahtarı varken varsayılan yine tomtom', mk({ HERE_MAP_KEY: HK, TOMTOM_MAP_KEY: 'tt' }).getDefault() === 'tomtom');
}
for (const env of [{}, { HERE_MAP_KEY: '' }, { HERE_MAP_KEY: '   ' }, { HERE_API_KEY: HSRV }, { HERE_API_KEY: HSRV, HERE_MAP_KEY: '  ' }]) {
  const m = mk(env), tag = JSON.stringify(Object.keys(env));
  ok('A anahtarsız/boşluk/yalnız sunucu anahtarı → here kullanılamaz ' + tag, m.available().here === false);
  ok('A → Premium here seçimi osm ' + tag, JSON.stringify(m.config({ mapProvider: 'here' }, true)) === '{"provider":"osm"}');
  let t1 = false; try { m.setUser({}, 'here'); } catch { t1 = true; }
  let t2 = false; try { m.setDefault('here'); } catch { t2 = true; }
  ok('A → setUser/setDefault here reddedilir ' + tag, t1 && t2);
}
{
  const m = mk({ HERE_MAP_KEY: HK, HERE_API_KEY: HSRV, TOMTOM_KEY: 'srv-tt', MAPBOX_TOKEN: 'srv-mb' });
  const all = JSON.stringify([m.available(), m.getDefault(), m.config({ mapProvider: 'here' }, true), m.config({}, true), m.config({ mapProvider: 'osm' }, true)]);
  ok('A sunucu anahtarları (HERE_API_KEY, TOMTOM_KEY, MAPBOX_TOKEN) hiçbir çıktıda yok', !all.includes(HSRV) && !all.includes('srv-tt') && !all.includes('srv-mb'));
  const padded = ` ${HK} `;
  ok('A geçerli anahtar kırpılmadan, aynen döner', mk({ HERE_MAP_KEY: padded }).config({ mapProvider: 'here' }, true).key === padded);
}

// ---- B) katalog ----
{
  const e = catalogEntry('here');
  ok('B here: harita bağlı, rota ve trafik değil', e.wired.map === true && e.wired.route === false && e.wired.traffic === false);
  ok('B here: rota/trafik coming-soon, harita değil', e.comingSoon.includes('route') && e.comingSoon.includes('traffic') && !e.comingSoon.includes('map'));
  ok('B here lisansı unverified kalır (yapılandırma yükseltemez)', e.licenseStatus === 'unverified');
  const prov = (cat, id) => cat.providers.find((p) => p.id === id);
  const sel = (cat) => JSON.stringify(cat.providers.filter((p) => p.selectable).map((p) => p.id));
  const on = buildCatalog({ plan: 'premium', configured: { here: { map: true } } });
  ok('B Premium + here anahtarı: here seçilebilir', prov(on, 'here').selectable === true && prov(on, 'here').status === 'available' && sel(on) === '["osm","here"]');
  ok('B here rota seçilebilir gibi görünmez + uyarılar', prov(on, 'here').routeAvailable === false && prov(on, 'here').warnings.includes('route-coming-soon') && prov(on, 'here').warnings.includes('license-unverified'));
  ok('B here rota/trafik coming-soon', prov(on, 'here').capabilities.route.status === 'coming-soon' && prov(on, 'here').capabilities.traffic.status === 'coming-soon');
  const nocfg = buildCatalog({ plan: 'premium', configured: {} });
  ok('B Premium, anahtar yok: here not-configured, seçilemez', prov(nocfg, 'here').status === 'not-configured' && !prov(nocfg, 'here').selectable);
  const free = buildCatalog({ plan: 'free', configured: { here: { map: true, route: true } } });
  ok('B Free: here premium-required, seçilemez', prov(free, 'here').status === 'premium-required' && !prov(free, 'here').selectable && sel(free) === '["osm"]');
  ok('B rota bayrağı HERE rotasını açmaz', buildCatalog({ plan: 'premium', configured: { here: { map: true, route: true } } }).providers.find((p) => p.id === 'here').routeAvailable === false);
}

// ---- C) istemci bağdaştırıcısı js/ui/maps/here.js ----
const H = await import('../js/ui/maps/here.js');
{
  const night = H.hereStyle(HK, false), sat = H.hereStyle(HK, true);
  const nu = night.sources.here.tiles[0], su = sat.sources.here.tiles[0];
  ok('C gece stili: HERE raster v3 base, explore.night, png8', nu.startsWith('https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?') && /style=explore\.night/.test(nu));
  ok('C uydu stili: explore.satellite.day, jpeg', su.startsWith('https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/jpeg?') && /style=explore\.satellite\.day/.test(su));
  ok('C anahtar yalnızca karo adresinde (apiKey)', nu.includes('apiKey=' + encodeURIComponent(HK)) && JSON.stringify({ ...night, sources: { here: { ...night.sources.here, tiles: [] } } }).includes(HK) === false);
  ok('C anahtar URL kodlanır', H.hereStyle('a b&c', false).sources.here.tiles[0].includes('apiKey=a%20b%26c'));
  ok('C raster kaynağı 256 px, atıf © HERE, glif/sprite yok', night.sources.here.type === 'raster' && night.sources.here.tileSize === 256 && /© HERE/.test(night.sources.here.attribution) && !('glyphs' in night) && !('sprite' in night));
  ok('C tek raster katman', night.version === 8 && night.layers.length === 1 && night.layers[0].type === 'raster' && night.layers[0].source === 'here');
  ok('C kimlik hatası: 401/403 evet, 404/429 hayır', H.isAuthError({ error: { status: 401 } }) && H.isAuthError({ error: { status: 403 } }) && !H.isAuthError({ error: { status: 404 } }) && !H.isAuthError({ error: { status: 429 } }) && !H.isAuthError(null) && !H.isAuthError({}));
  // uydu stratejisi: stil değişimi setStyle(..., { diff: false }); aynı değerde yeniden yüklenmez (kota)
  const calls = [];
  const fakeMap = { setStyle: (s, o) => calls.push([s, o]) };
  const strat = H.hereSatellite(HK);
  strat.set(fakeMap, false);
  ok('C açılıştaki set(false) stili yeniden yüklemez', calls.length === 0);
  strat.set(fakeMap, true);
  ok('C uydu açılır: setStyle(uydu, { diff:false })', calls.length === 1 && calls[0][1]?.diff === false && /explore\.satellite\.day/.test(calls[0][0].sources.here.tiles[0]));
  strat.set(fakeMap, true);
  ok('C aynı değerde yeniden yüklenmez', calls.length === 1);
  strat.set(fakeMap, false);
  ok('C uydu kapanır: gece stiline döner', calls.length === 2 && /explore\.night/.test(calls[1][0].sources.here.tiles[0]) && calls[1][1]?.diff === false);
}

// ---- D) istemci: ad saklama + kablolama ----
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), dump: () => [...m.entries()] }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
{
  const { rememberProvider, savedProvider } = await import('../js/net/mapConfig.js');
  rememberProvider('here');
  ok('D rememberProvider(here): ad saklanır', savedProvider() === 'here');
  ok('D depoda yalnızca sağlayıcı adı (anahtar yok)', localStorage.dump().length === 1 && JSON.parse(localStorage.dump()[0][1]) === 'here');
  const { choiceOptions, NOTES } = await import('../js/ui/mapChoice.js');
  ok('D NOTES.here var', typeof NOTES.here === 'string' && NOTES.here.length > 0);
  const cat = buildCatalog({ plan: 'premium', configured: { here: { map: true } } });
  ok('D seçici: here seçenek olarak listelenir', JSON.stringify(choiceOptions(cat).map((o) => o.id)) === '["osm","here"]');
  const cfg = read('js/net/mapConfig.js');
  ok('D mapConfig: parse here (yalnızca key)', /j\?\.provider === 'here' && typeof j\.key === 'string' && j\.key\) return \{ provider: 'here', key: j\.key \}/.test(cfg));
  const mv = read('js/ui/mapView.js');
  ok('D mapView: createHereMap içe aktarılır ve here sağlayıcısında çağrılır', /import \{ createHereMap \} from '\.\/maps\/here\.js'/.test(mv) && /cfg\.provider === 'here'/.test(mv) && /createHereMap\(mapEl, cfg\.key, \{ onAuthFail \}\)/.test(mv));
  ok('D sw.js: here.js önbellek kabuğunda', read('sw.js').includes("'./js/ui/maps/here.js'"));
  const adm = read('server/admin.html');
  ok('D yönetim: here seçeneği + HERE harita anahtarı durumu', /here: 'HERE'/.test(adm) && /hereMap/.test(adm));
  const sc = read('server/scrub.mjs');
  ok('D scrub gizli listesinde HERE_MAP_KEY', /'HERE_MAP_KEY'/.test(sc));
  const files = ['index.html', 'offline.html', 'sw.js'];
  const walk = (rel) => { for (const n of readdirSync(ROOT + rel)) { const p = rel + n; if (statSync(ROOT + p).isDirectory()) walk(p + '/'); else if (/\.(m?js|html)$/.test(n)) files.push(p); } };
  walk('js/');
  ok('D istemci dosyaları HERE_MAP_KEY / HERE_API_KEY adlarına başvurmaz', files.every((f) => !/HERE_MAP_KEY|HERE_API_KEY/.test(read(f))));
  ok('D .env.example: HERE_MAP_KEY satırı değersiz + Allowed Origins/Trusted Domains notu', /^\s*#?\s*HERE_MAP_KEY=\s*$/m.test(read('server/.env.example')) && /HERE_MAP_KEY[\s\S]{0,400}(Trusted Domains|Allowed Origins)/.test(read('server/.env.example')));
}

// ---- E) gerçek sunucu, uçtan uca (sahte anahtar, üst sunucu çağrısı yok) ----
let upstreamHits = 0;
const upstream = http.createServer((req, res) => { upstreamHits++; res.writeHead(500); res.end('{}'); });
await new Promise((r) => upstream.listen(18890, '127.0.0.1', r));
const UP = 'http://127.0.0.1:18890';
const CODE = 'test-dummy-access-code-0123456789';
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30);
const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'OCM_KEY', 'HERE_API_KEY', 'HERE_MAP_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'VERIAPI_KEY'].map((k) => [k, '']));
const children = [], dirs = [];
async function start(port, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'heremap-test-')); dirs.push(dir);
  const now = Date.now();
  writeFileSync(join(dir, 'db.json'), JSON.stringify({
    users: { u_free: { id: 'u_free', email: 'free@test.invalid', name: 'FreeKisi', createdAt: now }, u_prem: { id: 'u_prem', email: 'prem@test.invalid', name: 'PremKisi', createdAt: now, premiumUntil: now + 30 * 86400e3 } },
    invites: {}, docs: {},
    sessions: { [sha256(TOK_FREE)]: { uid: 'u_free', createdAt: now, lastSeen: now, exp: now + 86400e3 }, [sha256(TOK_PREM)]: { uid: 'u_prem', createdAt: now, lastSeen: now, exp: now + 86400e3 } },
  }));
  writeFileSync(join(dir, 'tesla.json'), JSON.stringify({ at: Date.now(), sites: [] }));
  const child = spawn(process.execPath, ['server/proxy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...BLANK, PROVIDER_REQUESTS_PAUSED: '0', PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE,
      MAPBOX_BASE: UP, OCM_BASE: UP, TOMTOM_BASE: UP, HERE_BASE: UP, HERE_ROUTER_BASE: UP, OVERPASS_URLS: UP, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out);
  const call = async (method, path, { auth, body } = {}) => {
    const headers = {};
    if (auth === 'code') headers['X-Access-Code'] = CODE; else if (auth) headers.Authorization = 'Bearer ' + auth;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, json: j };
  };
  return { call, dir };
}
const prov = (j, id) => j?.providers?.find((p) => p.id === id);

try {
  { // anahtar yok
    const A = await start(18891);
    let r = await A.call('POST', '/v1/map/choice', { auth: TOK_PREM, body: { provider: 'here' } });
    ok('E anahtar yok: here seçimi 400', r.status === 400);
    r = await A.call('GET', '/v1/providers', { auth: TOK_PREM });
    ok('E anahtar yok: here not-configured, seçilemez', prov(r.json, 'here')?.status === 'not-configured' && prov(r.json, 'here')?.selectable === false);
  }
  { // yalnız sunucu HERE anahtarı (istasyon/hız limiti için): harita yine kapalı
    const S = await start(18892, { HERE_API_KEY: HSRV });
    let r = await S.call('POST', '/v1/map/choice', { auth: TOK_PREM, body: { provider: 'here' } });
    ok('E yalnız HERE_API_KEY: here seçimi 400 (sunucu anahtarı tarayıcıya gitmez)', r.status === 400);
    r = await S.call('GET', '/v1/map/config', { auth: TOK_PREM });
    ok('E yalnız HERE_API_KEY: config osm, anahtar yok', r.json?.provider === 'osm' && !r.text.includes(HSRV));
  }
  { // harita anahtarı var
    const B = await start(18893, { HERE_MAP_KEY: HK, HERE_API_KEY: HSRV });
    let r = await B.call('POST', '/v1/map/choice', { auth: TOK_FREE, body: { provider: 'here' } });
    ok('E Free → 402 premium_required', r.status === 402 && r.json?.error === 'premium_required');
    r = await B.call('GET', '/v1/map/config', { auth: TOK_FREE });
    ok('E Free: config osm, HERE anahtarı yok', r.json?.provider === 'osm' && !r.text.includes(HK));
    r = await B.call('GET', '/v1/providers', { auth: TOK_PREM });
    ok('E Premium: here available + seçilebilir, rota coming-soon', prov(r.json, 'here')?.status === 'available' && prov(r.json, 'here')?.selectable === true && prov(r.json, 'here')?.routeAvailable === false && !r.text.includes(HK) && !r.text.includes(HSRV));
    r = await B.call('POST', '/v1/map/choice', { auth: TOK_PREM, body: { provider: 'here' } });
    ok('E Premium here → 200, etkin here, anahtar dönmez', r.status === 200 && r.json?.choice === 'here' && r.json?.effective === 'here' && !r.text.includes(HK));
    r = await B.call('GET', '/v1/map/config', { auth: TOK_PREM });
    ok('E /v1/map/config {provider:here, key:<harita anahtarı>}; sunucu anahtarı yok', r.status === 200 && r.json?.provider === 'here' && r.json?.key === HK && !r.text.includes(HSRV) && Object.keys(r.json).sort().join() === 'key,provider');
    r = await B.call('POST', '/v1/map/choice', { auth: TOK_PREM, body: { provider: null } });
    ok('E null: varsayılanı izler (osm)', r.status === 200 && r.json?.choice === null && r.json?.effective === 'osm');
  }
  ok('E üst sunucuya (ücretli) hiç istek gitmedi', upstreamHits === 0);
} finally {
  for (const c of children) c.kill();
  upstream.close();
  await new Promise((r) => setTimeout(r, 300));
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* geçici klasör */ } }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
