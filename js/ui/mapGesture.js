// Haritada kullanıcı hareketi algılama (v0.99.101, saf; mapView.js ve maps/* kullanır, scripts/test-nav-free-explore.mjs dener).
// Navigasyonda kullanıcı haritayı sürükler, iki parmakla yakınlaştırır/döndürür/eğer, tekerlekle ya da çift dokunmayla zoom yaparsa
// yalnızca kamera takibi durur (Ortala ile döner). Programatik kamera hareketleri (jumpTo/easeTo) takibi durdurmaz.

/** Harita kabında izlenen DOM olayları: sağlayıcıdan bağımsız (Google dahil) ve hareketin ilk anında (motor eşiğinden önce). */
export const DOM_GESTURE_EVENTS = ['touchstart', 'wheel', 'gesturestart', 'dblclick'];

/** DOM olayı kullanıcının haritayı yakınlaştırma/döndürme isteği mi? Tek parmak dokunuş sayılmaz (dokunma; sürükleme dragstart'la gelir). */
export function isDomUserGesture(type, ev) {
  if (type === 'touchstart') return (ev?.touches?.length ?? 0) >= 2; // pinch / iki parmakla döndürme-eğme
  return type === 'wheel' || type === 'gesturestart' || type === 'dblclick'; // tekerlek/dokunmatik yüzey, iOS Safari pinch, çift tıklama
}

/** MapLibre/Mapbox olayı kullanıcı kaynaklı mı? Kullanıcı hareketlerinde originalEvent bulunur; jumpTo/easeTo'da bulunmaz. */
export function isEngineUserGesture(type, ev) {
  if (type === 'dragstart') return true;
  return (type === 'zoomstart' || type === 'rotatestart' || type === 'pitchstart') && !!ev?.originalEvent;
}

/** Harita kabında pinch/tekerlek/çift tıklamayı izler (pasif, yakalama evresi: haritanın kendi işleyişini engellemez). Kaldırıcı döner. */
export function watchMapGestures(el, fn) {
  if (!el) return () => {};
  const opts = { passive: true, capture: true };
  const subs = DOM_GESTURE_EVENTS.map((type) => {
    const h = (ev) => { if (isDomUserGesture(type, ev)) fn(type); };
    el.addEventListener(type, h, opts);
    return [type, h];
  });
  return () => subs.forEach(([type, h]) => el.removeEventListener(type, h, opts));
}

/** MapLibre/Mapbox haritası: kullanıcı sürükleme, pinch zoom, çift dokunma zoom, iki parmakla döndürme/eğme başlangıcında fn(ev). */
export function bindEngineGestures(map, fn) {
  ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((type) => {
    map.on(type, (ev) => { if (isEngineUserGesture(type, ev)) fn(ev); });
  });
}
