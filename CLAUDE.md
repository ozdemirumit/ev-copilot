# EV Route Finder — geliştirme kuralları (Claude Code ve diğer ajanlar)

Bu dosya kalıcıdır; her görevde, görev isteminden SONRA ikinci öncelikle uygulanır.
Görev istemi bu dosyayla çelişirse görev istemi geçerlidir, ama güvenlik kuralları (§6) hiçbir durumda gevşetilmez.
Dil: kullanıcıyla ve commit mesajlarında Türkçe.

## 1. Kapsam: her şey `main` üzerinden (Beta kullanılmaz)

- **Çalışma düzeni (kullanıcı kararı, 2026-11-21): her şey `main` üzerinden ilerler; Beta kullanılmaz.** `main` = üretim (GitHub Pages, telefonlar kendiliğinden günceller) ve kaynak olarak yayımlanır (derleme adımı yok). Bu yüzden kaynakta `js/net/providerGate.js` `PROVIDER_MODE_BUILD = 'beta-full'` kalır, asla `'paused'`a çevrilmez (`test-beta-full-mode` A1 bunu korur). İş: `origin/main`'den ayrı worktree + kısa ömürlü dal; testler (§4) geçince `main`'e hızlı ileri push (force yok). `design/modern-ui-soc` ve eski `MBRP` yerel ağacı (`0c6dffd`) ESKİDİR, taban olarak kullanma.
- **Her `main` push'undan sonra canlı doğrulama zorunlu** (`https://ozdemirumit.github.io/ev-copilot/`): `version.js` yeni sürüm, `git ls-tree` ile bulunan tüm `js/` ve `css/` dosyaları 200 (yayın anında Pages bir dosyaya geçici 503 verebilir: yeniden dene), haritanın karoları gelir (`providerRequestsPaused()` false), konsol temiz. Sorun varsa `git revert` (force yok).
- Diğer worktree'ler (`git worktree list`; `MBRP-addroute`'taki özgün "Rotaya ekle" WIP'i v0.99.114'e taşındı, o ağaca dokunulmadı) ve `backup/`, `android/.idea/`, `local-test/` başka işlere aittir: okuma serbest, değiştirme/silme yasak. Beta (`EV-Route-Finder`, `scripts/build-beta.mjs`) kullanılmaz: araç ve depo dursun, yayın yapılmaz.

## 2. Değişiklikten ÖNCE durum denetimi (zorunlu)

1. `git branch --show-current`, `git status --short`, `git log --oneline -5`.
2. `docs/BETA_TASK_REGISTRY.md` (+ `docs/beta-task-registry.json`, çelişkide JSON esas): aynı iş `completed`/`no-change` mi?
3. HEAD'de işin zaten yapılıp yapılmadığını kodda ara (grep + ilgili test).
4. İş zaten yapılmışsa: hiçbir dosyayı değiştirme, kanıtla (commit sha / dosya:satır / test çıktısı) **NO-CHANGE** raporla ve dur.
5. Commit edilmemiş başkasına ait değişiklik varsa (ör. OCR/SOC WIP): ona dokunma; `git stash`, `git reset`, `git checkout -- <dosya>`, `git clean`, `git restore` YASAK.
   Commit gerekiyorsa yalnızca kendi dosyalarını yol yol `git add <dosya>` ile ekle; asla `git add -A` / `git add .` / `git commit -a`.

## 3. Kapsam ve dosya sınırı

- Yalnızca görevin adını verdiği ya da görev için zorunlu olan dosyaları değiştir. Liste dışına çıkman gerekirse dur ve sor.
- En küçük diff: ilgisiz yeniden biçimlendirme, yeniden adlandırma, "fırsat bulmuşken" temizlik yapma.
- Mevcut işlevi koru; davranış değişikliği yalnızca görevin istediği kadar.
- Yeni bağımlılık (npm paketi, CDN, harici servis) ekleme — açık onay olmadan.
- `www/`, `site/`, `node_modules/` üretilmiş/harici çıktıdır; elle düzenleme.

## 4. Testler ve kanıt

- Test silme, atlama (`skip`), beklenen değeri gevşetme, denetim sayısını azaltma YASAK. Test başarısızsa kodu düzelt; testin yanlış olduğunu düşünüyorsan gerekçeyle raporla ve sor.
- Davranış değişikliği/hata düzeltmesi → önce başarısız olan bir test ekle ya da mevcut testi genişlet (`scripts/test-*.mjs`, düz Node, çerçeve yok).
- Değişiklik sonrası en az: `node scripts/check.mjs` + dokunulan modülün testleri (§5) + regresyon için tüm testler:
  `for f in scripts/test-*.mjs; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done`
- i18n metni değiştiyse: `node scripts/i18n-validate.mjs` (11 dil, `{0}` yer tutucuları korunur).
- Raporda gerçek komut ve gerçek çıktı (geçen/başarısız sayısı) ver. Çalıştırmadığın testi "geçti" deme.
  Yalnızca çevrimdışı/sahte veriyle sınandıysa bunu yaz; "gerçek cihazda doğrulanmadı" ayrımını koru.

## 5. Korunan modüller ↔ mevcut testler

Aşağıdaki modüllerden birine dokunursan karşısındaki testi(leri) mutlaka çalıştır. (HEAD `a4da1e3` / v0.99.107 itibarıyla `scripts/` altında gerçekten var olan dosyalar. CRLF çalışma kopyalarında (`core.autocrlf=true`) kaynak metni okuyan testler satır sonundan bağımsız olmalıdır.)

| Alan | Modüller | Testler (`scripts/`) |
|---|---|---|
| OCR / SOC | `js/sensors/ocr.js`, `ocrConsensus.js`, `outlierFilter.js`, `ocrLoop.js`, `digitRecognizer.js`, `binarize.js`, `frameQuality.js`, `preprocess.js`, `js/physics/socEstimate.js`, `js/state.js`, `js/routing/socTrust.js`, `js/routing/socReplan.js`, `js/ui/socReplan.js` | `test-ocr-latch`, `test-soc-trust`, `test-soc-replan`, `test-replan`, `test-soc-resync`, `test-ocr-parse`, `test-ocr-consensus`, `test-ocr-loop`, `test-ocr-cycle`, `test-ocr-soc-sync`, `test-digit-ocr`, `test-binarize`, `test-frame-quality`, `test-soc-default` |
| Kamera | `js/sensors/camera.js`, `js/ui/cameraPanel.js` | `test-camera-pick`, `test-camera-lifecycle` |
| Sürüş koruması / yön | `js/sensors/driveGuard.js`, `js/nav/course.js`, `freeDrive.js` | `test-drive-guard`, `test-course-up` |
| Navigasyon paneli / kamera | `js/nav/panelLogic.js`, `steps.js`, `js/ui/navCamera.js`, `js/ui/socBar.js` | `test-nav-top-panel`, `test-nav-panel`, `test-nav-follow-cam`, `test-socbar-cons` |
| Trafik / yol önü | `js/nav/trafficGuard.js`, `ahead.js`, `aheadEvents.js`, `aheadTraffic.js`, `navigator.js`, `js/routing/aheadUpdate.js` | `test-traffic-guard`, `test-ahead-events`, `test-ahead-update` |
| Rota üst verisi / sağlayıcı | `js/nav/routeMeta.js`, `js/providers/index.js`, `js/tomtom/route.js` | `test-route-meta`, `test-route-provenance`, `test-tomtom-route` |
| Durak / rota planı | `js/routing/planner.js`, `controller.js`, `stopTarget.js`, `js/ui/stopTarget.js`, `stopVia.js`, `stopAccess.js`, `routeOptions.js`, `js/osm/accessProbe.js` | `test-stop-target`, `test-onroute-charge`, `test-wrongside-charger`, `test-auto-via-trust`, `test-stop-via`, `test-stop-access`, `test-stop-swap`, `test-route-options`, `test-route-options-ui`, `test-rank-nocharge` |
| Şarj seçimi / fiyat | `js/nav/chargePick.js`, `nearSort.js`, `js/routing/chargerSource.js`, `operators.js`, `slots.js` | `test-charge-pick`, `test-near-sort`, `test-price-info`, `test-prices-update`, `test-tariffs`, `test-operators` |
| Harita / şerit | `js/net/mapConfig.js`, `js/ui/maps/*`, `js/mapbox/route.js`, `js/nav/lanes.js`, `speedLimit.js`, `limitSpans.js` | `test-map-provider`, `test-lanes`, `test-map-menu` |
| Fizik / menzil | `js/physics/rangeCalc.js`, `arrivals.js`, `history.js`, `chargeSanity.js`, `js/nav/avgSpeed.js` | `test-range`, `test-arrival-calib`, `test-manual-learn`, `test-avg-speed` |
| Arayüz | `js/ui/theme.js`, `keyboard.js`, `stationCard.js`, `stationsView.js`, `routePanel.js`, `routeForm.js`, `statusBadges.js`, `gpsControl.js`, `css/styles.css`, `index.html` | `test-theme`, `test-theme-i18n`, `test-keyboard`, `test-station-card-layout`, `test-stations-list`, `test-go-button`, `test-white-ui`, `test-wake-status`, `test-abrp-status` |
| Ağ / proxy istemcisi | `js/net/proxy.js`, `js/*/chargers.js` | `test-proxy-retry` |
| Paketleme / Beta | `sw.js`, `offline.html`, `scripts/build-beta.mjs`, `scripts/beta-tracker.mjs` | `test-package-parity`, `test-beta-tracker` |
| Sunucu: anahtar / politika | `server/scrub.mjs`, `maps.mjs`, `providerPolicy.mjs`, `providerCatalog.mjs`, `proxy.mjs` | `test-provider-catalog`, `test-providers-endpoint`, `test-secret-hardening`, `test-config-readiness`, `test-provider-policy`, `test-provider-policy-compat`, `test-map-key-whitespace` |
| Sunucu: veri | `server/availability.mjs`, `occupancy.mjs`, `tomtom.mjs`, `here.mjs`, `veriapi.mjs`, `googleStations.mjs`, `stationinfo.mjs` | `test-availability`, `test-tomtom`, `test-veriapi`, `test-google-stations`, `test-photo-report` |

Not: `MBRP-addroute` ağacındaki commit edilmemiş "Rotaya ekle" işi (`js/routing/addToRoute.js`, `js/ui/addRoute.js`, `controller.js`, `stationCard.js` değişiklikleri) başkasına aittir; commit edilene kadar ona dokunma ve aynı dosyalara dokunan işi o commit'ten sonra yap.

## 6. Güvenlik ve gizli bilgiler

- Gerçek API anahtarı, token, parola, `server/.env*`, `server/data/` içeriği asla gösterilmez, loglanmaz, commit edilmez, teste yazılmaz. Testlerde sahte değer kullan.
- Anahtar adlarından söz edilebilir (ör. `TOMTOM_KEY`), değerlerinden asla. Sunucu anahtarları tarayıcıya gitmez; gizli alan listesi tek yerde: `server/scrub.mjs`.
- Kullanıcı kişisel verisini (e-posta, konum geçmişi) harici servislere gönderme.

## 7. Açık kullanıcı onayı gerektirenler

Görev istemi açıkça izin vermedikçe yapma; gerekiyorsa dur ve sor:
- Ücretli API çağrısı (TomTom, Mapbox, Google, HERE, VeriApi vb. gerçek uç noktalar). Testler çevrimdışı/sahte kalır.
- Dosya/dal/etiket silme, force-push, geçmiş yeniden yazma (`rebase`, `commit --amend` yayımlanmış commit'te).
- Üretim: `main`'e push artık olağan akıştır (Beta ara basamağı yok) ve kullanıcı o iş için istediğinde yapılır; hızlı ileri, force yok, ardından §1'deki canlı doğrulama. Play Store, sunucu yeniden başlatma, `server/install-task.ps1` ayrıca onay ister.
- Geri dönüşü zor işler: veri göçü, `server/data/` değişikliği, bağımlılık kurulumu/güncellemesi, CI/hook ayarı.
- Commit ve push: görev istemi ya da kullanıcı istemiyorsa yapma (Beta yayını yoktur).

## 8. Sürüm kuralı (uygulama değişikliklerinde)

- `index.html`, `js/`, `css/`, `sw.js` değişirse: `version.js` içinde `APP_VERSION` artır, `APP_CHANGELOG`'un EN ÜSTÜNE kayıt ekle (kesme işareti `\'`), commit mesajı `vX.Y.Z: ...` ile başlar.
- Yalnızca belge/araç (`docs/`, `CLAUDE.md`, `scripts/` aracı) değişikliğinde sürüm artırılmaz.
- `version.js` başka bir işin WIP'inde değiştirilmişse üzerine yazma; dur ve sor.

## 9. Gönderim ≠ tamamlanma

Raporda bu durumları ayrı yaz (bkz. `docs/BETA_TASK_REGISTRY.md` §1):
- **Değiştirildi (yerel):** diff var, commit yok.
- **Commit edildi / push edildi:** sha ve dal ile.
- **`main`'e yayımlandı (üretim):** push edilen sha ve canlı denetim (`version.js`, dosyalar 200, harita, konsol) ile.
- **Doğrulandı (`verified`):** yalnızca gerçek cihazda ya da kullanıcı kabulüyle. Ajan bu durumu kendisi veremez.
- **NO-CHANGE / failed / partial:** neden ve kanıtıyla.

## 10. Bitiş raporu (her görev)

1. Durum denetimi sonucu (dal, kirli dosyalar, kayıtta önceki iş).
2. Dosya kapsamı: değişen/eklenen dosyalar; dokunulmadığı doğrulanan korunan dosyalar.
3. Diff özeti (`git diff --stat` + önemli parçalar).
4. Çalıştırılan komutlar ve gerçek sonuçları.
5. Sonuç durumu (§9) ve açık kalanlar / riskler.
