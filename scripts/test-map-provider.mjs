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

// ---- Bölüm 3: server/admin.html içerik denetimi (Yönetim ekranı: harita seçimi ve fatura bağlantıları) ----
{
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(fileURLToPath(new URL('../server/admin.html', import.meta.url)), 'utf8');
  ok("admin.html '/admin/map' uç noktasını çağırır", html.includes("'/admin/map'"));
  ok("admin.html kullanıcı başı '/map' uç noktasını çağırır", html.includes('/admin/users/${u.id}/map') || (html.includes('/admin/users/') && html.includes('/map`')));
  ok('admin.html mapProvider ile başlar', html.includes('u.mapProvider'));
  ok('admin.html "Premium için varsayılan harita" seçicisi', html.includes('Premium için varsayılan harita'));
  ok('admin.html anahtarı olmayan seçenek "(anahtar yok)" notlu ve pasif', html.includes('(anahtar yok)') && html.includes('disabled'));
  ok('admin.html Mapbox/Google harita anahtarı durum satırları', html.includes('Mapbox harita anahtarı') && html.includes('Google harita anahtarı') && html.includes('configured.mapboxMap') && html.includes('configured.googleMap'));
  ok('admin.html "Fatura" başlığı', html.includes('Fatura'));
  ok('admin.html Mapbox hesap bağlantısı', html.includes('https://account.mapbox.com/'));
  ok('admin.html Google Cloud faturalama bağlantısı', html.includes('https://console.cloud.google.com/billing'));
  ok('admin.html Google Maps Platform kullanım/kota bağlantısı', html.includes('https://console.cloud.google.com/google/maps-apis/metrics'));
  ok('fatura bağlantıları yeni sekmede ve noopener ile açılır', html.includes("'_blank'") && html.includes('noopener'));
  ok('admin.html anahtar değeri içermez', !/pk\.[A-Za-z0-9_.-]{8,}/.test(html) && !html.includes('pk.test-dummy') && !/AIza[0-9A-Za-z_-]{10,}/.test(html));
}

// ---- Bölüm 4: js/net/mapConfig.js (istemci sağlayıcı çözümü) ----
// Tarayıcı nesneleri sahte: localStorage / sessionStorage / document / fetch globalThis üzerine konur, modül sonra import edilir.
// Kimlik (hasCreds) proxy.js'in okuduğu saklı oturumla (evcp.session) verilir; fetch sahtesi her çağrıyı kaydeder.
{
  let everLeaked = false; // herhangi bir anda depoya sahte anahtar yazıldı mı (sıfırlamalar arasında da izlenir)
  const mkStore = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { if (/pk\.test-dummy|gk-dummy/.test(String(v))) everLeaked = true; m.set(k, String(v)); }, removeItem: (k) => m.delete(k),
      clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, dump: () => [...m.values()].join('\n'),
    };
  };
  // Özgün tanımlar okunmadan (Node'un yerleşik localStorage alıcısı uyarı basar) tanımlayıcılarıyla saklanır, sonda geri konur.
  const saved = Object.fromEntries(['localStorage', 'sessionStorage', 'document', 'fetch'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const ls = mkStore(), ss = mkStore();
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  def('localStorage', ls); def('sessionStorage', ss); def('document', { dispatchEvent() {}, addEventListener() {} });
  let calls = [], reply = null; // reply: (url, init) => Promise<Response>
  def('fetch', (url, init) => { calls.push(String(url)); return reply(url, init); });
  const json = (status, body) => () => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  const SECRET = /pk\.test-dummy|gk-dummy/;
  const leaked = () => SECRET.test(ls.dump()) || SECRET.test(ss.dump());
  const reset = ({ creds = true, provider = null } = {}) => {
    ls.clear(); ss.clear(); calls = []; reply = json(200, { provider: 'osm' });
    if (creds) ls.setItem('evcp.session', JSON.stringify({ token: 'T'.repeat(30) }));
    if (provider) ls.setItem('evcp.mapProvider', JSON.stringify(provider));
  };

  try {
    const M = await import('../js/net/mapConfig.js');
    const R = (o) => M.resolveProvider(o);

    reset();
    ok('savedProvider() varsayılan osm', M.savedProvider() === 'osm');
    ok('osmForced() başta false', M.osmForced() === false);

    reset({ provider: 'mapbox' }); M.forceOsm();
    let r = await R();
    ok('bayrak varken fetch çağrılmaz, osm', M.osmForced() === true && JSON.stringify(r) === '{"provider":"osm"}' && calls.length === 0);

    reset({ creds: false, provider: 'mapbox' });
    r = await R(); await tick();
    ok('oturum/kimlik yok → fetch çağrılmaz, osm (Review Focus 1)', JSON.stringify(r) === '{"provider":"osm"}' && calls.length === 0);

    reset({ provider: 'osm' });
    let release; reply = () => new Promise((res) => { release = () => res(new Response('{"provider":"mapbox","token":"pk.test-dummy"}', { status: 200 })); });
    r = await R();
    ok('saklı osm → fetch beklenmeden osm döner', JSON.stringify(r) === '{"provider":"osm"}' && calls.length === 1 && M.savedProvider() === 'osm');
    ok('arka plan isteği /v1/map/config', calls[0]?.endsWith('/v1/map/config'));
    release(); await tick();
    ok('arka planda saklı ad config sağlayıcısına güncellenir (mapbox)', M.savedProvider() === 'mapbox');
    ok('arka plan güncellemesi belirteci saklamaz', !leaked());

    reset({ provider: 'mapbox' }); reply = json(200, { provider: 'mapbox', token: 'pk.test-dummy' });
    r = await R();
    ok('saklı mapbox + yanıt mapbox → o yanıt döner', JSON.stringify(r) === '{"provider":"mapbox","token":"pk.test-dummy"}' && calls.length === 1);
    ok('mapbox yanıtı sonrası saklı ad mapbox, belirteç cihazda yok', M.savedProvider() === 'mapbox' && !leaked());

    reset({ provider: 'mapbox' }); reply = json(200, { provider: 'google', key: 'gk-dummy', mapId: 'mid' });
    r = await R();
    ok('saklı mapbox + yanıt google → google yanıtı, saklı ad google', JSON.stringify(r) === '{"provider":"google","key":"gk-dummy","mapId":"mid"}' && M.savedProvider() === 'google' && !leaked());

    reset({ provider: 'mapbox' }); reply = json(200, { provider: 'osm' });
    r = await R();
    ok('Premium bitti: saklı mapbox + yanıt osm → osm ve savedProvider() osm (Review Focus 2)', JSON.stringify(r) === '{"provider":"osm"}' && M.savedProvider() === 'osm');

    reset({ provider: 'mapbox' }); reply = () => new Promise(() => {}); // hiç dönmeyen istek
    let t0 = Date.now();
    r = await R();
    let dt = Date.now() - t0;
    ok(`saklı mapbox + fetch 3 sn'den uzun → osm (varsayılan zaman aşımı, ${dt} ms)`, JSON.stringify(r) === '{"provider":"osm"}' && dt >= 2900 && dt < 4500);
    ok('zaman aşımında saklı ad değişmez', M.savedProvider() === 'mapbox');

    reset({ provider: 'google' }); reply = () => new Promise(() => {});
    t0 = Date.now(); r = await R({ timeoutMs: 80 }); dt = Date.now() - t0;
    ok('timeoutMs parametresi uygulanır', JSON.stringify(r) === '{"provider":"osm"}' && dt < 1000);

    reset({ provider: 'mapbox' }); reply = () => Promise.reject(new TypeError('ağ yok'));
    r = await R();
    ok('saklı mapbox + fetch reddeder → osm', JSON.stringify(r) === '{"provider":"osm"}');

    reset({ provider: 'mapbox' }); reply = json(429, { error: 'günlük harita hakkı doldu' });
    r = await R();
    ok('saklı mapbox + 429 → osm', JSON.stringify(r) === '{"provider":"osm"}');

    reset({ provider: 'mapbox' }); reply = json(401, { error: 'yetkisiz' });
    r = await R();
    ok('saklı mapbox + 401 → osm', JSON.stringify(r) === '{"provider":"osm"}');

    reset({ provider: 'mapbox' }); reply = json(200, { provider: 'mapbox' }); // belirteçsiz bozuk yanıt
    r = await R();
    ok('belirteçsiz mapbox yanıtı → osm', JSON.stringify(r) === '{"provider":"osm"}');

    reset({ provider: 'mapbox' }); reply = () => Promise.resolve(new Response('bozuk', { status: 200 }));
    r = await R();
    ok('JSON olmayan yanıt → osm', JSON.stringify(r) === '{"provider":"osm"}');

    reset({ provider: 'zzz' });
    ok('bilinmeyen saklı ad → savedProvider() osm', M.savedProvider() === 'osm');

    // Yavaş yanıt zaman aşımından sonra gelirse: harita osm açılır, ama çekilen ad yine kaydedilir (sonraki açılış için)
    reset({ provider: 'google' });
    reply = () => new Promise((res) => setTimeout(() => res(new Response('{"provider":"osm"}', { status: 200 })), 150));
    r = await R({ timeoutMs: 40 }); await tick(250);
    ok('geç gelen yanıt adı yine kaydeder (osm)', JSON.stringify(r) === '{"provider":"osm"}' && M.savedProvider() === 'osm');

    ok('hiçbir yolda token/key localStorage/sessionStorage içine yazılmadı', !everLeaked && !leaked());
  } catch (e) {
    ok('Bölüm 4 çalıştı: ' + e.message, false);
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
