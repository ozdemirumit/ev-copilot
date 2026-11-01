// Veri kaynağı katmanı: uygulamanın geri kalanı yalnızca bu dosyayı içe aktarır. Varsayılan hepsi ücretsiz, anahtarsız açık servis:
//   rota Valhalla, yer arama/adres adı Photon, şarj istasyonları Overpass (+ isteğe bağlı OpenChargeMap), hava Open-Meteo,
//   rakım Valhalla (yedek Open-Meteo), yol hız limiti OSM maxspeed (Valhalla). Harita ui/mapView.js'te (MapLibre + OpenFreeMap).
// Kullanıcı Mapbox anahtarı girerse: trafikli rota, trafik uyarısı ve istasyon araması Mapbox'tan gelir (hata olursa ücretsiz kaynağa dönülür).
// Mapbox yokken canlı trafik, kaza/kamera verisi ve istasyon doluluğu YOKTUR: süreler serbest akış, yuvalar "bilinmiyor".
import { fetchRoute as osmRoute } from '../osm/route.js';
import { fetchRoute as mapboxRoute, fetchTrafficAhead as mapboxTraffic } from '../mapbox/route.js';
import { mapboxKey } from '../mapbox/api.js';

export { fetchChargers, fetchAround } from '../osm/chargers.js';
export { fetchAvailability } from '../routing/occupancyClient.js';
export { searchPlaces, resolvePlace, reverseLabel } from '../osm/search.js';
export { fetchWeather } from '../osm/weather.js';
export { fetchElevations } from '../osm/elevation.js';
export { fetchSpeedLimit } from '../osm/speedLimit.js';

/** Rota: Mapbox anahtarı varsa canlı trafikli, alınamazsa (veya anahtar yoksa) Valhalla. `note` doluysa Mapbox atlanmıştır. */
export async function fetchRoute(...a) {
  if (!mapboxKey()) return osmRoute(...a);
  try {
    return await mapboxRoute(...a);
  } catch (err) {
    return { ...(await osmRoute(...a)), note: `Mapbox rotası alınamadı (${err.message}); ücretsiz rota kullanıldı, trafik yok` };
  }
}

/** Konumdan varışa canlı trafik (yalnızca Mapbox anahtarıyla); yoksa null. */
export const fetchTrafficAhead = (from, to) => (mapboxKey() ? mapboxTraffic(from, to) : Promise.resolve(null));
