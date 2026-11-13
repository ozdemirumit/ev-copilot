// Planlanan şarj duraklarını rotanın ZORUNLU ara noktası yapma kararı (saf; ağ/DOM yok).
// Planlayıcı istasyonları rota çizgisinin 3 km'lik koridorundan seçer ve sapmayı yalnızca enerji/süre olarak hesaplar; rota sağlayıcısına
// giden ara noktalar ise yalnızca kullanıcı ara durağı ve "Git" istasyonuydu. Otoyoldan ayrılmayı gerektiren istasyonda mavi çizgi
// istasyona uğramadan otoyolda devam ediyordu. Bu modül, hangi durakların ara nokta olarak sağlayıcıya gönderileceğini belirler.

/** Durak rotaya bundan uzaksa (km) rota onun üzerinden yeniden alınır. Navigasyonun rotadan çıkış alt sınırıyla aynı (navigator.js 0,15 km). */
export const VIA_OFF_KM = 0.15;
/** Sağlayıcı sınırı: Mapbox başlangıç+varış dahil 25 nokta, TomTom 24 ara nokta. Aşılırsa ara nokta rotası denenmez. */
export const MAX_VIA = 23;

/**
 * Noktanın tam çözünürlüklü rota çizgisine en kısa uzaklığı (km). coords: [[lon, lat], …] (sağlayıcının çizgisi; 2 km'lik örnekleme değil,
 * çünkü kıvrımda kiriş uzaklığı yanıltır). Geçersiz girdide Infinity.
 */
export function offRouteKm(coords, p) {
  if (!Array.isArray(coords) || !coords.length || !Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) return Infinity;
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const ax = (coords[i][0] - p.lon) * kx;
    const ay = (coords[i][1] - p.lat) * ky;
    if (i + 1 >= coords.length) { best = Math.min(best, Math.hypot(ax, ay)); break; }
    const bx = (coords[i + 1][0] - p.lon) * kx;
    const by = (coords[i + 1][1] - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}

const okPt = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon);

/**
 * Rota sağlayıcısına gönderilecek ara noktalar ya da null (yeni rota gerekmez / kurulamaz).
 * İleri duraklardan (km > fromKm) en az biri rota çizgisinden VIA_OFF_KM'den uzaksa: ileri durakların HEPSİ (rota sırasıyla) ve varsa
 * kullanıcının ara durağı (stopoverKm'e göre araya) zorunlu ara nokta olur. Hepsi yol üstündeyse null: mevcut davranış aynen kalır.
 * Dönüş öğeleri yalnızca { lat, lon } taşır.
 */
export function stopWaypoints({ coords, stops, stopover = null, stopoverKm = null, fromKm = 0, offKm = VIA_OFF_KM, max = MAX_VIA }) {
  const ahead = (stops || []).filter((s) => s?.km > fromKm + 0.5 && okPt(s.station));
  if (!ahead.some((s) => offRouteKm(coords, s.station) > offKm)) return null;
  const list = ahead.map((s) => ({ km: s.km, lat: s.station.lat, lon: s.station.lon }));
  if (okPt(stopover) && Number.isFinite(stopoverKm) && !list.some((w) => Math.abs(w.lat - stopover.lat) < 1e-5 && Math.abs(w.lon - stopover.lon) < 1e-5)) {
    list.push({ km: stopoverKm, lat: stopover.lat, lon: stopover.lon });
  }
  if (list.length > max) return null;
  return list.sort((a, b) => a.km - b.km).map(({ lat, lon }) => ({ lat, lon }));
}
