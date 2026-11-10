// Şarj oturumu makullük denetimi (saf, DOM'suz): ortalama güç aracın DC sınırının biraz üstünü aşamaz.
// Elle pil düzeltmesi ya da okuma kesintisi "5 dakikada %38 = 416 kW" gibi imkânsız kayıtlar üretebilir;
// bunlar geçmişe yazılmaz (ve "Fiyat bildir" ile topluluğa gitmez).
export const POWER_SLACK = 1.3; // ölçüm gürültüsü payı

/** kWh ve dk'dan ortalama kW (dk ≤ 0 ise null). */
export const avgKw = (kwh, min) => (min > 0 ? kwh / (min / 60) : null);

/** Ortalama güç maxKw × POWER_SLACK'i aşmıyorsa makul. maxKw yoksa denetlenemez: makul sayılır. */
export function plausibleCharge({ kwh, min, maxKw }) {
  const p = avgKw(kwh, min);
  if (p == null || !(maxKw > 0)) return p != null;
  return p <= maxKw * POWER_SLACK;
}
