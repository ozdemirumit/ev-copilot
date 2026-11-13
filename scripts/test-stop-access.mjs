// Şarj durağına YOL AĞIYLA erişim (karşı yön tesisi seçilmez). Kullanım: node scripts/test-stop-access.mjs
// 1) Saf yardımcı js/routing/stopAccess.js: taraf (sağ/sol), rota üstü A/B noktaları ve yönü, sapma kararı, kayıt defteri, uygulama.
// 2) Gerçek veri: O-7 Kuzey Marmara Otoyolu Çatalca Opet/Trugo tesisleri (scripts/fixtures/o7-catalca-access.json: Valhalla rota çizgisi,
//    OSM istasyon konumları ve Valhalla erişim sorgusu sonuçları kaydı). Düz çizgide hepsi 57-113 m; yol ağıyla karşı yön ≈ 36 km sapma.
// 3) Denetleyici (planTrip): bölünmüş otoyolda karşı yöndeki ucuz/güçlü tesis yerine doğru yöndeki seçilir; tek aday karşı yöndeyse
//    plan kurulmaz (karşı yön seçilmez); sorgu başarısızsa plan korunur ve uyarılır; ters yönde yolculukta öbür tesis seçilir.
// 4) Sağlayıcı isteği: Valhalla gövdesi (A/B yön kısıtı, istasyonda preferred_side, directions_type none).
// Ağ engellidir; yol ağı sorguları sahtedir (bölünmüş otoyol modeli ya da kayıtlı gerçek sonuçlar).
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

const S = (globalThis.__saStub = { calls: [], probes: [], toasts: [], route: null, probe: null, chargers: null, valhallaBody: null });
const g = 'globalThis.__saStub';
const PARENT_STUBS = {
  '/js/routing/controller.js': {
    '../providers/index.js': `
      export const fetchRoute = async (...a) => { ${g}.calls.push(a); return ${g}.route(...a); };
      export const fetchElevations = async () => null;
      export const fetchWeather = async () => null;
      export const fetchChargers = async (pts, profile) => ({ stations: ${g}.chargers(profile), errors: [], cached: false, summary: null });
      export const probeStopAccess = async (q) => { ${g}.probes.push(q); return ${g}.probe(q); };`,
    '../ui/mapView.js': `export const mapApi = { drawRoute: () => {}, drawStations: () => {}, setPoint: () => {}, clearRoute: () => {} };`,
    '../ui/toast.js': `export const toast = (m) => { ${g}.toasts.push(String(m)); };`,
    '../ui/recentDest.js': 'export const rememberDest = () => {};',
    '../utils/idb.js': 'export const kvDel = () => {};',
    '../physics/socEstimate.js': 'export const setManual = () => {};',
  },
  '/js/osm/accessProbe.js': { './valhalla.js': `export const valhalla = async (path, body, ms) => { ${g}.valhallaBody = { path, body, ms }; return { trip: { summary: { length: 6.06 } } }; };` },
};
registerHooks({
  resolve(spec, ctx, next) {
    for (const [parent, map] of Object.entries(PARENT_STUBS)) {
      if (ctx.parentURL?.endsWith(parent) && spec in map) return { url: 'data:text/javascript,' + encodeURIComponent(map[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const A = await import('../js/routing/stopAccess.js');

// ---------- 1) Saf yardımcı: bölünmüş otoyol modeli ----------
// Doğuya giden şerit (gidiş) 40,0000°K'de; batıya giden karşı şerit 40,0008°K'de (≈ 90 m kuzey). Karşı yön tesisi kuzeyde.
const LAT = 40;
const east = []; for (let x = 28; x <= 31 + 1e-9; x += 0.005) east.push([+x.toFixed(5), LAT]);
const cum = A.lineKm(east);
const southRest = { id: 'south', name: 'Doğru yön tesisi', lat: LAT - 0.0006, lon: 29.0 }; // ≈ 67 m güney: gidiş yönünün sağı
const northRest = { id: 'north', name: 'Karşı yön tesisi', lat: LAT + 0.0008, lon: 29.0 }; // ≈ 89 m kuzey: karşı şerit tarafı
const ls = A.locateOnLine(east, cum, southRest);
const ln = A.locateOnLine(east, cum, northRest);
ok('taraf: güneydeki tesis doğuya gidişte sağda', ls.side === 'right', JSON.stringify(ls));
ok('taraf: kuzeydeki tesis doğuya gidişte solda', ln.side === 'left', JSON.stringify(ln));
ok('düz çizgide ikisi de "yol üstü" görünür (< 100 m): yakınlık erişim kanıtı olamaz', ls.offKm < 0.1 && ln.offKm < 0.1, `${ls.offKm} ${ln.offKm}`);
const west = [...east].reverse();
ok('ters yönde taraflar yer değiştirir', A.locateOnLine(west, A.lineKm(west), northRest).side === 'right' && A.locateOnLine(west, A.lineKm(west), southRest).side === 'left');
const pr = A.accessProbe(east, { ...northRest, km: ln.km });
ok('A ve B rota çizgisinin üzerinde, istasyonun 3 km önü/arkası', pr && Math.abs(pr.a.lat - LAT) < 1e-9 && Math.abs(pr.b.lat - LAT) < 1e-9 && Math.abs(pr.alongKm - 6) < 0.01, JSON.stringify(pr));
ok('A ve B gidiş yönünü taşır (doğu ≈ 90°): sorgu karşı şeride oturmaz', Math.abs(pr.a.heading - 90) <= 1 && Math.abs(pr.b.heading - 90) <= 1, `${pr.a.heading} ${pr.b.heading}`);
const pStart = A.accessProbe(east, { lat: LAT - 0.0005, lon: 28.01, km: 0.85 });
ok('rota başına yakın durak: A rota başına kırpılır', pStart && pStart.a.km === 0 && pStart.alongKm > 3, JSON.stringify(pStart?.a));
ok('geçersiz girdi → null', A.accessProbe([], southRest) === null && A.accessProbe(east, { lat: NaN, lon: 1 }) === null);

// Sapma kararı
const j1 = A.judgeAccess({ routedKm: 42.291, alongKm: 6, geoOffKm: 0.08 });
ok('karşı yön (O-7 Çatalca kaydı: 36,3 km sapma, 80 m düz) → erişilemez', j1.ok === false && Math.abs(j1.detourKm - 36.291) < 1e-6, JSON.stringify(j1));
const j2 = A.judgeAccess({ routedKm: 6.058, alongKm: 6, geoOffKm: 0.063 });
ok('doğru yön (0,06 km sapma) → erişilebilir, sapma maliyete girer', j2.ok && j2.detourKm < 0.1, JSON.stringify(j2));
const j3 = A.judgeAccess({ routedKm: 13, alongKm: 6, geoOffKm: 2.4 });
ok('otoyoldan 2,4 km uzak istasyon, çıkış/giriş ile 7 km sapma → erişilebilir (orantılı)', j3.ok && j3.detourKm === 7);
const j4 = A.judgeAccess({ routedKm: 9.5, alongKm: 6, geoOffKm: 0.09 });
ok('karşı yön ama yakın kavşaktan yasal dönüş (3,5 km) → erişilebilir, gerçek sapmayla fiyatlanır', j4.ok && j4.detourKm === 3.5);
ok('negatif sapma 0 sayılır', A.judgeAccess({ routedKm: 5.9, alongKm: 6 }).detourKm === 0);

// Kayıt defteri: yön ayrımı ve yeniden deneme
const book = A.createAccessBook();
book.put('x', { heading: 90, verified: true, ok: false, detourKm: 36, at: 0 });
ok('aynı yön (±60°) kaydı bulunur', book.get('x', 100)?.ok === false && book.get('x', 145)?.ok === false && book.get('x', 20) === null);
ok('ters yön (270°) için kayıt yok: yeniden sorgulanır', book.get('x', 270) === null && book.needs('x', 270));
book.put('x', { heading: 270, verified: true, ok: true, detourKm: 0.1, at: 0 });
ok('iki yön ayrı tutulur', book.get('x', 90)?.ok === false && book.get('x', 270)?.ok === true);
book.put('y', { heading: 90, verified: false, at: 1000 });
ok('başarısız sorgu RETRY_MS dolmadan tekrarlanmaz, dolunca tekrarlanır', !book.needs('y', 90, 1000 + A.RETRY_MS - 1) && book.needs('y', 90, 1000 + A.RETRY_MS));

// Uygulama: maliyet ve eleme
const sts = [{ id: 'x', km: 50, offKm: 0.08 }, { id: 'z', km: 60, offKm: 0.07 }, { id: 'w', km: 70, offKm: 0.1 }];
const b2 = A.createAccessBook();
b2.put('x', { heading: 90, verified: true, ok: false, detourKm: 36, at: 0 });
b2.put('z', { heading: 90, verified: true, ok: true, detourKm: 0.6, at: 0 });
const ap = A.applyAccess(sts, b2, () => 90);
ok('erişilemeyen elenir (blocked)', ap.blocked.join() === 'x', ap.blocked.join());
ok('erişilebilenin sapması yol ağından: offKm = sapma / 2, düz çizgi geoOffKm olarak saklanır', ap.stations[1].offKm === 0.3 && ap.stations[1].geoOffKm === 0.07 && ap.stations[1].access?.verified === true);
ok('doğrulanmamış istasyon aynen kalır (erişim varsayılmaz, işaret yok)', ap.stations[2] === sts[2]);
ok('kullanıcının elle seçtiği durak elenmez (maliyetiyle kalır)', A.applyAccess(sts, b2, () => 90, new Set(['x'])).blocked.length === 0);
ok('girdi değiştirilmez', sts[1].offKm === 0.07 && !('access' in sts[1]));

// verifyStops: bölünmüş otoyol yol ağı modeli (kavşaklar 28,6° ve 29,4°: karşı yön tesisine ancak kavşakta dönülerek gidilir)
const divided = ({ a, station, b }) => {
  const along = (b.lon - a.lon) * 111.32 * Math.cos((LAT * Math.PI) / 180);
  if (station.lat > LAT) { // karşı şerit: sonraki kavşağa (29,4°) git, dön, tesise gel, bir önceki kavşağa (28,6°) git, dön, B'ye
    const kx = 111.32 * Math.cos((LAT * Math.PI) / 180);
    return along + 2 * (29.4 - station.lon) * kx + 2 * (station.lon - 28.6) * kx;
  }
  return along + 0.15;
};
const b3 = A.createAccessBook();
const stops = [{ km: ln.km, station: { ...northRest, km: ln.km } }, { km: ls.km + 40, station: { ...southRest, id: 'south2', lon: 29.47, km: ls.km + 40 } }];
const v = await A.verifyStops({ coords: east, stops, book: b3, probe: divided, now: () => 0 });
ok('verifyStops: karşı yön elenir, doğru yön geçer', v.checked === 2 && v.rejected.map((s) => s.id).join() === 'north' && b3.get('south2', 90)?.ok === true, JSON.stringify(v));
const again = await A.verifyStops({ coords: east, stops, book: b3, probe: () => { throw new Error('çağrılmamalı'); }, now: () => 0 });
ok('aynı yönde ikinci kez sorgulanmaz (önbellek)', again.checked === 0);
const b4 = A.createAccessBook();
const vf = await A.verifyStops({ coords: east, stops, book: b4, probe: () => { throw new Error('ağ yok'); }, now: () => 0 });
ok('sorgu başarısız: elenmez, "doğrulanmadı" kaydı', vf.failed.length === 2 && vf.rejected.length === 0 && b4.get('north', 90)?.verified === false);
ok('geride kalan durak sorgulanmaz', (await A.verifyStops({ coords: east, stops, fromKm: 200, book: A.createAccessBook(), probe: divided })).checked === 0);

// ---------- 2) Gerçek veri: O-7 Çatalca ----------
const FX = JSON.parse(readFileSync(new URL('./fixtures/o7-catalca-access.json', import.meta.url), 'utf8'));
for (const dir of ['east', 'west']) {
  const { coords, probes } = FX.dirs[dir];
  const c = A.lineKm(coords);
  const byId = Object.fromEntries(FX.stations.map((s) => [s.id, s]));
  const decided = {};
  for (const s of FX.stations) {
    const p = A.accessProbe(coords, s, { cum: c });
    const rec = probes[s.id];
    decided[s.id] = A.judgeAccess({ routedKm: rec.routedKm, alongKm: p.alongKm, geoOffKm: p.at.offKm });
    ok(`O-7 ${dir} ${s.name}: taraf ${p.at.side}, düz ${Math.round(p.at.offKm * 1000)} m, yol ağı sapması ${decided[s.id].detourKm.toFixed(2)} km → ${decided[s.id].ok ? 'erişilebilir' : 'ELENİR'}`,
      p.at.side === rec.side && Math.abs(p.alongKm - rec.alongKm) < 0.01 && decided[s.id].ok === (p.at.side === 'right') && p.at.offKm < 0.12);
  }
  const okIds = Object.keys(decided).filter((id) => decided[id].ok).map((id) => byId[id].name).sort().join(', ');
  ok(`O-7 ${dir}: yalnızca gidiş yönündeki Opet + Trugo kalır (${okIds})`, okIds === (dir === 'east' ? 'Opet (güney), Togg Trugo (güney)' : 'Opet (kuzey), Togg Trugo (kuzey)'));
}

// ---------- 3) Denetleyici ----------
const { PLANNER } = await import('../js/config.js');
PLANNER.minKw = 50; PLANNER.minStopAdd = 0; PLANNER.brands = [];
const { getState, patch } = await import('../js/state.js');
const C = await import('../js/routing/controller.js');

const START = { lat: LAT, lon: 28 }, END = { lat: LAT, lon: 31 };
const lineRoute = (coords) => () => {
  const km = A.lineKm(coords).at(-1);
  return { coords, intervals: [], distanceKm: km, durationH: km / 100, trafficRatio: 1, steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın', distM: km * 1000, staticSec: km * 36 }, { type: 'arrive', modifier: null, text: 'Varış', distM: 0 }] };
};
const mk = (base, extra = {}) => ({ ...base, opId: 'other', src: 'test', srcKw: 180, kw: 180, price: 10, slow: false, uncertain: false, ...extra });
// Karşı yön tesisi (kuzey) planlayıcının tercih edeceği şekilde daha ucuz ve daha güçlü; doğru yön tesisi (güney) aynı km'de
const opp = mk(northRest, { id: 'opp', name: 'Opet/Trugo karşı yön', kw: 300, srcKw: 300, price: 5 });
const right = mk(southRest, { id: 'right', name: 'Opet/Trugo doğru yön', kw: 180, price: 10 });
const reset = (list, coords = east) => {
  S.calls = []; S.probes = []; S.toasts = [];
  S.route = lineRoute(coords);
  S.probe = divided;
  S.chargers = (profile) => list.map((x) => ({ ...x, ...profile.project(x.lat, x.lon) }));
  C.clearTrip();
  patch('route', { start: START, end: END, via: null });
  patch('live', { soc: 30 });
};

// Önce: düz çizgi izdüşümünde karşı yön tesisi "yol üstü" (eski hata koşulu)
reset([opp, right]);
S.probe = () => { throw new Error('ağ yok'); };
await C.planTrip();
let p = getState('plan');
ok('hata koşulu yeniden üretildi: yol ağı olmadan planlayıcı karşı yön tesisini seçer (sapma ≈ 0 sanılır)', p.stops[0]?.station.id === 'opp' && p.stops[0].station.offKm < 0.1, p.stops.map((s) => s.station.id).join());
ok('sorgu başarısız: plan korunur, kullanıcı uyarılır (doğrulanamadı)', p.status === 'ready' && S.toasts.some((t) => /doğrulanamadı/.test(t)), JSON.stringify(S.toasts));

reset([opp, right]);
let res = await C.planTrip();
p = getState('plan');
const ids = p.stops.map((s) => s.station.id);
ok('yol ağıyla: karşı yön tesisi planda YOK, doğru yön tesisi durak', res === true && p.status === 'ready' && !ids.includes('opp') && ids.includes('right'), `${ids.join()} ${p.status} ${p.text}`);
ok('karşı yön tesisi için sorgu yapıldı (A/B gidiş yönünde, ≈ 90°)', S.probes.some((q) => q.station.lat === opp.lat && Math.abs(q.a.heading - 90) <= 2 && Math.abs(q.b.heading - 90) <= 2), JSON.stringify(S.probes.map((q) => [q.station.lat, q.a.heading])));
ok('doğru yön tesisi de yol ağıyla doğrulandı', S.probes.some((q) => q.station.lat === right.lat));
const rs = p.stops.find((s) => s.station.id === 'right');
ok('durak doğrulanmış erişim bilgisini taşır (verified, sapma yol ağından)', rs?.station.access?.verified === true && rs.station.access.ok === true && Math.abs(rs.station.access.detourKm - 0.15) < 0.01, JSON.stringify(rs?.station.access));
ok('kullanıcıya karşı yön tesisinin çıkarıldığı söylenir', S.toasts.some((t) => /Karşı yönde/.test(t) && t.includes('Opet/Trugo karşı yön')), JSON.stringify(S.toasts));
ok('karşı yön tesisi rota ara noktası olarak istenmedi (U dönüşlü rota yok)', !S.calls.some((c) => (c[2] || []).some((w) => w.lat === opp.lat)));
ok('mod değişince (ağsız yeniden plan) karşı yön yine seçilmez', (() => { patch('plan', { mode: 'cheap' }); const o = C.computePlan(); return o.result.feasible && !o.result.stops.some((s) => s.station.id === 'opp'); })());
ok('sıralama (rankStations) de karşı yön tesisini içermez', !(C.computePlan().ranking || []).some((r) => r.station.id === 'opp'));
patch('plan', { mode: 'opt' });

// Rotadan çıkış (aynı yönde yeniden rota): önbellek kullanılır, karşı yön yine seçilmez
S.probes = [];
await C.planTrip({ lat: LAT, lon: 28.2, label: 'Konumum' });
p = getState('plan');
ok('yeniden rota: karşı yön yine elenmiş, yeni sorgu gerekmez', !p.stops.some((s) => s.station.id === 'opp') && p.stops.some((s) => s.station.id === 'right') && S.probes.length === 0, `${p.stops.map((s) => s.station.id).join()} probes=${S.probes.length}`);

// Kullanıcı karşı yön tesisini ELLE seçerse (addStop): engellenmez, gerçek sapma maliyetiyle (U dönüşü) planlanır (yeterli pil: %60)
reset([opp, right]);
patch('live', { soc: 60 });
await C.planTrip();
const add = C.addStop('opp');
p = getState('plan');
const os = p.stops.find((s) => s.station.id === 'opp');
ok('elle seçilen karşı yön tesisi: kullanıcının kararı korunur, sapma gerçek (yol ağı) değeriyle', add.ok && os && os.station.offKm > 10, `${add.ok} ${add.reason} ${os?.station.offKm}`);

// Tek aday karşı yöndeyse: plan kurulmaz (karşı yön seçilmez), neden açıklanır
reset([opp]);
await C.planTrip();
p = getState('plan');
ok('tek aday karşı yönde → durak olarak seçilmez (plan kurulamaz, açıklama var)', !p.stops.some((s) => s.station.id === 'opp') && p.status === 'infeasible' && p.text.length > 0, `${p.status} ${p.stops.map((s) => s.station.id).join()}`);

// Ters yönde yolculuk: kuzeydeki tesis artık doğru yönde, güneydeki karşı yönde
const westStub = ({ a, station, b }) => {
  const along = Math.abs(b.lon - a.lon) * 111.32 * Math.cos((LAT * Math.PI) / 180);
  if (station.lat < LAT) return along + 36; // güney tesisi batıya gidişte karşı yön
  return along + 0.15;
};
reset([mk({ ...northRest, lon: 30 }, { id: 'n', name: 'Kuzey tesis', price: 10 }), mk({ ...southRest, lon: 30 }, { id: 's', name: 'Güney tesis', kw: 300, srcKw: 300, price: 5 })], west);
S.probe = westStub;
patch('route', { start: END, end: START, via: null });
await C.planTrip();
p = getState('plan');
ok('batıya gidiş: kuzeydeki (artık sağdaki) tesis seçilir, güneydeki elenir', p.stops.some((s) => s.station.id === 'n') && !p.stops.some((s) => s.station.id === 's'), p.stops.map((s) => s.station.id).join() + ' ' + p.status + ' ' + p.text + ' ' + JSON.stringify(S.probes.map((q) => [q.station.lat, q.a.heading])));
ok('ağ çağrısı yok (tüm yol ağı sorguları sahte)', netCalls === 0);

// ---------- 4) Sağlayıcı isteği ----------
const { probeStopAccess } = await import('../js/osm/accessProbe.js');
const km = await probeStopAccess({ a: { lat: 41.19, lon: 28.53, heading: 75 }, station: { lat: 41.1941244, lon: 28.5714521 }, b: { lat: 41.2, lon: 28.6, heading: 80 } });
const body = S.valhallaBody?.body;
ok('Valhalla: /route, 3 nokta (A, istasyon, B), hepsi break', S.valhallaBody?.path === '/route' && body.locations.length === 3 && body.locations.every((l) => l.type === 'break'));
ok('Valhalla: A ve B gidiş yönüyle kısıtlı (heading + tolerans)', body.locations[0].heading === 75 && body.locations[2].heading === 80 && body.locations[0].heading_tolerance === 45);
ok('Valhalla: istasyon "aynı taraf" kısıtlı, tarif metni istenmez, kısa zaman aşımı', body.locations[1].preferred_side === 'same' && body.directions_type === 'none' && body.costing === 'auto' && S.valhallaBody.ms <= 20000);
ok('Valhalla: dönüş yol ağı uzunluğu (km)', km === 6.06);

// ---------- 5) Çevrimdışı önbellek ve çeviriler ----------
{
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok("sw.js SHELL './js/routing/stopAccess.js' ve './js/osm/accessProbe.js' içerir", sw.includes("'./js/routing/stopAccess.js'") && sw.includes("'./js/osm/accessProbe.js'"));
  const ctl = readFileSync(new URL('../js/routing/controller.js', import.meta.url), 'utf8');
  const KEYS = ['Karşı yönde/erişilemeyen şarj tesisi plandan çıkarıldı: {0}', 'Şarj durağına yol ağıyla erişim doğrulanamadı ({0}); tesis karşı yönde olabilir.'];
  ok('iki erişim uyarısı controller.js içinde aynen kullanılıyor', KEYS.every((k) => ctl.includes(`tpl('${k}'`)));
  const keys = JSON.parse(readFileSync(new URL('../i18n/keys.extra.json', import.meta.url), 'utf8'));
  ok('iki uyarı i18n/keys.extra.json içinde', KEYS.every((k) => keys.includes(k)));
  for (const l of ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'ro', 'bg', 'el']) {
    const { default: d } = await import(`../js/i18n/lang/${l}.extra.js`);
    ok(`${l}.extra.js: iki uyarı çevrilmiş, {0} korunmuş`, KEYS.every((k) => typeof d[k] === 'string' && d[k] && d[k] !== k && d[k].split('{0}').length === 2));
  }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
