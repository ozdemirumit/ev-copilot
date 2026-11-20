// Sert viraj uyarısı (saf; ağ/DOM yok). Rotanın GERÇEK geometrisinden (hangi sağlayıcı olursa olsun aynı) hesaplanır; ek istek yapılmaz.
//  - Her 10 m'de iz örneklenir; ±30 m'lik iki yay arasındaki yön değişiminden yarıçap R ≈ 30 m / θ(rad) bulunur
//    (pencere kısa yayları da yakalar: sentetik yaylarda tahmin gerçek yarıçapa ±%15 yakın; 40 m pencerede kısa yaylar %12–36 büyük çıkıyordu).
//  - R ≤ 90 m ve toplam dönüş ≥ 45° olan kesim "sert viraj"; R ≤ 40 m ve dönüş ≥ 120° ise "keskin dönemeç" (saç tokası).
//  - Önerilen hız: konforlu yanal ivme 2 m/s² → v = 3,6·√(2·R) km/sa (5'e yuvarlanır, en az 20).
//  - Kavşak, dönüş, rampa ve döner kavşak gibi manevra adımlarının 120 m yakınındaki kesimler viraj sayılmaz (talimat zaten söyleniyor).
//  - Rota geometrisi çok kabaysa (ortalama köşe aralığı > 60 m) hiç uyarı üretilmez: yarıçap güvenilir değildir, tahminle uyarı yok.
import { buildTrack, pointAtKm } from './track.js';
import { bearing, angleDiff } from '../utils/geo.js';
import { isMinor } from './steps.js';

export const CURVE = Object.freeze({
  stepM: 10, armM: 30, maxRadiusM: 90, minTurnDeg: 45, hairpinRadiusM: 40, hairpinTurnDeg: 120,
  mergeGapM: 60, clearM: 120, maxSpacingM: 60, latAccel: 2.0,
  leadKm: [0.2, 0.6], // kesime bu kadar km kala (aralık) bir kez sesli uyarı
  showKm: 1.0, // ekranda bu mesafeden itibaren gösterilir
});

/** Rota izindeki sert virajlar, km'ye göre sıralı: { km0, km1, minR, turnDeg, dir: 'left'|'right', adviseKmh, hairpin }. */
export function sharpCurves(coords, steps = [], c = CURVE) {
  if (!Array.isArray(coords) || coords.length < 3) return [];
  const track = buildTrack(coords);
  const totalM = track.totalKm * 1000;
  if (!(totalM > 4 * c.armM)) return [];
  if (totalM / (track.n - 1) > c.maxSpacingM) return []; // kaba geometri: yarıçap güvenilir değil
  const n = Math.floor(totalM / c.stepM);
  const a = Math.round(c.armM / c.stepM);
  if (n < 2 * a + 2) return [];
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(pointAtKm(track, (k * c.stepM) / 1000));

  const rows = [];
  for (let k = a; k <= n - a; k++) {
    const d = angleDiff(bearing(pts[k], pts[k + a]), bearing(pts[k - a], pts[k])); // + sağ, − sol
    const rad = (Math.abs(d) * Math.PI) / 180;
    rows.push({ k, d, r: rad > 0.01 ? c.armM / rad : Infinity });
  }

  const gapMax = Math.max(1, Math.round(c.mergeGapM / c.stepM));
  const groups = [];
  let g = null;
  for (const row of rows) {
    if (row.r > c.maxRadiusM) continue;
    const sign = Math.sign(row.d);
    if (g && row.k - g.last <= gapMax && (sign === g.sign || Math.abs(row.d) < 5)) { g.last = row.k; g.minR = Math.min(g.minR, row.r); continue; }
    g = { first: row.k, last: row.k, sign, minR: row.r };
    groups.push(g);
  }

  const majors = (steps || []).filter((st) => Number.isFinite(st?.km) && !isMinor(st)).map((st) => st.km);
  const clearKm = c.clearM / 1000;
  const out = [];
  for (const q of groups) {
    const hStart = bearing(pts[Math.max(0, q.first - a)], pts[q.first]);
    const hEnd = bearing(pts[q.last], pts[Math.min(n, q.last + a)]);
    const turn = angleDiff(hEnd, hStart);
    if (Math.abs(turn) < c.minTurnDeg) continue;
    const km0 = Math.max(0, (q.first * c.stepM - c.armM) / 1000);
    const km1 = (q.last * c.stepM + c.armM) / 1000;
    if (majors.some((m) => m >= km0 - clearKm && m <= km1 + clearKm)) continue; // kavşak/dönüş: talimat zaten var
    const minR = Math.round(q.minR);
    const turnDeg = Math.round(Math.abs(turn));
    out.push({
      km0, km1, minR, turnDeg, dir: turn > 0 ? 'right' : 'left',
      adviseKmh: Math.max(20, Math.round((3.6 * Math.sqrt(c.latAccel * q.minR)) / 5) * 5),
      hairpin: q.minR <= c.hairpinRadiusM && Math.abs(turn) >= c.hairpinTurnDeg,
    });
  }
  return out.sort((x, y) => x.km0 - y.km0);
}

/**
 * Şu anki rota km'sine göre viraj uyarısı. said: söylenenlerin anahtarları (Set; burada güncellenir).
 * Dönüş: { speak: [{ ...viraj, key, dKm }], line } — line: ekranda gösterilecek en yakın viraj (yoksa null).
 */
export function pickCurves(km, curves, said, { enabled = true } = {}) {
  const speak = [];
  let line = null;
  if (!enabled || !Number.isFinite(km)) return { speak, line };
  for (const cv of curves) {
    const d = cv.km0 - km;
    if (d > CURVE.showKm) break; // sıralı: sonrakiler daha uzak
    if (d < 0) continue; // içindeyiz ya da geçtik
    if (!line) line = { ...cv, dKm: d };
    const key = `v${cv.km0.toFixed(2)}`;
    if (d >= CURVE.leadKm[0] && d <= CURVE.leadKm[1] && !said.has(key)) {
      said.add(key);
      speak.push({ ...cv, key, dKm: d });
    }
  }
  return { speak, line };
}
