# Çevrimdışı harita kurulumu

Ülke haritası tek bir `.pmtiles` dosyasıdır (Türkiye, yakınlaştırma 14'e kadar ≈ 0,7 GB; 12'ye kadar ≈ 0,2 GB, tahmin).
GitHub Actions dosyayı üretir ve **senin** Cloudflare R2 kovana yükler; uygulama oradan telefona indirir. Bu bir kerelik kurulumdur.

> Gerçek anahtarları (R2 erişim anahtarları) sohbete, koda veya depoya yazma. Yalnızca GitHub "Secrets" alanına ve Cloudflare paneline gir.

## 1. R2 kovası

1. Cloudflare hesabı aç (ücretsiz) → **R2 Object Storage** → **Create bucket** (ör. `ev-harita`).
   R2'nin ücretsiz kotası bu iş için fazlasıyla yeter (10 GB depolama; indirme trafiği ücretsiz).
2. Kovanın **Settings → Public access**:
   - Kalıcı kullanım için **Custom Domains** ile bir alan adı bağla (ör. `harita.alanadin.com`). `r2.dev` adresi yalnızca deneme içindir, hız sınırı vardır.
   - Hızlıca denemek için **R2.dev subdomain → Allow Access** de açabilirsin.
3. Kovanın **Settings → CORS policy → Add** (panel biçimi):

```json
[
  {
    "AllowedOrigins": ["https://ozdemirumit.github.io"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["range", "if-match", "if-range"],
    "ExposeHeaders": ["etag", "content-range", "content-length", "accept-ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

   `AllowedOrigins` uygulamanın yayın adresidir (yol yok, yalnızca şema + alan adı).

## 2. Erişim anahtarı

R2 → **Manage API tokens → Create API token** → izin: **Object Read & Write**, yalnızca bu kova.
Çıkan üç değeri not et: **Account ID**, **Access Key ID**, **Secret Access Key** (Secret bir kez gösterilir).

## 3. GitHub'a ekle

Depo → **Settings → Secrets and variables → Actions → New repository secret**. Dört gizli bilgi:

| Ad | Değer |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | Access Key ID |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key |
| `R2_BUCKET` | Kova adı (ör. `ev-harita`) |

## 4. Paketi üret

Depo → **Actions → build-offline-map → Run workflow** (`TUR`, `14`). 10-30 dakika sürer.
Bitince şu adres JSON döndürmeli (kendi adresinle):

```
https://harita.alanadin.com/maps/tur-latest.json
```

Dosya Range isteğini desteklemeli; denemek için:

```bash
curl -s -o /dev/null -D - -r 0-99 https://harita.alanadin.com/maps/tur-<tarih>-z14.pmtiles
```

Yanıt `206 Partial Content` ve `Content-Range` içermeli.

## 5. Uygulamada

Rota sekmesi → **Çevrimdışı harita** kartı → adresi gir (`https://harita.alanadin.com`) → **Haritayı indir (Türkiye)**.
Büyük dosyadır: Wi-Fi'de indir, ekranı açık tut. İndirme kesilirse "Devam et" kaldığı yerden sürer.
İnternet varken Google haritası kullanılır. Uygulama internetsiz açılırsa (veya Google haritası açılamazsa) indirilen harita kullanılır. Açıkken internet koparsa sayfayı yenilemek gerekir (rota planı sıfırlanır, çünkü rota henüz cihazda saklanmıyor). Google Haritalar uygulamasının kendi indirdiği çevrimdışı haritalar bu uygulamada kullanılamaz.

## Notlar

- **iPhone:** Safari, kullanılmayan sitelerin verisini silebilir. Uygulamayı **Ana Ekrana ekle** ve indirilen haritanın durumuna ara sıra bak; silinirse yeniden indir. Safari sekmesi ile Ana Ekran uygulaması ayrı depolama kullanır: haritayı hangisinden kullanacaksan oradan indir. Cihazda doğrulanmadı.
- **Güncelleme:** Workflow ayda bir yeni dosya üretir (adı sürümlüdür). Uygulamada **Güncelle** yeni dosyayı indirir, eskisini siler.
- **Atıf:** Harita verisi © OpenStreetMap katkıcıları (ODbL), harita biçimi Protomaps. Uygulama haritada atfı gösterir.
- **Sorun giderme:** "Sunucu Range desteklemiyor" → alan adının R2 kovasına bağlı olduğundan ve CORS'ta `range` başlığına izin verildiğinden emin ol.
