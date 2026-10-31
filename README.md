# Smart EV Co-Pilot & ABRP Bridge (Togg T10X V2 LR)

Telefonda (Chrome PWA) çalışan; GPS + kamera OCR + fizik tabanlı menzil motoru, çok duraklı şarj planlayıcı, dinamik uyarılar ve ABRP canlı telemetri köprüsü.
Build adımı yok: saf ES modülleri + Tesseract.js (OCR). Harita, rota, istasyon, arama, hava ve rakım verisi YALNIZCA Google Maps Platform API'lerinden gelir (üçüncü taraf servis yok).

## Mimari

```
MBRP/
├─ index.html                 Ana kabuk (6 sekme: Rota · Menzil · Kamera · İstasyon · ABRP · Test)
├─ version.js                 Sürüm numarası + sürüm notları (tek kaynak)
├─ vendor/                    Tesseract (çekirdek, işçi, dil verisi); sürümden bağımsız SW önbelleği
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
   │  ├─ elevation.js         Google Elevation (Maps JavaScript API ElevationService; web servisi CORS vermez)
   │  ├─ weather.js           Google Weather API saatlik tahmin (varış saatine göre)
   │  ├─ traffic.js           Yoğunluk → hız çarpanı; ekstra HVAC kWh vs düşük hız tasarrufu
   │  └─ rangeEngine.js       1 sn döngü: mesafe/enerji entegrasyonu, k, menzil, rüzgar/trafik etkisi
   ├─ routing/
   │  ├─ googleRoute.js       Google Routes API (trafik farkında rota + Türkçe dönüş talimatları)
   │  ├─ chargerSource.js     Google Places API (New) Nearby Search: rota boyunca daireler (dolu daire bölünür), 6 saat önbellek
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
      ├─ placeSearch.js       Yer/adres arama (Places Autocomplete + Place Details oturum belirteciyle) + haritadan seçince ad (Geocoding)
      └─ tokenScanner.js      ABRP token/API Key ve Google anahtarını kamerayla ekrandaki METİNDEN okur (OCR); boş alana dokununca açılır
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
- **Kütüphaneler uygulamayla birlikte** (`vendor/`, bkz. [vendor/README.md](vendor/README.md)): Tesseract (çekirdek + dil verisi). Service worker bunları **sürümden bağımsız** `ev-copilot-vendor-v2` önbelleğine alır (ilk OCR kullanımında); uygulama sürümü artınca yeniden indirilmez. Kütüphane dosyaları değişirse `sw.js` içindeki `VENDOR_CACHE` adını artır.

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
| 4 | Google rota + istasyonlar + şarj planlayıcı | ✅ |
| 5 | Fallback + Eco-Speed + sesli uyarı | ✅ |
| 6 | ABRP telemetri köprüsü | ✅ (gerçek token ile denenmedi) |
| 7 | Simülatör + ekran hızı ROI'si | ✅ |

Tarayıcıda gerçek servislerle denendi: rota/rakım/hava planı, istasyon önbelleği, planlayıcı modları, fallback, eco-hız, sesli uyarı metni, sahte ekranla OCR (pil + hız), ABRP uç noktasının yanıtı (sahte token → okunabilir HTTP 401).
**Araçta ve gerçek GPS ile henüz denenmedi.**

## Bilinen sınırlar

- **Canlı trafik yok:** anahtarsız ücretsiz bir trafik kaynağı yok. Trafik, Rota sekmesindeki yoğunluk tahmini (ve Test Modu sürgüsü) ile modellenir. Google Routes API gibi bir kaynak sonradan `traffic.js`'e bağlanabilir.
- **Google anahtarı**: Rota sekmesindeki kutuya yazılır (veya kamerayla okunur) ve yalnızca cihazın LocalStorage'ında durur; GitHub Pages sitesi herkese açık olduğundan anahtar koda/depoya KONMAZ. Anahtarı Google Cloud'da **HTTP yönlendiren** (`ozdemirumit.github.io/*`) ve API kısıtıyla (Maps JavaScript, Routes, Places (New), Weather, Geocoding, Elevation) sınırla; bütçe uyarısı/kota koy. "Kaydet ve sına" hangi API'nin kapalı olduğunu söyler. Fiyat: Google'da EV şarj fiyatı yok, operatör tablosundan gelir; kW Google'da yoksa tablodan (listede `*`).
- **Maliyet/kota**: Nearby Search'te `evChargeOptions` alanı üst SKU'dur. Uzun rota ≈ rota_km/45 + dolu dairelerin bölünmesi kadar çağrı (en çok 300); sonuç 6 saat önbelleğe alınır (Google içeriğini uzun saklamak hizmet şartlarınca kısıtlı).
- **Kendi istasyonlarım**: Google'da eksik istasyonlar İstasyon sekmesinden elle eklenir (`customStations`, yalnızca cihazda). Plan, zincirin koptuğu yeri ve gidilebilir mesafeyi yazar.
- **Açılır kartlar**: her kartın başlığındaki + / − düğmesiyle açılıp kapanır, seçim cihazda saklanır ([js/ui/collapse.js](js/ui/collapse.js)). Kartta `data-collapsed="1"` varsa ilk açılışta kapalı gelir.
- **Navigasyon** ([js/nav/navigator.js](js/nav/navigator.js), [steps.js](js/nav/steps.js), [track.js](js/nav/track.js)): Routes API adımları (`navigationInstruction`, Türkçe metin Google'dan gelir); araç, rotanın tam geometrisine izdüşürülür (menzil profilinin 2 km'lik kirişleri dönüş mesafesi için yeterince hassas değil). Sesli yönlendirme Web Speech API ile; tarayıcı sesi kullanıcı dokunuşundan sonra açar (Navigasyonu başlat düğmesi). Rotadan çıkınca (≥350 m, 12 sn) bulunulan yerden yeniden rota kurulur; mevcut istasyon listesi yeni rotaya izdüşürülür.
- **Yakınımdaki istasyonlar / düşük pil** ([js/nav/nearby.js](js/nav/nearby.js)): konum çevresinde Places Nearby Search ile aranır (en çok 50 km), ~1 km hücre başına 20 dk önbelleğe alınır. Pil eşiğin altına inince veya advisor 'ulaşılamıyor' derse en yakın uygun istasyon önerilir. Fiyat/kW operatör tablosundan gelen tahmindir; gerçek tarife değildir.
- **Düşük pil ve rota güncelleme**: pil ≤ eşik (veya plan 'ulaşılamıyor' diyorsa) 5 sn'de bir denetlenir; veri yoksa 45 sn'de bir kendiliğinden aranır (boş dönerse yarıçap 50 km). 'Git': `planTrip(from, { via, extra })` rotayı Routes API `intermediates` ile istasyondan geçirir, yakın istasyonları plana ekler ve planlayıcıya `forceFirstId` verir (ilk durak o istasyon). Navigasyon açıkken ve plan 'bad' iken, ulaşılabilir en iyi istasyon için bu otomatik çalışır (10 dk'da bir).
- **Canlı plan** ([js/routing/livePlan.js](js/routing/livePlan.js)): 5 sn'de bir; geçilen durak, plan beklentisinden > 4 puan sapma veya son hesaptan ≥ 25 km olunca `replanFrom` (konum + gerçek pil %) çağrılır (45 sn bekleme). Arayüz `engine.routeKm`'e göre geride kalan durak/istasyonları gizler ve 'X km kaldı'yı her tam km'de günceller.
- **Yuva doluluğu** ([js/routing/slots.js](js/routing/slots.js)): `evChargeOptions.connectorAggregation[].availableCount/outOfServiceCount/availabilityLastUpdateTime` (DC varsa yalnızca DC konnektörler) → `station.slots`. Yalnızca bazı ağlar canlı veri verir; yoksa 'doluluk bilgisi yok'. Planlayıcı: tamamen arızalı (taze bilgi, < 15 dk) istasyon aday değil; dolu + ilk 150 km içinde → 20 dk bekleme. Canlı yenileme: yaklaşan ≤ 2 planlı durak için Place Details (`evChargeOptions`) 5 dk'da bir; kötüleşirse sesli uyarı + `replanFrom`. Her yenileme Google'da Enterprise + Atmosphere SKU'dur (kota).
- **Yol önü uyarıları** ([js/nav/ahead.js](js/nav/ahead.js)): navigasyon açıkken 10 dk'da bir önümüzdeki 200 km için Google Weather (yağmur ≥ 0,3 mm/sa; ≤ 2 °C'de buzlanma) ve Routes `TRAFFIC_ON_POLYLINE` (SLOW/TRAFFIC_JAM aralıkları, toplam gecikme) sorgulanır; bulunduğun yerin havası (menzil modeli için) 15 dk veya 25 km'de bir yenilenir. Hız uyarısı kullanıcının eşiğidir. Google Maps Platform kaza/polis/kamera/hız sınırı verisi sunmaz.
- **Navigasyon modu**: başlatınca `body.navmode` ile harita `main` yüksekliğini doldurur (ResizeObserver ölçer), rozet satırı gizlenir; `bottomnav` ve diğer sabit öğeler `flex: none` olduğundan uyarı çubukları birikse de alt menü sıkışmaz. Zoom: ortalama hıza göre 17/16/15, kavşağa ≤ 250 m'de 18 (8 sn histerezis); harita eğimi 40°, yön GPS yönüne göre döner (vektör haritada). Kavşak penceresi ≤ 400 m'de görünür.
- **Gerçek navigasyon görünümü**: `renderingType: 'VECTOR'` haritada `setHeading` (rota yönünden, 150 m ilerisine bakan `headingAt`; her güncellemede farkın %60'ı = yumuşak dönüş) ve `setTilt(40)`. Merkez aracın harita yüksekliğinin ~%22'si kadar ilerisine konur (araç alt kısımda). Araç oku `me-arrow`, yön-yukarıda hep yukarı bakar. Kuzey-yukarı seçeneği `nav.headingUp` (LocalStorage `headingUp`).
- **Trafik otomatiği**: `routes.duration / routes.staticDuration` oranından yoğunluk türetilir (`densityFromRatio`, `speedFactor`'ün tersi; < %3 yavaşlama = 0) ve her planlamada `route.traffic`'e yazılır. Sürgüyü elle oynatmak otomatiği kapatır. Navigasyon varış saati = Google'ın kalan trafikli süresi (10 dk'da bir) + kalan şarj molaları. Oran tüm rotanın ortalamasıdır; yerel sıkışıklıklar yol önü uyarısıyla ayrıca gelir.
- **Tüketim geçmişi** ([js/physics/history.js](js/physics/history.js), [historyPanel.js](js/ui/historyPanel.js)): pil % kenarları arasındaki pencereler (≥ 5 km ve ≥ 3 puan, ya da ≥ 30 km ve ≥ 1 puan) `evcp.hist`'e (en çok 400 kayıt) yazılır: mesafe, ort. hız, kWh/100km, model kWh/100km, `kBase` (ölçülen/model, kullanıcının tüketim düzeltmesinden bağımsız), sıcaklık, rüzgâr, eğim. `planK()` (controller): seyir hızı × trafik çarpanı ±12 km/s içindeki kayıtların mesafe ağırlıklı `kBase` ortalaması (medyanın ±%40'ı dışı atılır, ≥ 40 km, 0,7–1,6 sınırı) tüm plan hesabında `k` olur; canlı ölçüm varsa 50/50. SoC okuması (kamera/OCR) gerekir; GPS tek başına tüketimi ölçemez.
- **İstasyon güvenilirliği**: Veri Google Places kaynaklıdır; erişim türü (özel/müşteri) Google'da belirtilmediği için bazı özel şarj noktaları listeye girebilir, Tesla/NACS'a özel kayıtlar elenir. Aynı noktadaki farklı operatörler ayrı aday kalır; operatör adı yanlışsa İstasyon sekmesinde satırdan düzeltilir (LocalStorage `stationOps`). 150 km üzeri DC boşlukları uyarılır.
- **Araç ve tüketim**: Rota sekmesinde araç seçimi (batarya, ağırlık, Cd, ön alan, DC gücü; değişince sayfa yenilenir), tüketim düzeltmesi (`PHYSICS.consScale`, hem harcamaya uygulanır, rejenerasyona değil), ara istasyona varış payı ve şarj hedefi. Model 100 km/h'de ≈ 18,5, 120 km/h'de ≈ 23 kWh/100 km verir (düz yol, 15 °C); gerçek tüketim farklıysa düzeltme verilmelidir. Hazır araç değerleri tahminidir.
- **Harita**: Google Maps JavaScript API (koyu şema, `DEMO_MAP_ID`). "Haritayı gizle" anahtarı harita yüklenmesini kapatır (veri tasarrufu); rota ve plan çalışmaya devam eder.
- **Yer arama** Google Places Autocomplete (Türkçe, yazarken 350 ms gecikmeli) + seçilince Place Details; oturum belirteci aramayı tek faturalanabilir oturum yapar.
- **Token okuma (OCR):** boş User Token / API Key alanına dokununca kamera açılır, ekrandaki UUID biçimli metin okunur (art arda 2 okuma tutarlı olunca kabul). OCR yanılabilir (sentetik testte 6 rastgele token'ın 5'i birebir okundu; ince monospace yazılar daha zayıf, bazı karakterler karışabilir, örn. `4`↔`d`); biçime uymayan okumalar reddedilir ama biçime uyan yanlış okuma kabul edilebilir, bu yüzden kaydetmeden önce değer düzenlenebilir kutuda gösterilir: ekrandakiyle karakter karakter karşılaştır. Yalnızca 8-4-4-4-12 onaltılı biçim okunur; farklı biçimli bir API Key'i elle yaz. Okuma küçük/ince yazıda zorlanır: metni büyüt ve kutuya sığdır.
- **Rota** Google Routes API (`TRAFFIC_AWARE`, yüksek kalite çizgi); varış saati trafik farkında süreden gelir, enerji modeli seyir hızıyla hesaplar.
- **Operatör fiyatları** `config.js`'te yer tutucudur; İstasyon sekmesinden güncelle.
- **Rakım/eğim:** SRTM ~90 m çözünürlük; 2 km dilimlerde yaklaşık eğim verir.
- **Şarj eğrisi** üretici verisi değil, "%10→%80 ≈ 28 dk"ya ayarlı bir yaklaşım.
- **Ekran OCR'ı:** ROI yalnızca iri rakamlara oturmalı (küçük % işareti ve pil simgesi dışarıda). Koyu zeminli ekranlar otomatik ters çevrilir.
- **Arka plan:** Chrome sekmesi arka plana alınınca GPS/zamanlayıcılar kısıtlanır; Wake Lock + ekran açık kullanım varsayılır.
- **ABRP:** iki kimlik gerekir: kullanıcı token'ı (ABRP uygulaması → araç ayarları → Bağlantıları değiştir → Generic → Bağla) ve Iternio'dan alınan API Key. Token ve key LocalStorage'da düz metin saklanır. İstek biçimi (sorgu parametreli GET / form gövdeli POST) gerçek anahtarla doğrulanmadı; biri başarısız olursa diğeri otomatik denenir. Test Modu açıkken ABRP gönderimi açıksa simülasyon verisi hesabına gider.
