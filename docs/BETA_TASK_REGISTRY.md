# EV Route Finder — Beta görev kaydı (task registry)

> **Kapsam:** Yalnızca Beta, kaynak dalı `design/modern-ui-soc`. `main` / üretim (v0.86.1) bu kaydın dışında.
> **Makine okunur kopya:** [`docs/beta-task-registry.json`](beta-task-registry.json). İki dosya birlikte güncellenir. Çelişki olursa JSON esas alınır.
> **Son güncelleme:** 2026-11-13 06:10 UTC · kaynak HEAD `44308a4` · uygulama v0.99.52
> **Beta önizleme:** `ozdemirumit/EV-Route-Finder` (`main`) → https://ozdemirumit.github.io/EV-Route-Finder/ · son bilinen yayın `620a068` (v0.99.52)

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

**Kimlikler**

- **Yerel oturum** = `~/.claude/projects/D--AI-Codes-Claude-Code-MBRP/` altındaki Claude Code döküm UUID'si. Tam ve kesin.
- **Orkestratör kimliği** = operatörün görev kimliği. Çoğu zaman yalnızca 8 haneli öneki biliniyor; o da sonraki bir görevin istemi bu kimliği andığı için. Oturumla eşleşmesi **çıkarımdır**, güven düzeyi (yüksek/orta/düşük) belirtilir. Hiçbir eşleşme üst veriyle doğrulanmadı.
- Özgün UUID'ler değiştirilmez. Başarısız bir görevin yerini alan görevler `replaced_by` ile bağlanır.

**Bakım:** Yeni her Claude görevi §3'e (tamamlanınca commit/test/yayın bilgisiyle) ve JSON'a eklenir. Ürün fikirleri önce §5'e `planned` olarak girer; görev verilince `queued` olur ve görev UUID'si bağlanır.

## 2. Kuyrukta / çalışan / sınıflandırılmamış (2026-11-13)

| Kimlik | Durum | Konu | Bağlantı ve not |
|---|---|---|---|
| `670880fb-b286-4dd8-ae57-f1fc59a5c15c` | `queued` (operatör) | Rota ara nokta hatası: şarj durağı mavi rotanın dışında | **RM-03.** Aynı hata yerel oturum `bae8d633` tarafından `44308a4` (v0.99.52) ile düzeltildi ve Beta'ya yayımlandı. 670880fb o oturumun kendisi olabilir (eşleşme güveni: orta) ya da başlamamış bir kopya. Başlarsa önce HEAD'i denetlemeli, düzeltme varsa `no-change` ile durmalı ve RM-04 dosyalarına dokunmamalı. |
| `18bfd92d-fc90-480a-95e6-b6f3dfe071a6` | `queued` (operatör) | **Bilinmiyor.** Hiçbir yerel döküm ya da istem bu kimliği anmıyor. | Sınıflandırılmadı. Aday: RM-04 (güven: düşük). Kapsamı öğrenilmeden hiçbir maddeye bağlanmaz. |
| `71ea067c-78cb-40cc-aed5-9ff7754915d0` (yerel) | `running` | O-7 bölünmüş otoyolda karşı yöndeki şarj istasyonunun (Opet/Trugo) seçilmesi | **RM-04.** Commit edilmemiş dosyaları: `js/providers/index.js`, `js/routing/controller.js`, `scripts/test-route-provenance.mjs`, `scripts/test-stop-swap.mjs`, `scripts/test-stop-via.mjs` (değişmiş); `js/osm/accessProbe.js`, `js/routing/stopAccess.js`, `scripts/fixtures/o7-catalca-access.json`, `scripts/test-stop-access.mjs` (yeni). Bu kayıt görevi bu dosyalara dokunmadı. |
| `4843e080-f516-461f-8cd3-3393f5503689` (yerel) | `running` | Bu kayıt dosyasını oluşturma | RM-13. Yalnızca `docs/` altındaki iki dosya. |

## 3. Claude Code teknik görevleri (son 30 + tarihsel)

Sıralama yeniden eskiye. Commit'ler `design/modern-ui-soc` dalında. "Test" sütunu görevin kendi raporudur; bu kayıt testleri yeniden çalıştırmadı.

| # | Yerel oturum | Orkestratör kimliği (güven) | Başlangıç (UTC) | Görev | Durum | Commit / sürüm | Test (bildirilen) | Yayın | RM |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `71ea067c-78cb-40cc-aed5-9ff7754915d0` | — (aday 18bfd92d, düşük) | 11-13 05:43 | Karşı yön şarj istasyonu düzeltmesi | `running` | — | yazılıyor | — | RM-04 |
| 2 | `bae8d633-3093-4167-be2c-932d82446d80` | — (aday 670880fb, orta) | 11-13 05:35 | Otoyol dışı durak zorunlu ara nokta | `completed` | `44308a4` v0.99.52 | test-stop-via 36; 58 dosya + check | Beta `620a068`, canlı 0.99.52 | RM-03 |
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
| RM-03 | Rota dışı şarj durağına ara nokta sapması | P0 | `completed` (doğrulanmadı) | — | bae8d633 → 44308a4; 670880fb (`queued`) |
| RM-04 | Karşı yöndeki şarj istasyonunu reddetme / doğru yön seçimi | P0 | `running` | RM-03 | 71ea067c; aday 18bfd92d |
| RM-05 | OCR kamera kararlılığı ve 5 saniyelik SOC güncellemesi | P1 | `partial` | RM-09 | 7323ad2c, 770f9991, 9fbfb8a9, 3c58e473 |
| RM-06 | Şarj doluluğu ve fiyatlar | P1 | `partial` | RM-10 | 78ea04ca, e1ff80e6, 977928af, 81477e1c |
| RM-07 | Navigasyon arayüzü | P1 | `partial` | — | 65d53ffd, fa2f626a, c6e51a54, 56a718b1 … |
| RM-08 | Şerit yönlendirmesi (ve tünel/köprü uyarıları) | P2 | `partial` | RM-10 | 480d9784, 81c05d03 |
| RM-09 | Android / iOS gerçek cihaz testi ve paketleme | P1 | `planned` | — | b8a2b7fd, 86eaa822 |
| RM-10 | Sağlayıcı lisansı ve yapılandırma (HERE/TomTom Premium) | P1 | `planned` (insan/hukuk kararı) | — | 26b19153, 49d0dc6a, 8929f104 … |
| RM-11 | Saklanan WIP dallarını/çalışma kopyalarını temizleme | P3 | `planned` (kullanıcı onayı gerekli) | RM-06 | — |
| RM-12 | Navigasyon bitince kendi konumuna yakınlaşma | P3 | `planned` | — | 56b5d6af kalıntısı |
| RM-13 | Bu kaydın bakımı | P2 | `running` | — | 4843e080, 55701559 |

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

**RM-05 OCR/kamera.** Teslim edilenler: `ocrLoop` `intervalMs` 5000, sabit en geniş kamera (`e191865`), 63→7 Faz A (`7a9c095`), kararlı OCR testleri. Kabul için cihazda 10 dakika boyunca SOC her 5 sn ±1 sn'de yenilenmeli, örnek veri setinde yanlış tek hane okunmamalı, arka plan/ön plan geçişinden sonra kamera temiz yeniden başlamalı. Açık kalanlar: Faz A sonrası OCR aşamalarının kapsamı, Android ve iPhone'da odak/pozlama/ısınma kararlılığı.

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
