// Rakım (ücretsiz açık servisler). Birincil: Valhalla /height (tek istekte tüm rota). Yedek: Open-Meteo Elevation (Copernicus DEM, ~90 m,
// istek başına 100 nokta). Çıktı: { elevations, source }.
import { cached, TTL } from '../utils/cache.js';
import { valhalla } from './valhalla.js';

const OM_URL = 'https://api.open-meteo.com/v1/elevation';
const VH_CHUNK = 700; // Valhalla tek istekte bu kadar nokta (550 noktalık rota tek istekte ölçüldü)
const OM_CHUNK = 100; // Open-Meteo üst sınırı

/** Nokta başına rakım (m). Servis başarısız olursa null döner (rota düz kabul edilir). */
export async function fetchElevations(points) {
  if (!points.length) return null;
  const f = points[0];
  const m = points[points.length >> 1];
  const l = points.at(-1);
  const key = `oel:${points.length}:${[f, m, l].map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('>')}`;
  return cached(key, TTL.long, async () => (await fromValhalla(points)) || (await fromOpenMeteo(points)));
}

async function fromValhalla(points) {
  try {
    const out = [];
    for (let i = 0; i < points.length; i += VH_CHUNK) {
      const shape = points.slice(i, i + VH_CHUNK).map((p) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) }));
      out.push(...(await valhalla('/height', { range: false, shape }, 30000)).height);
    }
    if (out.length === points.length && out.every(Number.isFinite)) return { elevations: out, source: 'Valhalla (OSM yükseklik verisi)' };
  } catch (err) {
    console.warn('Valhalla rakım başarısız, Open-Meteo deneniyor:', err.message || err);
  }
  return null;
}

async function fromOpenMeteo(points) {
  try {
    const out = [];
    for (let i = 0; i < points.length; i += OM_CHUNK) {
      const part = points.slice(i, i + OM_CHUNK);
      const url = `${OM_URL}?latitude=${part.map((p) => p.lat.toFixed(4)).join(',')}&longitude=${part.map((p) => p.lon.toFixed(4)).join(',')}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      out.push(...(await res.json()).elevation);
    }
    if (out.length === points.length && out.every(Number.isFinite)) return { elevations: out, source: 'Open-Meteo (Copernicus DEM)' };
  } catch (err) {
    console.warn('Rakım servisi başarısız:', err.message || err);
  }
  return null;
}
