// Premium sağlayıcı kataloğu testleri (bağımlılıksız, düz node): node scripts/test-provider-catalog.mjs
// server/providerCatalog.mjs saf ve yan etkisizdir: ağ, ortam değişkeni, dosya, anahtar yok. Çalışma zamanına HENÜZ BAĞLI DEĞİL.
// Testlerde yalnızca sahte değerler kullanılır; gerçek anahtar yok.
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

const envBefore = JSON.stringify(process.env);
const C = await import('../server/providerCatalog.mjs');
const { CATALOG_PROVIDER_IDS, CATALOG_CAPABILITIES, CATALOG_STATUSES, catalogEntry, buildCatalog } = C;
const policy = await import('../server/providerPolicy.mjs');

const ALL_ON = Object.freeze({
  mapbox: { map: true, route: true },
  tomtom: { map: true, route: true },
  google: { map: true, route: true }, // route bayrağı Google Routes'u açamaz (bağlı değil)
  here: { map: true, route: true, traffic: true }, // HERE yalnızca harita bağlı: rota/trafik bayrakları etkisiz
});
const cap = (cat, id, c) => cat.providers.find((p) => p.id === id).capabilities[c];
const prov = (cat, id) => cat.providers.find((p) => p.id === id);

// ---- Yapı ----
ok('5 sağlayıcı: osm, mapbox, tomtom, google, here', JSON.stringify(CATALOG_PROVIDER_IDS) === '["osm","mapbox","tomtom","google","here"]');
ok('yetenekler map/route/traffic', JSON.stringify(CATALOG_CAPABILITIES) === '["map","route","traffic"]');
ok('durumlar', JSON.stringify(CATALOG_STATUSES) === '["available","not-configured","premium-required","coming-soon","unavailable"]');
ok('sabit listeler dondurulmuş', Object.isFrozen(CATALOG_PROVIDER_IDS) && Object.isFrozen(CATALOG_CAPABILITIES) && Object.isFrozen(CATALOG_STATUSES));
for (const id of CATALOG_PROVIDER_IDS) {
  const e = catalogEntry(id);
  ok(`${id}: girdi var ve dondurulmuş`, e && Object.isFrozen(e) && Object.isFrozen(e.wired) && Object.isFrozen(e.comingSoon));
  ok(`${id}: licenseStatus unverified|approved`, e.licenseStatus === 'unverified' || e.licenseStatus === 'approved');
  ok(`${id}: lisans notu dolu`, typeof e.licenseNote === 'string' && e.licenseNote.length > 0);
  ok(`${id}: wired yalnızca boolean`, CATALOG_CAPABILITIES.every((c) => typeof e.wired[c] === 'boolean'));
}
ok('bilinmeyen/prototip ad → null', catalogEntry('valhalla') === null && catalogEntry('__proto__') === null && catalogEntry('toString') === null && catalogEntry(undefined) === null);

// ---- Gerçek bağlantı durumu (HEAD koduyla uyumlu) ----
const w = (id) => catalogEntry(id).wired;
ok('osm: harita+rota bağlı, trafik yok', w('osm').map && w('osm').route && !w('osm').traffic);
ok('mapbox: harita+rota+trafik bağlı', w('mapbox').map && w('mapbox').route && w('mapbox').traffic);
ok('tomtom: harita+rota+trafik bağlı', w('tomtom').map && w('tomtom').route && w('tomtom').traffic);
ok('google: yalnızca harita bağlı', w('google').map && !w('google').route && !w('google').traffic);
ok('here: yalnızca harita bağlı', w('here').map && !w('here').route && !w('here').traffic);
ok('google rota coming-soon olarak işaretli', catalogEntry('google').comingSoon.includes('route'));
ok('here route/traffic coming-soon, map değil', ['route', 'traffic'].every((c) => catalogEntry('here').comingSoon.includes(c)) && !catalogEntry('here').comingSoon.includes('map'));

// ---- Lisans: varsayım yok ----
ok('osm lisansı providerPolicy ile aynı (approved)', catalogEntry('osm').licenseStatus === policy.getProvider('osm').licenseStatus && catalogEntry('osm').licenseStatus === 'approved');
ok('tomtom lisansı providerPolicy ile aynı (unverified)', catalogEntry('tomtom').licenseStatus === policy.getProvider('tomtom').licenseStatus && catalogEntry('tomtom').licenseStatus === 'unverified');
ok('here lisansı providerPolicy ile aynı (unverified)', catalogEntry('here').licenseStatus === policy.getProvider('here').licenseStatus && catalogEntry('here').licenseStatus === 'unverified');
ok('mapbox lisansı unverified (inceleme kaydı yok)', catalogEntry('mapbox').licenseStatus === 'unverified');
ok('google lisansı unverified (inceleme kaydı yok)', catalogEntry('google').licenseStatus === 'unverified');

// ---- Free: yalnızca osm ----
for (const cfg of [undefined, {}, { plan: 'free' }, { plan: 'free', configured: ALL_ON }, { plan: 'PREMIUM', configured: ALL_ON }, { plan: 'gold', configured: ALL_ON }]) {
  const cat = buildCatalog(cfg);
  const label = JSON.stringify(cfg?.plan ?? null) + (cfg?.configured ? '+hepsi açık' : '');
  ok(`Free ${label}: plan free`, cat.plan === 'free');
  ok(`Free ${label}: yalnızca osm seçilebilir`, JSON.stringify(cat.providers.filter((p) => p.selectable).map((p) => p.id)) === '["osm"]');
  ok(`Free ${label}: osm available`, prov(cat, 'osm').status === 'available' && cap(cat, 'osm', 'map').status === 'available' && cap(cat, 'osm', 'route').status === 'available');
  ok(`Free ${label}: osm trafik unavailable`, cap(cat, 'osm', 'traffic').status === 'unavailable');
  ok(`Free ${label}: mapbox/tomtom/google premium-required`, ['mapbox', 'tomtom', 'google'].every((id) => prov(cat, id).status === 'premium-required'));
  ok(`Free ${label}: here premium-required, seçilemez`, prov(cat, 'here').status === 'premium-required' && !prov(cat, 'here').selectable);
  ok(`Free ${label}: osm dışında hiçbir yetenek available değil`, cat.providers.filter((p) => p.id !== 'osm').every((p) => CATALOG_CAPABILITIES.every((c) => p.capabilities[c].status !== 'available')));
}

// ---- Premium, hiçbir şey yapılandırılmamış ----
{
  const cat = buildCatalog({ plan: 'premium' });
  ok('Premium boş: plan premium', cat.plan === 'premium');
  ok('Premium boş: yalnızca osm seçilebilir', JSON.stringify(cat.providers.filter((p) => p.selectable).map((p) => p.id)) === '["osm"]');
  ok('Premium boş: mapbox/tomtom/google not-configured', ['mapbox', 'tomtom', 'google'].every((id) => prov(cat, id).status === 'not-configured'));
  ok('Premium boş: here not-configured', prov(cat, 'here').status === 'not-configured');
}

// ---- Premium, hepsi yapılandırılmış ----
{
  const cat = buildCatalog({ plan: 'premium', configured: ALL_ON });
  ok('Premium hepsi: osm/mapbox/tomtom/google/here seçilebilir', JSON.stringify(cat.providers.filter((p) => p.selectable).map((p) => p.id)) === '["osm","mapbox","tomtom","google","here"]');
  ok('Premium hepsi: here harita available, seçilebilir', prov(cat, 'here').status === 'available' && prov(cat, 'here').selectable);
  ok('Premium hepsi: here harita available, rota/trafik coming-soon (route bayrağı etkisiz)', cap(cat, 'here', 'map').status === 'available' && cap(cat, 'here', 'route').status === 'coming-soon' && cap(cat, 'here', 'traffic').status === 'coming-soon' && prov(cat, 'here').routeAvailable === false);
  ok('Premium hepsi: mapbox map/route/traffic available', CATALOG_CAPABILITIES.every((c) => cap(cat, 'mapbox', c).status === 'available'));
  ok('Premium hepsi: tomtom map/route/traffic available', CATALOG_CAPABILITIES.every((c) => cap(cat, 'tomtom', c).status === 'available'));
  ok('Premium hepsi: google harita available', cap(cat, 'google', 'map').status === 'available' && prov(cat, 'google').status === 'available');
  ok('Premium hepsi: google rota coming-soon (route bayrağı etkisiz)', cap(cat, 'google', 'route').status === 'coming-soon');
  ok('Premium hepsi: google trafik unavailable', cap(cat, 'google', 'traffic').status === 'unavailable');
  ok('Premium hepsi: google routeAvailable false + açık not', prov(cat, 'google').routeAvailable === false && /Google Routes/.test(prov(cat, 'google').routeNote));
  ok('Premium hepsi: mapbox/tomtom/osm routeAvailable true', ['osm', 'mapbox', 'tomtom'].every((id) => prov(cat, id).routeAvailable === true));
  ok('Premium hepsi: unverified lisans uyarısı mapbox/tomtom/google/here', ['mapbox', 'tomtom', 'google', 'here'].every((id) => prov(cat, id).licenseStatus === 'unverified' && prov(cat, id).licenseVerified === false && prov(cat, id).warnings.includes('license-unverified')));
  ok('Premium hepsi: osm lisans uyarısı yok', prov(cat, 'osm').licenseVerified === true && !prov(cat, 'osm').warnings.includes('license-unverified'));
  ok('available lisansı onaylamaz: tomtom available ama unverified', prov(cat, 'tomtom').status === 'available' && prov(cat, 'tomtom').licenseStatus === 'unverified');
}

// ---- Yetenek bazında yapılandırma ----
{
  const cat = buildCatalog({ plan: 'premium', configured: { mapbox: { map: true }, tomtom: { route: true } } });
  ok('mapbox yalnız harita: map available, route/traffic not-configured', cap(cat, 'mapbox', 'map').status === 'available' && cap(cat, 'mapbox', 'route').status === 'not-configured' && cap(cat, 'mapbox', 'traffic').status === 'not-configured');
  ok('mapbox yalnız harita: seçilebilir, routeAvailable false', prov(cat, 'mapbox').selectable && prov(cat, 'mapbox').routeAvailable === false);
  ok('tomtom yalnız rota anahtarı: harita yok → seçilemez', prov(cat, 'tomtom').status === 'not-configured' && !prov(cat, 'tomtom').selectable);
  ok('tomtom rota TomTom haritası ister (requires-map)', cap(cat, 'tomtom', 'route').status === 'not-configured' && cap(cat, 'tomtom', 'route').reason === 'requires-map');
  ok('tomtom trafik TomTom haritası ister', cap(cat, 'tomtom', 'traffic').status === 'not-configured' && cap(cat, 'tomtom', 'traffic').reason === 'requires-map');
}
{
  const cat = buildCatalog({ plan: 'premium', configured: { mapbox: { route: true } } });
  ok('mapbox yalnız rota: harita not-configured, seçilemez', prov(cat, 'mapbox').status === 'not-configured' && !prov(cat, 'mapbox').selectable);
  ok('mapbox yalnız rota: rota+trafik available (Mapbox rotası haritadan bağımsız)', cap(cat, 'mapbox', 'route').status === 'available' && cap(cat, 'mapbox', 'traffic').status === 'available');
}
{
  const cat = buildCatalog({ plan: 'premium', configured: { tomtom: { map: true } } });
  ok('tomtom yalnız harita: seçilebilir, rota not-configured', prov(cat, 'tomtom').selectable && cap(cat, 'tomtom', 'route').status === 'not-configured' && prov(cat, 'tomtom').routeAvailable === false);
}

// ---- Config yalnızca boolean; gizli bilgi taşımaz ----
const FAKE = 'pk.SAHTE-TEST-DEGERI-123';
const FAKE2 = 'sahte-tomtom-anahtari-xyz';
{
  const cfg = { plan: 'premium', configured: { mapbox: { map: FAKE, route: 'true', traffic: 1 }, tomtom: { map: FAKE2, route: 1 }, google: { map: 'yes' } }, keys: { MAPBOX_MAP_TOKEN: FAKE, TOMTOM_KEY: FAKE2 }, MAPBOX_MAP_TOKEN: FAKE };
  const cfgCopy = JSON.stringify(cfg);
  const cat = buildCatalog(cfg);
  const out = JSON.stringify(cat);
  ok('boolean olmayan bayrak (string/sayı) → yapılandırılmamış', ['mapbox', 'tomtom', 'google'].every((id) => prov(cat, id).status === 'not-configured'));
  ok('çıktıda sahte anahtar yok', !out.includes(FAKE) && !out.includes(FAKE2));
  ok('çıktıda anahtar adı/alan yok', !/MAPBOX_MAP_TOKEN|TOMTOM_KEY|"token"|"key"/.test(out));
  ok('girdi değiştirilmedi', JSON.stringify(cfg) === cfgCopy);
  ok('boolean olmayan bayraklar raporlanır (değer olmadan)', Array.isArray(cat.ignoredConfig) && cat.ignoredConfig.includes('mapbox.map') && cat.ignoredConfig.includes('tomtom.map') && !JSON.stringify(cat.ignoredConfig).includes(FAKE));
}
{
  const cat = buildCatalog({ plan: 'premium', configured: { mapbox: true, tomtom: 'x', osm: { map: false, route: false }, nope: { map: true } } });
  ok('sağlayıcı düzeyinde boolean kısa yol kabul edilmez (yetenek bazında olmalı)', prov(cat, 'mapbox').status === 'not-configured');
  ok('osm yapılandırmayla kapatılamaz (anahtarsız, her zaman available)', prov(cat, 'osm').status === 'available' && cap(cat, 'osm', 'route').status === 'available');
  ok('bilinmeyen sağlayıcı çıktıya eklenmez', cat.providers.length === 5 && !cat.providers.some((p) => p.id === 'nope'));
}
{
  const evil = JSON.parse('{"plan":"premium","configured":{"__proto__":{"map":true,"route":true},"mapbox":{"__proto__":{"map":true}}}}');
  const cat = buildCatalog(evil);
  ok('__proto__ ile bayrak enjekte edilemez', prov(cat, 'mapbox').status === 'not-configured' && prov(cat, 'google').status === 'not-configured');
  ok('Object.prototype kirlenmedi', ({}).map === undefined && ({}).route === undefined);
}
for (const bad of [null, 42, 'premium', [], { plan: 'premium', configured: null }, { plan: 'premium', configured: 'mapbox' }, { plan: 'premium', configured: [true] }]) {
  let cat = null, threw = false;
  try { cat = buildCatalog(bad); } catch { threw = true; }
  ok(`bozuk girdi atmaz: ${JSON.stringify(bad)}`, !threw && cat && cat.providers.length === 5 && prov(cat, 'osm').status === 'available');
}

// ---- Çıktı dondurulmuş, kayıt değişmez ----
{
  const cat = buildCatalog({ plan: 'premium', configured: ALL_ON });
  ok('çıktı derin dondurulmuş', Object.isFrozen(cat) && Object.isFrozen(cat.providers) && cat.providers.every((p) => Object.isFrozen(p) && Object.isFrozen(p.capabilities) && Object.isFrozen(p.warnings) && CATALOG_CAPABILITIES.every((c) => Object.isFrozen(p.capabilities[c]))));
  let threw = false;
  try { cat.providers[0].status = 'x'; } catch { threw = true; }
  ok('çıktı yazılamaz (strict mod)', threw || cat.providers[0].status === 'available');
  const again = buildCatalog({ plan: 'free' });
  ok('önceki çağrı sonrakini etkilemez', prov(again, 'tomtom').status === 'premium-required');
  ok('sıra sabit', JSON.stringify(cat.providers.map((p) => p.id)) === JSON.stringify(CATALOG_PROVIDER_IDS));
  ok('deterministik', JSON.stringify(buildCatalog({ plan: 'premium', configured: ALL_ON })) === JSON.stringify(cat));
}

// ---- Yan etkisizlik ve kaynak denetimi ----
ok('ağ çağrısı yok', fetchCalls === 0);
ok('process.env değişmedi', JSON.stringify(process.env) === envBefore);
{
  const src = readFileSync(fileURLToPath(new URL('../server/providerCatalog.mjs', import.meta.url)), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ok('kaynakta process.env yok', !/process\.env/.test(code));
  ok('kaynakta fetch/http yok', !/\bfetch\s*\(|node:https?|from ['"]https?/.test(code));
  ok('kaynakta fs/child_process yok', !/node:fs|node:child_process|from ['"]fs['"]/.test(code));
  ok('yalnızca providerPolicy içe aktarılır', (code.match(/^\s*import\b.*$/gm) || []).every((l) => /\.\/providerPolicy\.mjs['"]/.test(l)));
  ok('kaynakta anahtar adı yok', !/MAPBOX_MAP_TOKEN|TOMTOM_KEY|TOMTOM_MAP_KEY|GOOGLE_MAPS_BROWSER_KEY|HERE_KEY/.test(code));
}

globalThis.fetch = realFetch;
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
