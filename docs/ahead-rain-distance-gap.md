# Yol önü trafik/yağış uyarısı kalan mesafesi — inceleme ve test kapsamı

Taban: `integ/beta-2026-11-14` @ `9b48d7f`. Yalnız test + belge; çalışma zamanı kodu değişmedi, sürüm artmadı.
Gerçek cihazda doğrulanmadı; tüm sonuçlar çevrimdışı sahte veriyle.

## Bildirilen hata

Navigasyonda "~3 km sonra" (yağış) / "~3 km ileride" (trafik) metni araç ilerledikçe azalmıyordu.

## Durum: ana hata zaten düzeltildi (v0.99.56, `99e8d77`)

- Kök neden (v0.99.56 öncesi): `js/nav/ahead.js` `refreshTraffic`/`refreshRain` metni veri alındığı anda dondurup
  yalnızca 10 dk'lık yenilemede değiştiriyordu.
- Düzeltme: `js/nav/aheadEvents.js` olayı plan rotası km'sine bağlar (`alongKm = fetchKm + d|jam.from`);
  `check()` (5 sn) → `paintEvents()` → `stepEvent()` kalan = `max(0, alongKm − engine.routeKm)` ile metni yeniden yazar.
  `engine.routeKm` her motor adımında `plan.profile.project(lat, lon)` ile güncellenir (`js/physics/rangeEngine.js`).
  Görüntü: `js/nav/navigator.js` `paintAlert` her `nav` değişiminde `nav.ahead.traffic/rain`'i yeniden okur.
- `99e8d77` hem `integ` @9b48d7f'nin hem `origin/design/modern-ui-soc` @132d610'un atası.

## Test kapsamı

| Yol | Test | Önceki | Bu iş |
|---|---|---|---|
| Saf hesap (trafik+yağış) | `test-ahead-events.mjs` | var | — |
| Trafik, ahead.js uçtan uca | `test-traffic-guard.mjs` (v0.99.56 bölümü) | var | — |
| Yağış, ahead.js uçtan uca | `test-ahead-rain-progress.mjs` | **yoktu** | eklendi |

Yeni test: 10→20 km geri sayım (10, 8, 6, 5, 3, 2, 1, "Bu bölgede"), istek sürerken ilerleme (alınma km'sine bağlanır),
rota dışı "mesafe belirsiz", GPS geri sıçraması, yeniden rota temizliği, görüntü yolu (statik), ağ çağrısı yok.

## Kalan GAP (mevcut davranış testte sabitlendi, düzeltilmedi)

Kök: `refreshRain` her 10 dk'da yalnızca güncel km + `WX_AHEAD_KM = [10, 25, ...]` noktalarını örnekler ve bağlı olayı
yenisiyle değiştirir; `mergeEvent` yalnızca ±1 km'de birleştirir. Hâlâ geçerli ve daha yakın olay dikkate alınmaz.

- **GAP-1:** geniş yağış alanında 10 dk'lık yenilemede "~3 km sonra" → "~10 km sonra" sıçrar (geri sayım sıfırlanır);
  ses anahtarı (`rain@round(alongKm/50)`) değişirse sesli uyarı da yinelenir.
- **GAP-2:** yağış yalnızca yakın noktadaysa yenilemede +10 km'den başlayan örnekler kuru çıkar ve 3 km ilerideki uyarı silinir.

- **GAP-3 (D1-T0, karakterizasyon; taban `fd62ba8`):** yağış sesi her başarılı yenilemede
  `speak(..., { key: 'rain@' + round(alongKm/50), cooldownMs: 30 dk })` ile istenir; tekrar süzgeci yalnızca
  `js/advisor/voice.js` anahtar+bekleme kapısıdır. Testte sabitlenen mevcut davranış:
  1. Yenileme olayı başka 50 km dilimine bağlarsa (20. km `rain@0` → 27. km `rain@1`) 30 dk dolmadan **ikinci sesli uyarı**
     verilir ve "10 kilometre sonra" der (GAP-1 sıçramasının sesli yansıması).
  2. Karşı örnek: aynı dilimde kalırsa (90. km → 97. km, ikisi de `rain@2`) ahead.js yine `speak` ister ama kapı
     30 dk içinde ikinci kez seslendirmez.
  3. Hava isteği reddedilirse `rainEv = null`: hâlâ ileride olan uyarı silinir (`rain = null`), sonraki `check()` metni
     yeniden yazmaz, yeni deneme ancak 10 dk sonra (`wxAt` `finally`'de güncellenir); ses yok, yalnız `console.warn`.
  Test: `test-ahead-rain-progress.mjs` bölüm 4b (voice.js kapısı testte taklit edilir; statik denetim kapının biçimini doğrular).
  Karar verilmedi; düzeltme seçeneği D1 kapsamındadır (ör. ses anahtarını olay kimliğine bağlamak, ret durumunda önceki olayı korumak).

Trafikte benzer bir sıçrama beklenmez: sağlayıcı `jam.from` konumdan ölçülür ve aynı sıkışıklık ±1 km içinde birleşir
(`test-traffic-guard.mjs` uçtan uca).

## Açık kararlar (kullanıcı)

1. GAP-1/2/3 düzeltilsin mi? Seçenekler: (a) yenilemede önceki olay hâlâ ileride ve eskimemişse koru, yalnızca daha yakın
   yağış bulunursa değiştir; (b) örneklemeye km+0..5 yakın nokta ekle (Open-Meteo isteği büyür, ücretsiz);
   (c) olduğu gibi bırak (alan düzeyinde tahmin, kaba).
2. Düzeltme seçilirse `ahead.js` (Trafik / yol önü korunan modül) değişir → `v0.99.x` sürüm artışı, GAP testleri
   beklenen yeni davranışa çevrilir, `test-traffic-guard`/`test-ahead-events`/`test-ahead-update` yeniden çalıştırılır.
