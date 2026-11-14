// Google Routes / HERE yol olayları bağdaştırıcı SÖZLEŞMESİ testleri (yalnız test + belge; bağımlılıksız, düz node):
//   node scripts/test-road-events-google-here-contract.mjs
// Bugünkü sözleşme (docs/road-events-google-here-contract.md): Google ve HERE için yol olayları bağdaştırıcısı YOKTUR.
// - js/nav/roadEventsAdapt.js google/here'i ADAPTER_PROVIDERS'a, FIELD_EVIDENCE'a ya da fromGoogle/fromHere işlevine almaz.
// - adaptEvidence('google'|'here', herhangi) → provider null, alan yok, unverified, records 0 (sentetik ya da "verified" iddialı olsa bile).
// - Mevcut bağdaştırıcılar Google/HERE BENZERİ (uydurma, şeması doğrulanmamış) girdiyi okumaz: 0 olay, 0 yetenek.
// - Yol olayları modelinde google/here yalnızca boş, yeteneksiz model olabilir; her olay unsupported / cross-provider ile reddedilir.
// - Çıktıya girdiden koordinat, geometri (polyline), sahte anahtar ya da Premium/yetki iddiası SIZMAZ.
// - Hiçbir çalışma zamanı dosyası (js/server/index.html/sw.js) Google/HERE yol olayı bağdaştırıcısı tanımlamaz. Ağ engellidir.
// Girdi örnekleri bilerek UYDURMADIR (_synthetic): gerçek Google Routes / HERE Routing yanıt şeması varsayılmaz ve kodlanmaz.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// Ağ engeli
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const A = await import('../js/nav/roadEventsAdapt.js');
const E = await import('../js/nav/roadEvents.js');
const J = (x) => JSON.stringify(x);
const NEW = ['google', 'here'];
const ADAPT = { osm: A.fromOsm, mapbox: A.fromMapbox, tomtom: A.fromTomTom };
const emptyFor = (p) => E.emptyEvents(p, { supports: [] });
const deepFrozen = (o) => (o === null || typeof o !== 'object') ? true : Object.isFrozen(o) && Object.values(o).every(deepFrozen);

// ---- Sahte, işaretli değerler (gerçek değildir; sızıntı taraması için) ----
const LAT = 41.0123457, LNG = 28.9876543; // uydurma
const POLY = 'SYNTH_POLYLINE_zzz_do_not_leak';
const FAKE_CRED = ['SYNTH', 'FAKE', 'CRED', '0000'].join('-');
const credField = 'api' + 'Key'; // statik sır taramalarına takılmamak için hesaplanır; değer sahtedir
// Uydurma Google benzeri ve HERE benzeri girdiler: alan adları yalnız "bilinmeyen şekil" sınaması içindir, doğrulanmış şema DEĞİLDİR.
const shapes = {
  google: {
    _synthetic: true, provider: 'google', supports: ['tunnel', 'toll', 'exit', 'sign'],
    premium: true, entitlement: 'premium', tier: 'premium', status: 'verified', verified: true, records: 99,
    [credField]: FAKE_CRED,
    routes: [{ polyline: { encodedPolyline: POLY }, legs: [{ steps: [{ startLocation: { latLng: { latitude: LAT, longitude: LNG } },
      navigationInstruction: { maneuver: 'SYNTH_EXIT', instructions: 'SYNTH tunnel toll exit sign' } }] }],
      travelAdvisory: { tollInfo: { synth: true } } }],
    events: [{ kind: 'tunnel', source: 'google', fromM: 0, toM: 100 }],
  },
  here: {
    _synthetic: true, provider: 'here', supports: ['tunnel', 'toll', 'exit', 'sign'],
    premium: true, entitlement: 'premium', tier: 'premium', status: 'verified', verified: true, records: 99,
    [credField]: FAKE_CRED,
    routes: [{ sections: [{ polyline: POLY, departure: { place: { location: { lat: LAT, lng: LNG } } },
      actions: [{ action: 'SYNTH_exit', instruction: 'SYNTH tunnel toll exit sign' }],
      tolls: [{ synth: true }], notices: [{ code: 'SYNTH' }], spans: [{ offset: 0, synthTunnel: true }] }] }],
    events: [{ kind: 'toll', source: 'here', atM: 5 }],
  },
};
const LEAKS = [String(LAT), String(LNG), POLY, FAKE_CRED, 'premium', 'entitlement', 'SYNTH'];
const leaksIn = (o) => LEAKS.filter((s) => J(o).includes(s));

// ---- 1. Bağdaştırıcı kaydı: google/here YOK (fail-closed sözleşme) ----
ok('ADAPTER_PROVIDERS google/here içermez', NEW.every((p) => !A.ADAPTER_PROVIDERS.includes(p)));
ok('FIELD_EVIDENCE google/here içermez (alan kanıtı yok)', NEW.every((p) => !(p in A.FIELD_EVIDENCE)));
ok('fromGoogle/fromHere dışa aktarılmaz', !('fromGoogle' in A) && !('fromHere' in A) && !('fromGoogleRoutes' in A) && !('fromHereRouting' in A));
ok('google/here yol olayları modelinin PROVIDERS listesinde (model tanır, bağdaştırıcı yok)', NEW.every((p) => E.PROVIDERS.includes(p)));

// ---- 2. adaptEvidence: google/here her girdide provider null, unverified ----
for (const p of NEW) {
  const inputs = [undefined, null, {}, 0, 'x', [], shapes[p], { _synthetic: true, status: 'verified', verified: true, records: 5 }, { routes: [] }];
  const all = inputs.map((x) => A.adaptEvidence(p, x));
  ok(`${p}: adaptEvidence → provider null, alan yok`, all.every((e) => e.provider === null && Array.isArray(e.fields) && e.fields.length === 0));
  ok(`${p}: adaptEvidence → status unverified, records 0`, all.every((e) => e.status === 'unverified' && e.records === 0));
  ok(`${p}: adaptEvidence çıktısı derin dondurulmuş`, all.every(deepFrozen));
  ok(`${p}: adaptEvidence çıktısına girdi değeri sızmaz`, all.every((e) => leaksIn(e).length === 0), leaksIn(all[6]).join(','));
  const before = J(shapes[p]);
  A.adaptEvidence(p, shapes[p]);
  ok(`${p}: adaptEvidence girdiyi değiştirmez`, J(shapes[p]) === before);
}
for (const v of ['GOOGLE', 'Here', ' here', 'google-routes', 'here-routing', 'gmaps']) {
  ok(`benzer ad "${v}" bağdaştırıcı sağlayıcı sayılmaz`, A.adaptEvidence(v, shapes.google).provider === null);
}

// ---- 3. Mevcut bağdaştırıcılar Google/HERE benzeri bilinmeyen şekli okumaz: 0 olay ----
for (const [ap, fn] of Object.entries(ADAPT)) {
  for (const p of NEW) {
    let touches = 0;
    const trap = new Proxy(shapes[p], {
      get(t, k, r) { touches++; return Reflect.get(t, k, r); }, has(t, k) { touches++; return Reflect.has(t, k); },
      ownKeys(t) { touches++; return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { touches++; return Reflect.getOwnPropertyDescriptor(t, k); },
    });
    const m = fn(trap);
    ok(`${ap}(${p} benzeri): ${ap} boş modeli, 0 olay/yetenek`, J(m) === J(emptyFor(ap)) && m.provider === ap, J(m));
    ok(`${ap}(${p} benzeri): girdiye hiç dokunulmaz`, touches === 0, String(touches));
    ok(`${ap}(${p} benzeri): çıktıya koordinat/geometri/anahtar/yetki sızmaz`, leaksIn(m).length === 0, leaksIn(m).join(','));
    ok(`${ap}(${p} benzeri): provider iddiası benimsenmez`, !NEW.includes(m.provider));
  }
}

// ---- 4. Yol olayları modeli: google/here yalnız boş ve yeteneksiz ----
for (const p of NEW) {
  const m = E.emptyEvents(p);
  ok(`${p}: emptyEvents → provider ${p}, supports [], events []`, m.provider === p && m.supports.length === 0 && m.events.length === 0 && m.denied.length === 0);
  let mm = m;
  const evs = [{ kind: 'tunnel', source: p, fromM: 0, toM: 10 }, { kind: 'toll', source: p, atM: 5 }, { kind: 'exit', source: p, atM: 5, ref: '1' }, { kind: 'sign', source: p, atM: 5, text: ['X'] }];
  for (const ev of evs) mm = E.addEvent(mm, ev);
  ok(`${p}: yeteneksiz modelde tüm olaylar unsupported`, mm.events.length === 0 && mm.denied.length === 4 && mm.denied.every((d) => d.reason === 'unsupported'));
  ok(`${p}: eventsAhead boş`, E.eventsAhead(mm, 0).length === 0);
  const other = p === 'google' ? 'here' : 'google';
  const cross = E.addEvent(E.emptyEvents(p, { supports: ['toll'] }), { kind: 'toll', source: other, atM: 1 });
  ok(`${p}: ${other} kaynaklı olay cross-provider ile reddedilir`, cross.events.length === 0 && cross.denied[0].reason === 'cross-provider');
  for (const ap of A.ADAPTER_PROVIDERS) {
    const x = E.addEvent(E.emptyEvents(ap, { supports: ['toll'] }), { kind: 'toll', source: p, atM: 1 });
    ok(`${ap} modeline ${p} olayı girmez (cross-provider)`, x.events.length === 0 && x.denied[0].reason === 'cross-provider');
  }
  const inf = E.addEvent(E.emptyEvents(p, { supports: ['toll'] }), { kind: 'toll', source: 'gps-loss', atM: 1 });
  ok(`${p}: çıkarım kaynağı (gps-loss) reddedilir`, inf.events.length === 0 && inf.denied[0].reason === 'inferred-source');
}

// ---- 5. Statik: bağdaştırıcı modülü değişmeden saf; google/here adı geçmez ----
const src = read('js/nav/roadEventsAdapt.js');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('bağdaştırıcı kodu google/here adı içermez', !/\b(google|here)\b/i.test(code));
ok('bağdaştırıcı kodu içe aktarma yapmaz', !/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(code));
ok('bağdaştırıcı kodu ağ/DOM/ortam/yetki kullanmaz', !/\b(fetch|XMLHttpRequest|WebSocket|document|window|localStorage|process|globalThis|premium|entitlement|tier|plan)\b/i.test(code));

// ---- 6. Çalışma zamanı: Google/HERE yol olayı bağdaştırıcısı tanımı/çağrısı yok ----
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
// fromGoogle/fromHere adları bugün YALNIZCA şarj istasyonu normalleştiricilerinde vardır (yol olaylarıyla ilgisiz); başka yerde olamaz.
const CHARGER_NORMALIZERS = ['js/google/chargers.js', 'js/here/chargers.js'];
const hits = runtime.filter((p) => /\b(fromGoogle|fromHere)\b/.test(readFileSync(p, 'utf8'))).map(rel).sort();
ok('fromGoogle/fromHere yalnızca şarj normalleştiricilerinde (yol olayı bağdaştırıcısı yok)', J(hits) === J(CHARGER_NORMALIZERS), hits.join(', '));
const routeHits = runtime.filter((p) => /\b(fromGoogleRoutes|fromHereRouting|googleRoadEvents|hereRoadEvents)\b/.test(readFileSync(p, 'utf8'))).map(rel);
ok('hiçbir çalışma zamanı dosyası Google/HERE rota olayı bağdaştırıcısı tanımlamaz', routeHits.length === 0, routeHits.join(', '));
for (const f of CHARGER_NORMALIZERS) {
  const s = read(f);
  ok(`${f}: yol olayları modülüne bağlı değil`, !/roadEvents|roadEventsAdapt|routeMeta/.test(s));
}
const importers = runtime.filter((p) => rel(p) !== 'js/nav/roadEventsAdapt.js' && /roadEventsAdapt/.test(readFileSync(p, 'utf8'))).map(rel);
ok('bağdaştırıcı hâlâ hiçbir çalışma zamanı dosyasına bağlı değil', importers.length === 0, importers.join(', '));

// ---- 7. Belge var ve kapıları listeler ----
const docPath = 'docs/road-events-google-here-contract.md';
ok('sözleşme belgesi var', existsSync(join(root, docPath)));
if (existsSync(join(root, docPath))) {
  const doc = read(docPath);
  ok('belge unverified / lisans / gerçek kayıt kapılarını anar', /unverified/.test(doc) && /lisans/i.test(doc) && /gerçek kayıt/i.test(doc));
  ok('belgede anahtar/sır yok', !/(key|token|secret)\s*[:=]\s*\S{8,}/i.test(doc) && !/AIza|pk\.eyJ|sk\.eyJ/.test(doc));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
