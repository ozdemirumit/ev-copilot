// Test Modu sürücüsü (v0.99.127; SAF: ağ/DOM/depolama/zaman okumaz, her şey parametreyle gelir).
// Eskiden araç menzil profilinin ~2 km'lik kirişleri üzerinde sabit hızla (sürgü) ilerliyordu: köşeleri kesiyor, rotadan sapıyor, yönü köşelerde sıçrıyordu.
// Şimdi navigasyonun kullandığı GERÇEK rota izinde (js/nav/track.js) sürülür: konum her zaman rotanın üstündedir; hız sürgüdeki hedefe ivmelenir/frenlenir,
// virajlarda konforlu yanal ivmeye (2 m/s²) göre yavaşlar, varışta durur; yön hedef yöne sınırlı dönüş hızıyla yaklaşır.
import { buildTrack, pointAtKm, headingAt, locate } from '../nav/track.js';
import { bearing, angleDiff } from '../utils/geo.js';

export const DRIVER = Object.freeze({
  accel: 1.6, // m/s² (0→90 km/sa ≈ 16 sn)
  decel: 2.8, // m/s² üst sınır; viraj/varış planı bunun %85'iyle yapılır (pay)
  planFactor: 0.85,
  latAccel: 2.0, // m/s² konforlu yanal ivme (js/nav/curveLogic.js ile aynı)
  minCornerMs: 2.5, // en yavaş viraj hızı (≈ 9 km/sa)
  capStepM: 10, armM: 30, // viraj yarıçapı: ±30 m'lik iki yay arası yön değişimi (curveLogic ile aynı yöntem)
  lookM: 450, // frenleme için ileriye bakış
  hdgRate: 70, // °/sn en çok dönüş hızı
  headingLookKm: 0.06,
  endStopM: 4, // varışta bu kadar metre önce tam dur
  arriveM: 8, // kalan mesafe bu kadar ya da azsa ve araç durduysa varıldı
  maxSubstepS: 0.5, // zaman çarpanı büyükken bile her adım en çok bu kadar sim-saniye
});

/** Rota koordinatlarından sürüş verisi: gerçek iz + 10 m adımlı viraj hız tavanı (m/s; düz yolda Infinity). */
export function prepareDrive(coords, c = DRIVER) {
  const track = buildTrack(coords);
  const n = Math.max(1, Math.floor((track.totalKm * 1000) / c.capStepM) + 1);
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(pointAtKm(track, (i * c.capStepM) / 1000));
  const a = Math.max(1, Math.round(c.armM / c.capStepM));
  const cap = new Float32Array(n).fill(Infinity);
  for (let k = a; k < n - a; k++) {
    const rad = (Math.abs(angleDiff(bearing(pts[k], pts[k + a]), bearing(pts[k - a], pts[k]))) * Math.PI) / 180;
    if (rad > 0.05) cap[k] = Math.max(c.minCornerMs, Math.sqrt(c.latAccel * (c.armM / rad)));
  }
  return { track, cap, step: c.capStepM };
}

/** Bulunulan km'de izin verilen en yüksek hız (m/s): ilerideki her viraj tavanına ve varışa planlı frenle ulaşabilmek için. */
export function speedLimitAhead(drive, km, c = DRIVER) {
  const { cap, step, track } = drive;
  const dp = c.decel * c.planFactor;
  const i0 = Math.max(0, Math.floor((km * 1000) / step));
  const nLook = Math.ceil(c.lookM / step);
  let lim = Infinity;
  for (let j = 0; j <= nLook; j++) {
    const v = cap[i0 + j];
    if (v === undefined) break;
    if (v === Infinity) continue;
    const dist = Math.max(0, (i0 + j) * step - km * 1000);
    lim = Math.min(lim, Math.sqrt(v * v + 2 * dp * dist));
  }
  const remM = Math.max(0, (track.totalKm - km) * 1000 - c.endStopM);
  return Math.min(lim, Math.sqrt(2 * dp * remM));
}

/**
 * Bir adım ilerlet. s: { km, v (m/s), hdg (derece, yoksa rotadan) }; targetKmh: sürgüdeki hedef hız; dt: SİMÜLE saniye (gerçek süre × zaman çarpanı).
 * Dönüş: { km, v, hdg, lat, lon, arrived } (v m/s).
 */
export function stepDrive(drive, s, { targetKmh, dt }, c = DRIVER) {
  const { track } = drive;
  let km = Math.min(track.totalKm, Math.max(0, Number.isFinite(s.km) ? s.km : 0));
  let v = Math.max(0, Number.isFinite(s.v) ? s.v : 0);
  let hdg = Number.isFinite(s.hdg) ? ((s.hdg % 360) + 360) % 360 : headingAt(track, km, c.headingLookKm);
  const target = Math.max(0, Number.isFinite(targetKmh) ? targetKmh : 0) / 3.6;
  let left = Math.max(0, Number.isFinite(dt) ? dt : 0);
  while (left > 1e-9) {
    const h = Math.min(left, c.maxSubstepS);
    left -= h;
    const desired = Math.min(target, speedLimitAhead(drive, km, c));
    v = Math.max(0, v + Math.max(-c.decel * h, Math.min(c.accel * h, desired - v)));
    km = Math.min(track.totalKm, km + (v * h) / 1000);
    const dh = angleDiff(headingAt(track, km, c.headingLookKm), hdg);
    hdg = (((hdg + Math.max(-c.hdgRate * h, Math.min(c.hdgRate * h, dh))) % 360) + 360) % 360;
  }
  const p = pointAtKm(track, km);
  return { km, v, hdg, lat: p.lat, lon: p.lon, arrived: (track.totalKm - km) * 1000 <= c.arriveM && v < 0.3 }; // varış: yakın VE durmuş (hareket halindeyken aniden bitmez)
}

/** Yeni rota (yeniden planlama) gelince araç konumunu yeni izde bul: yakınsa izdüşüm km'si, uzaksa eski km (sınırlı). */
export function relocate(drive, lat, lon, hintKm) {
  if (lat == null || lon == null) return Math.min(drive.track.totalKm, Math.max(0, hintKm ?? 0));
  const loc = locate(drive.track, lat, lon, hintKm ?? null);
  return loc.offKm <= 0.4 ? loc.km : Math.min(drive.track.totalKm, Math.max(0, hintKm ?? 0));
}
