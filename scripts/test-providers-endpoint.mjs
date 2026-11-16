// GET /v1/providers (Premium sağlayıcı seçimi F2) testleri (bağımlılıksız, düz node): node scripts/test-providers-endpoint.mjs
// Uç nokta SALT OKUNURDUR: seçim yazmaz, rota/sağlayıcı değiştirmez, ücretli/üst sunucu çağrısı yapmaz, anahtar ya da kullanıcı bilgisi döndürmez.
// Sunucu ayrı alt süreç olarak 8787 DIŞINDA bir portta (18861-18863), geçici DATA_DIR ve YALNIZCA SAHTE anahtarlarla başlatılır.
// Tüm *_BASE adresleri yerel sayaç sunucusuna (18860) yönlendirilir: herhangi bir üst sunucu çağrısı sayılır ve test başarısız olur.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); }
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CODE = 'test-dummy-access-code-0123456789'; // sahte yönetici kodu (>=16 karakter)
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30);
const FAKE = {
  MAPBOX_MAP_TOKEN: 'pk.SAHTE-mapbox-harita-111',
  MAPBOX_TOKEN: 'sahte-mapbox-sunucu-222',
  TOMTOM_KEY: 'sahte-tomtom-sunucu-333',
  TOMTOM_MAP_KEY: 'sahte-tomtom-harita-444',
  GOOGLE_MAPS_BROWSER_KEY: 'sahte-google-harita-555',
  HERE_API_KEY: 'sahte-here-666',
};
const BLANK = Object.fromEntries(['MAPBOX_TOKEN', 'MAPBOX_MAP_TOKEN', 'TOMTOM_KEY', 'TOMTOM_MAP_KEY', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'VERIAPI_KEY'].map((k) => [k, '']));

// Üst sunucu sayacı: hiçbir istek gelmemeli.
let upstreamHits = 0;
const upstream = http.createServer((req, res) => { upstreamHits++; res.writeHead(500); res.end('{}'); });
await new Promise((r) => upstream.listen(18860, '127.0.0.1', r));
const UP = 'http://127.0.0.1:18860';

const seed = () => {
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
  };
};

const children = [], dirs = [];
async function start(port, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'providers-test-')); dirs.push(dir);
  writeFileSync(join(dir, 'db.json'), JSON.stringify(seed()));
  writeFileSync(join(dir, 'tesla.json'), JSON.stringify({ at: Date.now(), sites: [] })); // T-SAFE-1: taze boş Tesla önbelleği → açılışta supercharge.info'ya istek gitmez
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
  const call = async (method, path, { auth, body, headers: h = {} } = {}) => {
    const headers = { ...h };
    if (auth === 'code') headers['X-Access-Code'] = CODE;
    else if (auth) headers.Authorization = 'Bearer ' + auth;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    return { status: r.status, text, json: j, headers: r.headers };
  };
  return { call, dir, log: () => out };
}

const prov = (j, id) => j?.providers?.find((p) => p.id === id);
const cap = (j, id, c) => prov(j, id)?.capabilities?.[c]?.status;
const selectable = (j) => JSON.stringify((j?.providers || []).filter((p) => p.selectable).map((p) => p.id));
const IDS = '["osm","mapbox","tomtom","google","here"]';
const noLeak = (text) => !Object.values(FAKE).some((v) => text.includes(v)) && !/pk\.|test\.invalid|u_free|u_prem|FreeKisi|PremKisi|"email"|"token"|"key"|"userId"|"user"/.test(text);

try {
  // ---- A: hiçbir anahtar yok ----
  {
    const A = await start(18861);
    const get = (auth, extra) => A.call('GET', '/v1/providers', { auth, ...extra });
    let r = await get(undefined);
    ok('A kimliksiz → 401, katalog yok', r.status === 401 && !r.text.includes('providers'));
    r = await get(undefined, { headers: { 'X-Access-Code': 'yanlis-kod-yanlis-kod-000' } });
    ok('A yanlış erişim kodu → 401', r.status === 401 && !r.text.includes('providers'));
    r = await get('Z'.repeat(30));
    ok('A geçersiz oturum belirteci → 401', r.status === 401 && !r.text.includes('providers'));

    r = await get(TOK_FREE);
    ok('A Free: 200 JSON', r.status === 200 && r.json !== null);
    ok('A Free: üst düzey alanlar yalnızca plan/selected/providers', JSON.stringify(Object.keys(r.json || {}).sort()) === '["plan","providers","selected"]');
    ok('A Free: plan free', r.json?.plan === 'free');
    ok('A Free: beş sağlayıcı, sabit sıra', JSON.stringify(r.json?.providers?.map((p) => p.id)) === IDS);
    ok('A Free: yalnızca osm seçilebilir', selectable(r.json) === '["osm"]');
    ok('A Free: mapbox/tomtom/google premium-required', ['mapbox', 'tomtom', 'google'].every((id) => prov(r.json, id)?.status === 'premium-required'));
    ok('A Free: here coming-soon, seçilemez', prov(r.json, 'here')?.status === 'coming-soon' && prov(r.json, 'here')?.selectable === false);
    ok('A Free: seçili harita osm', JSON.stringify(r.json?.selected) === '{"map":"osm"}');
    ok('A Free: Cache-Control no-store', /no-store/.test(r.headers.get('cache-control') || ''));
    ok('A Free: kullanıcı/anahtar sızıntısı yok', noLeak(r.text));

    r = await get(TOK_PREM);
    ok('A Premium: plan premium', r.status === 200 && r.json?.plan === 'premium');
    ok('A Premium anahtarsız: yalnızca osm seçilebilir', selectable(r.json) === '["osm"]');
    ok('A Premium anahtarsız: mapbox/tomtom/google not-configured', ['mapbox', 'tomtom', 'google'].every((id) => prov(r.json, id)?.status === 'not-configured'));
    ok('A Premium anahtarsız: seçili osm', r.json?.selected?.map === 'osm');
    ok('A Premium: sızıntı yok', noLeak(r.text));

    r = await A.call('POST', '/v1/providers', { auth: TOK_PREM, body: { provider: 'mapbox' } });
    ok('A POST /v1/providers seçim yazamaz (200 değil)', r.status !== 200);
    r = await A.call('PUT', '/v1/providers', { auth: 'code', body: { provider: 'mapbox' } });
    ok('A PUT /v1/providers seçim yazamaz (200 değil)', r.status !== 200);
  }

  // ---- B: tüm sahte anahtarlar var ----
  {
    const B = await start(18862, { ...FAKE, MAP_DAILY_TOTAL: '1' });
    const get = (auth) => B.call('GET', '/v1/providers', { auth });

    let r = await get(TOK_FREE);
    ok('B Free (anahtarlar var): yine yalnızca osm seçilebilir', r.status === 200 && r.json?.plan === 'free' && selectable(r.json) === '["osm"]' && r.json?.selected?.map === 'osm');
    ok('B Free: sızıntı yok', noLeak(r.text));

    for (let i = 0; i < 3; i++) r = await get(TOK_PREM); // birkaç okuma: harita hakkı (MAP_DAILY_TOTAL=1) harcanmamalı
    ok('B Premium: plan premium', r.status === 200 && r.json?.plan === 'premium');
    ok('B Premium: osm/mapbox/tomtom/google seçilebilir, here değil', selectable(r.json) === '["osm","mapbox","tomtom","google"]');
    ok('B Premium: here coming-soon (map/route/traffic)', prov(r.json, 'here')?.status === 'coming-soon' && ['map', 'route', 'traffic'].every((c) => cap(r.json, 'here', c) === 'coming-soon'));
    ok('B Premium: here rota seçilebilir gibi görünmez', prov(r.json, 'here')?.routeAvailable === false && prov(r.json, 'here')?.selectable === false);
    ok('B Premium: google harita available ama rota coming-soon', cap(r.json, 'google', 'map') === 'available' && cap(r.json, 'google', 'route') === 'coming-soon' && prov(r.json, 'google')?.routeAvailable === false);
    ok('B Premium: google uyarısı route-coming-soon', prov(r.json, 'google')?.warnings?.includes('route-coming-soon'));
    ok('B Premium: mapbox ve tomtom rota+trafik available', ['mapbox', 'tomtom'].every((id) => prov(r.json, id)?.routeAvailable === true && cap(r.json, id, 'traffic') === 'available'));
    ok('B Premium: osm trafik unavailable', cap(r.json, 'osm', 'traffic') === 'unavailable' && prov(r.json, 'osm')?.routeAvailable === true);
    ok('B Premium: lisans unverified bildirilir (mapbox/tomtom/google/here)', ['mapbox', 'tomtom', 'google', 'here'].every((id) => prov(r.json, id)?.licenseVerified === false));
    ok('B Premium: seçili harita tomtom (TomTom anahtarı varken varsayılan)', JSON.stringify(r.json?.selected) === '{"map":"tomtom"}');
    ok('B Premium: hiçbir sahte anahtar/kullanıcı bilgisi yanıtta yok', noLeak(r.text));

    r = await B.call('GET', '/v1/map/config', { auth: TOK_PREM });
    ok('B /v1/providers harita hakkını harcamadı (MAP_DAILY_TOTAL=1 hâlâ kullanılabilir)', r.status === 200 && r.json?.provider === 'tomtom');

    r = await get('code');
    ok('B eski erişim kodu → premium (premiumOk örüntüsü)', r.status === 200 && r.json?.plan === 'premium' && noLeak(r.text));

    // seçim yalnızca yönetici uç noktasıyla değişir; /v1/providers yalnızca okur
    r = await B.call('POST', '/admin/users/u_prem/map', { auth: 'code', body: { provider: 'google' } });
    ok('B yönetici kullanıcıya google atadı', r.status === 200);
    r = await get(TOK_PREM);
    ok('B seçili harita yönetici seçimini yansıtır (google)', r.json?.selected?.map === 'google' && prov(r.json, 'google')?.routeAvailable === false);
    const before = await B.call('GET', '/admin/users', { auth: 'code' });
    await B.call('POST', '/v1/providers', { auth: TOK_PREM, body: { provider: 'mapbox' } });
    await get(TOK_PREM);
    const after = await B.call('GET', '/admin/users', { auth: 'code' });
    const mp = (x) => x.json?.users?.find((u) => u.id === 'u_prem')?.mapProvider;
    ok('B okuma/POST kullanıcı seçimini değiştirmedi', mp(before) === 'google' && mp(after) === 'google');
    r = await B.call('GET', '/admin/map', { auth: 'code' });
    ok('B varsayılan sağlayıcı değişmedi', r.json?.default === 'tomtom');
  }

  // ---- C: yalnızca sunucu rota anahtarları (MAPBOX_TOKEN, TOMTOM_KEY), harita anahtarı yok ----
  {
    const C = await start(18863, { MAPBOX_TOKEN: FAKE.MAPBOX_TOKEN, TOMTOM_KEY: FAKE.TOMTOM_KEY });
    const r = await C.call('GET', '/v1/providers', { auth: TOK_PREM });
    ok('C mapbox haritası yok: seçilemez, rota+trafik available', prov(r.json, 'mapbox')?.status === 'not-configured' && prov(r.json, 'mapbox')?.selectable === false && cap(r.json, 'mapbox', 'route') === 'available');
    ok('C tomtom harita anahtarı yok: rota requires-map, seçilemez', prov(r.json, 'tomtom')?.selectable === false && prov(r.json, 'tomtom')?.capabilities?.route?.reason === 'requires-map' && prov(r.json, 'tomtom')?.routeAvailable === false);
    ok('C seçili osm', r.json?.selected?.map === 'osm');
    ok('C sızıntı yok', noLeak(r.text));
  }

  ok('hiçbir üst sunucu (ücretli) çağrısı yapılmadı', upstreamHits === 0);
} catch (e) {
  ok('beklenmeyen hata: ' + (e?.message || e), false);
} finally {
  for (const c of children) c.kill();
  upstream.close();
  await new Promise((r) => setTimeout(r, 200));
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
