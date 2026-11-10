import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { kvDel } from '../utils/idb.js';
import { fetchRoute, fetchChargers, fetchElevations, fetchWeather } from '../providers/index.js';
import { reprice, reproject } from './chargerSource.js';
import { planRoute, rankStations, shown } from './planner.js';
import { resampleRoute, buildProfile } from '../physics/routeProfile.js';
import { densityFromRatio, speedFactor } from '../physics/traffic.js';
import { segmentSpeeds } from '../physics/routeSpeed.js';
import { mergeSpeeds, mergeWx } from './aheadUpdate.js';
import { kForSpeed, relFactor, overall } from '../physics/history.js';
import { PHYSICS, PLANNER } from '../config.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { setManual } from '../physics/socEstimate.js';
import { rememberDest } from '../ui/recentDest.js';
import { projectSteps } from '../nav/steps.js';
import { t as tpl } from '../i18n/index.js';

const WX_STEP_KM = 50;
let raw = null; // { pts, elevations, elevSource, wx } — profil ayarları değişince yeniden kurmak için
let startSoc = 80;
let sig = '';
let cacheKey = null;
let timer = null;

const routeSig = () => {
  const r = getState('route');
  return [r.cruise, r.traffic, r.minArrivalSoc, r.consAdj, r.chargerMin, r.maxChargeTo, r.minStopAdd, r.tolerance, r.allowSlow, r.minKw, (r.brands || []).join(','), getState('hist').at].join('|'); // hist.at: yeni sürüş ölçümü hız düzeltmesini değiştirir
};

/** Plan kurulurken hangi aşamada ne kadar zaman gitti (tm: başlangıç, rota, rakım/hava, istasyon). Her zaman konsola yazılır; 6 sn'yi aşarsa telefonda da gösterilir. */
function planTiming(tm) {
  if (tm.length < 4) return;
  const t = [...tm, Date.now()];
  const s = (i) => ((t[i + 1] - t[i]) / 1000).toFixed(1);
  const total = ((t[4] - t[0]) / 1000).toFixed(1);
  console.info(`Plan ${total} sn: rota ${s(0)} · rakım/hava ${s(1)} · istasyon ${s(2)} · hesap ${s(3)}`);
  if (t[4] - t[0] >= 6000) toast(`Plan ${total} sn sürdü: rota ${s(0)} · rakım/hava ${s(1)} · istasyon ${s(2)} · hesap ${s(3)}`, 9000);
}

function buildFromRaw() {
  const r = getState('route');
  const refV = planK().refV; // planın k'sının dayandığı referans (hız ya da tüm geçmiş): dilimler ona göre hıza bağlı düzeltilir
  return buildProfile({ ...raw, cruise: r.cruise, traffic: r.traffic, speedRel: (v) => relFactor(v, refV) }); // raw.speeds = rota adımlarından dilim hızları
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
  // refV: dilim hız düzeltmelerinin referansı (null = tüm geçmişin ortalaması). Bu hızda ölçüm yoksa ama geçmiş varsa ortalama kullanılır.
  const all = hist == null ? overall() : null;
  const histAll = all && all.km >= 40 ? Math.min(1.6, Math.max(0.7, all.kBase / PHYSICS.consScale)) : null;
  if (hist != null && live != null) return { k: 0.5 * hist + 0.5 * live, src: `geçmiş (${Math.round(h.km)} km) + canlı`, v, refV: v };
  if (hist != null) return { k: hist, src: `geçmiş ölçüm (~${Math.round(v)} km/s civarı, ${Math.round(h.km)} km)`, v, refV: v };
  if (histAll != null) return { k: live != null ? 0.5 * histAll + 0.5 * live : histAll, src: `geçmiş ortalama (${Math.round(all.km)} km) + hıza göre düzeltme`, v, refV: null };
  return { k: eng.k, src: eng.k !== 1 ? 'canlı kalibrasyon' : 'kalibre değil (model varsayımı)', v, refV: null };
}

/** Mevcut profil/istasyonlarla planı (yeniden) hesapla. fromKm/soc verilirse o konumdan (dinamik yeniden planlama). */
export function computePlan({ fromKm = 0, soc = startSoc, maxFirstStopKm = Infinity, pins = null, onlyIds = null } = {}) { // pins: { pinIds, banIds } denemesi (kaydetmeden); onlyIds: yalnızca bu istasyonlarla planla
  const plan = getState('plan');
  const r = getState('route');
  if (!plan.profile) return null;
  const kInfo = planK();
  const k = kInfo.k;
  const all = plan.stations;
  const stations = onlyIds ? all.filter((s) => onlyIds.includes(s.id)) : all;
  // Zorunlu ilk durak yalnızca hâlâ ilerideyse geçerlidir (geçildiyse veya listede yoksa yok sayılır)
  const forced = plan.forceFirstId && stations.some((s) => s.id === plan.forceFirstId && s.km > fromKm + 0.5) ? plan.forceFirstId : null;
  const result = planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: plan.mode, k, maxFirstStopKm, forceFirstId: forced,
    mustIds: (pins?.pinIds ?? plan.pinIds ?? []).filter((id) => stations.some((s) => s.id === id && s.km > fromKm + 0.5)), // kullanıcının seçtiği duraklar; geçilmiş olanlar yok sayılır
    excludeIds: pins?.banIds ?? plan.banIds ?? [],
  });
  const ranking = rankStations({ profile: plan.profile, stations: all, startKm: fromKm, startSoc: soc, k, mode: plan.mode });
  return { result, ranking, kInfo };
}

function applyPlan(out, extra = {}) {
  if (!out) return;
  const { result, ranking, kInfo } = out;
  patch('plan', {
    ...extra,
    kInfo,
    status: result.feasible ? 'ready' : 'infeasible',
    text: result.feasible ? '' : result.reason + (PLANNER.minKw > PLANNER.baseKw ? ' ' + tpl('En az şarj gücü filtresi {0} kW: düşürmeyi (AC) dene.', PLANNER.minKw) : ''),
    stops: result.stops,
    totals: result.totals || null,
    ranking,
  });
  const pl = getState('plan');
  const from = (pl.fromKm ?? 0) - 0.3;
  const planned = new Set(result.stops.map((x) => x.station.id));
  mapApi.drawStations(pl.stations.filter((s) => s.km > from && shown(s, planned)), result.stops); // geride kalan istasyonlar haritadan da çıkar
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
  } catch (err) {
    console.error(err);
    patch('plan', { status: 'error', text: err.message });
  }
}

/** Rotanın ara noktaları: önce (varsa) navigasyonda seçilen şarj istasyonu, sonra kullanıcının ara durağı. */
export const tripWaypoints = (stopover, station) => [station, stopover].filter(Boolean);

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
  if (e.soc == null) { // ne kamera okudu ne de elle girildi: "Mevcut pil" sürgüsünün gösterdiği %80 elle girilmiş sayılır; plan, HUD ve navigasyon aynı değeri kullanır
    setManual(80, { guess: true });
    toast('Pil bilinmiyor: %80 kabul edildi, Mevcut pil sürgüsünden değiştirebilirsin');
  }
  const prev = { ...getState('plan') }; // internet yoksa/rota alınamazsa mevcut (kayıtlı) plan bozulmasın
  const resumeSim = !!from && getState('sim').enabled && getState('sim').play; // yeniden rota (kritik pil, rotadan çıkış): simülasyon oynuyorsa yeni rota kurulunca devam eder
  const restoreSim = () => { if (resumeSim && getState('sim').enabled) patch('sim', { play: true }); };

  try {
    patch('plan', { status: 'loading', text: 'Rota alınıyor…', stops: [], totals: null, ranking: [], fromKm: 0, fromSoc: null, pinIds: [], banIds: [] }); // yeni rota: elle değiştirilen duraklar sıfırlanır
    patch('sim', { routeKm: 0, lat: from?.lat ?? null, lon: from?.lon ?? null, play: false }); // simüle araç yeni rotanın başına (yeniden rotada bulunduğu yere)
    const tm = [Date.now()]; const rt = await fetchRoute(start, end, tripWaypoints(route.via, via)); tm.push(Date.now()); // tm: aşama zamanları (yavaşlık tanısı)
    if (rt.note) toast(rt.note, 7000);
    const pts = resampleRoute(rt.coords);
    // Hız rota adımlarından: dilim başına serbest akış hızı (yol limiti/sınıfı) ve trafik çarpanı. Elle ayar yok.
    const speeds = segmentSpeeds(rt, pts);
    patch('route', {
      trafficInfo: { ratio: rt.trafficRatio, driveMin: rt.durationH * 60, freeMin: (rt.durationH * 60) / rt.trafficRatio, avgFreeKmh: speeds.avgFreeKmh, live: !!rt.live, jamKm: rt.intervals.reduce((a, iv) => a + (iv.to - iv.from), 0), slowKm: (rt.trafficSpans || []).reduce((a, s) => a + (s.to - s.from), 0) },
      cruise: Math.round(speeds.avgFreeKmh), // gösterim ve eco-hız üst sınırı için ortalama serbest hız
      traffic: densityFromRatio(rt.trafficRatio), // rota genelinde yoğunluk (planK hız bandı için)
    });
    mapApi.drawRoute(rt.coords, { fit: !from, traffic: rt.trafficSpans || null });
    if (from && !getState('sim').enabled) mapApi.setPoint('start', from, { fit: false }); // sürüş simülasyonunda A rota başlangıcında sabit kalır

    if (from) {
      // Yeniden rota (navigasyon): rota, adımlar ve plan hemen kurulur; rakım ve hava arkadan gelir. Navigasyon beklemeden devam eder.
      raw = { pts, elevations: null, elevSource: null, speeds: speeds.segs, wx: [] };
      sig = routeSig();
      const quick = buildFromRaw();
      const cur = getState('plan');
      const keptQ = reproject([...cur.stations, ...extra.filter((x) => !cur.stations.some((s) => s.id === x.id))], quick);
      patch('plan', { route: rt, profile: quick, steps: projectSteps(rt.steps, quick), planId: Date.now(), wxInfo: { source: null, fallbackReason: null, error: null }, forceFirstId: via?.id ?? null, lastStopKm: null, stations: keptQ, stationInfo: cur.stationInfo, text: '' });
      if (!keptQ.length) {
        cacheKey = [start, end].map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('>');
        await loadStations(pts, quick);
      }
      applyPlan(computePlan(), { startSoc });
      enrichRoute(pts, speeds, getState('plan').planId); // beklenmez
      restoreSim();
      return true;
    }

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
    tm.push(Date.now()); const profile = buildFromRaw();
    const pool = from ? [...getState('plan').stations, ...extra.filter((x) => !getState('plan').stations.some((s) => s.id === x.id))] : [];
    const kept = from ? reproject(pool, profile) : [];
    patch('plan', { route: rt, profile, steps: projectSteps(rt.steps, profile), planId: Date.now(), wxInfo: { source: wxRes?.source ?? null, fallbackReason: wxRes?.fallbackReason ?? null, error: wxError }, forceFirstId: via?.id ?? null, lastStopKm: null, stations: kept, stationInfo: from ? getState('plan').stationInfo : null, text: 'Şarj istasyonları aranıyor…' });

    if (!kept.length) {
      cacheKey = [start, end].map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('>');
      await loadStations(pts, profile); tm.push(Date.now());
    }
    applyPlan(computePlan(), { startSoc });
    rememberDest(end); planTiming(tm);
    return true;
  } catch (err) {
    console.error(err);
    restoreSim();
    if (prev.profile && prev.status !== 'loading') {
      patch('plan', { ...prev }); // eski plan ve istasyonlar geri gelir
      mapApi.drawStations(prev.stations.filter((s) => s.km > (prev.fromKm ?? 0) - 0.3 && shown(s, new Set(prev.stops.map((x) => x.station.id)))), prev.stops);
      toast('Yeni rota alınamadı, mevcut plan korundu: ' + err.message, 5000);
    } else {
      patch('plan', { status: 'error', text: err.message });
      toast('Plan hatası: ' + err.message, 4000);
    }
    return false;
  }
}

/** Yeniden rotanın rakım ve hava verisi (arka plan): gelince profil yenilenir ve plan ağsız yeniden hesaplanır. */
async function enrichRoute(pts, speeds, planId) {
  try {
    const wxIdx = pts.map((_, i) => i).filter((i) => i % (WX_STEP_KM / 2) === 0);
    if (wxIdx.at(-1) !== pts.length - 1) wxIdx.push(pts.length - 1);
    const wxPts = wxIdx.map((i) => pts[i]);
    const t0 = Date.now();
    let wxError = null;
    const [elev, wxRes] = await Promise.all([
      fetchElevations(pts).catch(() => null),
      fetchWeather(wxIdx.map((i) => ({ lat: pts[i].lat, lon: pts[i].lon, t: t0 + speeds.cumH[i] * 3600e3 }))).catch((err) => { wxError = err.message; return null; }),
    ]);
    if (getState('plan').planId !== planId) return; // araya yeni bir rota girdi
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
    patch('plan', { profile: buildFromRaw(), wxInfo: { source: wxRes?.source ?? null, fallbackReason: wxRes?.fallbackReason ?? null, error: wxError } });
    const pl = getState('plan');
    applyPlan(computePlan({ fromKm: pl.fromKm ?? 0, soc: pl.fromSoc ?? startSoc }));
  } catch (err) {
    console.warn('Yeniden rota verisi tamamlanamadı:', err.message);
  }
}

/**
 * Yolda: önümüzdeki rota için güncel hava (wx: [{ km, ...hava }]) ve/veya trafikli rota (rt: bulunulan konumdan varışa) alındı.
 * Ham veri güncellenir, profil yeniden kurulur (enerji ve süre buna göre değişir), plan ağsız yeniden hesaplanır. Plan o sırada kurulamazsa
 * eski plan korunur. Dönüş: profil güncellendi mi. planId: istek sırasında rota değiştiyse yok sayılır.
 */
export function updateAhead({ km, wx = null, rt = null, planId = null }) {
  const plan = getState('plan');
  if (!raw || !plan.profile || plan.status === 'loading' || plan.status === 'error') return false;
  if (planId != null && plan.planId !== planId) return false;
  const next = { ...raw };
  let changed = false;
  if (wx?.length) { next.wx = mergeWx(raw.wx, km, wx); changed = true; }
  if (rt) {
    const m = mergeSpeeds({ pts: raw.pts, speeds: raw.speeds, km, rt });
    if (m) { next.speeds = m.speeds; changed = true; }
  }
  if (!changed) return false;
  raw = next;
  patch('plan', { profile: buildFromRaw() });
  const pl = getState('plan');
  const out = computePlan({ fromKm: pl.fromKm ?? 0, soc: pl.fromSoc ?? startSoc });
  if (out && (out.result.feasible || pl.status !== 'ready')) applyPlan(out); // yeni veriyle plan kurulamıyorsa eski plan kalır
  return true;
}

/** Mevcut pil elle değişti (Rota sayfası sürgüsü): başlangıç pilini güncelle ve açık planı ağsız yeniden hesapla. */
export function setStartSoc(soc) {
  startSoc = soc;
  const plan = getState('plan');
  if (!raw || plan.status === 'loading' || plan.fromSoc != null) return; // yeniden rota planı kendi pilini taşır
  refresh();
}

/** Navigasyon: rotadan çıkıldı, bulunduğun konumdan varışa yeniden rota kur. Dönüş: yeni rota kuruldu mu (söz). */
export async function rerouteFromHere() {
  const e = effective();
  if (e.lat == null || getState('plan').status === 'loading') return false;
  return planTrip({ lat: e.lat, lon: e.lon, label: 'Konumum' });
}

/**
 * Plandaki bir durağı başka istasyonla değiştir: yeni istasyon zorunlu, eski istasyon dışlanır; plan yeniden hesaplanır.
 * Kurulamazsa eski plan korunur. Dönüş: { ok, reason }.
 */
export function swapStop(oldId, newId) {
  const plan = getState('plan');
  if (!plan.profile) return { ok: false, reason: 'Rota yok' };
  const prev = { pinIds: plan.pinIds || [], banIds: plan.banIds || [] };
  const next = {
    pinIds: [...prev.pinIds.filter((id) => id !== oldId && id !== newId), newId],
    banIds: [...new Set([...prev.banIds.filter((id) => id !== newId), oldId])],
  };
  const fromKm = plan.fromKm ?? 0;
  const soc = plan.fromSoc ?? startSoc;
  // 1) Yalnızca bu durak değişir: öbür duraklar aynı kalır; yeni istasyon eskisinin yerine geçer, şarj miktarı, süre ve maliyet yeniden hesaplanır
  const chain = (plan.stops || []).filter((s) => s.km > fromKm + 0.5 && s.station.id !== oldId).map((s) => s.station.id);
  let out = computePlan({ fromKm, soc, pins: { pinIds: [...chain, newId], banIds: next.banIds }, onlyIds: [...chain, newId] });
  let reflowed = false;
  if (!out?.result.feasible) { // 2) Öbür duraklarla zincir kurulamıyor (örn. yeni istasyon çok geride): yeni istasyon zorunlu, diğer duraklar yeniden düzenlenir
    out = computePlan({ fromKm, soc, pins: next });
    reflowed = true;
  }
  if (!out?.result.feasible) return { ok: false, reason: out?.result.reason || 'Plan kurulamadı' };
  applyPlan(out, next);
  return { ok: true, reflowed };
}

/**
 * Rotadaki bir istasyonda şarj et: istasyon zorunlu durak olur (kullanıcının seçimi), plan yeniden hesaplanır; otomatik seçilen duraklardan
 * gerekmeyenler planlayıcı tarafından çıkarılır. Kurulamazsa eski plan korunur. Dönüş: { ok, reason, dropped: [ad] }.
 */
export function addStop(newId) {
  const plan = getState('plan');
  if (!plan.profile) return { ok: false, reason: 'Rota yok' };
  const fromKm = plan.fromKm ?? 0;
  const next = {
    pinIds: [...new Set([...(plan.pinIds || []), newId])],
    banIds: (plan.banIds || []).filter((id) => id !== newId),
  };
  const out = computePlan({ fromKm, soc: plan.fromSoc ?? startSoc, pins: next });
  if (!out?.result.feasible) return { ok: false, reason: out?.result.reason || 'Plan kurulamadı', dropped: [] };
  const now = new Set(out.result.stops.map((s) => s.station.id));
  const dropped = (plan.stops || []).filter((s) => s.km > fromKm + 0.5 && !now.has(s.station.id)).map((s) => s.station.name);
  applyPlan(out, next);
  return { ok: true, dropped };
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

// Eski rota açılışta geri yüklenmez; önceki varışlar ui/recentDest.js içinde "Son hedefler" olarak tutulur.
const TRIP_KEY = 'trip'; // eski sürümlerin kaydı: açılışta silinir

export function initRouteController() {
  kvDel(TRIP_KEY); // eski sürümlerin kayıtlı rotası
  let lastMode = getState('plan').mode;
  subscribe('plan', (p) => {
    if (p.mode !== lastMode) { lastMode = p.mode; refresh(); }
  });
  subscribe(['route', 'hist'], () => {
    if (routeSig() === sig) return;
    clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  });
}
