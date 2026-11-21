# Android uygulaması (Capacitor)

Web uygulaması olduğu gibi bir Android paketinin içine konur (`npm run sync` dosyaları `www/` üzerinden `android/` içine kopyalar). Web uygulamasında derleme adımı yoktur.

## Bu bilgisayarda bir kerelik kurulum
1. [Node.js LTS](https://nodejs.org) ve [Android Studio](https://developer.android.com/studio) kurulu olmalı.
2. Proje klasöründe: `npm install`
3. Android Studio: **File > Open** > `D:\AI-Codes\Claude Code\MBRP\android` klasörünü seç. Gradle senkronu bitene kadar bekle.
   - "Install missing SDK platform" gibi bir uyarı çıkarsa kabul et (SDK 36 gerekir).
   - Gradle senkronu Java sürümü hatası verirse: **File > Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK > Download JDK > 21**.
4. Telefonda **Ayarlar > Telefon hakkında** içinde yapı numarasına 7 kez dokun (geliştirici modu), sonra **Geliştirici seçenekleri > USB hata ayıklama** aç. Telefonu USB ile bağla, Android Studio'da cihazı seçip ▶ ile çalıştır.

## Uygulama canlı siteyi yükler (v0.62 sonrası)
`capacitor.config.json` içindeki `server.url` APK'yı küçük bir kabuk yapar: arayüz her açılışta `https://ozdemirumit.github.io/ev-copilot/` adresinden gelir. Yani **web kodu değişince APK'yı yenilemek gerekmez**: `git push` yeter, uygulamalar kendiliğinden güncellenir (service worker önce ağı dener, sonra önbelleği kullanır).
- **İnternetsiz:** ilk açılış internet ister (service worker dosyaları önbelleğe alır); sonraki açılışlar internetsiz de açılır (GPS, kamera, pil tahmini, önceden planlanmış rotada navigasyon). Harita karoları, yeni rota, arama ve istasyonlar internet ister. İlk açılış başarısız olursa yerel `offline.html` sayfası ("Tekrar dene") gösterilir.
- **APK'yı yenilemek gereken tek durum:** Android tarafı değişince (izin, eklenti, `capacitor.config.json`, `AndroidManifest.xml`). `npm.cmd run apk` derler ve sunucuya koyar.
- Uygulamanın kökeni artık web sürümüyle aynıdır (`https://ozdemirumit.github.io`): tarayıcıdaki ayarlar APK'da da görünür.
- Giriş (Google) sistem tarayıcısında açılır, davet `evroutefinder://invite` (eski: `evcopilot://invite`, ikisi de kabul edilir) ile uygulamaya gelir. Paket adı `com.evroutefinder.app` (Play'e ilk yüklemeden sonra değişmez).

## APK dosyası
**Build > Build Bundle(s) / APK(s) > Build APK(s)**. Çıktı: `android/app/build/outputs/apk/debug/app-debug.apk`. Telefona atıp "bilinmeyen kaynaktan kur" izniyle yüklenir (kişisel kullanım). Play Store için imzalı AAB aşağıdaki "Google Play" bölümünde.

## Google Play (imzalı AAB)
Play, debug APK değil imzalı **AAB** ister. Play App Signing kullanılır: Google asıl imza anahtarını tutar, biz **yükleme anahtarı** (upload key) ile imzalayıp yükleriz.

**Bir kerelik: yükleme anahtarını üret** (depo dışında bir klasörde; örnek `C:\Users\<sen>\anahtarlar\`):
```
"C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore C:\Users\<sen>\anahtarlar\ev-copilot-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```
Parolaları keytool kendisi sorar (kayıt dışı bir yere not et). Anahtar dosyasının **yedeğini** (ör. parola yöneticisi ya da şifreli bir USB) al; kaybolursa Play'e anahtar sıfırlama başvurusu gerekir.

**Bir kerelik: `android/keystore.properties`** (depoya girmez, `.gitignore`'da):
```
storeFile=C:/Users/<sen>/anahtarlar/ev-copilot-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

**Her yayında:** `npm run aab`. Çıktı: `android/app/build/outputs/bundle/release/app-release.aab`. Sürüm kodu `version.js`'ten türer (`x.y.z` → `x*1000000 + y*1000 + z`, 0.82.3 → 82003); Play her yüklemede artmasını ister, bu yüzden aynı sürümle ikinci kez yüklenemez. Betik sonunda `jarsigner -verify` ile imzayı doğrular ("jar verified" çıkar; ardındaki "signed in JarFile" uyarıları AAB için normaldir).

Web kodu değişince yeni AAB gerekmez (uygulama canlı siteyi yükler); yalnızca Android tarafı (izin, eklenti, `capacitor.config.json`, manifest) değişince.

## Otomatik yükleme (GitHub Actions → Play dahili test)
`.github/workflows/play-internal.yml`: imzalı AAB'yi derler, `scripts/play-whatsnew.mjs` ile `APP_CHANGELOG`'un en üst kaydından sürüm notu (≤ 500 karakter) üretir ve **dahili test** kanalına yükler. Üretime taşıma ve kapalı test Play Console'dan **elle** kalır.

**Ne zaman gerekir:** yalnızca Android tarafı değişince (izin, eklenti, `capacitor.config.json`, manifest). Web kodu canlı siteden (Pages) yüklendiği için her yeni özellik için AAB gerekmez.

**Bir kerelik kurulum (sende; değerleri YALNIZCA GitHub'a gir, sohbete/kimseyle paylaşma):**
1. **İlk yükleme elle yapılmış olmalı** (uygulama kaydı Play'de var; 7 Kasım 2026'daki AAB). Otomasyon yalnızca sonrakileri yükler.
2. **Servis hesabı:** Google Cloud Console'da (mevcut ya da yeni proje) "Google Play Android Developer API"yi etkinleştir → IAM ve Yönetici > Hizmet hesapları > hesap oluştur → Anahtarlar > JSON anahtar indir. Play Console > Kullanıcılar ve izinler > Yeni kullanıcı davet et → servis hesabının e-postası, uygulama için "Test sürümlerini yönet" ve "Sürümleri oluştur ve düzenle" izinleri. (İzinlerin geçerli olması birkaç saati bulabilir.)
3. **GitHub:** depo > Settings > Environments > `play-internal` oluştur (isteğe bağlı: "Required reviewers" olarak kendini ekle: her yükleme onay bekler). Ortam gizli değerleri (Environment secrets):
   - `PLAY_SERVICE_ACCOUNT_JSON`: indirilen JSON dosyasının TÜM içeriği
   - `ANDROID_KEYSTORE_B64`: yükleme anahtarı dosyasının base64'ü. PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\Users\<sen>\anahtarlar\ev-copilot-upload.jks')) | Set-Clipboard`
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`upload`), `ANDROID_KEY_PASSWORD`

**Her yayında:** `git tag android-v0.99.123` ardından `git push origin android-v0.99.123` (etiketteki sürüm yalnızca ad; asıl sürüm kodu `version.js`'ten türer ve Play her yüklemede artmasını ister). Ya da GitHub > Actions > "Play dahili test" > Run workflow (`draft`: sürüm oluşur ama testçilere çıkmaz, Play Console'dan yayınlarsın; `completed`: dahili testçilere hemen çıkar). Derlenen AAB 30 gün Actions çıktısında da kalır.

**Güvenlik:** akış yalnızca etiket ya da elle tetiklenir (PR/fork ile çalışmaz, gizli değerler sızmaz); anahtar dosyası geçici klasöre yazılır ve iş bitince silinir; gizli değerler günlüğe yazdırılmaz. Anahtar ya da servis hesabı sızdıysa Play Console'dan servis hesabını kaldır, yükleme anahtarını sıfırlat.

## Notlar
- Eski gömülü sürümde adres `https://localhost` idi; o kurulumlardaki yerel ayarlar yeni sürümde görünmez, hesapla giriş yapınca senkron her şeyi geri getirir.
- Ekran kapalıyken GPS için ek bir eklenti (arka plan konumu) gerekir, ilk pakette yok.
- İzinler `android/app/src/main/AndroidManifest.xml` içinde: konum, kamera, ekranı açık tut.
