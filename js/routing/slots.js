// Şarj yuvası (konnektör) doluluğu: `evChargeOptions.connectorAggregation` biçimindeki (şu an hiçbir kaynak sunmuyor) alanlardan
// (count, availableCount, outOfServiceCount, availabilityLastUpdateTime). Bilgi yalnızca bazı ağlar için vardır.
// D3-T4: ARAYÜZ (slotEl / slotLabel) resmî doluluğu yalnız üç durumla gösterir — 🟢 Müsait / 🔴 Dolu / ⚪ Bilinmiyor (K5) — ve
// kararı saf occupancyDecision'dan alır (sağlayıcı zaman damgası yoksa ya da 15 dk'dan eskiyse Bilinmiyor). Topluluk satırları
// communityReport modelinden, resmî durumdan ayrı (K3).
// D3-T5: TÜKETİCİ kararları (slotKind / isFresh → planlayıcı, rota seçenekleri, düşük pil önerisi, yakın istasyon sıralaması,
// sesli uyarı) aynı karara bağlandı: yalnız doğrulanmış resmî doluluk (occupancyDecision trusted + sunucu vetosu yok) 'free' /
// 'full' / 'out' olur; zaman damgasız, 15 dk'dan eski, NDW 0/N, simüle ve topluluk bildirimi → 'unknown' (ne müsait ne dolu).
import { occupancyDecision } from './occupancyDecision.js';
import { communityReport } from './communityReport.js';

export const FRESH_MS = 15 * 60e3; // planlamada doluluk bu kadar tazeyse dikkate alınır
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

/**
 * Doğrulanmış resmî doluluk kararı ya da null. Tek karar noktası (arayüz + tüketiciler): saf occupancyDecision trusted olmalı
 * VE sunucu kararı (server/availability.mjs `decision`, occupancyClient aynen taşır) varsa güvenilir demeli (yoksa fail-closed).
 * Sunucu kararı tek başına Müsait/Dolu yapmaz; istemci kararı (saat, AGE) ayrıca gerekir. Topluluk bildirimi burada YOK (K3).
 */
function trustedOccupancy(sl, now) {
  if (!sl || typeof sl !== 'object') return null;
  const d = occupancyDecision(sl, { now });
  const veto = sl.decision != null && (typeof sl.decision !== 'object' || sl.decision.trusted !== true);
  return d.trusted && !veto ? d : null;
}

/** 'unknown' | 'out' (tamamı arızalı) | 'full' (boş yuva yok) | 'free' — yalnız doğrulanmış resmî doluluktan (D3-T5). */
export function slotKind(s, now = Date.now()) {
  const d = trustedOccupancy(s?.slots, now);
  if (!d) return 'unknown';
  return d.state === 'free' ? 'free' : d.state === 'busy' ? 'full' : d.state === 'out' ? 'out' : 'unknown';
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
  const d = trustedOccupancy(sl, now);
  if (!d) return { ui: 'unknown', available: null, total: null, ageMin: null };
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

// D3-T5 (K6): "canlı" fiyat etiketi yalnız bağımsız olarak doğrulanmış, güncel, resmî fiyata verilir.
export const PRICE_LIVE_SOURCES = Object.freeze(['ndw', 'ocpi']); // resmî açık veri (AFIR / OCPI); topluluk (user), VeriApi.Pro tarifesi, diğerleri değil
export const PRICE_LIVE_MAX_AGE_MS = 6 * 3600e3; // sağlayıcı zamanı en çok bu kadar eski (sunucunun OCPI tarife önbelleği süresi)
const PRICE_SKEW_MS = 2 * 60e3; // saat kayması payı (gelecekteki zaman damgası)
const toMs = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Date.parse(v) : NaN);

/**
 * Fiyat "canlı" gösterilebilir mi? Kaynak adına güvenmeden istemcide denetlenir: resmî kaynak, kWh > 0, geçerli para birimi,
 * SAĞLAYICI zaman damgası price.at (doluluk okuma anı slots.at / slots.checked sayılmaz), gelecekte değil, ≤ PRICE_LIVE_MAX_AGE_MS
 * ve sağlayıcının verdiği geçerlilik sonu (expires / validUntil) geçmemiş. Açıkça verified:false ise canlı değil. Şüphede false.
 */
export function isLivePrice(p, now = Date.now()) {
  if (!p || typeof p !== 'object' || Array.isArray(p) || !Number.isFinite(now)) return false;
  if (!PRICE_LIVE_SOURCES.includes(p.src) || p.verified === false) return false;
  if (typeof p.kwh !== 'number' || !Number.isFinite(p.kwh) || p.kwh <= 0) return false;
  if (typeof p.currency !== 'string' || !/^[A-Z]{3}$/i.test(p.currency.trim())) return false;
  const at = toMs(p.at);
  if (!Number.isFinite(at) || at <= 0 || at - now > PRICE_SKEW_MS || now - at > PRICE_LIVE_MAX_AGE_MS) return false;
  for (const k of ['expires', 'validUntil']) {
    if (p[k] == null) continue;
    const end = toMs(p[k]);
    if (!Number.isFinite(end) || end <= now) return false;
  }
  return true;
}

/**
 * kWh fiyat metni: { text, extra: ek ücret (oturum/süre) var mı, live: "canlı" mı } ya da null.
 * "(canlı)" yalnız isLivePrice; kullanıcı bildirimi "(bildirilen)"; VeriApi.Pro tarifesi atıflı; diğerleri (zaman damgasız / eski /
 * bilinmeyen kaynak) niteleyicisiz fiyat — asla "canlı" değil.
 */
export function livePrice(s, now = Date.now()) {
  const p = s?.slots?.price;
  if (!p || typeof p.kwh !== 'number' || !Number.isFinite(p.kwh)) return null;
  const sym = p.currency === 'EUR' ? '€' : p.currency === 'TRY' ? '₺' : `${p.currency} `;
  const live = isLivePrice(p, now);
  const how = live ? 'canlı' : p.src === 'user' ? 'bildirilen' : p.src === 'veriapi' ? 'tarife · VeriApi.Pro' : null; // VeriApi.Pro: işletmecinin yayımladığı genel tarife (atıf ücretsiz planda şart)
  return { text: `${sym}${p.kwh.toFixed(2)}/kWh` + (how ? ` (${how})` : ''), extra: !!(p.flat || p.hour || p.parkingHour), live };
}

/** Planlama için doluluk bilgisi doğrulanmış ve güncel mi? (sağlayıcı zamanı ≤ 15 dk; okuma anı `checked` tazelik sayılmaz) */
export const isFresh = (s, now = Date.now()) => !!trustedOccupancy(s?.slots, now);

/** Ekran metni (slotEl ile aynı karar): "🟢 Müsait · 3/4 · 2 dk önce", "🔴 Dolu · 0/4 · şimdi", "⚪ Bilinmiyor"; doluluk verisi yoksa boş metin. */
export function slotLabel(s) {
  const o = officialUi(s?.slots, Date.now());
  if (!o) return '';
  if (o.ui === 'unknown') return OCC_UI_LABELS.unknown;
  return `${OCC_UI_LABELS[o.ui]} · ${o.available}/${o.total} · ${o.ageMin < 1 ? 'şimdi' : `${o.ageMin} dk önce`}`;
}
