// Rotasız sürüş takibi: navigasyon kapalıyken araç hareket ediyorsa harita aracı izler ve (Harita yönü ayarı "gidiş yönü yukarı" ise)
// gidiş yönü ekranın üstünde kalır (GPS course-up). Yön, gps.js'teki süzgeçten gelir: yavaşken/kararsız GPS'te son güvenilir yön.
// Park edince (bir süre duran araç) takip biter, harita kuzey-yukarı serbest kalır. Kullanıcı haritayı kaydırırsa 15 sn izlenmez
// (navigasyondaki kural). Navigasyon açılınca görünümü navigator.js devralır. Test Modu'nda simülatör takibi (navigator.js) değişmez.
import { getState, subscribe, effective } from '../state.js';
import { mapApi } from '../ui/mapView.js';

export const START_KMH = 12; // takip bu hızın üstünde başlar (haritaya bakan duran kullanıcı rahatsız edilmez)
export const PARK_MS = 120_000; // bu kadar süre duran araçta takip biter
const ZOOM_EVERY_MS = 8000; // hız kaynaklı zoom değişimi en fazla bu sıklıkta (titreşmesin)

/**
 * Saf karar: 'start' | 'keep' | 'stop' | 'idle'.
 * s: { navActive, live (gerçek GPS, konum var), speed (km/s, null olabilir), blocked (istasyon kartı/haritadan seçim açık), on, stillMs }
 */
export function followDecision({ navActive, live, speed, blocked, on, stillMs }) {
  if (navActive || !live) return on ? 'stop' : 'idle';
  if (!on) return speed != null && speed >= START_KMH && !blocked ? 'start' : 'idle';
  return stillMs >= PARK_MS ? 'stop' : 'keep';
}

/** Hıza göre zoom: yavaşta yakın (navigasyondaki eşikler). */
export const zoomForSpeed = (kmh) => (kmh < 40 ? 17 : kmh < 80 ? 16 : 15);

export function initFreeDrive() {
  let on = false;
  let stillSince = 0;
  let zoomNow = null;
  let zoomAt = 0;
  let speedAvg = 0;
  const hiddenEl = (id) => document.getElementById(id)?.classList.contains('hidden') ?? true;

  const update = () => {
    const e = effective();
    const navActive = !!getState('nav').active;
    const live = e.source === 'live' && getState('live').gps === 'ok' && e.lat != null;
    const speed = e.speed;
    const now = Date.now();
    if (speed != null && speed >= 3) stillSince = 0;
    else if (!stillSince) stillSince = now;
    const blocked = !hiddenEl('station-card') || !hiddenEl('pickbar');
    const d = followDecision({ navActive, live, speed, blocked, on, stillMs: stillSince ? now - stillSince : 0 });
    if (d === 'idle') return;
    if (d === 'stop') {
      on = false;
      zoomNow = null;
      mapApi.driveView?.(false);
      return;
    }
    const up = !!getState('nav').headingUp;
    if (d === 'start') {
      on = true;
      speedAvg = speed ?? 0;
      zoomNow = zoomForSpeed(speedAvg);
      zoomAt = now;
      mapApi.driveView?.(true, up);
      mapApi.follow(e.lat, e.lon, zoomNow, true, up ? e.heading : null);
      return;
    }
    if (blocked) return; // istasyon kartına bakılırken / haritadan nokta seçilirken harita kaymasın
    speedAvg = speedAvg * 0.8 + (speed ?? 0) * 0.2;
    const want = zoomForSpeed(speedAvg);
    const change = want !== zoomNow && now - zoomAt > ZOOM_EVERY_MS;
    if (change) { zoomNow = want; zoomAt = now; }
    mapApi.follow(e.lat, e.lon, change ? want : null, false, up ? e.heading : null);
  };

  subscribe('live', update);
  subscribe('nav', () => {
    if (getState('nav').active && on) { on = false; zoomNow = null; mapApi.driveView?.(false); } // görünümü navigasyon devralır
    else if (on) mapApi.driveView?.(true, !!getState('nav').headingUp); // Harita yönü ayarı değişti
  });
  setInterval(update, 5000); // konum gelmese de park süresi dolunca takip bitsin
}
