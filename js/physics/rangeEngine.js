import { getState, patch, effective } from '../state.js';
import { VEHICLE } from '../config.js';
import { save } from '../utils/storage.js';
import { headwindComponent, haversineKm } from '../utils/geo.js';
import { batteryPowerKw, kwhPer100 } from './model.js';
import { createTracker } from './consumption.js';
import { trafficBreakdown, stopGoOverhead } from './traffic.js';
import { fetchWeather } from './weather.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tracker = createTracker();

let lastT = performance.now();
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
  const dtReal = Math.min(5, (now - lastT) / 1000);
  lastT = now;

  const sim = getState('sim');
  const plan = getState('plan');
  const route = getState('route');
  const e = effective();
  const scale = sim.enabled && sim.play ? sim.timeScale : 1;
  const dt = dtReal * scale;

  let routeKm = null;
  let offKm = null;
  if (plan.profile && e.lat != null) {
    const p = plan.profile.project(e.lat, e.lon, getState('engine').routeKm);
    routeKm = p.km;
    offKm = p.offKm;
  }

  const speed = e.speed ?? 0;
  const dKm = (speed * dt) / 3600;
  odo += dKm;
  updateLiveGrade(e);

  const cond = modelConditions(e, plan, routeKm);
  const overhead = stopGoOverhead(cond.traffic ?? 0);
  const modelKw = batteryPowerKw({ v: speed, ...cond });
  tracker.addDistance(dKm, (modelKw * dt * overhead) / 3600);
  tracker.addSoc(e.soc == null ? null : Math.round(e.soc));

  const st = tracker.stats();
  let k = getState('engine').k;
  if (st && st.at !== lastStatsAt) {
    lastStatsAt = st.at;
    if (st.k) {
      k = k * 0.6 + clamp(st.k, 0.6, 1.8) * 0.4;
      if (!sim.enabled) save('kCal', k);
    }
  }

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
  const usable = e.soc == null ? null : (Math.max(0, e.soc - route.minArrivalSoc) / 100) * VEHICLE.batteryNetKwh;

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
    kwh100Est: est,
    rangeKm: usable == null ? null : (usable / est) * 100,
    netWind, aeroPct, traffic,
  });

  maybeRefreshWeather(e);
}

export function initRangeEngine() {
  setInterval(tick, 1000);
}
