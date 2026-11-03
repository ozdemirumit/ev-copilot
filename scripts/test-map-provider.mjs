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
    const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED'].map((k) => [k, '']));
    // Premium/premium-olmayan testleri sahibinin .env/ortamına bağlı olmasın: PREMIUM_REQUIRED açıkça '1'
    const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, env: { ...process.env, ...blank, PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE, MAPBOX_MAP_TOKEN: 'pk.test-dummy', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    ok('test sunucusu PREMIUM_REQUIRED=1 ile çalışır (sahibinin .env/ortamından bağımsız)', r.json?.configured?.premiumRequired === true);

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
  ok('admin.html yönetici satırlarında da harita seçici gösterir', !html.includes('if (!u.admin) { mp = mapSelect'));
  ok('admin.html "Premium için varsayılan harita" seçicisi', html.includes('Premium için varsayılan harita'));
  ok('admin.html anahtarı olmayan seçenek "(anahtar yok)" notlu ve pasif', html.includes('(anahtar yok)') && html.includes('disabled'));
  ok('admin.html Mapbox/Google harita anahtarı durum satırları', html.includes('Mapbox harita anahtarı') && html.includes('Google harita anahtarı') && html.includes('configured.mapboxMap') && html.includes('configured.googleMap'));
  ok('admin.html "Fatura" başlığı', html.includes('Fatura'));
  ok('admin.html Mapbox hesap bağlantısı', html.includes('https://console.mapbox.com/'));
  ok('admin.html Google Cloud faturalama bağlantısı', html.includes('https://console.cloud.google.com/billing'));
  ok('admin.html Google Maps Platform kullanım/kota bağlantısı', html.includes('https://console.cloud.google.com/google/maps-apis/metrics'));
  ok('fatura bağlantıları yeni sekmede ve noopener ile açılır', html.includes("'_blank'") && html.includes('noopener'));
  ok('admin.html act() hata olunca da load() çağırır (reddedilen seçim hemen geri döner)', html.includes('catch (e) { toast(e.message); load(); }'));
  ok('admin.html harita değişikliği notu: en geç ikinci açılışta', html.includes('en geç ikinci açılışta') && !html.includes('bir sonraki açılışında geçerli olur'));
  ok('admin.html anahtarı kalkmış kayıtlı seçim için "→ OpenFreeMap kullanılıyor" notu', html.includes('→ OpenFreeMap kullanılıyor'));
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

// Sahte vektör kütüphanesi (MapLibre / Mapbox GL): Bölüm 5 ve 8 kullanır. maps[] oluşturulan haritaları tutar;
// cfg.autoLoad=false ise 'load' kendiliğinden gelmez. cfg.base: stilin kendi kaynakları (ör. 'openmaptiles', 'composite'),
// cfg.baseLayers: stilin kendi katmanları (ör. düz 'building'); stil değişiminde (setStyle) bunlar yeniden kurulur.
// addLayer(l, before): before verilirse katman onun önüne (altına) eklenir; tanımlar layerDefs'te, görünürlük layout'ta tutulur.
function fakeLib(cfg = {}) {
  const autoLoad = cfg.autoLoad ?? true;
  const base = cfg.base || [], baseLayers = cfg.baseLayers || [];
  const maps = [];
  class Map {
    constructor(opts) {
      this.opts = opts; this.handlers = {}; this.controls = []; this.styles = [opts.style];
      this.removed = false; this.installs = 0;
      this.resetStyle();
      maps.push(this);
      if (autoLoad) setTimeout(() => this.fire('load'), 0);
    }
    resetStyle() {
      this.sources = Object.fromEntries(base.map((id) => [id, { type: 'vector', base: true }]));
      this.layers = [...baseLayers]; this.layerDefs = Object.fromEntries(baseLayers.map((id) => [id, { id, type: 'fill' }])); this.layout = {};
    }
    on(ev, fn) { (this.handlers[ev] ??= []).push(fn); return this; }
    once(ev, fn) { const w = (e) => { this.off(ev, w); fn(e); }; return this.on(ev, w); }
    off(ev, fn) { this.handlers[ev] = (this.handlers[ev] || []).filter((f) => f !== fn); return this; }
    fire(ev, e = {}) { if (!this.removed) for (const f of [...(this.handlers[ev] || [])]) f(e); }
    addControl(c, pos) { this.controls.push({ c, pos }); }
    getSource(id) { return this.sources[id]; }
    addSource(id, s) {
      if (this.sources[id]) throw new Error('kaynak zaten var: ' + id);
      if (id === 'route') this.installs++;
      this.sources[id] = { ...s, setData(d) { this.data = d; } };
    }
    addLayer(l, before) {
      if (this.layers.includes(l.id)) throw new Error('katman zaten var: ' + l.id);
      if (l.source && !this.sources[l.source]) throw new Error('kaynak yok: ' + l.source);
      const i = before ? this.layers.indexOf(before) : -1;
      if (i >= 0) this.layers.splice(i, 0, l.id); else this.layers.push(l.id);
      this.layerDefs[l.id] = { ...l, before };
    }
    getLayer(id) { return this.layers.includes(id) ? this.layerDefs[id] : undefined; }
    removeLayer(id) { this.layers = this.layers.filter((x) => x !== id); delete this.layerDefs[id]; }
    setLayoutProperty(id, k, v) { (this.layout[id] ??= {})[k] = v; }
    // Gerçek kütüphane gibi: stil değişince kaynak/katmanlar silinir, 'style.load' daha sonra (eşzamansız) gelir
    setStyle(style, o) { this.styles.push(style); this.lastStyleOpts = o; this.resetStyle(); setTimeout(() => this.fire('style.load'), 5); }
    remove() { this.removed = true; }
    getCanvas() { return { style: {} }; }
  }
  class AttributionControl { constructor(o) { this.o = o; } }
  class Marker {}
  return { Map, AttributionControl, Marker, maps, accessToken: null };
}

// ---- Bölüm 5: js/ui/maps/mapbox.js (Mapbox bağdaştırıcısı) ve mapEngine.js yük/yedek mantığı ----
// Ağ yok: window.mapboxgl sahte bir kütüphanedir (olay yayan sahte Map); betik yükleyici sahte document ile denenir.
{
  const { readFileSync } = await import('node:fs');
  const src = (p) => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8');
  const saved = Object.fromEntries(['window', 'document'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
  const origError = console.error, logged = []; // beklenen harita hataları çıktıyı kirletmesin; kaydedilir
  console.error = (...x) => logged.push(x);

  const container = () => ({ querySelector: () => null });

  // Sahte document: script eklenince cfg.script 'error' ise onerror, 'load' ise window.mapboxgl kurulup onload çağrılır,
  // 'hang' ise hiçbir şey olmaz (asılı kalan CDN; öğe docCfg.hung'da saklanır)
  const appended = [];
  const docCfg = { script: 'error', lib: null, hung: null };
  def('window', {});
  def('document', {
    createElement: (tag) => ({ tagName: tag.toUpperCase(), remove() {} }),
    head: { append(el) { appended.push(el); if (el.tagName !== 'SCRIPT') return; if (docCfg.script === 'hang') { docCfg.hung = el; return; } setTimeout(() => { if (docCfg.script === 'load') { window.mapboxgl = docCfg.lib; el.onload?.(); } else el.onerror?.(); }, 0); } },
  });
  const nScripts = () => appended.filter((e) => e.tagName === 'SCRIPT').length;

  try {
    const MB = await import('../js/ui/maps/mapbox.js');
    const ENG = await import('../js/ui/maps/mapEngine.js');
    const METHODS = ['setSatellite', 'setBuildings3d', 'marker', 'traffic', 'line', 'fit', 'moveTo', 'onClick', 'onDragStart', 'cursor', 'resize', 'bearing', 'installLayers'];

    // (a) kütüphane betiği yüklenemezse reddeder (gerçek yükleyici, sahte document)
    let rejected = await throws(() => MB.createMapboxMap(container(), 'pk.test-dummy'));
    const script = appended.find((e) => e.tagName === 'SCRIPT'), css = appended.find((e) => e.tagName === 'LINK');
    ok('(a) Mapbox betiği yüklenemezse createMapboxMap reddeder', rejected);
    ok('betik Mapbox CDN, sürüm sabit (v3.x.y), @latest yok', /^https:\/\/api\.mapbox\.com\/mapbox-gl-js\/v3\.\d+\.\d+\/mapbox-gl\.js$/.test(script?.src || '') && !/latest/.test(script.src));
    ok('stil dosyası aynı sürümün mapbox-gl.css\'i', css?.href === script?.src.replace(/\.js$/, '.css') && css?.rel === 'stylesheet');
    // Asılı kalan CDN (onerror hiç gelmez): kütüphane süresi dolunca reddedilir; önbellekteki yükleme bozulmaz, geç yükleme kullanılır
    docCfg.script = 'hang';
    let t0h = Date.now();
    const hang1 = await MB.createMapboxMap(container(), 'pk.test-dummy', { libTimeoutMs: 60 }).then(() => null, (e) => e);
    ok('asılı kalan betik: kütüphane süresi dolunca anlaşılır Türkçe hatayla reddeder', hang1 instanceof Error && /zamanında yüklenemedi/.test(hang1.message) && Date.now() - t0h < 1000);
    ok('başarısız yüklemeden sonra yeniden denenir (önbelleğe alınmış ret yok)', nScripts() === 2 && !!docCfg.hung);
    docCfg.lib = fakeLib();
    const late = MB.createMapboxMap(container(), 'pk.test-dummy', { libTimeoutMs: 2000 });
    await tick();
    ok('süre dolması önbellekteki yüklemeyi silmez: ikinci çağrı yeni betik eklemez', nScripts() === 2);
    window.mapboxgl = docCfg.lib; docCfg.hung.onload();
    const lateA = await late.catch((e) => e);
    ok('geç gelen başarılı yükleme bekleyen çağrıya ulaşır', lateA?.name === 'mapbox' && docCfg.lib.maps.length === 1);
    ok('stil dosyası bir kez eklenir', appended.filter((e) => e.tagName === 'LINK').length === 1);
    ok('enjekte edilen yükleyici reddederse createMapboxMap reddeder', await throws(() => MB.createMapboxMap(container(), 'pk.test-dummy', { loadLib: () => Promise.reject(new Error('yok')) })));
    t0h = Date.now();
    const never = await MB.createMapboxMap(container(), 'pk.test-dummy', { loadLib: () => new Promise(() => {}), libTimeoutMs: 50 }).then(() => null, (e) => e);
    ok('enjekte yükleyici hiç sonuçlanmazsa süre içinde reddeder (openAdapter catch → OpenFreeMap)', never instanceof Error && /zamanında yüklenemedi/.test(never.message) && Date.now() - t0h < 1000);
    ok('kütüphane süresi varsayılanı 25 sn', /libTimeoutMs = 25000/.test(src('js/ui/maps/mapbox.js')));

    // Temel: ad, yöntemler, belirteç, koyu stil, atıf, mercator
    let lib = fakeLib(); window.mapboxgl = lib;
    let a = await MB.createMapboxMap(container(), 'pk.test-dummy');
    let m = lib.maps.at(-1);
    ok("adapter.name === 'mapbox'", a.name === 'mapbox');
    ok('OpenFreeMap bağdaştırıcısıyla aynı yöntemler', METHODS.every((k) => typeof a[k] === 'function'));
    ok('mapboxgl.accessToken = token', lib.accessToken === 'pk.test-dummy');
    ok('koyu stil mapbox://styles/mapbox/dark-v11', m.opts.style === 'mapbox://styles/mapbox/dark-v11');
    ok('mercator izdüşümü (küre değil; zoom ölçeği OpenFreeMap ile aynı)', m.opts.projection === 'mercator');
    ok('Mapbox atfı görünür: kompakt AttributionControl haritaya eklenir', m.controls.some(({ c, pos }) => c instanceof lib.AttributionControl && c.o.compact === true && pos === 'bottom-left'));
    ok('Mapbox logosu/atfı gizleyen seçenek verilmez (logo kütüphane varsayılanı)', !['logo', 'logoPosition', 'customAttribution'].some((k) => k in m.opts) && m.opts.attributionControl === false);

    // (b) 401/403 → onAuthFail tam bir kez; 404 → hiç
    let fails = 0;
    lib = fakeLib(); window.mapboxgl = lib;
    a = await MB.createMapboxMap(container(), 'pk.test-dummy', { onAuthFail: () => fails++ });
    m = lib.maps.at(-1);
    m.fire('error', { error: { status: 404, url: 'https://api.mapbox.com/x' } });
    ok('(b) 404 → onAuthFail çağrılmaz, hata konsola yazılır (bugünkü günlük korunur)', fails === 0 && logged.some((x) => x[0]?.status === 404));
    m.fire('error', { error: { status: 401 } }); m.fire('error', { error: { status: 403 } }); m.fire('error', { error: { status: 401 } });
    ok('(b) 401 + 403 + 401 → onAuthFail tam bir kez', fails === 1);
    m.fire('error', { error: new Error('başka hata') }); m.fire('error', {});
    ok('durumsuz hata çökertmez, onAuthFail artmaz', fails === 1);
    fails = 0; lib = fakeLib(); window.mapboxgl = lib;
    await MB.createMapboxMap(container(), 'pk.test-dummy', { onAuthFail: () => fails++ });
    lib.maps.at(-1).fire('error', { error: { status: 403 } });
    ok('(b) yalnızca 403 → onAuthFail bir kez', fails === 1);
    fails = 0; lib = fakeLib(); window.mapboxgl = lib;
    await MB.createMapboxMap(container(), 'pk.test-dummy');
    let threw = false; try { lib.maps.at(-1).fire('error', { error: { status: 401 } }); } catch { threw = true; }
    ok('onAuthFail verilmeden 401 çökertmez', !threw);

    // Yükleme öncesi kimlik hatası: hızlı ret (25 sn beklenmez), onAuthFail bir kez, harita kaldırılır (WebGL bağlamı bırakılır)
    fails = 0; lib = fakeLib({ autoLoad: false }); window.mapboxgl = lib;
    let t0 = Date.now();
    const p = MB.createMapboxMap(container(), 'pk.test-dummy', { onAuthFail: () => fails++ });
    await tick(); m = lib.maps.at(-1);
    m.fire('error', { error: { status: 401 } });
    rejected = await p.then(() => false, () => true);
    ok('yükleme öncesi 401 → hemen reddeder', rejected && Date.now() - t0 < 1000);
    ok('yükleme öncesi 401 → onAuthFail bir kez ve map.remove()', fails === 1 && m.removed === true);
    fails = 0; lib = fakeLib({ autoLoad: false }); window.mapboxgl = lib;
    const p404 = MB.createMapboxMap(container(), 'pk.test-dummy', { onAuthFail: () => fails++ });
    await tick(); m = lib.maps.at(-1);
    m.fire('error', { error: { status: 404 } });
    let settled = false; p404.then(() => { settled = true; }, () => { settled = true; });
    await tick(30);
    ok('yükleme öncesi 404 → reddetmez (yükleme sürer), onAuthFail yok', !settled && fails === 0 && !m.removed);
    m.fire('load'); await p404;
    ok('404 sonrası load gelirse harita açılır', settled === true);

    // Motor: yükleme zaman aşımı → reddet ve map.remove(); varsayılan 25 sn
    lib = fakeLib({ autoLoad: false });
    t0 = Date.now();
    rejected = await ENG.createVectorMap(lib, container(), { name: 'osm', timeoutMs: 60 }).then(() => false, () => true);
    ok('motor: zaman aşımında reddeder ve map.remove() çağrılır', rejected && lib.maps[0].removed === true && Date.now() - t0 < 1000);
    ok('motor: varsayılan yükleme süresi 25 sn, mapbox.js kendi süresini koymaz', /timeoutMs\s*=\s*25000/.test(src('js/ui/maps/mapEngine.js')) && !/timeoutMs\s*:/.test(src('js/ui/maps/mapbox.js')));
    lib = fakeLib();
    a = await ENG.createVectorMap(lib, container(), { name: 'osm' });
    ok('motor: başarılı yüklemede harita kaldırılmaz', a.name === 'osm' && lib.maps[0].removed === false);

    // (c) Uydu stil değişimi: installLayers yeniden çağrılır, rota ve trafik verisi korunur (Review Focus 5)
    lib = fakeLib(); window.mapboxgl = lib;
    a = await MB.createMapboxMap(container(), 'pk.test-dummy');
    m = lib.maps.at(-1);
    const C1 = [[29.0, 41.0], [29.1, 41.05], [29.2, 41.1]], C2 = [[32.8, 39.9], [32.9, 39.95]];
    a.line(C1);
    a.traffic(C1, [{ from: 0, to: 5, lvl: 'heavy' }]);
    const trafficBefore = JSON.stringify(m.getSource('traffic').data);
    ok('(c) başlangıçta rota ve trafik kaynağı', m.installs === 1 && JSON.stringify(m.getSource('route').data.geometry.coordinates) === JSON.stringify(C1) && m.getSource('traffic').data.features.length === 1);
    a.setSatellite(true);
    ok('(c) setSatellite(true) → setStyle(satellite-streets-v12, { diff:false })', m.styles.at(-1) === 'mapbox://styles/mapbox/satellite-streets-v12' && m.lastStyleOpts?.diff === false);
    threw = false; try { a.line(C2); a.traffic(C2, []); a.traffic(C1, [{ from: 0, to: 5, lvl: 'heavy' }]); } catch { threw = true; }
    ok('(c) stil yüklenirken line()/traffic() çökmez', !threw);
    await tick(30);
    ok('(c) style.load sonrası installLayers yeniden: rota kaynağı yeniden eklendi', m.installs === 2 && !!m.getSource('route') && m.layers.includes('route-line') && m.layers.includes('traffic-line'));
    ok('(c) rota verisi korunur (stil değişirken verilen son çizgi)', JSON.stringify(m.getSource('route').data.geometry.coordinates) === JSON.stringify(C2));
    ok('(c) trafik verisi korunur', JSON.stringify(m.getSource('traffic').data) === trafficBefore);
    ok('(c) trafik çizgisi rota çizgisinin üstünde', m.layers.indexOf('traffic-line') > m.layers.indexOf('route-line'));
    a.setSatellite(false); await tick(30);
    ok('(c) setSatellite(false) → dark-v11, rota ve trafik yine yerinde', m.styles.at(-1) === 'mapbox://styles/mapbox/dark-v11' && m.installs === 3 && JSON.stringify(m.getSource('route').data.geometry.coordinates) === JSON.stringify(C2) && JSON.stringify(m.getSource('traffic').data) === trafficBefore);
    const nStyles = m.styles.length;
    a.setSatellite(false);
    ok('(c) aynı durum için setStyle tekrar çağrılmaz (açılıştaki setSatellite(false) stil yüklemez)', m.styles.length === nStyles);
    const ln = a.line(C1); a.setSatellite(true); await tick(30); ln.remove();
    ok('(c) uydu açıkken rota kaldırılınca boşalır', m.getSource('route').data.features?.length === 0);
    a.setSatellite(false); await tick(30);
    ok('(c) kaldırılan rota stil değişiminde geri gelmez', m.getSource('route').data.features?.length === 0);

    // Bağlantılar: mapView mapbox dalı ve sw.js SHELL
    const mv = src('js/ui/mapView.js'), sw = src('sw.js'), mbs = src('js/ui/maps/mapbox.js');
    ok("mapView mapbox dalı createMapboxMap(mapEl, cfg.token, { onAuthFail })", /import \{ createMapboxMap \} from '\.\/maps\/mapbox\.js'/.test(mv) && /createMapboxMap\(mapEl, cfg\.token, \{ onAuthFail/.test(mv));
    ok('mapView onAuthFail → forceOsm + sayfa yenileme', /forceOsm\(\)/.test(mv) && /location\.reload\(\)/.test(mv));
    ok('mapView google dalı artık OpenFreeMap açmıyor (Task 7 bağladı; ayrıntı Bölüm 7)', !/cfg\.provider === 'google'\) return await createMapLibreMap\(mapEl\)/.test(mv));
    ok("sw.js SHELL './js/ui/maps/mapbox.js' içerir", sw.includes("'./js/ui/maps/mapbox.js'"));
    ok('mapbox.js gerçek belirteç içermez', !/pk\.[A-Za-z0-9_-]{20,}/.test(mbs) && !/sk\./.test(mbs));
  } catch (e) {
    ok('Bölüm 5 çalıştı: ' + e.message, false);
  } finally {
    console.error = origError;
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

// Sahte DOM öğesi (append/remove/replaceChildren/style/title): Bölüm 7 ve 8 kullanır.
const fakeEl = (tag) => {
  const e = {
    tagName: String(tag).toUpperCase(), style: {}, children: [], parentNode: null, removed: false,
    append(...c) { for (const x of c) { if (x && typeof x === 'object') x.parentNode = e; e.children.push(x); } },
    appendChild(x) { e.append(x); return x; },
    remove() { e.removed = true; if (e.parentNode) e.parentNode.children = e.parentNode.children.filter((y) => y !== e); e.parentNode = null; },
    replaceChildren(...c) { e.children = []; e.append(...c); },
    get firstChild() { return e.children[0] ?? null; },
    querySelector: () => null,
  };
  return e;
};

// Sahte google.maps (Bölüm 7 ve 8): maps[] ve polylines[] oluşturulanları tutar; cfg.autoIdle=false ise 'idle' kendiliğinden gelmez.
function fakeGm(cfg = { autoIdle: true }) {
  const maps = [], polylines = [], overlays = [];
  const on = (o, ev, fn) => { ((o._h ??= {})[ev] ??= []).push(fn); return { remove: () => off(o, ev, fn) }; };
  const off = (o, ev, fn) => { if (o._h?.[ev]) o._h[ev] = o._h[ev].filter((f) => f !== fn); };
  const fire = (o, ev, ...a) => { for (const f of [...(o._h?.[ev] || [])]) f(...a); };
  const event = {
    addListenerOnce(o, ev, fn) { const w = (...a) => { off(o, ev, w); fn(...a); }; return on(o, ev, w); },
    addListener: (o, ev, fn) => on(o, ev, fn),
    trigger: (o, ev, ...a) => fire(o, ev, ...a),
    clearInstanceListeners(o) { o._h = {}; o.cleared = true; },
  };
  class Map {
    constructor(div, opts) {
      this.div = div; this.opts = { ...opts }; this.calls = []; this.mapTypeId = opts.mapTypeId ?? 'roadmap'; this.zoom = opts.zoom; this.heading = 0;
      maps.push(this);
      if (cfg.autoIdle) setTimeout(() => fire(this, 'idle'), 0);
    }
    addListener(ev, fn) { return on(this, ev, fn); }
    fire(ev, ...a) { fire(this, ev, ...a); }
    setMapTypeId(t) { this.mapTypeId = t; this.calls.push(['setMapTypeId', t]); }
    getMapTypeId() { return this.mapTypeId; }
    moveCamera(o) { this.calls.push(['moveCamera', o]); if (o.zoom != null) this.zoom = o.zoom; if (o.heading != null) this.heading = o.heading; }
    panTo(c) { this.calls.push(['panTo', c]); }
    fitBounds(b, pad) { this.calls.push(['fitBounds', b, pad]); this.zoom = 18; }
    getZoom() { return this.zoom; }
    setZoom(z) { this.zoom = z; this.calls.push(['setZoom', z]); }
    setOptions(o) { Object.assign(this.opts, o); }
    getHeading() { return this.heading; }
    getDiv() { return this.div; }
  }
  class OverlayView {
    setMap(m) {
      if (m) { this.map = m; overlays.push(this); this.onAdd?.(); this.draw?.(); } else if (this.map) { this.onRemove?.(); this.map = null; }
    }
    getMap() { return this.map; }
    getPanes() { return { overlayMouseTarget: this.map ? (this.map._pane ??= fakeEl('div')) : null, floatPane: this.map ? (this.map._float ??= fakeEl('div')) : null }; }
    getProjection() { return { fromLatLngToDivPixel: (ll) => ({ x: ll.lng() * 10, y: ll.lat() * 10 }) }; }
  }
  class Polyline {
    constructor(o) { this.o = o; this.map = o.map ?? null; polylines.push(this); }
    setMap(m) { this.map = m; }
    getMap() { return this.map; }
  }
  class LatLng { constructor(lat, lng) { this._a = lat; this._o = lng; } lat() { return this._a; } lng() { return this._o; } }
  class LatLngBounds { constructor() { this.pts = []; } extend(p) { this.pts.push(p); return this; } }
  const ns = { Map, OverlayView, Polyline, LatLng, LatLngBounds, event, maps, polylines, overlays, imports: [] };
  ns.importLibrary = async (name) => { ns.imports.push(name); return name === 'maps' ? { Map, OverlayView, Polyline } : {}; };
  return ns;
}

// ---- Bölüm 7: js/ui/maps/google.js (Google bağdaştırıcısı) ----
// Ağ yok: window.google.maps sahte bir ad alanıdır (olay yayan sahte Map, Polyline, OverlayView); betik yükleyici sahte document ile denenir.
// Sahte anahtar KEY yalnızca bağdaştırıcıya verilir; ok() adlarında geçmez (günlük/depolama taraması için).
{
  const { readFileSync } = await import('node:fs');
  const src = (p) => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8');
  const keys = ['window', 'document', 'localStorage', 'sessionStorage'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
  const KEY = 'gk-dummy-t7';
  // Konsol: harita hataları çıktıyı kirletmesin; her şey kaydedilir (anahtar günlüğe yazılıyor mu diye taranır), log yine yazdırılır
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info }, logged = [];
  console.error = (...x) => logged.push(x);
  console.warn = (...x) => logged.push(x);
  console.info = (...x) => logged.push(x);
  console.log = (...x) => { logged.push(x); orig.log(...x); };
  // Depolama casusu: yazılan her değer kaydedilir
  const stored = [];
  const fakeStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { stored.push([k, String(v)]); m.set(k, String(v)); }, removeItem: (k) => m.delete(k), clear: () => m.clear() }; };

  // Sahte document: script eklenince cfg.script 'error' ise onerror, 'load' ise window.google kurulup betiğin callback'i çağrılır,
  // 'hang' ise hiçbir şey olmaz (asılı kalan betik; öğe docCfg.hung'da saklanır)
  const appended = [];
  const docCfg = { script: 'error', gm: null, hung: null };
  const cbOf = (el) => new URL(el.src).searchParams.get('callback');
  def('window', {});
  def('localStorage', fakeStorage());
  def('sessionStorage', fakeStorage());
  window.localStorage = globalThis.localStorage; window.sessionStorage = globalThis.sessionStorage;
  def('document', {
    documentElement: { lang: 'tr' },
    createElement: (tag) => fakeEl(tag),
    head: {
      append(el) {
        appended.push(el);
        if (el.tagName !== 'SCRIPT') return;
        if (docCfg.script === 'hang') { docCfg.hung = el; return; }
        setTimeout(() => { if (docCfg.script === 'load') { window.google = { maps: docCfg.gm }; window[cbOf(el)]?.(); } else el.onerror?.(); }, 0);
      },
    },
  });
  const nScripts = () => appended.filter((e) => e.tagName === 'SCRIPT').length;

  try {
    const G = await import('../js/ui/maps/google.js');
    const ENG = await import('../js/ui/maps/mapEngine.js');
    const gsrc = src('js/ui/maps/google.js');

    // (a) betik yüklenemezse reddeder (gerçek yükleyici, sahte document)
    let rejected = await throws(() => G.createGoogleMap(fakeEl('div'), KEY));
    const script = appended.find((e) => e.tagName === 'SCRIPT');
    ok('(a) Google betiği yüklenemezse createGoogleMap reddeder', rejected);
    const su = script ? new URL(script.src) : null;
    ok('betik maps.googleapis.com/maps/api/js, async, loading=async ve callback ile', su?.origin === 'https://maps.googleapis.com' && su.pathname === '/maps/api/js' && script.async === true && su.searchParams.get('loading') === 'async' && !!su.searchParams.get('callback'));
    ok("Google kanalı v=quarterly (kararlılık)", su?.searchParams.get('v') === 'quarterly');
    ok('betikte yalnızca harita: libraries / places YOK (Places hedef dışı)', !!su && !su.searchParams.has('libraries') && !/places/i.test(script.src) && !/places/i.test(gsrc));
    ok('başarısız yüklemede betik öğesi kaldırılır', script?.removed === true);

    // Asılı kalan betik: kütüphane süresi dolunca reddedilir; önbellekteki yükleme bozulmaz, geç yükleme yeni betik eklemeden kullanılır
    docCfg.script = 'hang';
    let t0 = Date.now();
    const hang1 = await G.createGoogleMap(fakeEl('div'), KEY, 'DEMO_MAP_ID', { libTimeoutMs: 60 }).then(() => null, (e) => e);
    ok('asılı kalan betik: kütüphane süresi dolunca anlaşılır Türkçe hatayla reddeder', hang1 instanceof Error && /zamanında yüklenemedi/.test(hang1.message) && Date.now() - t0 < 1000);
    ok('başarısız yüklemeden sonra yeniden denenir (önbelleğe alınmış ret yok)', nScripts() === 2 && !!docCfg.hung);
    docCfg.gm = fakeGm();
    const late = G.createGoogleMap(fakeEl('div'), KEY, 'DEMO_MAP_ID', { libTimeoutMs: 2000 });
    await tick();
    ok('süre dolması önbellekteki yüklemeyi silmez: ikinci çağrı ikinci betik eklemez', nScripts() === 2);
    window.google = { maps: docCfg.gm }; window[cbOf(docCfg.hung)]();
    const lateA = await late.catch((e) => e);
    ok('geç gelen başarılı yükleme bekleyen çağrıya ulaşır', lateA?.name === 'google' && docCfg.gm.maps.length === 1);
    await G.createGoogleMap(fakeEl('div'), KEY);
    ok('kütüphane yüklüyken yeni betik eklenmez', nScripts() === 2);
    ok('enjekte edilen yükleyici reddederse createGoogleMap reddeder', await throws(() => G.createGoogleMap(fakeEl('div'), KEY, 'm', { loadLib: () => Promise.reject(new Error('yok')) })));
    t0 = Date.now();
    const never = await G.createGoogleMap(fakeEl('div'), KEY, 'm', { loadLib: () => new Promise(() => {}), libTimeoutMs: 50 }).then(() => null, (e) => e);
    ok('enjekte yükleyici hiç sonuçlanmazsa süre içinde reddeder (openAdapter catch → OpenFreeMap)', never instanceof Error && /zamanında yüklenemedi/.test(never.message) && Date.now() - t0 < 1000);
    ok('kütüphane süresi varsayılanı 25 sn, harita yükleme süresi 25 sn', /libTimeoutMs = 25000/.test(gsrc) && /25000/.test(gsrc.replace(/libTimeoutMs = 25000/, '')));

    // Temel: ad, yöntem kümesi OpenFreeMap/Mapbox motoruyla BİREBİR aynı, harita seçenekleri
    let gm = fakeGm(); window.google = { maps: gm };
    const cont = fakeEl('div');
    let a = await G.createGoogleMap(cont, KEY, 'mid-1');
    let m = gm.maps.at(-1);
    ok("adapter.name === 'google'", a.name === 'google');
    const vlib = (() => {
      class Map { constructor() { this.h = {}; this.src = {}; setTimeout(() => this.fire('load'), 0); } on(ev, f) { (this.h[ev] ??= []).push(f); } once(ev, f) { this.on(ev, f); } fire(ev) { (this.h[ev] || []).forEach((f) => f({})); } addControl() {} getSource(id) { return this.src[id]; } addSource(id, s) { this.src[id] = { ...s, setData() {} }; } addLayer() {} }
      return { Map, AttributionControl: class {}, Marker: class {} };
    })();
    const osmA = await ENG.createVectorMap(vlib, fakeEl('div'), { name: 'osm' });
    const methodsOf = (o) => Object.keys(o).filter((k) => k !== 'name' && typeof o[k] === 'function').sort().join(',');
    ok('yöntem kümesi OpenFreeMap/Mapbox motoruyla birebir aynı', methodsOf(a) === methodsOf(osmA) && Object.keys(a).sort().join(',') === Object.keys(osmA).sort().join(','));
    ok("importLibrary('maps') ile harita kitaplığı yüklenir (başka kitaplık yok)", gm.imports.length === 1 && gm.imports[0] === 'maps');
    ok('harita, kabın içindeki kendi alt öğesine kurulur', m.div !== cont && cont.children.includes(m.div));
    ok('mapId sunucudan gelen değer; varsayılan zoom web-mercator (6)', m.opts.mapId === 'mid-1' && m.opts.zoom === 6 && m.opts.center?.lat === 39 && m.opts.center?.lng === 35);
    ok('Google logosu/şartları gizlenmez (gizleyen seçenek yok)', !Object.keys(m.opts).some((k) => /logo|attribution|copyright|terms/i.test(k)) && !/gm-style-cc|gmnoprint|\.gm-style\b/.test(gsrc));
    gm = fakeGm(); window.google = { maps: gm };
    await G.createGoogleMap(fakeEl('div'), KEY);
    ok("mapId verilmezse 'DEMO_MAP_ID'", gm.maps.at(-1).opts.mapId === 'DEMO_MAP_ID');

    // (b) gm_authFailure → onAuthFail tam bir kez (harita açıldıktan sonra)
    let fails = 0;
    gm = fakeGm(); window.google = { maps: gm };
    a = await G.createGoogleMap(fakeEl('div'), KEY, 'DEMO_MAP_ID', { onAuthFail: () => fails++ });
    ok('gm_authFailure window üzerinde tanımlı', typeof window.gm_authFailure === 'function');
    window.gm_authFailure(); window.gm_authFailure(); window.gm_authFailure();
    ok('(b) gm_authFailure üç kez → onAuthFail tam bir kez', fails === 1);
    gm = fakeGm(); window.google = { maps: gm };
    await G.createGoogleMap(fakeEl('div'), KEY);
    let threw = false; try { window.gm_authFailure(); } catch { threw = true; }
    ok('onAuthFail verilmeden gm_authFailure çökertmez', !threw);

    // Yükleme sırasında kimlik hatası: hızlı ret (25 sn beklenmez), onAuthFail bir kez, alt öğe kaldırılır
    fails = 0; gm = fakeGm({ autoIdle: false }); window.google = { maps: gm };
    const cont2 = fakeEl('div');
    t0 = Date.now();
    const p = G.createGoogleMap(cont2, KEY, 'DEMO_MAP_ID', { onAuthFail: () => fails++ });
    await tick();
    window.gm_authFailure();
    rejected = await p.then(() => false, () => true);
    ok('yükleme sırasında gm_authFailure → hemen reddeder', rejected && Date.now() - t0 < 1000);
    ok('yükleme sırasında gm_authFailure → onAuthFail bir kez, haritanın alt öğesi kaldırılır', fails === 1 && cont2.children.length === 0 && gm.maps.at(-1).cleared === true);
    window.gm_authFailure();
    ok('ret sonrası tekrar gm_authFailure → onAuthFail artmaz', fails === 1);

    // Düzeltme 1: 'maps' modülü (importLibrary) hiç gelmezse de kütüphane süresi içinde reddeder (openAdapter catch → OpenFreeMap)
    gm = fakeGm(); gm.importLibrary = () => new Promise(() => {});
    t0 = Date.now();
    const stall = await G.createGoogleMap(fakeEl('div'), KEY, 'm', { loadLib: async () => gm, libTimeoutMs: 50 }).then(() => null, (e) => e);
    ok("importLibrary('maps') hiç sonuçlanmazsa süre içinde anlaşılır Türkçe hatayla reddeder", stall instanceof Error && /zamanında yüklenemedi/.test(stall.message) && Date.now() - t0 < 1000 && gm.maps.length === 0);
    gm = fakeGm(); const il = gm.importLibrary; gm.importLibrary = (n) => new Promise((r) => setTimeout(() => r(il(n)), 30));
    const slowOk = await G.createGoogleMap(fakeEl('div'), KEY, 'm', { loadLib: async () => gm, libTimeoutMs: 1000 }).then((x) => x, (e) => e);
    ok("süre içinde gelen importLibrary('maps') normal açılır", slowOk?.name === 'google');

    // Düzeltme 2: 'idle' ve gm_authFailure aynı görevde → açılmış sayılmaz: ret, onAuthFail bir kez, alt öğe kaldırılır
    fails = 0; gm = fakeGm({ autoIdle: false }); window.google = { maps: gm };
    const cont3 = fakeEl('div');
    const p3 = G.createGoogleMap(cont3, KEY, 'DEMO_MAP_ID', { onAuthFail: () => fails++ });
    await tick();
    gm.maps.at(-1).fire('idle'); window.gm_authFailure();
    const r3 = await p3.then(() => null, (e) => e);
    ok("'idle' ile aynı anda gm_authFailure → createGoogleMap reddeder (anahtar reddedildi)", r3 instanceof Error && /anahtar reddedildi/.test(r3.message));
    ok("'idle' ile aynı anda gm_authFailure → onAuthFail bir kez, alt öğe kaldırılır, dinleyiciler temizlenir", fails === 1 && cont3.children.length === 0 && gm.maps.at(-1).cleared === true);

    // (c) trafik: her aralık ayrı çizgi; boş dizi hepsini kaldırır. Rota çizgisi: line() → { remove }
    gm = fakeGm(); window.google = { maps: gm };
    a = await G.createGoogleMap(fakeEl('div'), KEY);
    m = gm.maps.at(-1);
    const C1 = [[29.0, 41.0], [29.05, 41.02], [29.1, 41.05], [29.15, 41.07], [29.2, 41.1]];
    a.traffic(C1, [{ from: 0, to: 3, lvl: 'moderate' }, { from: 5, to: 9, lvl: 'heavy' }, { from: 12, to: 20, lvl: 'severe' }]);
    let tl = gm.polylines.filter((l) => l.map === m);
    ok('(c) traffic(coords, 3 aralık) → 3 ayrı çizgi haritada', tl.length === 3 && tl.every((l) => l.o.path.length >= 2));
    ok('(c) trafik renkleri motorla aynı (yavaş/yoğun/çok yoğun)', tl.map((l) => l.o.strokeColor).join() === '#ffb547,#ff5d6c,#c4001d');
    ok('(c) yol koordinatları {lat, lng} ([lon, lat] girdiden)', tl[0].o.path[0].lat === 41.0 && tl[0].o.path[0].lng === 29.0);
    a.traffic(C1, [{ from: 0, to: 3, lvl: 'heavy' }]);
    ok('(c) yeni trafik eskisini değiştirir (önceki 3 çizgi kaldırılır, 1 yeni)', gm.polylines.filter((l) => l.map === m).length === 1 && tl.every((l) => l.map === null));
    a.traffic(C1, []);
    ok('(c) traffic(coords, []) → tüm trafik çizgileri kaldırılır', gm.polylines.every((l) => l.map === null));
    const ln = a.line(C1);
    const route = gm.polylines.at(-1);
    ok('(c) line(coords) rota çizgisi çizer, trafik altında kalır', route.map === m && route.o.strokeColor === '#2ee6a6' && route.o.path.length === C1.length && route.o.zIndex < 2);
    a.traffic(C1, [{ from: 0, to: 3, lvl: 'heavy' }]);
    ok('(c) trafik çizgisi rota çizgisinin üstünde (zIndex)', gm.polylines.at(-1).o.zIndex > route.o.zIndex);
    a.line(C1.slice(0, 2));
    ok('(c) ikinci line() öncekini kaldırır', route.map === null && gm.polylines.filter((l) => l.map === m && l.o.strokeColor === '#2ee6a6').length === 1);
    ln.remove();
    ok('(c) line().remove() rota çizgisini kaldırır', gm.polylines.filter((l) => l.map === m && l.o.strokeColor === '#2ee6a6').length === 0);

    // (d) uydu: hybrid / roadmap
    a.setSatellite(true);
    ok("(d) setSatellite(true) → 'hybrid'", m.mapTypeId === 'hybrid');
    a.setSatellite(false);
    ok("(d) setSatellite(false) → 'roadmap'", m.mapTypeId === 'roadmap');

    // (e) moveTo → moveCamera (zoom ofseti YOK: Google kendi ölçeği web-mercator)
    m.calls.length = 0;
    a.moveTo({ center: { lat: 40.1, lon: 29.2 }, zoom: 15, heading: 90 });
    const mc = m.calls.find((c) => c[0] === 'moveCamera')?.[1];
    ok('(e) moveTo({center, zoom, heading}) → moveCamera', !!mc && mc.center.lat === 40.1 && mc.center.lng === 29.2 && mc.zoom === 15 && mc.heading === 90);
    a.moveTo({ tilt: 45 }, true);
    ok('(e) tilt → moveCamera({ tilt })', m.calls.at(-1)[0] === 'moveCamera' && m.calls.at(-1)[1].tilt === 45);
    a.moveTo({ center: { lat: 40.2, lon: 29.3 } }, true);
    ok('(e) yalnızca merkez + animate → panTo (akıcı kaydırma)', m.calls.at(-1)[0] === 'panTo' && m.calls.at(-1)[1].lat === 40.2);
    ok('bearing() = harita yönü', a.bearing() === 90);

    // İşaretçi, sığdırma, olaylar, imleç
    const dot = fakeEl('div');
    const mk = a.marker({ lat: 41, lon: 29 }, dot, 'Başlangıç');
    const ov = gm.overlays.at(-1);
    ok('marker: içerik haritanın bindirme katmanında, başlık sarmalayıcıda', ov.map === m && ov.div.children[0] === dot && ov.div.title === 'Başlangıç' && m._pane.children.includes(ov.div));
    mk.setPosition({ lat: 42, lon: 30 });
    ok('marker.setPosition konumu günceller', ov.div.style.left === '300px' && ov.div.style.top === '420px');
    const dot2 = fakeEl('div'); mk.setContent(dot2);
    ok('marker.setContent içeriği değiştirir', ov.div.children.length === 1 && ov.div.children[0] === dot2);
    mk.remove();
    ok('marker.remove haritadan kaldırır', ov.map === null && !m._pane.children.includes(ov.div));
    a.fit([{ lat: 40, lon: 29 }, { lat: 41, lon: 30 }], 60);
    const fb = m.calls.find((c) => c[0] === 'fitBounds');
    ok('fit(points, pad) → fitBounds(bounds, pad)', fb?.[1].pts.length === 2 && fb[1].pts[0].lng === 29 && fb[2] === 60);
    m.fire('idle');
    ok('fit sonrası zoom en çok 16', m.zoom === 16);
    const FP = [{ lat: 40, lon: 29 }, { lat: 41, lon: 30 }];
    a.fit(FP, 60); a.fit(FP, 60); a.fit(FP, 60);
    ok('art arda fit(): zoom sınırı dinleyicisi birikmez (tek idle dinleyicisi)', (m._h?.idle || []).length === 1);
    m.fire('idle');
    ok('idle sonrası fit dinleyicisi kalmaz, zoom yine 16', (m._h?.idle || []).length === 0 && m.zoom === 16);
    let clicked = null; a.onClick((pt) => { clicked = pt; });
    m.fire('click', { latLng: new gm.LatLng(40.5, 29.5) });
    ok('onClick { lat, lon } verir', clicked?.lat === 40.5 && clicked?.lon === 29.5);
    let dragged = 0; a.onDragStart(() => dragged++); m.fire('dragstart');
    ok('onDragStart kullanıcı sürüklemesinde çağrılır', dragged === 1);
    a.cursor('crosshair');
    ok('cursor(c) → draggableCursor', m.opts.draggableCursor === 'crosshair');
    a.cursor('');
    ok('cursor("") imleci sıfırlar', m.opts.draggableCursor == null);
    threw = false; try { a.resize(); a.installLayers(); } catch { threw = true; }
    ok('resize() ve installLayers() çökmez', !threw);

    // Anahtar: depolamaya ve günlüğe yazılmaz; kaynakta gerçek anahtar yok
    ok('anahtar localStorage/sessionStorage\'a hiç yazılmaz', !stored.some(([k, v]) => k.includes(KEY) || v.includes(KEY)) && !/localStorage|sessionStorage|storage\.js/.test(gsrc));
    ok('anahtar konsola/günlüğe yazılmaz', !logged.some((x) => x.some((y) => { try { return String(y?.message ?? y).includes(KEY) || JSON.stringify(y)?.includes(KEY); } catch { return false; } })));
    ok('google.js gerçek anahtar içermez', !/AIza[0-9A-Za-z_-]{20,}/.test(gsrc));

    // Bağlantılar: mapView google dalı, sw.js SHELL
    const mv = src('js/ui/mapView.js'), sw = src('sw.js');
    ok("mapView: import { createGoogleMap } from './maps/google.js'", /import \{ createGoogleMap \} from '\.\/maps\/google\.js'/.test(mv));
    ok('mapView google dalı createGoogleMap(mapEl, cfg.key, cfg.mapId, { onAuthFail })', /createGoogleMap\(mapEl, cfg\.key, cfg\.mapId, \{ onAuthFail \}\)/.test(mv));
    const gBranch = mv.slice(mv.indexOf("cfg.provider === 'google'"), mv.indexOf('} catch', mv.indexOf("cfg.provider === 'google'")));
    ok('mapView google dalı: onAuthFail → fallBackToOsm (forceOsm + tek bildirim), yalnızca gösterildikten sonra yenile', /fallBackToOsm\(\)/.test(gBranch) && /if \(shown\) setTimeout\(\(\) => location\.reload\(\)/.test(gBranch) && /shown = true/.test(gBranch));
    ok("sw.js SHELL './js/ui/maps/google.js' içerir", sw.includes("'./js/ui/maps/google.js'"));
  } catch (e) {
    ok('Bölüm 7 çalıştı: ' + e.message, false);
  } finally {
    Object.assign(console, orig);
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

// ---- Bölüm 8: Navigasyonda 3B/2B: setBuildings3d (üç bağdaştırıcı) ve navigasyon kamerası kararı ----
// Ağ yok: Bölüm 5'in sahte vektör kütüphanesi (stil kaynakları + düz 'building' katmanıyla) ve Bölüm 7'nin sahte google.maps'i.
{
  const { readFileSync } = await import('node:fs');
  const src = (p) => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8');
  const keys = ['window', 'document'];
  const saved = Object.fromEntries(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
  const container = () => ({ querySelector: () => null });
  const ext = (m) => m.layers.filter((id) => m.layerDefs[id]?.type === 'fill-extrusion');
  const js = (x) => JSON.stringify(x);
  def('window', {});
  def('document', { documentElement: { lang: 'tr' }, createElement: (tag) => fakeEl(tag), head: { append() {} } });

  try {
    const ML = await import('../js/ui/maps/maplibre.js');
    const MB = await import('../js/ui/maps/mapbox.js');
    const G = await import('../js/ui/maps/google.js');

    // (a) OpenFreeMap: openmaptiles/building üzerinde fill-extrusion, rota çizgisinin altında; kapatınca kalkar; tekrar açınca çoğalmaz
    let lib = fakeLib({ base: ['openmaptiles'], baseLayers: ['building'] });
    window.maplibregl = lib;
    const osm = await ML.createMapLibreMap(container());
    let m = lib.maps.at(-1);
    ok('(a) OpenFreeMap: başlangıçta 3B bina katmanı yok (navigasyon dışı harita düz)', ext(m).length === 0);
    osm.setBuildings3d(true);
    let ids = ext(m), d = m.layerDefs[ids[0]];
    const osmId = ids[0];
    ok('(a) setBuildings3d(true) → tek fill-extrusion katmanı', ids.length === 1);
    ok("(a) katman 'route-line'ın önüne (altına) eklenir: rota ve trafik görünür kalır", d?.before === 'route-line' && m.layers.indexOf(ids[0]) < m.layers.indexOf('route-line') && m.layers.indexOf(ids[0]) < m.layers.indexOf('traffic-line'));
    ok("(a) kaynak 'openmaptiles', kaynak katmanı 'building'", d?.source === 'openmaptiles' && d['source-layer'] === 'building');
    ok('(a) yükseklik render_height, taban render_min_height', js(d?.paint?.['fill-extrusion-height']).includes('render_height') && js(d?.paint?.['fill-extrusion-base']).includes('render_min_height') && !js(d?.paint?.['fill-extrusion-height']).includes('render_min_height'));
    ok('(a) süzgeç hide_3d == true olanları dışarıda bırakır', js(d?.filter).includes('hide_3d') && /"!=",\["get","hide_3d"\],true/.test(js(d?.filter)));
    ok('(a) koyu renk, opaklık ≈ 0.8, minzoom 13-14', /^#[0-9a-f]{6}$/i.test(d?.paint?.['fill-extrusion-color'] || '') && Math.abs(d.paint['fill-extrusion-opacity'] - 0.8) < 0.11 && d.minzoom >= 13 && d.minzoom <= 14);
    ok("(a) 3B açıkken düz 'building' dolgusu gizlenir", m.layout.building?.visibility === 'none');
    osm.setBuildings3d(true);
    ok('(a) tekrar setBuildings3d(true) katmanı çoğaltmaz', ext(m).length === 1);
    osm.setBuildings3d(false);
    ok('(a) setBuildings3d(false) katmanı kaldırır, düz dolgu geri gelir', ext(m).length === 0 && m.layout.building?.visibility === 'visible');
    let threw = false; try { osm.setBuildings3d(false); } catch { threw = true; }
    ok('(a) kapalıyken tekrar false çökmez', !threw && ext(m).length === 0);
    osm.setSatellite(true); osm.setBuildings3d(true);
    ok('(a) Esri uydu açıkken de bina katmanı rota çizgisinin altında', ext(m).length === 1 && m.layers.indexOf(ext(m)[0]) < m.layers.indexOf('route-line'));
    osm.setBuildings3d(false); osm.setSatellite(false);
    // Ters sıra: önce 3B, sonra uydu İLK kez açılır → Esri katmanları binaların altına girmeli (binaları örtmemeli)
    lib = fakeLib({ base: ['openmaptiles'], baseLayers: ['building'] });
    window.maplibregl = lib;
    const osm2 = await ML.createMapLibreMap(container());
    const m2 = lib.maps.at(-1);
    osm2.setBuildings3d(true); osm2.setSatellite(true);
    const bi = m2.layers.indexOf(ext(m2)[0]);
    ok('(a) önce 3B sonra uydu: Esri katmanları 3B binaların altında, binalar rota çizgisinin altında', bi > m2.layers.indexOf('sat') && bi > m2.layers.indexOf('sat-roads') && bi > m2.layers.indexOf('sat-places') && m2.layers.indexOf('sat') >= 0 && bi < m2.layers.indexOf('route-line'));
    osm2.setBuildings3d(false); osm2.setBuildings3d(true);
    const bi2 = m2.layers.indexOf(ext(m2)[0]);
    ok('(a) uydu açıkken 3B kapat/aç: binalar yine Esri üstünde, rota altında', bi2 > m2.layers.indexOf('sat-places') && bi2 < m2.layers.indexOf('route-line'));
    // Stilde kaynak yoksa (beklenmedik stil) katman eklenmez, çökmez
    lib = fakeLib(); window.maplibregl = lib;
    const bare = await ML.createMapLibreMap(container());
    threw = false; try { bare.setBuildings3d(true); } catch { threw = true; }
    ok('(a) stilde openmaptiles kaynağı yoksa setBuildings3d(true) çökmez, katman eklenmez', !threw && ext(lib.maps.at(-1)).length === 0);
    delete window.maplibregl;

    // (b) Mapbox: composite/building (extrude == 'true'), uydu stil değişiminde (style.load) korunur; kapatılınca geri eklenmez
    lib = fakeLib({ base: ['composite'], baseLayers: ['building'] });
    const mb = await MB.createMapboxMap(container(), 'pk.test-dummy', { loadLib: async () => lib });
    m = lib.maps.at(-1);
    mb.setBuildings3d(true);
    ids = ext(m); d = m.layerDefs[ids[0]];
    ok("(b) Mapbox: tek fill-extrusion, kaynak 'composite', kaynak katmanı 'building'", ids.length === 1 && d.source === 'composite' && d['source-layer'] === 'building');
    ok("(b) süzgeç extrude == 'true', yükseklik height, taban min_height", /"==",\["get","extrude"\],"true"/.test(js(d.filter)) && js(d.paint['fill-extrusion-height']).includes('"height"') && js(d.paint['fill-extrusion-base']).includes('"min_height"'));
    ok("(b) katman 'route-line'ın altında", d.before === 'route-line' && m.layers.indexOf(ids[0]) < m.layers.indexOf('route-line'));
    ok('(b) OpenFreeMap ile aynı katman kimliği (motor ortak)', !!osmId && ids[0] === osmId);
    mb.setSatellite(true);
    ok('(b) uydu stili yüklenirken katman geçici olarak yok (stil silindi)', ext(m).length === 0);
    threw = false; try { mb.setBuildings3d(true); } catch { threw = true; }
    ok('(b) stil yüklenirken setBuildings3d(true) çökmez', !threw);
    await tick(30);
    ok('(b) style.load sonrası (uydu) 3B binalar yeniden eklenir, tek katman, rota altında', m.styles.at(-1) === 'mapbox://styles/mapbox/satellite-streets-v12' && ext(m).length === 1 && m.layers.indexOf(ext(m)[0]) < m.layers.indexOf('route-line'));
    ok("(b) yeni stilde düz 'building' yine gizlenir", m.layout.building?.visibility === 'none');
    mb.setSatellite(false); await tick(30);
    ok('(b) uydu kapanınca (dark-v11) 3B binalar yine yerinde', m.styles.at(-1) === 'mapbox://styles/mapbox/dark-v11' && ext(m).length === 1);
    mb.setBuildings3d(false);
    ok('(b) setBuildings3d(false) → katman kalkar', ext(m).length === 0);
    mb.setSatellite(true); await tick(30);
    ok('(b) kapatıldıktan sonra stil değişiminde geri eklenmez', ext(m).length === 0 && m.installs >= 3);
    mb.setBuildings3d(true); mb.setSatellite(false); mb.setBuildings3d(false); await tick(30);
    ok('(b) stil yüklenirken kapatılırsa style.load sonrası katman yok', ext(m).length === 0 && m.layout.building?.visibility !== 'none');

    // (c) Google: yöntem var ve hiçbir şey yapmaz (eğim vektör haritada; 3B binaları Google kendisi çizer)
    const gm = fakeGm();
    const g = await G.createGoogleMap(fakeEl('div'), 'gk-dummy-t8', 'DEMO_MAP_ID', { loadLib: async () => gm });
    const gmap = gm.maps.at(-1);
    gmap.calls.length = 0;
    const optsBefore = js(gmap.opts);
    threw = false; try { g.setBuildings3d(true); g.setBuildings3d(false); g.setBuildings3d(true); } catch { threw = true; }
    ok('(c) Google setBuildings3d var, çökmez ve haritaya dokunmaz (no-op)', typeof g.setBuildings3d === 'function' && !threw && gmap.calls.length === 0 && js(gmap.opts) === optsBefore);

    // (d) Üç bağdaştırıcının yöntem kümesi birebir aynı ve setBuildings3d içerir
    const methodsOf = (o) => Object.keys(o).filter((k) => typeof o[k] === 'function').sort().join(',');
    ok('(d) yöntem kümesi OpenFreeMap = Mapbox = Google ve setBuildings3d içerir', methodsOf(osm) === methodsOf(mb) && methodsOf(mb) === methodsOf(g) && methodsOf(g).split(',').includes('setBuildings3d'));

    // (e) Navigasyon kamerası kararı (saf işlev): eğim yalnızca navigasyon + 3B; yön kararı 3B'den bağımsız
    const { navCamera } = await import('../js/ui/navCamera.js');
    let c = navCamera(true, false, true);
    ok('(e) 3B açık + kuzey-yukarı → eğim 40, yön 0, 3B binalar', c.tilt === 40 && c.resetHeading === true && c.buildings === true);
    c = navCamera(true, true, false);
    ok('(e) 3B kapalı + yön-yukarı → eğim 0, yön korunur (harita döner), düz binalar', c.tilt === 0 && c.resetHeading === false && c.buildings === false);
    c = navCamera(true, true, true);
    ok('(e) 3B açık + yön-yukarı → eğim 40, yön korunur, 3B binalar', c.tilt === 40 && c.resetHeading === false && c.buildings === true);
    c = navCamera(false, true, true);
    ok('(e) navigasyon kapalı → eğim 0, yön 0, düz binalar (3B seçimi ne olursa olsun)', c.tilt === 0 && c.resetHeading === true && c.buildings === false);
    c = navCamera(true, false, false);
    ok('(e) 3B kapalı + kuzey-yukarı → eğim 0, yön 0, düz binalar', c.tilt === 0 && c.resetHeading === true && c.buildings === false);

    // Bağlantılar: mapView, navigator, kabuk düğmesi, depolama (cihazda; hesap eşitlemesine girmez), sw.js
    const mv = src('js/ui/mapView.js'), nv = src('js/nav/navigator.js'), sh = src('js/ui/shell.js'), html = src('index.html'), sync = src('js/account/sync.js'), sw = src('sw.js');
    ok('mapView: navCamera kararı kullanılır, setBuildings3d çağrılır, harita hazır değilse whenMap sırası', /navCamera\(/.test(mv) && /adapter\.setBuildings3d\(/.test(mv) && /mapApi\.navView = [\s\S]{0,400}whenMap\(/.test(mv));
    ok("mapView: seçim cihazda load('nav3d', true) / save('nav3d', …)", /load\('nav3d', true\)/.test(mv) && /save\('nav3d',/.test(mv));
    ok("nav3d hesap eşitleme anahtarlarında yok", !/'nav3d'/.test(sync));
    ok('navigator: başlatma ve yön-yukarı değişimi 3B seçimini geçirir', /mapApi\.navView\(true, up, mapApi\.is3d\(\)\)/.test(nv) && /mapApi\.navView\(true, hu\.checked, mapApi\.is3d\(\)\)/.test(nv));
    const fabs = html.slice(html.indexOf('<div class="fabs" id="fabs">'), html.indexOf('</div>', html.indexOf('<div class="fabs" id="fabs">')));
    const b3 = /<button[^>]*id="fab-3d"[^>]*>/.exec(fabs)?.[0] || '';
    ok('index.html: #fab-3d .fabs içinde, başlangıçta gizli, aria-pressed ve Türkçe aria-label/title', /class="hidden"/.test(b3) && /aria-pressed="(true|false)"/.test(b3) && /aria-label="3B\/2B görünüm"/.test(b3) && /title="3B\/2B görünüm"/.test(b3));
    ok('shell: #fab-3d yalnızca navigasyonda görünür, 3B/2B yazar, mapApi.set3d ile değiştirir', /\$\('fab-3d'\)/.test(sh) && /'3B' : '2B'/.test(sh) && /mapApi\.set3d\(/.test(sh));
    ok('shell: paint3d durum değişmediyse DOM\'a yazmaz', /if \(st === painted3d\) return;/.test(sh));
    const kx = JSON.parse(src('i18n/keys.extra.json'));
    const dicts = await Promise.all(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ro', 'bg', 'el'].map(async (c) => (await import(`../js/i18n/lang/${c}.extra.js`)).default));
    ok('i18n: "3B"/"2B" ek sözlükte, 11 dilde "3D"/"2D"', kx.includes('3B') && kx.includes('2B') && dicts.every((dd) => dd['3B'] === '3D' && dd['2B'] === '2D'));
    ok("sw.js SHELL './js/ui/navCamera.js' içerir", sw.includes("'./js/ui/navCamera.js'"));
  } catch (e) {
    ok('Bölüm 8 çalıştı: ' + e.message, false);
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

// ---- Bölüm 9: Premium yol hız limiti (HERE → Mapbox → OSM → bilinmiyor) ----
// (a) server/speedlimits.mjs saf işlevleri; (b) POST /v1/speedlimits: alt süreç (8787 DIŞI port, geçici DATA_DIR, sahte anahtar) + sahte HERE sunucusu;
// (c) js/nav/limitSpans.js ve js/mapbox/route.js maxspeed ayrıştırması; (d) js/nav/speedLimit.js kaynak sırası (sahte fetch, gerçek ağ yok).
const FLEX_TAB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Test için HERE esnek çoklu çizgi kodlayıcısı (third: 3. boyut türü, z değerleri points[i][2]). */
function encodeFlex(points, precision = 5, third = 0, thirdPrec = 0) {
  const u = (v) => { let s = ''; while (v > 31) { s += FLEX_TAB[(v % 32) | 32]; v = Math.floor(v / 32); } return s + FLEX_TAB[v]; };
  const z = (v) => u(v < 0 ? -2 * v - 1 : 2 * v);
  let out = u(1) + u(precision | (third << 4) | (thirdPrec << 7));
  const m = 10 ** precision, mz = 10 ** thirdPrec;
  let pa = 0, pb = 0, pc = 0;
  for (const p of points) {
    const A = Math.round(p[0] * m), B = Math.round(p[1] * m);
    out += z(A - pa) + z(B - pb); pa = A; pb = B;
    if (third) { const C = Math.round(p[2] * mz); out += z(C - pc); pc = C; }
  }
  return out;
}
const line = (n, lat = 39.9, lon0 = 32.8, step = 0.001) => Array.from({ length: n }, (_, i) => [lat, +(lon0 + i * step).toFixed(5)]);
{
  // (a) saf işlevler
  try {
    const SL = await import('../server/speedlimits.mjs');
    const vec = [[50.10228, 8.69821], [50.10201, 8.69567], [50.10063, 8.6915], [50.09878, 8.68752]];
    ok('(a) esnek çoklu çizgi: HERE belge vektörü "BFoz5xJ67i1B1B7PzIhaxL7Y" çözülür', JSON.stringify(SL.decodeFlexPolyline('BFoz5xJ67i1B1B7PzIhaxL7Y')) === JSON.stringify(vec));
    ok('(a) test kodlayıcısı aynı vektörü üretir (kodlayıcı da doğru)', encodeFlex(vec) === 'BFoz5xJ67i1B1B7PzIhaxL7Y');
    const big = [[39.12345, 32.98765], [41, 28.97], [-33.9, 151.2], [39.12345, -179.99999], [89.99999, 179.99999]];
    ok('(a) negatif/büyük değerler gidiş-dönüş', JSON.stringify(SL.decodeFlexPolyline(encodeFlex(big))) === JSON.stringify(big));
    const z3 = [[50.1022829, 8.6982122, 10], [50.1020076, 8.6956695, 20], [50.1006313, 8.6914960, 30]];
    ok('(a) 3. boyutlu (rakım) çizgi: z atlanır, 7 basamak lat/lon doğru', JSON.stringify(SL.decodeFlexPolyline(encodeFlex(z3, 7, 2, 0))) === JSON.stringify(z3.map((p) => [p[0], p[1]])));
    ok('(a) bozuk dize hata fırlatır (geçersiz karakter, sürüm 2, yarım sayı)', await throws(() => SL.decodeFlexPolyline('BF*a')) && await throws(() => SL.decodeFlexPolyline('CFoz5xJ67i1B')) && await throws(() => SL.decodeFlexPolyline('BFo')));
    ok('(a) m/s → km/s: 22.7777786 → 82 (tek sayılı gerçek limit kabul)', SL.kphFromMs(22.7777786) === 82);
    ok('(a) m/s → km/s: 13.8888893 → 50, 41.6667 → 150', SL.kphFromMs(13.8888893) === 50 && SL.kphFromMs(41.6667) === 150);
    ok('(a) 0 / 3 km/s / 200 km/s / sayı değil → null', SL.kphFromMs(0) === null && SL.kphFromMs(3 / 3.6) === null && SL.kphFromMs(200 / 3.6) === null && SL.kphFromMs('x') === null && SL.kphFromMs(null) === null);
    const good = SL.parsePoints({ points: [{ lat: 39.9000049, lon: 32.8 }, { lat: 40.5, lon: 32 }] });
    ok('(a) parsePoints: geçerli 2 nokta, 5 basamağa yuvarlanır', JSON.stringify(good) === '[[39.9,32.8],[40.5,32]]');
    const P = (n) => Array.from({ length: n }, (_, i) => ({ lat: 39.9, lon: 32.8 + i * 0.001 }));
    const bad = [undefined, null, {}, { points: 'x' }, { points: P(1) }, { points: P(61) }, { points: [{ lat: 91, lon: 0 }, { lat: 0, lon: 0 }] },
      { points: [{ lat: 0, lon: -181 }, { lat: 0, lon: 0 }] }, { points: [{ lat: '39.9', lon: 32 }, { lat: 0, lon: 0 }] }, { points: [{ lat: null, lon: 32 }, { lat: 0, lon: 0 }] },
      { points: [{ lat: 39.9 }, { lat: 0, lon: 0 }] }, { points: [null, { lat: 0, lon: 0 }] }];
    ok('(a) parsePoints: geçersiz gövdelerin hepsi null (12 durum)', bad.every((b) => SL.parsePoints(b) === null));
    ok('(a) parsePoints: 60 nokta kabul', SL.parsePoints({ points: P(60) })?.length === 60);
    // HERE yanıtı → kısa kesimler: 11 doğrusal nokta; 0-3 arası 82, 3-6 limitsiz, 6-8 ve 8-10 50 (bitişik eşit limitler birleşir)
    const pts = line(11);
    const route = { routes: [{ sections: [{ polyline: encodeFlex(pts), spans: [{ offset: 0, maxSpeed: 22.7777786 }, { offset: 3 }, { offset: 6, maxSpeed: 13.8888893 }, { offset: 8, maxSpeed: 13.8888893 }] }] }] };
    ok('(a) spansFromRoute: limitsiz kesim atlanır, bitişik eşit limit birleşir', JSON.stringify(SL.spansFromRoute(route)) === JSON.stringify([[39.9, 32.8, 39.9, 32.803, 82], [39.9, 32.806, 39.9, 32.81, 50]]));
    const L = [[39.9, 32.8], [39.9, 32.81], [39.91, 32.81]]; // dik köşe: tek kirişe indirgenmez (yol şekli korunur)
    const rl = SL.spansFromRoute({ routes: [{ sections: [{ polyline: encodeFlex(L), spans: [{ offset: 0, maxSpeed: 25 }] }] }] });
    ok('(a) köşeli yol aynı limitte bile iki kesim (kiriş yolu kesmez)', rl.length === 2 && rl[0][4] === 90 && rl[1][4] === 90);
    const two = SL.spansFromRoute({ routes: [{ sections: [{ polyline: encodeFlex(line(3)), spans: [{ offset: 0, maxSpeed: 25 }] }, { polyline: encodeFlex(line(3, 39.9, 32.802)), spans: [{ offset: 0, maxSpeed: 25 }] }] }] });
    ok('(a) birden çok bölüm (section) art arda eklenir ve birleşir', JSON.stringify(two) === JSON.stringify([[39.9, 32.8, 39.9, 32.804, 90]]));
    // Düzeltme 1: rota uzunluğu / aralık sınırı, yanıt ve önbellek bayt sınırı, birleştirme maliyeti
    const chain = (n, stepDeg) => ({ points: Array.from({ length: n }, (_, i) => ({ lat: 39, lon: -20 + i * stepDeg })) });
    ok('(a) parsePoints: toplam > 2000 km → null (60 nokta × 0,4°, ≈ 2040 km)', SL.parsePoints(chain(60, 0.4)) === null && SL.parsePoints(chain(60, 0.38)) !== null);
    ok('(a) parsePoints: komşu iki nokta arası > 300 km → null (≈ 340 km), 250 km kabul', SL.parsePoints({ points: [{ lat: 39, lon: 32 }, { lat: 39, lon: 35.94 }] }) === null && SL.parsePoints({ points: [{ lat: 39, lon: 32 }, { lat: 39, lon: 34.9 }] }) !== null);
    ok('(a) sınır sabitleri: 2000 km, 300 km, yanıt ≤ 4 MB, önbellek kaydı ≤ 512 KB', SL.MAX_ROUTE_KM === 2000 && SL.MAX_GAP_KM === 300 && SL.MAX_REPLY_BYTES === 4e6 && SL.MAX_CACHE_ITEM === 512 * 1024);
    {
      const lru = SL.createLru(100, 60e3, 1000);
      const b = (n) => Buffer.alloc(n, 120);
      lru.set('a', b(400)); lru.set('b', b(400)); lru.set('c', b(400));
      ok('(a) LRU bayt bütçesi: 3 × 400 B, bütçe 1000 → en eskisi atılır', lru.get('a') === null && lru.get('b') && lru.get('c') && lru.size === 2 && lru.bytes === 800);
      lru.set('d', b(1500));
      ok('(a) LRU: bütçeden büyük tek kayıt saklanmaz, öncekiler kalır', lru.get('d') === null && lru.size === 2);
    }
    {
      const N = 20000;
      const pts = Array.from({ length: N }, (_, i) => [39.9, 32 + i * 0.00005]);
      let t0 = performance.now();
      const same = SL.mergeSegments(pts, new Array(N - 1).fill(90));
      const dt1 = performance.now() - t0;
      const zig = Array.from({ length: N }, (_, i) => [39.9 + (i % 2) * 0.0003, 32 + i * 0.00005]); // her köşe 30 m sapar: hiçbiri birleşmez
      t0 = performance.now();
      const zz = SL.mergeSegments(zig, new Array(N - 1).fill(90));
      const dt2 = performance.now() - t0;
      ok(`(a) mergeSegments 20000 köşe: doğrusal ${dt1.toFixed(0)} ms, zikzak ${dt2.toFixed(0)} ms (sınırlı geri bakış, O(n²) yok)`, dt1 < 300 && dt2 < 300 && same.length >= 20 && same.length <= 1000 && zz.length === N - 1 && same[0][0] === 39.9 && same.at(-1)[3] === pts.at(-1)[1]);
    }
    // Düzeltme 6: HERE_ROUTER_BASE yalnızca https ya da 127.0.0.1/localhost'a http
    {
      const old = process.env.HERE_ROUTER_BASE;
      const rb = (v) => { if (v === undefined) delete process.env.HERE_ROUTER_BASE; else process.env.HERE_ROUTER_BASE = v; return SL.routerBase(); };
      const REAL = 'https://router.hereapi.com';
      ok('(a) routerBase: boş → gerçek adres', rb(undefined) === REAL && rb('') === REAL);
      ok('(a) routerBase: http://127.0.0.1:18799 ve http://localhost:9 kabul', rb('http://127.0.0.1:18799') === 'http://127.0.0.1:18799' && rb('http://localhost:9') === 'http://localhost:9');
      ok('(a) routerBase: https://x.example kabul', rb('https://x.example') === 'https://x.example');
      ok('(a) routerBase: dış http, ftp, bozuk, kullanıcı bilgili adres → gerçek adres', rb('http://evil.example') === REAL && rb('http://127.0.0.1.evil.example') === REAL && rb('ftp://127.0.0.1') === REAL && rb('bozuk') === REAL && rb('http://user@127.0.0.1:1') === REAL);
      if (old === undefined) delete process.env.HERE_ROUTER_BASE; else process.env.HERE_ROUTER_BASE = old;
    }
    ok('(a) bozuk/boş yanıt → boş liste', JSON.stringify(SL.spansFromRoute({})) === '[]' && JSON.stringify(SL.spansFromRoute({ routes: [{ sections: [{ polyline: 'B*', spans: [] }] }] })) === '[]');
  } catch (e) {
    ok('Bölüm 9 (a) çalıştı: ' + e.message, false);
  }

  // (b) sunucu yolu
  const http = await import('node:http');
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const CODE = 'test-dummy-access-code-0123456789';
  const HKEY = 'here-test-dummy-key-0123456789';
  const sha256 = (s) => createHash('sha256').update(s).digest('hex');
  const TOK_FREE = 'F'.repeat(30), TOK_PREM = 'P'.repeat(30), TOK_PREM2 = 'Q'.repeat(30);
  const children = [], dirs = [], logs = [], texts = [];
  const hereReq = [];
  const mock = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hereReq.push(u);
    const org = u.searchParams.get('origin') || '';
    if (org.startsWith('10.')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'boom', echo: u.searchParams.get('apiKey') })); }
    if (org.startsWith('11.')) { // büyük ama sınır altı HERE yanıtı (≈ 1 MB): 25000 köşe, her parça farklı limit → sonuç gövdesi > 512 KB
      const big = Array.from({ length: 25000 }, (_, i) => [11, +(20 + i * 0.0001).toFixed(5)]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ routes: [{ sections: [{ polyline: encodeFlex(big), spans: big.slice(0, -1).map((_, i) => ({ offset: i, maxSpeed: i % 2 ? 22.7777786 : 13.8888893 })) }] }] }));
    }
    if (org.startsWith('12.')) { res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(5e6) }); res.write('{"routes":['); return setTimeout(() => res.destroy(), 50); } // Content-Length > 4 MB
    if (org.startsWith('13.')) { // uzunluk başlığı yok, 5 MB akar
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const chunk = 'x'.repeat(65536); let sent = 0;
      const pump = () => { while (sent < 5e6) { sent += chunk.length; if (!res.write(chunk)) return res.once('drain', pump); } res.end(); };
      res.on('error', () => {}); return pump();
    }
    if (org.startsWith('14.')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ routes: [{ sections: [{ polyline: encodeFlex(line(5, 14)), spans: [{ offset: 0 }] }] }] })); } // limitsiz: s = []
    const pts = [u.searchParams.get('origin'), ...u.searchParams.getAll('via').map((v) => v.split('!')[0]), u.searchParams.get('destination')].map((s) => String(s).split(',').map(Number));
    const n = pts.length, a = Math.floor(n / 3), b = Math.floor((2 * n) / 3);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ routes: [{ sections: [{ polyline: encodeFlex(pts), spans: [{ offset: 0, length: 1, maxSpeed: 22.7777786 }, { offset: a, length: 1 }, { offset: b, length: 1, maxSpeed: 13.8888893 }] }] }] }));
  });
  await new Promise((r) => mock.listen(18799, '127.0.0.1', r));
  const seed = () => {
    const now = Date.now();
    const sess = (uid) => ({ uid, createdAt: now, lastSeen: now, exp: now + 86400e3 });
    return {
      users: {
        u_free: { id: 'u_free', email: 'free@test.invalid', name: 'Free', createdAt: now },
        u_prem: { id: 'u_prem', email: 'prem@test.invalid', name: 'Prem', createdAt: now, premiumUntil: now + 30 * 86400e3 },
        u_prem2: { id: 'u_prem2', email: 'prem2@test.invalid', name: 'Prem2', createdAt: now, premiumUntil: now + 30 * 86400e3 },
      },
      invites: {}, docs: {},
      sessions: { [sha256(TOK_FREE)]: sess('u_free'), [sha256(TOK_PREM)]: sess('u_prem'), [sha256(TOK_PREM2)]: sess('u_prem2') },
    };
  };
  async function start(port, extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'sl-test-')); dirs.push(dir);
    writeFileSync(join(dir, 'db.json'), JSON.stringify(seed()));
    const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'GOOGLE_MAP_ID', 'MAPBOX_MAP_TOKEN', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'HERE_MONTHLY_CAP', 'SPEEDLIMIT_DAILY_PER_USER', 'HERE_ROUTER_BASE', 'HERE_BASE'].map((k) => [k, '']));
    const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, env: { ...process.env, ...blank, PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE, HERE_ROUTER_BASE: 'http://127.0.0.1:18799', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let out = ''; logs.push(() => out);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await new Promise((r) => setTimeout(r, 100));
    if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out);
    return async (auth, body, { raw } = {}) => {
      const headers = { 'Content-Type': 'application/json' };
      if (auth === 'code') headers['X-Access-Code'] = CODE; else if (auth) headers.Authorization = 'Bearer ' + auth;
      const r = await fetch(`http://127.0.0.1:${port}/v1/speedlimits`, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
      const text = await r.text(); texts.push(text);
      let j = null; try { j = JSON.parse(text); } catch {}
      return { status: r.status, text, json: j, headers: r.headers };
    };
  }
  const body = (n, lat = 39.9, lon0 = 32.8) => ({ points: line(n, lat, lon0).map(([la, lo]) => ({ lat: la, lon: lo })) });
  try {
    const A = await start(18791, { HERE_API_KEY: HKEY, SPEEDLIMIT_DAILY_PER_USER: '2', HERE_MONTHLY_CAP: '100' });
    let r = await A(undefined, body(10));
    ok('(b) kimliksiz → 401', r.status === 401);
    r = await A(TOK_FREE, body(10));
    ok('(b) Premium olmayan hesap → 402 premium_required, HERE çağrılmaz', r.status === 402 && r.json?.error === 'premium_required' && hereReq.length === 0);
    const bads = [{}, { points: [] }, body(1), body(61), { points: [{ lat: 95, lon: 1 }, { lat: 1, lon: 1 }] }, { points: [{ lat: '1', lon: 1 }, { lat: 1, lon: 1 }] }];
    let allBad = true;
    for (const b of bads) { const x = await A(TOK_PREM, b); if (x.status !== 400) allBad = false; }
    ok('(b) geçersiz gövdeler → 400 (6 durum)', allBad);
    r = await A(TOK_PREM, null, { raw: '{bozuk' });
    ok('(b) JSON olmayan gövde → 400', r.status === 400);
    r = await A(TOK_PREM, null, { raw: JSON.stringify({ points: body(10).points, pad: 'x'.repeat(20000) }) });
    ok('(b) çok büyük gövde → 400', r.status === 400 && hereReq.length === 0);
    r = await A(TOK_PREM, body(10));
    ok('(b) Premium → 200 { v:1, s:[[lat1,lon1,lat2,lon2,kph]] } (5 basamak, limitsiz kesim yok, birleşik)', r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ v: 1, s: [[39.9, 32.8, 39.9, 32.803, 82], [39.9, 32.806, 39.9, 32.809, 50]] }));
    ok('(b) yanıt Cache-Control no-store', /no-store/.test(r.headers.get('cache-control') || ''));
    const q = hereReq[0]?.searchParams;
    ok('(b) HERE isteği: /v8/routes, car, origin/destination ilk/son nokta, return=polyline, spans maxSpeed', hereReq.length === 1 && hereReq[0].pathname === '/v8/routes' && q.get('transportMode') === 'car' && q.get('origin') === '39.90000,32.80000' && q.get('destination') === '39.90000,32.80900' && q.get('return') === 'polyline' && /maxSpeed/.test(q.get('spans') || ''));
    ok('(b) ara noktalar via=lat,lon!passThrough=true (8 adet, sırayla)', q.getAll('via').length === 8 && q.getAll('via').every((v) => /^39\.90000,32\.80\d{3}!passThrough=true$/.test(v)) && q.getAll('via')[0].startsWith('39.90000,32.80100'));
    ok('(b) anahtar yalnızca HERE isteğinde (apiKey)', q.get('apiKey') === HKEY);
    r = await A(TOK_PREM, body(10));
    ok('(b) aynı rota ikinci kez: önbellekten (X-Cache hit), HERE ikinci kez çağrılmaz', r.status === 200 && r.headers.get('x-cache') === 'hit' && hereReq.length === 1 && r.json?.s?.length === 2);
    r = await A(TOK_PREM, body(10, 39.91));
    ok('(b) kullanıcı 2. farklı rota → 200 (günlük 2)', r.status === 200 && hereReq.length === 2);
    r = await A(TOK_PREM, body(10, 39.92));
    ok('(b) kullanıcı 3. farklı rota → 429 (SPEEDLIMIT_DAILY_PER_USER=2), HERE çağrılmaz', r.status === 429 && hereReq.length === 2);
    r = await A(TOK_PREM, body(10));
    ok('(b) hak dolsa da önbellekteki rota yine 200', r.status === 200 && r.headers.get('x-cache') === 'hit');
    r = await A('code', body(10, 39.93));
    ok('(b) yönetici kodu günlük sınırdan muaf → 200', r.status === 200 && hereReq.length === 3);
    r = await A(TOK_PREM2, body(10, 10.1));
    ok('(b) HERE hatası → 502, genel ileti, anahtar yok', r.status === 502 && typeof r.json?.error === 'string' && !r.text.includes(HKEY) && !r.text.includes('boom'));
    r = await A(TOK_PREM2, body(2, 39.95));
    ok('(b) 2 nokta (via yok) → 200', r.status === 200 && hereReq.at(-1).searchParams.getAll('via').length === 0);
    // Düzeltme 1 ve 5 (yönetici kodu: günlük haktan muaf)
    let n0 = hereReq.length;
    r = await A('code', { points: Array.from({ length: 60 }, (_, i) => ({ lat: 39, lon: -20 + i * 0.4 })) });
    ok('(b) > 2000 km rota → 400, HERE çağrılmaz', r.status === 400 && hereReq.length === n0);
    r = await A('code', { points: [{ lat: 39, lon: 26 }, { lat: 39, lon: 30 }] });
    ok('(b) komşu noktalar arası > 300 km → 400, HERE çağrılmaz', r.status === 400 && hereReq.length === n0);
    r = await A('code', body(3, 11));
    ok('(b) büyük sonuç (> 512 KB) → 200 ama önbelleğe girmez', r.status === 200 && r.text.length > 512 * 1024 && r.json?.s?.length === 24999 && hereReq.length === n0 + 1);
    r = await A('code', body(3, 11));
    ok('(b) aynı büyük rota tekrar: önbellekte yok (X-Cache miss), HERE yeniden çağrılır', r.status === 200 && r.headers.get('x-cache') === 'miss' && hereReq.length === n0 + 2);
    r = await A('code', body(3, 12));
    ok('(b) HERE yanıtı Content-Length > 4 MB → 502 genel ileti', r.status === 502 && r.json?.error === 'hız limiti alınamadı' && !r.text.includes(HKEY));
    r = await A('code', body(3, 13));
    ok('(b) uzunluk başlıksız 5 MB HERE yanıtı okuma sınırında kesilir → 502', r.status === 502 && r.json?.error === 'hız limiti alınamadı');
    n0 = hereReq.length;
    r = await A('code', body(3, 13));
    ok('(b) 502 sonrası önbellek yok: tekrar istek HERE sunucusuna gider', r.status === 502 && hereReq.length === n0 + 1);
    r = await A('code', body(3, 14));
    ok('(b) boş sonuç (s: []) → 200 ama önbelleğe girmez', r.status === 200 && JSON.stringify(r.json) === '{"v":1,"s":[]}' && hereReq.length === n0 + 2);
    r = await A('code', body(3, 14));
    ok('(b) boş sonuç tekrar: HERE yeniden sorulur (X-Cache miss)', r.status === 200 && r.headers.get('x-cache') === 'miss' && hereReq.length === n0 + 3);

    const B = await start(18792, { HERE_API_KEY: HKEY, HERE_MONTHLY_CAP: '1' });
    const before = hereReq.length;
    r = await B(TOK_PREM, body(10, 38.5));
    ok('(b) aylık HERE sayacı: 1. istek → 200', r.status === 200 && hereReq.length === before + 1);
    r = await B(TOK_PREM, body(10, 38.6));
    ok('(b) aylık HERE sınırı (ortak sayaç) → 402 here_cap, HERE çağrılmaz', r.status === 402 && r.json?.error === 'here_cap' && hereReq.length === before + 1);

    const C = await start(18793, {});
    r = await C(TOK_PREM, body(10));
    ok('(b) sunucuda HERE anahtarı yok → 501', r.status === 501);
  } catch (e) {
    ok('Bölüm 9 (b) çalıştı: ' + e.message, false);
  } finally {
    for (const c of children) { try { c.kill(); } catch {} }
    await new Promise((r) => setTimeout(r, 300));
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    mock.close();
  }
  ok('(b) hiçbir yanıtta ve sunucu çıktısında sahte HERE anahtarı yok', texts.length > 10 && texts.every((t) => !t.includes(HKEY)) && logs.length === 3 && logs.every((f) => !f().includes(HKEY)));
  ok('(b) 4 MB sınırı gerçekten devrede: günlükte 3 kez "yanıt çok büyük" (Content-Length + 2 × akış sınırı), ayrıştırma hatası değil', (logs[0]?.().match(/HERE hız limiti alınamadı: yanıt çok büyük/g) || []).length === 3);
}
{
  // (c) istemci: limitSpans.js, mapbox/route.js maxspeed; (d) speedLimit.js kaynak sırası
  const { readFileSync } = await import('node:fs');
  const src = (p) => readFileSync(fileURLToPath(new URL('../' + p, import.meta.url)), 'utf8');
  const saved = Object.fromEntries(['localStorage', 'sessionStorage', 'document', 'fetch'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  const m = new Map();
  const ls = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  def('localStorage', ls); def('sessionStorage', ls);
  def('document', { getElementById: () => null, addEventListener() {}, dispatchEvent() {}, documentElement: { lang: 'tr' }, body: { classList: { toggle() {}, contains: () => false } } });
  const calls = [];
  let mode = { premium: true, here: true, sl: 'ok', osm: 70 };
  const HERE_S = [[39.9, 32.8, 39.9, 32.81, 82], [39.9, 32.81, 39.9, 32.811, 200], [NaN, 32.81, 39.9, 32.82, 60]]; // son ikisi geçersiz: atılır
  const resp = (status, obj) => Promise.resolve(new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }));
  def('fetch', (url, init) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/v1/me')) return resp(200, { caps: { here: mode.here, mapbox: false, ocm: false, overpass: true, occupancy: true }, user: { premium: mode.premium } });
    if (u.endsWith('/v1/speedlimits')) {
      if (mode.sl === 'ok') return resp(200, { v: 1, s: HERE_S });
      if (mode.sl === 'net') return Promise.reject(new TypeError('ağ yok'));
      return resp(Number(mode.sl), { error: 'x' });
    }
    if (u.includes('/locate')) return resp(200, mode.osm ? [{ edges: [{ distance: 5, heading: 90, edge_info: { speed_limit: mode.osm } }] }] : [{ edges: [] }]);
    return resp(404, {});
  });
  const nSl = () => calls.filter((u) => u.endsWith('/v1/speedlimits')).length;
  const nOsm = () => calls.filter((u) => u.includes('/locate')).length;
  try {
    const LS = await import('../js/nav/limitSpans.js');
    ok('(c) kphFromMs 22.7777786 → 82, 0 → null', LS.kphFromMs(22.7777786) === 82 && LS.kphFromMs(0) === null);
    ok('(c) Mapbox maxspeed km/h: 82 kabul, 50 kabul', LS.kphFromMapbox({ speed: 82, unit: 'km/h' }) === 82 && LS.kphFromMapbox({ speed: 50, unit: 'km/h' }) === 50);
    ok('(c) Mapbox maxspeed mph → km/s (65 mph → 105, 31 mph → 50)', LS.kphFromMapbox({ speed: 65, unit: 'mph' }) === 105 && LS.kphFromMapbox({ speed: 31, unit: 'mph' }) === 50);
    ok('(c) Mapbox {unknown:true} / {none:true} / birimsiz / null → null', LS.kphFromMapbox({ unknown: true }) === null && LS.kphFromMapbox({ none: true }) === null && LS.kphFromMapbox({ speed: 50 }) === null && LS.kphFromMapbox(null) === null);
    ok('(c) 5..150 kabul (82 evet; 0, 3, 200, 151 hayır; 10\'un katı şartı yok)', LS.validKph(82) && LS.validKph(5) && LS.validKph(150) && LS.validKph(45) && !LS.validKph(0) && !LS.validKph(3) && !LS.validKph(200) && !LS.validKph(151) && !LS.validKph(82.5)
      && LS.kphFromMapbox({ speed: 3, unit: 'km/h' }) === null && LS.kphFromMapbox({ speed: 200, unit: 'km/h' }) === null);

    // örnekleme: en çok 60 nokta, ilk = başlangıç, son = varış, mesafeye göre eşit aralık
    const coords = Array.from({ length: 1000 }, (_, i) => [32 + i * 0.002, 39.9]); // [lon, lat]
    const smp = LS.sampleRoute(coords, 60);
    const gaps = smp.slice(1).map((p, i) => Math.abs(p.lon - smp[i].lon));
    ok('(c) sampleRoute: 60 nokta, ilk/son rota uçları, eşit aralık', smp.length === 60 && smp[0].lat === 39.9 && smp[0].lon === 32 && smp[59].lon === 33.998 && Math.max(...gaps) / Math.min(...gaps) < 1.05);
    ok('(c) sampleRoute: kısa rota (3 köşe) en çok köşe sayısı kadar ama en az 2', LS.sampleRoute([[32, 39.9], [32.001, 39.9], [32.002, 39.9]], 60).length <= 60 && LS.sampleRoute([[32, 39.9], [32.001, 39.9]], 60).length === 2);

    // uzamsal arama: çift şeritli yol (gidiş doğu 90, dönüş batı 70; ≈ 22 m arayla)
    const east = [[39.9, 32.8, 39.9, 32.81, 90], [39.9, 32.81, 39.9, 32.82, 90]];
    const west = [[39.9002, 32.82, 39.9002, 32.81, 70], [39.9002, 32.81, 39.9002, 32.8, 70]];
    const L1 = LS.createLimitSpans({ post: () => { throw new Error('çağrılmamalı'); }, premium: () => true, hasHere: () => false });
    await L1.loadForRoute({ coords: [], limitSpans: [...east, ...west] }, { fetchHere: false });
    const hit = (lat, lon, h) => { const x = L1.limitAt(lat, lon, h); return x ? `${x.kph}/${x.src}` : 'null'; };
    ok('(c) limitAt: doğuya giderken 90 (mapbox)', hit(39.9001, 32.805, 92) === '90/mapbox');
    ok('(c) limitAt: aynı noktada batıya giderken karşı şerit 70 (yön tercihi)', hit(39.9001, 32.805, 268) === '70/mapbox');
    ok('(c) limitAt: yön bilinmiyorsa en yakın kesim', hit(39.90004, 32.815, null) === '90/mapbox' && hit(39.90017, 32.815, null) === '70/mapbox');
    ok('(c) limitAt: 40 m\'den uzak → null', hit(39.9008, 32.805, 90) === 'null' && hit(39.9, 32.83, 90) === 'null');
    ok('(c) limitAt: yönle uyumlu kesim yoksa (dik yön) tahmin yok → null', hit(39.9001, 32.805, 0) === 'null');
    // uzun rota: 6000 kesim, ardışık 1200 sorgu doğru ve hızlı; uzak sıçrama da bulunur
    const longS = Array.from({ length: 6000 }, (_, i) => [39.9, +(32 + i * 0.0005).toFixed(5), 39.9, +(32 + (i + 1) * 0.0005).toFixed(5), i < 3000 ? 110 : 82]);
    const L2 = LS.createLimitSpans({ post: () => null, premium: () => true, hasHere: () => false });
    await L2.loadForRoute({ coords: [], limitSpans: longS }, { fetchHere: false });
    let allRight = true; const t0 = performance.now();
    for (let i = 0; i < 1200; i++) { const lon = 32 + i * 0.0025 + 0.0001; const x = L2.limitAt(39.90005, lon, 90); if (x?.kph !== (lon < 33.5 ? 110 : 82)) allRight = false; }
    const dt = performance.now() - t0;
    ok(`(c) 6000 kesimli rotada 1200 ardışık sorgu doğru ve hızlı (${dt.toFixed(0)} ms)`, allRight && dt < 400);
    ok('(c) pencere dışına sıçrama (geri dönüş) da bulunur', L2.limitAt(39.90005, 32.0101, 90)?.kph === 110);

    // kaynak sırası (örnek kesimlerle): HERE > Mapbox > (OSM speedLimit.js'te) > null
    let posts = 0;
    const L3 = LS.createLimitSpans({ post: () => { posts++; return resp(200, { v: 1, s: HERE_S }); }, premium: () => true, hasHere: () => true });
    const R = { coords: [[32.8, 39.9], [32.85, 39.9]], limitSpans: [[39.9, 32.8, 39.9, 32.82, 90]] };
    await L3.ensure({ active: true, limitOn: true, route: R });
    ok('(c) ensure: Premium + HERE → tek POST; geçersiz HERE kesimleri atılır', posts === 1 && L3.status().here === 1);
    ok('(c) HERE ve Mapbox ikisi de biliyorsa HERE', JSON.stringify(L3.limitAt(39.9, 32.805, 90)) === '{"kph":82,"src":"here"}');
    ok('(c) yalnızca Mapbox biliyorsa Mapbox', JSON.stringify(L3.limitAt(39.9, 32.815, 90)) === '{"kph":90,"src":"mapbox"}');
    ok('(c) hiçbiri bilmiyorsa null', L3.limitAt(39.9, 32.84, 90) === null);
    await L3.ensure({ active: true, limitOn: true, route: R }); await L3.ensure({ active: true, limitOn: true, route: R });
    ok('(c) aynı rota için yeniden POST yok', posts === 1);
    await L3.ensure({ active: true, limitOn: true, route: { ...R } });
    ok('(c) rota değişince (yeniden rota) yeni POST', posts === 2);
    await L3.ensure({ active: false, limitOn: true, route: { ...R } }); await L3.ensure({ active: true, limitOn: false, route: { ...R } });
    ok('(c) navigasyon kapalıyken ya da limit kapalıyken POST yok', posts === 2);
    const L4 = LS.createLimitSpans({ post: () => { posts++; return resp(200, { v: 1, s: HERE_S }); }, premium: () => false, hasHere: () => true });
    await L4.ensure({ active: true, limitOn: true, route: R });
    ok('(c) Premium değil → POST yok, Mapbox kesimleri de kullanılmaz', posts === 2 && L4.limitAt(39.9, 32.805, 90) === null);
    let p402 = 0;
    const L5 = LS.createLimitSpans({ post: () => { p402++; return resp(402, { error: 'here_cap' }); }, premium: () => true, hasHere: () => true });
    await L5.ensure({ active: true, limitOn: true, route: R });
    for (let i = 0; i < 5; i++) await L5.ensure({ active: true, limitOn: true, route: { ...R } });
    ok('(c) 402 sonrası yeni rotalarda bile tekrar POST yok (döngü yok), Mapbox kesimleri yine çalışır', p402 === 1 && L5.limitAt(39.9, 32.805, 90)?.src === 'mapbox' && L5.status().failed === true);

    // mapbox/route.js: maxspeed ek açıklaması → aynı kesim biçimi
    const MR = await import('../js/mapbox/route.js');
    const c5 = [[32.8, 39.9], [32.801, 39.9], [32.802, 39.9], [32.803, 39.9], [32.804, 39.9]];
    const legs = [{ annotation: { distance: [85, 85], maxspeed: [{ speed: 50, unit: 'km/h' }, { speed: 50, unit: 'km/h' }] } }, { annotation: { distance: [85, 85], maxspeed: [{ unknown: true }, { speed: 31, unit: 'mph' }] } }];
    ok('(c) maxspeedSpans: iki bacak birleşir, bilinmeyen atlanır, mph çevrilir', JSON.stringify(MR.maxspeedSpans(c5, legs)) === JSON.stringify([[39.9, 32.8, 39.9, 32.802, 50], [39.9, 32.803, 39.9, 32.804, 50]]));
    const legs2 = [{ annotation: { distance: [170, 170], maxspeed: [{ speed: 30, unit: 'km/h' }, { speed: 70, unit: 'km/h' }] } }]; // sayı uyuşmuyor: mesafeye göre eşlenir
    ok('(c) maxspeedSpans: kesim sayısı uyuşmazsa birikimli mesafeyle eşlenir', JSON.stringify(MR.maxspeedSpans(c5, legs2)) === JSON.stringify([[39.9, 32.8, 39.9, 32.802, 30], [39.9, 32.802, 39.9, 32.804, 70]]));
    ok('(c) maxspeedSpans: ek açıklama yoksa boş', JSON.stringify(MR.maxspeedSpans(c5, [{ annotation: { distance: [1, 1, 1, 1] } }])) === '[]');
    const rsrc = src('js/mapbox/route.js');
    ok('(c) route.js maxspeed yalnızca Premium: premiumAccess() ve önbellek anahtarında bayrak', /premiumAccess\(\)/.test(rsrc) && /mrt:\$\{/.test(rsrc) && rsrc.includes("'distance,congestion,maxspeed' : 'distance,congestion'"));

    // (d) speedLimit.js: gerçek modüller, sahte fetch
    const { patch, getState } = await import('../js/state.js');
    const PX = await import('../js/net/proxy.js');
    const S = await import('../js/nav/speedLimit.js');
    ls.setItem('evcp.session', JSON.stringify({ token: 'T'.repeat(30) }));
    const at = (lon, heading = 90) => patch('sim', { enabled: true, play: true, lat: 39.9, lon, speed: 60, heading });
    const run = async () => { await S.__test.check(); await S.__test.idle(); await S.__test.check(); await S.__test.idle(); };
    const lim = () => { const l = getState('nav').limit; return l ? `${l.kph}/${l.src}` : 'null'; };
    const mkRoute = () => ({ coords: [[32.8, 39.9], [32.9, 39.9]], limitSpans: [[39.9, 32.8, 39.9, 32.82, 90]] });

    // Ücretsiz kullanıcı: yalnızca OSM, /v1/speedlimits yok, Mapbox kesimleri kullanılmaz
    mode = { premium: false, here: true, sl: 'ok', osm: 70 };
    await PX.refreshCaps();
    S.__test.reset();
    patch('nav', { active: true, limitOn: true, limit: null, limitErr: null }); patch('plan', { route: mkRoute() }); at(32.805);
    let c0 = calls.length;
    await run();
    ok('(d) ücretsiz: /v1/speedlimits isteği yok, limit OSM\'den (Mapbox kesimi olsa da)', nSl() === 0 && lim() === '70/osm' && calls.slice(c0).some((u) => u.includes('/locate')));
    ok('(d) ücretsiz: durum satırında kaynak OpenStreetMap', /Kaynak: OpenStreetMap/.test(S.__test.statusText()));

    // Premium: HERE > Mapbox > OSM > null
    mode = { premium: true, here: true, sl: 'ok', osm: 70 };
    await PX.refreshCaps();
    S.__test.reset();
    patch('nav', { limit: null }); patch('plan', { route: mkRoute() }); at(32.805);
    let o0 = nOsm();
    await run();
    ok('(d) Premium: navigasyonda tek /v1/speedlimits POST', nSl() === 1);
    ok('(d) Premium: HERE kesimi varken HERE limiti, OSM sorgusu yok', lim() === '82/here' && nOsm() === o0 && S.currentLimit() === 82);
    ok('(d) durum satırı "Kaynak: HERE"', /Kaynak: HERE/.test(S.__test.statusText()));
    at(32.815); await run();
    ok('(d) HERE bilmiyor, Mapbox biliyor → Mapbox, OSM sorgusu yok', lim() === '90/mapbox' && nOsm() === o0);
    ok('(d) durum satırı "Kaynak: Mapbox"', /Kaynak: Mapbox/.test(S.__test.statusText()));
    at(32.84); await run();
    ok('(d) hiçbir kesim yok → OSM (bugünkü sorgu)', lim() === '70/osm' && nOsm() === o0 + 1);
    S.__test.reset(); mode.osm = 0; at(32.87); await run();
    ok('(d) OSM de bilmiyor → null (tahmin yok)', lim() === 'null' && S.currentLimit() === null);
    ok('(d) bu sürüşte /v1/speedlimits hâlâ tek', nSl() === 1);
    // HERE limitinden sonra bilinmeyen kesime geçince eski HERE limiti taşınmaz (OSM sorgusu sıklık sınırında olsa bile)
    at(32.805); await run();
    ok('(d) yeniden HERE kesimi → 82/here', lim() === '82/here');
    o0 = nOsm();
    at(32.875); await S.__test.check(); // son OSM sorgusu 32.87'de, < 1 km ve < 20 sn: OSM sorulmaz
    ok('(d) kesim dışına çıkınca eski HERE limiti hemen düşer (taşınmaz), OSM sıklık sınırına uyar', S.currentLimit() === null && nOsm() === o0);
    await S.__test.idle();

    // 402: OSM'e düşer, tekrar denemez (yeni rotada da)
    mode = { premium: true, here: true, sl: '402', osm: 60 };
    S.__test.reset({ spans: true });
    patch('nav', { limit: null }); patch('plan', { route: { coords: [[32.8, 39.9], [32.9, 39.9]] } }); at(32.91);
    let s0 = nSl();
    await run(); await run();
    patch('plan', { route: { coords: [[32.8, 39.9], [32.95, 39.9]] } }); at(32.93); S.__test.reset(); await run();
    ok('(d) 402: tek POST, yeni rotada da tekrar yok, limit OSM\'den', nSl() === s0 + 1 && lim() === '60/osm');
    ok('(d) 402 sonrası durum notu (toast yok)', /HERE hız limiti alınamadı/.test(S.__test.statusText({ noLimit: true })));
    patch('nav', { active: false });
    ok('(d) navigasyon bitince "HERE hız limiti alınamadı" notu kalmaz', !/HERE hız limiti alınamadı/.test(S.__test.statusText({ noLimit: true })));
    patch('nav', { active: true });
    // 500 / ağ hatası: aynı rotada tekrar yok, OSM'e düşer
    for (const bad of ['500', 'net']) {
      mode = { premium: true, here: true, sl: bad, osm: 50 };
      S.__test.reset({ spans: true });
      patch('nav', { limit: null }); patch('plan', { route: { coords: [[32.8, 39.9], [32.99, 39.9]] } }); at(bad === '500' ? 32.96 : 32.98);
      s0 = nSl();
      await run(); await run(); await run();
      ok(`(d) ${bad}: tek POST, döngü yok, limit OSM'den`, nSl() === s0 + 1 && lim() === '50/osm');
    }
    // HERE özelliği sunucuda yoksa (caps.here false): POST yok, Mapbox kesimleri çalışır
    mode = { premium: true, here: false, sl: 'ok', osm: 40 };
    await PX.refreshCaps();
    S.__test.reset({ spans: true });
    patch('nav', { limit: null }); patch('plan', { route: mkRoute() }); at(32.805);
    s0 = nSl();
    await run();
    ok('(d) sunucuda HERE yok: POST yok, Mapbox kesimi kullanılır', nSl() === s0 && lim() === '90/mapbox');

    // Düzeltme 2: Mapbox maxspeed yalnızca Premium; ücretsiz istek/yanıt v0.81 ile birebir; önbellek planlara göre ayrı
    {
      const enc6 = (pts) => { let o = '', pa = 0, pb = 0; const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s2 = ''; while (v >= 0x20) { s2 += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s2 + String.fromCharCode(v + 63); }; for (const [la, lo] of pts) { const A2 = Math.round(la * 1e6), B2 = Math.round(lo * 1e6); o += e(A2 - pa) + e(B2 - pb); pa = A2; pb = B2; } return o; };
      const mbCalls = [];
      const MB_JSON = { routes: [{ geometry: enc6([[39.9, 32.8], [39.9, 32.801], [39.9, 32.802]]), distance: 170, duration: 20, duration_typical: 20, legs: [{ steps: [], annotation: { distance: [85, 85], congestion: ['low', 'low'], maxspeed: [{ speed: 82, unit: 'km/h' }, { speed: 82, unit: 'km/h' }] } }] }] };
      const prevFetch = globalThis.fetch;
      def('fetch', (url, init) => { const u2 = String(url); if (u2.startsWith('https://api.mapbox.com/directions/')) { mbCalls.push(u2); return resp(200, MB_JSON); } return prevFetch(url, init); });
      const MBK = 'pk.test-dummy-mapbox-0123456789.abcdefghij0123';
      ls.setItem('evcp.mbKey', JSON.stringify(MBK));
      const A0 = { lat: 39.9, lon: 32.8 }, B0 = { lat: 39.9, lon: 32.802 };
      mode = { premium: false, here: true, sl: 'ok', osm: 40 }; await PX.refreshCaps();
      const free = await MR.fetchRoute(A0, B0);
      const oldQ = new URLSearchParams({ geometries: 'polyline6', overview: 'full', steps: 'true', roundabout_exits: 'true', alternatives: 'false', annotations: 'distance,congestion' });
      oldQ.set('access_token', MBK);
      const oldUrl = 'https://api.mapbox.com/directions/v5/mapbox/driving-traffic/32.800000,39.900000;32.802000,39.900000?' + oldQ;
      ok('(c) ücretsiz: Mapbox isteği v0.81 ile birebir (maxspeed yok)', mbCalls.length === 1 && mbCalls[0] === oldUrl);
      ok('(c) ücretsiz: sonuçta limitSpans alanı yok (eski yanıt biçimi)', !('limitSpans' in free) && JSON.stringify(Object.keys(free)) === '["coords","intervals","distanceKm","durationH","trafficRatio","trafficSpans","live","steps"]');
      mode = { premium: true, here: true, sl: 'ok', osm: 40 }; await PX.refreshCaps();
      const prem = await MR.fetchRoute(A0, B0);
      ok('(c) Premium: aynı rota ücretsiz önbellekten verilmez, yeni istek maxspeed ister', mbCalls.length === 2 && /annotations=distance%2Ccongestion%2Cmaxspeed/.test(mbCalls[1]));
      ok('(c) Premium: sonuçta limitSpans (82)', JSON.stringify(prem.limitSpans) === '[[39.9,32.8,39.9,32.802,82]]');
      mode = { premium: false, here: true, sl: 'ok', osm: 40 }; await PX.refreshCaps();
      const free2 = await MR.fetchRoute(A0, B0);
      ok('(c) ücretsize geri dönünce Premium önbelleği verilmez (ücretsiz kayıt kendi önbelleğinden)', mbCalls.length === 2 && !('limitSpans' in free2));
      ls.removeItem('evcp.mbKey');
      def('fetch', prevFetch);
    }

    // i18n ve sw.js
    const kx = JSON.parse(src('i18n/keys.extra.json'));
    const NEW = ['Bu yolun hız limiti: {0} km/s · Kaynak: {1}', 'HERE hız limiti alınamadı; OpenStreetMap kullanılıyor (etiketi olmayan yolda bilinmez)', 'Yol hız limiti sürerken okunur (Premium: HERE; yoksa Mapbox, o da yoksa OpenStreetMap)', 'Yol hız limiti kontrolü açık (Premium: HERE, yedek OpenStreetMap)'];
    const dicts = await Promise.all(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'ro', 'bg', 'el'].map(async (c) => (await import(`../js/i18n/lang/${c}.extra.js`)).default));
    ok('i18n: yeni hız limiti metinleri ek sözlükte ve 11 dilde', NEW.every((k) => kx.includes(k)) && dicts.every((dd) => NEW.every((k) => typeof dd[k] === 'string' && dd[k].trim())));
    ok("sw.js SHELL './js/nav/limitSpans.js' içerir", src('sw.js').includes("'./js/nav/limitSpans.js'"));
  } catch (e) {
    ok('Bölüm 9 (c/d) çalıştı: ' + e.message + ' ' + (e.stack || '').split('\n')[1], false);
  } finally {
    for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
}

// ---- Bölüm 10: Yönetim TOTP ikinci adımı (ADMIN_TOTP_SECRET, /admin/auth, /admin/login, X-Admin-Token, yerel CLI muafiyeti, kilit, kurulum betiği) ----
// Gizli anahtar olarak RFC 6238'in herkese açık test anahtarı kullanılır ("12345678901234567890"); gerçek anahtar/kod yok. Sunucular 8787 DIŞINDA,
// geçici DATA_DIR ile alt süreç olarak çalışır; kurulum betiği yalnızca geçici bir env dosyasına (--env) yazar. Çıktıda anahtar/belirteç yazdırılmaz.
{
  const { spawnSync } = await import('node:child_process');
  const { readFileSync, existsSync } = await import('node:fs');
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const CODE = 'test-dummy-access-code-0123456789';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let T = null;
  try { T = await import('../server/totp.mjs'); } catch (e) { ok('Bölüm 10: server/totp.mjs yüklenir (' + e.code + ')', false); }

  // (a) birim: base32, RFC 6238 vektörleri, pencere, tekrar oynatma, belirteç, kilit (enjekte saat)
  if (T) {
    try {
      const key = T.base32Decode(SECRET);
      ok('(10a) base32 çözümü RFC anahtarı', key?.toString('ascii') === '12345678901234567890');
      ok('(10a) base32 kodlama geri döner', T.base32Encode(Buffer.from('12345678901234567890')) === SECRET);
      ok('(10a) RFC 6238 SHA-1 T=59 → 287082', T.totpAt(key, 59) === '287082');
      ok('(10a) RFC 6238 SHA-1 T=1111111109 → 081804', T.totpAt(key, 1111111109) === '081804');
      ok('(10a) RFC 6238 SHA-1 T=1234567890 → 005924', T.totpAt(key, 1234567890) === '005924');
      ok('(10a) RFC 6238 SHA-1 T=1111111111/2000000000/20000000000', T.totpAt(key, 1111111111) === '050471' && T.totpAt(key, 2000000000) === '279037' && T.totpAt(key, 20000000000) === '353130');
      ok('(10a) base32: küçük harf ve boşluk kabul', T.base32Decode(SECRET.toLowerCase().replace(/(.{4})/g, '$1 '))?.equals(key));
      ok('(10a) base32: geçersiz karakter (0/1/8/!) red', ['GEZDGNBVGY3TQOJ0', 'GEZDGNBVGY3TQOJ1', 'GEZDGNBVGY3TQOJ8', 'GEZDGNBV!Y3TQOJQ'].every((s) => T.base32Decode(s) === null));
      ok('(10a) base32: geçersiz uzunluk red (1/3/6 karakter)', ['M', 'MYM', 'MZXW6Y'].every((s) => T.base32Decode(s) === null));
      ok('(10a) base32: artık bitler sıfır değilse red (MZ), sıfırsa kabul (MY)', T.base32Decode('MZ') === null && T.base32Decode('MY')?.toString() === 'f');
      ok('(10a) base32: doğru dolgu kabul, yanlış dolgu red', T.base32Decode('MY======')?.toString() === 'f' && T.base32Decode('MY=') === null && T.base32Decode('M=Y') === null);
      ok('(10a) parseSecret: boş/tanımsız/kısa (<16 bayt) → null, RFC anahtarı 20 bayt', T.parseSecret('') === null && T.parseSecret(undefined) === null && T.parseSecret('MY') === null && T.parseSecret(SECRET)?.length === 20);
      ok('(10a) createAdminAuth: geçersiz/boş anahtar → null (TOTP kapalı)', T.createAdminAuth('') === null && T.createAdminAuth('NOT*BASE32') === null && T.createAdminAuth(undefined) === null);

      let clock = 1111111109 * 1000;
      const mk = (o = {}) => T.createAdminAuth(SECRET, { now: () => clock, ...o });
      const at = (s) => T.totpAt(key, s);
      ok('(10a) şimdiki adımın kodu kabul', mk().matchTotp('081804') !== null);
      ok('(10a) pencere: -1 ve +1 adım kabul', mk().matchTotp(at(1111111109 - 30)) !== null && mk().matchTotp(at(1111111109 + 30)) !== null);
      ok('(10a) pencere: -2 ve +2 adım red', mk().matchTotp(at(1111111109 - 60)) === null && mk().matchTotp(at(1111111109 + 60)) === null);
      ok('(10a) biçim: 5/7 hane, harf, sayı türü red; boşluklu "081 804" kabul', ['08180', '0818045', 'abcdef', '08180a', '', null].every((c) => mk().matchTotp(c) === null) && mk().matchTotp(81804) === null && mk().matchTotp('081 804') !== null);
      {
        const a = mk();
        const st = a.matchTotp('081804');
        ok('(10a) matchTotp kodu tüketmez (tekrar çağrı yine eşleşir)', st !== null && a.matchTotp('081804') === st);
        a.consume(st);
        ok('(10a) tekrar oynatma: kullanılan adımın kodu red', a.matchTotp('081804') === null);
        ok('(10a) tekrar oynatma: daha eski adımın kodu da red, sonraki adım kabul', a.matchTotp(at(1111111109 - 30)) === null && a.matchTotp(at(1111111109 + 30)) !== null);
      }
      {
        const a = mk({ ttlMs: 1000 });
        const { token, expiresAt } = a.issueToken();
        ok('(10a) belirteç 32 bayt base64url, bitiş = şimdi + TTL', /^[A-Za-z0-9_-]{43}$/.test(token) && expiresAt === clock + 1000);
        ok('(10a) belirteç geçerli; bozuk/yanlış belirteç geçersiz', a.tokenValid(token) && !a.tokenValid(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')) && !a.tokenValid('') && !a.tokenValid(undefined) && !a.tokenValid(token + 'x'));
        const t2 = a.issueToken().token;
        a.revoke(t2);
        ok('(10a) revoke: çıkış yapılan belirteç geçersiz, diğeri geçerli', !a.tokenValid(t2) && a.tokenValid(token));
        clock += 1000;
        ok('(10a) TTL dolunca belirteç geçersiz', !a.tokenValid(token));
        clock = 1111111109 * 1000;
      }
      {
        const a = mk();
        const toks = Array.from({ length: 21 }, () => a.issueToken().token);
        ok('(10a) en çok 20 canlı belirteç: 21.de en eskisi düşer', !a.tokenValid(toks[0]) && a.tokenValid(toks[1]) && a.tokenValid(toks[20]) && a.stats().tokens === 20);
      }
      {
        const a = mk();
        for (let i = 0; i < 4; i++) a.fail('1.1.1.1');
        ok('(10a) kilit: 4 yanlış → hâlâ açık', a.gate('1.1.1.1') === 0);
        a.fail('1.1.1.1');
        const w = a.gate('1.1.1.1');
        ok('(10a) kilit: 5. yanlışta adres 1 saat kapalı', w === 3600 && a.gate('2.2.2.2') === 0);
        clock += 3600e3 + 1000;
        ok('(10a) kilit: 1 saat sonra açılır', a.gate('1.1.1.1') === 0);
        clock = 1111111109 * 1000;
      }
      {
        const a = mk();
        for (let i = 0; i < 4; i++) a.fail('3.3.3.3');
        a.success('3.3.3.3');
        for (let i = 0; i < 4; i++) a.fail('3.3.3.3');
        ok('(10a) başarılı giriş adresin sayacını sıfırlar', a.gate('3.3.3.3') === 0);
      }
      {
        const a = mk();
        for (let i = 0; i < 24; i++) a.fail('10.0.0.' + i);
        ok('(10a) genel sınır: 24 yanlış (farklı adresler) → açık', a.gate('9.9.9.9') === 0);
        a.fail('10.0.1.1');
        ok('(10a) genel sınır: 25. yanlışta tüm adreslere 10 dk 429', a.gate('9.9.9.9') === 600);
        clock += 600e3 + 1000;
        ok('(10a) genel sınır: 10 dk sonra açılır', a.gate('9.9.9.9') === 0);
        clock = 1111111109 * 1000;
      }
    } catch (e) {
      ok('Bölüm 10 (a) çalıştı: ' + e.message, false);
    }
  }

  // (b) sunucu: alt süreçler (18781-18785)
  const children = [], dirs = [], logs = [], responses = [], tokensSeen = [];
  async function start(port, extra = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'totp-test-')); dirs.push(dir);
    writeFileSync(join(dir, 'db.json'), JSON.stringify({ users: {}, invites: {}, docs: {}, sessions: {} }));
    const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'MAPBOX_MAP_TOKEN', 'GOOGLE_MAP_ID', 'MAP_DAILY_PER_USER', 'MAP_DAILY_TOTAL', 'TRUST_PROXY', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'ADMIN_TOKEN_TTL_SEC'].map((k) => [k, '']));
    const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, env: { ...process.env, ...blank, PREMIUM_REQUIRED: '1', PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let out = ''; logs.push(() => out);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await sleep(100);
    if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı');
    const call = async (method, path, { headers = {}, body, raw } = {}) => {
      const h = { ...headers };
      if (body !== undefined || raw !== undefined) h['Content-Type'] = 'application/json';
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let j = null; try { j = JSON.parse(text); } catch {}
      responses.push({ path, text, login: path === '/admin/login' && r.status === 200 });
      return { status: r.status, text, json: j, headers: r.headers };
    };
    return { call, log: () => out };
  }
  const XFF = { 'X-Forwarded-For': '203.0.113.5' };
  const C = { 'X-Access-Code': CODE };
  const key = T?.base32Decode(SECRET);
  const nowCode = (d = 0) => T.hotp(key, Math.floor(Date.now() / 30000) + d);
  const wrongCode = () => { const w = new Set([-1, 0, 1].map(nowCode)); let c = 0; while (w.has(String(c).padStart(6, '0'))) c++; return String(c).padStart(6, '0'); };
  const untilSafe = async () => { const r = Date.now() % 30000; if (r > 24000) await sleep(30000 - r + 300); }; // adım sınırına yakınsa yeni adımı bekle
  const login = (S, ip, body) => S.call('POST', '/admin/login', { headers: ip ? { 'X-Forwarded-For': ip } : {}, body });

  if (T) try {
    let r, r2, r3, r4;
    // --- TOTP açık (TRUST_PROXY=1: adres X-Forwarded-For'dan, kilit adres başına denenebilsin) ---
    const S = await start(18781, { ADMIN_TOTP_SECRET: SECRET, TRUST_PROXY: '1' });
    r = await S.call('GET', '/admin/auth');
    ok('(10b) GET /admin/auth (kimliksiz) → {totp:true}', r.status === 200 && r.text === '{"totp":true}');
    r = await S.call('GET', '/admin/summary', { headers: { ...C, ...XFF } });
    ok('(10b) dış istek (X-Forwarded-For) yalnızca kodla /admin/summary → 401 totp_required', r.status === 401 && r.json?.error === 'totp_required');
    r = await S.call('GET', '/admin/summary', { headers: C });
    ok('(10b) yerel istek (vekil başlığı yok) kodla /admin/summary → 200 (CLI muafiyeti)', r.status === 200 && !!r.json?.users);
    const PH = { Forwarded: 'for=203.0.113.5', 'X-Real-IP': '203.0.113.5', 'CF-Connecting-IP': '203.0.113.5', Via: '1.1 caddy', 'X-Forwarded-Host': 'evcopilot.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '' };
    const ph = [];
    for (const [k, v] of Object.entries(PH)) ph.push((await S.call('GET', '/admin/summary', { headers: { ...C, [k]: v } })).json?.error === 'totp_required');
    ok('(10b) her vekil başlığı (Forwarded, X-Real-IP, CF-Connecting-IP, Via, X-Forwarded-Host/Proto, boş XFF) isteği yerel saymaz', ph.every(Boolean));
    r = await S.call('GET', '/admin/users', { headers: { ...C, ...XFF } });
    r2 = await S.call('POST', '/admin/invites', { headers: { ...C, ...XFF }, body: { label: 'x' } });
    r3 = await S.call('POST', '/admin/restart', { headers: { ...C, ...XFF } });
    r4 = await S.call('GET', '/admin/devices', { headers: { ...C, ...XFF } });
    ok('(10b) diğer /admin/* (users, invites, restart, devices) dışarıdan kodla → 401 totp_required', [r, r2, r3, r4].every((x) => x.status === 401 && x.json?.error === 'totp_required'));
    r = await S.call('GET', '/health', { headers: { ...C, ...XFF } });
    r2 = await S.call('GET', '/v1/map/config', { headers: { ...C, ...XFF } });
    ok('(10b) uygulama yolları (/health, /v1/map/config) dışarıdan kodla yine 200', r.status === 200 && r2.status === 200);
    r = await login(S, '198.51.100.7', { code: CODE, totp: wrongCode() });
    ok('(10b) giriş: yanlış TOTP → 401 kod yanlış', r.status === 401 && r.text === '{"error":"kod yanlış"}');
    await untilSafe();
    const keep = nowCode(0);
    r2 = await login(S, '198.51.100.7', { code: CODE + 'x', totp: keep });
    ok('(10b) giriş: yanlış erişim kodu + doğru TOTP → aynı genel mesaj (hangi adımın yanlış olduğu belli olmaz)', r2.status === 401 && r2.text === r.text);
    r = await login(S, '198.51.100.8', { code: CODE, totp: 'abcdef' });
    ok('(10b) giriş: rakam olmayan TOTP → 401', r.status === 401 && r.json?.error === 'kod yanlış');
    r = await S.call('POST', '/admin/login', { headers: { 'X-Forwarded-For': '198.51.100.9' }, raw: '{"code":' });
    r2 = await S.call('POST', '/admin/login', { headers: { 'X-Forwarded-For': '198.51.100.9' }, raw: '[1,2]' });
    ok('(10b) giriş: bozuk JSON ve dizi gövde → 400', r.status === 400 && r2.status === 400);
    r = await S.call('POST', '/admin/login', { headers: { 'X-Forwarded-For': '198.51.100.9' }, raw: JSON.stringify({ code: CODE, totp: '000000', pad: 'x'.repeat(3000) }) });
    ok('(10b) giriş: büyük gövde → 413', r.status === 413);
    r = await S.call('GET', '/admin/login', { headers: { 'X-Forwarded-For': '198.51.100.9' } });
    ok('(10b) GET /admin/login → 405', r.status === 405);
    r = await login(S, '198.51.100.10', { code: CODE, totp: keep });
    const tok = r.json?.token;
    if (tok) tokensSeen.push(tok);
    ok('(10b) giriş başarılı: {token, expiresAt} (32 bayt base64url, ~12 sa) — yanlış erişim kodlu deneme kodu tüketmedi', r.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(tok || '') && Math.abs(r.json.expiresAt - (Date.now() + 12 * 3600e3)) < 60e3 && JSON.stringify(Object.keys(r.json)) === '["token","expiresAt"]');
    r = await login(S, '198.51.100.10', { code: CODE, totp: keep });
    ok('(10b) tekrar oynatma: aynı geçerli kod ikinci kez → 401', r.status === 401 && r.json?.error === 'kod yanlış');
    const T1 = { 'X-Admin-Token': tok, ...XFF };
    r = await S.call('GET', '/admin/summary', { headers: T1 });
    r2 = await S.call('GET', '/admin/users', { headers: T1 });
    r3 = await S.call('POST', '/admin/map', { headers: T1, body: { default: 'osm' } });
    ok('(10b) X-Admin-Token + X-Forwarded-For → /admin/summary, /admin/users, POST /admin/map 200', r.status === 200 && !!r.json?.users && r2.status === 200 && r3.status === 200);
    r = await S.call('GET', '/health', { headers: T1 });
    ok('(10b) belirteç uygulama yollarını açmaz (/health → 401)', r.status === 401);
    r = await S.call('GET', '/admin/summary', { headers: { 'X-Admin-Token': 'A'.repeat(43), ...XFF } });
    r2 = await S.call('GET', '/admin/summary', { headers: { 'X-Admin-Token': tok + 'x', ...XFF } });
    ok('(10b) geçersiz belirteç → 401', r.status === 401 && r2.status === 401);
    r = await login(S, '198.51.100.10', { code: CODE, totp: nowCode(1) });
    if (r.json?.token) tokensSeen.push(r.json.token);
    ok('(10b) sonraki adımın kodu (+1) kabul, yeni belirteç farklı', r.status === 200 && r.json?.token && r.json.token !== tok);
    const tok2 = r.json?.token;
    r = await S.call('POST', '/admin/logout', { headers: { 'X-Admin-Token': tok2, ...XFF } });
    r2 = await S.call('GET', '/admin/summary', { headers: { 'X-Admin-Token': tok2, ...XFF } });
    r3 = await S.call('GET', '/admin/summary', { headers: T1 });
    ok('(10b) POST /admin/logout belirteci sunucuda geçersiz kılar (diğer belirteç etkilenmez)', r.status === 200 && r2.status === 401 && r3.status === 200);
    // adres kilidi: 5 yanlış → 1 saat 429
    const L = '192.0.2.44';
    const lk = [];
    for (let i = 0; i < 5; i++) lk.push((await login(S, L, { code: CODE, totp: wrongCode() })).status);
    r = await login(S, L, { code: CODE, totp: nowCode(0) });
    const ra = Number(r.headers.get('retry-after'));
    ok('(10b) kilit: 5 yanlış (401) → 6. deneme 429, Retry-After ≈ 3600', lk.every((s) => s === 401) && r.status === 429 && ra > 3500 && ra <= 3600);
    r = await login(S, '192.0.2.45', { code: CODE, totp: wrongCode() });
    ok('(10b) kilit yalnızca o adresi etkiler (başka adres → 401, 429 değil)', r.status === 401);
    r = await S.call('GET', '/admin/summary', { headers: { 'X-Admin-Token': tok, 'X-Forwarded-For': L } });
    ok('(10b) giriş kilidi geçerli belirteci ve eski 10/10 kilidini etkilemez', r.status === 200);
    ok('(10b) açılış günlüğü TOTP açık der', /TOTP açık/.test(S.log()));

    // --- genel sınır: 7 adres × 4 yanlış = 28 → 25.den sonra herkese 429 ---
    const G = await start(18782, { ADMIN_TOTP_SECRET: SECRET, TRUST_PROXY: '1' });
    const gs = [];
    for (let a = 0; a < 7; a++) for (let i = 0; i < 4; i++) gs.push((await login(G, '10.1.0.' + a, { code: CODE, totp: wrongCode() })).status);
    r = await login(G, '10.9.9.9', { code: CODE, totp: nowCode(0) });
    const gra = Number(r.headers.get('retry-after'));
    ok('(10b) genel sınır: ilk 25 yanlış 401, sonrası 429; yeni adrese de 429 (Retry-After ≈ 600)', gs.slice(0, 25).every((s) => s === 401) && gs.slice(25).every((s) => s === 429) && r.status === 429 && gra > 500 && gra <= 600);
    r = await G.call('GET', '/admin/summary', { headers: C });
    ok('(10b) genel giriş sınırı yerel CLI erişimini etkilemez', r.status === 200);

    // --- belirteç süresi (ADMIN_TOKEN_TTL_SEC=1) ---
    const E = await start(18783, { ADMIN_TOTP_SECRET: SECRET, ADMIN_TOKEN_TTL_SEC: '1' });
    await untilSafe();
    r = await login(E, null, { code: CODE, totp: nowCode(0) });
    const et = r.json?.token;
    if (et) tokensSeen.push(et);
    r2 = await E.call('GET', '/admin/summary', { headers: { 'X-Admin-Token': et, ...XFF } });
    await sleep(1300);
    r3 = await E.call('GET', '/admin/summary', { headers: { 'X-Admin-Token': et, ...XFF } });
    ok('(10b) belirteç süresi: TTL içinde 200, dolunca 401', r.status === 200 && r2.status === 200 && r3.status === 401);

    // --- TOTP kapalı (tanımsız) ve geçersiz anahtar: bugünkü davranış ---
    const U = await start(18784, {});
    r = await U.call('GET', '/admin/auth');
    r2 = await U.call('GET', '/admin/summary', { headers: { ...C, ...XFF } });
    r3 = await U.call('POST', '/admin/login', { body: { code: CODE, totp: '000000' } });
    ok('(10b) ADMIN_TOTP_SECRET yok → /admin/auth {totp:false}, dışarıdan kodla /admin/summary 200, /admin/login eskisi gibi (401 giriş gerekli)', r.text === '{"totp":false}' && r2.status === 200 && r3.status === 401 && r3.json?.error === 'giriş gerekli');
    ok('(10b) ADMIN_TOTP_SECRET yok → açılış günlüğünde TOTP sözü yok', !/TOTP/.test(U.log()));
    const BAD = 'NOT*BASE32*SECRET';
    const V = await start(18785, { ADMIN_TOTP_SECRET: BAD });
    r = await V.call('GET', '/admin/auth');
    r2 = await V.call('GET', '/admin/summary', { headers: { ...C, ...XFF } });
    ok('(10b) geçersiz ADMIN_TOTP_SECRET → TOTP kapalı (bugünkü davranış) ve uyarı, değer yazılmaz', r.text === '{"totp":false}' && r2.status === 200 && /ADMIN_TOTP_SECRET geçersiz/.test(V.log()) && !V.log().includes(BAD));
  } catch (e) {
    ok('Bölüm 10 (b) çalıştı: ' + e.message, false);
  } finally {
    for (const c of children) { try { c.kill(); } catch {} }
    await sleep(300);
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
  }
  if (T) {
    const allLogs = logs.map((f) => f()).join('\n');
    ok('(10b) sunucu çıktısında TOTP anahtarı ve belirteç yok', logs.length >= 5 && !allLogs.includes(SECRET) && tokensSeen.length >= 3 && tokensSeen.every((t) => !allLogs.includes(t)));
    ok('(10b) hiçbir yanıtta anahtar yok; belirteç yalnızca giriş yanıtında', responses.length > 20 && responses.every((x) => !x.text.includes(SECRET)) && tokensSeen.every((t) => responses.filter((x) => x.text.includes(t)).every((x) => x.login)));
  }

  // (c) admin.html içerik denetimi
  {
    const html = readFileSync(fileURLToPath(new URL('../server/admin.html', import.meta.url)), 'utf8');
    ok("(10c) admin.html '/admin/auth' ve '/admin/login' çağırır", html.includes("'/admin/auth'") && html.includes("'/admin/login'"));
    ok('(10c) admin.html ikinci alan "Doğrulama kodu (6 hane)"', html.includes('Doğrulama kodu (6 hane)'));
    const inp = /<input[^>]*id="totp"[^>]*>/.exec(html)?.[0] || '';
    ok('(10c) TOTP alanı: inputmode numeric, autocomplete one-time-code, maxlength 6', /inputmode="numeric"/.test(inp) && /autocomplete="one-time-code"/.test(inp) && /maxlength="6"/.test(inp));
    ok('(10c) admin.html X-Admin-Token gönderir ve adm_t oturum anahtarını kullanır', html.includes("'X-Admin-Token'") && html.includes("'adm_t'"));
    ok("(10c) admin.html Çıkış'ta '/admin/logout' çağırır", html.includes("'/admin/logout'"));
    ok('(10c) süre dolunca mesaj: "Oturum süresi doldu, tekrar giriş yap"', html.includes('Oturum süresi doldu, tekrar giriş yap'));
    ok('(10c) TOTP açıkken erişim kodu saklanmaz (adm yalnızca !TOTP dalında yazılır, açılışta silinir)', /if \(!TOTP\)[^\n]*sessionStorage\.setItem\('adm',/.test(html) && (html.match(/sessionStorage\.setItem\('adm',/g) || []).length === 1 && html.includes("sessionStorage.removeItem('adm')"));
    ok('(10c) admin.html innerHTML / outerHTML / insertAdjacentHTML / document.write kullanmaz', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
  }

  // (d) kurulum betiği: yalnızca geçici env dosyası (--env), sahte erişim kodu; çıktı yakalanır, yazdırılmaz
  {
    const dir = mkdtempSync(join(tmpdir(), 'totp-setup-'));
    try {
      const envFile = join(dir, 'test.env');
      const orig = `# deneme\r\nACCESS_CODES=${CODE}\r\nPORT=18999\r\n`;
      writeFileSync(envFile, orig);
      const run = (...args) => spawnSync(process.execPath, ['server/totp-setup.mjs', '--env', envFile, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
      let p = run();
      const txt = readFileSync(envFile, 'utf8');
      const sec = /^ADMIN_TOTP_SECRET=([A-Z2-7]+)\r$/m.exec(txt)?.[1] || '';
      ok('(10d) kurulum: çıkış 0, ADMIN_TOTP_SECRET 32 karakter base32 (20 bayt)', p.status === 0 && sec.length === 32 && T?.base32Decode(sec)?.length === 20);
      ok('(10d) kurulum: diğer satırlar ve CRLF korunur', txt.startsWith(orig) && !/[^\r]\n/.test(txt));
      ok('(10d) kurulum: yedek dosyası eski içerikle', existsSync(envFile + '.totp-yedek') && readFileSync(envFile + '.totp-yedek', 'utf8') === orig);
      const uri = `otpauth://totp/EV%20Co-Pilot%20Y%C3%B6netim?secret=${sec}&issuer=EV%20Co-Pilot&algorithm=SHA1&digits=6&period=30`;
      ok('(10d) çıktı: otpauth URI (aynı anahtar) ve 4\'lü gruplar', !!sec && p.stdout.includes(uri) && p.stdout.includes(sec.match(/.{4}/g).join(' ')));
      ok('(10d) çıktı: Microsoft Authenticator adımları (Diğer hesap, Kodu el ile gir) ve kapatma yolu', p.stdout.includes('Microsoft Authenticator') && p.stdout.includes('Diğer hesap') && p.stdout.includes('Kodu el ile gir') && /sil/.test(p.stdout));
      ok('(10d) çıktı erişim kodunu içermez', !p.stdout.includes(CODE) && !p.stderr.includes(CODE));
      p = run();
      ok('(10d) --force olmadan mevcut anahtar üzerine yazılmaz (çıkış ≠ 0, dosya aynı, anahtar yazdırılmaz)', p.status !== 0 && readFileSync(envFile, 'utf8') === txt && !p.stdout.includes(sec) && !p.stderr.includes(sec));
      p = run('--force');
      const txt2 = readFileSync(envFile, 'utf8');
      const sec2 = /^ADMIN_TOTP_SECRET=([A-Z2-7]+)\r$/m.exec(txt2)?.[1] || '';
      ok('(10d) --force yeni anahtar yazar (tek satır, farklı), yedek önceki içerik', p.status === 0 && sec2.length === 32 && sec2 !== sec && (txt2.match(/^ADMIN_TOTP_SECRET=/gm) || []).length === 1 && readFileSync(envFile + '.totp-yedek', 'utf8') === txt);
      const env2 = join(dir, 'empty.env');
      writeFileSync(env2, `ACCESS_CODES=${CODE}\nADMIN_TOTP_SECRET=\nPORT=1\n`);
      p = spawnSync(process.execPath, ['server/totp-setup.mjs', '--env', env2], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
      const t3 = readFileSync(env2, 'utf8').split('\n');
      ok('(10d) boş ADMIN_TOTP_SECRET= satırı --force gerekmeden yerinde doldurulur (LF korunur)', p.status === 0 && t3.length === 4 && /^ADMIN_TOTP_SECRET=[A-Z2-7]{32}$/.test(t3[1]) && t3[2] === 'PORT=1');
    } catch (e) {
      ok('Bölüm 10 (d) çalıştı: ' + e.message, false);
    } finally {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
