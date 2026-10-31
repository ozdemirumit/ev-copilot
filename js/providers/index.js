// Veri kaynakları: her veri türü için SABİT seçim (kullanıcı ayarı yok). Uygulamanın geri kalanı yalnızca bu dosyayı içe aktarır;
// bir veri türünün kaynağını değiştirmek burada tek satırdır.
//   Google: rota (trafikli), trafik, yer arama, adres adı, şarj istasyonları ve canlı doluluk (harita ui/mapView.js'te)
//   Ücretsiz açık servisler: hava (Open-Meteo), rakım ve yol hız limiti (Valhalla / OpenStreetMap)
export { fetchRoute, fetchChargers, fetchAround, fetchAvailability, searchPlaces, resolvePlace, reverseLabel, fetchTrafficAhead } from './google.js';
export { fetchWeather, fetchElevations, fetchSpeedLimit } from './free.js';
