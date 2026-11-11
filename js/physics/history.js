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
 * İki pil kenarı (ya da elle girilen iki pil değeri) arasındaki pencereden ölçüm kaydı üretir; geçersizse null.
 * a/b: { odo, sec, soc, modelKwh, tSum, hwSum, gSum }. kLo/kHi: kabul edilen ölçülen/model oranı aralığı (consScale'siz).
 */
export function buildRecord(a, b, kLo, kHi, battery = BAT, consScale = PHYSICS.consScale) {
  const dist = b.odo - a.odo;
  const drop = a.soc - b.soc;
  if (!(dist > 0) || !(drop > 0)) return null;
  const measuredKwh = (drop / 100) * battery;
  const modelDelta = b.modelKwh - a.modelKwh; // model, kullanıcının tüketim düzeltmesini (consScale) içerir
  const hours = (b.sec - a.sec) / 3600;
  const v = hours > 0 ? dist / hours : 0;
  const kBase = modelDelta > 0.05 ? (measuredKwh * consScale) / modelDelta : null; // consScale'den bağımsız ölçülen/model oranı
  if (kBase == null || v < 20 || v > 200 || kBase < kLo || kBase > kHi) return null;
  const t = Date.now();
  const pos = effective();
  const trip = recs.length ? recs.at(-1).trip + (t - recs.at(-1).t > TRIP_GAP_MS ? 1 : 0) : 1;
  return {
    t, trip, dist: +dist.toFixed(2), v: Math.round(v), drop,
    kwh100: +((measuredKwh / dist) * 100).toFixed(2),
    model: +((modelDelta / consScale / dist) * 100).toFixed(2), // consScale'siz model kWh/100km
    kBase: +kBase.toFixed(3),
    temp: Math.round((b.tSum - a.tSum) / dist),
    hw: Math.round((b.hwSum - a.hwSum) / dist),
    grade: +(((b.gSum - a.gSum) / dist) * 100).toFixed(1),
    lat: pos.lat != null ? +pos.lat.toFixed(4) : null, lon: pos.lon != null ? +pos.lon.toFixed(4) : null, // yolculuğun nerede olduğu (geçmiş ve hesap geçmişi için)
    dest: String(getState('route').end?.label || '').slice(0, 40) || null,
  };
}

function pushRecord(rec) {
  recs.push(rec);
  if (recs.length > MAX_RECORDS) recs = recs.slice(-MAX_RECORDS);
  relCache = new Map();
  save(KEY, recs);
  notify();
}

// ---- Kamerasız öğrenme: elle girilen pil de ölçüm sayılır -------------------------------------------------------------
// Kullanıcı yol aldıktan sonra pili elle girerse (kamera yokken tek gerçek bilgi bu), iki giriş arasındaki düşüş ve yol
// bir ölçüm penceresi olur. Pil yüzdesi tam sayı ve el okuması ±1 puan oynak olduğundan pencere en az MIN_MAN_DROP puan ve
// MIN_MAN_KM yol ister; kayıt kameralı ölçümle aynı biçimde tutulur (planlama ve hız düzeltmesi onu da kullanır).
export const MIN_MAN_KM = 10;
export const MIN_MAN_DROP = 5;
export const MAX_MAN_KM = 500; // daha uzun aralıkta araya şarj girmiş olabilir
const MAN_SETTLE_MS = 3000; // sürgü sürüklenirken ara değerler ölçüm sayılmasın: son değer bu kadar beklenince kesinleşir
const MAN_K_LO = 0.5;
const MAN_K_HI = 2;

/** Bir önceki elle referans (a) ile yeni giriş (b) arasında ne yapılır: 'reset' (referansı b yap), 'keep' (a'yı koru) ya da 'record' + kayıt. */
export function manualStep(a, b, battery = BAT, consScale = PHYSICS.consScale) {
  if (!a) return { action: 'reset' };
  if (b.soc >= a.soc) return { action: 'reset' }; // yükseldi: şarj ya da düzeltme, pencere geçersiz
  const dist = b.odo - a.odo;
  const drop = a.soc - b.soc;
  if (dist > MAX_MAN_KM) return { action: 'reset' };
  if (dist < MIN_MAN_KM) return drop >= MIN_MAN_DROP ? { action: 'reset' } : { action: 'keep' }; // yol almadan büyük atlama: elle düzeltme
  if (drop < MIN_MAN_DROP) return { action: 'keep' };
  const rec = buildRecord(a, b, MAN_K_LO, MAN_K_HI, battery, consScale);
  return rec ? { action: 'record', rec } : { action: 'reset' };
}

let manual = null; // elle girilen pilin son geçerli referansı
let manualTimer = null;

function commitManual(soc) {
  if (getState('sim').enabled) { manual = null; return; } // Test Modu ölçüm değildir
  const snap = { odo, sec, soc, modelKwh, tSum, hwSum, gSum };
  const r = manualStep(manual, snap);
  if (r.action === 'reset') { manual = snap; return; }
  if (r.action === 'keep') return;
  pushRecord(r.rec);
  manual = snap;
  // Canlı k: kameralı ölçümdeki gibi yumuşak karışım (sınır 0,6–1,8); consScale'siz oran consScale'e bölünerek canlı k'ya çevrilir
  const kLive = Math.min(1.8, Math.max(0.6, r.rec.kBase / PHYSICS.consScale));
  const k = getState('engine').k * 0.6 + kLive * 0.4;
  patch('engine', { k });
  save('kCal', k);
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('consumption-learned', { detail: { kwh100: r.rec.kwh100, k, dist: r.rec.dist } }));
}

/** Kullanıcı pili elle girdi (sürgü, +/−). Değer sürüklemeden sonra kesinleşince ölçüm penceresi değerlendirilir. */
export function noteManualSoc(soc) {
  clearTimeout(manualTimer);
  manualTimer = setTimeout(() => commitManual(soc), MAN_SETTLE_MS);
}

/** Test için: bekleme olmadan değerlendir. */
export const __test = { commit: commitManual, reset: () => { manual = null; clearTimeout(manualTimer); }, anchor: () => manual };

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

  const rec = buildRecord(anchor, snap, 0.4, 3);
  if (rec) pushRecord(rec);
  anchor = snap;
}

/**
 * Ölçüm boşluğu (sayfa arka planda ya da GPS sustu): aradaki yol bilinmediği için açık pencereler (kameralı ve elle girilen pil)
 * geçersizdir; bir sonraki pil değeri yeni başlangıç olur. Böylece boşlukta düşen pil, kısa sayılan mesafeye bölünüp aşırı tüketim kaydı üretmez.
 */
export function breakWindow() {
  anchor = null;
  lastSoc = null;
  manual = null; // elle girişin eski referansı silinir; bekleyen giriş (sürgü zamanlayıcısı) iptal edilmez, kesinleşince yeni referans olur
}

export const records = () => recs;

/** Bu oturumda gidilen toplam yol (km; Test Modu hariç). */
export const odometerKm = () => odo;

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
