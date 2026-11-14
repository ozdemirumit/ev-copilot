// Sağlayıcı yol olayları bağdaştırıcı iskeleti testleri (BL-P2-05a; bağımlılıksız, düz node): node scripts/test-road-events-adapt.mjs
// Fail-closed: fromOsm/fromMapbox/fromTomTom sağlayıcıya özgü BOŞ modeli (emptyEvents(p, { supports: [] }) ile birebir aynı) döndürür.
// Sentetik örneklerde (scripts/fixtures/road-events/*-synthetic.json) tünel/sınıf/gişe/çıkış/tabela alanları olsa bile 0 olay, 0 yetenek.
// FIELD_EVIDENCE alanlarının tümü unverified; gerçek kayıt yok; _synthetic girdi asla verified olamaz. Ağ engellidir.
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
const { fromOsm, fromMapbox, fromTomTom, FIELD_EVIDENCE, ADAPTER_PROVIDERS, MODEL_VERSION, adaptEvidence } = A;
const J = (x) => JSON.stringify(x);
const deepFrozen = (o) => {
  if (o === null || typeof o !== 'object') return true;
  if (!Object.isFrozen(o)) return false;
  return Object.values(o).every(deepFrozen);
};
const deepFreeze = (o) => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
const fixture = (p) => JSON.parse(read(`scripts/fixtures/road-events/${p}-synthetic.json`));
const ADAPT = { osm: fromOsm, mapbox: fromMapbox, tomtom: fromTomTom };
const emptyFor = (p) => E.emptyEvents(p, { supports: [] });

// ---- Dışa aktarımlar / sabitler ----
ok('fromOsm/fromMapbox/fromTomTom işlev', [fromOsm, fromMapbox, fromTomTom].every((fn) => typeof fn === 'function'));
ok('ADAPTER_PROVIDERS = osm,mapbox,tomtom (dondurulmuş)', J(ADAPTER_PROVIDERS) === '["osm","mapbox","tomtom"]' && Object.isFrozen(ADAPTER_PROVIDERS));
ok('ADAPTER_PROVIDERS yol olayları modelinin PROVIDERS alt kümesi', ADAPTER_PROVIDERS.every((p) => E.PROVIDERS.includes(p)));
ok('MODEL_VERSION modelin sürümüyle aynı', MODEL_VERSION === E.ROAD_EVENTS_VERSION);

// ---- Sentetik örnekler gerçekten olay alanları içerir (test anlamlı olsun) ----
const tokens = ['tunnel', 'classes', 'toll_collection', 'exits', 'signpostText'];
for (const p of ADAPTER_PROVIDERS) {
  const raw = read(`scripts/fixtures/road-events/${p}-synthetic.json`);
  const fx = fixture(p);
  ok(`${p}: örnek _synthetic=true`, fx._synthetic === true);
  const missing = tokens.filter((t) => !new RegExp(`\\b${t}\\b`, 'i').test(raw));
  ok(`${p}: örnek tunnel/classes/toll_collection/exits/signpostText içerir`, missing.length === 0, missing.join(','));
  ok(`${p}: örnekte anahtar/sır yok`, !/(key|token|secret|access_token)\s*["']?\s*[:=]/i.test(raw) && !/pk\.eyJ|sk\.eyJ|AIza/.test(raw));
}

// ---- Fail-closed: 0 olay, 0 yetenek, sağlayıcıya özgü boş model ----
for (const p of ADAPTER_PROVIDERS) {
  const fx = fixture(p);
  const before = J(fx);
  const m = ADAPT[p](fx);
  ok(`${p}: provider = ${p}`, m.provider === p);
  ok(`${p}: 0 olay`, Array.isArray(m.events) && m.events.length === 0);
  ok(`${p}: 0 yetenek (supports [])`, Array.isArray(m.supports) && m.supports.length === 0);
  ok(`${p}: denied boş`, Array.isArray(m.denied) && m.denied.length === 0);
  ok(`${p}: emptyEvents(p, { supports: [] }) ile birebir aynı`, J(m) === J(emptyFor(p)), J(m));
  ok(`${p}: anahtar sırası modelle aynı`, J(Object.keys(m)) === J(Object.keys(emptyFor(p))));
  ok(`${p}: çıktı derin dondurulmuş`, deepFrozen(m));
  ok(`${p}: girdi değişmedi`, J(fx) === before);
  ok(`${p}: eventsAhead boş`, E.eventsAhead(m, 0).length === 0);
  // Model geçerli: addEvent kabul eder ama yetenek olmadığından her olay 'unsupported' ile reddedilir
  let mm = m;
  for (const ev of [{ kind: 'tunnel', source: p, fromM: 0, toM: 10 }, { kind: 'toll', source: p, atM: 5 }, { kind: 'exit', source: p, atM: 5, ref: '12' }, { kind: 'sign', source: p, atM: 5, text: ['X'] }]) {
    mm = E.addEvent(mm, ev);
  }
  ok(`${p}: aşağı akışta tüm olaylar unsupported reddedilir`, mm.events.length === 0 && mm.denied.length === 4 && mm.denied.every((d) => d.reason === 'unsupported'));
  ok(`${p}: addEvent orijinal çıktıyı değiştirmez`, m.events.length === 0 && m.denied.length === 0);
  // Çıktıya yazılamaz (ESM katı kip)
  let threw = 0;
  for (const fn of [() => { m.events.push(1); }, () => { m.supports.push('tunnel'); }, () => { m.provider = 'x'; }, () => { m.extra = 1; }]) { try { fn(); } catch { threw++; } }
  ok(`${p}: çıktı değiştirilemez`, threw === 4 && J(m) === J(emptyFor(p)));
}

// ---- Sağlayıcı kaynağı (provenance): girdi iddiası benimsenmez ----
{
  const claim = { _synthetic: true, provider: 'tomtom', source: 'tomtom', supports: ['tunnel', 'toll', 'exit', 'sign'], events: [{ kind: 'tunnel', source: 'tomtom', fromM: 0, toM: 100 }] };
  for (const p of ADAPTER_PROVIDERS) {
    const m = ADAPT[p](claim);
    ok(`${p}: girdideki provider/supports/events iddiası yok sayılır`, m.provider === p && m.supports.length === 0 && m.events.length === 0);
  }
  ok('çapraz örnek: fromMapbox(tomtom örneği) → mapbox, boş', J(fromMapbox(fixture('tomtom'))) === J(emptyFor('mapbox')));
  ok('çapraz örnek: fromTomTom(mapbox örneği) → tomtom, boş', J(fromTomTom(fixture('mapbox'))) === J(emptyFor('tomtom')));
  ok('çapraz örnek: fromOsm(tomtom örneği) → osm, boş', J(fromOsm(fixture('tomtom'))) === J(emptyFor('osm')));
}

// ---- Geçersiz/eksik girdi → yine boş model, istisna yok ----
for (const p of ADAPTER_PROVIDERS) {
  const bad = [undefined, null, 0, 42, NaN, '', 'x', true, [], {}, { routes: null }, { routes: [{}] }, () => 1, Symbol('s')];
  let allOk = true, threw = false;
  for (const b of bad) {
    try { if (J(ADAPT[p](b)) !== J(emptyFor(p))) allOk = false; } catch { threw = true; }
  }
  ok(`${p}: geçersiz girdiler boş model döndürür, istisna yok`, allOk && !threw);
}

// ---- Girdi değişmezliği: girdi hiç okunmaz/yazılmaz ----
for (const p of ADAPTER_PROVIDERS) {
  const frozen = deepFreeze(fixture(p));
  let threw = false;
  try { ADAPT[p](frozen); } catch { threw = true; }
  ok(`${p}: dondurulmuş girdi istisna atmaz`, !threw);
  let touches = 0;
  const trap = new Proxy(fixture(p), {
    get(t, k, r) { touches++; return Reflect.get(t, k, r); },
    set() { touches++; return false; },
    has(t, k) { touches++; return Reflect.has(t, k); },
    ownKeys(t) { touches++; return Reflect.ownKeys(t); },
    getOwnPropertyDescriptor(t, k) { touches++; return Reflect.getOwnPropertyDescriptor(t, k); },
    defineProperty() { touches++; return false; },
    deleteProperty() { touches++; return false; },
    getPrototypeOf(t) { touches++; return Reflect.getPrototypeOf(t); },
  });
  ADAPT[p](trap);
  ok(`${p}: bağdaştırıcı girdiye hiç dokunmaz (fail-closed, ayrıştırma yok)`, touches === 0, String(touches));
}

// ---- Her çağrı bağımsız; sonuç belirlenimci ----
ok('aynı girdi → aynı çıktı', J(fromMapbox(fixture('mapbox'))) === J(fromMapbox(fixture('mapbox'))));

// ---- FIELD_EVIDENCE: değişmez, tüm alanlar unverified, gerçek kayıt yok ----
{
  ok('FIELD_EVIDENCE sağlayıcıları = ADAPTER_PROVIDERS', J(Object.keys(FIELD_EVIDENCE)) === J([...ADAPTER_PROVIDERS]));
  ok('FIELD_EVIDENCE derin dondurulmuş', deepFrozen(FIELD_EVIDENCE));
  const all = ADAPTER_PROVIDERS.flatMap((p) => FIELD_EVIDENCE[p]);
  ok('her sağlayıcıda en az bir alan', ADAPTER_PROVIDERS.every((p) => Array.isArray(FIELD_EVIDENCE[p]) && FIELD_EVIDENCE[p].length > 0));
  ok('tüm alanlar status=unverified', all.length > 0 && all.every((e) => e.status === 'unverified'));
  ok('hiçbir alanda gerçek kayıt yok (records 0, evidence null)', all.every((e) => e.records === 0 && e.evidence === null));
  ok('alan girdisi yalnızca field/status/records/evidence', all.every((e) => J(Object.keys(e)) === '["field","status","records","evidence"]' && typeof e.field === 'string' && e.field.trim() !== ''));
  ok('FIELD_EVIDENCE içinde "verified" durumu yok', !/"(verified|present|approved)"/.test(J(FIELD_EVIDENCE)));
  ok('sağlayıcı içinde alan tekrarı yok', ADAPTER_PROVIDERS.every((p) => new Set(FIELD_EVIDENCE[p].map((e) => e.field)).size === FIELD_EVIDENCE[p].length));
  const has = (p, s) => FIELD_EVIDENCE[p].some((e) => e.field.includes(s));
  ok('mapbox: classes/toll_collection/exits alanları listelenir', has('mapbox', 'classes') && has('mapbox', 'toll_collection') && has('mapbox', 'exits'));
  ok('osm: classes/exits alanları listelenir', has('osm', 'classes') && has('osm', 'exits'));
  ok('tomtom: sectionType/signpostText/exitNumber alanları listelenir', has('tomtom', 'sectionType') && has('tomtom', 'signpostText') && has('tomtom', 'exitNumber'));
  let threw = 0;
  for (const fn of [() => { FIELD_EVIDENCE.mapbox[0].status = 'verified'; }, () => { FIELD_EVIDENCE.osm.push({}); }, () => { FIELD_EVIDENCE.here = []; }]) { try { fn(); } catch { threw++; } }
  ok('FIELD_EVIDENCE değiştirilemez', threw === 3 && FIELD_EVIDENCE.mapbox[0].status === 'unverified' && !('here' in FIELD_EVIDENCE));
}

// ---- Kanıt durumu: _synthetic asla verified olamaz ----
{
  for (const p of ADAPTER_PROVIDERS) {
    const ev = adaptEvidence(p, fixture(p));
    ok(`${p}: sentetik örnek → synthetic true, status unverified, records 0`, ev.provider === p && ev.synthetic === true && ev.status === 'unverified' && ev.records === 0);
    ok(`${p}: kanıt alanları FIELD_EVIDENCE ile aynı`, ev.fields === FIELD_EVIDENCE[p]);
    ok(`${p}: kanıt nesnesi derin dondurulmuş`, deepFrozen(ev));
    const forged = { ...fixture(p), status: 'verified', _status: 'verified', verified: true, _verified: true, evidence: 'verified', records: 99 };
    const fv = adaptEvidence(p, forged);
    ok(`${p}: sahte "verified" iddiası yok sayılır (_synthetic)`, fv.status === 'unverified' && fv.synthetic === true && fv.records === 0);
    const real = adaptEvidence(p, { routes: [], status: 'verified', verified: true });
    ok(`${p}: _synthetic olmayan girdi de unverified (gerçek kayıt yok)`, real.status === 'unverified' && real.synthetic === false && real.records === 0);
    ok(`${p}: _synthetic yalnızca === true sayılır`, adaptEvidence(p, { _synthetic: 'true' }).synthetic === false && adaptEvidence(p, null).synthetic === false);
    const before = J(forged);
    adaptEvidence(p, forged);
    ok(`${p}: adaptEvidence girdiyi değiştirmez`, J(forged) === before);
  }
  const u = adaptEvidence('here', fixture('tomtom'));
  ok('bilinmeyen/bağdaştırıcısız sağlayıcı → provider null, alan yok, unverified', u.provider === null && u.fields.length === 0 && u.status === 'unverified');
  ok('adaptEvidence hiçbir girdide verified döndürmez', [undefined, null, {}, { _synthetic: true, status: 'verified' }].every((x) => ADAPTER_PROVIDERS.every((p) => adaptEvidence(p, x).status !== 'verified')));
}

// ---- Saflık ve bağlanmamışlık (statik) ----
const src = read('js/nav/roadEventsAdapt.js');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('modül hiçbir şey içe aktarmaz', !/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(code) && !/\bexport\s+[^;]*\bfrom\b/.test(code));
ok('ağ/DOM/depolama/ortam yok', !/\b(fetch|XMLHttpRequest|WebSocket|document|window|localStorage|sessionStorage|indexedDB|navigator|process|setTimeout|setInterval|globalThis|self)\b/.test(code));
ok('Date/Math.random yok (belirlenimci)', !/\b(Date|Math\.random)\b/.test(code));
ok('modülde anahtar/sır yok', !/(key|token|secret)\s*[:=]/i.test(code) && !/pk\.eyJ|sk\.eyJ|AIza/.test(src));
// Mevcut taramalarla uyum: test-road-events (/roadEvents/ içeren çalışma zamanı dosyası yasak) ve test-route-meta (kodda tünel/köprü sözcüğü yasak)
ok('modül metni "roadEvents" dizesini içermez (test-road-events bağlanmamışlık taraması)', !/roadEvents/.test(src));
ok('modül kodu tünel/köprü sözcüğü içermez (test-route-meta taraması)', !/\b(tunnels?|bridges?|brunnel|underpass)\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')));
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
  .filter((p) => /\.(m?js|html)$/.test(p) && rel(p) !== 'js/nav/roadEventsAdapt.js');
ok('tarama çalışma zamanı dosyalarını kapsar', runtime.length > 20 && runtime.some((p) => rel(p) === 'sw.js') && runtime.some((p) => rel(p).startsWith('server/')));
const importers = runtime.filter((p) => /roadEventsAdapt/.test(readFileSync(p, 'utf8'))).map(rel);
ok('hiçbir çalışma zamanı dosyası bağdaştırıcıyı içe aktarmaz (js/server/index.html/sw.js)', importers.length === 0, importers.join(', '));
ok('sw.js SHELL bağdaştırıcıyı içermez', !/roadEventsAdapt/.test(read('sw.js')));

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
