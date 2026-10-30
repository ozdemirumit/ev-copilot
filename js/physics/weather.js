const BASE = 'https://api.open-meteo.com/v1/forecast';

const METNO = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

/**
 * Nokta başına saatlik tahmin (varış saatine en yakın saat). Önce Open-Meteo (tek istek); yanıt vermezse
 * MET Norway (anahtarsız, CORS açık; nokta başına bir istek). Dönüş dizisinde `source` ve (Open-Meteo başarısızsa) `fallbackReason` var.
 * points: [{ lat, lon, t }]  (t: ms, o noktaya tahmini varış zamanı)
 * Dönüş: [{ temp (°C), rain (mm/sa), windSpeed (km/h), windDir (geldiği yön, °) }]
 */
export async function fetchWeather(points) {
  try {
    const out = await openMeteo(points);
    out.source = 'Open-Meteo';
    return out;
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'yanıt yok' : err.message.replace(/^Open-Meteo\s*/, '');
    try {
      const out = await metNo(points);
      out.source = 'MET Norway';
      out.fallbackReason = 'Open-Meteo ' + reason;
      return out;
    } catch (err2) {
      throw new Error(`Open-Meteo ${reason}; MET Norway ${err2.name === 'TimeoutError' ? 'yanıt yok' : err2.message}`);
    }
  }
}

/** MET Norway locationforecast: nokta başına istek, 4'erli paralel. Rüzgâr m/s → km/h; yağış sonraki 1 saat (yoksa 6 saatin ortalaması). */
async function metNo(points) {
  const out = new Array(points.length);
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const i = next++;
      const p = points[i];
      const res = await fetch(`${METNO}?lat=${p.lat.toFixed(3)}&lon=${p.lon.toFixed(3)}`, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const series = (await res.json()).properties.timeseries;
      const target = p.t;
      let best = series[0];
      for (const e of series) if (Math.abs(Date.parse(e.time) - target) < Math.abs(Date.parse(best.time) - target)) best = e;
      const d = best.data.instant.details;
      const rain = best.data.next_1_hours?.details?.precipitation_amount
        ?? (best.data.next_6_hours?.details?.precipitation_amount ?? 0) / 6;
      out[i] = { temp: d.air_temperature, rain, windSpeed: d.wind_speed * 3.6, windDir: d.wind_from_direction };
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

async function openMeteo(points) {
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
