// Tek sürüm kaynağı. Sayfa (klasik <script>) ve service worker (importScripts) buradan okur.
// KURAL: her değişiklikte APP_VERSION artırılır ve APP_CHANGELOG'un EN ÜSTÜNE bir kayıt eklenir.
//   x.y.z → z: düzeltme · y: yeni özellik · x: uyumsuz/büyük değişiklik. Commit mesajı "vX.Y.Z: ..." ile başlar.
// Sürüm değişince sw.js'in önbellek adı da değişir; telefon yeni sürümü indirir.
self.APP_VERSION = '0.53.1';
self.APP_CHANGELOG = [
  {
    v: '0.53.1', date: '2026-11-01',
    notes: [
      'Sürüm notu düzeltildi: %0\'a kadar menzil bilgisi dokunmatik ekranda uzun basınca değil, yalnızca masaüstünde fareyle üzerine gelince ipucu olarak görünür.',
    ],
  },
  {
    v: '0.53.0', date: '2026-11-01',
    notes: [
      'Navigasyon ekranında şarjla tahmini menzil (km): sol pil çubuğunun altında mavi rakam. Mevcut pilden, Rota sekmesindeki minimum varış pili eşiğine kadar gidilebilecek mesafe (Menzil sekmesindeki değerle aynı); %0'a kadar menzil masaüstünde üzerine gelince ipucu olarak görünür. Karartma modunda da görünür.',
      'Pil çevrimiçi göstergesi: yeşil nokta + "canlı" = pil kameradan canlı okunuyor (son 45 sn içinde). Kırmızı nokta = okuma yok: "tahmin" (elle girilmiş, yolda modelle düşüyor) ya da "eski" (kamera okuması 45 sn\'den eski). Mavi = Test Modu. Gösterge hem sol pil çubuğunda hem alttaki "% pil" kutusunda.',
    ],
  },
  {
    v: '0.52.1', date: '2026-11-01',
    notes: [
      'Mapbox istek sınırı (429) düzeltildi: istasyon araması istekleri artık saniyede ~4 ile aralıklanıyor, 429 alan kutular Mapbox\'un istediği süre beklenip en çok 4 kez yeniden deneniyor (eskiden o kutular sonuçsuz kalıyordu, "7 arama başarısız" uyarısının nedeni). Sahte 429\'larla denendi: 12 kutunun 12\'si tamamlandı.',
      'Rota önizlemesinde "0 şarj durağı" hatası düzeltildi: konumun rotanın sonunda olduğu bir önizlemede (ör. İstanbul\'dayken Ankara-İstanbul planlayınca) duraklar "geride kaldı" sayılıp gizleniyordu. Artık ilerleme yalnızca navigasyon açıkken ya da araç hareket ederken ve rotanın üzerindeyken sayılır; park halinde plan baştan gösterilir ve konuma göre kısaltılmaz.',
    ],
  },
  {
    v: '0.52.0', date: '2026-11-01',
    notes: [
      'Rotada trafik renklendirmesi (Mapbox anahtarı girilince): yavaş kesimler sarı, yoğun kesimler kırmızı, çok yoğun kesimler koyu kırmızı çizilir; rota panelindeki trafik satırı yavaş/yoğun kesimin toplam uzunluğunu da yazar. Anahtar yoksa rota tek renk kalır (ücretsiz kaynaklarda canlı trafik yoktur).',
      'Not: Haritanın kendisi Mapbox değildir (MapLibre + OpenFreeMap, OpenStreetMap verisi); Mapbox yalnızca anahtar girilince rota, trafik ve istasyon araması için kullanılır. Türkiye'de Mapbox trafik verisinin kapsamı gerçek anahtarla doğrulanmadı.',
    ],
  },
  {
    v: '0.51.3', date: '2026-11-01',
    notes: [
      'Haritadaki düğme çubuğunda uydu düğmesinin hemen altına "Haritayı bana ortala" düğmesi (mavi nişan simgesi) taşındı. Konum varsa haritayı sana ortalar ve yakınlaştırır, navigasyondayken takibe döner. Konum yoksa GPS\'i açar ve ilk konum gelince kendiliğinden ortalar. Tüm rotayı göster düğmesi onun altına geçti.',
    ],
  },
  {
    v: '0.51.2', date: '2026-11-01',
    notes: [
      'Ev, İş, F1, F2, F3 çipleri her ekran genişliğinde tek satırda eşit genişlikte durur (320 px dahil); favoriye uzun ad verilirse çip içinde kısalır.',
    ],
  },
  {
    v: '0.51.1', date: '2026-11-01',
    notes: [
      'Rota sayfasında "Rotayı Planla" ve "Navigasyonu başlat" düğmeleri yan yana, aynı yükseklikte; Navigasyon kartından düğme kalktı (ayarlar orada kaldı). Favori çipleri tek satıra sığacak şekilde küçüldü.',
    ],
  },
  {
    v: '0.51.0', date: '2026-11-01',
    notes: [
      'Tüketim hıza göre öğrenilir: sürüşte pil yüzdesi düştükçe kaydedilen ölçümlerden (zaten tutuluyordu) her hız için "ölçülen / model" oranı çıkarılır ve plan, rotanın HER diliminde o dilimin hızına uygun düzeltmeyi uygular (eskiden tek hız için tek düzeltme vardı). Şehir içi ve otoyol parçaları ayrı ayrı doğru enerjiyle hesaplanır; eco-hız tavsiyesi de bu düzeltmeyi kullanır.',
      'Bir hızda en az 25 km ölçüm yoksa o hıza düzeltme uygulanmaz; az veride düzeltme yumuşatılır (80 km\'de tam güven). Referans, planın k değeridir: o hızda ölçüm yoksa tüm geçmişin ortalaması referans alınır. Yeni ölçüm gelince plan kendiliğinden yeniden hesaplanır.',
      'Menzil sekmesindeki sürüş geçmişi kartında "Hız düzeltmesi: 50 / 70 / 90 / 110 / 130 km/s ×…" satırı eklendi. Elle girilen (tahmini) pil ölçüme katılmaz, yalnızca kameranın gerçek okumaları.',
      'Favori yer çipleri F1, F2, F3 olarak yazılır.',
    ],
  },
  {
    v: '0.50.0', date: '2026-11-01',
    notes: [
      'Elle girilen pil artık yolda kendiliğinden düşer: Rota sayfasındaki sürgü, navigasyondaki yeni sürgü ya da kalibrasyon +/- ile pil girilince, araç yol aldıkça tüketim modeline (hız, eğim, hava, öğrenilen düzeltme) göre pil yüzdesi azalır ve plan buna göre güncellenir. Bu tahmin tüketim öğrenmesine katılmaz.',
      'Kamera okuması her zaman önceliklidir: OCR bir değer okuduğu an elle girilen/tahmini değerin yerine geçer. OCR 90 sn okuyamazsa son değerden tahmine devam edilir.',
      'Navigasyonda sol kenarda dikey pil sürgüsü: parmakla yukarı/aşağı kaydırarak mevcut pil elle ayarlanır. Altında kaynak görünür (kamera / elle / test), eşik altında kırmızı olur.',
    ],
  },
  {
    v: '0.49.0', date: '2026-11-01',
    notes: [
      'Rota sayfasına "Mevcut pil" sürgüsü eklendi: kamera/OCR okuması yoksa pil yüzdesi elle girilir. Sürgü bırakılınca açık plan ağsız yeniden hesaplanır (varış pili, şarj durakları); HUD ve navigasyon da bu değeri kullanır. Test Modu açıksa Test sekmesindeki pil değişir.',
      'Rota sayfasının düzeni: favori çipleri, başlangıç/varış, mevcut pil ve Rotayı Planla düğmesi artık en üstte; özet hemen altında. Yerleri düzenle bölümü sayfanın en altına taşındı.',
    ],
  },
  {
    v: '0.48.0', date: '2026-11-01',
    notes: [
      'Araç seçimi Marka > Model > Pil/versiyon sırasıyla yapılır (Araç ve tüketim bölümü), "Kaydet ve uygula" ile telefona kaydedilir. Seçili araç üst başlıkta ve "Kayıtlı araç" satırında görünür. Bir değeri elle değiştirince araç "Özel araç" olur. Eski kayıtlı Togg seçimleri otomatik eşlenir. Katalog değerleri tahmindir, düzeltilebilir.',
      'Yer arama Türkçe adlarla da çalışır: "Selanik", "Münih" gibi Türkçe yazılmış yabancı şehir adları artık bulunur (Photon\'a ek olarak Nominatim; yazma durduktan bir saniye sonra eklenir, kullanım politikası gereği saniyede en çok 1 istek).',
    ],
  },
  {
    v: '0.47.0', date: '2026-11-01',
    notes: [
      'Telefon pili: navigasyonda belli süre dokunulmazsa ekran tam siyaha döner (OLED\'de ışık harcamaz); yalnızca dönüş oku, mesafe, hız ve varış silik renkle görünür, harita çizimi durur. Dokununca uyanır. Sağdaki 🌙 düğmesi hemen karartır; süre ve açma/kapama Navigasyon kartında (varsayılan 45 sn). Telefonun parlaklığı web uygulamasından ayarlanamaz, LCD ekranlarda kazanç sınırlıdır.',
      'Akıllı OCR: pil değeri art arda 3 okumadır değişmediyse 5 sn yerine 15 sn aralıkla okunur, değişince hemen sıklaşır. Araç durunca harita her saniye yeniden çizilmez.',
      'Araç kataloğu: Hyundai Ioniq 5 (63/77/84 kWh), Ioniq 6, Kona, Kia EV6/EV9/Niro, Tesla Model 3/Y, BYD, MG, Renault, Peugeot/Citroën/Fiat, VW grubu, BMW/Mini/Mercedes, Volvo/Polestar, Nissan, Ford ve diğerleri eklendi (toplam 49 seçenek, markaya göre gruplu). TÜM DEĞERLER TAHMİNDİR, doğrulanmadı: Araç ve tüketim bölümünden her değer düzeltilebilir.',
      'Geniş ekran (web/masaüstü): sayfalar sol yan panel olarak açılır, harita sağda görünür kalır; uyarılar sola toplanır.',
      'Kısa ekran (yatay telefon, küçük pencere): üst ve alt çubuk küçülür, durum rozetleri gizlenir, sayfa sol panel olur; sayfa alanı 200 px yerine 260 px+ olur. Dik telefonlarda (320-412 px genişlik) taşma taraması yapıldı: yatay taşma yok.',
    ],
  },
  {
    v: '0.46.0', date: '2026-11-01',
    notes: [
      'Kayıtlı yerler: Ev, İş ve 3 favori. Rota sayfasındaki çiplere dokununca yer, son dokunduğun kutuya (başlangıç ya da varış) yazılır. "Yerleri düzenle" bölümünden varışı, başlangıcı ya da konumunu bir yuvaya kaydedersin; favorilere ad verilir (ör. Anne). Yerler yalnızca bu telefonda saklanır ve haritada küçük emoji iğneleriyle görünür.',
    ],
  },
  {
    v: '0.45.0', date: '2026-11-01',
    notes: [
      'OCR eğik yazıyı okuyor: telefon göstergeye açılı dururken rakamlar hem döner hem yatar. Okuma kutusundaki görüntünün dönmesi ve yatıklığı her okumada otomatik tahmin edilip düzeltilir (Kamera > Görüntü filtresi > Eğimi otomatik düzelt; açık gelir). Eğik sahte rakamlarla denendi: düzeltme olmadan okunamayan veya düşük güvenli okumalar düzeltmeyle %91-97 güvenle okundu. Çok aşırı eğimde (yaklaşık 25° üstü) otomatik yetmeyebilir: otomatiği kapatıp Dönme ve Yatıklık sürgüleriyle elle düzelt.',
      'OCR hata verince nedeni artık Okuma kartında yazılı görünür (ör. motor dosyası yüklenemedi); "Hata" yazısının sebebi anlaşılabilir.',
    ],
  },
  {
    v: '0.44.0', date: '2026-11-01',
    notes: [
      'Kamera sekmesine yakınlaştırma (zoom) sürgüsü eklendi. Telefon kamerası zoom veriyorsa donanım zoom\'u kullanılır (görüntü bozulmaz), vermiyorsa 1-4× dijital zoom (görüntü büyür, netlik azalır). OCR okuma kutusu zoom\'a göre doğru eşlenir; seçim hatırlanır.',
    ],
  },
  {
    v: '0.43.0', date: '2026-11-01',
    notes: [
      'Android paketi (Capacitor) projeye eklendi: android/ klasörü, package.json, capacitor.config.json ve scripts/copy-www.mjs. Uygulamanın kendisi değişmedi; APK, Android Studio ile derlenir (adımlar docs/android.md).',
    ],
  },
  {
    v: '0.42.2', date: '2026-11-01',
    notes: [
      'İmleç artık yola yapışık: navigasyonda konum, rotanın en yakın noktasına çekilir (GPS doğruluğuna göre 70-200 m pay); harita da bu noktayı izler. Rotadan gerçekten çıkınca ham konum gösterilir.',
      'Yeni rota kurulunca "hedefe geldiniz" hatası giderildi: navigasyonu başlatırken eski rotanın izi kullanılıyordu, araç eski rotanın sonunda olduğu için hemen varış sanılıyordu. Artık her başlatışta güncel rotanın izi kurulur.',
      'Yön-yukarı harita yeni rotadan sonra da döner (rota çizilince harita kuzeye dönüyor ama açı eski değerde sanılıyordu; artık haritanın gerçek açısıyla kıyaslanır). Navigasyondayken yeni rota haritayı uzaklaştırmaz.',
      'Farklı yola sapma daha erken algılanır: rotadan 70 m (GPS kötüyse daha fazla) uzakta 6 sn kalınca, 400 m\'den uzaktaysa hemen bulunduğun yerden yeni rota kurulur.',
    ],
  },
  {
    v: '0.42.1', date: '2026-11-01',
    notes: [
      'Yeniden rota düzeltildi: rotadan çıkınca bulunduğun yerden varışa yeni rota kurulur. Sapma 8 sn sürünce (1 km\'den uzaktaysan hemen) başlar; GPS hızı okunamazsa da çalışır (eskiden hız bilgisi yoksa hiç kurulmuyordu). Yeni rota alınamazsa (internet yok) 12 sn sonra tekrar dener; kurulunca "Yeni rota hazır" der.',
      'Test Modu: yeniden rotada simüle araç rotanın başına değil bulunduğu yere konur.',
    ],
  },
  {
    v: '0.42.0', date: '2026-11-01',
    notes: [
      'Yeni arayüz: harita tam ekran arka plan. Altta yüzen hap çubuk (İstasyonlar, Harita, Daha Fazla), solda büyük Rota düğmesi, sağda düğme çubuğu (uydu, tüm rota, konumum, navigasyon) ve arama düğmesi. Sekmeler haritanın üstünde sayfa olarak açılır; ✕ ya da açık sayfanın düğmesine tekrar dokunmak haritaya döner.',
      'Menzil, Kamera, ABRP ve Test sayfaları Daha Fazla altına, Araç ve tüketim ile Veri kaynakları da oraya taşındı. İstasyonlar düğmesinde plandaki şarj durağı sayısı görünür.',
      'İstasyon işaretleri damla iğne oldu: AC mavi, DC turuncu, 150 kW ve üstü mor; planlanan duraklar büyük, amber halkalı ve sıra numaralı. Haritadan seçerken sayfa kapanıp üstte yönerge çubuğu çıkar.',
      'Uydu görüntüsü eklendi (Esri World Imagery, yol ve yer adlarıyla): sağdaki 🛰️ düğmesi, tercih hatırlanır. Navigasyonda hız/ETA çubuğu alt çubuğun üstünde durur.',
    ],
  },
  {
    v: '0.41.0', date: '2026-11-01',
    notes: [
      'Mapbox eklendi (isteğe bağlı): Rota sekmesindeki Veri kaynakları kartına herkese açık Mapbox anahtarı (pk.) girilirse rota canlı trafikli olur (olağan süreye göre gecikme gösterilir), navigasyonda yoldaki yoğunluk uyarısı gelir ve şarj istasyonları Overpass yerine Mapbox Search Box ile aranır (çok daha hızlı).',
      'Anahtar reddedilirse veya Mapbox yanıt vermezse rota Valhalla\'ya, istasyonlar Overpass\'e otomatik düşer. Mapbox istasyon kayıtlarında güç bilgisi yoktur: kW operatör tablosundan tahmin edilir, listede yıldız (*) görünür. Anahtarsız kullanım aynen sürer.',
      'Mapbox gerçek anahtarla henüz sınanmadı (yalnızca sahte yanıtlarla): Kaydet ve sına düğmesi Directions ve Search Box için sonucu gösterir.',
    ],
  },
  {
    v: '0.40.0', date: '2026-11-01',
    notes: [
      'Google kaldırıldı: uygulama artık hiçbir Google servisi ve anahtarı kullanmıyor. Harita OpenFreeMap (MapLibre), rota ve rakım Valhalla, yer arama ve adres adı Photon, şarj istasyonları Overpass (isteğe bağlı OpenChargeMap anahtarıyla daha geniş kapsam), hava Open-Meteo, yol hız limiti OpenStreetMap.',
      'Kaybedilenler: canlı trafik (süreler trafiksiz hesaplanır), trafik renk katmanı, istasyon yuva doluluğu ve Google çağrı sayacı. Rota planı, enerji modeli, kayıtlı rota ve navigasyon aynen çalışır.',
      'Telefonda eski Google anahtarı ve sayaç verisi açılışta otomatik silinir. Rota sekmesinde yeni Veri kaynakları kartı: OpenChargeMap anahtarı (isteğe bağlı) ve önbellek durumu.',
    ],
  },
  {
    v: '0.39.0', date: '2026-11-01',
    notes: [
      'İstasyon aramasında Google günlük kotası (SearchNearbyRequest per day) dolunca kalan aramalar artık boşuna denenmiyor, kota hakkı yakılmıyor. Hata mesajı kaç aramanın denenmediğini söylüyor.',
      'Başarılı arama daireleri 6 saat saklanır: yarım kalan bir aramayı (kota, internet, hız sınırı) tekrarlayınca tamamlanan daireler yeniden sorulmaz, yalnızca eksikler gider.',
    ],
  },
  {
    v: '0.38.0', date: '2026-11-01',
    notes: [
      'Çevrimdışı harita özelliği kaldırıldı (kurulumu ve bakımı fazla ağırdı). Rota sekmesindeki Çevrimdışı harita kartı, MapLibre ve harita dosyası indirme kodu silindi. Telefonda daha önce indirilmiş harita dosyası açılışta otomatik silinir.',
      'Harita yalnızca Google. Kayıtlı rota (internetsiz açılışta son planın geri yüklenmesi) duruyor.',
      'Google "istek sınırı/kota doldu" hatası artık hangi kotanın dolduğunu söylüyor (ör. Nearby Search, dakikalık ya da günlük) ve ne yapılacağını yazıyor.',
    ],
  },
  {
    v: '0.37.0', date: '2026-10-31',
    notes: [
      'Kayıtlı rota: planlanan rota, adımlar, şarj planı, istasyonlar ve hava/rakım verisi telefona kaydedilir ve uygulama açılınca (internet olmasa da) geri yüklenir. Çevrimdışı haritayla birlikte planın üzerinden yola devam edebilirsin. 36 saatten eski kayıt kullanılmaz; "Rotayı temizle" kaydı da siler.',
      'Yeni rota alınamazsa (internet yok, Google hatası) mevcut plan artık bozulmuyor: eski plan ve istasyonlar korunur, uyarı çıkar.',
    ],
  },
  {
    v: '0.36.0', date: '2026-10-31',
    notes: [
      'Alternatif veri kaynağı modu kaldırıldı. Her veri türü için sabit kaynak: harita, rota (trafikli), trafik, yer arama, adres adı, istasyon ve doluluk Google; hava Open-Meteo; rakım ve yol hız limiti Valhalla/OpenStreetMap (ücretsiz). Google anahtarı artık Weather, Roads ve Elevation API istemiyor.',
      'Çevrimdışı harita yedek oldu: indirilmiş ülke haritası varsa ve uygulama internetsiz açılırsa (ya da Google haritası açılamazsa) o kullanılır. Google Haritalar uygulamasının indirdiği harita bu uygulamada kullanılamaz.',
      'Düzeltme: indirilen harita dosyası tarayıcı tarafından silinmişse kart artık indirildi demiyor, yeniden indirmeni söylüyor.',
    ],
  },
  {
    v: '0.35.0', date: '2026-10-31',
    notes: [
      'Google haritasında trafik renk katmanı: Rota sekmesindeki harita ayarlarında "Haritada trafik renkleri" anahtarı (akıcı, yavaş, yoğun yollar renkli görünür). Seçimin kalıcıdır. Yalnızca Google kaynağında; Alternatif kaynakta canlı trafik verisi yok.',
    ],
  },
  {
    v: '0.34.0', date: '2026-10-31',
    notes: [
      'Çevrimdışı harita (Alternatif kaynak): ülke haritası telefona indirilir (OPFS, kaldığı yerden devam eder) ve internetsiz çizilir. Veri kaynağı kartında Çevrimdışı harita bölümü: R2 adresi, indir/durdur/sil, harita kaynağı (otomatik, hep indirilen, hep çevrimiçi).',
      'Otomatik modda internet kopunca harita kendiliğinden indirilen haritaya geçer, bağlantı gelince çevrimiçine döner; rota çizgisi ve işaretler kaybolmaz.',
      'Paketi GitHub Actions üretir ve Cloudflare R2 kovana yükler (.github/workflows/build-offline-map.yml). Kurulum adımları docs/offline-harita.md içinde. Dosya adresi koda yazılmaz, telefonda girilir.',
      'pmtiles, Protomaps stili ve yazı tipleri/simgeler uygulamayla birlikte sunulur (vendor/).',
    ],
  },
  {
    v: '0.33.0', date: '2026-10-31',
    notes: [
      'Alternatif veri kaynağı artık seçilebilir (Rota sekmesi, Veri kaynağı kartı). Seçince harita OpenFreeMap + MapLibre (OpenStreetMap), rota Valhalla, istasyon Overpass (+ isteğe bağlı OpenChargeMap), hava Open-Meteo, rakım Valhalla, arama Photon, yol hız limiti OpenStreetMap olur. Hepsi birlikte değişir, karışık kullanım yok.',
      'Alternatifte canlı trafik ve istasyon doluluğu yoktur; süreler trafiksizdir. Çevrimdışı harita sonraki sürümde. Google varsayılan kalır ve aynen çalışır.',
      'Harita katmanı bağdaştırıcıya ayrıldı (maps/google.js, maps/maplibre.js). MapLibre 5.6.0 uygulamayla birlikte sunulur (vendor/maplibre).',
    ],
  },
  {
    v: '0.32.0', date: '2026-10-31',
    notes: [
      'Alternatif kaynak (henüz seçilemez): istasyonlar OpenStreetMap Overpass sunucularından (rota 120 km parçalarla, parça başına önbellek, ulaşılamayan sunucu atlanır), isteğe bağlı OpenChargeMap anahtarıyla birleştirilir. Tesla ve herkese açık olmayanlar elenir. Canlı doluluk yoktur.',
      'Alternatif kaynakta yol hız limiti OpenStreetMap etiketinden (Valhalla) okunur: ücretsiz; etiketi olmayan yolda bilinmez ve senin eşiğin kullanılır.',
      'Veri kaynağı kartına OpenChargeMap anahtarı alanı eklendi (yalnızca Alternatif seçilince görünür).',
    ],
  },
  {
    v: '0.31.1', date: '2026-10-31',
    notes: [
      'Alternatif kaynak hazırlığı (henüz seçilemez): açık kaynak rota (Valhalla, Türkçe talimat, ara durak), rakım (Valhalla, yedek Open-Meteo), hava (Open-Meteo) ve yer arama (Photon) modülleri yazıldı ve gerçek servislerle sınandı. Uygulama davranışı değişmedi.',
    ],
  },
  {
    v: '0.31.0', date: '2026-10-31',
    notes: [
      'Altyapı: veri kaynağı katmanı (js/providers). Harita dışındaki tüm veri (rota, istasyon, arama, hava, rakım, trafik, yol hız limiti) tek bir arayüzden gelir; Google şimdilik tek kaynak ve davranışı aynı.',
      'Rota sekmesinde Veri kaynağı seçimi eklendi: Google veya Alternatif (açık kaynak). Alternatif hazırlanıyor, şimdilik seçilemez. İki kaynak hiçbir zaman karışık kullanılmaz.',
    ],
  },
  {
    v: '0.30.0', date: '2026-10-31',
    notes: [
      'Google çağrı sayacı: Rota sekmesindeki anahtar kartında "Google kullanımı ve tahmini maliyet" bölümü. Çağrılar SKU bazında sayılır (harita, rota, istasyon arama, doluluk, hava, rakım, adres, Roads), ücretsiz kotaya göre kalan ve tahmini tutar gösterilir.',
      'Ücretsiz kotanın %80i dolunca ve aşılınca uyarı çıkar. Yalnızca Google a gerçekten giden ve kabul edilen çağrılar sayılır; önbellekten gelenler sayılmaz. Sayaç ay başında sıfırlanır.',
      'Yer seçerken Place Details yalnızca konum alanını ister (ad alanı Pro fiyatlıdır): çağrı başına maliyet düştü.',
      'Düzeltme: harita karanlık temada açılmıyordu (bir satırdaki yorum, colorScheme ayarını yutuyordu).',
    ],
  },
  {
    v: '0.29.2', date: '2026-10-31',
    notes: [
      'Haritanın üstündeki büyük dönüş penceresi kaldırıldı (aracın konumunu kapatıyordu). Dönüş bilgisi üstteki yön kartında kalır: ok, kalan metre, talimat, bir sonraki dönüş. Dönüşe 250 m kala haritanın yakınlaşması aynen sürer.',
    ],
  },
  {
    v: '0.29.1', date: '2026-10-31',
    notes: [
      'Yol hız limiti kontrolü (Google Roads, ücretli) artık varsayılan kapalı: istemeden ücret çıkmaz. Navigasyon kartındaki anahtardan veya navigasyon sırasında haritadaki bariyer düğmesinden açılıp kapatılır. Kapalıyken Google Roads hiç çağrılmaz, hız uyarısı senin eşiğinle çalışır.',
      'Bir ekran bileşeni hata verirse (ör. geçersiz anahtarla harita açılamadı) diğer bileşenlerin güncellenmesi durmaz.',
    ],
  },
  {
    v: '0.29.0', date: '2026-10-31',
    notes: [
      'Seyir hızı ve trafik yoğunluğu sürgüleri kaldırıldı: rota hızı artık Google dan okunur. Her rota dilimi için Routes API adımlarının trafiksiz süresinden serbest akış hızı (yol limiti ve yol sınıfı yansır) ve trafik aralıklarından (akıcı, yavaş, sıkışık) hız çarpanı alınır; enerji, süre, hava zamanlaması ve şarj planı bunlarla hesaplanır. Rota sekmesinde Google süreleri, ortalama hız ve yavaş km yazar.',
      'Yol hız limiti (Google Roads, Asset Tracking lisansı ister): sürerken okunur, üstte limit işareti çıkar, aşınca sesli uyarılır. Lisans yoksa nedeni yazılır ve senin belirlediğin eşik kullanılır. Maliyet düşük tutuldu (tek nokta, en az 20 sn ve 1 km arayla) ve aylık sorgu sayısı ile tahmini tutar gösterilir.',
      'Şarj planında parantez içindeki km artık şarj istasyonları arasındaki mesafe: 311 km kaldı (yolculuk başından 311 km), 483 km kaldı (önceki duraktan 172 km).',
      'Ortak önbellek: aynı bilgi tekrar sorulmaz. Hava (30 dk), rakım, adres, hız limiti, yer ayrıntısı (6 saat), trafikli rota ve arama (10 dk), doluluk (2 dk). Rota sekmesinde kaç çağrının Google a gitmediği görünür, Önbelleği temizle düğmesi vardır.',
    ],
  },
  {
    v: '0.28.0', date: '2026-10-31',
    notes: [
      'Gerçek navigasyon ekranı: harita her zaman gidiş yönü yukarı olacak şekilde döner (rotanın yönünden alınır, GPS yönü olmasa da çalışır), 3D eğimli görünür ve araç ekranın alt kısmında, yol önü geniş görünür. Araç oku hep yukarı bakar. Nav kartındaki anahtardan kuzey-yukarı düz haritaya dönülebilir.',
      'Harita üstü alt bilgi çubuğu: hız, varış saati, kalan km ve süre (şarj molaları dahil), pil yüzdesi; sesli yönlendirmeyi aç-kapat, tüm rotayı göster ve aracı ortala (haritayı kaydırınca çıkar) düğmeleri.',
      'Üstteki yön kartında bir sonraki dönüş de gösterilir: Sonra (3 km sonra): ...',
    ],
  },
  {
    v: '0.27.0', date: '2026-10-31',
    notes: [
      'Şarj yuvası doluluğu: Google in canlı konnektör verisi okunur ve Şarj planı, İstasyon listesi, Yakınımdaki istasyonlar ve düşük pil uyarısında gösterilir (örn. 3/4 boş, dolu 0/4, arızalı, kaç dk önceki bilgi). Bilgi vermeyen ağlar için doluluk bilgisi yok yazar.',
      'Planlama doluluğu dikkate alır: tamamen arızalı istasyon aday olmaz, yakın (ilk 150 km) ve dolu görünen istasyona 20 dk bekleme eklenir. Düşük pil önerisinde arızalı istasyon önerilmez, dolu olan daha uzak sayılır.',
      'Yaklaşan planlı duraklar için canlı doluluk 5 dakikada bir yenilenir. Durak dolu veya arızalı çıkarsa sesli uyarı verilir ve plan kendiliğinden yeniden hesaplanır.',
    ],
  },
  {
    v: '0.26.1', date: '2026-10-31',
    notes: [
      'Yunanistan gibi bölgelerde istasyon bulunamama için yedek arama: Google istasyon türü filtresiyle bir bölgede hiç sonuç vermezse o bölge EV charging station metin aramasıyla bir daha sorgulanır (yalnızca şarj bilgisi olan kayıtlar alınır).',
      'İstasyon sekmesinde arama özeti: Google kaç kayıt döndürdü, kaçı aday kaldı, neden elendi (Tesla, kapalı vb.), yedek aramanın kaç istasyon bulduğu ve her 100 km için aday sayısı. Eksik bölgeyi bu satırda görürsün.',
    ],
  },
  {
    v: '0.26.0', date: '2026-10-31',
    notes: [
      'Şarj planı artık konuma göre canlı: araç ilerledikçe her durak için kaç km kaldı yazar (her km güncellenir); geçilen duraklar plandan, geride kalan istasyonlar Şarj planı, İstasyon listesi ve haritadan çıkar.',
      'Plan bulunulan konum ve gerçek pil yüzdesiyle kendiliğinden yeniden hesaplanır: bir durak geçilince, gerçek pil plan beklentisinden 4 puandan fazla saparsa veya son hesaptan 25 km sonra (en az 45 saniye arayla). Kalan durak sayısı, şarj süresi, maliyet ve varışta pil buna göre güncellenir.',
      'Google Haritalar da aç düğmesi artık yalnızca kalan durakları gönderir.',
    ],
  },
  {
    v: '0.25.2', date: '2026-10-31',
    notes: [
      'Test Modu sürüş simülasyonunda harita artık aracı izler: Oynata a basınca araca yakınlaşır (hıza göre 17, 16 veya 15 zoom) ve araç ilerledikçe ortalar. Haritayı elle kaydırırsan izleme 15 saniye durur. Navigasyon kapalıyken de çalışır.',
    ],
  },
  {
    v: '0.25.1', date: '2026-10-31',
    notes: [
      'Test Modu sürüş simülasyonu: pil artık yalnızca hıza göre azalır. Planlı duraklarda anında şarj ve iniş/arka rüzgârdan gelen rejenerasyon artışı kaldırıldı (inişte bile en az yardımcı yük ve klima kadar harcanır).',
      'Pil 0a gelince simülasyon durmaz: pil %80e sıfırlanır ve sürüş devam eder.',
    ],
  },
  {
    v: '0.25.0', date: '2026-10-31',
    notes: [
      'Pil eşiğin altına inince (varsayılan %20; rota başlatılmamış olsa da) uygulama yakın istasyonları kendisi arar ve en yakın 3 tanesini uyarı kutusunda listeler (mesafe, kW, fiyat, varışta pil, Git). Çevrede bulunamazsa yarıçapı otomatik 50 kme çıkarır; konum yoksa GPSi açmanı ister. Tüm liste için İstasyon sekmesine tek dokunuş.',
      'Git artık varış noktasını değiştirmez: rota bulunduğun yerden seçtiğin istasyon üzerinden asıl varışa yeniden kurulur ve plan ilk durak olarak orada şarj eder (varışta kaç pil, kaça şarj).',
      'Plan sıradaki durağa ulaşılamıyor derse (navigasyon açıkken) rota en uygun yakın istasyon üzerinden kendiliğinden güncellenir, sesli söylenir; 10 dakikada en fazla bir kez.',
    ],
  },
  {
    v: '0.24.1', date: '2026-10-31',
    notes: [
      'Yenileme sonrası alt menünün kaybolması için iki önlem: uygulama yüksekliği artık gerçek görünür alandan ölçülür (sayfa yenilenince 100dvh yanlış kalabiliyordu) ve yenilemede geri yüklenen belge kaydırması sıfırlanır.',
      'Uyarı çubukları (navigasyon, yol önü, düşük pil, tavsiye) ortak kutuya alındı; kutu ekranın en çok %38ini kaplar, fazlası kutunun içinde kayar. Uyarılar ne kadar birikse alt menü ve içerik alanı görünür kalır.',
    ],
  },
  {
    v: '0.24.0', date: '2026-10-31',
    notes: [
      'Menzil sekmesine Hız ve Anlık güç (tahmin) kartları ve Yolculuk ve tüketim geçmişi eklendi: bu yolculuk ve tüm geçmiş (km, kWh/100km, ortalama hız), tüketim ve hız grafiği, hız bandı tablosu (kWh/100km ve düzeltme k) ve Geçmişi sil düğmesi.',
      'Geçmiş kaydı: sürerken pil yüzdesi düştükçe ölçüm penceresi (en az 5 km, 3 puan) kayda alınır; cihazda saklanır. Test Modu ve şarj sırasındaki veri kaydedilmez.',
      'Planlama artık geçmişten öğrenir: seyir hızına yakın (±12 km/s) ölçümlerden bulunan düzeltme k, enerji ve şarj planına uygulanır (en az 40 km veri; aykırı ölçümler atılır; canlı ölçüm varsa yarı yarıya karışır). Hangi k nin neden kullanıldığı Menzil sekmesinde yazar.',
    ],
  },
  {
    v: '0.23.0', date: '2026-10-31',
    notes: [
      'Trafik artık otomatik: rota planlanırken Google trafikli süresinin trafiksiz süreye oranından trafik yoğunluğu hesaplanır ve enerji, hız, süre ile şarj planına girer. Rota sekmesinde Google süreleri ve çıkan yoğunluk yazar.',
      'Sürgüyü elle oynatırsan otomatik kapanır (anahtardan tekrar açılır); elle değer korunur.',
      'Navigasyondaki varış saati artık Google trafikli kalan süresini (10 dakikada bir yenilenir) ve kalan şarj molalarını kullanır.',
    ],
  },
  {
    v: '0.22.0', date: '2026-10-31',
    notes: [
      'Alt menü kaybolması düzeltildi: üstte uyarı çubukları birikince menü sıkışıp görünmez oluyordu; artık sabit kalır, taşan kısmı sayfa kaydırır.',
      'Navigasyon modu: Navigasyonu başlat deyince harita görünür alanı doldurur (durum rozetleri gizlenir), araç eğik ve yön-yukarı görünümde izlenir. Zoom hıza göre ayarlanır: yavaşken yakın, otoyol hızında uzak.',
      'Kavşak ve dönüşlere 400 metre kala haritada büyük pencere açılır (ok, kalan metre, Google talimatı, örn. Kavşakta 2. çıkıştan çıkın); 250 metrede harita en yakın zoom a girer, 120 metrede pencere yanıp söner.',
    ],
  },
  {
    v: '0.21.0', date: '2026-10-31',
    notes: [
      'Yol önü uyarıları (navigasyon açıkken, 10 dakikada bir yenilenir): ileride yağmur (Google Weather, önümüzdeki 200 km, sıcaklık 2 derece altındaysa buzlanma riski) ve ileride yoğun veya yavaş trafik ile toplam gecikme (Google Routes trafik çizgisi). Üstte uyarı çubuğunda görünür ve sesli söylenir.',
      'Hız uyarısı: Navigasyon kartından kendi belirlediğin eşiği ayarla (0 = kapalı); 5 saniye aşılırsa sesli uyarır. Bu yolun yasal sınırı değildir.',
      'Not: Google Maps Platform kaza, polis, hız kamerası ve yol hız sınırı verisi sunmuyor; bu uyarılar şimdilik yok.',
    ],
  },
  {
    v: '0.20.2', date: '2026-10-31',
    notes: [
      'Uzun rotada istasyon araması için çağrı sınırı 150den 300e çıkarıldı (çok uzun ve şehirli rotalarda liste artık kesilmez). Her çağrı Google kotasından düşer.',
    ],
  },
  {
    v: '0.20.1', date: '2026-10-31',
    notes: [
      'Uzun rotada istasyon araması artık kademeli: önce rotanın tamamı taranır, sonra yalnızca dolu ve rotaya değen daireler bölünür. Çağrı sayısı çok azaldı; arama 120 çağrıda kesilip zincirin rotanın ortasında kopması düzeltildi.',
      'Hava durumu: tek bir noktadaki geçici Google hatası artık tüm hava verisini düşürmüyor (nokta bir kez yeniden denenir, olmazsa komşu nokta kullanılır). Google API etkin değil veya faturalandırma yok hataları açık Türkçe yazılır.',
    ],
  },
  {
    v: '0.20.0', date: '2026-10-31',
    notes: [
      'Tüm harita, rota, istasyon, yer arama, hava ve rakım verisi artık YALNIZCA Google Maps Platform servislerinden gelir (Maps JavaScript, Routes, Places New, Weather, Geocoding, Elevation). OSM, Overpass, OSRM, Nominatim, Photon, Open-Meteo, MET Norway, OpenChargeMap ve CARTO kaldırıldı.',
      'Rota sekmesinin en üstündeki kutuya Google API anahtarını gir (kamerayla da okunur); anahtar yalnızca telefonda saklanır. Kaydet ve sına düğmesi hangi servisin çalıştığını veya kapalı olduğunu gösterir. Anahtar olmadan uygulama veri alamaz.',
      'Dönüş talimatları ve sesli yönlendirme metni Google tarafından Türkçe gelir. Rota trafik farkındadır. İstasyon kW değeri Google evChargeOptions alanından okunur; fiyat Google tarafında olmadığı için operatör tablosundan gelir.',
      'Yerleşik OSM istasyon listesi ve yedek servisler kaldırıldı; Google verisi eksikse Kendi istasyonlarım ile tamamla. Not: uzun rotada Places çağrısı sayısı kotayı ve faturayı etkiler; Google Cloud içinde bütçe uyarısı koy.',
    ],
  },
  {
    v: '0.19.0', date: '2026-10-31',
    notes: [
      'Navigasyon: Rota sekmesinde Navigasyonu başlat. Üstte dönüş dönüş banner (yön oku, kalan metre, yol adı, kalan km, varış saati, sıradaki şarj durağı). Harita aracı izler; haritayı elle kaydırırsan 15 sn izleme durur.',
      'Sesli yönlendirme (Türkçe, açma/kapama anahtarı): dönüşlere 2 km, 500 m ve 120 m kala; şarj durağına 5 km ve 1 km kala. Rotadan 350 m çıkıp 12 sn sürerse bulunduğun yerden otomatik yeniden rota kurar (istasyon listesi korunur).',
      'İstasyon sekmesinde Yakınımdaki istasyonlar: 10/25/50 km çevre, uzaklık, kW, TL/kWh, tahmini varış pili, %80e şarj süresi ve maliyeti; Git (navigasyonu başlatır), Google Haritalar ve haritada göster. Fiyatlar operatör tablosundaki tahmin değerlerdir.',
      'Düşük pil: pil eşiğin (ayarlanır, varsayılan %20) altına inince veya menzil yetmeyecek görününce en yakın uygun istasyon üstte önerilir ve sesli söylenir. Navigasyon açıkken veya sürerken yakın istasyon listesi 15 dk ya da 10 km yol sonrası kendiliğinden yenilenir.',
    ],
  },
  {
    v: '0.18.0', date: '2026-10-31',
    notes: [
      'Kartlar artık başlığın yanındaki + / − düğmesiyle açılıp kapanır; seçimin telefonda hatırlanır. Uygulama kısalsın diye Araç ve tüketim, Kendi istasyonlarım, Operatör tablosu ve ABRP paket önizlemesi ilk açılışta kapalı gelir.',
    ],
  },
  {
    v: '0.17.0', date: '2026-10-30',
    notes: [
      'İstasyon sekmesinde "Kendi istasyonlarım": haritada eksik istasyonu yer arayarak veya bulunduğun yeri ekleyerek tanımla (operatör ve kW seçilir). Plan bunları da aday sayar; telefonda saklanır.',
      'Zincir kurulamazsa neden artık açıkça yazılır: hangi istasyondan sonra, sonraki aday kaç km uzakta, o pille en fazla kaç km gidilebilir. (Doğu Anadolu gibi OSM verisinin boş olduğu aralıklar için.)',
    ],
  },
  {
    v: '0.16.0', date: '2026-10-30',
    notes: [
      'Yerleşik istasyon listesi (data/stations.json, 6688 herkese açık istasyon: Türkiye, Yunanistan, Balkanlar; OSM 30.10.2026). Overpass sunucuları yanıt vermediğinde rotadaki istasyonlar buradan gelir; çevrimdışı da çalışır.',
      'Hava durumu yedeği: Open-Meteo yanıt vermezse (429/zaman aşımı) MET Norway kullanılır; kart kaynağı ve nedeni gösterir, hata olursa sebebi yazar.',
      'OpenChargeMap anahtarı reddedilirse (HTTP 403) bunu açıkça söyler; İstasyon sekmesine "Anahtarı sına" düğmesi eklendi.',
    ],
  },
  {
    v: '0.15.0', date: '2026-10-30',
    notes: [
      'Rota sekmesinde "Rota boyunca hava" kartı: her ~50 km için sıcaklık, yağış, rüzgâr hızı ve o dilimdeki kafa/arka rüzgâr (planın hesapta kullandığı veri) ile kısa özet. Hava verisi alınamazsa kart bunu söyler.',
      'Hava servisi geçici sınır/yoğunluk (429/5xx) verirse bir kez bekleyip yeniden denenir.',
    ],
  },
  {
    v: '0.14.0', date: '2026-10-30',
    notes: [
      'Yalnızca herkese açık istasyonlar: OSM erişim etiketi özel/müşteri/izinli olanlar ve OpenChargeMap kısıtlı/özel olanlar elenir.',
      'DÜZELTME: Aynı noktadaki iki operatörden (ör. Astor + Trugo) biri yanlışlıkla eleniyordu; artık yalnızca aynı operatörün kopyası atılır. İstasyon listesinde her satırda operatör düzeltme menüsü (kalıcı): fiyat ve kW seçilen operatöre göre alınır.',
      'DÜZELTME: 80 istasyon sınırı en güçlüleri seçerken seyrek bölgelerdeki (ör. Kayseri–Malatya) istasyonları silebiliyordu; artık her 15 km diliminde en güçlü 2 istasyon korunur.',
      'Bilinen hızlı (DC) istasyonun olmadığı 150 km üzeri aralıklar plan durumunda uyarı olarak gösterilir (harita verisi eksik olabilir). Yavaş AC / türü belirsiz herkese açık istasyonlar yalnızca DC yetmediğinde yedek olur (kapatılabilir).',
    ],
  },
  {
    v: '0.13.2', date: '2026-10-30',
    notes: [
      'DÜZELTME: Plan, birbirine 6 km uzaklıktaki iki istasyonda ikişer dakikalık anlamsız duraklar çıkarabiliyordu (giriş eşiğinde 1 puanlık uçurum yüzünden). Artık "Durakta en az eklenecek pil" (varsayılan 15 puan) uygulanır; kuralla çözüm çıkmazsa kuralsız yeniden denenir.',
      'Eşik toleransı (± puan, varsayılan 3): giriş ve varış eşiğinin biraz altına inmek yasak değil ama cezalı; plan eşikte sıçramaz. Varış eşiğin altındaysa durum satırında belirtilir.',
    ],
  },
  {
    v: '0.13.1', date: '2026-10-30',
    notes: [
      'Plan payları net adlandırıldı: "Şarj istasyonuna giriş pili (en az)" ve "Şarj hedefi, istasyondan çıkış (en fazla)". Giriş pili aralığı %5–50.',
    ],
  },
  {
    v: '0.13.0', date: '2026-10-30',
    notes: [
      'Araç seçimi: Togg T10X V2 Uzun Menzil (varsayılan), Standart Menzil (tahmini) ve Özel araç; batarya, ağırlık, Cd, ön alan ve DC şarj gücü düzenlenebilir (Rota sekmesi, Araç ve tüketim). Araç değişince sayfa yenilenir.',
      'Tüketim ayarı: gerçek tüketimini (kWh/100 km) yaz veya düzeltme sürgüsünü kullan; plan, menzil ve eco-hız buna göre hesaplanır. Modelin hız başına tahmini gösterilir.',
      'Plan payları ayarlanabilir: ara istasyona varışta en az pil (varsayılan %8 yerine %10) ve durakta şarj hedefi üst sınırı. Daha yüksek tüketim/pay = daha çok şarj durağı.',
    ],
  },
  {
    v: '0.12.3', date: '2026-10-30',
    notes: [
      'DÜZELTME: Uzun rotalarda (ör. İstanbul–Selanik) "0 aday istasyon" çıkıyordu. İstasyon sorgusu rota boyunca sınır kutusu (bbox) parçalarına çevrildi (sunucuya çok daha ucuz); çalışan Overpass aynası (overpass.openstreetmap.fr) eklendi. Test: İstanbul–Selanik rotasında 17 sn içinde 52 istasyon.',
      'DÜZELTME: Overpass zaman aşımında HTTP 200 + boş liste döndürüyordu; bu artık hata sayılıp sıradaki sunucuya geçilir.',
    ],
  },
  {
    v: '0.12.2', date: '2026-10-30',
    notes: [
      'DÜZELTME: v0.12.1 yayınında sürüm numarası "v?" görünüyordu (sürüm dosyasında sözdizimi hatası); düzeltildi.',
    ],
  },
  {
    v: '0.12.1', date: '2026-10-30',
    notes: [
      'DÜZELTME: Şarj istasyonu bulunamıyordu — herkese açık Overpass sunucuları yanıtsız kalınca liste boş geliyor ve uyarı 5 sn sonra kayboluyordu. Sunucular artık paralel/kademeli denenir (5 ayna, yanıtsız olan atlanır): toplam bekleme ~2 dk yerine ~30–55 sn.',
      'Overpass tamamen yanıtsızsa Photon üzerinden tanınan operatör adlarıyla (ZES, Trugo, Eşarj, Voltrun, Astor…) yaklaşık bir liste alınır.',
      'İstasyon sekmesinde kalıcı uyarı (neden bulunamadı) ve "İstasyonları yeniden ara" düğmesi (rotayı baştan hesaplamaz).',
    ],
  },
  {
    v: '0.12.0', date: '2026-10-30',
    notes: [
      'Rota sekmesinde isteğe bağlı CARTO harita anahtarı: girilirse yerel koyu CARTO karoları kullanılır, boşsa OpenStreetMap. Anahtar yalnızca telefonda saklanır (depoya yazılmaz).',
    ],
  },
  {
    v: '0.11.0', date: '2026-10-30',
    notes: [
      'DÜZELTME: Yer aramada Türkçe şehir adları (Selanik, Üsküp, Atina, Köln…) bulunuyor. Arama artık Nominatim ve Photon sonuçlarını birleştirir; Photon Türkçe adları çözemiyordu.',
    ],
  },
  {
    v: '0.10.0', date: '2026-10-30',
    notes: [
      'Başlığa veya sürüm numarasına dokununca uygulama yenilenir (yeni sürüm varsa service worker güncellenir). Aktif plan veya OCR varken yanlışlıkla dokunmaya karşı ikinci dokunuş ister.',
      'Sürüm notları artık ⓘ düğmesinde.',
    ],
  },
  {
    v: '0.9.0', date: '2026-10-30',
    notes: [
      'Veri tasarrufu: ABRP gönderim aralığı ayarlanabilir (5–60 sn, varsayılan 10 sn ≈ 0,4 MB/saat); araç duruyorken en az 30 sn\'de bir gönderilir.',
      'Veri tasarrufu: Rota sekmesinde "Harita karolarını yükleme" anahtarı (tarayıcı Veri Tasarrufu açıksa varsayılan kapalı).',
      'Leaflet ve Tesseract (çekirdek + dil verisi) uygulamayla birlikte sunulur (vendor/); service worker bunları sürümden bağımsız önbelleğe alır, CDN\'den tekrar indirilmez.',
    ],
  },
  {
    v: '0.8.0', date: '2026-10-30',
    notes: [
      'DÜZELTME: Kamera sekmesi gizliyken (başka sekmedeyken) OCR hata verip pil/hız güncellemesini durduruyordu; artık sekmeden bağımsız çalışır.',
      'OCR rozeti son geçerli okumanın yaşını gösterir (30 sn\'den eskiyse). Pil okuması 5 dk\'dan eskiyse ABRP\'ye eski değer gönderilmez.',
      'Kamera sekmesinde "Açılışta kamerayı ve OCR\'ı otomatik başlat" (kamera izni verilmişse). Ekran kilidi (Wake Lock) önceki oturumda açıksa kendiliğinden yeniden alınır.',
    ],
  },
  {
    v: '0.7.0', date: '2026-10-30',
    notes: [
      'OpenChargeMap API anahtarı da kamerayla okunur: boş alana dokununca veya "Anahtarı kamerayla oku" düğmesiyle.',
    ],
  },
  {
    v: '0.6.0', date: '2026-10-30',
    notes: [
      'Boş User Token / API Key alanına dokununca kamera açılır ve ekrandaki METİN OCR ile okunur (UUID biçimi, iki okuma tutarlı olunca kabul). Kılavuz kutu, "Elle yaz" ve "Boş alana dokununca kamerayı aç" anahtarı eklendi.',
      'Okunan değer onay ekranında düzenlenebilir (OCR yanılırsa karakter düzeltilir). İnce çizgili yazıda kalınlaştırarak ikinci deneme.',
      'QR göster / QR ile oku kaldırıldı (v0.3.0\'daki); yalnızca metin okunur.',
    ],
  },
  {
    v: '0.5.0', date: '2026-10-30',
    notes: [
      'Ana sayfada sürüm numarası ve sürüm notları (sürüme dokun).',
      'Veri kullanımı sayacı: gönderilen/alınan veri kategoriye göre, sıfırlanabilir.',
      'Service worker önbelleği sürüm numarasına bağlandı.',
    ],
  },
  {
    v: '0.4.0', date: '2026-10-30',
    notes: [
      'PNG simgeler ve güncel manifest: Chrome\'dan gerçek uygulama olarak yüklenebilir.',
      '"Uygulamayı yükle" düğmesi.',
    ],
  },
  {
    v: '0.3.0', date: '2026-10-30',
    notes: [
      'Rota sekmesinde yer/adres arama (öneri listesi, koordinat yapıştırma, haritadan seçince ad).',
      'ABRP token ve API Key için QR göster / QR ile oku.',
      'Service worker güncellemeleri sunucuyla doğruluyor (eski sürüm görünmesin).',
    ],
  },
  {
    v: '0.2.0', date: '2026-10-30',
    notes: [
      'ABRP gönderimi iki istek biçimini deniyor (sorgu parametreli GET / form gövdeli POST).',
      'ABRP paketine is_dcfc eklendi.',
    ],
  },
  {
    v: '0.1.0', date: '2026-10-30',
    notes: [
      'İlk sürüm: dark arayüz, GPS, kamera OCR (pil + ekran hızı), outlier filtresi, Wake Lock.',
      'Fizik tabanlı menzil motoru, rakım, hava, trafik modeli.',
      'OSRM rota, istasyonlar, şarj planlayıcı (En Hızlı / En Ekonomik / Optimum).',
      'Fallback, eco-hız ve sesli uyarı; ABRP köprüsü; Test Modu ve sürüş simülasyonu.',
    ],
  },
];
