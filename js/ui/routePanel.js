import { getState, patch, subscribe } from '../state.js';
import { save } from '../utils/storage.js';

const $ = (id) => document.getElementById(id);
const MODE_LABEL = { fast: 'En Hızlı', cheap: 'En Ekonomik', opt: 'Optimum' };

const hm = (min) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m} dk`;
};

/** Google Haritalar bağlantısı: başlangıç, durak(lar), varış (en çok 9 ara nokta). Anahtar gerektirmez. */
function gmapsUrl(start, end, stops) {
  const ll = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', ll(start));
  u.searchParams.set('destination', ll(end));
  if (stops.length) u.searchParams.set('waypoints', stops.slice(0, 9).map((s) => ll(s.station)).join('|'));
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}

export function initRoutePanel() {
  // Seyir hızı ve trafik tahmini sürgüleri
  const bind = (id, outId, key, storeKey, fmt) => {
    const el = $(id);
    el.value = getState('route')[key];
    $(outId).textContent = fmt(el.value);
    el.addEventListener('input', () => {
      $(outId).textContent = fmt(el.value);
      patch('route', { [key]: Number(el.value) });
      save(storeKey, Number(el.value));
    });
  };
  bind('cruise', 'cruise-out', 'cruise', 'cruise', (v) => `${v} km/h`);
  bind('traffic-est', 'traffic-est-out', 'traffic', 'trafficEst', (v) => `%${v}`);

  const list = $('plan-list');
  const status = $('plan-status');
  const gm = $('btn-gmaps');

  function paint() {
    const p = getState('plan');
    $('plan-mode-label').textContent = MODE_LABEL[p.mode];
    list.replaceChildren();
    gm.classList.toggle('hidden', p.status !== 'ready');

    const busy = p.status === 'loading';
    $('btn-plan').disabled = busy;
    if (p.status === 'none') status.textContent = "Başlangıç ve varış seçip Rotayı Planla'ya dokun.";
    else if (busy) status.textContent = p.text;
    else if (p.status === 'error' || p.status === 'infeasible') status.textContent = '⚠️ ' + p.text;

    if (p.route) {
      $('sum-dist').textContent = p.route.distanceKm.toFixed(0);
    }
    if (p.status === 'ready') {
      const t = p.totals;
      $('sum-time').textContent = hm(t.totalMin);
      $('sum-stops').textContent = String(p.stops.length);
      const thr = getState('route').minArrivalSoc;
      const dip = t.arriveSoc < thr - 0.5 ? ` — eşiğin ${(thr - t.arriveSoc).toFixed(0)} puan altı, tolerans içinde` : '';
      status.textContent = p.stops.length
        ? `Varışta tahmini pil %${t.arriveSoc.toFixed(0)} (eşik %${thr}${dip}) · şarj ${hm(t.chargeMin)} · ${t.cost.toFixed(0)} TL`
        : `Şarj gerekmiyor — varışta tahmini pil %${t.arriveSoc.toFixed(0)} (eşik %${thr}${dip}).`;
      p.stops.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'stop';
        const num = Object.assign(document.createElement('div'), { className: 'num', textContent: String(i + 1) });
        const title = Object.assign(document.createElement('div'), { className: 't', textContent: s.station.name });
        const right = Object.assign(document.createElement('div'), { className: 'r', textContent: `${Math.round(s.minutes)} dk · ${s.cost.toFixed(0)} TL` });
        const meta = Object.assign(document.createElement('div'), {
          className: 'm',
          textContent: `${s.km.toFixed(0)}. km · ${s.station.opName} ${s.station.kw} kW · %${s.arriveSoc.toFixed(0)} → %${s.leaveSoc}`
            + (s.station.offKm > 0.3 ? ` · sapma ${s.station.offKm.toFixed(1)} km` : ''),
        });
        row.append(num, title, right, meta);
        list.append(row);
      });
    } else if (p.status !== 'loading') {
      $('sum-time').textContent = '—';
      $('sum-stops').textContent = '—';
      if (!p.route) $('sum-dist').textContent = '—';
    }
  }

  gm.addEventListener('click', () => {
    const { start, end } = getState('route');
    const p = getState('plan');
    if (!start || !end) return;
    window.open(gmapsUrl(start, end, p.stops), '_blank', 'noopener');
  });

  subscribe('plan', paint);
  subscribe('route', paint);
  paint();
}
