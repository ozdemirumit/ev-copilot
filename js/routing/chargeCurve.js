import { VEHICLE } from '../config.js';

// Togg T10X (88.5 kWh) için yaklaşık DC şarj eğrisi: SoC % → kW. Üretici verisi değil, kabaca "%10→%80 ≈ 28 dk"ya ayarlı.
const CURVE = [[0, 130], [10, 180], [30, 175], [50, 150], [60, 120], [70, 95], [80, 70], [90, 38], [100, 6]];
const CURVE_REF_KW = 180; // eğri 180 kW'lık tepe için; başka araçta tepe gücüne göre ölçeklenir
const STATION_EFF = 0.95; // istasyon nominal gücünün pratikte verilebilen kısmı

export function curveKw(soc) {
  for (let i = 1; i < CURVE.length; i++) {
    if (soc <= CURVE[i][0]) {
      const [x0, y0] = CURVE[i - 1];
      const [x1, y1] = CURVE[i];
      return y0 + ((y1 - y0) * (soc - x0)) / (x1 - x0);
    }
  }
  return CURVE.at(-1)[1];
}

const cache = new Map();

/** Verilen istasyon gücünde (kW) SoC `from`% → `to`% şarj süresi (dakika), 1 puanlık adımlarla integral. */
export function chargeMinutes(stationKw, from, to) {
  const a = Math.round(from);
  const b = Math.round(to);
  if (b <= a) return 0;
  const key = `${Math.round(stationKw)}|${a}|${b}`;
  let m = cache.get(key);
  if (m == null) {
    m = 0;
    const perPct = VEHICLE.batteryNetKwh / 100;
    for (let s = a; s < b; s++) {
      const kw = Math.min(curveKw(s + 0.5) * (VEHICLE.maxDcKw / CURVE_REF_KW), stationKw * STATION_EFF, VEHICLE.maxDcKw);
      m += (perPct / kw) * 60;
    }
    cache.set(key, m);
  }
  return m;
}
