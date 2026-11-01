// Sürüş geçmişi: gerçek tüketim ölçümleri (pil %'si düşüşü + gidilen mesafe) kayda alınır ve planlamada kullanılır.
// Ölçüm penceresi iki "pil kenarı" (SoC'nin değiştiği an) arasıdır; kayıtlar cihazda (LocalStorage `evcp.hist`) tutulur.
// Test Modu ve şarj sırasındaki veriler kaydedilmez.
import { load, save, remove } from '../utils/storage.js';
import { VEHICLE, PHYSICS } from '../config.js';
import { patch, effective, getState } from '../state.js';

const KEY = 'hist';
const MAX_RECORDS = 400; // ≈ 400 × ~10 km = birkaç bin km
const MIN_DIST_KM = 5;
const MIN_DROP = 3; // puan: ≥ 3 puanlık düşüş
const FALLBACK_DIST_KM = 30; // düşüş azsa bile bu kadar yol sonrası ≥ 1 puanla kapat
const MAX_DIST_KM = 60; // daha uzun pencere (veri boşluğu) atılır
const TRIP_GAP_MS = 25 * 60e3; // kayıtlar arası bu kadar boşluk yeni yolculuk sayılır
const BAT = VEHICLE.batteryNetKwh;

export const BANDS = [
  { label: '< 70', lo: 0, hi: 70 },
  { label: '70–90', lo: 70, hi: 90 },
  { label: '90–110', lo: 90, hi: 110 },
  { label: '110–130', lo: 110, hi: 130 },
  { label: '130+', lo: 130, hi: 999 },
];

let recs = load(KEY, []);
let odo = 0;
let sec = 0;
let modelKwh = 0;
let tSum = 0;
let hwSum = 0;
let gSum = 0;
let lastSoc = null;
let anchor = null;

const notify = () => patch('hist', { n: recs.length, at: Date.now() });

/**
 * Her saniye çağrılır (Test Modu hariç). dKm/dt: bu adımdaki yol (km) ve süre (sn); modelKwh: o adımın model enerjisi;
 * soc: tam sayı pil %; temp/headwind/grade: o anki rota koşulları.
 */
export function feed({ dKm, dt, moving, modelStepKwh, soc, temp, headwind, grade }) {
  odo += dKm;
  if (moving) sec += dt;
  modelKwh += modelStepKwh;
  tSum += temp * dKm;
  hwSum += headwind * dKm;
  gSum += grade * dKm;
  if (soc == null || soc === lastSoc) return;

  const prev = lastSoc;
  lastSoc = soc;
  if (prev == null) return; // ilk okuma kenar sayılmaz (ne zaman değiştiği belirsiz)
  if (soc > prev) { anchor = null; return; } // şarj/manuel düzeltme: pencere geçersiz

  const snap = { odo, sec, soc, modelKwh, tSum, hwSum, gSum };
  if (!anchor) { anchor = snap; return; }
  const dist = snap.odo - anchor.odo;
  const drop = anchor.soc - soc;
  if (dist > MAX_DIST_KM) { anchor = snap; return; }
  const ready = (drop >= MIN_DROP && dist >= MIN_DIST_KM) || (dist >= FALLBACK_DIST_KM && drop >= 1);
  if (!ready) return;

  const measuredKwh = (drop / 100) * BAT;
  const modelDelta = snap.modelKwh - anchor.modelKwh; // model, kullanıcının tüketim düzeltmesini (consScale) içerir
  const hours = (snap.sec - anchor.sec) / 3600;
  const v = hours > 0 ? dist / hours : 0;
  const kBase = modelDelta > 0.05 ? (measuredKwh * PHYSICS.consScale) / modelDelta : null; // consScale'den bağımsız ölçülen/model oranı
  if (kBase != null && v >= 20 && v <= 200 && kBase >= 0.4 && kBase <= 3) {
    const t = Date.now();
    const pos = effective();
    const trip = recs.length ? recs.at(-1).trip + (t - recs.at(-1).t > TRIP_GAP_MS ? 1 : 0) : 1;
    recs.push({
      t, trip, dist: +dist.toFixed(2), v: Math.round(v), drop,
      kwh100: +((measuredKwh / dist) * 100).toFixed(2),
      model: +((modelDelta / PHYSICS.consScale / dist) * 100).toFixed(2), // consScale'siz model kWh/100km
      kBase: +kBase.toFixed(3),
      temp: Math.round((snap.tSum - anchor.tSum) / dist),
      hw: Math.round((snap.hwSum - anchor.hwSum) / dist),
      grade: +(((snap.gSum - anchor.gSum) / dist) * 100).toFixed(1),
      lat: pos.lat != null ? +pos.lat.toFixed(4) : null, lon: pos.lon != null ? +pos.lon.toFixed(4) : null, // yolculuğun nerede olduğu (geçmiş ve hesap geçmişi için)
      dest: String(getState('route').end?.label || '').slice(0, 40) || null,
    });
    if (recs.length > MAX_RECORDS) recs = recs.slice(-MAX_RECORDS);
    relCache = new Map();
    save(KEY, recs);
    notify();
  }
  anchor = snap;
}

export const records = () => recs;

export function clearHistory() {
  recs = [];
  relCache = new Map();
  anchor = null;
  remove(KEY);
  notify();
}

/**
 * Bu hızda (±12 km/h) geçmişten ölçülen/model oranı (consScale'siz) ve dayandığı mesafe. Veri yoksa null.
 * Aykırı kayıtlar (pil yüzdesi elle düzeltilmiş, okuma hatası, karışık hızlı pencere) medyanın ±%40'ı dışında kalanlar atılır.
 */
export function kForSpeed(v) {
  let rs = recs.filter((r) => Math.abs(r.v - v) <= 12);
  if (rs.length >= 4) {
    const sorted = rs.map((r) => r.kBase).sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    rs = rs.filter((r) => r.kBase >= med * 0.6 && r.kBase <= med * 1.4);
  }
  const w = rs.reduce((a, r) => a + r.dist, 0);
  return w > 0 ? { kBase: rs.reduce((a, r) => a + r.kBase * r.dist, 0) / w, km: w } : null;
}

const REL_MIN_KM = 25; // iki hızda da bu kadar ölçüm yoksa hız düzeltmesi uygulanmaz
const REL_FULL_KM = 80; // bu kadar ölçümde düzeltme tam güvenle uygulanır (altında oransal yumuşatılır)
let relCache = new Map();

/** Tüm geçmişin mesafe ağırlıklı ortalama ölçülen/model oranı (aykırılar atılır) ve dayandığı mesafe; veri yoksa null. */
export function overall() {
  let rs = recs;
  if (rs.length >= 4) {
    const sorted = rs.map((r) => r.kBase).sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    rs = rs.filter((r) => r.kBase >= med * 0.6 && r.kBase <= med * 1.4);
  }
  const w = rs.reduce((a, r) => a + r.dist, 0);
  return w > 0 ? { kBase: rs.reduce((a, r) => a + r.kBase * r.dist, 0) / w, km: w } : null;
}

/**
 * Hıza bağlı göreli tüketim çarpanı: v hızındaki ölçülen/model oranının referanstakine (planın k'sının dayandığı hız; null ise tüm geçmiş ortalaması) oranı.
 * Planın k'sı referans hızı zaten düzelttiği için bu çarpan referansta 1'dir; dilimlerin gerçek hızı farklıysa (şehir içi, otoyol)
 * enerji o hızda gerçekte ölçülen sapmaya göre ayarlanır. Veri azsa 1'e doğru yumuşatılır; [0.75, 1.4] ile sınırlı.
 */
export function relFactor(v, vRef) {
  const key = `${Math.round(v / 3)}|${vRef == null ? 'o' : Math.round(vRef / 3)}`; // 3 km/s'lik kovalar: hesap önbelleğe alınır
  if (relCache.has(key)) return relCache.get(key);
  const a = kForSpeed(v);
  const b = vRef == null ? overall() : kForSpeed(vRef); // vRef yoksa: tüm geçmişin ortalaması referanstır
  let f = 1;
  if (a && b && a.km >= REL_MIN_KM && b.km >= REL_MIN_KM && b.kBase > 0) {
    const w = Math.min(1, Math.min(a.km, b.km) / REL_FULL_KM);
    f = 1 + (Math.min(1.4, Math.max(0.75, a.kBase / b.kBase)) - 1) * w;
  }
  relCache.set(key, f);
  return f;
}

/** Hız bandı başına ortalama tüketim (mesafe ağırlıklı) ve k. */
export function byBand() {
  return BANDS.map((b) => {
    const rs = recs.filter((r) => r.v >= b.lo && r.v < b.hi);
    const km = rs.reduce((a, r) => a + r.dist, 0);
    const wavg = (f) => (km ? rs.reduce((a, r) => a + f(r) * r.dist, 0) / km : null);
    return { label: b.label, km, kwh100: wavg((r) => r.kwh100), kBase: wavg((r) => r.kBase) };
  });
}

/** Son yolculuk ve tüm geçmiş özeti. */
export function summary() {
  const agg = (rs) => {
    const km = rs.reduce((a, r) => a + r.dist, 0);
    if (!km) return null;
    return {
      km,
      kwh100: rs.reduce((a, r) => a + r.kwh100 * r.dist, 0) / km,
      v: km / rs.reduce((a, r) => a + r.dist / r.v, 0), // harmonik: gerçek ortalama hız
      n: rs.length,
    };
  };
  const trip = recs.length ? recs.filter((r) => r.trip === recs.at(-1).trip) : [];
  return { trip: agg(trip), all: agg(recs) };
}
