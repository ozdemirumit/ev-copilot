# BL-P2-09 R3 — Nav/planlayıcı ↔ doluluk biçimlendiricisi tutarlılık sözleşmesi

Durum: **belge + çevrimdışı regresyon testi**. Çalışma zamanı kodu DEĞİŞMEDİ; bu belge bir düzeltme iddia etmez.
Temel: `19120b6` (v0.99.73). Test: `node scripts/test-occupancy-consistency-contract.mjs` (ağ/anahtar/sağlayıcı çağrısı yok).

## 1. Sorun özeti

Aynı NDW (Hollanda) doluluk kaydı iki farklı yoldan iki farklı sonuca varıyor:

| Yol | Kod | NDW "2/4" kaydı | NDW "0/4" kaydı |
|---|---|---|---|
| Fail-closed biçimlendirici (bağlı değil) | `js/routing/occupancyLabel.js` `formatOccupancy` | `unknown` / `unverified-time`, `confirmed:false` | `unknown`, asla `busy` |
| Nav/planlayıcı (canlı yol) | `js/routing/slots.js` `slotKind`/`isFresh`/`slotEl` | `free`, taze, "🟢 2/4 boş · şimdi" | `full`, taze, "🔴 dolu (0/4)" |

Kök neden:
- `server/occupancy.mjs` NDW dönüşünde eski alan `at: Date.now()` (okuma anı). Normalize alan `availability.timestampKind = 'fetched'`
  (sağlayıcı zamanı yok; `last_updated` tazelik değil son değişim).
- `js/routing/occupancyClient.js` `at: r.at, checked: Date.now()` yazar; `slots.isFresh` yalnızca `checked`'e bakar → her NDW kaydı 15 dk "taze".
- NDW durum ayrıntısı vermez: `fromNdwAvailabilities` boş olmayanları `UNKNOWN` sayar; `slotKind` ise `available <= 0` → `full`.
- `occupancyLabel.js` / `occupancyView.js` hiçbir çalışma zamanı modülünce içe aktarılmıyor ve `sw.js` SHELL listesinde yok.

Not: sunucu yorumu "AFIR gereği 1 dk içinde tazedir → okuma anı" der. Bu bir varsayımdır; NDW yanıtında doğrulanabilir sağlayıcı zamanı yok.
Biçimlendirici bu varsayımı kabul etmez. Hangisinin geçerli olacağı **kullanıcı kararıdır** (§5 K1).

## 2. Bilinen boşluklar (testte `KNOWN-GAP`, beklenen bulgu)

| Kimlik | Bugünkü davranış (sentetik NDW fikstürü) | Etki | Yer |
|---|---|---|---|
| ~~G1~~ | **KAPANDI (D3-T5, v0.99.84) → ACCEPT:** `isFresh` okuma anını (`checked`) değil doğrulanmış kararı (`trustedOccupancy` → `occupancyDecision` + sunucu vetosu) kullanır; NDW fetched → taze değil. Önce: NDW fetched kaydını taze sayıyordu | — | `slots.js` `isFresh` |
| ~~G2 / G2b~~ | **KAPANDI (D3-T5, v0.99.84) → ACCEPT:** `slotKind` NDW fetched 0/4 ve 2/4 → `unknown`; yalnız doğrulanmış resmî doluluk `free`/`full`/`out`; topluluk bildirimi `slotKind`e girmez. Önce: 0/4 → `full`, 2/4 → `free` | — | `slots.js` `slotKind` |
| ~~G3 / G3b / G3c~~ | **KAPANDI (D3-T4, v0.99.83) → ACCEPT:** `slotEl`/`slotLabel` saf `occupancyDecision` ile yalnız 🟢 Müsait / 🔴 Dolu / ⚪ Bilinmiyor; NDW fetched → "⚪ Bilinmiyor" (sayı/yaş yok). Önce: "🟢 2/4 boş · şimdi", "🔴 dolu (0/4)" | Yakın istasyonlar listesi, düşük pil kartı, Şarj planı durak satırı, istasyon kartı | `slots.js`; çağıranlar `nearby.js`, `routePanel.js`, `stationCard.js`, `stationsView.js` |
| ~~G4 / G4b~~ | **KAPANDI (D3-T5, v0.99.84) → ACCEPT:** `nearSort.availability` NDW 0/4 → `unknown`; 1 km NDW kaydı 5 km bilinmeyenin önünde (mesafe sırası). Önce: `full`, sona atılıyordu | — | `nearSort.js` |
| ~~G5~~ | **KAPANDI (D3-T5, v0.99.84) → ACCEPT:** `planRoute` NDW 0/4 olan yakın durağı plandan çıkarmaz, bekleme eklemez (`fullNear`/`waitMin`/`usable` aynı `slotKind`/`isFresh` kararını kullanır) | — | `planner.js` |
| ~~G6~~ / ~~G6b~~ | G6 **KAPANDI (D3-T5, v0.99.84) → ACCEPT:** karar yolu (`slotKind`/`isFresh` → `planner.js`, `routeOptions.js`, `livePlan.js` anons, `nearby.js` `gone()`/`pen`/not, `nearSort.js`, `chargePick.js`) `slots.js` `trustedOccupancy` ile `occupancyDecision` kullanır. G6b KAPANDI (D3-T4) → ACCEPT: `sw.js` SHELL karar + biçimlendirici modüllerini içerir | — | `slots.js` |
| ~~G7~~ | **KAPANDI (D3-T5, v0.99.84) → ACCEPT:** nav/planlayıcı kararı §3 sözleşmesinden sapmaz (NDW fetched 2/4, 0/4, 3 sa eski) | — | — |

Ek (test edilmedi, kaynakta görülen): `livePlan.js` aynı `slotKind` ile sesli "{istasyon} istasyonunda şu an boş yuva yok. Plan güncellendi."
der; `nearby.js` düşük pilde "N dolu istasyon elendi" notu yazar (`gone()` = `isFresh && full`). İkisi de G1/G2'ye bağlıdır.

Test kuralı: boşluk hâlâ varsa sayılır ve test geçer; boşluk **kendiliğinden** kaybolursa test `GAP CLOSED` ile başarısız olur.
Düzeltme görevi ilgili `knownGap(...)` satırını §3 kabul denetimine (`ok(...)`) çevirip bu tabloyu güncellemelidir. Test silinmez/gevşetilmez.

Kontroller (bugün tutarlı, normal PASS): sağlayıcı zamanlı taze kayıt (Google benzeri) iki yolda da `free`/`busy`;
3 sa eski kayıt iki yolda da boş/dolu denmez; veri yok → iki yolda `unknown`.

## 3. Hedef fail-closed kabul sözleşmesi (GELECEKTEKİ ayrı düzeltme için)

Tek doğruluk kaynağı `formatOccupancy(slots.availability, { now })` olur (`d`):

- **A1 tazelik:** nav/planlayıcıda "taze" ⇔ `d.confirmed === true` (sağlayıcı zamanı, ≤15 dk, tutarlı sayılar, bilinen kaynak, simüle değil).
  `checked` (okuma anı) tek başına tazelik sayılmaz.
- **A2 görüntü:** `d.state === 'unknown'` iken "boş"/"dolu"/"arızalı" ve "şimdi"/"canlı" yazılmaz; "doluluk bilgisi yok" (+ kaynak) yazılır.
- **A3 planlayıcı:** durak eleme/bekleme yalnızca `d.confirmed && d.state === 'busy'`; arızalı eleme yalnızca `d.confirmed && d.state === 'out'`.
- **A4 sıralama:** `unknown` kayıt sona atılmaz; mesafe/fiyat/güç sırası korunur.
- **A5 ses:** "şu an boş yuva yok"/"arızalı" anonsu yalnızca A3 koşulunda.
- **A6 işlev korunur:** sağlayıcı zamanlı taze kayıtta bugünkü free/busy/out davranışı aynen kalır (testte kontrol).
- **A7 eski biçim:** `availability` alanı yoksa (eski sunucu, `community`/`book`/`veriapi` kayıtları) doluluk `unknown`; fiyat ve topluluk bildirimi ayrı yoldan gösterilmeye devam eder (K3).
- **A8 regresyon:** bu testteki G1–G7 `ACCEPT` denetimine dönüşür; tüm `scripts/test-*.mjs` geçer.

## 4. Önerilen küçük uygulama aşamaları (her biri ayrı görev, ayrı commit, sürüm artışıyla)

1. **R3-a (saf, bağlı değil):** `slots.js` yanına saf `occupancyDecision(slots, now)` → `{ trusted, state }` (biçimlendiriciyi sarar). Yalnız test; çağıran yok.
2. **R3-b (planlayıcı) — Yapıldı: D3-T5 (v0.99.84), merkezi `slots.js` `slotKind`/`isFresh`:** `planner.js` `usable`/`waitMin`/`fullNear` → `occupancyDecision`. Test: G5 → ACCEPT, `test-stop-swap`, `test-route-options`, `test-rank-nocharge`.
3. **R3-c (nav kararları) — Yapıldı: D3-T5 (v0.99.84), aynı merkezi karar; `nearSort` `slotKind(s, now)`; yeni `test-occupancy-consumers`:** `nearby.js` `gone()`/`pen`/notlar, `nearSort.availability`, `livePlan.js` anons koşulu. Test: G1/G2/G4 → ACCEPT, `test-near-sort`, `test-charge-pick`.
4. **R3-d (görüntü):** `slotEl`/`slotLabel` unknown'da boş/dolu yazmaz (ya da `occupancyView` bağlanır + `sw.js` SHELL). Test: G3/G6 → ACCEPT; i18n gerekirse `i18n-validate`. → **Yapıldı: D3-T4 (v0.99.83)** — `slotEl` düzeltildi (`occupancyView` bağlanmadı); G3/G3b/G3c/G6b ACCEPT, G6 karar yoluna daraltıldı; `test-occupancy-ui`; 2 yeni çeviri anahtarı (11 dil).
5. **R3-e (isteğe bağlı, sunucu):** NDW eski `at` alanı `null` ya da `availability` ile tutarlı hâle getirilir (sunucu yeniden başlatma = kullanıcı onayı).

Her aşamada gerçek cihazda doğrulama ayrı kalır (`verified` ajan tarafından verilmez).

## 5. Kullanıcı kararları (düzeltmeden önce)

- **K1:** NDW "AFIR ≤1 dk tazelik" varsayımı kabul mü? Evet → NDW için ayrı güven sınıfı (ör. `timestampKind:'fetched-trusted'`), sözleşme
  buna göre güncellenir. Hayır → NDW doluluğu nav/planlayıcıda `unknown` olur (Hollanda'da boş/dolu eleme ve "dolu" uyarısı kaybolur).
- **K2:** NDW 0/N (durum ayrıntısı yok) "dolu" mu "bilinmiyor" mu? Biçimlendirici bugün "bilinmiyor" diyor.
- **K3:** Topluluk "Dolu bildirildi" (20 dk) planlayıcıyı etkilemeye devam etsin mi? (Biçimlendirici bu yolu kapsamıyor.)
- **K4:** TomTom da `fetched` (zaman yok); aynı kural TomTom'a uygulanacak mı? (Bu test yalnız NDW + Google kontrolünü kapsar.)
- **K5:** Görüntü için `slotEl`'i düzeltmek mi, yoksa `occupancyView`'i bağlamak mı (R3-d)?
- **K6:** NDW fiyatı `livePrice` içinde "(canlı)" etiketlenir; doluluk sözleşmesinin dışında, ayrı görev mi?
