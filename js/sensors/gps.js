import { getState, patch } from '../state.js';
import { haversineKm, bearing } from '../utils/geo.js';
import { createCourseFilter } from '../nav/course.js';
import { guard, emitCatchup, STALE_FIX_MS } from './driveGuard.js';

const STILL_MS = 0.5; // m/s altında hızı 0 say (GPS titreşimi)
const BEARING_MIN_M = 8; // yön için en az bu kadar yer değiştirmiş olmalı
const RESUME_REWATCH_MS = 3000; // ön plana dönüşten bu kadar sonra hâlâ taze konum yoksa izleme yeniden başlatılır (iOS'ta izleme takılabiliyor)

let watchId = null;
let prev = null; // son fix (hız yedeği için)
let anchor = null; // yön hesabı için son referans nokta
const course = createCourseFilter(); // son güvenilir, yumuşatılmış gidiş yönü (harita yön-yukarı bunu kullanır)
let lastFreshAt = 0;

function onPosition(pos) {
  const c = pos.coords;
  const here = { lat: c.latitude, lon: c.longitude, t: pos.timestamp };
  // Sayfa yaşam döngüsü: arka plandan dönüşteki eski (önbellek) konum hız/yön/mesafe hesabına girmez, yalnızca haritadaki yeri günceller
  const g = guard.fix({ lat: here.lat, lon: here.lon, ts: pos.timestamp }, Date.now());
  if (!g.fresh) {
    patch('live', { lat: c.latitude, lon: c.longitude, acc: c.accuracy, gps: 'ok' });
    return;
  }
  lastFreshAt = Date.now();
  if (g.closed) prev = anchor = null; // boşluk öncesi noktadan hız/yön hesaplanmaz
  if (g.catchup) emitCatchup(g.catchup);

  let speedMs = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed : null;
  if (speedMs == null && prev) {
    const dt = (here.t - prev.t) / 1000;
    if (dt > 0.5 && dt < 10) speedMs = (haversineKm(prev, here) * 1000) / dt;
  }

  let heading = Number.isFinite(c.heading) && c.heading >= 0 ? c.heading : null;
  if (heading == null && anchor && haversineKm(anchor, here) * 1000 >= BEARING_MIN_M) {
    heading = bearing(anchor, here);
  }
  if (!anchor || haversineKm(anchor, here) * 1000 >= BEARING_MIN_M) anchor = here;
  prev = here;

  // Duruyorken, yavaşken ya da doğruluk kötüyken yön anlamsızdır: son güvenilir yön korunur, güvenilir ölçümler yumuşatılır.
  const lastHeading = course.push({ heading, speedKmh: speedMs == null ? null : speedMs * 3.6, acc: c.accuracy });

  patch('live', {
    lat: c.latitude,
    lon: c.longitude,
    alt: Number.isFinite(c.altitude) ? c.altitude : null,
    speed: speedMs == null ? null : speedMs < STILL_MS ? 0 : speedMs * 3.6,
    heading: lastHeading,
    acc: c.accuracy,
    gps: 'ok',
  });
}

function onError(err) {
  patch('live', { gps: err.code === err.PERMISSION_DENIED ? 'denied' : 'error' });
}

export function startGps() {
  if (!navigator.geolocation) {
    patch('live', { gps: 'error' });
    throw new Error('Geolocation desteklenmiyor');
  }
  if (watchId != null) return;
  prev = anchor = null;
  patch('live', { gps: 'searching' });
  watch();
  wireLifecycle();
}

function watch() {
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 20000,
  });
}

let wired = false;
/** Ön plana dönüş ve susan GPS: eski hız gösterilmez, takılan izleme yeniden başlatılır. */
function wireLifecycle() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  let rewatchTimer = null;
  // iPhone Chrome dönüşte visibilitychange yerine yalnızca pageshow/focus gönderebilir: üçü de aynı denetimi kurar (tek zamanlayıcı)
  const onShown = () => {
    if (document.visibilityState !== 'visible' || watchId == null || rewatchTimer) return;
    const shownAt = Date.now();
    rewatchTimer = setTimeout(() => {
      rewatchTimer = null;
      if (watchId == null || document.visibilityState !== 'visible' || lastFreshAt >= shownAt) return;
      navigator.geolocation.clearWatch(watchId);
      watch();
    }, RESUME_REWATCH_MS);
  };
  document.addEventListener('visibilitychange', onShown);
  window.addEventListener('pageshow', onShown);
  window.addEventListener('focus', onShown);
  // Konum bir süredir gelmiyorsa (tünel, iOS'ta askıya alınan izleme) son hız "şimdiki hız" gibi gösterilmez. Duran araçta 0 korunur.
  setInterval(() => {
    if (watchId == null || !lastFreshAt || Date.now() - lastFreshAt <= STALE_FIX_MS) return;
    const sp = getState('live').speed;
    if (sp != null && sp > 0) patch('live', { speed: null });
  }, 2000);
}

/** Tek seferlik hızlı konum (izin sorusunu dokunuşta tetikler); başarıda canlı konum güncellenir. Hata: GeolocationPositionError. */
export async function locateOnce() {
  if (!navigator.geolocation) throw Object.assign(new Error('desteklenmiyor'), { code: 0 });
  const get = (opts) => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((p) => { onPosition(p); resolve(); }, reject, opts));
  // Önce hızlı kaba konum (şebeke/Wi-Fi, 1-3 sn): harita hemen oraya gider. GPS uydu bulması (soğuk başlangıç) 10-40 sn sürebilir.
  try { return await get({ enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }); } catch (err) { if (err?.code === 1) throw err; }
  return get({ enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
}

export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  patch('live', { gps: 'off', speed: null });
}
