// TomTom yol olayları FAIL-CLOSED SÖZLEŞMESİ testleri (yalnız test + belge; bağımlılıksız, düz node, çevrimdışı):
//   node scripts/test-road-events-tomtom-contract.mjs
// Bugünkü davranışı sabitler (docs/road-events-tomtom-contract.md):
// - js/tomtom/route.js TomTom rotasından yalnızca trafik (trafficSpans) ve hız limiti (limitSpans) bölümlerini kullanır;
//   tünel/köprü/alt geçit/üst geçit/gişe/otoyol çıkışı/tabela/şerit için DOĞRULANMIŞ yol olayı ya da sesli uyarı üretmez.
// - roundaboutExitNumber yalnızca kavşak ("Kavşağa girin, N. çıkış") metnidir; otoyol çıkışı (exit) olayı DEĞİLDİR.
// - fromTomTom her girdide boş tomtom modeli; adaptEvidence('tomtom') daima unverified, records 0.
// - roadEventsAdapt.js / roadEvents.js hiçbir çalışma zamanı dosyasına bağlı değildir.
// - Girdideki sahte anahtar, Premium/yetki iddiası ya da işaretli değerler çıktılara sızmaz.
// Sentetik girdiler yalnızca route.js'in BUGÜN zaten okuduğu alanları (legs[].points, sections[].sectionType TRAFFIC/SPEED_LIMIT,
// guidance.instructions[]) taşır. Ek "olay benzeri" alanlar bilerek UYDURMADIR (SYNTH_ önekli ya da yalnızca FIELD_EVIDENCE'taki
// doğrulanmamış aday adlar): gerçek TomTom şeması varsayılmaz; testler yalnızca "bu ekler çıktıyı DEĞİŞTİRMEZ" der.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// Ağ engeli (sağlayıcı çağrısı olamaz)
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };
// Tarayıcı nesneleri sahte (route.js modül zinciri localStorage/document ister; test-tomtom-route.mjs ile aynı yaklaşım)
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document = { dispatchEvent() {}, addEventListener() {} };
process.env.TOMTOM_BASE = 'https://synthetic.invalid'; // sunucu modülü yalnızca sahte fetchImpl ile çağrılır

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const R = await import('../js/tomtom/route.js');
const A = await import('../js/nav/roadEventsAdapt.js');
const E = await import('../js/nav/roadEvents.js');
const M = await import('../js/nav/routeMeta.js');
const S = await import('../server/tomtom.mjs');
const J = (x) => JSON.stringify(x);
const deepFrozen = (o) => (o === null || typeof o !== 'object') ? true : Object.isFrozen(o) && Object.values(o).every(deepFrozen);
const clone = (o) => JSON.parse(J(o));

// ---- Sahte, işaretli değerler (gerçek değildir; sızıntı taraması için) ----
const LAT = 40.0123457, LNG = 28.0876543; // uydurma
const FAKE_CRED = ['SYNTH', 'FAKE', 'CRED', '0000'].join('-');
const credField = 'api' + 'Key'; // statik sır taramalarına takılmamak için hesaplanır; değer sahtedir
const P = (lat, lon) => ({ latitude: lat, longitude: lon });

// Temel sentetik rota: yalnızca route.js'in bugün okuduğu alanlar.
const base = {
  _synthetic: true,
  routes: [{
    summary: { lengthInMeters: 4000, travelTimeInSeconds: 400, historicTrafficTravelTimeInSeconds: 380 },
    legs: [{ points: [P(LAT, LNG), P(40.02, 28.1), P(40.03, 28.1), P(40.04, 28.1), P(40.05, 28.1)] }],
    sections: [
      { sectionType: 'TRAFFIC', simpleCategory: 'JAM', magnitudeOfDelay: 2, delayInSeconds: 90, startPointIndex: 1, endPointIndex: 3 },
      { sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 90, startPointIndex: 0, endPointIndex: 4 },
    ],
    guidance: { instructions: [
      { routeOffsetInMeters: 0, travelTimeInSeconds: 0, maneuver: 'DEPART', street: 'SYN Cadde' },
      { routeOffsetInMeters: 1000, travelTimeInSeconds: 100, maneuver: 'ROUNDABOUT_RIGHT', street: 'SYN Kavşak', roundaboutExitNumber: 3 },
      { routeOffsetInMeters: 2500, travelTimeInSeconds: 250, maneuver: 'TAKE_EXIT', street: 'SYN Yol' },
      { routeOffsetInMeters: 4000, travelTimeInSeconds: 400, maneuver: 'ARRIVE', street: 'SYN Varış' },
    ] },
  }],
};

// Zenginleştirilmiş: temel + UYDURMA olay benzeri ekler. Adlar doğrulanmış şema DEĞİLDİR; yalnızca "yok sayılır mı" sınaması.
const SYN_SECTION_TYPES = ['SYNTH_TUNNEL', 'SYNTH_BRIDGE', 'SYNTH_UNDERPASS', 'SYNTH_OVERPASS', 'SYNTH_TOLL', 'SYNTH_LANES', 'SYNTH_SIGN'];
function enriched() {
  const x = clone(base);
  const r = x.routes[0];
  Object.assign(x, { provider: 'tomtom', premium: true, entitlement: 'premium', tier: 'premium', status: 'verified', verified: true, records: 99, [credField]: FAKE_CRED });
  for (const t of SYN_SECTION_TYPES) r.sections.push({ sectionType: t, startPointIndex: 1, endPointIndex: 2, SYNTH_note: FAKE_CRED });
  r.roadEvents = [{ kind: 'tunnel', source: 'tomtom', fromM: 0, toM: 100 }, { kind: 'toll', source: 'tomtom', atM: 5 }];
  r.SYNTH_flags = { tunnel: true, toll: true, bridge: true };
  const ins = r.guidance.instructions;
  // FIELD_EVIDENCE'taki doğrulanmamış aday adlar (exitNumber, signpostText) + SYNTH_ alanlar: route.js bunları okumamalı.
  Object.assign(ins[2], { exitNumber: 'SYNTH-EXIT-42', signpostText: 'SYNTH tunnel toll exit sign', SYNTH_lanes: [{ dir: 'x' }], message: 'SYNTH tunnel ahead ' + FAKE_CRED });
  Object.assign(ins[1], { exitNumber: 'SYNTH-RB-7', signpostText: 'SYNTH roundabout sign', message: 'SYNTH toll ahead' });
  return x;
}
const LEAKS = [FAKE_CRED, 'SYNTH', 'premium', 'entitlement', 'verified'];
const leaksIn = (o) => LEAKS.filter((s) => J(o).includes(s));
const ROAD_WORDS = /tunnel|tünel|bridge|köprü|underpass|overpass|alt geçit|üst geçit|toll|gişe|signpost|tabela|exitNumber|lanes?\b|şerit|roadEvents|routeMeta/i;

// ---- 1. convertRoute: yalnızca trafik + hız limiti; olay benzeri ekler çıktıyı DEĞİŞTİRMEZ ----
const outBase = R.convertRoute(clone(base), true);
const enr = enriched();
const enrBefore = J(enr);
const outEnr = R.convertRoute(enr, true);
const OUT_KEYS = ['coords', 'distanceKm', 'durationH', 'intervals', 'limitSpans', 'live', 'steps', 'trafficRatio', 'trafficSpans'];
ok('convertRoute çıktı anahtarları yalnızca bilinen rota alanları', J(Object.keys(outBase).sort()) === J(OUT_KEYS), Object.keys(outBase).join(','));
ok('trafik bölümü kullanılır (trafficSpans dolu)', outBase.trafficSpans.length > 0);
ok('hız limiti bölümü kullanılır (limitSpans dolu, 90)', outBase.limitSpans.length > 0 && outBase.limitSpans.every((s) => s[4] === 90));
ok('uydurma olay/şerit/tabela ekleri çıktıyı birebir değiştirmez', J(outEnr) === J(outBase));
ok('çıktıda roadEvents/routeMeta/tünel/gişe/şerit/tabela anahtarı yok', !ROAD_WORDS.test(J(Object.keys(outEnr))) && outEnr.steps.every((s) => !ROAD_WORDS.test(J(Object.keys(s)))));
ok('çıktıya sahte anahtar / SYNTH / Premium iddiası sızmaz', leaksIn(outEnr).length === 0, leaksIn(outEnr).join(','));
ok('convertRoute girdiyi değiştirmez', J(enr) === enrBefore);
const STEP_KEYS = ['distM', 'modifier', 'road', 'staticSec', 'text', 'type'];
ok('adım alanları yalnızca type/modifier/text/road/distM/staticSec (+ arrive)', outEnr.steps.slice(0, -1).every((s) => J(Object.keys(s).sort()) === J(STEP_KEYS)));
ok('prem=false: limitSpans yok, trafik yine var', !('limitSpans' in R.convertRoute(enriched(), false)) && R.convertRoute(enriched(), false).trafficSpans.length > 0);
// Bilinmeyen sectionType'lar trafik/hız limiti üretmez (yalnız SYNTH bölümler)
const onlySyn = clone(base);
onlySyn.routes[0].sections = SYN_SECTION_TYPES.map((t) => ({ sectionType: t, startPointIndex: 0, endPointIndex: 4, magnitudeOfDelay: 3, delayInSeconds: 999, maxSpeedLimitInKmh: 50 }));
const outSyn = R.convertRoute(onlySyn, true);
ok('bilinmeyen sectionType trafik aralığı üretmez', R.trafficSpans(onlySyn.routes[0].sections, onlySyn.routes[0].legs[0].points.map((p) => [p.latitude, p.longitude])).length === 0 && outSyn.trafficSpans.length === 0);
ok('bilinmeyen sectionType hız limiti üretmez', outSyn.limitSpans.length === 0);

// ---- 2. roundaboutExitNumber otoyol çıkışı DEĞİLDİR; çıkış numarası/tabela okunmaz ----
const rb = outEnr.steps[1];
ok('ROUNDABOUT_* → roundabout adımı (off ramp değil)', rb.type === 'roundabout' && rb.modifier === null);
ok('roundaboutExitNumber yalnızca kavşak metninde', rb.text === R.mapSteps([{ maneuver: 'ROUNDABOUT_RIGHT', roundaboutExitNumber: 3 }], 0, 0)[0].text && /3\. çıkış/.test(rb.text));
ok('kavşak adımında exitNumber/signpost değeri yok', !/SYNTH-RB-7|SYNTH roundabout/.test(J(rb)));
const tx = outEnr.steps[2];
ok('TAKE_EXIT → off ramp, metin exitNumber/signpostText olmadan aynı', tx.type === 'off ramp' && tx.text === outBase.steps[2].text && !/SYNTH-EXIT-42|SYNTH tunnel/.test(J(tx)));
ok('off ramp metni roundaboutExitNumber verilse bile çıkış numarası içermez',
  R.mapSteps([{ maneuver: 'TAKE_EXIT', street: '', roundaboutExitNumber: 5 }], 0, 0)[0].text === R.mapSteps([{ maneuver: 'TAKE_EXIT', street: '' }], 0, 0)[0].text);
const evFromRb = A.fromTomTom({ _synthetic: true, routes: [{ guidance: { instructions: [{ maneuver: 'ROUNDABOUT_LEFT', roundaboutExitNumber: 2 }] } }] });
ok('roundaboutExitNumber hiçbir exit olayı üretmez', evFromRb.events.length === 0 && !evFromRb.supports.includes('exit'));

// ---- 3. fromTomTom boş, adaptEvidence unverified ----
const emptyTT = E.emptyEvents('tomtom', { supports: [] });
const ttInputs = [undefined, null, {}, 0, 'x', [], clone(base), enriched(), outEnr, { _synthetic: true, status: 'verified', verified: true, records: 5 }];
ok('fromTomTom her girdide boş tomtom modeli', ttInputs.every((x) => J(A.fromTomTom(x)) === J(emptyTT) && A.fromTomTom(x).provider === 'tomtom'));
ok('fromTomTom çıktısı derin dondurulmuş', deepFrozen(A.fromTomTom(enriched())));
ok('fromTomTom çıktısına koordinat/anahtar/SYNTH sızmaz', [String(LAT), String(LNG), ...LEAKS].every((s) => !J(A.fromTomTom(enriched())).includes(s)));
let touches = 0;
const trap = new Proxy(enriched(), { get(t, k, r) { touches++; return Reflect.get(t, k, r); }, has(t, k) { touches++; return Reflect.has(t, k); }, ownKeys(t) { touches++; return Reflect.ownKeys(t); } });
A.fromTomTom(trap);
ok('fromTomTom girdiye hiç dokunmaz', touches === 0, String(touches));
const evs = ttInputs.map((x) => A.adaptEvidence('tomtom', x));
ok('adaptEvidence(tomtom) her girdide unverified, records 0', evs.every((e) => e.provider === 'tomtom' && e.status === 'unverified' && e.records === 0));
ok('adaptEvidence(tomtom) alanlarının tümü unverified, evidence null', evs.every((e) => e.fields.length > 0 && e.fields.every((f) => f.status === 'unverified' && f.records === 0 && f.evidence === null)));
ok('adaptEvidence(tomtom) çıktısına girdi değeri sızmaz', evs.every((e) => leaksIn(e).filter((s) => s !== 'verified').length === 0 && !J(e).includes(String(LAT))));
ok('adaptEvidence(tomtom) synthetic yalnızca _synthetic === true', A.adaptEvidence('tomtom', enriched()).synthetic === true && A.adaptEvidence('tomtom', outEnr).synthetic === false);

// ---- 4. Model düzeyi: tomtom yeteneksiz; rota üst verisi tünel/köprü/şerit 'unsupported' ----
ok('routeMeta DEFAULT_CAPS.tomtom boş', Array.isArray(M.DEFAULT_CAPS.tomtom) && M.DEFAULT_CAPS.tomtom.length === 0);
const meta = M.emptyMeta('tomtom');
ok('emptyMeta(tomtom): lanes/tunnel/bridge/underpass/overpass unsupported', ['lanes', 'tunnel', 'bridge', 'underpass', 'overpass'].every((a) => M.attrStatus(meta, a) === 'unsupported'));
let mm = E.emptyEvents('tomtom');
for (const ev of [
  { kind: 'tunnel', source: 'tomtom', fromM: 0, toM: 10 }, { kind: 'bridge', source: 'tomtom', fromM: 0, toM: 10 },
  { kind: 'underpass', source: 'tomtom', fromM: 0, toM: 10 }, { kind: 'overpass', source: 'tomtom', fromM: 0, toM: 10 },
  { kind: 'toll', source: 'tomtom', atM: 5 }, { kind: 'exit', source: 'tomtom', atM: 5, ref: '3' }, { kind: 'sign', source: 'tomtom', atM: 5, text: ['X'] },
]) mm = E.addEvent(mm, ev);
ok('emptyEvents(tomtom): 7 olay türü de unsupported ile reddedilir', mm.events.length === 0 && mm.denied.length === 7 && mm.denied.every((d) => d.reason === 'unsupported'));
ok('eventsAhead(tomtom) boş', E.eventsAhead(mm, 0).length === 0);

// ---- 5. Sunucu isteği: yalnızca traffic + speedLimit bölümleri istenir (sahte fetchImpl; ağ yok) ----
let reqUrl = null;
const fakeFetch = async (u) => { reqUrl = new URL(String(u)); return { ok: true, status: 200, json: async () => clone(base) }; };
await S.tomtomRoute(FAKE_CRED, '40.10000,28.10000:40.20000,28.20000', { fetchImpl: fakeFetch });
const sect = reqUrl ? reqUrl.searchParams.getAll('sectionType').sort() : [];
ok('sunucu yalnızca sectionType=traffic,speedLimit ister', J(sect) === J(['speedLimit', 'traffic']), J(sect));
ok('sunucu isteği sentetik tabana gider (gerçek uç nokta yok)', reqUrl && reqUrl.hostname === 'synthetic.invalid');
let err = null;
try { await S.tomtomRoute(FAKE_CRED, '40.10000,28.10000:40.20000,28.20000', { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }); } catch (e) { err = e; }
ok('sunucu hata iletisinde sahte anahtar yok', err && !String(err.message).includes(FAKE_CRED) && !J(err).includes(FAKE_CRED));

// ---- 6. Statik: çalışma zamanı bağlantısı ve sesli uyarı yok ----
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const routeCode = strip(read('js/tomtom/route.js'));
ok('route.js yalnızca TRAFFIC ve SPEED_LIMIT bölüm türlerini adlandırır', J([...new Set(routeCode.match(/sectionType === '([A-Z_]+)'/g) || [])].sort()) === J(["sectionType === 'SPEED_LIMIT'", "sectionType === 'TRAFFIC'"]));
// roundaboutExitNumber (yalnız kavşak metni, bölüm 2'de sınanır) dışarıda tutulur; kalan kodda yol olayı adı geçmez.
ok('route.js kodu tünel/köprü/gişe/şerit/tabela/exitNumber/roadEvents işlemez',
  !ROAD_WORDS.test(routeCode.replace(/['"`][^'"`\n]*['"`]/g, '').replace(/\broundaboutExitNumber\b/g, '')));
ok('route.js ses modülünü içe aktarmaz', !/voice\.js|speak\s*\(/.test(routeCode));
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'data'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => relative(root, p).replace(/\\/g, '/');
const runtime = [...walk(join(root, 'js')), ...walk(join(root, 'server')), join(root, 'index.html'), join(root, 'sw.js')]
  .filter((p) => /\.(m?js|html)$/.test(p));
ok('tarama çalışma zamanı dosyalarını kapsar', runtime.length > 20 && runtime.some((p) => rel(p) === 'sw.js') && runtime.some((p) => rel(p).startsWith('server/')));
const importersOf = (re, self) => runtime.filter((p) => rel(p) !== self && re.test(readFileSync(p, 'utf8'))).map(rel);
const adaptImp = importersOf(/roadEventsAdapt/, 'js/nav/roadEventsAdapt.js');
ok('roadEventsAdapt hiçbir çalışma zamanı dosyasına bağlı değil', adaptImp.length === 0, adaptImp.join(', '));
// v0.99.102: roadEvents.js yalnız Valhalla (osm) tünel/gişe yoluna bağlıdır; TomTom yolunda hiçbir bağlantı yoktur (dar izin listesi).
const evImp = importersOf(/nav\/roadEvents\.js|\.\/roadEvents\.js/, 'js/nav/roadEvents.js').sort();
ok('roadEvents.js yalnız roadAlerts + valhallaRoadEvents (+ sw.js kabuğu) tarafından içe aktarılır; TomTom yolu yok', J(evImp) === J(['js/nav/roadAlerts.js', 'js/nav/valhallaRoadEvents.js', 'sw.js']), evImp.join(', '));
const speakers = runtime.filter((p) => /\bspeak\s*\(/.test(strip(readFileSync(p, 'utf8'))));
ok('sesli uyarı çağıranlar bulundu (tarama boş değil)', speakers.length > 0);
const roadSpeakers = speakers.filter((p) => /roadEventsAdapt|tomtom\/route\.js|exitNumber|signpost|roundaboutExitNumber/.test(readFileSync(p, 'utf8'))).map(rel);
ok('hiçbir sesli uyarı modülü TomTom rota alanı / bağdaştırıcı okumaz', roadSpeakers.length === 0, roadSpeakers.join(', '));
// v0.99.102: yol olayı modelini konuşan TEK modül roadWarnings (Valhalla tünel/gişe); TomTom adı geçmez.
const evSpeakers = speakers.filter((p) => /roadEvents/.test(readFileSync(p, 'utf8'))).map(rel);
ok('yol olayı sesli uyarısı yalnız roadWarnings.js (TomTom alanı okumaz)', J(evSpeakers) === J(['js/nav/roadWarnings.js']) && !/tomtom/i.test(strip(read('js/nav/roadWarnings.js'))), evSpeakers.join(', '));
const rbUsers = runtime.filter((p) => /roundaboutExitNumber/.test(readFileSync(p, 'utf8'))).map(rel);
ok('roundaboutExitNumber yalnızca js/tomtom/route.js içinde', J(rbUsers) === J(['js/tomtom/route.js']), rbUsers.join(', '));

// ---- 7. Belge ----
const docPath = 'docs/road-events-tomtom-contract.md';
ok('sözleşme belgesi var', existsSync(join(root, docPath)));
if (existsSync(join(root, docPath))) {
  const doc = read(docPath);
  ok('belge unverified / lisans / gerçek kayıt / roundaboutExitNumber anar', /unverified/.test(doc) && /lisans/i.test(doc) && /gerçek kayıt/i.test(doc) && /roundaboutExitNumber/.test(doc));
  ok('belgede anahtar/sır yok', !/(key|token|secret)\s*[:=]\s*\S{8,}/i.test(doc) && !/AIza|pk\.eyJ|sk\.eyJ/.test(doc));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
