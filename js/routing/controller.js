import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { kvDel } from '../utils/idb.js';
import { fetchRoute, fetchChargers, fetchElevations, fetchWeather, probeStopAccess } from '../providers/index.js';
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
import { stopWaypoints, offRouteKm } from './stopVia.js';
import { createAccessBook, applyAccess, verifyStops, lineKm, locateOnLine } from './stopAccess.js';

const WX_STEP_KM = 50;
let raw = null; // { pts, elevations, elevSource, wx } — profil ayarları değişince yeniden kurmak için
let startSoc = 80;
let sig = '';
let cacheKey = null;
let timer = null;
const accessBook = createAccessBook(); // şarj durağı yol ağı erişim sonuçları (istasyon × gidiş yönü); yeni yolculukta temizlenir
const ACCESS_ROUNDS = 4; // erişilemeyen durak elenince yeni seçilen durak(lar) da doğrulanır: en çok bu kadar tur
let accessRun = null; // { key, p }: aynı plan için tek erişim denetimi; yeni planlama/rota eskisini yeniden kullanmaz
let tripSeq = 0; // her planTrip yeni nesil: eski neslin geç gelen yanıtları (rota, istasyon, erişim, durak üzerinden rota) planı/haritayı yazmaz
let lastGood = null; // planlama sürerken yeni bir planlama başlarsa geri dönülecek son tutarlı durum
let lineCache = { coords: null, cum: null, head: new Map() };

/** Rotanın istasyondaki gidiş yönü (tam çözünürlüklü çizgiden; rota değişince yeniden hesaplanır). */
function headingAt(s) {
  const coords = getState('plan').route?.coords;
  if (!coords) return null;
  if (lineCache.coords !== coords) lineCache = { coords, cum: lineKm(coords), head: new Map() };
  const key = `${s.id}@${Math.round(s.km ?? -1)}`;
  if (!lineCache.head.has(key)) lineCache.head.set(key, locateOnLine(coords, lineCache.cum, s, Number.isFinite(s.km) ? s.km : null, 8)?.heading ?? null);
  return lineCache.head.get(key);
}

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
export function computePlan({ fromKm = 0, soc = startSoc, maxFirstStopKm = Infinity, pins = null, onlyIds = null, mode = null, rank = true } = {}) { // pins: { pinIds, banIds } denemesi (kaydetmeden); onlyIds: yalnızca bu istasyonlarla planla
  const plan = getState('plan');
  const r = getState('route');
  if (!plan.profile) return null;
  const kInfo = planK();
  const k = kInfo.k;
  // Yol ağıyla doğrulanmış sapma maliyete girer; erişilemeyen (karşı yön) istasyon aday olmaz (kullanıcının elle seçtiği hariç)
  const keep = new Set([...(pins?.pinIds ?? plan.pinIds ?? []), plan.forceFirstId].filter(Boolean));
  const acc = applyAccess(plan.stations, accessBook, headingAt, keep);
  const all = acc.stations;
  const stations = onlyIds ? all.filter((s) => onlyIds.includes(s.id)) : all;
  // Zorunlu ilk durak yalnızca hâlâ ilerideyse geçerlidir (geçildiyse veya listede yoksa yok sayılır)
  const forced = plan.forceFirstId && stations.some((s) => s.id === plan.forceFirstId && s.km > fromKm + 0.5) ? plan.forceFirstId : null;
  const result = planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: mode || plan.mode, k, maxFirstStopKm, forceFirstId: forced,
    mustIds: (pins?.pinIds ?? plan.pinIds ?? []).filter((id) => stations.some((s) => s.id === id && s.km > fromKm + 0.5)), // kullanıcının seçtiği duraklar; geçilmiş olanlar yok sayılır
    excludeIds: [...(pins?.banIds ?? plan.banIds ?? []), ...acc.blocked],
  });
  const ranking = rank ? rankStations({ profile: plan.profile, stations: all, startKm: fromKm, startSoc: soc, k, mode: plan.mode }) : [];
  return { result, ranking, kInfo, maxFirstStopKm };
}

/**
 * Rota seçenekleri karşılaştırması için her planlayıcı modunda (Hızlı / Ekonomik / Optimum) planı ağsız kurar; mevcut planı değiştirmez.
 * Aynı başlangıç km/pil, ilk durak sınırı (dinamik fallback'in maxFirstStopKm'i), elle seçilen duraklar ve filtrelerle. Dönüş: { fast, cheap, opt } planRoute sonuçları ya da plan yoksa null.
 */
export function routeOptionPlans(modes = ['fast', 'cheap', 'opt']) {
  const p = getState('plan');
  if (!p.profile || p.status !== 'ready') return null;
  const out = {};
  for (const m of modes) out[m] = computePlan({ fromKm: p.fromKm ?? 0, soc: p.fromSoc ?? startSoc, maxFirstStopKm: p.maxFirstStopKm ?? Infinity, mode: m, rank: false })?.result ?? null;
  return out;
}

function applyPlan(out, extra = {}) {
  if (!out) return;
  const { result, ranking, kInfo } = out;
  patch('plan', {
    ...extra,
    kInfo,
    maxFirstStopKm: Number.isFinite(out.maxFirstStopKm) ? out.maxFirstStopKm : null, // mevcut planı kuran ilk durak sınırı (rota seçenekleri aynısını kullanır)
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
  if (result.feasible && result.stops.some((x) => !x.station.access?.verified && x.km > (pl.fromKm ?? 0) + 0.5)) verifyStopAccess(); // beklenmez: elle değişiklik/mod sonrası yeni durak
}

/**
 * Plandaki ileri şarj duraklarını YOL AĞIYLA doğrula (düz çizgi yakınlığı erişim kanıtı değildir). Bölünmüş otoyolda karşı yönün tesisi
 * rota çizgisine yakın görünür ama ancak sonraki kavşaktan dönülerek ulaşılır: sapma orantısızsa istasyon elenir ve plan yeniden kurulur;
 * erişilebilirse gerçek sapma maliyete girer. Yeni seçilen durak(lar) da doğrulanır (en çok ACCESS_ROUNDS tur). Sorgu başarısızsa plan
 * korunur ve kullanıcı uyarılır (durak "doğrulanmadı" kalır). Aynı anda tek çalışma.
 */
export function verifyStopAccess() {
  const key = `${tripSeq}:${getState('plan').planId}`; // başka plan için süren (eski) çalışma yeni planı doğrulamaz: yenisi başlar, eskisi kendiliğinden bırakır
  if (accessRun?.key === key) return accessRun.p;
  const run = { key, p: null };
  accessRun = run;
  run.p = runAccess().catch((err) => console.warn('Durak erişim denetimi:', err.message)).finally(() => { if (accessRun === run) accessRun = null; });
  return run.p;
}

async function runAccess() {
  const seq = tripSeq;
  const failedNames = new Set();
  let removed = [];
  for (let round = 0; round < ACCESS_ROUNDS; round++) {
    const pl = getState('plan');
    if (pl.status !== 'ready' || !pl.profile || !pl.route?.coords) return;
    const fromKm = pl.fromKm ?? 0;
    const res = await verifyStops({ coords: pl.route.coords, stops: pl.stops, fromKm, book: accessBook, probe: probeStopAccess });
    if (seq !== tripSeq || getState('plan').planId !== pl.planId) return; // araya yeni planlama/rota girdi
    res.failed.forEach((s) => failedNames.add(s.name));
    if (!res.checked) break;
    removed = [...removed, ...res.rejected.map((s) => s.name)];
    const out = computePlan({ fromKm, soc: pl.fromSoc ?? startSoc, maxFirstStopKm: pl.maxFirstStopKm ?? Infinity });
    if (!out) return;
    applyPlan(out);
    if (!out.result.feasible) break;
  }
  if (removed.length) toast(tpl('Karşı yönde/erişilemeyen şarj tesisi plandan çıkarıldı: {0}', [...new Set(removed)].join(', ')), 7000);
  if (failedNames.size) toast(tpl('Şarj durağına yol ağıyla erişim doğrulanamadı ({0}); tesis karşı yönde olabilir.', [...failedNames].join(', ')), 7000);
}

/** İstasyonları getir ve plan durumuna yaz; hata/önbellek bilgisi İstasyon sekmesinde kalıcı gösterilir. */
async function loadStations(pts, profile, stale = () => false) {
  const { stations, errors, cached, summary } = await fetchChargers(pts, profile, cacheKey);
  if (stale()) return; // araya yeni planlama girdi: eski rotanın istasyonları yeni planı ezmez
  if (errors.length) toast(errors.join(' · '), 7000);
  if (cached) toast('İstasyonlar önbellekten alındı');
  patch('plan', { stations, stationInfo: { errors, cached, summary } });
}

/** İstasyon sekmesindeki "Yeniden ara": rota/profil aynı kalır, yalnızca istasyon sorgusu tekrarlanır. */
export async function refetchStations() {
  const plan = getState('plan');
  if (!raw || !plan.profile || plan.status === 'loading') return;
  patch('plan', { status: 'loading', text: 'Şarj istasyonları aranıyor…' });
  const seq = tripSeq;
  try {
    await loadStations(raw.pts, plan.profile, () => seq !== tripSeq);
    if (seq !== tripSeq) return;
    const p = getState('plan');
    applyPlan(computePlan({ fromKm: p.fromKm ?? 0, soc: p.fromSoc ?? startSoc }));
  } catch (err) {
    console.error(err);
    if (seq === tripSeq) patch('plan', { status: 'error', text: err.message });
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
  // Yeni nesil: önceki planlamanın (ve onun arka plan adımlarının) geç gelen sonuçları bundan sonra yok sayılır
  const seq = ++tripSeq;
  const stale = () => seq !== tripSeq;
  // İnternet yoksa/rota alınamazsa mevcut (kayıtlı) plan bozulmasın. Planlama sürerken yenisi başladıysa son tutarlı durum geri gelir.
  const cur = getState('plan');
  const prev = cur.status === 'loading' && lastGood ? lastGood
    : { plan: { ...cur }, route: { trafficInfo: route.trafficInfo, cruise: route.cruise, traffic: route.traffic }, raw, sig };
  lastGood = prev;
  const resumeSim = !!from && getState('sim').enabled && getState('sim').play; // yeniden rota (kritik pil, rotadan çıkış): simülasyon oynuyorsa yeni rota kurulunca devam eder
  const restoreSim = () => { if (resumeSim && getState('sim').enabled) patch('sim', { play: true }); };

  try {
    patch('plan', { status: 'loading', text: 'Rota alınıyor…', stops: [], totals: null, ranking: [], fromKm: 0, fromSoc: null, pinIds: [], banIds: [] }); // yeni rota: elle değiştirilen duraklar sıfırlanır
    if (!from) {
      accessBook.clear(); // yeni yolculuk: erişim sonuçları sıfırdan (yeniden rotada aynı yöndeki sonuçlar geçerli kalır)
      mapApi.drawStations([], []); // önceki rotanın durak/istasyon işaretleri yeni plan gelene kadar haritada kalmaz
    }
    patch('sim', { routeKm: 0, lat: from?.lat ?? null, lon: from?.lon ?? null, play: false }); // simüle araç yeni rotanın başına (yeniden rotada bulunduğu yere)
    const tm = [Date.now()]; const rt = await fetchRoute(start, end, tripWaypoints(route.via, via)); tm.push(Date.now()); // tm: aşama zamanları (yavaşlık tanısı)
    if (stale()) return false; // araya yeni planlama girdi: bu rota çizilmez
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
        await loadStations(pts, quick, stale);
        if (stale()) return false;
      }
      applyPlan(computePlan(), { startSoc });
      await verifyStopAccess(); // karşı yöndeki tesis durak olmasın (yol ağı)
      if (stale()) return false;
      const via2 = await routeThroughStops(start, end, { elev: false }); // otoyol dışı durak: rota onun üzerinden (rakım/hava yine arkadan)
      if (stale()) return false;
      enrichRoute(via2?.pts ?? pts, via2?.speeds ?? speeds, getState('plan').planId); // beklenmez
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
    if (stale()) return false;
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
      await loadStations(pts, profile, stale); tm.push(Date.now());
      if (stale()) return false;
    }
    applyPlan(computePlan(), { startSoc });
    await verifyStopAccess(); // karşı yöndeki tesis durak olmasın (yol ağı)
    if (stale()) return false;
    await routeThroughStops(start, end);
    if (stale()) return false;
    rememberDest(end); planTiming(tm);
    return true;
  } catch (err) {
    console.error(err);
    if (stale()) return false; // eski planlamanın geç gelen hatası: yeni planı bozmaz, uyarı gösterilmez
    restoreSim();
    const old = prev.plan;
    if (old.profile && old.status !== 'loading') {
      // Eski plan, istasyonlar, harita çizgisi, rota özeti ve ham veri birlikte geri gelir (ağsız yeniden hesap eski rotayla tutarlı kalır)
      raw = prev.raw; sig = prev.sig;
      patch('route', prev.route);
      patch('plan', { ...old });
      if (old.route?.coords) mapApi.drawRoute(old.route.coords, { fit: false, traffic: old.route.trafficSpans || null });
      mapApi.drawStations(old.stations.filter((s) => s.km > (old.fromKm ?? 0) - 0.3 && shown(s, new Set(old.stops.map((x) => x.station.id)))), old.stops);
      toast('Yeni rota alınamadı, mevcut plan korundu: ' + err.message, 5000);
    } else {
      // Geri dönülecek plan yok: yarım kalan rota/profil plandan ve haritadan kalkar, hata metni Rota sayfasında kalır
      raw = null; sig = '';
      patch('plan', { status: 'error', text: err.message, route: null, profile: null, steps: [], stations: [], stationInfo: null, stops: [], totals: null, planId: null });
      mapApi.clearRoute(); // rota çizgisi ve istasyon işaretleri
      toast('Plan hatası: ' + err.message, 4000);
    }
    return false;
  } finally {
    if (!stale()) lastGood = null;
  }
}

/**
 * Plandaki şarj durakları rota sağlayıcısına ara nokta olarak gitmez (planlayıcı onları 3 km'lik koridordan seçer, sapmayı yalnızca
 * enerji/süre olarak sayar). Bir durak çizimdeki rotadan VIA_OFF_KM'den uzaksa (otoyoldan çıkmak gerekir) rota, ileri durakların hepsi
 * (ve kullanıcının ara durağı) ZORUNLU ara nokta olacak şekilde aynı sağlayıcı zinciriyle yeniden alınır; duraklar zorunlu (pinIds) olur ve
 * plan yeni rotada yeniden hesaplanır (sapma artık rota enerjisinde, ikinci kez sayılmaz). Yeni rota alınamaz ya da plan kurulamazsa
 * ilk plan aynen geri yüklenir ve kullanıcı uyarılır. Dönüş: { pts, speeds } (yeni rota) ya da null.
 */
async function routeThroughStops(start, end, { elev = true } = {}) {
  const pl = getState('plan');
  if (pl.status !== 'ready' || !pl.profile || !pl.route?.coords) return null;
  const stopover = getState('route').via || null;
  const wps = stopWaypoints({
    coords: pl.route.coords, stops: pl.stops, fromKm: pl.fromKm ?? 0,
    stopover, stopoverKm: stopover ? pl.profile.project(stopover.lat, stopover.lon).km : null,
  });
  if (!wps) return null;
  const seq = tripSeq;
  const gone = () => seq !== tripSeq || getState('plan').planId !== pl.planId; // araya yeni planlama/rota girdi
  const prev = { plan: { ...pl }, route: { ...getState('route') }, raw, sig };
  const restore = (msg) => {
    if (gone()) return null; // yeni planın üzerine eski plan geri yazılmaz
    raw = prev.raw; sig = prev.sig;
    patch('route', { trafficInfo: prev.route.trafficInfo, cruise: prev.route.cruise, traffic: prev.route.traffic });
    patch('plan', prev.plan);
    mapApi.drawStations(prev.plan.stations.filter((s) => s.km > (prev.plan.fromKm ?? 0) - 0.3 && shown(s, new Set(prev.plan.stops.map((x) => x.station.id)))), prev.plan.stops);
    toast(tpl('Rota şarj istasyonu üzerinden geçirilemedi ({0}); istasyon için otoyoldan ayrılmanız gerekebilir.', msg), 7000);
    return null;
  };
  try {
    const rt = await fetchRoute(start, end, wps);
    if (gone()) return null; // araya yeni bir rota girdi
    const pts = resampleRoute(rt.coords);
    const speeds = segmentSpeeds(rt, pts);
    const ev = elev ? await fetchElevations(pts).catch(() => null) : null;
    if (gone()) return null;
    patch('route', {
      trafficInfo: { ratio: rt.trafficRatio, driveMin: rt.durationH * 60, freeMin: (rt.durationH * 60) / rt.trafficRatio, avgFreeKmh: speeds.avgFreeKmh, live: !!rt.live, jamKm: rt.intervals.reduce((a, iv) => a + (iv.to - iv.from), 0), slowKm: (rt.trafficSpans || []).reduce((a, s) => a + (s.to - s.from), 0) },
      cruise: Math.round(speeds.avgFreeKmh),
      traffic: densityFromRatio(rt.trafficRatio),
    });
    raw = { ...raw, pts, speeds: speeds.segs, elevations: ev?.elevations ?? null, elevSource: ev?.source ?? null };
    sig = routeSig();
    const profile = buildFromRaw();
    const pinIds = [...new Set([...(pl.pinIds || []), ...pl.stops.filter((s) => s.km > (pl.fromKm ?? 0) + 0.5).map((s) => s.station.id)])];
    // Ara nokta olan durak artık rotanın üzerinde: sapması (offKm) 2 km örnekli profile göre değil tam çizgiye göre ölçülür; yoksa
    // sapma hem rota enerjisinde hem durak sapmasında iki kez sayılırdı.
    const pinSet = new Set(pinIds);
    const stations = reproject(pl.stations, profile).map((s) => (pinSet.has(s.id) ? { ...s, offKm: Math.min(s.offKm, offRouteKm(rt.coords, s)) } : s));
    patch('plan', { route: rt, profile, steps: projectSteps(rt.steps, profile), planId: Date.now(), stations, pinIds });
    const out = computePlan({ fromKm: pl.fromKm ?? 0, soc: pl.fromSoc ?? startSoc });
    if (!out?.result.feasible) return restore(out?.result.reason || 'plan kurulamadı');
    applyPlan(out);
    mapApi.drawRoute(rt.coords, { fit: false, traffic: rt.trafficSpans || null });
    if (rt.note) toast(rt.note, 7000);
    return { pts, speeds };
  } catch (err) {
    console.warn('Durak üzerinden rota alınamadı:', err.message);
    return restore(err.message);
  }
}

/** Yeniden rotanın rakım ve hava verisi (arka plan): gelince profil yenilenir ve plan ağsız yeniden hesaplanır. */
async function enrichRoute(pts, speeds, planId) {
  const seq = tripSeq;
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
    if (seq !== tripSeq || getState('plan').planId !== planId) return; // araya yeni planlama/rota girdi
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
 * Plandaki bir şarj durağını rotadan kaldır: istasyon dışlanır (seçimi varsa kalkar), plan yeniden hesaplanır.
 * Önce öbür duraklar aynı kalacak şekilde denenir (durak gereksizse tamamen çıkar); olmazsa planlayıcı rota üzerinden alternatif seçer.
 * Kurulamazsa eski plan korunur. Dönüş: { ok, reason, added: [ad] } (added: yerine seçilen yeni duraklar).
 */
export function removeStop(oldId) {
  const plan = getState('plan');
  if (!plan.profile) return { ok: false, reason: 'Rota yok' };
  const fromKm = plan.fromKm ?? 0;
  const soc = plan.fromSoc ?? startSoc;
  const next = {
    pinIds: (plan.pinIds || []).filter((id) => id !== oldId),
    banIds: [...new Set([...(plan.banIds || []), oldId])],
  };
  const ahead = (plan.stops || []).filter((s) => s.km > fromKm + 0.5);
  const chain = ahead.filter((s) => s.station.id !== oldId).map((s) => s.station.id);
  // 1) Öbür duraklar aynı, bu durak hiç yok (boş zincir: şarjsız gidilebiliyorsa durak kalmaz)
  let out = computePlan({ fromKm, soc, pins: { pinIds: [...new Set([...next.pinIds, ...chain])], banIds: next.banIds }, onlyIds: chain });
  if (!out?.result.feasible) out = computePlan({ fromKm, soc, pins: next }); // 2) yerine rota üzerinden alternatif (öbür duraklar da yeniden düzenlenebilir)
  if (!out?.result.feasible) return { ok: false, reason: out?.result.reason || 'Plan kurulamadı', added: [] };
  const before = new Set(ahead.map((s) => s.station.id));
  const added = out.result.stops.filter((s) => !before.has(s.station.id)).map((s) => s.station.name);
  applyPlan(out, next);
  return { ok: true, added };
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

/** Navigasyon bitti ya da durduruldu: plan, rota çizgisi ve başlangıç/ara/varış işaretleri temizlenir (yeni rota için sıfırdan başlanır). */
export function clearTrip() {
  clearTimeout(timer);
  tripSeq++; // süren planlama/erişim denetimi temizlenen rotayı geri çizmez
  lastGood = null;
  accessRun = null;
  accessBook.clear();
  raw = null;
  sig = '';
  patch('plan', { status: 'none', text: '', route: null, profile: null, wxInfo: null, stations: [], stationInfo: null, stops: [], steps: [], pinIds: [], banIds: [], totals: null, planId: null, fromKm: 0, fromSoc: null });
  mapApi.clearRoute();
  for (const k of ['start', 'via', 'end']) mapApi.setPoint(k, null, { fit: false });
}
