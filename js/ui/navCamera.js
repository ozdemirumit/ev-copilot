// Navigasyon kamerası kararı (saf işlev; mapView.js kullanır, scripts/test-map-provider.mjs dener).
// 3B/2B seçimi yön kararından bağımsızdır: eğim ve 3B binalar yalnızca navigasyonda ve 3B seçiliyken; yön-yukarı haritayı döndürür,
// kuzey-yukarı (ya da navigasyon kapalı) yönü 0'a getirir.

/**
 * @param {boolean} on navigasyon açık mı
 * @param {boolean} up yön-yukarı mı (false: kuzey-yukarı)
 * @param {boolean} threeD 3B görünüm seçili mi (cihazda 'nav3d')
 * @returns {{ tilt: number, resetHeading: boolean, buildings: boolean }}
 */
export function navCamera(on, up, threeD) {
  const d3 = !!(on && threeD);
  return { tilt: d3 ? 40 : 0, resetHeading: !on || !up, buildings: d3 };
}
