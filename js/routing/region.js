// Türkiye sınırı (kaba çokgen, [boylam, enlem]). Liste fiyatı (operatör tablosu) yalnızca Türkiye için geçerlidir: dışında istasyonun gerçek
// tarifesi bilinmiyorsa fiyat gösterilmez. Sınır yakın adalarda (Midilli, Sakız, Sisam, İstanköy, Rodos) ve komşu sınır kasabalarında
// birkaç km sapabilir; amaç istasyonun hangi ülkede olduğunu kabaca ayırmaktır.
const TR = [
  [26.36, 41.71], [26.6, 42.0], [27.5, 42.05], [28.03, 41.98], [28.5, 42.2], [35.0, 42.3], [36.5, 41.95], [40.5, 41.7],
  [41.55, 41.58], [41.9, 41.45], [42.6, 41.6], [43.45, 41.1], [43.6, 40.7], [43.75, 40.2], [44.3, 40.05], [44.82, 39.7],
  [44.55, 39.4], [44.4, 38.9], [44.3, 38.3], [44.3, 37.6], [44.5, 37.15], [42.4, 37.12], [41.2, 37.05], [40.1, 36.83],
  [38.5, 36.88], [38.0, 36.82], [37.0, 36.68], [36.65, 36.55], [36.55, 36.2], [36.35, 36.0], [35.95, 35.85], [35.6, 36.3],
  [34.5, 36.3], [33.0, 35.95], [32.0, 36.25], [30.2, 36.1], [29.5, 36.0], [28.6, 36.5], [28.3, 36.58], [27.55, 36.68],
  [27.3, 37.0], [27.1, 37.3], [27.1, 37.65], [26.9, 38.05], [26.24, 38.25], [26.25, 38.6], [26.35, 38.8], [26.65, 39.0],
  [26.65, 39.3], [26.4, 39.35], [26.0, 39.43], [25.9, 39.6], [25.6, 39.83], [25.6, 40.2], [25.8, 40.5], [26.05, 40.75],
  [26.33, 40.9], [26.5, 41.1], [26.65, 41.4], [26.55, 41.62],
];

/** Nokta Türkiye'de mi (ışın atma yöntemi). */
export function inTurkey(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true; // konum bilinmiyorsa eski davranış (liste fiyatı)
  let inside = false;
  for (let i = 0, j = TR.length - 1; i < TR.length; j = i++) {
    const [xi, yi] = TR[i];
    const [xj, yj] = TR[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
