// "Yakınımdaki istasyonlar": konum etrafındaki herkese açık istasyonlar, fiyat/kW, tahmini varış pili ve maliyet.
// Düzenli güncelleme + düşük pil uyarısı: pil eşiğin altına inince (veya yetmeyecek görünürse) en yakın uygun
// istasyon önerilir ve sesli söylenir.
import { getState, patch, effective } from '../state.js';
import { load, save } from '../utils/storage.js';
import { VEHICLE, PLANNER } from '../config.js';
import { haversineKm } from '../utils/geo.js';
import { fetchAround } from '../providers/index.js';
import { chargeMinutes } from '../routing/chargeCurve.js';
import { planTrip } from '../routing/controller.js';
import { mapApi } from '../ui/mapView.js';
import { toast } from '../ui/toast.js';
import { speak } from '../advisor/voice.js';
import { slotKind, slotLabel } from '../routing/slots.js';
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
    const res = await fetchAround(e.lat, e.lon, radius, force);
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

/**
 * İstasyona git. Varış noktası varsa (planlı rota): rota bulunduğun yerden istasyon ÜZERİNDEN asıl varışa yeniden kurulur ve
 * plan ilk durak olarak orada şarj eder (varış değişmez). Varış yoksa istasyonun kendisi varış olur.
 */
function goTo(s, { auto = false } = {}) {
  const e = effective();
  if (e.lat == null) return toast('Konum yok');
  const start = { lat: e.lat, lon: e.lon, label: 'Konumum' };
  const dest = getState('route').end;
  mapApi.setPoint('start', start, { fit: false });
  document.querySelector('.bottomnav [data-tab="route"]')?.click();
  const keep = dest && getState('plan').profile && haversineKm(dest, s) > 1;
  if (!keep) mapApi.setPoint('end', { lat: s.lat, lon: s.lon, label: s.name });
  const done = () => { if (getState('plan').steps?.length) startNav(); };
  if (keep) {
    planTrip(start, { via: s, extra: all }).then(() => {
      done();
      const p = getState('plan');
      const first = p.stops[0];
      const msg = first?.station.id === s.id
        ? `Rota güncellendi: ${s.name} üzerinden, orada %${Math.round(first.arriveSoc)} → %${Math.round(first.leaveSoc)} şarj`
        : `Rota ${s.name} üzerinden güncellendi`;
      toast(msg, 5000);
      if (auto) speak(`Rota güncellendi. ${s.name} istasyonunda şarj durağı eklendi.`, { key: 'viaupdate', cooldownMs: 0, interrupt: true });
    });
  } else {
    planTrip().then(done);
  }
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
      + ` · %${CHARGE_TO}'e ≈ ${Math.round(s.minutes)} dk, ${s.cost.toFixed(0)} TL`
      + (slotLabel(s) ? ` · ${slotLabel(s)}` : ' · doluluk bilgisi yok'));
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

/** Önerilecek istasyonlar: ulaşılabilir olanlar önce, yol üstündekiler hafif öncelikli, kalanı yola göre sıralı. */
function rankNearby() {
  const items = visible().filter((s) => !s.slow);
  const pool = items.length ? items : enrich(all);
  const eng = getState('engine');
  const plan = getState('plan');
  const score = (s) => {
    if (plan.profile && eng.routeKm != null) {
      const p = plan.profile.project(s.lat, s.lon, eng.routeKm);
      if (p.offKm < 3 && p.km > eng.routeKm) return s.roadKm - 2; // yol üstünde: hafif tercih (düşük pilde en yakın olan yine öncelikli)
    }
    return s.roadKm;
  };
  const live = pool.filter((s) => slotKind(s) !== 'out'); // tamamen arızalı istasyon önerilmez
  const usablePool = live.length ? live : pool;
  const ok = usablePool.filter((s) => s.reachable);
  const pen = (s) => (slotKind(s) === 'full' ? 10 : 0); // dolu görünen istasyon ~10 km daha uzak sayılır
  return [...(ok.length ? ok : usablePool)].sort((a, b) => score(a) + pen(a) - (score(b) + pen(b)));
}

/** Uyarı çubuğu: başlık + (varsa) en yakın 3 istasyon, her biri için Git düğmesi. */
function showAlert(title, stations = []) {
  const bar = $('near-alert');
  if (!title) { bar.classList.add('hidden'); patch('nav', { alert: null }); return; }
  const body = $('near-alert-body');
  body.replaceChildren(Object.assign(document.createElement('div'), { textContent: title }));
  stations.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'near-row';
    const info = document.createElement('span');
    info.textContent = s.name;
    info.append(cell('small', '', `${fmtKm(s.distKm)} km · ${s.kw} kW · ${s.price.toFixed(2)} TL/kWh`
      + (s.arrive != null ? ` · varışta ~%${Math.max(0, s.arrive).toFixed(0)}` : '') + (s.reachable ? '' : ' · yetmeyebilir')
      + (slotLabel(s) ? ` · ${slotLabel(s)}` : '')));
    const go = cell('button', 'btn primary sm', '🧭 Git');
    go.type = 'button';
    go.addEventListener('click', () => goTo(s));
    row.append(info, go);
    body.append(row);
  });
  if (stations.length) {
    const all3 = cell('button', 'btn ghost sm', '📋 Tüm listeyi aç');
    all3.type = 'button';
    all3.addEventListener('click', () => document.querySelector('.bottomnav [data-tab="stations"]')?.click());
    body.append(all3);
  }
  bar.classList.remove('hidden');
  patch('nav', { alert: { text: title, id: stations[0]?.id ?? null } });
}

let dismissedUntil = 0;
let lastAutoVia = 0;

/** Pil eşiğin altında veya plan "ulaşılamıyor" diyorsa sorun var. */
function inTrouble(e, nav) {
  return e.soc != null && (e.soc <= nav.lowSoc || (getState('advisor').level === 'bad' && (e.speed ?? 0) > 5));
}

/** Veri yoksa/eskiyse kendiliğinden ara (45 sn'de bir; başarısız denemeler döngüye girmesin). */
function autoSearch(widen = false) {
  if (busy || Date.now() - meta.at < 45000) return;
  if (widen && radius < 50) { radius = 50; save('nearRadius', radius); $('near-radius').value = '50'; }
  refreshNearby({ silent: true, force: true });
}

function checkLow() {
  const e = effective();
  const nav = getState('nav');
  if (e.soc == null) return;
  if (e.lat == null) { // konum bilinmiyorsa istasyonlar aranamaz: kullanıcıyı uyar
    if (e.soc <= nav.lowSoc && Date.now() >= dismissedUntil) showAlert(`Pil %${Math.round(e.soc)}: yakındaki istasyonları listelemek için konum gerekli. Üstteki 📍 düğmesiyle GPS'i aç.`);
    return;
  }
  if (!inTrouble(e, nav)) {
    if (e.soc > nav.lowSoc + 3) { bands.clear(); if (getState('nav').alert) showAlert(null); }
    return;
  }
  if (Date.now() < dismissedUntil) return;

  const soc = Math.round(e.soc);
  if (!all.length) {
    const why = meta.at ? (meta.errors[0] ? `arama başarısız: ${meta.errors[0]}` : `${radius} km çevrede istasyon bulunamadı`) : 'aranıyor…';
    showAlert(`Pil %${soc}: yakındaki istasyonlar ${why}`);
    autoSearch(meta.at > 0); // önceki arama boş döndüyse yarıçapı 50 km'ye çıkarıp kendiliğinden yeniden dene
    return;
  }
  const ranked = rankNearby();
  const best = ranked[0];
  if (!best) { showAlert(`Pil %${soc}: uygun istasyon bulunamadı`); autoSearch(true); return; }
  const planBroken = getState('advisor').level === 'bad';
  const updated = Date.now() - lastAutoVia < 10 * 60e3;
  showAlert(`Pil %${soc} — en yakın şarj istasyonları:` + (updated ? ' (rota otomatik güncellendi)' : ''), ranked.slice(0, 3));
  // Plan sıradaki durağa/varışa ulaşılamıyor diyorsa: navigasyonda rotayı en uygun istasyon üzerinden kendiliğinden güncelle
  if (planBroken && nav.active && getState('route').end && !updated && best.reachable && (best.arrive ?? 99) >= 5
      && getState('plan').stops[0]?.station.id !== best.id && getState('plan').status !== 'loading') {
    lastAutoVia = Date.now();
    goTo(best, { auto: true });
  }

  // Her pil bandında (eşik, 15, 10, 5) bir kez konuş
  const band = [nav.lowSoc, 15, 10, 5].filter((b) => e.soc <= b).sort((a, b) => a - b)[0] ?? nav.lowSoc;
  if (!bands.has(band)) {
    bands.add(band);
    speak(`Pil yüzde ${soc}. En yakın şarj istasyonu ${best.name}, ${fmtKm(best.distKm)} kilometre. ${best.kw} kilovat, kilovat saati ${best.price.toFixed(1).replace('.', ',')} lira.`, { key: 'low' + band, cooldownMs: 0, interrupt: true });
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
  const lowNow = inTrouble(e, nav);
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
  setInterval(() => { if (!busy) checkLow(); }, 5000); // sorun varsa 30 sn beklemeden öner/ara
}
