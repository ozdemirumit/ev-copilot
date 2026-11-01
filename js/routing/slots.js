// Şarj yuvası (konnektör) doluluğu: `evChargeOptions.connectorAggregation` biçimindeki (şu an hiçbir kaynak sunmuyor) alanlardan
// (count, availableCount, outOfServiceCount, availabilityLastUpdateTime). Bilgi yalnızca bazı ağlar için vardır.

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

/** 'unknown' | 'out' (tamamı arızalı) | 'full' (boş yuva yok) | 'free' */
export function slotKind(s) {
  const sl = s.slots;
  if (!sl || sl.available == null) return 'unknown';
  if (sl.out >= sl.total) return 'out';
  if (sl.available <= 0) return 'full';
  return 'free';
}

/**
 * Doluluk öğesi: " · 🟢 3/4 boş · 2 dk önce" (kalıp, durum ve yaş AYRI metin düğümleridir: uzun satırın sonuna eklenen metin çeviri
 * kalıplarını bozmasın, her parça kendi anahtarıyla çevrilir). Bilinmiyorsa null.
 */
export function slotEl(s, lead = ' · ') {
  const k = slotKind(s);
  if (k === 'unknown') return null;
  const sl = s.slots;
  const t = sl.at ?? sl.checked;
  const age = t ? Math.max(0, Math.round((Date.now() - t) / 60e3)) : null;
  const status = k === 'out' ? '⚫ arızalı' : k === 'full' ? `🔴 dolu (0/${sl.total})` : `🟢 ${sl.available}/${sl.total} boş`;
  const when = age == null ? null : age < 1 ? 'şimdi' : age < 90 ? `${age} dk önce` : 'eski bilgi';
  const span = (txt) => Object.assign(document.createElement('span'), { textContent: txt });
  const wrap = document.createElement('span');
  wrap.append(lead, span(status));
  if (when) wrap.append(' · ', span(when));
  return wrap;
}

/** Canlı kWh fiyatı: { text: "€0.42/kWh (canlı)", extra: ek ücret (oturum/süre) var mı } ya da null. */
export function livePrice(s) {
  const p = s.slots?.price;
  if (!p || p.kwh == null) return null;
  const sym = p.currency === 'EUR' ? '€' : p.currency === 'TRY' ? '₺' : `${p.currency} `;
  return { text: `${sym}${p.kwh.toFixed(2)}/kWh (canlı)`, extra: !!(p.flat || p.hour || p.parkingHour) };
}

/** Planlama için doluluk bilgisi yeterince taze mi? */
export const isFresh = (s) => !!s.slots && Date.now() - (s.slots.checked || 0) < FRESH_MS;

/** Ekran metni: "🟢 3/4 boş · 2 dk önce", "🔴 dolu (0/4)", "⚫ arızalı", bilinmiyorsa boş metin. */
export function slotLabel(s) {
  const k = slotKind(s);
  if (k === 'unknown') return '';
  const sl = s.slots;
  const t = sl.at ?? sl.checked;
  const age = t ? Math.max(0, Math.round((Date.now() - t) / 60e3)) : null;
  const when = age == null ? '' : age < 1 ? ' · şimdi' : age < 90 ? ` · ${age} dk önce` : ' · eski bilgi';
  if (k === 'out') return '⚫ arızalı' + when;
  if (k === 'full') return `🔴 dolu (0/${sl.total})` + when;
  return `🟢 ${sl.available}/${sl.total} boş` + when;
}
