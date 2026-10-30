# vendor/ — üçüncü taraf kütüphaneler (uygulamayla birlikte sunulur)

Değiştirilmeden, resmî dağıtım paketlerinden alındı. Service worker (`sw.js`) bu dosyaları sürümden bağımsız
önbelleğe alır; böylece CDN'den tekrar tekrar indirilmez. Dosyalar değişirse `sw.js` içindeki `VENDOR_CACHE` adını artır.

| Yol | Kaynak | Sürüm | Lisans |
|---|---|---|---|
| `leaflet/leaflet.js`, `leaflet.css` | https://unpkg.com/leaflet@1.9.4/dist/ | 1.9.4 | BSD-2-Clause |
| `tesseract/tesseract.min.js`, `worker.min.js` | https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/ | 5.1.1 | Apache-2.0 |
| `tesseract/core/tesseract-core-*-lstm.wasm.js` | https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/ | 5.1.0 | Apache-2.0 |
| `tesseract/lang/eng.traineddata.gz` | https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/ | 4.0.0_best_int | Apache-2.0 |

Leaflet dosyasındaki telif ve lisans başlığı korunmuştur.
