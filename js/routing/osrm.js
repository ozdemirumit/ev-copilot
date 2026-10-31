/** OSRM herkese açık demo sunucusu (trafik bilgisi içermez, yoğun kullanıma uygun değildir). */
export async function fetchRoute(start, end) {
  const url = 'https://router.project-osrm.org/route/v1/driving/'
    + `${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('OSRM HTTP ' + res.status);
  const json = await res.json();
  if (json.code !== 'Ok' || !json.routes?.length) throw new Error('Rota bulunamadı (' + json.code + ')');
  const r = json.routes[0];
  // Dönüş talimatları (navigasyon): her adım bir manevra noktasıdır; km'ye çevirmeyi controller rota profiliyle yapar.
  const steps = r.legs.flatMap((l) => l.steps).map((st) => ({
    type: st.maneuver.type, modifier: st.maneuver.modifier || null, exit: st.maneuver.exit ?? null,
    lat: st.maneuver.location[1], lon: st.maneuver.location[0],
    name: st.name || st.ref || '', distM: st.distance,
  }));
  return { coords: r.geometry.coordinates, distanceKm: r.distance / 1000, durationH: r.duration / 3600, steps };
}
