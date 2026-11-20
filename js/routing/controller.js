import { getState, patch, subscribe, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { kvDel } from '../utils/idb.js';
import { fetchRoute, fetchChargers, fetchElevations, fetchWeather, probeStopAccess } from '../providers/index.js';
import { keepLastGood, reprice, reproject } from './chargerSource.js';
import { planRoute, rankStations, shown } from './planner.js';
import { resampleRoute, buildProfile } from '../physics/routeProfile.js';
import { densityFromRatio, speedFactor } from '../physics/traffic.js';
import { segmentSpeeds } from '../physics/routeSpeed.js';
import { mergeSpeeds, mergeWx } from './aheadUpdate.js';
import { kForSpeed, relFactor, overall } from '../physics/history.js';
import { PHYSICS, PLANNER, VEHICLE } from '../config.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { setManual } from '../physics/socEstimate.js';
import { rememberDest } from '../ui/recentDest.js';
import { projectSteps } from '../nav/steps.js';
import { t as tpl } from '../i18n/index.js';
import { stopWaypoints, offRouteKm, viaCheck, VIA_REACH_KM } from './stopVia.js';
import { createAccessBook, applyAccess, verifyStops, lineKm, locateOnLine, travelDir } from './stopAccess.js';
import { splitByRoute, altCandidates, buildAlternatives, consentFlow, autoExclude, ACCESS_PENDING_TEXT, ACCESS_FAILED_TEXT } from './onRoute.js';
import { askRouteChoice } from '../ui/routeChoice.js';
import { sanitizeLeaveSocs, planDiff, targetBounds } from './stopTarget.js';
import { remainingTotals, expectedSoc } from './socReplan.js';
import { addEligibility, stationAt, lockedAhead, addVias, startUturn, judgeAddRoute, PREVIEW_TTL_MS, GPS_MAX_ACC_M, GPS_MAX_OFF_KM } from './addToRoute.js';
import { slotKind, isFresh } from './slots.js';

const WX_STEP_KM = 50;
let raw = null; // { pts, elevations, elevSource, wx } — profil ayarları değişince yeniden kurmak için
let startSoc = 80;
let sig = '';
let cacheKey = null;
let stationsCtl = null; // süren istasyon aramasının iptali: yeni planlama başlayınca önceki ücretli Google araması durdurulur
let timer = null;
const accessBook = createAccessBook(); // şarj durağı yol ağı erişim sonuçları (istasyon × gidiş yönü); yeni yolculukta temizlenir
const ACCESS_ROUNDS = 4; // erişilemeyen durak elenince yeni seçilen durak(lar) da doğrulanır: en çok bu kadar tur
let accessRun = null; // { key, p }: aynı plan için tek erişim denetimi; yeni planlama/rota eskisini yeniden kullanmaz
let tripSeq = 0; // her planTrip yeni nesil: eski neslin geç gelen yanıtları (rota, istasyon, erişim, durak üzerinden rota) planı/haritayı yazmaz
let lastGood = null; // planlama sürerken yeni bir planlama başlarsa geri dönülecek son tutarlı durum
let lineCache = { coords: null, cum: null, head: new Map() };
let offerRun = null; // { key, p }: rota dışı seçenek onayı (aynı plan için tek soru; İptal edilen plan için yeniden sorulmaz)
const offerDone = new Set(); // sorulmuş plan anahtarları (tripSeq:planId)
let lastPlanId = 0;
/** v0.99.107: plan kimliği tekdüze artar (aynı milisaniyede iki rota — ör. ara nokta rotası — aynı kimliği alıp eski/yeni ayrımını bozmasın). */
const newPlanId = () => (lastPlanId = Math.max(Date.now(), lastPlanId + 1));

/** Rotanın istasyondaki gidiş yönü (tam çözünürlüklü çizgiden; rota değişince yeniden hesaplanır). */
function headingAt(s, coords = getState('plan').route?.coords) { // v0.99.108 coords: önizleme rotası (durum değişmeden)
  if (!coords) return null;
  if (lineCache.coords !== coords) lineCache = { coords, cum: lineKm(coords), head: new Map() };
  const at = locAt(s, coords);
  return at ? travelDir(coords, lineCache.cum, at.km) : null; // v0.99.107: erişim kaydıyla aynı anahtar (A → B gidiş yönü)
}

/** İstasyonun rota çizgisindeki izdüşümü (önbellekli; heading ve tam çizgiye düz çizgi uzaklığı). */
function locAt(s, coords) {
  if (lineCache.coords !== coords) lineCache = { coords, cum: lineKm(coords), head: new Map() };
  const key = `${s.id}@${Math.round(s.km ?? -1)}`;
  if (!lineCache.head.has(key)) lineCache.head.set(key, locateOnLine(coords, lineCache.cum, s, Number.isFinite(s.km) ? s.km : null, 8));
  return lineCache.head.get(key);
}

/**
 * İstasyonun AKTİF rota çizgisine (tam çözünürlük) düz çizgi uzaklığı (km). Yalnızca rota üstü ön elemesi içindir; erişim kanıtı değildir
 * (karşı yön/giriş yol ağıyla doğrulanır). Çizgi yoksa koridor uzaklığı (offKm) kullanılır.
 */
function lineOffKm(s, coords = getState('plan').route?.coords) {
  if (!coords || coords.length < 2) return Number.isFinite(s.geoOffKm) ? s.geoOffKm : s.offKm;
  return locAt(s, coords)?.offKm ?? null;
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
export function computePlan({ fromKm = 0, soc = startSoc, maxFirstStopKm = Infinity, pins = null, onlyIds = null, mode = null, rank = true, env = null } = {}) { // pins: { pinIds, banIds, leaveSocs } denemesi (kaydetmeden); onlyIds: yalnızca bu istasyonlarla planla
  // v0.99.108 env: { profile, stations, route } — durumu DEĞİŞTİRMEDEN başka bir rota üzerinde plan (Rotaya Ekle önizlemesi; uygulanınca aynı sonuç)
  const plan = env ? { ...getState('plan'), profile: env.profile, stations: env.stations, route: env.route, forceFirstId: null } : getState('plan');
  const coordsP = plan.route?.coords;
  const r = getState('route');
  if (!plan.profile) return null;
  const kInfo = planK();
  const k = kInfo.k;
  // Yol ağıyla doğrulanmış sapma maliyete girer; erişilemeyen (karşı yön) istasyon aday olmaz (kullanıcının elle seçtiği hariç)
  const keep = new Set([...(pins?.pinIds ?? plan.pinIds ?? []), plan.forceFirstId].filter(Boolean));
  const acc = applyAccess(plan.stations, accessBook, (s) => headingAt(s, coordsP), keep);
  // v0.99.107: erişim kapısı rotaya göredir; rota çizgisi yoksa (çevrimdışı önizleme/test) navigasyon da yoktur — applyPlan'daki
  // viaCheck çizgisiz her durağı tutarsız sayar ve navGate başlatmayı engeller.
  const hasLine = !!plan.route?.coords?.length;
  // v0.99.97: otomatik seçilen durak AKTİF ROTANIN ÜZERİNDE olmalı (onRoute.js). Rotadan ayrılmayı gerektiren ('off') ve karşı yön
  // ('blocked') istasyonlar otomatik seçilmez; rota değişikliği yalnızca kullanıcı onayıyla (offerAlternatives). Elle seçilenler (keep) kalır.
  const split = splitByRoute(acc.stations, (s) => lineOffKm(s, coordsP), keep);
  const all = acc.stations;
  const stations = onlyIds ? all.filter((s) => onlyIds.includes(s.id)) : all;
  // Zorunlu ilk durak yalnızca hâlâ ilerideyse geçerlidir (geçildiyse veya listede yoksa yok sayılır)
  const forced = plan.forceFirstId && stations.some((s) => s.id === plan.forceFirstId && s.km > fromKm + 0.5) ? plan.forceFirstId : null;
  // v0.99.98: kullanıcının durak şarj hedefleri yalnız zorunlu (elle kilitli) ve ilerideki duraklarda geçerlidir
  const mustNow = (pins?.pinIds ?? plan.pinIds ?? []).filter((id) => stations.some((s) => s.id === id && s.km > fromKm + 0.5));
  const leaveSocs = sanitizeLeaveSocs(pins?.leaveSocs ?? plan.leaveSocs, mustNow);
  const result = planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: mode || plan.mode, k, maxFirstStopKm, forceFirstId: forced,
    mustIds: (pins?.pinIds ?? plan.pinIds ?? []).filter((id) => stations.some((s) => s.id === id && s.km > fromKm + 0.5)), // kullanıcının seçtiği duraklar; geçilmiş olanlar yok sayılır
    excludeIds: [...(pins?.banIds ?? plan.banIds ?? []), ...acc.blocked, ...(hasLine ? autoExclude(split) : [...split.offIds, ...split.blockedIds])], leaveSocs, // v0.99.107: doğrulanmamış da otomatik seçilmez
  });
  // v0.99.107 Doğrulama ADAYI: doğrulanmamış istasyonlarla kurulabilecek plan. ASLA uygulanmaz; yalnızca hangi istasyonların yol ağıyla
  // sorgulanacağını belirler (runAccess). Doğrulananlar 'on' olunca kesin plana girebilir.
  const candidate = !result.feasible && split.unverifiedIds.length ? planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: mode || plan.mode, k, maxFirstStopKm, forceFirstId: forced,
    mustIds: (pins?.pinIds ?? plan.pinIds ?? []).filter((id) => stations.some((s) => s.id === id && s.km > fromKm + 0.5)),
    excludeIds: [...(pins?.banIds ?? plan.banIds ?? []), ...acc.blocked, ...split.offIds, ...split.blockedIds], leaveSocs,
  }) : null;
  // Rota üstünde zincir yoksa: rota dışı istasyonlarla (karşı yön hariç) kurulabilir miydi? Yalnızca onaylı seçenek sunmak için; uygulanmaz.
  const relaxed = !result.feasible && split.offIds.length ? planRoute({
    profile: plan.profile, stations, startKm: fromKm, startSoc: soc,
    minArrival: r.minArrivalSoc, mode: mode || plan.mode, k, maxFirstStopKm, forceFirstId: forced,
    mustIds: (pins?.pinIds ?? plan.pinIds ?? []).filter((id) => stations.some((s) => s.id === id && s.km > fromKm + 0.5)),
    excludeIds: [...(pins?.banIds ?? plan.banIds ?? []), ...acc.blocked, ...split.blockedIds, ...split.unverifiedIds], leaveSocs,
  }) : null;
  const ranking = rank ? rankStations({ profile: plan.profile, stations: all, startKm: fromKm, startSoc: soc, k, mode: plan.mode }) : [];
  return { result, ranking, kInfo, maxFirstStopKm, relaxed, candidate, offIds: split.offIds, unverifiedIds: split.unverifiedIds, routeStatus: split.status, fromKm, soc, k, planId: plan.planId };
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

let lastOut = null; // son uygulanan computePlan çıktısı (rota dışı seçenek onayı için: gevşek plan ve rota dışı kimlikler)

/** Rota üstünde zincir yok ama rota dışı istasyonla kurulabilir: kullanıcıya gösterilen açıklama. */
const OFF_ROUTE_TEXT = 'Aktif rota üzerinde uygun şarj durağı yok. Rotadan ayrılmayı gerektiren istasyonlar yalnızca onayınla rotaya eklenir.';

function applyPlan(out, extra = {}) {
  if (!out) return;
  const { result, ranking, kInfo } = out;
  lastOut = out;
  const offOnly = !result.feasible && !!out.relaxed?.feasible;
  // v0.99.107: kesin plan yok ama doğrulanmamış istasyonla kurulabilirdi → otomatik durak YOK; metin "doğrulanıyor" ya da "doğrulanamadı"
  const pend = !result.feasible && out.candidate?.feasible ? out.candidate.stops.filter((x) => (out.unverifiedIds || []).includes(x.station.id)) : [];
  const failedAcc = pend.filter((x) => x.station.access?.verified === false);
  const accText = pend.length ? (failedAcc.length ? tpl(ACCESS_FAILED_TEXT, failedAcc.map((x) => x.station.name).join(', ')) : tpl(ACCESS_PENDING_TEXT)) : '';
  const plan0 = getState('plan');
  const vc = viaCheck({ coords: plan0.route?.coords, stops: result.stops, fromKm: extra.fromKm ?? plan0.fromKm ?? 0, viaIds: plan0.viaIds || [], pinIds: (extra.pinIds ?? plan0.pinIds ?? []).filter((id) => !(plan0.viaIds || []).includes(id)) });
  patch('plan', {
    ...extra,
    kInfo,
    maxFirstStopKm: Number.isFinite(out.maxFirstStopKm) ? out.maxFirstStopKm : null, // mevcut planı kuran ilk durak sınırı (rota seçenekleri aynısını kullanır)
    status: result.feasible ? 'ready' : 'infeasible',
    offRouteOnly: offOnly, // rota dışı seçenek var (onay bekler)
    routeStatus: out.routeStatus || {}, // istasyon kimliği → 'on' | 'unverified' | 'off' | 'blocked' (Sonraki şarj işareti)
    accessPending: pend.length > 0 && !failedAcc.length, accessFailed: failedAcc.map((x) => x.station.name),
    viaIssues: result.feasible ? vc.issues : [], // v0.99.107: planda görünen durak rotada ziyaret edilmiyorsa (navGate başlatmayı engeller)
    text: result.feasible ? '' : accText || (offOnly ? tpl(OFF_ROUTE_TEXT) : result.reason) + (PLANNER.minKw > PLANNER.baseKw ? ' ' + tpl('En az şarj gücü filtresi {0} kW: düşürmeyi (AC) dene.', PLANNER.minKw) : ''),
    stops: result.stops,
    totals: result.totals || null,
    ranking,
  });
  const pl = getState('plan');
  const from = (pl.fromKm ?? 0) - 0.3;
  const planned = new Set(result.stops.map((x) => x.station.id));
  mapApi.drawStations(pl.stations.filter((s) => s.km > from && shown(s, planned)), result.stops); // geride kalan istasyonlar haritadan da çıkar
  const fromNow = (pl.fromKm ?? 0) + 0.5;
  const toCheck = [...result.stops, ...(out.candidate?.feasible ? out.candidate.stops : [])];
  if (toCheck.some((x) => x.km > fromNow && !x.station.access?.verified && accessBook.needs(x.station.id, headingAt(x.station) ?? 0))) verifyStopAccess(); // doğrulanmamış aday/elle seçilen durak
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
    if (pl.status === 'loading' || !pl.profile || !pl.route?.coords) return;
    const fromKm = pl.fromKm ?? 0;
    // v0.99.107: kesin plandaki duraklar + doğrulama adayının durakları (doğrulanmamış istasyon önce sorgulanır, sonra seçilebilir)
    const cand = lastOut?.planId === pl.planId && lastOut.candidate?.feasible ? lastOut.candidate.stops : [];
    const stops = [...pl.stops, ...cand.filter((c) => !pl.stops.some((x) => x.station.id === c.station.id))];
    const res = await verifyStops({ coords: pl.route.coords, stops, fromKm, book: accessBook, probe: probeStopAccess });
    if (seq !== tripSeq || getState('plan').planId !== pl.planId) return; // araya yeni planlama/rota girdi
    res.failed.forEach((s) => failedNames.add(s.name));
    if (!res.checked) break;
    removed = [...removed, ...res.rejected.map((s) => s.name)];
    const out = computePlan({ fromKm, soc: pl.fromSoc ?? startSoc, maxFirstStopKm: pl.maxFirstStopKm ?? Infinity });
    if (!out) return;
    applyPlan(out);
    if (!out.result.feasible && !out.candidate?.feasible) break; // v0.99.107: aday (doğrulanmamış) varsa sonraki turda o sorgulanır
  }
  if (removed.length) toast(tpl('Karşı yönde/erişilemeyen şarj tesisi plandan çıkarıldı: {0}', [...new Set(removed)].join(', ')), 7000);
  if (failedNames.size) toast(tpl('Şarj durağına yol ağıyla erişim doğrulanamadı ({0}); tesis karşı yönde olabilir.', [...failedNames].join(', ')), 7000);
  if (seq === tripSeq && getState('plan').status === 'infeasible' && getState('nav').active) offerAlternatives(); // yolda: erişilemeyen durak elendi, rota üstünde yedek yok (beklenmez)
}

/** İstasyonları getir ve plan durumuna yaz; hata/önbellek bilgisi İstasyon sekmesinde kalıcı gösterilir. */
async function loadStations(pts, profile, stale = () => false) {
  stationsCtl?.abort(); // önceki arama hâlâ sürüyorsa (yeni rota / yeniden ara) ücretli istekleri durur
  const ctl = (stationsCtl = new AbortController());
  try {
    const res = await fetchChargers(pts, profile, cacheKey, { signal: ctl.signal });
    if (stale() || ctl.signal.aborted) return; // araya yeni planlama girdi: eski rotanın istasyonları yeni planı ezmez
    const { cached, summary, notices = [] } = res;
    const { stations, errors } = keepLastGood(getState('plan').stations, res); // kaynak kesikse aynı rotanın önceki listesi silinmez
    if (errors.length || notices.length) toast([...errors, ...notices].join(' · '), 7000);
    if (cached) toast('İstasyonlar önbellekten alındı');
    patch('plan', { stations, stationInfo: { errors, notices, cached, summary } });
  } finally {
    if (stationsCtl === ctl) stationsCtl = null;
  }
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
export async function planTrip(from = null, { via = null, extra = [], preRoute = null, noOffer = false } = {}) {
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
  stationsCtl?.abort(); // önceki planlamanın süren istasyon (ücretli Google) araması iptal edilir; sonucu zaten yok sayılırdı
  // İnternet yoksa/rota alınamazsa mevcut (kayıtlı) plan bozulmasın. Planlama sürerken yenisi başladıysa son tutarlı durum geri gelir.
  const cur = getState('plan');
  const prev = cur.status === 'loading' && lastGood ? lastGood
    : { plan: { ...cur }, route: { trafficInfo: route.trafficInfo, cruise: route.cruise, traffic: route.traffic }, raw, sig };
  lastGood = prev;
  const resumeSim = !!from && getState('sim').enabled && getState('sim').play; // yeniden rota (kritik pil, rotadan çıkış): simülasyon oynuyorsa yeni rota kurulunca devam eder
  const restoreSim = () => { if (resumeSim && getState('sim').enabled) patch('sim', { play: true }); };

  try {
    // v0.99.108: yolda yeniden rotada (from) kullanıcının kilitlediği ileri duraklar (Rotaya Ekle / elle seçim) ve hedefleri korunur; yeni rotada
    // zorunlu durak olurlar ve routeThroughStops onları gerçek ara nokta yapar (doğrulanamazsa işaretli kalır, navGate). Yeni yolculukta sıfırlanır.
    const keepU = from ? (prev.plan.userPins || []).filter((id) => (prev.plan.stops || []).some((s) => s.station.id === id && s.km > (prev.plan.fromKm ?? 0) + 0.5)) : [];
    patch('plan', { status: 'loading', text: 'Rota alınıyor…', stops: [], totals: null, ranking: [], fromKm: 0, fromSoc: null, pinIds: keepU, banIds: [], leaveSocs: sanitizeLeaveSocs(from ? prev.plan.leaveSocs : {}, keepU), viaIds: [], viaIssues: [], userPins: keepU }); // yeni rota: elle değiştirilen duraklar sıfırlanır
    if (!from) {
      accessBook.clear(); // yeni yolculuk: erişim sonuçları sıfırdan (yeniden rotada aynı yöndeki sonuçlar geçerli kalır)
      mapApi.drawStations([], []); // önceki rotanın durak/istasyon işaretleri yeni plan gelene kadar haritada kalmaz
    }
    patch('sim', { routeKm: 0, lat: from?.lat ?? null, lon: from?.lon ?? null, play: false }); // simüle araç yeni rotanın başına (yeniden rotada bulunduğu yere)
    const tm = [Date.now()]; const rt = preRoute || await fetchRoute(start, end, tripWaypoints(route.via, via)); tm.push(Date.now()); // preRoute: kullanıcının onayladığı seçenek rotası (aynı rota, ikinci istek yok) // tm: aşama zamanları (yavaşlık tanısı)
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
      // Ara nokta istasyonu (Git / onaylı seçenek) artık rotanın üzerinde: sapması tam çizgiye göre (2 km örnekli profil sapmayı şişirir, iki kez sayılırdı)
      const keptQ = reproject([...cur.stations, ...extra.filter((x) => !cur.stations.some((s) => s.id === x.id))], quick)
        .map((s) => (via && s.id === via.id ? { ...s, offKm: Math.min(s.offKm, offRouteKm(rt.coords, s)) } : s));
      patch('plan', { route: rt, profile: quick, steps: projectSteps(rt.steps, quick), planId: newPlanId(), wxInfo: { source: null, fallbackReason: null, error: null }, forceFirstId: via?.id ?? null, viaIds: via ? [via.id] : [], lastStopKm: null, stations: keptQ, stationInfo: cur.stationInfo, text: '' });
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
      if (!noOffer) { const o = await offerAlternatives(); if (o?.applied) return true; } // rota üstünde şarj yok: onaylı seçenek
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
    patch('plan', { route: rt, profile, steps: projectSteps(rt.steps, profile), planId: newPlanId(), wxInfo: { source: wxRes?.source ?? null, fallbackReason: wxRes?.fallbackReason ?? null, error: wxError }, forceFirstId: via?.id ?? null, viaIds: via ? [via.id] : [], lastStopKm: null, stations: kept, stationInfo: from ? getState('plan').stationInfo : null, text: 'Şarj istasyonları aranıyor…' });

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
    if (!noOffer) { const o = await offerAlternatives(); if (o?.applied) return true; } // rota üstünde şarj yok: onaylı seçenek
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
    force: true, hasVia: (id) => (pl.viaIds || []).includes(id), // v0.99.107: her onaylı durak gerçek ara nokta (çizgiye yakın olsa da)
  });
  if (!wps) return null;
  // v0.99.97/107: yol ağıyla doğrulanmamış ya da karşı yön/rota dışı işaretli (yalnız elle seçilebilir) durak için rota onun üzerinden SESSİZCE
  // değiştirilmez; durak işaretli ve "rota girmiyor" (viaIssues) kalır, navigasyon ancak açık onayla başlar (navGate).
  if (pl.stops.some((s) => s.km > (pl.fromKm ?? 0) + 0.5 && ['unverified', 'blocked', 'off'].includes(pl.routeStatus?.[s.station.id]))) return null;
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
    const viaIds = pl.stops.filter((s) => s.km > (pl.fromKm ?? 0) + 0.5).map((s) => s.station.id); // sağlayıcıya ara nokta gönderilen duraklar
    patch('plan', { route: rt, profile, steps: projectSteps(rt.steps, profile), planId: newPlanId(), stations, pinIds, viaIds });
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

/**
 * v0.99.97 — Rota üstünde uygun şarj zinciri yok ama rotadan ayrılan bir istasyonla kurulabilir. En çok MAX_ALTERNATIVES istasyon için
 * yapılandırılmış rota sağlayıcı zincirinden (fetchRoute: TomTom/Mapbox yalnız izinli ve Premium'da, yoksa Valhalla/OSM; HERE politika gereği
 * kapalı) istasyon ÜZERİNDEN rota alınır; ek km/dk, durakta varış pili, şarj süresi ve varışta pil gerçek rota + plan hesabından gelir.
 * Kullanıcı açıkça onaylamadan mevcut rota/plan DEĞİŞMEZ; İptal → aynen kalır. Sağlayıcı rota veremezse "seçenek yok" denir, ölçü uydurulmaz.
 * Aynı plan için tek soru (İptal sonrası yeniden sorulmaz). Dönüş: { applied, cancelled } ya da null.
 */
export function offerAlternatives(out = lastOut) {
  const pl = getState('plan');
  const key = `${tripSeq}:${pl.planId}`;
  if (offerRun?.key === key) return offerRun.p; // aynı plan için süren soru (bekleyen çağıran aynı sonucu alır)
  if (!out?.relaxed?.feasible || !pl.profile || out.planId !== pl.planId) return Promise.resolve(null);
  if (offerDone.has(key)) return Promise.resolve(null);
  offerDone.add(key);
  const run = { key, p: null };
  offerRun = run;
  run.p = runOffer(out, key).catch((err) => { console.warn('Rota seçenekleri:', err.message); return null; }).finally(() => { if (offerRun === run) offerRun = null; });
  return run.p;
}

async function runOffer(out, key) {
  const pl = getState('plan');
  const r = getState('route');
  const gone = () => `${tripSeq}:${getState('plan').planId}` !== key; // araya yeni planlama/rota girdi: eski seçenek uygulanmaz
  const fromKm = out.fromKm ?? 0;
  const soc = out.soc ?? startSoc;
  const e = effective();
  const here = getState('nav').active && e.lat != null ? { lat: e.lat, lon: e.lon, label: 'Konumum' } : null;
  const origin = here || r.start;
  if (!origin || !r.end) return null;
  const off = new Set(out.offIds || []);
  const ranking = rankStations({ profile: pl.profile, stations: pl.stations.filter((s) => off.has(s.id)), startKm: fromKm, startSoc: soc, k: out.k, mode: pl.mode });
  const candidates = altCandidates({ relaxedStops: out.relaxed.stops, ranking, offIds: out.offIds, fromKm });
  const total = pl.profile.totalKm;
  const base = { km: total - fromKm, min: pl.profile.timeBetween(fromKm, total) * 60 };
  const result = await buildAlternatives({
    candidates, base,
    route: (st) => fetchRoute(origin, r.end, tripWaypoints(r.via, st)),
    evaluate: (rt, st) => evaluateAlt(rt, st, soc, out.k, pl),
  });
  if (gone()) return null;
  const res = await consentFlow({
    result,
    ask: (x) => askRouteChoice(x),
    // Onay: seçilen rota (ikinci istek yok) aynı denetleyici yoluyla kurulur; kurulamazsa planTrip eski planı geri yükler
    apply: (choice) => (gone() ? false : planTrip(origin, { via: choice.station, preRoute: choice.route, noOffer: true })),
  });
  if (res.cancelled && !gone()) toast(tpl(result.unavailable ? 'Rota dışı şarj seçeneği hesaplanamadı; mevcut rota korundu.' : 'Mevcut rota korundu; rota dışı şarj istasyonu eklenmedi.'), 6000);
  return res;
}

/** Seçenek rotasında plan (ağsız): rakım bilinmez (düz), hız sağlayıcı adımlarından; istasyon zorunlu ilk durak (onayda da öyle kurulur). */
function evaluateAlt(rt, st, soc, k, pl) {
  const r = getState('route');
  const pts = resampleRoute(rt.coords);
  const speeds = segmentSpeeds(rt, pts);
  const refV = planK().refV;
  const prof = buildProfile({ pts, elevations: null, elevSource: null, speeds: speeds.segs, wx: [], cruise: r.cruise, traffic: r.traffic, speedRel: (v) => relFactor(v, refV) });
  const cum = lineKm(rt.coords);
  const loc = (s) => locateOnLine(rt.coords, cum, s, Number.isFinite(s.km) ? s.km : null, 8);
  const keep = new Set([st.id]);
  const acc = applyAccess(reproject(pl.stations, prof), accessBook, (s) => { const at = loc(s); return at ? travelDir(rt.coords, cum, at.km) : null; }, keep);
  const split = splitByRoute(acc.stations, (s) => loc(s)?.offKm ?? null, keep);
  const plan = planRoute({
    profile: prof, stations: acc.stations, startKm: 0, startSoc: soc, minArrival: r.minArrivalSoc, mode: pl.mode, k,
    forceFirstId: st.id, excludeIds: [...(pl.banIds || []), ...acc.blocked, ...autoExclude(split)], // v0.99.107: sonraki duraklar da yalnız doğrulanmış
  });
  return { alt: { km: prof.totalKm, min: prof.timeBetween(0, prof.totalKm) * 60 }, plan };
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
    userPins: [...(plan.userPins || []).filter((id) => id !== oldId && id !== newId), newId], // v0.99.108 kullanıcı kilidi (Rotaya Ekle korur)
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
    userPins: (plan.userPins || []).filter((id) => id !== oldId),
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
    userPins: [...new Set([...(plan.userPins || []), newId])],
  };
  const out = computePlan({ fromKm, soc: plan.fromSoc ?? startSoc, pins: next });
  if (!out?.result.feasible) return { ok: false, reason: out?.result.reason || 'Plan kurulamadı', dropped: [] };
  const now = new Set(out.result.stops.map((s) => s.station.id));
  const dropped = (plan.stops || []).filter((s) => s.km > fromKm + 0.5 && !now.has(s.station.id)).map((s) => s.station.name);
  applyPlan(out, next);
  return { ok: true, dropped };
}

/**
 * v0.99.98 — Bir şarj durağının hedef pilini (ayrılış %) değiştirmeyi ÖNİZLE: plan/rota/harita DEĞİŞMEZ (ağ yok, kota harcanmaz).
 * Durak ve ondan önceki ileri duraklar zorunlu (kilitli) olur; sonraki duraklar aynı planlayıcıyla (tüketim profili, k, şarj eğrisi,
 * rota üstü/erişim/karşı yön kuralları, dışlananlar) yeniden seçilir. target null → hedef kilidi kalkar (planlayıcı yeniden seçer).
 * Dönüş: { ok, reason, offRouteOnly, preview } — preview applyStopTarget'a verilir; İptal'de hiçbir şey yapılmaz, mevcut plan aynen kalır.
 */
export function previewStopTarget(stationId, target) {
  const plan = getState('plan');
  if (!plan.profile || plan.status !== 'ready') return { ok: false, reason: 'Rota yok' };
  const fromKm = plan.fromKm ?? 0;
  const soc = plan.fromSoc ?? startSoc;
  const ahead = (plan.stops || []).filter((s) => s.km > fromKm + 0.5);
  const idx = ahead.findIndex((s) => s.station.id === stationId);
  if (idx < 0) return { ok: false, reason: 'Durak geride kaldı ya da planda yok' };
  const stop = ahead[idx];
  if (isFresh(stop.station) && slotKind(stop.station) === 'out') return { ok: false, reason: 'İstasyon kullanım dışı görünüyor (taze doluluk bilgisi); önce durağı değiştir.' };
  const leaveSocs = { ...(plan.leaveSocs || {}) };
  if (target == null) delete leaveSocs[stationId];
  else {
    const b = targetBounds(stop);
    leaveSocs[stationId] = Math.min(b.hi, Math.max(0, Math.round(target)));
  }
  const upstream = ahead.slice(0, idx + 1).map((s) => s.station.id); // bu durak ve öncekiler korunur; yalnız sonrası yeniden seçilir
  const next = {
    pinIds: [...new Set([...(plan.pinIds || []), ...upstream])],
    banIds: (plan.banIds || []).filter((id) => !upstream.includes(id)),
    leaveSocs,
  };
  const out = computePlan({ fromKm, soc, maxFirstStopKm: plan.maxFirstStopKm ?? Infinity, pins: next, rank: true });
  if (!out) return { ok: false, reason: 'Plan kurulamadı' };
  if (!out.result.feasible) {
    // Rota üstünde zincir yok: rota dışı seçenek varsa bile burada uygulanmaz (rota değişikliği yalnız ayrı onayla)
    return { ok: false, offRouteOnly: !!out.relaxed?.feasible, reason: out.relaxed?.feasible ? OFF_ROUTE_TEXT : out.result.reason || 'Plan kurulamadı' };
  }
  const diff = planDiff({ stops: ahead, totals: plan.totals }, { stops: out.result.stops, totals: out.result.totals });
  return { ok: true, preview: { out, next, diff, stationId, target, planId: plan.planId, seq: tripSeq } };
}

/**
 * Önizlenen hedefi kullanıcı ONAYLADIKTAN sonra uygula. Önizlemeden sonra plan değiştiyse (yeni rota, yeniden planlama, başka değişiklik)
 * eski önizleme uygulanmaz. Dönüş: { ok, reason }.
 */
export function applyStopTarget(preview) {
  if (!preview?.out?.result?.feasible) return { ok: false, reason: 'Önizleme yok' };
  const plan = getState('plan');
  if (preview.seq !== tripSeq || preview.planId !== plan.planId || plan.status !== 'ready') return { ok: false, reason: 'Plan önizlemeden sonra değişti; yeniden dene.' };
  applyPlan(preview.out, preview.next);
  return { ok: true };
}

/**
 * v0.99.99 — Pil değişti (doğrulanmış kamera/elle) ya da şarj planlanandan farklı bitti: kalan planı aynı motorla ÖNİZLE
 * (computePlan + planDiff; ağ yok, plan/rota/harita DEĞİŞMEZ, rota dışı onayı tetiklemez). Kullanıcının durak hedefleri/kilitleri korunur.
 * fromKm: plan bu km'den kurulur (durakta şarj bitince durağın hemen ötesi). Uygulama yalnız onayla: applyStopTarget(preview).
 */
export function previewSocReplan({ km, soc, fromKm = km }) {
  const plan = getState('plan');
  if (!plan.profile || plan.status !== 'ready') return { ok: false, reason: 'Rota yok' };
  let out;
  try {
    out = computePlan({ fromKm, soc, maxFirstStopKm: Infinity, rank: false });
  } catch (err) {
    return { ok: false, reason: 'Plan hesaplanamadı: ' + err.message };
  }
  if (!out) return { ok: false, reason: 'Plan kurulamadı' };
  if (!out.result.feasible) return { ok: false, offRouteOnly: !!out.relaxed?.feasible, reason: out.relaxed?.feasible ? OFF_ROUTE_TEXT : out.result.reason || 'Plan kurulamadı' };
  const ahead = (plan.stops || []).filter((s) => s.km > fromKm + 0.5);
  const diff = planDiff({ stops: ahead, totals: remainingTotals(plan, fromKm) }, { stops: out.result.stops, totals: out.result.totals });
  return { ok: true, preview: { out, next: { fromKm, fromSoc: soc }, diff, soc, km: fromKm, planId: plan.planId, seq: tripSeq } };
}

// ---------- v0.99.108 Haritadaki istasyonu "Rotaya Ekle": önizleme (durum değişmez) → açık onay → uygulama ----------
let addRun = null; // { id, p }: aynı anda tek ekleme hesabı (art arda dokunuş aynı sözü alır; başka istasyon 'busy')

/** Önizleme rotası için profil + istasyonlar (durum değişmez). extras: rakım/hava alındıysa ham veri. */
function addCtx(rt, pool, viaIds, extras = null) {
  const pts = extras?.raw?.pts ?? resampleRoute(rt.coords);
  const speeds = extras?.speeds ?? segmentSpeeds(rt, pts);
  const rw = extras?.raw ?? { pts, elevations: null, elevSource: null, speeds: speeds.segs, wx: [] };
  const cruise = Math.round(speeds.avgFreeKmh);
  const traffic = densityFromRatio(rt.trafficRatio);
  const refV = planK().refV;
  const profile = buildProfile({ ...rw, cruise, traffic, speedRel: (v) => relFactor(v, refV) });
  const vs = new Set(viaIds);
  const stations = reproject(pool, profile).map((s) => (vs.has(s.id) ? { ...s, offKm: Math.min(s.offKm, offRouteKm(rt.coords, s)) } : s));
  return { rt, pts, speeds, raw: rw, profile, stations, cruise, traffic };
}

/** Önizleme rotasında rakım ve hava (planTrip ile aynı kaynaklar; yalnız kullanıcının eylemiyle, GPS adımında asla). */
async function addExtras(rt) {
  const pts = resampleRoute(rt.coords);
  const speeds = segmentSpeeds(rt, pts);
  const wxIdx = pts.map((_, i) => i).filter((i) => i % (WX_STEP_KM / 2) === 0);
  if (wxIdx.at(-1) !== pts.length - 1) wxIdx.push(pts.length - 1);
  const t0 = Date.now();
  let wxError = null;
  const [elev, wxRes] = await Promise.all([
    fetchElevations(pts).catch(() => null),
    fetchWeather(wxIdx.map((i) => ({ lat: pts[i].lat, lon: pts[i].lon, t: t0 + speeds.cumH[i] * 3600e3 }))).catch((err) => { wxError = err.message; return null; }),
  ]);
  return {
    speeds,
    raw: { pts, elevations: elev?.elevations ?? null, elevSource: elev?.source ?? null, speeds: speeds.segs, wx: wxRes ? wxRes.map((w, j) => ({ km: pts[wxIdx[j]].km, ...w })) : [] },
    wxInfo: { source: wxRes?.source ?? null, fallbackReason: wxRes?.fallbackReason ?? null, error: wxError },
    elevOk: !!elev, wxOk: !!wxRes,
  };
}

/**
 * Haritada dokunulan istasyonu kalan rotaya ZORUNLU şarj durağı olarak eklemeyi ÖNİZLE. Plan/rota/harita DEĞİŞMEZ; sonuç yalnız
 * applyAddToRoute(preview) ile (kullanıcı onayından sonra) uygulanır. Sırayla:
 *  1) uygunluk + (navigasyonda) konum güvenilirliği; 2) yol ağıyla GİDİŞ YÖNÜNDE erişim (karşı şerit/doğrulanamayan → fail-closed);
 *  3) istasyon + kullanıcının kilitli durakları + ara durak GERÇEK ara nokta olarak sağlayıcı rotası; 4) yeni rotada plan (kilitliler +
 *  yeni durak zorunlu, sonrakiler yeniden seçilir; doğrulanmamış aday sorgulanır); otomatik seçilen sonraki duraklar da ara nokta olacak
 *  şekilde rota bir kez daha alınır; 5) rakım/hava ile son plan, viaCheck (girişe ulaşma, U dönüşü) ve başlangıçta geri dönüş denetimi.
 * socNow: { soc, trusted } — arayüzün okuduğu pil ve kaynağın güvenilirliği (güvenilir değilse planın bu km için beklediği pil kullanılır).
 * Dönüş: { ok: true, preview } | { ok: false, reason, detail } (reason → addToRoute.ADD_TEXT).
 */
export function previewAddToRoute(station, { socNow = null } = {}) {
  if (addRun) return addRun.id === station?.id ? addRun.p : Promise.resolve({ ok: false, reason: 'busy', detail: '' });
  const run = { id: station?.id, p: null };
  addRun = run;
  run.p = runAddPreview(station, socNow)
    .catch((err) => { console.warn('Rotaya ekle:', err?.message); return { ok: false, reason: 'provider', detail: err?.message || String(err) }; })
    .finally(() => { if (addRun === run) addRun = null; });
  return run.p;
}

async function runAddPreview(station, socNow) {
  const pl = getState('plan');
  const r = getState('route');
  const seq = tripSeq;
  const planId = pl.planId;
  const gone = () => seq !== tripSeq || getState('plan').planId !== planId;
  const fail = (reason, detail = '') => ({ ok: false, reason, detail });
  const coords = pl.route?.coords;
  const eng = getState('engine');
  const e = effective();
  const moving = !!getState('nav').active || (pl.fromKm ?? 0) > 0.5;
  let fromKm = pl.fromKm ?? 0;
  let origin = r.start;
  let soc = pl.fromSoc ?? startSoc;
  let curDir = null;
  if (moving && coords?.length) {
    const live = getState('live');
    const gpsOk = e.source === 'sim' || (live.gps === 'ok' && e.lat != null && !(live.acc > GPS_MAX_ACC_M));
    if (!gpsOk || eng.routeKm == null || !((eng.offRouteKm ?? Infinity) <= GPS_MAX_OFF_KM)) return fail('gps');
    fromKm = eng.routeKm;
    origin = { lat: e.lat, lon: e.lon, label: 'Konumum' };
    curDir = travelDir(coords, lineKm(coords), fromKm);
    const exp = expectedSoc(pl, fromKm, pl.kInfo?.k ?? eng.k, VEHICLE.batteryNetKwh);
    soc = socNow?.trusted && Number.isFinite(socNow.soc) ? socNow.soc : Number.isFinite(exp) ? exp : (e.soc ?? soc);
  }
  const at = stationAt(coords, station);
  const el = addEligibility({ plan: pl, station, at, here: fromKm });
  if (!el.ok) return fail(el.reason);
  if (!origin || !r.end) return fail('noroute');

  // 2) Gidiş yönünde yol ağı erişimi (v0.99.107 kapıları): yakın tarihli başarısız sorgu yeniden denenmez (sağlayıcı sınırı) → doğrulanmadı
  await verifyStops({ coords, stops: [{ km: at.km, station: { ...station, km: at.km } }], fromKm, book: accessBook, probe: probeStopAccess });
  if (gone()) return fail('changed');
  const rec = accessBook.get(station.id, travelDir(coords, lineKm(coords), at.km));
  if (!rec || !rec.verified) return fail('unverified', rec?.reason || tpl('yol ağı sorgusu yapılamadı'));
  if (!rec.ok) return fail('blocked');

  // 3) Gerçek ara noktalı rota
  const locked = lockedAhead(pl, fromKm);
  const stopover = r.via || null;
  const sv = stopover ? stationAt(coords, stopover) : null;
  const v = addVias({ locked, add: { km: at.km, station }, stopover, stopoverKm: sv?.km ?? null, fromKm });
  if (!v) return fail('provider', tpl('ara nokta sınırı aşıldı'));
  const pool = [...pl.stations.filter((s) => s.id !== station.id), station];
  const leaveSocs = pl.leaveSocs || {};
  const banIds = (pl.banIds || []).filter((id) => id !== station.id);
  const route = async (wps) => {
    try {
      const rt = await fetchRoute(origin, r.end, wps);
      if (!rt || !Array.isArray(rt.coords) || rt.coords.length < 2) throw new Error(tpl('rota yanıtı boş'));
      return rt;
    } catch (err) { return { error: err?.message || String(err) }; }
  };
  const planOn = async (ctx, mustIds) => {
    let out = null;
    for (let round = 0; round < 3; round++) { // doğrulanmamış aday sonraki durak: yol ağıyla sorgulanır (en çok 2 tur), sonra kesin plan
      out = computePlan({ fromKm: 0, soc, pins: { pinIds: mustIds, banIds, leaveSocs }, env: { profile: ctx.profile, stations: ctx.stations, route: ctx.rt } });
      if (out?.result.feasible || !out?.candidate?.feasible || round === 2) break;
      const need = out.candidate.stops.filter((x) => (out.unverifiedIds || []).includes(x.station.id));
      if (!need.length) break;
      const res = await verifyStops({ coords: ctx.rt.coords, stops: need, fromKm: 0, book: accessBook, probe: probeStopAccess });
      if (gone() || !res.checked) break;
    }
    return out;
  };
  const turnBad = (rt) => moving && startUturn(rt.coords, curDir, origin);
  const reached = (rt) => offRouteKm(rt.coords, station) <= VIA_REACH_KM;

  let rt = await route(v.wps);
  if (gone()) return fail('changed');
  if (rt.error) return fail('provider', rt.error);
  if (!reached(rt)) return fail('noreach');
  if (turnBad(rt)) return fail('startuturn');
  let viaIds = v.ids;
  let must = v.ids;
  let ctx = addCtx(rt, pool, viaIds);
  let out = await planOn(ctx, must);
  if (gone()) return fail('changed');
  if (!out?.result.feasible) return fail('plan', out?.result.reason || '');
  // Sonraki duraklar yeniden seçildi: hepsi rotada gerçek ara nokta olmalı (v0.99.107) → rota bir kez daha (yalnız gerekiyorsa)
  if (out.result.stops.some((s) => s.km > 0.5 && !viaIds.includes(s.station.id))) {
    const ahead = out.result.stops.filter((s) => s.km > 0.5);
    const mine = ahead.find((s) => s.station.id === station.id);
    if (!mine) return fail('plan', tpl('durak planda yok'));
    const sv2 = stopover ? ctx.profile.project(stopover.lat, stopover.lon) : null;
    const v2 = addVias({ locked: ahead.filter((s) => s !== mine), add: mine, stopover, stopoverKm: sv2?.km ?? null, fromKm: 0 });
    if (!v2) return fail('provider', tpl('ara nokta sınırı aşıldı'));
    rt = await route(v2.wps);
    if (gone()) return fail('changed');
    if (rt.error) return fail('provider', rt.error);
    if (!reached(rt)) return fail('noreach');
    if (turnBad(rt)) return fail('startuturn');
    viaIds = v2.ids;
    must = v2.ids;
  }
  // 5) Son rota: rakım + hava ile profil ve kesin plan (onayda aynen uygulanır)
  const ex = await addExtras(rt);
  if (gone()) return fail('changed');
  ctx = addCtx(rt, pool, viaIds, ex);
  out = await planOn(ctx, must);
  if (gone()) return fail('changed');
  if (!out?.result.feasible) return fail('plan', out?.result.reason || '');
  const stop = out.result.stops.find((s) => s.station.id === station.id && s.km > 0.5);
  if (!stop) return fail('plan', tpl('durak planda yok'));
  const userPins = [...new Set([...locked.map((s) => s.station.id), station.id])];
  const vc = viaCheck({ coords: rt.coords, stops: out.result.stops, fromKm: 0, viaIds, pinIds: [] });
  const j = judgeAddRoute({ viaIssues: vc.issues, addId: station.id, startTurn: turnBad(rt) });
  if (!j.ok) return fail(j.reason, j.names.join(', '));
  const ahead0 = (pl.stops || []).filter((s) => s.km > fromKm + 0.5);
  const diff = planDiff({ stops: ahead0, totals: remainingTotals(pl, fromKm) }, { stops: out.result.stops, totals: out.result.totals });
  const baseKm = pl.profile.totalKm - fromKm;
  const baseMin = pl.profile.timeBetween(fromKm, pl.profile.totalKm) * 60;
  return {
    ok: true,
    preview: {
      station, stop, out, ctx, wxInfo: ex.wxInfo, elevOk: ex.elevOk, wxOk: ex.wxOk, diff,
      addKm: ctx.profile.totalKm - baseKm, addMin: ctx.profile.timeBetween(0, ctx.profile.totalKm) * 60 - baseMin,
      provider: rt.routeMeta?.provider ?? null, moving, origin, soc, socTrusted: !!socNow?.trusted,
      next: { pinIds: must, banIds, leaveSocs: sanitizeLeaveSocs(leaveSocs, must), userPins, viaIds, fromKm: 0, fromSoc: moving ? soc : null, forceFirstId: null },
      seq, planId, at: Date.now(),
    },
  };
}

/**
 * Önizlenen eklemeyi kullanıcı ONAYLADIKTAN sonra uygula: rota (ara noktalı), profil, istasyonlar ve plan birlikte değişir; harita
 * yeniden çizilir. Önizlemeden sonra plan değiştiyse (yeniden rota, yeni plan) ya da önizleme eskidiyse uygulanmaz, mevcut rota kalır.
 * Dönüş: { ok, reason, viaIssues }.
 */
export function applyAddToRoute(preview, now = Date.now()) {
  if (!preview?.out?.result?.feasible) return { ok: false, reason: 'plan' };
  const pl = getState('plan');
  if (preview.seq !== tripSeq || preview.planId !== pl.planId || !['ready', 'infeasible'].includes(pl.status)) return { ok: false, reason: 'changed' };
  if (now - preview.at > PREVIEW_TTL_MS) return { ok: false, reason: 'stale' };
  const { ctx } = preview;
  const rt = ctx.rt;
  raw = ctx.raw;
  patch('route', {
    trafficInfo: { ratio: rt.trafficRatio, driveMin: rt.durationH * 60, freeMin: (rt.durationH * 60) / rt.trafficRatio, avgFreeKmh: ctx.speeds.avgFreeKmh, live: !!rt.live, jamKm: (rt.intervals || []).reduce((a, iv) => a + (iv.to - iv.from), 0), slowKm: (rt.trafficSpans || []).reduce((a, s) => a + (s.to - s.from), 0) },
    cruise: ctx.cruise,
    traffic: ctx.traffic,
  });
  sig = routeSig();
  const planId = newPlanId();
  patch('plan', { route: rt, profile: ctx.profile, steps: projectSteps(rt.steps, ctx.profile), planId, stations: ctx.stations, wxInfo: preview.wxInfo, lastStopKm: null, ...preview.next });
  applyPlan({ ...preview.out, planId }, preview.next);
  mapApi.drawRoute(rt.coords, { fit: false, traffic: rt.trafficSpans || null });
  if (preview.moving && getState('sim').enabled) patch('sim', { routeKm: 0, lat: preview.origin.lat, lon: preview.origin.lon }); // simüle araç yeni rotanın başında (bulunduğu yer)
  if (rt.note) toast(rt.note, 7000);
  return { ok: true, viaIssues: getState('plan').viaIssues || [] };
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
  if (!out?.result.feasible && out?.candidate?.feasible) { // v0.99.107: aday var ama yol ağıyla doğrulanmamış → durak YOK, önce doğrulanır
    applyPlan(out, { fromKm: km, fromSoc: soc }); // "doğrulanıyor/doğrulanamadı" metni; doğrulama bitince runAccess bu konumdan yeniden planlar
    return false;
  }
  if (!out?.result.feasible) {
    if (out?.relaxed?.feasible) offerAlternatives(out); // rota üstünde zincir yok: rota değişikliği yalnızca onayla (eski plan bu arada kalır; beklenmez)
    return false;
  }
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
  offerRun = null;
  offerDone.clear();
  addRun = null; // v0.99.108: süren Rotaya Ekle önizlemesi temizlenen rotaya uygulanamaz (tripSeq de arttı)
  accessBook.clear();
  raw = null;
  sig = '';
  patch('plan', { status: 'none', text: '', route: null, profile: null, wxInfo: null, stations: [], stationInfo: null, stops: [], steps: [], pinIds: [], banIds: [], leaveSocs: {}, userPins: [], totals: null, planId: null, fromKm: 0, fromSoc: null, viaIds: [], viaIssues: [], accessPending: false, accessFailed: [] });
  mapApi.clearRoute();
  for (const k of ['start', 'via', 'end']) mapApi.setPoint(k, null, { fit: false });
}
