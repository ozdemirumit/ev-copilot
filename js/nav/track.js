// Navigasyon için tam çözünürlüklü rota izi. Menzil motorunun profili ~2 km'lik kirişlerden oluşur; dönüşe kalan
// mesafe metre hassasiyeti ister, bu yüzden araç rotanın gerçek geometrisine izdüşürülür (km ekseni profille aynıdır:
// ikisi de aynı koordinatların yay uzunluğudur).
import { haversineKm, bearing } from '../utils/geo.js';

export function buildTrack(coords) {
  const n = coords.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lon[i] = coords[i][0];
    lat[i] = coords[i][1];
    if (i) cum[i] = cum[i - 1] + haversineKm({ lat: lat[i - 1], lon: lon[i - 1] }, { lat: lat[i], lon: lon[i] });
  }
  return { lat, lon, cum, n, totalKm: cum[n - 1] };
}

function firstIdxAtLeast(cum, km) {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < km) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Konumu iz üzerinde bul: { km, offKm }. hintKm verilirse önce [hint-0,3 km, hint+3 km] aralığına bakılır;
 * orada ≥ 0,4 km uzaktaysa (kayıp/atlama) tüm iz taranır.
 */
export function locate(track, lat, lon, hintKm = null) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const d = (i) => Math.hypot((lon - track.lon[i]) * kx, (lat - track.lat[i]) * ky);
  const scan = (from, to) => {
    let best = -1;
    let bd = Infinity;
    for (let i = from; i <= to; i++) { const v = d(i); if (v < bd) { bd = v; best = i; } }
    return { best, bd };
  };
  let r = { best: -1, bd: Infinity };
  if (hintKm != null) r = scan(Math.max(0, firstIdxAtLeast(track.cum, hintKm - 0.3) - 1), Math.min(track.n - 1, firstIdxAtLeast(track.cum, hintKm + 3) + 1));
  if (r.best < 0 || r.bd > 0.4) r = scan(0, track.n - 1);

  let km = track.cum[r.best];
  let off = r.bd;
  for (const i of [r.best - 1, r.best]) {
    if (i < 0 || i + 1 >= track.n) continue;
    const bx = (track.lon[i + 1] - track.lon[i]) * kx;
    const by = (track.lat[i + 1] - track.lat[i]) * ky;
    const px = (lon - track.lon[i]) * kx;
    const py = (lat - track.lat[i]) * ky;
    const len2 = bx * bx + by * by;
    if (!len2) continue;
    const t = Math.min(1, Math.max(0, (px * bx + py * by) / len2));
    const o = Math.hypot(px - bx * t, py - by * t);
    if (o < off) { off = o; km = track.cum[i] + (track.cum[i + 1] - track.cum[i]) * t; }
  }
  return { km, offKm: off };
}

export function pointAtKm(track, km) {
  const i = Math.min(track.n - 1, firstIdxAtLeast(track.cum, km));
  if (i === 0) return { lat: track.lat[0], lon: track.lon[0] };
  const span = track.cum[i] - track.cum[i - 1] || 1;
  const t = Math.min(1, Math.max(0, (km - track.cum[i - 1]) / span));
  return { lat: track.lat[i - 1] + (track.lat[i] - track.lat[i - 1]) * t, lon: track.lon[i - 1] + (track.lon[i] - track.lon[i - 1]) * t };
}

/** Rotanın gidiş yönü (0–360°, kuzey = 0): bulunulan noktadan 150 m ilerisine bakar (GPS yönü yokken/oynakken de kararlı). */
export function headingAt(track, km, lookKm = 0.15) {
  const a = pointAtKm(track, Math.max(0, km - 0.02));
  const b = pointAtKm(track, Math.min(track.totalKm, km + lookKm));
  return bearing(a, b);
}
