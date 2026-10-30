/** OSRM herkese açık demo sunucusu (trafik bilgisi içermez, yoğun kullanıma uygun değildir). */
export async function fetchRoute(start, end) {
  const url = 'https://router.project-osrm.org/route/v1/driving/'
    + `${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('OSRM HTTP ' + res.status);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error('Rota bulunamadı (' + json.code + ')');
  const r = json.routes[0];
  return { coords: r.geometry.coordinates, distanceKm: r.distance / 1000, durationH: r.duration / 3600 };
}
