// Harita sağlayıcısı seçimi testleri (bağımlılıksız, düz node): node scripts/test-map-provider.mjs
// Bölümler görev görev eklenir; her kontrol ok(ad, koşul) ile yazdırılır. Gerçek anahtar kullanılmaz (yalnızca sahte değerler).
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
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
