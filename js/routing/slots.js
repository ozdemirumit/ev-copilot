// Şarj yuvası (konnektör) doluluğu: `evChargeOptions.connectorAggregation` biçimindeki (şu an hiçbir kaynak sunmuyor) alanlardan
// (count, availableCount, outOfServiceCount, availabilityLastUpdateTime). Bilgi yalnızca bazı ağlar için vardır.
// D3-T4: ARAYÜZ (slotEl / slotLabel) resmî doluluğu yalnız üç durumla gösterir — 🟢 Müsait / 🔴 Dolu / ⚪ Bilinmiyor (K5) — ve
// kararı saf occupancyDecision'dan alır (sağlayıcı zaman damgası yoksa ya da 15 dk'dan eskiyse Bilinmiyor). Topluluk satırları
// communityReport modelinden, resmî durumdan ayrı (K3). Planlayıcı kararları (slotKind / isFresh) bu görevde DEĞİŞMEDİ.
import { occupancyDecision } from './occupancyDecision.js';
import { communityReport } from './communityReport.js';

export const FRESH_MS = 15 * 60e3; // planlamada doluluk bu kadar tazeyse dikkate alınır
const COMMUNITY_FULL_MS = 20 * 60e3; // "Dolu" bildirimi bu kadar süre planı etkiler
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);

/**
 * evChargeOptions → { total, available (bilinmiyorsa null), out, at (Google'ın son güncelleme zamanı, ms), checked (bizim okuma zamanımız) }.
 * DC konnektör varsa yalnızca DC'ler sayılır (AC yuvaları DC hızlı şarj için boş sayılmaz).
 */
export function slotsOf(ev, dcTypes) {
  const agg = ev?.connectorAggregation || [];
  const dc = agg.filter((a) => dcTypes.has(a.type));
  const use = dc.length ? dc : agg;
  const total = sum(use, (a) => a.count);
  if (!total) return null;
  const known = use.some((a) => a.availableCount != null);
  const times = use.map((a) => Date.parse(a.availabilityLastUpdateTime)).filter(Number.isFinite);
  return {
    total,
    available: known ? sum(use, (a) => a.availableCount) : null,
    out: sum(use, (a) => a.outOfServiceCount),
    at: times.length ? Math.max(...times) : null,
    checked: Date.now(),
  };
}

/** 'unknown' | 'out' (tamamı arızalı) | 'full' (boş yuva yok) | 'free'. Resmî sayı yoksa taze "Dolu" topluluk bildirimi 'full' sayılır. */
export function slotKind(s) {
  const sl = s.slots;
  if (!sl) return 'unknown';
  if (sl.available == null) {
    const r = sl.community?.report;
    return r?.status === 'full' && Date.now() - r.at < COMMUNITY_FULL_MS ? 'full' : 'unknown';
  }
  if (sl.out >= sl.total) return 'out';
  if (sl.available <= 0) return 'full';
  return 'free';
}

/** Arayüzde gösterilen üç resmî doluluk durumu (K5). Başka durum etiketi (boş/dolu (0/N)/arızalı/eski) yazılmaz. */
export const OCC_UI_LABELS = Object.freeze({ free: '🟢 Müsait', full: '🔴 Dolu', unknown: '⚪ Bilinmiyor' });

/**
 * Resmî doluluğun arayüz durumu ya da null (hiç resmî doluluk verisi gelmediyse: bölüm gizli kalır, mevcut UX).
 * { ui: 'free'|'full'|'unknown', available, total, ageMin } — sayı ve yaş yalnız doğrulanmış (free/full) durumda.
 * Doğrulanmış "hepsi arızalı" (out) da "Dolu" gösterilir (boş yuva yok; dördüncü durum yok).
 */
function officialUi(sl, now) {
  if (!sl || (sl.available == null && (sl.availability == null || typeof sl.availability !== 'object'))) return null;
  const d = occupancyDecision(sl, { now });
  // Sunucu kararı (server/availability.mjs `decision`, occupancyClient aynen taşır) güvenilmez diyorsa fail-closed: Bilinmiyor.
  // Sunucu kararı tek başına Müsait/Dolu yapmaz; istemci kararı (saat, AGE) ayrıca gerekir.
  const veto = sl.decision != null && (typeof sl.decision !== 'object' || sl.decision.trusted !== true);
  if (!d.trusted || veto) return { ui: 'unknown', available: null, total: null, ageMin: null };
  const c = sl.availability.counts;
  const total = Object.values(c).reduce((n, v) => n + v, 0);
  return { ui: d.state === 'free' ? 'free' : 'full', available: c.AVAILABLE, total, ageMin: d.ageMin };
}

/**
 * Doluluk öğesi: " · 🟢 Müsait · 3/4 · 2 dk önce" (durum, sayı ve yaş AYRI metin düğümleridir: uzun satırın sonuna eklenen metin çeviri
 * kalıplarını bozmasın, her parça kendi anahtarıyla çevrilir). Hiç doluluk verisi yoksa null.
 */
export function slotEl(s, lead = ' · ') {
  const sl = s.slots;
  if (!sl) return null;
  const now = Date.now();
  const span = (txt, cls = '') => Object.assign(document.createElement('span'), { textContent: txt, className: cls });
  const ago = (t) => { const m = Math.max(0, Math.round((now - t) / 60e3)); return m < 1 ? 'şimdi' : m < 90 ? `${m} dk önce` : 'eski bilgi'; };
  const wrap = document.createElement('span');
  let first = true;
  const add = (node) => { wrap.append(first ? lead : ' · ', node); first = false; };
  const o = officialUi(sl, now);
  if (o) { // resmî ya da operatör verisi: yalnız Müsait / Dolu / Bilinmiyor
    const c = document.createElement('span');
    c.append(span(OCC_UI_LABELS[o.ui], `occ-state occ-${o.ui}`));
    if (o.ui !== 'unknown') c.append(' · ', span(`${o.available}/${o.total}`), ' · ', span(o.ageMin < 1 ? 'şimdi' : `${o.ageMin} dk önce`));
    add(c);
  }
  const cm = communityReport(sl, { now }); // topluluk (resmî değil, K3): şu an şarj edenler ve son ≤60 dk Dolu/Boş bildirimi
  if (cm?.busy > 0) add(span(`👥 ${cm.busy} araç şarj ediyor`));
  if (cm?.report) {
    const c = document.createElement('span');
    c.append(span(cm.report.status === 'full' ? '🔴 Dolu bildirildi' : '🟢 Boş bildirildi'), ' · ', span(ago(cm.report.at)));
    add(c);
  }
  if (o && o.ui !== 'unknown' && (sl.src === 'google' || sl.src === 'here' || sl.src === 'tomtom')) { // Google Places kuralı: Google verisi Google Maps adıyla belirtilir (çevrilmez, silinmez); HERE ve TomTom verisi de kendi adıyla. Bilinmiyor'da sağlayıcı verisi gösterilmediği için atıf yok
    const g = span(sl.src === 'here' ? 'HERE' : sl.src === 'tomtom' ? 'TomTom' : 'Google Maps');
    g.translate = false;
    g.className = 'attrib';
    wrap.append(' · ', g);
  }
  return first ? null : wrap;
}

/** Canlı kWh fiyatı: { text: "€0.42/kWh (canlı)", extra: ek ücret (oturum/süre) var mı } ya da null. */
export function livePrice(s) {
  const p = s.slots?.price;
  if (!p || p.kwh == null) return null;
  const sym = p.currency === 'EUR' ? '€' : p.currency === 'TRY' ? '₺' : `${p.currency} `;
  const how = p.src === 'user' ? 'bildirilen' : p.src === 'veriapi' ? 'tarife · VeriApi.Pro' : 'canlı'; // NDW/OCPI canlı; kullanıcı bildirimi (fiyat defteri) son bilinen; VeriApi.Pro: işletmecinin yayımladığı genel tarife (atıf ücretsiz planda şart)
  return { text: `${sym}${p.kwh.toFixed(2)}/kWh (${how})`, extra: !!(p.flat || p.hour || p.parkingHour) };
}

/** Planlama için doluluk bilgisi yeterince taze mi? */
export const isFresh = (s) => !!s.slots && Date.now() - (s.slots.checked || 0) < FRESH_MS;

/** Ekran metni (slotEl ile aynı karar): "🟢 Müsait · 3/4 · 2 dk önce", "🔴 Dolu · 0/4 · şimdi", "⚪ Bilinmiyor"; doluluk verisi yoksa boş metin. */
export function slotLabel(s) {
  const o = officialUi(s?.slots, Date.now());
  if (!o) return '';
  if (o.ui === 'unknown') return OCC_UI_LABELS.unknown;
  return `${OCC_UI_LABELS[o.ui]} · ${o.available}/${o.total} · ${o.ageMin < 1 ? 'şimdi' : `${o.ageMin} dk önce`}`;
}
