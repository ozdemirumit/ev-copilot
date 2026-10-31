import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { fetchRoute } from './googleRoute.js';
import { fetchChargers, reprice, reproject } from './chargerSource.js';
import { planRoute, rankStations } from './planner.js';
import { resampleRoute, buildProfile } from '../physics/routeProfile.js';
import { densityFromRatio, speedFactor } from '../physics/traffic.js';
import { kForSpeed } from '../physics/history.js';
import { PHYSICS } from '../config.js';
import { fetchElevations } from '../physics/elevation.js';
import { fetchWeather } from '../physics/weather.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { projectSteps } from '../nav/steps.js';

const WX_STEP_KM = 50;
let raw = null; // { pts, elevations, elevSource, wx } — profil ayarları değişince yeniden kurmak için
let startSoc = 80;
let sig = '';
let cacheKey = null;
let timer = null;

const routeSig = () => {
  const r = getState('route');
  return [r.cruise, r.traffic, r.minArrivalSoc, r.consAdj, r.chargerMin, r.maxChargeTo, r.minStopAdd, r.tolerance, r.allowSlow].join('|');
};

function buildFromRaw() {
  const r = getState('route');
  return buildProfile({ ...raw, cruise: r.cruise, traffic: r.traffic });
}

/**
 * Planlamada kullanılan tüketim düzeltmesi k (ölçülen / model). Geçmiş ölçümlerden, planın gerçekte süreceği
 * hızda (seyir hızı × trafik) bulunur; ≥ 40 km veri varsa kullanılır. Şu an ölçüm de yapılıyorsa canlı k ile yarı yarıya karıştırılır.
 */
export function planK() {
  const r = getState('route');
  const eng = getState('engine');
  const v = Math.max(30, r.cruise * speedFactor(r.traffic));
  const h = kForSpeed(v);
  const hist = h && h.km >= 40 ? Math.min(1.6, Math.max(0.7, h.kBase / PHYSICS.consScale)) : null;
  const live = eng.measuredKm != null ? eng.k : null;
  if (hist != null && live != null) return { k: 0.5 * hist + 0.5 * live, src: `geçmiş (${Math.round(h.km)} km) + canlı`, v };
  if (hist != null) return { k: hist, src: `geçmiş ölçüm (~${Math.round(v)} km/s civarı, ${Math.round(h.km)} km)`, v };
  return { k: eng.k, src: eng.k !== 1 ? 'canlı kalibrasyon' : 'kalibre değil (model varsayımı)', v };
}

/** Mevcut profil/istasyonlarla planı (yeniden) hesapla. fromKm/soc verilirse o konumdan (dinamik yeniden planlama). */
export function computePlan({ fromKm = 0, soc = startSoc, maxFirstStopKm = Infinity } = {}) {
  const plan = getState('plan');
  const r = getState('route');
  if (!plan.profile) return null;
  const kInfo = planK();
  const k = kInfo.k;
  const stations = plan.stations;
  // Zorunlu ilk durak yalnızca hâlâ ilerideyse geçerlidir (geçildiyse veya listede yoksa yok sayılır)
  const forced = plan.forceFirstId && stations.some((s) => s.id === plan.forceFirstId && s.km > fromKm + 0.5) ? plan.forceFirstId : null;
  const result = planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: plan.mode, k, maxFirstStopKm, forceFirstId: forced,
  });
  const ranking = rankStations({ profile: plan.profile, stations, startKm: fromKm, startSoc: soc, k, mode: plan.mode });
  return { result, ranking, kInfo };
}

function applyPlan(out, extra = {}) {
  if (!out) return;
  const { result, ranking, kInfo } = out;
  patch('plan', {
    ...extra,
    kInfo,
    status: result.feasible ? 'ready' : 'infeasible',
    text: result.feasible ? '' : result.reason,
    stops: result.stops,
    totals: result.totals || null,
    ranking,
  });
  mapApi.drawStations(getState('plan').stations, result.stops);
}

/** İstasyonları getir ve plan durumuna yaz; hata/önbellek bilgisi İstasyon sekmesinde kalıcı gösterilir. */
async function loadStations(pts, profile) {
  const { stations, errors, cached } = await fetchChargers(pts, profile, cacheKey);
  if (errors.length) toast(errors.join(' · '), 7000);
  if (cached) toast('İstasyonlar önbellekten alındı');
  patch('plan', { stations, stationInfo: { errors, cached } });
}

/** İstasyon sekmesindeki "Yeniden ara": rota/profil aynı kalır, yalnızca istasyon sorgusu tekrarlanır. */
export async function refetchStations() {
  const plan = getState('plan');
  if (!raw || !plan.profile || plan.status === 'loading') return;
  patch('plan', { status: 'loading', text: 'Şarj istasyonları aranıyor…' });
  try {
    await loadStations(raw.pts, plan.profile);
    const p = getState('plan');
    applyPlan(computePlan({ fromKm: p.fromKm ?? 0, soc: p.fromSoc ?? startSoc }));
  } catch (err) {
    console.error(err);
    patch('plan', { status: 'error', text: err.message });
  }
}

/**
 * Rotayı planla. `from` verilirse (yeniden rota: rotadan çıkıldı) başlangıç o konumdur ve istasyonlar yeniden aranmaz,
 * mevcut liste yeni rotaya izdüşürülür (Google'a yeniden gitmemek için).
 * via: şarj istasyonu — rota ondan geçer ve plan ilk durak olarak orada şarj eder (varış noktası değişmez).
 * extra: plana eklenecek ek istasyonlar (ör. yakın çevre aramasından).
 */
export async function planTrip(from = null, { via = null, extra = [] } = {}) {
  const route = getState('route');
  const start = from || route.start;
  const end = route.end;
  if (!start || !end) return toast('Önce başlangıç ve varış seç');
  const e = effective();
  startSoc = e.soc ?? 80;
  if (e.soc == null) toast('Pil okunamadı: %80 varsayıldı');

  try {
    patch('plan', { status: 'loading', text: 'Rota alınıyor…', stops: [], totals: null, ranking: [], fromKm: 0, fromSoc: null });
    patch('sim', { routeKm: 0, lat: null, lon: null, play: false }); // simüle araç yeni rotanın başına
    const rt = await fetchRoute(start, end, via ? [via] : []);
    // Trafik: Google'ın trafikli süresinden yoğunluğu türet → enerji, hız ve süre hesabına girer (elle ayarı ezer)
    patch('route', { trafficInfo: { ratio: rt.trafficRatio, driveMin: rt.durationH * 60, freeMin: (rt.durationH * 60) / rt.trafficRatio } });
    if (getState('route').trafficAuto) {
      const d = densityFromRatio(rt.trafficRatio);
      patch('route', { traffic: d });
      save('trafficEst', d);
    }
    const pts = resampleRoute(rt.coords);
    mapApi.drawRoute(rt.coords, { fit: !from });
    if (from) mapApi.setPoint('start', from, { fit: false });

    patch('plan', { text: 'Rakım ve hava durumu alınıyor…' });
    const cruise = getState('route').cruise;
    const wxPts = pts.filter((_, i) => i % (WX_STEP_KM / 2) === 0);
    if (wxPts.at(-1) !== pts.at(-1)) wxPts.push(pts.at(-1));
    const t0 = Date.now();
    let wxError = null;
    const [elev, wxRes] = await Promise.all([
      fetchElevations(pts),
      fetchWeather(wxPts.map((p) => ({ lat: p.lat, lon: p.lon, t: t0 + (p.km / cruise) * 3600e3 }))).catch((err) => { console.warn(err); wxError = err.message; return null; }),
    ]);
    if (!elev) toast('Rakım alınamadı: rota düz kabul edildi');
    if (!wxRes) toast('Hava durumu alınamadı: rüzgar/yağış yok sayıldı');

    raw = {
      pts,
      elevations: elev?.elevations ?? null,
      elevSource: elev?.source ?? null,
      wx: wxRes ? wxRes.map((w, i) => ({ km: wxPts[i].km, ...w })) : [],
    };
    sig = routeSig();
    const profile = buildFromRaw();
    const pool = from ? [...getState('plan').stations, ...extra.filter((x) => !getState('plan').stations.some((s) => s.id === x.id))] : [];
    const kept = from ? reproject(pool, profile) : [];
    patch('plan', { route: rt, profile, steps: projectSteps(rt.steps, profile), planId: Date.now(), wxInfo: { source: wxRes?.source ?? null, fallbackReason: wxRes?.fallbackReason ?? null, error: wxError }, forceFirstId: via?.id ?? null, stations: kept, stationInfo: from ? getState('plan').stationInfo : null, text: 'Şarj istasyonları aranıyor…' });

    if (!kept.length) {
      cacheKey = [start, end].map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('>');
      await loadStations(pts, profile);
    }
    applyPlan(computePlan(), { startSoc });
  } catch (err) {
    console.error(err);
    patch('plan', { status: 'error', text: err.message });
    toast('Plan hatası: ' + err.message, 4000);
  }
}

/** Navigasyon: rotadan çıkıldı, bulunduğun konumdan varışa yeniden rota kur. */
export function rerouteFromHere() {
  const e = effective();
  if (e.lat == null || getState('plan').status === 'loading') return false;
  planTrip({ lat: e.lat, lon: e.lon, label: 'Konumum' });
  return true;
}

/** İstasyon fiyat/kW tablosu değişti: ağ çağrısı olmadan yeniden fiyatla ve planla. */
export function repriceAndReplan() {
  const plan = getState('plan');
  if (!plan.profile) return;
  patch('plan', { stations: reprice(plan.stations) });
  applyPlan(computePlan({ fromKm: plan.fromKm ?? 0, soc: plan.fromSoc ?? startSoc }));
}

/** Dinamik fallback: mevcut konumdan, ilk durağı maxFirstStopKm'den ileri olmayacak şekilde yeniden planla. */
export function replanFrom({ km, soc, maxFirstStopKm }) {
  const out = computePlan({ fromKm: km, soc, maxFirstStopKm });
  if (!out?.result.feasible) return false;
  applyPlan(out, { fromKm: km, fromSoc: soc });
  return true;
}

// Mod değişimi veya seyir hızı / trafik / eşik değişimi → profili yeniden kur ve planla (ağ yok).
function refresh() {
  if (!raw || getState('plan').status === 'loading') return;
  if (routeSig() !== sig) {
    sig = routeSig();
    patch('plan', { profile: buildFromRaw() });
  }
  const plan = getState('plan');
  applyPlan(computePlan({ fromKm: plan.fromKm ?? 0, soc: plan.fromSoc ?? startSoc }));
}

export function initRouteController() {
  document.getElementById('btn-plan').addEventListener('click', () => planTrip());
  let lastMode = getState('plan').mode;
  subscribe('plan', (p) => {
    if (p.mode !== lastMode) { lastMode = p.mode; refresh(); }
  });
  subscribe('route', () => {
    if (routeSig() === sig) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  });
}
