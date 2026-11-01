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
