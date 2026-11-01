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
