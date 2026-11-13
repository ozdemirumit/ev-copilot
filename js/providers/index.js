// Veri kaynağı katmanı: uygulamanın geri kalanı yalnızca bu dosyayı içe aktarır. Varsayılan hepsi ücretsiz, anahtarsız açık servis:
//   rota Valhalla, yer arama/adres adı Photon, şarj istasyonları Overpass (+ isteğe bağlı OpenChargeMap), hava Open-Meteo,
//   rakım Valhalla (yedek Open-Meteo), yol hız limiti OSM maxspeed (Valhalla). Harita ui/mapView.js'te (MapLibre + OpenFreeMap).
// Premium hesapta (sunucuda TomTom anahtarı varsa) ve harita TomTom iken rota TomTom'dan (canlı trafik, hız limiti) gelir; hata olursa aşağıdaki sıra izlenir.
// Kullanıcı Mapbox anahtarı girerse: trafikli rota, trafik uyarısı (TomTom varsa ondan) ve istasyon araması Mapbox'tan gelir (hata olursa ücretsiz kaynağa dönülür).
// Mapbox yokken canlı trafik, kaza/kamera verisi ve istasyon doluluğu YOKTUR: süreler serbest akış, yuvalar "bilinmiyor".
import { fetchRoute as osmRoute } from '../osm/route.js';
import { fetchRoute as mapboxRoute } from '../mapbox/route.js';
import { aheadFromRoute } from '../nav/aheadTraffic.js';
import { mapboxKey } from '../mapbox/api.js';
import { fetchRoute as tomtomRoute } from '../tomtom/route.js';
import { proxyHas, premiumAccess } from '../net/proxy.js';
import { activeMap } from '../net/activeMap.js';
import { emptyMeta, withProvenance, lanesStatusFromSteps } from '../nav/routeMeta.js';

export { fetchChargers, fetchAround } from '../osm/chargers.js';
export { fetchAvailability } from '../routing/occupancyClient.js';
export { searchPlaces, resolvePlace, reverseLabel } from '../osm/search.js';
export { fetchWeather } from '../osm/weather.js';
export { fetchElevations } from '../osm/elevation.js';
export { fetchSpeedLimit } from '../osm/speedLimit.js';
export { probeStopAccess } from '../osm/accessProbe.js'; // şarj durağına yol ağıyla erişim (her zaman Valhalla)

/** TomTom rotası: sunucuda TomTom anahtarı var, hesap Premium ve açık harita TomTom ise (TomTom sonuçları yalnızca TomTom haritasında gösterilir). */
const tomtomRouteOn = () => proxyHas('tomtom') && premiumAccess() && activeMap() === 'tomtom';

/**
 * Seçilen rotaya kaynak üst verisi (routeMeta) ekler: provider = rotayı GERÇEKTEN veren sağlayıcı (harita sağlayıcısı değil).
 * Rota alanları aynen kalır (sağ kopyası + tek ek alan); sağlayıcı sonucu değiştirilmez. Şerit durumu yalnızca Mapbox'ta ve
 * yalnızca adım listesi varsa adımlardan okunur; adım yoksa 'unrequested' kalır (veri uydurulmaz). Hata olursa rota üst verisiz döner.
 */
function tagRoute(r, provider) {
  if (!r || typeof r !== 'object') return r;
  try {
    let meta = emptyMeta(provider);
    if (provider === 'mapbox' && Array.isArray(r.steps)) meta = withProvenance(meta, 'lanes', { source: 'mapbox', status: lanesStatusFromSteps(r.steps) });
    return { ...r, routeMeta: meta };
  } catch {
    return r;
  }
}

/** Rota: Premium + TomTom haritasında canlı trafikli TomTom; olmazsa Mapbox anahtarı varsa Mapbox; o da olmazsa/alınamazsa Valhalla. `note` doluysa bir üst kaynak atlanmıştır. routeMeta.provider: tomtom | mapbox | osm (Valhalla). */
export async function fetchRoute(...a) {
  let skipped = '';
  if (tomtomRouteOn()) {
    try {
      return tagRoute(await tomtomRoute(...a), 'tomtom');
    } catch (err) {
      skipped = `TomTom rotası alınamadı (${err.message}); `;
    }
  }
  if (!mapboxKey()) return tagRoute(skipped ? { ...(await osmRoute(...a)), note: skipped + 'ücretsiz rota kullanıldı, trafik yok' } : await osmRoute(...a), 'osm');
  let r;
  try {
    r = await mapboxRoute(...a);
  } catch (err) {
    return tagRoute({ ...(await osmRoute(...a)), note: `${skipped}Mapbox rotası alınamadı (${err.message}); ücretsiz rota kullanıldı, trafik yok` }, 'osm');
  }
  return tagRoute(skipped ? { ...r, note: skipped + 'Mapbox rotası kullanıldı' } : r, 'mapbox');
}

/**
 * Konumdan varışa canlı trafik: { jam, delayMin, remainH, rt } ya da kaynak yoksa null. Kaynak: TomTom rotası (TomTom kullanılabilirken, hata olursa Mapbox'a düşer),
 * yoksa Mapbox anahtarıyla Mapbox. rt: yeni trafikli rota (yolda hız profilini tazelemek için).
 * trafficSource: trafik rotasını GERÇEKTEN veren sağlayıcı ('tomtom' | 'mapbox'; açık harita değil). Seçilen plan rotasının
 * routeMeta.provider değerinden farklı olabilir; rt etiketlenmez (routeMeta yalnızca seçilen plan rotasındadır). Henüz okuyan yok.
 */
export async function fetchTrafficAhead(from, to) {
  let rt = null, trafficSource = null;
  if (tomtomRouteOn()) {
    try { rt = await tomtomRoute(from, to); } catch { rt = null; }
    if (rt) trafficSource = 'tomtom';
  }
  if (!rt && mapboxKey()) {
    rt = await mapboxRoute(from, to);
    if (rt) trafficSource = 'mapbox';
  }
  return rt ? { ...aheadFromRoute(rt), trafficSource } : null;
}
