import { getState, subscribe } from '../state.js';
import { startGps } from '../sensors/gps.js';
import { tr } from '../i18n/index.js';

/**
 * GPS izin verildiği sürece açık kalır (üst çubukta düğme yok). Reddedilmişse yeniden sorulmaz; haritadaki konum düğmesi amber olur,
 * dokununca (shell.js) GPS yeniden denenir ve nedeni söylenir.
 */
export function initGpsControl() {
  const me = document.getElementById('fab-me');
  const label = me.getAttribute('aria-label');
  let denied = false;
  const paint = () => {
    const g = getState('live').gps;
    const bad = denied || g === 'denied' || g === 'error';
    me.classList.toggle('gps-bad', bad);
    const text = bad ? tr('Konum kapalı: izin ver ya da konum düğmesine dokun') : label;
    if (me.title !== text) { me.title = text; me.setAttribute('aria-label', text); }
  };
  subscribe('live', paint);
  paint();

  const go = () => { try { startGps(); } catch { /* konum desteği yok: konum düğmesi nedeni söyler */ } };
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((p) => {
      denied = p.state === 'denied';
      paint();
      if (!denied) go();
      p.addEventListener?.('change', () => { denied = p.state === 'denied'; paint(); if (!denied) go(); });
    }).catch(go);
  } else go();
}
