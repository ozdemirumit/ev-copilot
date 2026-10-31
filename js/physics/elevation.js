// Rakım YALNIZCA Google Elevation'dan. Elevation web servisi tarayıcıdan (CORS) çağrılamaz; Maps JavaScript API'nin
// ElevationService'i aynı veriyi sunar, bu yüzden o kullanılır.
import { loadGoogle } from '../google/loader.js';
import { record } from '../google/usage.js';
import { cached, TTL } from '../utils/cache.js';

const CHUNK = 256;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nokta başına rakım (m). Servis başarısız olursa null döner (rota düz kabul edilir). */
export async function fetchElevations(points) {
  if (!points.length) return null;
  // Rakım (Google'da öğe başına ücretli) aynı rota için 6 saat saklanır: yeniden planlama/aynı rota tekrar ücretlenmez
  const f = points[0];
  const m = points[points.length >> 1];
  const l = points.at(-1);
  const key = `el:${points.length}:${[f, m, l].map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('>')}`;
  return cached(key, TTL.long, () => elevationsFromGoogle(points));
}

async function elevationsFromGoogle(points) {
  try {
    await loadGoogle();
    const { ElevationService } = await google.maps.importLibrary('elevation');
    const svc = new ElevationService();
    const out = [];
    for (let i = 0; i < points.length; i += CHUNK) {
      const locations = points.slice(i, i + CHUNK).map((p) => ({ lat: p.lat, lng: p.lon }));
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await svc.getElevationForLocations({ locations });
          break;
        } catch (err) {
          if (attempt >= 3 || !/OVER_QUERY_LIMIT|UNKNOWN_ERROR/.test(String(err.code || err.message))) throw err;
          await sleep(1200 * (attempt + 1)); // hız sınırı: bekleyip tekrar
        }
      }
      record('elevation', locations.length); // Elevation nokta başına faturalanır
      out.push(...res.results.map((r) => r.elevation));
    }
    if (out.length === points.length && out.every(Number.isFinite)) return { elevations: out, source: 'Google Elevation' };
  } catch (err) {
    console.warn('Rakım servisi başarısız:', err.message || err);
  }
  return null;
}
