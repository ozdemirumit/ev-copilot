# Beta — bağımlılık ve karar matrisi (D1–D7 ONAYLANDI 2026-11-15; D1 kısmen uygulandı 2026-11-16, D2–D7 uygulanmadı)

## 0. Onaylı kararlar (2026-11-15)

Kullanıcı D1–D7'yi 2026-11-15'te onayladı; köprü görevi `1c769a50` istemiyle kaydedildi (JSON `decisions[]`, durum `approved`).
**2026-11-16 durumu (`a0fa9e93`):** D1 kısmen uygulandı — yalnız yerel integ `405f628` (yağış), `e28ee47` ve `8e2399f` (trafik hata yolu); push/yayın/cihaz yok. D2–D7 uygulanmadı (`f0f448e` kota koruması D2 değildir). Kural: `implemented` ancak ilgili kod commit'i + testlerle, `device-verified` yalnız kullanıcı tarafından yazılır.
Kayıt anında temel: `integ/beta-2026-11-14` @`f51e40a` (v0.99.76, yerel, push yok, Beta'da değil, cihazda doğrulanmadı; canlı Beta 0.99.61).

> **Bu kararlar izin değildir.** Ürün kararlarıdır; ücretli API çağrısı, lisans satın alma, sır/anahtar paylaşımı, production
> (`main`, GitHub Pages üretim, Play Store), sunucu yeniden başlatma, push/yayın ya da geri alınamaz değişiklik için ayrı ve açık
> onay gerekir (CLAUDE.md §7). Her uygulama ayrı, tek görevde, yalıtılmış dalda yapılır.

| # | Onaylanan karar | Bu kararla AÇIK kalan / onaylanmayan |
|---|---|---|
| D1 | Yol önü trafik/yağış uyarısında **her veri yenilemesinde** kalan mesafe, **güncel araç konumu + güncel olay konumundan** yeniden hesaplanır; eski mesafe yanlışlıkla yeniden kullanılmaz; veri yoksa / istek başarısızsa **güvenli "belirsiz"** (uydurma mesafe yok). | Eski olayı **körlemesine korumak onaylanmadı** (§2 seçenek (a)'nın "koru" kısmı); (b) ek Open-Meteo yakın örneği onaylanmadı (dış istek artışı ayrı onay); "belirsiz"in metin/ses biçimi uygulama görevinde testle sabitlenir. |
| D2 | Mapbox rotası: sunucuda **Premium yetki denetimi + kota** (aylık sınır/sayaç) + yetki ya da kota yoksa **Free yedeğe** düşüş. | Kota değeri; canlıya alma için sunucu yeniden başlatma onayı; gerçek Mapbox çağrısı yok (testler çevrimdışı). |
| D3 | Doluluk: **yalnız doğrulanmış ve güncel** doluluk gösterilir/kullanılır; aksi halde **"Bilinmiyor"**. | K1/K2/K4 eşlemesi (tazeliği kanıtsız → Bilinmiyor) uygulamadan önce teyit; K3 (topluluk bildirimi), K5 (görüntü yolu), K6 (NDW fiyat etiketi) ayrıca seçilmedi; R3-e sunucu onayı. |
| D4 | Sesli yönlendirme **doğal Türkçe**; **toplam 16 dil**; **yol adı, çıkış numarası, birleşik manevra** ("ardından") söylenir. | Kodda 12 dil (BL-P3-08): eklenecek 4 dil adı; kesin cümle kalıpları/eşikler örnek cümle fikstürüyle onaylanır; çıkış numarası sağlayıcı verisine bağlı (D5, BL-P2-08). |
| D5 | HERE / Maps.com **yalnız yazılı lisans ve gerçek sağlayıcı özelliği doğrulanırsa** eklenir; o zamana kadar HERE kapalı, Maps.com yok. | Doğrulama için ücretli örnek çağrı (G-PAID) ve lisans satın alma/kabulü (G-LEGAL) ayrı açık onay; `providerPolicy` değişmedi. |
| D6 | İlk yayın **yalnız KAPALI Beta testi**; **"cihazda test edilmedi"** etiketi; **genel erişim yok**. | Kapalı erişim yöntemi ve etiketin yeri belirlenmedi. Bugünkü Beta önizlemesi herkese açık GitHub Pages (`ozdemirumit.github.io/EV-Route-Finder`) → yöntem belirlenmeden yayın D6'yı ihlal eder (BL-P0-08 ile ilişkili). |
| D7 | **Zorunlu testler ve yayın kapıları yeşilse** Beta yayını (`build-beta.mjs`); **production yok**. | Bugün kapılar yeşil değil (integ yerel/push yok, D6 yöntemi yok, cihaz testi yok); her push/yayın yine görev isteminde açık izin ister. |

Aşağıdaki §1–§3, kararlardan önceki (`0804d23`) seçenek/kabul metnidir; tarihçe için korunur, her alt bölüme karar satırı eklendi.

---

Önceki durum (0804d23): **yalnız belge, karar içermez.** Temel: `integ/beta-2026-11-14` @ `018d726` (= `fe5fb45` + regrec14 kayıt commit'i, yalnız belge; uygulama v0.99.76; yerel, push yok,
Beta'da değil, cihazda doğrulanmadı; canlı Beta son okumada 0.99.61). Yazan: regrec14 (köprü `5363a7e5`, 2026-11-15).
Ağ/sağlayıcı çağrısı yapılmadı, çalışma zamanı değişmedi. Kimlikler `docs/beta-task-registry.json` ile aynı; yeni BL kimliği
açılmadı. Çelişkide JSON kayıt esastır. Seçenek sırası öneri değildir; **her satırın kararı kullanıcıya aittir.**

Kapı gösterimi `docs/beta-next-backlog.md` ile aynı: **G-HEAD** (integ beklenen sha'da, temiz), **G-SUITE** (`check.mjs` +
tüm `scripts/test-*.mjs` sıralı 0 FAIL), **G-USER** (kullanıcı kararı/onayı), **G-DEVICE** (gerçek cihaz; `verified` yalnız kullanıcı),
**G-PAID** (ücretli/harici sağlayıcı çağrısı onayı), **G-LEGAL** (yazılı lisans).

## 1. Özet matris

| # | Konu | Kayıt | Karar | Kapılar | Karardan sonra ajanın yapabileceği | Durum (2026-11-15) |
|---|---|---|---|---|---|---|
| D1 | Yol önü yağış kalan mesafe GAP-1/2 | `docs/ahead-rain-distance-gap.md`, `test-ahead-rain-progress` | koru / yakın örnek ekle / olduğu gibi | G-USER, G-HEAD, G-SUITE | `js/nav/ahead.js` düzeltmesi + sürüm artışı | **ONAYLANDI**; kısmen uygulandı 2026-11-16 (yerel `405f628`, `e28ee47`, `8e2399f`; cihaz yok) |
| D2 | Mapbox rotası Premium kapısı (BL-P3-01 M1/M1b/M2/M2b) | `test-mapbox-route-gate` (4 KNOWN-GAP) | Premium'a kapat / aylık sınır / olduğu gibi | G-USER, sunucu yeniden başlatma onayı | `server/proxy.mjs` `mapbox()` değişikliği | **ONAYLANDI** (uygulanmadı; §0) |
| D3 | Doluluk BL-P2-09 R3 K1–K6 | `docs/occupancy-consistency-contract.md` §4–5 (12 boşluk) | K1…K6 ayrı ayrı | G-USER; R3-e için sunucu onayı | R3-a…R3-d sıralı, her biri ayrı commit | **ONAYLANDI** (uygulanmadı; §0) |
| D4 | Türkçe sesli yönlendirme sözcükleri (BL-P3-09 / RM-01) | `js/nav/steps.js:62-85`, `test-nav-panel` | yol adı / çıkış no / "ardından" / yuvarlama | G-USER | `steps.js` + test genişletmesi + sürüm artışı | **ONAYLANDI** (uygulanmadı; §0) |
| D5 | Sağlayıcı lisansı ve gerçek örnek yanıtlar (RM-10 / BL-P3-07; BL-P2-04/06/08/10) | `server/providerPolicy.mjs` `unverified`; sözleşme testleri | lisans onayı; hangi örnek çağrı | G-LEGAL, G-PAID | yalnız onaylı, anahtarsız/temizlenmiş fikstürle ayrıştırıcı | **ONAYLANDI** (uygulanmadı; §0) |
| D6 | Mobil RM-07 cihaz doğrulaması (A2b/A3/A4/A5) | `docs/nav-narrow-layout-contract.md` §6, `window.__navLayout()` | cihaz ölçümü + kırpılma kabulü | G-DEVICE, G-USER | ölçüme göre CSS düzeltmesi (sürüm artışı) | **ONAYLANDI** (uygulanmadı; §0) |
| D7 | Kaynak yedeği ve push/yayın kapısı (BL-P0-02, BL-P0-06, BL-P0-08) | ana kopya @`0c6dffd` 35 kirli; integ yerel | eşitleme yöntemi; push; Beta yayını | G-USER (push/yayın), WIP sahibi | yalnız onaylanan yöntem; yayın sonrası canlı `version.js` okuması | **ONAYLANDI** (uygulanmadı; §0) |

## 2. Ayrıntı — seçenekler ve kabul ölçütleri

Her satırda "Kabul" kararın **uygulanmış** sayılması için gereken kanıttır; ajan `verified` vermez.

### D1 — Yağış uyarısı kalan mesafe (GAP-1/2) — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** her trafik/yağış veri yenilemesinde kalan mesafe güncel araç + güncel olay konumundan yeniden hesaplanır; eski mesafe yeniden kullanılmaz; veri yoksa güvenli "belirsiz". Eski olayı körlemesine koruma (a-koru) ve (b) ek örnek **onaylanmadı**. GAP-1/2/3 testleri (`f51e40a`, 45/0) bu davranışa bilinçli çevrilecek. Uygulanmadı.
- Bugün: `refreshRain` 10 dk'da bir yalnız güncel km + `WX_AHEAD_KM` noktalarını örnekler; GAP-1 "~3 km" → "~10 km" sıçraması
  (ses anahtarı değişirse uyarı yinelenir), GAP-2 yakın yağış uyarısının silinmesi. Testte sabit, düzeltilmedi.
- Seçenekler: (a) önceki olay hâlâ ileride ve eskimemişse koru, yalnız daha yakın yağış bulunursa değiştir; (b) km+0..5 yakın
  örnek ekle (Open-Meteo isteği büyür, ücretsiz); (c) olduğu gibi bırak.
- Bağımlılık: yok (bağımsız). (b) dış istek sayısını artırır → kullanıcı bunu da onaylamalı.
- Kabul: GAP testleri yeni beklenen davranışa **bilinçli** çevrilir (gevşetilmez); `test-ahead-rain-progress`, `test-traffic-guard`,
  `test-ahead-events`, `test-ahead-update` geçer; sürüm artışı; G-SUITE; cihazda sürüşte gözlem ayrı (G-DEVICE).

### D2 — Mapbox rotası Premium kapısı (BL-P3-01) — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** Premium yetki denetimi + kota + Free yedek ((a)+(b) birleşimi). Uygulanmadı; sunucu yeniden başlatma ayrı onay.
- Bugün: `mapbox()` ve dağıtıcı satırında Premium denetimi yok (M1/M1b); aylık `MB_CAP` ve sayaç yalnız aramaya uygulanır (M2/M2b).
- Seçenekler: (a) Mapbox rotasını Premium'a kapat (Free → Valhalla); (b) açık kalsın, rota da aylık sınıra ve sayaca girsin;
  (c) olduğu gibi (maliyet riski kabul).
- Bağımlılık: sağlayıcı faturalama/kota bilgisi kullanıcıda; canlıya alma sunucu yeniden başlatması = ayrı onay.
- Kabul: seçilen M satırları `test-mapbox-route-gate`'te KNOWN-GAP → `ok` kabul denetimine çevrilir; `test-provider-policy*`,
  `test-secret-hardening`, `test-proxy-retry` geçer; anahtar değeri hiçbir yerde görünmez; G-SUITE.

### D3 — Doluluk BL-P2-09 R3 (K1–K6) — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** yalnız doğrulanmış güncel doluluk, aksi halde "Bilinmiyor". K3/K5/K6 ayrıca seçilmedi; K1/K2/K4 eşlemesi uygulama öncesi teyit. Uygulanmadı.
| Karar | Soru | Seçenekler | Açtığı aşama |
|---|---|---|---|
| K1 | NDW "AFIR ≤1 dk tazelik" varsayımı kabul mü? | evet → ayrı güven sınıfı / hayır → nav+planlayıcıda `unknown` (NL'de eleme kaybolur) | R3-a (önkoşul) |
| K2 | NDW 0/N (ayrıntısız) dolu mu, bilinmiyor mu? | dolu / bilinmiyor (bugünkü biçimlendirici) | R3-a |
| K3 | Topluluk "Dolu bildirildi" (20 dk) planlayıcıyı etkilesin mi? | evet / hayır / yalnız uyarı | R3-b, R3-c |
| K4 | TomTom `fetched` (zaman yok) için aynı kural mı? | aynı / ayrı / TomTom doluluğu kapalı | R3-a |
| K5 | Görüntü: `slotEl` düzelt mi, `occupancyView` bağla mı? | düzelt / bağla (+`sw.js` SHELL) | R3-d |
| K6 | NDW fiyatının "(canlı)" etiketi doluluk dışı ayrı görev mi? | ayrı görev / R3'e dahil | — (BL-P2-10 ile ilişkili) |

- Bağımlılık sırası: K1+K2(+K4) → R3-a → R3-b / R3-c → R3-d; R3-e sunucu onayı ister. K1/K2 olmadan R3-a bile yazılmaz.
- Kabul: her aşamada ilgili G-satırları KNOWN-GAP → ACCEPT; 12 bilinen boşluk sayısı yalnız bilinçli kapatmayla azalır;
  `test-occupancy-consistency-contract`, `test-occupancy-label`, `test-availability`, `test-near-sort`, `test-charge-pick`,
  `test-stop-swap`, `test-route-options` geçer; i18n değişirse `i18n-validate`; G-SUITE; cihaz doğrulaması ayrı.

### D4 — Türkçe sesli yönlendirme sözcükleri (BL-P3-09) — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** doğal Türkçe, toplam 16 dil, yol adı + çıkış numarası + birleşik manevra. Kesin kalıplar/eşikler ve 4 yeni dil örnek fikstürle onaylanır. Uygulanmadı.
- Bugün: `steps.js` saf Türkçe cümle kurucusu var (50 m / 0,5 km yuvarlama, 120/500/2000 m eşikleri); yol adı, çıkış numarası,
  birleşik manevra ("ardından") bilinçli olarak söylenmiyor (3fe33b73 NO-CHANGE).
- Kullanıcıdan istenen: (1) yol adı söylensin mi, hangi ekle ("… Caddesi'ne"); (2) çıkış no kalıbı ("3. çıkıştan" / "çıkış 3'ten");
  (3) "ardından" birleştirme eşiği; (4) yuvarlama/eşik değerleri değişsin mi. Örnek cümle listesiyle onay.
- Bağımlılık: D5 (çıkış numarası/tabela verisi BL-P2-08 sağlayıcı örneğine bağlı); yol adı Mapbox/Valhalla'da var.
- Kabul: onaylı örnek cümleler belirlenimci fikstür olur; `test-nav-panel`, `test-lanes` geçer; 11 dil etkilenirse `i18n-validate`;
  sürüm artışı; sesli çıktı cihazda dinlenir (G-DEVICE, APK WebView ses farkı ayrı).

### D5 — Sağlayıcı lisansı ve gerçek fikstürler — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** HERE / Maps.com yalnız lisans + gerçek sağlayıcı özelliği doğrulanırsa. Koşul sağlanmadı; ücretli çağrı/lisans satın alma ayrı onay. `providerPolicy` değişmedi.
- Bugün: `providerPolicy` HERE/TomTom lisansı `unverified`, HERE kapalı; TomTom/Google/HERE yol olayı sözleşmeleri fail-closed;
  ayrıştırıcı kapısı (`b36030e`) doğrulanmamış alanların okunmadığını sabitler.
- Kullanıcıdan istenen: (1) her sağlayıcı için yazılı lisans/ToS onayı (G-LEGAL, RM-10); (2) hangi ücretli örnek çağrıların yapılacağı
  (Valhalla `turn_lanes` BL-P2-04, TomTom tünel/gişe BL-P2-06, çıkış/tabela BL-P2-08, VeriApi şeması BL-P2-10) ve bütçe (G-PAID).
- Bağımlılık: D4 çıkış numarası ve BL-P2-06/08 buna bağlı. Fikstürler anahtarsız, kişisel veri/konum geçmişi içermeyecek biçimde
  temizlenir (`server/scrub.mjs`); testler çevrimdışı kalır.
- Kabul: lisans kanıtı kayıtta (`providerPolicy` durumu ancak bundan sonra değişir); fikstür kaynağı/tarihi belgede; sözleşme
  testleri KNOWN-GAP → ACCEPT; `test-provider-policy*`, `test-secret-hardening`, `test-road-events*` geçer.

### D6 — Mobil RM-07 cihaz doğrulaması — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** ilk yayın yalnız KAPALI Beta testi, "cihazda test edilmedi" etiketi, genel erişim yok. Kapalı erişim yöntemi henüz belirlenmedi.
- Bugün: dar ekran sözleşmesi yalnız çevrimdışı model (`577ee24`); A1 (`4721532`), A2a (`bb7045a`), A3 sondası `__navLayout()`
  (`e321ffe`) yerelde; kalan A2b/A4/A5 ve ≈%100 / 1234 km / 3 satır uyarı taşmaları cihaz ölçümü bekliyor.
- Kullanıcıdan istenen: `docs/nav-narrow-layout-contract.md` §6 listesindeki cihazlarda (360×640 Android, 375 iPhone, 393–412 Android;
  varsayılan + büyük yazı; açık/koyu; TR + DE) ölçüm ve ekran görüntüleri; kırpılmanın kabul edilip edilmediği (ürün kararı).
- Bağımlılık: D7 (cihaza Beta/APK ulaşması için push/yayın ya da yerel derleme kararı); www/ ve APK 0.85.x eski (BL-P0-07, RM-09).
- Kabul: madde başına geçti/kaldı + ekran görüntüsü + cihaz/OS/tarayıcı/APK sürümü kayıtta; `verified` yalnız kullanıcı yazar.

### D7 — Kaynak yedeği ve push/yayın kapısı — ONAYLANDI (2026-11-15, uygulanmadı)

- **Karar (2026-11-15, ONAYLANDI):** zorunlu testler + yayın kapıları yeşilse Beta yayını; production yok. Bugün kapılar yeşil değil (Beta NO-GO).
- Bugün: integ `fe5fb45` yalnız yerel (uzakta yok); ana kopya `design/modern-ui-soc` @`0c6dffd` 35 kirli kayıt (sahipli WIP);
  canlı Beta 0.99.61, yerelde 0.99.62–0.99.76 yayımlanmadı.
- Kullanıcıdan istenen: (1) yerel işin yedeği (ör. integ dalının özel uzak dala push'u ya da `git bundle`) yapılsın mı, nereye;
  (2) ana kopya eşitleme yöntemi (BL-P0-02; stash/reset/clean yasak, WIP sahibi onayı); (3) `design/modern-ui-soc`'a push ve
  `build-beta.mjs` ile Beta yayını ne zaman (BL-P0-06); (4) depo görünürlüğü (BL-P0-08).
- Bağımlılık: D6 cihaz testi yayına bağlı; D1–D5 düzeltmeleri yayından önce mi sonra mı — kullanıcı sırası.
- Kabul: push/yayın sonrası salt okunur `git ls-remote` + canlı `version.js` sürüm kanıtı; ana kopyada WIP sağlama toplamları değişmez;
  force-push ve geçmiş yeniden yazma yok.

## 3. Karar gerektirmeyen bağımsız iş

Bu belge yazılırken (integ @`fe5fb45`) kararsız yürütülebilecek, kanıtla güvenli bir uygulama işi belirlenmedi: `beta-next-backlog.md`
§1'deki A1 (regrec) ve A4 test kısmı (`b36030e`) yapıldı; A2 BL-P3-09 için NO-CHANGE + D4 kararı; A3 occupancy kaynak sabitlemesi
D3 kararlarına bitişik olduğundan önce kullanıcıyla kapsamı teyit edilmeli. Yalnız belge/kayıt işleri (bir sonraki regrec) karar
gerektirmez.

## 4. Sonraki D1 kod görevi — küçük güvenli kapsam (öneri, başlatılmadı)

> **2026-11-16 notu (`a0fa9e93`):** bu öneri D1-T1 olarak `405f628` (v0.99.77) ile yapıldı; trafik tarafı D1-T2 `e28ee47` ve D1-T3 `8e2399f` ile. Tekrar açılmaz. `docs/ahead-rain-distance-gap.md` hâlâ GAP'leri "mevcut" diye anlatır (açık belge işi).

- **Ad:** D1-T1, tek görev, tek aktif kod değiştirici. Taban: integ HEAD, yalıtılmış dal/worktree, yalnız `--ff-only`, push/yayın yok.
- **Ön adım (salt okunur):** trafik tarafı (v0.99.56 konumla güncelleme, `aheadTraffic.js` / `trafficGuard.js`) D1'i zaten sağlıyorsa trafik için NO-CHANGE kanıtı; değişiklik yalnız yağış yoluna.
- **Dosyalar:** `js/nav/ahead.js` (yağış yenilemesi: her yenilemede olay konumu yeniden alınır, mesafe güncel araç km'sinden hesaplanır; istek reddi / veri yoksa olay "belirsiz" işaretlenir, eski mesafe gösterilmez/seslendirilmez), `scripts/test-ahead-rain-progress.mjs` (GAP-1/2/3 denetimleri yeni beklenen davranışa **bilinçli** çevrilir; denetim sayısı azalmaz), `version.js` (0.99.77 + changelog), `docs/ahead-rain-distance-gap.md`.
- **Kapsam dışı:** ek Open-Meteo örneği (b), eski olayı körlemesine koruma, yeni i18n dizesi ("belirsiz" için yeni metin gerekirse ayrı D1-T2 + `i18n-validate`), ses anahtarı politikası, sunucu, ağ, push/yayın.
- **Kabul:** `test-ahead-rain-progress`, `test-ahead-events`, `test-ahead-update`, `test-traffic-guard`, `check.mjs`, tüm `scripts/test-*.mjs` 0 FAIL; testteki ağ çağrısı sayısı değişmez; cihazda sürüş gözlemi ayrı (G-DEVICE).

## 5. D3 canlı doluluk — hazırlık envanteri ve sıradaki tek alt görev (2026-11-16, `a0fa9e93`; başlatılmadı)

Salt okunur inceleme, integ @`8e2399f`. Kod değiştirilmedi. Gerçek sağlayıcı çağrısı yapılmadı.

**Mevcut envanter**

| Katman | Dosya | Durum | Test (a0fa9e93 @8e2399f) |
|---|---|---|---|
| Sunucu normalize | `server/availability.mjs` (`buildAvailability`, `fromOcpiLocation`, `fromNdwAvailabilities`, `fromHereItem`, `fromTomTom`, `fromGoogleAggregation`, `fromMockFixture`, `staleness`; `timestampKind` `provider`/`fetched`) | var; NDW/TomTom `fetched` (sağlayıcı zamanı yok) | `test-availability` 39/0 (yalnız sahte fikstür `scripts/fixtures/availability/*`) |
| Sunucu uç | `server/occupancy.mjs` | NDW eski `at: Date.now()` alanı (R3-e kökü) | dolaylı |
| İstemci istemi | `js/routing/occupancyClient.js` | `checked: Date.now()` yazar | dolaylı |
| Fail-closed biçimlendirici | `js/routing/occupancyLabel.js` `formatOccupancy` | var, **hiçbir çalışma zamanı modülüne bağlı değil** | `test-occupancy-label` 154/0 |
| Görüntü bileşeni | `js/ui/occupancyView.js` | var, bağlı değil, `sw.js` SHELL'de yok | `test-occupancy-view` 101/0 |
| Canlı nav/planlayıcı yolu | `js/routing/slots.js` (`slotKind`, `isFresh`, `slotEl`, `slotLabel`), `nearSort.js`, `planner.js`, `nearby.js`, `livePlan.js` | NDW `fetched` kaydını taze/dolu/boş sayar | `test-occupancy-consistency-contract` 34/0, **12/12 KNOWN-GAP açık** (G1–G7) |
| Sağlayıcı sözleşmesi | `server/tomtom.mjs`, `server/veriapi.mjs` | doluluk TomTom'da `fetched`; VeriApi doluluk vermez | `test-tomtom` 36/0, `test-veriapi` 25/0 |
| Kota kapısı | `js/net/providerGate.js`, `server/providerGate.mjs` (`f0f448e`) | tüm harici istekler varsayılan **duraklatıldı** | `test-provider-pause` 111/0 |

**Boşluklar / blokajlar**

- Canlı (gerçek) doluluk doğrulaması bugün **yapılamaz**: `f0f448e` kota koruması istekleri duraklatıyor; gerçek uç noktası ücretli/kotalı (CLAUDE.md §7 onayı); gerçek, temizlenmiş sağlayıcı fikstürü yok (D5); cihaz testi yok (D6). Mevcut tüm kanıt sentetiktir.
- `occupancyDecision` (R3-a) kodda yok (grep 0 eşleşme); biçimlendirici ile `slots.js` arasında köprü yok.
- Kural: "K1/K2 olmadan R3-a bile yazılmaz" (§2 D3). D3 onayı "tazeliği kanıtsız → Bilinmiyor" eşlemesini öneriyor ama teyidi açık.

**Sıradaki tek ≤30 dk kod alt görevi — D3-T1 (= R3-a, öneri, başlatılmadı)**

- **Önkoşul (kullanıcı, tek satır):** K1 = hayır (NDW AFIR varsayımı doğrulama sayılmaz → `unknown`), K2 = bilinmiyor (NDW 0/N), K4 = aynı kural (TomTom `fetched` → `unknown`) eşlemesinin teyidi. K3/K5/K6 kapsam dışı.
- **Dosyalar:** `js/routing/slots.js` — yalnız yeni saf dışa aktarım `occupancyDecision(slots, now)` → `{ trusted, state }` (`formatOccupancy(slots.availability, { now })` sarmalı; `trusted` ⇔ `confirmed === true`; `availability` yoksa `unknown`, A7); mevcut `slotKind`/`isFresh`/`slotEl`/`slotLabel` **değişmez**, çağıran yok. Yeni test `scripts/test-occupancy-decision.mjs` (düz Node, sentetik fikstür, ağ yok). `version.js` 0.99.81 + changelog (CLAUDE.md §8, `js/` değiştiği için).
- **Kabul:** yeni test — Google benzeri sağlayıcı zamanlı taze kayıt `trusted:true` + `free`/`busy`/`out` aynen (A6); NDW `fetched` 2/4 ve 0/4 → `trusted:false, state:'unknown'` (K1/K2); TomTom `fetched` → `unknown` (K4); 3 sa eski → `unknown`; `availability` yok → `unknown` (A7); `checked` tek başına tazelik sayılmaz (A1); `Date.now` yerine `now` parametresi kullanılır. `test-occupancy-consistency-contract` 34/0 ve **12/12 KNOWN-GAP değişmeden** (R3-a bağlı olmadığı için hiçbir G kapanmaz; kapanırsa `GAP CLOSED` = hata); `test-occupancy-label`, `test-availability`, `test-near-sort`, `test-charge-pick`, `test-stop-swap`, `test-route-options`, `check.mjs`, tüm `scripts/test-*.mjs` 0 FAIL (ağ engelleyiciyle); ağ çağrısı yok; i18n değişmez.
- **Kapsam dışı:** R3-b planlayıcı / R3-c nav / R3-d görüntü bağlama, `sw.js`, sunucu (R3-e), gerçek sağlayıcı çağrısı, push/yayın. Yalıtılmış dal, yalnız `--ff-only`.
- **Sonrası (ayrı görevler, sırayla):** R3-b (G5 → ACCEPT), R3-c (G1/G2/G4 → ACCEPT), R3-d (K5 kararı + G3/G6), canlı doğrulama yalnız ücretli çağrı/kota onayı ve cihaz testiyle.
