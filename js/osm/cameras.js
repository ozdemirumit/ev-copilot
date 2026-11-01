// Hız kameraları: OpenStreetMap'te highway=speed_camera olarak işaretli noktalar (Overpass). Veri eksik olabilir (tüm kameralar işaretli değildir,
// mobil kameralar hiç yoktur). Rota boyunca 100 m koridorda aranır; sonuçlar saklanır. Dönüş: [{ lat, lon, maxspeed }].
import { cached } from '../utils/cache.js';
import { haversineKm } from '../utils/geo.js';
import { overpass } from './chargers.js';

const RADIUS_M = 100;
const SPACING_KM = 0.4; // koridor çizgisinin nokta aralığı (köşeleri kesmesin diye sık)
const CHUNK = 150; // sorgu başına nokta (≈ 60 km)
const TTL_MS = 7 * 24 * 3600e3;

const fmt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/** Rota koordinatlarından (GeoJSON [lon,lat]) SPACING_KM aralıklı noktalar. */
function spaced(coords) {
  const pts = [];
  let last = null;
  for (const c of coords) {
    const p = { lat: c[1], lon: c[0] };
    if (!last || haversineKm(last, p) >= SPACING_KM) { pts.push(p); last = p; }
  }
  const end = coords.at(-1);
  if (end && pts.at(-1) && (pts.at(-1).lat !== end[1] || pts.at(-1).lon !== end[0])) pts.push({ lat: end[1], lon: end[0] });
  return pts;
}

export async function fetchCameras(coords) {
  const pts = spaced(coords);
  const out = [];
  for (let i = 0; i < pts.length; i += CHUNK) {
    const part = pts.slice(Math.max(0, i - 1), i + CHUNK); // parçalar arasında boşluk kalmasın (1 nokta örtüşme)
    if (part.length < 2) continue;
    const key = `cam:${fmt(part[0])}>${fmt(part.at(-1))}:${part.length}`;
    const query = `[out:json][timeout:60];nwr["highway"="speed_camera"](around:${RADIUS_M},${part.map(fmt).join(',')});out tags center;`;
    const els = await cached(key, TTL_MS, () => overpass(query));
    for (const el of els) {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat == null || lon == null) continue;
      const ms = parseInt(el.tags?.maxspeed, 10);
      out.push({ lat, lon, maxspeed: Number.isFinite(ms) ? ms : null });
    }
  }
  return out;
}
