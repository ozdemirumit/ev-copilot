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

  // Daha önce açıksa ve izin zaten verilmişse otomatik başlat (izin sorusu çıkmaz).
  if (load('gpsOn', false) && navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((p) => {
      if (p.state === 'granted') startGps();
    }).catch(() => {});
  }
}
