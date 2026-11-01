// Şarj yuvası (konnektör) doluluğu: `evChargeOptions.connectorAggregation` biçimindeki (şu an hiçbir kaynak sunmuyor) alanlardan
// (count, availableCount, outOfServiceCount, availabilityLastUpdateTime). Bilgi yalnızca bazı ağlar için vardır.

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

/**
 * Doluluk öğesi: " · 🟢 3/4 boş · 2 dk önce" (kalıp, durum ve yaş AYRI metin düğümleridir: uzun satırın sonuna eklenen metin çeviri
 * kalıplarını bozmasın, her parça kendi anahtarıyla çevrilir). Bilinmiyorsa null.
 */
export function slotEl(s, lead = ' · ') {
  const sl = s.slots;
  if (!sl) return null;
  const k = slotKind(s);
  const span = (txt) => Object.assign(document.createElement('span'), { textContent: txt });
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60e3)); return m < 1 ? 'şimdi' : m < 90 ? `${m} dk önce` : 'eski bilgi'; };
  const wrap = document.createElement('span');
  let first = true;
  const add = (node) => { wrap.append(first ? lead : ' · ', node); first = false; };
  if (sl.available != null) { // resmî ya da operatör verisi: sayılar
    const status = k === 'out' ? '⚫ arızalı' : k === 'full' ? `🔴 dolu (0/${sl.total})` : `🟢 ${sl.available}/${sl.total} boş`;
    const t = sl.at ?? sl.checked;
    const c = document.createElement('span');
    c.append(span(status));
    if (t) c.append(' · ', span(ago(t)));
    add(c);
  }
  const cm = sl.community; // topluluk (resmî veri olmayan yerler): şu an şarj edenler ve son Dolu/Boş bildirimi
  if (cm?.busy > 0) add(span(`👥 ${cm.busy} araç şarj ediyor`));
  if (cm?.report) {
    const c = document.createElement('span');
    c.append(span(cm.report.status === 'full' ? '🔴 Dolu bildirildi' : '🟢 Boş bildirildi'), ' · ', span(ago(cm.report.at)));
    add(c);
  }
  return first ? null : wrap;
}

/** Canlı kWh fiyatı: { text: "€0.42/kWh (canlı)", extra: ek ücret (oturum/süre) var mı } ya da null. */
export function livePrice(s) {
  const p = s.slots?.price;
  if (!p || p.kwh == null) return null;
  const sym = p.currency === 'EUR' ? '€' : p.currency === 'TRY' ? '₺' : `${p.currency} `;
  const how = p.src === 'user' ? 'bildirilen' : 'canlı'; // NDW/OCPI canlı; kullanıcı bildirimi (fiyat defteri) son bilinen
  return { text: `${sym}${p.kwh.toFixed(2)}/kWh (${how})`, extra: !!(p.flat || p.hour || p.parkingHour) };
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
