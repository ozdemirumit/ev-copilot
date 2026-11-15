# Beta — sıradaki bağımsız işler (öncelikli, kapılı)

Durum: **yalnız belge**. Temel: `integ/beta-2026-11-14` @ `9b48d7f` (uygulama v0.99.76, yerel, push yok, Beta'da değil, cihazda doğrulanmadı).
Yazan: kuyruk orkestratörü 84671015 (2026-11-15). Ağ/sağlayıcı çağrısı yapılmadı. Kimlikler `docs/beta-task-registry.json`
`backlog.items` ile aynıdır; yeni BL kimliği açılmadı. Çelişkide JSON kayıt esastır; bu belge kaydı güncellemez (ayrı regrec görevi).

Kapı gösterimi: **G-HEAD** = görev başında integ HEAD beklenen sha'da ve temiz; **G-SUITE** = `node scripts/check.mjs` + tüm
`scripts/test-*.mjs` sıralı 0 FAIL; **G-USER** = kullanıcı kararı/onayı gerekir (ajan başlatamaz).

## 0. Bu çalıştırmada yapılanlar (yerel)

| Adım | Commit | Not |
|---|---|---|
| regrec9 docs ff | `f5096df` (ebeveyn `e321ffe`) | yalnız `docs/`; 89 test dosyası 0 FAIL; sürüm artmadı |
| BL-P3-01 tanı testi | `9b48d7f` (ebeveyn `f5096df`) | yalnız `scripts/test-mapbox-route-gate.mjs` (26/0, 4 KNOWN-GAP); 90 dosya 0 FAIL; ff integ |

## 1. Ajanla yapılabilir — karar gerektirmeyen (öncelik sırası)

| # | İş | Kapsam (dosya) | Kapı | Kabul testi |
|---|---|---|---|---|
| A1 | **Kayıt uzlaştırması (regrec10)**: 84671015 kaydı, `f5096df`/`9b48d7f` local-integrated, regrec9 öz-kaydı running → completed, BL-P3-01'e tanı testi bağlantısı | `docs/BETA_TASK_REGISTRY.md`, `docs/beta-task-registry.json` | G-HEAD `9b48d7f` (ya da bu belgenin ff'i), G-SUITE | `test-beta-tracker` geçer; JSON geçerli; sürüm artmaz |
| A2 | BL-P3-09 doğal Türkçe navigasyon cümle kurucusu — **yalnız saf modül + test, bağlı değil** | yeni `js/nav/phrase*.js` + `scripts/test-*.mjs`; `sw.js` SHELL'e eklenmez | G-HEAD, G-SUITE; js/ değiştiği için sürüm artışı (§8) | belirlenimci fikstürler; hiçbir modül içe aktarmaz (grep testi); i18n değişmez |
| A3 | Occupancy R3 "Ek" maddeleri için kaynak sabitlemesi: `nearby.js` "N dolu istasyon elendi" notu ve `pen()` cezası (G1/G2 kökü) | yalnız `scripts/test-occupancy-consistency-contract.mjs` genişletmesi + `docs/occupancy-consistency-contract.md` §2 | G-HEAD, G-SUITE | yeni satırlar KNOWN-GAP; mevcut 12 boşluk sayısı azalmaz |
| A4 | RM-08 ön koşulu: mevcut Mapbox/TomTom/Valhalla rota yanıt **ayrıştırıcılarının** tünel/gişe alanı okumadığını sabitleyen statik tanı | yalnız `scripts/` | G-HEAD, G-SUITE; önce `test-road-events*` kapsamı denetlenir, zaten sabitliyse NO-CHANGE (bu çalıştırmada denetlenmedi) | yeni alan adı uydurulmaz (BL-P2-06 kabulü); ağ yok |

Not: A2 yeni çalışma zamanı dosyası eklediği için "yalnız test" değildir; ayrı görev ve sürüm artışı gerekir.

## 2. Kullanıcı kararı bekleyenler (G-USER) — karar verilmeden kod yazılmaz

| Karar | Açtığı işler | Seçenekler / not |
|---|---|---|
| BL-P3-01: Free kullanıcı Mapbox rotası alsın mı? | proxy `mapbox()` Premium kapısı (M1/M1b) ve rota için aylık üst sınır (M2/M2b) | (a) Premium'a kapat (Free → Valhalla); (b) açık kalsın ama aylık rota sınırı; (c) olduğu gibi. Düzeltme `test-mapbox-route-gate` KNOWN-GAP → ok; **sunucu yeniden başlatma = onay** |
| BL-P2-09 K1–K6 (NDW tazelik, 0/N dolu mu, topluluk bildirimi, TomTom, slotEl vs occupancyView, NDW fiyat etiketi) | R3-a…R3-e (`docs/occupancy-consistency-contract.md` §4) | R3-a saf `occupancyDecision` bile K1/K2'ye bağlı → karar öncesi yazılmaz |
| RM-07 A3/A4/A5/A2b (59f60809) | ≤399 px kalan taşmalar, kalan durak sayısı | önce cihazda `window.__navLayout()` ölçümü |
| BL-P1-06 konum noktası A/B/C, BL-P1-05 × silme yeri | ilgili UI | v0.99.62 bir seçeneği yerelde uyguladı; onay bekliyor |
| BL-P3-08 hangi 4 dil; BL-P3-04 Maps.com kaldırma | i18n / sağlayıcı seçimi | — |
| RM-10 / BL-P3-07 yazılı lisans | BL-P3-03/04/05/06, providerPolicy `unverified` | hukuki; ajan karar veremez |
| Ücretli/harici örnek yanıt (BL-P2-04/06/08/10) | Valhalla turn_lanes, TomTom tünel/gişe, çıkış tabelası, VeriApi şema | sağlayıcı çağrısı onayı |

## 3. Ortam/onay kapılı (ajan yalnız onayla)

| İş | Kapı |
|---|---|
| BL-P0-02 ana kopya (MBRP @0c6dffd, 35 kirli WIP) eşitleme yöntemi | G-USER; WIP sahibine dokunulmaz |
| integ → `design/modern-ui-soc` push, Beta yayını (BL-P0-06) | G-USER (push/yayın); sonra canlı `version.js` denetimi |
| BL-P0-07 / RM-09 cihaz testi (360/375/393–412 px; www/ ve APK 0.85.x) | gerçek cihaz; `verified` yalnız kullanıcı |
| BL-P3-02 sağlayıcı kataloğu `/v1/providers` canlı | sunucu yeniden başlatma onayı |
| BL-P3-13 CI/hook regresyon kapısı | CI ayarı onayı |
| BL-P3-15 worktree/dal temizliği (50+ worktree) | silme onayı |

## 4. Ortak kabul (her iş)

Ebeveyn = beklenen integ HEAD ve temiz; yalnız adı geçen dosyalar; test silme/gevşetme yok; G-SUITE sıralı;
yalnızca `git add <dosya>`; ff yalnız `--ff-only`; push/yayın/sağlayıcı çağrısı yok; raporda "cihazda doğrulanmadı" ayrımı.
