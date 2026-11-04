// Menzil hesabı (saf, DOM'suz; node ile test edilir).
// Rota planlıysa ve araç rotadaysa önümüzdeki yolun enerji profiline göre (eğim, hız, rüzgâr, trafik dilim dilim);
// enerji rota sonuna yetiyorsa kalan yol + artan enerjiyle düz zemin tüketiminde devam; rota yoksa düz zemin tüketimiyle.
// Düz zemin kullanılır çünkü yerel eğim menzile yayılmamalı: kısa bir iniş (%3 bile) rejenerasyonla tüketimi ~1-6 kWh/100 km'ye indirir
// ve "bu eğim sonsuza dek sürer" varsayımıyla menzil 1000 km'yi aşardı.

/** Menzil rota profiline göre mi hesaplanır? (araç rotada, rotadan ≤ 3 km uzakta ve rota bitmemiş) */
export function usesRouteProfile({ prof, routeKm, offKm }) {
  return !!(prof && routeKm != null && offKm != null && offKm <= 3 && prof.totalKm - routeKm > 0.5);
}

/**
 * energyKwh: harcanabilir enerji (kWh) ya da null. estFlat: düz zemin tüketimi (kWh/100 km, > 0).
 * prof: rota profili ({ totalKm, energyBetween(fromKm, toKm, k) }) ya da null. routeKm/offKm: araç rotadaki km ve rotadan uzaklık (km).
 * kp: profil enerji düzeltme katsayısı. Dönüş: km ya da null.
 */
export function rangeForEnergy({ energyKwh, estFlat, prof, routeKm, offKm, kp }) {
  if (energyKwh == null) return null;
  let km = (energyKwh / estFlat) * 100;
  if (usesRouteProfile({ prof, routeKm, offKm })) {
    const toEnd = prof.energyBetween(routeKm, prof.totalKm, kp);
    if (toEnd <= energyKwh) {
      km = (prof.totalKm - routeKm) + ((energyKwh - toEnd) / estFlat) * 100;
    } else {
      let lo = routeKm;
      let hi = prof.totalKm;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (prof.energyBetween(routeKm, mid, kp) <= energyKwh) lo = mid; else hi = mid;
      }
      km = lo - routeKm;
    }
  }
  return km;
}
