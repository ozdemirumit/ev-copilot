// Navigasyon üst paneli mantığı (DOM'suz, node ile test edilir): dönüşümlü bilgi/uyarı seçimi ve hız aşımı.

export const ALERT_MS = 3000; // pil/varış/durak bilgisi ve gerçek uyarılar bu aralıkla dönüşümlü gösterilir
export const OVER_TOL_KMH = 5; // limitin bu kadar üstü "aşıldı" (GPS payı; ahead.js yol limiti toleransıyla aynı)

/** Dönüşümlü uyarı: yalnızca gerçek (dolu metin) uyarılar sırayla döner; hiç yoksa null (uydurma uyarı gösterilmez). */
export function pickAlert(items, tick) {
  const list = (items || []).filter((x) => typeof x === 'string' && x.trim());
  return list.length ? list[Math.abs(Math.trunc(tick) || 0) % list.length] : null;
}

/**
 * Hız aşımı: aynı güncel hız kaynağıyla (effective().speed) hem hız rengi hem uyarı metni hesaplanır.
 * Yol limiti biliniyorsa o (+5 km/s GPS payı), yoksa kullanıcının eşiği (+3); ikisi de yoksa ya da hız yoksa aşım yok.
 */
export function speedOver(speed, roadLimit, userLimit) {
  const road = Number.isFinite(roadLimit) && roadLimit > 0 ? roadLimit : null;
  const limit = road ?? (Number.isFinite(userLimit) && userLimit > 0 ? userLimit : null);
  if (limit == null || !Number.isFinite(speed)) return null;
  return speed > limit + (road ? OVER_TOL_KMH : 3) ? { kph: Math.round(speed), limit, road: road != null } : null;
}

/**
 * Sağ bölümdeki dönüşümlü hücre: slots = gösterilebilir öğeler (boşlar atlanır), over = hız aşımı var mı.
 * Aşımda her ikinci adım aşım uyarısıdır ('over'), arada diğer öğeler sırayla döner (önemli uyarılar tamamen engellenmez).
 */
export function pickSlot(slots, tick, over) {
  const list = (slots || []).filter(Boolean);
  const n = Math.abs(Math.trunc(tick) || 0);
  if (over) return n % 2 === 0 || !list.length ? 'over' : list[Math.floor(n / 2) % list.length];
  return list.length ? list[n % list.length] : null;
}

/** Varış saati dönüşümlü hücrede gösterilebilir mi: dolu, '--:--' değil, rakam içerir, "Invalid Date"/NaN değil (v0.99.51). */
export function etaShown(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  return !!s && s !== '--:--' && /\d/.test(s) && !/invalid|nan/i.test(s);
}
