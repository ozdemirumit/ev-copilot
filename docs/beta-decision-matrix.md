# Beta — bağımlılık ve karar matrisi (D1–D7 ONAYLANDI 2026-11-15; D1 kısmen uygulandı 2026-11-16, D2–D7 uygulanmadı; D3 alt kararları ONAYLANDI 2026-11-16, §8)

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

**2026-11-16 (`0a591021`):** D3'ün açık bıraktığı K1/K2/K4 eşlemesi, yaşlanma kuralı ve K3/K5/K6 kullanıcı tarafından kesin onaylandı; D3-T1..T6 sırası PLANNED kaydedildi → §8. Uygulanmadı.

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

## 6. D3-T0 — salt okunur doluluk karar modeli hazırlığı ve test güvenliği denetimi (2026-11-16, köprü `531d536f`; yalnız belge)

Temel: `integ/beta-2026-11-14` @`dca5a47` (v0.99.80), yalıtılmış worktree `MBRP-d3t0`. Kod, test, `version.js`, sunucu değişmedi.
Gerçek sağlayıcı çağrısı yapılmadı; kullanıcı ücretsiz sağlayıcı kotalarının dolduğunu bildirdi. Aşağıdakilerin tümü kaynak okumasıdır
(sentetik/çevrimdışı); gerçek sağlayıcı yanıtıyla ya da cihazda doğrulanmadı.

### 6.1 K1/K2/K4 durumu — DOĞRULANMIŞ SAYILMAZ

- K1 (NDW "AFIR ≤1 dk" tazelik varsayımı), K2 (NDW 0/N), K4 (TomTom zaman damgası yok) **kullanıcı tarafından teyit edilmedi**.
  §5'teki "K1 = hayır, K2 = bilinmiyor, K4 = aynı" yalnız **öneridir**; D3 onayının ("yalnız doğrulanmış ve güncel") lafzına en yakın
  fail-closed eşlemedir ama karar yerine geçmez. Teyit gelmeden D3-T1 (R3-a) dahil hiçbir D3 kodu yazılmaz.
- Varsayımların hiçbiri gerçek veriyle sınanmadı: NDW ve TomTom yanıtlarında sağlayıcı zamanı olmadığı yalnız mevcut ayrıştırıcı
  kodundan (`server/availability.mjs` `fromNdwAvailabilities`, `fromTomTom` → `timestampKind:'fetched'`) ve `PROVIDERS` kaydından
  okunur; gerçek, temizlenmiş sağlayıcı fikstürü yok (D5). "NDW 0/N ayrıntısız" da yalnız ayrıştırıcıdan çıkarımdır.

### 6.2 Veri kaynağı / tazelik kuralları (kaynak okuması, @`dca5a47`)

Eşikler: biçimlendirici `OCC_THRESHOLDS` (`js/routing/occupancyLabel.js:15`) fresh ≤15 dk, aging ≤2 sa, stale >2 sa, gelecek sapma
>2 dk → `unverified`; `confirmed` yalnız `fresh` + `timestampKind:'provider'` + bilinen kaynak + `simulated:false`. Bugünkü
nav/planlayıcı eşiği `slots.js:4` `FRESH_MS` 15 dk, ama `isFresh` (`slots.js:89`) **okuma anı `checked`**'e bakar (G1 kökü).

| Kaynak | `timestampKind` | Durum | Biçimlendirici bugün | `slots.js` bugün | D3-T1 önerisi (teyit bekler) | Bağlı karar |
|---|---|---|---|---|---|---|
| Google (`fromGoogleAggregation`) | `provider` (`availabilityLastUpdateTime`) | canlı; TR'de veri yok (kayıt: "ölçüldü"), yalnız düşük pil | fresh → free/busy/out + confirmed; aging → durum, confirmed değil; stale → unknown | `checked` tazeliği | fresh → `trusted:true`, durum aynen (A6) | — |
| NDW (`fromNdwAvailabilities`) | `fetched` (`last_updated` son değişim, tazelik değil) | canlı, NL, yalnız sayı | her zaman `unknown` (`unverified-time`) | taze/dolu/boş sayar (G1/G2/G5) | `trusted:false, state:'unknown'` | K1, K2 |
| TomTom (`fromTomTom`) | `fetched` | canlı, TR dahil kısmi; bugün kota koruması altında duraklatılmış | her zaman `unknown` | taze sayar | `trusted:false, state:'unknown'` | K4 |
| HERE (`fromHereItem`) | `provider` (`last_updated`) | `providerPolicy` ile kapalı, lisans `unverified` | — (veri gelmez) | — | Google ile aynı kural; açılması D5'e bağlı | D5 |
| OCPI | `provider` | bağlı besleme yok (`live:false`) | — | — | Google ile aynı kural | — |
| mock | `provider` ama `simulated:true` | yalnız test | her zaman `unknown` (`simulated`) | — | `unknown`, asla trusted | — |
| Topluluk "Dolu bildirildi" | `availability` yok | `slots.js:5` 20 dk planı etkiler | kapsamaz | `full` | R3-a'da `unknown` (A7); planlayıcı etkisi R3-b'de | K3 |
| `availability` alanı yok (eski sunucu, `book`/`veriapi`) | — | — | `unknown` (`no-data`) | `checked` ile taze | `unknown` (A7) | — |

Sonuç (öneri teyit edilirse): Türkiye'de bugünkü kaynaklarla nav/planlayıcıda **güvenilir doluluk pratikte kalmaz** (Google TR'de veri
vermiyor, TomTom/NDW `fetched`); NL'de NDW'ye dayalı boş/dolu eleme ve "dolu" uyarısı kaybolur. Bu, D3 onayının bilinen ürün
sonucudur ve K1/K4 teyidinde kullanıcıya açıkça söylenmelidir.

### 6.3 Kararsız noktalar (kullanıcı; D3-T1 öncesi ya da ilgili aşamadan önce)

1. **K1 / K2 / K4 teyidi** (D3-T1 önkoşulu). K1 = evet seçilirse R3-a değişir: biçimlendiricide ayrı güven sınıfı (ör. `fetched-trusted`)
   gerekir, `test-occupancy-label` beklentileri bilinçli güncellenir ve K2 (0/N dolu mu) ancak o zaman anlam kazanır; K1 = hayır iken
   0/N zaten `unknown`.
2. **Aging (15 dk–2 sa) kaydı:** karar katmanında (planlayıcı/nav) `unknown` mu (D3 lafzı; öneri), yoksa yalnız görüntüde "X dk önce"
   ile gösterilsin mi? Görüntü tarafı K5/R3-d ile birlikte karara bağlanır; R3-a yalnız `trusted` bayrağını sabitler.
3. **K3** topluluk bildirimi planlayıcıyı etkilesin mi (R3-b/R3-c). R3-a bunu değiştirmez.
4. **K5** `slotEl` düzelt / `occupancyView` bağla (+`sw.js` SHELL) — R3-d.
5. **K6** NDW fiyatının "(canlı)" etiketi — ayrı görev mi (BL-P2-10 ile ilişkili).
6. **R3-e** sunucu NDW eski `at` alanı — sunucu yeniden başlatma onayı.
7. **Canlı doğrulama yolu:** kota dolu; gerçek yanıt yalnız G-PAID + kota yenilenmesi + temizlenmiş fikstür (D5) ile; cihaz D6.

### 6.4 Test koruma riskleri (salt okunur analiz; bu testler engelleyicisiz çalıştırılmamalı)

- **Kök neden:** `server/proxy.mjs:778` açılışta `tesla.get()` çağırır; `server/tesla.mjs:7` `SOURCE` sabit
  (`https://supercharge.info/service/supercharge/allSites`, ortam değişkeniyle yönlendirilemez); `DATA_DIR`'de `tesla.json` yoksa
  (`tesla.mjs:23-25`, TTL 24 sa) hemen gerçek istek atılır. Kota koruması (`server/providerGate.mjs`, `proxy.mjs:51-52`) bunu normalde
  keser, fakat `scripts/test-map-provider.mjs` (4 `spawn` yeri: satır 138, 1166, 1613, 1994) ve `scripts/test-providers-endpoint.mjs`
  (satır 57-59) alt sunucuyu `PROVIDER_REQUESTS_PAUSED: '0'` ile başlatır ve geçici `DATA_DIR`'e `tesla.json` koymaz → her sunucu
  açılışında `supercharge.info` denemesi. Önceki engelleyicili koşularda 20 deneme durduruldu (17 + 3; kayıt `4bc2adc1`, `a0fa9e93`).
  Bu testlerde diğer sağlayıcılar yerel sahte üst sunucuya (`127.0.0.1:18799/18809/18860`) yönlendirilmiş; okumada bulunan tek sızıntı Tesla.
- `supercharge.info` anahtarsız topluluk verisidir (ücretli değil) ama yine de **harici istektir** ve engellenmelidir.
- **Mevcut engelleyici:** depo dışı `D:/AI-Codes/netguard-tmp/netguard.mjs` (`NODE_OPTIONS=--import=…`, `NETGUARD_LOG`). `fetch` ve
  `net.Socket.prototype.connect`'i yerel olmayan ana makine için reddeder; alt süreçlere `...process.env` ile geçer. Sınırları:
  `dgram`/UDP kapsanmaz (testlerde kullanım bulunmadı); depo dışında olduğu için CI/başka makinede yok.
- **Engelleyici açığı (bu görevde bulundu, çevrimdışı öz-sınama):** `net.connect(port, host)` / `http(s).request` Node içinde
  `socket.connect([options, cb])` dizi biçimine normalleşir; `netguard-tmp/netguard.mjs` ana makine adını diziyi açmadan okuduğu için
  bu yolu **engellemez** (öz-sınamada `.invalid` adı DNS'e kadar gitti) ve DNS çözümlemesini hiç engellemez. Güvenilir kesilen yollar:
  global `fetch` ve nesne biçimli `tls.connect`. Depoda fetch dışı tek ağ yolu `server/mailer.mjs:26` (SMTP; testlerde SMTP anahtarı
  boş). Bu görev ortak dosyayı değiştirmedi; koşu, depo dışı düzeltilmiş kopya `D:/AI-Codes/d3t0-logs/netguard-fixed.mjs` ile yapıldı
  (dizi açma + yerel olmayan DNS reddi; öz-sınamada fetch/net/https/tls/dns yerel olmayan 5/5 engellendi, yerel fetch ve http geçti).
  Sonraki koşular bu kopyayı ya da aynı düzeltmeyi kullanmalı.
- **Önerilen test-yalnız düzeltme (ayrı görev T-SAFE-1, ürün kararı gerektirmez, başlatılmadı):** iki testte her `start()` öncesi geçici
  `DATA_DIR`'e `tesla.json = { at: Date.now(), sites: [] }` yazmak (TTL içinde → `refresh()` çağrılmaz). Dosyalar yalnız
  `scripts/test-map-provider.mjs`, `scripts/test-providers-endpoint.mjs`; çalışma zamanı değişmez, sürüm artmaz, denetim sayısı aynı
  kalır (bu testlerde `/v1/tesla` denetlenmiyor). Kabul: engelleyici günlüğü bu iki test için 0 satır; geçen/başarısız sayıları önceki koşuyla aynı.
  Alternatif `TESLA_SOURCE` ortam değişkeni sunucu değişikliğidir (ayrı onay).
- **D3-T1 testine özgü kural:** `occupancyDecision` testi `Date.now` yerine `now` parametresi kullanmalı, yalnız sentetik fikstür okumalı,
  sunucu başlatmamalı, `fetch` çağırmamalı. `test-occupancy-consistency-contract` 12/12 KNOWN-GAP sayısı R3-a ile **değişmemeli**.

### 6.5 Uygulama bağımlılık sırası (D3)

1. **T-SAFE-1** (karar gerektirmez; önerilen ilk iş): iki testin Tesla sızıntısını test içinde kapat → tüm paket engelleyicide 0 blok.
2. **Kullanıcı:** K1/K2/K4 teyidi (+ aging kuralı, §6.3-2).
3. **D3-T1 = R3-a** (§5 tanımı; K1 = evet seçilirse kapsam yeniden yazılır): saf `occupancyDecision`, çağıran yok, `version.js` artışı.
4. **R3-b** planlayıcı (K3 gerekir) → **R3-c** nav kararları → **R3-d** görüntü (K5) → **R3-e** sunucu (yeniden başlatma onayı).
5. Canlı doğrulama: kota/G-PAID onayı + temizlenmiş fikstür (D5) + cihaz (D6). `verified` yalnız kullanıcı.

## 7. Durum kaydı 2026-11-16 — D3-T0 ve T-SAFE-1 tamamlandı; depo içi test ağ engelleyicisi yazıldı (COMMIT EDİLMEDİ — STOP); D3 kullanıcı kararları BEKLİYOR (köprü `83d3680e`; yalnız test altyapısı + belge)

Temel: `integ/beta-2026-11-14` @`0987a72` (v0.99.80, yerel, temiz), yalıtılmış worktree `MBRP-netguard`, dal `test/netguard-hardening-0987a72`.
Uygulama `js/`, `server/`, `version.js`, `sw.js`, navigasyon ve şarj davranışı **değişmedi**; sürüm artmaz. Gerçek sağlayıcı isteği (ücretli
ya da ücretsiz) yapılmadı. Push/yayın/cihaz yok; **Beta NO-GO** sürüyor.

### 7.1 Tamamlanan görevler (yerel entegre; `verified` DEĞİL)

| Köprü | Oturum | İş | Commit | Entegrasyon (git'ten okundu) |
|---|---|---|---|---|
| `531d536f` | `7e7face6` | D3-T0: salt okunur doluluk karar modeli hazırlığı + test güvenliği denetimi (§6) | `9394189` (yalnız belge: bu dosya §6 + `docs/beta-next-backlog.md` §1a) | `--ff-only` integ, reflog 2026-11-16 04:47:37 +0300; köprü `completed`, çıkış 0 (01:39–01:48Z) |
| `8a21b5a9` | `cfbf8802` | T-SAFE-1: `test-map-provider` / `test-providers-endpoint` her `start()` öncesi geçici `DATA_DIR`'e taze boş `tesla.json` yazar → sunucu açılışında `supercharge.info` isteği yok | `0987a72` (yalnız iki test dosyası, +5 satır) | `--ff-only` integ, reflog 2026-11-16 06:39:47 +0300; köprü `completed`, çıkış 0 (03:33–03:40Z) |

"Tamamlandı" = commit + çevrimdışı testler + yerel `--ff-only`. Push, Beta yayını, gerçek cihaz ya da gerçek sağlayıcı yanıtıyla doğrulama yok.

### 7.2 Depo içi test ağ engelleyicisi (bu görev; yalnız test altyapısı; commit edilmedi)

- **Dosyalar:** `scripts/netguard.mjs` (engelleyici; `NODE_OPTIONS=--import=…` ile yüklenir, uygulama/sunucu içe aktarmaz),
  `scripts/test-netguard.mjs` (öz-sınama), `scripts/run-tests-guarded.mjs` (ön denetim + `check.mjs` + tüm `scripts/test-*.mjs` sıralı).
  Depo dışı `D:/AI-Codes/netguard-tmp/netguard.mjs` ve `D:/AI-Codes/d3t0-logs/netguard-fixed.mjs` yalnız okundu, değiştirilmedi.
- **Kapatılan açıklar (§6.4'e ek):** `dns.resolve*` / `reverse` / `lookupService` (geri çağrı, `dns.promises`, `dns.Resolver`,
  `dns.promises.Resolver`; c-ares DNS sunucusuna doğrudan gider, `lookup` sarmalayıcısını atlar) her zaman reddedilir; `dgram`
  `send`/`connect` yerel olmayan adrese ve çoklu yayın üyeliği reddedilir; `/^127\./` ad açığı (`127.evil.invalid` yerel sayılıyordu)
  kapandı — yalnız `localhost` ve loopback IP (127/8, `::1`, `::ffff:127/104`) izinli, `0.0.0.0` değil; `localhost` çözümü ve özel
  `lookup` seçeneği sonucu loopback değilse reddedilir; ESM adlandırılmış içe aktarmalar (`import { resolve4 } from 'node:dns'`)
  `syncBuiltinESMExports` ile kapsanır; `child_process` çağrılarına engelleyici `NODE_OPTIONS` ile enjekte edilir — böylece
  `test-package-parity`'nin ortamı PATH/SystemRoot'a indirerek başlattığı `build-beta.mjs` çocuğu da korunur (eski engelleyicide
  korumasızdı); `worker_threads.Worker`, `process.binding(ağ sarmalayıcıları)`, `process.dlopen` reddedilir. `dns.setServers`
  sarmadan ÖNCE loopback'e çekilir (Node `setServers` dışa aktarımları yeniden bağlar; öz-sınama bu sıralama hatasını yakaladı).
- **0 gerçek DNS/ağ denemesi kanıtı:** `test-netguard` engelleyiciyi, hiçbir zaman ağa çıkmayan tuzak (tripwire) işlevlerin
  ÜSTÜNE kurar ve yalnız sentetik `.invalid` / RFC 5737 `192.0.2.x` hedefleriyle her yolu dener: her yerel olmayan denemede
  engelleyici reddeder VE alttaki tuzağa inen çağrı 0'dır; loopback kontrolleri tuzağa ulaşır (sınama boş değil). Gerçek alt süreç
  ve ortamı indirilmiş torun süreçte tüm uçların sarılı olduğu yalnız işaret denetimiyle (ağ çağrısı olmadan) doğrulanır.
  Sonuç: `test-netguard` **214/0** (tek başına ve dış engelleyici altında; ikinci durumda dış günlük hiç oluşmadı).
- **Koşu (`node scripts/run-tests-guarded.mjs`, belge düzenlemesinden önce, @`0987a72` + 3 yeni betik):** `check.mjs` v0.99.80 / 267 kayıt / 185 dosya çıkış 0; 95 dosya (check + 94 test) 94 PASS / **1 FAIL** (`test-station-card-layout` 57/1, "chromium 320x568: kart ve olanaklar yüklendi" chips=0); 0 BLOCK satırı; node dışı çocuklar `Playwright.exe`, `chrome.exe`, `git`, `icacls`. **Bu koşuda Chromium ve WebKit gerçekten başlatıldı ve Node engelleyicisinin DIŞINDA çalıştı** (bkz. aşağı).
- **Tarayıcı engellendikten sonra (2. koşu):** ön denetim 214/0; `check.mjs` 185 dosya çıkış 0; 95 dosya 94 PASS / **1 FAIL** (`test-station-card-layout`: `browserType.launch` → `BLOCK_CHILD chrome.exe`, tarayıcı hiç başlamadı); tam olarak 1 BLOCK satırı (o `chrome.exe`), ağ BLOCK satırı 0; `test-map-provider` 534/0 ve `test-providers-endpoint` 44/0 **0 blok → 0 `supercharge.info`** (T-SAFE-1 korunuyor); `test-package-parity` 56/0, `test-beta-tracker` 64/0; node dışı çocuk yalnız `git`, `icacls`.
- **STOP — tarayıcı testi engelleyicinin dışında:** `scripts/test-station-card-layout.mjs` (yerelde `%TEMP%\evrf-ocr\node_modules\playwright-core`
  ve `ms-playwright` tarayıcıları varsa) Playwright ile `chrome.exe` / `Playwright.exe` başlatır. Sayfa istekleri test içinde `p.route` ile
  yerel olmayanlara 404 döner ve Playwright arka plan ağını kapatan bayraklar (`--disable-background-networking`, `--disable-component-update` …)
  kullanır; ama tarayıcı süreci Node engelleyicisinin kapsamı dışındadır, bu yüzden "0 harici deneme" **kanıtlanamaz**. Önceki engelleyicili
  koşularda da (`d3t0-logs`, `tsafe1-logs`) bu test tarayıcıyı başlatıyordu; "0 blok" o koşularda tarayıcıyı kapsamıyordu. Bu görevde bir koşu
  (1. koşu) tarayıcıyı başlattı — fark edildikten sonra engelleyici fail-closed yapıldı (izinli node dışı çocuk yalnız `git`, `icacls`) ve
  tarayıcılı koşu tekrarlanmadı. Görev kuralı (sızma olasılığı → STOP, 0 FAIL) gereği **commit ve integ ff yapılmadı**; değişiklikler
  `MBRP-netguard` worktree'sinde commit edilmemiş durur. **Kullanıcı kararı gerekir** (seçenekler, öneri değil karar sizin):
  (a) tarayıcı testi engelleyicili koşuda `PLAYWRIGHT_CORE`'u yok bir yola çevirerek testin kendi "atlandı" yoluna düşsün (tarayıcı
  denetimleri bu koşuda sayılmaz — CLAUDE.md §4 "atlama" kuralı nedeniyle açık onay ister); (b) tarayıcı başlatmaya izin verilsin, sayfa
  `p.route` + Playwright bayraklarıyla sınırlı kabul edilsin (artık risk kabulü); (c) tarayıcı testi yalnız işletim sistemi düzeyinde
  dış ağ engeli (güvenlik duvarı kuralı; yönetici yetkisi) altında koşulsun.
- **Kalan sınırlar (bilinçli):** engelleyici yalnız Node süreçlerini korur (işletim sistemi güvenlik duvarı değildir); node olmayan
  çocuk süreçler `git`/`icacls` dışında reddedilir (izinliler `INFO_CHILD` olarak günlüğe girer; pakette `git status` ve `icacls` yerel); `internalBinding` yalnız
  `--expose-internals` ile erişilebilir, testlerde yok. Ön denetim başarısızsa koşucu hiçbir testi çalıştırmaz (çıkış 2) —
  bu görevde bir kez tetiklendi (öz-sınama beklentisi koşucu ortamına göre düzeltildi, engelleyici değişmedi), testler o koşuda başlamadı.

### 7.5 Kullanıcı kararı (b) uygulandı — tarayıcı testi sınırlı izinle; commit + integ ff (köprü `6883b3a8`, 2026-11-16)

Kullanıcı kararı (aynen): *"Playwright testlerinin mevcut yönlendirmelerle çalıştırılmasındaki kalan ağ riskini kabul ediyorum. Ücretli
sağlayıcı isteklerini yine de engelle."* Kapsam: yalnız Playwright'ın mevcut `p.route` yönlendirmeleri, Playwright'ın varsayılan arka plan
ağ kapatma bayrakları ve mevcut test sınırlarıyla başlatılması. Ücretli/kotalı sağlayıcı çağrısı, genel ağ açılması, canlı yayın ya da test
atlama onayı **değildir**. §7.2'deki STOP bu kararla kapandı; `83d3680e`'nin commit edilmemiş 6 dosyası `6883b3a8` tarafından sahiplenildi.

- **`scripts/netguard.mjs`:** Node dışı çocuk süreç yine fail-closed (`git`/`icacls` dışında red). TEK istisna: çağıran betik
  `test-station-card-layout.mjs` ise (`BROWSER_SCRIPTS`), yalnız `spawn` ile, yalnız `%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe`
  ya da `webkit-*\Playwright.exe`, yalnız headless + pipe (Chromium'da `--disable-background-networking` ve `--remote-debugging-pipe`
  zorunlu; `--remote-debugging-port`, `--proxy-*`, `--host-rules`, `--load-extension` yasak) ve yalnız Playwright bu engelleyici
  tarafından sarılmışsa (`Module._load`) → `INFO_BROWSER`. Playwright sarmalı: `launch` yalnız `executablePath`/`headless`/`timeout`
  (`args`, `ignoreDefaultArgs`, `proxy`, `channel`, `headless:false` red); `launchPersistentContext`/`launchServer`/`connect`/
  `connectOverCDP` ve örtük `browser.newPage` red; `newContext` `serviceWorkers:'block'` zorunlu, `proxy` red; `goto` yalnız loopback ve
  ancak `'**/*'` route kurulduktan sonra; route içinde harici isteğe `continue`/`fallback`/`fetch` → `abort` + `BLOCK_BROWSER_CONTINUE`;
  route'tan geçmeyen ya da kapanışta bekleyen harici istek → `BLOCK_BROWSER_UNROUTED`; gerçek sunucu adresli (`serverAddr`) harici yanıt →
  `BLOCK_BROWSER_NETWORK`. Yerelde sahte yanıtlanan harici istek `INFO_BROWSER_MOCKED_PROVIDER` (ücretli/kotalı sağlayıcı ya da onlara
  vekil kendi sunucumuz `evcopilot.duckdns.org`) / `INFO_BROWSER_MOCKED_HOST`. Günlüğe yalnız ana makine adı girer (yol/sorgu girmez).
- **`scripts/run-tests-guarded.mjs`:** tüm testlere `EVRF_REQUIRE_BROWSER=1` (tarayıcı bölümü atlanamaz); `test-station-card-layout`
  çıktısında "atlandı" varsa ya da Chromium+WebKit için `INFO_BROWSER` yoksa FAIL; başka betikte tarayıcı satırı FAIL; özet tarayıcı
  satırlarını listeler. İzinli betik listesi `netguard.mjs`'ten metin olarak okunur (koşucu kendini sarmaz).
- **`scripts/test-netguard.mjs`:** 214 önceki denetim değişmedi; +74 denetim (sahte Playwright nesneleri ve tuzak `child_process`; gerçek
  tarayıcı/ağ yok) → **288/0**. Depo dışı geçici kopyada 3 mutasyon (continue serbest, bayrak denetimi yok, `serverAddr` yok sayılır)
  sırasıyla 3, 4, 1 FAIL üretti.
- **Sonuç (`run-tests-guarded`, @`0987a72` + bu değişiklik):** ön denetim 288/0; `check.mjs` v0.99.80 / 185 dosya çıkış 0;
  **95/95 PASS, 0 FAIL, 0 BLOCK**; `test-station-card-layout` 58/0 (Chromium + WebKit gerçekten çalıştı). Sayfanın 24 harici isteği
  (`evcopilot.duckdns.org` `/v1/me`, `/v1/station/info`, `/v1/sync`, `/v1/tariffs`; 3 görünüm × 2 tarayıcı) testin route'u ile
  yerelde yanıtlandı (`/v1/station/info` sahte veri, diğerleri 404); gerçek sunucuya ulaşan sayfa isteği 0.
- **Kalan risk (kabul edildi, sıfır iddiası YOK):** tarayıcı sürecinin kendi ağ yığını (bileşen güncelleme, güvenli tarama, DNS ön
  çözümleme, WebKit iç istekleri vb.) Node engelleyicisinin dışındadır; yalnız Playwright'ın varsayılan bayraklarıyla (`--disable-background-networking`,
  `OptimizationHints`/`NetworkTimeServiceQuerying`/`PreconnectToSearch` kapalı …) sınırlıdır ve gözlenemez. WebKit'te eşdeğer bayrak yoktur.
  Ek sertleştirme önerisi (uygulanmadı, ayrı onay gerekir): Chromium'a `--host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"` ya da
  işletim sistemi güvenlik duvarı kuralı (seçenek c).
- Ürün kodu (`js/`, `server/`, `css/`, `index.html`, `version.js`, `sw.js`) değişmedi; sürüm artmaz. Push/yayın/cihaz yok; **Beta NO-GO** sürer.

### 7.3 BEKLEYEN kullanıcı kararları — onay verilmedi, doğrulanmış sayılmaz — **2026-11-16: ONAYLANDI (§8)**

| Karar | Soru | Durum | Bağladığı iş |
|---|---|---|---|
| K1 | NDW "AFIR ≤1 dk" tazelik varsayımı kabul mü? | ~~bekliyor~~ → **onaylandı 2026-11-16** (§8: zaman damgası zorunlu) | D3-T1 (R3-a) önkoşulu |
| K2 | NDW 0/N (ayrıntısız) dolu mu, bilinmiyor mu? | ~~bekliyor~~ → **onaylandı 2026-11-16** (§8: NDW 0/N doğrulanmamışsa Bilinmiyor) | D3-T1 |
| K4 | TomTom `fetched` (sağlayıcı zamanı yok) için aynı kural mı? | ~~bekliyor~~ → **onaylandı 2026-11-16** (§8: ingest, zaman damgası yoksa canlı değil) | D3-T1 |
| Aging | 15 dk–2 sa yaşındaki doluluk karar katmanında `unknown` mu, yalnız görüntüde "X dk önce" mi? (§6.3-2) | ~~bekliyor~~ → **onaylandı 2026-11-16** (§8: 15 dk'dan eski → Bilinmiyor) | D3-T1 `trusted` bayrağı; görüntü K5/R3-d |

> **2026-11-16 (`0a591021`) notu:** aşağıdaki paragraf yazıldığı anki (`6883b3a8`) durumu anlatır; dört alt karar ile K3/K5/K6 artık onaylıdır (§8). R3-e sunucu yeniden başlatma onayı hâlâ ayrıdır.

D3 kararı (`approved`, 2026-11-15) yerinde; yukarıdaki dört alt karar **teyit edilmedi**. D3-T1 dahil hiçbir D3 kodu bu kararlar
gelmeden başlatılmaz. K3, K5, K6 ve R3-e sunucu onayı da ayrıca açıktır (§6.3).

### 7.4 Sıradaki D2 ve D4 alt görevleri — yalnız belge (başlatılmadı; paralel kod görevi açılmadı)

Kural: aynı anda tek kod değiştirici görev; her biri integ HEAD'den yalıtılmış worktree, `scripts/run-tests-guarded.mjs` 0 FAIL / 0 BLOCK,
yalnız `--ff-only`, push/yayın yok. Karar (`approved`) uygulama izni değildir; kullanıcı girdisi
gerektirmeyen alt görev de yalnız ayrı, açık görev istemiyle başlatılır.

| Alt görev | Kapsam (öneri) | Kullanıcı girdisi / kapı | Kabul |
|---|---|---|---|
| D2-T1 | `server/proxy.mjs` `mapbox()` rota yolunda Premium yetki denetimi; yetki yoksa Free yedek (Valhalla) — M1/M1b | sunucu yeniden başlatma ayrı onay (canlıya alma); Free yedek sağlayıcısının Valhalla olduğu teyidi | `test-mapbox-route-gate` M1/M1b KNOWN-GAP → `ok`; `test-provider-policy*`, `test-secret-hardening`, `test-proxy-retry`, `test-provider-pause` geçer; `f0f448e` kota duraklatması korunur; sürüm artışı |
| D2-T2 | Mapbox rotası aylık sınır + sayaç (M2/M2b); sınırda Free yedeğe düşüş | **aylık kota değeri** (kullanıcı) | M2/M2b KNOWN-GAP → `ok`; sayaç `DATA_DIR` sahte dizinde sınanır; anahtar değeri hiçbir yerde görünmez |
| D4-T0 | Örnek cümle fikstürü (yol adı, çıkış no, "ardından", yuvarlama/eşikler) — yalnız test + belge, KNOWN-GAP olarak | örnek cümle listesinin **onayı** | `test-nav-panel`, `test-lanes` geçer; davranış değişmez |
| D4-T1 | `js/nav/steps.js` Türkçe cümle kurucusu: onaylı fikstüre göre yol adı / çıkış no / birleşik manevra | D4-T0 onayı; çıkış numarası verisi D5 / BL-P2-08'e bağlı | fikstür KNOWN-GAP → `ok`; sürüm artışı; sesli çıktı cihazda (G-DEVICE) |
| D4-T2 | 12 → 16 dil (BL-P3-08) | **eklenecek 4 dilin adı** (kullanıcı) | `i18n-validate` (yer tutucular korunur); sürüm artışı |

Önerilen sıra (karar değildir): K1/K2/K4 + aging gelirse **D3-T1**; gelmezse kullanıcı girdisi gerektirmeyen tek aday **D2-T1**
(canlıya alma yine sunucu onayı ister). D4-T0 örnek cümle onayıyla başlar. Hiçbiri bu görevde başlatılmadı.

## 8. D3 onaylı alt kararlar ve bağımlılık kuyruğu (2026-11-16, köprü `0a591021`; yalnız belge, uygulanmadı)

Temel: `integ/beta-2026-11-14` @`4934476` (v0.99.80, yerel, temiz), yalıtılmış worktree `MBRP-d3dec`, dal `docs/d3-decisions-4934476`.
Kullanıcı aşağıdaki D3 alt kararlarını görev isteminde **kesin onayladı**. Bunlar ürün kararıdır; ücretli/kotalı sağlayıcı çağrısı,
sunucu yeniden başlatma, push/yayın ya da production izni **değildir** (CLAUDE.md §7). Kod, test, `version.js`, `sw.js`, sunucu değişmedi;
harici API çağrısı, Playwright ve sunucu başlatma yapılmadı. Makine okunur kopya: JSON `decisions[D3].sub_decisions` ve `task_queue`.

### 8.1 Onaylı kararlar

| # | Karar (onaylı, 2026-11-16) | Yerini aldığı açık nokta | Uygulamada açık kalan ayrıntı |
|---|---|---|---|
| K1 | Sağlayıcı **zaman damgası zorunlu**; zaman damgası yoksa arayüz **"Bilinmiyor"**. | §6.3-1, §7.3 K1 (NDW "AFIR ≤1 dk" varsayımı doğrulama sayılmaz) | — |
| K2 | NDW **0/N doğrulanmamışsa "Bilinmiyor"** (dolu sayılmaz). | §7.3 K2 | — |
| K4 | TomTom dahil sağlayıcı doluluk verisi **ingest edilir** (alınır/normalize edilir), fakat zaman damgası yoksa K1 gereği **doğrulanmış canlı doluluk gösterilmez**. | §7.3 K4 | ingest kapsamı D3-T2'de |
| AGE | **15 dakikadan eski** doluluk verisi **"Bilinmiyor"** sayılır. | §6.3-2, §7.3 aging | bugünkü biçimlendirici `OCC_THRESHOLDS` 15 dk–2 sa aralığını "aging" durumu ile gösterir; D3-T1/T4'te bu karara göre bilinçli uyarlanır (test gevşetilmez) |
| K3 | **Topluluk bildirimi resmî doluluktan ayrı** veri; resmî doluluk durumunu belirlemez/üzerine yazmaz. | §6.3-3 | planlayıcıyı etkileyip etkilemeyeceği bu kararda ayrıca belirtilmedi → D3-T3 veri ayrımını yaptı (§8.6), planlayıcıyı DEĞİŞTİRMEDİ; planlayıcı etkisi AÇIK (ayrı karar) |
| K5 | Arayüz **üç durum**: **Müsait / Dolu / Bilinmiyor**. | §6.3-4 | uygulama yolu (`slotEl` düzeltme / `occupancyView` bağlama + `sw.js` SHELL) D3-T4'te |
| K6 | **"Canlı" etiketi yalnız doğrulanmış güncel fiyat** verisine. | §6.3-5 | "doğrulanmış güncel fiyat" ölçütü D3-T5'te testle sabitlenir (BL-P2-10 ile ilişkili) |

Sonuç (bilinen ürün etkisi, §6.2): bugünkü kaynaklarla NDW ve TomTom kayıtları `fetched` (sağlayıcı zamanı yok) olduğundan K1/K4 gereği
doğrulanmış canlı doluluk olarak gösterilmez; Türkiye'de güvenilir doluluk pratikte kalmaz, NL'de NDW'ye dayalı boş/dolu eleme kaybolur.
Bu sonuç gerçek sağlayıcı yanıtıyla doğrulanmadı (yalnız ayrıştırıcı kaynağı; D5 fikstürü yok).

### 8.2 Onaylı bağımlılık sırası — hepsi PLANNED (başlatılmadı, çalışmıyor, tamamlanmadı)

| Sıra | Görev | Kapsam | Kararlar | Bağımlı | Durum |
|---|---|---|---|---|---|
| 1 | **D3-T1** | Saf `occupancyDecision` + zaman damgası / 15 dk testleri (eski R3-a; çağıran yok, sentetik fikstür, `now` parametresi, ağ yok; `test-occupancy-consistency-contract` 12/12 KNOWN-GAP değişmez; `js/` değişirse sürüm artışı) | K1, K2, K4, AGE | — | COMPLETED — yerel entegre (`c759f62`, `ec585e43`, v0.99.81; §8.4) |
| 2 | **D3-T2** | NDW / TomTom bağdaştırıcısı: ingest, zaman damgası yoksa doğrulanmamış (sunucu değişirse canlıya alma = sunucu yeniden başlatma onayı, eski R3-e) | K1, K2, K4 | D3-T1 | COMPLETED — yerel entegre (`045a257`, `ddb92ce9`; sunucu bağdaştırıcısı bağlı, istemci/UI bağlı değil; §8.5) |
| 3 | **D3-T3** | Topluluk bildirimi ayrı veri | K3 | D3-T1 | RUNNING → yerel commit + `--ff-only` integ (`aa4c329c`, v0.99.82; veri modeli, bağlı değil, planlayıcı değişmedi; §8.6) |
| 4 | **D3-T4** | Üç durum arayüz Müsait / Dolu / Bilinmiyor (eski R3-d; nav/planlayıcı hizalaması R3-b/R3-c ile ilişkili; i18n değişirse `i18n-validate`) | K5, AGE | D3-T1, D3-T2, D3-T3 | PLANNED |
| 5 | **D3-T5** | Fiyat "Canlı" etiketi yalnız doğrulanmış güncel fiyata | K6 | D3-T1 | PLANNED |
| 6 | **D3-T6** | Regresyon: `run-tests-guarded` tam paket + D3 sözleşme testleri | tümü | D3-T1..T5 | PLANNED |

Kurallar: aynı anda tek kod görevi; her görev integ HEAD tabanlı yalıtılmış worktree, `scripts/run-tests-guarded.mjs` 0 FAIL / 0 BLOCK,
yalnız `--ff-only`, push/yayın yok; gerçek sağlayıcı çağrısı yok; cihaz doğrulaması ayrı, `verified` yalnız kullanıcı yazar.
Bu kuyruk §5/§6.5'teki R3-a…R3-e sırasının yerini alır (R3 kimlikleri yalnız geçmiş için korunur).

**Sıradaki tek görev: D3-T1** (ayrı, açık görev istemiyle; bu görevde başlatılmadı). → 2026-11-16 `ec585e43` ile çalıştırıldı (§8.4); **sıradaki: D3-T2**.

### 8.3 Uzlaştırma (bu görev)

- `e62eea0a` (oturum `33c1f375`): D2 Premium/kota/Free yedek salt okunur envanteri **tamamlandı**, `no-change` (dosya değişmedi; rapor köprü sonucunda). D2 `approved`, uygulanmadı; D2-T1/T2 §7.4'teki gibi başlatılmadı.
- `6883b3a8` (oturum `3760013d`): `running`/`isolated` → **completed / yerel entegre**; commit `4934476` = integ HEAD; `run-tests-guarded` **95/95 PASS**, 0 FAIL, 0 BLOCK (görevin kendi koşusu, §7.5).
- D1 tamamlanan kayıtları (`405f628`, `e28ee47`, `8e2399f`) değişmedi.

### 8.4 D3-T1 uygulandı — saf `occupancyDecision` (2026-11-16, köprü `ec585e43`; bağlı değil, v0.99.81)

Temel: `integ/beta-2026-11-14` @`f984e70` (görev başında temiz; `f984e70` integ atası doğrulandı), yalıtılmış worktree `MBRP-d3t1`, dal `feat/occupancy-decision-d3-t1`.

- **Yeni:** `js/routing/occupancyDecision.js` — `occupancyDecision(input, { now })` → `{ trusted, state, reason, source, ageMin }`, `OCC_DECISION_MAX_AGE_MS` = 15 dk.
  Saf (saat/ağ/DOM/depolama yok), yalnız `./occupancyLabel.js` içe aktarır; `trusted:false` ise `state` daima `unknown` ("Bilinmiyor").
  - K1: `timestampKind:'provider'` + sonlu `at` yoksa `no-timestamp`; `now` yok/geçersizse `no-now` (saat okunmaz).
  - K4: TomTom/NDW `fetched` (ingest edilmiş, `at` = okuma anı) → `unknown`; kaynak verisini almak gösterim doğrulaması değildir; `checked` tazelik sayılmaz.
  - K2: NDW 0/N (hiç boş yok) → `ndw-zero-unverified`; bugün NDW doğrulama yolu yok, sağlayıcı zamanlı olsa bile 0/N `unknown`.
  - AGE: `now - at` > 15 dk → `aged` (≤2 sa) / `stale` (>2 sa); tam 15 dk güncel sayılır; >2 dk gelecek zaman → `no-timestamp`.
- **Test:** `scripts/test-occupancy-decision.mjs` 64/0 (sentetik, `server/availability.mjs` yardımcıları `now` parametresiyle; sunucu/fetch/harici API yok; modül yokken içe aktarma hatası; 3 mutasyon yakalandı).
  Çağıran yok denetimi: `js/`, `server/`, `sw.js`, `index.html` modülü anmaz.
- **Dokunulmadı:** `slots.js`, `occupancyLabel.js`, `occupancyView.js`, `occupancyClient.js`, sunucu bağdaştırıcıları, UI, i18n, `sw.js`. `test-occupancy-consistency-contract` 12/12 KNOWN-GAP değişmedi (bağlı olmadığı için hiçbir G kapanmaz).
- **Doğrulama durumu:** yalnız çevrimdışı/sentetik; gerçek sağlayıcı yanıtıyla ve gerçek cihazda doğrulanmadı; push/yayın yok. Tarayıcı ağ riskinin sıfır olduğu iddia edilmez.
- **Sıradaki:** D3-T2 (NDW/TomTom bağdaştırıcısı; sunucu değişirse canlıya alma = sunucu yeniden başlatma onayı).

### 8.5 D3-T2 uygulandı — NDW/TomTom bağdaştırıcısı → saf karar (2026-11-16, köprü `ddb92ce9`; sürüm değişmedi)

Temel: `integ/beta-2026-11-14` @`c759f62` (görev başında temiz; D3-T1 köprüde completed/çıkış 0 ve integ HEAD olarak doğrulandı), yalıtılmış worktree `MBRP-d3t2`, dal `feat/occupancy-adapter-d3-t2`.

- **Bağlama:** `server/availability.mjs` `withOccupancyDecision(result, now)` — sonuca ek `decision` alanı (`occupancyDecision(result.availability, { now })`); saf, girdiyi değiştirmez.
  `ndwLookup` (`now` = sonucun `at`'i) ve `tomtomLookup` (`now` parametresi) bunu kullanır. Tek çalışma zamanı içe aktarıcısı `server/availability.mjs`.
  - K4: veri **ingest edilir** — sonuç null değil, eski alanlar (`src/total/available/out/at/price`) ve `availability` aynen.
  - K1: TomTom ve NDW sağlayıcı zamanı vermez (`fetched`) → `decision` `unknown` / `no-timestamp` (0/4 "dolu", hepsi arızalı "arızalı" denmez).
  - K2: NDW 0/N → `unknown` (sağlayıcı zamanlı varsayımsal kayıtta `ndw-zero-unverified`).
  - Kural kaynağa değil zaman damgasına bağlı: TomTom ileride sağlayıcı zamanı verirse taze kayıt güvenilir olur (testte varsayımsal fikstür).
- **Test:** `scripts/test-occupancy-adapter.mjs` 37/0 — yalnız sahte `fetchImpl` fikstürleri, global `fetch` hata fırlatan sahteyle değiştirildi (0 çağrı), sahte anahtar. `test-occupancy-decision` "çağıran yok" denetimi → "çağıran tam olarak `server/availability.mjs`; istemci/`sw.js`/`index.html` bağlı değil" (gevşetme değil, kesin liste).
- **Dokunulmadı:** istemci (`occupancyClient.js` `decision`'ı taşımaz → tarayıcı henüz almaz/okumaz, D3-T4), UI, i18n, `sw.js`, `version.js`, fiyat/tarife kodu, HERE/Google aramaları, `tomtomSlots` belirsiz→null kuralı. 12/12 KNOWN-GAP değişmedi.
- **Not:** sunucu açılışında Node bir kez `MODULE_TYPELESS_PACKAGE_JSON` uyarısı basar (`js/` dosyası ESM olarak yeniden ayrıştırılır); `package.json` değiştirilmedi.
- **Doğrulama durumu:** yalnız çevrimdışı/sahte fikstür; gerçek NDW/TomTom yanıtıyla ve gerçek cihazda doğrulanmadı; canlıya alma = sunucu yeniden başlatma (ayrı onay, yapılmadı); push/yayın yok. Tarayıcı ağ riskinin sıfır olduğu iddia edilmez.
- **Sıradaki:** D3-T3 (topluluk ayrı veri) ya da D3-T5; D3-T4 D3-T2 + D3-T3'e bağlı.

### 8.6 D3-T3 uygulandı — topluluk bildirimi ayrı veri (2026-11-16, köprü `aa4c329c`; v0.99.82)

Temel: `integ/beta-2026-11-14` @`045a257` (görev başında temiz; D3-T2 köprüde completed/çıkış 0 ve integ HEAD olarak doğrulandı), yalıtılmış worktree `MBRP-d3t3`, dal `feat/community-reports-d3-t3`.

- **Veri modeli (K3):** yeni saf `js/routing/communityReport.js` `communityReport(slots|community, { now })` → `{ kind: 'community', official: false, verified: false, busy, report: { status: 'full'|'free', at, ageMin } | null }` ya da `null`.
  Resmî karar alanlarını (`trusted`/`state`/`available`/`total`/`source`) taşımaz; bildirim en fazla 60 dk (sunucu `REPORT_MS`), zamansız/gelecek (> 1 dk) bildirim yok sayılır. Çağıran yok (bağlama D3-T4).
- **Resmî karar koruması:** `js/routing/occupancyDecision.js` `source: 'community'` (büyük/küçük harf, boşluk dahil) → `unknown` / `community-not-official`. Diğer resmî olmayan kaynaklar zaten `unknown-source`. `community` alanı resmî kararı değiştirmez (aynı çıktı testle sabit): topluluk "Boş" bildirimi doğrulanmış resmî "Müsait"e dönüşemez; topluluk "Dolu" resmî "Müsait"i ezmez.
- **Rota planlaması DEĞİŞMEDİ:** `js/routing/slots.js` `slotKind` mevcut kuralı (resmî sayı yoksa taze topluluk "Dolu" < 20 dk → `full`; topluluk "Boş" asla `free`; resmî sayı varsa topluluk yok sayılır) aynen korunur ve testle kilitlendi; planlayıcı/nav modülleri yeni modeli içe aktarmaz. **Açık karar:** topluluk bildirimi planlayıcıyı etkilesin mi (koru / kaldır / yalnız uyarı) — ayrı kullanıcı kararı gerekir.
- **Test:** `scripts/test-community-separation.mjs` 66/0 — sentetik; global `fetch` hata fırlatan sahte (0 çağrı); sunucu açılmaz. Uygulamadan önce modül yok → FAIL; mutasyonlar (koruma kaldırma; `official: true` + yaş penceresi 2×) 3/3 FAIL yakalandı.
- **Dokunulmadı:** `server/` (topluluk özeti zaten `{ busy, report }`, kullanıcı kimliği yok — testle doğrulandı), UI, i18n, `sw.js`, planlayıcı. 12/12 KNOWN-GAP değişmedi.
- **Doğrulama durumu:** yalnız çevrimdışı/sentetik; gerçek cihazda doğrulanmadı; push/yayın yok. Tarayıcı ağ riskinin sıfır olduğu iddia edilmez.
- **Sıradaki:** D3-T4 (üç durum arayüz; D3-T2 + D3-T3 tamamlandıktan sonra) ya da D3-T5.
