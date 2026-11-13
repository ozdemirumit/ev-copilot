// Aktif rota varken yeniden "Rota planla": önceki rotanın geç gelen (stale) asenkron sonuçları yeni rotayı ezmez, hata olursa
// tutarlı plan/harita kalır, aynı parametrelerde mevcut önbellek (utils/cache.js) kullanılır. Kullanım: node scripts/test-replan.mjs
// Senaryolar: hızlı çift tıklama, aynı rotayı tekrar planlama (önbellek isabeti), farklı hedefe geçiş (önbellek ıskası),
// geç gelen rota yanıtı, geç gelen erişim doğrulaması (eski planın arka plan adımı), geç gelen hata, rota bulunamadı (önceki plan var/yok),
// aktif navigasyonda yeniden planlama; kullanıcı girişleri (başlangıç/varış/pil) sıfırlanmaz.
// Ağ engellidir; sağlayıcılar sahtedir (ücretli API çağrısı yok).
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };

const S = (globalThis.__rpStub = {
  routeApi: 0, chargerApi: 0, probes: 0, toasts: [], draws: [], stationDraws: [], clears: 0,
  route: null, chargers: null, probe: null, cached: null, TTL: null, gate: null,
});
const g = 'globalThis.__rpStub';
const k5 = 'p => p.lat.toFixed(5) + "," + p.lon.toFixed(5)';
const STUBS = {
  // Sağlayıcı katmanı: gerçek uygulamadaki gibi önbellek (cached) ARKASINDA "API" çağrısı sayılır
  '../providers/index.js': `
    const k = ${k5};
    export const fetchRoute = async (s, e, via = []) => ${g}.cached('rt:' + k(s) + '>' + k(e) + '|' + via.map(k).join(';'), ${g}.TTL.route, async () => { ${g}.routeApi++; return ${g}.route(s, e, via); }, { persist: false });
    export const fetchElevations = async () => null;
    export const fetchWeather = async () => null;
    export const fetchChargers = async (pts, profile, key) => {
      const list = await ${g}.cached('ch:' + key, ${g}.TTL.long, async () => { ${g}.chargerApi++; return ${g}.chargers(); }, { persist: false });
      return { stations: list.map((x) => ({ ...x, ...profile.project(x.lat, x.lon) })), errors: [], cached: false, summary: null };
    };
    export const probeStopAccess = async (q) => { ${g}.probes++; if (${g}.gate) await ${g}.gate; return ${g}.probe(q); };`,
  '../ui/mapView.js': `export const mapApi = {
    drawRoute: (c) => { ${g}.draws.push(c); }, drawStations: (st, stops) => { ${g}.stationDraws.push({ st, stops }); },
    setPoint: () => {}, clearRoute: () => { ${g}.clears++; ${g}.draws.push(null); } };`,
  '../ui/toast.js': `export const toast = (m) => { ${g}.toasts.push(String(m)); };`,
  '../ui/recentDest.js': 'export const rememberDest = () => {};',
  '../utils/idb.js': 'export const kvDel = () => {};',
  '../physics/socEstimate.js': 'export const setManual = () => {};',
};
registerHooks({
  resolve(spec, ctx, next) {
    if (ctx.parentURL?.endsWith('/js/routing/controller.js') && spec in STUBS) return { url: 'data:text/javascript,' + encodeURIComponent(STUBS[spec]), format: 'module', shortCircuit: true };
    return next(spec, ctx);
  },
});

const cache = await import('../js/utils/cache.js');
S.cached = cache.cached; S.TTL = cache.TTL;
const A = await import('../js/routing/stopAccess.js');
const { PLANNER } = await import('../js/config.js');
PLANNER.minKw = 50; PLANNER.minStopAdd = 0; PLANNER.brands = [];
const { getState, patch } = await import('../js/state.js');
const C = await import('../js/routing/controller.js');

const LAT = 40;
const START = { lat: LAT, lon: 28, label: 'Ev' };
const END1 = { lat: LAT, lon: 31, label: 'Hedef 1' };
const END2 = { lat: LAT, lon: 30.4, label: 'Hedef 2' };
const line = (a, b) => { const c = []; const d = Math.sign(b.lon - a.lon) * 0.005; for (let x = a.lon; d > 0 ? x <= b.lon + 1e-9 : x >= b.lon - 1e-9; x += d) c.push([+x.toFixed(5), LAT]); return c; }; // doğuya ya da batıya düz rota
const routeOf = (s, e) => {
  const coords = line(s, e);
  const km = A.lineKm(coords).at(-1);
  return { coords, intervals: [], distanceKm: km, durationH: km / 100, trafficRatio: 1, steps: [{ type: 'depart', modifier: null, text: 'Yola çıkın', distM: km * 1000, staticSec: km * 36 }, { type: 'arrive', modifier: null, text: 'Varış', distM: 0 }] };
};
const mk = (id, lon) => ({ id, name: id, lat: LAT - 0.0006, lon, opId: 'other', opName: 'Test', src: 'test', srcKw: 180, kw: 180, price: 10, slow: false, uncertain: false });
const STATIONS = [mk('s1', 28.6), mk('s2', 29.0), mk('s3', 29.4), mk('s4', 29.8), mk('s5', 30.2), mk('s6', 30.6)];
const roadProbe = ({ a, b }) => Math.abs(b.lon - a.lon) * 111.32 * Math.cos((LAT * Math.PI) / 180) + 0.1; // doğru yön: küçük sapma
const deferred = () => { let resolve, reject; const p = new Promise((r, j) => { resolve = r; reject = j; }); return { p, resolve, reject }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const within = (p, ms = 2000) => Promise.race([p, new Promise((r) => setTimeout(() => r('ZAMAN AŞIMI'), ms))]); // takılan planlama sessizce çıkmasın
const lastLon = (coords) => coords?.at(-1)?.[0];

const reset = () => {
  cache.clearCache();
  Object.assign(S, { routeApi: 0, chargerApi: 0, probes: 0, toasts: [], draws: [], stationDraws: [], clears: 0, gate: null });
  S.route = (s, e) => routeOf(s, e);
  S.chargers = () => STATIONS;
  S.probe = roadProbe;
  C.clearTrip();
  patch('nav', { active: false });
  patch('route', { start: START, end: END1, via: null });
  patch('live', { soc: 60 });
};

// ---------- 1) Hızlı çift tıklama: iki planTrip aynı anda; yalnızca sonuncusu planı yazar ----------
reset();
{
  const gate = deferred();
  S.route = async (s, e) => { await gate.p; return routeOf(s, e); };
  const p1 = C.planTrip();
  const p2 = C.planTrip();
  gate.resolve();
  const [r1, r2] = await Promise.all([p1, p2]);
  const p = getState('plan');
  ok('çift tıklama: ilk çağrı yerini yenisine bırakır (false), ikincisi kurar (true)', r1 === false && r2 === true, `${r1} ${r2}`);
  ok('çift tıklama: plan hazır, varış Hedef 1', p.status === 'ready' && lastLon(p.route?.coords) === END1.lon, `${p.status} ${p.text}`);
  ok('çift tıklama: aynı rota için sağlayıcı API tek kez çağrılır (eşzamanlı istek birleşir)', S.routeApi === 1, String(S.routeApi));
  ok('çift tıklama: "mevcut plan korundu"/"Plan hatası" uyarısı yok', !S.toasts.some((t) => /korundu|Plan hatası/.test(t)), JSON.stringify(S.toasts));
}

// ---------- 2) Aynı rotayı tekrar planlama: önbellek isabeti, gereksiz API çağrısı yok ----------
reset();
{
  ok('ilk plan kurulur', (await C.planTrip()) === true && getState('plan').status === 'ready', getState('plan').text);
  const id1 = getState('plan').planId;
  const before = { route: S.routeApi, ch: S.chargerApi, probes: S.probes };
  await new Promise((r) => setTimeout(r, 2)); // planId = Date.now(): yeni planın kimliği farklı olsun
  const res = await C.planTrip();
  const p = getState('plan');
  ok('aynı rota tekrar: plan yeniden kurulur (yeni planId), hazır', res === true && p.status === 'ready' && p.planId !== id1, `${res} ${p.status}`);
  ok('aynı rota tekrar: rota API çağrısı yok (önbellek)', S.routeApi === before.route, `${before.route} → ${S.routeApi}`);
  ok('aynı rota tekrar: istasyon API çağrısı yok (önbellek)', S.chargerApi === before.ch, `${before.ch} → ${S.chargerApi}`);
  ok('aynı rota tekrar: önceki planın durakları yeni planda yeniden doğrulanır', p.stops.every((s) => s.station.access?.verified === true) && p.stops.length > 0, JSON.stringify(p.stops.map((s) => [s.station.id, s.station.access?.verified])));
  ok('kullanıcı girişleri korunur (başlangıç, varış, pil)', getState('route').start === START && getState('route').end === END1 && getState('live').soc === 60);
}

// ---------- 3) Farklı hedefe geçiş: önbellek ıskası, yeni rota çizilir, eski duraklar kalmaz ----------
{
  const before = S.routeApi;
  patch('route', { end: END2 });
  const res = await C.planTrip();
  const p = getState('plan');
  ok('farklı hedef: yeni rota API çağrısı yapılır (önbellek ıskası)', S.routeApi === before + 1, `${before} → ${S.routeApi}`);
  ok('farklı hedef: plan ve harita yeni hedefe', res === true && lastLon(p.route.coords) === END2.lon && lastLon(S.draws.at(-1)) === END2.lon);
  ok('farklı hedef: durak/istasyonlar yeni rotanın ötesinde değil', p.stations.every((s) => s.km <= p.profile.totalKm + 0.5) && p.stops.every((s) => s.km <= p.profile.totalKm), JSON.stringify(p.stops.map((s) => s.station.id)));
  ok('farklı hedef: varış girişi değişmez', getState('route').end === END2);
}

// ---------- 4) Geç gelen rota yanıtı: eski hedefin yanıtı yeni hedeften SONRA gelir ----------
reset();
{
  const slow = deferred();
  S.route = async (s, e) => (e.lon === END1.lon ? (await slow.p, routeOf(s, e)) : routeOf(s, e));
  const p1 = C.planTrip(); // Hedef 1: yanıt gecikir
  await tick();
  patch('route', { end: END2 });
  const r2 = await C.planTrip(); // Hedef 2: hemen biter
  const drawsAfter2 = S.draws.length;
  slow.resolve();
  const r1 = await p1;
  await tick();
  const p = getState('plan');
  ok('geç yanıt: yeni hedef kurulur, eski çağrı false döner', r2 === true && r1 === false, `${r1} ${r2}`);
  ok('geç yanıt: plan yeni hedefte kalır (eski rota ezmez)', lastLon(p.route.coords) === END2.lon && p.status === 'ready', `${lastLon(p.route.coords)} ${p.status}`);
  ok('geç yanıt: eski rota haritaya çizilmez', S.draws.length === drawsAfter2 && lastLon(S.draws.at(-1)) === END2.lon, `${S.draws.length} ${drawsAfter2}`);
  ok('geç yanıt: rota özeti (trafficInfo) yeni rotanın', Math.abs(getState('route').trafficInfo.driveMin - p.route.durationH * 60) < 1e-6);
}

// ---------- 5) Geç gelen arka plan adımı: eski planın erişim doğrulaması yeni planlama sürerken biter ----------
reset();
{
  const gate = deferred();
  S.gate = gate.p; // eski planın yol ağı sorgusu bekler (plan "hazır" görünür, Rota planla yeniden dokunulabilir)
  const p1 = C.planTrip();
  for (let i = 0; i < 20 && getState('plan').status !== 'ready'; i++) await tick();
  ok('eski plan hazır, erişim doğrulaması sürüyor', getState('plan').status === 'ready' && S.probes > 0);
  // Yeni yolculuk ters yönde (Hedef 1 → Ev, batıya): eski planın doğuya yön kayıtları geçersiz, yeni planın durakları kendi sorgusunu ister
  patch('route', { start: END1, end: START });
  const slowRoute = deferred();
  S.route = async (s, e) => { await slowRoute.p; return routeOf(s, e); };
  patch('live', { soc: 30 }); // yeni yolculukta durak gereksin (doğrulanacak durak olsun)
  const p2 = C.planTrip(); // yeni planlama: rota bekliyor (durum loading)
  await tick();
  S.gate = null;
  gate.resolve(); // eski planın sorgusu ŞİMDİ biter
  await p1;
  await tick();
  ok('geç doğrulama: yeni planlama sürerken plan "loading" kalır (eski plan geri yazılmaz)', getState('plan').status === 'loading', getState('plan').status);
  ok('geç doğrulama: eski çağrı false döner', (await p1) === false);
  const probesBefore = S.probes;
  slowRoute.resolve();
  const r2 = await p2;
  const p = getState('plan');
  ok('geç doğrulama: yeni plan (batıya, varış Ev) hazır', r2 === true && p.status === 'ready' && lastLon(p.route.coords) === START.lon, `${r2} ${p.status} ${p.text}`);
  ok('geç doğrulama: yeni planın durakları kendi doğrulamasından geçer (eski çalışma yeniden kullanılmaz)', p.stops.length > 0 && S.probes > probesBefore && p.stops.every((s) => s.station.access?.verified === true), JSON.stringify(p.stops.map((s) => [s.station.id, s.station.access?.verified])));
}

// ---------- 5b) Eski planın erişim doğrulaması, yeni plan kendi doğrulamasına geldiğinde HÂLÂ sürüyor ----------
// (Eski davranış: verifyStopAccess süren eski çalışmayı döndürür; o da planId değişti diye bırakır → yeni planın durakları hiç doğrulanmaz.)
reset();
{
  const gate = deferred();
  S.gate = gate.p;
  const p1 = C.planTrip();
  for (let i = 0; i < 20 && getState('plan').status !== 'ready'; i++) await tick();
  ok('5b: eski plan hazır, doğrulaması bekliyor', getState('plan').status === 'ready' && S.probes > 0);
  patch('route', { start: END1, end: START }); // ters yön: eski yön kayıtları geçmez
  patch('live', { soc: 30 });
  S.gate = null; // yeni planın sorguları beklemez; eskininkiler beklemeye devam eder
  const probesBefore = S.probes;
  const r2 = await within(C.planTrip());
  const p = getState('plan');
  ok('5b: yeni planlama eski doğrulamayı beklerken takılmaz', r2 !== 'ZAMAN AŞIMI', `${r2} ${p.status}`);
  ok('5b: yeni plan hazır', r2 === true && p.status === 'ready' && lastLon(p.route.coords) === START.lon, `${r2} ${p.status} ${p.text}`);
  ok('5b: yeni planın durakları kendi sorgusuyla doğrulanır (eski çalışma döndürülmez)', p.stops.length > 0 && S.probes > probesBefore && p.stops.every((s) => s.station.access?.verified === true), JSON.stringify(p.stops.map((s) => [s.station.id, s.station.access?.verified])));
  const id2 = p.planId;
  gate.resolve();
  ok('5b: eski çağrı false döner', (await within(p1)) === false);
  await tick();
  ok('5b: eski doğrulamanın bitişi yeni planı değiştirmez', getState('plan').planId === id2 && getState('plan').status === 'ready' && lastLon(getState('plan').route.coords) === START.lon);
}

// ---------- 6) Geç gelen HATA: eski istek başarısız olur ama yeni plan bozulmaz ----------
reset();
{
  const slow = deferred();
  S.route = async (s, e) => (e.lon === END1.lon ? (await slow.p, routeOf(s, e)) : routeOf(s, e));
  const p1 = C.planTrip();
  await tick();
  patch('route', { end: END2 });
  await C.planTrip();
  const snap = getState('plan').planId;
  slow.reject(new Error('zaman aşımı'));
  ok('geç hata: eski çağrı false', (await p1) === false);
  const p = getState('plan');
  ok('geç hata: yeni plan aynen kalır, hata/koruma uyarısı yok', p.planId === snap && p.status === 'ready' && lastLon(p.route.coords) === END2.lon && !S.toasts.some((t) => /zaman aşımı/.test(t)), JSON.stringify(S.toasts));
}

// ---------- 7) Rota bulunamadı, önceki plan VAR: önceki plan, harita çizgisi ve rota özeti tutarlı geri gelir ----------
reset();
{
  await C.planTrip();
  const prev = getState('plan');
  const prevInfo = getState('route').trafficInfo;
  patch('route', { end: END2 });
  S.route = () => { throw new Error('Rota bulunamadı'); };
  const res = await C.planTrip();
  const p = getState('plan');
  ok('rota yok (önceki plan var): false döner', res === false);
  ok('rota yok: önceki plan aynen geri gelir (durum, rota, duraklar)', p.status === 'ready' && p.route === prev.route && p.planId === prev.planId && p.stops.length === prev.stops.length);
  ok('rota yok: anlaşılır uyarı (neden yazılı)', S.toasts.some((t) => /mevcut plan korundu/.test(t) && /Rota bulunamadı/.test(t)), JSON.stringify(S.toasts));
  ok('rota yok: varış girişi kullanıcıda kalır (sıfırlanmaz)', getState('route').end === END2);
  ok('rota yok: rota özeti önceki planın', getState('route').trafficInfo === prevInfo);
}

// ---------- 8) Rota alındı ama sonraki adım başarısız: haritadaki çizgi ve ham veri önceki plana döner ----------
reset();
{
  await C.planTrip();
  const prev = getState('plan');
  const prevInfo = getState('route').trafficInfo;
  patch('route', { end: END2 });
  S.chargers = () => { throw new Error('istasyon servisi yanıt vermedi'); };
  const res = await C.planTrip();
  const p = getState('plan');
  ok('ara adım hatası: false, önceki plan geri gelir', res === false && p.planId === prev.planId && p.status === 'ready');
  ok('ara adım hatası: haritada önceki rota çizgisi yeniden çizilir (yeni hedefin çizgisi kalmaz)', lastLon(S.draws.at(-1)) === END1.lon, String(lastLon(S.draws.at(-1))));
  ok('ara adım hatası: rota özeti (trafficInfo) önceki planın', getState('route').trafficInfo === prevInfo);
  const out = C.computePlan(); // ağsız yeniden hesap (mod/ayar değişimi) eski ham veriyle tutarlı
  ok('ara adım hatası: ağsız yeniden hesap önceki rotayla tutarlı', out && out.result.feasible && Math.abs(getState('plan').profile.totalKm - prev.profile.totalKm) < 1e-9);
}

// ---------- 9) Rota bulunamadı, önceki plan YOK: hata durumu, yarım rota/harita kalmaz ----------
reset();
{
  S.chargers = () => { throw new Error('istasyon servisi yanıt vermedi'); };
  const res = await C.planTrip();
  const p = getState('plan');
  ok('önceki plan yok: false ve "error" durumu, metin açıklayıcı', res === false && p.status === 'error' && /istasyon servisi/.test(p.text), `${p.status} ${p.text}`);
  ok('önceki plan yok: yarım rota/profil planda kalmaz', p.route == null && p.profile == null && p.stops.length === 0);
  ok('önceki plan yok: haritadaki yarım rota çizgisi temizlenir', S.draws.at(-1) === null, String(S.draws.length));
  ok('önceki plan yok: kullanıcıya hata gösterilir', S.toasts.some((t) => /Plan hatası/.test(t)));
}

// ---------- 10) Aktif navigasyonda yeniden planlama ----------
reset();
{
  await C.planTrip();
  patch('nav', { active: true });
  const id1 = getState('plan').planId;
  patch('route', { end: END2 });
  S.stationDraws = [];
  const res = await C.planTrip();
  const p = getState('plan');
  ok('navigasyon sürerken: yeni rota kurulur, yeni planId (navigatör izini/uyarılarını sıfırlar)', res === true && p.planId !== id1 && lastLon(p.route.coords) === END2.lon);
  ok('navigasyon sürerken: önceki rotanın istasyon işaretleri planlama başında haritadan kalkar', S.stationDraws[0]?.st.length === 0 && S.stationDraws[0]?.stops.length === 0, JSON.stringify(S.stationDraws[0]));
  ok('navigasyon sürerken: navigasyon kapanmaz, pil girişi değişmez', getState('nav').active === true && getState('live').soc === 60);
  const nav = readFileSync(new URL('../js/nav/navigator.js', import.meta.url), 'utf8');
  ok('navigatör yeni planId\'de rota izini ve sesli uyarıları sıfırlar (kaynak denetimi)', /plan\.planId !== planId/.test(nav) && /said = new Set\(\)/.test(nav));
  patch('nav', { active: false });
}

// ---------- 11) Arayüz: planlama sürerken düğmeler kilitli (kaynak denetimi) ----------
{
  const rp = readFileSync(new URL('../js/ui/routePanel.js', import.meta.url), 'utf8');
  ok("Rota planla düğmesi plan 'loading' iken devre dışı", /\$\('btn-plan'\)\.disabled = busy/.test(rp));
  ok("Git düğmesi plan 'loading' iken devre dışı", /go\.disabled = going \|\| getState\('plan'\)\.status === 'loading'/.test(rp));
}

ok('ağ çağrısı yok (tüm sağlayıcılar sahte)', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
