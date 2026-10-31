// Rakım YALNIZCA Google Elevation'dan. Elevation web servisi tarayıcıdan (CORS) çağrılamaz; Maps JavaScript API'nin
// ElevationService'i aynı veriyi sunar, bu yüzden o kullanılır.
import { loadGoogle } from '../google/loader.js';

const CHUNK = 256;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Nokta başına rakım (m). Servis başarısız olursa null döner (rota düz kabul edilir). */
export async function fetchElevations(points) {
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
      out.push(...res.results.map((r) => r.elevation));
    }
    if (out.length === points.length && out.every(Number.isFinite)) return { elevations: out, source: 'Google Elevation' };
  } catch (err) {
    console.warn('Rakım servisi başarısız:', err.message || err);
  }
  return null;
}
