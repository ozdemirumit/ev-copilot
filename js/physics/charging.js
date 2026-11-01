// Şarj oturumları: araç dururken (kameradan okunan) pil yüzdesi yükselirse bir şarj oturumu kaydedilir (yer, istasyon, süre, pil, kWh, ortalama kW, maliyet).
// Yalnızca kamera OCR'ı çevrimiçiyken ve Test Modu kapalıyken; elle girilen pil sayılmaz. Kayıtlar cihazda (`charges`) tutulur ve hesapla giriş yapılmışsa
// sunucudaki kalıcı geçmişe yüklenir (account/historySync.js).
import { load, save } from '../utils/storage.js';
import { effective, getState } from '../state.js';
import { VEHICLE } from '../config.js';
import { isOnline } from './socEstimate.js';
import { haversineKm } from '../utils/geo.js';

const MAX_LOCAL = 300;
const MIN_RISE = 3; // puan: bundan az yükselme şarj sayılmaz
const MIN_MIN = 3; // dk
const IDLE_END_MS = 6 * 60e3; // pil bu kadar süre yükselmezse oturum biter
const STOP_KMH = 3;
const MOVE_KMH = 8;
const NEAR_KM = 0.3;

let base = null; // { soc, t } durağan dönemdeki en düşük pil
let sess = null;

export const chargeLog = () => load('charges', []);

/** Bir şarj kaydını güncelle (ör. kullanıcının bildirdiği fiyat). */
export function updateCharge(id, part) {
  const list = chargeLog();
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...part };
  save('charges', list);
  document.dispatchEvent(new Event('charges-changed'));
}

function nearestStation(lat, lon) {
  let best = null;
  let bd = NEAR_KM;
  for (const s of getState('plan').stations || []) {
    const d = haversineKm({ lat, lon }, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function finish(now) {
  const s = sess;
  sess = null;
  base = null;
  const rise = s.soc1 - s.soc0;
  const min = (s.tEnd - s.t0) / 60e3;
  if (rise < MIN_RISE || min < MIN_MIN) return;
  const kwh = +((rise / 100) * VEHICLE.batteryNetKwh).toFixed(1);
  const st = nearestStation(s.lat, s.lon);
  const rec = {
    id: 'ch' + s.t0.toString(36), t: s.tEnd, t0: s.t0,
    lat: +s.lat.toFixed(4), lon: +s.lon.toFixed(4),
    station: st?.name ?? null, op: st?.opName ?? null, ratedKw: st?.kw ?? null,
    soc0: s.soc0, soc1: s.soc1, min: Math.round(min), kwh, avgKw: +(kwh / (min / 60)).toFixed(1),
    cost: st?.price != null ? +(kwh * st.price).toFixed(2) : null, price: st?.price ?? null,
    bat: VEHICLE.batteryNetKwh,
  };
  const list = chargeLog().filter((r) => r.id !== rec.id);
  list.push(rec);
  save('charges', list.slice(-MAX_LOCAL));
  document.dispatchEvent(new Event('charges-changed'));
}

function tick() {
  const e = effective();
  const now = Date.now();
  if (getState('sim').enabled || e.soc == null || e.lat == null || !isOnline()) { if (sess && now - sess.tLast > IDLE_END_MS) finish(now); return; }
  const v = e.speed ?? 0;
  if (sess) {
    if (e.soc > sess.soc1) { sess.soc1 = e.soc; sess.tLast = now; sess.tEnd = now; sess.lat = e.lat; sess.lon = e.lon; }
    if (v > MOVE_KMH || now - sess.tLast > IDLE_END_MS) finish(now);
    return;
  }
  if (v > STOP_KMH) { base = { soc: e.soc, t: now }; return; } // hareket halinde: tabanı sürekli güncelle
  if (!base || e.soc < base.soc) { base = { soc: e.soc, t: now }; return; }
  if (e.soc - base.soc >= 2) { // durağan ve pil yükseldi: oturum başladı
    sess = { soc0: base.soc, soc1: e.soc, t0: base.t, tLast: now, tEnd: now, lat: e.lat, lon: e.lon };
  }
}

export function initCharging() {
  setInterval(tick, 5000);
}
