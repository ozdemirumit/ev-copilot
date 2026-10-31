// Hava durumu YALNIZCA Google Weather API'den (saatlik tahmin). Yedek servis yoktur.
import { gfetch } from '../google/api.js';
import { cacheGet, cacheSet, TTL } from '../utils/cache.js';

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
  // ~11 km'lik hücre başına saatlik tahmin 30 dk saklanır; yeterli saati kapsıyorsa yeniden istenmez (aynı rotayı tekrar planlamak, aynı bölgeden geçmek)
  const ckey = `wx:${p.lat.toFixed(1)},${p.lon.toFixed(1)}`;
  const hit = cacheGet(ckey);
  const hours = hit && hit.length >= need ? [...hit] : [];
  let token = null;
  for (let page = 0; page < 12 && hours.length < need; page++) {
    const url = `${URL_BASE}?location.latitude=${p.lat.toFixed(4)}&location.longitude=${p.lon.toFixed(4)}&hours=${need}` + (need > 24 ? '&pageSize=24' : '')
      + (token ? `&pageToken=${encodeURIComponent(token)}` : '');
    const json = await gfetch(url, { keyInQuery: true });
    hours.push(...(json.forecastHours || []));
    token = json.nextPageToken;
    if (!token) break;
  }
  if (!hours.length) throw new Error('Google Hava Durumu: bu bölge için tahmin yok');
  if (!hit || hit.length < hours.length) cacheSet(ckey, hours, TTL.weather);
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
  const out = new Array(points.length).fill(null);
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const i = next++;
      for (let attempt = 0; attempt < 2 && !out[i]; attempt++) {
        try {
          out[i] = await pointForecast(points[i], now);
        } catch (err) {
          if (err.fatal) throw err; // anahtar/etkin-API sorunu: tekrarlamanın anlamı yok
          errors.push(err.message);
          await new Promise((r) => setTimeout(r, 1200)); // geçici hata/hız sınırı: bir kez daha dene
        }
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (out.every((o) => !o)) throw new Error(errors[0] || 'Google Hava Durumu yanıt vermedi');
  // Tek tük noktada hata varsa en yakın başarılı komşunun değeri kullanılır (rota boyunca hava yavaş değişir).
  out.forEach((o, i) => {
    if (o) return;
    for (let d = 1; d < out.length; d++) {
      const near = out[i - d] || out[i + d];
      if (near) { out[i] = near; break; }
    }
    console.warn('Hava noktası komşudan dolduruldu:', i, errors[0]);
  });
  out.source = SOURCE;
  return out;
}
