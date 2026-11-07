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

## Notlar
- Eski gömülü sürümde adres `https://localhost` idi; o kurulumlardaki yerel ayarlar yeni sürümde görünmez, hesapla giriş yapınca senkron her şeyi geri getirir.
- Ekran kapalıyken GPS için ek bir eklenti (arka plan konumu) gerekir, ilk pakette yok.
- İzinler `android/app/src/main/AndroidManifest.xml` içinde: konum, kamera, ekranı açık tut.
