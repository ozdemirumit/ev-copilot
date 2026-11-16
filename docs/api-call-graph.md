# API çağrı grafiği ve istek yönetişimi — R5 G0

Kapsam: istemcideki **her** ağ çağrı noktası, GPS / OCR-SOC (5 sn) / rota / trafik / hava / şarj tetikleyicileriyle bağı ve isteği
sınırlayan koruma. Taban: `integ/beta-2026-11-14` @`cab7756` (v0.99.86, R4 D2-T1 sonrası). Kanıt: `scripts/test-api-call-graph.mjs`
(çevrimdışı, sahte fetch, sanal saat) + D2-T0 envanteri `scripts/test-d2-quota-inventory.mjs` (koruma sabitleri, SOC güven kapısı,
duraklatma kapıları, sunucu sayaçları — burada tekrarlanmaz). **Hiçbir API çağrısı varsayılmadı**: her satır kaynakta bulunan bir
çağrı noktasına ya da testte sayılan bir isteğe dayanır. Gerçek ağ / gerçek anahtar / cihaz kullanılmadı; cihazda DOĞRULANMADI.

Uygulama kodu bu adımda **değişmedi** (sürüm v0.99.86 kalır). Bulunan boşluk (W-1) KNOWN-GAP olarak sabitlendi; düzeltme G1. **G1a (v0.99.87) W-1'i kapattı** — aşağıdaki W-1 satırı.

## 1. Özet bulgular

| # | Bulgu | Kanıt |
|---|---|---|
| F1 | GPS konumu (`gps.js` `onPosition`) ve OCR kabulü hiçbir ağ çağrısı yapmaz; GPS/OCR/SOC çekirdek modüllerinin statik içe aktarma kapanışında ağ ilkeli yok. Tek köprü `ocr.js → meter.js` (`countOcrEngineOnce`, yerel sayaç) `→ proxy.js` (`proxyBase`, yalnız sınıflandırma). | test §B (14 kök) |
| F2 | GPS/Test Modu/OCR durumunu dinleyen 16 dosyanın (21 kayıt) hiçbiri ağ ilkeli içermez; dolaylı yollar yerel: `defaultStart` 100 m eşiği + plan/nav'da donuk, `controller.refresh` plan yoksa döner, ters adres yalnız haritaya dokunuşta. | test §C |
| F3 | 30 dk sanal sürüşte (1800 GPS konumu, 360 OCR kabulü, ~45 km, menzil motoru 1 sn) üretilen istek: **yalnız 2 Open-Meteo** (15 dk / 25 km koruması). | test §D1 |
| F4 | ABRP telemetrisi açıkken (Premium + kullanıcı token'ı) 10 dk'da **10 istek** (60 sn); GPS 1 Hz / OCR 5 sn sıklığı artırmaz. | test §D2 |
| F5 | Park (hız 0) 14 dk: en çok 1 hava isteği, başka istek yok. | test §D3 |
| F6 | Hesap eşitlemesi (kendi sunucu `/v1/sync`, yalnız oturum açıkken, 4 sn gecikmeli) sürüşte yalnız `kCal` (SOC %1 düşüş kenarında, 30 dk'da 5) ve `hist` (≥ 5 km pencere, 2) ile tetiklenir; SOC tahmini ve son konum kayıtları sessizdir. Ücretli sağlayıcı değil. | test §D1, §B |
| **W-1** | **Gereksiz istek:** `rangeEngine.maybeRefreshWeather` hiç başarı yokken hata alırsa `weather.at` 0 kalır (`js/physics/rangeEngine.js:59`), koruma (`w.at && …`, `:51`) atlanır ve 1 sn'lik her tick (`:177`, `:194`) yeni Open-Meteo isteği atar: **60 sn'de 60 istek**. Ağ yok / DNS / 429 / 5xx'te geçerli. Beta'da sağlayıcı duraklatması açıkken istek ağa çıkmaz ama her saniye denenir. **Kapandı (G1a, v0.99.87):** ardışık hatada geri çekilme `wxRetryDelayMs` 60 sn → 2 → 4 → 8 dk, en çok 10 dk; başarı sayacı sıfırlar; 15 dk / 25 km tazelik ve `wxBusy` tekilleştirme aynı. Sanal saatle: 60 sn'de 1 istek, 30 dk kesinti + hareket 5 istek (eskiden 60 / 1800). | test §E `W-1` kabul denetimleri (`ok`) |

## 2. Ağ çağrı noktaları (sink manifestosu — test §A ile iki yönlü eşit)

Sayım yorumlar çıkarılarak yapılır; `fetch(` = çıplak fetch, sarmalayıcı ataması (`window.fetch =`) yalnız `meter.js` (sayaç, isteği bir kez
iletir) ve `providerGate.js` (duraklatmada isteği alttaki fetch'e hiç iletmez). XHR / WebSocket / EventSource / sendBeacon: **yok**.

| Dosya | İlkel (sayı) | Hedef | Sınıf | Tetikleyici → koruma |
|---|---|---|---|---|
| `js/abrp/telemetry.js` | fetch 3 | api.iternio.com, kullanıcı webhook'u | harici (kullanıcı anahtarı) | 60 sn zamanlayıcı (`nextDelay`); Premium + açık + token; pil okuması > 5 dk eskiyse gönderilmez |
| `js/account/auth.js` | fetch 1, proxyFetch 2 | kendi sunucu `/v1/auth/poll`, `/v1/auth/logout`, `/v1/me` | kendi | kullanıcı girişi |
| `js/account/community.js` | proxyFetch 1 | kendi sunucu | kendi | kullanıcı bildirimi |
| `js/account/historySync.js` | proxyFetch 1 | `/v1/history/…` | kendi | geçmiş eşitleme |
| `js/account/stationInfo.js` | proxyFetch 6 | `/v1/station/info`, `/v1/station/photo` | kendi | istasyon kartı / kullanıcı |
| `js/account/sync.js` | proxyFetch 2 | `/v1/sync` | kendi | `SYNC_KEYS` sessiz olmayan kayıt → 4 sn gecikme (birleştirir); görünür olunca 10 dk'da bir çekme |
| `js/google/chargers.js` | proxyFetchRetry 1 | `/google/stations` | ücretli | rota planı / yakın arama; sunucuda `premiumOk` |
| `js/here/chargers.js` | proxyFetchRetry 1 | `/here/stations` | ücretli | rota planı / yakın arama |
| `js/mapbox/api.js` | fetch 1, proxyFetch 1, proxyFetchRetry 1 | api.mapbox.com (kişisel mbKey) ya da `/mapbox/` | ücretli | `mbfetch` tabanı; 429 iç döngüde tekrar yok (D2-T0 §E) |
| `js/mapbox/chargers.js` | mbfetch 2 | Mapbox arama | ücretli | rota planı / yakın arama |
| `js/mapbox/route.js` | mbfetch 1 | Mapbox rota | ücretli | plan / yeniden rota / yol önü trafik; R4 Premium + aylık sınır |
| `js/mapbox/test.js` | mbfetch 2 | Mapbox | ücretli | ayarlarda anahtar sınama (kullanıcı) |
| `js/nav/limitSpans.js` | proxyFetch 1 | `/v1/speedlimits` | sunucu→sağlayıcı | navigasyon; 401/402/403/429/501 sonrası 1 sa kesinti |
| `js/net/mapConfig.js` | proxyFetch 1 | `/v1/map/config` | sunucu→sağlayıcı | harita açılışı |
| `js/net/proxy.js` | fetch 2, proxyFetch 2 | ara sunucu tabanı, `/v1/config` | kendi | sarmalayıcı; sunucu kapalıysa 20 sn kesinti |
| `js/osm/chargers.js` | fetch 2, proxyFetchRetry 2 | Overpass (3 ayna) / OCM, ya da `/overpass`, `/ocm/poi` | açık / anahtarlı | rota planı, yakın arama, hız kamerası (`roadWarnings`, rota başına 1 deneme) |
| `js/osm/elevation.js` | fetch 1 | yükselti servisi | açık | rota planı / zenginleştirme |
| `js/osm/search.js` | fetch 2 | photon.komoot.io, Nominatim | açık | kullanıcı yazınca; ters adres yalnız haritaya dokunuşta |
| `js/osm/valhalla.js` | fetch 1 | valhalla1.openstreetmap.de | açık | rota, durak erişim sorgusu (tekilleştirilmiş, 120 sn tekrar), hız limiti (20 sn / 1 km, hata öncesi `lastQ`) |
| `js/osm/weather.js` | fetch 1 | api.open-meteo.com | açık | `rangeEngine` (15 dk / 25 km; hata: 60 sn→10 dk geri çekilme, W-1 kapandı), `ahead` (10/20 dk, hata dahil `wxAt`/`pwAt` güncellenir), plan; 11 km hücre 30 dk önbellek |
| `js/routing/occupancyClient.js` | proxyFetch 1 | `/v1/occupancy` | sunucu→sağlayıcı | `livePlan` 30 sn zamanlayıcı (Free 5 dk / Premium 2 dk / kritik 1 dk; `lastAvail` istekten önce), `nearby` 60 sn, kart |
| `js/routing/tariffs.js` | proxyFetch 1 | `/v1/tariffs` | kendi (önbellek) | açılış |
| `js/routing/tesla.js` | proxyFetch 1 | `/v1/tesla` | sunucu→sağlayıcı | istasyon kaynağı |
| `js/tomtom/route.js` | proxyFetch 1 | `/tomtom/route` | ücretli | plan / yol önü trafik (10 dk); sunucuda `premiumOk` |
| `js/ui/historyPanel.js` | proxyFetch 1 | `/v1/price` | kendi | kullanıcı |
| `js/ui/stationCard.js` | proxyFetch 1 | `/v1/price` | kendi | kullanıcı |
| `js/ui/versionInfo.js` | fetch 1 | aynı köken `version.js` | uygulama | kullanıcı / güncelleme denetimi |
| `sw.js` | fetch 2, importScripts 1 | aynı köken | uygulama | service worker önbellek |

Toplam: 28 dosya, 51 çağrı noktası. Koddaki `https://` kökenleri (16, test §A tam eşitlik): api.iternio.com, api.mapbox.com,
api.open-meteo.com, api.openchargemap.io, api.tomtom.com, evcopilot.duckdns.org, maps.googleapis.com, nominatim.openstreetmap.org,
overpass-api.de, overpass.kumi.systems, overpass.private.coffee, photon.komoot.io, server.arcgisonline.com, tiles.openfreemap.org,
valhalla1.openstreetmap.de, www.google.com. (Bazıları bağlantı/harita stili adresidir; istek atılıp atılmadığı yukarıdaki tabloya göre.)

## 3. Tetikleyici → istek grafiği

```
GPS watchPosition ──► gps.onPosition ──► patch('live')  ── (ağ YOK) ──► 16 dinleyici dosyası (UI çizimi, yerel)
                                                     └─► defaultStart ─► mapApi.setPoint(start) ─► controller.refresh (plan yoksa dön; yerel computePlan)
OCR çevrimi (5 sn) ─► ocr.js kabul ─► patch('ocr') + patch('live'.soc) ── (ağ YOK) ──► socEstimate (sessiz kayıt)
Zamanlayıcılar (konum/SOC'yi OKUR, olay başına istek atmaz):
  rangeEngine 1 sn ─► maybeRefreshWeather ─► Open-Meteo   [15 dk / 25 km; hata: 60 sn→10 dk geri çekilme (W-1 kapandı)]
                   └► tracker SOC kenarı ─► save('kCal') ─► sync.js 4 sn ─► /v1/sync (oturum varsa)
  telemetry 60 sn  ─► api.iternio.com (+ webhook)         [Premium + açık + token]
  livePlan 5 sn    ─► replanFrom (yerel) ─► applyPlan ─► verifyStopAccess ─► Valhalla [tekil; 120 sn tekrar]
  livePlan 30 sn   ─► /v1/occupancy                       [5 dk / 2 dk / 1 dk]
  navigator        ─► rota dışı 6 sn ─► rerouteFromHere ─► rota + yükselti + hava + istasyon [45 sn soğuma, 12 sn tekrar]
  ahead 5 sn       ─► Open-Meteo 10/20 dk, ücretli trafik rotası 10 dk
  speedLimit       ─► Valhalla 20 sn / 1 km (hız > 5)
  nearby           ─► istasyon araması 15 dk / 10 km (düşük pil 5 dk), /v1/occupancy 60 sn
  roadWarnings 3 sn─► Overpass hız kamerası (rota başına 1)
Kullanıcı eylemi: plan, arama, kart, giriş, ayar sınaması, fiyat bildirimi.
Hepsi: Beta'da providerGate (istemci) + server/providerGate.mjs varsayılan DURAKLATILMIŞ (D2-T0 §D).
```

## 4. Bilinen boşluklar (açık) ve kapsam dışı gözlemler

- **W-1 (G1a ile kapandı, v0.99.87):** hata sonrası en az 60 sn, üstel, en çok 10 dk bekleme; test §E KNOWN-GAP satırı `ok(...)` kabul denetimlerine çevrildi.
- **Q-SOC-1 / Q-SOC-2 (G1b ile kapandı, v0.99.88):** `advisor/fallback.js` yedek `replanFrom` ve `nearby.js` düşük pil kaynaklı
  arama/doluluk (`checkLow` refreshOccupancy + autoSearch, `watch` düşük pil sıklığı) yalnızca `socTrusted` (live/manual/Test Modu sim)
  ile; güvenilmeyen pilde uyarı, ses ve eko-hız tavsiyesi sürer, elle Yenile ve normal sürüş tazelemesi değişmedi. Davranış testi
  `scripts/test-soc-request-gates.mjs`; `test-d2-quota-inventory` KNOWN-GAP satırları `ok(...)` kabul denetimine çevrildi.
- **Q-SRV-1/2/3 (G2a ile kapandı, sunucu):** reddedilen istek (429 günlük / 402 aylık sınır) günlük kullanıcı hakkını harcamaz ve
  aylık sınırlar günlük haktan önce denetlenir; `MAPBOX_MONTHLY_CAP` / `HERE_MONTHLY_CAP` geçersizse sınır 0 (fail-closed), boşsa
  eski varsayılan; günlük kullanıcı sayacı `db.json` (`dailyUsage`, `server/quotaCounters.mjs`) içinde kalıcı. Davranış testi
  `scripts/test-server-quota.mjs`; `test-d2-quota-inventory` KNOWN-GAP satırları `ok(...)` kabul denetimine çevrildi.
- Harita karoları MapLibre Web Worker'ından yüklenir: `fetch` sarmalayıcısı ve bu manifest onları görmez (`providerGate.js:8`);
  takip kamerası GPS ile kaydıkça karo isteği oluşabilir. Duraklatmada yerel boş stil kullanılır. Sayılmadı → G2.
- **Yalnız ücretsiz mod (v0.99.92, `dee61f95`):** yalnız `build-beta.mjs --free-only` yerel çıktısında `providerGate.js` izin listesi
  (`FREE_ENDPOINTS`: OpenFreeMap, Valhalla, Open-Meteo, Photon, Nominatim, Overpass) + ana makine başına jeton kovası/saatlik tavan;
  `proxyHas()` false, kişisel Mapbox/OCM anahtarı kullanılmaz; harita Worker istekleri `freeMapRequest` (transformRequest) ile yalnız
  OpenFreeMap. Yeni çağrı noktası ya da köken EKLENMEDİ (sink manifestosu ve 16 köken aynı). Kanıt `scripts/test-free-only-mode.mjs`;
  kullanım ve cihaz kanıt listesi `docs/free-only-device-test.md`. Kaynak varsayılanı duraklatılmış kalır.
- **S-0 (G2b ile kapandı, v0.99.89):** `nearby.refreshNearby` atılan hata (throw) yolunda `meta.at` yazılmıyordu. `fetchAround` reddi
  gerçek: sunucu Mapbox 402/401/501 ya da sunucuya ulaşılamaması `categoryId` içinde fatal olarak yeniden atılır (`mapbox/chargers.js`).
  Sonuç: güvenilir düşük pilde `refreshNearby → checkLow → autoSearch → refreshNearby` beklemesiz döngü (sanal saatte aynı anda 26+
  arama, sınırsız fırtına); normal pilde `watch` 30 sn'de bir (120/saat). Şimdi atılan hatada üstel geri çekilme (60 sn → 2 → 4 → 8 → en
  çok 10 dk; başarı sıfırlar) `watch` ve `autoSearch` için; elle Yenile etkilenmez. Testi `scripts/test-g2b-request-budget.mjs` §A.
- **S-1 (v0.99.93 `c2b6c59` ile kapandı: 45→90→180→en çok 300 sn, S-1b son iyi liste ≤ 60 dk; test-g2b A4/A4b/A4c):** eski durum — arama hata DİZİSİYLE dönerse (kaynak ulaşılamadı; throw değil) `meta.at` yazılır ve güvenilir
  düşük pilde boş listeyle `autoSearch` 45 sn'de bir dener (≈ 80/saat). Acil durum araması olduğu için geri çekilme eklenmedi.
- **N-1 (v0.99.93 `c2b6c59` ile kapandı: 12→24→48→en çok 60 sn, ses sapma başına 1; test-g2b B5):** eski durum — `navigator.js` rotadan çıkınca yeniden rota başarısız oldukça 12 sn'de bir dener (`RETRY_MS`;
  sanal 60 dk'da 277 deneme). Sürücü güvenliği ↔ istek ödünleşimi; sunucu tarafında Mapbox rota aylık sınırı (D2-T1) ve günlük hak (G2a) korur.

## 5. Takip görevleri (YAPILMADI)

- **G1 — istemci düzeltmeleri:** YAPILDI — G1a W-1 (v0.99.87), G1b Q-SOC-1 / Q-SOC-2 (v0.99.88); `test-api-call-graph` D1–D3
  sınırları korundu.
- **G2 — kapsam genişletme:** Sunucu Q-SRV-1/2/3 YAPILDI (G2a). G2b YAPILDI (v0.99.89, `scripts/test-g2b-request-budget.mjs`): navigasyon
  modüllerinin gerçek kodu (ağ uçları sahte, sanal 60 dk, 90 km/h, plan yüklü) sağlayıcı başarılı / ağ hatası / fatal modlarında sayıldı —
  saatlik: Open-Meteo (yağış + plan havası) 8, trafik rota isteği 6, doluluk ücretsiz 12 / Premium 30 / Premium düşük pil 60, yeniden plan
  (25 km) 4, yol limiti 86 (fatalde 6), hız kamerası rota başına 1, yakın arama başarılı 9 / hata yolu 9 (önce 120 ve fırtına).
  Modüller ayrı ayrı çalıştırıldı (birlikte tek süreçte değil); toplam saatlik bütçe bunların toplamıdır. Harita karoları Worker'da
  yüklendiği için SAYILMADI: §C yalnız kod değişmezlerini kilitler (tek harita nesnesi, kendiliğinden yeniden açılış yok, kimlik
  hatasında oturum boyu OpenFreeMap + en çok bir yenileme, uydu = setStyle, durunca kamera hareketsiz, duraklatmada yerel stil).
  Gerçek karo sayısı ve sağlayıcı faturalama modeli (harita yüklemesi / karo) doğrulanmadı → G3 (cihaz).
- **G3 — çalışma zamanı bütçesi ve saha doğrulaması:** istemcide merkezi istek yöneticisi (sağlayıcı başına belirteç kovası, providerGate
  ile aynı yerde) + yönetici panelinde sayaç; gerçek cihazda ağ günlüğüyle istek sayısının doğrulanması (ücretli çağrı / kota onayı ve
  cihaz gerektirir — kullanıcı kararı).

## 6. Herkese açık ücretsiz Beta (public-free, v0.99.93 `c2b6c59`)

Yalnız `build-beta.mjs --public-free` çıktısı: paylaşılan sunucuya sıfır istek, `PUBLIC_FREE_ENDPOINTS` (Nominatim/overpass-api.de/kumi/Valhalla `/locate` kapalı), cihaz başı saatlik+günlük tavan, yanıt tabanlı geri çekilme. Yeni çağrı noktası ya da köken eklenmedi. Kanıt `scripts/test-public-beta-mode.mjs`; kapı ve politika kaynakları `docs/public-beta-release-gate.md`.
