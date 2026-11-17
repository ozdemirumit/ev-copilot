// v0.99.107 KARŞI ŞERİT ŞARJ DURAĞI GÜVENLİK REGRESYONU. Kullanım: node scripts/test-wrongside-charger.mjs
// Saha bildirimi (Beta v0.99.106, Yunanistan A1 Atina–Selanik, bölünmüş otoyol, iki yanda EKO): mavi rota bir şeritte, "1 numaralı şarj durağı"
// KARŞI şeritteki tesis; rota istasyona dönmüyordu. Kök nedenler (8f16680):
//  1) onRoute.routeStatus: yol ağı sorgusu yok/başarısız (Valhalla 429, zaman aşımı) → 'unverified' ve OTOMATİK SEÇİLEBİLİYORDU (fail-open).
//  2) stopVia.stopWaypoints: çizgiye ≤ 150 m durak ara nokta yapılmıyordu → karşı şerit tesisi (60-110 m) "plandaki durak", rota yanından geçer.
//  3) accessProbe: istasyon noktası Valhalla'da kendi şeride oturabilir → A → istasyon → B düz geçer, "erişilebilir" (sahte doğrulama).
// İki uçtan uca doğrulama: (1) otomatik plan yalnız yol ağıyla gidiş yönünde doğrulanmış istasyonu seçer, doğrulanamazsa FAIL-CLOSED;
// (2) onaylı durak sağlayıcı rotasında gerçek ara nokta, çizgi girişe ulaşır, U dönüşü yok; değilse tutarsız → navigasyon başlatılmaz.
// Ağ engellidir; rota sağlayıcısı ve yol ağı sorgusu sahtedir (gerçek sağlayıcıyla/gerçek cihazda doğrulanmadı).
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

const S = (globalThis.__wsStub = { calls: [], toasts: [], route: null, probe: null, chargers: null, asks: [], choose: () => null, drawn: null, vbody: null });
const g = 'globalThis.__wsStub';
const PARENT_STUBS = {
  '/js/routing/controller.js': {
    '../providers/index.js': `
      export const fetchRoute = async (...a) => { ${g}.calls.push(a); return ${g}.route(...a); };
      export const fetchElevations = async () => null;
      export const fetchWeather = async () => null;
      export const fetchChargers = async (pts, profile) => ({ stations: ${g}.chargers(profile), errors: [], cached: false, summary: null });
      export const probeStopAccess = async (q) => ${g}.probe(q);`,
    '../ui/mapView.js': `export const mapApi = { drawRoute: (c) => { ${g}.drawn = c; }, drawStations: () => {}, setPoint: () => {}, clearRoute: () => {} };`,
    '../ui/toast.js': `export const toast = (m) => { ${g}.toasts.push(String(m)); };`,
    '../ui/recentDest.js': 'export const rememberDest = () => {};',
    '../utils/idb.js': 'export const kvDel = () => {};',
    '../physics/socEstimate.js': 'export const setManual = () => {};',
    '../ui/routeChoice.js': `export const askRouteChoice = async (r) => { ${g}.asks.push(r); return ${g}.choose(r); };`,
  },
  '/js/osm/accessProbe.js': {
    './valhalla.js': `export const valhalla = async (path, body) => { ${g}.vbody = body; return { trip: { summary: { length: 6.4 } } }; };`,
  },
};
registerHooks({
  resolve(spec, ctx, next) {
    for (const [parent, map] of Object.entries(PARENT_STUBS)) {
      if (ctx.parentURL?.endsWith(parent) && spec in map) return { url: 'data:text/javascript,' + encodeURIComponent(map[spec]), format: 'module', shortCircuit: true };
    }
    return next(spec, ctx);
  },
});

const O = await import('../js/routing/onRoute.js');
const V = await import('../js/routing/stopVia.js');
const A = await import('../js/routing/stopAccess.js');
const { haversineKm } = await import('../js/utils/geo.js');

// ---------- Fikstür: bölünmüş otoyol (sağdan trafik). Doğuya giden şerit E (LAT), batıya giden şerit W (LAT + 0,0006 ≈ 67 m kuzey) ----------
const LAT = 38.5;
const W_LAT = LAT + 0.0006;
const grid = (a, b, lat, step = 0.01) => { const c = []; const dir = b >= a ? 1 : -1; for (let i = 0; ; i++) { const x = +(a + dir * i * step).toFixed(5); if (dir * (x - b) > 1e-9) break; c.push([x, lat]); } return c; };
const kmOf = (coords) => coords.reduce((a, c, i) => (i ? a + haversineKm({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: c[1], lon: c[0] }) : 0), 0);
const START = { lat: LAT, lon: 22 }, END = { lat: LAT, lon: 25 }; // ≈ 261 km doğuya
const IC = 0.05; // kavşaklar istasyonun ±0,05° (≈ 4,4 km) doğusunda/batısında
const EKO_R = { id: 'ekoR', name: 'EKO (gidiş yönü)', lat: LAT - 0.0005, lon: 23.0 }; // E şeridinin sağında, 55 m: aynı yön tesisi
const EKO_L = { id: 'ekoL', name: 'EKO (karşı şerit)', lat: W_LAT + 0.0005, lon: 23.0, price: 3, kw: 300 }; // W şeridinin kuzeyinde: karşı yön (daha ucuz/güçlü)
const opposite = (p) => p.lat > LAT; // kuzey = karşı şerit tarafı
const STX = {};

// Rota sağlayıcısı sahtesi (ara noktalara uyar): aynı taraf tesis → çık-gir-katıl (tek geçiş); karşı taraf → sonraki kavşakta dön, W şeridiyle
// tesise gel, önceki kavşakta yeniden dön (U dönüşleri); ignoreVia → ara noktaları yok sayar (sağlayıcı kusuru).
let ignoreVia = false;
const provider = (s, e, v = []) => {
  const from = s.lon ?? 22;
  let coords = [];
  let x = from;
  const vias = ignoreVia ? [] : [...v].sort((a, b) => a.lon - b.lon);
  for (const p of vias) {
    if (!opposite(p)) {
      coords.push(...grid(x, p.lon, LAT));
      coords.push([p.lon, p.lat], [p.lon + 0.004, LAT]);
      x = +(p.lon + 0.01).toFixed(5);
    } else {
      coords.push(...grid(x, p.lon + IC, LAT)); // tesisin yanından geçip doğu kavşağına
      coords.push(...grid(p.lon + IC, p.lon, W_LAT)); // W şeridinde batıya, tesise
      coords.push([p.lon, p.lat]);
      coords.push(...grid(p.lon - 0.01, p.lon - IC, W_LAT)); // batı kavşağına
      coords.push(...grid(p.lon - IC, p.lon + 0.01, LAT)); // yeniden doğuya
      x = +(p.lon + 0.02).toFixed(5);
    }
  }
  coords.push(...grid(x, END.lon, LAT));
  coords = coords.filter((c, i) => !i || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
  const km = kmOf(coords);
  return { coords, intervals: [], distanceKm: km, durationH: km / 100, trafficRatio: 1, routeMeta: { provider: 'osm' }, steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın', distM: km * 1000, staticSec: km * 36 }, { type: 'arrive', modifier: null, text: 'Varış', distM: 0 }] };
};
// Yol ağı sahtesi (A → istasyon → B, km): karşı şerit tesisine yalnız iki kavşak dönüşüyle (≈ 2 × 2 × 4,4 km ek) ulaşılır.
let probeMode = 'net'; // 'net' | '429' | 'timeout'
let extraDetour = {};
const probes = [];
const netProbe = (q) => {
  probes.push(q);
  if (probeMode === '429') throw new Error('Ücretsiz yol sunucusu istek sınırına ulaştı, biraz bekle');
  if (probeMode === 'timeout') throw new Error('Ücretsiz yol sunucusu yanıt vermedi (zaman aşımı)');
  const along = q.b.km - q.a.km;
  const id = [EKO_R, EKO_L, ...Object.values(STX)].find((x) => Math.abs(x.lat - q.station.lat) < 1e-9 && Math.abs(x.lon - q.station.lon) < 1e-9)?.id;
  if (extraDetour[id] != null) return along + extraDetour[id];
  return along + (opposite(q.station) ? 2 * 2 * IC * 87 : 0.3);
};

const { PLANNER } = await import('../js/config.js');
PLANNER.minKw = 50; PLANNER.minStopAdd = 0; PLANNER.brands = [];
const { getState, patch } = await import('../js/state.js');
const C = await import('../js/routing/controller.js');
const st = (base) => ({ opId: 'other', src: 'test', srcKw: 180, kw: 180, price: 10, slow: false, uncertain: false, ...base });
const reset = (list, soc = 30) => {
  S.calls = []; S.toasts = []; S.asks = []; S.drawn = null; S.choose = () => null;
  probes.length = 0; probeMode = 'net'; extraDetour = {}; ignoreVia = false;
  S.route = provider; S.probe = netProbe;
  S.chargers = (profile) => list.map((x) => ({ ...st(x), ...profile.project(x.lat, x.lon) }));
  C.clearTrip();
  patch('nav', { active: false });
  patch('route', { start: START, end: END, via: null });
  patch('live', { soc, lat: null, lon: null });
};
const ids = (p) => p.stops.map((s) => s.station.id).join();
const viaHas = (call, s) => !!call?.[2]?.some((w) => w.lat === s.lat && w.lon === s.lon);

// ---------- 0) Fikstür doğruluğu ve eski kök neden 2 ----------
{
  const base = provider(START, END, []);
  ok('fikstür: karşı şerit tesisi rotaya 100-150 m (eski ara nokta eşiğinin altında → eskiden ara nokta yapılmazdı)', V.offRouteKm(base.coords, EKO_L) < V.VIA_OFF_KM && V.offRouteKm(base.coords, EKO_L) > 0.1, V.offRouteKm(base.coords, EKO_L));
  const cum = A.lineKm(base.coords);
  ok('fikstür: izdüşüm tarafı doğru (doğuya gidişte kuzey = sol = karşı şerit; güney = sağ)', A.locateOnLine(base.coords, cum, EKO_L).side === 'left' && A.locateOnLine(base.coords, cum, EKO_R).side === 'right');
  ok('eski kök neden 2: stopWaypoints varsayılanıyla karşı şerit durağı ARA NOKTA OLMAZ', V.stopWaypoints({ coords: base.coords, stops: [{ km: 87, station: EKO_L }] }) === null);
  ok('force: aynı durak gerçek ara nokta olur', JSON.stringify(V.stopWaypoints({ coords: base.coords, stops: [{ km: 87, station: EKO_L }], force: true })) === JSON.stringify([{ lat: EKO_L.lat, lon: EKO_L.lon }]));
  ok('force + hasVia: zaten ara nokta olan durak için yeni rota istenmez', V.stopWaypoints({ coords: base.coords, stops: [{ km: 87, station: EKO_R }], force: true, hasVia: (id) => id === 'ekoR' }) === null);
  const viaRt = provider(START, END, [EKO_R]);
  const c2 = A.lineKm(viaRt.coords);
  const at1 = A.locateOnLine(base.coords, cum, EKO_R);
  const at2 = A.locateOnLine(viaRt.coords, c2, EKO_R);
  ok('erişim kaydı anahtarı gidiş yönü: ara nokta dikeni yerel yönü bozar ama travelDir ≈ 90° kalır', Math.abs(A.travelDir(base.coords, cum, at1.km) - 90) <= 2 && Math.abs(A.travelDir(viaRt.coords, c2, at2.km) - 90) <= 2, `${at2.heading} ${A.travelDir(viaRt.coords, c2, at2.km)}`);
}

// ---------- 1) Valhalla erişim sorgusu gövdesi: istasyon otoyol/ana yol kenarına oturtulmaz (eski kök neden 3) ----------
{
  const { probeStopAccess } = await import('../js/osm/accessProbe.js');
  const km = await probeStopAccess({ a: { lat: LAT, lon: 22.97, heading: 90 }, station: { lat: EKO_L.lat, lon: EKO_L.lon }, b: { lat: LAT, lon: 23.03, heading: 90 } });
  const loc = S.vbody?.locations || [];
  ok('erişim sorgusu: istasyon noktası search_filter.max_road_class=primary (motorway/trunk şeridine oturmaz)', loc[1]?.search_filter?.max_road_class === 'primary' && loc[1].preferred_side === 'same', JSON.stringify(loc[1]));
  ok('erişim sorgusu: A ve B gidiş yönüne bağlı (heading 90 ± 45), yanıt km', loc[0]?.heading === 90 && loc[2]?.heading === 90 && loc[0]?.heading_tolerance === 45 && km === 6.4);
}

// ---------- 2) Saf karar: yalnız 'on' otomatik seçilebilir (eski kök neden 1) ----------
{
  const stations = [{ id: 'on', access: { verified: true, ok: true, detourKm: 0.3 } }, { id: 'unk' }, { id: 'fail', access: { verified: false } }, { id: 'opp', access: { verified: true, ok: false, detourKm: 17 } }, { id: 'pin' }];
  const sp = O.splitByRoute(stations, () => 0.08, new Set(['pin']));
  const ex = new Set(O.autoExclude(sp));
  ok('autoExclude: bilinmeyen, başarısız (429) ve karşı yön dışlanır; doğrulanmış rota üstü kalır', ex.has('unk') && ex.has('fail') && ex.has('opp') && !ex.has('on'), [...ex].join());
  ok('autoExclude: elle seçilen (pin) dışlanmaz ama durumu unverified', !ex.has('pin') && sp.status.pin === 'unverified');
}

// ---------- 3) UÇTAN UCA (1)+(2): karşı şerit reddedilir, doğru taraf seçilir, ara nokta + çizgi girişe ulaşır ----------
reset([EKO_R, EKO_L], 30);
let res = await C.planTrip();
let p = getState('plan');
ok('E2E-1: karşı şerit EKO (ucuz/güçlü) otomatik durak OLMAZ, gidiş yönü EKO durak', res === true && p.status === 'ready' && ids(p) === 'ekoR', `${p.status} ${ids(p)} ${p.text}`);
ok('E2E-1: karşı şerit yol ağıyla blocked, doğru taraf on', p.routeStatus.ekoL === 'blocked' && p.routeStatus.ekoR === 'on', JSON.stringify(p.routeStatus));
ok('E2E-1: yol ağı sorgusu karşı şerit için A/B gidiş yönünde (≈ 90°) yapıldı', probes.some((q) => q.station.lat === EKO_L.lat && Math.abs(q.a.heading - 90) <= 2 && Math.abs(q.b.heading - 90) <= 2));
ok('E2E-2: ikinci rota isteği YALNIZ gidiş yönü EKO üzerinden (doğru ara nokta)', S.calls.length === 2 && viaHas(S.calls[1], EKO_R) && !viaHas(S.calls[1], EKO_L), JSON.stringify(S.calls.map((c) => c[2])));
ok('E2E-2: plan rotası (= çizilen mavi çizgi) istasyon girişine ≤ 50 m ulaşır, tek geçiş (U dönüşü yok)', V.offRouteKm(p.route.coords, EKO_R) <= V.VIA_REACH_KM && V.passCount(p.route.coords, EKO_R) === 1 && S.drawn === p.route.coords);
ok('E2E-2: ara nokta kaydı ve tutarlılık: viaIds=ekoR, viaIssues boş, navGate serbest', (p.viaIds || []).join() === 'ekoR' && (p.viaIssues || []).length === 0 && !O.navGate(p).block && !O.navGate(p).confirm, JSON.stringify(p.viaIssues));
{
  const stop = p.stops[0];
  const at = A.locateOnLine(p.route.coords, A.lineKm(p.route.coords), EKO_R);
  ok('E2E-2: SOC/ETA tutarlı: profil uzunluğu = ara noktalı rota, durak km = istasyonun bu rotadaki yeri', stop && Math.abs(p.profile.totalKm - p.route.distanceKm) < 2.5 && Math.abs(stop.km - at.km) < 2.5, `${p.profile.totalKm} ${p.route.distanceKm} ${stop?.km} ${at.km}`);
  ok('E2E-2: durakta varış pili ve varışta pil sonlu; toplam süre pozitif', stop && Number.isFinite(stop.arriveSoc) && stop.arriveSoc > 0 && Number.isFinite(p.totals?.arriveSoc) && p.totals.totalMin > 0, JSON.stringify(p.totals));
}

// ---------- 4) Yol ağı kullanılamıyor (429 / zaman aşımı): FAIL-CLOSED ----------
for (const mode of ['429', 'timeout']) {
  reset([EKO_R, EKO_L], 30);
  probeMode = mode;
  res = await C.planTrip();
  p = getState('plan');
  ok(`FAIL-CLOSED (${mode}): hiçbir durak otomatik seçilmez (düz çizgi/karşı taraf yakınlığı doğrulama sayılmaz)`, p.stops.length === 0 && p.status === 'infeasible', `${p.status} ${ids(p)}`);
  ok(`FAIL-CLOSED (${mode}): plan metni "erişim doğrulanamadı" + elle seçme seçeneği; uyarı gösterilir`, /erişim doğrulanamadı/.test(p.text) && /kendin seç/.test(p.text) && S.toasts.some((t) => /doğrulanamadı/.test(t)), p.text);
  ok(`FAIL-CLOSED (${mode}): rota durak için değiştirilmez (tek istek), istasyonların durumu unverified`, S.calls.length === 1 && p.routeStatus.ekoL === 'unverified' && p.routeStatus.ekoR === 'unverified', `${S.calls.length} ${JSON.stringify(p.routeStatus)}`);
}

// ---------- 5) Kavşaktan yasal sapma: çizgiye 330 m, yol ağıyla 1,6 km ek yol → on; rota kavşaktan girer ----------
STX.ic = { id: 'ic', name: 'Kavşak DC', lat: LAT - 0.003, lon: 23.0 };
reset([STX.ic], 30);
extraDetour = { ic: 1.6 };
await C.planTrip();
p = getState('plan');
ok('Kavşak: doğrulanmış yasal sapma otomatik durak olur ve rota onun üzerinden (ara nokta, girişe ulaşır)', ids(p) === 'ic' && p.routeStatus.ic === 'on' && viaHas(S.calls[1], STX.ic) && V.offRouteKm(p.route.coords, STX.ic) <= V.VIA_REACH_KM && (p.viaIssues || []).length === 0, `${ids(p)} ${JSON.stringify(p.routeStatus)} ${JSON.stringify(p.viaIssues)}`);

// ---------- 6) Sağlayıcı ara noktayı yok sayarsa → tutarsız, navigasyon başlatılmaz ----------
reset([EKO_R], 30);
ignoreVia = true;
await C.planTrip();
p = getState('plan');
ok('Sağlayıcı ara noktayı yok saydı: durak planda ama rota girmiyor → viaIssues noreach', (p.viaIssues || []).some((x) => x.id === 'ekoR' && x.reason === 'noreach'), JSON.stringify(p.viaIssues));
ok('…navGate: otomatik durakta tutarsızlık → başlatma ENGELLENİR', O.navGate(p).block === true && O.navGate(p).names.includes('EKO (gidiş yönü)'));

// ---------- 7) U dönüşü (karşı şerit erişimi), ara nokta olmayan durak ve elle seçim kapısı ----------
ignoreVia = false;
{
  const rt = provider(START, END, [EKO_L]);
  ok('U dönüşü: karşı şeride ara nokta → tesis çevresinde ≥ 2 geçiş', V.passCount(rt.coords, EKO_L) >= 2, V.passCount(rt.coords, EKO_L));
  const vc = V.viaCheck({ coords: rt.coords, stops: [{ km: 90, station: EKO_L }], viaIds: ['ekoL'] });
  ok('viaCheck: ara nokta olsa da U dönüşü → uturn', vc.issues[0]?.reason === 'uturn', JSON.stringify(vc));
  const vr = V.viaCheck({ coords: provider(START, END, [EKO_R]).coords, stops: [{ km: 87, station: EKO_R }], viaIds: ['ekoR'] });
  ok('viaCheck: doğru taraf ara noktası tutarlı', vr.ok, JSON.stringify(vr));
  const base = provider(START, END, []).coords;
  ok('viaCheck: ara nokta yapılmamış durak (çizgi yanından geçiyor) → novia', V.viaCheck({ coords: base, stops: [{ km: 87, station: EKO_L }], viaIds: [] }).issues[0]?.reason === 'novia');
  const plan = { stops: [{ km: 87, station: EKO_L }], pinIds: ['ekoL'], viaIssues: [{ id: 'ekoL', name: 'EKO (karşı şerit)', reason: 'uturn', pinned: true }], routeStatus: { ekoL: 'blocked' } };
  ok('navGate: elle seçilen karşı şerit durağı → engel değil ama AÇIK ONAY gerekir', O.navGate(plan).block === false && O.navGate(plan).confirm === true);
  ok('navGate: otomatik durakta aynı sorun → engellenir', O.navGate({ ...plan, pinIds: [] }).block === true);
}

// ---------- 8) Elle seçim: kullanıcı karşı şerit tesisini ekler → işaretli, rota sessizce oraya gönderilmez, başlatmada onay ----------
reset([EKO_R, EKO_L], 30);
await C.planTrip();
const callsBefore = S.calls.length;
const add = C.addStop('ekoL');
p = getState('plan');
ok('Elle ekleme: karşı şerit durağı planda (kullanıcı seçimi) ama blocked işaretli', add.ok && p.stops.some((s) => s.station.id === 'ekoL') && p.routeStatus.ekoL === 'blocked', `${add.ok} ${add.reason} ${ids(p)} ${JSON.stringify(p.routeStatus)}`);
ok('Elle ekleme: rota karşı şeride SESSİZCE değiştirilmez (yeni rota isteği yok), durak novia + pinned', S.calls.length === callsBefore && (p.viaIssues || []).some((x) => x.id === 'ekoL' && x.reason === 'novia' && x.pinned), JSON.stringify(p.viaIssues));
ok('Elle ekleme: navigasyon başlatmada uyarı + onay istenir', O.navGate(p).confirm === true && !O.navGate(p).block);

// ---------- 9) Yarış / yeniden planlama ----------
STX.r2 = { id: 'r2', name: 'EKO 2 (gidiş yönü)', lat: LAT - 0.0005, lon: 24.0 };
reset([EKO_R, STX.r2], 30);
await C.planTrip();
p = getState('plan');
const firstVia = (p.viaIds || []).join();
patch('nav', { active: true });
C.replanFrom({ km: 95, soc: 25, maxFirstStopKm: Infinity }); // ekoR geçildi; yeni durak r2 (rota çizildikten sonra değişti)
p = getState('plan');
ok('Yeniden planlama: yeni aday henüz doğrulanmamışken durak seçilmez ("doğrulanıyor")', p.stops.length === 0 || p.stops.every((s) => p.routeStatus[s.station.id] === 'on'), `${ids(p)} ${p.text}`);
await C.verifyStopAccess();
p = getState('plan');
const r2now = p.stops.some((s) => s.station.id === 'r2') && !firstVia.split(',').includes('r2');
ok('Yeniden planlama: rota çizildikten sonra seçilen durak ara nokta değilse işaretlenir (novia), sessizce "rotada" gösterilmez', r2now && (p.viaIssues || []).some((x) => x.id === 'r2' && x.reason === 'novia'), `${firstVia} ${ids(p)} ${JSON.stringify(p.viaIssues)}`);
patch('nav', { active: false });

// Doğrulama sürerken (yanıt bekleniyor) plan doğrulanmamış durağı seçmez; araya yeni yolculuk girerse eski yanıt yeni planı değiştirmez
reset([EKO_L], 30);
let release;
const hold = new Promise((r) => { release = r; });
S.probe = async (q) => { await hold; return netProbe(q); };
const pend = C.planTrip();
await new Promise((r) => setTimeout(r, 20));
p = getState('plan');
ok('Yarış: doğrulama sürerken durak YOK, metin "doğrulanıyor"', p.stops.length === 0 && /doğrulanıyor/.test(p.text), `${ids(p)} ${p.text}`);
reset([EKO_R], 30); // araya yeni yolculuk girdi (eski sorgu hâlâ bekliyor)
const second = C.planTrip();
release();
await Promise.all([pend, second]);
p = getState('plan');
ok('Yarış: eski planın geç gelen erişim yanıtı yeni planı bozmaz (yeni plan: yalnız ekoR, ara noktalı)', ids(p) === 'ekoR' && (p.viaIds || []).includes('ekoR'), `${ids(p)} ${p.status}`);

// ---------- 10) Bağlantılar ----------
const nav = readFileSync(new URL('../js/nav/navigator.js', import.meta.url), 'utf8');
const startIdx = nav.indexOf('export async function startNav');
ok('startNav: navGate denetimi navigasyonu etkinleştirmeden ÖNCE', startIdx > 0 && nav.indexOf('navGate(plan)', startIdx) > startIdx && nav.indexOf('navGate(plan)', startIdx) < nav.indexOf("patch('nav', { active: true })", startIdx));
const panel = readFileSync(new URL('../js/nav/panelLogic.js', import.meta.url), 'utf8');
ok('Sonraki şarj işareti viaIssues\'tan da gelir (novia/noreach/uturn açıklamaları)', /plan\.viaIssues/.test(nav) && ['novia', 'noreach', 'uturn'].every((k) => panel.includes(`${k}:`)));
ok('ağ çağrısı yok', netCalls === 0);

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
