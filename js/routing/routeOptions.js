// Rota seçenekleri karşılaştırması: aynı güzergâh üzerinde planlayıcının üç modu (Hızlı / Ekonomik / Optimum) ile kurulan şarj planları
// yan yana konur ve "En hızlı", "En ucuz", "En düşük risk" rozetleri yalnızca savunulabilir ölçütle verilir. DOM kullanmaz (test edilebilir).
// Dürüstlük kuralları:
//  - Rota sağlayıcısı tek güzergâh verirse alternatif güzergâh uydurulmaz: seçenekler aynı yol üzerindeki şarj planlarıdır ve bu yazılır.
//  - Maliyet üç sınıftır: bilinen tarife (işletmeci liste/yayımlanan/kullanıcı tarifesi), tahmin ("Diğer" ortalaması) ve bilinmeyen
//    (yurt dışı, fiyat yok). "En ucuz" yalnızca tüm farklı seçeneklerin maliyeti bilinen tarifeyle tam hesaplanabiliyorsa verilir.
//  - "En düşük risk" açık ölçütlerle verilir (RISK_CRITERIA) ve ölçütler arayüzde gösterilir.
import { isFresh, slotKind } from './slots.js';

export const OPTION_MODES = ['fast', 'cheap', 'opt'];
export const OPTION_LABELS = { fast: '⏱️ Hızlı', cheap: '💰 Ekonomik', opt: '⚖️ Optimum' };

/** "En düşük risk" ölçütleri, sırayla (ilki eşitse sonrakine bakılır). Arayüzde aynen gösterilir. */
export const RISK_CRITERIA = [
  'Yolculuk boyunca en düşük tahmini pil (her istasyona ve varışa varışta) daha yüksek olan',
  'Belirsiz durak sayısı daha az olan: gücü kayıtta yazmayan, yavaş (AC) ya da taze bilgiye göre dolu/arızalı istasyon',
  'Şarj durağı sayısı daha az olan',
];
const SOC_STEP = 1; // en düşük pil 1 puandan küçük farkla "eşit" sayılır (model gürültüsü üstün sayılmaz)

/** Durağın fiyat sınıfı: 'known' (bilinen tarife), 'estimate' (ortalama tahmini), 'unknown'. */
export function priceClass(st) {
  if (!st || st.foreign || !(st.price > 0)) return 'unknown';
  if (st.tariff === 'list') return 'known';
  if (st.tariff === 'estimate') return 'estimate';
  return 'unknown';
}

/** Planın maliyet özeti. kind: 'none' (şarj yok, 0 TL), 'known' (tümü bilinen tarife), 'estimate' (en az bir tahmin, bilinmeyen yok), 'unknown' (en az bir durağın fiyatı yok). */
export function planCost(stops = []) {
  const c = { known: 0, estimate: 0, nKnown: 0, nEstimate: 0, nUnknown: 0, kind: 'none' };
  for (const s of stops) {
    const k = priceClass(s.station);
    const tl = Number.isFinite(s.cost) ? s.cost : 0;
    if (k === 'known') { c.known += tl; c.nKnown++; } else if (k === 'estimate') { c.estimate += tl; c.nEstimate++; } else c.nUnknown++;
  }
  if (!stops.length) c.kind = 'none';
  else if (c.nUnknown) c.kind = 'unknown';
  else if (c.nEstimate) c.kind = 'estimate';
  else c.kind = 'known';
  c.total = c.kind === 'known' || c.kind === 'none' ? c.known : null; // yalnızca tam bilinen maliyet karşılaştırılabilir
  return c;
}

/** Maliyet hücresi metni (TL yalnızca bilinen/tahmini tutar için; bilinmeyen tutar uydurulmaz). */
export function costText(c) {
  if (c.kind === 'none') return '0 TL (şarj yok)';
  if (c.kind === 'known') return `${Math.round(c.known)} TL (tarife)`;
  if (c.kind === 'estimate') return `~${Math.round(c.known + c.estimate)} TL (${c.nEstimate} durak tahmini fiyat)`;
  return c.nKnown + c.nEstimate
    ? `≥ ${Math.round(c.known + c.estimate)} TL · ${c.nUnknown} durağın fiyatı bilinmiyor`
    : 'Fiyat bilinmiyor';
}

/** Durağın belirsizlik nedenleri (risk ölçütü 2). */
export function stopRisks(st) {
  const r = [];
  if (st.uncertain) r.push('güç bilinmiyor');
  if (st.slow) r.push('yavaş (AC)');
  if (isFresh(st)) {
    const k = slotKind(st);
    if (k === 'full') r.push('dolu');
    else if (k === 'out') r.push('arızalı');
  }
  return r;
}

const sigOf = (res) => res.stops.map((s) => `${s.station.id}@${Math.round(s.leaveSoc)}`).join('|');

/** Tek planın özeti (planRoute sonucu). */
export function summarizeOption(mode, res) {
  if (!res?.feasible) return { mode, label: OPTION_LABELS[mode], feasible: false, reason: res?.reason || 'Plan kurulamadı' };
  const stops = res.stops;
  const minSoc = Math.min(res.totals.arriveSoc, ...stops.map((s) => s.arriveSoc));
  const risky = stops.filter((s) => stopRisks(s.station).length).length;
  return {
    mode, label: OPTION_LABELS[mode], feasible: true,
    totalMin: res.totals.totalMin, chargeMin: res.totals.chargeMin, driveMin: res.totals.driveMin,
    stops: stops.length, arriveSoc: res.totals.arriveSoc, minSoc, risky,
    cost: planCost(stops), sig: sigOf(res), sameAs: null,
  };
}

/** Sağlayıcı kaç güzergâh verdi? Şu an tüm sağlayıcılar tek güzergâh ister (Mapbox alternatives=false; TomTom/Valhalla tek rota). */
export function routeAlternatives(route) {
  const n = route ? 1 + (Array.isArray(route.alternatives) ? route.alternatives.length : 0) : 0;
  return {
    count: n,
    available: n > 1,
    note: n > 1 ? `${n} güzergâh` : 'Rota sağlayıcısı tek güzergâh verdi: alternatif güzergâh yok. Seçenekler aynı yol üzerindeki farklı şarj planlarıdır.',
  };
}

const minBy = (list, f) => list.reduce((a, b) => (f(b) < f(a) ? b : a));

/** Risk karşılaştırması: negatif = a daha az riskli. */
function riskCmp(a, b) {
  if (Math.abs(a.minSoc - b.minSoc) >= SOC_STEP) return b.minSoc - a.minSoc;
  if (a.risky !== b.risky) return a.risky - b.risky;
  return a.stops - b.stops;
}

/**
 * plans: { fast, cheap, opt } planRoute sonuçları (eksik olan atlanır). route: plan.route. current: seçili mod.
 * Dönüş: { routes, options[], distinct, best: { fast, cheap, risk }, notes: { fast, cheap, risk }, criteria }.
 * best.* = mod adı ya da null (iddia edilemiyorsa). Aynı planı veren modlar sameAs ile ilkine bağlanır; rozetler o gruba verilir.
 */
export function buildRouteOptions({ plans = {}, route = null, current = 'opt' } = {}) {
  const options = OPTION_MODES.filter((m) => m in plans).map((m) => ({ ...summarizeOption(m, plans[m]), current: m === current }));
  const groups = [];
  for (const o of options) {
    if (!o.feasible) continue;
    const g = groups.find((x) => x.sig === o.sig);
    if (g) o.sameAs = g.mode; else groups.push(o);
  }
  const best = { fast: null, cheap: null, risk: null };
  const notes = { fast: '', cheap: '', risk: '' };
  if (!groups.length) {
    notes.fast = notes.cheap = notes.risk = 'Uygun plan yok.';
  } else if (groups.length < 2) {
    notes.fast = notes.cheap = notes.risk = 'Tüm modlar aynı şarj planını verdi: karşılaştırılacak farklı seçenek yok.';
  } else {
    const fast = minBy(groups, (o) => o.totalMin);
    if (groups.filter((o) => Math.round(o.totalMin) === Math.round(fast.totalMin)).length > 1) notes.fast = 'Planların tahmini toplam süresi eşit (1 dk içinde).';
    else { best.fast = fast.mode; notes.fast = 'Tahmini toplam süre (sürüş + şarj + durak) en kısa olan.'; }
    const safe = groups.reduce((a, b) => (riskCmp(b, a) < 0 ? b : a));
    const criteria = 'Ölçütler: ' + RISK_CRITERIA.map((c, i) => `${i + 1}) ${c}`).join('; ') + '.';
    if (groups.some((o) => o !== safe && riskCmp(o, safe) === 0)) notes.risk = 'Planlar risk ölçütlerinin hepsinde eşit: en düşük risk söylenemez. ' + criteria;
    else { best.risk = safe.mode; notes.risk = criteria; }
    const notComparable = groups.filter((o) => o.cost.total == null);
    if (notComparable.length) {
      const nUnk = notComparable.filter((o) => o.cost.kind === 'unknown').length;
      notes.cheap = 'En ucuz söylenemez: ' + (nUnk ? 'bazı planlarda fiyatı bilinmeyen durak var' : 'bazı planlarda yalnızca tahmini (ortalama) fiyat var')
        + '; maliyetler bilinen tarifeyle karşılaştırılabilir değil.';
    } else {
      const lo = minBy(groups, (o) => o.cost.total);
      const tie = groups.filter((o) => Math.round(o.cost.total) === Math.round(lo.cost.total)).length > 1;
      if (tie) notes.cheap = 'Planların bilinen tarifeyle maliyeti eşit.';
      else { best.cheap = lo.mode; notes.cheap = 'Tüm planların maliyeti bilinen tarifeyle hesaplandı; en düşük olan.'; }
    }
  }
  return { routes: routeAlternatives(route), options, distinct: groups.length, best, notes, criteria: RISK_CRITERIA };
}

const hm = (min) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`;
};

/** Seçenek satırı metinleri (arayüz ve test aynı metni kullanır): { title, badges[], line, risk }. */
export function optionText(o, model) {
  const badges = [];
  if (o.current) badges.push('seçili');
  if (!o.feasible) return { title: o.label, badges, line: 'Plan kurulamadı: ' + o.reason, risk: '' };
  const lead = o.sameAs || o.mode; // aynı planı veren modlar ilk modun rozetini paylaşır
  if (model.best.fast === lead) badges.push('En hızlı');
  if (model.best.cheap === lead) badges.push('En ucuz');
  if (model.best.risk === lead) badges.push('En düşük risk');
  const same = o.sameAs ? ` · ${OPTION_LABELS[o.sameAs]} ile aynı plan` : '';
  return {
    title: o.label,
    badges,
    line: `${hm(o.totalMin)} (şarj ${hm(o.chargeMin)}) · ${o.stops} durak · ${costText(o.cost)}${same}`,
    risk: `En düşük pil %${Math.round(o.minSoc)} · varışta %${Math.round(o.arriveSoc)}` + (o.risky ? ` · ${o.risky} belirsiz durak` : ' · belirsiz durak yok'),
  };
}
