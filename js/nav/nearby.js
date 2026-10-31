// "Yakınımdaki istasyonlar": konum etrafındaki herkese açık istasyonlar, fiyat/kW, tahmini varış pili ve maliyet.
// Düzenli güncelleme + düşük pil uyarısı: pil eşiğin altına inince (veya yetmeyecek görünürse) en yakın uygun
// istasyon önerilir ve sesli söylenir.
import { getState, patch, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { VEHICLE, PLANNER } from '../config.js';
import { haversineKm } from '../utils/geo.js';
import { fetchAround } from '../routing/chargerSource.js';
import { chargeMinutes } from '../routing/chargeCurve.js';
import { planTrip } from '../routing/controller.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { speak } from '../advisor/voice.js';
import { startNav } from './navigator.js';

const $ = (id) => document.getElementById(id);
const BAT = VEHICLE.batteryNetKwh;
const ROAD_FACTOR = 1.35; // kuş uçuşu → yol tahmini
const MIN_ARRIVE_SOC = 3; // bundan azıyla varılacaksa "ulaşılamayabilir"
const REFRESH_MS = 15 * 60e3; // sürüş sırasında otomatik güncelleme aralığı
const REFRESH_KM = 10; // ya da bu kadar yol alınınca
const LOW_REFRESH_MS = 5 * 60e3;
const CHARGE_TO = 80;

let all = []; // son sorgu sonucu (fetchAround)
let meta = { at: 0, lat: null, lon: null, errors: [], cached: false };
let busy = false;
let focusId = null;
let radius = load('nearRadius', 25);
let showAc = load('nearAc', false);
const bands = new Set(); // bu düşüş için konuşulmuş pil bantları

const fmtKm = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',');

/** Anlık konuma göre uzaklık, yol tahmini, varış pili, maliyet/süre ekler. */
function enrich(list) {
  const e = effective();
  if (e.lat == null) return [];
  const eng = getState('engine');
  const kwh100 = eng.kwh100Est ?? 20;
  return list.map((s) => {
    const distKm = haversineKm(e, s);
    const roadKm = distKm * ROAD_FACTOR;
    const arrive = e.soc == null ? null : e.soc - ((roadKm * kwh100) / 100 / BAT) * 100;
    const from = Math.max(arrive ?? 20, 0);
    const kwh = (Math.max(0, CHARGE_TO - from) / 100) * BAT;
    return {
      ...s, distKm, roadKm, arrive,
      reachable: arrive == null || arrive >= MIN_ARRIVE_SOC,
      cost: (kwh / PLANNER.billedEff) * s.price,
      minutes: chargeMinutes(s.kw, from, CHARGE_TO),
    };
  }).sort((a, b) => a.distKm - b.distKm);
}

const visible = () => enrich(all).filter((s) => showAc || !s.slow);

export async function refreshNearby({ force = false, silent = false } = {}) {
  const e = effective();
  if (e.lat == null) { if (!silent) toast('Konum yok: üstteki 📍 ile GPS\'i aç (veya Test Modu)', 3500); return; }
  if (busy) return;
  busy = true;
  paintStatus('Yakındaki istasyonlar aranıyor…');
  try {
    const res = await fetchAround(e.lat, e.lon, radius, load('ocmKey', ''), force);
    all = res.stations;
    meta = { at: Date.now(), lat: e.lat, lon: e.lon, errors: res.errors, cached: res.cached };
  } catch (err) {
    meta = { ...meta, errors: ['Arama başarısız: ' + err.message] };
  } finally {
    busy = false;
  }
  render();
  checkLow();
}

function paintStatus(text) {
  const el = $('near-status');
  if (el) el.textContent = text;
}

function goTo(s) {
  const e = effective();
  if (e.lat == null) return toast('Konum yok');
  mapApi.setPoint('start', { lat: e.lat, lon: e.lon, label: 'Konumum' }, { fit: false });
  mapApi.setPoint('end', { lat: s.lat, lon: s.lon, label: s.name });
  document.querySelector('.bottomnav [data-tab="route"]')?.click();
  planTrip().then(() => { if (getState('plan').steps?.length) startNav(); });
}

const mapsUrl = (s) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=driving`;

function cell(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  el.textContent = text;
  return el;
}

function render() {
  const list = $('near-list');
  if (!list) return;
  const items = visible();
  const shown = items.slice(0, 30);
  mapApi.drawNearby(shown, focusId);

  const age = meta.at ? Math.round((Date.now() - meta.at) / 60000) : null;
  paintStatus(meta.at
    ? `${items.length} istasyon · ${radius} km çevre · ${age < 1 ? 'şimdi' : age + ' dk önce'} güncellendi${meta.cached ? ' (önbellek)' : ''}`
    : 'Henüz aranmadı. Konumunu açıp "Ara"ya dokun.');
  const warn = $('near-warn');
  warn.textContent = meta.errors.join(' · ');
  warn.classList.toggle('hidden', !meta.errors.length);

  list.replaceChildren();
  if (meta.at && !items.length) list.append(cell('p', 'small muted', showAc ? 'Bu çevrede istasyon bulunamadı.' : 'Bu çevrede hızlı (DC) istasyon bulunamadı; yavaş AC olanlar için "AC de göster"i aç.'));

  shown.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'station' + (s.id === focusId ? ' focus' : '');
    const left = document.createElement('div');
    left.append(cell('div', 'name', s.name));
    const meta1 = document.createElement('div');
    meta1.className = 'meta';
    meta1.append(
      cell('span', 'tag ' + (s.reachable ? 'best' : ''), s.reachable ? `${fmtKm(s.distKm)} km` : 'Yetmeyebilir'),
      cell('span', '', `${s.opName} · ${s.slow ? 'AC/yavaş ' : ''}${s.kw} kW${s.uncertain ? '*' : ''} · ${s.price.toFixed(2)} TL/kWh`),
    );
    const meta2 = cell('div', 'meta', `~${fmtKm(s.roadKm)} km yol`
      + (s.arrive != null ? ` · varışta %${Math.max(0, s.arrive).toFixed(0)}` : '')
      + ` · %${CHARGE_TO}'e ≈ ${Math.round(s.minutes)} dk, ${s.cost.toFixed(0)} TL`);
    const acts = document.createElement('div');
    acts.className = 'row wrap';
    const go = cell('button', 'btn primary sm', '🧭 Git');
    go.type = 'button';
    go.addEventListener('click', () => goTo(s));
    const gm = cell('a', 'btn ghost sm', '↗ Haritalar');
    gm.href = mapsUrl(s);
    gm.target = '_blank';
    gm.rel = 'noopener';
    const show = cell('button', 'btn ghost sm', '📍 Haritada');
    show.type = 'button';
    show.addEventListener('click', () => { focusId = s.id; mapApi.follow(s.lat, s.lon, 14, true); document.querySelector('.bottomnav [data-tab="route"]')?.click(); render(); });
    acts.append(go, gm, show);
    left.append(meta1, meta2, acts);
    row.append(left);
    list.append(row);
  });
}

// ---------- Düşük pil: en yakın uygun istasyonu öner ----------

function pickBest() {
  const items = visible().filter((s) => !s.slow);
  const pool = items.length ? items : enrich(all);
  const eng = getState('engine');
  const plan = getState('plan');
  // Rota üzerindeyse ve ileride olanlar öncelikli (yoldan sapmadan şarj); değilse en yakın.
  const score = (s) => {
    if (plan.profile && eng.routeKm != null) {
      const p = plan.profile.project(s.lat, s.lon, eng.routeKm);
      if (p.offKm < 3 && p.km > eng.routeKm) return s.roadKm - 2; // yol üstünde: hafif tercih (düşük pilde en yakın olan yine öncelikli)
    }
    return s.roadKm;
  };
  const ok = pool.filter((s) => s.reachable);
  return (ok.length ? ok : pool).sort((a, b) => score(a) - score(b))[0] || null;
}

function showAlert(text, station) {
  const bar = $('near-alert');
  if (!text) { bar.classList.add('hidden'); patch('nav', { alert: null }); return; }
  $('near-alert-text').textContent = text;
  const go = $('near-alert-go');
  go.classList.toggle('hidden', !station);
  go.onclick = station ? () => goTo(station) : null;
  bar.classList.remove('hidden');
  patch('nav', { alert: { text, id: station?.id ?? null } });
}

let dismissedUntil = 0;

function checkLow() {
  const e = effective();
  const nav = getState('nav');
  if (e.soc == null || e.lat == null) return;
  const trouble = e.soc <= nav.lowSoc || (getState('advisor').level === 'bad' && (e.speed ?? 0) > 5);
  if (!trouble) {
    if (e.soc > nav.lowSoc + 3) { bands.clear(); if (getState('nav').alert) showAlert(null); }
    return;
  }
  if (Date.now() < dismissedUntil) return;

  const best = all.length ? pickBest() : null;
  if (!best) {
    showAlert(`Pil %${Math.round(e.soc)}: yakındaki istasyon verisi yok (aranıyor veya bulunamadı). İstasyon sekmesinden "Ara"ya dokun.`, null);
    return;
  }
  const text = `Pil %${Math.round(e.soc)} — en yakın şarj: ${best.name} (${fmtKm(best.distKm)} km, ${best.kw} kW, ${best.price.toFixed(2)} TL/kWh)`
    + (best.arrive != null ? `, varışta ~%${Math.max(0, best.arrive).toFixed(0)}` : '');
  showAlert(text, best);

  // Her pil bandında (eşik, 15, 10, 5) bir kez konuş
  const band = [nav.lowSoc, 15, 10, 5].filter((b) => e.soc <= b).sort((a, b) => a - b)[0] ?? nav.lowSoc;
  if (!bands.has(band)) {
    bands.add(band);
    speak(`Pil yüzde ${Math.round(e.soc)}. En yakın şarj istasyonu ${best.name}, ${fmtKm(best.distKm)} kilometre. ${best.kw} kilovat, kilovat saati ${best.price.toFixed(1).replace('.', ',')} lira.`, { key: 'low' + band, cooldownMs: 0, interrupt: true });
  }
}

/** Her 30 sn: sürüyorsak/navigasyon açıksa listeyi eskidiğinde yenile, düşük pili denetle. */
function watch() {
  const e = effective();
  if (e.lat == null) return;
  const nav = getState('nav');
  const moving = nav.active || (e.speed ?? 0) > 5;
  const age = Date.now() - meta.at;
  const moved = meta.lat == null ? Infinity : haversineKm({ lat: meta.lat, lon: meta.lon }, e);
  const lowNow = e.soc != null && e.soc <= nav.lowSoc;
  const wanted = moving && (all.length || nav.active) || lowNow;
  if (wanted && !busy && (age > (lowNow ? LOW_REFRESH_MS : REFRESH_MS) || moved > REFRESH_KM)) refreshNearby({ silent: true });
  else { if (meta.at) render(); checkLow(); }
}

export function initNearby() {
  const rad = $('near-radius');
  rad.value = String(radius);
  rad.addEventListener('change', () => { radius = Number(rad.value); save('nearRadius', radius); refreshNearby({ force: true }); });
  const ac = $('near-ac');
  ac.checked = showAc;
  ac.addEventListener('change', () => { showAc = ac.checked; save('nearAc', showAc); render(); });
  $('near-refresh').addEventListener('click', () => refreshNearby({ force: true }));
  $('near-alert-close').addEventListener('click', () => { dismissedUntil = Date.now() + 10 * 60e3; showAlert(null); });
  render();
  setInterval(watch, 30000);
}
