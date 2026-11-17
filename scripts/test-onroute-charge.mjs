// Şarj durağı AKTİF ROTA ÜZERİNDE mi ve rota değişikliği yalnız ONAYLA mı? (v0.99.97) Kullanım: node scripts/test-onroute-charge.mjs
// Regresyon: canlı Beta v0.99.96 (Yunanistan A106) — navigasyonda yeniden planlama, rota çizgisinden uzaktaki DC istasyonu "Sonraki şarj 29 km"
// olarak seçti; mavi rota istasyondan geçmiyordu. 1) Saf karar js/routing/onRoute.js. 2) Denetleyici (planTrip / replanFrom): rota dışı aday
// sessizce seçilmez, karşı yön ve erişim kısıtı elenir, doğrulanamayan durak işaretlenir, seçenekler onaylanmadan rota değişmez, İptal/seçenek
// yok/sağlayıcı yok/düşük pil. 3) Arayüz metni (ölçü yoksa "--"). Ağ engellidir; sağlayıcılar ve yol ağı sorgusu sahtedir.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

const S = (globalThis.__orStub = { calls: [], toasts: [], route: null, probe: null, chargers: null, asks: [], choose: () => null, drawn: null });
const g = 'globalThis.__orStub';
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

// ---------- 1) Saf karar ----------
ok('rota üstü + yol ağıyla doğrulandı → on', O.routeStatus({ lineOffKm: 0.08, access: { verified: true, ok: true, detourKm: 0.4 } }) === 'on');
ok('çizgide ama yol ağı sorgusu yok/başarısız → unverified (işaretlenir)', O.routeStatus({ lineOffKm: 0.08 }) === 'unverified' && O.routeStatus({ lineOffKm: 0.3, access: { verified: false } }) === 'unverified');
ok('düz çizgi 1,5 km: yol ağı "erişilebilir" dese de rota dışı (rotadan ayrılmak gerekir) → off', O.routeStatus({ lineOffKm: 1.5, access: { verified: true, ok: true, detourKm: 0.2 } }) === 'off');
ok('çizgiye yakın ama yol ağıyla 4 km ek yol (erişim kısıtı / çıkış gerekir) → off', O.routeStatus({ lineOffKm: 0.3, access: { verified: true, ok: true, detourKm: 4 } }) === 'off');
ok('karşı yön (yol ağı sapması orantısız) → blocked', O.routeStatus({ lineOffKm: 0.09, access: { verified: true, ok: false, detourKm: 36 } }) === 'blocked');
ok('uzaklık bilinmiyor → off (yakınlık varsayılmaz)', O.routeStatus({ lineOffKm: null }) === 'off' && O.routeStatus({ lineOffKm: NaN }) === 'off');
ok('eşikler: 0,5 km çizgi, 2 km yol ağı ek yolu, en çok 3 seçenek', O.ON_ROUTE_KM === 0.5 && O.ON_ROUTE_DETOUR_KM === 2 && O.MAX_ALTERNATIVES === 3);
{
  const st = [{ id: 'a' }, { id: 'b' }, { id: 'c', access: { verified: true, ok: false, detourKm: 30 } }, { id: 'd' }];
  const off = { a: 0.1, b: 2, c: 0.1, d: 3 };
  const sp = O.splitByRoute(st, (s) => off[s.id], new Set(['d']));
  ok('splitByRoute: rota dışı ve karşı yön ayrılır, elle seçilen (keep) elenmez ama durumu off', sp.offIds.join() === 'b' && sp.blockedIds.join() === 'c' && sp.status.d === 'off' && sp.status.a === 'unverified');
  ok('splitByRoute istasyon nesnelerini değiştirmez', st.every((s) => !('routeStatus' in s)));
}
{
  const s = (id, km) => ({ id, km });
  const c = O.altCandidates({ relaxedStops: [{ station: s('x', 40) }], ranking: [{ station: s('y', 20) }, { station: s('on', 25) }, { station: s('x', 40) }, { station: s('z', 60) }, { station: s('w', 70) }, { station: s('back', 5) }], offIds: ['x', 'y', 'z', 'w', 'back'], fromKm: 10 });
  ok('altCandidates: gevşek planın durağı önce, yalnız rota dışı, ileride, tekrarsız, en çok 3', c.map((x) => x.id).join() === 'x,y,z', c.map((x) => x.id).join());
}
{
  const plan = { feasible: true, stops: [{ station: { id: 'x' }, km: 30, arriveSoc: 12.4, leaveSoc: 70, minutes: 25 }], totals: { arriveSoc: 31 } };
  const a = O.altSummary({ base: { km: 200, min: 120 }, alt: { km: 207.5, min: 131 }, plan, stationId: 'x' });
  ok('altSummary: ek km/dk, durakta varış/ayrılış, şarj dk, hedefte pil', a.feasible && a.addKm === 7.5 && a.addMin === 11 && a.arriveStopSoc === 12.4 && a.leaveStopSoc === 70 && a.chargeMin === 25 && a.arriveEndSoc === 31);
  const m = O.altSummary({ base: { km: 200 }, alt: { km: 207 }, plan, stationId: 'x' });
  ok('altSummary: süre bilinmiyorsa null (uydurulmaz)', m.addMin === null && m.addKm === 7);
  const f = O.altSummary({ base: { km: 200, min: 1 }, alt: { km: 210, min: 2 }, plan: { feasible: false, reason: 'menzil yetmez', stops: [] }, stationId: 'x' });
  ok('altSummary: plan kurulamıyorsa seçenek değil, neden taşınır', !f.feasible && f.arriveStopSoc === null && f.reason === 'menzil yetmez');
}
{
  const evalOk = () => ({ alt: { km: 210, min: 130 }, plan: { feasible: true, stops: [{ station: { id: 'x' }, km: 5, arriveSoc: 20, leaveSoc: 60, minutes: 20 }], totals: { arriveSoc: 25 } } });
  const none = await O.buildAlternatives({ candidates: [], base: { km: 200, min: 120 }, route: async () => { throw new Error('x'); }, evaluate: evalOk });
  ok('buildAlternatives: aday yok → unavailable, istek yok', none.unavailable && none.choices.length === 0);
  let n = 0;
  const down = await O.buildAlternatives({ candidates: [{ id: 'x' }, { id: 'y' }], base: { km: 200, min: 120 }, route: async () => { n++; throw new Error('sağlayıcı yok'); }, evaluate: evalOk });
  ok('buildAlternatives: sağlayıcı yok/hata → unavailable, her aday için hata kaydı, ölçü yok', down.unavailable && down.failures.length === 2 && down.failures.every((f) => f.error === 'sağlayıcı yok') && n === 2);
  const empty = await O.buildAlternatives({ candidates: [{ id: 'x' }], base: { km: 200, min: 120 }, route: async () => ({ coords: [] }), evaluate: evalOk });
  ok('buildAlternatives: boş rota yanıtı seçenek olmaz', empty.unavailable && /boş/.test(empty.failures[0].error));
  const good = await O.buildAlternatives({ candidates: [{ id: 'x' }], base: { km: 200, min: 120 }, route: async () => ({ coords: [[0, 0], [1, 1]], routeMeta: { provider: 'osm' } }), evaluate: evalOk });
  ok('buildAlternatives: gerçek rota + plan → seçenek (sağlayıcı adıyla)', !good.unavailable && good.choices[0].summary.addKm === 10 && good.choices[0].provider === 'osm');
  // Onay akışı
  let applied = 0;
  const c1 = await O.consentFlow({ result: good, ask: async () => null, apply: async () => { applied++; return true; } });
  ok('consentFlow: İptal → uygulanmaz, rota değişmez', c1.cancelled && !c1.applied && applied === 0);
  const c2 = await O.consentFlow({ result: good, ask: async (r) => r.choices[0], apply: async (c) => { applied++; return c === good.choices[0]; } });
  ok('consentFlow: açık onay → yalnız seçilen seçenek uygulanır', c2.applied && applied === 1);
  const c3 = await O.consentFlow({ result: down, ask: async () => ({ fake: 1 }), apply: async () => { applied++; return true; } });
  ok('consentFlow: seçenek yokken hiçbir şey uygulanmaz', c3.cancelled && applied === 1);
  const c4 = await O.consentFlow({ result: good, ask: async () => ({ ...good.choices[0] }), apply: async () => { applied++; return true; } });
  ok('consentFlow: listede olmayan (sahte) seçim uygulanmaz', c4.cancelled && applied === 1);
}
ok('stopFlag: on → null, diğerleri işaret', O.stopFlag({ station: { id: 'a' } }, { a: 'on' }) === null && O.stopFlag({ station: { id: 'a' } }, { a: 'unverified' }) === 'unverified' && O.stopFlag({ station: { id: 'a' } }, null) === null);

// ---------- 2) Denetleyici ----------
const { PLANNER } = await import('../js/config.js');
PLANNER.minKw = 50; PLANNER.minStopAdd = 0; PLANNER.brands = [];
const { getState, patch } = await import('../js/state.js');
const C = await import('../js/routing/controller.js');
const V = await import('../js/routing/stopVia.js');
const { haversineKm } = await import('../js/utils/geo.js');

const LAT = 40;
const long = []; for (let x = 28; x <= 31 + 1e-9; x += 0.01) long.push([+x.toFixed(5), LAT]); // doğuya ~255 km bölünmüş otoyol
const START = { lat: LAT, lon: 28 }, END = { lat: LAT, lon: 31 };
const st = (base) => ({ opId: 'other', src: 'test', srcKw: 180, kw: 180, price: 10, slow: false, uncertain: false, ...base });
// Rota sahtesi: ara nokta otoyol dışındaysa çizgi oraya gidip döner
const routeVia = (s, e, v = []) => {
  const coords = [];
  const from = s.lon ?? 28;
  for (const [lon, lat] of long) {
    if (lon < from - 1e-9) continue;
    for (const p of v) if (Math.abs(lon - p.lon) < 1e-6 && Math.abs(lat - p.lat) > 1e-6) coords.push([lon, lat], [p.lon, p.lat]);
    coords.push([lon, lat]);
  }
  const km = coords.reduce((a, c, i) => (i ? a + haversineKm({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: c[1], lon: c[0] }) : 0), 0);
  return { coords, intervals: [], distanceKm: km, durationH: km / 100, trafficRatio: 1, routeMeta: { provider: 'osm' }, steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın', distM: km * 1000, staticSec: km * 36 }, { type: 'arrive', modifier: null, text: 'Varış', distM: 0 }] };
};
// Yol ağı sahtesi: istasyonun kimliğine göre ek yol (km); 'throw' → sorgu başarısız
let detour = {};
const probeBy = (list) => (q) => {
  const s = list.find((x) => Math.abs(x.lat - q.station.lat) < 1e-9 && Math.abs(x.lon - q.station.lon) < 1e-9);
  const d = detour[s?.id] ?? 0.2;
  if (d === 'throw') throw new Error('Valhalla HTTP 429');
  return (q.b.km - q.a.km) + d;
};
const reset = (list, soc = 30) => {
  S.calls = []; S.toasts = []; S.asks = []; S.drawn = null; S.choose = () => null;
  S.route = routeVia;
  S.probe = probeBy(list);
  S.chargers = (profile) => list.map((x) => ({ ...st(x), ...profile.project(x.lat, x.lon) }));
  C.clearTrip();
  patch('route', { start: START, end: END, via: null });
  patch('live', { soc });
};
const ids = (p) => p.stops.map((s) => s.station.id).join();
const viaReq = (s) => S.calls.some((c) => c[2]?.some((w) => w.lat === s.lat && w.lon === s.lon));

// A) A106 regresyonu: yolda yeniden planlama rota dışı ucuz istasyonu "Sonraki şarj" yapmamalı
const onRoad = { id: 'onA', name: 'Yol üstü DC', lat: LAT - 0.0005, lon: 29.0 }; // ~85 km, 55 m güney (gidiş yönü tarafı)
const offCheap = { id: 'offB', name: 'Kasaba DC (rota dışı)', lat: LAT + 0.018, lon: 28.4, price: 2, kw: 300 }; // ~34 km, ≈ 2 km kuzey
detour = {};
reset([onRoad, offCheap], 30);
let res = await C.planTrip();
let p = getState('plan');
ok('A: ilk plan rota üstündeki istasyonu seçer (rota dışı ucuz olan seçilmez)', res === true && p.status === 'ready' && ids(p) === 'onA', `${p.status} ${ids(p)} ${p.text}`);
ok('A: rota dışı istasyon için rota isteği/soru yok; ikinci istek yalnız yol üstü durak ÜZERİNDEN (v0.99.107 ara nokta)', S.calls.length === 2 && S.asks.length === 0 && !viaReq(offCheap) && viaReq(onRoad));
ok('A: plan.routeStatus: yol üstü on, kasaba off', p.routeStatus.onA === 'on' && p.routeStatus.offB === 'off', JSON.stringify(p.routeStatus));
// Navigasyonda pil beklenenden düşük: km 20'de %13 — rota üstü istasyona (85 km) yetmez, rota dışı (34 km) yeter
const before = ids(getState('plan'));
patch('nav', { active: true }); patch('live', { lat: LAT, lon: 28.24 }); // navigasyonda, ~20. km'de
const r1 = C.replanFrom({ km: 20, soc: 13, maxFirstStopKm: Infinity });
await C.offerAlternatives();
p = getState('plan');
ok('A: yeniden planlama rota dışı istasyonu SESSİZCE seçmez (eski plan kalır)', r1 === false && ids(p) === before && !p.stops.some((s) => s.station.id === 'offB'), `${r1} ${ids(p)}`);
ok('A: bunun yerine onay sorulur: seçenek o istasyon üzerinden gerçek rota', S.asks.length === 1 && S.asks[0].choices[0]?.station.id === 'offB' && viaReq(offCheap), JSON.stringify(S.asks.map((a) => a.choices.map((c) => c.station.id))));
const sm = S.asks[0]?.choices[0]?.summary || {};
ok('A: seçenekte ek km > 0, ek dk > 0, durakta varış pili ve şarj süresi var', sm.addKm > 0 && sm.addMin > 0 && Number.isFinite(sm.arriveStopSoc) && sm.chargeMin > 0, JSON.stringify(sm));
ok('A: İptal sonrası rota çizgisi değişmez (istasyondan geçmez)', V.offRouteKm(p.route.coords, offCheap) > 1.5);
C.replanFrom({ km: 21, soc: 13, maxFirstStopKm: Infinity });
await C.offerAlternatives();
ok('A: İptal edilen plan için aynı soru tekrar sorulmaz', S.asks.length === 1, S.asks.length);
ok('A: seçenek rotası aracın bulunduğu yerden istenir', S.calls.some((c) => c[0]?.label === 'Konumum' && Math.abs(c[0].lon - 28.24) < 1e-9));
patch('nav', { active: false }); patch('live', { lat: null, lon: null });

// B) Karşı yön: kuzeydeki (sol, karşı şerit) tesis ucuz ve güçlü ama yol ağıyla 36 km → elenir; güneydeki seçilir
const north = { id: 'north', name: 'Karşı yön tesisi', lat: LAT + 0.0008, lon: 29.0, price: 3, kw: 300 };
const south = { id: 'south', name: 'Doğru yön tesisi', lat: LAT - 0.0006, lon: 29.02 };
detour = { north: 36, south: 0.3 };
reset([north, south], 30);
await C.planTrip();
p = getState('plan');
ok('B: karşı yöndeki tesis seçilmez, doğru yöndeki seçilir', p.status === 'ready' && ids(p) === 'south', `${p.status} ${ids(p)} ${p.text}`);
ok('B: karşı yön blocked, doğru yön on', p.routeStatus.north === 'blocked' && p.routeStatus.south === 'on', JSON.stringify(p.routeStatus));
ok('B: karşı yön için rota değişikliği önerilmez', S.asks.length === 0);

// C) Erişim kısıtı: çizgiye 300 m ama giriş için otoyoldan çıkıp 4 km dolaşmak gerekiyor → otomatik seçilmez, onay sorulur
const gated = { id: 'gated', name: 'Arka yol DC', lat: LAT + 0.0027, lon: 29.0 };
detour = { gated: 4 };
reset([gated], 30);
S.choose = () => null;
await C.planTrip();
p = getState('plan');
ok('C: erişimi 4 km sapma isteyen istasyon otomatik durak olmaz', p.stops.length === 0 && p.routeStatus.gated === 'off', `${ids(p)} ${JSON.stringify(p.routeStatus)}`);
ok('C: onay sorulur (rota değişikliği seçeneği)', S.asks.length === 1 && S.asks[0].choices.length === 1);

// D) Yol ağı sorgusu başarısız (Valhalla 429): çizgiye 300 m durak işaretli kalır, rota onun üzerinden DEĞİŞTİRİLMEZ
const unv = { id: 'unv', name: 'Doğrulanamayan DC', lat: LAT + 0.0027, lon: 29.0 };
detour = { unv: 'throw' };
reset([unv], 30);
await C.planTrip();
p = getState('plan');
ok('D (v0.99.107 fail-closed): doğrulanamayan durak OTOMATİK SEÇİLMEZ, durumu unverified', p.status === 'infeasible' && ids(p) === '' && p.routeStatus.unv === 'unverified', `${p.status} ${ids(p)} ${JSON.stringify(p.routeStatus)}`);
ok('D: doğrulanmamış durak için rota değiştirilmez (tek rota isteği)', S.calls.length === 1 && !viaReq(unv), S.calls.length);
ok('D: kullanıcı uyarılır (erişim doğrulanamadı)', S.toasts.some((t) => /doğrulanamadı/.test(t)), JSON.stringify(S.toasts));
ok('D: plan metni "erişim doğrulanamadı" + istasyon adı + elle seçme seçeneği', /erişim doğrulanamadı \(Doğrulanamayan DC\)/.test(p.text) && /kendin seç/.test(p.text) && (p.accessFailed || []).includes('Doğrulanamayan DC'), p.text);

// E) Seçenek yok: tek aday karşı yönde → soru yok, plan kurulamaz (neden açıklanır), rota değişmez
detour = { north: 36 };
reset([north], 30);
await C.planTrip();
p = getState('plan');
ok('E: tek aday karşı yönde → durak yok, soru yok', p.stops.length === 0 && S.asks.length === 0 && p.status === 'infeasible' && !p.offRouteOnly, `${p.status} ${S.asks.length}`);
ok('E: rota tek istek, değişmez', S.calls.length === 1);

// F) Sağlayıcı yok: seçenek rotaları alınamıyor (iki aday) → "kullanılamıyor", ölçü uydurulmaz, özgün rota
const offA = { id: 'offA', name: 'Rota dışı A', lat: LAT + 0.018, lon: 28.6 };
const offC = { id: 'offC', name: 'Rota dışı C', lat: LAT - 0.02, lon: 28.8 };
detour = {};
reset([offA, offC], 30);
S.route = (s, e, v = []) => { if (v.length) throw new Error('rota sağlayıcısı yok'); return routeVia(s, e, v); };
S.choose = (r) => r.choices[0] || null;
await C.planTrip();
p = getState('plan');
ok('F: soru "kullanılamıyor": seçenek yok, her aday için hata', S.asks.length === 1 && S.asks[0].unavailable && S.asks[0].choices.length === 0 && S.asks[0].failures.length === 2, JSON.stringify(S.asks[0]?.failures));
ok('F: plan rota dışı durak içermez, rota özgün', p.stops.length === 0 && V.offRouteKm(p.route.coords, offA) > 1.5);

// G) Düşük pil: %13 — yalnız yakın rota dışı aday seçenek olur; uzaktaki (yetmeyen) seçenek olarak sunulmaz
const nearOff = { id: 'nearOff', name: 'Yakın rota dışı', lat: LAT + 0.018, lon: 28.2 };
const farOff = { id: 'farOff', name: 'Uzak rota dışı', lat: LAT + 0.018, lon: 30.2 };
reset([nearOff, farOff], 13);
S.choose = (r) => r.choices[0] || null;
await C.planTrip();
p = getState('plan');
const lowAsk = S.asks[0];
ok('G: düşük pilde yalnız ulaşılabilen seçenek sunulur', lowAsk && lowAsk.choices.map((c) => c.station.id).join() === 'nearOff', JSON.stringify(lowAsk?.choices.map((c) => c.station.id)));
ok('G: seçenekte durakta varış pili eşik üstünde', lowAsk?.choices[0]?.summary.arriveStopSoc >= PLANNER.chargerMinArrival - PLANNER.tolerance - 1e-9, lowAsk?.choices[0]?.summary.arriveStopSoc);
ok('G: onaydan sonra rota istasyondan geçer ve durak o', p.status === 'ready' && ids(p).startsWith('nearOff') && V.offRouteKm(p.route.coords, nearOff) <= 0.05, `${p.status} ${ids(p)}`);

// H) Sağlayıcı isteği sınırı: 5 rota dışı aday → en çok 3 seçenek rotası
const many = [0, 1, 2, 3, 4].map((i) => ({ id: 'm' + i, name: 'M' + i, lat: LAT + 0.018, lon: 28.3 + i * 0.05 }));
reset(many, 30);
await C.planTrip();
ok('H: seçenek için en çok 3 ek rota isteği (kota korunur)', S.calls.length <= 1 + O.MAX_ALTERNATIVES && S.asks[0]?.choices.length <= 3, S.calls.length);

// I) Soru açıkken rota değişti (ör. yeniden rota): eski seçenek uygulanmaz
reset([gated], 30);
detour = { gated: 4 };
S.choose = (r) => { C.clearTrip(); return r.choices[0]; };
await C.planTrip();
p = getState('plan');
ok('I: soru sırasında plan değiştiyse onaylanan eski seçenek uygulanmaz', p.status === 'none' && p.route === null && p.stops.length === 0, `${p.status}`);
ok('ağ çağrısı yok', netCalls === 0);

// ---------- 3) Arayüz metni ve bağlantılar ----------
const { choiceLines } = await import('../js/ui/routeChoice.js');
const L = choiceLines({ station: { name: 'X DC', kw: 150 }, provider: 'osm', summary: { addKm: 7.4, addMin: null, arriveStopSoc: 12.2, leaveStopSoc: null, chargeMin: 21, arriveEndSoc: null } });
ok('arayüz: eksik ölçü "--" (uydurulmaz), ek km işaretli', /\+7 km/.test(L.line1) && /-- dk/.test(L.line1) && /%12/.test(L.line2) && /--/.test(L.line2) && /OSM\/Valhalla/.test(L.line3), JSON.stringify(L));
ok('arayüz: DOM yokken soru hiçbir şey seçmez', (await (await import('../js/ui/routeChoice.js')).askRouteChoice({ choices: [] })) === null);
const nav = readFileSync(new URL('../js/nav/navigator.js', import.meta.url), 'utf8');
ok('Sonraki şarj hücresi işareti plan.routeStatus\'tan (stopFlag) ve açıklama başlıkta', /stopFlag\(nextStop, plan\.routeStatus\)/.test(nav) && /FLAG_TEXT\[v\.flag\]/.test(nav));
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
ok('sw.js önbellek listesinde yeni modüller', sw.includes("'./js/routing/onRoute.js'") && sw.includes("'./js/ui/routeChoice.js'"));
const keys = [...JSON.parse(readFileSync(new URL('../i18n/keys.extra.json', import.meta.url), 'utf8')), ...JSON.parse(readFileSync(new URL('../i18n/keys.json', import.meta.url), 'utf8'))];
const NEW_KEYS = [
  'Aktif rota üzerinde uygun şarj durağı yok. Rotadan ayrılmayı gerektiren istasyonlar yalnızca onayınla rotaya eklenir.',
  'Rota dışı şarj seçeneği hesaplanamadı; mevcut rota korundu.', 'Mevcut rota korundu; rota dışı şarj istasyonu eklenmedi.',
  'Erişim yol ağıyla doğrulanmadı', 'Rota dışı: rota bu istasyondan geçmiyor', 'Karşı yönde/erişilemez olabilir',
  'Rota üzerinde uygun şarj yok', 'Mevcut rotada kal', '{0} km · {1} dk ek yol', 'Durakta varış %{0} → %{1} (~{2} dk şarj) · hedefte %{3}',
  'Rota: {0} · {1} kW · rakım hariç, yaklaşık', 'Rotadan ayrılan şarj seçeneği için rota sağlayıcısından rota alınamadı ({0}). Mevcut rota değişmedi.',
  'Aşağıdaki seçenekler rotadan ayrılmayı gerektirir. Seçmezsen mevcut rota aynen kalır.', 'Şarj istasyonu', 'bilinmiyor', 'aday yok',
];
ok('yeni metinler i18n anahtar listelerinde (11 dil çevirisi i18n-validate ile)', NEW_KEYS.every((k) => keys.includes(k)), NEW_KEYS.filter((k) => !keys.includes(k)).join(' | '));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
