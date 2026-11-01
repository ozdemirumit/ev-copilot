# Android uygulaması (Capacitor)

Web uygulaması olduğu gibi bir Android paketinin içine konur (`npm run sync` dosyaları `www/` üzerinden `android/` içine kopyalar). Web uygulamasında derleme adımı yoktur.

## Bu bilgisayarda bir kerelik kurulum
1. [Node.js LTS](https://nodejs.org) ve [Android Studio](https://developer.android.com/studio) kurulu olmalı.
2. Proje klasöründe: `npm install`
3. Android Studio: **File > Open** > `D:\AI-Codes\Claude Code\MBRP\android` klasörünü seç. Gradle senkronu bitene kadar bekle.
   - "Install missing SDK platform" gibi bir uyarı çıkarsa kabul et (SDK 36 gerekir).
   - Gradle senkronu Java sürümü hatası verirse: **File > Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK > Download JDK > 21**.
4. Telefonda **Ayarlar > Telefon hakkında** içinde yapı numarasına 7 kez dokun (geliştirici modu), sonra **Geliştirici seçenekleri > USB hata ayıklama** aç. Telefonu USB ile bağla, Android Studio'da cihazı seçip ▶ ile çalıştır.

## Web kodu değişince
```bash
npm run sync
```
sonra Android Studio'da yeniden ▶. Web sürümü (GitHub Pages) kendiliğinden güncellenir, APK'daki kopya güncellenmez.

## APK dosyası
**Build > Build Bundle(s) / APK(s) > Build APK(s)**. Çıktı: `android/app/build/outputs/apk/debug/app-debug.apk`. Telefona atıp "bilinmeyen kaynaktan kur" izniyle yüklenir (kişisel kullanım). Play Store'a koymak için imzalı sürüm (`.aab`) gerekir; imzalama anahtarını (keystore) GitHub'a koyma, yedeğini güvenli yerde tut.

## Notlar
- Uygulama içinde adres `https://localhost` olur: tarayıcıdaki ayarlar (OpenChargeMap, Mapbox anahtarı, kayıtlı rota) burada ayrı başlar, anahtarları yeniden yaz. Mapbox anahtarında URL kısıtı varsa `https://localhost` da eklenmeli.
- Ekran kapalıyken GPS için ek bir eklenti (arka plan konumu) gerekir, ilk pakette yok.
- İzinler `android/app/src/main/AndroidManifest.xml` içinde: konum, kamera, ekranı açık tut.
