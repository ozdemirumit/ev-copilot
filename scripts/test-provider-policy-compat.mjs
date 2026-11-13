// Sağlayıcı politika UYUMLULUK TANISI (salt okunur): node scripts/test-provider-policy-compat.mjs
// Bugün çalışma zamanında açık olan her harita sağlayıcısını (osm, tomtom, mapbox, google) ve mevcut HERE/TomTom/Google/Mapbox veri yollarını
// server/providerPolicy.mjs içindeki muhafazakâr varsayılan politikayla karşılaştırır ve deterministik, sır içermeyen bir özet basar.
// Hiçbir davranışı DEĞİŞTİRMEZ, politikayı çalışma zamanına BAĞLAMAZ, ağa çıkmaz (fetch engellenir), gerçek anahtar kullanmaz.
// Yöntem: server/maps.mjs sahte depo + sahte (anahtar olmayan) yer tutucularla çalıştırılır; diğer yollar kaynak metni üzerinden statik denetlenir
// (server/proxy.mjs içe AKTARILMAZ: sunucu başlatır).
//
// Sınıflar (HUKUKİ DEĞERLENDİRME DEĞİLDİR; yalnızca bu depodaki iç politikaya göre):
//   consistent      — politika izin veriyor ve çalışma zamanı da aynı şeyi yapıyor.
//   unverified      — politika kuralları geçiyor ama sağlayıcının lisans durumu kayıtta 'unverified' (doğrulanmamış; ihlal iddiası yok).
//   unmodeled       — sağlayıcı politika kaydında hiç yok (mapbox, google); politika bunu değerlendiremez (destek dışı, ihlal iddiası yok).
//   policy-conflict — çalışma zamanı, iç politikanın açıkça REDDETTİĞİ bir şeyi yapıyor (kanıt: kod yolu). Bu bir sözleşme/lisans ihlali iddiası
//                     DEĞİLDİR; yalnızca politika bağlandığında davranışın değişeceğini gösterir.
// Test, bilinen bulguları "beklenen" olarak doğrular: kod ya da politika değişirse burada FAIL olur ve tanı güncellenmelidir.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); } };

// Ağ engeli
let fetchCalls = 0;
globalThis.fetch = () => { fetchCalls++; throw new Error('ağ yasak'); };

const src = (rel) => readFileSync(fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');
/** Kaynak metinde `async function name(` ile başlayan gövdeyi (bir sonraki üst düzey function'a kadar) döndürür; bulunamazsa ''. */
function fnBody(text, name) {
  const i = text.indexOf(`function ${name}(`);
  if (i < 0) return '';
  const rest = text.slice(i + 1);
  const j = rest.search(/\n(?:async )?function |\nexport |\nconst [A-Za-z_]+ = /);
  return j < 0 ? rest : rest.slice(0, j);
}

const policy = await import('../server/providerPolicy.mjs');
const { createMaps, PROVIDERS: MAP_PROVIDERS } = await import('../server/maps.mjs');

// ---- 0) Ön koşullar: politika ve harita kayıtlarının bugünkü hâli ----
ok('politika kaydı: osm/tomtom/here', JSON.stringify(policy.PROVIDER_IDS) === '["osm","tomtom","here"]');
ok('harita sağlayıcıları (maps.mjs): osm/mapbox/google/tomtom', JSON.stringify(MAP_PROVIDERS) === '["osm","mapbox","google","tomtom"]');
ok('HERE lisansı unverified, varsayılan kapalı', policy.getProvider('here').licenseStatus === 'unverified' && Object.values(policy.getProvider('here').enabledByDefault).every((v) => v === false));
ok('TomTom lisansı unverified', policy.getProvider('tomtom').licenseStatus === 'unverified');

// ---- 1) Harita: maps.mjs sahte depo + yer tutucu değerlerle (gerçek anahtar DEĞİL; çıktıya asla basılmaz) ----
const FAKE = { MAPBOX_MAP_TOKEN: 'pk.PLACEHOLDER-not-a-key', GOOGLE_MAPS_BROWSER_KEY: 'PLACEHOLDER-google-not-a-key', TOMTOM_MAP_KEY: 'PLACEHOLDER-tomtom-not-a-key' };
const store = { data: { settings: {} }, save() {} };
const maps = createMaps(store, FAKE);
const mapRows = [];
for (const p of MAP_PROVIDERS) {
  const u = { mapProvider: p };
  const free = maps.effective(u, false);
  const prem = maps.effective(u, true);
  const cfg = maps.config(u, true);
  ok(`harita ${p}: Free → osm`, free === 'osm', free);
  ok(`harita ${p}: Premium + anahtar → ${p}`, prem === p && cfg.provider === p, prem);
  mapRows.push({ p, free, prem });
}
{
  const bare = createMaps({ data: { settings: {} }, save() {} }, {});
  ok('anahtar yokken Premium da osm’ye düşer (mapbox/google/tomtom)', ['mapbox', 'google', 'tomtom'].every((p) => bare.effective({ mapProvider: p }, true) === 'osm'));
}

// ---- 2) Statik kanıtlar (kaynak metin) ----
const PROXY = src('server/proxy.mjs');
const IDX = src('js/providers/index.js');
const CLIENT_PROXY = src('js/net/proxy.js');
const OSM_CHARGERS = src('js/osm/chargers.js');
const LIMIT_SPANS = src('js/nav/limitSpans.js');
const OCC = src('server/occupancy.mjs');
const SPEED = src('server/speedlimits.mjs');

const hereStationsFn = fnBody(PROXY, 'hereStations');
const occupancyFn = fnBody(PROXY, 'occupancyRoute');
const speedFn = fnBody(PROXY, 'speedLimitsRoute');
const tomtomRouteFn = fnBody(PROXY, 'tomtomRouteRoute');
const googleStationsFn = fnBody(PROXY, 'googleStationsRoute');
const fetchRouteFn = fnBody(IDX, 'fetchRoute');

const ev = {
  hereStationsNoPremiumGate: hereStationsFn.length > 0 && !/premiumOk\(|isPremium\(/.test(hereStationsFn),
  clientHereCapNotPremiumGated: /here: !!c\?\.here,/.test(CLIENT_PROXY),
  clientTomtomCapPremiumGated: /tomtom: !!c\?\.tomtom && prem/.test(CLIENT_PROXY),
  chargersUseHereFirst: /if \(hereOn\(\)\)/.test(OSM_CHARGERS),
  chargersNoActiveMapGate: !/activeMap/.test(OSM_CHARGERS),
  occupancyPremiumGated: /!accounts\.isPremium\(id\.user\)/.test(occupancyFn),
  occupancyNoMapInput: occupancyFn.length > 0 && !/activeMap|mapProvider|maps\./.test(occupancyFn),
  occupancyHereTomtomGoogle: /hereLookup\(/.test(OCC) && /tomtomLookup\(/.test(OCC) && /googleLookup\(/.test(OCC),
  speedPremiumGated: /premiumOk\(id\)/.test(speedFn) && /hereSpeedLimits\(/.test(speedFn) && /router\.hereapi\.com/.test(SPEED),
  limitSpansNoActiveMapGate: /\/v1\/speedlimits/.test(LIMIT_SPANS) && !/activeMap/.test(LIMIT_SPANS),
  tomtomRouteServerPremiumGated: /premiumOk\(id\)/.test(tomtomRouteFn),
  tomtomRouteOnlyOnTomtomMap: /activeMap\(\) === 'tomtom'/.test(IDX) && /premiumAccess\(\)/.test(IDX),
  osmRouteFallbackAfterTomtom: /skipped = `TomTom rotası alınamadı/.test(fetchRouteFn) && /osmRoute\(\.\.\.a\)/.test(fetchRouteFn),
  mapboxRouteNoActiveMapGate: /mapboxKey\(\)/.test(fetchRouteFn) && !/activeMap\(\) === 'mapbox'/.test(IDX),
  googleStationsPremiumGated: /premiumOk\(id\)/.test(googleStationsFn),
};
for (const [k, v] of Object.entries(ev)) ok(`kanıt: ${k}`, v === true);

// ---- 3) Bulgular: her yüzey için politika isteği + beklenen sınıf ----
const classify = (req) => {
  const r = policy.evaluate(req);
  const ids = [req.map, req.route, req.data].filter(Boolean);
  if (ids.some((id) => !policy.PROVIDER_IDS.includes(id))) return { cls: 'unmodeled', r };
  if (r.status === 'allowed') return { cls: 'consistent', r };
  if (r.status === 'unverified') return { cls: 'unverified', r };
  return { cls: 'policy-conflict', r };
};

// note: insan okunur kısa açıklama (anahtar/URL/sır yok). evidence: yukarıdaki ev anahtarları.
const FINDINGS = [
  // Harita yüzeyleri (maps.mjs)
  { id: 'map.osm.free', note: 'Free harita OpenFreeMap', req: { plan: 'free', map: 'osm' }, expect: 'consistent', evidence: [] },
  { id: 'map.osm.premium-fallback', note: 'Premium ama anahtar yok/secim osm', req: { plan: 'premium', map: 'osm' }, expect: 'consistent', evidence: [] },
  { id: 'map.tomtom.premium', note: 'Premium TomTom harita (anahtar tarayiciya gider)', req: { plan: 'premium', map: 'tomtom' }, expect: 'unverified', evidence: [] },
  { id: 'map.mapbox.premium', note: 'Premium Mapbox harita', req: { plan: 'premium', map: 'mapbox' }, expect: 'unmodeled', evidence: [] },
  { id: 'map.google.premium', note: 'Premium Google harita', req: { plan: 'premium', map: 'google' }, expect: 'unmodeled', evidence: [] },
  // Rota yüzeyleri (js/providers/index.js)
  { id: 'route.tomtom.on-tomtom-map', note: 'TomTom rota yalnizca TomTom haritasinda + Premium', req: { plan: 'premium', map: 'tomtom', route: 'tomtom' }, expect: 'unverified', evidence: ['tomtomRouteOnlyOnTomtomMap', 'tomtomRouteServerPremiumGated'] },
  { id: 'route.osm-fallback.on-tomtom-map', note: 'TomTom rota hatasinda Valhalla rotasi TomTom haritasinda', req: { plan: 'premium', map: 'tomtom', route: 'osm' }, expect: 'policy-conflict', evidence: ['osmRouteFallbackAfterTomtom'] },
  { id: 'route.mapbox.any-map', note: 'Mapbox anahtari varsa Mapbox rota, aktif haritaya bakilmaz', req: { plan: 'premium', map: 'osm', route: 'mapbox' }, expect: 'unmodeled', evidence: ['mapboxRouteNoActiveMapGate'] },
  { id: 'route.osm.free', note: 'Free Valhalla rota OSM haritasinda', req: { plan: 'free', map: 'osm', route: 'osm' }, expect: 'consistent', evidence: [] },
  // HERE veri yolları
  { id: 'data.here.stations.free', note: 'HERE istasyon listesi (/here/stations) Premium kapisiz, OSM haritasinda', req: { plan: 'free', map: 'osm', data: 'here' }, expect: 'policy-conflict', evidence: ['hereStationsNoPremiumGate', 'clientHereCapNotPremiumGated', 'chargersUseHereFirst', 'chargersNoActiveMapGate'] },
  { id: 'data.here.stations.premium-tomtom-map', note: 'HERE istasyon listesi TomTom haritasinda', req: { plan: 'premium', map: 'tomtom', data: 'here' }, expect: 'policy-conflict', evidence: ['chargersNoActiveMapGate'] },
  { id: 'data.here.occupancy.premium', note: 'HERE canli doluluk (/v1/occupancy), harita bilgisi yok', req: { plan: 'premium', map: 'osm', data: 'here' }, expect: 'policy-conflict', evidence: ['occupancyPremiumGated', 'occupancyNoMapInput', 'occupancyHereTomtomGoogle'] },
  { id: 'data.here.speedlimits.premium', note: 'HERE hiz limiti (/v1/speedlimits) her haritada', req: { plan: 'premium', map: 'osm', data: 'here' }, expect: 'policy-conflict', evidence: ['speedPremiumGated', 'limitSpansNoActiveMapGate'] },
  // TomTom / Google / Mapbox veri yolları
  { id: 'data.tomtom.occupancy.osm-map', note: 'TomTom doluluk OSM haritasinda (harita bilgisi yok)', req: { plan: 'premium', map: 'osm', data: 'tomtom' }, expect: 'policy-conflict', evidence: ['occupancyNoMapInput', 'occupancyHereTomtomGoogle'] },
  { id: 'data.tomtom.occupancy.tomtom-map', note: 'TomTom doluluk TomTom haritasinda', req: { plan: 'premium', map: 'tomtom', data: 'tomtom' }, expect: 'unverified', evidence: ['occupancyHereTomtomGoogle'] },
  { id: 'data.google.places', note: 'Google Places doluluk/istasyon (Premium)', req: { plan: 'premium', map: 'osm', data: 'google' }, expect: 'unmodeled', evidence: ['googleStationsPremiumGated', 'occupancyHereTomtomGoogle'] },
  { id: 'data.mapbox.stations-limits', note: 'Mapbox istasyon arama + maxspeed kesimleri', req: { plan: 'premium', map: 'osm', data: 'mapbox' }, expect: 'unmodeled', evidence: [] },
  { id: 'data.osm.free', note: 'Overpass istasyon + OSM maxspeed', req: { plan: 'free', map: 'osm', route: 'osm', data: 'osm' }, expect: 'consistent', evidence: [] },
];

console.log('\n==== Sağlayıcı politika uyumluluk özeti (deterministik, sır yok; hukuki değerlendirme DEĞİL) ====');
console.log('Harita (maps.mjs, yer tutucu anahtarlarla): ' + mapRows.map((m) => `${m.p}[free→${m.free}, premium→${m.prem}]`).join(' '));
const counts = { consistent: 0, unverified: 0, unmodeled: 0, 'policy-conflict': 0 };
for (const f of FINDINGS) {
  const { cls, r } = classify(f.req);
  counts[cls]++;
  const evOk = f.evidence.every((k) => ev[k] === true);
  ok(`bulgu ${f.id}: beklenen ${f.expect}`, cls === f.expect && evOk, `${cls}; kanıt ${evOk ? 'tamam' : 'eksik'}`);
  const reqTxt = ['plan', 'map', 'route', 'data'].map((k) => `${k}=${f.req[k] ?? '-'}`).join(' ');
  console.log(`  [${cls.padEnd(15)}] ${f.id.padEnd(40)} ${reqTxt.padEnd(44)} → ${r.status}${r.reasons.length ? ' (' + r.reasons.join(', ') + ')' : ''} | ${f.note}`);
}
console.log(`Toplam ${FINDINGS.length} yüzey: consistent ${counts.consistent}, unverified ${counts.unverified}, unmodeled ${counts.unmodeled}, policy-conflict ${counts['policy-conflict']}`);
console.log('Not: "policy-conflict" yalnızca iç politikaya göre farktır (politika bağlanırsa davranış değişir); lisans/sözleşme ihlali iddiası değildir.');
ok('beklenen dağılım 4/3/5/6', counts.consistent === 4 && counts.unverified === 3 && counts.unmodeled === 5 && counts['policy-conflict'] === 6, JSON.stringify(counts));

// ---- 4) Güvenlik: ağ yok, yer tutucu değerler çıktıda yok, politika değişmedi ----
ok('hiç fetch çağrısı yok', fetchCalls === 0, String(fetchCalls));
{
  const printed = JSON.stringify({ FINDINGS, mapRows, counts });
  ok('özet yer tutucu anahtar değerlerini içermez', Object.values(FAKE).every((v) => !printed.includes(v)));
}
ok('politika varsayılanı değişmedi (HERE kapalı)', policy.getProvider('here').enabledByDefault.map === false && Object.isFrozen(policy.getProvider('here')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
