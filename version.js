// Tek sürüm kaynağı. Sayfa (klasik <script>) ve service worker (importScripts) buradan okur.
// KURAL: her değişiklikte APP_VERSION artırılır ve APP_CHANGELOG'un EN ÜSTÜNE bir kayıt eklenir.
//   x.y.z → z: düzeltme · y: yeni özellik · x: uyumsuz/büyük değişiklik. Commit mesajı "vX.Y.Z: ..." ile başlar.
// Sürüm değişince sw.js'in önbellek adı da değişir; telefon yeni sürümü indirir.
self.APP_VERSION = '0.20.1';
self.APP_CHANGELOG = [
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
