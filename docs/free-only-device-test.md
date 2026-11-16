# Yalnız ücretsiz sağlayıcı modu — kapalı cihaz testi (Android `adb reverse` / iOS yerel HTTPS)

Durum: **UYGULANDI (yerel), CİHAZDA TEST EDİLMEDİ.** Köprü görevi `dee61f95`, 2026-11-16, uygulama **v0.99.92**.
Bu belge yalnız talimat ve boş kanıt listesidir. Hiçbir fiziksel cihaz testi yapılmadı; `verified` yalnız kullanıcı yazar (CLAUDE.md §9).
Herkese açık yayın İÇİN DEĞİL: GitHub Pages, `ev-copilot-beta` deposu, üretim (`main`) ve canlı sunucu bu işte değişmedi.

## 1. Ne değişti

| Derleme | Sağlayıcı davranışı |
|---|---|
| Kaynak / üretim / bayraksız `build-beta.mjs` | **Değişmedi.** `js/net/providerGate.js` `PROVIDER_MODE_BUILD = 'paused'`, `PROVIDER_REQUESTS_PAUSED_DEFAULT = true`: bütün dış sağlayıcı istekleri kesik, harita yerel boş stil. |
| `node scripts/build-beta.mjs --free-only <depo-dışı-klasör>` | Yalnız çıktıdaki `providerGate.js` satırı `'free-only'` olur. Küresel duraklatmanın yerine **kesin izin listesi** (`FREE_ENDPOINTS`). |

İzin listesi (yalnız `https`, standart port, kimlik bilgisiz adres, listede olan yol ve yöntem):

| Kimlik | Ana makine | Yol / yöntem | Patlama | Jeton aralığı | Saatlik tavan |
|---|---|---|---|---|---|
| openfreemap | `tiles.openfreemap.org` | `/styles` `/planet` `/fonts` `/sprites` `/natural_earth` GET | 20 | 100 ms | 3000 (yalnız stil gibi ana iş parçacığı istekleri sayılır) |
| valhalla | `valhalla1.openstreetmap.de` | `/route` `/height` `/locate` POST | 5 | 1000 ms | 600 |
| open-meteo | `api.open-meteo.com` | `/v1/forecast` `/v1/elevation` GET | 10 | 500 ms | 600 |
| photon | `photon.komoot.io` | `/api` `/reverse` GET | 3 | 1000 ms | 300 |
| nominatim | `nominatim.openstreetmap.org` | `/search` `/reverse` GET | 1 | 1100 ms | 60 |
| overpass | `overpass-api.de`, `overpass.private.coffee`, `overpass.kumi.systems` (ayna başına ayrı kova) | `/api/interpreter` POST/GET | 2 | 2000 ms | 60 |

- **Reddedilir:** Mapbox, Google (googleapis/gstatic dahil), TomTom, HERE, Iternio/ABRP, ArcGIS/Esri, OpenChargeMap (`reason: paid-provider`),
  listede olmayan her köken ya da yol, Open-Meteo ticari `customer-api` ucu, `http`, standart dışı port (`not-allowlisted`). Ara sunucunun
  sağlayıcıya giden yolları (`/mapbox/` `/here/` `/google/` `/tomtom/` `/ocm/` `/overpass` `/v1/occupancy` `/v1/speedlimits` `/v1/tesla`
  `/v1/map/config`) her iki modda da reddedilir (`proxy-provider`).
- **Sınır aşımı:** istek kuyruğa alınmaz, `ProviderPausedError` (`reason: rate-limit`, TypeError değil → `proxy.js` yeniden deneme turu
  başlamaz) ile reddedilir. Fırtına olmaz: 60 sn boyunca saniyede 20 Valhalla denemesinde en çok ~60 istek ağa çıkar (test D6).
- **Sağlayıcı seçimi:** free-only modda `proxyHas()` her yetenek için `false`, kişisel `mapboxKey()` ve `ocmKey()` boş. Rota doğrudan
  Valhalla, istasyon Overpass, hava/yükselti Open-Meteo (+ Valhalla `/height`), arama Photon/Nominatim; trafik/doluluk/hız limiti
  (sunucu) ve ABRP telemetrisi istek atamaz (engellenir).
- **Harita:** `/v1/map/config` sorulmaz; doğrudan OpenFreeMap koyu stil + 3B binalar. Esri/ArcGIS uydu katmanı bu modda **hiç eklenmez**
  (uydu düğmesi etkisizdir). MapLibre Worker istekleri `transformRequest: freeMapRequest` ile denetlenir: OpenFreeMap dışındaki her adres
  boş yerel `data:` adresine çevrilir (ağa çıkmaz). Worker karoları sayılmaz/kısılmaz (OpenFreeMap yayımlanmış sınır bildirmiyor; T10'da sayılır).
- **Belirsizlik = kapalı:** mod değeri tam `'free-only'` değilse `'paused'`. `build-beta.mjs --free-only` klasörsüz, `../ev-copilot-beta`
  (herkese açık Beta deposu), içinde `.git` olan ya da proje içi klasörle **çalışmaz**; bilinmeyen bayrak reddedilir.
- Adil kullanım sınırları yayımlanmış kuralların altında seçildi; kurallar bu görevde çevrimiçi yeniden okunmadı (her satırda `terms` notu).

Bilinen sınır (karar bekliyor, §5 D-FO-1): kendi ara sunucunun **sağlayıcıya gitmeyen** yolları (`/v1/config`, giriş, eşitleme, istasyon bilgisi,
topluluk fiyatı, önbellekteki tarifeler) duraklatma modundaki gibi izinlidir. Bunlar canlı sunucuya (üretime de hizmet eden) gider ama ücretli
sağlayıcı çağırmaz. `localhost` kökeninden CORS nedeniyle çoğu başarısız olabilir — bu beklenir.

## 2. Yerel derleme (bilgisayarda, depo dışında)

Önkoşul: Node (depoda kullanılan sürüm), Android için `adb` (Android SDK platform-tools), iOS için `openssl` (Git for Windows ile gelir).
Yeni npm paketi, CDN ya da tünel/harici servis **gerekmez**.

```bash
# 1) Temiz bir kopyadan, entegre commit'ten derle (çıktı depo DIŞINDA, git deposu OLMAYAN boş klasör)
git -C "D:/AI-Codes/Claude Code/MBRP-integ" log --oneline -1          # v0.99.92 içeren sha'yı not et
node "D:/AI-Codes/Claude Code/MBRP-integ/scripts/build-beta.mjs" --free-only "D:/AI-Codes/evrf-localtest/build"
# Çıktıda FREE-ONLY-LOCAL-TEST.txt ve başlık "EV Route Finder (Beta – yerel ücretsiz test)" olmalı.
```

Bu klasörü **hiçbir yere push etmeyin / yayımlamayın.** İşiniz bitince klasörü silebilirsiniz.

## 3. Android — USB + `adb reverse` (yeni servis yok)

```bash
node "D:/AI-Codes/Claude Code/MBRP-integ/scripts/serve-local-test.mjs" "D:/AI-Codes/evrf-localtest/build"   # yalnız 127.0.0.1:8080
adb devices                         # telefon "device" görünmeli (Geliştirici seçenekleri → USB hata ayıklama açık)
adb reverse tcp:8080 tcp:8080
# Telefonda Chrome: http://localhost:8080/   (localhost güvenli bağlamdır: konum, kamera/OCR, servis çalışanı çalışır)
```

- Konsol/ağ kanıtı: bilgisayarda Chrome `chrome://inspect` → cihaz → *inspect*. Engellenen her istek konsola
  `[kota koruması] istek gönderilmedi: <neden> <host>` yazar (neden: `paid-provider`, `not-allowlisted`, `proxy-provider`, `rate-limit`).
- PWA olarak eklenirse köken `http://localhost:8080` olur; test bitince ana ekrandan kaldırın. `adb reverse --remove-all` ile tüneli kapatın.
- Sunucu yalnız `127.0.0.1`'e bağlanır; ağdaki başka cihazlar erişemez.

## 4. iOS — aynı Wi-Fi, yerel HTTPS (kendinden imzalı, tünel yok)

iOS Safari konum, kamera ve servis çalışanı için HTTPS ister. Sertifika dosyaları depo dışında tutulur ve **asla commit edilmez**.

```bash
mkdir -p "D:/AI-Codes/evrf-localtest/cert" && cd "D:/AI-Codes/evrf-localtest/cert"
IP=192.168.1.20   # bilgisayarın Wi-Fi IP'si (ipconfig)
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -keyout ca.key -out ca.pem -subj "/CN=EVRF yerel test CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -newkey rsa:2048 -nodes -keyout key.pem -out srv.csr -subj "/CN=$IP"
printf "subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "$IP" > ext.cnf
openssl x509 -req -in srv.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 30 -out cert.pem -extfile ext.cnf
node "D:/AI-Codes/Claude Code/MBRP-integ/scripts/serve-local-test.mjs" "D:/AI-Codes/evrf-localtest/build" \
  --https --cert cert.pem --key key.pem --host "$IP"        # https://$IP:8443/
```

1. Yalnız `ca.pem`'i iPhone'a aktarın (AirDrop/kablo). `ca.key` bilgisayardan çıkmaz.
2. Ayarlar → Genel → VPN ve Aygıt Yönetimi → profili yükleyin; Ayarlar → Genel → Hakkında → Sertifika Güven Ayarları → "EVRF yerel test CA" tam güven.
3. Windows Güvenlik Duvarı 8443 için yalnız **Özel** ağda gelen izni sorabilir; genel ağda açmayın.
4. Safari: `https://<IP>:8443/`. Konsol kanıtı için Mac'te Safari Web Inspector gerekir (yoksa ekran görüntüsü + sayım notu).
5. Test bitince: profili silin, `ca.key`'i silin, sunucuyu durdurun.

## 5. Açık kararlar (kullanıcıda)

- **D-FO-1:** Free-only modda kendi ara sunucunun sağlayıcıya gitmeyen yolları da kapatılsın mı? (Bugün duraklatmadakiyle aynı: izinli.)
- **D-FO-2:** Uydu düğmesi free-only modda gizlensin mi? (Bugün görünür ama etkisiz; Esri/ArcGIS yüklenmez.)
- **D-FO-3:** OpenFreeMap Worker karoları için istemci tarafı sayaç/kısıtlama (G3) gerekiyor mu? T10 sayımı sonrası karar.
- **D-FO-4:** Adil kullanım sınır değerleri (tablo §1) cihaz testinde kullanıcı deneyimini bozarsa (ör. Nominatim saatte 60) ayar.
- Yayın kapıları açık kalır: G-SERVER, G-PAID, S-1, N-1 bu işle çözülmedi; G-ACCESS yöntemi (A1 + yerel A2) yazıldı ama cihazda koşulmadı.

## 6. D6 T1–T11 kanıt listesi — free-only [F] derlemesi (BOŞ; yalnız cihazı kullanan doldurur)

Mod işareti **[F]** = bu belgedeki yerel free-only derleme. Her satır `docs/d6-device-acceptance.md` §3 adımları ve §4 kanıt şablonuyla
kaydedilir; ölçütler oradakiyle aynıdır, aşağıda yalnız [F]'ye özgü farklar yazılıdır. Sürüm etiketi **0.99.92** değilse satır geçersizdir.

| # | Test | [F]'de koşulabilir mi | [F]'ye özgü not / beklenen | Toplanacak kanıt | Sonuç |
|---|---|---|---|---|---|
| F0 | Ön koşul: derleme kimliği | evet | Başlık "(Beta – yerel ücretsiz test)", sürüm 0.99.92, kaynak sha | ekran görüntüsü + `git log -1` sha | |
| T1 | Geç gelen GPS, tek nokta | evet | Zemin artık OpenFreeMap haritası (boş stil değil) | 2–3 zaman damgalı görüntü | |
| T2 | Normal harita tek nokta | evet | — | 20–30 sn kayıt | |
| T3 | Navigasyonda yalnız araç oku | **evet (yeni)** | Rota Valhalla'dan; trafik yok | ≥1 dk sürüş kaydı (yolcu çeker) | |
| T4 | Navigasyon bitince nokta geri gelir | **evet (yeni)** | — | iki bitiş yolu kaydı | |
| T5 | Hava hatasında geri çekilme | evet | [F]'de hava başarılı olur; hata yolu için uçak modu/veri kapalı ile 10 dk say (≤4 deneme) | konsol günlüğü + sayım | |
| T6 | SOC güven kapısı | evet (1–3) | Düşük pil araması Overpass'e gider; doluluk (`/v1/occupancy`) her durumda engelli | üst bar görüntüleri + konsol | |
| T7 | İstasyon hatasında geri çekilme | evet | Arama Overpass; hata yolu uçak moduyla; S-1 gözlenirse "S-1 gözlendi" yazılır | konsol + sayım + liste görüntüsü | |
| T8a | Sunucu kota sıfırlama | **hayır** | G-SERVER (sunucu yeniden başlatılmadı) | — | koşulamadı (G-SERVER) |
| T8b | Çevrimdışı yedek | evet | PWA kökeni `localhost:8080` / `https://<IP>:8443` | görüntüler | |
| T8c | Mapbox 402 → Valhalla düşüşü | **uygulanamaz** | [F]'de Mapbox hiç denenmez; doğrudan Valhalla | konsolda `api.mapbox.com` satırı OLMAMALI | |
| T9 | Rota ve sesli yönlendirme | **evet (yeni)** | Valhalla manevraları; N-1 gözlem | ses içeren kayıt + manevra listesi | |
| T10 | Harita karosu sağlayıcı kullanımı | evet (değişik ölçüt) | 10 dk: `tiles.openfreemap.org` > 0 **kaydedilir**; `api.mapbox.com`, `server.arcgisonline.com`, `maps.googleapis.com`, `api.tomtom.com` = **0**; Mapbox/Google/TomTom betiği yüklenmez; uydu düğmesi Esri isteği üretmez | HAR/Network (sorgu ve anahtar maskeli) + sayılar | |
| T11 | Dar ekran üst bar (RM-07) | evet | `window.__navLayout()` çıktısı | görüntü + konsol | |
| F1 | Ücretli istek sıfır | evet | 30 dk karışık kullanım: Network'te ücretli ana makine 0; konsolda `paid-provider` satırları sayılır | HAR + sayım | |
| F2 | Adil kullanım koruması | evet | Hızlı arama yazımında `rate-limit` satırı görülürse kullanıcıya etkisi not edilir (D-FO-4) | konsol + not | |
| F3 | Ana sunucuya giden istekler | evet | Yalnız sağlayıcıya gitmeyen yollar (`/v1/config` vb.); CORS hatası beklenir; sağlayıcı yolu yok (D-FO-1) | Network listesi (yalnız yol + durum kodu) | |

Kişisel veri kuralı: ekran görüntüsünde ev/iş adresi, e-posta, konum geçmişi bulanıklaştırılır; HAR/konsolda anahtar ve sorgu dizesi
paylaşılmaz. Kanıtlar depoya commit edilmez.

## 7. Otomatik kanıt (çevrimdışı, sahte veri — cihaz değil)

`node scripts/test-free-only-mode.mjs` — A varsayılan değişmedi · B mod ayrıştırma fail-closed · C izin/ret tablosu · D kota (sanal saat) ve
ücretli istek 0 · E harita (OpenFreeMap, Esri yok, `/v1/map/config` yok) · F gerçek rota/istasyon/hava/yükselti modülleri sahte `fetch` ile ·
G `build-beta --free-only` geçici klasörde (yayın deposu ve git deposu reddi) · H kaynak değişmezleri · I yerel sunucu aracı.

## 8. Yerel özel derleme kaydı (köprü `ce6f9141`, 2026-11-16) — YAYIN DEĞİL

Durum: **derlendi ve dosya düzeyinde denetlendi; CİHAZDA TEST EDİLMEDİ.** D6 fiziksel cihaz kabulü `verified` değildir; yalnız kullanıcı işaretler.

### 8.1 Derleme kimliği

| Alan | Değer |
|---|---|
| Kaynak | `integ/beta-2026-11-14` @ `39dc62ccb3cd84b521355b9ffeb3320ddf49b952` (MBRP-integ, temiz çalışma kopyası) |
| Sürüm | `APP_VERSION = '0.99.92'` (F0 satırında bu değer görülmeli) |
| Komut | `node scripts/build-beta.mjs --free-only "D:/AI-Codes/evrf-localtest/build-0.99.92-39dc62c"` (çıkış 0) |
| Çıktı | `D:\AI-Codes\evrf-localtest\build-0.99.92-39dc62c` — 206 dosya, ~15 MB, depo dışı, `.git` yok |
| Dosya denetimi | `FREE-ONLY-LOCAL-TEST.txt` var; başlık "EV Route Finder (Beta – yerel ücretsiz test)"; çıktıda `PROVIDER_MODE_BUILD = 'free-only'`, kaynakta `'paused'` (kaynak değişmedi, `git status` temiz); `server/` ve `.env*` yok; anahtar deseni taraması (Google/Mapbox belirteç biçimleri) 0 eşleşme |
| Yerel sunucu | `serve-local-test.mjs` yalnız 127.0.0.1 duman testi 7/7: `/` 200 + başlık, `/version.js` 0.99.92, `providerGate.js` free-only, `sw.js` JS türü, klasör dışı yol reddi, POST 405, `0.0.0.0` reddi |
| Testler (@39dc62c) | `node scripts/check.mjs` tamam (187 dosya); `node scripts/test-free-only-mode.mjs` 165/0; `node scripts/run-tests-guarded.mjs` 110/110, BLOCK_ 0 — hepsi çevrimdışı/sahte veri |

Bu klasör yalnız bu bilgisayarda durur; kopyalamayın, push etmeyin, herhangi bir sunucuya yüklemeyin. Test bitince silinebilir.

### 8.2 Bu bilgisayara özgü notlar

- `adb` PATH'te değil; Android SDK içinde: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. §3 komutlarını bu tam yolla çalıştırın
  (Git Bash: `"/c/Users/<kullanıcı>/AppData/Local/Android/Sdk/platform-tools/adb.exe" reverse tcp:8080 tcp:8080`). Yeni kurulum gerekmez.
- `openssl` Git Bash içinde mevcut (§4 iOS sertifikası için yeterli). Sertifika klasörü derleme klasörünün DIŞINDA tutulmalı (ör. `D:/AI-Codes/evrf-localtest/cert`).
- Sunucu klasör olarak §8.1 çıktısını alır: `node "D:/AI-Codes/Claude Code/MBRP-integ/scripts/serve-local-test.mjs" "D:/AI-Codes/evrf-localtest/build-0.99.92-39dc62c"`.

### 8.3 Bilinen sınırlar (karar bekleyen)

- **D-FO-1 / canlı sunucu teması:** free-only istemci, varsayılan ara sunucuya (`evcopilot.duckdns.org`, üretime de hizmet eder) sağlayıcıya gitmeyen
  istekler (`/v1/config`, istasyon bilgisi, eşitleme vb.) göndermeye çalışır. Depodaki `server/proxy.mjs` `ALLOW_ORIGINS` varsayılanı köken için tam eşleşme
  yapar ve `http://localhost:8080` ya da `https://<LAN-IP>:8443` içermez; köken reddi her işleyiciden (OPTIONS dahil) önce 403 döner → beklenen etki: canlı
  sunucu günlüğünde reddedilmiş istek satırları, veri yazımı yok, sağlayıcı çağrısı yok. Canlı sunucunun gerçek `ALLOW_ORIGINS` ortam değeri gizli dosyada
  olduğundan okunmadı → **doğrulanmadı**; F3 satırında durum kodları kaydedilmeli. Tamamen kesmek kod değişikliği ister (D-FO-1 kararı).
- Uydu düğmesi görünür ama etkisiz (D-FO-2); OpenFreeMap Worker karoları sayılmaz (D-FO-3); adil kullanım tavanları sabit (D-FO-4).
- Trafik, doluluk, hız limiti (sunucu), ABRP telemetrisi bu derlemede bilerek yok; T8a (G-SERVER) koşulamaz, T8c uygulanamaz.

### 8.4 Herkese açık Beta neden güncellenmedi

"Beta'yı güncelle" isteği bu görevde yalnız yerel özel derleme olarak karşılandı. Herkese açık Beta (`ozdemirumit/EV-Route-Finder` GitHub Pages) güncellenemez, çünkü:

1. **D6 erişim kararı (G-ACCESS):** onaylanan yöntem KAPALI cihaz testidir (A1 Android `adb reverse`, A2 iOS yerel HTTPS). Pages internete açıktır;
   oraya konan her derleme herkesçe açılabilir. Bu, onaylı erişim kararının dışındadır.
2. **G-PAUSE:** bayraksız `build-beta.mjs` çıktısı duraklatılmış moddadır (rota/hava/istasyon/karo ağa çıkmaz); yayımlanırsa canlı Beta 0.99.61'den daha az çalışır.
3. **Free-only yayımlanamaz:** `--free-only` çıktısı tasarım gereği `ev-copilot-beta`'ya ve git deposuna yazılamaz; açık yayında topluluk servislerine
   (OpenFreeMap, Valhalla, Nominatim, Overpass) kontrolsüz kullanıcı trafiği gider ve D-FO-1 canlı sunucu teması herkese açılır.
4. **Açık kapılar:** G-SERVER, G-PAID, S-1, N-1 çözülmedi; D6 [F] listesi boş.

Açık Beta için gereken kullanıcı kararı (biri): (a) D6 erişim kararını "herkese açık free-only Beta"ya genişletmek + D-FO-1..4 ve sağlayıcı adil kullanım
riskinin kabulü; (b) erişim denetimli bir barındırma (yeni servis — ayrıca onay ister); (c) önce D6 [F] testini yerelde koşup sonucu kaydetmek, sonra karar.
