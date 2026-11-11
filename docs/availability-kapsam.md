# Canlı dolu/boş (EVSE availability): kapsam raporu

Tarih: 2026-11-11 · Dal: `design/modern-ui-soc` (Beta) · Sürüm: 0.99.21

## Önceki durum (inceleme)

Doluluk zaten vardı: `server/occupancy.mjs` `lookupAll` sırasıyla NDW (Hollanda, açık veri) → HERE → TomTom → Google Places → topluluk bildirimleri → fiyat defteri. Sonuç yalnızca toplu sayıydı: `{ src, total, available, out, at, price }`.

Eksikler: EVSE bazlı normalize durum yoktu, `at` bazen okuma anıydı ama bu belirtilmiyordu, tazelik (staleness) hesaplanmıyordu, sağlayıcılar tek bir kayıtta tanımlı değildi.

## Eklenen

- `server/availability.mjs`
  - `EVSE_STATUS`: AVAILABLE, CHARGING, RESERVED, BLOCKED, OUTOFORDER, INOPERATIVE, UNKNOWN.
  - `normalizeStatus(source, raw)`: OCPI 2.2.1 ve HERE eşlemesi. Tanınmayan değer UNKNOWN olur, hiçbir zaman AVAILABLE olmaz. OCPI PLANNED/REMOVED sayılmaz.
  - `staleness(at, now)`: fresh ≤15 dk, aging ≤2 sa, stale >2 sa, zaman yoksa unknown.
  - `buildAvailability`: istasyon düzeyinde `total`, `available`, durum başına `counts`, EVSE listesi (varsa), `at`, `timestampKind` (`provider` ya da `fetched`, yani okuma anı), `ageMs`, `staleness`, `source`, `simulated`.
  - Adaptörler (saf işlevler): `fromNdwAvailabilities`, `fromHereItem`, `fromTomTom`, `fromGoogleAggregation`, `fromOcpiLocation` (genel OCPI; şu an bağlı bir besleme yok), `fromMockFixture` (yalnızca test).
  - `PROVIDERS` kaydı ve `providerStatus(env)` (anahtar değerini değil, yalnızca var/yok bilgisini döndürür).
- NDW, HERE, TomTom ve Google sonuçlarına **ek** `availability` alanı eklendi. Eski alanlar ve sağlayıcı sırası değişmedi. Fiyat katmanına (tarifeler, fiyat defteri) dokunulmadı.
- `js/routing/occupancyClient.js`: sunucudan gelen `availability` alanı aynen taşınır. Arayüz henüz bu alanı kullanmıyor; navigasyon ve rota planlama arayüzü değişmedi.

## Dürüstlük kuralları

- Ayrıntı vermeyen sağlayıcıda boş olmayan yuvalar UNKNOWN sayılır, "dolu" denmez (NDW: yalnızca available/total; Google: kalan sayı).
- TomTom ve NDW güncellenme zamanı vermez: `timestampKind: 'fetched'`. Bu durumda gerçek tazelik bilinmez.
- Mock sağlayıcı `simulated: true` ve `source: 'mock'` döndürür, `live: false` olarak işaretlidir ve `lookupAll`'a bağlı değildir. Anahtar yoksa hiçbir sahte veri üretilmez (testle doğrulandı).

## Testler

`node scripts/test-availability.mjs`: 39 test, ağ ve gerçek anahtar kullanılmaz. Sahte fikstürler: `scripts/fixtures/availability/`. Tüm `scripts/test-*.mjs` dosyaları (35 dosya) ve `scripts/check.mjs` geçti.

## Erişim durumu ve eksikler

| Sağlayıcı | Anahtar | Durum |
|---|---|---|
| NDW / DOT-NL | gerekmez | Yalnızca Hollanda; ayrıntılı lisans koşulu bu görevde doğrulanmadı |
| HERE Browse | `HERE_API_KEY` (sunucuda tanımlı) | Yalnızca canlı beslemesi olan istasyonlar. EV Charge Points API v3 bu anahtara kapalı (403) |
| TomTom | `TOMTOM_KEY` (sunucuda tanımlı) | Türkiye'de istasyonların yaklaşık %30'u; EVSE kimliği ve zaman damgası yok; ToS gösterim şartları doğrulanmadı |
| Google Places | `GOOGLE_PLACES_KEY` (sunucuda tanımlı) | Türkiye için EV doluluk verisi yok (ölçüldü); ücretli |
| OCPI (doğrudan CPO: ZES, Eşarj, Trugo vb.) | **yok** | Roaming veya CPO anlaşması gerekir; adaptör hazır, besleme yok |
| Türkiye ulusal erişim noktası (AFIR benzeri) | **yok** | Bilinen açık bir uç nokta yok |
| ZES MarkerSet | - | Belgesiz uç nokta; lisans belirsiz olduğu için eklenmedi |

Bu görevde canlı API çağrısı yapılmadı; sunucudaki anahtarlarla gerçek yanıt doğrulanmadı. Değişikliğin sunucuda çalışması için ara sunucunun yeniden başlatılması gerekir (`node server/restart.mjs`).
