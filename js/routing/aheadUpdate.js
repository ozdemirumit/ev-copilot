// Yolda rota profilini tazeleme (saf hesap): bulunulan konumdan sonrası için yeni hava ve trafikli hız verisini mevcut ham veriye işler.
import { segmentSpeeds } from '../physics/routeSpeed.js';

export const WX_STEP_KM = 50; // hava noktaları arası (rota kurulurken de böyle)
const MAX_DIST_DIFF = 0.15; // yeni rotanın kalan uzunluğu, eski rotanın kalanından bu orandan fazla saparsa başka yol sayılır: hız verisi uygulanmaz

/** Hava sorgulanacak rota km'leri: bulunulan konum, sonra 50 km'nin katları, en son varış. */
export function wxQueryKms(totalKm, km) {
  const out = [km];
  for (let k = Math.ceil((km + 1) / WX_STEP_KM) * WX_STEP_KM; k < totalKm - 1; k += WX_STEP_KM) out.push(k);
  if (totalKm - km > 1) out.push(totalKm);
  return out;
}

/** Eski hava noktalarından geride kalanlar korunur, konumdan ilerisi yeni değerlerle değişir. fresh: [{ km, ...hava }]. */
export function mergeWx(oldWx, km, fresh) {
  return [...(Array.isArray(oldWx) ? oldWx : []).filter((w) => w.km < km), ...fresh];
}

/**
 * Yeni trafikli rotanın adım sürelerinden, konumdan sonraki dilimlerin hızlarını yeniden hesapla.
 * pts: rota dilim noktaları ({ km, lat, lon }) · speeds: şimdiki dilim hızları ({ vFree, tf }) · km: bulunulan rota km'si ·
 * rt: yeni rota ({ steps (staticSec dolu), intervals, distanceKm }), başlangıcı bulunulan konum.
 * Dönüş: { speeds } (aynı uzunlukta; geçilen dilimler aynen) ya da uygulanamazsa null.
 */
export function mergeSpeeds({ pts, speeds, km, rt }) {
  if (!Array.isArray(pts) || pts.length < 3 || !Array.isArray(speeds) || !rt?.steps?.some((s) => s.staticSec > 0)) return null;
  const total = pts.at(-1).km;
  const remain = total - km;
  if (!(remain >= 3) || !(rt.distanceKm > 0) || Math.abs(rt.distanceKm - remain) / remain > MAX_DIST_DIFF) return null;
  let i0 = 0;
  while (i0 < pts.length - 2 && pts[i0 + 1].km <= km) i0++; // bulunulan dilim: pts[i0] → pts[i0 + 1]
  const a = pts[i0];
  const b = pts[i0 + 1];
  const f = Math.min(1, Math.max(0, (km - a.km) / (b.km - a.km || 1)));
  const rebased = [{ km: 0, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }, ...pts.slice(i0 + 1).map((p) => ({ ...p, km: p.km - km }))];
  if (rebased.length < 2 || rebased[1].km <= 0) return null;
  const fresh = segmentSpeeds({ steps: rt.steps, intervals: rt.intervals || [] }, rebased);
  return { speeds: [...speeds.slice(0, i0), ...fresh.segs], from: i0, avgFreeKmh: fresh.avgFreeKmh };
}
