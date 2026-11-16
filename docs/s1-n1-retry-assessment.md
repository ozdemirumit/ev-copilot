# S-1 / N-1 yeniden deneme — risk değerlendirmesi ve öneri (SALT OKUNUR)

Durum: **yalnız değerlendirme ve öneri; uygulama kodu DEĞİŞMEDİ** (sürüm v0.99.90 kalır). Taban: `integ/beta-2026-11-14` @`8625735`.
Kaynak: kod okuması + mevcut çevrimdışı test `scripts/test-g2b-request-budget.mjs` (sanal saat, ağ sahte; 45/0, 2 KNOWN-GAP:
A4 = 80/saat, B5 = 277/saat). Gerçek ağ, gerçek anahtar, cihaz kullanılmadı; aşağıdaki "en kötü durum" sayıları kod okumasından
türetilen **üst sınırlardır**, ölçülmüş fatura değildir. Cihazda DOĞRULANMADI. Önerilerin hiçbiri kullanıcı onayı olmadan uygulanmaz (§6).

## 1. Özet

| | S-1 düşük pil istasyon araması | N-1 rotadan çıkış yeniden rotası |
|---|---|---|
| Tetik | güvenilir düşük pil (`socTrusted`), liste boş, arama **hata dizisiyle** döndü (throw değil) | navigasyonda rota dışı ≥ 6 sn (ya da > 0,4 km), hareket ediyor, yeniden rota başarısız |
| Bugünkü sıklık | 45 sn sabit → **80 deneme/saat** (test A4) | 12 sn sabit → **277 deneme/saat** (test B5; 300 tavan) |
| Geri çekilme | yok (S-0 throw yolunda var: 60 sn → 10 dk) | yok |
| Elle tetik | İstasyonlar sekmesi "Yenile" var; düşük pil uyarı panelinde yok | yok |
| Ek bulgu | hata dönen arama son iyi listeyi **siler** (S-1b) | her denemede **sesli** "Rota yeniden hesaplanıyor." (N-1b) |
| Öneri | 45 → 90 → 180 → **en çok 5 dk**, ±%10 sapma → ≈ 12–14/saat | 12 → 24 → 48 → **en çok 60 sn**, ±%10 → ≈ 60–62/saat |
| Kota etkisi (öneri) | Mapbox kişi/gün 400 hakkı 5 sa yerine ≈ 29 sa'te biter | TomTom kişi/gün 150 hakkı 33 dk yerine ≈ 2,4 sa'te biter |

Önerilen ilke: **otomatik** denemeler sınırlı üstel geri çekilir; **kullanıcının elle denemesi asla beklemez** ve geri çekilmeyi
sıfırlar; sürücüye hata bir kez sesle, sonra yalnız görsel (sonraki deneme sayacı) bildirilir.

## 2. S-1 — kod yolu (kanıt)

- `js/nav/nearby.js:536` `checkLow` 5 sn'de bir; `:440-444` liste boşsa uyarı + `autoSearch(meta.at > 0)`; `:450` sıralama boşsa
  `autoSearch(true)`.
- `:412-417` `autoSearch`: `busy`, `retryAt` (yalnız throw yolu, S-0) ve `Date.now() - meta.at < 45000` korur; `force: true` ile
  `refreshNearby` çağırır (istemci 20 dk önbelleği okunmaz, `js/osm/chargers.js:384`).
- `:113-121` düşük pilde yarıçap 25 km'den başlar; `res.errors.length` varsa genişleme durur (deneme başına **tek** `fetchAround`);
  `:121` hata dizisinde de `meta.at = Date.now()` yazılır, `:122-123` `failN`/`retryAt` **sıfırlanır** → S-0 geri çekilmesi devreye girmez.
- `:489` `watch` 5 dk düşük pil tazelemesi, `meta.at` her 45 sn güncellendiği için ayrıca tetiklenmez (toplam 80/saat, test A4 ile tutarlı).
- **S-1b (yeni bulgu):** `:116` `all = res.stations` koşulsuz → hata dizisi + boş sonuç önceki başarılı listeyi siler; `force: true`
  olduğu için 20 dk önbellek de okunmaz. Düşük pilde geçici bir kesinti, kullanıcının elindeki son geçerli istasyon listesini kaldırır.
- Bitişik durum (S-1 kapsamı dışı, karar D-S1-4): sonuç **hatasız ama boş** ise aynı 45 sn döngü `widen` ile sürer (yarıçap 50 km'de sabitlenir).

### Deneme başına HTTP yayılımı (`fetchAround`, `js/osm/chargers.js:342-387`)

| Kaynak (yapılandırmaya bağlı) | Deneme başına | Not |
|---|---|---|
| Mapbox kategori araması (`stationsAround`, `js/mapbox/chargers.js:125`) | 1 üst sunucu isteği (kök kutu) | `mbfetch` istasyonda `proxyFetchRetry`: yalnız **kendi sunucu** kapalı / JSON olmayan 502-503-504'te 4 sn arayla en çok 4 deneme (`js/net/proxy.js:58,69,110`) — bunlar üst sağlayıcı hakkı harcamaz |
| Overpass (Mapbox yok/fatal) | ara sunucu 1 (en çok 4 yeniden deneme) + doğrudan aynalar en çok 3 | ağ hatası/zaman aşımında ayna 10 dk ölü sayılır (`:101,132`); HTTP hatasında sayılmaz → her denemede 3 ayna |
| Google istasyon (açıksa) | 1 | |
| OpenChargeMap (anahtar varsa) | 1 | |
| Tesla | 0 | `/v1/tesla` 1 gün önbellek |

## 3. N-1 — kod yolu (kanıt)

- `js/nav/navigator.js:27-28` `REROUTE_COOLDOWN_MS = 45000`, `RETRY_MS = 12000`; `:148-163` rota dışı → `rerouteFromHere()`;
  başarısızlıkta `lastReroute = now - 45000 + 12000` → 12 sn sonra yeniden; sayaç yok, geri çekilme yok.
- `:158` **her denemede** `speak('Rota yeniden hesaplanıyor.', { cooldownMs: 0, interrupt: true })` → sürekli hatada saatte ≈ 277
  sesli kesinti (**N-1b, sürücü dikkati**); `js/routing/controller.js:332` her hatada toast "Yeni rota alınamadı, mevcut plan korundu";
  `:237` her denemede plan `loading` + `stops: []` yazılır, hatada eski plan geri konur (panel titreşimi; cihazda doğrulanmadı).
- `js/routing/controller.js:473-477` `rerouteFromHere` → `planTrip(from)`; `:243` `fetchRoute` (`js/providers/index.js:49-66`):
  TomTom (açıksa, Premium) → hata → Mapbox (Premium, D2-T1 kapısı) → hata → Valhalla (açık). Deneme başına **en çok 3** HTTP,
  hiçbiri yeniden deneme sarmalayıcısı kullanmaz (`js/tomtom/route.js:132` `proxyFetch`; `mbfetch` rota `retry: false`).
- Yeniden rotada (`from`) rakım/hava beklenmez (`:257-277`); istasyon yalnız plan istasyonu yoksa yüklenir.
- Kod okumasında, rota **başarılı** alınıp sonradan atılan bir hatayla `false` dönen (ücretli rotayı her 12 sn'de başarıyla
  faturalayan) yol bulunmadı; ama `verifyStopAccess` / `routeThroughStops` iç hata yolları test edilmediği için **dışlanmadı** (açık risk R-N3).
- Beta'da istemci `providerGate` varsayılan duraklatılmış: yeni plan kurulamadığı için N-1 cihazda ancak önceden kurulmuş planla
  ya da duraklatma kaldırılınca görülür (D6 belgesi). Ağ yokken N-1 kota harcamaz ama ses/toast/titreşim sürer.

## 4. En kötü durum istek ve kota etkisi

Varsayılan sunucu hakları: `server/proxy.mjs:149` kişi/gün `mapbox` 400 (rota **ve** arama ortak, `:325`), `overpass` 300, `ocm` 200,
`gsearch` 60, `tomtom` (rota) 150; `server/tomtom.mjs:12` TomTom tüm istekler günlük 2000 (doluluk ile ortak); `MAPBOX_MONTHLY_CAP`
(arama) varsayılan 4800; `MAPBOX_ROUTE_MONTHLY_CAP` boş = **sınırsız**. Reddedilen istek hak harcamaz (G2a); sayaç izin verilen her
isteği **üst sunucu cevabından önce** sayar → üst sağlayıcının hata döndüğü istek de hak/fatura harcar. Cihaz çevrimdışıysa 0.

### Saatlik deneme (zamanlama formülü: deneme/saat ≈ 3600 / (bekleme + deneme süresi); anlık hata = en kötü)

| Senaryo | Bugün | Öneri A (önerilen) | Öneri B (daha tutumlu) |
|---|---|---|---|
| S-1 | 45 sn → 80/sa | 45→90→180→300 sn: ilk saat 14, sonra 12/sa | 45→…→600 sn: ilk saat 9, sonra 6/sa |
| N-1 | 12 sn → 277/sa (test) | 12→24→48→60 sn: ilk saat ≈ 62, sonra 60/sa | 12→…→120 sn: ilk saat ≈ 33, sonra 30/sa |

### Kotanın tükenme süresi (tek cihaz, kaynak sürekli hata, varsayılan haklar)

| Kaynak / hak | Bugün | Öneri A | Öneri B |
|---|---|---|---|
| S-1 Mapbox arama, kişi/gün 400 | 5,0 sa | ≈ 29–33 sa (gün içinde dolmaz) | ≈ 60 sa+ |
| S-1 Mapbox arama, aylık genel 4800 | 60 sa (tek cihaz) | ≈ 340 sa | ≈ 800 sa |
| S-1 Overpass ara sunucu, kişi/gün 300 | 3,75 sa | ≈ 21–25 sa | ≈ 50 sa |
| S-1 Overpass doğrudan aynalar (cihaz IP'si) | ≤ 240/sa | ≤ 42/sa | ≤ 27/sa |
| S-1 Google istasyon, kişi/gün 60 | 45 dk | ≈ 4,3–5 sa | ≈ 10 sa |
| S-1 OCM, kişi/gün 200 | 2,5 sa | ≈ 14–17 sa | ≈ 33 sa |
| N-1 TomTom rota, kişi/gün 150 | 33 dk | ≈ 2,4 sa | ≈ 4,5 sa |
| N-1 TomTom genel 2000 (doluluk ortak) | 14 takılı Premium cihaz bir günde tüketir | ≈ 14 cihaz × 2,4 sa | ≈ 14 cihaz × 4,5 sa |
| N-1 Mapbox rota, kişi/gün 400 (**arama ile ortak**) | 1,4 sa | ≈ 6,5 sa | ≈ 12 sa |
| N-1 Mapbox rota aylık | sınırsız → fatura ≤ 277 rota/sa/cihaz | ≤ 62/sa | ≤ 33/sa |
| N-1 Valhalla (açık, cihaz IP'si) | 277/sa | ≤ 62/sa | ≤ 33/sa |

**Çapraz etki (R-X1):** N-1 Mapbox rota denemeleri kişi/gün `mapbox` hakkını 1,4 sa'te bitirirse aynı kullanıcının **düşük pil
istasyon araması** (S-1, Mapbox) aynı gün 429 alır. Yani güvenlik açısından en kritik arama, en az kritik yeniden denemenin
kotasıyla aç kalabilir. Öneri A ile bu süre ≈ 6,5 sa'e çıkar; kesin çözüm sunucuda rota/arama haklarını ayırmaktır (D-X1, sunucu değişikliği).

## 5. Öneri (uygulanmadı)

### Ortak yardımcı (öneri)
Saf `nextDelay(failN, { min, max, factor = 2, jitter = 0.1, rand })` → `min(max, min·factor^(failN-1)) · (1 ± jitter)`;
sanal saatle test edilebilir, `nearby.js` S-0 (`:40-41,127`) ve W-1 (`rangeEngine`) ile aynı biçim. Yeni bağımlılık yok.

### S-1
1. Hata dizisi + boş sonuç `failS1++`, `retryAt = now + nextDelay(failS1, { min: 45 s, max: 5 dk })`; `autoSearch` bunu `retryAt` ile
   zaten okur. En az bir istasyon dönen sonuç ya da elle Yenile sıfırlar.
2. **Hemen sıfırlayan olaylar:** elle Yenile (İstasyonlar ve — öneri — uyarı panelindeki yeni "Yeniden ara" düğmesi), konum son
   aramadan ≥ 5 km uzaklaştı, yeni pil bandına inildi (eşik/15/10/5; bant başına bir anlık deneme), `online` olayı.
3. **S-1b:** hata dönen aramada son başarılı liste korunur ve "N dk önce · güncellenemedi" etiketiyle gösterilir; en çok 60 dk
   (sonra kaldırılır). Varış pili/uzaklık anlık konumdan yeniden hesaplanır (`enrich` zaten yapıyor).
4. **Güvenlik bildirimi** (uyarı panelinde, görsel): "İstasyon listesi alınamadı · sonraki deneme 3 dk · [Yeniden ara]". Ses: hata
   dizisinin **ilk** denemesinde bir kez "İstasyon listesi alınamadı." (bant sesleri değişmez).

### N-1
1. Başarısız yeniden rota `failN1++`; sonraki deneme `nextDelay(failN1, { min: 12 s, max: 60 s })`. Başarı, rotaya dönüş
   (`offSince = 0`) ve elle deneme sıfırlar; başarılı rotadan sonraki 45 sn soğuma aynen kalır.
2. **Hemen deneyen olaylar:** off-route panelinde yeni "Yeniden rota" düğmesi (beklemez, `rerouting` dışında engel yok), `online` olayı,
   rotadan uzaklık bir önceki denemeye göre ≥ 1 km arttıysa (yanlış çıkış sonrası).
3. **Ses (N-1b):** "Rota yeniden hesaplanıyor." sapma bölümü başına **bir kez**; ilk hatada bir kez "Yeni rota alınamadı. Önceki
   rotaya dönün ya da Yeniden rota'ya dokunun."; sonraki otomatik denemeler sessiz. Hata toast'ı bölüm başına bir kez.
4. **Görsel bildirim:** "Rotadan çıktınız · yeni rota alınamadı · sonraki deneme 48 sn · [Yeniden rota]"; eski rota çizgisi kalır.

### Kabul testi (uygulama görevinde; bugün yazılmadı)
`scripts/test-g2b-request-budget.mjs` KNOWN-GAP S-1 ve N-1 satırları `ok(...)` kabul denetimine çevrilir (gevşetilmez, sıkılaştırılır):
A4 ≤ 15/sa ve ardışık aralıklar büyür, ≤ 5 dk + 30 sn; elle Yenile/Yeniden ara hemen 1 arama; ilk istasyonlu sonuç sıfırlar; hata
sonrası son liste korunur (S-1b). B5 ≤ 65/sa (Öneri B'de ≤ 35/sa); elle "Yeniden rota" hemen 1 deneme; `online` hemen 1 deneme;
sapma bölümü başına "yeniden hesaplanıyor" sesi ≤ 1, hata sesi ≤ 1. Yeni metinler 11 dilde (`node scripts/i18n-validate.mjs`).
`test-api-call-graph` dinleyici kilidi `online` dinleyicisi için güncellenmeli (yeni tetik). Ardından D6 cihaz T7 + rota dışı adımı.

## 6. Kullanıcı onayı gerektiren kararlar

| Kod | Karar | Öneri |
|---|---|---|
| D-S1-1 | S-1 geri çekilme tavanı: 5 dk (A) / 10 dk (B) / bugünkü 45 sn kalsın | **A (5 dk)** — düşük pilde liste 5 dk'dan eski kalmasın; `LOW_REFRESH_MS` ile aynı |
| D-S1-2 | Sıfırlayan olaylar: elle, ≥ 5 km yer değişimi, pil bandı, `online` | hepsi |
| D-S1-3 | S-1b: hata sonrası son iyi listeyi "güncellenemedi" etiketiyle en çok 60 dk göster (davranış değişikliği: eski veri gösterilir) | evet |
| D-S1-4 | Hatasız-boş sonuç (50 km'de istasyon yok) da aynı geri çekilmeye tabi olsun mu | evet, 50 km genişletmeden sonra |
| D-N1-1 | N-1 tavanı: 60 sn (A) / 120 sn (B) / bugünkü 12 sn | **A (60 sn)** — sürücü rehberliği öncelikli; kota B'nin iki katı |
| D-N1-2 | Ses: bölüm başına bir "yeniden hesaplanıyor" + bir "alınamadı"; tekrarlar sessiz | evet (bugünkü 277/sa ses dikkat dağıtır) |
| D-UI-1 | Yeni düğmeler: uyarı panelinde "Yeniden ara", rota dışı panelinde "Yeniden rota" (`index.html`, `css`, 11 dil i18n) | evet |
| D-X1 | Sunucu: Mapbox rota ve arama kişi/gün haklarını ayır (`server/proxy.mjs:149,325`) — acil arama rota denemeleriyle aç kalmasın | evet, ayrı görev (sunucu yeniden başlatma ayrı onay) |
| D-X2 | `MAPBOX_ROUTE_MONTHLY_CAP` değeri (boş = sınırsız fatura) — D2-T2 ile aynı açık karar | kullanıcı değeri |
| D-REL | Uygulama: sürüm artışı (`version.js`), commit/push, Beta yayını, D6 cihaz kabulü | her biri ayrı onay |

## 7. Açık riskler

- **R-S1:** öneri A ile kaynak düzelse bile en kötü 5 dk (+ ±%10) gecikme; elle düğme ve olay sıfırlamaları bunu karşılar.
- **R-N1:** 60 sn tavanda ağ geri geldiğinde en kötü ≈ 60 sn rehbersiz sürüş; `online` olayı mobilde güvenilmez olabilir (cihazda doğrulanmadı).
- **R-N3:** başarılı rota + sonradan hata yolu (§3) dışlanmadı; uygulama görevinde test eklenmeli.
- **R-X1:** ortak Mapbox hakkı (§4) sunucu değişikliği yapılmadan sürer.
- Bu belgedeki tüm sayılar kod okuması + sanal saat testi; gerçek sağlayıcı faturası ve cihaz davranışı ölçülmedi.
