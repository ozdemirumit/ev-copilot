// Veri kaynağı katmanı: uygulamanın geri kalanı yalnızca bu dosyayı içe aktarır. Varsayılan hepsi ücretsiz, anahtarsız açık servis:
//   rota Valhalla, yer arama/adres adı Photon, şarj istasyonları Overpass (+ isteğe bağlı OpenChargeMap), hava Open-Meteo,
//   rakım Valhalla (yedek Open-Meteo), yol hız limiti OSM maxspeed (Valhalla). Harita ui/mapView.js'te (MapLibre + OpenFreeMap).
// Premium hesapta (sunucuda TomTom anahtarı varsa) ve harita TomTom iken rota TomTom'dan (canlı trafik, hız limiti) gelir; hata olursa aşağıdaki sıra izlenir.
// Kullanıcı Mapbox anahtarı girerse: trafikli rota, trafik uyarısı ve istasyon araması Mapbox'tan gelir (hata olursa ücretsiz kaynağa dönülür).
// Mapbox yokken canlı trafik, kaza/kamera verisi ve istasyon doluluğu YOKTUR: süreler serbest akış, yuvalar "bilinmiyor".
import { fetchRoute as osmRoute } from '../osm/route.js';
import { fetchRoute as mapboxRoute, fetchTrafficAhead as mapboxTraffic } from '../mapbox/route.js';
import { mapboxKey } from '../mapbox/api.js';
import { fetchRoute as tomtomRoute } from '../tomtom/route.js';
import { proxyHas, premiumAccess } from '../net/proxy.js';
import { activeMap } from '../net/activeMap.js';

export { fetchChargers, fetchAround } from '../osm/chargers.js';
export { fetchAvailability } from '../routing/occupancyClient.js';
export { searchPlaces, resolvePlace, reverseLabel } from '../osm/search.js';
export { fetchWeather } from '../osm/weather.js';
export { fetchElevations } from '../osm/elevation.js';
export { fetchSpeedLimit } from '../osm/speedLimit.js';

/** TomTom rotası: sunucuda TomTom anahtarı var, hesap Premium ve açık harita TomTom ise (TomTom sonuçları yalnızca TomTom haritasında gösterilir). */
const tomtomRouteOn = () => proxyHas('tomtom') && premiumAccess() && activeMap() === 'tomtom';

/** Rota: Premium + TomTom haritasında canlı trafikli TomTom; olmazsa Mapbox anahtarı varsa Mapbox; o da olmazsa/alınamazsa Valhalla. `note` doluysa bir üst kaynak atlanmıştır. */
export async function fetchRoute(...a) {
  let skipped = '';
  if (tomtomRouteOn()) {
    try {
      return await tomtomRoute(...a);
    } catch (err) {
      skipped = `TomTom rotası alınamadı (${err.message}); `;
    }
  }
  if (!mapboxKey()) return skipped ? { ...(await osmRoute(...a)), note: skipped + 'ücretsiz rota kullanıldı, trafik yok' } : osmRoute(...a);
  try {
    const r = await mapboxRoute(...a);
    return skipped ? { ...r, note: skipped + 'Mapbox rotası kullanıldı' } : r;
  } catch (err) {
    return { ...(await osmRoute(...a)), note: `${skipped}Mapbox rotası alınamadı (${err.message}); ücretsiz rota kullanıldı, trafik yok` };
  }
}

/** Konumdan varışa canlı trafik (yalnızca Mapbox anahtarıyla); yoksa null. */
export const fetchTrafficAhead = (from, to) => (mapboxKey() ? mapboxTraffic(from, to) : Promise.resolve(null));
