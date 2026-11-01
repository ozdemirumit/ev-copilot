# EV Co-Pilot: komutlar

Hepsi **PowerShell**'de, proje klasöründen çalışır (aksi yazılmadıkça yönetici gerekmez):

```powershell
cd 'D:\AI-Codes\Claude Code\MBRP'
```

> `npm` komutu PowerShell betik politikasına takılırsa `npm.cmd` yaz (ör. `npm.cmd run apk`).
> Gerçek anahtarlar yalnızca `server\.env` içindedir; bu dosya repoya girmez, kimseye gönderme.

## 1. Sunucu (Windows hizmetleri)

| Ne | Komut |
|---|---|
| Durum (hizmetler, yanıtlar, son günlük satırları, yedek) | `powershell -ExecutionPolicy Bypass -File server\service\status.ps1` |
| Sunucuyu yeniden başlat (kod ya da `.env` değişince; **yönetici gerekmez**) | `node server\restart.mjs` |
| Hızlı sağlık denetimi | `curl.exe -s https://evcopilot.duckdns.org/v1/config` |
| Hizmetleri listele | `Get-Service EVCoPilot*` |
| Hizmeti durdur / başlat / yeniden başlat (**yönetici**) | `Stop-Service EVCoPilotProxy` · `Start-Service EVCoPilotProxy` · `Restart-Service EVCoPilotProxy` (HTTPS için `EVCoPilotCaddy`) |
| Hizmetleri kur / güncelle (**yönetici**) | `powershell -ExecutionPolicy Bypass -File server\service\install-services.ps1` (önce `-DryRun` ile dene) |
| Hizmetleri kaldır (**yönetici**, veri silinmez) | `powershell -ExecutionPolicy Bypass -File server\service\uninstall-services.ps1` |
| Veriyi elle yedekle | `powershell -ExecutionPolicy Bypass -File server\service\backup.ps1` |

Hizmetler: `EVCoPilotProxy` (node, 127.0.0.1:8787), `EVCoPilotCaddy` (HTTPS, :443); görevler: `EVCoPilotBackup` (her gün 03:30), `EVCoPilotWatchdog` (5 dakikada bir sağlık denetimi).

**Günlükler** (`C:\ProgramData\EVCoPilot\logs`):
```powershell
Get-Content C:\ProgramData\EVCoPilot\logs\proxy.out.log -Tail 50     # istekler
Get-Content C:\ProgramData\EVCoPilot\logs\proxy.err.log -Tail 50     # hatalar (ör. Google girişi nedeni)
Get-Content C:\ProgramData\EVCoPilot\logs\caddy.err.log -Tail 50     # HTTPS / sertifika
Get-Content C:\ProgramData\EVCoPilot\logs\watchdog.log -Tail 20     # otomatik yeniden başlatmalar
```
Yedekler: `C:\ProgramData\EVCoPilot\backup\db-*.json` (son 14). Veri: `server\data\db.json`.

## 2. Kullanıcılar, davet, Premium

```powershell
node server\invite.mjs "Ali" 7                 # tek kullanımlık davet linki üretir (7 gün geçerli)
node server\premium.mjs list                   # herkesin planını listeler
node server\premium.mjs kisi@gmail.com 30      # 30 gün Premium ekler (süre varsa üstüne)
node server\premium.mjs kisi@gmail.com 0       # Premium'u kaldırır
node server\premium.mjs costs                  # kullanıcı başına Google maliyeti (bugün / bu ay / toplam, çağrı ve tahmini USD)
```

**Yönetim paneli (tarayıcıda):** `https://evcopilot.duckdns.org/yonetim`. Yönetici kodunu (`ACCESS_CODES`'dan biri) girersin; Özet, Kullanıcılar (Premium ver/kaldır, hesabı kapat/aç), Davetler (link üret/iptal) ve Maliyet (kullanıcı başına Google, CSV) sekmeleri vardır. Kod yalnızca o sekmede tutulur, çıkışta silinir.

Davet linkini kişiye gönder; linkte "Android uygulamasını indir" ve "Web'de aç" düğmeleri var. Yönetici hesabı (`ADMIN_EMAILS`) davetsiz girer ve her zaman Premium sayılır.

Bir kullanıcıyı kapatmak/açmak (yönetici kodu `.env`'deki ilk `ACCESS_CODES` değeridir):
```powershell
$code = ((Get-Content server\.env | Where-Object { $_ -match '^ACCESS_CODES=' }) -replace '^ACCESS_CODES=','').Split(',')[0]
$h = @{ 'X-Access-Code' = $code }
(Invoke-RestMethod http://127.0.0.1:8787/admin/users -Headers $h).users | Format-Table id,email,disabled,premiumUntil
Invoke-RestMethod -Method Post http://127.0.0.1:8787/admin/users/u_XXXX/disable -Headers $h   # ya da /enable
```

## 3. Ayarlar (`server\.env`)

Değiştirince `node server\restart.mjs`. Şablon: `server\.env.example`.

| Değişken | Ne için |
|---|---|
| `ACCESS_CODES` | yönetici erişim kodu (komut satırı araçları kullanır) |
| `PUBLIC_URL` | dışarıdan görünen adres (`https://evcopilot.duckdns.org`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google ile giriş (OAuth, Web uygulaması) |
| `ADMIN_EMAILS` | davetsiz giren ve yönetici olan e-postalar |
| `MAPBOX_TOKEN`, `OCM_KEY` | trafikli rota/istasyon araması ve OpenChargeMap (yalnızca sunucuda) |
| `GOOGLE_PLACES_KEY` | **boş bırak** (Türkiye'de veri vermiyor, Google kuralları Google dışı haritayla kullanımı kısıtlıyor) |
| `PREMIUM_REQUIRED` | `0` yazarsan herkes Premium sayılır |
| `GOOGLE_COST_PER_CALL_USD` | Google çağrı başına tahmini maliyet (varsayılan `0.035`); maliyet kayıtlarında kullanılır |
| `MAPBOX_DAILY_PER_USER`, `OCCUPANCY_DAILY_PER_USER`, `GOOGLE_DAILY_PER_USER`, `GOOGLE_DAILY_TOTAL`, `GOOGLE_SOC_BELOW` | günlük kotalar ve eşikler |
| `TRUST_PROXY=1`, `HOST`, `PORT`, `ALLOW_ORIGINS`, `DATA_DIR`, `SESSION_DAYS` | ağ ve veri ayarları (genelde dokunma) |

Anahtar değerlerini Not Defteri ile `.env` dosyasına yaz; sohbete ya da git'e yapıştırma.

## 4. Yayın akışı (sürüm çıkarma)

| Ne değişti | Ne yapılır |
|---|---|
| Web uygulaması (`index.html`, `js\`, `css\`) | `version.js` içinde sürümü artır ve `APP_CHANGELOG` başına kayıt ekle (kesme işaretini `\'` yaz ya da hiç kullanma), `node scripts\check.mjs`, sonra `git add … ; git commit ; git push`. GitHub Pages ~1-2 dakikada yayınlar; telefonlar kendiliğinden günceller (APK da canlı siteyi yüklediği için yeniden kurulmaz). |
| Sunucu kodu / `.env` | `node server\restart.mjs` |
| Android tarafı (izin, eklenti, `capacitor.config.json`, `AndroidManifest.xml`) | `npm.cmd run apk` → APK `server\public` içine konur ve `https://evcopilot.duckdns.org/app` adresinden iner |
| Yeni dosya eklendi | `sw.js` içindeki `SHELL` listesine ekle |

Kontrol ve sürüm doğrulama:
```powershell
node scripts\check.mjs                         # version.js geçerli mi, tüm .js söz dizimi
curl.exe -s https://ozdemirumit.github.io/ev-copilot/version.js | Select-String "APP_VERSION ="
```

Git:
```powershell
git status --short
git add -A ; git commit -m "v0.70.0: kısa açıklama"
git push
```
Commit mesajı `vX.Y.Z:` ile başlar (x.y.z: z düzeltme, y yeni özellik, x büyük değişiklik).

## 5. Android uygulaması

| Ne | Komut / adres |
|---|---|
| Kurulum sayfası (internetten) | `https://evcopilot.duckdns.org/app` |
| APK derle ve yayınla | `npm.cmd run apk` (ya da `node scripts\build-apk.mjs`) |
| Web dosyalarını `android\` içine eşitle | `npm.cmd run sync` |
| Android Studio | `android` klasörünü aç (File > Open), cihaz seçip ▶ |
| Wi-Fi'dan elle indirme (yerel ağ) | APK klasöründe `python -m http.server 8000`, telefonda `http://192.168.1.30:8000/ev-copilot.apk` (işin bitince durdur) |
| Kablosuz hata ayıklama | `adb pair IP:PORT` → `adb install app-debug.apk` (`adb.exe`: `%LOCALAPPDATA%\Android\Sdk\platform-tools`) |

Uygulama canlı siteyi yükler (`capacitor.config.json` `server.url`); ilk açılış internet ister. Sürüm kartında `APK · ozdemirumit.github.io` yazar (`localhost` yazıyorsa eski gömülü APK'dır: yeniden kur).

## 6. Çeviriler

```powershell
node scripts\i18n-validate.mjs en de fr it es pt nl pl ro el bg              # ana sözlükler
node scripts\i18n-validate.mjs en:extra de:extra fr:extra it:extra es:extra pt:extra nl:extra pl:extra ro:extra el:extra bg:extra   # ek sözlükler
```
Yeni metin ekleyince Türkçesi anahtar olur; her dilin `js\i18n\lang\<kod>.extra.js` dosyasına karşılığı eklenir ve `i18n\keys.extra.json`'a yazılır. Doğrulayıcı eksik/boş/yer tutucu uyuşmazlığı arar. Eksikleri tarayıcıda `window.__i18nMissing` gösterir.

## 6b. Sorun giderme

| Belirti | Neye bak |
|---|---|
| Uygulamada/tarayıcıda **502** | Sunucu kapalı: `Get-Service EVCoPilot*`, `status.ps1`; `Restart-Service EVCoPilotProxy` (yönetici) |
| `https://evcopilot.duckdns.org` açılmıyor | Caddy: `Get-Service EVCoPilotCaddy`, `caddy.err.log`; router 443 → 192.168.1.30 yönlendirmesi |
| "Google ile giriş tamamlanamadı" | `proxy.err.log` içindeki `google:` satırı (`invalid_client` = secret hatalı, `redirect_uri_mismatch` = yönlendirme adresi) |
| "Davet gerekli" | `node server\invite.mjs "Ad" 7` ile davet üret ya da `ADMIN_EMAILS`'e e-postayı ekle |
| Premium görünmüyor | `node server\premium.mjs list`; kullanıcı Hesap kartında **Şimdi eşitle**'ye dokunsun |
| Eski sürüm görünüyor | Sürüm kartındaki `APK · …` satırına bak (`localhost` = eski gömülü APK) ya da başlığa/sürüme dokunup yenile |
| `npm` çalışmıyor (betik politikası) | `npm.cmd` kullan |

## 7. Önemli yollar

| Ne | Yol |
|---|---|
| Proje | `D:\AI-Codes\Claude Code\MBRP` |
| Sunucu kodu | `server\` |
| Gizli ayarlar | `server\.env` (git'e girmez) |
| Kullanıcı verisi | `server\data\db.json` |
| Hizmet verisi ve günlükler | `C:\ProgramData\EVCoPilot\` (`logs\`, `backup\`, `caddy\`) |
| Caddy ayarı (hizmetin kullandığı) | `C:\ProgramData\EVCoPilot\caddy\Caddyfile` |
| APK (yayında) | `server\public\ev-copilot.apk` |
| Ayrıntılı belgeler | `server\README.md`, `docs\android.md`, `README.md` |
