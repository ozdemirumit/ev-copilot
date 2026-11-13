// Sağlayıcı politika/yetenek kaydı testleri (bağımlılıksız, düz node): node scripts/test-provider-policy.mjs
// Modül saf ve salt okunurdur: ağ, anahtar, ortam değişkeni yok. Çalışma zamanına henüz bağlı değildir.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); }
}

// Ağ engeli: modül yüklenirken ya da çağrılırken fetch kullanılırsa sayılır.
let fetchCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = () => { fetchCalls++; throw new Error('ağ yasak'); };

const P = await import('../server/providerPolicy.mjs');
const { PROVIDER_IDS, CAPABILITIES, LICENSE_STATUSES, getProvider, listProviders, isCombinationAllowed, evaluate, resolvePolicy, attributionFor } = P;

// ---- Kayıt yapısı ----
ok('sağlayıcılar osm/tomtom/here', JSON.stringify(PROVIDER_IDS) === '["osm","tomtom","here"]');
ok('yetenekler map/route/data', JSON.stringify(CAPABILITIES) === '["map","route","data"]');
ok('lisans durumları yalnızca unverified|approved', JSON.stringify(LICENSE_STATUSES) === '["unverified","approved"]');
for (const p of listProviders()) {
  ok(`${p.id}: licenseStatus geçerli`, LICENSE_STATUSES.includes(p.licenseStatus));
  ok(`${p.id}: provenance dolu`, typeof p.provenance === 'string' && p.provenance.length > 0);
  ok(`${p.id}: atıf zorunlu ve metinli`, p.attribution?.required === true && typeof p.attribution.text === 'string' && p.attribution.text.length > 0);
  ok(`${p.id}: kayıt dondurulmuş`, Object.isFrozen(p) && Object.isFrozen(p.capabilities) && Object.isFrozen(p.attribution) && Object.isFrozen(p.enabledByDefault));
}
ok('PROVIDER_IDS dondurulmuş', Object.isFrozen(PROVIDER_IDS));
ok('bilinmeyen sağlayıcı → null', getProvider('mapbox') === null && getProvider('google') === null && getProvider('') === null && getProvider(undefined) === null);
{
  let threw = false;
  try { 'use strict'; getProvider('here').licenseStatus = 'approved'; } catch { threw = true; }
  ok('HERE kaydı dışarıdan değiştirilemez', threw && getProvider('here').licenseStatus === 'unverified');
}

// ---- HERE: hukuki onay asla ileri sürülmez, varsayılan kapalı ----
const here = getProvider('here');
ok('HERE licenseStatus unverified', here.licenseStatus === 'unverified');
ok('HERE map/route varsayılan kapalı', here.enabledByDefault.map === false && here.enabledByDefault.route === false);
ok('HERE data varsayılan kapalı (politika kaydında)', here.enabledByDefault.data === false);
ok('HERE Premium katmanı', here.tier === 'premium');
ok('TomTom licenseStatus unverified', getProvider('tomtom').licenseStatus === 'unverified');
ok('TomTom Premium katmanı', getProvider('tomtom').tier === 'premium');
ok('OSM Free katmanı', getProvider('osm').tier === 'free');
{
  const r = evaluate({ plan: 'premium', map: 'here', route: 'here' });
  ok('Premium + HERE harita/rota (varsayılan) → izin yok', r.allowed === false && r.reasons.includes('here:map:disabled') && r.reasons.includes('here:route:disabled'));
}
{
  // Yapılandırma HERE'yi açsa bile lisans doğrulanmadığı için izin verilmez; yapılandırma lisans durumunu değiştiremez.
  const pol = resolvePolicy({ enable: { here: { map: true, route: true, data: true } }, licenseStatus: { here: 'approved' } });
  ok('yapılandırma licenseStatus’u yükseltemez', pol.getProvider('here').licenseStatus === 'unverified');
  ok('yapılandırma HERE’yi açabilir (yalnızca etkinlik bayrağı)', pol.getProvider('here').enabled.map === true);
  const r = pol.evaluate({ plan: 'premium', map: 'here', route: 'here', data: 'here' });
  ok('HERE açık + unverified → status unverified, izin yok', r.allowed === false && r.status === 'unverified' && r.reasons.includes('here:license-unverified'));
  ok('resolvePolicy varsayılan kaydı değiştirmez', getProvider('here').enabledByDefault.map === false);
}
ok('hiçbir yerde HERE için approved yok', !JSON.stringify(listProviders().filter((p) => p.id === 'here')).includes('approved'));

// ---- Free: Premium sağlayıcılara erişim yok ----
for (const plan of ['free', undefined, null, '', 'gold', 'PREMIUM']) {
  const r = evaluate({ plan, map: 'tomtom', route: 'tomtom' });
  ok(`plan=${JSON.stringify(plan)} → TomTom izin yok (premium-required)`, r.allowed === false && r.reasons.includes('tomtom:premium-required'));
  const h = evaluate({ plan, map: 'here' });
  ok(`plan=${JSON.stringify(plan)} → HERE izin yok`, h.allowed === false && h.reasons.includes('here:premium-required'));
}
{
  const r = evaluate({ plan: 'free', map: 'osm', route: 'osm', data: 'osm' });
  ok('Free + OSM harita/rota/veri → izin', r.allowed === true && r.status === 'allowed' && r.reasons.length === 0);
  ok('Free OSM atıfı döner', r.attributions.length === 1 && /OpenStreetMap/.test(r.attributions[0].text));
}
ok('Premium + OSM de izinli (Premium Free’nin üst kümesi)', evaluate({ plan: 'premium', map: 'osm', route: 'osm' }).allowed === true);

// ---- Sağlayıcılar arası karıştırma reddi ----
ok('aynı sağlayıcı kombinasyonu izinli listede (osm)', isCombinationAllowed({ map: 'osm', route: 'osm', data: 'osm' }) === true);
ok('aynı sağlayıcı kombinasyonu izinli listede (tomtom)', isCombinationAllowed({ map: 'tomtom', route: 'tomtom', data: 'tomtom' }) === true);
ok('veri yokken (data null) tek sağlayıcı izinli', isCombinationAllowed({ map: 'tomtom', route: 'tomtom' }) === true);
const mixes = [
  { map: 'osm', route: 'tomtom' }, { map: 'tomtom', route: 'osm' }, { map: 'osm', route: 'here' }, { map: 'here', route: 'tomtom' },
  { map: 'tomtom', route: 'here' }, { map: 'tomtom', route: 'tomtom', data: 'here' }, { map: 'osm', route: 'osm', data: 'here' },
  { map: 'osm', route: 'osm', data: 'tomtom' }, { map: 'here', route: 'here', data: 'tomtom' }, { map: 'tomtom', route: 'tomtom', data: 'osm' },
];
for (const c of mixes) {
  ok(`karışım reddedilir: ${JSON.stringify(c)}`, isCombinationAllowed(c) === false);
  const r = evaluate({ plan: 'premium', ...c });
  ok(`evaluate karışımı reddeder: ${JSON.stringify(c)}`, r.allowed === false && r.status === 'denied' && r.reasons.includes('cross-provider-mix'));
}
ok('bilinmeyen sağlayıcı reddedilir', evaluate({ plan: 'premium', map: 'mapbox', route: 'mapbox' }).reasons.includes('mapbox:unknown-provider'));
ok('harita seçilmezse reddedilir', evaluate({ plan: 'premium' }).allowed === false && evaluate({ plan: 'premium' }).reasons.includes('map:missing'));
ok('yeteneği olmayan sağlayıcı reddedilir (here route kaydında var ama kapalı)', evaluate({ plan: 'premium', map: 'here', route: 'here' }).allowed === false);
ok('rota sağlayıcısı haritadan farklı ve data null → yine karışım', evaluate({ plan: 'premium', map: 'osm', route: 'tomtom', data: null }).reasons.includes('cross-provider-mix'));

// ---- TomTom: Premium'da bile lisans doğrulanmadığı için politika izin vermez (çalışma zamanı değişmedi) ----
{
  const r = evaluate({ plan: 'premium', map: 'tomtom', route: 'tomtom', data: 'tomtom' });
  ok('Premium + TomTom tek sağlayıcı → status unverified, izin yok', r.allowed === false && r.status === 'unverified' && r.reasons.includes('tomtom:license-unverified'));
  ok('unverified durumunda bile atıf listesi dolu', r.attributions.some((a) => /TomTom/.test(a.text)));
}

// ---- Atıf ----
ok('attributionFor tekrarsız', attributionFor(['osm', 'osm', null, 'tomtom']).length === 2);
ok('attributionFor bilinmeyeni atlar', attributionFor(['mapbox']).length === 0);

// ---- Saflık: girdi değiştirilmez, ağ yok, ortam/anahtar yok ----
{
  const req = Object.freeze({ plan: 'premium', map: 'osm', route: 'osm', data: null });
  let threw = false;
  try { evaluate(req); } catch { threw = true; }
  ok('dondurulmuş girdiyle çalışır (girdiyi değiştirmez)', !threw);
}
ok('hiç fetch çağrısı yok', fetchCalls === 0);
{
  const src = readFileSync(fileURLToPath(new URL('../server/providerPolicy.mjs', import.meta.url)), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('kaynakta import yok', !/\bimport\b/.test(code));
  ok('kaynakta fetch/http/XMLHttpRequest yok', !/\bfetch\b|https?:|XMLHttpRequest|WebSocket/.test(code));
  ok('kaynakta process.env / anahtar adı yok', !/process\.env|_KEY|apiKey|token/i.test(code));
}

// ---- Mevcut davranış etkilenmedi ----
{
  const { createMaps, PROVIDERS } = await import('../server/maps.mjs');
  ok('server/maps.mjs PROVIDERS değişmedi (here eklenmedi)', JSON.stringify(PROVIDERS) === '["osm","mapbox","google","tomtom"]');
  const m = createMaps({ data: { users: {}, settings: {} }, save() {} }, { TOMTOM_MAP_KEY: 'tt-dummy' });
  ok('maps: Free → osm', JSON.stringify(m.config({}, false)) === '{"provider":"osm"}');
  ok('maps: Premium + TomTom anahtarı → tomtom (politika çalışma zamanına bağlı değil)', m.config({}, true).provider === 'tomtom');
  let threw = false;
  try { m.setUser({}, 'here'); } catch { threw = true; }
  ok('maps: kullanıcı HERE seçemez', threw);
}
{
  const root = new URL('../', import.meta.url);
  const html = readFileSync(fileURLToPath(new URL('index.html', root)), 'utf8');
  ok('index.html: HERE harita seçeneği yok', !/value=["']here["']/i.test(html));
  const mapCfg = readFileSync(fileURLToPath(new URL('js/net/mapConfig.js', root)), 'utf8');
  ok('mapConfig.js: here sağlayıcısı yok', !/['"]here['"]/.test(mapCfg));
}

globalThis.fetch = realFetch;
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
