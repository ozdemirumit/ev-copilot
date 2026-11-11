import { getState, patch, effective } from '../state.js';
import { VEHICLE } from '../config.js';
import { save } from '../utils/storage.js';
import { headwindComponent, haversineKm } from '../utils/geo.js';
import { batteryPowerKw, kwhPer100 } from './model.js';
import { rangeForEnergy, usesRouteProfile } from './rangeCalc.js';
import { createTracker } from './consumption.js';
import { trafficBreakdown, stopGoOverhead } from './traffic.js';
import { fetchWeather } from '../providers/index.js';
import { feed as feedHistory, breakWindow } from './history.js';
import { isEstimating, consume } from './socEstimate.js';
import { guard, onCatchup } from '../sensors/driveGuard.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tracker = createTracker();

let lastT = performance.now();
let gapNote = null; // son ölçüm boşluğu: { at, km (kuş uçuşu, null: bilinmiyor), gapMs } — arayüz/teşhis için
let odo = 0;
let altRef = null;
let lastStatsAt = null;
let wxBusy = false;

/**
 * Model "ne biliyor?" sorusu: rota planlıysa rota profilindeki tahmin koşulları (hava servisi + rakım),
 * değilse anlık koşullar. Test Modu'nda sürgüler "gerçek"i temsil eder; model rota tahminini kullandığı için
 * sürgüler tahminden saptırılınca ölçülen/model oranı (k) yükselir ve fallback tetiklenebilir.
 */
function modelConditions(e, plan, routeKm) {
  if (plan.profile && routeKm != null) {
    const s = plan.profile.segAt(routeKm);
    return { grade: s.grade, headwind: s.headwind, temp: s.temp, rain: s.rain, traffic: plan.profile.traffic };
  }
  const hw = e.windSpeed != null && e.heading != null ? headwindComponent(e.windSpeed, e.windDir, e.heading) : 0;
  return { grade: (e.grade ?? 0) / 100, headwind: hw, temp: e.extTemp ?? 15, rain: e.rain ?? 0, traffic: e.traffic ?? 0 };
}

function updateLiveGrade(e) {
  if (e.source !== 'live' || e.alt == null) return;
  if (!altRef) { altRef = { km: odo, alt: e.alt }; return; }
  if (odo - altRef.km < 0.4) return;
  const g = ((e.alt - altRef.alt) / ((odo - altRef.km) * 1000)) * 100;
  const prev = getState('engine').grade ?? g;
  patch('engine', { grade: clamp(prev * 0.5 + g * 0.5, -12, 12) });
  altRef = { km: odo, alt: e.alt };
}

async function maybeRefreshWeather(e) {
  if (wxBusy || e.source !== 'live' || e.lat == null) return;
  const w = getState('weather');
  const moved = w.lat == null ? Infinity : haversineKm({ lat: w.lat, lon: w.lon }, { lat: e.lat, lon: e.lon });
  if (w.at && Date.now() - w.at < 15 * 60e3 && moved < 25) return;
  wxBusy = true;
  try {
    const [r] = await fetchWeather([{ lat: e.lat, lon: e.lon, t: Date.now() }]);
    patch('weather', { ...r, at: Date.now(), lat: e.lat, lon: e.lon });
  } catch (err) {
    console.warn('Hava durumu alınamadı:', err.message);
    patch('weather', { at: w.at || 0 });
  } finally {
    wxBusy = false;
  }
}

function tick() {
  const now = performance.now();
  let dtReal = Math.min(5, (now - lastT) / 1000);
  lastT = now;

  const sim = getState('sim');
  const plan = getState('plan');
  const route = getState('route');
  const e = effective();
  const scale = sim.enabled && sim.play ? sim.timeScale : 1;
  // Gerçek GPS: sayfa arka plandaysa, zamanlayıcı durmuşsa (iOS) ya da GPS sustuysa bu adımda yol/enerji toplanmaz (son hız sonsuza
  // dek sürmüş sayılmaz). Duvar saati kullanılır: iOS askıdayken performance.now ilerlemeyebilir. Test Modu bu korumaya girmez.
  const speed = e.speed ?? 0;
  if (e.source === 'live') {
    const g = guard.step(Date.now(), { still: speed < 1 });
    if (g.gap) { tracker.gap(); breakWindow(); gapNote = { at: Date.now(), km: null, gapMs: null }; }
    dtReal = g.integrate ? Math.min(5, g.dt) : 0; // dt = 0: bu adımda yol, enerji, süre ve pil düşüşü yok (göstergeler hesaplanmaya devam eder)
  }
  const dt = dtReal * scale;

  let routeKm = null;
  let offKm = null;
  if (plan.profile && e.lat != null) {
    const p = plan.profile.project(e.lat, e.lon, getState('engine').routeKm);
    routeKm = p.km;
    offKm = p.offKm;
  }

  const dKm = (speed * dt) / 3600;
  odo += dKm;
  updateLiveGrade(e);

  const cond = modelConditions(e, plan, routeKm);
  const overhead = stopGoOverhead(cond.traffic ?? 0);
  const modelKw = batteryPowerKw({ v: speed, ...cond });
  tracker.addDistance(dKm, (modelKw * dt * overhead) / 3600);
  const estimating = isEstimating(); // elle girilen pil modelden düşüyor: gerçek ölçüm değil, tüketim öğrenmesine katılmaz
  tracker.addSoc(e.soc == null || estimating ? null : Math.round(e.soc));
  // Geçmiş: gerçek sürüş ölçümleri kayda alınır (Test Modu'nda değil)
  if (!sim.enabled) {
    feedHistory({
      dKm, dt, moving: speed > 5, modelStepKwh: (modelKw * dt * overhead) / 3600,
      soc: e.soc == null || estimating ? null : Math.round(e.soc), temp: cond.temp ?? 15, headwind: cond.headwind ?? 0, grade: cond.grade ?? 0,
    });
  }

  const st = tracker.stats();
  let k = getState('engine').k;
  if (st && st.at !== lastStatsAt) {
    lastStatsAt = st.at;
    if (st.k) {
      k = k * 0.6 + clamp(st.k, 0.6, 1.8) * 0.4;
      if (!sim.enabled) save('kCal', k);
    }
  }

  if (estimating) consume((modelKw * k * overhead * dt) / 3600); // yol alındıkça elle girilen pil düşer

  // Anlık tahmin: bu koşullarda (hız ≥ 20 ise mevcut hız, değilse seyir hızı) kWh/100km
  const vRef = speed >= 20 ? speed : route.cruise;
  // Rota varsa önümüzdeki 25 km'nin ortalaması (tek bir dilimin eğimi tahmini zıplatmasın); yoksa anlık koşul.
  let est;
  const prof = plan.profile;
  if (prof && routeKm != null && prof.totalKm - routeKm > 1) {
    const to = Math.min(prof.totalKm, routeKm + 25);
    est = (prof.energyAtSpeed(routeKm, to, vRef, k) / (to - routeKm)) * 100;
  } else {
    est = kwhPer100({ v: vRef, ...cond }) * k * overhead;
  }
  // Düz zemin tüketimi: rota profilinin bittiği yerden sonrası (ve rota yoksa her şey) için kullanılır. Yerel eğim menzile yayılmasın:
  // kısa bir iniş (%3 bile) rejenerasyonla tüketimi ~1-6 kWh/100 km'ye indirir ve "bu eğim sonsuza dek sürer" varsayımıyla
  // menzil 1000 km'yi aşardı (kısa rotanın son dilimi ya da GPS rakım eğimi).
  const estFlat = kwhPer100({ v: vRef, ...cond, grade: 0 }) * k * overhead;
  // Menzil: rota profiline göre eğim hesaba katılır, profil bitince düz zemin tüketimi (physics/rangeCalc.js).
  const rangeFor = (energyKwh) => rangeForEnergy({ energyKwh, estFlat, prof, routeKm, offKm, kp: plan.kInfo?.k ?? k });
  const usable = e.soc == null ? null : (Math.max(0, e.soc - route.minArrivalSoc) / 100) * VEHICLE.batteryNetKwh;
  const rangeKm = rangeFor(usable); // eşik piline kadar (Menzil sekmesi)
  const totalKwh = e.soc == null ? null : (Math.max(0, e.soc) / 100) * VEHICLE.batteryNetKwh;
  const totalRangeKm = rangeFor(totalKwh); // %0'a kadar (pil sürgüsü altı)
  // Tanı: menzil neye göre hesaplandı? (rota profili ya da düz zemin) ve bu menzilin ima ettiği ortalama tüketim
  const rangeSrc = usesRouteProfile({ prof, routeKm, offKm }) ? 'route' : 'flat';
  const rangeKwh100 = totalKwh != null && totalRangeKm > 0 ? (totalKwh / totalRangeKm) * 100 : null;
  const rangeKp = plan.kInfo?.k ?? k;

  // Rüzgar (anlık koşul)
  let netWind = null;
  let aeroPct = null;
  if (e.windSpeed != null && e.heading != null) {
    netWind = headwindComponent(e.windSpeed, e.windDir, e.heading);
    const base = { v: vRef, grade: cond.grade, temp: cond.temp, rain: cond.rain };
    aeroPct = (kwhPer100({ ...base, headwind: netWind }) / kwhPer100({ ...base, headwind: 0 }) - 1) * 100;
  }

  // Trafik (100 km'lik referans)
  let traffic = null;
  if (e.traffic != null) {
    traffic = trafficBreakdown({ distKm: 100, vFree: route.cruise, density: e.traffic, grade: cond.grade, headwind: cond.headwind, temp: cond.temp, rain: cond.rain });
  }

  patch('engine', {
    k,
    routeKm, offRouteKm: offKm,
    kwh100Measured: st?.kwh100 ?? null,
    kmPerPct: st?.kmPerPct ?? null,
    measuredKm: st?.distKm ?? null,
    kwh100Est: est, kwh100Flat: estFlat,
    powerKw: speed > 0 ? modelKw * k : null, // anlık güç tahmini (model × k)
    gap: gapNote,
    rangeKm, totalRangeKm, rangeSrc, rangeKwh100, rangeKp,
    netWind, aeroPct, traffic,
  });

  maybeRefreshWeather(e);
}

/**
 * Boşluk kapandı (taze konum): boşluğun iki ucu arasındaki kuş uçuşu mesafe gerçek yolun alt sınırıdır. Yalnızca elle/tahmini pil bu
 * kadarlık düz zemin tüketimiyle düşürülür (eksik düşmektense alt sınır); kilometre sayacına ve tüketim öğrenmesine girmez.
 */
export function applyCatchup({ km, gapMs }) {
  gapNote = { at: Date.now(), km, gapMs };
  const eng = getState('engine');
  const kwh100 = eng.kwh100Flat ?? eng.kwh100Est;
  if (km > 0 && kwh100 > 0 && isEstimating()) consume((km * kwh100) / 100);
  patch('engine', { gap: gapNote });
}

export function initRangeEngine() {
  onCatchup(applyCatchup);
  setInterval(tick, 1000);
}
