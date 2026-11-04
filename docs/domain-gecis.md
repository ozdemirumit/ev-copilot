# evroutefinder.com'a geçiş (sıra önemli)

Hedef adresler:

| Adres | Ne | Nerede |
|---|---|---|
| `evroutefinder.com` | Tanıtım sitesi (`site-src/` → `site/`) | GitHub Pages, ayrı depo (`evroutefinder-site`) |
| `app.evroutefinder.com` | Web uygulaması (bu depo) | GitHub Pages, bu depo |
| `api.evroutefinder.com` | Sunucu: API, yönetim, APK, davet, Google dönüşü | Ev sunucusu (Caddy) |

Eski adresler (`ozdemirumit.github.io/ev-copilot/`, `evcopilot.duckdns.org`) geçiş boyunca çalışmaya devam eder; eski APK'lar ve açık sekmeler bozulmaz.

## Adım 1: Sunucu yeni adresleri tanısın (kod/`.env`: Claude yapar, yeniden başlatmadan önce haber verir)
- `server/.env`: `ALLOW_ORIGINS` listesine `https://app.evroutefinder.com` ve `https://evroutefinder.com` eklenir (eskiler kalır).
- Caddyfile (`C:\ProgramData\EVCoPilot\caddy\Caddyfile`): `api.evroutefinder.com { reverse_proxy 127.0.0.1:8787 }` bloğu eklenir, eski `evcopilot.duckdns.org` bloğu kalır; `Restart-Service EVCoPilotCaddy`.
- Sertifika Caddy tarafından otomatik alınır; bunun için `api.evroutefinder.com` DNS'te sunucuya çözülmeli (Adım 2).

## Adım 2: DNS (sen, alan adı sağlayıcında)
1. `api` → **CNAME** `evcopilot.duckdns.org` (duckdns adresi güncel IP'yi tutuyor). Sağlayıcı CNAME'e izin vermezse A kaydı: sunucunun genel IP'si.
2. `app` → **CNAME** `ozdemirumit.github.io`
3. `evroutefinder.com` (apex) için GitHub Pages kayıtları: **A** `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; isteğe bağlı **AAAA** `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`. Şu an apex duckdns'e gidiyor; bu kayıtlar geçer geçmez `evroutefinder.com` ev sunucusuna değil siteye gider.
4. `www` → **CNAME** `ozdemirumit.github.io` (GitHub apex'e yönlendirir).

## Adım 3: Üçüncü taraf ayarları (sen)
- **Google Cloud Console > Kimlik Bilgileri > OAuth istemcisi:** Yetkili yönlendirme URI'sine `https://api.evroutefinder.com/auth/google/callback` ekle (eskisi kalsın). Yetkili JavaScript kaynaklarına `https://app.evroutefinder.com` ekle.
- **Mapbox** (harita belirteci URL kısıtı): `https://app.evroutefinder.com` ekle (yalnızca köken, yol yok).
- **Google Maps anahtarı** (HTTP yönlendiren kısıtı): `https://app.evroutefinder.com/*` ekle.
- **Google Play / Search Console:** siteyi `https://evroutefinder.com` olarak ekle; gizlilik politikası adresi `https://evroutefinder.com/gizlilik/`.

## Adım 4: Uygulama bu depoda `app.evroutefinder.com`'a geçsin
- Depo kökünde `CNAME` dosyası: `app.evroutefinder.com`; GitHub > Settings > Pages > Custom domain aynı adres; "Enforce HTTPS" açılır (sertifika ~15 dk).
- Aynı anda GitHub eski `ozdemirumit.github.io/ev-copilot/` adresini yeni adrese yönlendirir. Köken değiştiği için tarayıcıdaki yerel veri (ayarlar, oturum) taşınmaz; Google ile yeniden giriş yapınca eşitlenenler geri gelir.
- Kodda: `js/net/proxy.js` `DEFAULT_SERVER` → `https://api.evroutefinder.com`, `capacitor.config.json` `server.url` → `https://app.evroutefinder.com/`, `offline.html` bağlantısı, `server/accounts.mjs` `APP_URL` varsayılanı; `.env`: `PUBLIC_URL=https://api.evroutefinder.com`, `APP_URL=https://app.evroutefinder.com/`. Sonra yeni sürüm, `npm run apk` (APK'da yalnızca `server.url` değişir).

## Adım 5: Tanıtım sitesi `evroutefinder.com`'da yayınlansın
- `site-src/config.json` içindeki `email` doldurulur; `node site-src/build.mjs --publish` ile `site/` üretilir (e-posta geçerli değilse yayın reddedilir).
- Yeni GitHub deposu `evroutefinder-site` (herkese açık), `site/` içeriği kökte; Settings > Pages > Custom domain `evroutefinder.com`, HTTPS zorunlu. `site/CNAME` zaten `evroutefinder.com` yazar.
- Doğrulama: `https://evroutefinder.com/`, `/en/`, `/gizlilik/`, `/hesap-silme/`, `/sitemap.xml`.

## Sorun giderme
- `app.evroutefinder.com` açılıyor ama uygulama "sunucuya ulaşılamadı" diyor: `ALLOW_ORIGINS` (Adım 1) eksik ya da sunucu yeniden başlatılmadı.
- Google ile giriş "redirect_uri_mismatch": Adım 3'teki dönüş adresi eklenmemiş ya da `PUBLIC_URL` ile aynı değil.
- Sertifika alınamıyor: DNS henüz yayılmadı ya da 443 yönlendirmesi/duvarı; `C:\ProgramData\EVCoPilot\logs\caddy.err.log`.
