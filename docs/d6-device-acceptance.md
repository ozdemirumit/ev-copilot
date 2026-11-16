# D6 — Kapalı Beta gerçek cihaz kabul hazırlığı (iOS / Android) — yalnız belge

Durum: **HAZIRLIK.** Bu belgede **hiçbir test sonucu yoktur**; tüm "Sonuç" alanları boştur ve yalnız cihazı kullanan kişi doldurur.
`verified` yalnız kullanıcı tarafından, aşağıdaki kanıt paketiyle yazılır (CLAUDE.md §9). Yazan: köprü `8858f5da`, 2026-11-16.

Temel: `integ/beta-2026-11-14` @`8d0c522` (uygulama **v0.99.90** = `e090676`; uzak yalnız kaynak yedeği
`origin/beta/verified-integration-2026-11-16` = `e090676`). Canlı Beta önizlemesi **0.99.61** — yani aşağıdaki düzeltmelerin hiçbiri bugün
bir cihazda çalışmıyor. Bu belge yazılırken ücretli/harici API çağrısı, yayın, push, sunucu yeniden başlatma **yapılmadı**.
Kural kaynağı: karar matrisi D6 (`docs/beta-decision-matrix.md` §0, §2 D6), dar ekran sözleşmesi `docs/nav-narrow-layout-contract.md` §6,
istek grafiği `docs/api-call-graph.md`.

## 1. Kapılar — kabul testi başlamadan önce (hiçbiri bugün yeşil değil)

| Kapı | Gerekli olan | Bugün | Onay |
|---|---|---|---|
| **G-ACCESS** (D6) | Kapalı erişim yöntemi + "cihazda test edilmedi" etiketinin yeri. Herkese açık GitHub Pages Beta'ya yayın D6'yı ihlal eder (BL-P0-08). | Belirlenmedi | Kullanıcı kararı |
| **G-BUILD** (D7) | v0.99.90'ın cihaza ulaşması: kapalı Beta yayını **ya da** yerel derleme/APK. APK ve `www/` 0.85.x eski (BL-P0-07, RM-09). | Yok | Yayın/derleme ayrı açık onay |
| **G-PAUSE** | İstemci `js/net/providerGate.js:11` `PROVIDER_REQUESTS_PAUSED_DEFAULT = true`: rota (Valhalla/Mapbox/TomTom), hava, istasyon, doluluk, arama ve **harita karoları** ağa hiç çıkmaz; harita `OFFLINE_STYLE` (koyu boş zemin, `js/ui/maps/maplibre.js:10`). [L] testleri bu kapı açılmadan **koşulamaz**. Açmak = sürüm artırımı + yayın; sunucu tarafı `PROVIDER_REQUESTS_PAUSED=0` + yeniden başlatma. | Kapalı (duraklatılmış) | Kullanıcı + G-PAID |
| **G-SERVER** | G2a `03e0fa5` (günlük/aylık sayaç) ve D2-T1 `e2620bc` (Mapbox rota Premium kapısı) yalnız sunucu yeniden başlatılınca canlı. | Yeniden başlatılmadı | Kullanıcı |
| **G-PAID** | Gerçek sağlayıcı trafiği (Mapbox, TomTom, Google, HERE kotası/faturası). | Yok | Kullanıcı, test başına |
| **G-DEBUG** | Kanıt için uzak hata ayıklama: Android Chrome `chrome://inspect`, iOS Safari Web Inspector (Mac gerekir). Duraklatmada engellenen her istek konsola `[kota koruması] istek gönderilmedi: <neden> <host>` yazar (`js/net/providerGateInstall.js:8`) — sayım kanıtı budur. | Kullanıcı ortamı | — |
| **G-USER** | Satır başına geçti/kaldı + kırpılma/ödünleşim kabulü; `verified` yazımı. | — | Kullanıcı |

Mod işaretleri: **[P]** = bugünkü duraklatılmış derlemeyle (G-ACCESS + G-BUILD sonrası) koşulabilir; **[L]** = ayrıca G-PAUSE (+ çoğunda G-PAID,
G-SERVER) gerekir. [P] ile koşulan bir test [L] davranışını kanıtlamaz; raporda mod yazılır.

## 2. Cihaz matrisi

En az bir satır her platform için. "Sürüm" = uygulamadaki sürüm etiketi + `version.js` (`APP_VERSION`); 0.99.90 değilse test geçersizdir.

| Kod | Platform | Ekran (CSS px) | Kabuk | Zorunlu? |
|---|---|---|---|---|
| IOS-S | iPhone (güncel iOS) | 375 geniş | Safari sekmesi | evet |
| IOS-P | aynı iPhone | 375 | Ana ekrana eklenmiş PWA | evet (ses + çevrimdışı farklı davranır) |
| AND-S | Android (Chrome) | 360×640 ya da `min-height` 521–640 | Chrome sekmesi / PWA | evet |
| AND-L | Android (Chrome) | 393–412 | PWA | evet |
| AND-A | Android APK (Capacitor) | herhangi | APK (yerel TTS, `offline.html`) | yalnız güncel APK derlenirse (G-BUILD) |

Her cihazda: sistem yazı boyutu varsayılan **ve** bir kademe büyük; açık **ve** koyu tema; Türkçe **ve** Almanca (en uzun etiketler).
Satır × test kesişimi §4 kanıt şablonuyla ayrı kaydedilir.

## 3. Test kontrol listeleri

Her testte "Önce" = beklenen eski (≤0.99.61) davranış, karşılaştırma içindir; "Geçti ölçütü" yalnız 0.99.90 içindir.

### T1 — Geç gelen GPS (tek nokta) [P] — `e090676` v0.99.90, `js/ui/mapView.js` `startPinStep` / `syncStartPin`
Ön koşul: konum izni verilmiş, GPS soğuk (kapalı alanda açılış ya da uçak modu kapatıldıktan hemen sonra); rota yok.
1. Uygulamayı kapatıp yeniden aç; GPS konumu gelmeden ekran görüntüsü al.
2. Konum gelene kadar bekle (dışarı çık), konum geldikten sonra ekran görüntüsü al.
3. İzni "Sor" yap → aç → reddet → sonra izin ver; konum gelince yine görüntü al.

- Önce: "Konumum" başlangıç iğnesi kalıyordu → haritada **2 yeşil nokta**.
- Geçti ölçütü: konum geldikten sonra haritada **tam 1** yeşil konum noktası; "Konumum" iğnesi kaldırılmış; elle seçilmiş başlangıç noktası (varsa) korunur.
- Kanıt: 2–3 zaman damgalı ekran görüntüsü + sürüm etiketi.

### T2 — Normal harita tek nokta [P] — `e090676`
Ön koşul: navigasyon yok. 2 dk yürü / araçla ilerle; haritayı kaydır, "Ortala"ya bas.
- Geçti ölçütü: her an tek yeşil nokta; **ok yok**; kaydırma sonrası ikinci işaret yok.
- Kanıt: 20–30 sn ekran kaydı.
- Not: [P]'de zemin koyu boş stil (karo yok); nokta yine görünür olmalı.

### T3 — Navigasyonda yalnız araç oku [L] — `e090676`, course-up `js/nav/course.js`
Ön koşul: G-PAUSE (rota sağlayıcısı duraklatmada engelli → rota çizilemez). Rota planla, "Git".
- Geçti ölçütü: navigasyon boyunca **yalnız araç oku**, yeşil nokta yok; ok gidiş yönünü gösterir; araç ekranın altından ≈%10 (takip kamerası).
- Kanıt: ≥1 dk sürüş kaydı (yolcu çeker; sürücü telefonu tutmaz).

### T4 — Navigasyon bitince nokta geri gelir [L] — `e090676` (`navView(false)` → `glideAt = 0`)
Ön koşul: T3 sürerken.
1. Navigasyonu "Bitir"/X ile durdur. 2. Varış noktasına ulaşarak bitir (ayrı deneme).
- Önce: son kamera karesi <500 ms ise ok haritada kalıyordu.
- Geçti ölçütü: durdurmadan sonra ≤1 sn içinde ok kaybolur, **tek yeşil nokta** görünür; iki işaret aynı anda yok.
- Kanıt: durdurma anını içeren ekran kaydı (her iki bitiş yolu için).

### T5 — Hava hatasında geri çekilme [P] — `fb064ef` v0.99.87 (W-1), `js/physics/rangeEngine.js:26-31`
Ön koşul: G-DEBUG; rota **yok** ve navigasyon **yok** (yol önü yağış `ahead` ayrı 10/20 dk Open-Meteo atar, sayımı karıştırır).
[P]'de her hava denemesi engellenir = hata. Konsolda `api.open-meteo.com` içeren `[kota koruması]` satırlarını 10 dk say.
- Önce: hiç başarı yokken **her 1 sn** deneme (10 dk'da ≈600).
- Geçti ölçütü: ilk 10 dk'da **en çok 4** deneme (≈0, ≈1, ≈3, ≈7. dk; 60 sn → 2 → 4 → 8 dk, en çok 10 dk). Uygulama donmaz, menzil hesabı sürer.
- [L] eki (G-PAUSE): uçak modu ya da Wi-Fi'siz/veri kapalı ile aynı sayım Network sekmesinde; ağ dönünce sonraki denemede başarı ve sayaç sıfırlanması.
- Kanıt: konsol günlüğü dışa aktarımı (zaman damgalı) + sayım.

### T6 — SOC güven kapısı [P kısmi / L] — `708d87c` v0.99.88 (Q-SOC-1/2), `js/routing/socTrust.js`
Güvenilir kaynaklar: canlı OCR, elle girilen, Test Modu simülasyonu. Güvenilmez: varsayılan / tahmin / eski (üst barda `≈` öneki).
1. [P] Pil kaynağı güvenilmez iken (`≈` görünür) düşük pil eşiğinin altına in (Test Modu ya da elle değer girip sonra tahmine bırak).
   Konsolda yakın istasyon araması / `/v1/occupancy` denemesi **olmamalı**; düşük pil uyarısı, ses ve eko-hız tavsiyesi **sürmeli**.
2. [P] Elle SOC gir (güvenilir) → düşük pil aramasının **denendiğini** konsolda gör ([P]'de engellendiği satır yeterli).
3. [L] Navigasyonda güvenilmez SOC ile yedek yeniden plan (`fallback.js` `replanFrom`) tetiklenmemeli; güvenilir SOC ile tetiklenebilir.
- Geçti ölçütü: 1 ve 2'nin ikisi de; `≈` öneki güvenilmez durumda görünür, güvenilir durumda yok.
- Kanıt: üst bar ekran görüntüsü (iki durum) + konsol günlüğü. OCR ile ilgili saha doğruluğu bu testin kapsamı dışında.

### T7 — İstasyon hatasında geri çekilme [P] — `7fcdfbc` v0.99.89 (S-0), `js/nav/nearby.js:40-41,122-127`
Ön koşul: G-DEBUG; yakın istasyon izleme açık. [P]'de her arama `ProviderPausedError` ile atılır (S-0 yolu).
1. 10 dk bekle; otomatik arama denemelerini say. 2. Ardından "Yenile"ye elle bas.
- Önce: güvenilir düşük pilde beklemesiz döngü (aynı anda onlarca arama); normal pilde 30 sn'de bir.
- Geçti ölçütü: 10 dk'da otomatik deneme **en çok 4** (60 sn → 2 → 4 → 8 dk, en çok 10 dk); elle Yenile **hemen** bir deneme yapar; kullanıcıya liste hatası/boş durum gösterilir, uydurma istasyon yok.
- Bilinen açık **S-1** (karar kullanıcıda, `4b7c802d` değerlendiriyor): kaynak hata DİZİSİYLE dönerse güvenilir düşük pilde 45 sn'de bir deneme (≈80/sa). [L]'de görülürse "kaldı" değil "S-1 gözlendi" yazılır.
- Kanıt: konsol günlüğü + sayım + liste ekran görüntüsü.

### T8 — Kota sıfırlama ve çevrimdışı yedek
**T8a Kota (sunucu) [L + G-SERVER]** — `03e0fa5` `server/quotaCounters.mjs`, `server/proxy.mjs:281-305`
Günlük kullanıcı sayacı UTC gününe (`dailyUsage.day`, TR saatiyle 03:00), Mapbox arama / Mapbox rota / HERE sayaçları UTC ayına (`YYYY-AA`) bağlı.
1. Yönetim panelindeki özet (`adminSummary`, anahtar değeri göstermez) 02:55 ve 03:05 TR saatinde okunur.
2. Günlük sınıra ulaşmış hesapla 429 alınır; reddedilen istek sayacı **artırmaz**; 03:00 TR sonrası ilk istek kabul edilir.
3. Ay dönümünde (UTC) `month` alanı yeni aya geçer, `n`/`used` 0'dan başlar.
- Geçti ölçütü: 1–3; geçersiz `MAPBOX_MONTHLY_CAP`/`HERE_MONTHLY_CAP` değeri sınır 0 (fail-closed) — yalnız sunucu günlüğünden, değer gösterilmeden.
- Kanıt: özet ekran görüntüleri (sayısal, anahtarsız), saatler UTC ile. Ajan `server/data/` okumaz/değiştirmez.

**T8b Çevrimdışı yedek [P]** — `sw.js:62-70` (önce ağ, olmazsa önbellek), `offline.html` (APK)
1. PWA'yı bir kez çevrimiçi aç (önbellek dolsun), uçak moduna geç, uygulamayı kapat-aç.
2. AND-A: aynı adımlar; "Tekrar dene" ekranı.
3. Ağ geri gelince yeniden yükle.
- Geçti ölçütü: PWA kabuğu açılır, sürüm etiketi 0.99.90; sağlayıcı verisi "veri yok/bilinmiyor" olarak görünür (uydurma yok), uygulama donmaz; APK'da `offline.html` açılır ve "Tekrar dene" APK'nın yapılandırılmış adresini yeniden yükler (Beta önizleme derlemesindeki `offline.html` ise Beta adresine döner, `scripts/build-beta.mjs:67`); ağ dönünce normal açılış.
- iOS notu: Safari PWA önbelleği uzun süre kullanılmayınca silinebilir; ilk açılış tarihini yaz.
- **T8c [L]** Mapbox rota aylık sınırı/Premium yok → 402 → ücretsiz Valhalla rotasına düşüş (`e2620bc`); rota çizilir, kullanıcıya engelleyici hata yok.
- Kanıt: ekran görüntüleri + (T8c) Network satırı (yalnız yol ve durum kodu; sorgu/anahtar maskeli).

### T9 — Rota ve sesli yönlendirme [L] — `js/advisor/voice.js`, `js/nav/steps.js`
Ön koşul: G-PAUSE. Ses açık; cihaz sessize alınmamış.
1. Rota planla → "Git"; ilk talimat sesli okunur mu.
2. 3 manevra (dönüş, kavşak, otoyol çıkışı) dinle; erken uyarı + manevra anı.
3. Rotadan bilerek çık → yeniden rota (45 sn soğuma; başarısızsa 12 sn'de bir — **N-1** bilinen açık).
4. Navigasyonu bitir → konuşma hemen kesilir (`stopSpeech`).
- Platform notları: iOS Safari'de `speechSynthesis` kullanıcı dokunuşu olmadan başlamayabilir; AND-A yerel TTS (Capacitor) kullanır, Web Speech yok.
- Geçti ölçütü: talimatlar Türkçe, doğru manevra ve mesafeyle, tekrarsız; ses çıkmazsa "Ses çıkmadı: …" bildirimi (en çok dakikada 1).
- Kapsam dışı (ölçüt DEĞİL): D4 doğal Türkçe (yol adı, çıkış no, "ardından") ve 16 dil **uygulanmadı** — gözlem olarak not edilir.
- Kanıt: ses kaydı içeren ekran kaydı (yolcu çeker) + manevra listesi.

### T10 — Harita karosu sağlayıcı kullanımı [P + L] — G3 açık, `docs/api-call-graph.md` §4–5
Karolar MapLibre Web Worker'ından istenir; `fetch` sarmalayıcısı ve testler onları **saymaz** — tek kanıt cihaz/gerçek ağ.
1. [P] 10 dk harita + Test Modu / yürüyüş: Network sekmesinde `tiles.openfreemap.org`, `api.mapbox.com`, `server.arcgisonline.com`,
   `maps.googleapis.com` istek sayısı **0** olmalı; Mapbox/Google/TomTom harita betikleri yüklenmemeli.
2. [L] Seçili sağlayıcıyla (OpenFreeMap / Mapbox / Google — yönetici seçimi) 10 dk navigasyon: karo + stil isteklerini sağlayıcı başına say;
   duraklıyken (hız 0) kamera hareketsiz → yeni karo isteği olmamalı; uydu katmanı tek `setStyle`.
3. [L] Sağlayıcı kimlik hatasında oturum boyu OpenFreeMap'e düşüş ve en çok bir yenileme.
- Geçti ölçütü: 1 kesin; 2–3 sayıları **kaydedilir**, eşik kullanıcı kararıdır (fatura modeli harita yüklemesi mi karo mu — sağlayıcı panelinden kullanıcı okur, ajan okumaz).
- Kanıt: HAR ya da Network ekran görüntüsü (sorgu dizeleri ve anahtarlar maskelenmiş), süre, sağlayıcı adı.

### T11 — Dar ekran üst bar (RM-07) — `docs/nav-narrow-layout-contract.md` §6 aynen uygulanır; konsolda `window.__navLayout()` çıktısı eklenir.

## 4. Kanıt şablonu (her cihaz × test satırı için)

| Alan | Doldurulacak |
|---|---|
| Test / mod | ör. T5 / [P] |
| Cihaz, OS sürümü, tarayıcı/kabuk | ör. iPhone 13, iOS 18.1, Safari PWA |
| Uygulama sürümü | ekrandaki etiket + `version.js` |
| Tarih/saat (UTC) ve konum türü | şehir içi / otoyol (kesin konum yazılmaz) |
| Yazı boyutu, tema, dil | |
| Adımlar uygulandı mı | evet / sapma |
| Gözlenen | sayı, süre, davranış |
| Sonuç | geçti / kaldı / koşulamadı (kapı adı) |
| Ek | ekran görüntüsü/kaydı, konsol/HAR dosya adı |

Kişisel veri kuralı: ekran görüntüsünde ev/iş adresi, e-posta, konum geçmişi bulanıklaştırılır; HAR/konsolda anahtar ve sorgu dizesi
paylaşılmaz (CLAUDE.md §6). Kanıtlar depoya commit edilmez; kayıtta yalnız dosya adı/özet.

## 5. Kalan kapılar ve açıklar (özet)

1. G-ACCESS (D6 kapalı erişim yöntemi + etiket) — kullanıcı kararı; çözülmeden Beta yayını D6'yı ihlal eder.
2. G-BUILD / D7 — v0.99.90'ı cihaza ulaştırma (kapalı yayın ya da yerel derleme/APK) ayrı onay.
3. G-PAUSE — T3, T4, T8c, T9, T10(2–3) ve T6(3) bugünkü derlemede koşulamaz.
4. G-SERVER — T8a sunucu yeniden başlatılmadan anlamsız.
5. Bilinen açıklar, ölçüt değil gözlem: S-1, N-1 (`4b7c802d` salt okunur değerlendirme), D4 ses sözcükleri, G3 karo/fatura sayımı.
6. Sonuçlar gelince: kayıt (`docs/beta-task-registry.json`) satırı ve karar matrisi D6 durumu ancak kullanıcının doldurduğu kanıtla güncellenir;
   `verified` yalnız kullanıcı yazar.
