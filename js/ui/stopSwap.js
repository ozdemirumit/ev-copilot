// Plandaki bir şarj durağını değiştir: durağın RADIUS_KM çevresindeki, filtrelere uygun (güç filtresi, marka tercihi) istasyonları listeler;
// seçilen istasyon zorunlu durak olur, eski durak dışlanır ve plan yeniden hesaplanır (routing/controller.js: swapStop).
import { getState } from '../state.js';
import { swapStop, removeStop } from '../routing/controller.js';
import { swapCandidates } from '../routing/planner.js';
import { t, tr } from '../i18n/index.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const RANGE_KM = 5; // rotada durağın önünde/arkasında

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
  $('swap-sub').textContent = t('{0} durağının rotada ±{1} km çevresindeki istasyonlar (filtresiz)', stop.station.name, RANGE_KM);

  const rows = swapCandidates({
    stop, stations: p.stations || [], rangeKm: RANGE_KM, fromKm: here, plannedIds: (p.stops || []).map((s) => s.station.id),
  });
  if (!rows.length) {
    list.append(el('p', 'small muted', t('Rotada ±{0} km içinde başka istasyon yok.', RANGE_KM)));
  }
  rows.forEach(({ station: s, dKm, offFilter }) => {
    const b = el('button', 'swap-row');
    b.type = 'button';
    const along = Math.abs(dKm) < 0.3 ? tr('aynı noktada') : dKm < 0 ? t('{0} km önce', Math.abs(dKm).toFixed(1)) : t('{0} km sonra', dKm.toFixed(1));
    const parts = [
      s.opName, `${s.slow ? 'AC/yavaş ' : ''}${s.kw} kW${s.uncertain ? '*' : ''}`,
      s.foreign ? null : `${s.price.toFixed(2)} TL/kWh`,
      along,
      s.offKm > 0.3 ? t('sapma {0} km', s.offKm.toFixed(1)) : null,
      offFilter ? tr('filtre dışı') : null,
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

/** Durağı rotadan kaldır; gerekirse yerine alternatif seçilir. Sonucu bildirir. */
export function removeFromRoute(stop) {
  const r = removeStop(stop.station.id);
  if (!r.ok) return toast(t('Bu durak olmadan plan kurulamadı: {0}', tr(r.reason || 'Plan kurulamadı')), 8000);
  toast(r.added.length ? t('Durak çıkarıldı: {0}. Alternatif: {1}', stop.station.name, r.added.join(', ')) : t('Durak rotadan çıkarıldı: {0}', stop.station.name), 7000);
}

export function initStopSwap() {
  $('swap-close').addEventListener('click', () => $('swap-dialog').close());
}
