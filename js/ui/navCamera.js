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

/**
 * Navigasyon takip kamerasında aracın ekrandaki yeri (v0.99.33). Görünür harita alanı: üst panelin altı ile aracın sütununu örten
 * alt kontrollerin üstü arası. Araç bu alanın ALT kenarından ~%10 yukarıda (üstten frac = %90) durur; ok çizimi noktanın altına
 * arrowHalf piksel taştığından alt kenara en az arrowHalf + margin kalır. Hiçbir durumda harita merkezinin üstüne çıkmaz.
 * @param {{ mapH: number, top?: number, bottom?: number, arrowHalf?: number, margin?: number, frac?: number }} o
 *   mapH: harita yüksekliği (px); top/bottom: üstten/alttan örtülen piksel (güvenli alan, panel, düğmeler)
 * @returns {number} araç noktasının harita merkezinden aşağı uzaklığı (px, >= 0)
 */
export function followAnchorPx({ mapH, top = 0, bottom = 0, arrowHalf = 15, margin = 10, frac = 0.9 }) {
  if (!(mapH > 0)) return 0;
  const visTop = Math.min(Math.max(top, 0), mapH);
  const visBot = Math.max(Math.min(mapH - Math.max(bottom, 0), mapH), visTop);
  let y = visTop + (visBot - visTop) * frac;
  y = Math.min(y, visBot - arrowHalf - margin); // ok alt kontrollerin/kenarın altına girmesin
  return Math.max(0, y - mapH / 2);
}

/**
 * Ekranda merkezin dy piksel altındaki zemin noktasının merkeze yer uzaklığı (merkez ölçeğinde piksel; x metre/piksel = metre).
 * Eğimli perspektif kamera: MapLibre/Mapbox görüş açısı 36.87° → kamera merkeze 1.5 x harita yüksekliği uzakta. Eğim 0 iken = dy.
 */
export function groundAheadPx(dy, mapH, tiltDeg = 0) {
  if (!(mapH > 0) || !(dy > 0)) return 0;
  const D = 1.5 * mapH;
  const t = (Math.min(Math.max(tiltDeg || 0, 0), 85) * Math.PI) / 180;
  const a = Math.atan(dy / D);
  return D * Math.sin(t) - D * Math.cos(t) * Math.tan(t - a);
}
