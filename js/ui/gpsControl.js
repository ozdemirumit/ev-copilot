import { getState, subscribe } from '../state.js';
import { load, save } from '../utils/storage.js';
import { startGps, stopGps } from '../sensors/gps.js';
import { toast } from './toast.js';

/** Üst çubuktaki GPS düğmesi. İzin penceresi sayfa açılışında değil, kullanıcı dokununca çıkar. */
export function initGpsControl() {
  const btn = document.getElementById('btn-gps');

  const on = () => getState('live').gps !== 'off';

  btn.addEventListener('click', () => {
    if (on()) {
      stopGps();
      save('gpsOn', false);
      return;
    }
    try {
      startGps();
      save('gpsOn', true);
    } catch (err) {
      toast(err.message);
    }
  });

  subscribe('live', () => {
    btn.classList.toggle('on', on());
    btn.setAttribute('aria-pressed', String(on()));
  });

  // GPS varsayılan olarak açık gelir (kullanıcı düğmeyle kapattıysa kapalı kalır). İzin henüz sorulmadıysa ilk açılışta sorulur;
  // reddedilmişse yeniden denenmez (düğmeyle elle açılır).
  if (load('gpsOn', true)) {
    const go = () => { try { startGps(); } catch { /* konum desteği yok: düğmeye dokununca uyarı çıkar */ } };
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((p) => { if (p.state !== 'denied') go(); }).catch(go);
    } else go();
  }
}
