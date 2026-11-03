# Harita sağlayıcısı seçimi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Yönetici, Premium kullanıcıların haritasını (OpenFreeMap / Mapbox / Google) yönetim ekranından seçer; anahtarlar sunucuda kalır ve yalnızca yetkili Premium'a verilir; sağlayıcı çalışmazsa harita OpenFreeMap'e döner.

**Architecture:** Sunucuda saf bir `server/maps.mjs` etkin sağlayıcıyı ve anahtarı belirler, `proxy.mjs` bunu `GET /v1/map/config` ile (kota ve günlük tavanla) sunar, yönetim uç noktaları kullanıcıya/varsayılana yazar. İstemcide `mapView.js` açılışta `js/net/mapConfig.js` ile sağlayıcıyı çözer; üç bağdaştırıcı (OpenFreeMap, Mapbox, Google) bugünkü `maplibre.js` arayüzünü verir, Mapbox ve OpenFreeMap ortak bir vektör-harita motorunu paylaşır.

**Tech Stack:** Düz ES modülleri (derleme yok), sıfır bağımlılıklı Node sunucusu, MapLibre GL JS (vendor), Mapbox GL JS, Google Maps JavaScript API.

**Spec:** `docs/superpowers/specs/2026-11-03-harita-saglayici-secimi-design.md` (sonundaki "Karar notları" dahil; yürütücü ikisini birlikte okur).

## Global Constraints

- Gerçek anahtar repoya, teste, günlüğe, sohbete GİRMEZ. Testler `pk.test-dummy` gibi sahte değerler ve sahte sunucu kullanır. Sahibi anahtarları `server\.env`'ye yazar.
- Anahtar değişkenleri: `MAPBOX_MAP_TOKEN` (herkese açık "pk.", sunucu içi `MAPBOX_TOKEN`'dan farklı), `GOOGLE_MAPS_BROWSER_KEY`, isteğe bağlı `GOOGLE_MAP_ID`. Anahtar tanımsızken uygulama %100 bugünkü gibi çalışır.
- Premium olmayan hesap ve anonim cihaz anahtar ALAMAZ. `isPremium` (accounts.mjs) kullanılır; yönetici hesabı ve eski erişim kodu Premium sayılır.
- `Cache-Control: no-store` anahtar yanıtında; anahtar `scrub` kapsamına girer; anahtar cihaza yazılmaz (yalnızca sağlayıcı ADI saklanır).
- Günlük hak: kullanıcı başı `MAP_DAILY_PER_USER` (varsayılan 100), tüm kullanıcılar `MAP_DAILY_TOTAL` (varsayılan 3000); yalnızca anahtar döndüren çağrılar sayılır.
- Açılış: saklı sağlayıcı osm veya oturum yoksa harita beklemeden OpenFreeMap; aksi halde `/v1/map/config` en çok 3 sn beklenir. Hata/zaman aşımı → OpenFreeMap. Sağlayıcı değişikliği sonraki açılışta uygulanır.
- OpenFreeMap'e dönüş sinyalleri: kütüphane yüklenemedi, 25 sn içinde harita yüklenmedi, Google `gm_authFailure`, Mapbox `error` olayında 401/403. Dönüşte tek bildirim, `sessionStorage` bayrağı (`mapForceOsm`), sonra sayfa yenilenir (bayrak varken döngü yok).
- Her sağlayıcı kendi uydusunu kullanır (Mapbox uydu stili, Google `hybrid`); Esri yalnızca OpenFreeMap'te.
- Fatura: yönetim ekranında yalnızca bağlantılar, sayaç yok. `server/costs.mjs` değişmez.
- Çalışma kuralları: `node scripts/check.mjs` commit öncesi; istemci değişikliği `APP_VERSION` artırır ve `version.js` en üstüne kayıt ekler (kaydı betikle yaz, dizide kesme işareti `\u0027`, ters eğik çizgi yok); yeni JS dosyaları `sw.js` SHELL'e; yeni metinler 11 dile (`i18n/keys.extra.json` + `js/i18n/lang/*.extra.js`, doğrulama `node scripts/i18n-validate.mjs <kod>:extra`); sunucu kodu/`.env` değişince `node server\restart.mjs`; `.claude-flow/`, `.swarm/`, `android/.idea/` git'e eklenmez; commit mesajı `vX.Y.Z: ...` + `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Testler repoda: tek dosya `scripts/test-map-provider.mjs` (sıfır bağımlılık, `T_MAP` bu dosyadır; her görev kendi bölümünü ekler, `node scripts/test-map-provider.mjs` hepsini çalıştırır). Bash'te `export PATH="/c/Program Files/nodejs:$PATH"`.

## Review Focus

1. Oturumsuz/anonim istemci açılışı: `/v1/map/config` çağrılmaz, harita hemen OpenFreeMap (Task 4 testi).
2. Premium bitmiş kullanıcının saklı sağlayıcısı mapbox/google: sunucu osm döner, saklı ad osm olur (Task 1 ve 4 testleri).
3. Yönetici anahtarı tanımsız bir sağlayıcıyı seçer: sunucu reddeder / etkin sağlayıcı osm kalır, yönetim ekranında seçenek pasif (Task 1, 2, 3).
4. Geçersiz Mapbox/Google anahtarı: bir kez bildirim, OpenFreeMap, yenileme döngüsü yok (Task 4 mantık testi; Task 5/7 tarayıcı denemesi sahte anahtarla).
5. Mapbox'ta uydu açılıp kapanınca rota çizgisi ve trafik katmanı kaybolmaz (Task 5).

---

### Task 1: `server/maps.mjs` (etkin sağlayıcı ve anahtar)

**Files:**
- Create: `server/maps.mjs`
- Test: `T_MAP`

**Interfaces:**
- Produces:
  - `export const PROVIDERS = ['osm', 'mapbox', 'google']`
  - `createMaps(store, env = {})` → `{ available(): {mapbox: boolean, google: boolean}, getDefault(): string, setDefault(p: string): void, setUser(u: object, p: string|null): void, effective(u: object|null, premium: boolean): string, config(u: object|null, premium: boolean): {provider:'osm'} | {provider:'mapbox', token:string} | {provider:'google', key:string, mapId:string} }`
  - Varsayılan `store.data.settings.mapDefault` (yoksa `'osm'`); kullanıcı seçimi `u.mapProvider` (`null` = varsayılanı izle). `setDefault`/`setUser` geçersiz ad veya anahtarı tanımsız sağlayıcı için `Error` fırlatır (`'geçersiz sağlayıcı'` / `'anahtar yok'`); `null` yalnızca `setUser` için geçerli. `store.save()` çağrılır.

- [ ] **Step 1: Write the failing tests in `T_MAP`** (sahte `store = { data: { users: {} }, save() {} }`, `env = { MAPBOX_MAP_TOKEN: 'pk.test-dummy', GOOGLE_MAPS_BROWSER_KEY: 'gk-dummy', GOOGLE_MAP_ID: 'mid' }`). Her biri ayrı `ok(ad, koşul)`:
  - premium değil → `effective(u,false)==='osm'` ve `config(u,false)` yalnızca `{provider:'osm'}` (anahtar alanı YOK; `JSON.stringify` içinde `pk.test-dummy` geçmez)
  - premium, varsayılan osm, `u.mapProvider` yok → osm
  - `setDefault('mapbox')` → premium kullanıcı `config` = `{provider:'mapbox', token:'pk.test-dummy'}`
  - `setUser(u,'google')` varsayılanı geçer → `{provider:'google', key:'gk-dummy', mapId:'mid'}`; `setUser(u,null)` varsayılana döner
  - env'de anahtar yok: `available()` → `{mapbox:false, google:false}`, `setUser(u,'mapbox')` fırlatır `'anahtar yok'`
  - kayıtlı sağlayıcının anahtarı sonradan kalkarsa (env değişti) `effective` osm döner (çökme yok)
  - `setUser(u,'zzz')` ve `setDefault('zzz')` fırlatır; `GOOGLE_MAP_ID` yoksa `mapId==='DEMO_MAP_ID'`
  - `u === null` (eski erişim kodu) premium=true ile varsayılanı izler
- [ ] **Step 2: Run** `node T_MAP` → FAIL (modül yok).
- [ ] **Step 3: Implement `server/maps.mjs`** yukarıdaki imzayla; mevcut sunucu modülleri gibi tek `export`lu fabrika, Türkçe kısa yorumlar.
- [ ] **Step 4: Run** `node T_MAP` → tüm `ok` satırları geçer.
- [ ] **Step 5: Commit** `git add server/maps.mjs` → `"Sunucu: harita sağlayıcısı seçimi modülü (sürüm değişmedi)"`.

### Task 2: Sunucu bağlantısı (`/v1/map/config`, yönetici uç noktaları)

**Files:**
- Modify: `server/proxy.mjs` (import + `const maps = createMaps(store, env);` `store` tanımından sonra; `DAILY`'e `map`; rota; `adminSummary`; `scrub` listesi), `server/accounts.mjs` (`/admin/users` yanıtına `mapProvider`), `server/.env.example`, `server/README.md`
- Test: `T_MAP` (sunucuyu alt süreç olarak başlatır)

**Interfaces:**
- Consumes: `createMaps` (Task 1), `premiumOk(id)`, `overQuota(id, kind)`.
- Produces (HTTP):
  - `GET /v1/map/config` → `200 {provider:'osm'}` | `200 {provider:'mapbox', token}` | `200 {provider:'google', key, mapId}`, `Cache-Control: no-store`; anahtar dönecekse önce `overQuota(id,'map')` ve `MAP_DAILY_TOTAL` denetimi, aşılırsa `429 {error:'günlük harita hakkı doldu'}`; kimlik yoksa mevcut 401.
  - `GET /admin/map` (yönetici) → `{ default, available:{mapbox,google} }`
  - `POST /admin/map` gövde `{ default }` → `{ ok:true, default }`; hata `400 {error}` (`maps.setDefault` mesajı)
  - `POST /admin/users/:id/map` gövde `{ provider: 'osm'|'mapbox'|'google'|null }` → `{ ok:true, provider }`; kullanıcı yoksa 404, hata 400
  - `/admin/summary` `configured.mapboxMap`, `configured.googleMap` (bool) ve `map: { default }` alanları; `/admin/users` her kullanıcıda `mapProvider`.

- [ ] **Step 1: Write failing tests in `T_MAP`:** geçici `DATA_DIR`, `PORT=18787`, `ACCESS_CODES=<16+ karakter sahte>`, `MAPBOX_MAP_TOKEN=pk.test-dummy`, `GOOGLE_MAPS_BROWSER_KEY` tanımsız ile `node server/proxy.mjs` başlat (sahte kodla `X-Access-Code` yönetici sayılır). Beklentiler:
  - kimliksiz `GET /v1/map/config` → 401
  - varsayılan osm iken kodlu istek → `{provider:'osm'}`
  - `POST /admin/map {default:'mapbox'}` → 200; sonra `/v1/map/config` → token `pk.test-dummy` ve başlık `cache-control` içinde `no-store`
  - `POST /admin/map {default:'google'}` → 400 (anahtar yok); `{default:'zzz'}` → 400
  - `MAP_DAILY_TOTAL=2` ile başlatılmış ikinci süreçte 3. anahtarlı çağrı → 429, osm yanıtı sayılmaz
  - `/admin/summary` gövdesinde `pk.test-dummy` metni GEÇMEZ; `configured.mapboxMap===true`, `configured.googleMap===false`
  - sunucu stdout/stderr'de `pk.test-dummy` geçmez
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** yukarıdaki uç noktaları; toplam tavan sayacı `googleAllowed` gibi bellek içi gün sayacı (`mapToday`). `scrub` listesine iki harita anahtarı eklenir. `.env.example` ve `README.md`'ye: iki anahtarın ne olduğu, ayrı anahtar önerisi, **adres kısıtını panelde sahibinin yapması gerektiği** (`https://ozdemirumit.github.io/*`), Google'da günlük kota sınırı önerisi, `MAP_DAILY_PER_USER`, `MAP_DAILY_TOTAL`.
- [ ] **Step 4: Run** `T_MAP` → geçer; `node scripts/check.mjs` temiz.
- [ ] **Step 5: Commit** `"Sunucu: /v1/map/config ve yönetici harita uç noktaları (sürüm değişmedi)"`.

### Task 3: Yönetim ekranı (`server/admin.html`)

**Files:**
- Modify: `server/admin.html` (Özet: varsayılan harita seçimi, anahtar durumu satırları ve fatura bağlantıları kartı; Kullanıcılar: "Harita" sütunu/seçici)
- Test: `T_MAP` (alt süreç sunucusu + HTML metin denetimi), tarayıcıda elle bakış (`/yonetim`)

**Interfaces:**
- Consumes: Task 2 uç noktaları (`api(path, method, body)`, `act(fn, okMsg)` mevcut yardımcılar).
- Produces: yok (yalnızca arayüz).

- [ ] **Step 1: Write failing test:** `server/admin.html` metninde `'/admin/map'`, `'/admin/users/'` + `'/map'`, Mapbox ve Google fatura bağlantı sabitleri ve `"Fatura"` başlığı bulunur (basit içerik denetimi); anahtar değeri geçmez.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** (a) Özet'te "Premium için varsayılan harita" `<select>` (OpenFreeMap / Mapbox / Google; anahtarı tanımsız olan `disabled` ve metne "(anahtar yok)" eklenir), değişimde `POST /admin/map`; (b) Yapılandırma tablosuna "Mapbox harita anahtarı", "Google harita anahtarı" satırları; (c) "Fatura (harici paneller)" kartı, yeni sekmede açılan bağlantılar: Mapbox hesap/istatistik (`https://account.mapbox.com/`), Google Cloud faturalama (`https://console.cloud.google.com/billing`), Google Maps Platform kullanım/kota (`https://console.cloud.google.com/google/maps-apis/metrics`) — üç bağlantı da yayından önce tarayıcıda açılarak doğrulanır, çalışmayan düzeltilir; sayaç/tutar YOK; (d) Kullanıcılar tablosunda yönetici olmayan her satıra "Varsayılan / OpenFreeMap / Mapbox / Google" `<select>`, değişimde `POST /admin/users/:id/map`, `u.mapProvider` ile başlar.
- [ ] **Step 4: Run** testi → geçer; `/yonetim` sayfasını tarayıcıda (sahte kodlu yerel sunucu) aç, seçici ve kart görünür, taşma yok.
- [ ] **Step 5: Commit** `"Yönetim ekranı: harita sağlayıcısı seçimi ve fatura bağlantıları (sürüm değişmedi)"`.

### Task 4: İstemci sağlayıcı çözümü + ortak vektör-harita motoru

**Files:**
- Create: `js/net/mapConfig.js`, `js/ui/maps/mapEngine.js`
- Modify: `js/ui/maps/maplibre.js` (motoru kullanan ince sarmalayıcı; dışa aktarım `createMapLibreMap(container)` aynı kalır), `js/ui/mapView.js` (`boot` içinde `adapter = await openAdapter()`), `sw.js` (SHELL), i18n dosyaları
- Test: `T_MAP`

**Interfaces:**
- Produces (`js/net/mapConfig.js`):
  - `export function savedProvider(): 'osm'|'mapbox'|'google'` (`load('mapProvider','osm')`)
  - `export function forceOsm(): void` / `export const osmForced = (): boolean` (`sessionStorage` `mapForceOsm`)
  - `export async function resolveProvider({ timeoutMs = 3000 } = {}): Promise<{provider:'osm'} | {provider:'mapbox', token:string} | {provider:'google', key:string, mapId:string}>`
    - bayrak varsa osm; `hasCreds()` yoksa osm (çağrı yok); `savedProvider()==='osm'` ise hemen osm döner ve arka planda config çekip saklı adı günceller (anahtarı atar); aksi halde `timeoutMs` ile çeker; yanıt/hata/zaman aşımı osm'e düşer; çekilen sağlayıcı adı her durumda kaydedilir (premium bitmişse `osm` yazılır).
- Produces (`js/ui/maps/mapEngine.js`): bugünkü `maplibre.js` gövdesi (rota/trafik kaynakları, `marker`, `traffic`, `line`, `fit`, `moveTo`, `onClick`, `onDragStart`, `cursor`, `resize`, `bearing`, `setSatellite`) bir kütüphane nesnesi (`maplibregl` | `mapboxgl`), harita seçenekleri ve bir uydu stratejisi `{ install(map), set(map, on) }` alan bir fabrikada: `export async function createVectorMap(lib, container, { mapOptions, name, satellite, onError })`. Rota ve trafik katman kurulumu, stil değişse bile yeniden uygulanabilir tek bir `installLayers()` içinde olur.

- [ ] **Step 1: Write failing tests in `T_MAP`:** `resolveProvider` mantığı için `localStorage`/`sessionStorage`/`fetch`/`hasCreds` sahteleriyle:
  - bayrak varken fetch çağrılmaz, osm
  - oturum/kimlik yok → fetch çağrılmaz, osm (Review Focus 1)
  - saklı osm → fetch beklenmeden osm döner, sonra arka planda saklı ad config'in sağlayıcısına güncellenir
  - saklı mapbox + yanıt `{provider:'mapbox',token}` → o yanıt döner
  - saklı mapbox + yanıt `{provider:'osm'}` (Premium bitti) → osm ve `savedProvider()==='osm'` (Review Focus 2)
  - saklı mapbox + fetch 3 sn'den uzun / reddeder / 429 → osm
  - hiçbir yolda `token`/`key` `localStorage` içine yazılmaz
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `mapConfig.js` ve `mapEngine.js`; `maplibre.js`'yi motora bağla (OpenFreeMap davranışı BİREBİR aynı kalır: aynı stil, Esri uydu stratejisi, atıf); `mapView.js`'de `openAdapter()` ekle: `resolveProvider()` sonucuna göre osm → `createMapLibreMap`; mapbox/google şimdilik `createMapLibreMap`'e düşer (Task 5 ve 7 bağlar); herhangi bir hata → `forceOsm()`, tek `toast`, `createMapLibreMap`. Yeni metin(ler) 11 dile eklenir, `sw.js` SHELL'e iki dosya.
- [ ] **Step 4: Run** `T_MAP` → geçer; `node scripts/check.mjs`; geçici statik sunucuda (port 7071, işim bitince PID ile kapat) tarayıcıda 360 px'te OpenFreeMap haritası, rota çizgisi ve uydu düğmesi bugünkü gibi çalışır, konsolda hata yok.
- [ ] **Step 5: Commit** (sürüm artışı Task 6'da; bu commit yerel kalır, push edilmez) `"İstemci: harita sağlayıcısı çözümü ve ortak vektör-harita motoru"`.

### Task 5: Mapbox bağdaştırıcısı

**Files:**
- Create: `js/ui/maps/mapbox.js`
- Modify: `js/ui/mapView.js` (mapbox dalı), `sw.js` (SHELL)
- Test: `T_MAP` (yük sınırı/yedek mantığı), tarayıcıda sahte anahtarla deneme

**Interfaces:**
- Consumes: `createVectorMap` (Task 4).
- Produces: `export async function createMapboxMap(container, token, { onAuthFail } = {}): Promise<adapter>` — `adapter.name === 'mapbox'`, `maplibre.js` ile aynı yöntemler.

- [ ] **Step 1: Write failing tests in `T_MAP`:** `mapbox.js` modülü import edilip kütüphane yükleyici sahte `window.mapboxgl` ile çalıştırılır: (a) kütüphane betiği yüklenemezse `createMapboxMap` reddeder; (b) sahte harita `error` olayı `{ error: { status: 401 } }` ve `403` yayınlarsa `onAuthFail` bir kez çağrılır, `404` çağrılmaz; (c) `setSatellite(true)` sonrası stil değişse bile `installLayers` yeniden çağrılır (rota kaynağı yeniden eklenir) ve `line(coords)` verisi korunur (Review Focus 5).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement:** Mapbox GL JS'i sağlayıcının güncel şartlarına uygun şekilde, sürümü sabitlenmiş yükleyiciyle (Mapbox'un kendi CDN adresi; sürüm numarası iki haftadan eski, `@latest` yok) yükle; `accessToken = token`; koyu stil `mapbox://styles/mapbox/dark-v11`, uydu stili `mapbox://styles/mapbox/satellite-streets-v12`; stil değişince `style.load` ile `installLayers()` ve son rota/trafik verisini yeniden uygula; atıf kontrolü Mapbox'un zorunlu logo/atıf kuralına göre; 25 sn yüklenmezse reddet. `mapView.js` mapbox dalında `onAuthFail` → `forceOsm()`, bildirim, yenile.
- [ ] **Step 4: Run** `T_MAP` → geçer; tarayıcıda `MAPBOX_MAP_TOKEN=pk.test-dummy` ile sunucu başlatıp yönetici kodla Mapbox'u seç → harita Mapbox kimlik hatasıyla kısa sürede OpenFreeMap'e döner, bildirim bir kez, yenileme sonrası döngü yok (Review Focus 4).
- [ ] **Step 5: Commit** (yerel) `"İstemci: Mapbox harita bağdaştırıcısı"`.

### Task 6: v0.79.0 yayını (sunucu + yönetim + Mapbox)

**Files:**
- Modify: `version.js`, `i18n/keys.extra.json`, `js/i18n/lang/*.extra.js`, `sw.js`

- [ ] **Step 1:** Tüm yeni uygulama metinleri 11 dilde; `node scripts/i18n-validate.mjs <kod>:extra` her dil için geçer.
- [ ] **Step 2:** `APP_VERSION` `0.79.0` ve `APP_CHANGELOG` en üstüne "YENİ: Premium kullanıcılar için yönetici seçimli harita sağlayıcısı (OpenFreeMap / Mapbox); sağlayıcı çalışmazsa harita otomatik OpenFreeMap'e döner" kaydını betikle ekle.
- [ ] **Step 3:** `node scripts/check.mjs`, `T_MAP` baştan sona, tarayıcıda OpenFreeMap yolu kontrolü.
- [ ] **Step 4:** Push, canlı `version.js`'in `0.79.0` olduğunu yokla; `node server\restart.mjs` ile sunucuyu yeniden başlat ve `/health` yanıtını doğrula.
- [ ] **Step 5:** Sahibine: iki anahtarı `server\.env`'ye yazmasını, panelde adres kısıtını yapmasını ve Mapbox'u bir hesaba atayıp gerçek denemeyi kendisinin yapmasını söyle (gerçek anahtarla doğrulama bu oturumda yapılmadı, açıkça belirt).

### Task 7: Google bağdaştırıcısı (v0.80.0)

**Files:**
- Create: `js/ui/maps/google.js` (başlangıç: `git show 174a115:js/ui/maps/google.js`)
- Modify: `js/ui/mapView.js` (google dalı), `sw.js`, `version.js`, i18n dosyaları
- Test: `T_MAP`

**Interfaces:**
- Consumes: `forceOsm`, `resolveProvider` (Task 4).
- Produces: `export async function createGoogleMap(container, key, mapId = 'DEMO_MAP_ID', { onAuthFail } = {}): Promise<adapter>` — `adapter.name === 'google'`, Task 4'teki arayüzle aynı yöntemler (`marker`, `traffic`, `line`, `fit`, `moveTo`, `onClick`, `onDragStart`, `cursor`, `resize`, `bearing`, `setSatellite`).

- [ ] **Step 1: Write failing tests in `T_MAP`:** sahte `window.google.maps` ile (a) betik yüklenemezse reddeder; (b) `gm_authFailure` tetiklenince `onAuthFail` bir kez çağrılır; (c) `traffic(coords, spans)` her aralık için ayrı çizgi oluşturur ve `traffic(coords, [])` hepsini kaldırır; (d) `setSatellite(true)` → `hybrid`, `false` → `roadmap`; (e) `moveTo({center, zoom, heading})` `moveCamera` çağırır.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** eski dosyayı alıp Task 4'teki arayüze uyarla (OverlayView işaretçisi, çizgiler, `moveCamera`); Places kitaplığı ve yer kartı kodu ALINMAZ (hedef dışı). `mapView.js` google dalı: `onAuthFail` → `forceOsm()`, bildirim, yenile.
- [ ] **Step 4: Run** `T_MAP` → geçer; sahte anahtarla tarayıcıda Google'ın anahtar hatası OpenFreeMap'e dönüş verir.
- [ ] **Step 5:** `0.80.0` sürüm kaydı, `check.mjs`, push, canlı sürümü yokla; sahibine gerçek Google anahtarını yazma ve (varsa) panelde günlük kota sınırı koyma hatırlatması; gerçek anahtar doğrulamasının sahibine kaldığını belirt. Commit `"v0.80.0: Premium için Google harita sağlayıcısı seçeneği"`.
