// Valhalla/OSM rotasında şerit bilgisi (v0.99.122) testleri (bağımsız, düz node): node scripts/test-valhalla-lanes.mjs
// Veri: Valhalla'nın OSRM biçimli yanıtı adımın manevra kavşağında (intersections[0]) Mapbox ile AYNI şemada `lanes` taşır (gerçek kayıt:
// scripts/fixtures/lanes/osm-valhalla-ankara-lanes-recorded.json, 18 adım, 2'sinde lanes). Sağlayıcı verisi yoksa şerit gösterilmez (kamerayla tespit YOK).
// Ağ yok: fetch sahte yanıtlanır; gerçek istek atılmaz.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = mem();
globalThis.sessionStorage = mem();
globalThis.document ??= { createElement: () => ({ getContext: () => null }), documentElement: { lang: 'tr' } };

const fx = JSON.parse(read('scripts/fixtures/lanes/osm-valhalla-ankara-lanes-recorded.json'));
const calls = [];
globalThis.fetch = async (url, init) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => fx.response }; };

const { fetchRoute } = await import('../js/osm/route.js');
const { parseLanes, lanesToShow, LANES_SHOW_M, addLaneHint } = await import('../js/nav/lanes.js');
const { lanesStatusFromSteps, DEFAULT_CAPS } = await import('../js/nav/routeMeta.js');

// ---- A) kayıt: şema ----
const rawSteps = fx.response.routes[0].legs.flatMap((l) => l.steps);
const rawLaneSteps = rawSteps.filter((s) => Array.isArray(s.intersections?.[0]?.lanes));
ok('A kayıt: 18 adım, manevra kavşağında lanes olan en az 1 adım', rawSteps.length === 18 && rawLaneSteps.length >= 1);
ok('A kayıt şeması Mapbox ile aynı: indications dizisi + valid mantıksal', rawLaneSteps.every((s) => s.intersections[0].lanes.every((l) => Array.isArray(l.indications) && typeof l.valid === 'boolean')));

// ---- B) fetchRoute adımlara lanes koyar ----
const route = await fetchRoute({ lat: 39.9139, lon: 32.861 }, { lat: 39.8745, lon: 32.749 });
const withLanes = route.steps.filter((s) => s.lanes);
ok('B tek Valhalla isteği (ağ sahte), başka ana makine yok', calls.length === 1 && /valhalla1\.openstreetmap\.de\/route/.test(calls[0]));
const mapped = route.steps.filter((s) => s.type !== 'arrive' && s.type !== 'stop'); // Valhalla adımları; sentetik varış/ara durak adımları hariç
  ok('B Valhalla adımlarının hepsinde lanes alanı var: veri yoksa null (undefined değil)', mapped.length === 17 && mapped.every((s) => 'lanes' in s) && mapped.filter((s) => !s.lanes).every((s) => s.lanes === null));
ok('B lanes olan adım sayısı: kayıttaki parseLanes kabul eden adımlar kadar', withLanes.length === rawLaneSteps.filter((s) => parseLanes(s.intersections[0].lanes)).length && withLanes.length >= 1);
{
  const raw = rawLaneSteps[0].intersections[0].lanes;
  const expect = parseLanes(raw);
  const got = withLanes[0].lanes;
  ok('B şeritler parseLanes ile aynı: 5 şerit, 2 uygun + 3 uygun değil', got.length === 5 && JSON.stringify(got) === JSON.stringify(expect) && got.filter((l) => l.ok).length === 2 && got.filter((l) => !l.ok).length === 3);
  ok('B oklar: ilk üç şerit düz (uygun değil), son iki şerit hafif sağ (rotadaki dönüş için uygun)', got.slice(0, 3).every((l) => l.arrow === '↑' && !l.ok) && got.slice(3).every((l) => l.arrow === '↗' && l.ok));
}
ok('B varış ve ara durak adımlarında lanes yok (null/undefined)', !route.steps.at(-1).lanes);

// ---- C) gösterim kuralı sağlayıcıdan bağımsız ----
{
  const st = withLanes[0];
  ok('C manevraya 2 km kala gösterilir, uzaktaysa gösterilmez', lanesToShow(st, 400) === st.lanes && lanesToShow(st, LANES_SHOW_M + 1) === null);
  const hint = addLaneHint(new Set(), 0, st, 400, 'Sağa dön');
  ok('C sesli şerit ipucu metni bozulmaz (dize döner)', typeof hint === 'string' && hint.length >= 'Sağa dön'.length);
}

// ---- D) rota üst verisi + kablolama ----
{
  ok('D routeMeta: osm şerit yeteneği artık tanımlı (yalnızca adımlarda veri varsa present)', DEFAULT_CAPS.osm.includes('lanes') && DEFAULT_CAPS.mapbox.includes('lanes') && !DEFAULT_CAPS.tomtom.includes('lanes') && !DEFAULT_CAPS.here.includes('lanes') && !DEFAULT_CAPS.google.includes('lanes'));
  ok('D lanesStatusFromSteps: veri varsa present, yoksa absent', lanesStatusFromSteps(route.steps) === 'present' && lanesStatusFromSteps(route.steps.map((s) => ({ ...s, lanes: null }))) === 'absent');
  const rsrc = read('js/osm/route.js'), ver = read('version.js');
  ok('D route.js: parseLanes içe aktarılır ve intersections[0].lanes okunur', /import \{ parseLanes \} from '\.\.\/nav\/lanes\.js'/.test(rsrc) && /parseLanes\(st\.intersections\?\.\[0\]\?\.lanes\)/.test(rsrc));
  ok('D kamerayla/çıkarımla şerit üretilmez: route.js yalnız sağlayıcı alanını okur', !/camera|ocr|heuristic/i.test(rsrc.split('\n').filter((l) => /lanes/.test(l)).join('\n')));
  ok('D sürüm 0.99.122', /self\.APP_VERSION = '0\.99\.122';/.test(ver) && /v: '0\.99\.122'/.test(ver));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
