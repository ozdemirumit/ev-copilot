# Smart EV Co-Pilot & ABRP Bridge (Togg T10X V2 LR)

Telefonda (Chrome PWA) çalışan; GPS + kamera OCR + fizik tabanlı menzil motoru, çok duraklı şarj planlayıcı, dinamik uyarılar ve ABRP canlı telemetri köprüsü.
Build adımı yok: saf ES modülleri + CDN kütüphaneleri (Leaflet, Tesseract.js).

## Mimari

```
MBRP/
├─ index.html                 Ana kabuk (6 sekme: Rota · Menzil · Kamera · İstasyon · ABRP · Test)
├─ version.js                 Sürüm numarası + sürüm notları (tek kaynak)
├─ vendor/                    Leaflet + Tesseract (çekirdek, işçi, dil verisi); sürümden bağımsız SW önbelleği
├─ manifest.webmanifest, sw.js, icons/
├─ css/styles.css             Dark UI
└─ js/
   ├─ app.js                  Başlatıcı
   ├─ config.js               Araç/fizik/planlayıcı sabitleri, varsayılan operatörler
   ├─ state.js                Merkezi store (live, sim, weather, route, ocr, engine, plan, advisor, abrp) + effective()
   ├─ utils/                  storage.js (LocalStorage), geo.js (haversine, bearing, rüzgar bileşeni)
   ├─ sensors/
   │  ├─ gps.js               watchPosition: hız, konum, irtifa, yön
   │  ├─ camera.js            getUserMedia (arka kamera)
   │  ├─ preprocess.js        ROI kırp → gri → kontrast → otomatik ters çevir → eşik
   │  ├─ ocr.js               Tesseract.js, 5 sn döngü; % SoC + (opsiyonel) ekran hızı ROI'si
   │  ├─ outlierFilter.js     5 sn'de >%2 SoC sıçramasını reddet (+ yeniden eşleme güvenliği)
   │  └─ wakeLock.js
   ├─ physics/
   │  ├─ model.js             Batarya gücü: aero + yuvarlanma + eğim + rejenerasyon + HVAC
   │  ├─ consumption.js       SoC "kenar" örneklerinden ölçülen kWh/100km, km/%1, k düzeltme çarpanı
   │  ├─ routeProfile.js      Rota → 2 km dilimler (eğim, kafa rüzgarı, sıcaklık, yağış), enerji/süre sorguları
   │  ├─ elevation.js         Open-Elevation (yedek: Open-Meteo elevation)
   │  ├─ weather.js           Open-Meteo saatlik tahmin (varış saatine göre)
   │  ├─ traffic.js           Yoğunluk → hız çarpanı; ekstra HVAC kWh vs düşük hız tasarrufu
   │  └─ rangeEngine.js       1 sn döngü: mesafe/enerji entegrasyonu, k, menzil, rüzgar/trafik etkisi
   ├─ routing/
   │  ├─ osrm.js              OSRM rota
   │  ├─ chargerSource.js     Overpass (parçalı sorgu, 7 gün önbellek) + opsiyonel OpenChargeMap
   │  ├─ operators.js         Düzenlenebilir TL/kWh + kW tablosu, operatör sınıflama
   │  ├─ chargeCurve.js       Togg şarj eğrisi (maks 180 kW), şarj süresi integrali
   │  ├─ planner.js           DP ile çok duraklı plan: En Hızlı / En Ekonomik / Optimum
   │  └─ controller.js        Rota+rakım+hava+istasyon+plan orkestrasyonu, yeniden planlama
   ├─ advisor/
   │  ├─ fallback.js          5 sn'de bir varış SoC tahmini → bir önceki istasyona yönlendir
   │  ├─ ecoSpeed.js          Güvenli varış için en yüksek hız
   │  └─ voice.js             Web Speech API (tr-TR)
   ├─ net/meter.js            Veri kullanımı sayacı (fetch sarmalayıcı + Resource Timing)
   ├─ abrp/telemetry.js       5 sn'de bir api.iternio.com/1/tlm/send + opsiyonel webhook
   ├─ sim/simulator.js        Test Modu "oynat": rota boyunca ilerler, pili fizikle düşürür
   └─ ui/                     tabs, mapView, roiBox, cameraPanel, routePanel, stationsView, abrpPanel, testPanel, cards, statusBadges, gpsControl, toast
      ├─ placeSearch.js       Yer/adres arama (Nominatim + Photon birlikte; Türkçe yer adları Nominatim'den) + haritadan seçince ad (reverse)
      └─ tokenScanner.js      ABRP token/API Key ve OpenChargeMap anahtarını kamerayla ekrandaki METİNDEN okur (OCR); boş alana dokununca açılır
```

### Veri akışı

`sensors/* | sim/simulator` → `state.live/sim` → `effective()` → `physics/rangeEngine` → `state.engine`
`routing/controller` → `state.plan` (profil + istasyonlar + duraklar) → `advisor/fallback` → `state.advisor` (+ sesli uyarı, yeniden plan)
`effective()` → `abrp/telemetry`; `state.*` → `ui/*` (boyama).

Test Modu açıkken `effective()` sensör yerine sürgü değerlerini verir; GPS/OCR yazmaya devam etse de kullanılmaz.

### Tüketim modeli nasıl çalışır?

1. **Model:** `model.js` hız, eğim, kafa rüzgarı, sıcaklık, yağıştan batarya gücü (kW) hesaplar. Katsayılar (`config.js › PHYSICS`) **tahmindir**.
2. **Ölçüm:** `consumption.js` SoC'nin değiştiği anları (tam sayı SoC'nin belirsizliğini önlemek için) mesafeyle eşler → gerçek kWh/100km ve km/%1.
3. **Kalibrasyon:** ölçülen / model enerji oranı **k** (EMA, 0.6–1.8) kaydedilir; planlayıcı ve menzil bunu kullanır. İlk sürüşlerde k öğrenilir.
4. **Rota tahmini:** `routeProfile` her dilimi (eğim, rüzgar, yağış, sıcaklık, trafik) enerjiye çevirir; DP planlayıcı bunu ve şarj eğrisini kullanır.

## Sürümleme

Tek kaynak: [version.js](version.js) (`APP_VERSION` + `APP_CHANGELOG`). Sayfa üst çubuğunda `vX.Y.Z` görünür; **başlığa veya sürüme dokununca uygulama yenilenir** (yeni sürüm varsa service worker güncellenir; aktif plan/OCR varken ikinci dokunuş ister), **ⓘ** düğmesi sürüm notlarını açar. Service worker önbellek adı sürümden türer, bu yüzden sürüm değişince telefon yeni dosyaları indirir.

**Her değişiklikte:**
1. `APP_VERSION`'ı artır (`z` düzeltme, `y` yeni özellik, `x` büyük/uyumsuz değişiklik).
2. `APP_CHANGELOG`'un en üstüne tarihli bir kayıt ekle.
3. Commit mesajını `vX.Y.Z: ...` ile başlat (isteğe bağlı: `git tag vX.Y.Z`).

## Veri kullanımı sayacı

Üst çubuktaki `📶 ↑… ↓…` rozeti, uygulamanın gönderdiği ve aldığı toplam veriyi gösterir; dokununca kategori dökümü (ABRP, rota/hava/arama servisleri, harita karoları, kütüphaneler/OCR, uygulama dosyaları, diğer), bu oturum ve sıfırlama düğmesi açılır (yanlışlıkla silinmesin diye iki dokunuş). Sayaç LocalStorage'da saklanır. Kaynak: [js/net/meter.js](js/net/meter.js).

Sayaç **uygulama düzeyinde tahmindir** (operatör faturasından %5–15 farklı olabilir): `fetch` çağrıları Content-Length ve başlık tahminiyle, betik/CSS/harita karoları Resource Timing ile sayılır; ölçüm izni vermeyen CDN dosyaları ve harita karoları ölçülmüş/ortalama boyutla tahmin edilir (`≈`), OCR motoru (Web Worker içinde indiği için görünmez) ilk kurulumda bir kez ~4,4 MB eklenir. Önbellekten gelen `fetch` yanıtları da sayılabilir (üst sınır). Ölçülen ABRP yükü: istek başına yaklaşık 780 B giden + 350 B gelen (5 sn aralıkla ≈ 0,8 MB/saat).

## Sürüşte sürekli güncelleme (OCR → ABRP)

- OCR başlayınca her 5 sn'de pil (ve açıksa ekran hızı) okunur; geçerli değer `live.soc` / `live.speedScr`'a yazılır. Okuma **kamera sekmesi gizliyken de** sürer (v0.8.0 ile düzeltildi).
- Hız: GPS hızı varsa o, yoksa (veya 15 sn'den eskiyse) ekrandan okunan hız kullanılır.
- ABRP her 5 sn'de pil, hız, konum, irtifa ve dış sıcaklığı gönderir. Pil/konum yoksa "Veri bekleniyor" der. Pil okuması (OCR veya manuel +/−) **5 dk'dan eskiyse eski değer gönderilmez** ("Pil okuması eski"). OCR rozeti son okumanın yaşını gösterir (30 sn'den eskiyse).
- Kamera sekmesindeki "Açılışta kamerayı ve OCR'ı otomatik başlat" (kamera izni zaten verilmişse) ve Wake Lock'un önceki oturumdan hatırlanması, telefon yeniden açıldığında zinciri kendiliğinden kurar.
- Kısıt: tarayıcı ekran kapanınca veya Chrome arka plana alınınca kamerayı, GPS'i ve zamanlayıcıları durdurur; uygulama ön planda ve ekran açık olmalı (Wake Lock). Telefon bir tutucuyla Togg ekranına sabit bakmalı.
- `is_charging` şu an her zaman 0 gönderilir (şarj sırasında ABRP'ye şarj bilgisi iletilmez).

## Veri tasarrufu

- **ABRP aralığı** ABRP sekmesinde ayarlanır (5–60 sn, varsayılan 10 sn ≈ 0,4 MB/saat; 5 sn ≈ 0,8 MB/saat). Araç duruyorken (hız < 1 km/h) en az 30 sn'de bir gönderilir.
- **Harita karolarını yükleme** anahtarı (Rota sekmesi): kapalıyken rota çizgisi, istasyonlar ve araç koyu zeminde görünür, karo indirilmez (karo ≈ 15–20 KB). Tarayıcının Veri Tasarrufu modu açıksa varsayılan kapalıdır.
- **Kütüphaneler uygulamayla birlikte** (`vendor/`, bkz. [vendor/README.md](vendor/README.md)): Leaflet ve Tesseract (çekirdek + dil verisi, ~11 MB depoda, istemciye gzip'li). Service worker bunları **sürümden bağımsız** `ev-copilot-vendor-v1` önbelleğine alır (Tesseract ilk OCR kullanımında, Leaflet kurulumda); uygulama sürümü artınca yeniden indirilmez ve CDN'e gidilmez. Kütüphane dosyaları değişirse `sw.js` içindeki `VENDOR_CACHE` adını artır.

## Çalıştırma

Kamera ve Geolocation **güvenli bağlam** ister (HTTPS veya localhost).

```bash
python -m http.server 8080
```

Bilgisayarda `http://localhost:8080`. Telefonda HTTPS gerekir (GitHub Pages, Cloudflare Tunnel, `ngrok http 8080`...).

## Durum

| Adım | İçerik | Durum |
|---|---|---|
| 1 | Mimari + Dark UI | ✅ |
| 2 | GPS, kamera OCR, outlier filtresi, Wake Lock | ✅ |
| 3 | Fizik / rakım / hava / trafik menzil motoru | ✅ |
| 4 | OSRM rota + istasyonlar + şarj planlayıcı | ✅ |
| 5 | Fallback + Eco-Speed + sesli uyarı | ✅ |
| 6 | ABRP telemetri köprüsü | ✅ (gerçek token ile denenmedi) |
| 7 | Simülatör + ekran hızı ROI'si | ✅ |

Tarayıcıda gerçek servislerle denendi: rota/rakım/hava planı, istasyon önbelleği, planlayıcı modları, fallback, eco-hız, sesli uyarı metni, sahte ekranla OCR (pil + hız), ABRP uç noktasının yanıtı (sahte token → okunabilir HTTP 401).
**Araçta ve gerçek GPS ile henüz denenmedi.**

## Bilinen sınırlar

- **Canlı trafik yok:** anahtarsız ücretsiz bir trafik kaynağı yok. Trafik, Rota sekmesindeki yoğunluk tahmini (ve Test Modu sürgüsü) ile modellenir. Google Routes API gibi bir kaynak sonradan `traffic.js`'e bağlanabilir.
- **Overpass** herkese açık ve sık yavaşlıyor/hız sınırlıyor (429/502). Parçalı sorgu + 3 ayna + 7 günlük önbellek var; yine de başarısız olabilir, o zaman "OpenChargeMap anahtarı" alanı ek kaynaktır. OSM'de güç/soket etiketi yoksa istasyon kW'ı operatör tablosundan gelir (listede `*`).
- **İstasyon güvenilirliği**: Veri OSM (ve isteğe bağlı OpenChargeMap) kaynaklıdır; Türkiye'de eksik/eski olabilir (ör. Kayseri–Malatya arasında OSM'de hızlı istasyon yoktur). Yalnızca herkese açık istasyonlar alınır. Aynı noktadaki farklı operatörler ayrı aday kalır; operatör yanlışsa İstasyon sekmesinde satırdan düzeltilir (LocalStorage `stationOps`). 150 km üzeri DC boşlukları uyarılır. En iyi kapsama için OpenChargeMap anahtarı girilmelidir.
- **Araç ve tüketim**: Rota sekmesinde araç seçimi (batarya, ağırlık, Cd, ön alan, DC gücü; değişince sayfa yenilenir), tüketim düzeltmesi (`PHYSICS.consScale`, hem harcamaya uygulanır, rejenerasyona değil), ara istasyona varış payı ve şarj hedefi. Model 100 km/h'de ≈ 18,5, 120 km/h'de ≈ 23 kWh/100 km verir (düz yol, 15 °C); gerçek tüketim farklıysa düzeltme verilmelidir. Hazır araç değerleri tahminidir.
- **İstasyon verisi**: Overpass herkese açık ve sık yanıtsız kalır. Rota ~60 km'lik sınır kutusu (bbox) parçalarıyla sorgulanır (`around` polyline sorgusu uzun rotada zaman aşımı veriyordu); 6 ayna kademeli (4 sn arayla paralel) denenir, boş+`remark` yanıtı hata sayılır; hepsi yanıtsızsa Photon'dan operatör adıyla yaklaşık liste (DC/kW doğrulanamaz) alınır. Sorun İstasyon sekmesinde kalıcı gösterilir, "İstasyonları yeniden ara" ile tekrarlanır. En güvenilir kaynak: OpenChargeMap anahtarı.
- **Harita karoları**: varsayılan OpenStreetMap (CSS ile koyulaştırılır). Rota sekmesindeki "CARTO harita anahtarı" alanına anahtar yazılırsa CARTO dark_all karoları kullanılır; anahtar yalnızca cihazın LocalStorage'ında tutulur, depoya/koda konmaz (GitHub Pages sitesi herkese açık olduğundan kodda gizli kalmaz).
- **Yer arama** herkese açık Nominatim ve Photon servislerini birlikte kullanır (Türkçe adlar — Selanik, Üsküp — Nominatim ile çözülür) (yazarken 350 ms gecikmeli, adil kullanım); yoğun kullanım için kendi geocoder'ını bağlamak gerekir.
- **Token okuma (OCR):** boş User Token / API Key alanına dokununca kamera açılır, ekrandaki UUID biçimli metin okunur (art arda 2 okuma tutarlı olunca kabul). OCR yanılabilir (sentetik testte 6 rastgele token'ın 5'i birebir okundu; ince monospace yazılar daha zayıf, bazı karakterler karışabilir, örn. `4`↔`d`); biçime uymayan okumalar reddedilir ama biçime uyan yanlış okuma kabul edilebilir, bu yüzden kaydetmeden önce değer düzenlenebilir kutuda gösterilir: ekrandakiyle karakter karakter karşılaştır. Yalnızca 8-4-4-4-12 onaltılı biçim okunur; farklı biçimli bir API Key'i elle yaz. Okuma küçük/ince yazıda zorlanır: metni büyüt ve kutuya sığdır.
- **OSRM demo sunucusu** yoğun kullanıma uygun değildir; kendi OSRM'ni kurmak için `routing/osrm.js` tek yerdir.
- **Operatör fiyatları** `config.js`'te yer tutucudur; İstasyon sekmesinden güncelle.
- **Rakım/eğim:** SRTM ~90 m çözünürlük; 2 km dilimlerde yaklaşık eğim verir.
- **Şarj eğrisi** üretici verisi değil, "%10→%80 ≈ 28 dk"ya ayarlı bir yaklaşım.
- **Ekran OCR'ı:** ROI yalnızca iri rakamlara oturmalı (küçük % işareti ve pil simgesi dışarıda). Koyu zeminli ekranlar otomatik ters çevrilir.
- **Arka plan:** Chrome sekmesi arka plana alınınca GPS/zamanlayıcılar kısıtlanır; Wake Lock + ekran açık kullanım varsayılır.
- **ABRP:** iki kimlik gerekir: kullanıcı token'ı (ABRP uygulaması → araç ayarları → Bağlantıları değiştir → Generic → Bağla) ve Iternio'dan alınan API Key. Token ve key LocalStorage'da düz metin saklanır. İstek biçimi (sorgu parametreli GET / form gövdeli POST) gerçek anahtarla doğrulanmadı; biri başarısız olursa diğeri otomatik denenir. Test Modu açıkken ABRP gönderimi açıksa simülasyon verisi hesabına gider.
