// BL-P2 yol olayları AYRIŞTIRICI KAPISI (parser gate) regresyon testi (yalnız test; bağımlılıksız, düz node, çevrimdışı):
//   node scripts/test-road-events-parser-gate.mjs
// Bugünkü durumu sabitler: Mapbox (js/mapbox/route.js) ve Valhalla (js/osm/route.js) rota ayrıştırıcıları, yorumları
// çıkarılmış kodlarında doğrulanmamış yol olayı alanlarını (toll_collection, classes, exits, destinations, bannerInstructions)
// OKUMAZ / İSTEMEZ. Bu alanlardan biri ileride okunursa önce sağlayıcı şeması ve lisans doğrulanmalı (BL-P2-06 kabulü);
// bu test o adımı atlayan bir değişikliği yakalar.
// Bilinçli muafiyetler (yanlış pozitif sayılmaz):
// - roundabout_exits: Mapbox İSTEK parametresi (kavşak çıkış numarası metni), yanıttan "exits" alanı okumak değildir.
// - st.intersections?.[0]?.lanes: mevcut şerit verisi (parseLanes, test-lanes.mjs ile sınanır).
// - banner_instructions: false: Valhalla İSTEK parametresi; yalnızca KAPALI (false) olarak kabul edilir.
// - maneuver.exit (tekil): kavşak çıkış numarası; "exits" değildir.
// TomTom ayrıştırıcısı test-road-events-tomtom-contract.mjs'te sınanır; burada tekrar yazılmaz.
// Sağlayıcı şeması uydurulmaz: yalnızca kaynak metni taranır; dedektörün kendi sınaması yapay (SYNTH) parçacıklarla yapılır.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// Ağ engeli (bu test hiçbir modülü içe aktarmaz; yine de sağlayıcı çağrısı olamaz)
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Yorum çıkarma: blok yorumlar + satır yorumları (URL içindeki "://" ve dize içindeki "//" korunur; test-route-meta.mjs ile aynı yaklaşım).
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// Doğrulanmamış olay alanları. Sözcük sınırıyla aranır: "_" sözcük karakteri olduğundan roundabout_exits "exits" eşleşmez.
// Dize anahtarı (st['classes']) ve yapı çözme ({ classes }) de yakalanır; dize içerikleri bilerek SİLİNMEZ.
const FIELDS = ['toll_collection', 'classes', 'exits', 'destinations', 'bannerInstructions'];
const EXEMPT = [
  /\broundabout_exits\b/g,                 // Mapbox istek parametresi
  /\bintersections\?\.\[0\]\?\.lanes\b/g, // mevcut şerit verisi
  /\bbanner_instructions\s*:\s*false\b/g, // Valhalla istek parametresi (kapalı)
];
function scan(code) {
  let c = strip(code);
  for (const re of EXEMPT) c = c.replace(re, ' ');
  return FIELDS.filter((f) => new RegExp(`\\b${f}\\b`).test(c));
}

// ---- 1. Dedektör öz-sınaması (yapay parçacıklar; gerçek sağlayıcı şeması değildir) ----
ok('dedektör: st.bannerInstructions yakalanır', scan('const b = st.bannerInstructions;').join() === 'bannerInstructions');
ok('dedektör: köşeli dize anahtarı yakalanır', scan("const d = st['destinations'];").join() === 'destinations');
ok('dedektör: yapı çözme yakalanır', scan('const { classes } = x;').join() === 'classes');
ok('dedektör: toll_collection yakalanır', scan('if (i.toll_collection) n++;').join() === 'toll_collection');
ok('dedektör: m.exits yakalanır', scan('const e = m.exits;').join() === 'exits');
ok('dedektör: beş alan birlikte yakalanır',
  scan('a.toll_collection; a.classes; a.exits; a.destinations; a.bannerInstructions;').join() === FIELDS.join());
ok('dedektör: yorum içindeki ad yanlış pozitif değil', scan('// SYNTH classes exits\n/* SYNTH destinations\n bannerInstructions */\nconst x = 1;').length === 0);
ok('dedektör: roundabout_exits istek parametresi yanlış pozitif değil', scan("({ steps: 'true', roundabout_exits: 'true' })").length === 0);
ok('dedektör: intersections[0].lanes yanlış pozitif değil', scan('parseLanes(st.intersections?.[0]?.lanes)').length === 0);
ok('dedektör: banner_instructions: false yanlış pozitif değil', scan('({ banner_instructions: false })').length === 0);
ok('dedektör: maneuver.exit (tekil) yanlış pozitif değil', scan('trText(type, modifier, st.name, m.exit)').length === 0);
ok('dedektör: banner_instructions: true muaf DEĞİL (açılırsa ayrıca yakalanır)', !EXEMPT.some((re) => new RegExp(re.source).test('({ banner_instructions: true })')));
ok('dedektör: URL içindeki // yorum sanılmaz', strip("const u = 'https://synthetic.invalid/x'; a.classes;").includes('a.classes'));

// ---- 2. Gerçek ayrıştırıcılar: doğrulanmamış olay alanı okunmaz ----
const PARSERS = ['js/mapbox/route.js', 'js/osm/route.js'];
const src = Object.fromEntries(PARSERS.map((p) => [p, read(p)]));
for (const p of PARSERS) {
  const hits = scan(src[p]);
  ok(`${p}: toll_collection/classes/exits/destinations/bannerInstructions okunmaz`, hits.length === 0, hits.join(', '));
}

// ---- 3. Muafiyetler bugünkü dar kullanımla sınırlı ----
const mbx = strip(src['js/mapbox/route.js']);
const osm = strip(src['js/osm/route.js']);
// intersections yalnızca [0].lanes için okunur (intersections[].classes vb. yok)
const interAll = (mbx.match(/\bintersections\b[^\s,;)]*/g) || []);
ok('mapbox: intersections yalnızca ?.[0]?.lanes ile okunur', interAll.length > 0 && interAll.every((s) => s === 'intersections?.[0]?.lanes'), interAll.join(' | '));
// v0.99.122: Valhalla da (Mapbox ile aynı dar kuralla) yalnız manevra kavşağının şeritlerini okur; tünel/gişe/sınıf alanları valhallaRoadEvents.js'te, burada YOK
const interOsm = (osm.match(/\bintersections\b[^\s,;)]*/g) || []);
ok('osm/valhalla: intersections yalnızca ?.[0]?.lanes ile okunur (classes/toll vb. route.js\'te yok)', interOsm.length > 0 && interOsm.every((s) => s === 'intersections?.[0]?.lanes'), interOsm.join(' | '));
// Valhalla banner talimatları istenmez (açıkça kapalı) ve hiçbir biçimde okunmaz
ok('osm/valhalla: banner_instructions yalnızca false olarak geçer',
  (osm.match(/\bbanner_instructions\b[^,\n]*/g) || []).every((s) => /^banner_instructions\s*:\s*false\s*$/.test(s)));
ok('her iki ayrıştırıcı: banner (bannerInstructions/banner_instructions: true) okunmaz/istenmez',
  !/bannerInstructions|banner_instructions\s*:\s*true/.test(mbx + osm));
// roundabout_exits yalnızca istek parametresi olarak ('true' dizesi) geçer; yanıttan okunmaz
const rbx = mbx.match(/\broundabout_exits\b[^,\n]*/g) || [];
ok('mapbox: roundabout_exits yalnızca istek parametresi', rbx.every((s) => /^roundabout_exits\s*:\s*'true'\s*$/.test(s)), rbx.join(' | '));
ok('mapbox: .roundabout_exits / [\'roundabout_exits\'] yanıt erişimi yok', !/[.[]\s*'?roundabout_exits/.test(mbx));

// ---- 4. v0.99.102: Valhalla yol olayı ayrıştırıcısı (js/nav/valhallaRoadEvents.js) — BL-P2-06 kabulü yalnız osm için ----
// Gerçek kayıt (anahtarsız, ücretsiz FOSSGIS sunucusu, halka açık otoyol) zorunludur; yalnız kayıtta görülen iki alan okunabilir.
{
  const rec = JSON.parse(read('scripts/fixtures/road-events/osm-valhalla-bolu-recorded.json'));
  const ints = rec.response.routes[0].legs.flatMap((l) => l.steps.flatMap((st) => st.intersections || []));
  ok('gerçek kayıt: _synthetic değil, sağlayıcı osm, tarihli', rec._synthetic !== true && rec._recorded?.provider === 'osm' && /^\d{4}-\d{2}-\d{2}$/.test(rec._recorded.date));
  ok('gerçek kayıt: classes tunnel/toll ve toll_collection içerir', ints.some((i) => (i.classes || []).includes('tunnel')) && ints.some((i) => (i.classes || []).includes('toll')) && ints.some((i) => i.toll_collection));
  const vre = scan(read('js/nav/valhallaRoadEvents.js'));
  ok('valhallaRoadEvents: yalnız classes + toll_collection okunur (exits/destinations/bannerInstructions yok)', JSON.stringify(vre.sort()) === JSON.stringify(['classes', 'toll_collection']), vre.join(', '));
  const vcode = strip(read('js/nav/valhallaRoadEvents.js'));
  ok('valhallaRoadEvents: yalnız tunnel/toll sınıfları adlandırılır', JSON.stringify([...new Set(vcode.match(/includes\('([a-z_]+)'\)/g) || [])].sort()) === JSON.stringify(["includes('toll')", "includes('tunnel')"]));
  ok('valhallaRoadEvents: köprü/alt geçit/üst geçit üretmez', !/'(bridge|underpass|overpass|exit|sign)'/.test(vcode));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
