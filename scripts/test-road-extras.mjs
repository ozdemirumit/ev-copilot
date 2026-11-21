// Köprü / alt geçit / gişe uyarıları (OpenStreetMap ek yol olayları) testleri (bağımsız, düz node): node scripts/test-road-extras.mjs
// Saf kurucular (Valhalla trace_attributes + Overpass gişe → olay modeli), model birleştirme, uyarı süzgeci, ağ modülü (sahte bağımlılıklarla; gerçek ağ YOK) ve kablolama.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const X = await import('../js/nav/roadExtras.js');
const { buildTrack } = await import('../js/nav/track.js');
const { emptyEvents, addEvent } = await import('../js/nav/roadEvents.js');
const { alertable, ALERT_KINDS, stepRoadAlerts, createRoadAlerts } = await import('../js/nav/roadAlerts.js');

// Doğuya doğru 20 m aralıklı 300 nokta (enlem 40): indeks i ≈ i·20 m
const D_LON = 20 / (111320 * Math.cos((40 * Math.PI) / 180));
const coords = Array.from({ length: 300 }, (_, i) => [30 + i * D_LON, 40]);
const track = buildTrack(coords);
const m = (i) => Math.round(track.cum[i] * 1000);
const edge = (b, e, o = {}) => ({ begin_shape_index: b, end_shape_index: e, bridge: false, tunnel: false, toll: false, use: 'road', road_class: 'primary', length: (e - b) * 0.1, ...o });
const chunk = (edges, offset = 0) => ({ json: { edges }, offset });
const ev = (model, kind) => model.events.filter((e) => e.kind === kind);

// ---- A) Valhalla trace_attributes → köprü / tünel / alt geçit ----
ok('A sabitler', X.MIN_BRIDGE_M === 250 && X.UNDERPASS_MIN_M === 25 && X.TUNNEL_MIN_M === 100 && X.MERGE_GAP_M === 60 && Object.isFrozen(X.EXTRA_SUPPORTS));
{
  const a = X.fromTraceAttributes([chunk([edge(0, 2), edge(2, 27, { bridge: true }), edge(27, 30)])], coords);
  const b = ev(a, 'bridge');
  ok('A 500 m köprü: tek bridge olayı, rota ekseninde', b.length === 1 && b[0].fromM === m(2) && b[0].toM === m(27) && b[0].source === 'osm');
  ok('A model osm sağlayıcılı, bridge/tunnel/underpass destekli', a.provider === 'osm' && ['bridge', 'tunnel', 'underpass'].every((k) => a.supports.includes(k)) && Object.isFrozen(a) && Object.isFrozen(a.events));
  const adj = X.fromTraceAttributes([chunk([edge(2, 12, { bridge: true }), edge(12, 22, { bridge: true })])], coords);
  ok('A bitişik köprü kenarları tek köprüde birleşir', ev(adj, 'bridge').length === 1 && ev(adj, 'bridge')[0].fromM === m(2) && ev(adj, 'bridge')[0].toM === m(22));
  const far = X.fromTraceAttributes([chunk([edge(2, 16, { bridge: true }), edge(16, 46), edge(46, 60, { bridge: true })])], coords);
  ok('A 600 m arayla iki ayrı köprü ayrı kalır', ev(far, 'bridge').length === 2);
  const g60 = X.fromTraceAttributes([chunk([edge(2, 16, { bridge: true }), edge(16, 19), edge(19, 33, { bridge: true })])], coords);
  ok('A tam 60 m aralıklı köprüler birleşir (sınır dahil)', ev(g60, 'bridge').length === 1);
  const g80 = X.fromTraceAttributes([chunk([edge(2, 16, { bridge: true }), edge(16, 20), edge(20, 34, { bridge: true })])], coords);
  ok('A 80 m aralıklı köprüler ayrı kalır', ev(g80, 'bridge').length === 2);
  ok('A 100 m köprü (kısa) uyarı üretmez', ev(X.fromTraceAttributes([chunk([edge(3, 8, { bridge: true })])], coords), 'bridge').length === 0);
  ok('A 240 m köprü üretmez, 260 m üretir (eşik 250 m)', ev(X.fromTraceAttributes([chunk([edge(10, 22, { bridge: true })])], coords), 'bridge').length === 0 && ev(X.fromTraceAttributes([chunk([edge(10, 23, { bridge: true })])], coords), 'bridge').length === 1);
}
{
  const t = (e) => X.fromTraceAttributes([chunk(e)], coords);
  ok('A ≥ 100 m tünel → tunnel', ev(t([edge(4, 9, { tunnel: true })]), 'tunnel').length === 1 && ev(t([edge(4, 9, { tunnel: true })]), 'underpass').length === 0);
  ok('A 40 m tünel ana yolda → underpass', ev(t([edge(4, 6, { tunnel: true })]), 'underpass').length === 1);
  ok('A 40 m tünel konut yolunda → olay yok', t([edge(4, 6, { tunnel: true, road_class: 'residential' })]).events.length === 0);
  ok('A 20 m tünel (< 25 m) → olay yok', t([edge(4, 5, { tunnel: true })]).events.length === 0);
  ok('A "true" dizesi bayrak sayılmaz (yalnız boolean true)', t([edge(2, 30, { bridge: 'true' }), edge(30, 40, { tunnel: 1 })]).events.length === 0);
  ok('A aralık dışı/bozuk indeks atlanır, atmaz', t([edge(5, 999, { bridge: true }), edge(-3, 2, { bridge: true }), edge(8, 7, { bridge: true }), { bridge: true }, null, 'x']).events.length === 0);
}
{
  // iki parça: ikinci parça offset 30'da başlar; sınırdaki köprü iki parçada örtüşür → tek olay
  const c1 = chunk([edge(25, 45, { bridge: true })], 0);
  const c2 = chunk([edge(0, 10, { bridge: true }), edge(10, 15, { tunnel: true })], 40);
  const a = X.fromTraceAttributes([c1, c2], coords);
  ok('A parça offseti uygulanır, örtüşen köprü tek olay', ev(a, 'bridge').length === 1 && ev(a, 'bridge')[0].fromM === m(25) && ev(a, 'bridge')[0].toM === m(50));
  ok('A ikinci parçadaki tünel global eksende', ev(a, 'tunnel').length === 1 && ev(a, 'tunnel')[0].fromM === m(50) && ev(a, 'tunnel')[0].toM === m(55));
}
{
  const bad = [undefined, null, {}, { json: null }, { json: { edges: 'x' }, offset: 0 }, chunk([edge(1, 30, { bridge: true })], NaN)];
  for (const arg of [undefined, null, 'x', [], bad]) ok('A bozuk girdi atmaz → boş osm modeli ' + JSON.stringify(arg)?.slice(0, 30), (() => { const r = X.fromTraceAttributes(arg, coords); return r.provider === 'osm' && r.events.length === 0; })());
  ok('A coords yoksa boş model', X.fromTraceAttributes([chunk([edge(2, 30, { bridge: true })])], null).events.length === 0);
}

// ---- B) Overpass gişe ----
{
  const lat = 40, lonAt = (i) => 30 + i * D_LON;
  const els = [
    { type: 'node', lat: lat + 0.00005, lon: lonAt(10), tags: { barrier: 'toll_booth' } }, // ~6 m
    { type: 'node', lat: lat + 0.0003, lon: lonAt(20), tags: { highway: 'toll_gantry' } }, // ~33 m: dışarıda
    { type: 'node', lat: lat + 0.00005, lon: lonAt(10.2), tags: { barrier: 'toll_booth' } }, // 4 m ötede: aynı gişe
    { type: 'way', center: { lat: lat + 0.00005, lon: lonAt(40) }, tags: { barrier: 'toll_booth' } },
    { type: 'node', lat: 'x', lon: lonAt(30) }, null, { type: 'node' },
  ];
  const t = X.fromOverpassToll(els, coords);
  ok('B yakın gişe/ kapı noktaları, 500 m içinde tekilleşir', Array.isArray(t) && t.length === 2 && Math.abs(t[0] - m(10)) < 30 && Math.abs(t[1] - m(40)) < 30);
  ok('B uzak (≥ 30 m) ve bozuk elemanlar atılır', t.every((x) => Number.isFinite(x)) && !t.some((x) => Math.abs(x - m(20)) < 60));
  ok('B bozuk girdi → []', X.fromOverpassToll(undefined, coords).length === 0 && X.fromOverpassToll(els, null).length === 0 && X.fromOverpassToll('x', coords).length === 0);
}

// ---- C) buildExtras ----
{
  const tr = X.fromTraceAttributes([chunk([edge(20, 40, { bridge: true }), edge(4, 9, { tunnel: true })])], coords);
  const all = X.buildExtras({ trace: tr, tolls: [m(100), m(101)] });
  ok('C buildExtras: tunnel, bridge, toll, toll — başlangıca göre sıralı', all.events.map((e) => e.kind).join() === 'tunnel,bridge,toll,toll');
  ok('C buildExtras: supports dört tür', ['bridge', 'tunnel', 'underpass', 'toll'].every((k) => all.supports.includes(k)));
  ok('C buildExtras: trace yok + gişe → yalnız toll', X.buildExtras({ trace: null, tolls: [m(5)] }).events.length === 1);
  ok('C buildExtras: hiç veri yok → null', X.buildExtras({ trace: null, tolls: [] }) === null && X.buildExtras({}) === null);
}

// ---- D) mergeRoadModels ----
{
  let own = emptyEvents('osm', { supports: ['tunnel', 'toll'] });
  own = addEvent(own, { kind: 'tunnel', source: 'osm', fromM: 1000, toM: 2000 });
  own = addEvent(own, { kind: 'toll', source: 'osm', atM: 5000 });
  const ex = X.buildExtras({ trace: X.fromTraceAttributes([chunk([edge(20, 40, { bridge: true }), edge(80, 85, { tunnel: true })])], coords), tolls: [m(150)] });
  const mg = X.mergeRoadModels(own, ex);
  const kinds = mg.events.map((e) => e.kind);
  ok('D kendi rota modeli kazanır: ekstradaki tunnel/toll atılır', kinds.filter((k) => k === 'tunnel').length === 1 && kinds.filter((k) => k === 'toll').length === 1 && kinds.includes('bridge'));
  ok('D supports birleşir (tunnel,toll + bridge,underpass)', ['tunnel', 'toll', 'bridge', 'underpass'].every((k) => mg.supports.includes(k)));
  ok('D birleşik model dondurulmuş, girdiler değişmedi', Object.isFrozen(mg) && Object.isFrozen(mg.events) && own.events.length === 2 && ex.events.some((e) => e.kind === 'tunnel'));
  const only = X.mergeRoadModels(null, ex);
  ok('D kendi model yok (Mapbox/TomTom rotası): ekstralar olduğu gibi', only.events.length === ex.events.length && only.supports.includes('tunnel'));
  ok('D ekstra yok: kendi model aynen', X.mergeRoadModels(own, null) === own);
  ok('D ikisi de yok → null', X.mergeRoadModels(null, null) === null && X.mergeRoadModels(undefined, undefined) === null);
  ok('D bozuk model yok sayılır', X.mergeRoadModels({ events: 'x' }, ex) !== null && X.mergeRoadModels({ events: 'x' }, { events: 5 }) === null);
}

// ---- E) alertable / stepRoadAlerts ----
{
  ok('E ALERT_KINDS = tunnel,toll,bridge,underpass', JSON.stringify(ALERT_KINDS) === '["tunnel","toll","bridge","underpass"]' && Object.isFrozen(ALERT_KINDS));
  let mod = emptyEvents('osm', { supports: ['bridge', 'underpass', 'tunnel'] });
  mod = addEvent(mod, { kind: 'bridge', source: 'osm', fromM: 1000, toM: 1100 }); // 100 m: kısa
  mod = addEvent(mod, { kind: 'bridge', source: 'osm', fromM: 3000, toM: 3400 });
  mod = addEvent(mod, { kind: 'underpass', source: 'osm', fromM: 5000, toM: 5040 });
  mod = addEvent(mod, { kind: 'underpass', source: 'osm', fromM: 6000, toM: 6010 }); // 10 m: kısa
  const al = alertable(mod);
  ok('E kısa köprü (<250 m) ve kısa alt geçit (<25 m) uyarı almaz', al.length === 2 && al[0].kind === 'bridge' && al[0].fromM === 3000 && al[1].kind === 'underpass');
  const st = createRoadAlerts();
  const r = stepRoadAlerts(st, { model: mod, planId: 'p', routeKm: 2.0, now: 1000 }); // köprü 3000 m: 1000 m kala → uzak aşama
  ok('E köprü 1 km kala uzak aşamada konuşulur, satırda lenM', r.speak.length === 1 && r.speak[0].kind === 'bridge' && r.speak[0].lenM === 400 && r.line.kind === 'bridge');
  const sup = emptyEvents('osm', { supports: ['tunnel'] });
  ok('E supports\'ta olmayan tür uyarı almaz', alertable(addEvent(sup, { kind: 'bridge', source: 'osm', fromM: 0, toM: 500 })).length === 0);
}

// ---- F) ağ modülü (sahte bağımlılıklar; gerçek ağ yok) ----
const N = await import('../js/osm/roadExtras.js');
{
  ok('F sabitler: parça ≤ 2500 nokta', N.CHUNK_POINTS === 2500 && N.OVERLAP_POINTS >= 2);
  const calls = [];
  const trace = async (body) => { calls.push(body); return { edges: [edge(2, 27, { bridge: true })] }; };
  const tolls = async () => [{ type: 'node', lat: 40.00005, lon: 30 + 10 * D_LON, tags: { barrier: 'toll_booth' } }];
  const r = await N.fetchRoadExtras(coords, { trace, tolls });
  ok('F köprü + gişe tek modelde', r && ev(r, 'bridge').length === 1 && ev(r, 'toll').length === 1 && r.provider === 'osm');
  ok('F trace isteği: map_snap, auto, yalnızca gereken öznitelikler, şekil {lat,lon}', calls.length === 1 && calls[0].shape_match === 'map_snap' && calls[0].costing === 'auto' && calls[0].shape.length === 300 && typeof calls[0].shape[0].lat === 'number'
    && calls[0].filters.action === 'include' && ['edge.bridge', 'edge.tunnel', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.road_class', 'edge.length'].every((a) => calls[0].filters.attributes.includes(a)));
  const failTrace = async () => { throw new Error('ağ yok'); };
  const r2 = await N.fetchRoadExtras(coords, { trace: failTrace, tolls });
  ok('F trace başarısız → Overpass gişesi yine döner', r2 && ev(r2, 'toll').length === 1 && ev(r2, 'bridge').length === 0);
  const failTolls = async () => { throw new Error('overpass yok'); };
  const r3 = await N.fetchRoadExtras(coords, { trace, tolls: failTolls });
  ok('F Overpass başarısız → köprü yine döner', r3 && ev(r3, 'bridge').length === 1 && ev(r3, 'toll').length === 0);
  const r4 = await N.fetchRoadExtras(coords, { trace: failTrace, tolls: failTolls });
  ok('F ikisi de başarısız → null (olay uydurulmaz)', r4 === null);
  ok('F rota çok kısa/bozuk → null, istek yok', (await N.fetchRoadExtras([[30, 40]], { trace, tolls })) === null && (await N.fetchRoadExtras(null, { trace, tolls })) === null);
  // uzun rota: 6000 nokta → 3 parça, parçalar 1 + OVERLAP nokta örtüşür, ofsetler eşleşir
  const long = Array.from({ length: 6000 }, (_, i) => [30 + i * 0.0001, 40]);
  const longCalls = [];
  const traceLong = async (body) => { longCalls.push(body.shape.length); return { edges: [] }; };
  await N.fetchRoadExtras(long, { trace: traceLong, tolls: async () => [], pauseMs: 0 });
  ok('F 6000 nokta: 3 trace parçası, her biri ≤ CHUNK_POINTS + OVERLAP', longCalls.length === 3 && longCalls.every((n) => n <= N.CHUNK_POINTS + N.OVERLAP_POINTS) && longCalls.reduce((a, b) => a + b, 0) >= 6000);
  const order = [];
  await N.fetchRoadExtras(long, { trace: async (b) => { order.push('t'); return { edges: [] }; }, tolls: async () => { order.push('o'); return []; }, pauseMs: 0 });
  ok('F Overpass tek geçişte (parçalı kopya yok) ve trace istekleri sıralı', order.filter((x) => x === 'o').length >= 1 && order.filter((x) => x === 't').length === 3);
}

// ---- G) kablolama ----
{
  const rw = read('js/nav/roadWarnings.js'), html = read('index.html'), sw = read('sw.js'), pg = read('js/net/providerGate.js'), ver = read('version.js');
  ok('G roadWarnings: ekstralar içe aktarılır, birleştirilir, ayar warnRoad', /from '\.\/roadExtras\.js'/.test(rw) && /mergeRoadModels\(/.test(rw) && /load\('warnRoad', true\)/.test(rw) && /bind\('warn-road', 'road', 'warnRoad'\)/.test(rw));
  ok('G roadWarnings: köprü ve alt geçit konuşma/satır metinleri', /köprü, uzunluğu/.test(rw) && /ileride alt geçit/.test(rw) && /🌉/.test(rw));
  ok('G roadWarnings: ekstra yalnız ayar açıkken, plan başına bir kez istenir', /on\.road/.test(rw) && /extrasTriedFor/.test(rw));
  ok('G index.html: warn-road anahtarı', /id="warn-road"/.test(html));
  ok('G sw.js SHELL: iki yeni dosya', sw.includes("'./js/nav/roadExtras.js'") && sw.includes("'./js/osm/roadExtras.js'"));
  ok('G providerGate: ücretsiz modda Valhalla trace_attributes izinli', /route\|height\|locate\|trace_attributes/.test(pg));
  ok('G sürüm 0.99.118', /self\.APP_VERSION = '0\.99\.118';/.test(ver) && /v: '0\.99\.118'/.test(ver));
  const ne = read('js/osm/roadExtras.js');
  ok('G ağ modülü: anahtar/belirteç/depolama yok, yalnız Valhalla + Overpass yardımcıları', !/localStorage|sessionStorage|apiKey|token|process\.env/.test(ne) && /trace_attributes/.test(ne));
}

// ---- H) GERÇEK kayıt: Bolu rotası (49,9 km), Valhalla /trace_attributes yanıtı (scripts/fixtures/road-events/osm-valhalla-trace-bolu-recorded.json) ----
{
  const { fromValhallaOsrm } = await import('../js/nav/valhallaRoadEvents.js');
  const fx = JSON.parse(read('scripts/fixtures/road-events/osm-valhalla-trace-bolu-recorded.json'));
  const rec = JSON.parse(read('scripts/fixtures/road-events/osm-valhalla-bolu-recorded.json'));
  const tr = X.fromTraceAttributes([{ json: fx.response, offset: 0 }], fx.shape);
  const osrm = fromValhallaOsrm(rec.response, fx.shape);
  const routeM = Math.round(buildTrack(fx.shape).cum.at(-1) * 1000);
  const bridges = ev(tr, 'bridge');
  ok('H gerçek kayıt: 167 kenar, 689 nokta', fx.response.edges.length === 167 && fx.shape.length === 689);
  ok('H 8 köprü, hepsi ≥ 250 m, sıralı, rota içinde', bridges.length === 8 && bridges.every((b) => b.toM - b.fromM >= X.MIN_BRIDGE_M && b.fromM >= 0 && b.toM <= routeM) && bridges.every((b, i) => i === 0 || b.fromM >= bridges[i - 1].toM));
  ok('H ilk köprü 1690–2220 m, en uzunu 2301 m (birleşmiş kenarlar)', bridges[0].fromM === 1690 && bridges[0].toM === 2220 && Math.max(...bridges.map((b) => b.toM - b.fromM)) === 2301);
  const tun = ev(tr, 'tunnel');
  const osrmTun = osrm.events.filter((e) => e.kind === 'tunnel');
  ok('H Bolu Dağı Tüneli: trace tüneli, OSRM tünelleriyle (ayrı kayıt, ayrı kaynak alanı) AYNI aralık', tun.length === 1 && osrmTun.some((o) => o.fromM === tun[0].fromM && o.toM === tun[0].toM) && tun[0].toM - tun[0].fromM === 3120);
  const up = ev(tr, 'underpass');
  ok('H 29 m\'lik "tünel" parçası (kodda bilinen alt geçit) → underpass', up.length === 1 && up[0].toM - up[0].fromM === 29 && osrmTun.some((o) => o.fromM === up[0].fromM && o.toM === up[0].toM));
  ok('H köprüler tüneli kesmez', bridges.every((b) => b.toM <= tun[0].fromM || b.fromM >= tun[0].toM));
  const mg = X.mergeRoadModels(osrm, X.buildExtras({ trace: tr, tolls: [] }));
  const kc = (k) => mg.events.filter((e) => e.kind === k).length;
  ok('H birleşim: kendi model aynen (2 tünel kaydı: 3120 m + 29 m parça; 2 gişe; ekstradaki tünel kopyası eklenmez) + 8 köprü + 1 alt geçit', kc('tunnel') === 2 && kc('toll') === 2 && kc('bridge') === 8 && kc('underpass') === 1);
  ok('H birleşik modelde uyarı verilecek olay sayısı: 8 köprü + 1 tünel + 2 gişe (kısa alt geçit 29 m ≥ 25 m: uyarılır)', alertable(mg).length === 12);
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
