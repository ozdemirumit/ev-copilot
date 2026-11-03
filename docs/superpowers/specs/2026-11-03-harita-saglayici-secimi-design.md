# Premium kullanıcılar için harita sağlayıcısı seçimi (OpenFreeMap / Mapbox / Google)

Tarih: 2026-11-03 · Durum: taslak, sahibinin onayını bekliyor

## Amaç ve neden

Uygulamanın haritası bugün herkes için MapLibre + OpenFreeMap (ücretsiz, anahtarsız). Sahibi, Premium kullanıcıların
haritasını **yönetim ekranından kendisi seçebilsin** istiyor: OpenFreeMap (bugünkü), Mapbox veya Google. Amaç, daha
iyi stil, trafik gibi şeyleri yalnızca seçtiği kullanıcılara ve kontrollü maliyetle açabilmek. Google haritası daha önce
(v0.73.0) yapılıp sahibinin isteğiyle (v0.73.3) kaldırıldı; şimdi sahibi bunu yeniden ve bu kez seçimli, yalnızca
Premium için istiyor. Bu yeni bir karardır, eskisini geçersiz kılar.

## Hedefler

1. Yönetim ekranında (`server/admin.html`) her kullanıcı için harita sağlayıcısı seçilir: Varsayılan / OpenFreeMap / Mapbox / Google.
2. Yönetim ekranında tüm Premium kullanıcılar için bir **varsayılan sağlayıcı** ayarı vardır (başlangıçta OpenFreeMap).
   Kullanıcıya özel seçim varsayılanı geçer.
3. Premium olmayan kullanıcı her zaman OpenFreeMap kullanır; sağlayıcı anahtarını hiçbir zaman almaz.
4. Seçilen sağlayıcı herhangi bir nedenle çalışmazsa (anahtar yok, adres kısıtı reddi, günlük hak doldu, ağ hatası,
   Premium bitti) uygulama **sessizce OpenFreeMap'e döner**; harita boş kalmaz.
5. Yönetim ekranında "Fatura" için yalnızca ilgili panellere **bağlantılar** bulunur (aşağıya bak).

## Hedef dışı

- Fatura, maliyet veya harita yükleme **sayaçları**. Sahibi bunu açıkça istemedi: yalnızca bağlantı. (Mevcut
  `server/costs.mjs` Google Places maliyet sayacı olduğu gibi kalır, genişletilmez.)
- Google Places UI Kit istasyon kartı, Google doluluk verisi. Yalnızca **harita** sağlayıcısı değişir. İstasyon,
  rota, arama, hava, doluluk kaynakları aynı kalır.
- Mapbox trafik katmanı, 3B bina gibi yeni görsel özellikler (ayrı iş).
- Çevrimdışı harita, döşeme önbelleği (ikisi de daha önce bilerek kaldırıldı ve tekrar önerilmez).
- Premium olmayan kullanıcılara seçim hakkı.

## Kötü sonuçlar (başarısızlık sayılır, çalışsa bile)

- Premium olmayan birinin (veya anonim bir cihazın) Mapbox/Google anahtarını alabilmesi.
- Kota veya anahtar sorununda boş/bozuk harita görünmesi.
- Gerçek anahtarın repoya, teste, günlüğe veya sohbete girmesi.
- OpenFreeMap kullanıcıları için bugünkü davranışın bozulması (hız, düğme, rota çizgisi, uydu katmanı).

## Güvenlik (sahibinin onayladığı yaklaşım)

Mapbox ve Google haritaları tarayıcıda çizildiği için tarayıcı bir anahtar görmek zorundadır. Bu yüzden:

1. **Adres kısıtı asıl koruma:** Her iki anahtar da kendi panelinde yalnızca uygulamanın adresine (`ozdemirumit.github.io/ev-copilot`
   ve APK'nın yüklediği aynı adres) kısıtlanır. Bunu **sahibi panelde yapar**; kod yapamaz. Belgelerde (server/README.md ve
   `.env.example`) adım adım yazılır.
2. **Ayrı harita anahtarları:** `MAPBOX_MAP_TOKEN` (herkese açık "pk." anahtarı; mevcut sunucu içi `MAPBOX_TOKEN`'dan farklı
   olmalı) ve `GOOGLE_MAPS_BROWSER_KEY` (+ isteğe bağlı `GOOGLE_MAP_ID`). Sahibi bunları `server\.env`'ye kendisi yazar
   (dosya git'te yok). Kod, test ve belge yalnızca sahte değerler kullanır.
3. **Anahtar yalnızca yetkili Premium'a verilir:** İstemci sağlayıcıyı kendisi seçmez. Sunucu, oturumdaki kullanıcı için
   etkin sağlayıcıyı kendisi belirler (kullanıcıya özel > varsayılan > OpenFreeMap) ve yalnızca o sağlayıcının anahtarını
   döndürür. Kullanıcı Premium değilse veya sağlayıcı OpenFreeMap ise anahtar uç noktası anahtar vermez. Anahtar değeri
   günlüklere yazılmaz (`scrub` kapsamına eklenir). Yanıt `Cache-Control: no-store`.
4. **Yük sınırı:** Anahtar alışı bir harita yüklemesi sayılır; kullanıcı başına günlük hak ve tüm kullanıcılar için günlük
   toplam tavan (`.env` ile ayarlanır, v0.73.0'daki `gmap` hakkı örnek alınır). Hak dolunca 429 → istemci OpenFreeMap'e döner.
5. Mapbox'ta sert bir harcama tavanı yoktur; bu yüzden 4. madde ve yönetim ekranındaki bağlantılar tek denetimdir.
   Google'da panelden günlük kota sınırı konabilir (sahibine belgede önerilir).

## Davranış

### Sunucu
- Kullanıcı kaydına `mapProvider` alanı eklenir: `null` (varsayılanı izle) | `osm` | `mapbox` | `google`.
- Genel ayar `mapDefault`: `osm` | `mapbox` | `google` (db.json içinde kalıcı).
- Etkin sağlayıcı = Premium değilse `osm`; değilse `mapProvider ?? mapDefault`; seçilen sağlayıcının anahtarı sunucuda
  tanımlı değilse `osm`.
- Yeni uç nokta (örn. `GET /v1/map/config`, kimlik doğrulamalı): `{ provider: 'osm' }` ya da
  `{ provider: 'mapbox', token }` / `{ provider: 'google', key, mapId }`. Her anahtar dönüşü günlük hak sayacına işler.
- Yönetici uç noktaları: kullanıcıya `mapProvider` yazma; `mapDefault` yazma/okuma; yönetim özeti hangi anahtarların
  tanımlı olduğunu (var/yok, değer değil) gösterir.

### Yönetim ekranı (`server/admin.html`)
- **Kullanıcılar** sekmesinde her kullanıcı satırında "Harita" seçimi (Varsayılan / OpenFreeMap / Mapbox / Google).
  Anahtarı tanımsız sağlayıcı seçeneği pasif ve "anahtar yok" notlu gösterilir.
- **Özet** sekmesinde (Yapılandırma bölümü) "Premium için varsayılan harita" seçimi ve harita anahtarlarının var/yok durumu.
- **Fatura bağlantıları** (yeni küçük kart, yalnızca bağlantı, sayaç yok): Mapbox hesap/istatistik ve fatura sayfası,
  Google Cloud faturalama sayfası ve Google Maps Platform kullanım/kota sayfası. Yeni sekmede açılır. Bağlantıların
  güncel olduğu uygulamadan önce elle kontrol edilir; sahibi hesabına giriş yapmış olmalıdır.
- Mevcut Maliyet sekmesine dokunulmaz.

### İstemci
- `js/ui/mapView.js` bugün `createMapLibreMap` çağırır. Yerine bir seçici gelir: açılışta (veya hesap girişinden sonra)
  `/v1/map/config` istenir; yanıta göre ilgili bağdaştırıcı yüklenir. Anahtar/istek hatasında OpenFreeMap bağdaştırıcısı.
- Üç bağdaştırıcı aynı arayüzü verir (bugünkü `maplibre.js` ile aynı): `marker`, `line`, `traffic`, `fit`, `moveTo`,
  `bearing`, `setSatellite`, `onClick`, `onDragStart`, `cursor`, atıf. Mevcut harita-kodunun geri kalanı değişmez.
- Sağlayıcı değişikliği (yönetici değiştirdiğinde) bir sonraki uygulama açılışında/yenilemede uygulanır; canlı geçiş gerekmez.
- Mapbox bağdaştırıcısı: Mapbox GL JS (MapLibre ile büyük ölçüde uyumlu arayüz; bugünkü `maplibre.js` ile ortak koda
  yaslanabilir), koyu stil. Google bağdaştırıcısı: Maps JavaScript API; v0.73.0'daki `js/ui/maps/google.js`
  (`git show 174a115:js/ui/maps/google.js`) başlangıç noktasıdır, ama mevcut arayüze (trafik çizgisi, uydu) uyarlanmalıdır.
- Her sağlayıcının kendi atıf (attribution) ve logo kuralları korunur.
- Yeni dosyalar `sw.js` SHELL listesine girer; sürüm artar; 11 dil için yeni metinler eklenir.

## Kısıtlar

- Düz ES modülleri, derleme adımı yok. Sunucu sıfır bağımlılık.
- Gerçek anahtarla bu oturumda test yapılmaz; testler sahte anahtar ve sahte sunucu kullanır. Gerçek sağlayıcı doğrulaması
  sahibi anahtarları `.env`'ye yazdıktan sonra onun tarafından yapılır.
- Mapbox GL JS ve Google Maps JS sağlayıcı kodudur; yüklemenin lisans/şart uygunluğu (kendi barındırma mı, sağlayıcı
  adresinden yükleme mi) uygulama sırasında sağlayıcının güncel şartlarına göre belirlenir.

## Builder'a bırakılanlar

- Mapbox ve Google kütüphanelerinin nereden yüklendiği (şartlara uygun olan), sürüm sabitleme.
- Mapbox'ta stil seçimi (koyu), uydu için kendi uydu stili mi Esri katmanı mı; Google'da harita kimliği.
- Günlük hak sayılarının varsayılan değerleri.
- Yönetim ekranı yerleşimi ayrıntıları.

## Karar notları (yazılı tasarım kontrolünden sonra eklendi; "benim kararım" etiketli olanlar sahibi tarafından görülüp değiştirilebilir)

1. **Açılış sırası (benim kararım).** Harita bekletilmez. Son etkin sağlayıcı adı (anahtar değil) cihazda saklanır. Oturum yoksa veya
   saklı sağlayıcı OpenFreeMap ise harita hemen OpenFreeMap ile açılır. Saklı sağlayıcı Mapbox/Google ise ve oturum varsa
   `/v1/map/config` en çok ~3 sn beklenir; süre dolar veya hata gelirse OpenFreeMap ile açılır. Yönetici sağlayıcıyı
   değiştirince yeni sağlayıcı sonraki açılışta (ilk açılışta saklı ad güncellenir) uygulanır. Böylece OpenFreeMap kullanıcıları için
   açılış hızı değişmez.
2. **Premium sayımı.** Sunucudaki mevcut `isPremium` kullanılır (yönetici hesabı her zaman Premium). Premium oturum ortasında biterse harita
   o oturumda olduğu gibi kalır, sonraki açılışta OpenFreeMap'e döner (benim kararım: canlı sökme yok).
3. **Günlük hak (benim kararım).** Yalnızca anahtar döndüren `/v1/map/config` çağrıları sayılır. Varsayılan kullanıcı başı 100/gün,
   tüm kullanıcılar için 3000/gün (`.env` ile ayarlanır). Anahtar yalnızca oturum süresince bellekte tutulur, cihaza yazılmaz.
   Maliyeti asıl koruyan adres kısıtıdır; hak, kötüye kullanımı sınırlar ve gün içinde sağlayıcının sık değişmesini önlemek için cömert tutulur.
4. **Hata sinyalleri (benim kararım).** OpenFreeMap'e dönüş şu durumlarda olur: kütüphane yüklenemedi, 25 sn içinde harita yüklenmedi,
   Google `gm_authFailure`, Mapbox'ta stil/döşeme isteğinde 401/403 hatası (`error` olayı). Hata açılışta veya sonrasında gelirse tek bir bildirim
   gösterilir ve cihaz oturumu boyunca OpenFreeMap zorlanır (`sessionStorage`), sonra sayfa yenilenir.
5. **APK.** APK `server.url` ile canlı siteyi yüklediği için sayfanın kökeni `https://ozdemirumit.github.io` olur; adres kısıtı APK'da da geçerli.
6. **Bağdaştırıcı uyumu.** Arayüz bugünkü `maplibre.js` ile aynı kalır (işaretçi için DOM elemanı, web-mercator zoom). Mapbox bağdaştırıcısı
   `maplibre.js` kodunu paylaşan bir fabrikayla yapılır (Mapbox GL JS bu kullanılan alt küme için uyumludur; sürüm sabitlenir).
   Google bağdaştırıcısı v0.73.0'daki `OverlayView` işaretçisini ve `moveCamera` kullanımını alır; navigasyonda kare başına
   kamera hareketi Google'da biraz daha az akıcı olabilir, kabul edilir (benim kararım).
7. **Uydu (benim kararım).** Her sağlayıcı kendi uydu görüntüsünü kullanır (Mapbox uydu stili, Google `hybrid`); Esri katmanı yalnızca OpenFreeMap'te kalır
   (Esri döşemesini başka sağlayıcının haritasına karıştırmak şart sorunu çıkarabilir).
8. **Sürümleme (benim kararım).** Önce sunucu + yönetim ekranı + seçici + Mapbox (v0.79.0), sonra Google (v0.80.0); ikisi bağımsız. Anahtarlar
   tanımlı değilken uygulama %100 bugünkü gibi çalışır; yönetim ekranında seçenekler pasif ve "anahtar yok" notlu görünür.
