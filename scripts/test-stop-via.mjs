// Şarj durağı rotada zorunlu ara nokta mı? Kullanım: node scripts/test-stop-via.mjs
// 1) Saf yardımcı js/routing/stopVia.js: tam çözünürlüklü rota çizgisine uzaklık, ara nokta listesi (sıra, eşik, sınır).
// 2) Sağlayıcı katmanı (js/providers/index.js): TomTom → Mapbox → Valhalla yedeğinde ara noktalar değişmeden geçer.
// 3) Sağlayıcı istek biçimleri: Valhalla locations, Mapbox koordinat dizisi, TomTom pts — ara nokta istekte var.
// 4) Denetleyici (js/routing/controller.js planTrip): otoyoldan ~1,5 km uzaktaki DC istasyon plana girince rota o istasyon
//    ÜZERİNDEN yeniden alınır; yol üstündeki istasyonda ikinci rota isteği yapılmaz; ikinci istek başarısızsa ilk plan korunur.
// Ağ engellidir, anahtar/sır yoktur; tüm sağlayıcılar bellek içi sahtedir.
import { registerHooks } from 'node:module';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

// ---------- Ortak sahte modüller ----------
const S = (globalThis.__svStub = {
  calls: [], toasts: [], route: null, // route(start, end, via) → rota | throw
  tomtomOn: false, mbKey: '', tomtom: null, mapbox: null, osm: null, provCalls: [],
  valhallaBody: null, mbPath: null, ttPath: null,
});
const g = 'globalThis.__svStub';
const PARENT_STUBS = {
  // denetleyici testleri: sağlayıcı katmanı ve arayüz
  '/js/routing/controller.js': {
    '../providers/index.js': `
      export const fetchRoute = async (...a) => { ${g}.calls.push(a); return ${g}.route(...a); };
      export const fetchElevations = async () => null;
      export const fetchWeather = async () => null;
      export const fetchChargers = async (pts, profile) => ({ stations: ${g}.chargers(profile), errors: [], cached: false, summary: null });`,
    '../ui/mapView.js': `export const mapApi = { drawRoute: (c) => { ${g}.drawn = c; }, drawStations: () => {}, setPoint: () => {}, clearRoute: () => {} };`,
    '../ui/toast.js': `export const toast = (m) => { ${g}.toasts.push(String(m)); };`,
    '../ui/recentDest.js': 'export const rememberDest = () => {};',
    '../utils/idb.js': 'export const kvDel = () => {};',
    '../physics/socEstimate.js': 'export const setManual = () => {};',
  },
  // sağlayıcı yedeği testleri
  '/js/providers/index.js': {
    '../osm/route.js': `export const fetchRoute = async (...a) => { ${g}.provCalls.push(['osm', a]); return ${g}.osm(...a); };`,
    '../mapbox/route.js': `export const fetchRoute = async (...a) => { ${g}.provCalls.push(['mapbox', a]); return ${g}.mapbox(...a); };`,
    '../tomtom/route.js': `export const fetchRoute = async (...a) => { ${g}.provCalls.push(['tomtom', a]); return ${g}.tomtom(...a); };`,
    '../nav/aheadTraffic.js': 'export const aheadFromRoute = (rt) => ({ rt });',
    '../mapbox/api.js': `export const mapboxKey = () => ${g}.mbKey;`,
    '../net/proxy.js': `export const proxyHas = (w) => w === 'tomtom' && ${g}.tomtomOn; export const premiumAccess = () => ${g}.tomtomOn;`,
    '../net/activeMap.js': `export const activeMap = () => (${g}.tomtomOn ? 'tomtom' : null);`,
    '../osm/chargers.js': 'export const fetchChargers = () => {}; export const fetchAround = () => {};',
    '../routing/occupancyClient.js': 'export const fetchAvailability = () => {};',
    '../osm/search.js': 'export const searchPlaces = () => {}; export const resolvePlace = () => {}; export const reverseLabel = () => {};',
    '../osm/weather.js': 'export const fetchWeather = () => {};',
    '../osm/elevation.js': 'export const fetchElevations = () => {};',
    '../osm/speedLimit.js': 'export const fetchSpeedLimit = () => {};',
  },
  // sağlayıcı istek biçimi testleri
  '/js/osm/route.js': { './valhalla.js': `export const valhalla = async (path, body) => { ${g}.valhallaBody = body; return ${g}.valhallaJson; };` },
  '/js/mapbox/route.js': {
    './api.js': `export const mbfetch = async (path) => { ${g}.mbPath = path; return ${g}.mbJson; };`,
    '../net/proxy.js': 'export const premiumAccess = () => false; export const proxyFetch = async () => { throw new Error(\'ağ yasak\'); };',
  },
  '/js/tomtom/route.js': { '../net/proxy.js': `export const proxyFetch = async (path) => { ${g}.ttPath = path; return { ok: true, status: 200, json: async () => ${g}.ttJson }; }; export const premiumAccess = () => true;` },
};
registerHooks({
  resolve(spec, ctx, next) {
    for (const [parent, map] of Object.entries(PARENT_STUBS)) {
      if (ctx.parentURL?.endsWith(parent) && spec in map) return { url: 'data:text/javascript,' + encodeURIComponent(map[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

// ---------- 1) Saf yardımcı ----------
const V = await import('../js/routing/stopVia.js');
const { haversineKm } = await import('../js/utils/geo.js');

// Doğuya giden düz otoyol (40°N), 0,01° adımlı tam çözünürlüklü çizgi: [lon, lat]
const LAT = 40;
const hw = (fromLon, toLon) => { const c = []; for (let x = fromLon; x <= toLon + 1e-9; x += 0.01) c.push([+x.toFixed(5), LAT]); return c; };
const highway = hw(28, 31); // ≈ 256 km
const offStation = { id: 'off1', name: 'Uzak DC', lat: LAT + 0.0135, lon: 29.0 }; // ≈ 1,5 km kuzeyde (otoyoldan ayrılmak gerekir)
const onStation = { id: 'on1', name: 'Yol üstü DC', lat: LAT + 0.0004, lon: 29.5 }; // ≈ 45 m: otoyol dinlenme tesisi

ok('offRouteKm: 1,5 km kuzeydeki istasyon ≈ 1,5 km', Math.abs(V.offRouteKm(highway, offStation) - 1.5) < 0.05, V.offRouteKm(highway, offStation));
ok('offRouteKm: yol üstündeki istasyon < 0,1 km', V.offRouteKm(highway, onStation) < 0.1, V.offRouteKm(highway, onStation));
// Kıvrımlı yol: 2 km örnekli kiriş uzaklığı yanıltırdı; tam çizgi kullanılmalı
const curve = []; for (let i = 0; i <= 200; i++) { const a = (i / 200) * Math.PI; curve.push([29 + 0.05 * Math.cos(a), LAT + 0.05 * Math.sin(a)]); }
const onCurve = { lat: curve[50][1], lon: curve[50][0] };
ok('offRouteKm: kıvrımın tam üstündeki nokta ≈ 0', V.offRouteKm(curve, onCurve) < 0.01, V.offRouteKm(curve, onCurve));
ok('offRouteKm: geçersiz girdi → Infinity', V.offRouteKm([], offStation) === Infinity && V.offRouteKm(highway, { lat: NaN, lon: 1 }) === Infinity);

const stop = (station, km) => ({ station: { ...station, km, offKm: 0.3 }, km });
ok('yol üstündeki durak → ara nokta gerekmez (null, davranış korunur)', V.stopWaypoints({ coords: highway, stops: [stop(onStation, 128)] }) === null);
ok('durak yok → null', V.stopWaypoints({ coords: highway, stops: [] }) === null);
const w1 = V.stopWaypoints({ coords: highway, stops: [stop(offStation, 85)] });
ok('otoyol dışı durak → istasyon koordinatı ara nokta', Array.isArray(w1) && w1.length === 1 && w1[0].lat === offStation.lat && w1[0].lon === offStation.lon, JSON.stringify(w1));
ok('ara nokta yalnızca lat/lon taşır (sağlayıcıya ek alan gitmez)', w1 && Object.keys(w1[0]).sort().join() === 'lat,lon');
const w2 = V.stopWaypoints({ coords: highway, stops: [stop(offStation, 85), stop(onStation, 128)] });
ok('bir durak dışarıdaysa TÜM ileri duraklar zorunlu ara nokta (sıra km)', w2?.length === 2 && w2[0].lon === 29.0 && w2[1].lon === 29.5, JSON.stringify(w2));
const stopover = { lat: LAT + 0.02, lon: 29.2, label: 'Ara durak' };
const w3 = V.stopWaypoints({ coords: highway, stops: [stop(offStation, 85), stop(onStation, 128)], stopover, stopoverKm: 102 });
ok('kullanıcı ara durağı km sırasına göre araya girer', w3?.length === 3 && w3[0].lon === 29.0 && w3[1].lon === 29.2 && w3[2].lon === 29.5, JSON.stringify(w3));
const w4 = V.stopWaypoints({ coords: highway, stops: [stop(offStation, 85)], stopover: { lat: offStation.lat, lon: offStation.lon }, stopoverKm: 85 });
ok('ara durak istasyonla aynı yerdeyse iki kez eklenmez', w4?.length === 1, JSON.stringify(w4));
ok('geride kalan durak (fromKm) ara nokta olmaz', V.stopWaypoints({ coords: highway, stops: [stop(offStation, 85)], fromKm: 90 }) === null);
const many = Array.from({ length: 30 }, (_, i) => stop({ ...offStation, id: 'm' + i, lon: 28.1 + i * 0.08 }, 10 + i * 7));
ok('sağlayıcı sınırını aşan ara nokta sayısı → null (rota bozulmaz)', V.stopWaypoints({ coords: highway, stops: many }) === null);
ok('koordinatı bozuk durak atlanır', V.stopWaypoints({ coords: highway, stops: [stop({ ...offStation, lat: null }, 85)] }) === null);

// ---------- 2) Sağlayıcı yedeği: ara noktalar değişmeden geçer ----------
const P = await import('../js/providers/index.js');
const rtFx = () => ({ coords: highway, intervals: [], distanceKm: 256, durationH: 2.5, trafficRatio: 1, steps: [{ type: 'arrive', modifier: null, text: 'x', distM: 0 }] });
const A = { lat: LAT, lon: 28 }, B = { lat: LAT, lon: 31 };
const via = [{ lat: offStation.lat, lon: offStation.lon }];
const viaOf = (name) => S.provCalls.find((c) => c[0] === name)?.[1]?.[2];
const sameVia = (v) => JSON.stringify(v) === JSON.stringify(via);

S.provCalls = []; S.tomtomOn = true; S.mbKey = 'mbx-test-placeholder';
S.tomtom = () => { throw new Error('TomTom HTTP 503'); };
S.mapbox = () => { throw new Error('Mapbox HTTP 500'); };
S.osm = () => rtFx();
let r = await P.fetchRoute(A, B, via);
ok('TomTom → Mapbox → Valhalla yedeği: üçü de aynı ara noktayla çağrılır', sameVia(viaOf('tomtom')) && sameVia(viaOf('mapbox')) && sameVia(viaOf('osm')), JSON.stringify(S.provCalls.map((c) => [c[0], c[1][2]])));
ok('yedek sonucu Valhalla (osm) etiketli', r.routeMeta?.provider === 'osm');
S.provCalls = []; S.tomtomOn = false; S.mbKey = '';
r = await P.fetchRoute(A, B, via);
ok('anahtarsız: Valhalla ara noktayı alır', S.provCalls.length === 1 && sameVia(viaOf('osm')));
S.provCalls = []; S.tomtomOn = true; S.mbKey = ''; S.tomtom = () => { throw new Error('TomTom HTTP 429'); };
r = await P.fetchRoute(A, B, via);
ok('TomTom hatası, Mapbox yok: Valhalla ara noktayı alır', sameVia(viaOf('tomtom')) && sameVia(viaOf('osm')) && !viaOf('mapbox'));

// ---------- 3) Sağlayıcı istek biçimleri ----------
const enc = (pts) => { // [lon,lat] → polyline6
  let out = '', pl = 0, po = 0;
  const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lon, lat] of pts) { const la = Math.round(lat * 1e6), lo = Math.round(lon * 1e6); out += e(la - pl) + e(lo - po); pl = la; po = lo; }
  return out;
};
const geom = enc([[28, LAT], [29, LAT + 0.0135], [31, LAT]]);
S.valhallaJson = { routes: [{ geometry: geom, distance: 260000, duration: 9000, legs: [{ steps: [{ maneuver: { type: 'depart' }, distance: 100, duration: 5, name: '' }, { maneuver: { type: 'arrive' }, distance: 0, duration: 0 }] }, { steps: [{ maneuver: { type: 'arrive' }, distance: 0, duration: 0 }] }] }] };
const { fetchRoute: osmRoute } = await import('../js/osm/route.js');
const vr = await osmRoute({ lat: LAT, lon: 28.001 }, { lat: LAT, lon: 31.001 }, via);
const locs = S.valhallaBody?.locations || [];
ok('Valhalla: istasyon locations ortasında, tür break (durak atlanamaz)', locs.length === 3 && locs[1].lat === offStation.lat && locs[1].lon === offStation.lon && locs[1].type === 'break', JSON.stringify(locs));
ok('Valhalla: istasyonda "stop" adımı, sonda tek "arrive"', vr.steps.some((s) => s.type === 'stop') && vr.steps.filter((s) => s.type === 'arrive').length === 1);

S.mbJson = { routes: [{ geometry: geom, distance: 260000, duration: 9000, legs: [] }] };
const { fetchRoute: mbRoute } = await import('../js/mapbox/route.js');
await mbRoute({ lat: LAT, lon: 28.002 }, { lat: LAT, lon: 31.002 }, via);
ok('Mapbox: koordinat dizisinde istasyon ortada', /28\.002000,40\.000000;29\.000000,40\.013500;31\.002000,40\.000000/.test(S.mbPath || ''), S.mbPath);

S.ttJson = { routes: [{ summary: { lengthInMeters: 260000, travelTimeInSeconds: 9000 }, legs: [{ points: [{ latitude: LAT, longitude: 28 }, { latitude: LAT + 0.0135, longitude: 29 }] }, { points: [{ latitude: LAT + 0.0135, longitude: 29 }, { latitude: LAT, longitude: 31 }] }], sections: [], guidance: { instructions: [] } }] };
const { fetchRoute: ttRoute } = await import('../js/tomtom/route.js');
await ttRoute({ lat: LAT, lon: 28.003 }, { lat: LAT, lon: 31.003 }, via);
ok('TomTom: pts dizisinde istasyon ortada', decodeURIComponent(S.ttPath || '').includes('40.00000,28.00300:40.01350,29.00000:40.00000,31.00300'), S.ttPath);

// ---------- 4) Denetleyici: plan → istasyon üzerinden rota ----------
const { PLANNER } = await import('../js/config.js');
PLANNER.minKw = 50; PLANNER.minStopAdd = 0; PLANNER.brands = [];
const state = await import('../js/state.js');
const C = await import('../js/routing/controller.js');
const { getState, patch } = state;

// Durak gerektiren uzun rota: ~600 km düz otoyol, %30 başlangıç pili. Tek aday: otoyoldan ~1,5 km uzak (veya yol üstü) DC istasyon.
const long = hw(28, 31);
const START = { lat: LAT, lon: 28 }, END = { lat: LAT, lon: 31 };
const st = (base) => ({ ...base, opId: 'other', src: 'test', srcKw: 180, kw: 180, price: 10, slow: false, uncertain: false });
// Rota sahtesi: ara nokta varsa çizgi o noktaya gidip geri döner (otoyoldan ayrılıp istasyona varış)
const routeVia = (s, e, v = []) => {
  const coords = [];
  for (const [lon, lat] of long) {
    for (const p of v) if (Math.abs(lon - p.lon) < 1e-6 && Math.abs(lat - p.lat) > 1e-6) { coords.push([lon, lat], [p.lon, p.lat]); }
    coords.push([lon, lat]);
  }
  const km = coords.reduce((a, c, i) => (i ? a + haversineKm({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: c[1], lon: c[0] }) : 0), 0);
  return { coords, intervals: [], distanceKm: km, durationH: km / 100, trafficRatio: 1, steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın', distM: km * 1000, staticSec: km * 36 }, { type: 'arrive', modifier: null, text: 'Varış', distM: 0 }] };
};
const reset = (station) => {
  S.calls = []; S.toasts = []; S.drawn = null;
  S.route = routeVia;
  S.chargers = (profile) => [station].map((x) => ({ ...st(x), ...profile.project(x.lat, x.lon) }));
  C.clearTrip();
  patch('route', { start: START, end: END, via: null });
  patch('live', { soc: 30 });
};

const offFar = { id: 'farDC', name: 'Otoyol dışı DC', lat: LAT + 0.0135, lon: 29.0 }; // ≈ 1,5 km kuzey, ~85. km
reset(offFar);
let res = await C.planTrip();
let p = getState('plan');
ok('planTrip başarılı ve istasyon durak', res === true && p.status === 'ready' && p.stops.some((s) => s.station.id === 'farDC'), `${res} ${p.status} ${p.text}`);
ok('otoyol dışı durak: rota İKİNCİ kez, istasyon ara nokta olarak istenir', S.calls.length === 2 && S.calls[1][2]?.some((w) => w.lat === offFar.lat && w.lon === offFar.lon), JSON.stringify(S.calls.map((c) => c[2])));
ok('çizilen mavi rota istasyondan geçer (≤ 50 m)', S.drawn && V.offRouteKm(S.drawn, offFar) <= 0.05, S.drawn && V.offRouteKm(S.drawn, offFar));
ok('plan.route istasyon üzerinden olan rota', p.route && V.offRouteKm(p.route.coords, offFar) <= 0.05);
const farStop = p.stops.find((s) => s.station.id === 'farDC');
ok('durak artık rotada (offKm ≈ 0: sapma ikinci kez sayılmaz)', farStop && farStop.station.offKm < 0.1, farStop?.station.offKm);
ok('durak zorunlu kalır (sonraki yeniden hesapta düşmez)', (p.pinIds || []).includes('farDC'));
ok('ağ çağrısı yok', netCalls === 0);

const onRoad = { id: 'roadDC', name: 'Yol üstü DC', lat: LAT + 0.0003, lon: 29.0 };
reset(onRoad);
res = await C.planTrip();
p = getState('plan');
ok('yol üstündeki durak: tek rota isteği (davranış aynı)', res === true && S.calls.length === 1 && p.stops.some((s) => s.station.id === 'roadDC'), `${S.calls.length} ${p.status}`);
ok('yol üstündeki durak zorunlu yapılmaz (pinIds boş)', (p.pinIds || []).length === 0);

reset(offFar);
S.route = (s, e, v = []) => { if (v.length) throw new Error('Valhalla HTTP 502'); return routeVia(s, e, v); };
res = await C.planTrip();
p = getState('plan');
ok('ikinci istek başarısız: ilk plan korunur (hazır, aynı durak)', res === true && p.status === 'ready' && p.stops.some((s) => s.station.id === 'farDC'), `${p.status} ${p.text}`);
ok('ikinci istek başarısız: kullanıcı uyarılır (sessiz geçmez)', S.toasts.some((t) => /istasyon/i.test(t) && /geçirilemedi|alınamadı/i.test(t)), JSON.stringify(S.toasts));
ok('ikinci istek başarısız: pinIds değişmez', (p.pinIds || []).length === 0);

// Yeniden rota (navigasyonda rotadan çıkış, from verilir): aynı kural
reset(offFar);
await C.planTrip();
S.calls = [];
res = await C.planTrip({ lat: LAT, lon: 28.2, label: 'Konumum' });
p = getState('plan');
ok('yeniden rota: otoyol dışı durak yine ara nokta', res === true && S.calls.some((c) => c[2]?.some((w) => w.lat === offFar.lat)), JSON.stringify(S.calls.map((c) => c[2])));
ok('yeniden rota: çizgi istasyondan geçer', p.route && V.offRouteKm(p.route.coords, offFar) <= 0.05);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
