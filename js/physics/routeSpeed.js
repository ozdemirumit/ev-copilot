// Rotanın hızı rota adımlarından okunur (elle seyir hızı / trafik tahmini yok):
//  - serbest akış hızı: Routes API adımlarının trafiksiz süresinden (staticDuration) → yol limiti/yol sınıfı yansır
//  - trafik: TRAFFIC_ON_POLYLINE aralıkları (NORMAL / SLOW / TRAFFIC_JAM) → hız çarpanı
// Çıktı rota profiline (her ~2 km dilim) hız olarak verilir; enerji, süre ve hava zamanlaması bunu kullanır.

export const TRAFFIC_MULT = { SLOW: 0.6, TRAFFIC_JAM: 0.3 }; // NORMAL = 1
const V_MIN = 15;
const V_MAX = 130;

/** Parça-parça doğrusal yardımcı: edges (km, artan) ve her kenarda birikmiş değer vals → x'teki değer. */
function lerpAt(edges, vals, x) {
  if (x <= edges[0]) return vals[0];
  if (x >= edges.at(-1)) return vals.at(-1);
  let lo = 0;
  let hi = edges.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= x) lo = mid; else hi = mid;
  }
  const t = (x - edges[lo]) / (edges[hi] - edges[lo] || 1);
  return vals[lo] + (vals[hi] - vals[lo]) * t;
}

/**
 * rt: { steps: [{ distM, staticSec }], intervals: [{ from, to, mult }] (km) } · pts: resampleRoute çıktısı.
 * Dönüş: { segs: [{ vFree, tf }] (pts[i]→pts[i+1]), cumH: pts ile aynı uzunlukta kümülatif saat, avgFreeKmh }.
 */
export function segmentSpeeds(rt, pts) {
  const totalKm = pts.at(-1).km;
  // Adım kenarları (km) ve birikmiş trafiksiz süre (saat); adım toplam uzunluğu rota uzunluğuna ölçeklenir
  const sumKm = rt.steps.reduce((a, s) => a + s.distM, 0) / 1000;
  const scale = sumKm > 0 ? totalKm / sumKm : 1;
  const edges = [0];
  const hours = [0];
  rt.steps.forEach((s) => {
    if (!s.distM) return;
    edges.push(edges.at(-1) + (s.distM / 1000) * scale);
    hours.push(hours.at(-1) + (s.staticSec > 0 ? s.staticSec / 3600 : s.distM / 1000 / 100)); // süre yoksa 100 km/h varsay
  });
  const hasStatic = rt.steps.some((s) => s.staticSec > 0);

  const segs = [];
  const cumH = [0];
  let freeH = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i].km;
    const b = pts[i + 1].km;
    const d = b - a;
    const dh = lerpAt(edges, hours, b) - lerpAt(edges, hours, a);
    const vFree = hasStatic && dh > 0 ? Math.min(V_MAX, Math.max(V_MIN, d / dh)) : 100;
    // Trafik: bu dilimle kesişen aralıkların süreye katkısı (harmonik: süre = pay / çarpan)
    let slowFrac = 0;
    let timeMult = 0;
    for (const iv of rt.intervals) {
      const ov = Math.min(b, iv.to) - Math.max(a, iv.from);
      if (ov > 0) { slowFrac += ov / d; timeMult += (ov / d) / iv.mult; }
    }
    const tf = 1 / (Math.max(0, 1 - slowFrac) + timeMult); // 1 = akıcı, 0,3 = sıkışık
    segs.push({ vFree, tf: Math.min(1, tf) });
    cumH.push(cumH[i] + d / Math.max(5, vFree * Math.min(1, tf)));
    freeH += d / vFree;
  }
  return { segs, cumH, avgFreeKmh: totalKm / (freeH || 1) };
}
