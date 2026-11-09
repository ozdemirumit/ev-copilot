# EV Route Finder ara sunucusu (isteğe bağlı)

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
3. Dene: `node server\proxy.mjs` → "EV Route Finder ara sunucusu 127.0.0.1:8787 …" yazmalı.
4. Açılışta otomatik başlasın: PowerShell'de `powershell -ExecutionPolicy Bypass -File server\install-task.ps1`. Bilgisayarda zamanlanmış görev için yönetici izni yoksa betik kendiliğinden Başlangıç klasörüne kısayol koyar (yönetici gerekmez). Günlük: `server\proxy.log` (adres, yol, durum; sorgu ve anahtar yazılmaz).

## İnternete açmak: Cloudflare Tunnel (önerilen)
Statik IP ve router port yönlendirmesi gerekmez; bilgisayarın portu internete açılmaz, HTTPS Cloudflare'dan gelir.
1. Cloudflare hesabı + bir alan adı (Cloudflare'a bağlı).
2. Zero Trust > Networks > Tunnels > Create tunnel (cloudflared). Windows için verilen kurulum komutunu çalıştır (servis olarak kurulur).
3. Public hostname ekle: örn. `ev.alanadin.com` → Service: `http://127.0.0.1:8787`.
4. `server\.env` içinde `TRUST_PROXY=1` ve `TRUST_CF_HEADER=1` olsun (yoksa tüm istekler tek adres sayılır, istek sınırı ve yanlış kod engeli herkesi etkiler). `TRUST_CF_HEADER=1` gerçek istemci adresini `CF-Connecting-IP`'den okutur; bunu YALNIZCA Cloudflare Tunnel'da yaz (Caddy gibi bir vekil bu başlığı istemciden olduğu gibi geçirir, sahte adresle sınırlardan kaçılır).
5. Uygulamada Daha Fazla > Veri kaynakları: **Ara sunucu adresi** `https://ev.alanadin.com`, **erişim kodu** `.env`'deki kod → Kaydet ve sına.

### Cloudflare şart değil
Amaç bilgisayarı HTTPS ile internetten erişilir yapmak. Seçenekler:
- **Cloudflare Tunnel** (yukarıdaki): en kolayı; alan adı gerekir (ucuz bir alan adı yeter).
- **Tailscale Funnel**: alan adı gerekmez, `https://makine.tailnet.ts.net` adresi verir; bilgisayara Tailscale kurulur. Ücretsiz plan yeterli.
- **Statik IP + port yönlendirme + Caddy**: alan adını statik IP'ye yönlendirirsin (A kaydı), Caddy `reverse_proxy 127.0.0.1:8787` ile sertifikayı kendi alır. Router'da 443 → bu bilgisayar; Windows güvenlik duvarında yalnızca Caddy'ye izin. Operatör CGNAT yapıyorsa çalışmaz. Caddy ile yalnızca `TRUST_PROXY=1` yaz (`TRUST_CF_HEADER` YAZMA) ve Caddy'nin `X-Forwarded-For` göndermesi gerekir (Caddy varsayılan olarak gönderir; istemcinin gönderdiğini kendi gördüğü adresle değiştirir). Sunucu zincirin SON adresini kullanır.
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

## Yönetim ekranı: ikinci adım (TOTP, Microsoft Authenticator)
İsteğe bağlıdır. `server\.env` içinde `ADMIN_TOTP_SECRET` yoksa (ya da geçersizse) yönetim ekranı ve `/admin/*` eskisi gibi yalnızca erişim koduyla çalışır.

**Kurulum (bir kez, kendi terminalinde):**
1. `node server\totp-setup.mjs` → 20 baytlık rastgele bir anahtar üretir, `server\.env` içine `ADMIN_TOTP_SECRET=...` yazar (diğer satırlara dokunmaz, erişim kodlarını ekrana yazmaz; önce `server\.env.totp-yedek` yedeğini alır, Windows'ta yalnızca SYSTEM/Yöneticiler/sen okuyabilir) ve anahtarı **yalnızca o an** ekrana yazar. Zaten anahtar varsa `--force` olmadan üzerine yazmaz.
2. Microsoft Authenticator: **+ (Hesap ekle) > Diğer hesap (Google, Facebook vb.) > "Kodu el ile gir"** → Hesap adı `EV Route Finder Yönetim`, Gizli anahtar: ekrandaki 4'lü gruplar (boşluklu ya da boşluksuz). Betik ayrıca `otpauth://` adresini yazar (başka doğrulayıcılar için); QR üretmek için bir web sitesine yapıştırma, anahtar sızar.
3. `node server\restart.mjs` → açılış satırında "yönetim 2. adım: TOTP açık" yazar.

**Giriş:** `/yonetim` sayfası açılışta `GET /admin/auth` (`{ totp: true|false }`, gizli bilgi yok) sorar; TOTP açıksa erişim kodunun yanında "Doğrulama kodu (6 hane)" alanı çıkar. Sayfa `POST /admin/login { code, totp }` ile giriş yapar; dönen `{ token, expiresAt }` belirteci yalnızca o sekmede (`sessionStorage`) tutulur ve her istekte `X-Admin-Token` başlığıyla gider. Erişim kodu sayfada saklanmaz. Belirteç **12 saat** geçerlidir (`ADMIN_TOKEN_TTL_SEC` ile kısaltılabilir, uzatılamaz); sunucuda yalnızca SHA-256 özeti bellekte durur (en çok 20 canlı oturum; sunucu yeniden başlarsa herkes çıkar). Süre dolunca sayfa "Oturum süresi doldu, tekrar giriş yap" der. Çıkış düğmesi `POST /admin/logout` ile belirteci sunucuda da siler.
- **Her yerden çıkış** (ör. belirteç çalındı sanıyorsan): bu bilgisayarda `POST /admin/logout?all=1` tüm oturumları siler (yalnızca yerel istek; dışarıdan `403`). PowerShell: `curl.exe -X POST -H "X-Access-Code: <kod>" "http://127.0.0.1:8787/admin/logout?all=1"` (kod komut geçmişinde kalır; istersen sonra geçmişi temizle). `node server\restart.mjs` de herkesi çıkarır.
- Kod: RFC 6238 (HMAC-SHA1, 6 hane, 30 sn), ±1 adım saat kayması tolere edilir, karşılaştırmalar sabit sürelidir. **Her kod bir kez kullanılır:** başarılı girişte kullanılan adımın (ve öncekilerin) kodu bir daha kabul edilmez; aynı 30 sn içinde ikinci giriş için yeni kodu bekle.
- Yanlış girişte hangi adımın yanlış olduğu söylenmez (`401 {"error":"kod yanlış"}`). **Kilit:** aynı adresten 5 yanlış → o adrese 1 saat `429`; erişim kodu DOĞRU ama doğrulama kodu yanlış denemeler tüm adreslerden 10 dk içinde 25'e ulaşırsa giriş uç noktası herkese 10 dk `429` (`Retry-After` ile). Yanlış erişim kodlu denemeler yalnızca adres kilidine sayılır (kodu bilmeyen biri çok adresten deneyerek senin girişini kilitleyemez). Kilit gövde okunduktan sonra yeniden denetlenir (yavaş gövdeli eşzamanlı isteklerle aşılamaz). Bir kilit açılınca günlüğe tek satır yazılır: `admin giriş kilidi: ip <adres> (1 sa)` ya da `admin giriş kilidi: global (10 dk)`. Bu kilit eski "10 yanlış kodda 10 dk" kilidinden ayrıdır ve yalnızca `/admin/login` için geçerlidir. Gövde en çok 1 KB; bozuk JSON `400`.
- TOTP açıkken `/admin/*` yolları (`/admin/auth` ve `/admin/login` dışında) yalnızca şunlarla açılır: geçerli `X-Admin-Token`, **yönetici Google hesabı** (`ADMIN_EMAILS`, eskisi gibi) ya da **yerel istek**. Dışarıdan yalnızca `X-Access-Code` ile gelen yönetim isteği `401 {"error":"totp_required"}` alır. Erişim kodu uygulama yollarında (`/health`, `/v1/*`, `/mapbox/*` …) eskisi gibi çalışır.
- **Yerel istek (komut satırı muafiyeti):** soket adresi 127.0.0.1/::1 VE hiçbir vekil başlığı (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`, `CF-Connecting-IP`, `Via`, `X-Forwarded-Host`, `X-Forwarded-Proto`) yoksa. Caddy (ve cloudflared) her dış isteğe `X-Forwarded-For` ekler, bu yüzden dışarıdan gelen istek hiçbir zaman yerel sayılmaz. Bu bilgisayardaki `premium.mjs`, `restart.mjs`, `invite.mjs` değişmeden çalışır. Muafiyet aynı makinedeki TCP düzeyinde yönlendiricilere de güvenir: `netsh interface portproxy`, `ssh -L`, katman 4 (TCP) vekili ya da Caddy'de `header_up -X-Forwarded-For` gibi başlığı silen bir ayar dış isteği yerel gösterir; bunları kurma.
- Anahtar, kodlar ve belirteçler günlüğe yazılmaz; istek günlüğü yalnızca adres, yöntem, yol, durum ve süreyi yazar.
- Son kullanılan kodun adımı `DATA_DIR\totp-last.json` dosyasına yazılır (yalnızca adım numarası, gizli değil): yeniden başlatmadan sonra da aynı kod ikinci kez kabul edilmez. Dosya yoksa ya da bozuksa sunucu yine açılır.
- TOTP yalnızca `/admin/*` yollarını korur; erişim kodu uygulama yollarında (`/health`, `/v1/*`, `/mapbox/*` …) tek başına geçerli kalır.

**Telefonu kaybedersen / kapatmak için:** `server\.env` içindeki `ADMIN_TOTP_SECRET` satırını sil (ya da değerini boşalt) ve `node server\restart.mjs` çalıştır: yönetim ekranı yeniden yalnızca erişim koduyla açılır. Yeni telefonla yeniden açmak için `node server\totp-setup.mjs --force` (eski kayıt çalışmaz olur). Anahtar sızdıysa aynı şekilde `--force` ile yenile; erişim kodu da sızdıysa `ACCESS_CODES`'u da değiştir.

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
| **Sunucu kodu** (`server\*.mjs`) | `node server
estart.mjs` (yönetici gerekmez) | Hizmet süreci kapanır, NSSM 5 sn içinde yeni kodla açar. Kullanıcılar birkaç saniye bağlantı hatası görebilir. |
| **Sunucu ayarı** (`server\.env`: anahtarlar, Google, kotalar) | `node server
estart.mjs` | Aynı. |
| **Caddyfile** | `C:\ProgramData\EVCoPilot\caddy\Caddyfile` dosyasını güncelle (repodaki kopya yalnızca ilk kurulumda taşınır), sonra yönetici PowerShell'de `Restart-Service EVCoPilotCaddy` | HTTPS kısa kesilir. |
| **Hizmet tanımı** (`server\service\install-services.ps1`) | Yönetici PowerShell'de betiği tekrar çalıştır (yeniden kurar, veriyi silmez) | Kısa kesinti. |

Sunucu kodu bu çalışma kopyasından (`D:\AI-Codes\Claude Code\MBRP\server`) çalıştığı için `git pull` ya da kopyalama gerekmez: dosya değişince yeniden başlatmak yeter. Sırayla tam yayın: `git push` (web) → `npm.cmd run apk` (APK) → `node server
estart.mjs` (sunucu).

## Canlı doluluk ve fiyat (`POST /v1/occupancy`)
Planlı duraklar için dolu/boş soket sayısı ve kWh fiyatı. Uygulama bunu 5 dakikada bir, yaklaşan ilk 2 durak için sorar (`routing/livePlan.js`).
- **Hollanda (NDW / DOT-NL, anahtarsız):** konum çevresindeki kayıtlar `.../charge-point-data/v1/features?bbox=...` GeoJSON'undan (OCPI Locations özeti: bağlayıcı türü başına `available/total`, `tariff_ids`) alınır; tarifeler ülke çapındaki OCPI 2.2.1 Tariffs dosyasından (~4 MB gz, 6 saatte bir) okunur. Tarife hesabı `server/occupancy.mjs` içindedir: her boyut (ENERGY, FLAT, TIME, PARKING_TIME) için sıradaki ilk uygun `TariffElement` (gün, saat aralığı, güç aralığı, başlangıç/bitiş tarihi koşulları; `min_kwh`/`min_duration` koşulları oturum başında geçerli sayılmaz), KDV dahil. Tarife dosyası ilk Hollanda isteğinde arka planda yüklenir (~500 MB bellek tepe noktası, birkaç saniye); fiyat ilk istekte olmayabilir.
- **Türkiye ve diğer ülkeler, isteğe bağlı TomTom:** `.env` içine `TOMTOM_KEY` (Search API + EV Charging Stations Availability API açık olmalı). Sorgu sırası NDW → HERE → **TomTom** → Google. İki adım: istasyonun ≤150 m çevresinde EV araması (doluluk kimliği 24 saat saklanır), sonra kimlikle canlı soket durumu (boş/dolu/arızalı). Ölçüm (Ankara, İstanbul, İzmir): istasyonların ~%30'unda canlı kimlik var; ZES, Trugo, Eşarj, WAT Mobilite, Sharz, En Yakıt, Zeplin, 5 Şarj verdi. Fiyat dönmez (operatör tablosu/topluluk fiyatı kullanılır), yanıtta güncellenme zamanı yoktur (zaman okuma anıdır). Günlük tavan `TOMTOM_DAILY_CAP` (varsayılan 2000, ücretsiz plan 2.500). Anahtarı değiştirince sunucuyu yeniden başlat (`node server/restart.mjs`).
- **Diğer ülkeler (Türkiye dahil), isteğe bağlı Google Places (Yeni):** `.env` içine `GOOGLE_PLACES_KEY`. Google Cloud'da **Places API (New)** etkinleştirilir, anahtar IP adresine (sunucunun genel adresi) ve yalnızca bu API'ye kısıtlanır, bütçe uyarısı kurulur. Çağrı `places:searchNearby` (alan maskesi `evChargeOptions`); sayım yoksa sonuç boş kalır. Her çağrı ücretlidir (Nearby Search ≈ 32-40 USD / 1000 çağrı; SKU'ya göre ayda 1000-5000 çağrı ücretsiz; EV alanının hangi katmanda faturalandığını Google Cloud > Faturalama > Raporlar'dan doğrula). Kullanıcı başına günlük 40 (`GOOGLE_DAILY_PER_USER`) ve tüm kullanıcılar için günlük 150 çağrı (`GOOGLE_DAILY_TOTAL`) tavanı vardır; sonuç 90 sn (sonuçsuzluk 5 dk) saklanır. Google Places EV fiyatı döndürmez: fiyat yalnızca NDW/OCPI kaynağından gelir.
- Kota: kullanıcı başına günde 600 doluluk isteği (`OCCUPANCY_DAILY_PER_USER`).
- Yeni ülke eklemek: `occupancy.mjs` içine aynı çıktı biçimiyle (`{ src, total, available, out, at, price }`) bir adaptör yazılır ve `lookupAll` içinde ülke kutusuna bağlanır. Avrupa'daki başka ulusal erişim noktaları (AFIR) OCPI ya da DATEX II sunar; erişim koşulları ülkeye göre değişir.

## Harita sağlayıcısı (`GET /v1/map/config`)
Haritayı herkes için OpenFreeMap (anahtarsız) çizer. Premium hesaplar için yönetici isteğe bağlı olarak Mapbox ya da Google Maps seçebilir; seçim sunucuda tutulur (`db.json`: varsayılan `settings.mapDefault`, kullanıcı başına `mapProvider`), uygulama yalnızca sağlayıcı ADINI saklar.
- **İki anahtar (`.env`):** `MAPBOX_MAP_TOKEN` (herkese açık `pk.` belirteci; `sk.` gizli belirteç kabul edilmez, yapılandırılmamış sayılır) ve `GOOGLE_MAPS_BROWSER_KEY` (Maps JavaScript API; isteğe bağlı `GOOGLE_MAP_ID`). Bunlar tarayıcıya gider, bu yüzden sunucu içi `MAPBOX_TOKEN` ve `GOOGLE_PLACES_KEY` ile **ayrı anahtarlar** kullan. Anahtar yoksa o sağlayıcı seçilemez ve her şey bugünkü gibi çalışır.
- **Kısıtlar (sahibi yapar):** iki anahtarı da kendi panelinde uygulamanın adresine kısıtla: `https://ozdemirumit.github.io/*` (Mapbox: belirteç URL kısıtı olarak `https://ozdemirumit.github.io` YOL OLMADAN yaz; tarayıcı başka bir siteye yalnızca adresin kökünü gönderdiği için `/ev-copilot` gibi bir yol yazarsan Mapbox döşemeleri 403 verir ve harita OpenFreeMap'e düşer. Google: HTTP yönlendiren kısıtı + yalnızca Maps JavaScript API). Sunucu bunu yapamaz; kısıtsız anahtar çalınıp başka sitede kullanılabilir.
- **Google ön koşulu:** anahtarın Google Cloud projesinde Google Maps Platform **faturalandırması etkin** olmalı ve **Maps JavaScript API** etkinleştirilmeli; değilse Google anahtarı reddeder ve harita kendiliğinden OpenFreeMap'e döner.
- **Google 3B (navigasyon):** 3B/2B düğmesi Google'da haritayı eğer; bunun için harita kimliği **Vector** olmalı ve **Tilt and rotation** açık olmalı (boş bırakırsan deneme kimliği `DEMO_MAP_ID` kullanılır, o da çalışır). Binaları Google kendisi çizer (bölgeye ve yakınlaştırmaya göre); fotogerçekçi şehir modeli (Photorealistic 3D Tiles) ayrı bir hizmettir ve şimdilik yoktur.
- **Google kotası:** Google Cloud'da Maps JavaScript API için **günlük kota sınırı** koy ve bütçe uyarısı kur (fatura üst sınırı).
- **Uç noktalar:** `GET /v1/map/config` (kimlik şart) osm için `{provider:'osm'}`; Premium'a seçili sağlayıcının anahtarını döner (`Cache-Control: no-store`). Premium olmayan hesap ve anonim cihaz anahtar ALAMAZ; anahtarı kalkmış sağlayıcı sessizce osm'ye düşer. Yönetici: `GET/POST /admin/map` (`{default}`), `POST /admin/users/:id/map` (`{provider: 'osm'|'mapbox'|'google'|null}`, null = varsayılanı izle); `/admin/summary` yalnızca anahtarın tanımlı olup olmadığını (`configured.mapboxMap`, `configured.googleMap`) ve `map.default`'u gösterir, anahtar değerini asla.
- **Günlük hak:** yalnızca anahtar dönen çağrılar sayılır (osm sayılmaz): kullanıcı başına `MAP_DAILY_PER_USER` (varsayılan 100), tüm kullanıcılar için `MAP_DAILY_TOTAL` (varsayılan 3000, sunucu yeniden başlayınca sıfırlanır); aşılırsa `429 günlük harita hakkı doldu`, uygulama OpenFreeMap'e döner. Yönetici ve eski erişim kodu kullanıcı başı sınırdan muaftır, toplam tavana tabidir.
- Anahtarlar `scrub` kapsamındadır (üst sunucu yanıtlarında ve hata günlüğünde `***` olur).

## Premium yol hız limiti (`POST /v1/speedlimits`)
Navigasyonda yol hız limiti Premium hesaplarda önce HERE'den gelir (güncel, şehir içi dahil); HERE'nin bilmediği yerde Mapbox rotasının `maxspeed` ek açıklaması, o da yoksa bugünkü OpenStreetMap sorgusu (Valhalla) kullanılır; hiçbiri bilmiyorsa uygulama tahmin yapmaz, kullanıcının hız eşiği geçerlidir. Ücretsiz hesapta değişiklik yok (yalnızca OpenStreetMap).
- **İstek:** uygulama navigasyon başlayınca (rota planlarken DEĞİL) ve her yeniden rotada bir kez gövde `{ points: [{lat, lon}, ...] }` yollar: 2..60 nokta, rotadan mesafeye göre eşit aralıklı (ilk = başlangıç, son = varış). Sayı/aralık denetimi, 6 KB gövde sınırı, toplam büyük daire uzunluğu ≤ 2000 km ve komşu iki nokta arası ≤ 300 km; değilse `400`.
- **HERE çağrısı:** Routing v8 `https://router.hereapi.com/v8/routes?transportMode=car&origin=..&destination=..&via=lat,lon!passThrough=true ...&return=polyline&spans=maxSpeed,length`; ara noktalar `passThrough` olduğu için durak/manevra oluşmaz, HERE'nin yolu uygulamanın rotasını izler. Tek istek yeter (ölçüldü: 100 ara nokta sorunsuz, 200'de adres çok uzun, HTTP 414). Anahtarın projesinde **Routing v8 izinli olmalı**.
- **Yanıt:** `{ v: 1, s: [[lat1, lon1, lat2, lon2, kph], ...] }` (5 basamak). HERE `maxSpeed` m/s → km/s yuvarlanır; yalnızca 5..150 kabul (82 gibi tek sayılı limitler geçerli); limitsiz kesim yazılmaz, bitişik eşit limitler yol şekli 10 m içinde kalacak biçimde birleşir. Esnek çoklu çizgi (flexible polyline) çözücüsü `server/speedlimits.mjs` içindedir.
- **Sınırlar:** yalnızca Premium (değilse `402 premium_required`); anahtar yoksa `501`. HERE **aylık sayacı istasyon aramasıyla ortaktır** (`HERE_MONTHLY_CAP`, dolunca `402 here_cap`); kullanıcı başına günlük `SPEEDLIMIT_DAILY_PER_USER` (varsayılan 40, aşılırsa `429`; yönetici ve eski erişim kodu muaf). Sonuç 24 saat bellek önbelleğinde (en çok 100 rota, toplam 32 MB); boş sonuç (`s: []`) ve 512 KB'tan büyük sonuç önbelleğe alınmaz; önbellekten dönen yanıt sayaçtan ve haktan düşmez. HERE yanıtı 4 MB'tan büyükse okunmaz (Content-Length ya da okuma sınırı). HERE hatası `502` (genel ileti; anahtar ve HERE yanıtı ne istemciye ne günlüğe yazılır). Deneme adresi `HERE_ROUTER_BASE` yalnızca https ya da `127.0.0.1`/`localhost`'a http kabul eder, başka değer yok sayılır.
- **Mapbox maxspeed:** uygulama Mapbox rotasında `maxspeed` ek açıklamasını yalnızca Premium'da (`premiumAccess()`: plan Premium ya da eski yönetici kodu) ister; ücretsiz kullanıcının Mapbox isteği ve rota sonucu v0.81 ile aynıdır, rota önbelleği plana göre ayrıdır.
- **Uygulama tarafı:** `js/nav/limitSpans.js` kesimleri tutar ve her 3 sn konuma göre (≤ 40 m, gidiş yönüyle uyumlu kesim) ağ isteği olmadan okur; hata ya da `402/429` olursa sessizce sonraki kaynağa geçer, `402/429` sonrası bir saat yeni rota için de sormaz (döngü yok). Durum satırı kaynağı gösterir ("Kaynak: HERE / Mapbox / OpenStreetMap").

## Premium üyelik
Canlı doluluk ve canlı kWh fiyatı (`POST /v1/occupancy`) yalnızca Premium hesaplara açıktır; ücretsiz hesapta sunucu `402 premium_required` döndürür, uygulama ipucu gösterir. Yönetici hesapları (`ADMIN_EMAILS`) ve yönetici erişim kodu her zaman erişir.
- Kullanıcı kaydında `premiumUntil` (ms) tutulur; `/v1/me` ve giriş yanıtı `premium` ve `premiumUntil` döndürür. Uygulama açılışta, öne gelince (en çok 5 dk'da bir) ve her 30 dk'da planı tazeler.
- **Yönetim paneli:** `/yonetim` (statik sayfa; veriler `/admin/*` ile yönetici kodu ya da yönetici hesabıyla gelir, yanlış kod denemeleri sınırlıdır). Özet (`GET /admin/summary`: kullanıcı/davet sayıları, bugünkü çağrılar, Google kotası ve maliyeti, yapılandırma durumu; anahtar değerleri yok), Kullanıcılar, Davetler ve Maliyet sekmeleri. Komut satırı karşılığı: `node server\premium.mjs list|costs`.
- **Sağlayıcı istek sayaçları:** sunucu, sağlayıcıya GERÇEKTEN giden her isteği kişi başına gün gün sayar (`db.json` > `costs`, en çok 400 gün; önbellekten dönen, kota/kimlik nedeniyle reddedilen istek sayılmaz; yönetici hesapları ve yönetici kodu da sayılır, kodlu istekler "yönetici kodu" satırında). Zamanlama: istek GÖNDERİLİRKEN sayılır, yani hata/zaman aşımı da sayılır (HERE aylık sayacı gibi); doluluk sorgusundaki HERE ve Google çağrıları ise yalnızca başarılı yanıttan sonra sayılır. Overpass istemci isteği başına bir kez sayılır (birden çok ayna denense de). Türler: `google` (Places doluluk, tahmini USD yalnızca bunun için), `here` (panelde "HERE (istasyon + doluluk)": istasyon araması ve doluluk sorgusu), `slimit` (HERE hız limiti), `mapbox` (Mapbox rota/arama vekili), `ocm`, `overpass`, `map_mapbox` / `map_google` (`/v1/map/config` harita **anahtarı verme**). **Anahtar verme ≠ gerçek harita yüklemesi:** harita döşemeleri tarayıcıdan doğrudan Mapbox/Google'a gider, sunucu göremez; gerçek yükleme sayısı ve tutarı sağlayıcı panellerindedir. Özet'te "Sağlayıcı istekleri (sunucu sayacı)" kartları (bugün / bu ay / toplam) ve "Kullanıcı başına bugünkü istekler" tablosu (bellek içi kota sayacı: reddedilen denemeler ve sağlayıcı dışı türler de sayılır, yeniden başlatınca sıfırlanır; artık yöneticileri de sayar, sınırlamaz), Maliyet sekmesinde tür başına kişi tablosu, TOPLAM satırı ve CSV (UTF-8 BOM, tırnaklı hücreler, formül enjeksiyonuna karşı `=`/`+`/`-`/`@` ile başlayan metne `'` eklenir). API: `GET /admin/costs` eski alanlara ek `kinds`, `totals`, `rows[].usage`; `GET /admin/summary` ek `providers`, `usageByUser`. Hesap silinince sayılar anonim `_silinen` kovasına eklenir.
- **Giriş onay kodu:** uygulama girişi başlatınca ekranda 4 haneli bir kod gösterir (nonce'tan türetilir, `loginCode`). Google'dan dönülünce hesap hemen açılmaz; tarayıcıda kod istenir (`/auth/confirm`), doğru girilince davet kullanılır, hesap açılır ve oturum uygulamaya iletilir. 5 yanlış denemede giriş iptal olur. Amaç: başkasının başlattığı girişe habersizce onay verip oturumu ona kaptırmamak.
- **Cihaz kimliği (anonim kullanıcı):** uygulama giriş yapmamış her cihaza rastgele bir kimlik (`d_...`) verir ve `X-Device-Id` başlığında yollar (açılışta `GET /v1/config?v=&p=` ile en çok 6 saatte bir uğrar). Sunucu cihazı sayar (ilk/son görülme, açılış, etkin gün, sürüm, apk/web; IP saklanmaz), genel yollarda istek sınırını IP'ye ek olarak cihaza da uygular, adres başına saatte en çok 20 yeni cihaz kaydı açar. Kullanıcı giriş yapınca (`/v1/auth/poll`) ya da oturumlu bir istek aynı başlıkla gelince cihaz hesaba bağlanır ve anonim sayılmaz; hesap silinince bağlı cihaz kayıtları silinir. Panelde Cihazlar sekmesi, `GET /admin/devices`.
- **Davetler:** panel (`/yonetim` > Davetler) ya da `POST /admin/invites { email?, label, days, premiumDays?, send? }`. `email` verilirse davet yalnızca o Google hesabıyla kullanılabilir (`invite_email` hatası), `premiumDays` ilk girişte Premium süresi başlatır. `send: true` ve `SMTP_USER`/`SMTP_PASS` varsa davet e-postası `mailer.mjs` (Gmail SMTP, doğrudan TLS 465, uygulama şifresi) ile gönderilir; hata olursa davet yine üretilir ve link panelde görünür. Panel aynı kökenden (PUBLIC_URL) istek yaptığı için köken izin listesine PUBLIC_URL otomatik eklenir. Premium: `POST /admin/premium { userId|email, days | until }` (`until` kesin bitiş, geçmişse kaldırır).
- **Google maliyet kaydı:** her başarılı Google Places çağrısı çağrıyı yapan kullanıcıya gün gün yazılır (`costs.mjs`, `db.json` içinde `costs`; günlük yedeklere girer, 400 gün tutulur). Tahmini tutar = çağrı × `GOOGLE_COST_PER_CALL_USD` (varsayılan 0.04). Hesap silinince kişiye bağlı kayıt silinir, toplamlar anonim `_silinen` kovasına eklenir. Asıl fatura Google Cloud Billing'dedir.
- **Tahmini maliyet (tüm ücretli sağlayıcılar):** Yönetim > Özet ve Maliyet sekmelerinde "Tahmini maliyet" tablosu. Sayaçlar `costs.mjs`'teki türlerdir (`google`, `here`, `slimit`, `mapbox` = rota, `mapbox_search` = istasyon araması, `map_mapbox`, `map_google`). Tutar = istek × birim fiyat, **ücretsiz aylık kota hesap geneli ay ay düşülerek** (`costs.estimate()`); kişi başına yalnızca brüt (kotasız) gösterilir. Varsayılan fiyat ve kotalar `RATES`'te (Mapbox harita 50.000 / 5 USD, Mapbox rota 100.000 / 2 USD, Mapbox arama 25.000 / 1,7 USD, Google harita 10.000 / 7 USD, Google Places 1000 / 40 USD, HERE 30.000 / 0,75 USD); HERE ve Mapbox arama rakamları doğrulanmadı, `.env`'de `COST_<TÜR>_PER_1K_USD` ve `COST_<TÜR>_FREE_MONTHLY` ile değiştirilir (`.env.example`). Harita türleri anahtar vermeyi sayar, gerçek yüklemeyi değil; `mapbox` türünün eski kayıtları aramayı da içerir (rota fiyatıyla hesaplanır). Bu bir tahmindir, asıl fatura sağlayıcı panellerindedir.
- **Elle vermek:** `node server\premium.mjs ornek@gmail.com 30` (30 gün ekler, süre varsa üstüne); `... 0` kaldırır. Kullanıcı listesinde (`GET /admin/users`) `premiumUntil` görünür.
- `PREMIUM_REQUIRED=0` (`.env`): herkes Premium sayılır (deneme ya da herkese açma).
- **Ödeme (henüz yok):** abonelik sağlayıcısı (Play Faturalandırma, Stripe, iyzico vb.) bağlanınca ödeme webhook'u sunucuda `/admin/premium` ile aynı yetkilendirmeyi (`premiumUntil` = dönem sonu) yazar. Google Play'de sunulan dijital abonelikler Play Faturalandırma kullanmak zorundadır; web sürümü için ayrı sağlayıcı gerekir.

## Fiyat defteri ve Google kuralları (v0.68)
- **Google Places kuralları (Places API Policies, doğrulandı 01.11.2026):** Google içeriği Google haritası dışında bir haritada gösterilemez; harita olmayan listede gösterilecekse "Google Maps" adı/logosu görünür olmalı; yer kimliği (place ID) dışında içerik saklanamaz. Uygulama buna göre: Google kaynaklı doluluk yalnızca listelerde (istasyon listesi, plan durakları, düşük pil uyarısı) "Google Maps" etiketiyle gösterilir, harita iğnesi kartında gösterilmez; sunucu Google sonuçlarını önbelleğe almaz (her istek yeniden sorar, kota ve bütçe tavanı bu yüzden önemli); veritabanına yalnızca çağrı sayısı yazılır. EV alanı (`evChargeOptions`) Enterprise + Atmosphere katmanında (~40 USD/1000 çağrı, ayda ilk 1000 ücretsiz). Places API'de EV kWh fiyatı alanı yok: Google'dan fiyat okunamaz, fiyat NDW, kullanıcı bildirimleri ve işletmeci tablosundan gelir.
- **Google yalnızca pil < %25 iken** sorulur (`GOOGLE_SOC_BELOW`, varsayılan 25); uygulama pil yüzdesini isteğe ekler. NDW (Hollanda) ücretsiz olduğu için pilden bağımsız çalışır.
- **Bölge öğrenmesi:** Google bir bölgede (≈ 11 km) üst üste 3 kez EV verisi vermezse o bölge 7 gün atlanır. **Ölçüm (Kasım 2026):** Ankara, İstanbul, İzmir'de Google 30 istasyonu listeledi (ZES, Eşarj, Trugo, Tesla...) ama hiçbirinde soket sayısı/doluluk (`evChargeOptions`) yoktu; bu nedenle Türkiye'de Google'dan canlı doluluk beklenmemeli. Google Places EV **fiyatı** hiç döndürmez.
- **Fiyat defteri (`server/prices.mjs`, `data/db.json` içinde `prices`):** `POST /v1/price` (hesaplı kullanıcı, günde 20 bildirim) `{ lat, lon, kwh, currency }`. Konum ~100 m hücreye ayrılır; son 5 bildirimin (90 günden yeni) medyanı döner, `src: 'user'`. `/v1/occupancy` yanıtında canlı fiyat yoksa bu eklenir; doluluk de yoksa yalnızca fiyat döner. Uygulamada: Menzil sekmesi > Şarj oturumları > **Fiyat bildir**.

## Topluluk doluluğu (`server/community.mjs`)
Resmî canlı veri olmayan yerlerde (Türkiye) doluluğu kullanıcılar oluşturur. Konum ~100 m hücrelere ayrılır, komşu hücreler birlikte okunur.
- **Varlık:** `POST /v1/presence { lat, lon, state: 'start'|'stop' }` — uygulama, şarj oturumu algılandığında ve bittiğinde yalnızca eşleşen bilinen herkese açık istasyon konumuyla gönderir (ev/iş gibi kayıtsız yerler gönderilmez; Hesap kartından kapatılır). "Bitti" gelmezse kayıt 3 saatte düşer.
- **Dolu / Boş:** `POST /v1/status { lat, lon, status: 'full'|'free' }`; aynı kullanıcı aynı hücreye 10 dakikada bir, günde 30 bildirim. Bildirim 60 dakika geçerlidir; taze "Dolu" planda o durağa bekleme süresi ekler (20 dk).
- **Okuma:** `/v1/occupancy` yanıtında `community: { busy, report: { status, at } }` (Premium). Kullanıcı kimlikleri dışarı verilmez; hesap silinince fiyat ve topluluk bildirimleri de silinir.
- Yazmak her hesaba açık, okumak Premium.
