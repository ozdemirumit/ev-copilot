// D2-T1 Mapbox rotası Premium yetkisi + aylık rota sınırı + Free (Valhalla/OSM) yedeği: node scripts/test-mapbox-premium-gate.mjs
// Deterministik, çevrimdışı. Gerçek anahtar yok (yalnız sahte değerler), gerçek sağlayıcıya istek yok:
//   A) saf karar modülü server/mapboxGate.mjs
//   B) sunucu: server/proxy.mjs ayrı alt süreçte, 8787 DIŞINDA bir portta (18881-18885), geçici DATA_DIR; MAPBOX_BASE yerel sahte
//      üst sunucuya (18880) yönlendirilir ve gelen her istek sayılır
//   C) istemci: js/providers/index.js rota sağlayıcı seçimi (bağımlılıklar bellek içi sahte, ağ engelli)
//   D) istemci: js/mapbox/api.js sunucu 402 iletisi (premium_required ≠ aylık hak doldu)
// Kota DEĞERİ uydurulmaz: testteki sınırlar (1, 2) yalnız davranışı sınamak içindir; gerçek değer kullanıcı kararıdır (D2-T2).
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };

const realFetch = globalThis.fetch; // yalnız 127.0.0.1 test sunucusuna (B bölümü)
let netCalls = 0;
const netBan = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.fetch = netBan;

// =====================================================================================================================
// A) Saf karar modülü
// =====================================================================================================================
let G = null;
try { G = await import('../server/mapboxGate.mjs'); } catch (e) { ok('server/mapboxGate.mjs yüklenir', false, e.message); }
if (G) {
  const { parseCap, parseFlag, routeGate } = G;
  ok('parseCap: tanımsız/boş → sınır kapalı (null), geçerli', JSON.stringify(parseCap(undefined)) === '{"cap":null,"valid":true}' && JSON.stringify(parseCap('')) === '{"cap":null,"valid":true}' && JSON.stringify(parseCap('  ')) === '{"cap":null,"valid":true}');
  ok('parseCap: pozitif tam sayı → sınır', parseCap('5000').cap === 5000 && parseCap('5000').valid === true && parseCap(' 12 ').cap === 12);
  ok('parseCap: "0" → sınır 0 (hiç Mapbox rotası yok), geçerli', parseCap('0').cap === 0 && parseCap('0').valid === true);
  ok('parseCap: geçersiz (abc, -5, 1.5, 1e3, NaN) → 0, geçersiz (fail-closed: sınır açılmaz)', ['abc', '-5', '1.5', '1e3', 'NaN', '12abc'].every((v) => parseCap(v).cap === 0 && parseCap(v).valid === false));
  ok('parseFlag: varsayılan açık; 0/false/off/no kapatır; başka her değer açık', parseFlag(undefined) === true && parseFlag('') === true && parseFlag('1') === true && parseFlag('yes') === true && ['0', 'false', 'off', 'no', ' OFF '].every((v) => parseFlag(v) === false));
  const base = { premium: true, premiumOnly: true, used: 0, cap: null };
  ok('routeGate: Premium, sınır yok → izin', routeGate(base).allow === true);
  const free = routeGate({ ...base, premium: false });
  ok('routeGate: Free + premiumOnly → 402 premium_required', free.allow === false && free.status === 402 && free.error === 'premium_required');
  ok('routeGate: Free + premiumOnly kapalı → izin', routeGate({ ...base, premium: false, premiumOnly: false }).allow === true);
  const capHit = routeGate({ ...base, used: 10, cap: 10 });
  ok('routeGate: sayaç = sınır → 402 mapbox_route_cap', capHit.allow === false && capHit.status === 402 && capHit.error === 'mapbox_route_cap');
  ok('routeGate: sayaç < sınır → izin', routeGate({ ...base, used: 9, cap: 10 }).allow === true);
  ok('routeGate: sınır 0 → hiç izin yok', routeGate({ ...base, cap: 0 }).allow === false);
  ok('routeGate: Free önce Premium kapısına takılır (sınır dolu olsa da premium_required)', routeGate({ ...base, premium: false, used: 5, cap: 1 }).error === 'premium_required');
  ok('routeGate: bozuk girdi (premium undefined, used NaN) → izin yok', routeGate({ premiumOnly: true, used: 0, cap: null }).allow === false && routeGate({ premium: true, premiumOnly: true, used: NaN, cap: 3 }).allow === false);
}

// =====================================================================================================================
// B) Sunucu (server/proxy.mjs alt süreç; MAPBOX_BASE = yerel sahte üst sunucu)
// =====================================================================================================================
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'test-dummy-access-code-0123456789'; // sahte eski yönetici erişim kodu (>=16 karakter) → Premium sayılır
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30);
const FAKE_MB = 'sahte-mapbox-sunucu-anahtari-777';
const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'VERIAPI_KEY', 'MAPBOX_DAILY_PER_USER', 'MAPBOX_MONTHLY_CAP', 'MAPBOX_MONTH_USED_SEED', 'MAPBOX_ROUTE_MONTHLY_CAP', 'MAPBOX_ROUTE_PREMIUM_ONLY'].map((k) => [k, '']));

const up = { hits: [] };
const upstream = http.createServer((req, res) => {
  up.hits.push(req.url);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 'Ok', routes: [], features: [] }));
});
await new Promise((r) => upstream.listen(18880, '127.0.0.1', r));
const UP = 'http://127.0.0.1:18880';

const seed = (counters) => {
  const now = Date.now();
  return {
    users: {
      u_free: { id: 'u_free', email: 'free@test.invalid', name: 'FreeKisi', createdAt: now },
      u_prem: { id: 'u_prem', email: 'prem@test.invalid', name: 'PremKisi', createdAt: now, premiumUntil: now + 30 * 86400e3 },
    },
    invites: {}, docs: {},
    sessions: {
      [sha256(TOK_FREE)]: { uid: 'u_free', createdAt: now, lastSeen: now, exp: now + 86400e3 },
      [sha256(TOK_PREM)]: { uid: 'u_prem', createdAt: now, lastSeen: now, exp: now + 86400e3 },
    },
    ...(counters ? { counters } : {}),
  };
};
const children = [], dirs = [];
async function start(port, extra = {}, seedCounters = null) {
  const dir = mkdtempSync(join(tmpdir(), 'mbgate-test-')); dirs.push(dir);
  writeFileSync(join(dir, 'db.json'), JSON.stringify(seed(seedCounters)));
  writeFileSync(join(dir, 'tesla.json'), JSON.stringify({ at: Date.now(), sites: [] })); // T-SAFE-1: açılışta supercharge.info'ya istek gitmez
  const child = spawn(process.execPath, ['server/proxy.mjs'], {
    cwd: ROOT,
    env: { ...process.env, ...BLANK, PROVIDER_REQUESTS_PAUSED: '0', PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE,
      MAPBOX_TOKEN: FAKE_MB, MAPBOX_BASE: UP, OCM_BASE: UP, TOMTOM_BASE: UP, HERE_BASE: UP, HERE_ROUTER_BASE: UP, OVERPASS_URLS: UP, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out);
  const call = async (path, auth) => {
    const headers = { 'X-Device-Id': 'd_testtesttesttesttest' };
    if (auth === 'code') headers['X-Access-Code'] = CODE; else if (auth) headers.Authorization = 'Bearer ' + auth;
    const r = await realFetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, json: j };
  };
  // store.save() 800 ms gecikmeli yazar (server/store.mjs): okumadan önce bekle
  const counters = async () => { await new Promise((r) => setTimeout(r, 1300)); return JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')).counters || {}; };
  return { call, counters, log: () => out };
}
const ROUTE = (n) => `/mapbox/directions/v5/mapbox/driving-traffic/29.0${n},41.02;29.10,41.11?overview=full`;
const SEARCH = '/mapbox/search/searchbox/v1/category/ev_charging_station?proximity=29,41';
const routeHits = () => up.hits.filter((u) => u.startsWith('/directions/')).length;
const ym = new Date().toISOString().slice(0, 7);

try {
  // ---- B1) varsayılan yapılandırma: Premium kapısı açık, aylık rota sınırı yok (D2-T2 değeri bekleniyor) ----
  {
    const s = await start(18881);
    const before = routeHits();
    const f = await s.call(ROUTE(1), TOK_FREE);
    ok('Free hesap Mapbox rotası → 402 premium_required', f.status === 402 && f.json?.error === 'premium_required', `${f.status} ${f.text}`);
    ok('Free ret: üst sunucuya istek gitmedi', routeHits() === before, String(routeHits() - before));
    const fs = await s.call(SEARCH, TOK_FREE);
    ok('Free hesap Mapbox istasyon araması korunur (D2 yalnız rota)', fs.status === 200 && up.hits.some((u) => u.startsWith('/search/')), `${fs.status}`);
    const p = await s.call(ROUTE(2), TOK_PREM);
    ok('Premium hesap Mapbox rotası → 200, üst sunucuya tek istek', p.status === 200 && routeHits() === before + 1, `${p.status} ${routeHits() - before}`);
    const c = await s.call(ROUTE(3), 'code');
    ok('eski yönetici erişim kodu Premium sayılır → 200', c.status === 200 && routeHits() === before + 2, `${c.status}`);
    const cnt = await s.counters();
    ok('aylık rota sayacı db.json\'da kalıcı: yalnız üst sunucuya giden 2 rota sayıldı (Free ret sayılmadı)', cnt.mapboxRoute?.month === ym && cnt.mapboxRoute?.n === 2, JSON.stringify(cnt.mapboxRoute));
    ok('arama sayacı (mapbox) ayrı kalır: rota onu artırmaz', cnt.mapbox?.n === 1, JSON.stringify(cnt.mapbox));
    const lastUrl = up.hits.filter((u) => u.startsWith('/directions/')).at(-1) || '';
    ok('üst sunucu isteğine sunucu anahtarı eklenir, yanıtlarda anahtar yok', lastUrl.includes('access_token=' + FAKE_MB) && ![f, fs, p, c].some((r) => r.text.includes(FAKE_MB)));
    ok('girişsiz istek 401 (kapıdan önce)', (await s.call(ROUTE(4), null)).status === 401);
  }
  // ---- B2) aylık rota sınırı 2: iki istek geçer, üçüncü 402 mapbox_route_cap, üst sunucuya gitmez ----
  {
    const s = await start(18882, { MAPBOX_ROUTE_MONTHLY_CAP: '2' });
    const before = routeHits();
    const a = await s.call(ROUTE(5), TOK_PREM), b = await s.call(ROUTE(6), TOK_PREM), c = await s.call(ROUTE(7), TOK_PREM);
    ok('sınır 2: ilk iki rota 200', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
    ok('sınır 2: üçüncü rota 402 mapbox_route_cap', c.status === 402 && c.json?.error === 'mapbox_route_cap', `${c.status} ${c.text}`);
    ok('sınır 2: üst sunucuya yalnız 2 rota isteği', routeHits() === before + 2, String(routeHits() - before));
    { const c2 = await s.counters(); ok('sınır 2: sayaç sınırda durur (2)', c2.mapboxRoute?.n === 2, JSON.stringify(c2.mapboxRoute)); }
    const fs = await s.call(SEARCH.replace('proximity=29,41', 'proximity=28,40'), TOK_PREM);
    ok('rota sınırı aramayı etkilemez', fs.status === 200, String(fs.status));
  }
  // ---- B3) sayaç kalıcı: önceki ay değeri sıfırlanır, bu ayın değeri korunur ----
  {
    const s = await start(18883, { MAPBOX_ROUTE_MONTHLY_CAP: '1' }, { mapboxRoute: { month: ym, n: 1 } });
    const before = routeHits();
    const a = await s.call(ROUTE(8), TOK_PREM);
    ok('kalıcı sayaç: bu ay 1 kullanılmış + sınır 1 → yeniden başlatmadan sonra da 402', a.status === 402 && a.json?.error === 'mapbox_route_cap' && routeHits() === before, `${a.status}`);
  }
  // ---- B4) geçersiz sınır fail-closed; Premium kapısı yapılandırmayla kapatılabilir ----
  {
    const s = await start(18884, { MAPBOX_ROUTE_MONTHLY_CAP: 'abc', MAPBOX_ROUTE_PREMIUM_ONLY: '0' }, { mapboxRoute: { month: '2000-01', n: 999 } });
    const before = routeHits();
    const a = await s.call(ROUTE(9), TOK_PREM);
    ok('geçersiz MAPBOX_ROUTE_MONTHLY_CAP → sınır 0 (fail-closed), 402, üst sunucuya gitmez', a.status === 402 && a.json?.error === 'mapbox_route_cap' && routeHits() === before, `${a.status} ${a.text}`);
    ok('geçersiz sınır uyarısı günlüğe yazılır (değer yazılmaz)', /MAPBOX_ROUTE_MONTHLY_CAP/.test(s.log()) && !s.log().includes('abc'));
    { const c4 = await s.counters(); ok('eski ayın sayacı yeni ayda 0\'dan başlar', c4.mapboxRoute?.month === ym && c4.mapboxRoute?.n === 0, JSON.stringify(c4.mapboxRoute)); }
    ok('sunucu günlüğünde Mapbox anahtarı yok', !s.log().includes(FAKE_MB));
  }
  {
    const s = await start(18885, { MAPBOX_ROUTE_PREMIUM_ONLY: '0' });
    const before = routeHits();
    const f = await s.call(ROUTE(10), TOK_FREE);
    ok('MAPBOX_ROUTE_PREMIUM_ONLY=0 → Free rota izinli (yapılandırılabilir)', f.status === 200 && routeHits() === before + 1, `${f.status}`);
  }
} catch (e) {
  ok('sunucu senaryoları hatasız', false, e.message);
} finally {
  for (const c of children) c.kill();
  await new Promise((r) => upstream.close(r));
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows kilidi */ } }
}

// =====================================================================================================================
// C) İstemci rota sağlayıcı seçimi (js/providers/index.js; bağımlılıklar sahte)
// =====================================================================================================================
const S = (globalThis.__mgStub = { tomtomOn: false, mbKey: '', viaProxy: false, premium: false, calls: [], mapbox: null });
const STUBS = {
  '../osm/route.js': "export const fetchRoute = async (...a) => { globalThis.__mgStub.calls.push('osm'); return { steps: [], coords: [], km: 1 }; };",
  '../mapbox/route.js': "export const fetchRoute = async (...a) => { const S = globalThis.__mgStub; S.calls.push('mapbox'); return S.mapbox(); };",
  '../tomtom/route.js': "export const fetchRoute = async () => { globalThis.__mgStub.calls.push('tomtom'); throw new Error('yok'); };",
  '../nav/aheadTraffic.js': 'export const aheadFromRoute = (rt) => ({ ahead: true });',
  '../mapbox/api.js': 'export const mapboxKey = () => globalThis.__mgStub.mbKey;',
  '../net/proxy.js': "export const proxyHas = (w) => { const S = globalThis.__mgStub; return w === 'mapbox' ? S.viaProxy : w === 'tomtom' && S.tomtomOn; }; export const premiumAccess = () => globalThis.__mgStub.premium;",
  '../net/activeMap.js': 'export const activeMap = () => null;',
  '../osm/chargers.js': 'export const fetchChargers = () => {}; export const fetchAround = () => {};',
  '../routing/occupancyClient.js': 'export const fetchAvailability = () => {};',
  '../osm/search.js': 'export const searchPlaces = () => {}; export const resolvePlace = () => {}; export const reverseLabel = () => {};',
  '../osm/weather.js': 'export const fetchWeather = () => {};',
  '../osm/elevation.js': 'export const fetchElevations = () => {};',
  '../osm/speedLimit.js': 'export const fetchSpeedLimit = () => {};',
  '../osm/accessProbe.js': 'export const probeStopAccess = () => {};',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/providers/index.js') && spec in STUBS) return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    return next(spec, ctx);
  },
});
const PV = await import('../js/providers/index.js');
const A = { lat: 41, lon: 29 }, B = { lat: 41.1, lon: 29.1 };
const run = async (state, fn) => { Object.assign(S, { tomtomOn: false, calls: [], mapbox: () => ({ steps: [], coords: [], km: 1 }) }, state); return fn(); };
{
  const r = await run({ mbKey: 'proxy', viaProxy: true, premium: false }, () => PV.fetchRoute(A, B));
  ok('istemci Free + sunucu Mapbox: Mapbox rotası istenmez, Valhalla (osm), not yok', S.calls.join() === 'osm' && r.routeMeta?.provider === 'osm' && !r.note, `${S.calls.join()} ${r.note || ''}`);
  const t = await run({ mbKey: 'proxy', viaProxy: true, premium: false }, () => PV.fetchTrafficAhead(A, B));
  ok('istemci Free + sunucu Mapbox: yol önü trafik Mapbox\'a sorulmaz (null)', t === null && S.calls.length === 0, S.calls.join());
}
{
  const r = await run({ mbKey: 'proxy', viaProxy: true, premium: true }, () => PV.fetchRoute(A, B));
  ok('istemci Premium + sunucu Mapbox: Mapbox rotası', S.calls.join() === 'mapbox' && r.routeMeta?.provider === 'mapbox', S.calls.join());
  const t = await run({ mbKey: 'proxy', viaProxy: true, premium: true }, () => PV.fetchTrafficAhead(A, B));
  ok('istemci Premium + sunucu Mapbox: yol önü trafik Mapbox\'tan', t?.trafficSource === 'mapbox' && S.calls.join() === 'mapbox', S.calls.join());
}
{
  const r = await run({ mbKey: 'pk.kisisel-sahte', viaProxy: false, premium: false }, () => PV.fetchRoute(A, B));
  ok('kişisel mbKey (sunucu Mapbox yok, Free): davranış korunur → Mapbox rotası', S.calls.join() === 'mapbox' && r.routeMeta?.provider === 'mapbox', S.calls.join());
  const t = await run({ mbKey: 'pk.kisisel-sahte', viaProxy: false, premium: false }, () => PV.fetchTrafficAhead(A, B));
  ok('kişisel mbKey (Free): yol önü trafik korunur', t?.trafficSource === 'mapbox', S.calls.join());
}
{
  const err = Object.assign(new Error('Mapbox rotası Premium gerektirir: ücretsiz rota kullanılıyor'), { status: 402, fatal: true });
  const r = await run({ mbKey: 'proxy', viaProxy: true, premium: true, mapbox: () => { throw err; } }, () => PV.fetchRoute(A, B));
  ok('istemci Premium ama sunucu 402 (plan bayat / sınır doldu): Free Valhalla yedeğine düşer, not yazılır', S.calls.join() === 'mapbox,osm' && r.routeMeta?.provider === 'osm' && /ücretsiz rota/.test(r.note || ''), `${S.calls.join()} ${r.note}`);
}
{
  const r = await run({ mbKey: '', viaProxy: false, premium: true }, () => PV.fetchRoute(A, B));
  ok('anahtar yok: Valhalla (değişmedi)', S.calls.join() === 'osm' && r.routeMeta?.provider === 'osm');
}

// =====================================================================================================================
// D) js/mapbox/api.js: sunucu 402 iletisi gövdedeki koda göre
// =====================================================================================================================
{
  const store = new Map([['evcp.proxyUrl', JSON.stringify('http://proxy.test')], ['evcp.proxyCaps', JSON.stringify({ mapbox: true })], ['evcp.proxyCode', JSON.stringify('fake-code-0000000000')], ['evcp.deviceId', JSON.stringify('d_fakefakefakefakefake')]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  globalThis.document = { dispatchEvent() { return true; }, addEventListener() {}, getElementById() { return null; } };
  const MB = await import('../js/mapbox/api.js');
  const try402 = async (body) => {
    const seen = [];
    globalThis.fetch = async (u) => { seen.push(String(u)); return new Response(JSON.stringify(body), { status: 402, headers: { 'Content-Type': 'application/json' } }); };
    let err = null;
    try { await MB.mbfetch('/directions/v5/mapbox/driving-traffic/29,41;30,41', {}); } catch (e) { err = e; }
    globalThis.fetch = netBan;
    return { err, seen };
  };
  const p = await try402({ error: 'premium_required' });
  ok('402 premium_required → "Premium gerektirir" iletisi, ölümcül, tek istek', p.err?.status === 402 && p.err.fatal === true && /Premium/.test(p.err.message) && !/aylık/.test(p.err.message) && p.seen.length === 1, p.err?.message);
  const c = await try402({ error: 'mapbox_route_cap' });
  ok('402 mapbox_route_cap → aylık hak iletisi, ölümcül', c.err?.status === 402 && c.err.fatal === true && /aylık/.test(c.err.message), c.err?.message);
  const s = await try402({ error: 'mapbox_cap' });
  ok('402 mapbox_cap (arama) → aylık hak iletisi (değişmedi)', s.err?.status === 402 && /aylık/.test(s.err.message), s.err?.message);
  const n = await try402(null);
  ok('402 gövdesiz → aylık hak iletisi (geriye uyumlu)', n.err?.status === 402 && n.err.fatal === true && /aylık/.test(n.err.message), n.err?.message);
}

ok('C/D bölümlerinde gerçek ağ çağrısı yok', netCalls === 0, String(netCalls));
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
