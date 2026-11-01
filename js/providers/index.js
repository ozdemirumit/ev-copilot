// Veri kaynağı katmanı: uygulamanın geri kalanı yalnızca bu dosyayı içe aktarır. Hepsi ücretsiz, anahtarsız açık servis (OpenStreetMap tabanlı):
//   rota Valhalla, yer arama/adres adı Photon, şarj istasyonları Overpass (+ isteğe bağlı OpenChargeMap), hava Open-Meteo,
//   rakım Valhalla (yedek Open-Meteo), yol hız limiti OSM maxspeed (Valhalla). Harita ui/mapView.js'te (MapLibre + OpenFreeMap).
// Canlı trafik, kaza/kamera verisi ve istasyon doluluğu bu kaynaklarda YOKTUR: süreler serbest akış, yuvalar "bilinmiyor".
export { fetchRoute } from '../osm/route.js';
export { fetchChargers, fetchAround, fetchAvailability } from '../osm/chargers.js';
export { searchPlaces, resolvePlace, reverseLabel } from '../osm/search.js';
export { fetchWeather } from '../osm/weather.js';
export { fetchElevations } from '../osm/elevation.js';
export { fetchSpeedLimit } from '../osm/speedLimit.js';

/** Canlı trafik verisi yok. */
export const fetchTrafficAhead = async () => null;
