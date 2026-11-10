// Plandaki bir şarj durağını değiştir: durağın RADIUS_KM çevresindeki, filtrelere uygun (güç filtresi, marka tercihi) istasyonları listeler;
// seçilen istasyon zorunlu durak olur, eski durak dışlanır ve plan yeniden hesaplanır (routing/controller.js: swapStop).
import { getState } from '../state.js';
import { swapStop } from '../routing/controller.js';
import { swapCandidates } from '../routing/planner.js';
import { haversineKm } from '../utils/geo.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const RADIUS_KM = 5;
const dist = (a, b) => haversineKm({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** stop: plan.stops öğesi ({ station, km, ... }); here: araçın rotadaki km'si. */
export function openSwap(stop, here = 0) {
  const dlg = $('swap-dialog');
  const p = getState('plan');
  const list = $('swap-list');
  list.replaceChildren();
  $('swap-sub').textContent = t('{0} çevresinde {1} km içindeki uygun istasyonlar', stop.station.name, RADIUS_KM);

  const rows = swapCandidates({
    stop, stations: p.stations || [], dist, radiusKm: RADIUS_KM, fromKm: here, plannedIds: (p.stops || []).map((s) => s.station.id),
  });
  if (!rows.length) {
    list.append(el('p', 'small muted', tr('5 km içinde filtrelere uygun başka istasyon yok. Şarj gücü filtresini ya da marka tercihini gevşetmeyi dene.')));
  }
  rows.forEach(({ station: s, distKm }) => {
    const b = el('button', 'swap-row');
    b.type = 'button';
    const dKm = s.km - stop.km;
    const along = Math.abs(dKm) < 0.3 ? tr('aynı noktada') : dKm < 0 ? t('{0} km önce', Math.abs(dKm).toFixed(1)) : t('{0} km sonra', dKm.toFixed(1));
    const parts = [
      s.opName, `${s.slow ? 'AC/yavaş ' : ''}${s.kw} kW${s.uncertain ? '*' : ''}`,
      s.foreign ? null : `${s.price.toFixed(2)} TL/kWh`,
      t('{0} km uzakta', distKm.toFixed(1)), along,
      s.offKm > 0.3 ? t('sapma {0} km', s.offKm.toFixed(1)) : null,
    ].filter(Boolean);
    b.append(el('b', 'n', s.name), el('span', 'm', parts.join(' · ')));
    b.addEventListener('click', () => {
      const r = swapStop(stop.station.id, s.id);
      if (r.ok) {
        dlg.close();
        toast(r.reflowed ? t('Durak değiştirildi: {0}. Zincir bozulduğu için diğer duraklar da yeniden düzenlendi.', s.name) : t('Durak değiştirildi: {0}', s.name), r.reflowed ? 8000 : 5000);
      } else {
        toast(t('Bu istasyonla plan kurulamadı: {0}', tr(r.reason || 'Plan kurulamadı')), 8000);
      }
    });
    list.append(b);
  });
  dlg.showModal();
}

export function initStopSwap() {
  $('swap-close').addEventListener('click', () => $('swap-dialog').close());
}
