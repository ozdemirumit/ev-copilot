import { haversineKm, bearing, headwindComponent } from '../utils/geo.js';
import { batteryPowerKw } from './model.js';
import { speedFactor, stopGoOverhead, densityFromRatio } from './traffic.js';

export const STEP_KM = 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Rota geometrisini (GeoJSON [lon,lat]) her ~2 km'de bir noktaya indirger. */
export function resampleRoute(coords, stepKm = STEP_KM) {
  const pts = [{ km: 0, lat: coords[0][1], lon: coords[0][0] }];
  let cum = 0;
  let nextAt = stepKm;
  for (let i = 1; i < coords.length; i++) {
    const a = { lat: coords[i - 1][1], lon: coords[i - 1][0] };
    const b = { lat: coords[i][1], lon: coords[i][0] };
    const d = haversineKm(a, b);
    if (d <= 0) continue;
    while (cum + d >= nextAt) {
      const f = (nextAt - cum) / d;
      pts.push({ km: nextAt, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
      nextAt += stepKm;
    }
    cum += d;
  }
  const last = coords.at(-1);
  if (cum - pts.at(-1).km > 0.05) pts.push({ km: cum, lat: last[1], lon: last[0] });
  return pts;
}

/**
 * Rota profili: her ~2 km'lik dilim için eğim, kafa rüzgarı, sıcaklık, yağış ve (varsayılan seyir hızında)
 * enerji/süre. Aynı dilimler farklı hızlarda yeniden hesaplanabilir (eco-hız tavsiyesi için).
 *  pts: resampleRoute çıktısı · elevations: pts ile aynı uzunlukta (m) veya null
 *  wx: [{ km, temp, rain, windSpeed, windDir }] · cruise: km/h · traffic: 0..100
 */
export function buildProfile({ pts, elevations, wx, cruise, traffic, elevSource = null, speeds = null }) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dKm = b.km - a.km;
    if (dKm <= 0.001) continue;
    const heading = bearing(a, b);
    const grade = elevations ? clamp((elevations[i + 1] - elevations[i]) / (dKm * 1000), -0.12, 0.12) : 0;
    const mid = (a.km + b.km) / 2;
    const w = wx.length ? wx.reduce((best, c) => (Math.abs(c.km - mid) < Math.abs(best.km - mid) ? c : best)) : null;
    segs.push({
      km0: a.km, km1: b.km, dKm, heading, grade, lat: a.lat, lon: a.lon,
      headwind: w ? headwindComponent(w.windSpeed, w.windDir, heading) : 0,
      temp: w?.temp ?? 15,
      rain: w?.rain ?? 0,
      wind: w ? { speed: w.windSpeed, dir: w.windDir } : null,
      // Google'dan: serbest akış hızı ve trafik çarpanı (yoksa seyir hızı + trafik yoğunluğuna düşülür)
      vFree: speeds?.[i]?.vFree ?? null,
      tf: speeds?.[i]?.tf ?? null,
    });
  }

  // vOv: hızı elle geçersiz kıl (eco-hız tavsiyesi). Yoksa dilimin Google hızı (vFree × tf), o da yoksa seyir hızı × trafik.
  const cost = (seg, vOv = null) => {
    const vf = vOv ?? seg.vFree ?? cruise;
    const tfac = seg.tf ?? speedFactor(traffic);
    const dens = seg.tf != null ? densityFromRatio(1 / seg.tf) : traffic;
    const vEff = Math.max(5, vf * tfac);
    const p = batteryPowerKw({ v: vEff, grade: seg.grade, headwind: seg.headwind, temp: seg.temp, rain: seg.rain });
    const h = seg.dKm / vEff;
    return { kwh: p * h * stopGoOverhead(dens), h, p };
  };

  // Varsayılan seyir hızında kümülatif diziler
  const cumKwh = [0];
  const cumH = [0];
  let regen = 0;
  let ascent = 0;
  let descent = 0;
  segs.forEach((s, i) => {
    const c = cost(s);
    cumKwh.push(cumKwh[i] + c.kwh);
    cumH.push(cumH[i] + c.h);
    if (c.p < 0) regen += -c.p * c.h;
  });
  if (elevations) {
    // SRTM gürültüsü toplam tırmanışı şişirir: yalnızca ≥ 10 m'lik gerçek yön değişimlerini say (histerezis).
    let ref = elevations[0];
    for (const e of elevations) {
      if (e - ref >= 10) { ascent += e - ref; ref = e; }
      else if (ref - e >= 10) { descent += ref - e; ref = e; }
    }
  }

  const totalKm = segs.length ? segs.at(-1).km1 : 0;

  function idxAt(km) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].km1 < km) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function cumAt(arr, km) {
    if (!segs.length) return 0;
    const x = clamp(km, 0, totalKm);
    const i = idxAt(x);
    const s = segs[i];
    return arr[i] + (arr[i + 1] - arr[i]) * clamp((x - s.km0) / s.dKm, 0, 1);
  }

  return {
    pts, segs, wx, cruise, traffic, totalKm, elevSource,
    hasElevation: !!elevations,
    ascent, descent, regenKwh: regen,
    energyBetween: (a, b, k = 1) => Math.max(0, cumAt(cumKwh, b) - cumAt(cumKwh, a)) * k,
    timeBetween: (a, b) => Math.max(0, cumAt(cumH, b) - cumAt(cumH, a)), // saat
    segAt: (km) => segs[idxAt(km)],

    /** [a,b] arasını `vFree` serbest akış hızında (km/h) yeniden hesapla. */
    energyAtSpeed(a, b, vFree, k = 1) {
      let e = 0;
      for (let i = idxAt(a); i < segs.length && segs[i].km0 < b; i++) {
        const s = segs[i];
        const f = clamp((Math.min(b, s.km1) - Math.max(a, s.km0)) / s.dKm, 0, 1);
        e += cost(s, vFree).kwh * f;
      }
      return e * k;
    },

    pointAt(km) {
      const s = segs[idxAt(km)];
      const f = clamp((km - s.km0) / s.dKm, 0, 1);
      const nxt = pts[Math.min(pts.length - 1, idxAt(km) + 1)];
      return { lat: s.lat + (nxt.lat - s.lat) * f, lon: s.lon + (nxt.lon - s.lon) * f, heading: s.heading };
    },

    /** Konumu rotaya izdüşür. hintKm verilirse önce o civarda arar. Dönüş: { km, offKm }. */
    project(lat, lon, hintKm = null) {
      const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
      const ky = 110.57;
      const dist = (p) => Math.hypot((lon - p.lon) * kx, (lat - p.lat) * ky);
      const search = (from, to) => {
        let best = -1;
        let bd = Infinity;
        for (let i = from; i <= to; i++) {
          const d = dist(pts[i]);
          if (d < bd) { bd = d; best = i; }
        }
        return { best, bd };
      };
      let r = { best: -1, bd: Infinity };
      if (hintKm != null) {
        const c = Math.round(hintKm / STEP_KM);
        r = search(Math.max(0, c - 20), Math.min(pts.length - 1, c + 20));
      }
      if (r.best < 0 || r.bd > 3) r = search(0, pts.length - 1);

      let bestKm = pts[r.best].km;
      let bestOff = r.bd;
      for (const i of [r.best - 1, r.best]) {
        if (i < 0 || i + 1 >= pts.length) continue;
        const a = pts[i];
        const b = pts[i + 1];
        const bx = (b.lon - a.lon) * kx;
        const by = (b.lat - a.lat) * ky;
        const px = (lon - a.lon) * kx;
        const py = (lat - a.lat) * ky;
        const len2 = bx * bx + by * by;
        if (!len2) continue;
        const t = clamp((px * bx + py * by) / len2, 0, 1);
        const off = Math.hypot(px - bx * t, py - by * t);
        if (off < bestOff) { bestOff = off; bestKm = a.km + (b.km - a.km) * t; }
      }
      return { km: bestKm, offKm: bestOff };
    },
  };
}
