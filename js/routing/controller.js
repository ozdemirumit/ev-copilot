import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { kvGet, kvSet, kvDel } from '../utils/idb.js';
import { fetchRoute, fetchChargers, fetchElevations, fetchWeather } from '../providers/index.js';
import { reprice, reproject } from './chargerSource.js';
import { planRoute, rankStations } from './planner.js';
import { resampleRoute, buildProfile } from '../physics/routeProfile.js';
import { densityFromRatio, speedFactor } from '../physics/traffic.js';
import { segmentSpeeds } from '../physics/routeSpeed.js';
import { kForSpeed } from '../physics/history.js';
import { PHYSICS } from '../config.js';
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
  return buildProfile({ ...raw, cruise: r.cruise, traffic: r.traffic }); // raw.speeds = rota adımlarından dilim hızları
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
  const pl = getState('plan');
  const from = (pl.fromKm ?? 0) - 0.3;
  mapApi.drawStations(pl.stations.filter((s) => s.km > from), result.stops); // geride kalan istasyonlar haritadan da çıkar
}

/** İstasyonları getir ve plan durumuna yaz; hata/önbellek bilgisi İstasyon sekmesinde kalıcı gösterilir. */
async function loadStations(pts, profile) {
  const { stations, errors, cached, summary } = await fetchChargers(pts, profile, cacheKey);
  if (errors.length) toast(errors.join(' · '), 7000);
  if (cached) toast('İstasyonlar önbellekten alındı');
  patch('plan', { stations, stationInfo: { errors, cached, summary } });
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
    saveTrip();
  } catch (err) {
    console.error(err);
    patch('plan', { status: 'error', text: err.message });
  }
}

/**
 * Rotayı planla. `from` verilirse (yeniden rota: rotadan çıkıldı) başlangıç o konumdur ve istasyonlar yeniden aranmaz,
 * mevcut liste yeni rotaya izdüşürülür (sunucuya yeniden gitmemek için).
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
  const prev = { ...getState('plan') }; // internet yoksa/rota alınamazsa mevcut (kayıtlı) plan bozulmasın

  try {
    patch('plan', { status: 'loading', text: 'Rota alınıyor…', stops: [], totals: null, ranking: [], fromKm: 0, fromSoc: null });
    patch('sim', { routeKm: 0, lat: from?.lat ?? null, lon: from?.lon ?? null, play: false }); // simüle araç yeni rotanın başına (yeniden rotada bulunduğu yere)
    const rt = await fetchRoute(start, end, via ? [via] : []);
    if (rt.note) toast(rt.note, 7000);
    const pts = resampleRoute(rt.coords);
    // Hız rota adımlarından: dilim başına serbest akış hızı (yol limiti/sınıfı) ve trafik çarpanı. Elle ayar yok.
    const speeds = segmentSpeeds(rt, pts);
    patch('route', {
      trafficInfo: { ratio: rt.trafficRatio, driveMin: rt.durationH * 60, freeMin: (rt.durationH * 60) / rt.trafficRatio, avgFreeKmh: speeds.avgFreeKmh, live: !!rt.live, jamKm: rt.intervals.reduce((a, iv) => a + (iv.to - iv.from), 0) },
      cruise: Math.round(speeds.avgFreeKmh), // gösterim ve eco-hız üst sınırı için ortalama serbest hız
      traffic: densityFromRatio(rt.trafficRatio), // rota genelinde yoğunluk (planK hız bandı için)
    });
    mapApi.drawRoute(rt.coords, { fit: !from });
    if (from) mapApi.setPoint('start', from, { fit: false });

    patch('plan', { text: 'Rakım ve hava durumu alınıyor…' });
    // Hava noktaları ve geçiş saatleri: dilim hızlarından hesaplanan gerçek varış süresiyle
    const wxIdx = pts.map((_, i) => i).filter((i) => i % (WX_STEP_KM / 2) === 0);
    if (wxIdx.at(-1) !== pts.length - 1) wxIdx.push(pts.length - 1);
    const wxPts = wxIdx.map((i) => pts[i]);
    const t0 = Date.now();
    let wxError = null;
    const [elev, wxRes] = await Promise.all([
      fetchElevations(pts),
      fetchWeather(wxIdx.map((i) => ({ lat: pts[i].lat, lon: pts[i].lon, t: t0 + speeds.cumH[i] * 3600e3 }))).catch((err) => { console.warn(err); wxError = err.message; return null; }),
    ]);
    if (!elev) toast('Rakım alınamadı: rota düz kabul edildi');
    if (!wxRes) toast('Hava durumu alınamadı: rüzgar/yağış yok sayıldı');

    raw = {
      pts,
      elevations: elev?.elevations ?? null,
      elevSource: elev?.source ?? null,
      speeds: speeds.segs,
      wx: wxRes ? wxRes.map((w, i) => ({ km: wxPts[i].km, ...w })) : [],
    };
    sig = routeSig();
    const profile = buildFromRaw();
    const pool = from ? [...getState('plan').stations, ...extra.filter((x) => !getState('plan').stations.some((s) => s.id === x.id))] : [];
    const kept = from ? reproject(pool, profile) : [];
    patch('plan', { route: rt, profile, steps: projectSteps(rt.steps, profile), planId: Date.now(), wxInfo: { source: wxRes?.source ?? null, fallbackReason: wxRes?.fallbackReason ?? null, error: wxError }, forceFirstId: via?.id ?? null, lastStopKm: null, stations: kept, stationInfo: from ? getState('plan').stationInfo : null, text: 'Şarj istasyonları aranıyor…' });

    if (!kept.length) {
      cacheKey = [start, end].map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('>');
      await loadStations(pts, profile);
    }
    applyPlan(computePlan(), { startSoc });
    saveTrip();
    return true;
  } catch (err) {
    console.error(err);
    if (prev.profile && prev.status !== 'loading') {
      patch('plan', { ...prev }); // eski plan ve istasyonlar geri gelir
      mapApi.drawStations(prev.stations.filter((s) => s.km > (prev.fromKm ?? 0) - 0.3), prev.stops);
      toast('Yeni rota alınamadı, mevcut plan korundu: ' + err.message, 5000);
    } else {
      patch('plan', { status: 'error', text: err.message });
      toast('Plan hatası: ' + err.message, 4000);
    }
    return false;
  }
}

/** Navigasyon: rotadan çıkıldı, bulunduğun konumdan varışa yeniden rota kur. Dönüş: yeni rota kuruldu mu (söz). */
export async function rerouteFromHere() {
  const e = effective();
  if (e.lat == null || getState('plan').status === 'loading') return false;
  return planTrip({ lat: e.lat, lon: e.lon, label: 'Konumum' });
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

// ---------- Kayıtlı yolculuk: planlanan rota cihazda saklanır, internetsiz açılışta geri yüklenir ----------
const TRIP_KEY = 'trip';
const TRIP_MAX_AGE_MS = 36 * 3600e3;

/** Son başarılı planı (rota, adımlar, istasyonlar, profil verisi) IndexedDB'ye yaz. Profil işlev içerdiği için kaydedilmez, açılışta yeniden kurulur. */
function saveTrip() {
  const pl = getState('plan');
  const r = getState('route');
  if (!raw || !pl.route || !pl.profile || !r.start || !r.end) return;
  kvSet(TRIP_KEY, {
    v: 1, at: Date.now(), startSoc, cacheKey,
    start: r.start, end: r.end, route: pl.route, raw,
    forceFirstId: pl.forceFirstId ?? null, stations: pl.stations, stationInfo: pl.stationInfo, wxInfo: pl.wxInfo,
    trafficInfo: r.trafficInfo, cruise: r.cruise, traffic: r.traffic,
  });
}

/** Kayıtlı yolculuğu geri yükle (açılışta, henüz plan/nokta yoksa; en çok 36 saatlik). Dönüş: yüklendiyse true. */
export async function restoreTrip() {
  const t = await kvGet(TRIP_KEY);
  if (!t || t.v !== 1) return false;
  if (Date.now() - t.at > TRIP_MAX_AGE_MS) { kvDel(TRIP_KEY); return false; }
  const r = getState('route');
  if (getState('plan').status !== 'none' || r.start || r.end) return false; // kullanıcı bu arada kendi rotasına başladı
  raw = t.raw;
  cacheKey = t.cacheKey ?? null;
  startSoc = effective().soc ?? t.startSoc;
  mapApi.setPoint('start', t.start, { fit: false });
  mapApi.setPoint('end', t.end, { fit: false });
  patch('route', { trafficInfo: t.trafficInfo, cruise: t.cruise, traffic: t.traffic });
  mapApi.drawRoute(t.route.coords, { fit: true });
  sig = routeSig();
  const profile = buildFromRaw();
  patch('plan', {
    route: t.route, profile, steps: projectSteps(t.route.steps, profile), planId: Date.now(), wxInfo: t.wxInfo,
    forceFirstId: t.forceFirstId, lastStopKm: null, stations: t.stations, stationInfo: t.stationInfo,
  });
  applyPlan(computePlan(), { startSoc });
  const ageH = (Date.now() - t.at) / 3600e3;
  toast(`Kayıtlı rota yüklendi (${ageH < 1 ? 'az önce' : Math.round(ageH) + ' saat önce'} planlandı)${ageH >= 3 ? ': internet varsa yeniden planla' : ''}`, 6000);
  return true;
}

export function initRouteController() {
  document.getElementById('btn-clear-route').addEventListener('click', () => kvDel(TRIP_KEY)); // rota temizlenince kayıt da silinir
  restoreTrip(); // beklemeden: harita hazır olunca çizimler uygulanır
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
