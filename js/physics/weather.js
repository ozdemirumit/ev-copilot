const BASE = 'https://api.open-meteo.com/v1/forecast';

/**
 * Open-Meteo'dan nokta başına saatlik tahmin (varış saatine en yakın saat).
 * points: [{ lat, lon, t }]  (t: ms, o noktaya tahmini varış zamanı)
 * Dönüş: [{ temp (°C), rain (mm/sa), windSpeed (km/h), windDir (geldiği yön, °) }]
 */
export async function fetchWeather(points) {
  const lat = points.map((p) => p.lat.toFixed(3)).join(',');
  const lon = points.map((p) => p.lon.toFixed(3)).join(',');
  const url = `${BASE}?latitude=${lat}&longitude=${lon}`
    + '&hourly=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m'
    + '&wind_speed_unit=kmh&timeformat=unixtime&forecast_days=3';
  let res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (res.status === 429 || res.status >= 500) { // geçici sınır/yoğunluk: bir kez bekleyip tekrar dene
    await new Promise((r) => setTimeout(r, 2000));
    res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  }
  if (!res.ok) throw new Error('Open-Meteo HTTP ' + res.status);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];

  return list.map((loc, i) => {
    const times = loc.hourly.time;
    const target = points[i].t / 1000;
    let idx = 0;
    for (let j = 1; j < times.length; j++) {
      if (Math.abs(times[j] - target) < Math.abs(times[idx] - target)) idx = j;
    }
    const h = loc.hourly;
    return {
      temp: h.temperature_2m[idx],
      rain: h.precipitation[idx] ?? 0,
      windSpeed: h.wind_speed_10m[idx],
      windDir: h.wind_direction_10m[idx],
    };
  });
}
