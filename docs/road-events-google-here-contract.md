# Google Routes / HERE yol olayları bağdaştırıcı sözleşmesi (fail-closed)

Durum: **yalnız sözleşme + çevrimdışı test**. Kod değişikliği yok. Test: `node scripts/test-road-events-google-here-contract.mjs`.

## Neden kod yok

- `js/nav/roadEventsAdapt.js` (BL-P2-05a) yalnızca `osm`, `mapbox`, `tomtom` için boş model döndüren iskelet içerir.
  `scripts/test-road-events-adapt.mjs` bu listeyi (`ADAPTER_PROVIDERS`) ve `adaptEvidence('here', …)` → `provider: null`
  davranışını açıkça sabitler. Google/HERE eklemek bu beklentileri değiştirmeyi gerektirir; test gevşetmek yasaktır.
- Google Routes ve HERE Routing yanıt alanlarının adı, anlamı ve güvenilirliği **gerçek kayıtla doğrulanmadı**.
  `FIELD_EVIDENCE`'a aday alan yazmak bile şema varsayımı olurdu. Bu yüzden eklenmedi.

## Bugünkü sözleşme (testle sabit)

1. `ADAPTER_PROVIDERS` ve `FIELD_EVIDENCE` `google`/`here` içermez; `fromGoogle*`/`fromHere*` yol olayı işlevi yoktur.
2. `adaptEvidence('google'|'here', herhangi girdi)` → `provider: null`, `fields: []`, `status: 'unverified'`, `records: 0`
   (sentetik, "verified" ya da Premium iddialı girdide bile).
3. Mevcut bağdaştırıcılar Google/HERE benzeri (uydurma) girdiyi hiç okumaz: kendi boş modelleri, 0 olay, 0 yetenek.
4. Yol olayları modelinde (`js/nav/roadEvents.js`) `google`/`here` yalnızca yeteneksiz boş model olabilir; olaylar
   `unsupported`, başka sağlayıcıdan gelenler `cross-provider`, çıkarım kaynakları `inferred-source` ile reddedilir.
5. Çıktıya girdiden koordinat, geometri (polyline), sahte anahtar ya da Premium/yetki iddiası sızmaz.
6. Hiçbir çalışma zamanı dosyası (js/, server/, index.html, sw.js) bağdaştırıcıyı içe aktarmaz. `fromGoogle`/`fromHere`
   adları yalnızca şarj istasyonu normalleştiricilerinde (`js/google/chargers.js`, `js/here/chargers.js`) bulunur ve
   yol olaylarıyla ilgisizdir.

## Bir sonraki adımın kapıları (hepsi açık)

- **Gerçek kayıt kanıtı:** her aday alan için anonimleştirilmiş gerçek yanıt kaydı (koordinat/geometri/anahtar ayıklanmış);
  bugün 0 kayıt. Sentetik örnek hiçbir zaman `verified` sayılmaz.
- **Lisans/ToS:** Google Maps Platform ve HERE koşulları (görüntüleme/önbellek/başka haritada gösterme, tüketici navigasyonu)
  hukuken incelenmedi — `unverified`. `server/providerPolicy.mjs`'te HERE kapalıdır; Google orada hiç yer almaz.
- **Politika/katalog:** sağlayıcı seçimi, Premium yetkisi ve fiyatlama bu sözleşmenin dışındadır; bağdaştırıcı hiçbir
  yetki/katman kararı vermez.
- Bu kapılar kapanmadan `ADAPTER_PROVIDERS`'a ekleme, `FIELD_EVIDENCE` alanı ya da çalışma zamanı bağlantısı yapılmaz.
