# Beta — bağımlılık ve karar matrisi (tümü AÇIK)

Durum: **yalnız belge, karar içermez.** Temel: `integ/beta-2026-11-14` @ `018d726` (= `fe5fb45` + regrec14 kayıt commit'i, yalnız belge; uygulama v0.99.76; yerel, push yok,
Beta'da değil, cihazda doğrulanmadı; canlı Beta son okumada 0.99.61). Yazan: regrec14 (köprü `5363a7e5`, 2026-11-15).
Ağ/sağlayıcı çağrısı yapılmadı, çalışma zamanı değişmedi. Kimlikler `docs/beta-task-registry.json` ile aynı; yeni BL kimliği
açılmadı. Çelişkide JSON kayıt esastır. Seçenek sırası öneri değildir; **her satırın kararı kullanıcıya aittir.**

Kapı gösterimi `docs/beta-next-backlog.md` ile aynı: **G-HEAD** (integ beklenen sha'da, temiz), **G-SUITE** (`check.mjs` +
tüm `scripts/test-*.mjs` sıralı 0 FAIL), **G-USER** (kullanıcı kararı/onayı), **G-DEVICE** (gerçek cihaz; `verified` yalnız kullanıcı),
**G-PAID** (ücretli/harici sağlayıcı çağrısı onayı), **G-LEGAL** (yazılı lisans).

## 1. Özet matris

| # | Konu | Kayıt | Karar | Kapılar | Karardan sonra ajanın yapabileceği | Durum |
|---|---|---|---|---|---|---|
| D1 | Yol önü yağış kalan mesafe GAP-1/2 | `docs/ahead-rain-distance-gap.md`, `test-ahead-rain-progress` | koru / yakın örnek ekle / olduğu gibi | G-USER, G-HEAD, G-SUITE | `js/nav/ahead.js` düzeltmesi + sürüm artışı | **AÇIK** |
| D2 | Mapbox rotası Premium kapısı (BL-P3-01 M1/M1b/M2/M2b) | `test-mapbox-route-gate` (4 KNOWN-GAP) | Premium'a kapat / aylık sınır / olduğu gibi | G-USER, sunucu yeniden başlatma onayı | `server/proxy.mjs` `mapbox()` değişikliği | **AÇIK** |
| D3 | Doluluk BL-P2-09 R3 K1–K6 | `docs/occupancy-consistency-contract.md` §4–5 (12 boşluk) | K1…K6 ayrı ayrı | G-USER; R3-e için sunucu onayı | R3-a…R3-d sıralı, her biri ayrı commit | **AÇIK** |
| D4 | Türkçe sesli yönlendirme sözcükleri (BL-P3-09 / RM-01) | `js/nav/steps.js:62-85`, `test-nav-panel` | yol adı / çıkış no / "ardından" / yuvarlama | G-USER | `steps.js` + test genişletmesi + sürüm artışı | **AÇIK** |
| D5 | Sağlayıcı lisansı ve gerçek örnek yanıtlar (RM-10 / BL-P3-07; BL-P2-04/06/08/10) | `server/providerPolicy.mjs` `unverified`; sözleşme testleri | lisans onayı; hangi örnek çağrı | G-LEGAL, G-PAID | yalnız onaylı, anahtarsız/temizlenmiş fikstürle ayrıştırıcı | **AÇIK** |
| D6 | Mobil RM-07 cihaz doğrulaması (A2b/A3/A4/A5) | `docs/nav-narrow-layout-contract.md` §6, `window.__navLayout()` | cihaz ölçümü + kırpılma kabulü | G-DEVICE, G-USER | ölçüme göre CSS düzeltmesi (sürüm artışı) | **AÇIK** |
| D7 | Kaynak yedeği ve push/yayın kapısı (BL-P0-02, BL-P0-06, BL-P0-08) | ana kopya @`0c6dffd` 35 kirli; integ yerel | eşitleme yöntemi; push; Beta yayını | G-USER (push/yayın), WIP sahibi | yalnız onaylanan yöntem; yayın sonrası canlı `version.js` okuması | **AÇIK** |

## 2. Ayrıntı — seçenekler ve kabul ölçütleri

Her satırda "Kabul" kararın **uygulanmış** sayılması için gereken kanıttır; ajan `verified` vermez.

### D1 — Yağış uyarısı kalan mesafe (GAP-1/2) — AÇIK

- Bugün: `refreshRain` 10 dk'da bir yalnız güncel km + `WX_AHEAD_KM` noktalarını örnekler; GAP-1 "~3 km" → "~10 km" sıçraması
  (ses anahtarı değişirse uyarı yinelenir), GAP-2 yakın yağış uyarısının silinmesi. Testte sabit, düzeltilmedi.
- Seçenekler: (a) önceki olay hâlâ ileride ve eskimemişse koru, yalnız daha yakın yağış bulunursa değiştir; (b) km+0..5 yakın
  örnek ekle (Open-Meteo isteği büyür, ücretsiz); (c) olduğu gibi bırak.
- Bağımlılık: yok (bağımsız). (b) dış istek sayısını artırır → kullanıcı bunu da onaylamalı.
- Kabul: GAP testleri yeni beklenen davranışa **bilinçli** çevrilir (gevşetilmez); `test-ahead-rain-progress`, `test-traffic-guard`,
  `test-ahead-events`, `test-ahead-update` geçer; sürüm artışı; G-SUITE; cihazda sürüşte gözlem ayrı (G-DEVICE).

### D2 — Mapbox rotası Premium kapısı (BL-P3-01) — AÇIK

- Bugün: `mapbox()` ve dağıtıcı satırında Premium denetimi yok (M1/M1b); aylık `MB_CAP` ve sayaç yalnız aramaya uygulanır (M2/M2b).
- Seçenekler: (a) Mapbox rotasını Premium'a kapat (Free → Valhalla); (b) açık kalsın, rota da aylık sınıra ve sayaca girsin;
  (c) olduğu gibi (maliyet riski kabul).
- Bağımlılık: sağlayıcı faturalama/kota bilgisi kullanıcıda; canlıya alma sunucu yeniden başlatması = ayrı onay.
- Kabul: seçilen M satırları `test-mapbox-route-gate`'te KNOWN-GAP → `ok` kabul denetimine çevrilir; `test-provider-policy*`,
  `test-secret-hardening`, `test-proxy-retry` geçer; anahtar değeri hiçbir yerde görünmez; G-SUITE.

### D3 — Doluluk BL-P2-09 R3 (K1–K6) — AÇIK

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

### D4 — Türkçe sesli yönlendirme sözcükleri (BL-P3-09) — AÇIK

- Bugün: `steps.js` saf Türkçe cümle kurucusu var (50 m / 0,5 km yuvarlama, 120/500/2000 m eşikleri); yol adı, çıkış numarası,
  birleşik manevra ("ardından") bilinçli olarak söylenmiyor (3fe33b73 NO-CHANGE).
- Kullanıcıdan istenen: (1) yol adı söylensin mi, hangi ekle ("… Caddesi'ne"); (2) çıkış no kalıbı ("3. çıkıştan" / "çıkış 3'ten");
  (3) "ardından" birleştirme eşiği; (4) yuvarlama/eşik değerleri değişsin mi. Örnek cümle listesiyle onay.
- Bağımlılık: D5 (çıkış numarası/tabela verisi BL-P2-08 sağlayıcı örneğine bağlı); yol adı Mapbox/Valhalla'da var.
- Kabul: onaylı örnek cümleler belirlenimci fikstür olur; `test-nav-panel`, `test-lanes` geçer; 11 dil etkilenirse `i18n-validate`;
  sürüm artışı; sesli çıktı cihazda dinlenir (G-DEVICE, APK WebView ses farkı ayrı).

### D5 — Sağlayıcı lisansı ve gerçek fikstürler — AÇIK

- Bugün: `providerPolicy` HERE/TomTom lisansı `unverified`, HERE kapalı; TomTom/Google/HERE yol olayı sözleşmeleri fail-closed;
  ayrıştırıcı kapısı (`b36030e`) doğrulanmamış alanların okunmadığını sabitler.
- Kullanıcıdan istenen: (1) her sağlayıcı için yazılı lisans/ToS onayı (G-LEGAL, RM-10); (2) hangi ücretli örnek çağrıların yapılacağı
  (Valhalla `turn_lanes` BL-P2-04, TomTom tünel/gişe BL-P2-06, çıkış/tabela BL-P2-08, VeriApi şeması BL-P2-10) ve bütçe (G-PAID).
- Bağımlılık: D4 çıkış numarası ve BL-P2-06/08 buna bağlı. Fikstürler anahtarsız, kişisel veri/konum geçmişi içermeyecek biçimde
  temizlenir (`server/scrub.mjs`); testler çevrimdışı kalır.
- Kabul: lisans kanıtı kayıtta (`providerPolicy` durumu ancak bundan sonra değişir); fikstür kaynağı/tarihi belgede; sözleşme
  testleri KNOWN-GAP → ACCEPT; `test-provider-policy*`, `test-secret-hardening`, `test-road-events*` geçer.

### D6 — Mobil RM-07 cihaz doğrulaması — AÇIK

- Bugün: dar ekran sözleşmesi yalnız çevrimdışı model (`577ee24`); A1 (`4721532`), A2a (`bb7045a`), A3 sondası `__navLayout()`
  (`e321ffe`) yerelde; kalan A2b/A4/A5 ve ≈%100 / 1234 km / 3 satır uyarı taşmaları cihaz ölçümü bekliyor.
- Kullanıcıdan istenen: `docs/nav-narrow-layout-contract.md` §6 listesindeki cihazlarda (360×640 Android, 375 iPhone, 393–412 Android;
  varsayılan + büyük yazı; açık/koyu; TR + DE) ölçüm ve ekran görüntüleri; kırpılmanın kabul edilip edilmediği (ürün kararı).
- Bağımlılık: D7 (cihaza Beta/APK ulaşması için push/yayın ya da yerel derleme kararı); www/ ve APK 0.85.x eski (BL-P0-07, RM-09).
- Kabul: madde başına geçti/kaldı + ekran görüntüsü + cihaz/OS/tarayıcı/APK sürümü kayıtta; `verified` yalnız kullanıcı yazar.

### D7 — Kaynak yedeği ve push/yayın kapısı — AÇIK

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
