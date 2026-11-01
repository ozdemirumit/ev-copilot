import { progressKm } from '../routing/progress.js';
import { getState, patch, subscribe } from '../state.js';
import { save } from '../utils/storage.js';
import { stationGaps } from '../routing/planner.js';
import { slotEl, livePrice } from '../routing/slots.js';
import { mapApi } from './mapView.js';

const showMap = () => document.querySelector('.bottomnav [data-tab="map"]')?.click();

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
  // Hız rota adımlarından gelir (elle ayar yok): planlama sonrası özet burada gösterilir
  const paintTraffic = () => {
    const i = getState('route').trafficInfo;
    if (!i) return;
    $('traffic-info').textContent = i.live
      ? `Mapbox canlı trafik: süre ${hm(i.driveMin)}, olağan ${hm(i.freeMin)} (×${i.ratio.toFixed(2)}) · ortalama hız ${Math.round(i.avgFreeKmh)} km/s` + (i.slowKm > 0.2 ? ` · haritada sarı: yavaş, kırmızı: yoğun trafik (${i.slowKm.toFixed(0)} km)` : ' · yoğun kesim yok')
      : `Süre ${hm(i.driveMin)} (trafiksiz, canlı trafik yok) · ortalama hız ${Math.round(i.avgFreeKmh)} km/s`;
  };
  subscribe('route', paintTraffic);
  paintTraffic();

  const list = $('plan-list');
  const status = $('plan-status');
  const gm = $('btn-gmaps');
  const sm = $('btn-stops-map');

  /** Araç rotada nerede: canlı konum, yoksa planın başlangıcı. Geçilen duraklar/istasyonlar bu km'ye göre elenir. */
  const curKm = progressKm;

  function paint() {
    const p = getState('plan');
    const here = curKm();
    $('plan-mode-label').textContent = MODE_LABEL[p.mode];
    list.replaceChildren();
    gm.classList.toggle('hidden', p.status !== 'ready');
    sm.classList.toggle('hidden', p.status !== 'ready' || !p.stops.some((s) => s.km > here - 0.3));

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
      const stops = p.stops.filter((s) => s.km > here - 0.3); // geride kalanlar plandan çıkar
      $('sum-stops').textContent = String(stops.length);
      const gaps = stationGaps(p.stations, p.profile.totalKm);
      const gapNote = gaps.length
        ? ` ⚠ ${gaps.map((g) => `${g.from.toFixed(0)}–${g.to.toFixed(0)} km`).join(', ')} arasında bilinen hızlı (DC) istasyon yok; harita verisi eksik olabilir.`
        : '';
      const thr = getState('route').minArrivalSoc;
      const dip = t.arriveSoc < thr - 0.5 ? ` — eşiğin ${(thr - t.arriveSoc).toFixed(0)} puan altı, tolerans içinde` : '';
      status.textContent = stops.length
        ? `Varışta tahmini pil %${t.arriveSoc.toFixed(0)} (eşik %${thr}${dip}) · şarj ${hm(t.chargeMin)} · ${t.cost.toFixed(0)} TL${gapNote}`
        : `Şarj gerekmiyor — varışta tahmini pil %${t.arriveSoc.toFixed(0)} (eşik %${thr}${dip}).${gapNote}`;
      stops.forEach((s, i) => {
        // Parantez: bir önceki şarj durağına (ilk duraksa yolculuğun başına / geçilen son durağa) olan mesafe
        const fi = p.stops.indexOf(s); // geçilen duraklar listeden gizlenir ama önceki durak hesabında sayılır
        const prevKm = fi > 0 ? p.stops[fi - 1].km : (p.lastStopKm ?? 0);
        const row = document.createElement('div');
        row.className = 'stop';
        const num = Object.assign(document.createElement('div'), { className: 'num', textContent: String(i + 1) });
        const title = Object.assign(document.createElement('div'), { className: 't', textContent: s.station.name });
        const right = Object.assign(document.createElement('div'), { className: 'r', textContent: `${Math.round(s.minutes)} dk · ${s.cost.toFixed(0)} TL` });
        const meta = Object.assign(document.createElement('div'), {
          className: 'm',
          textContent: `${Math.max(0, s.km - here).toFixed(0)} km kaldı (${fi > 0 || p.lastStopKm != null ? 'önceki duraktan' : 'yolculuk başından'} ${(s.km - prevKm).toFixed(0)} km) · ${s.station.opName} ${s.station.slow ? 'AC/yavaş ' : ''}${s.station.kw} kW · %${s.arriveSoc.toFixed(0)} → %${s.leaveSoc}`
            + (s.station.offKm > 0.3 ? ` · sapma ${s.station.offKm.toFixed(1)} km` : '')
            ,
        });
        const show = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost sm show', textContent: '📍 Haritada' });
        show.addEventListener('click', () => { showMap(); mapApi.showAt(s.station.lat, s.station.lon, 14); });
        const slotNode = slotEl(s.station);
        if (slotNode) meta.append(slotNode);
        const lp = livePrice(s.station);
        const price = lp && Object.assign(document.createElement('div'), { className: 'm', textContent: lp.text });
        const extra = lp?.extra && Object.assign(document.createElement('div'), { className: 'm', textContent: 'Ek ücret var (oturum başı ya da süre)' });
        row.append(num, title, right, meta, ...[price, extra].filter(Boolean), show);
        list.append(row);
      });
    } else if (p.status !== 'loading') {
      $('sum-time').textContent = '—';
      $('sum-stops').textContent = '—';
      if (!p.route) $('sum-dist').textContent = '—';
    }
  }

  /** Rota boyunca hava: km, sıcaklık, yağış, rüzgâr ve o dilimdeki kafa/arka rüzgâr (planın hesapta kullandığı veri). */
  function paintWeather() {
    const p = getState('plan');
    const card = $('wx-card');
    const wx = p.profile?.wx || [];
    card.classList.toggle('hidden', !p.profile);
    if (!p.profile) return;
    const list = $('wx-list');
    list.replaceChildren();
    if (!wx.length) {
      $('wx-sum').textContent = 'Hava durumu alınamadı: rüzgâr ve yağış hesaba katılmadı'
        + (p.wxInfo?.error ? ` (${p.wxInfo.error})` : '') + '. Rotayı Planla ile tekrar dene.';
      return;
    }
    const rows = wx.map((w) => {
      const head = p.profile.segAt(w.km).headwind;
      return { ...w, head };
    });
    const avg = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
    const rainy = rows.filter((r) => r.rain >= 0.1);
    $('wx-sum').textContent = `Ortalama ${avg((r) => r.temp).toFixed(0)} °C · en düşük ${Math.min(...rows.map((r) => r.temp)).toFixed(0)} °C`
      + (rainy.length ? ` · yağış: ${rainy.map((r) => r.km.toFixed(0) + '. km').join(', ')}` : ' · yağış yok')
      + ` · ortalama net rüzgâr ${avg((r) => r.head) >= 0 ? 'kafa' : 'arka'} ${Math.abs(avg((r) => r.head)).toFixed(0)} km/h`
      + (p.wxInfo?.source ? ` · kaynak: ${p.wxInfo.source}${p.wxInfo.fallbackReason ? ` (${p.wxInfo.fallbackReason} olduğu için yedek)` : ''}` : '');
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'stop wx';
      const rain = r.rain >= 0.1 ? `🌧️ ${r.rain.toFixed(1)} mm/sa` : '☀️ yağış yok';
      const wind = `💨 ${r.windSpeed.toFixed(0)} km/h (${r.head >= 0 ? 'kafa +' : 'arka −'}${Math.abs(r.head).toFixed(0)})`;
      row.append(
        Object.assign(document.createElement('div'), { className: 'num', textContent: r.km.toFixed(0) }),
        Object.assign(document.createElement('div'), { className: 't', textContent: `${r.temp.toFixed(0)} °C · ${rain}` }),
        Object.assign(document.createElement('div'), { className: 'm', textContent: wind }),
      );
      list.append(row);
    });
  }

  sm.addEventListener('click', () => {
    const p = getState('plan');
    const here = curKm();
    const pts = p.stops.filter((s) => s.km > here - 0.3).map((s) => ({ lat: s.station.lat, lon: s.station.lon }));
    showMap();
    mapApi.fitPoints(pts);
  });
  gm.addEventListener('click', () => {
    const { start, end } = getState('route');
    const p = getState('plan');
    if (!start || !end) return;
    const here = curKm();
    window.open(gmapsUrl(start, end, p.stops.filter((s) => s.km > here - 0.3)), '_blank', 'noopener'); // yalnızca kalan duraklar
  });

  subscribe('plan', () => { paint(); paintWeather(); }); // doluluk yenilenince de (plan.availAt) yeniden çizilir
  subscribe('route', paint);
  // Araç ilerledikçe kalan mesafeler güncellenir (her tam km'de bir yeniden çiz)
  let shownKm = -1;
  subscribe('engine', () => {
    const km = Math.floor(getState('engine').routeKm ?? -1);
    if (km !== shownKm) { shownKm = km; paint(); }
  });
  paint();
  paintWeather();
}
