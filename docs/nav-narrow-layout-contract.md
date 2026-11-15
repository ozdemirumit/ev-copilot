# RM-07 — Dar ekran navigasyon üst barı: çevrimdışı yerleşim risk sözleşmesi

Durum: **yalnızca test + belge**. Uygulama kodu, CSS, i18n, sürüm, SW değişmedi. Hiçbir hata "düzeltildi" sayılmaz.
Taban: `e08b265` (v0.99.73). Test: `scripts/test-nav-narrow-layout-contract.mjs` (düz Node, bağımlılık yok, ağ yok).

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

## 2. Model (testte kodlanmış)

- İçerik genişliği = W − 20 (`#banners > *` 0 10px) − 2 (kenarlık) − 16 (`.navbar` dolgu 8px 8px) = **W − 38**.
- `.nb-metrics` sütunları `1 | 1 | 1.15 | 1.1 | 1.5 | 1.1` fr (toplam 6.95), `minmax(0, …)` → içerikten bağımsız oransal.
  Hücre iç genişliği = sütun − 4 (dolgu 0 2px) − 1 (sol kenarlık, ilk hücre hariç).
- Değer yazısı `clamp(18px, 5.4vw, 22px)`, hız `clamp(22px, 6.6vw, 28px)`, `letter-spacing: -.3px`; `≈` öneki `b.approx::before` .7em.
- Taşma davranışı (CSS kanıtı): `.ne-v` nowrap, `.ne-v b` overflow:hidden + ellipsis → taşan değer komşuya geçmez, **… ile kırpılır**.

## 3. Tahmini sonuçlar (model çıktısı, sabitlendi)

| Durum | 360 | 375 | 399 | 412 |
|---|---|---|---|---|
| Pil `≈%100` (tahmini/eski pil) | KESİLME-RİSKİ (60.7 / 49.1) | KESİLME-RİSKİ | KESİLME-RİSKİ | KESİLME-RİSKİ (68.8 / 57.8) |
| Hız `199` | SIĞAR (41.9 / 43.0) | SIĞAR | SIĞAR | SIĞAR |
| Hız ortalaması `Ø199` | SIĞAR | SIĞAR | SIĞAR | SIĞAR |
| Sonraki şarj değeri `1234 km` | SINIRDA (73.1 / 65.5) | SINIRDA | SINIRDA | SINIRDA |
| Sonraki şarj alt satırı `%100 · 1 sa 59 dk` (11px) | KESİLME-RİSKİ (94.6 / 65.5) | KESİLME-RİSKİ | KESİLME-RİSKİ | KESİLME-RİSKİ |

(parantez: gereken ≈px / kullanılabilir ≈px)

Yükseklik, 360×640 (`@media (min-height: 521px) and (max-height: 640px) { #banners { max-height: 34dvh } }` → 217.6px; çubuk bütçesi ≈209.6px):

| Senaryo | Tahmini yükseklik | Sınıf |
|---|---|---|
| En az (1 satır manevra, yol yok, uyarı yok) | ≈150.0 (min-height 150) | SIĞAR |
| Tipik + uyarı 1 satır | ≈178.4 | SIĞAR |
| Tipik + uyarı 3 satır | ≈212.0 | KAYAR-RİSKİ (sınırda, ≈2.4px aşım) |
| En kötü (2+2 satır, şerit, uyarı 3 satır) | ≈277.2 | KAYAR-RİSKİ |

Uyarı (`.nb-alert`): `-webkit-line-clamp: 3`, dar ekranda 14px/1.2 → 1→3 satır büyümesi ≈33.6px; 4. satır kırpılır.

Kapat X (`#near-alert-close`, `.tp-head .tog`): statik 36×36px. WCAG 2.5.8 (24px) üstünde; Apple HIG 44pt / Material 48dp önerisinin altında.

## 4. Bilinen boşluklar (açık; düzeltilmedi)

1. **Pil `≈%100`** dar hücrede (1.15fr) model tüm genişliklerde kırpılma öngörüyor → `≈%10…` görünebilir. Gerçek cihazda doğrulanmadı.
2. **Sonraki şarj alt satırı** (`%100 · 1 sa 59 dk`) tüm genişliklerde … ile kırpılır (tasarım gereği ellipsis; bilgi kaybı riski).
3. **Sonraki şarj `1234 km`** sınırda; 3–4 haneli km değerleri yazı tipine göre kırpılabilir.
4. **360×640'ta 3 satır uyarı** veya uzun manevra/yol adı + şerit ile üst bar `#banners` içinde kayar; metrik/uyarı satırı ilk bakışta görünmeyebilir. `#near-alert` (şarj uyarısı) aynı kutuda ayrıca yer kaplar — modele katılmadı.
5. **Kapat X 36px** < 44px dokunma önerisi.
6. Model dışı: kullanıcı yazı tipi ölçeklemesi (Android "Yazı tipi boyutu", iOS Safari metin boyutu / sayfa yakınlaştırma), 11 dil etiketleri (yalnız Türkçe metin modellendi), `Limit` hücresi, `Varışta`/`Menzil` değerleri, yatay yönlendirme (≤520px yükseklik), güvenli alan girintileri.

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
