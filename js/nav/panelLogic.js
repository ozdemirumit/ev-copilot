// Navigasyon üst paneli mantığı (DOM'suz, node ile test edilir): dönüşümlü uyarı seçimi ve ince hız çubuğu ölçüleri.

export const ALERT_MS = 3000; // trafik ve yağış uyarıları bu aralıkla dönüşümlü gösterilir
export const BAR_MAX_KMH = 140; // limit bilinmiyorsa çubuk ölçeği
export const OVER_TOL_KMH = 5; // limitin bu kadar üstü "aşıldı" (GPS payı; ahead.js yol limiti toleransıyla aynı)

/** Dönüşümlü uyarı: yalnızca gerçek (dolu metin) uyarılar sırayla döner; hiç yoksa null (uydurma uyarı gösterilmez). */
export function pickAlert(items, tick) {
  const list = (items || []).filter((x) => typeof x === 'string' && x.trim());
  return list.length ? list[Math.abs(Math.trunc(tick) || 0) % list.length] : null;
}

/**
 * İnce hız çubuğu: pct = hızın ölçekteki yeri (%), limitPct = limit işaretinin yeri (limit yoksa null), over = limit aşıldı.
 * Ölçek: limit varsa limitin %130'u, yoksa 140 km/s; hız ölçeği aşarsa çubuk dolu kalır.
 */
export function speedBar(speed, limit) {
  const v = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const lim = Number.isFinite(limit) && limit > 0 ? limit : null;
  const scale = lim ? lim * 1.3 : BAR_MAX_KMH;
  const clamp = (x) => Math.round(Math.min(100, Math.max(0, x)) * 10) / 10;
  return { pct: clamp((v / scale) * 100), limitPct: lim ? clamp((lim / scale) * 100) : null, over: lim != null && v > lim + OVER_TOL_KMH };
}
