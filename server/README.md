# EV Co-Pilot ara sunucusu (isteğe bağlı)

Uygulama sunucusuz da çalışır. Bu sunucu şunlar için vardır:
- **Anahtarlar sunucuda kalır:** Mapbox ve OpenChargeMap anahtarları yalnızca `server/.env` içinde durur; telefona yazılmaz, repoya girmez.
- **Ortak önbellek:** Overpass, OpenChargeMap ve Mapbox arama yanıtları saklanır; Overpass istekleri tek sıradan, aralıklı gider (429 azalır).
- **Koruma:** her istek `X-Access-Code` ile doğrulanır; adres başına istek sınırı, 10 yanlış kodda 10 dk engel, yalnızca izinli kökenler (CORS), yalnızca sabit yollar (açık vekil değil).

Sunucu kapalıysa ya da ulaşılamıyorsa: Overpass doğrudan halka açık sunuculara düşer, Mapbox'lı rota ve istasyon araması kapanır (rota Valhalla'ya, istasyonlar Overpass'e düşer), OpenChargeMap hata verir. Sunucuyu kullanmayan telefonlar kendi anahtarıyla eskisi gibi çalışır.

## Kurulum (Windows)
1. Node.js LTS kurulu olmalı (`node -v`).
2. `server\.env.example` dosyasını `server\.env` olarak kopyala. `ACCESS_CODES` için rastgele bir kod üret:
   ```
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```
   `MAPBOX_TOKEN` ve `OCM_KEY` alanlarına kendi anahtarlarını yaz. Bu dosyayı kimseye gönderme, repoya ekleme.
3. Dene: `node server\proxy.mjs` → "EV Co-Pilot ara sunucusu 127.0.0.1:8787 …" yazmalı.
4. Açılışta otomatik başlasın: PowerShell'de `powershell -ExecutionPolicy Bypass -File server\install-task.ps1`. Bilgisayarda zamanlanmış görev için yönetici izni yoksa betik kendiliğinden Başlangıç klasörüne kısayol koyar (yönetici gerekmez). Günlük: `server\proxy.log` (adres, yol, durum; sorgu ve anahtar yazılmaz).

## İnternete açmak: Cloudflare Tunnel (önerilen)
Statik IP ve router port yönlendirmesi gerekmez; bilgisayarın portu internete açılmaz, HTTPS Cloudflare'dan gelir.
1. Cloudflare hesabı + bir alan adı (Cloudflare'a bağlı).
2. Zero Trust > Networks > Tunnels > Create tunnel (cloudflared). Windows için verilen kurulum komutunu çalıştır (servis olarak kurulur).
3. Public hostname ekle: örn. `ev.alanadin.com` → Service: `http://127.0.0.1:8787`.
4. `server\.env` içinde `TRUST_PROXY=1` olsun (yoksa tüm istekler tek adres sayılır, istek sınırı ve yanlış kod engeli herkesi etkiler).
5. Uygulamada Daha Fazla > Veri kaynakları: **Ara sunucu adresi** `https://ev.alanadin.com`, **erişim kodu** `.env`'deki kod → Kaydet ve sına.

### Cloudflare şart değil
Amaç bilgisayarı HTTPS ile internetten erişilir yapmak. Seçenekler:
- **Cloudflare Tunnel** (yukarıdaki): en kolayı; alan adı gerekir (ucuz bir alan adı yeter).
- **Tailscale Funnel**: alan adı gerekmez, `https://makine.tailnet.ts.net` adresi verir; bilgisayara Tailscale kurulur. Ücretsiz plan yeterli.
- **Statik IP + port yönlendirme + Caddy**: alan adını statik IP'ye yönlendirirsin (A kaydı), Caddy `reverse_proxy 127.0.0.1:8787` ile sertifikayı kendi alır. Router'da 443 → bu bilgisayar; Windows güvenlik duvarında yalnızca Caddy'ye izin. Operatör CGNAT yapıyorsa çalışmaz. `TRUST_PROXY=1` ve Caddy'nin `X-Forwarded-For` göndermesi gerekir (Caddy varsayılan olarak gönderir).
- **ngrok**: hızlı deneme için; ücretsiz planda adres değişebilir.

Statik IP + port yönlendirme istersen: HTTPS sertifikasını (örn. Caddy ile otomatik Let's Encrypt) sen kurarsın; Android WebView düz `http://` adrese istek atamaz. Bilgisayarı doğrudan açmak daha riskli; mümkünse tünel kullan.

## Güvenlik notları
- Erişim kodu telefona senin tarafından yazılır (APK içinde değildir). Kod sızarsa `.env`'de değiştir, sunucuyu yeniden başlat.
- Mapbox için sunucuda tutulan token'ı yine de kapsamla (Directions, Search) kısıtla.
- Sunucu yalnızca şu yolları iletir: Mapbox directions/search (driving, driving-traffic, category), OpenChargeMap `/v3/poi`, ve yalnızca şarj istasyonu Overpass sorguları.
- Bilgisayar kapalıyken sunucu da kapalıdır; uygulama yedek yola düşer.

## Hesaplar: davet + Google ile giriş (çok kullanıcılı)
Telefonda hiçbir anahtar yazılmaz. Kullanıcı davet linkine dokunur, Google ile giriş yapar; oturum belirteci uygulamada kendiliğinden saklanır. Mapbox/OpenChargeMap anahtarları yalnızca sunucuda durur.

**Sunucu ayarı (`server\.env`):**
1. Google Cloud Console > API'ler ve Hizmetler > OAuth izin ekranı (dış, test ya da yayında) > Kimlik bilgileri > **OAuth istemci kimliği, tür: Web uygulaması**.
   Yetkili yönlendirme URI'si: `https://evcopilot.duckdns.org/auth/google/callback`.
2. `PUBLIC_URL=https://evcopilot.duckdns.org`, `GOOGLE_CLIENT_ID=...`, `GOOGLE_CLIENT_SECRET=...` yaz (istemci gizlisi yalnızca burada kalır).
3. `ADMIN_EMAILS=senin@gmail.com` yazarsan o e-posta davetsiz kayıt olur ve yönetici olur. Yazmazsan ilk daveti aşağıdaki komutla üretirsin.
4. Sunucuyu yeniden başlat.

**Davet üretmek:** `node server\invite.mjs "Ali" 7` → tek kullanımlık, 7 gün geçerli link yazar (`https://evcopilot.duckdns.org/i/KOD`). Linki kişiye gönder; link sayfasında "Android uygulamasında aç" (`evcopilot://invite?code=KOD`) ve "Web uygulamasında aç" düğmeleri vardır. Uygulama kodu alır, kişi "Google ile giriş"e basar.

**Giriş akışı:** uygulama rastgele bir kod (nonce) üretip tarayıcıda `/auth/google` sayfasını açar; Google'dan dönünce sunucu oturumu o kodla bekleyen uygulamaya tek seferlik teslim eder (uygulama 2 sn'de bir yoklar). Sonraki girişlerde davet gerekmez.

**Veri (`server\data\db.json`, repoya girmez, yedeğini al):** kullanıcılar, davetler (yalnızca özeti), oturumlar (özeti), eşitlenen ayarlar ve kalıcı geçmiş (yolculuklar, şarj oturumları). Eşitlenmeyenler: ABRP, API anahtarları, oturum, sunucu adresi.
- Uç noktalar (oturumla): `GET /v1/me`, `GET/PUT /v1/sync[/anahtar]`, `GET/POST /v1/history/trips|charges`, `DELETE /v1/me` (hesap ve tüm veri silinir), `POST /v1/auth/logout`.
- Yönetici (yönetici kodu ya da yönetici hesabı): `POST/GET /admin/invites`, `DELETE /admin/invites/ID`, `GET /admin/users`, `POST /admin/users/ID/disable|enable`.
- Kullanıcı başına günlük kota: Mapbox 400, OpenChargeMap 200, Overpass 300 (`.env` ile değişir); yönetici ve yönetici kodu sınırsız.

**Gizlilik:** sunucu e-posta, ad, ayarlar, konum içeren yolculuk ve şarj geçmişi saklar. Google Play için gizlilik politikası ve hesap silme (uygulamada "Hesabı sil") gerekir.

## Android uygulamasını internetten kurdurmak
Sunucu kurulum sayfasını ve APK'yı kendisi sunar: **`https://evcopilot.duckdns.org/app`** (herkese açık; telefon tarayıcısında açılır, APK'yı indirir, kurulum adımları sayfada yazar). Davet sayfasında (`/i/KOD`) da "Android uygulamasını indir" düğmesi vardır; yani kişiye tek bir davet linki göndermek yeter.

**Yayınlamak (yeni sürüm çıkınca):**
```
npm run apk
```
Bu komut web dosyalarını `android/` içine eşitler, Gradle ile debug APK derler ve `server/public/ev-copilot.apk` + `app.json` dosyalarını yazar. Sunucuyu yeniden başlatmak gerekmez; sayfa hemen yeni sürümü sunar. Gerekenler: Android Studio (SDK ve JDK 21). APK repoya girmez (`server/public/` gitignore'da).

Sınırlar: bir adresten saatte en çok 20 indirme. APK debug imzalıdır, kendi kullanımın içindir; Play Store için imzalı `.aab` ayrıca hazırlanır. Kullanıcılar APK'yı yeni sürümde üstüne kurarak güncelleyebilir; ayarları ve hesapları korunur.

## Windows hizmeti olarak çalıştırma (durmasın, kendi başına açılsın)
Normal kullanıcı betikleri (`start.ps1`, Başlangıç kısayolları) oturum açılmadan çalışmaz ve oturum kapanınca ya da araç oturumları bitince durabilir. Kalıcı çözüm Windows hizmetidir: bilgisayar açılınca, kimse oturum açmadan başlar, çökerse 5 saniyede yeniden başlar, güncelleme sonrası yeniden başlatmada kendiliğinden gelir.

**Kurulan bileşenler (`server\service\`):**
| Ad | Ne yapar |
|---|---|
| `EVCoPilotProxy` (hizmet) | `node proxy.mjs`: hesaplar, anahtarlar, `/app`; 127.0.0.1:8787 |
| `EVCoPilotCaddy` (hizmet) | HTTPS ve sertifika yenileme; :443 |
| `EVCoPilotBackup` (görev) | her gün 03:30 `db.json` yedeği, son 14 tutulur (`C:\ProgramData\EVCoPilotackup`) |
| `EVCoPilotWatchdog` (görev) | 5 dakikada bir sağlık denetimi; yanıt vermeyen hizmeti yeniden başlatır |

**Güvenlik tasarımı:** hizmetler `NT AUTHORITY\LocalService` (düşük yetkili) hesabıyla çalışır; yalnızca `server\` (okuma), `server\data` ve `C:\ProgramData\EVCoPilot` (yazma) klasörlerine erişir. `server\.env` yalnızca SYSTEM, yöneticiler, senin hesabın ve LocalService tarafından okunabilir. Güvenlik duvarında yalnızca `caddy.exe` için gelen TCP 443 açılır. Sarmalayıcı: NSSM (winget ile `NSSM.NSSM`; node ve caddy Windows hizmet protokolünü bilmediği için gerekir).

**Kurulum (yönetici PowerShell):**
```
powershell -ExecutionPolicy Bypass -File "D:\AI-Codes\Claude Code\MBRP\server\service\install-services.ps1" -DryRun
powershell -ExecutionPolicy Bypass -File "D:\AI-Codes\Claude Code\MBRP\server\service\install-services.ps1"
```
İlki hiçbir şeyi değiştirmeden ne yapılacağını yazar. İkincisi NSSM'i kurar, eski kullanıcı döngülerini kapatır, Caddy'yi ve Caddyfile'ı `C:\ProgramData\EVCoPilot\caddy` altına kopyalar (sertifikalar da taşınır), hizmetleri ve görevleri kurar, prizdeyken uykuyu kapatır, başlatır ve doğrular. Sunucuda kısa kesinti olur.

**Günlük işler:** durum `server\service\status.ps1` (normal PowerShell), kaldırmak `uninstall-services.ps1` (yönetici). Yeniden başlatmak: `Restart-Service EVCoPilotProxy` (yönetici). Günlükler `C:\ProgramData\EVCoPilot\logs` içinde (5 MB'ta döner). Google/Mapbox anahtarlarını `.env`'de değiştirince yalnızca proxy'yi yeniden başlat. `npm run apk` sunucuyu yeniden başlatmayı gerektirmez.

**Hâlâ bilgisayara bağlı olanlar (yazılım çözemez):** elektrik ve internet kesintisi (UPS önerilir), Windows güncellemesinin zorunlu yeniden başlatması (hizmetler kendiliğinden gelir), router'da bilgisayarın yerel adresinin sabitlenmesi (DHCP rezervasyonu) ve 443 yönlendirmesi, BIOS'ta "elektrik gelince aç" ayarı. Yedekleri başka bir diske/bilgisayara da kopyalamak için `install-services.ps1 -BackupDir "E:\EVCoPilotYedek"` kullan.

## Güncelleme: neyi nasıl yayınlarız
| Değişen | Ne yapılır | Kullanıcıya etkisi |
|---|---|---|
| **Web uygulaması** (arayüz, hesaplamalar, çeviriler; `index.html`, `js/`, `css/`) | `git push` (GitHub Pages kendiliğinden yayınlar, ~1-2 dk) | Tarayıcı/PWA kullananlarda açılışta "Güncelle" rozeti çıkar. APK'da gömülü kopya olduğu için APK'yı yenilemek gerekir (aşağıdaki satır). |
| **Android APK** (web kodu ya da Android izinleri/eklentileri değişti) | `npm.cmd run apk` → APK `server\public` içine konur | Kullanıcılar `https://evcopilot.duckdns.org/app` adresinden indirip üstüne kurar; hesapları ve ayarları korunur. |
| **Sunucu kodu** (`server\*.mjs`) | `node serverestart.mjs` (yönetici gerekmez) | Hizmet süreci kapanır, NSSM 5 sn içinde yeni kodla açar. Kullanıcılar birkaç saniye bağlantı hatası görebilir. |
| **Sunucu ayarı** (`server\.env`: anahtarlar, Google, kotalar) | `node serverestart.mjs` | Aynı. |
| **Caddyfile** | `C:\ProgramData\EVCoPilot\caddy\Caddyfile` dosyasını güncelle (repodaki kopya yalnızca ilk kurulumda taşınır), sonra yönetici PowerShell'de `Restart-Service EVCoPilotCaddy` | HTTPS kısa kesilir. |
| **Hizmet tanımı** (`server\service\install-services.ps1`) | Yönetici PowerShell'de betiği tekrar çalıştır (yeniden kurar, veriyi silmez) | Kısa kesinti. |

Sunucu kodu bu çalışma kopyasından (`D:\AI-Codes\Claude Code\MBRP\server`) çalıştığı için `git pull` ya da kopyalama gerekmez: dosya değişince yeniden başlatmak yeter. Sırayla tam yayın: `git push` (web) → `npm.cmd run apk` (APK) → `node serverestart.mjs` (sunucu).

## Canlı doluluk ve fiyat (`POST /v1/occupancy`)
Planlı duraklar için dolu/boş soket sayısı ve kWh fiyatı. Uygulama bunu 5 dakikada bir, yaklaşan ilk 2 durak için sorar (`routing/livePlan.js`).
- **Hollanda (NDW / DOT-NL, anahtarsız):** konum çevresindeki kayıtlar `.../charge-point-data/v1/features?bbox=...` GeoJSON'undan (OCPI Locations özeti: bağlayıcı türü başına `available/total`, `tariff_ids`) alınır; tarifeler ülke çapındaki OCPI 2.2.1 Tariffs dosyasından (~4 MB gz, 6 saatte bir) okunur. Tarife hesabı `server/occupancy.mjs` içindedir: her boyut (ENERGY, FLAT, TIME, PARKING_TIME) için sıradaki ilk uygun `TariffElement` (gün, saat aralığı, güç aralığı, başlangıç/bitiş tarihi koşulları; `min_kwh`/`min_duration` koşulları oturum başında geçerli sayılmaz), KDV dahil. Tarife dosyası ilk Hollanda isteğinde arka planda yüklenir (~500 MB bellek tepe noktası, birkaç saniye); fiyat ilk istekte olmayabilir.
- **Diğer ülkeler (Türkiye dahil), isteğe bağlı Google Places (Yeni):** `.env` içine `GOOGLE_PLACES_KEY`. Google Cloud'da **Places API (New)** etkinleştirilir, anahtar IP adresine (sunucunun genel adresi) ve yalnızca bu API'ye kısıtlanır, bütçe uyarısı kurulur. Çağrı `places:searchNearby` (alan maskesi `evChargeOptions`); sayım yoksa sonuç boş kalır. Her çağrı ücretlidir (Nearby Search ≈ 32-40 USD / 1000 çağrı; SKU'ya göre ayda 1000-5000 çağrı ücretsiz; EV alanının hangi katmanda faturalandığını Google Cloud > Faturalama > Raporlar'dan doğrula). Kullanıcı başına günlük 40 (`GOOGLE_DAILY_PER_USER`) ve tüm kullanıcılar için günlük 150 çağrı (`GOOGLE_DAILY_TOTAL`) tavanı vardır; sonuç 90 sn (sonuçsuzluk 5 dk) saklanır. Google Places EV fiyatı döndürmez: fiyat yalnızca NDW/OCPI kaynağından gelir.
- Kota: kullanıcı başına günde 600 doluluk isteği (`OCCUPANCY_DAILY_PER_USER`).
- Yeni ülke eklemek: `occupancy.mjs` içine aynı çıktı biçimiyle (`{ src, total, available, out, at, price }`) bir adaptör yazılır ve `lookupAll` içinde ülke kutusuna bağlanır. Avrupa'daki başka ulusal erişim noktaları (AFIR) OCPI ya da DATEX II sunar; erişim koşulları ülkeye göre değişir.

## Premium üyelik
Canlı doluluk ve canlı kWh fiyatı (`POST /v1/occupancy`) yalnızca Premium hesaplara açıktır; ücretsiz hesapta sunucu `402 premium_required` döndürür, uygulama ipucu gösterir. Yönetici hesapları (`ADMIN_EMAILS`) ve yönetici erişim kodu her zaman erişir.
- Kullanıcı kaydında `premiumUntil` (ms) tutulur; `/v1/me` ve giriş yanıtı `premium` ve `premiumUntil` döndürür. Uygulama açılışta, öne gelince (en çok 5 dk'da bir) ve her 30 dk'da planı tazeler.
- **Elle vermek:** `node server\premium.mjs ornek@gmail.com 30` (30 gün ekler, süre varsa üstüne); `... 0` kaldırır. Kullanıcı listesinde (`GET /admin/users`) `premiumUntil` görünür.
- `PREMIUM_REQUIRED=0` (`.env`): herkes Premium sayılır (deneme ya da herkese açma).
- **Ödeme (henüz yok):** abonelik sağlayıcısı (Play Faturalandırma, Stripe, iyzico vb.) bağlanınca ödeme webhook'u sunucuda `/admin/premium` ile aynı yetkilendirmeyi (`premiumUntil` = dönem sonu) yazar. Google Play'de sunulan dijital abonelikler Play Faturalandırma kullanmak zorundadır; web sürümü için ayrı sağlayıcı gerekir.

## Fiyat defteri ve Google kuralları (v0.68)
- **Google yalnızca pil < %25 iken** sorulur (`GOOGLE_SOC_BELOW`, varsayılan 25); uygulama pil yüzdesini isteğe ekler. NDW (Hollanda) ücretsiz olduğu için pilden bağımsız çalışır.
- **Bölge öğrenmesi:** Google bir bölgede (≈ 11 km) üst üste 3 kez EV verisi vermezse o bölge 7 gün atlanır. **Ölçüm (Kasım 2026):** Ankara, İstanbul, İzmir'de Google 30 istasyonu listeledi (ZES, Eşarj, Trugo, Tesla...) ama hiçbirinde soket sayısı/doluluk (`evChargeOptions`) yoktu; bu nedenle Türkiye'de Google'dan canlı doluluk beklenmemeli. Google Places EV **fiyatı** hiç döndürmez.
- **Fiyat defteri (`server/prices.mjs`, `data/db.json` içinde `prices`):** `POST /v1/price` (hesaplı kullanıcı, günde 20 bildirim) `{ lat, lon, kwh, currency }`. Konum ~100 m hücreye ayrılır; son 5 bildirimin (90 günden yeni) medyanı döner, `src: 'user'`. `/v1/occupancy` yanıtında canlı fiyat yoksa bu eklenir; doluluk de yoksa yalnızca fiyat döner. Uygulamada: Menzil sekmesi > Şarj oturumları > **Fiyat bildir**.

## Topluluk doluluğu (`server/community.mjs`)
Resmî canlı veri olmayan yerlerde (Türkiye) doluluğu kullanıcılar oluşturur. Konum ~100 m hücrelere ayrılır, komşu hücreler birlikte okunur.
- **Varlık:** `POST /v1/presence { lat, lon, state: 'start'|'stop' }` — uygulama, şarj oturumu algılandığında ve bittiğinde yalnızca eşleşen bilinen herkese açık istasyon konumuyla gönderir (ev/iş gibi kayıtsız yerler gönderilmez; Hesap kartından kapatılır). "Bitti" gelmezse kayıt 3 saatte düşer.
- **Dolu / Boş:** `POST /v1/status { lat, lon, status: 'full'|'free' }`; aynı kullanıcı aynı hücreye 10 dakikada bir, günde 30 bildirim. Bildirim 60 dakika geçerlidir; taze "Dolu" planda o durağa bekleme süresi ekler (20 dk).
- **Okuma:** `/v1/occupancy` yanıtında `community: { busy, report: { status, at } }` (Premium). Kullanıcı kimlikleri dışarı verilmez; hesap silinince fiyat ve topluluk bildirimleri de silinir.
- Yazmak her hesaba açık, okumak Premium.
