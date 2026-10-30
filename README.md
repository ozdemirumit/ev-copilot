# Smart EV Co-Pilot & ABRP Bridge (Togg T10X V2 LR)

Telefonda (Chrome PWA) çalışan; GPS + kamera OCR + fizik tabanlı menzil motoru, çok duraklı şarj planlayıcı, dinamik uyarılar ve ABRP canlı telemetri köprüsü.
Build adımı yok: saf ES modülleri + CDN kütüphaneleri (Leaflet, Tesseract.js).

## Mimari

```
MBRP/
├─ index.html                 Ana kabuk (6 sekme: Rota · Menzil · Kamera · İstasyon · ABRP · Test)
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
   ├─ abrp/telemetry.js       5 sn'de bir api.iternio.com/1/tlm/send + opsiyonel webhook
   ├─ sim/simulator.js        Test Modu "oynat": rota boyunca ilerler, pili fizikle düşürür
   └─ ui/                     tabs, mapView, roiBox, cameraPanel, routePanel, stationsView, abrpPanel, testPanel, cards, statusBadges, gpsControl, toast
      ├─ placeSearch.js       Yer/adres arama (Photon, yedek Nominatim) + haritadan seçince ad (reverse)
      └─ qrTransfer.js        ABRP token/API Key'i QR ile cihazlar arası aktarma (üret: qrcode-generator, oku: BarcodeDetector veya jsQR)
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
- **Yer arama** herkese açık Photon/Nominatim servislerini kullanır (yazarken 350 ms gecikmeli, adil kullanım); yoğun kullanım için kendi geocoder'ını bağlamak gerekir.
- **QR aktarımı:** QR gizli bilgi içerir; yalnızca kendi cihazına göster. Okunan QR'dan yalnızca token ve API Key kabul edilir (webhook gibi alanlar yok sayılır) ve kaydetmeden önce onay istenir.
- **OSRM demo sunucusu** yoğun kullanıma uygun değildir; kendi OSRM'ni kurmak için `routing/osrm.js` tek yerdir.
- **Operatör fiyatları** `config.js`'te yer tutucudur; İstasyon sekmesinden güncelle.
- **Rakım/eğim:** SRTM ~90 m çözünürlük; 2 km dilimlerde yaklaşık eğim verir.
- **Şarj eğrisi** üretici verisi değil, "%10→%80 ≈ 28 dk"ya ayarlı bir yaklaşım.
- **Ekran OCR'ı:** ROI yalnızca iri rakamlara oturmalı (küçük % işareti ve pil simgesi dışarıda). Koyu zeminli ekranlar otomatik ters çevrilir.
- **Arka plan:** Chrome sekmesi arka plana alınınca GPS/zamanlayıcılar kısıtlanır; Wake Lock + ekran açık kullanım varsayılır.
- **ABRP:** iki kimlik gerekir: kullanıcı token'ı (ABRP uygulaması → araç ayarları → Bağlantıları değiştir → Generic → Bağla) ve Iternio'dan alınan API Key. Token ve key LocalStorage'da düz metin saklanır. İstek biçimi (sorgu parametreli GET / form gövdeli POST) gerçek anahtarla doğrulanmadı; biri başarısız olursa diğeri otomatik denenir. Test Modu açıkken ABRP gönderimi açıksa simülasyon verisi hesabına gider.
