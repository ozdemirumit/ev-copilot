// Şarj durağına varışta pil kalibrasyonu (saf mantık + cihaz kaydı). Sürücü durağa varınca araçta gördüğü pil yüzdesini girer;
// uygulamanın tahmini ile gerçek arasındaki fark "hesap geçmişi"nde tutulur. Girilen değer ayrıca elle pil girişi olarak
// tüketim öğrenmeye katılır (physics/history.js: iki elle giriş arasındaki düşüş ve yol ölçüm sayılır).
import { load, save } from '../utils/storage.js';
import { haversineKm } from '../utils/geo.js';

const KEY = 'arrivals';
const MAX = 200;

export const STOP_KMH = 6; // GPS gürültüsü payı: bu hızın altı duruyor sayılır
export const NEAR_KM = 0.15; // istasyona bu kadar yakın
export const DWELL_MS = 20_000; // bu kadar süre durmuş olmalı (kavşakta/geçişte sorulmasın)
export const MIN_DRIVE_KM = 5; // son istemden/kalibrasyondan beri en az bu kadar yol (evin yanındaki istasyonda sorulmasın)
export const COOLDOWN_MS = 60 * 60e3; // aynı durak için tekrar sorma süresi

export const arrivalLog = () => load(KEY, []);

/** pos'a NEAR_KM içindeki en yakın istasyon (yoksa null). */
export function nearestWithin(stations, pos, maxKm = NEAR_KM) {
  if (!Array.isArray(stations) || pos?.lat == null) return null;
  let best = null;
  let bd = maxKm;
  for (const s of stations) {
    if (s?.lat == null || s?.lon == null) continue;
    const d = haversineKm({ lat: pos.lat, lon: pos.lon }, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

/**
 * Varış istemi gösterilmeli mi? stoppedMs: araç ne kadardır duruyor · driven: son istemden beri gidilen km ·
 * lastForStation: bu durak için son istem zamanı (ms) ya da undefined.
 */
export function shouldPrompt({ station, speed, stoppedMs, driven, lastForStation, now }) {
  if (!station) return false;
  if ((speed ?? 0) > STOP_KMH) return false;
  if (!(stoppedMs >= DWELL_MS)) return false;
  if (!(driven >= MIN_DRIVE_KM)) return false;
  if (lastForStation != null && now - lastForStation < COOLDOWN_MS) return false;
  return true;
}

/** Bir varış kalibrasyonu kaydeder. est: uygulamanın tahmini, actual: sürücünün girdiği, plan: planın varış tahmini (yoksa null). */
export function addArrival({ station, lat, lon, est, actual, plan = null }) {
  const rec = {
    id: 'ar' + Date.now().toString(36),
    t: Date.now(),
    station: station || null,
    lat: lat != null ? +lat.toFixed(4) : null,
    lon: lon != null ? +lon.toFixed(4) : null,
    est: Math.round(est),
    actual: Math.round(actual),
    plan: plan == null ? null : Math.round(plan),
    err: Math.round(actual) - Math.round(est), // + : gerçek tahminden yüksek (uygulama fazla tüketim sanmış)
    planErr: plan == null ? null : Math.round(actual) - Math.round(plan),
  };
  const list = arrivalLog();
  list.push(rec);
  save(KEY, list.slice(-MAX));
  if (typeof document !== 'undefined') document.dispatchEvent(new Event('arrivals-changed'));
  return rec;
}
