# EV Route Finder — Beta görev kaydı (task registry)

> **Kapsam:** Yalnızca Beta, kaynak dalı `design/modern-ui-soc`. `main` / üretim (v0.86.1) bu kaydın dışında.
> **Makine okunur kopya:** [`docs/beta-task-registry.json`](beta-task-registry.json). İki dosya birlikte güncellenir. Çelişki olursa JSON esas alınır.
> **Son güncelleme:** 2026-11-14 14:50 UTC · yerel entegrasyon dalı `integ/beta-2026-11-14` @`2aee1ae` (v0.99.72; `8f6e71c`..`2aee1ae` BL-P2-05b-1 / BL-P2-05c zinciri eklendi, yalnız `scripts/` araç/test, **push edilmedi**, Beta yayını yok, cihaz testi yok; `4932efe` **reddedildi**) · bu güncelleme yeni yalıtılmış dal `docs/registry-reconcile-2aee1ae` (taban `2aee1ae`) üzerinde; eski `docs/registry-reconcile-2026-11-14` @`1b11704` yalnız okundu, birleştirilmedi · `origin/design/modern-ui-soc` = `132d610` (v0.99.61, son ls-remote kanıtı 2026-11-14; bu görevde ağ yok) · ana kopya `design/modern-ui-soc` @`0c6dffd` hâlâ kirli (35 kayıt, dokunulmadı). Uzlaştırma §7.
> **Önceki güncelleme:** 2026-11-14 08:00 UTC · yerel entegrasyon dalı `integ/beta-2026-11-14` @`7097a3d` (v0.99.72; BL-P2-05a `7097a3d` eklendi, **push edilmedi**, Beta yayını yok, cihaz testi yok) · önceki uzlaştırmalar @`309e044` (06:40 UTC, `b40e715`), @`88313a2` (04:10 UTC, `d25a761`), @`3975941` (03:15 UTC, `f7d0225`) · `origin/design/modern-ui-soc` = `132d610` (v0.99.61, ls-remote 2026-11-14) · ana kopya `design/modern-ui-soc` @`0c6dffd` hâlâ kirli. Uzlaştırma §7. (dal `1b11704`, integ'e alınmadı)
> **Beta önizleme:** `ozdemirumit/EV-Route-Finder` (`main`) → https://ozdemirumit.github.io/EV-Route-Finder/ · son bilinen yayın `4c3bd73` (v0.99.61, kaynak `132d610`, yayımlayan `1d3a3004`). Canlı `version.js` = **0.99.61** (salt okunur okuma: `b069193a` / köprü `5c147383`, 2026-11-14 ~03:30 UTC). Canlı Beta en son **0.99.61** olarak doğrulandı; bu görev yeniden denetlemedi. v0.99.62–0.99.72 ve `8f6e71c`..`2aee1ae` araç commit'leri yayımlanmadı. Önceki: `6540e59` (0.99.58), `415bd81` (0.99.57), `8e62927` (0.99.53).
> **Kalıcı backlog:** 44 BL maddesi, açık hatalar ve backlog dışı tamamlananlar JSON'da (`backlog`, `open_defects`); MD'de yalnızca 2026-11-14 uzlaştırması (§7) ve açık hatalar (§8) var.

## 1. Kurallar

**Durumlar**

| Durum | Anlamı |
|---|---|
| `planned` | Yol haritasında var, Claude'a henüz görev olarak verilmedi. |
| `queued` | Claude'a verildi ama başlamadı (operatörün bildirdiği durum). |
| `running` | Şu anda bir Claude işçisi üzerinde çalışıyor. |
| `completed` | Görev, commit'in `design/modern-ui-soc` dalına push edildiğini ve testlerin geçtiğini bildirdi (salt okunur görevlerde rapor teslim edildi). Cihazda ya da kullanıcı tarafından doğrulanmadı. |
| `verified` | Gerçek cihazda ya da kullanıcı kabulüyle bağımsız olarak doğrulandı. **Şu an hiçbir kayıt bu durumda değil.** |
| `failed` | Görev bitmeden sona erdi (ör. 40 tur sınırı). |
| `no-change` | Görev, iş zaten yapılmış olduğu için bilerek değişiklik yapmadan durdu. |
| `unknown` | Sonuç için yerel kanıt yok. Tamamlanmış sayılmaz. |
| `partial` | Yol haritası maddesinin bir kısmı teslim edildi, kalanı açık. |
| `local-integrated` | Commit yerel `integ/beta-2026-11-14` dalında (fast-forward); `design/modern-ui-soc`'a push yok, Beta yok, cihaz testi yok. Yalnız JSON `local_integration.tasks` içinde kullanılır. |
| `isolated` | Commit yalnız kendi yerel dalında; integ'in atası değil, push yok. Yalnız JSON `local_integration.tasks` içinde kullanılır. |

**Entegrasyon alanı** (JSON `integration`, `integration_vocabulary`): `local-integrated` (integ HEAD'in atası) · `isolated` (yalnız kendi dalında) · `rejected` (bilerek alınmayacak; yerini alan belirtilir) · `blocked` (onay / gerçek veri / lisans eksik) · `pending` (başlamadı) · `none` (salt okunur / değişiklik yok).

**Kimlikler**

- **Yerel oturum** = `~/.claude/projects/D--AI-Codes-Claude-Code-MBRP/` altındaki Claude Code döküm UUID'si. Tam ve kesin.
- **Orkestratör kimliği** = operatörün görev kimliği. Çoğu zaman yalnızca 8 haneli öneki biliniyor; o da sonraki bir görevin istemi bu kimliği andığı için. Oturumla eşleşmesi **çıkarımdır**, güven düzeyi (yüksek/orta/düşük) belirtilir. Hiçbir eşleşme üst veriyle doğrulanmadı.
- Özgün UUID'ler değiştirilmez. Başarısız bir görevin yerini alan görevler `replaced_by` ile bağlanır.

**Bakım:** Yeni her Claude görevi §3'e (tamamlanınca commit/test/yayın bilgisiyle) ve JSON'a eklenir. Ürün fikirleri önce §5'e `planned` olarak girer; görev verilince `queued` olur ve görev UUID'si bağlanır.

## 2. Kuyrukta / çalışan / sınıflandırılmamış (2026-11-13)

| Kimlik | Durum | Konu | Bağlantı ve not |
|---|---|---|---|
| `670880fb-b286-4dd8-ae57-f1fc59a5c15c` | `completed` (köprü; önceki: `queued` operatör) | Rota ara nokta hatası: şarj durağı mavi rotanın dışında | **RM-03.** Köprü `tasks.json` (2026-11-14 okundu): completed, çıkış 0, başlangıç 2026-11-13 05:35:03Z, bitiş 05:43:45Z; sonuç v0.99.52'yi bildiriyor. Başlangıç yerel oturum `bae8d633` (`44308a4`) ile aynı → eşleşme güveni yüksek. |
| `18bfd92d-fc90-480a-95e6-b6f3dfe071a6` | `failed` (operatör / kurtarma denetimi `9dde68df-770e-414f-b6c8-3e7e44cc2261`) | RM-04 karşı yöndeki şarj tesisine erişim (O-7 Çatalca Opet/Trugo) | **RM-04.** Yerel oturum `71ea067c` ile eşleşme (güven: yüksek, operatör istemine dayanır). Commit edilmemiş ve testleri geçen WIP, `7a801c5b-364e-43fc-8736-95d3fd2ab79a` tarafından değiştirilmeden `bb2f676` (v0.99.53) ile tamamlandı. |
| `7a801c5b-364e-43fc-8736-95d3fd2ab79a` (yerel) | `completed` | RM-04 Beta tamamlama: sw.js önbelleği, 11 dilde iki uyarı, v0.99.53, commit/push, Beta önizleme | **RM-04.** `bb2f676` push edildi; Beta `8e62927`. Gerçek cihazda doğrulanmadı. |
| `4843e080-f516-461f-8cd3-3393f5503689` (yerel) | `running` | Bu kayıt dosyasını oluşturma | RM-13. Yalnızca `docs/` altındaki iki dosya. |

## 3. Claude Code teknik görevleri (son 30 + tarihsel)

Sıralama yeniden eskiye. Commit'ler `design/modern-ui-soc` dalında. "Test" sütunu görevin kendi raporudur; bu kayıt testleri yeniden çalıştırmadı.

| # | Yerel oturum | Orkestratör kimliği (güven) | Başlangıç (UTC) | Görev | Durum | Commit / sürüm | Test (bildirilen) | Yayın | RM |
|---|---|---|---|---|---|---|---|---|---|
| 0 | `7a801c5b-364e-43fc-8736-95d3fd2ab79a` | — (kurtarma denetimi 9dde68df sonrası) | 11-13 06:30 | RM-04 Beta tamamlama (18bfd92d WIP'i + sw.js önbelleği + 11 dil + v0.99.53) | `completed` | `bb2f676` v0.99.53 | check (173 dosya) + 60 test dosyasının hepsi geçti; test-stop-access 69/69 (sw.js önbellek ve 11 dil `{0}` denetimi dahil); i18n-validate 11 dil 410/410. Yalnızca çevrimdışı/sahte testler; gerçek cihaz yok. | Beta `8e62927`, canlı 0.99.53 | RM-04 |
| 1 | `71ea067c-78cb-40cc-aed5-9ff7754915d0` | `18bfd92d` (yüksek) | 11-13 05:43 | Karşı yön şarj istasyonu düzeltmesi | `failed` (commit edilmeden bitti; WIP korundu, yerini 7a801c5b aldı) | — (WIP `bb2f676` içinde) | test-stop-access.mjs yazıldı; denetime göre geçiyordu | — | RM-04 |
| 2 | `bae8d633-3093-4167-be2c-932d82446d80` | — (aday 670880fb, yüksek) | 11-13 05:35 | Otoyol dışı durak zorunlu ara nokta | `completed` | `44308a4` v0.99.52 | test-stop-via 36; 58 dosya + check | Beta `620a068`, canlı 0.99.52 | RM-03 |
| 3 | `330bdbd7-a2e3-409f-844e-936e2b1be01a` | — | 11-13 05:31 | Başarısız e1168bd5 Faz A uzlaştırma | `no-change` | — (zaten `10f5ad1`) | — | — | RM-06 |
| 4 | `e83e6d43-b3ab-4a35-bf5e-e680ec7fa710` | — | 11-13 05:27 | v0.99.51'i Beta önizlemeye yayımla | `completed` | — | check + 57 dosya | Beta `ae392d6`, canlı 0.99.51 | RM-07 |
| 5 | `65d53ffd-f739-468a-a578-c74d99312a2b` | — | 11-13 04:45 | Dönüşümlü hücrede ETA | `completed` | `6d64c9a` v0.99.51 | 3045 geçti / 57 dosya | e83e6d43 ile | RM-07 |
| 6 | `56a718b1-8b9d-4065-ab5b-a36ed70db37c` | `068ee562` (yüksek) | 11-13 04:42 | Nav üst panel boşluk denetimi (salt okunur) | `completed` | — | — | — | RM-07 |
| 7 | `fd092bb9-0e6a-4955-a975-b671887dd414` | — | 11-13 04:40 | Rota planlama SOC kontrolünü sadeleştir | `no-change` | — (zaten v0.95.0 `2c0beaa`) | — | — | RM-07 |
| 8 | `3368710f-143d-4353-a224-9080dd66af77` | — | 11-13 04:34 | Beta offline "Tekrar dene" adresi + v0.99.50 yayını | `completed` | `cffd469` | 57 dosya, 3034 denetim | Beta `414e174` (canlı denetim yapılmadı) | RM-09 |
| 9 | `86eaa822-34d3-4540-90ce-67feef6a75fa` | — | 11-13 04:29 | Çevrimdışı paket eşliği testi | `completed` | `0cef98b` | test-package-parity | — | RM-09 |
| 10 | `b8a2b7fd-4cdc-4867-a299-d2fb652e89b1` | `f3cdaa37` (yüksek) | 11-13 04:24 | Paketleme eşliği denetimi (salt okunur) | `completed` | — | — | — | RM-09 |
| 11 | `fa2f626a-04aa-469f-895c-67b1c79f2eb8` | — | 11-13 04:15 | Eski trafik zamanlayıcısı + planlar arası canlı ETA | `completed` | `5b4451e` v0.99.50 | check + 56 dosya | — | RM-07 |
| 12 | `027e95d4-76d9-43fb-9c15-15181388fdef` | `f330206f` (yüksek) | 11-13 04:13 | Trafik zamanlayıcısı/ETA denetimi (salt okunur) | `completed` | — | — | — | RM-07 |
| 13 | `c6e51a54-71aa-4205-a5be-6b66909a11c2` | `1b30225e` (yüksek) | 11-13 04:03 | Canlı trafik sağlayıcı koruması (fail-closed) | `completed` | `85d7605` v0.99.49 | 56 dosya | — | RM-07 |
| 14 | `4c135e89-442f-48ee-b00d-18a896909ee5` | `fb084541` (yüksek) | 11-13 03:58 | Sağlayıcılar arası trafik karışması denetimi | `completed` | — | — | — | RM-07 |
| 15 | `f288c670-7a22-4987-be5d-3116e44a182a` | `d1e15346` (yüksek) | 11-13 03:53 | Trafik kaynağı (trafficSource) | `completed` | `250cf49` v0.99.48 | — | — | RM-07 |
| 16 | `00381d91-dcee-4f57-a50d-d70ab589b061` | `b0392b76` (yüksek) | 11-13 03:52 | Rota yenileme kaynağı denetimi | `completed` | — | — | — | RM-07 |
| 17 | `51115fc9-e8dc-4594-ae25-56d54a7c820d` | `0a816d5c` (yüksek) | 11-13 03:45 | fetchRoute routeMeta etiketi | `completed` | `6e8a911` v0.99.47 | 55 dosya | — | RM-10 |
| 18 | `fe8fb6f0-6f72-48c7-aecf-e50827ed9a55` | `778f0714` (yüksek) | 11-13 03:39 | Saf routeMeta modeli | `completed` | `2029b87` v0.99.46 | 87 routeMeta testi | — | RM-10 |
| 19 | `480d9784-7cd1-4ce6-9c39-09c28ec15bbe` | `1fb9a1cb` (yüksek) | 11-13 03:36 | HERE/TomTom/OSM/Mapbox şerit-tünel-köprü karşılaştırma | `completed` | — | — | — | RM-08 |
| 20 | `81c05d03-e590-48a1-8018-2240eee5237f` | `675931b6` (orta) | 11-13 03:33 | TomTom şerit/köprü/tünel veri hazırlığı | `completed` | — | — | — | RM-08 |
| 21 | `5e157d70-befa-4733-96d6-37387a5b3a4b` | — | 11-13 03:29 | Boşluklu TOMTOM_MAP_KEY = yapılandırılmamış | `completed` | `2f3ca19` v0.99.45 | — | — | RM-10 |
| 22 | `9b081a54-069c-45be-a3d0-6c6e30054dc3` | `675e4001` (yüksek) | 11-13 03:24 | Yapılandırma hazırlık testleri | `completed` | `a53ebe9` | 186 denetim | — | RM-10 |
| 23 | `8929f104-5f62-4d51-8be6-d6634193830e` | — | 11-13 03:15 | TOMTOM_KEY tarayıcıya gitmez | `completed` | `2ed96a8` v0.99.44 | check + 51 dosya | — | RM-10 |
| 24 | `05a17d5f-caa6-4d1f-8bf3-1ae712cebf19` | `8e9981e5` (orta) | 11-13 03:13 | API anahtarı hazırlık denetimi | `completed` | — | — | — | RM-10 |
| 25 | `9fbfb8a9-b95a-47c6-8bb6-df86d32f04a1` | — | 11-13 03:03 | Kırılgan OCR çevrim testi | `completed` | `7a5f6be` | — | — | RM-05 |
| 26 | `c0d062f7-8f97-4799-af00-27fe55b2fc36` | — | 11-13 02:55 | Sağlayıcı politika uyumluluk tanısı | `completed` | `5725303` | — | — | RM-10 |
| 27 | `49d0dc6a-fcf4-4f9d-86b0-a1d6b3ae6874` | — | 11-13 02:42 | Sağlayıcı politika kaydı | `completed` | `ef19919` v0.99.43 | — | — | RM-10 |
| 28 | `26b19153-83af-477f-8a90-8bdf03d38a07` | `f8ccc3c8-d24d-41fa-b6e6-765d55415e11` (yüksek) | 11-13 02:37 | HERE/TomTom lisans + kod uyumluluk denetimi | `completed` | — | — | — | RM-10 |
| 29 | `0118d23a-1606-45cb-9eb8-c439b65d3c9d` | — | 11-13 01:55 | Harita sağlayıcı API karşılaştırması | `completed` | — | — | — | RM-10 |
| 30 | `81477e1c-9dac-4369-9334-af54df138449` | — | 11-13 01:26 | Şarj istasyonu veri kaynakları araştırması | `completed` | — | — | — | RM-06 |

**Tarihsel (son 30'un öncesi)**

| Yerel oturum | Orkestratör kimliği (güven) | Başlangıç | Görev | Durum | Commit / sürüm | Bağlantı |
|---|---|---|---|---|---|---|
| `ded881b5-4cca-4286-b5ee-5e8d6cd90377` | — | 11-13 00:42 | Rota seçenekleri UI testinde dinamik sürüm | `completed` | `81aee78` | RM-07 |
| `770f9991-623f-4411-ac06-84fe84f381af` | — | 11-13 00:13 | OCR 63→7 Faz A | `completed` | `7a9c095` v0.99.42 | RM-05 |
| `3c58e473-9750-445f-8381-b6d056426bb7` | `9b4f4190-9c0b-4bea-96ec-123a6c363430` (yüksek) | 11-12 23:28 | OCR 63/7 tanısı | `completed` | — | RM-05 |
| `7323ad2c-ce9a-4137-9bb0-f874ec225e7b` | — | 11-12 22:44 | Kamera C2: sabit en geniş, zoom kaydırıcısı yok | `completed` | `e191865` v0.99.41 | RM-05 |
| `31647590-d65d-4e04-937f-6ebc632d06ff` | `06bddee2-6f49-4cfb-b4e3-c500fb2dcf5a` (yüksek) | 11-12 22:42 | Kamera C1 denetimi | `completed` | — | RM-05 |
| `977928af-228a-4a63-a00b-c78081f38acd` | — | 11-12 22:36 | Rota seçenekleri Faz B2 UI | `completed` | `740627e` v0.99.40 | RM-06; 59d19e98 ve e1168bd5'in yerine |
| `e1ff80e6-a1e4-4e9d-8b8a-c5c5916c6b13` | — | 11-12 22:25 | Rota seçenekleri Faz B1 model | `completed` | `181da91` v0.99.40 | RM-06; 59d19e98 ve e1168bd5'in yerine |
| `feb88192-015f-47a4-b79b-ff61b31659dd` | `060242ea-d759-401e-9812-e90cc151c0d2` (yüksek) | 11-12 22:23 | 59d19e98 sonrası kurtarma denetimi | `completed` | — | RM-06 |
| `eae323eb-8b47-4054-a8db-d848b6c4c7bc` | — (aday 59d19e98, orta) | 11-12 22:10 | Rota seçenekleri Faz B (birleşik) | `failed` | — | Yerini alanlar: e1ff80e6, 977928af |
| `78ea04ca-94ca-4601-ac4a-96499014efc1` | — | 11-12 22:04 | Yakındaki istasyon sıralaması | `completed` | `10f5ad1` v0.99.39 | RM-06; e1168bd5 Faz A'nın yerine |
| `55701559-cbf2-4b97-acc8-adf4b8bde040` | — | 11-12 21:59 | Başarısız görev uzlaştırması (salt okunur) | `completed` | — | RM-13 |

Daha eski sürümler (v0.40–v0.99.38) için tek kaynak `git log` ve `js/version.js` değişiklik günlüğüdür. Bu kayıt onları tek tek görev olarak listelemiyor; görev UUID'leri bilinmiyor.

## 4. Başarısız ve belirsiz orkestratör görevleri

| Orkestratör kimliği | Durum | Konu | Neden | Yerini alan | Açık kalan |
|---|---|---|---|---|---|
| `e1168bd5-066e-4290-84ef-4b079f7a841e` | `failed` | Yakın istasyon sıralaması + rota seçenekleri + fiyat | 40 tur sınırı; v0.100.0 yarım iş | `78ea04ca` (10f5ad1), `e1ff80e6` (181da91), `977928af` (740627e); uzlaştırma `55701559`, `330bdbd7` | Yarım iş yerel `wip/v0.100.0-price-route-failed-20261110` (`48f4d5e`) dalında, push edilmedi → RM-11 |
| `59d19e98-b494-42b7-aae7-165fa95bde86` | `failed` | Rota seçenekleri Faz B | 40 tur sınırı | `e1ff80e6`, `977928af`; kurtarma `feb88192` | — |
| `ff92aaa1-c1e8-4de4-9ec3-96b839af50e1` | `failed` | **Bilinmiyor** | Bilinmiyor | — | Operatörden kapsam gerekli |
| `29b9e9a5-cda5-47aa-a38f-a8cb9738462b` | `failed` | İnce varış çubuğu/hız kaydırıcısı/sarı şerit kaldır, büyük hız levhası | Kayıt yok | `f44cc1d`, `32952c0` (büyük olasılıkla) | Görsel doğrulama yok |
| `56b5d6af-ca62-4f92-acff-4c0d08760bcc` | `failed` | Birleşik nav üst panel / course-up / ortalama hız / sabit kamera / 5 sn OCR | 40 tur sınırı | `1c0c1d1`, `4eed4a5`, `6f57319`, `f44cc1d`, `e191865` | Navigasyon bitince konuma yakınlaşma doğrulanmadı → RM-12 |
| `5ad94fd2-980c-42b3-a59e-ed77b98af669` | `failed` | Ortalama hız | 40 tur sınırı | `6f57319` | Dar ekran taşması, gerçek iPhone |
| `36fb2fa3-86bf-40ce-9d63-6337f3d3dfbd` | `failed` | Birleşik iPhone görevi | 40 tur sınırı | `0dba4f0`, `1c0c1d1`, `4eed4a5`, `a6f3a53`, `353dd11` | Gerçek iPhone testi yok → RM-09 |
| `2ad04ab9` | `unknown` | Kırılgan OCR testi tanısı (9fbfb8a9 anıyor) | — | — | Yerel döküm yok |
| `0a39e01b` | `unknown` | Uzlaştırma (3c58e473 "tamamlandı" diyor) | — | — | Yerel döküm yok |
| `5674fd65` | `unknown` | UI kompaktlaştırma (e1168bd5 çakışması yüzünden engellendi) | — | — | Sonucu bilinmiyor |
| `65664093` | `unknown` | Kompakt UI (çakışmayı önlemek için durdu) | — | — | Sonucu bilinmiyor |

## 5. Ürün yol haritası (henüz görev verilmemiş olanlar dahil)

| RM | Başlık | Öncelik | Durum | Bağımlı | Bağlı görevler |
|---|---|---|---|---|---|
| RM-01 | İnsan sesine yakın doğal Türkçe navigasyon sesi (TTS) | P1 | `planned` | RM-09 | — |
| RM-02 | Açık / koyu / otomatik tema | P2 | `planned` | — | — |
| RM-03 | Rota dışı şarj durağına ara nokta sapması | P0 | `completed` (doğrulanmadı) | — | bae8d633 → 44308a4; 670880fb (`completed`, köprü) |
| RM-04 | Karşı yöndeki şarj istasyonunu reddetme / doğru yön seçimi | P0 | `completed` (doğrulanmadı) | RM-03 | 71ea067c/18bfd92d (`failed`) → 7a801c5b → `bb2f676`, Beta `8e62927`; denetim 9dde68df |
| RM-05 | OCR kamera kararlılığı ve 5 saniyelik SOC güncellemesi | P1 | `partial` | RM-09 | 7323ad2c, 770f9991, 9fbfb8a9, 3c58e473 |
| RM-06 | Şarj doluluğu ve fiyatlar | P1 | `partial` | RM-10 | 78ea04ca, e1ff80e6, 977928af, 81477e1c |
| RM-07 | Navigasyon arayüzü | P1 | `partial` | — | 65d53ffd, fa2f626a, c6e51a54, 56a718b1 … |
| RM-08 | Şerit yönlendirmesi (ve tünel/köprü uyarıları) | P2 | `partial` | RM-10 | 480d9784, 81c05d03 |
| RM-09 | Android / iOS gerçek cihaz testi ve paketleme | P1 | `planned` | — | b8a2b7fd, 86eaa822 |
| RM-10 | Sağlayıcı lisansı ve yapılandırma (HERE/TomTom Premium) | P1 | `planned` (insan/hukuk kararı) | — | 26b19153, 49d0dc6a, 8929f104 … |
| RM-11 | Saklanan WIP dallarını/çalışma kopyalarını temizleme | P3 | `planned` (kullanıcı onayı gerekli) | RM-06 | — |
| RM-12 | Navigasyon bitince kendi konumuna yakınlaşma | P3 | `partial` (yalnız yerel `f4061e3`, push yok) | — | 56b5d6af kalıntısı |
| RM-13 | Bu kaydın bakımı | P2 | `running` | — | 4843e080, 55701559, 01d65a9e, d396b5a8, d4d3bb36 |
| RM-14 | Google Places "bazı alanlar taranamadı" uyarısı + 502/429/402 dayanıklılığı | P1 | `failed` (tek deneme b8d9813e başarısız; açık, DEF-01) | — | 5d643ae3, eaf84549, 9f9ad1db |

### Kabul ölçütleri

**RM-01 Doğal Türkçe ses.** Şu an: `js/advisor/voice.js` Web Speech API ya da yerel TTS kullanıyor, dile göre ses seçiyor. Ses robotik ve cihaza bağlı; APK WebView ses sorunu biliniyor.
- Doğal Türkçe cümleler ("300 metre sonra sağa dönün", yol adları, çıkış numaraları) saf ve test edilmiş bir cümle kurucudan üretilir.
- Mesafe yuvarlama ve anons zamanlaması (uzak/yakın/şimdi) çevrimdışı testlerle kapsanır.
- Varsa nöral ya da yüksek kaliteli ses seçilir, yoksa belirli bir sırayla cihaz TTS'ine düşülür. İstemciye gizli anahtar gitmez.
- Anonslar üst üste binmez, eskimiş anons kesilir, sessiz ayarına uyulur.
- Android APK'da (ekran açık/kilitli) ve iPhone Safari/Chrome'da cihazda doğrulanır.

**RM-02 Tema.** Ayar seçenekleri Açık / Koyu / Otomatik, `evcpb.*` deposunda saklanır. Otomatik mod `prefers-color-scheme`'i canlı izler. Harita stili her sağlayıcıda temaya uyar. Navigasyon paneli iki temada da en az WCAG AA kontrastı sağlar. Ayarın saklanması ve CSS değişkeni kapsamı test edilir.

**RM-03 Ara nokta sapması.** Mavi rota seçilen her duraktan en fazla 150 m geçer. Sapma bir kez sayılır. Yeni rota alınamazsa ilk plan uyarıyla geri yüklenir. `verified` için gerçek bir yolculukta doğrulama gerekir.

**RM-04 Karşı yön.** Bölünmüş otoyolda (O-7 Opet/Trugo örnek verisi) karşı yöndeki istasyon seçilmez. Yalnızca yasal giriş ya da U dönüşü sapma maliyeti yol ağından hesaplanırsa seçilebilir. Erişim kuş uçuşu yakınlıktan çıkarılmaz, bariyer üstünden yola bağlanmaz. Karşılıklı dinlenme tesisleri ve doğru yön alternatifleri için regresyon testleri yazılır. Beta önizlemeye yalnızca tüm testler geçince yayımlanır.

**RM-05 OCR/kamera.** Teslim edilenler: `ocrLoop` `intervalMs` 5000, sabit en geniş kamera (`e191865`), 63→7 Faz A (`7a9c095`), kararlı OCR testleri. Kabul için cihazda 10 dakika boyunca SOC her 5 sn ±1 sn'de yenilenmeli, örnek veri setinde yanlış tek hane okunmamalı, arka plan/ön plan geçişinden sonra kamera temiz yeniden başlamalı. Yalnız yerel (`integ/beta-2026-11-14`, push yok): 63→7 kilidi `034ca37` v0.99.65, OCR1/OCR2 çapraz denetimi `2efbea5` v0.99.67, SOC 18→77 A kararı `3975941` v0.99.68. Açık kalanlar: Faz A sonrası OCR aşamalarının kapsamı, Android ve iPhone'da odak/pozlama/ısınma kararlılığı.

**RM-06 Doluluk/fiyat.** Teslim edilenler: `availability.mjs` (arayüz kullanmıyor), VeriApi.Pro tarifeleri, yakın istasyon sıralaması, rota seçenekleri. Kabul ölçütleri:
- Doluluk yalnızca tazeyse gösterilir; zaman damgası ve kaynak etiketi yanında yer alır.
- Fiyat uydurulmaz; gerçek ve tahmini fiyat her yerde ayrı etiketlenir.
- Testler kaydedilmiş örnek verilerle çevrimdışı çalışır.
- VeriApi şeması canlı veriyle doğrulanır.

**RM-07 Navigasyon arayüzü.** Açık kalanlar: dönüşümlü hücrede durak sayısı (068ee562 denetimi), 399 px ve altında taşma, ETA hücresinin cihazda denenmesi. Kabul için 360 px ve iPhone genişliklerinde ekran görüntüsü alınır.

**RM-08 Şerit.** Teslim edilen: Mapbox şerit paneli (v0.99.35). Şerit okları yalnızca etkin rotanın sağlayıcısından gelir, sağlayıcılar karıştırılmaz. Veri yoksa panel gizlenir. Her sağlayıcı için örnek veri testi yazılır. TomTom/HERE şerit verisi ve tünel/köprü uyarıları açık.

**RM-09 Cihaz testi ve paketleme.** `www/` ve Android kopyaları eski (0.85.x), Beta APK yeniden üretilmeli. iPhone'da driveGuard, course-up ve OCR arka plan/ön plan geçişi hiç cihazda denenmedi. Her derleme için yazılı bir cihaz test listesi tutulur (cihaz, işletim sistemi, sürüm, sonuç). Bir madde `completed`'dan `verified`'a ancak bu listeyle geçer.

**RM-10 Lisans.** Kod tarafı tamam. Her sağlayıcı ve kullanım için lisans koşulları yazılı olarak onaylanmalı, ardından `providerPolicy.mjs` "unverified" durumundan çıkarılmalı.

**RM-11 Temizlik.** Kapsam: `wip/v0.100.0-price-route-failed-20261110`, `wip/nav-split-tmp` ve `D:\AI-Codes\Claude Code\MBRP-navsplit`. Kullanıcı açıkça onaylamadan hiçbiri silinmez.

**RM-12 Konuma yakınlaşma.** Önce salt okunur denetim yapılır. Davranış eksikse uygulanır ve "navigasyon durdu → kamera kullanıcının üstünde" testi eklenir.

**RM-13 Bakım.** Her yeni görev UUID, durum, commit, test ve yayın bilgisiyle eklenir. Başarısız görevler yerini alan görevlere bağlanır. Bilinmeyenler bilinmeyen olarak kalır.

## 6. İşçilerle çakışmayı önleme

- Bu kayıt yalnızca `docs/BETA_TASK_REGISTRY.md` ve `docs/beta-task-registry.json` dosyalarını değiştirir. Commit'ler yalnızca bu yolları içerir.
- Çalışan bir işçinin (şu an 71ea067c) commit edilmemiş dosyaları kayıt güncellemesi sırasında stash'lenmez, geri alınmaz ve commit'e alınmaz.
- `main`, üretim sitesi ve Beta önizleme deposu bu kayıt tarafından değiştirilmez.

## 7. Yerel entegrasyon uzlaştırması (2026-11-14)

Kaynak: `integ/beta-2026-11-14` = `132d610..2aee1ae` (yerel dal, push yok; ilk uzlaştırma @`aecfdfb`, SOC A `3975941` 03:15 UTC'de, BL-P2-01 `d6b924e` ve BL-P0-05 `88313a2` 04:10 UTC'de, BL-P2-02 `6c62cf1` ve BL-P2-03 `309e044` 06:40 UTC'de, BL-P2-05a `7097a3d` 08:00 UTC'de, BL-P2-05b-1/05c zinciri `8f6e71c`..`2aee1ae` 14:50 UTC'de eklendi; `4932efe` reddedildi). Hiçbir madde `completed`/`verified` yapılmadı: `completed` için `design/modern-ui-soc`'a push gerekir. Ayrıntı JSON `local_integration` ve ilgili `backlog.items[].reconciled`.

| BL / RM | Commit (yerel) | Kayıt durumu | Kanıt (çevrimdışı, temiz worktree @aecfdfb) | Açık kalan |
|---|---|---|---|---|
| BL-P0-02 | integ dalı | partial | 8 commit yalnızca yerel; ana kopya kirli | Eşitleme yöntemi kullanıcı kararı; push |
| BL-P0-03 | `171a1ef` v0.99.64 | partial | test-nav-top-panel 81/0, test-nav-topbar 54/0, test-white-ui 83/0 | Push, yayın, cihaz; `.tmp-upd-test.py` sahipliği doğrulanmadı. "Limit" anahtarı @309e044'te 11 dil dosyasının hepsinde var (`d6b924e` ile eklendi, i18n-validate çıkış 0); ekranda görünümü cihazda doğrulanmadı |
| BL-P0-04 | `171a1ef` v0.99.64 | partial | test-lanes 35/0 | Push, yayın, cihaz |
| BL-P1-01 | `034ca37` v0.99.65 | partial | test-ocr-latch 28/0, test-ocr-consensus 59/0 | Push, yayın, cihaz |
| BL-P1-02 | `2efbea5` v0.99.67 (`53d0b07` cherry-pick) | partial | test-ocr-readroi 26/0, test-ocr-parse 24/0 | Push, yayın, cihaz |
| BL-P3-02 | `29e3a30` (server) | partial | test-provider-catalog 133/0, test-providers-endpoint 44/0 | Sunucu yeniden başlatma (onay) kanıtı yok |
| BL-P3-12 / RM-12 | `f4061e3` v0.99.66 | partial | test-nav-stop-recenter 23/0 | Push, yayın, cihaz |
| BL-P1-05 | `7419ffd` v0.99.63 | partial (değişmedi) | — | **Karar bekliyor**: 8 satır yerine %30 sapması, × silme yeri |
| BL-P1-06 | `341c017` v0.99.62 | partial (değişmedi) | — | **Karar bekliyor**: A/B/C seçimi |
| BL-P1-03 | `3975941` v0.99.68 (A kararı) | partial (yalnız yerel entegre; önceki: planned) | @3975941: test-soc-resync 55/0 | Push, yayın, cihazda 18→77 senaryosu; DEF-02 açık. Sürüşte 18→77 sıçraması bilerek reddedilir (A) |
| BL-P2-01 | `d6b924e` v0.99.69 | partial (yalnız yerel entegre; önceki: planned) | @88313a2: test-ahead-events 328/0; i18n 11 dil 671/671 | Push, yayın, cihazda dil kontrolü |
| BL-P0-05 | `88313a2` v0.99.70 | partial (yalnız yerel entegre; önceki: planned) | @88313a2: test-auto-via-trust 21/0 | Push, yayın, cihaz; kapsamdaki `advisor/fallback.js` bu commit'te değişmedi (gerekliliği denetlenmedi) |
| BL-P2-03 | `309e044` v0.99.71 | partial — yerel entegrasyon tamam, yayın/cihaz doğrulaması bekliyor (önceki: planned) | @309e044: test-road-events 184/0, test-route-meta 87/0; 78 test dosyası 0 FAIL | Push, yayın, cihaz. Model saf, runtime'a **bağlı değil** (js/ içinde import yok). BL-P2-05 (harici API / sağlayıcı örnek verisi) `planned`/bekliyor |
| BL-P2-05 → BL-P2-05a | `7097a3d` v0.99.72 | partial — yerel entegre, doğrulanmadı (BL-P2-05 önceki: planned; 29de0e39 05a/05b olarak böldü) | @7097a3d: test-road-events-adapt 110/0, test-road-events 184/0; 79 test dosyası 0 FAIL | Push, yayın, cihaz. Bağdaştırıcı fail-closed (0 olay, 0 yetenek), runtime'a **bağlı değil** (js/, index.html, sw.js içinde import yok); fixture'lar yalnız `*-synthetic.json` |
| BL-P2-05 → BL-P2-05b | — | planned — bekliyor (pending) | — | Gerçek kayıtlı sağlayıcı yanıtı yok: kullanıcı mevcut Mapbox yanıtını yerelde kaydeder (anonim, yeni API çağrısı yok); ancak o zaman görülen alanlar `verified` olabilir |
| BL-P2-05b → BL-P2-05b-1 | `8f6e71c` (araç) | partial — `local-integrated` | @2aee1ae: test-mapbox-sanitize 246/0 (göç sonrası) | Gerçek yanıtla hiç çalıştırılmadı; push, yayın, cihaz |
| BL-P2-05b → BL-P2-05b-2 | — | planned — `blocked` | — | Kullanıcının kaydettiği gerçek Mapbox yanıtı + lisans izni yok; yeni API çağrısı yapılmaz |
| BL-P2-05c-1 | `78d245c` (araç) | partial — `local-integrated` | @2aee1ae: test-sanitize-core 411/0 | Runtime'a bağlı değil; push, yayın |
| BL-P2-05c-2 (05c-2a / T0 / T1 / T2 / T3 / T4 / 05c-2h / T4b) | `6e58d6b`, `47ddc84`, `fc3f1c4`, `3e8471c`, `111028c`, `971e8a3`, `78d1508`, `2aee1ae` | partial — `local-integrated` (hepsi integ @2aee1ae atası) | @2aee1ae: test-mapbox-sanitize 246/0, test-sanitize-core 411/0, test-secret-hardening 45/0 | Push, yayın; gerçek sağlayıcı verisi yok |
| BL-P2-05c-2i | `4932efe` | `rejected` (yalnız kendi dalında, `isolated`) | Kendi dalında testler geçti, ama güvenlik kararı `6d2a55a9`: `key: abc123`, `mykey=abc`, `license_key: abc`, `Monkey Key: abc123` kabul ediliyordu | **Birleştirilmez / cherry-pick edilmez**; yerini `2aee1ae` aldı. Dal silme kullanıcı onayı ister |
| BL-P2-04 | — | planned — `blocked` | — | FOSSGIS/Valhalla yanıt kaydı harici çağrı + onay ister; `8f6e71c`..`2aee1ae` içinde ilgili commit yok |

Genel @aecfdfb: `node scripts/check.mjs` 177 dosya (v0.99.67); 74 `scripts/test-*.mjs` 0 FAIL.

Genel @3975941 (MBRP-integ, temiz, çevrimdışı; 085d0d89 bağımsız yeniden çalıştırdı): `check.mjs` v0.99.68 / 255 kayıt / 177 dosya; 75 `scripts/test-*.mjs` 0 FAIL; `i18n-validate` çıkış 0; test-soc-resync 55/0. Yukarıdaki OCR/üst panel kanıtları geçerliliğini korur (aynı testler 75'in içinde). Gerçek cihazda doğrulanmadı.

Genel @88313a2 (MBRP-integ, temiz, `version.js` 0.99.70, çevrimdışı; `3e5c8464` 2026-11-14 ~04:05 UTC bağımsız yeniden çalıştırdı): 76 `scripts/test-*.mjs` 0 FAIL; test-ahead-events 328/0; test-auto-via-trust 21/0; `i18n-validate` en/de/fr/es/it/nl/pl/pt/ro/bg/el her biri 671/671 (eksik/boş/yer tutucu/fazla 0), çıkış 0. `integ` dalına ikisi de fast-forward ile girdi (reflog). **Push yok, Beta yayını yok, cihaz testi yok** → hiçbiri `completed`/`verified`/yayımlandı değil.

Genel @309e044 (MBRP-integ, temiz, `version.js` 0.99.71, çevrimdışı): köprü `729eb124` sonucu — test-road-events 184/0, test-route-meta 87/0, `check.mjs` v0.99.71 / 258 kayıt / 178 dosya, `i18n-validate` çıkış 0, 78 `scripts/test-*.mjs` 0 FAIL. `7dd6d1da` / `996664b6` 2026-11-14 ~06:30 UTC bağımsız yeniden çalıştırdı: aynı sonuç (184/0, 87/0, 78 dosya 0 FAIL, i18n çıkış 0). `309e044` integ'e `git merge --ff-only` ile girdi (`6c62cf1..309e044`). **Push yok, Beta yayını yok, cihaz testi yok.**

Genel @7097a3d (MBRP-integ, temiz, `version.js` 0.99.72, çevrimdışı, sentetik veri): köprü `a14db421` sonucu — test-road-events-adapt 110/0, test-road-events 184/0, test-warn-logic 101/0, test-package-parity 56/0, `check.mjs` v0.99.72 / 259 kayıt / 179 dosya, `i18n-validate` çıkış 0, 79 `scripts/test-*.mjs` 0 FAIL. `9a289b85` / `6ddaffa7` 2026-11-14 ~07:58 UTC bağımsız yeniden çalıştırdı: 110/0, 184/0, 79 dosya 0 FAIL, worktree sonrasında temiz. `7097a3d` integ'e fast-forward ile girdi (reflog: `309e044..7097a3d`). Gerçek sağlayıcı kaydı yok. **Push yok, Beta yayını yok, cihaz testi yok.**

Genel @2aee1ae (bu görev, temiz yalıtılmış worktree `MBRP-regrec2` = integ ile aynı kod, çevrimdışı, sentetik veri): `check.mjs` v0.99.72 / 259 kayıt / 179 dosya; 81 `scripts/test-*.mjs` 0 FAIL; test-mapbox-sanitize 246/0, test-sanitize-core 411/0, test-secret-hardening 45/0, test-road-events-adapt 110/0, test-road-events 184/0, test-beta-tracker 65/0. integ'e `8f6e71c`, `78d245c`, `6e58d6b`, `47ddc84`, `fc3f1c4`, `3e8471c`, `111028c` ayrı ayrı; `971e8a3`, `78d1508`, `2aee1ae` tek fast-forward ile (`18cd438d`, reflog 17:08:33 +0300) girdi. `4932efe` integ'in atası değil. **Push yok, Beta yayını yok, cihaz testi yok.**

SOC A, v0.99.69–72 ve BL-P2-05b/05c görevleri (yalnız yerel, push yok):

| Yerel oturum | Orkestratör (güven) | Başlangıç (UTC) | Görev | Durum | Commit |
|---|---|---|---|---|---|
| `38293e70-1640-4c44-8663-fe21a9ebb923` | `34242e5d` (yüksek) | 11-14 02:42 | SOC 18→77 A düzeltmesi | yerel entegre (push yok; JSON `local_integration.tasks`) | `3975941` @`fix/soc-resync-18-77` |
| `bad8f7a7-c268-4c4c-bc2c-45bc8cb3a807` | `53e5e88c` (yüksek) | 11-14 02:57 | `integ/beta-2026-11-14`'e ff entegrasyon | yerel entegre (push yok; JSON `local_integration.tasks`) | `3975941` @integ |
| `085d0d89-58b5-4220-83ef-e80cacd3d1c8` | `0459c1da` (yüksek) | 11-14 03:03 | SOC A kayıt güncellemesi (yalnız belge) | `isolated` — yalnız belge dalında, integ'e alınmadı (önceki: yerel commit) | `f7d0225` @`docs/registry-reconcile-2026-11-14` |
| `e0a804ef-b70d-4924-b125-19aee3f1cf59` | `1d51df93` (yüksek) | 11-14 03:11 | BL-P2-01 trafik/yağmur 11 dil çevirisi | yerel entegre | `d6b924e` @`fix/ahead-i18n-bl-p2-01` |
| `c03d5bed-427b-4fac-b239-81bd13466769` | `48a66f60` (yüksek) | 11-14 03:22 | `d6b924e`'yi integ'e ff entegrasyon | yerel entegre | `d6b924e` @integ |
| `b069193a-a79d-4db9-9c1d-e6d1d9400a4c` | `5c147383` (yüksek) | 11-14 03:28 | Salt okunur öncelik/kayıt/GitHub uzlaştırması (canlı Beta 0.99.61 okundu) | `completed` (salt okunur) | — |
| `4e18a5d6-3edd-4113-ab3d-2217a6326239` | `0faab0a2` (yüksek) | 11-14 03:34 | BL-P0-05 güvenilmeyen SOC ile otomatik durak/rota değişikliği yok | yerel entegre | `88313a2` @`fix/auto-via-trust-bl-p0-05` |
| `51410636-ead2-4b57-a453-82e5e436f5b3` | `624f8caa` (yüksek) | 11-14 03:49 | `88313a2`'yi integ'e ff entegrasyon | yerel entegre | `88313a2` @integ |
| `3e5c8464-4cae-46cf-8ffe-8a1ef01f276d` | `a2c9d118` (yüksek) | 11-14 04:01 | Kayıt güncellemesi @88313a2 (yalnız belge) | `isolated` — yalnız belge dalında, integ'e alınmadı (önceki: yerel commit; önceki: `running`; köprü completed 04:08:31Z, çıkış 0) | `d25a761` @`docs/registry-reconcile-2026-11-14` |
| `0e09d6e2-30ff-4754-8a3a-251ae35575af` | `55c323fa` (yüksek) | 11-14 05:05 | BL-P2-03 F1 roadEvents ilk deneme | köprü completed, **commit yok** (test-route-meta 86/87, durup sordu) | — |
| `6760caef-100f-43c9-9661-c61e57dc82d9` | `18a9fa54` (yüksek) | 11-14 05:15 | BL-P2-03 F1 roadEvents tamamlama (saf, bağlanmamış) | yerel entegre | `309e044` @`feat/road-events-bl-p2-03` |
| `ea70e9f8-b4ef-4aef-9deb-8620dc40e1ed` | `729eb124` (yüksek) | 11-14 05:33 | `309e044`'ü integ'e ff entegrasyon | yerel entegre | `309e044` @integ |
| `996664b6-cab3-4ec0-b290-2c09dcbf2c41` | `7dd6d1da` (yüksek) | 11-14 06:20 | Kayıt güncellemesi @309e044 (yalnız belge) | `isolated` — yalnız belge dalında, integ'e alınmadı (önceki: yerel commit) | `b40e715` @`docs/registry-reconcile-2026-11-14` |
| `129b44cb-71be-4edc-be56-be38f8747306` | `29de0e39` (yüksek) | 11-14 06:30 | BL-P2-05'i 05a/05b olarak bölen salt okunur analiz | `no-change` (köprü completed, salt okunur) | — |
| `febca2e3-9e81-4ec1-996e-194cc2fb7c8f` | `6fcc2948` (yüksek) | 11-14 06:34 | BL-P2-05a fail-closed bağdaştırıcı iskeleti (saf, bağlanmamış) | yerel entegre (köprü completed) | `7097a3d` @`feat/road-events-adapt-bl-p2-05a` |
| `f0b9fbc1-4309-43e9-a732-9d4076ab8c78` | `a14db421` (yüksek) | 11-14 07:23 | `7097a3d`'yi integ'e ff entegrasyon | yerel entegre (köprü completed) | `7097a3d` @integ |
| `6ddaffa7-3cae-416b-806c-e177f047c39e` | `9a289b85` (yüksek) | 11-14 07:55 | Kayıt güncellemesi @7097a3d (yalnız belge) | `isolated` — integ'e alınmadı | `1b11704` @`docs/registry-reconcile-2026-11-14` |
| `845d8014-4edd-4015-82a5-1e8ac408dc0a` | `def10f79` (yüksek) | 11-14 08:02 | BL-P2-05b gerçek yanıt içe alma aracı tasarımı (salt okunur) | `completed` (salt okunur, NO-CHANGE) | — |
| `baeb3f31-f106-4d1e-8e59-13178404520a` | `20c02374` (yüksek) | 11-14 08:18 | BL-P2-05b-1 yerel Mapbox yanıt temizleyici aracı | yerel entegre | `8f6e71c` @`feat/mapbox-sanitize-bl-p2-05b-1` |
| `4bfda812-eb64-4dc0-a91d-8741018a7ca3` | `9d2f15a7` (yüksek) | 11-14 08:39 | `8f6e71c`'yi integ'e ff | yerel entegre | `8f6e71c` @integ |
| `15a1e9f7-3c2e-4bd6-a89e-51648662662c` | `4d76cae2` (yüksek) | 11-14 08:46 | BL-P2-05c çok sağlayıcılı eşleme/temizleme mimarisi (salt okunur) | `completed` (salt okunur) | — |
| `dbf8f49c-55ea-4fc9-b0d3-c54de4aad7ce` | `ce466d05` (yüksek) | 11-14 08:49 | BL-P2-05c-1 sanitize-core çekirdeği | yerel entegre | `78d245c` @`feat/sanitize-core-bl-p2-05c-1` |
| `ed2afbac-d80a-43f8-903a-63cb787d72b8` | `282272ac` (yüksek) | 11-14 08:59 | `78d245c`'yi integ'e ff | yerel entegre | `78d245c` @integ |
| `ad5ee7b8-ce66-4a29-8c55-9632be7b2ff6` | `4b17b037` (yüksek) | 11-14 09:04 | BL-P2-05c-2 Mapbox göçü denemesi | `no-change` (kaynak göçü yapılmadı) | — |
| `fc43c5df-ba58-432f-ae06-19472ba57436` | `3b87d128` (yüksek) | 11-14 09:28 | BL-P2-05c-2a korkuluk testleri | yerel entegre | `6e58d6b` @`feat/mapbox-core-migrate-bl-p2-05c-2` |
| `e5fb7971-f9be-4f46-932f-ecc48bbcde85` | `a347f128` (yüksek) | 11-14 09:35 | `6e58d6b`'yi integ'e ff | yerel entegre | `6e58d6b` @integ |
| `58e85a23-6b8c-43ed-8257-c6daaec265da` | `f1849969` (yüksek) | 11-14 09:41 | BL-P2-05c-2b çekirdek uyumluluk tasarımı (salt okunur) | `completed` (salt okunur) | — |
| `b2288a4e-5770-4361-be30-13b78869fdc2` | `c33b4eb3` (yüksek) | 11-14 09:48 | BL-P2-05c-2c T0 altın davranış tabloları | yerel entegre | `47ddc84` @`feat/mapbox-golden-tests-bl-p2-05c-2c` |
| `cf92ba4c-55a8-499d-bf67-66d400936636` | `79291cf3` (yüksek) | 11-14 10:05 | `47ddc84`'ü integ'e ff | yerel entegre | `47ddc84` @integ |
| `7668f41c-eee2-46d8-b85e-ca7cf7bc4172` | `44dee9a5` (yüksek) | 11-14 10:11 | BL-P2-05c-2d T1 order/required/errorStyle | yerel entegre | `fc3f1c4` @`feat/sanitize-core-options-bl-p2-05c-2d` |
| `6cedf68d-af4f-40cf-bdc2-34b3292e057a` | `63952a1a` (yüksek) | 11-14 10:32 | `fc3f1c4`'ü integ'e ff | yerel entegre | `fc3f1c4` @integ |
| `54e0e71b-e515-4d5a-91e0-38621caa08e7` | `496a90a8` (yüksek) | 11-14 10:43 | BL-P2-05c-2e T2 presence şeması | yerel entegre | `3e8471c` @`feat/sanitize-core-presence-bl-p2-05c-2e` |
| `b55fed25-db66-4919-b553-bc869e83e9d7` | `5a6fc69b` (yüksek) | 11-14 10:51 | `3e8471c`'yi integ'e ff | yerel entegre | `3e8471c` @integ |
| `2ce327a0-cce0-4d80-aab9-913f52b664b6` | `e26f9b1b` (yüksek) | 11-14 11:01 | BL-P2-05c-2f T3 leakScan seçenekleri + buildSanitized | yerel entegre | `111028c` @`feat/sanitize-core-leakopts-bl-p2-05c-2f` |
| `9c45dca2-0017-407e-a568-a9715bc16336` | `e4247e38` (yüksek) | 11-14 11:11 | `111028c`'yi güvenlik incelemesiyle integ'e ff | yerel entegre | `111028c` @integ |
| `069d3db7-3c77-4fc5-9394-a645f51b416f` | `e6d8a90b` (yüksek) | 11-14 11:16 | BL-P2-05c-2g T4 Mapbox temizleyicisi çekirdeğe | yerel entegre | `971e8a3` @`feat/mapbox-core-migrate-bl-p2-05c-2g` |
| `337c2787-60ef-4f97-b952-373dac3b7260` | `d5c7ca36` (yüksek) | 11-14 11:43 | T4 `971e8a3` entegrasyon öncesi denetim (salt okunur) | `completed` (salt okunur) | — |
| `8bd38547-214c-4acf-b205-dfc02be5e701` | `2360342b` (yüksek) | 11-14 11:52 | BL-P2-05c-2h T4 korkuluk testleri | yerel entegre | `78d1508` @`feat/mapbox-core-t4-guardrails-bl-p2-05c-2h` |
| `7b8e6186-a06a-4c7d-bfb3-25e16e94f1b8` | `8311af43` (yüksek) | 11-14 12:01 | BL-P2-05c-2i "key:" yanlış pozitif dar düzeltme | `isolated` — **`rejected`** (güvenlik gerilemesi) | `4932efe` @`feat/mapbox-core-t4-falsepositive-bl-p2-05c-2i` |
| `3e64bb27-f011-4ed8-bad0-6f526ca25c8d` | `6d2a55a9` (yüksek) | 11-14 12:57 | BL-P2-05c-2j güvenlik kararı: `4932efe` alınmaz, T4b önerisi (salt okunur) | `completed` (salt okunur) | — |
| `d3314713-13dc-46a4-9093-2872c914fe58` | `69d3f626` (yüksek) | 11-14 13:10 | BL-P2-05c-2k T4b fail-closed "key:" dar istisnası (`4932efe`'nin yerine) | yerel entegre | `2aee1ae` @`feat/mapbox-core-t4b-strict-bl-p2-05c-2k` |
| `6162eaa9-8c37-458d-a3ba-ebb2252a63ac` | `255a4896` (yüksek) | 11-14 13:20 | T4b bağımsız inceleme → GO (salt okunur) | `completed` (salt okunur) | — |
| `1c8121ea-4b0d-4ec8-9e64-e5343554711c` | `18cd438d` (orta) | 11-14 14:07 | `971e8a3`, `78d1508`, `2aee1ae`'yi integ'e ff (`111028c..2aee1ae`) | yerel entegre | `2aee1ae` @integ |
| `d4d3bb36-e104-4760-bc6d-3d1d74227c4a` | `9749decc` (yüksek) | 11-14 14:42 | Bu kayıt güncellemesi @2aee1ae (yalnız belge) | `isolated` — integ'e alınmadı (ayrı FF görevi) | bu commit @`docs/registry-reconcile-2aee1ae` |

## 8. Açık hatalar

| ID | Konu | Durum | Not |
|---|---|---|---|
| DEF-01 | Google Places "arama üst sınır" uyarısı, 502/429/402, eski aramanın iptali (b8d9813e FAILED) | açık | integ'de Google commit'i yok; `MBRP-gplaces` WIP commit edilmemiş (17 dosya), korunmalı |
| DEF-02 | SOC 18→77 yukarı düzelmesi takılıyor ("77,77,4") — BL-P1-03 | açık (düzeltme yalnız yerel entegre) | `3975941` v0.99.68 `integ/beta-2026-11-14`'te; push/Beta/cihaz testi yok. Kapanış: push + Beta + cihazda 18→77 |
