// Hava durumu YALNIZCA Google Weather API'den (saatlik tahmin). Yedek servis yoktur.
import { gfetch } from '../google/api.js';

const URL_BASE = 'https://weather.googleapis.com/v1/forecast/hours:lookup';
const SOURCE = 'Google Hava Durumu';
const HOUR_MS = 3600e3;

const toC = (v, unit) => (/FAHRENHEIT/i.test(unit || '') ? ((v - 32) * 5) / 9 : v);
const toMm = (v, unit) => (/INCH/i.test(unit || '') ? v * 25.4 : v);
const toKmh = (v, unit) => (/MILES/i.test(unit || '') ? v * 1.609344 : /METERS_PER_SECOND/i.test(unit || '') ? v * 3.6 : v);

/** Bir nokta için varış saatine en yakın saatlik tahmin. Gerekirse sayfa sayfa (en çok 24 saat/sayfa) okunur. */
async function pointForecast(p, now) {
  const ahead = Math.max(0, Math.round((p.t - now) / HOUR_MS));
  const need = Math.min(240, ahead + 2);
  const hours = [];
  let token = null;
  for (let page = 0; page < 12 && hours.length < need; page++) {
    const url = `${URL_BASE}?location.latitude=${p.lat.toFixed(4)}&location.longitude=${p.lon.toFixed(4)}&hours=${need}&pageSize=24`
      + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
    const json = await gfetch(url, { keyInQuery: true });
    hours.push(...(json.forecastHours || []));
    token = json.nextPageToken;
    if (!token) break;
  }
  if (!hours.length) throw new Error('Google Hava Durumu: bu bölge için tahmin yok');
  let best = hours[0];
  const mid = (h) => Date.parse(h.interval?.startTime) + HOUR_MS / 2;
  for (const h of hours) if (Math.abs(mid(h) - p.t) < Math.abs(mid(best) - p.t)) best = h;
  return {
    temp: toC(best.temperature?.degrees ?? 15, best.temperature?.unit),
    rain: toMm(best.precipitation?.qpf?.quantity ?? 0, best.precipitation?.qpf?.unit),
    windSpeed: toKmh(best.wind?.speed?.value ?? 0, best.wind?.speed?.unit),
    windDir: best.wind?.direction?.degrees ?? 0, // rüzgârın GELDİĞİ yön (Google belgesi)
  };
}

/**
 * Nokta başına saatlik tahmin. points: [{ lat, lon, t }]  (t: ms, o noktaya tahmini varış zamanı)
 * Dönüş: [{ temp (°C), rain (mm/sa), windSpeed (km/h), windDir (geldiği yön, °) }] ve `.source`.
 */
export async function fetchWeather(points) {
  const now = Date.now();
  const out = new Array(points.length);
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const i = next++;
      out[i] = await pointForecast(points[i], now);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  out.source = SOURCE;
  return out;
}
