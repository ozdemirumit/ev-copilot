// Yakınımdaki istasyonlar: En yakın / En ucuz / En hızlı sıralaması. DOM kullanmaz (test edilebilir).
// Fiyat uydurulmaz: yalnızca chargePick.priceStatus "known" diyen fiyatlar sıralanır; tahmini/bilinmeyen fiyatlar etiketlenir ve
// bilinen fiyatlardan SONRA gelir. Güç: kayıtta yazan kW (knownKw); varsayılan/eksik kW etiketlenir ve en hızlıda sona gelir.
// Doluluk: arızalı ya da taze "dolu" istasyonlar her sıralamada sona alınır; eski (bayat) doluluk "boş" sayılmaz.
import { priceStatus, knownKw } from './chargePick.js';
import { slotKind, FRESH_MS } from '../routing/slots.js';

export const NEAR_SORTS = ['near', 'cheap', 'fast'];
export const NEAR_SORT_TITLE = { near: 'En yakın', cheap: 'En ucuz', fast: 'En hızlı' };

/**
 * Ekranda gösterilecek doluluk durumu: 'free' (taze boş), 'full' (taze dolu ya da süresi geçmemiş topluluk bildirimi),
 * 'out' (arızalı), 'stale' (sayısal veri var ama FRESH_MS'ten eski: boş/dolu denmez), 'unknown'.
 */
export function availability(s, now = Date.now()) {
  const k = slotKind(s);
  const sl = s?.slots;
  if (!sl || sl.available == null) return k; // topluluk bildirimi slotKind içinde zaman sınırlı
  const t = sl.checked ?? sl.at;
  const fresh = typeof t === 'number' && now - t >= 0 && now - t < FRESH_MS;
  if (!fresh) return 'stale';
  return k;
}

const unusable = (s, now) => { const a = availability(s, now); return a === 'out' || a === 'full'; };
const dist = (s) => (Number.isFinite(s?.distKm) ? s.distKm : Infinity);
const tie = (a, b) => dist(a) - dist(b) || String(a.id ?? '').localeCompare(String(b.id ?? ''));

/** Fiyat etiketi: bilinen fiyatta null; tahmini fiyatta "≈x TL/kWh (tahmini)"; değilse "Fiyat bilinmiyor". */
export function priceLabel(s) {
  const ps = priceStatus(s);
  if (ps.known) return null;
  if (ps.reason === 'estimate' && typeof s.price === 'number' && s.price > 0) return `≈${s.price.toFixed(2)} TL/kWh (tahmini)`;
  return 'Fiyat bilinmiyor';
}

/** Güç etiketi: kaynakta yazan kW ise null; varsayılan/eksikse "≈x kW (tahmini)" ya da "Güç bilinmiyor". */
export function powerLabel(s) {
  if (knownKw(s) != null) return null;
  return typeof s.kw === 'number' && s.kw > 0 ? `≈${s.kw} kW (tahmini)` : 'Güç bilinmiyor';
}

/** Karşılaştırmanın para birimi: en çok bilinen fiyatı olan; eşitlikte alfabetik (belirlenimci). */
function mainCurrency(infos) {
  const n = new Map();
  for (const i of infos) n.set(i.currency, (n.get(i.currency) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/**
 * list: enrich() sonrası istasyonlar (distKm, kw, srcKw, uncertain, price, tariff, slots…). Girdi değiştirilmez.
 * Dönüş: { list, unknown, unusable }. unknown: seçilen ölçütte değeri bilinmeyip sona alınan istasyon sayısı;
 * unusable: arızalı/taze dolu olduğu için sona alınan istasyon sayısı.
 * Eşitlikte mesafe, sonra id (belirlenimci).
 */
export function sortNearby(list = [], by = 'near', now = Date.now()) {
  const rows = list.filter(Boolean).map((s) => ({ s, ps: priceStatus(s), kw: knownKw(s), bad: unusable(s, now) }));
  let key; // [grup, değer] — küçük önce
  let unknown = 0;
  if (by === 'cheap') {
    const cur = mainCurrency(rows.filter((r) => r.ps.known && r.ps.comparable).map((r) => r.ps));
    key = (r) => {
      if (r.ps.known && r.ps.comparable && r.ps.currency === cur) return [0, r.ps.value];
      if (r.ps.known) return [1, 0]; // ek ücretli ya da başka para birimi: bilinir ama karşılaştırılmaz
      return [2, 0]; // tahmini/bilinmeyen: her zaman bilinenlerden sonra
    };
    unknown = rows.filter((r) => !r.ps.known).length;
  } else if (by === 'fast') {
    key = (r) => (r.kw != null ? [0, -r.kw] : [1, 0]);
    unknown = rows.filter((r) => r.kw == null).length;
  } else {
    key = () => [0, 0];
  }
  const sorted = rows.sort((a, b) => {
    if (a.bad !== b.bad) return a.bad ? 1 : -1;
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || tie(a.s, b.s);
  });
  return { list: sorted.map((r) => r.s), unknown, unusable: rows.filter((r) => r.bad).length };
}

/** Sıralama altındaki kısa not (boşsa ''). */
export function sortNote(by, res) {
  const parts = [];
  if (by === 'cheap' && res.unknown) parts.push(`${res.unknown} istasyonun fiyatı bilinmiyor ya da tahmini; bilinen fiyatlardan sonra listelendi`);
  if (by === 'fast' && res.unknown) parts.push(`${res.unknown} istasyonun gücü kayıtta yok; sona alındı`);
  if (res.unusable) parts.push(`${res.unusable} dolu/arızalı istasyon sona alındı`);
  return parts.join(' · ');
}
