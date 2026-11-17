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
export function stopWaypoints({ coords, stops, stopover = null, stopoverKm = null, fromKm = 0, offKm = VIA_OFF_KM, max = MAX_VIA, force = false, hasVia = null }) {
  const ahead = (stops || []).filter((s) => s?.km > fromKm + 0.5 && okPt(s.station));
  // v0.99.107 force: çizgiye yakın durak da ara nokta olur (karşı şerit tesisi çizgiye 60-110 m; rota yanından geçip girmiyordu).
  // hasVia(id): durak mevcut rotada zaten sağlayıcıya ara nokta olarak gönderildiyse yeniden rota gerekmez.
  const need = (s) => (force ? !(hasVia && hasVia(s.station.id)) : offRouteKm(coords, s.station) > offKm);
  if (!ahead.some(need)) return null;
  const list = ahead.map((s) => ({ km: s.km, lat: s.station.lat, lon: s.station.lon }));
  if (okPt(stopover) && Number.isFinite(stopoverKm) && !list.some((w) => Math.abs(w.lat - stopover.lat) < 1e-5 && Math.abs(w.lon - stopover.lon) < 1e-5)) {
    list.push({ km: stopoverKm, lat: stopover.lat, lon: stopover.lon });
  }
  if (list.length > max) return null;
  return list.sort((a, b) => a.km - b.km).map(({ lat, lon }) => ({ lat, lon }));
}

// ---------- v0.99.107 Ara nokta tutarlılığı: planda görünen durak sağlayıcının rotasında GERÇEKTEN ziyaret ediliyor mu? ----------
/** Ara nokta rotası istasyona bundan yakın geçmeli (km). Sağlayıcı ara noktayı en yakın yola oturtur; tesis içi yol istasyona ≤ 50 m. */
export const VIA_REACH_KM = 0.05;
/** Bu yarıçap içinde rotanın ayrı geçiş sayısı sayılır (km). Doğru taraf tesis: tek geçiş (çık-gir-katıl). Karşı şerit: dönüşlerle ≥ 2. */
export const PASS_KM = 0.35;

/** Rotanın p'ye PASS_KM içinde kaç AYRI geçişi var (ardışık yakın parçalar tek geçiş). Geri dönüş (U) karşı şerit erişiminin izidir. */
export function passCount(coords, p, passKm = PASS_KM) {
  if (!Array.isArray(coords) || coords.length < 2 || !okPt(p)) return 0;
  let runs = 0;
  let inside = false;
  for (let i = 0; i + 1 < coords.length; i++) {
    const near = offRouteKm([coords[i], coords[i + 1]], p) <= passKm;
    if (near && !inside) runs++;
    inside = near;
  }
  return runs;
}

/**
 * İleri durakların rota tutarlılığı (saf). viaIds: mevcut rota isteğinde sağlayıcıya ara nokta olarak gönderilen istasyon kimlikleri.
 * Sorun nedenleri: 'novia' (rota bu durak ara nokta yapılarak alınmadı — çizgi yanından geçebilir ama girmez), 'noreach' (rota istasyona
 * VIA_REACH_KM'den yakın geçmiyor: sağlayıcı ara noktayı başka yola oturttu), 'uturn' (istasyon çevresinde birden çok geçiş: karşı şeride
 * kavşaktan dönüp gelme). Dönüş: { ok, issues: [{ id, name, reason, pinned }] }.
 */
export function viaCheck({ coords, stops, fromKm = 0, viaIds = [], pinIds = [] }) {
  const via = new Set(viaIds || []);
  const pins = new Set(pinIds || []);
  const issues = [];
  for (const s of stops || []) {
    const st = s?.station;
    if (!st || !(s.km > fromKm + 0.5)) continue;
    let reason = null;
    if (!via.has(st.id)) reason = 'novia';
    else if (offRouteKm(coords, st) > VIA_REACH_KM) reason = 'noreach';
    else if (passCount(coords, st) > 1) reason = 'uturn';
    if (reason) issues.push({ id: st.id, name: st.name || '', reason, pinned: pins.has(st.id) });
  }
  return { ok: !issues.length, issues };
}
