// SOC güven kapısı (saf, yan etkisiz). Plan beklentisinden pil sapması yalnızca güvenilir bir kaynaktan geliyorsa otomatik yeniden
// planı tek başına tetikleyebilir. Güvenilir: 'live' (taze kamera okuması), 'manual' (kullanıcının elle girdiği), 'sim' (Test Modu sürgüsü).
// Güvenilmeyen: 'stale' (eski kamera), 'estimate' (son değerden tahmin), 'default' (varsayılan %80), 'none' — bunlar tüketim modelinden
// türediği için plan beklentisinden "sapmaları" ölçüm değildir. Geçilen durak ve mesafe tazelemesi kaynaktan bağımsız çalışmaya devam eder.

export const TRUSTED_SOC_SOURCES = Object.freeze(['live', 'manual', 'sim']);

/** Bu pil kaynağı (physics/socEstimate.js socSource() ya da Test Modu 'sim') SOC farkıyla yeniden plan tetikleyebilir mi? */
export const socTrusted = (source) => TRUSTED_SOC_SOURCES.includes(source);

/**
 * Canlı planı yeniden hesaplamak gerekiyor mu?
 * passed: bir durak geride kaldı; far: tazeleme mesafesi aşıldı; drift: plan beklentisinden sapma (puan); tolerance: sapma eşiği (puan).
 */
export function shouldReplan({ passed = false, far = false, drift = 0, tolerance, source } = {}) {
  if (passed || far) return true;
  return drift > tolerance && socTrusted(source);
}
