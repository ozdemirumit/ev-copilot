# TomTom yol olayları sözleşmesi (fail-closed)

Durum: **yalnız sözleşme + çevrimdışı test**. Kod değişikliği yok. Test: `node scripts/test-road-events-tomtom-contract.mjs`.

## Bugünkü davranış (testle sabit)

1. `js/tomtom/route.js` (`convertRoute`) TomTom rotasından yalnızca iki bölüm türünü kullanır: trafik (`trafficSpans`) ve
   hız limiti (`limitSpans`, yalnızca Premium). Sunucu (`server/tomtom.mjs`) da yalnızca bu iki bölüm türünü ister.
2. Tünel, köprü, alt geçit, üst geçit, gişe, otoyol çıkışı, tabela ve şerit için **doğrulanmış yol olayı ya da sesli uyarı
   yoktur**. Girdiye uydurma olay benzeri alanlar eklense de `convertRoute` çıktısı birebir aynı kalır.
3. `roundaboutExitNumber` yalnızca kavşak adımının metnidir ("Kavşağa girin, N. çıkıştan çıkın"); **otoyol çıkışı (exit)
   olayı değildir**. `TAKE_EXIT` adımı çıkış numarası ya da tabela metni taşımaz.
4. `fromTomTom` (`js/nav/roadEventsAdapt.js`) her girdide boş tomtom modelini döndürür ve girdiyi hiç okumaz.
   `adaptEvidence('tomtom', …)` her zaman `unverified`, `records: 0`; aday alanların tümü `unverified`, `evidence: null`.
5. `routeMeta` içinde `DEFAULT_CAPS.tomtom` boştur; tünel/köprü/şerit `unsupported`. Yol olayları modelinde tomtom yeteneksizdir.
6. `roadEventsAdapt.js` ve `roadEvents.js` hiçbir çalışma zamanı dosyasına (js/, server/, index.html, sw.js) bağlı değildir;
   hiçbir sesli uyarı modülü yol olayı ya da TomTom rota alanı okumaz.
7. Çıktılara girdiden sahte anahtar, Premium/yetki iddiası ya da işaretli değer sızmaz; sunucu hata iletisi anahtar içermez.

## Test girdileri hakkında

Girdiler yalnızca `route.js`'in bugün zaten okuduğu alanları taşır. Ek olay benzeri alanlar `SYNTH_` önekli uydurmalardır ya da
`FIELD_EVIDENCE`'taki doğrulanmamış aday adlardır; gerçek TomTom yanıt şeması varsayılmaz. Testler yalnızca "bu ekler çıktıyı
değiştirmez" der. Ağ engellidir; sunucu işlevi sahte `fetchImpl` ve sahte anahtarla çağrılır.

## Bir sonraki adımın kapıları (hepsi açık)

- **Gerçek kayıt kanıtı:** her aday alan için anonimleştirilmiş gerçek yanıt kaydı (koordinat/geometri/anahtar ayıklanmış);
  bugün 0 kayıt. Sentetik örnek hiçbir zaman `verified` sayılmaz.
- **Lisans/ToS:** TomTom koşulları (görüntüleme/önbellek/tüketici navigasyonu) hukuken incelenmedi — `unverified`.
- **Politika/katalog:** sağlayıcı seçimi, Premium yetkisi ve fiyatlama bu sözleşmenin dışındadır.
- Bu kapılar kapanmadan `fromTomTom` yanıt okumaz, ek `sectionType` istenmez, çalışma zamanı bağlantısı ya da sesli uyarı eklenmez.
