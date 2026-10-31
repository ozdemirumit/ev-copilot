// Google sağlayıcısı: mevcut Google modüllerini ortak sağlayıcı arayüzüne bağlar (bkz. providers/index.js).
// Google seçiliyken harita, rota, istasyon, arama, hava, rakım, trafik ve yol hız limiti HEPSİ buradan, yalnızca Google'dan gelir.
import { gfetch } from '../google/api.js';
import { record } from '../google/usage.js';
import { fetchRoute, decodePolyline } from '../routing/googleRoute.js';
import { fetchChargers, fetchAround, fetchAvailability } from '../routing/chargerSource.js';
import { fetchWeather } from '../physics/weather.js';
import { fetchElevations } from '../physics/elevation.js';
import { searchPlaces, resolvePlace, reverseLabel } from '../google/places.js';
import { haversineKm } from '../utils/geo.js';

export { fetchRoute, fetchChargers, fetchAround, fetchAvailability, fetchWeather, fetchElevations, searchPlaces, resolvePlace, reverseLabel };

/** Bu kaynağın neleri sunduğu: arayüz yoksa ilgili özelliği gizler/uyarır. */
export const capabilities = { traffic: true, availability: true, speedLimit: true, speedCameras: false, offline: false };

/** Yol hız limiti (km/s) veya veri yoksa null. Roads API: Asset Tracking lisansı ister, öğe başına ücretlidir. */
export async function fetchSpeedLimit(lat, lon) {
  const j = await gfetch(`https://roads.googleapis.com/v1/speedLimits?path=${lat.toFixed(6)},${lon.toFixed(6)}&units=KPH`, { keyInQuery: true });
  const list = j.speedLimits || [];
  record('roads', list.length || 1); // yalnızca gerçek Google çağrısı sayılır; dönen öğe sayısı kadar faturalanır
  const hit = list.at(-1);
  return hit?.speedLimit ? Math.round(hit.units === 'MPH' ? hit.speedLimit * 1.609344 : hit.speedLimit) : null;
}

/** speedReadingIntervals (çizgi nokta indeksleri) → bitişik yavaş/sıkışık aralıkların km cinsinden ilk önemli kümesi. */
export function findJam(coords, intervals, maxAheadKm = 150) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineKm({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: coords[i][1], lon: coords[i][0] }));
  const spans = [];
  for (const iv of intervals) {
    if (iv.speed !== 'SLOW' && iv.speed !== 'TRAFFIC_JAM') continue;
    const from = cum[iv.startPolylinePointIndex ?? 0];
    const to = cum[Math.min(iv.endPolylinePointIndex ?? 0, cum.length - 1)];
    const last = spans.at(-1);
    if (last && from - last.to < 0.5) { last.to = to; last.jam ||= iv.speed === 'TRAFFIC_JAM'; } // bitişikleri birleştir
    else spans.push({ from, to, jam: iv.speed === 'TRAFFIC_JAM' });
  }
  // Önemli: sıkışık ≥ 0,5 km ya da yavaş ≥ 3 km
  return spans.find((s) => s.from <= maxAheadKm && s.to - s.from >= (s.jam ? 0.5 : 3)) || null;
}

/**
 * Konumdan varışa trafik durumu (Routes API trafik çizgisi, ücretli). Dönüş: { jam: {from,to,jam}|null (km), delayMin, remainH } veya rota yoksa null.
 * from/to: { lat, lon }.
 */
export async function fetchTrafficAhead(from, to) {
  const wp = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
  const json = await gfetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    mask: 'routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals',
    body: {
      origin: wp(from), destination: wp(to), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE',
      extraComputations: ['TRAFFIC_ON_POLYLINE'], languageCode: 'tr-TR', units: 'METRIC',
    },
    timeoutMs: 30000,
  });
  const r = json.routes?.[0];
  if (!r?.polyline?.encodedPolyline) return null;
  const duration = parseFloat(r.duration);
  return {
    jam: findJam(decodePolyline(r.polyline.encodedPolyline), r.travelAdvisory?.speedReadingIntervals || []),
    delayMin: Math.round((duration - parseFloat(r.staticDuration || r.duration)) / 60),
    remainH: duration / 3600,
  };
}
