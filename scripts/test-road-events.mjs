// Sağlayıcıdan bağımsız yol olayları modeli testleri (BL-P2-03 F1; bağımlılıksız, düz node): node scripts/test-road-events.mjs
// Elle yazılmış sahte (fixture) örnekler; ağ engellidir. Modülün saf olduğu (import/ağ/DOM/depolama yok) ve hiçbir çalışma
// zamanı dosyasından içe aktarılmadığı statik olarak da doğrulanır. Sabitlerin routeMeta.js ile eşleştiği burada (testte) denetlenir.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// Ağ / depolama engeli
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const E = await import('../js/nav/roadEvents.js');
const RM = await import('../js/nav/routeMeta.js');
const { KINDS, SPAN_KINDS, POINT_KINDS, PROVIDERS, INFERRED_SOURCES, emptyEvents, addEvent, eventsAhead } = E;
const J = (x) => JSON.stringify(x);
const deepFrozen = (o) => {
  if (o === null || typeof o !== 'object') return true;
  if (!Object.isFrozen(o)) return false;
  return Object.values(o).every(deepFrozen);
};

// ---- Sabitler ----
ok('KINDS tam liste', J(KINDS) === '["tunnel","bridge","underpass","overpass","toll","exit","sign"]');
ok('aralık türleri (tunnel/bridge/underpass/overpass)', J(SPAN_KINDS) === '["tunnel","bridge","underpass","overpass"]');
ok('nokta türleri (gişe noktadır)', J(POINT_KINDS) === '["toll","exit","sign"]');
ok('toll aralık türü değil', !SPAN_KINDS.includes('toll') && POINT_KINDS.includes('toll'));
ok('aralık+nokta = KINDS, kesişim yok', J([...SPAN_KINDS, ...POINT_KINDS].sort()) === J([...KINDS].sort()) && !SPAN_KINDS.some((k) => POINT_KINDS.includes(k)));
ok('PROVIDERS routeMeta ile aynı', J(PROVIDERS) === J(RM.PROVIDERS));
ok('INFERRED_SOURCES routeMeta ile aynı', J(INFERRED_SOURCES) === J(RM.INFERRED_SOURCES));
ok('çıkarım kaynakları GPS/hız/kamera/OCR içerir', ['gps', 'gps-loss', 'speed', 'camera', 'ocr'].every((s) => INFERRED_SOURCES.includes(s)));
ok('sabitler dondurulmuş', [KINDS, SPAN_KINDS, POINT_KINDS, PROVIDERS, INFERRED_SOURCES].every(Object.isFrozen));

// ---- emptyEvents ----
for (const p of PROVIDERS) {
  const m = emptyEvents(p);
  ok(`${p}: varsayılan hiçbir yetenek yok`, m.provider === p && J(m.supports) === '[]' && J(m.events) === '[]' && J(m.denied) === '[]');
  ok(`${p}: boş model derin dondurulmuş`, deepFrozen(m));
}
{
  const u = emptyEvents('waze');
  ok('bilinmeyen sağlayıcı → provider null, yetenek yok', u.provider === null && J(u.supports) === '[]');
  ok('bilinmeyen sağlayıcı supports verilse de yetenek yok', J(emptyEvents('waze', { supports: ['tunnel'] }).supports) === '[]');
  ok('provider yok → null', emptyEvents().provider === null);
  const s = emptyEvents('tomtom', { supports: ['tunnel', 'bridge', 'lanes', 'ufo', 7, 'tunnel'] });
  ok('supports: yalnızca bilinen türler, tekrarsız', J(s.supports) === '["tunnel","bridge"]');
  const sup = ['exit'];
  const s2 = emptyEvents('mapbox', { supports: sup });
  sup.push('sign');
  ok('supports girdisi kopyalanır (sonradan değişiklik etkisiz)', J(s2.supports) === '["exit"]');
  ok('supports dizi değilse yetenek yok', J(emptyEvents('here', { supports: 'tunnel' }).supports) === '[]');
  ok('sürüm alanı', typeof emptyEvents('osm').v === 'number');
}

// ---- addEvent: kabul ----
const ALL = [...KINDS];
const base = emptyEvents('tomtom', { supports: ALL });
{
  const m1 = addEvent(base, { kind: 'tunnel', source: 'tomtom', fromM: 1200, toM: 1850 });
  ok('tünel aralığı eklenir', m1.events.length === 1 && J(m1.events[0]) === '{"kind":"tunnel","source":"tomtom","fromM":1200,"toM":1850}');
  ok('girdi modeli değişmez', base.events.length === 0 && base.denied.length === 0);
  ok('çıktı derin dondurulmuş', deepFrozen(m1));
  const m2 = addEvent(m1, { kind: 'exit', source: 'tomtom', atM: 3000, ref: '12' });
  ok('çıkış noktası ref ile eklenir', J(m2.events[1]) === '{"kind":"exit","source":"tomtom","atM":3000,"ref":"12"}');
  const txt = ['Ankara', 'O-4'];
  const ev = { kind: 'sign', source: 'tomtom', atM: 0, text: txt };
  const m3 = addEvent(m2, ev);
  ok('tabela atM=0 kabul, text kopyalanır', J(m3.events[2]) === '{"kind":"sign","source":"tomtom","atM":0,"text":["Ankara","O-4"]}');
  ok('text dizisi dondurulmuş ve girdiden ayrı', Object.isFrozen(m3.events[2].text) && m3.events[2].text !== txt);
  ok('olay girdisi değiştirilmez', !Object.isFrozen(ev) && !Object.isFrozen(txt) && ev.text === txt && txt.length === 2 && J(Object.keys(ev)) === '["kind","source","atM","text"]');
  txt.push('İzmir');
  ok('girdi sonradan değişse de model değişmez', m3.events[2].text.length === 2);
  for (const k of ['bridge', 'underpass', 'overpass']) {
    const m = addEvent(base, { kind: k, source: 'tomtom', fromM: 0, toM: 10 });
    ok(`${k} aralığı (fromM=0) kabul`, m.events.length === 1 && m.events[0].kind === k && m.denied.length === 0);
  }
  const t0 = addEvent(base, { kind: 'toll', source: 'tomtom', atM: 0 });
  ok('gişe noktası atM=0 kabul', t0.events.length === 1 && t0.denied.length === 0 && J(t0.events[0]) === '{"kind":"toll","source":"tomtom","atM":0}');
  const t1 = addEvent(base, { kind: 'toll', source: 'tomtom', atM: 4200.5, foo: 1 });
  ok('gişe noktası yalnızca kind/source/atM saklar', J(t1.events[0]) === '{"kind":"toll","source":"tomtom","atM":4200.5}' && deepFrozen(t1));
  ok('bilinmeyen ek alanlar saklanmaz', J(addEvent(base, { kind: 'bridge', source: 'tomtom', fromM: 5, toM: 9, foo: 1 }).events[0]) === '{"kind":"bridge","source":"tomtom","fromM":5,"toM":9}');
  ok('emptyEvents.supports alanı korunur', J(m3.supports) === J(base.supports) && m3.provider === 'tomtom');
}

// ---- addEvent: ret ----
function rejects(name, model, ev, reason) {
  const out = addEvent(model, ev);
  const d = out.denied[out.denied.length - 1];
  ok(`ret ${name} → ${reason}`, out.events.length === model.events.length && out.denied.length === model.denied.length + 1 && d?.reason === reason,
    J(out.denied));
  ok(`ret ${name}: çıktı dondurulmuş, girdi model değişmez`, deepFrozen(out) && out !== model && model.denied.length === out.denied.length - 1);
  return out;
}
rejects('başka sağlayıcı', base, { kind: 'tunnel', source: 'here', fromM: 1, toM: 2 }, 'cross-provider');
rejects('mapbox→tomtom modeli', base, { kind: 'exit', source: 'mapbox', atM: 1, ref: '3' }, 'cross-provider');
for (const s of ['gps', 'gps-loss', 'speed', 'camera', 'ocr', 'heuristic', 'inferred', 'guess']) {
  rejects(`çıkarım kaynağı ${s}`, base, { kind: 'tunnel', source: s, fromM: 1, toM: 2 }, 'inferred-source');
}
rejects('kaynak yok', base, { kind: 'tunnel', fromM: 1, toM: 2 }, 'unknown-source');
rejects('kaynak bilinmiyor', base, { kind: 'tunnel', source: 'waze', fromM: 1, toM: 2 }, 'unknown-source');
rejects('bilinmeyen tür', base, { kind: 'lanes', source: 'tomtom', atM: 1 }, 'unknown-kind');
rejects('tür yok', base, { source: 'tomtom', atM: 1 }, 'unknown-kind');
rejects('yetenek yok (varsayılan)', emptyEvents('tomtom'), { kind: 'tunnel', source: 'tomtom', fromM: 1, toM: 2 }, 'unsupported');
rejects('yetenek yalnızca bridge', emptyEvents('here', { supports: ['bridge'] }), { kind: 'tunnel', source: 'here', fromM: 1, toM: 2 }, 'unsupported');
rejects('bilinmeyen sağlayıcı modeli', emptyEvents('waze', { supports: ALL }), { kind: 'tunnel', source: 'osm', fromM: 1, toM: 2 }, 'cross-provider');
// geometri
rejects('fromM = toM', base, { kind: 'tunnel', source: 'tomtom', fromM: 5, toM: 5 }, 'bad-geometry');
rejects('fromM > toM', base, { kind: 'bridge', source: 'tomtom', fromM: 9, toM: 5 }, 'bad-geometry');
rejects('negatif fromM', base, { kind: 'bridge', source: 'tomtom', fromM: -1, toM: 5 }, 'bad-geometry');
rejects('NaN toM', base, { kind: 'tunnel', source: 'tomtom', fromM: 1, toM: NaN }, 'bad-geometry');
rejects('Infinity toM', base, { kind: 'underpass', source: 'tomtom', fromM: 1, toM: Infinity }, 'bad-geometry');
// gişe (toll) NOKTA olayıdır: aralık geometrisi reddedilir
rejects('gişeye aralık', base, { kind: 'toll', source: 'tomtom', fromM: 1000, toM: 1100 }, 'bad-geometry');
rejects('gişeye aralık + atM', base, { kind: 'toll', source: 'tomtom', fromM: 1, toM: 3, atM: 2 }, 'bad-geometry');
rejects('gişede yalnızca fromM', base, { kind: 'toll', source: 'tomtom', fromM: 1, atM: 2 }, 'bad-geometry');
rejects('gişe atM yok', base, { kind: 'toll', source: 'tomtom' }, 'bad-geometry');
rejects('gişe negatif atM', base, { kind: 'toll', source: 'tomtom', atM: -1 }, 'bad-geometry');
rejects('gişe NaN atM', base, { kind: 'toll', source: 'tomtom', atM: NaN }, 'bad-geometry');
rejects('gişe Infinity atM', base, { kind: 'toll', source: 'tomtom', atM: Infinity }, 'bad-geometry');
rejects('gişe metin atM', base, { kind: 'toll', source: 'tomtom', atM: '5' }, 'bad-geometry');
rejects('gişede ref', base, { kind: 'toll', source: 'tomtom', atM: 5, ref: '1' }, 'bad-props');
rejects('gişede text', base, { kind: 'toll', source: 'tomtom', atM: 5, text: ['Gişe'] }, 'bad-props');
rejects('gişe çıkarım kaynağı (gps)', base, { kind: 'toll', source: 'gps', atM: 5 }, 'inferred-source');
rejects('gişe başka sağlayıcı', base, { kind: 'toll', source: 'here', atM: 5 }, 'cross-provider');
for (const k of SPAN_KINDS) rejects(`${k} aralık türüne yalnızca atM`, base, { kind: k, source: 'tomtom', atM: 5 }, 'bad-geometry');
rejects('metin fromM', base, { kind: 'underpass', source: 'tomtom', fromM: '1', toM: 5 }, 'bad-geometry');
rejects('aralık türüne atM', base, { kind: 'overpass', source: 'tomtom', atM: 3 }, 'bad-geometry');
rejects('aralık + atM birlikte', base, { kind: 'overpass', source: 'tomtom', fromM: 1, toM: 3, atM: 2 }, 'bad-geometry');
rejects('negatif atM', base, { kind: 'exit', source: 'tomtom', atM: -0.5, ref: '1' }, 'bad-geometry');
rejects('atM yok', base, { kind: 'exit', source: 'tomtom', ref: '1' }, 'bad-geometry');
rejects('nokta türüne aralık', base, { kind: 'sign', source: 'tomtom', fromM: 1, toM: 3, text: ['A'] }, 'bad-geometry');
// özellikler
rejects('exit ref yok', base, { kind: 'exit', source: 'tomtom', atM: 1 }, 'bad-props');
rejects('exit ref sayı', base, { kind: 'exit', source: 'tomtom', atM: 1, ref: 12 }, 'bad-props');
rejects('exit ref boş', base, { kind: 'exit', source: 'tomtom', atM: 1, ref: '  ' }, 'bad-props');
rejects('sign text yok', base, { kind: 'sign', source: 'tomtom', atM: 1 }, 'bad-props');
rejects('sign text dizi değil', base, { kind: 'sign', source: 'tomtom', atM: 1, text: 'Ankara' }, 'bad-props');
rejects('sign text boş dizi', base, { kind: 'sign', source: 'tomtom', atM: 1, text: [] }, 'bad-props');
rejects('sign text içinde sayı', base, { kind: 'sign', source: 'tomtom', atM: 1, text: ['A', 3] }, 'bad-props');
rejects('tünelde ref', base, { kind: 'tunnel', source: 'tomtom', fromM: 1, toM: 2, ref: 'x' }, 'bad-props');
rejects('çıkışta text', base, { kind: 'exit', source: 'tomtom', atM: 1, ref: '1', text: ['A'] }, 'bad-props');
rejects('tabelada ref', base, { kind: 'sign', source: 'tomtom', atM: 1, text: ['A'], ref: '1' }, 'bad-props');
rejects('olay nesne değil', base, null, 'unknown-kind');
{
  const d = addEvent(base, { kind: 'tunnel', source: 'gps', fromM: 1, toM: 2 }).denied[0];
  ok('denied kaydı tür/kaynak/neden içerir', J(d) === '{"kind":"tunnel","source":"gps","reason":"inferred-source"}');
  const d2 = addEvent(base, { kind: 42, source: { x: 1 }, atM: 1 }).denied[0];
  ok('denied kaydı metin olmayan tür/kaynağı null yazar', d2.kind === null && d2.source === null && d2.reason === 'unknown-kind');
  // Ret sıralaması: çıkarım > sağlayıcı > yetenek > geometri
  ok('çıkarım kaynağı yetenek kontrolünden önce', addEvent(emptyEvents('osm'), { kind: 'tunnel', source: 'camera', fromM: 1, toM: 2 }).denied[0].reason === 'inferred-source');
  ok('başka sağlayıcı yetenekten önce', addEvent(emptyEvents('osm'), { kind: 'tunnel', source: 'here', fromM: 1, toM: 2 }).denied[0].reason === 'cross-provider');
  ok('yetenek geometriden önce', addEvent(emptyEvents('osm'), { kind: 'tunnel', source: 'osm', fromM: 2, toM: 1 }).denied[0].reason === 'unsupported');
  let m = base;
  m = addEvent(m, { kind: 'tunnel', source: 'gps', fromM: 1, toM: 2 });
  m = addEvent(m, { kind: 'tunnel', source: 'tomtom', fromM: 1, toM: 2 });
  m = addEvent(m, { kind: 'bridge', source: 'here', fromM: 3, toM: 4 });
  ok('ret ve kabul birikir', m.events.length === 1 && J(m.denied.map((x) => x.reason)) === '["inferred-source","cross-provider"]');
  let threw = false;
  try { addEvent(null, { kind: 'tunnel', source: 'tomtom', fromM: 1, toM: 2 }); } catch (e) { threw = e instanceof TypeError; }
  ok('geçersiz model → TypeError', threw);
}

// ---- eventsAhead ----
let route = emptyEvents('mapbox', { supports: ALL });
const fixtures = [
  { kind: 'sign', source: 'mapbox', atM: 4500, text: ['Bursa'] },
  { kind: 'tunnel', source: 'mapbox', fromM: 800, toM: 1500 },
  { kind: 'exit', source: 'mapbox', atM: 200, ref: '3' },
  { kind: 'bridge', source: 'mapbox', fromM: 3000, toM: 3400 },
  { kind: 'toll', source: 'mapbox', atM: 1000 },
  { kind: 'exit', source: 'mapbox', atM: 3000, ref: '5' },
  { kind: 'overpass', source: 'mapbox', fromM: 12000, toM: 12100 },
];
for (const f of fixtures) route = addEvent(route, f);
ok('fixture: 7 olay, ret yok', route.events.length === 7 && route.denied.length === 0);
const sig = (list) => list.map((e) => `${e.kind}@${e.fromM ?? e.atM}`).join(',');
{
  const all = eventsAhead(route, 0, Infinity);
  ok('0 m, sınırsız: başlangıca göre sıralı (eşitse önce kısa biten)', sig(all) === 'exit@200,tunnel@800,toll@1000,exit@3000,bridge@3000,sign@4500,overpass@12000', sig(all));
  ok('sonuç dondurulmuş', Object.isFrozen(all));
  ok('modelin olay sırası değişmez (ekleme sırası)', route.events[0].kind === 'sign');
  const a = eventsAhead(route, 1200, 2000);
  ok('1200 m, 2 km ufuk: geçmişler (geçilen gişe dahil) dışarıda, içinde olunan aralık dahil', sig(a) === 'tunnel@800,exit@3000,bridge@3000', sig(a));
  ok('gişe tam konumda dahil, geçilince dışarıda', sig(eventsAhead(route, 1000, 0)) === 'tunnel@800,toll@1000' && !eventsAhead(route, 1000.1, 50).some((e) => e.kind === 'toll'));
  const b = eventsAhead(route, 1500, 1000);
  ok('aralık sonu = konum → geçmiş', !b.some((e) => e.kind === 'tunnel'), sig(b));
  const c = eventsAhead(route, 3000, 0);
  ok('ufuk 0: tam konumdaki nokta + içinde olunan aralıklar', sig(c) === 'exit@3000,bridge@3000', sig(c));
  const d = eventsAhead(route, 200, 600);
  ok('nokta tam konumda dahil, ufuk sınırı dahil', sig(d) === 'exit@200,tunnel@800', sig(d));
  ok('nokta geçildi → dışarıda', !eventsAhead(route, 200.1, 100).some((e) => e.kind === 'exit'));
  ok('rota sonu sonrası boş', eventsAhead(route, 20000, 5000).length === 0);
  ok('ufuk verilmezse sınırsız', eventsAhead(route, 0).length === 7);
  ok('geçersiz konum → boş', eventsAhead(route, NaN, 100).length === 0 && eventsAhead(route, -1, 100).length === 0 && eventsAhead(route, '0', 100).length === 0);
  ok('geçersiz ufuk → boş', eventsAhead(route, 0, -1).length === 0 && eventsAhead(route, 0, NaN).length === 0);
  ok('geçersiz model → boş', eventsAhead(null, 0, 100).length === 0 && eventsAhead({}, 0, 100).length === 0);
  ok('boş model → boş', eventsAhead(emptyEvents('osm'), 0, 1e6).length === 0);
  const same = addEvent(addEvent(emptyEvents('osm', { supports: ALL }), { kind: 'bridge', source: 'osm', fromM: 10, toM: 50 }), { kind: 'tunnel', source: 'osm', fromM: 10, toM: 20 });
  ok('aynı başlangıçta kısa aralık önce', sig(eventsAhead(same, 0)) === 'tunnel@10,bridge@10' && eventsAhead(same, 0)[0].toM === 20);
  const pt = addEvent(same, { kind: 'toll', source: 'osm', atM: 10 });
  ok('aynı başlangıçta gişe noktası aralıklardan önce', sig(eventsAhead(pt, 0)) === 'toll@10,tunnel@10,bridge@10' && eventsAhead(pt, 0)[0].toM === undefined);
}

// ---- Saflık ve bağlanmamışlık (statik) ----
const src = read('js/nav/roadEvents.js');
const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok('modül hiçbir şey içe aktarmaz', !/\bimport\b/.test(code) && !/\brequire\s*\(/.test(code));
ok('ağ/DOM/depolama/ortam yok', !/\b(fetch|XMLHttpRequest|WebSocket|document|window|localStorage|sessionStorage|indexedDB|navigator|process\.env|setTimeout|setInterval)\b/.test(code));
ok('Date/Math.random yok (belirlenimci)', !/\b(Date|Math\.random)\b/.test(code));
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
// scripts/test-route-meta.mjs tünel/köprü taramasında YALNIZCA js/nav/roadEvents.js muaftır; bu muafiyet ancak modül hiçbir
// çalışma zamanı dosyasına (js/, server/, index.html, sw.js; statik/dinamik import, SHELL listesi dahil) bağlı değilken güvenlidir.
const rel = (p) => relative(root, p).replace(/\\/g, '/');
const runtime = [...walk(join(root, 'js')), ...walk(join(root, 'server')).filter((p) => !/[\\/](node_modules|data)[\\/]/.test(p)), join(root, 'index.html'), join(root, 'sw.js')]
  .filter((p) => /\.(js|mjs|html)$/.test(p) && rel(p) !== 'js/nav/roadEvents.js');
ok('tarama çalışma zamanı dosyalarını kapsar', runtime.length > 20 && runtime.some((p) => rel(p) === 'js/nav/routeMeta.js') && runtime.some((p) => rel(p) === 'sw.js') && runtime.some((p) => rel(p).startsWith('server/')));
// v0.99.102: model yalnızca gerçek kayıtla doğrulanan Valhalla tünel/gişe yoluna bağlandı (scripts/test-road-alerts.mjs).
// Bağlantı DAR izin listesiyle sabitlenir: yeni bir çalışma zamanı dosyası (ör. Mapbox/TomTom ayrıştırıcısı, sunucu) modeli kullanırsa bu test kırılır.
const ROAD_EVENTS_USERS = ['js/nav/roadAlerts.js', 'js/nav/roadWarnings.js', 'js/nav/valhallaRoadEvents.js', 'js/osm/route.js', 'sw.js'];
const importers = runtime.filter((p) => /roadEvents/.test(readFileSync(p, 'utf8'))).map(rel).sort();
ok('roadEvents yalnızca izinli çalışma zamanı dosyalarında geçer (js/server/index.html/sw.js)', J(importers) === J(ROAD_EVENTS_USERS), importers.join(', '));
const direct = runtime.filter((p) => /from '\.\/roadEvents\.js'|nav\/roadEvents\.js'/.test(readFileSync(p, 'utf8'))).map(rel).sort();
ok('roadEvents.js modülünü yalnız roadAlerts + valhallaRoadEvents içe aktarır (sw.js çevrimdışı kabuk)', J(direct) === J(['js/nav/roadAlerts.js', 'js/nav/valhallaRoadEvents.js', 'sw.js']), direct.join(', '));
ok('sunucu (server/) roadEvents kullanmaz', !importers.some((p) => p.startsWith('server/')));
{
  const rm = read('scripts/test-route-meta.mjs');
  const ex = [...rm.matchAll(/ROAD_EVENTS_EXEMPT = '([^']+)'/g)].map((m) => m[1]);
  ok('test-route-meta muafiyeti dar: yalnızca js/nav/roadEvents.js', J(ex) === '["js/nav/roadEvents.js"]' && /if \(p === ROAD_EVENTS_EXEMPT\) continue;/.test(rm), J(ex));
}
ok('ağ çağrısı yapılmadı', netCalls === 0);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
