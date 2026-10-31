# vendor/ — üçüncü taraf kütüphaneler (uygulamayla birlikte sunulur)

Değiştirilmeden, resmî dağıtım paketlerinden alındı. Service worker (`sw.js`) bu dosyaları sürümden bağımsız
önbelleğe alır; böylece CDN'den tekrar tekrar indirilmez. Dosyalar değişirse `sw.js` içindeki `VENDOR_CACHE` adını artır.

| Yol | Kaynak | Sürüm | Lisans |
|---|---|---|---|
| `tesseract/tesseract.min.js`, `worker.min.js` | https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/ | 5.1.1 | Apache-2.0 |
| `tesseract/core/tesseract-core-*-lstm.wasm.js` | https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/ | 5.1.0 | Apache-2.0 |
| `tesseract/lang/eng.traineddata.gz` | https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/ | 4.0.0_best_int | Apache-2.0 |
| `maplibre/maplibre-gl.js`, `maplibre-gl.css`, `LICENSE.txt` | https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-5.6.0.tgz (`dist/`; sha512 npm kaydıyla doğrulandı) | 5.6.0 | BSD-3-Clause |
| `pmtiles/pmtiles.js` | https://registry.npmjs.org/pmtiles/-/pmtiles-4.5.0.tgz (`dist/pmtiles.js`; sha512 npm kaydıyla doğrulandı) | 4.5.0 | BSD-3-Clause |
| `basemaps/basemaps.js` | https://registry.npmjs.org/@protomaps/basemaps/-/basemaps-5.7.2.tgz (`dist/basemaps.js`; sha512 doğrulandı) | 5.7.2 | BSD-3-Clause |
| `basemaps-assets/fonts/Noto Sans {Regular,Medium,Italic}/*.pbf` (Latin + Türkçe aralıkları), `sprites/v4/dark*` | https://protomaps.github.io/basemaps-assets/ (protomaps/basemaps-assets) | main | yazı tipi SIL OFL 1.1 (Noto Sans), simgeler MIT (tangrams/icons) |
