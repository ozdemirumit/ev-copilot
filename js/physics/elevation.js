const CHUNK = 100;

async function openElevation(points) {
  const out = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    const locations = points.slice(i, i + CHUNK).map((p) => ({ latitude: +p.lat.toFixed(5), longitude: +p.lon.toFixed(5) }));
    const res = await fetch('https://api.open-elevation.com/api/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations }),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error('Open-Elevation HTTP ' + res.status);
    out.push(...(await res.json()).results.map((r) => r.elevation));
  }
  return out;
}

// Yedek: genel Open-Elevation sunucusu yavaş/kararsız olabildiği için.
async function openMeteoElevation(points) {
  const out = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    const part = points.slice(i, i + CHUNK);
    const url = 'https://api.open-meteo.com/v1/elevation'
      + `?latitude=${part.map((p) => p.lat.toFixed(4)).join(',')}`
      + `&longitude=${part.map((p) => p.lon.toFixed(4)).join(',')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error('Open-Meteo elevation HTTP ' + res.status);
    out.push(...(await res.json()).elevation);
  }
  return out;
}

/** Nokta başına rakım (m). İki servis de başarısız olursa null döner (rota düz kabul edilir). */
export async function fetchElevations(points) {
  for (const fn of [openElevation, openMeteoElevation]) {
    try {
      const e = await fn(points);
      if (e.length === points.length && e.every(Number.isFinite)) return { elevations: e, source: fn === openElevation ? 'Open-Elevation' : 'Open-Meteo' };
    } catch (err) {
      console.warn('Rakım servisi başarısız:', err.message);
    }
  }
  return null;
}
