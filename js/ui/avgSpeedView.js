// Ortalama hız gösterimi: rotasız pil kartında (sürüş oturumu, yeterli veri olunca görünür) ve navigasyon alt şeridinde
// (navigasyon başlangıcından beri; veri yetene kadar "--"). Hesap nav/avgSpeed.js'te; burada yalnızca boyama ve navigasyon aç/kapa.
// Test Modu'nda (simülasyon) gerçek GPS ortalaması gösterilmez.
import { getState, subscribe, effective } from '../state.js';
import { driveTrip, navTrip, setNavTrip } from '../nav/avgSpeed.js';
import { t, tr, locale } from '../i18n/index.js';

const $ = (id) => document.getElementById(id);
const min = (ms) => Math.round(ms / 60000);

function detail(s) {
  return s.kmh == null ? tr('Ortalama hız') : t('Ortalama hız: {0} km yol, {1} dk sürüş, {2} dk duruş', new Intl.NumberFormat(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(s.km), min(s.movingMs), min(s.waitMs));
}

export function initAvgSpeedView() {
  const box = $('socbar-avg');
  const nav = $('nh-avg');
  if (!box || !nav) return;

  const paint = () => {
    const live = effective().source === 'live';
    const d = driveTrip.snapshot();
    const showDrive = live && d.kmh != null;
    box.classList.toggle('hidden', !showDrive);
    if (showDrive) {
      $('socbar-avg-v').textContent = String(Math.round(d.kmh));
      box.title = detail(d);
    }
    const n = navTrip.snapshot();
    const v = live && n.kmh != null ? String(Math.round(n.kmh)) : '--';
    if ($('nh-avg-v').textContent !== v) $('nh-avg-v').textContent = v;
    nav.title = detail(n);
    nav.setAttribute('aria-label', v === '--' ? tr('Ortalama hız') : `${tr('Ortalama hız')} ${v} ${tr('km/s')}`);
  };

  const syncNav = () => { setNavTrip(!!getState('nav').active); paint(); };
  syncNav();
  subscribe('nav', syncNav);
  subscribe('live', paint);
  setInterval(paint, 2000);
}
