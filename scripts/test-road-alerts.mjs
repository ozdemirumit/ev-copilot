// Tünel / ücretli yol uyarıları (v0.99.102) testi — düz node, çevrimdışı, ağ engelli:
//   node scripts/test-road-alerts.mjs
// Kapsam: gerçek Valhalla kaydından normalleştirme (scripts/fixtures/road-events/osm-valhalla-bolu-recorded.json), rotaya ileri yönlü
// bağlama (karşı şerit / rota dışı / açık tünel yok), kalan mesafenin azalması, geçilen olayın düşmesi, ses tekrarsızlığı, yanlış uyarı
// olmaması (köprü/alt geçit/üst geçit, kısa tünel, başka sağlayıcı, rota dışı, eski konum, GPS sıçraması), üst bar önceliği, eksik
// yetenek ve osm/route.js'in rota nesnesine modeli eklemesi.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const J = JSON.stringify;

let netCalls = 0;
const REC = JSON.parse(read('scripts/fixtures/road-events/osm-valhalla-bolu-recorded.json'));
let fetchImpl = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.fetch = (...a) => fetchImpl(...a);
const stored = new Map();
globalThis.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };

const V = await import('../js/nav/valhallaRoadEvents.js');
const A = await import('../js/nav/roadAlerts.js');
const E = await import('../js/nav/roadEvents.js');
const { decodePolyline6 } = await import('../js/osm/route.js');

// ---- 1. Gerçek kayıt: normalleştirme ----
const coords = decodePolyline6(REC.response.routes[0].geometry);
const model = V.fromValhallaOsrm(REC.response, coords);
ok('kayıt meta: sağlayıcı osm, tarih var, anahtar/sır yok', REC._recorded?.provider === 'osm' && /^\d{4}-\d{2}-\d{2}$/.test(REC._recorded.date)
  && !/(key|token|secret|access_token)\s*["']?\s*[:=]/i.test(J(REC)) && !/pk\.eyJ|sk\.eyJ|AIza/.test(J(REC)));
ok('model sağlayıcısı osm, yetenek yalnız tunnel+toll', model.provider === 'osm' && J(model.supports) === '["tunnel","toll"]');
const tun = model.events.filter((e) => e.kind === 'tunnel');
const tolls = model.events.filter((e) => e.kind === 'toll');
ok('Bolu Dağı Tüneli: 29923–33043 m (3,12 km; gerçek ≈3 km)', tun.some((e) => e.fromM === 29923 && e.toM === 33043), J(tun));
ok('kısa tünel parçası modelde var (29 m) ama uyarılmaz', tun.some((e) => e.toM - e.fromM < A.MIN_TUNNEL_M) && !A.alertable(model).some((e) => e.toM - e.fromM < A.MIN_TUNNEL_M));
ok('ücretli yol girişi 4831 m (gişe 4991 m ile birleşti) ve çıkış gişesi 45738 m', J(tolls.map((e) => e.atM)) === '[4831,45738]', J(tolls));
ok('köprü/alt geçit/üst geçit/çıkış/tabela üretilmez (alan yok)', model.events.every((e) => e.kind === 'tunnel' || e.kind === 'toll'));
ok('reddedilen olay yok, model dondurulmuş', model.denied.length === 0 && Object.isFrozen(model) && Object.isFrozen(model.events));
ok('tüm olaylar kaynak=osm', model.events.every((e) => e.source === 'osm'));
ok('aynı girdi → aynı çıktı', J(V.fromValhallaOsrm(REC.response, coords)) === J(model));

// ---- 2. Eksik yetenek / geçersiz girdi ----
{
  const bads = [null, undefined, {}, { routes: [] }, { routes: [{}] }, 'x', 42];
  const allEmpty = bads.every((b) => { const m = V.fromValhallaOsrm(b, coords); return m.provider === 'osm' && m.events.length === 0 && m.supports.length === 0; });
  ok('geçersiz girdi → boş osm modeli, yetenek yok', allEmpty);
}
ok('koordinat yoksa boş model', V.fromValhallaOsrm(REC.response, []).events.length === 0 && V.fromValhallaOsrm(REC.response, null).supports.length === 0);
{
  const noCls = JSON.parse(J(REC.response));
  for (const l of noCls.routes[0].legs) for (const s of l.steps) for (const i of s.intersections) { delete i.classes; delete i.toll_collection; }
  ok('sınıf alanı olmayan yanıt → olay yok (uydurma yok)', V.fromValhallaOsrm(noCls, coords).events.length === 0);
}

// ---- 3. Rotaya bağlama: ileri yönlü, karşı şerit yok, rota dışı yok, açık tünel yok ----
{
  // Gidiş-dönüş: kuzeye 21 nokta (lon 30.0000), dönüş karşı şeritte (lon 30.0002 ≈ 17 m doğu) güneye.
  const out = []; for (let i = 0; i <= 20; i++) out.push([30.0, 40.0 + i * 0.001]);
  const back = []; for (let i = 20; i >= 0; i--) back.push([30.0002, 40.0 + i * 0.001]);
  const line = [...out, ...back];
  const I = (loc, classes, extra = {}) => ({ location: loc, ...(classes ? { classes } : {}), ...extra });
  const { buildTrack } = await import('../js/nav/track.js');
  const tr = buildTrack(line);
  const resp = { routes: [{ legs: [{ steps: [{ intersections: [I([30.0, 40.002]), I([30.0, 40.005])] },
    { intersections: [I([30.0002, 40.012], ['tunnel']), I([30.0002, 40.010])] }] }] }] };
  const t0 = V.fromValhallaOsrm(resp, line).events.find((e) => e.kind === 'tunnel');
  const idxBack = 21 + (20 - 12); // dönüş şeridindeki 40.012 köşesi
  ok('karşı şerit: tünel dönüş şeridindeki köşeye bağlanır (gidiştekine değil)', t0 && t0.fromM === Math.round(tr.cum[idxBack] * 1000) && t0.toM > t0.fromM, J(t0));
  const off = { routes: [{ legs: [{ steps: [{ intersections: [I([30.01, 40.005], ['tunnel']), I([30.01, 40.006])] }] }] }] };
  ok('rotadan > 3 m uzak kavşak bağlanmaz', V.fromValhallaOsrm(off, line).events.length === 0);
  const open = { routes: [{ legs: [{ steps: [{ intersections: [I([30.0, 40.003], ['tunnel']), I([30.0, 40.004], ['tunnel'])] }] }] }] };
  ok('sonu bulunamayan (açık) tünel üretilmez', V.fromValhallaOsrm(open, line).events.length === 0);
  const startToll = { routes: [{ legs: [{ steps: [{ intersections: [I([30.0, 40.0], ['toll']), I([30.0, 40.004], ['toll'])] }] }] }] };
  ok('rota zaten ücretli yolda başlıyorsa giriş uyarısı yok', V.fromValhallaOsrm(startToll, line).events.length === 0);
  const booth = { routes: [{ legs: [{ steps: [{ intersections: [I([30.0, 40.004], ['toll'], { toll_collection: { type: 'toll_gantry' } })] }] }] }] };
  ok('toll_collection (gantry) gişe noktası olur', V.fromValhallaOsrm(booth, line).events.filter((e) => e.kind === 'toll').length === 1);
  // Sıra dışı: önce 40.010 (gidiş, dizin 10), sonra 40.003 tünel başı → ileri aramada gidişte bulunamaz, dönüş şeridinde 3 m'den uzak: atlanır
  const back2 = { routes: [{ legs: [{ steps: [{ intersections: [I([30.0, 40.010]), I([30.0, 40.003], ['tunnel']), I([30.0, 40.004])] }] }] }] };
  ok('geriye dönük (sıra dışı) kavşak rotanın gerisine bağlanmaz', V.fromValhallaOsrm(back2, line).events.length === 0);
}

// ---- 4. Canlı ilerleme: mesafe azalır, geçilen düşer ----
const step = (st, km, o = {}) => A.stepRoadAlerts(st, { model, planId: 1, routeKm: km, offRouteKm: 0.01, fresh: true, now: km * 30000, ...o }); // ~120 km/s
{
  const st = A.createRoadAlerts();
  const d = [28.0, 28.5, 29.0].map((k) => step(st, k).line?.dM);
  ok('kalan mesafe her adımda azalır (1923 → 1423 → 923 m)', J(d.map((x) => Math.round(x))) === '[1923,1423,923]', J(d));
  ok('2 km dışındaki olay gösterilmez', step(A.createRoadAlerts(), 20).line === null);
  const st2 = A.createRoadAlerts();
  step(st2, 29.5);
  ok('tünele girildikten sonra satır düşer (içindeki tünel "ileride" değil)', step(st2, 30.2).line === null);
  ok('tünel geçildikten sonra sıradaki olay yalnız 2 km içine girince', step(st2, 43.0).line === null && step(st2, 44.0).line?.kind === 'toll');
  ok('soon: 500 m içinde true, dışında false', step(st2, 45.3).soon === true && step(A.createRoadAlerts(), 44.0).soon === false);
}

// ---- 5. Ses: aşama başına bir kez, tek tick'te tek konuşma, rota değişince sıfırlanır ----
{
  const st = A.createRoadAlerts();
  const said = [];
  for (let km = 27.0; km <= 30.5; km += 0.05) for (const s of step(st, km).speak) said.push(s.key);
  ok('tünel için uzak + yakın tam bir kez', J(said) === J(['tunnel@29923:far', 'tunnel@29923:near']), J(said));
  const again = [];
  for (let km = 27.0; km <= 30.5; km += 0.05) for (const s of step(st, km, { now: 1e9 + km * 30000 }).speak) again.push(s.key);
  ok('aynı planda aynı konumlardan yeniden geçiş tekrar söyletmez', again.length === 0, J(again));
  const re = [];
  for (let km = 28.5; km <= 29.9; km += 0.05) for (const s of step(st, km, { planId: 2 }).speak) re.push(s.key);
  ok('rota değişince (planId) durum sıfırlanır', re.length >= 1, J(re));
  const st3 = A.createRoadAlerts();
  const keyed = [];
  for (let km = 28.5; km <= 29.9; km += 0.05) for (const s of step(st3, km, { keyOf: (e) => `${e.kind}@GEO` }).speak) keyed.push(s.key);
  ok('keyOf ile coğrafi anahtar kullanılır', keyed.length === 2 && keyed.every((k) => k.startsWith('tunnel@GEO:')), J(keyed));
  const st4 = A.createRoadAlerts();
  const near = step(st4, 29.6).speak; // doğrudan yakın pencerede başla
  ok('yakın pencerede başlarsa yalnız yakın söylenir', near.length === 1 && near[0].stage === 'near');
  ok('yakın söylendikten sonra geri gidişte uzak söylenmez', step(st4, 29.0, { now: 29.6 * 30000 + 60000 }).speak.length === 0);
  const m2 = E.addEvent(E.addEvent(E.emptyEvents('osm', { supports: ['tunnel', 'toll'] }), { kind: 'toll', source: 'osm', atM: 1300 }), { kind: 'tunnel', source: 'osm', fromM: 2000, toM: 2500 });
  const s5 = A.stepRoadAlerts(A.createRoadAlerts(), { model: m2, planId: 1, routeKm: 1.0, offRouteKm: 0, now: 0 }).speak;
  ok('aynı tick\'te tek konuşma (en yakın olay)', s5.length === 1 && s5[0].kind === 'toll' && s5[0].stage === 'near', J(s5));
}

// ---- 6. Yanlış uyarı yok ----
{
  ok('model yok → boş', J(A.stepRoadAlerts(A.createRoadAlerts(), { model: null, planId: 1, routeKm: 29 })) === J({ line: null, soon: false, speak: [] }));
  ok('Mapbox/TomTom boş modeli → boş', A.stepRoadAlerts(A.createRoadAlerts(), { model: E.emptyEvents('mapbox'), planId: 1, routeKm: 29 }).line === null);
  const br = E.addEvent(E.addEvent(E.addEvent(E.emptyEvents('osm', { supports: E.KINDS }), { kind: 'bridge', source: 'osm', fromM: 1500, toM: 1800 }),
    { kind: 'underpass', source: 'osm', fromM: 1600, toM: 1700 }), { kind: 'overpass', source: 'osm', fromM: 1650, toM: 1660 });
  // v0.99.118: köprü ve alt geçit artık OSM ekstralarıyla uyarılır (scripts/test-road-extras.mjs); ÜST GEÇİT hâlâ uyarılmaz (sürücü için anlamlı değil, veri kaynağı yok)
  const op = E.addEvent(E.emptyEvents('osm', { supports: E.KINDS }), { kind: 'overpass', source: 'osm', fromM: 1650, toM: 1700 });
  ok('üst geçit uyarılmaz; köprü + alt geçit alertable, üst geçit değil', br.events.length === 3 && A.stepRoadAlerts(A.createRoadAlerts(), { model: op, planId: 1, routeKm: 0.8 }).line === null && J(A.alertable(br).map((e) => e.kind)) === J(['bridge', 'underpass']));
  const unsup = E.addEvent(E.emptyEvents('osm', { supports: [] }), { kind: 'tunnel', source: 'osm', fromM: 1500, toM: 1800 });
  ok('yeteneksiz modelde olay yok (unsupported reddi)', unsup.events.length === 0 && A.alertable(unsup).length === 0);
  ok('rotadan çıkınca (offRoute > 100 m) gösterim/ses yok', J(step(A.createRoadAlerts(), 29.5, { offRouteKm: 0.3 })) === J({ line: null, soon: false, speak: [] }));
  ok('konum taze değilken (GPS aranıyor) gösterim/ses yok', step(A.createRoadAlerts(), 29.5, { fresh: false }).line === null);
  ok('konum yok / geçersiz → boş', step(A.createRoadAlerts(), null).line === null && step(A.createRoadAlerts(), NaN).line === null && step(A.createRoadAlerts(), -1).line === null);
  const sj = A.createRoadAlerts();
  step(sj, 10.0);
  const j = step(sj, 29.6, { now: 10.0 * 30000 + 3000 }); // 3 sn'de 19,6 km: sıçrama
  ok('GPS sıçramasında o adım konuşulmaz (satır gösterilir)', j.speak.length === 0 && j.line?.kind === 'tunnel');
  ok('sıçramadan sonraki normal adımda konuşur', step(sj, 29.65, { now: 10.0 * 30000 + 6000 }).speak.length === 1);
}

// ---- 7. Üst bar önceliği ----
ok('yol olayı yoksa sıra değişmez (boşlar atılır)', J(A.orderAlerts(['pil', null, 'trafik', ' '], null)) === J(['pil', 'trafik']));
ok('yol olayı başa girer', J(A.orderAlerts(['pil', 'trafik'], 'tünel')) === J(['tünel', 'pil', 'trafik']));
ok('yakın (soon) yol olayı tek başına sabitlenir', J(A.orderAlerts(['pil', 'trafik'], 'tünel', true)) === J(['tünel']));
{
  const { pickSlot } = await import('../js/nav/panelLogic.js');
  const list = A.orderAlerts(['pil'], 'tünel', true);
  const shown = [0, 1, 2, 3].map((t) => pickSlot(list.map((_, i) => 'alert:' + i), t, true));
  ok('hız aşımı soon yol olayıyla dönüşümlü kalır', J(shown) === J(['over', 'alert:0', 'over', 'alert:0']), J(shown));
}

// ---- 8. osm/route.js rota nesnesine modeli ekler (ağ sahte: kayıtlı yanıt) ----
{
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => REC.response, text: async () => J(REC.response) });
  const R = await import('../js/osm/route.js');
  let rt = null, err = null;
  try { rt = await R.fetchRoute({ lat: 40.838, lon: 31.163 }, { lat: 40.74, lon: 31.6 }); } catch (e) { err = e; }
  ok('Valhalla rotası roadEvents taşır (tünel + gişe)', rt && rt.roadEvents?.provider === 'osm' && rt.roadEvents.events.length === 4, err ? err.message : J(rt?.roadEvents));
  ok('rota alanları değişmedi (coords/steps/distanceKm)', rt && rt.coords.length === coords.length && Array.isArray(rt.steps) && Math.abs(rt.distanceKm - 49.894574) < 1e-6);
  fetchImpl = () => { netCalls++; throw new Error('ağ yasak'); };
}

// ---- 9. Statik: bağlantı, sağlayıcı koruması, ek ağ yok ----
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const rw = strip(read('js/nav/roadWarnings.js'));
ok('roadWarnings: model yalnızca routeMeta.provider ile aynı sağlayıcınınsa kullanılır', /routeMeta\?\.provider === model\.provider/.test(rw));
ok('roadWarnings: yol olayı için ağ çağrısı yok (yalnız mevcut kamera sorgusu)', (rw.match(/\bfetch\w*\(/g) || []).every((x) => x === 'fetchCameras('));
ok('roadAlerts/valhallaRoadEvents saf (ağ/DOM/depolama/zaman yok)', ['js/nav/roadAlerts.js', 'js/nav/valhallaRoadEvents.js'].every((p) => !/\b(fetch|document|window|localStorage|Date\.now|setTimeout|setInterval)\b/.test(strip(read(p)))));
ok('navigator üst barı orderAlerts ile sıralar', /orderAlerts\(base, a\.road, !!a\.roadSoon\)/.test(strip(read('js/nav/navigator.js'))));
ok('Mapbox/TomTom rota ayrıştırıcıları yol olayı üretmez', !/roadEvents|valhallaRoadEvents/.test(read('js/mapbox/route.js') + read('js/tomtom/route.js')));
ok('ağ çağrısı yapılmadı', netCalls === 0, String(netCalls));
console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
