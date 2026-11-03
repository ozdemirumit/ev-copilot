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

  // Sahte kütüphane: maps[] oluşturulan haritaları tutar; cfg.autoLoad=false ise 'load' kendiliğinden gelmez.
  function fakeLib(cfg = { autoLoad: true }) {
    const maps = [];
    class Map {
      constructor(opts) {
        this.opts = opts; this.handlers = {}; this.controls = []; this.sources = {}; this.layers = []; this.styles = [opts.style];
        this.removed = false; this.installs = 0;
        maps.push(this);
        if (cfg.autoLoad) setTimeout(() => this.fire('load'), 0);
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
      addLayer(l, before) { this.layers.push(l.id); }
      setLayoutProperty() {}
      // Gerçek kütüphane gibi: stil değişince kaynak/katmanlar silinir, 'style.load' daha sonra (eşzamansız) gelir
      setStyle(style, o) { this.styles.push(style); this.lastStyleOpts = o; this.sources = {}; this.layers = []; setTimeout(() => this.fire('style.load'), 5); }
      remove() { this.removed = true; }
      getCanvas() { return { style: {} }; }
    }
    class AttributionControl { constructor(o) { this.o = o; } }
    class Marker {}
    return { Map, AttributionControl, Marker, maps, accessToken: null };
  }
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
    const METHODS = ['setSatellite', 'marker', 'traffic', 'line', 'fit', 'moveTo', 'onClick', 'onDragStart', 'cursor', 'resize', 'bearing', 'installLayers'];

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

  // Sahte DOM öğesi (append/remove/replaceChildren/style/title)
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

  // Sahte google.maps: maps[] ve polylines[] oluşturulanları tutar; cfg.autoIdle=false ise 'idle' kendiliğinden gelmez.
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

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
