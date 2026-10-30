const toRad = (d) => (d * Math.PI) / 180;

/** İki nokta arası büyük daire mesafesi (km). */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

/** a → b başlangıç yönü, 0..360 derece (0 = kuzey). */
export function bearing(a, b) {
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** İki açı (derece) arasındaki işaretli fark, -180..180. */
export function angleDiff(a, b) {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * Rüzgarın aracın gidiş eksenindeki bileşeni.
 * windFrom: rüzgarın GELDİĞİ yön (meteorolojik, derece), heading: aracın gidiş açısı.
 * Dönüş: pozitif = kafa rüzgarı, negatif = arka rüzgar (aynı birim: windSpeed).
 */
export function headwindComponent(windSpeed, windFrom, heading) {
  return windSpeed * Math.cos(toRad(angleDiff(windFrom, heading)));
}

const COMPASS = ['K', 'KKD', 'KD', 'DKD', 'D', 'DGD', 'GD', 'GGD', 'G', 'GGB', 'GB', 'BGB', 'B', 'BKB', 'KB', 'KKB'];
export function compass(deg) {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
