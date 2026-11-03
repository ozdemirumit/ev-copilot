// Harita sağlayıcısı seçimi testleri (bağımlılıksız, düz node): node scripts/test-map-provider.mjs
// Bölümler görev görev eklenir; her kontrol ok(ad, koşul) ile yazdırılır. Gerçek anahtar kullanılmaz (yalnızca sahte değerler).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); }
}
async function throws(fn, msg) { try { await fn(); return false; } catch (e) { return msg ? String(e.message).includes(msg) : true; } }

// ---- Bölüm 1: server/maps.mjs ----
{
  const { createMaps, PROVIDERS } = await import('../server/maps.mjs');
  const ENV = { MAPBOX_MAP_TOKEN: 'pk.test-dummy', GOOGLE_MAPS_BROWSER_KEY: 'gk-dummy', GOOGLE_MAP_ID: 'mid' };
  const mk = (env = ENV) => createMaps({ data: { users: {} }, save() {} }, env);

  ok('PROVIDERS sırası', JSON.stringify(PROVIDERS) === '["osm","mapbox","google"]');
  {
    const m = mk(), u = {};
    ok('premium değil → effective osm', m.effective(u, false) === 'osm');
    const c = m.config(u, false);
    ok('premium değil → config yalnızca {provider:osm}', JSON.stringify(c) === '{"provider":"osm"}' && !JSON.stringify(c).includes('pk.test-dummy'));
    m.setDefault('mapbox'); m.setUser(u, 'google');
    ok('premium değil iken seçim ne olursa osm kalır', m.effective(u, false) === 'osm' && JSON.stringify(m.config(u, false)) === '{"provider":"osm"}');
  }
  {
    const m = mk(), u = {};
    ok('premium, varsayılan osm, seçim yok → osm', m.effective(u, true) === 'osm' && m.getDefault() === 'osm');
  }
  {
    const m = mk(), u = {};
    m.setDefault('mapbox');
    ok('setDefault(mapbox) → premium config mapbox+token', JSON.stringify(m.config(u, true)) === '{"provider":"mapbox","token":"pk.test-dummy"}');
  }
  {
    const m = mk(), u = {};
    m.setDefault('mapbox'); m.setUser(u, 'google');
    ok('setUser(google) varsayılanı geçer', JSON.stringify(m.config(u, true)) === '{"provider":"google","key":"gk-dummy","mapId":"mid"}');
    m.setUser(u, null);
    ok('setUser(null) varsayılana döner', m.effective(u, true) === 'mapbox' && u.mapProvider == null);
  }
  {
    const m = mk({}), u = {};
    ok('anahtar yok → available hepsi false', JSON.stringify(m.available()) === '{"mapbox":false,"google":false}');
    ok("anahtar yok → setUser(mapbox) 'anahtar yok' fırlatır", await throws(() => m.setUser(u, 'mapbox'), 'anahtar yok'));
    ok("anahtar yok → setDefault(google) 'anahtar yok' fırlatır", await throws(() => m.setDefault('google'), 'anahtar yok'));
    ok('osm her zaman geçerli', !(await throws(() => m.setUser(u, 'osm'))));
  }
  {
    const env = { ...ENV }, m = mk(env), u = {};
    m.setUser(u, 'mapbox');
    delete env.MAPBOX_MAP_TOKEN; // anahtar sonradan kalktı
    ok('kayıtlı sağlayıcının anahtarı kalkarsa effective osm (çökme yok)', m.effective(u, true) === 'osm' && JSON.stringify(m.config(u, true)) === '{"provider":"osm"}');
    const st = { data: { users: {}, settings: { mapDefault: 'google' } }, save() {} }, e2 = { ...ENV };
    const m2 = createMaps(st, e2); delete e2.GOOGLE_MAPS_BROWSER_KEY;
    ok('varsayılanın anahtarı kalkarsa da osm', m2.effective({}, true) === 'osm');
  }
  {
    const m = mk(), u = {};
    ok("setUser('zzz') 'geçersiz sağlayıcı' fırlatır", await throws(() => m.setUser(u, 'zzz'), 'geçersiz sağlayıcı'));
    ok("setDefault('zzz') 'geçersiz sağlayıcı' fırlatır", await throws(() => m.setDefault('zzz'), 'geçersiz sağlayıcı'));
    ok('setDefault(null) geçersiz', await throws(() => m.setDefault(null), 'geçersiz sağlayıcı'));
    ok('geçersiz çağrı durumu bozmaz', u.mapProvider == null && m.getDefault() === 'osm');
  }
  {
    const m = mk({ MAPBOX_MAP_TOKEN: 'pk.test-dummy', GOOGLE_MAPS_BROWSER_KEY: 'gk-dummy' }), u = {};
    m.setUser(u, 'google');
    ok("GOOGLE_MAP_ID yoksa mapId 'DEMO_MAP_ID'", m.config(u, true).mapId === 'DEMO_MAP_ID');
  }
  {
    const m = mk();
    m.setDefault('google');
    ok('u === null premium=true varsayılanı izler', m.effective(null, true) === 'google' && m.config(null, true).provider === 'google');
    ok('u === null premium=false osm', m.effective(null, false) === 'osm');
  }
  {
    let saves = 0; const st = { data: { users: {} }, save() { saves++; } }, m = createMaps(st, ENV), u = {};
    m.setDefault('mapbox'); m.setUser(u, 'google');
    ok('store.save() çağrılır ve varsayılan settings.mapDefault içinde', saves === 2 && st.data.settings.mapDefault === 'mapbox');
  }
  {
    // Güvenlik: yalnızca herkese açık "pk." Mapbox belirteci kabul edilir; "sk." gizli belirteç tarayıcıya asla gitmez.
    const m = mk({ MAPBOX_MAP_TOKEN: 'sk.test-dummy-secret', GOOGLE_MAPS_BROWSER_KEY: 'gk-dummy' }), u = {};
    ok('sk. belirteci → available.mapbox false', m.available().mapbox === false && m.available().google === true);
    ok("sk. belirteci → setUser(mapbox) 'anahtar yok'", await throws(() => m.setUser(u, 'mapbox'), 'anahtar yok'));
    ok("sk. belirteci → setDefault(mapbox) 'anahtar yok'", await throws(() => m.setDefault('mapbox'), 'anahtar yok'));
    const st = { data: { users: {}, settings: { mapDefault: 'mapbox' } }, save() {} };
    const m2 = createMaps(st, { MAPBOX_MAP_TOKEN: 'sk.test-dummy-secret' });
    ok('sk. belirteci → kayıtlı mapbox seçimi osm\'ye düşer, belirteç dönmez', m2.effective({}, true) === 'osm' && !JSON.stringify(m2.config({ mapProvider: 'mapbox' }, true)).includes('sk.'));
  }
}

// ---- Bölüm 2: server/proxy.mjs bağlantısı (/v1/map/config ve yönetici uç noktaları) ----
// Sunucu ayrı alt süreç olarak, 8787 DIŞINDA bir portta ve geçici DATA_DIR ile başlatılır; yalnızca bu testin kendi süreçleri sonda kapatılır.
{
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const CODE = 'test-dummy-access-code-0123456789'; // sahte yönetici kodu (>=16 karakter)
  const sha256 = (s) => createHash('sha256').update(s).digest('hex');
  const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30);
  const children = [], dirs = [], logs = [];
  const seed = () => {
    const now = Date.now();
    return {
      users: {
        u_free: { id: 'u_free', email: 'free@test.invalid', name: 'Free', createdAt: now },
        u_prem: { id: 'u_prem', email: 'prem@test.invalid', name: 'Prem', createdAt: now, premiumUntil: now + 30 * 86400e3 },
      },
      invites: {}, docs: {},
      sessions: {
        [sha256(TOK_FREE)]: { uid: 'u_free', createdAt: now, lastSeen: now, exp: now + 86400e3 },
        [sha256(TOK_PREM)]: { uid: 'u_prem', createdAt: now, lastSeen: now, exp: now + 86400e3 },
      },
    };
  };
  async function start(port, extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'map-test-')); dirs.push(dir);
    writeFileSync(join(dir, 'db.json'), JSON.stringify(seed()));
    // Gerçek server/.env anahtarları sızmasın: tanımlı (boş) değerler .env'nin üstüne yazılmaz.
    const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY'].map((k) => [k, '']));
    const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, env: { ...process.env, ...blank, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE, MAPBOX_MAP_TOKEN: 'pk.test-dummy', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let out = ''; logs.push(() => out);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
    if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out);
    const call = async (method, path, { auth, body } = {}) => {
      const headers = {};
      if (auth === 'code') headers['X-Access-Code'] = CODE;
      else if (auth) headers.Authorization = 'Bearer ' + auth;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      return { status: r.status, text, json: j, headers: r.headers };
    };
    return { call };
  }

  try {
    const A = await start(18787);
    const cfg = (auth) => A.call('GET', '/v1/map/config', { auth });
    let r = await cfg(undefined);
    ok('kimliksiz /v1/map/config → 401', r.status === 401);
    r = await cfg('code');
    ok('varsayılan osm iken kodlu istek → {provider:osm}', r.status === 200 && r.text === '{"provider":"osm"}');
    r = await A.call('GET', '/admin/map', { auth: 'code' });
    ok('GET /admin/map → default osm, mapbox var, google yok', r.status === 200 && r.json?.default === 'osm' && r.json?.available?.mapbox === true && r.json?.available?.google === false);
    r = await A.call('POST', '/admin/map', { auth: 'code', body: { default: 'mapbox' } });
    ok('POST /admin/map mapbox → 200 {ok,default}', r.status === 200 && r.json?.ok === true && r.json?.default === 'mapbox');
    r = await cfg('code');
    ok('mapbox varsayılan → token pk.test-dummy', r.status === 200 && r.json?.provider === 'mapbox' && r.json?.token === 'pk.test-dummy');
    ok('anahtar yanıtında Cache-Control no-store', /no-store/.test(r.headers.get('cache-control') || ''));
    r = await cfg(TOK_FREE);
    ok('premium olmayan hesap → osm, belirteç yok', r.status === 200 && r.text === '{"provider":"osm"}' && !r.text.includes('pk.'));
    r = await cfg(TOK_PREM);
    ok('premium hesap → mapbox + token', r.status === 200 && r.json?.provider === 'mapbox' && r.json?.token === 'pk.test-dummy');
    r = await A.call('POST', '/admin/map', { auth: 'code', body: { default: 'google' } });
    ok('POST /admin/map google (anahtar yok) → 400', r.status === 400 && typeof r.json?.error === 'string');
    r = await A.call('POST', '/admin/map', { auth: 'code', body: { default: 'zzz' } });
    ok('POST /admin/map zzz → 400', r.status === 400);
    r = await A.call('POST', '/admin/map', { auth: 'code', body: {} });
    ok('POST /admin/map boş gövde → 400', r.status === 400);
    r = await A.call('POST', '/admin/map', { auth: TOK_PREM, body: { default: 'osm' } });
    ok('yönetici olmayan hesap /admin/map değiştiremez', r.status !== 200);
    r = await A.call('GET', '/admin/map', { auth: 'code' });
    ok('reddedilen çağrılar varsayılanı bozmadı', r.json?.default === 'mapbox');

    // kullanıcı bazlı seçim
    r = await A.call('POST', '/admin/users/u_prem/map', { auth: 'code', body: { provider: 'osm' } });
    ok('kullanıcıya osm ata → 200 {ok,provider}', r.status === 200 && r.json?.ok === true && r.json?.provider === 'osm');
    r = await cfg(TOK_PREM);
    ok('kullanıcı seçimi varsayılanı geçer (osm)', r.text === '{"provider":"osm"}');
    r = await A.call('GET', '/admin/users', { auth: 'code' });
    ok('/admin/users her kullanıcıda mapProvider', r.json?.users?.find((u) => u.id === 'u_prem')?.mapProvider === 'osm' && r.json?.users?.find((u) => u.id === 'u_free')?.mapProvider === null);
    r = await A.call('POST', '/admin/users/u_prem/map', { auth: 'code', body: { provider: null } });
    ok('provider:null → seçim kalkar', r.status === 200 && r.json?.provider === null && (await cfg(TOK_PREM)).json?.provider === 'mapbox');
    r = await A.call('POST', '/admin/users/u_prem/map', { auth: 'code', body: { provider: 'google' } });
    ok('kullanıcıya anahtarsız google → 400', r.status === 400);
    r = await A.call('POST', '/admin/users/u_prem/map', { auth: 'code', body: {} });
    ok('provider alanı yok → 400', r.status === 400);
    r = await A.call('POST', '/admin/users/u_yok/map', { auth: 'code', body: { provider: 'osm' } });
    ok('olmayan kullanıcı → 404', r.status === 404);
    r = await A.call('POST', '/admin/users/u_prem/map', { auth: TOK_FREE, body: { provider: 'osm' } });
    ok('yönetici olmayan hesap kullanıcı seçimi değiştiremez', r.status !== 200);

    // özet: anahtar değeri geçmez
    r = await A.call('GET', '/admin/summary', { auth: 'code' });
    ok('/admin/summary pk.test-dummy içermez', r.status === 200 && !r.text.includes('pk.test-dummy'));
    ok('/admin/summary configured.mapboxMap true, googleMap false', r.json?.configured?.mapboxMap === true && r.json?.configured?.googleMap === false);
    ok('/admin/summary map.default', r.json?.map?.default === 'mapbox');

    // günlük hak: kullanıcı başı 1, toplam 2; osm yanıtları sayılmaz
    const B = await start(18788, { MAP_DAILY_PER_USER: '1', MAP_DAILY_TOTAL: '2' });
    const cb = (auth) => B.call('GET', '/v1/map/config', { auth });
    await B.call('POST', '/admin/map', { auth: 'code', body: { default: 'mapbox' } });
    const osmCalls = [await cb(TOK_FREE), await cb(TOK_FREE), await cb(TOK_FREE), await cb(TOK_FREE)];
    ok('osm yanıtları sayılmaz (4 çağrı de 200)', osmCalls.every((x) => x.status === 200 && x.text === '{"provider":"osm"}'));
    r = await cb(TOK_PREM);
    ok('kullanıcı 1. anahtarlı çağrı → 200', r.status === 200 && r.json?.provider === 'mapbox');
    r = await cb(TOK_PREM);
    ok('kullanıcı 2. anahtarlı çağrı (MAP_DAILY_PER_USER=1) → 429', r.status === 429 && r.json?.error === 'günlük harita hakkı doldu' && !r.text.includes('pk.'));
    r = await cb('code');
    ok('toplam 2. anahtarlı çağrı (eski kod) → 200', r.status === 200 && r.json?.provider === 'mapbox');
    r = await cb('code');
    ok('toplam 3. anahtarlı çağrı (MAP_DAILY_TOTAL=2) → 429', r.status === 429 && r.json?.error === 'günlük harita hakkı doldu' && !r.text.includes('pk.'));
    r = await cb(TOK_FREE);
    ok('tavan dolunca osm yanıtı yine 200', r.status === 200 && r.text === '{"provider":"osm"}');
  } finally {
    for (const c of children) { try { c.kill(); } catch {} }
    await new Promise((r) => setTimeout(r, 300));
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  }
  ok('sunucu çıktısında (stdout/stderr) pk.test-dummy geçmez', logs.length >= 2 && logs.every((f) => !f().includes('pk.test-dummy')));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
