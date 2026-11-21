# Herkese açık ücretsiz Beta (public-free) — yayın kapısı raporu (v0.99.93)

> **Güncel durum (2026-11-21):** Bu belge 2026-11-16 tarihli durumu anlatır; tarihsel kayıttır. Kaynakta `PROVIDER_MODE_BUILD` v0.99.112'den (`b360a39`) beri **`'beta-full'`**'dur, `'paused'` DEĞİL (üretim haritasını kapatan hata buydu; `'paused'` asla geri konmamalı). Kullanıcı kararıyla (2026-11-21) Beta kullanılmaz, her şey `main` üzerinden gider. Aşağıdaki "kaynakta paused" / G-PAUSE ifadeleri o günün durumudur.

**Sonuç: BLOCKED — yayımlanmadı.** Kod ve otomatik fail-closed testleri hazır (G-PUB-AUTO `met`); yayın, kullanıcıya ait dış koşullar
(§5) `met` olmadan yapılamaz ve derleme betiği bunu zorlar (kapı kapalıyken çıktı git deposuna yazılamaz, çıkış 2).
Push yok, GitHub Pages / `EV-Route-Finder` / üretim (`ev-copilot` main) / paylaşılan canlı sunucu dokunulmadı, ücretli API çağrısı yok,
cihazda test yok. `verified` yalnız kullanıcı yazar (CLAUDE.md §9).

| Alan | Değer |
|---|---|
| Karar | D6 kullanıcı tarafından değiştirildi: **yalnız** `https://ozdemirumit.github.io/EV-Route-Finder/` için herkese açık ücretsiz Beta, güvenlik kapıları geçerse |
| Taban | `integ/beta-2026-11-14` @ `39665d3` (v0.99.92, temiz) |
| Kod commit'i | `c2b6c59` (v0.99.93) |
| Dal / worktree | `feat/public-beta-free-39665d3` / `MBRP-pubbeta` → yalnız kapılar yeşilse `integ/beta-2026-11-14`'e `--ff-only` |
| Canlı Beta (değişmedi) | `ozdemirumit/EV-Route-Finder` main `4c3bd73`, `APP_VERSION 0.99.61` (yerel `../ev-copilot-beta` temiz, salt okunur denetlendi) |

## 1. Ne uygulandı

Kaynakta mod yine `paused` (`js/net/providerGate.js` `PROVIDER_MODE_BUILD = 'paused'`); yalnız
`node scripts/build-beta.mjs --public-free <klasör>` çıktısında `'public-free'` olur. `free-only` (kapalı cihaz testi) değişmedi.

| Katman | public-free davranışı | Kod |
|---|---|---|
| Paylaşılan canlı sunucu | **Sıfır istek.** `proxyBase` kökeni ve `evcopilot.duckdns.org` her yol için `shared-server` reddi (`/v1/config`, `/v1/me`, `/health`, giriş, `/v1/sync`, geçmiş, istasyon bilgisi/fotoğraf, `/v1/price`, `/v1/tariffs`, doluluk, Tesla, hız limiti, harita yapılandırması, tüm sağlayıcı yolları). Ayrıca `proxyFetch` ağa çıkmadan reddeder, `serverConfig`/`refreshCaps`/`watchCaps` hiç istek/zamanlayıcı kurmaz, eski Beta'dan kalan oturum/yönetici kodu okunmaz (Premium/hesap yolu kapalı). | `providerGate.js` `blockedReason`, `js/net/proxy.js` |
| Ücretli sağlayıcılar | Mapbox, Google (googleapis/gstatic/google.com), TomTom, HERE, Iternio/ABRP, ArcGIS/Esri, OpenChargeMap: `paid-provider`. Kişisel Mapbox/OCM anahtarı kullanılmaz. | `PAID_HOST_SUFFIXES`, `mapbox/api.js`, `osm/chargers.js` |
| İzin listesi | `PUBLIC_FREE_ENDPOINTS`: OpenFreeMap (stil/karo), Valhalla `/route` `/height` (POST), Open-Meteo `/v1/forecast` `/v1/elevation`, Photon `/api` `/reverse`, **yalnız** `overpass.private.coffee`. Yalnız https, standart port, kimlik bilgisiz. **Kapalı:** Nominatim, overpass-api.de, overpass.kumi.systems, Valhalla `/locate`, Open-Meteo ticari uç. | `providerGate.js` |
| Cihaz başı tavan | Jeton kovası + saatlik + **günlük** (cihazda kalıcı, yeniden yüklemeyle sıfırlanmaz; yalnız sayı tutar). Aşımda kuyruk yok, ret. | `createFreeLimiter` |
| Geri çekilme | Yanıt tabanlı, ana makine başına: 429/5xx → 30 sn, ağ hatası/zaman aşımı → 15 sn, ardışık hatada ×2, tavan 10 dk; `Retry-After` uyulur (en çok 1 sa); başarı sıfırlar; çağıranın iptali sayılmaz. Bekleme süresince istek ağa çıkmaz (`backoff`). | `installProviderGate` |
| Overpass temposu | Rota boyu istasyon parçaları sıralı (1 paralel), başlangıçlar ≥ kova aralığı (3,1 sn). | `osm/chargers.js` |
| Kimlik | Valhalla isteklerine `X-Client-Id: EV-Route-Finder-Beta (ozdemirumit.github.io/EV-Route-Finder)` (kişisel veri yok). Tarayıcı varsayılanı Referer olarak yalnız kökeni gönderir. | `osm/valhalla.js` |
| S-1 / S-1b | Hata dizisi + boş sonuçta otomatik arama 45 → 90 → 180 → en çok 300 sn; elle Yenile hemen; son iyi liste en çok 60 dk korunur. (Bütün Beta kaynağında, mod fark etmez.) | `nav/nearby.js` |
| N-1 / N-1b | Başarısız yeniden rota 12 → 24 → 48 → en çok 60 sn; "Rota yeniden hesaplanıyor" sesi sapma bölümü başına 1. (Bütün Beta kaynağında.) | `nav/navigator.js` |
| Arayüz | `<html class="public-free">`: uydu düğmesi, hesap kartı, "kendi anahtarlarım", ABRP/trafik rozetleri, trafik kartı, Premium notu ve yanıltıcı veri kaynağı satırı gizli; istasyon kartında doluluk/puan/fotoğraf ve giriş istemi yok; yeni kaynak/atıf satırı (OpenFreeMap/OpenMapTiles/OSM, Valhalla, Photon, Overpass, Open-Meteo CC BY 4.0) 11 dilde. Kamera/ABRP/Test sekmeleri zaten Premium-dışı gizli. | `css/styles.css`, `index.html`, `ui/stationCard.js`, `net/providerGateInstall.js`, `js/i18n/lang/*.extra.js` |
| Derleme | `--public-free` klasörü zorunlu; `--free-only` ile birlikte, bilinmeyen bayrak, proje içi klasör reddedilir; **kapı kapalıyken git deposu hedefi (yayın deposu dahil) çıkış 2 BLOCKED, klasöre dokunulmaz**; depo dışı klasöre `PUBLIC-BETA-GATE-BLOCKED.txt` işaretiyle yazılır. | `scripts/build-beta.mjs`, `docs/public-beta-gate.json` |

## 2. Topluluk servislerinin yayımlanmış kuralları (2026-11-16 birincil kaynaktan okundu)

| Servis | Kaynak | Kural (özet, kısa alıntı) | Karar |
|---|---|---|---|
| OpenFreeMap | openfreemap.org, /tos | "no limits on the number of map views or requests"; ticari kullanım "Yes"; atıf zorunlu | **izinli** (MapLibre atfı) |
| Nominatim | operations.osmfoundation.org/policies/nominatim | en çok 1 istek/sn; "the sum of traffic by all your users should not exceed the limits"; otomatik tamamlama yasak; proxy + önbellek önerilir | **kapalı** — toplam sınır istemciden korunamaz |
| Valhalla demo | github.com/valhalla/valhalla README + discussions/3373 | adil kullanım; 2021: "1 call/user/sec and 100 calls/sec total"; son kullanıcıya yayımlanan uygulama `X-Client-Id` göndermeli ve bakımcılara GitHub Discussions'ta bildirilmeli; bakımcı: üçüncü taraf üretim hizmeti için uygun değil | **koşullu** — başlık kodda; bildirim kullanıcıda (G-PUB-VALHALLA). FOSSGIS Almanca kullanım koşulları sayfası bot denetimi nedeniyle okunamadı. |
| Open-Meteo | open-meteo.com/en/terms, /pricing | yalnız ticari olmayan kullanım (abonelik/reklam olan uygulama ticari); <10.000/gün, <5.000/sa, <600/dk; sınır "IP addresses and application" başına; CC BY 4.0 | **koşullu** (G-PUB-OPENMETEO) |
| Photon (komoot) | photon.komoot.io | "please be fair - extensive usage will be throttled"; sayı yok | izinli, cihaz başı düşük tavan |
| overpass-api.de | wiki.openstreetmap.org/wiki/Overpass_API, dev.overpass-api.de commons | "usage counts towards the sum of requests made by all your users"; "app for more than just OSM mappers ... relying on the public instances" sorunlu; hatada 30 sn bekle | **kapalı** |
| overpass.private.coffee | OSM wiki | hız sınırı yok; "Feel free to use our service in any project"; büyük ölçek önceden bildirilmeli | **koşullu** (G-PUB-OVERPASS); kumi.systems aynı hizmetin eski adı → kapalı |

**İstemci kotaları toplam trafiği korumaz.** Yukarıdaki tavanlar cihaz başınadır; kullanıcı sayısı arttıkça toplam yük doğrusal artar ve
istemciden sınırlanamaz. Bu yüzden toplamı açıkça sınırlayan servisler kapatıldı; kalanlar için risk kabulü ve izleme kullanıcıda (G-PUB-AGGREGATE).
Ücret açısından: public-free derlemede ücretli sağlayıcı ve paylaşılan sunucu yolu olmadığı için **kullanıcıya fatura riski istemci kodundan doğmaz**;
risk topluluk servislerinin adil kullanımı ve hizmet sürekliliğidir (servis kısarsa uygulama geri çekilir, veri gelmez).

## 3. Kapatılan / gizlenen özellikler

Hesap ve eşitleme, Premium, canlı doluluk, canlı trafik (süreler trafiksiz), fiyat bildirimi, istasyon puan/fotoğraf/olanak, VeriApi tarifeleri
(fiyatlar yerel işletmeci tablosundan "tahmini"), Tesla Supercharger katmanı, yol hız limiti (sunucu ve Valhalla `/locate`), uydu görüntüsü, ABRP
telemetrisi, kişisel Mapbox/OCM anahtarı, Nominatim yabancı ad araması (Photon kalır). Navigasyon, rota, şarj planı, istasyon araması, hava/rakım,
SOC/OCR (yerel) çalışır.

## 4. Testler (çevrimdışı, sahte ağ — cihaz değil)

Önce kırmızı (taban `39665d3` kaynağı, `git archive` ile depo dışı kopya `D:/AI-Codes/evrf-pubbeta-tools/base-39665d3`):
- `scripts/test-public-beta-mode.mjs` → çıkış 1, `TypeError: gate.publicFreeMode is not a function` (mod yok).
- `scripts/test-g2b-request-budget.mjs` (S-1/N-1 kabul denetimleri) → 44/6: A4 80/saat, aralıklar 45 sn sabit, A4c liste silindi (`n1 → null`), B5 277/saat, aralık 13 sn, ses 277.

Sonra (bu dal) — ayrıntılı sayılar §8:
- `scripts/test-public-beta-mode.mjs`: A kaynak varsayılanı · B mod ayrıştırma · C izin/ret tablosu (izinli 12, not-allowlisted 12, paid 11, shared-server 22 yol + özel köken) · D paylaşılan sunucuya sıfır istek (gerçek `proxy.js`, eski oturum/kod/yetenekler varken) · E geri çekilme/tavan (sanal saat: 60 dk sürekli 503'te saniyede 1 deneme → 10 istek; saatlik 240, günlük 1200, yeniden yüklemede kalıcı) · F harita · G gerçek rota/istasyon/hava/yükselti/arama modülleri · H çevrimdışı (10 dk/120 deneme → 6 Valhalla isteği) · Z1 testin tamamında alttaki fetch'e yalnız izin listesi · I herkese açık derleme + kapı · J arayüz değişmezleri.
- `scripts/test-g2b-request-budget.mjs`: S-1 ≤ 15/sa (14), S-1b liste korunur, N-1 ≤ 65/sa (61), ses 1.
- `scripts/test-free-only-mode.mjs` 165/0 (kapalı test modu regresyonu), `node scripts/check.mjs`, 11 dil `i18n-validate :extra`, `run-tests-guarded`.

## 5. Yayın kapısı koşulları (`docs/public-beta-gate.json`, esas)

| Kimlik | Durum | Sahibi | Koşul |
|---|---|---|---|
| G-PUB-AUTO | met | ajan | Otomatik fail-closed testleri yeşil (§4, §8) |
| G-PUB-VALHALLA | **open** | kullanıcı | Valhalla bakımcılarına GitHub Discussions bildirimi (README koşulu) |
| G-PUB-OPENMETEO | **open** | kullanıcı | Ticari olmayan kullanım teyidi (abonelik/reklam yok; Premium planının durumu) ya da ticari plan |
| G-PUB-OVERPASS | **open** | kullanıcı | private.coffee ölçek bildirimi kararı |
| G-PUB-AGGREGATE | **open** | kullanıcı | Toplam trafik riskinin yazılı kabulü + izleme/geri alma planı (§6) |
| G-PUB-DEVICE | **open** | kullanıcı | Android + iOS duman testi (harita, arama, rota — `X-Client-Id` CORS ön isteği gerçek sunucuda doğrulanmadı —, istasyon, hava; ağ günlüğünde paylaşılan sunucu/ücretli 0) |
| G-PUB-PUBLISH | **open** | kullanıcı | Yayın (derleme + push) için ayrı açık onay |

Koşullar `met` olunca kullanıcı (ya da onaylı görev) `docs/public-beta-gate.json`'da `status: "met"` + `evidence` yazar; ancak o zaman
`build-beta.mjs --public-free ../ev-copilot-beta` çalışır.

## 6. İzleme ve geri alma planı

**Yayın (kapılar met olunca, ayrı onayla):**
```bash
cd "D:/AI-Codes/Claude Code/MBRP-integ"            # integ HEAD = v0.99.93 içeren sha (git log -1)
node scripts/run-tests-guarded.mjs                 # yeşil olmalı
node scripts/build-beta.mjs --public-free ../ev-copilot-beta   # kapı kapalıysa çıkış 2 (yazmaz)
git -C ../ev-copilot-beta diff --stat && grep -o "PROVIDER_MODE_BUILD = '[^']*'" ../ev-copilot-beta/js/net/providerGate.js   # 'public-free'
git -C ../ev-copilot-beta add -A && git -C ../ev-copilot-beta commit -m "v0.99.93 (önizleme): herkese açık ücretsiz Beta — kaynak <sha>"
git -C ../ev-copilot-beta push origin main          # AYRI ONAY
curl -s https://ozdemirumit.github.io/EV-Route-Finder/version.js | grep APP_VERSION   # 0.99.93
```

**İzleme (istemci telemetrisi bilerek yok):** GitHub Pages trafiği yalnız depo sahibinin Insights sayfasında; topluluk servislerinin
durum sayfaları/duyuruları (OSM wiki Overpass, Valhalla GitHub Discussions, Open-Meteo); kullanıcı geri bildirimi. Cihazda konsol
`[kota koruması] istek gönderilmedi: <neden> <host>` satırları geri çekilme/tavanı gösterir.

**Geri alma (öncelik sırasıyla, hepsi yalnız `EV-Route-Finder` deposu; üretim ve sunucu etkilenmez):**
1. **Önceki Beta'ya dön:** `git -C ../ev-copilot-beta revert --no-edit <yayın-commit'i>` → push (ayrı onay). Ağaç `4c3bd73` (0.99.61) olur.
   Force-push GEREKMEZ. Servis çalışanı aynı kökende önce ağ kullandığı için istemciler bir sonraki açılışta eski sürümü alır.
2. **Acil kesici (tüm sağlayıcı trafiğini durdur):** bayraksız `node scripts/build-beta.mjs ../ev-copilot-beta` (kaynak varsayılanı `paused`:
   hiçbir dış sağlayıcıya istek yok) + commit + push. Not: bayraksız derleme paylaşılan sunucunun sağlayıcıya gitmeyen yollarını açar
   (D-FO-1 davranışı) — sunucuya istek de istenmiyorsa seçenek 1'i kullanın.
3. **Tek servisi kapat:** `PUBLIC_FREE_ENDPOINTS`'ten ilgili kaydı çıkar → sürüm artır → test → yeniden derle/yayımla.

## 7. Bilinen sınırlar / açık riskler

- Cihazda doğrulanmadı; Valhalla'nın `X-Client-Id` başlığına CORS izni gerçek sunucuda denenmedi (reddederse rota çalışmaz → G-PUB-DEVICE).
- MapLibre Worker karoları fetch sarmalayıcısından geçmez: yalnız ana makine denetlenir (`freeMapRequest`), sayılmaz (OpenFreeMap sınır bildirmiyor).
- İstemci denetimleri kötü niyetli kullanıcıya karşı koruma değildir (kod değiştirilebilir); amaç uygulamanın kendisinin fırtına üretmemesidir.
- S-1/N-1 için yeni "Yeniden ara / Yeniden rota" düğmeleri (D-UI-1) eklenmedi; elle Yenile İstasyonlar sekmesinde var.
- İstasyon kartındaki "↗ Haritalar" bağlantısı kullanıcı dokununca Google Haritalar'ı açar (uygulama isteği değil, gezinme).
- `www.google.com` vb. bağlantı adresleri kaynakta kalır; fetch ile istek atılmaz (C3 ret).

## 8. Kanıt kaydı

| Alan | Değer |
|---|---|
| Kod commit'i | `c2b6c59` (v0.99.93) — `feat/public-beta-free-39665d3`, ebeveyn `39665d3` |
| Dosyalar | `js/net/providerGate.js`, `providerGateInstall.js`, `proxy.js`, `js/osm/valhalla.js`, `search.js`, `chargers.js`, `js/ui/stationCard.js`, `js/nav/nearby.js`, `navigator.js`, `css/styles.css`, `index.html`, `i18n/keys.extra.json`, `js/i18n/lang/*.extra.js` (11), `version.js`, `scripts/build-beta.mjs`, `scripts/test-public-beta-mode.mjs` (yeni), `scripts/test-g2b-request-budget.mjs`, `docs/public-beta-gate.json` (yeni) |
| `node scripts/check.mjs` | version.js v0.99.93, 280 kayıt; 187 dosya söz dizimi tamam |
| `node scripts/test-public-beta-mode.mjs` | 169 geçti, 0 başarısız (taban `39665d3`: çıkış 1) |
| `node scripts/test-g2b-request-budget.mjs` | 50 geçti, 0 kaldı (taban: 44/6); S-1 14/sa, aralık 45→300 sn; S-1b `n1 → n1`; N-1 61/sa, aralık 12→60 sn; ses 1 |
| `node scripts/test-free-only-mode.mjs` | 165 geçti, 0 başarısız |
| `node scripts/i18n-validate.mjs <dil>:extra` | 11 dil 419/419, eksik/boş/yer tutucu/fazla 0 |
| `node scripts/run-tests-guarded.mjs` | 1. koşu 109/111 (FAIL test-api-call-graph: sarmalayıcı değişmezi; test-package-parity: yorumdaki tırnaklı önek) → kod düzeltildi, test değişmedi; **2. koşu 111/111 (check.mjs + 110 test), BLOCK_ 0**, günlük `D:/AI-Codes/evrf-pubbeta-tools/guarded-2` |
| Entegrasyon | kapılar yeşilse `integ/beta-2026-11-14`'e `--ff-only` (sonuç: kayıt §7.6) |
| Yayın | **yok** — kapı BLOCKED (G-PUB-VALHALLA/OPENMETEO/OVERPASS/AGGREGATE/DEVICE/PUBLISH açık) |
