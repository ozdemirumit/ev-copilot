# Alternatif veri kaynağı (tasarım)

Karar (2026-10-31): Rota sekmesinde tek bir **Veri kaynağı** anahtarı olacak: **Google** (varsayılan) veya **Alternatif** (açık kaynak).
Seçilen kaynak harita, rota, istasyon, arama, hava, rakım ve hız limiti için **birlikte** kullanılır; karışık kullanım yoktur.
Çevrimdışı çalışma yalnızca **Alternatif** kaynakta bulunur (Google şartları harita karosu saklamayı yasaklar).

## Mimari

`js/providers/index.js` seçili sağlayıcıyı verir (`localStorage evcp.source` = `google` | `osm`). Her sağlayıcı aynı arayüzü uygular,
böylece `routing/`, `nav/`, `physics/` ve `ui/` kodu kaynağı bilmez:

| Arayüz | Çıktı | Google (var) | Alternatif |
|---|---|---|---|
| `map` | mapApi (drawRoute, drawStations, follow, navView …) | Maps JS API | MapLibre GL JS |
| `route.fetchRoute(start, end, via)` | `{coords, intervals, distanceKm, durationH, trafficRatio, steps}` | Routes API | Valhalla (çevrimiçi), cihazdaki motor (çevrimdışı) |
| `chargers.fetchChargers / fetchAround / fetchAvailability` | istasyon listesi | Places Nearby | Overpass + OpenChargeMap; doluluk yok |
| `search.searchPlaces / resolvePlace / reverseLabel` | öneriler, konum, ad | Places Autocomplete, Geocoding | Photon, Nominatim |
| `weather.fetchWeather(points)` | saatlik hava | Weather API | Open-Meteo |
| `elevation.fetchElevations(points)` | rakım | ElevationService | Open-Meteo elevation |
| `speedLimit.query(lat, lon, heading)` | km/s | Roads | Valhalla `trace_attributes` / OSM `maxspeed` |
| `usage` | sayaç | Google SKU sayacı | istek sayısı (ücretsiz) |

Alternatifte trafik yok: `trafficRatio = 1`, `intervals = []`. Serbest akış hızı rota adımlarının süresinden gelir (enerji modeli aynı kalır).
Doluluk bilgisi yok: slotlar "bilinmiyor" görünür.

## Çevrimiçi alternatif servisler (herkese açık sunucular, kullanım sınırı var)

- Rota: Valhalla (OSM Almanya sunucusu) — adım adım talimat, süre. Yoğun kullanım için kendi sunucu gerekir.
- İstasyon: Overpass `amenity=charging_station`, koridor boyunca parça parça. OpenChargeMap anahtarı kullanıcıdan telefonda alınır, kodda olmaz.
- Arama: Photon (öneri), Nominatim (ters arama; saniyede 1 istek sınırı).
- Hava ve rakım: Open-Meteo (anahtarsız).
- Harita: OpenFreeMap vektör karoları (anahtarsız) çevrimiçi; çevrimdışı için PMTiles.

## Çevrimdışı (yalnızca Alternatif)

1. **Harita:** ülke bazlı PMTiles dosyası (z≤14), Cloudflare R2'den indirilir, cihazda OPFS/Cache'te saklanır; MapLibre `pmtiles` protokolüyle okunur.
2. **Veri paketi:** ülke için istasyonlar, yol hız limitleri ve hız kameraları OSM'den önceden çıkarılıp R2'ye konur; cihazda saklanır.
3. **Kayıtlı yolculuk:** rota, adımlar, plan, istasyonlar IndexedDB'de; açılışta geri yüklenir.
4. **Cihazda rota hesabı:** OSM yol grafiği → daraltma hiyerarşisi (contraction hierarchies) → ikili dosya; sorgu motoru WASM; talimat üretimi (dönüş açısı, yol adı) bizde.
   Risk: dosya boyutu ve telefon belleği. Önce prototip: bir ülkenin ana yol grafiğiyle (otoyol…üçüncül yol + bağlantılar) ölçüm yapılır.
   Veri hazırlığı kullanıcının makinesinde değil GitHub Actions'ta yapılır (makinede Java/Rust yok); çıktı R2'ye yüklenir.

## Fazlar (her biri ayrı sürüm)

1. Sağlayıcı katmanı + Veri kaynağı anahtarı (davranış Google ile aynı kalır).
2. Alternatif çevrimiçi: MapLibre harita, Valhalla rota, Photon arama, Open-Meteo hava ve rakım.
3. Alternatif istasyon (Overpass/OCM) ve hız limiti/kamera (OSM).
4. Çevrimdışı harita: PMTiles hazırlama hattı (Actions → R2), indirme yöneticisi.
5. Çevrimdışı veri paketi ve kayıtlı yolculuk.
6. Cihazda rota hesabı (prototip → ölçüm → entegrasyon). En riskli faz.

## Kullanıcıdan gerekenler

- Faz 4: Cloudflare R2 hesabı, herkese açık kova (CORS: GET, Range), kova adresi.
- Faz 4 ve 6: GitHub Actions için R2 erişim anahtarları (depo "Secrets" alanına; koda ve sohbete yazılmaz).
- Faz 2/3: OpenChargeMap anahtarı (isteğe bağlı; telefondan girilir).

## Kurallar

- Gerçek anahtarlar depoya, koda, teste yazılmaz (bkz. proje hafızası).
- Google modu bozulmadan kalır; her faz sonunda Google modu aynı davranır.
- OSM verisi ODbL: uygulamada "© OpenStreetMap katkıcıları" yazılır.
