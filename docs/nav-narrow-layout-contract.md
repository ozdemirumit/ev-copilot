# RM-07 — Dar ekran navigasyon üst barı: çevrimdışı yerleşim risk sözleşmesi

Durum: **test + belge**; tek uygulama değişikliği RM-07 A1 (v0.99.74): `#near-alert-close` görünmez dokunma alanı 36→44px (yalnız CSS `::after`). Diğer boşluklar açık; hiçbiri cihazda "düzeltildi" sayılmaz.
Taban: `e08b265` (v0.99.73); **v0.99.91 ile model iki yarılı tek panele güncellendi** (taban `2c06f69`). Test: `scripts/test-nav-narrow-layout-contract.mjs` (düz Node, bağımlılık yok, ağ yok).

> **v0.99.113 güncellemesi (B tasarımı, taban `b360a39`):** iki yarılı düzen kalktı. Üst panel dikey yığın: üstte mavi manevra bloğu (ok + mesafe, altında talimat ve yol adı; beyaz yazı),
> altında tek satırda üç EŞİT metrik sütunu (pil | varış | sonraki şarj), en altta tam genişlikte uyarı (en çok 2 satır). Hız + limit levhası + Ø panelden çıktı: `#nb-speed` DOM'da `#nb-metrics`
> içinde kalır (kimlikler ve `navigator.js` / `avgSpeedView.js` / `speedLimit.js` değişmedi), CSS ile haritanın sol altında `position: fixed` bir kutu; limit levhası kutunun köşesinde rozet.
> Rotasız panel (`.mapsoc`) aynı dilde: mavi başlık bloğu + beyaz sürgü şeridi, düşük pilde amber; 150 px en düşük yükseklik kalktı (iki panel de içerik kadar).
> Test modeli (bölüm 2-3) bu düzene göre yeniden yazıldı; sonuç: tipik panel + 1 satır uyarı ≈194,6 px (tarayıcıda 360×740'ta 194 px ölçüldü) SIĞAR; **uyarı 2 satırken ≈213 px → KAYAR-RİSKİ** (bütçe ≈209,6;
> `#banners` kendi içinde kayar, bilinen boşluk); alt satırlar (varış, sonraki şarj) 360/375 px'te SINIRDA = ikinci satıra sarar, … ile kesilmez. Aşağıdaki v0.99.91 / v0.99.103 bölümleri tarihsel kayıttır. Gerçek cihazda doğrulanmadı.
>
> **v0.99.103 güncellemesi (taban `61b49a0`):** üst panel sol %60 / sağ %40 (`3fr | 2fr`; ≤360 px `11fr | 9fr`), sağ 2×2 metrik eşit sütun,
> değer yazısı hücreye göre (`min(21px, max(14px, 28cqi))`, hız 33cqi / ≤360 px 30cqi, sonraki şarj 23cqi), limit levhası 30 px (≤360 px 26 px).
> Sağ değer ve alt satırlar artık `…` ile **kesilmez, sarar**; §3'teki sağ hücre `SINIRDA`/`KESİLME-RİSKİ` sınıfları v0.99.103'te "tek satıra sığmayabilir → ikinci satıra sarar
> (hız levhası alt satıra kayar)" demektir. Sol: ok 52/44/40 px, mesafe 34/30/28 px, talimat ve yol adı 20/18/17 px, en çok 3+3 satır (yatayda 16 px, 2+2).
> v0.99.103 model çıktısı testte sabitlendi: hız `199`+levha 375–412 px SINIRDA (levha alta kayar); varış alt satırı ve sonraki şarj alt satırı her genişlikte
> KESİLME-RİSKİ (= sarar); sonraki şarj `1234 km` ve `12,5 km` her genişlikte SIĞAR. Yükseklik 360×640: en az ≈159, uyarı 1 satır ≈190 (SIĞAR),
> **uyarı 3 satır ≈224 → KAYAR-RİSKİ** (bütçe ≈209.6; `#banners` kendi içinde kayar — bilinen boşluk; 320×568'de v0.99.102'de de kayıyordu).
> Gerçek tarayıcı ölçümü: `EVRF_NAV_BROWSER=1 node scripts/test-nav-toppanel-layout.mjs` (Chromium + WebKit, 320/360/390/430 dikey, 844×390 yatay, zoom 1.3;
> en uzun değerler, Yunanca yol adı, 2 satır uyarı ile 360×640 ve üstünde kaydırma yok). Aşağıdaki v0.99.91 tabloları tarihsel kayıttır. Gerçek cihazda doğrulanmadı.

## 1. Ne ölçülüyor, ne ölçülmüyor

| | Bu sözleşme | Gerçek ölçüm (yapılmadı) |
|---|---|---|
| Kaynak | `css/styles.css`, `index.html`, `js/nav/navigator.js`, `js/nav/panelLogic.js` metni | Çalışan DOM |
| Yazı tipi | Karakter başına sabit em katsayısı (tutucu üst değer; iyimser = ×0.88) | Cihazın gerçek yazı tipi (Roboto / SF / Samsung One …) |
| Düzen | Elle türetilmiş ızgara/kutu modeli | Tarayıcı düzen motoru, alt piksel yuvarlama, yazı tipi ölçekleme |
| Sonuç | **TAHMİNİ risk sınıfı** | `getBoundingClientRect`, `scrollWidth > clientWidth`, ekran görüntüsü |

Sınıflar:
- Genişlik: `SIĞAR` (tutucu tahmin sığar) · `SINIRDA` (yalnız iyimser tahmin sığar) · `KESİLME-RİSKİ` (iyimser tahmin bile sığmaz).
- Yükseklik: `SIĞAR` · `KAYAR-RİSKİ` (`#banners` kendi içinde kayar; alt satırlar ilk bakışta görünmeyebilir).

## 2. Model (testte kodlanmış) — v0.99.91 tek panel, iki yarı

- İçerik genişliği = W − 20 (`#banners > *` 0 10px) − 2 (kenarlık) − 16 (`.navbar` dolgu 8px 8px) = **W − 38**.
- `.navbar` iki sütun `minmax(0, 1fr) minmax(0, 1.2fr)`, sütun boşluğu 10px: sol yarı = (W − 48)·1/2.2, sağ yarı = (W − 48)·1.2/2.2.
- Sol yarı: `.nb-head` (ok 46px + 6px + canlı mesafe; ≤380px 26px, üstü 30px), altında talimat ve yol adı aynı boy (18px; ≤380px 16px; en çok 2+2 satır), şerit.
- Sağ yarı: `.nb-metrics` 2×2, sütunlar `1.1 | 1` fr (sütun 0 = Hız, Varış; sütun 1 = Pil, Sonraki şarj); altında `.nb-alert` (ayrı uyarı alanı).
  Hücre iç genişliği = sütun − 4 (dolgu 0 2px) − 1 (sol kenarlık, sütun 0 hariç).
- Değer yazısı `clamp(18px, 5.4vw, 22px)`, hız `clamp(22px, 6.6vw, 28px)` + aynı satırda 38px limit levhası (4px boşluk); alt satır kalın değerler (`.ne-sub b`) 14px, alt satır metni 11px; `≈` öneki `b.approx::before` .7em.
- Taşma davranışı (CSS kanıtı): `.ne-v` nowrap, `.ne-v b` / `.ne-sub` overflow:hidden + ellipsis → taşan değer komşuya geçmez, **… ile kırpılır**. Canlı mesafe (`.nav-dist`) kırpılmaz: sığmazsa boşlukta ikinci satıra kayar.
- Yükseklik: iki yarı yan yana → panel = max(sol, sağ); eskiden manevra + metrik satırı + uyarı üst üste toplanırdı.

## 3. Tahmini sonuçlar (model çıktısı, sabitlendi)

| Durum | 360 | 375 | 399 | 412 |
|---|---|---|---|---|
| Pil `≈%100` (sütun 1) | SIĞAR (60.7 / 76.0) | SIĞAR | SIĞAR | SIĞAR (68.8 / 89.5) |
| Hız `199` + 38px levha (sütun 0) | SIĞAR (83.9 / 85.1) | SIĞAR | SIĞAR | SIĞAR |
| Hız ortalaması `Ø199` | SIĞAR | SIĞAR | SIĞAR | SIĞAR |
| Varış saati `23:59` | SIĞAR (56.8 / 85.1) | SIĞAR | SIĞAR | SIĞAR |
| Varış alt satırı `≈%100 · 1234 km` | SINIRDA (96.4 / 85.1) | SINIRDA | SINIRDA | SIĞAR (96.4 / 100.0) |
| Varış alt satırı yalnız varışta pil `≈%100 ·` | SIĞAR (50.8 / 85.1) | SIĞAR | SIĞAR | SIĞAR |
| Menzil alt satırı `≈999 km` | SIĞAR (47.4 / 76.0) | SIĞAR | SIĞAR | SIĞAR |
| Sonraki şarj değeri `1234 km` | SIĞAR (73.1 / 76.0) | SIĞAR | SIĞAR | SIĞAR |
| Sonraki şarj alt satırı `%100 · 1 sa 59 dk` (11px) | KESİLME-RİSKİ (94.6 / 76.0) | KESİLME-RİSKİ | SINIRDA | SINIRDA |
| Sol üst: ok + `850 m` | SIĞAR (121.4 / 141.8) | SIĞAR | SIĞAR | SIĞAR |
| Sol üst: ok + `12,5 km` | SINIRDA (152.6 / 141.8) → 2. satıra kayabilir | SINIRDA | SINIRDA | SINIRDA |

(parantez: gereken ≈px / kullanılabilir ≈px)

Yükseklik, 360×640 (`@media (min-height: 521px) and (max-height: 640px) { #banners { max-height: 34dvh } }` → 217.6px; çubuk bütçesi ≈209.6px; sağ yarı metrikleri uyarısız ≈129.0px):

| Senaryo | Tahmini yükseklik | Sınıf |
|---|---|---|
| En az (1 satır manevra, yol yok, uyarı yok) | ≈150.0 (min-height 150) | SIĞAR |
| Tipik + uyarı 1 satır | ≈173.8 | SIĞAR |
| Tipik + uyarı 3 satır | ≈207.4 | SIĞAR (sınırda, ≈2.2px pay) |
| En kötü (2+2 satır, şerit, uyarı 3 satır) | ≈207.4 | SIĞAR (sağ yarı belirler) |
| En kötü + uzun mesafe 2 satır | ≈207.4 | SIĞAR |

Uyarı (`.nb-alert`): artık sağ yarıda, `-webkit-line-clamp: 3`, dar ekranda 14px/1.2 → 1→3 satır büyümesi ≈33.6px; 4. satır kırpılır. Sağ yarı daha dar olduğundan uzun uyarı metni eskisinden önce 3 satıra ulaşır.

Kapat X (`#near-alert-close`, `.tp-head .tog`): görünür boyut 36×36px (değişmedi). RM-07 A1 (v0.99.74) ile görünmez dokunma alanı
`#near-alert-close { position: relative; }` + `#near-alert-close::after { content: ""; position: absolute; inset: -5px; }` (mevcut `.fabs-more button::after` deseni):
border-box, 1px kenarlık → dolgu kutusu 34px + 2×5 = **etkin 44×44px** (≥ Apple HIG 44pt; Material 48dp altında). Kenarlık kutusundan her yönde 4px taşar:
- Komşu "Liste" (`.tog-list`, kapat'tan önce): `.tp-head` gap 6px > 4px → çakışma yok (2px boşluk kalır).
- Kırpılma: `.toppanel` overflow:hidden, ama `.tp-charge` dolgusu tüm kurallarda üst/alt ≥6px, sağ ≥10px → 4px taşma kırpılmaz; `.toppanel` yükseklik sınırı yok, yapışkan başlık kaymaz.
- Alt: `.tp-charge .near-body` margin-top 4px → liste gövdesine binmez.
Test bu hesabı kaynaktan okur ve **etkin ≥44×44**'ü kabul ölçütü olarak denetler (tahmini; tarayıcı/cihaz ölçümü değil).

## 4. Bilinen boşluklar (v0.99.91 sonrası; hiçbiri cihazda doğrulanmadı)

1. ~~**Pil `≈%100`** dar hücrede kırpılma~~ — v0.99.91 modelinde tüm genişliklerde SIĞAR (hücre genişledi). Cihazda doğrulanmadı.
2. **Sonraki şarj alt satırı** (`%100 · 1 sa 59 dk`) 360/375px'te … ile kırpılır, 399/412px'te sınırda (tasarım gereği ellipsis; tam metin hücre `title`'ında).
3. ~~**Sonraki şarj `1234 km`** sınırda~~ — modelde SIĞAR (az payla: 360px'te ≈3px).
4. **Yükseklik:** 360×640'ta en kötü durum ≈207.4px / 209.6px bütçe (≈2.2px pay); `#near-alert` (şarj uyarısı) aynı kutuda ayrıca yer kaplar — modele katılmadı.
5. ~~**Kapat X 36px**~~ — kaynak modelinde kapandı (RM-07 A1, v0.99.74), cihazda doğrulanmadı.
6. **Varış alt satırı** `≈%100 · 1234 km` 360–399px'te sınırda: kesilirse önce sondaki kalan km … olur; varışta pil kısmı tüm genişliklerde sığar.
7. **Sol üst satır** uzun mesafe (`12,5 km`) dar ekranda ok ile aynı satıra sığmayabilir → kırpılmaz, ikinci satıra kayar (yükseklik modelinde hesaba katıldı).
8. **Sol yarı daha dar:** talimat/yol adı satır başına ≈14 karakter (360px, 16px) → uzun adlar 2 satırda … ile kesilir (eskiden tam genişlikti).
9. Model dışı: kullanıcı yazı tipi ölçeklemesi (Android "Yazı tipi boyutu", iOS Safari metin boyutu / sayfa yakınlaştırma), 11 dil etiketleri (yalnız Türkçe metin modellendi), yatay yönlendirme (≤520px yükseklik), güvenli alan girintileri.

## 5. Kaynak kayması koruması

Test, modelin dayandığı CSS kurallarını / HTML parçalarını / JS biçimleyicilerini **birebir** arar, kademe sırasını
(ör. `.nb-metrics .ne-v b` clamp kuralının `@media (max-width: 380px)` 21px kuralından sonra gelmesi) ve bazı seçici
sayımlarını denetler. Biri değişirse test **FAIL** verir: bu bir hata değil, "sözleşmeyi gözden geçir" sinyalidir.
Gözden geçirmede: modeli güncelle, §3 tablosunu yeniden üret, beklenen sınıfları bilinçli olarak değiştir — testi gevşetme.

## 6. Fiziksel cihaz kabul gereksinimleri (zorunlu; ajan veremez)

Bu sözleşme `verified` değildir. Kabul için gerçek cihazda, Beta derlemesinde, navigasyon etkinken:

1. Cihazlar: en az bir 360×640 CSS px (veya `min-height:521–640` aralığı) Android, bir 375 px iPhone, bir 393–412 px Android.
   Sistem yazı boyutu varsayılan **ve** bir kademe büyük.
2. Pil kaynağı tahmini/eski iken (≈ öneki) `%100` gösterimi: `≈%100` tam okunuyor mu, yoksa `…` ile mi kırpılıyor? Ekran görüntüsü.
3. Hız `199` (Test Modu/simülasyon) ve `Ø` ortalaması: hücre sınırını aşmıyor, komşu Limit hücresine binmiyor.
4. Sonraki şarj: 3–4 haneli km (`1234 km`) ve alt satır `%100 · 1 sa 59 dk`: kırpılma kabul edilebilir mi (ürün kararı).
5. 360×640: uyarı 1, 2, 3 satır; uzun manevra + yol adı + şerit; `#near-alert` açıkken: metrik satırı ve uyarı görünür mü, kutu kayıyor mu, harita kontrolleri kapanıyor mu?
6. Kapat X: eldivensiz/eldivenle tek dokunuşta isabet; yanlışlıkla komşu "Liste" düğmesine basılmıyor.
7. Açık ve koyu tema; Türkçe + en uzun etiketli bir dil (ör. Almanca).
8. Sonuç: her madde için geçti/kaldı + ekran görüntüsü + cihaz/OS/tarayıcı/APK sürümü; ancak bundan sonra kayıtta `verified` yazılabilir.
