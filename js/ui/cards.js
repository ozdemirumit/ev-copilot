import { effective, getState, subscribe } from '../state.js';
import { compass } from '../utils/geo.js';

const $ = (id) => document.getElementById(id);
const num = (v, d = 0) => (v == null ? '—' : v.toFixed(d));
const withUnit = (v, unit, d = 0) => (v == null ? '—' : v.toFixed(d) + ' ' + unit);
const signed = (v, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(d));
const set = (id, text) => { $(id).textContent = text; };

function trafficLabel(t) {
  if (t == null) return '—';
  const name = t < 20 ? 'Akıcı' : t < 50 ? 'Yoğun' : t < 80 ? 'Sıkışık' : 'Durma-kalkma';
  return `${name} (%${t})`;
}

/** Bir metrik kartının ana değerini yaz (birim <small> içinde kalır). */
function metric(id, value, d = 0) {
  const el = $(id);
  el.firstChild.replaceWith(value == null ? Object.assign(document.createElement('span'), { className: 'pending', textContent: '—' }) : document.createTextNode(value.toFixed(d)));
}

/** state → HUD + kartlar. */
function paint() {
  const e = effective();
  const g = getState('engine');

  $('hud-soc').textContent = num(e.soc);
  $('hud-speed').textContent = num(e.speed);
  $('cal-soc').textContent = num(e.soc);
  metric('c-soc', e.soc);

  // Tüketim / menzil
  metric('c-range', g.rangeKm);
  metric('c-kwh100', g.kwh100Measured, 1);
  metric('c-kmpct', g.kmPerPct, 1);
  set('c-window', g.measuredKm == null ? 'veri bekleniyor (≥3 puan düşüş)' : `${g.measuredKm.toFixed(1)} km`);
  set('c-model', g.kwh100Est == null ? '—' : `${g.kwh100Est.toFixed(1)} kWh/100km`);
  set('c-k', g.k.toFixed(2) + (Math.abs(g.k - 1) < 0.005 ? ' (kalibre değil)' : ''));

  // Hava
  set('w-temp', withUnit(e.extTemp, '°C'));
  set('w-rain', withUnit(e.rain, 'mm/sa', 1));
  set('w-wind', e.windSpeed == null ? '—' : `${e.windSpeed.toFixed(0)} km/h · ${compass(e.windDir)} (${Math.round(e.windDir)}°)`);
  set('w-heading', e.heading == null ? '—' : `${e.heading.toFixed(0)}° ${compass(e.heading)}`);
  set('w-net', g.netWind == null ? '—' : `${g.netWind >= 0 ? 'Kafa' : 'Arka'} ${Math.abs(g.netWind).toFixed(0)} km/h`);
  set('w-aero', g.aeroPct == null ? '—' : `${signed(g.aeroPct)}% tüketim`);

  // Rakım
  const p = getState('plan').profile;
  set('e-alt', withUnit(e.alt, 'm'));
  set('e-grade', e.grade == null ? '—' : `${signed(e.grade, 1)}%`);
  set('e-net', p ? `↑${Math.round(p.ascent)} m / ↓${Math.round(p.descent)} m${p.hasElevation ? '' : ' (rakım yok)'}` : '—');
  set('e-regen', p ? `${p.regenKwh.toFixed(1)} kWh` : '—');

  // Trafik
  const t = g.traffic;
  set('t-level', trafficLabel(e.traffic));
  set('t-delay', t ? `+${t.extraMin.toFixed(0)} dk / 100 km` : '—');
  set('t-hvac', t ? `+${t.hvacExtraKwh.toFixed(2)} kWh / 100 km` : '—');
  set('t-aero', t ? `−${Math.max(0, t.driveSavingKwh).toFixed(2)} kWh / 100 km` : '—');
  set('t-net', t ? `${signed(t.netKwh, 2)} kWh / 100 km` : '—');
}

export function initCards() {
  subscribe(['live', 'sim', 'engine', 'plan', 'weather'], paint);
  paint();
}
