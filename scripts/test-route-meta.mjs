// Sağlayıcıdan bağımsız rota üst verisi modeli testleri (bağımlılıksız, düz node): node scripts/test-route-meta.mjs
// Elle yazılmış çevrimdışı örnekler; ağ engellidir. Modülün çalışma zamanına bağlı olmadığı ve bugün tünel/köprü kaynağı
// bulunmadığı statik olarak da doğrulanır.
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
const M = await import('../js/nav/routeMeta.js');
const { PROVIDERS, ATTRS, STATUSES, DEFAULT_CAPS, INFERRED_SOURCES, emptyMeta, withProvenance, filterBySource, attrStatus, lanesStatusFromSteps } = M;

// ---- Yapı ----
ok('öznitelikler lanes/tunnel/bridge', JSON.stringify(ATTRS) === '["lanes","tunnel","bridge"]');
ok('durumlar present/absent/unrequested/unsupported', JSON.stringify(STATUSES) === '["present","absent","unrequested","unsupported"]');
ok('sabitler dondurulmuş', [PROVIDERS, ATTRS, STATUSES, DEFAULT_CAPS, INFERRED_SOURCES].every(Object.isFrozen));
ok('varsayılan yetenek: yalnızca mapbox lanes', JSON.stringify(DEFAULT_CAPS) === '{"osm":[],"mapbox":["lanes"],"tomtom":[],"here":[],"google":[]}');
for (const p of PROVIDERS) {
  const m = emptyMeta(p);
  ok(`${p}: tünel/köprü varsayılan unsupported (bugün kaynak yok)`, m.attrs.tunnel.status === 'unsupported' && m.attrs.bridge.status === 'unsupported');
}

// ---- emptyMeta ----
{
  const m = emptyMeta('mapbox');
  ok('mapbox boş: provider mapbox, lanes unrequested', m.provider === 'mapbox' && m.attrs.lanes.status === 'unrequested' && m.attrs.lanes.source === null);
  ok('boş: aralık ve ret yok', m.roadSpans.length === 0 && m.denied.length === 0 && m.v === 1);
  ok('boş: derin dondurulmuş', Object.isFrozen(m) && Object.isFrozen(m.attrs) && Object.isFrozen(m.attrs.lanes) && Object.isFrozen(m.roadSpans) && Object.isFrozen(m.denied));
  ok('osm boş: lanes unsupported', emptyMeta('osm').attrs.lanes.status === 'unsupported');
}
for (const bad of ['foo', 'Mapbox', '', null, undefined, 42, {}, 'gps']) {
  const m = emptyMeta(bad);
  ok(`bilinmeyen sağlayıcı ${JSON.stringify(bad)} → provider null, hepsi unsupported`, m.provider === null && ATTRS.every((a) => m.attrs[a].status === 'unsupported'));
}
{
  const m = emptyMeta('tomtom', { supports: ['tunnel', 'bridge', 'underpass', 'overpass'] });
  ok('açık yetenek listesi yalnızca bilinen öznitelikleri alır', m.attrs.tunnel.status === 'unrequested' && m.attrs.bridge.status === 'unrequested' && m.attrs.lanes.status === 'unsupported' && !('underpass' in m.attrs) && !('overpass' in m.attrs));
  ok('bilinmeyen sağlayıcıya yetenek verilemez', emptyMeta('foo', { supports: ['tunnel'] }).attrs.tunnel.status === 'unsupported');
}

// ---- withProvenance: kabul ----
{
  const m0 = emptyMeta('mapbox');
  const m1 = withProvenance(m0, 'lanes', { source: 'mapbox', status: 'present' });
  ok('mapbox lanes present kabul', m1.attrs.lanes.status === 'present' && m1.attrs.lanes.source === 'mapbox' && m1.denied.length === 0);
  ok('girdi değiştirilmez', m0.attrs.lanes.status === 'unrequested' && m1 !== m0);
  const m2 = withProvenance(m0, 'lanes', { source: 'mapbox', status: 'absent' });
  ok('mapbox lanes absent kabul (istendi, rota boyunca yok)', m2.attrs.lanes.status === 'absent');
  ok('lanes aralık almaz', withProvenance(m0, 'lanes', { source: 'mapbox', status: 'present', spans: [{ fromM: 0, toM: 10 }] }).denied[0]?.reason === 'bad-spans');
}
{
  // Gelecekteki ayrıştırıcıyı temsil eden elle yazılmış örnek (ağ yok): TomTom tünel ve köprü aralıkları
  const m0 = emptyMeta('tomtom', { supports: ['tunnel', 'bridge'] });
  const m1 = withProvenance(m0, 'tunnel', { source: 'tomtom', status: 'present', spans: [{ fromM: 5200, toM: 6100 }, { fromM: 1200, toM: 1500 }] });
  const m2 = withProvenance(m1, 'bridge', { source: 'tomtom', status: 'absent' });
  ok('tünel present + aralıklar sıralı', m2.attrs.tunnel.status === 'present' && JSON.stringify(m2.roadSpans) === JSON.stringify([
    { attr: 'tunnel', fromM: 1200, toM: 1500, source: 'tomtom' }, { attr: 'tunnel', fromM: 5200, toM: 6100, source: 'tomtom' }]));
  ok('köprü absent (istendi, yok) ≠ unsupported ≠ unrequested', m2.attrs.bridge.status === 'absent' && attrStatus(m2, 'bridge') === 'absent');
  ok('aralıklar dondurulmuş', m2.roadSpans.every(Object.isFrozen));
  const m3 = withProvenance(m2, 'tunnel', { source: 'tomtom', status: 'absent' });
  ok('yeniden kayıt eski tünel aralıklarını kaldırır', m3.attrs.tunnel.status === 'absent' && m3.roadSpans.length === 0);
  for (const [label, opt] of [
    ['present ama aralık yok', { status: 'present' }], ['present boş aralık', { status: 'present', spans: [] }],
    ['absent ama aralık var', { status: 'absent', spans: [{ fromM: 0, toM: 5 }] }], ['ters aralık', { status: 'present', spans: [{ fromM: 9, toM: 3 }] }],
    ['negatif', { status: 'present', spans: [{ fromM: -1, toM: 3 }] }], ['NaN', { status: 'present', spans: [{ fromM: NaN, toM: 3 }] }],
    ['dizi değil', { status: 'present', spans: 'x' }],
  ]) {
    const r = withProvenance(m0, 'tunnel', { source: 'tomtom', ...opt });
    ok(`tünel geçersiz aralık reddi: ${label}`, r.denied[0]?.reason === 'bad-spans' && r.attrs.tunnel.status === 'unrequested' && r.roadSpans.length === 0);
  }
}

// ---- withProvenance: ret (veri değişmez) ----
{
  const m0 = emptyMeta('mapbox');
  const cases = [
    ['başka sağlayıcı (tomtom → mapbox rotası)', 'lanes', { source: 'tomtom', status: 'present' }, 'cross-provider'],
    ['başka sağlayıcı (here)', 'lanes', { source: 'here', status: 'present' }, 'cross-provider'],
    ['bilinmeyen kaynak', 'lanes', { source: 'waze', status: 'present' }, 'unknown-source'],
    ['kaynak yok', 'lanes', { status: 'present' }, 'unknown-source'],
    ['bilinmeyen öznitelik underpass', 'underpass', { source: 'mapbox', status: 'present' }, 'unknown-attr'],
    ['bilinmeyen öznitelik overpass', 'overpass', { source: 'mapbox', status: 'present' }, 'unknown-attr'],
    ['desteklenmeyen tünel (mapbox)', 'tunnel', { source: 'mapbox', status: 'present', spans: [{ fromM: 0, toM: 1 }] }, 'unsupported'],
    ['geçersiz durum unsupported', 'lanes', { source: 'mapbox', status: 'unsupported' }, 'bad-status'],
    ['geçersiz durum yok', 'lanes', { source: 'mapbox' }, 'bad-status'],
  ];
  for (const [label, attr, opt, reason] of cases) {
    const r = withProvenance(m0, attr, opt);
    ok(`ret: ${label} → ${reason}`, r.denied.length === 1 && r.denied[0].reason === reason && JSON.stringify(r.attrs) === JSON.stringify(m0.attrs) && r.roadSpans.length === 0);
  }
  const unk = emptyMeta('foo');
  ok('bilinmeyen sağlayıcılı rota hiçbir kaynağı kabul etmez', PROVIDERS.every((p) => withProvenance(unk, 'lanes', { source: p, status: 'present' }).denied[0]?.reason === 'cross-provider'));
}

// ---- GPS kaybından köprü/tünel/alt-üst geçit ÇIKARILMAZ ----
{
  const m0 = emptyMeta('tomtom', { supports: ['tunnel', 'bridge'] }); // destek açık olsa bile
  for (const src of INFERRED_SOURCES) for (const attr of ['tunnel', 'bridge']) {
    const r = withProvenance(m0, attr, { source: src, status: 'present', spans: [{ fromM: 100, toM: 400 }] });
    ok(`çıkarım reddi: ${attr} ← ${src}`, r.denied[0]?.reason === 'inferred-source' && r.attrs[attr].status === 'unrequested' && r.roadSpans.length === 0);
  }
  for (const a of ['underpass', 'overpass']) ok(`${a} durumu unsupported`, attrStatus(m0, a) === 'unsupported');
  const src = read('js/nav/routeMeta.js');
  ok('modül GPS/konum/hız okumaz', !/\b(gps\.|navigator\.geolocation|accuracy|coords|speedMs|lastFix|getState)\b/.test(src.replace(/\/\/.*$/gm, '')));
}

// ---- filterBySource ----
{
  let m = emptyMeta('tomtom', { supports: ['lanes', 'tunnel', 'bridge'] });
  m = withProvenance(m, 'lanes', { source: 'tomtom', status: 'absent' });
  m = withProvenance(m, 'tunnel', { source: 'tomtom', status: 'present', spans: [{ fromM: 10, toM: 20 }] });
  m = withProvenance(m, 'bridge', { source: 'mapbox', status: 'present', spans: [{ fromM: 30, toM: 40 }] }); // reddedilir
  const t = filterBySource(m, 'tomtom');
  ok('filtre: tomtom öznitelikleri', Object.keys(t.attrs).join() === 'lanes,tunnel' && t.roadSpans.length === 1 && t.roadSpans[0].source === 'tomtom');
  ok('filtre: kaynağı olmayan köprü atlanır (anahtar yok)', !('bridge' in t.attrs));
  const x = filterBySource(m, 'mapbox');
  ok('filtre: başka sağlayıcı → boş', Object.keys(x.attrs).length === 0 && x.roadSpans.length === 0);
  for (const s of ['waze', null, undefined, 'gps']) {
    const r = filterBySource(m, s);
    ok(`filtre: bilinmeyen kaynak ${JSON.stringify(s)} → boş`, r.source === null && Object.keys(r.attrs).length === 0 && r.roadSpans.length === 0);
  }
  ok('filtre sonucu dondurulmuş', Object.isFrozen(t) && Object.isFrozen(t.attrs) && Object.isFrozen(t.roadSpans));
}

// ---- step.lanes dokunulmaz ----
{
  const steps = [
    { maneuver: 'turn', lanes: [{ arrow: '←', ok: true }, { arrow: '↑', ok: false }] },
    { maneuver: 'depart', lanes: null },
    { maneuver: 'arrive' },
  ];
  const before = JSON.stringify(steps);
  const st = lanesStatusFromSteps(steps);
  let m = withProvenance(emptyMeta('mapbox'), 'lanes', { source: 'mapbox', status: st });
  filterBySource(m, 'mapbox');
  ok('adımlarda şerit varsa present', st === 'present' && m.attrs.lanes.status === 'present');
  ok('step.lanes aynen korunur', JSON.stringify(steps) === before && steps[0].lanes.length === 2 && steps[1].lanes === null && !('lanes' in steps[2]));
  ok('şeritsiz adımlar → absent', lanesStatusFromSteps([{ lanes: null }, { lanes: [] }, {}]) === 'absent' && lanesStatusFromSteps(null) === 'absent');
  ok('üst veri şerit içeriğini kopyalamaz', !JSON.stringify(m).includes('arrow'));
}

// ---- Statik: saf modül, çalışma zamanına bağlı değil ----
const modSrc = read('js/nav/routeMeta.js');
const code = modSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok('modül import içermez', !/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(code));
ok('modül ağ/DOM/depolama/ortam kullanmaz', !/\b(fetch|XMLHttpRequest|WebSocket|document|window|localStorage|sessionStorage|indexedDB|process|navigator)\b/.test(code));
ok('modülde anahtar/sır yok', !/(key|token|secret)\s*[:=]/i.test(code) && !/pk\.eyJ|sk\.eyJ|AIza/.test(modSrc));

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'android', 'www', 'vendor', '.git', 'local-test', 'beta', 'dist'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(m?js|html)$/.test(n)) out.push(p);
  }
  return out;
}
const runtime = [...walk(join(root, 'js')), ...walk(join(root, 'server')), join(root, 'index.html'), join(root, 'sw.js')]
  .map((p) => relative(root, p).replace(/\\/g, '/')).filter((p) => p !== 'js/nav/routeMeta.js');
const importers = runtime.filter((p) => /routeMeta/.test(read(p)));
ok('hiçbir çalışma zamanı dosyası routeMeta’yı içe aktarmaz/anmaz', importers.length === 0, importers.join(', '));
ok('sw.js SHELL routeMeta içermez (bağlı değil)', !read('sw.js').includes('routeMeta'));

// Bugün tünel/köprü veri kaynağı yok: yorumlar ve i18n metinleri dışındaki kodda tunnel/bridge/brunnel/underpass alanı okunmaz/istenmez.
// ('overpass' aranmaz: Overpass API, istasyon/kamera sorgularının adıdır, üst geçit verisi değildir.)
const srcFiles = runtime.filter((p) => /\.m?js$/.test(p) && !p.startsWith('js/i18n/lang/'));
const hits = [];
for (const p of srcFiles) {
  const c = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  if (/\b(tunnels?|bridges?|brunnel|underpass)\b/i.test(c)) hits.push(p);
}
ok('çalışma zamanında tünel/köprü veri kaynağı yok', hits.length === 0, hits.join(', '));
ok('şerit verisi yalnızca mapbox rotasında ayrıştırılır', srcFiles.filter((p) => /parseLanes\(/.test(read(p)) && p !== 'js/nav/lanes.js').join() === 'js/mapbox/route.js');

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
