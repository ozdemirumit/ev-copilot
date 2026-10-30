import { getState, patch, subscribe, effective } from '../state.js';
import { load } from '../utils/storage.js';
import { fetchRoute } from './osrm.js';
import { fetchChargers, reprice } from './chargerSource.js';
import { planRoute, rankStations } from './planner.js';
import { resampleRoute, buildProfile } from '../physics/routeProfile.js';
import { fetchElevations } from '../physics/elevation.js';
import { fetchWeather } from '../physics/weather.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';

const WX_STEP_KM = 50;
let raw = null; // { pts, elevations, elevSource, wx } — profil ayarları değişince yeniden kurmak için
let startSoc = 80;
let sig = '';
let cacheKey = null;
let timer = null;

const routeSig = () => {
  const r = getState('route');
  return [r.cruise, r.traffic, r.minArrivalSoc, r.consAdj, r.chargerMin, r.maxChargeTo, r.minStopAdd, r.tolerance].join('|');
};

function buildFromRaw() {
  const r = getState('route');
  return buildProfile({ ...raw, cruise: r.cruise, traffic: r.traffic });
}

/** Mevcut profil/istasyonlarla planı (yeniden) hesapla. fromKm/soc verilirse o konumdan (dinamik yeniden planlama). */
export function computePlan({ fromKm = 0, soc = startSoc, maxFirstStopKm = Infinity } = {}) {
  const plan = getState('plan');
  const r = getState('route');
  const k = getState('engine').k;
  if (!plan.profile) return null;
  const stations = plan.stations;
  const result = planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: plan.mode, k, maxFirstStopKm,
  });
  const ranking = rankStations({ profile: plan.profile, stations, startKm: fromKm, startSoc: soc, k, mode: plan.mode });
  return { result, ranking };
}

function applyPlan(out, extra = {}) {
  if (!out) return;
  const { result, ranking } = out;
  patch('plan', {
    ...extra,
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
  const { stations, errors, cached } = await fetchChargers(pts, profile, load('ocmKey', ''), cacheKey);
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

export async function planTrip() {
  const { start, end } = getState('route');
  if (!start || !end) return toast('Önce başlangıç ve varış seç');
  const e = effective();
  startSoc = e.soc ?? 80;
  if (e.soc == null) toast('Pil okunamadı: %80 varsayıldı');

  try {
    patch('plan', { status: 'loading', text: 'Rota alınıyor…', stops: [], totals: null, ranking: [], fromKm: 0, fromSoc: null });
    patch('sim', { routeKm: 0, lat: null, lon: null, play: false }); // simüle araç yeni rotanın başına
    const rt = await fetchRoute(start, end);
    const pts = resampleRoute(rt.coords);
    mapApi.drawRoute(rt.coords);

    patch('plan', { text: 'Rakım ve hava durumu alınıyor…' });
    const cruise = getState('route').cruise;
    const wxPts = pts.filter((_, i) => i % (WX_STEP_KM / 2) === 0);
    if (wxPts.at(-1) !== pts.at(-1)) wxPts.push(pts.at(-1));
    const t0 = Date.now();
    const [elev, wxRes] = await Promise.all([
      fetchElevations(pts),
      fetchWeather(wxPts.map((p) => ({ lat: p.lat, lon: p.lon, t: t0 + (p.km / cruise) * 3600e3 }))).catch((err) => { console.warn(err); return null; }),
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
    patch('plan', { route: rt, profile, stations: [], stationInfo: null, text: 'Şarj istasyonları aranıyor…' });

    cacheKey = [start, end].map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('>');
    await loadStations(pts, profile);
    applyPlan(computePlan(), { startSoc });
  } catch (err) {
    console.error(err);
    patch('plan', { status: 'error', text: err.message });
    toast('Plan hatası: ' + err.message, 4000);
  }
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
  document.getElementById('btn-plan').addEventListener('click', planTrip);
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
