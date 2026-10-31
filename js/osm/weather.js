// Hava durumu Open-Meteo'dan (anahtarsız, ticari olmayan kullanım ücretsiz).
import { cacheGet, cacheSet, TTL } from '../utils/cache.js';

const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const SOURCE = 'Open-Meteo';
const HOUR_MS = 3600e3;
const CHUNK = 40; // istek başına nokta (URL uzunluğu)
const cellKey = (p) => `owx:${p.lat.toFixed(1)},${p.lon.toFixed(1)}`; // ~11 km hücre, 30 dk saklanır

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

/** Saatlik seriden (unix saniye) varış zamanına en yakın saat. */
function pick(series, t) {
  let bi = 0;
  let bd = Infinity;
  series.time.forEach((s, i) => {
    const d = Math.abs(s * 1000 + HOUR_MS / 2 - t);
    if (d < bd) { bd = d; bi = i; }
  });
  return {
    temp: num(series.temperature_2m[bi], 15),
    rain: num(series.precipitation[bi]),
    windSpeed: num(series.wind_speed_10m[bi]),
    windDir: num(series.wind_direction_10m[bi]), // rüzgârın GELDİĞİ yön (meteorolojik)
  };
}

async function fetchSeries(points, days) {
  const lat = points.map((p) => p.lat.toFixed(3)).join(',');
  const lon = points.map((p) => p.lon.toFixed(3)).join(',');
  const url = `${URL_BASE}?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m`
    + `&forecast_days=${days}&timezone=UTC&timeformat=unixtime&wind_speed_unit=kmh`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  return (Array.isArray(json) ? json : [json]).map((r) => r.hourly);
}

/**
 * Nokta başına saatlik tahmin. points: [{ lat, lon, t }]  (t: ms, o noktaya tahmini varış zamanı)
 * Dönüş: [{ temp (°C), rain (mm/sa), windSpeed (km/h), windDir (geldiği yön, °) }] ve `.source`.
 */
export async function fetchWeather(points) {
  const now = Date.now();
  const days = Math.min(16, Math.max(2, Math.ceil(Math.max(0, ...points.map((p) => p.t - now)) / (24 * HOUR_MS)) + 1));
  const series = points.map((p) => {
    const hit = cacheGet(cellKey(p));
    const end = hit ? hit.time.at(-1) * 1000 : 0;
    return hit && end >= p.t ? hit : null; // yeterli saati kapsıyorsa yeniden istenmez
  });
  const todo = points.map((_, i) => i).filter((i) => !series[i]);
  for (let k = 0; k < todo.length; k += CHUNK) {
    const idx = todo.slice(k, k + CHUNK);
    const got = await fetchSeries(idx.map((i) => points[i]), days);
    idx.forEach((i, j) => { series[i] = got[j]; if (got[j]) cacheSet(cellKey(points[i]), got[j], TTL.weather); });
  }
  if (series.some((s) => !s?.time?.length)) throw new Error('Open-Meteo: bazı noktalar için tahmin yok');
  const out = points.map((p, i) => pick(series[i], p.t));
  out.source = SOURCE;
  return out;
}
