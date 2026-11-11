// Tek sürüm kaynağı. Sayfa (klasik <script>) ve service worker (importScripts) buradan okur.
// KURAL: her değişiklikte APP_VERSION artırılır ve APP_CHANGELOG'un EN ÜSTÜNE bir kayıt eklenir.
//   x.y.z → z: düzeltme · y: yeni özellik · x: uyumsuz/büyük değişiklik. Commit mesajı "vX.Y.Z: ..." ile başlar.
// Sürüm değişince sw.js'in önbellek adı da değişir; telefon yeni sürümü indirir.
self.APP_VERSION = '0.99.28';
self.APP_CHANGELOG = [
  {
    v: '0.99.28', date: '2026-11-11',
    notes: [
      'Gidis yonu yukari (course-up) rotasiz suruste de: arac 12 km/h ustunde hareket edince harita araci izler, arac ok olarak ekranin alt kisminda, gidis yonu ekranin ustunde; park edince (2 dk duran arac) harita serbest kalir.',
      'Yon GPS gidis yonunden gelir (pusula kullanilmaz): 8 km/h altinda, dogruluk 50 m den kotuyken ya da yon yokken son guvenilir yon korunur; olcumler yumusatilir, yavasken tek seferlik GPS sicramasi yonu cevirmez.',
      'Navigasyonda da ayni suzulmus GPS yonu kullanilir (rota disindayken); harita donusu yumusak. Harita yonu ayari (kuzey yukari) her iki modda gecerli.',
    ],
  },
  {
    v: '0.99.27', date: '2026-11-11',
    notes: [
      'Rotasiz surus ust paneli (pil/menzil/tuketim karti) navigasyon ust bariyla ayni kenar boslugu, genislik ve kose yaricapinda; genis ekranda da ayni 420 px.',
      'Okunabilirlik: pil yuzdesi ve menzil rakamlari buyudu; dar ekranda yazi boyu ekrana gore kucuk olcekte kalir.',
      'Harita alani korunur: kaynak satiri tek satirda kalir (sigmazsa kisalir), sigmayan esik menzili yarim rakam yerine gizlenir; kart 360 px ekranda ~115 px yerine ~97 px.',
    ],
  },
  {
    v: '0.99.26', date: '2026-11-11',
    notes: [
      'Kamera pil okumasi duzeltmesi: kareler bir cevrimde karisinca (38/33/38) dogru deger hic dogrulanamiyor, gecerli deger eski kalip hesaplama Tahmin\'e dusuyordu. Artik son birkac cevrim birlikte degerlendirilir (en az 2 cevrim, son cevrimle uyumlu, kare cogunlugu); ham okuma dogrulanmadan pile gecmez.',
      'Tek farkli okuma gecerli pili degistirmez: yeni deger ikinci cevrimde (rakam karisikligina benziyorsa ucuncude) teyit edilir; arka plandan donuste de ayni kural gecerlidir.',
      'Arka plan/on plan: OCR arka planda durur, donuste (visibilitychange/pageshow/focus) hemen yeniden okur; iOS\'ta kacirilan kamera unmute/ended olaylari senkronlanir. 5 sn okuma duzeni degismedi.',
      'Pil 45 sn dogrulanamazsa Eski (kac sn once dogrulandigi yazar), 60 sn sonra son dogrulanan degerden guvenli tahmin. Kamera Tanilama tablosunda Son karar satiri (kareler, cevrim/pencere adayi, filtre sonucu).',
    ],
  },
  {
    v: '0.99.25', date: '2026-11-11',
    notes: [
      'Kamera/OCR ekrani daha okunakli: Okuma kartinda Son guncelleme etiketi ve kalin saat, Ham/Gecerli/Durum kutularinda etiket ustte ve deger iri, Eski isareti renkli rozet; Tanilama tablosunda etiket/deger ayrimi, satir cizgileri ve daha buyuk yazi; son 5 ham okumada saat kalin. Kamera, OCR ve 5 saniyelik okuma degismedi',
    ],
  },
  {
    v: '0.99.24', date: '2026-11-11',
    notes: [
      'Istasyon fiyati: isletmecilerin yayimladigi guncel kWh tarifesi (VeriApi.Pro, sunucudan gunde bir) sabit listedeki tahmini fiyatin yerine gecer; kartta isletmeci tarifesi yazar. Kullanici DC fiyatini degistirdiyse onun fiyati gecerli. Tabloda olmayan isletmeciler (Esarj, Voltrun, Tesla) liste fiyatinda kalir',
    ],
  },
  {
    v: '0.99.23', date: '2026-11-11',
    notes: [
      'VeriApi.Pro: gercek yanit semasina gore cozucu duzeltildi (kademe ust_kw, lokasyona gore degisen fiyatta ust sinir en_cok kullanilir, maliyet dusuk gosterilmez); 12 isletmeci cozuluyor',
    ],
  },
  {
    v: '0.99.22', date: '2026-11-11',
    notes: [
      'Sunucu: VeriApi.Pro ile Turkiye isletmecilerinin genel kWh tarifeleri (gunde bir cekim, anahtar yoksa kapali); canli ve kullanici fiyati yoksa son care olarak gosterilir, atifli (tarife - VeriApi.Pro). Doluluk vermez',
    ],
  },
  {
    v: '0.99.21', date: '2026-11-11',
    notes: [
      'Sunucu: canli doluluk icin normalize EVSE durum katmani (AVAILABLE, CHARGING, RESERVED, BLOCKED, OUTOFORDER, INOPERATIVE, UNKNOWN), zaman damgasi, kaynak ve tazelik bilgisi; NDW, HERE, TomTom ve Google sonuclarina ek alan olarak eklendi, arayuz degismedi',
    ],
  },
  {
    v: '0.99.20', date: '2026-11-11',
    notes: [
      'Ekran goruntusunden pil okuma ozelligi kaldirildi (0.99.19)',
    ],
  },
  {
    v: '0.99.19', date: '2026-11-11',
    notes: [
      'Pil yuzdesi artik arac uygulamasinin widget veya ekran goruntusunden okunabiliyor: Pil kartindaki ve pil penceresindeki dugme goruntu secer, OCR cihazda calisir, %, menzil ve zaman damgasi okunur, eski veri (1 saatten eski) uyarilir ve yuzde onaydan once duzenlenebilir',
    ],
  },
  {
    v: '0.99.18', date: '2026-11-11',
    notes: [
      'Rota planlama ekrani klavye acikken duzeltildi: sayfa klavyenin ustune sigar (iOS), yazarken form kompakt (pil karti ve Planla/Git gizli), odakli alan sayfanin ustune kayar ve oneri listesi gorunur',
    ],
  },
  {
    v: '0.99.17', date: '2026-11-11',
    notes: [
      'Istasyonlar sekmesinden Operatoru duzelt acilir menusu kaldirildi',
    ],
  },
  {
    v: '0.99.16', date: '2026-11-11',
    notes: [
      'Istasyonlar sekmesinde Rotadakiler listesinde planli duraklara Degistir ve Kaldir dugmeleri eklendi',
    ],
  },
  {
    v: '0.99.15', date: '2026-11-11',
    notes: [
      'Planli sarj duragina Kaldir dugmesi (Rota sayfasi ve istasyon karti): durak rotadan cikar; gerekirse rota uzerinden alternatif secilir, gerekmiyorsa tamamen kalkar; kurulamazsa eski plan korunur',
    ],
  },
  {
    v: '0.99.14', date: '2026-11-11',
    notes: [
      'Istasyon kartinda rotadaki ama planda olmayan istasyona Sarj et dugmesi: istasyon plana zorunlu girer, rota guncellenir, gerekmeyen otomatik durak cikarilir',
    ],
  },
  {
    v: '0.99.13', date: '2026-11-11',
    notes: [
      'Durak degistirme (Rota sayfasi ve istasyon karti): adaylar filtresiz, rotada durak ±5 km cevresindeki tum istasyonlar; filtreye uymayanlar filtre disi diye isaretlenir ve secilince plana girer',
    ],
  },
  {
    v: '0.99.12', date: '2026-11-11',
    notes: [
      'Harita istasyon kartinda rotadaki sarj duragi icin Fiyat bildir in yanina Degistir dugmesi: 5 km cevresindeki uygun istasyonlar listelenir, secilen istasyon rotaya girer ve eskisi cikar',
    ],
  },
  {
    v: '0.99.11', date: '2026-11-11',
    notes: [
      'Durak degistirmede secilen istasyon eskisinin yerine gecer, diger duraklar ayni kalir; sarj miktari, sure ve maliyet yeniden hesaplanir (zincir kurulamazsa diger duraklar da yeniden duzenlenir)',
    ],
  },
  {
    v: '0.99.10', date: '2026-11-11',
    notes: [
      'Rota sayfasinda her sarj duragina Degistir dugmesi: duragin 5 km cevresindeki filtrelere (guc, marka) uygun istasyonlar listelenir, secilen istasyon zorunlu durak olur ve plan yeniden hesaplanir',
    ],
  },
  {
    v: '0.99.9', date: '2026-11-11',
    notes: [
      'Sarj duragina varinca (kamera pili okumuyorsa) arac yuzdesi sorulur: girilen deger elle pil olarak tuketim ogrenmeye katilir; tahmin, plan ve gercek fark Menzil gecmisinde Varis kalibrasyonlari listesinde tutulur',
    ],
  },
  {
    v: '0.99.8', date: '2026-11-11',
    notes: [
      'Pil hapinda iki tuketim (simdi ve rota/duz ortalama) ve toplam menzilin yaninda esik piline kadar menzil gosterilir',
    ],
  },
  {
    v: '0.99.7', date: '2026-11-11',
    notes: [
      'Kamerasiz tuketim ogrenme: yol aldiktan sonra elle girilen pil (en az 10 km, 5 puan dusus) olcum penceresi sayilir; k ve gecmis guncellenir, ogrenince bildirim gosterilir',
    ],
  },
  {
    v: '0.99.6', date: '2026-11-10',
    notes: [
      'Istasyon listesinde pil dolu iken yakin adaylarda eksi maliyet duzeltildi (sarj gerekmez, sona siralanir); imkansiz ortalama gucu olan sarj oturumlari kayda alinmaz ve listeden suzulur',
    ],
  },
  {
    v: '0.99.5', date: '2026-11-10',
    notes: [
      'Rota sayfasinda Ev, Is ve favori kisayollari Rota basligin yanina alindi, kucultme dugmesi kaldirildi; Son hedefler okunun boyutu buyutuldu',
    ],
  },
  {
    v: '0.99.4', date: '2026-11-10',
    notes: [
      'Sarj fiyati veri katmani: fiyat kaynagi (canli, bildirilen, kullanici tarifesi, liste tarifesi) ve zaman bilgisi eklendi; tahmini ortalama, yurt disi ve 0 ya da eksik fiyat bilinmiyor sayilir. Arayuz degismedi',
    ],
  },
  {
    v: '0.99.3', date: '2026-11-10',
    notes: [
      'Harita ve navigasyon ekraninda sag dugme sirasindan Favoriler, Arac ve menzil, Test Modu ve ABRP dugmeleri kaldirildi; Daha fazla menusunden erisilir',
    ],
  },
  {
    v: '0.99.2', date: '2026-11-10',
    notes: [
      'Navigasyon ekraninda alt hiz ve varis seridi inceltildi (54 pikselden 40 piksele); alt gezinme cubugu ile ayni ince gorunum',
    ],
  },
  {
    v: '0.99.1', date: '2026-11-10',
    notes: [
      'Alt gezinme cubugu geri geldi (Harita, Istasyonlar, Daha fazla) ve yuksekligi 62 pikselden 44 piksele indirildi; simge ve yazi yan yana',
    ],
  },
  {
    v: '0.99.0', date: '2026-11-10',
    notes: [
      'Alt gezinme cubugu kaldirildi: Istasyonlar ve Daha fazla sagdaki yuvarlak dugme sirasina tasindi (istasyon rozeti dugmenin kosesinde); harita alt kenara kadar uzanir',
    ],
  },
  {
    v: '0.98.1', date: '2026-11-10',
    notes: [
      'Liste tarifeleri yonga.io/sarj-fiyatlari kaynagina (06.11.2026) gore guncellendi: ZES AC, Eşarj, Sharz ve Diger fiyatlari degisti; 18 yeni marka eklendi (Neva, Otojet, otoWATT, WAT, Şarjon, Sepaş, Aksa, e-POwer, ovolt, Electrise vb.); kullanicinin degistirdigi fiyatlar korunur',
    ],
  },
  {
    v: '0.98.0', date: '2026-11-10',
    notes: [
      'Rota planlama sayfasi kompakt: haritadan sec dugmeleri simge, dokunma alanlari 44 piksel, son hedefler acilir liste, Planla ve Git altta sabit, telefonda ustte harita gorunur kalir',
    ],
  },
  {
    v: '0.97.1', date: '2026-11-10',
    notes: [
      'Haritadaki Rota planla dugmesi Git gibi yesil, simge ve Planla yazisiyla',
    ],
  },
  {
    v: '0.97.0', date: '2026-11-10',
    notes: [
      'Daha fazla menusundeki Durum ve kontroller kaldirildi: GPS, veri kullanimi, Test Modu, guncelleme ve yukleme dugmeleri ust cubugun sagina tasindi; ust seritteki surum numarasi surum notlarini acar',
    ],
  },
  {
    v: '0.96.2', date: '2026-11-10',
    notes: [
      'Acilista harita bulunulan konuma yakinlasir: konum harita acilmadan gelirse bekletilip uygulanir; henuz konum yoksa son bilinen konuma gidilir',
    ],
  },
  {
    v: '0.96.1', date: '2026-11-10',
    notes: [
      'Yolda rota onu verisi tazelenir: trafik (TomTom ya da Mapbox rotasindan) 10 dk, hava 20 dk arayla enerji ve sure hesabina islenir; TomTom aktifken trafik uyarisi da calisir',
    ],
  },
  {
    v: '0.96.0', date: '2026-11-09',
    notes: [
      'BETA: Haritadaki uc nokta menusu kalkti; butun kontroller sag kenarda dikey sutunda dogrudan gorunuyor',
      'BETA: Sutun alttan yukari dizilir, yer yetmezse ikinci sutun sola acilir; ust panele ve alt panellere binmez',
      'BETA: Dokunma alani 44 piksele cikti, sag centik guvenli alani dikkate aliniyor',
    ],
  },
  {
    v: '0.95.0', date: '2026-11-09',
    notes: [
      'BETA: Rota sayfasinin ust kartinda yalnizca kompakt pil surgusu ve sayisal yuzde kaldi',
      'BETA: Arac, tuketim ve guvenli menzil ozeti Gelismis secenekler bolumune tasindi; arac ve tuketim ayarlari Arac ve menzil sayfasinda aynen duruyor',
      'BETA: Pil notu yalnizca varsayilan deger, kamera kilidi ve Test Modunda gorunur',
    ],
  },
  {
    v: '0.94.0', date: '2026-11-09',
    notes: [
      'BETA: Dusuk pil onerisi varsayilan olarak tek kart: ulasilabilir, gucu kesin 150 kW ustu istasyonlar icinde gercek fiyati bilinen en ucuz',
      'BETA: Kartta mesafe, guc ve fiyat gorunur; fiyat yoksa Fiyat bilinmiyor yazar ve en ucuz denmez; 150 kW ustu yoksa en yakin uygun istasyon acikca belirtilir',
      'BETA: Liste dugmesi diger uygun istasyonlari ayni ust panelde acar, Daralt tek karta dondurur',
      'BETA: Dusuk pilde otomatik arama en az 25 km yaricaptan baslar',
    ],
  },
  {
    v: '0.93.0', date: '2026-11-09',
    notes: [
      'BETA: iPhone Safari icin kamera onizlemesi OCR ile ayni koordinatlarla tuvale cizilir; kaydirinca kuculme gorunmez, akis lens ve zoom degismez',
      'BETA: OCR bosluklu okumalari birlestirir (4 2 artik 42); 42 iken 4 veya 2 okuma hane kaybi sayilir, hatali tek haneden otomatik donulur, gercek tek haneli pil yasak degil',
      'BETA: Yeni OCR 2 internet gerektirmeyen rakam tanıyici; OCR 1 (Tesseract) aynen duruyor, ikisi ayni kamera ve kutuyu kullanir',
      'BETA: Okuma basliginda son okuma saati ve sayac; tanilamada son 5 ham okuma, ret nedeni, kirpma bilgisi ve eski deger isareti',
    ],
  },
  {
    v: '0.92.0', date: '2026-11-09',
    notes: [
      'BETA: Lacivert ust bar, beyaz kartlar, yesil eylem rengi ve mavi rota cizgisi',
      'BETA: Ust durum satiri OCR, ABRP, trafik, hava simgesi ve sicaklik; hava verisi yoksa bilinmiyor yazar',
      'BETA: GPS ve ekran acik tut dugmeleri kalkti; GPS izin varsa acik kalir, ekran navigasyonda otomatik acik tutulur',
      'BETA: Haritada pil, menzil, tuketim ve kucuk pil surgusu; Rota planla ve Git yan yana',
      'BETA: Rota sayfasinda arac ozeti, guvenli menzil, ara durak, sarj hedefi (varsayilan %80), varista pil, gelismis secenekler',
      'BETA: Navigasyonda pil, menzil, varista pil, sonraki sarj; durdurma sagdaki kirmizi dugmede ve onayli',
    ],
  },
  {
    v: '0.91.1', date: '2026-11-09',
    notes: [
      'BETA: Ust seritte ABRP durumu kisa ve dogru: pasif, bekliyor, bagli, gonderildi, hata; ayrinti ABRP sayfasinda',
      'BETA: Canli gonderim acikken uygulama yeniden acilinca ABRP ilk gonderime kadar yanlislikla pasif gorunuyordu',
    ],
  },
  {
    v: '0.91.0', date: '2026-11-09',
    notes: [
      'BETA: Rota sayfasinda Rota planla (yalnizca planlar) ve Git (planlar ve baslatir) yan yana; haritada plan hazirken Git gorunur',
      'BETA: Haritadaki uc nokta yukari acilan kucuk simge yigini oldu: Navigasyonu durdur, Favoriler, Arac ve menzil, Test Modu, Kamera, ABRP ve harita kontrolleri',
      'BETA: Arac secimi ve tuketim ayarlari Arac ve menzil sayfasinin basina tasindi',
      'BETA: Haritadaki yinelenen Sarj istasyonlari satiri kaldirildi; istasyonlar alt gezinmeden acilir',
    ],
  },
  {
    v: '0.90.0', date: '2026-11-09',
    notes: [
      'Ust cubuk: uc nokta yerine tek dokunusla ekrani acik tut dugmesi; yalnizca kilit gercekten aliniyorsa acik gorunur, desteklenmeyen tarayicida nedenini soyler',
      'Ust cubugun altinda tek satir durum seridi: GPS, OCR, ABRP, trafik ve surum numarasi',
      'Yukleme, guncelleme, veri kullanimi ve surum notlari Daha fazla > Durum ve kontroller altinda; surum numarasina dokununca da acilir',
    ],
  },
  {
    v: '0.89.0', date: '2026-11-09',
    notes: [
      'Kamera OCR: pil ve hiz sabit 5 saniyede bir okunur (15 saniyeye seyreklesme kalkti); okunamazsa son dogrulanmis deger korunur ve eski olarak gosterilir',
      'Tek kare kabul edilmez: her cevrimde birkac kare ornek alinir, tutarlilik ve guven skoru ile fiziksel makullik (sarj/desarj baglami, ust sinirli tolerans) denetlenir; ilk okuma dahil 73 -> 13 gibi sicramalar engellenir',
      'Parlama ve netlik olcumu, destekleyen cihazda odak/pozlama ayari, en genis acili arka fiziksel kamera oturumda sabit, track ended/mute kurtarma, egim onbellegi, tek calisan OCR dongusu, Tanilama karti',
    ],
  },
  {
    v: '0.88.3', date: '2026-11-09',
    notes: [
      'Kamera varsa en genis acili arka kamerayi kullanir (Ultra Wide etiketi ya da donanim zoom 0.5x); kayitli zoom yoksa en genis acidan baslar',
    ],
  },
  {
    v: '0.88.2', date: '2026-11-09',
    notes: [
      'Kamera sekmesinde goruntu kutusu modern arayuzde 2 piksele cokuyordu; kutu artik daralmaz (flex: none)',
    ],
  },
  {
    v: '0.88.1', date: '2026-11-09',
    notes: [
      'TomTom doluluk eslesmesi marka denetimli: ayni operatorun istasyonu 400 metreye kadar, farkli operatorun kaydi (ayni otoparkta bile) reddedilir; boylece bir istasyonda baska operatorun doluluk bilgisi gosterilmez. Operator adi uygulamadan sunucuya gonderilir.',
    ],
  },
  {
    v: '0.88.0', date: '2026-11-09',
    notes: [
      'TomTom harita ve rota eklendi: Premium hesaplarda varsayilan harita TomTom (Orbis vektor harita, TomTom uydu gorunumu), rota canli trafik, yol hiz limiti ve Turkce adimlarla TomTom uzerinden gelir (yalnizca TomTom haritasi acikken; olmazsa Mapbox veya Valhalla). Yonetici varsayilani degistirebilir. Sunucuda TomTom anahtari gerekir, sunucu yeniden baslatilmali.',
    ],
  },
  {
    v: '0.87.11', date: '2026-11-09',
    notes: [
      'Canli soket doluluguna TomTom kaynagi eklendi (Turkiye: ZES, Trugo, Esarj, WAT, Sharz vb.; sunucu tarafi, Premium). Istasyonlarin yaklasik ucte birinde bos/dolu/arizali bilgisi gelir, TomTom adi gosterilir; fiyat bilgisi vermez.',
    ],
  },
  {
    v: '0.87.10', date: '2026-11-09',
    notes: [
      'En az sarj gucu suzgecinde uygun istasyon yoksa suzgec otomatik bir basamak gevsiyor (180 > 150 > 120 > 60 > 22 > hepsi) ve nedeni listenin ustune yaziliyor; Rotadakiler ve Yakindakiler icin gecerli.',
    ],
  },
  {
    v: '0.87.9', date: '2026-11-09',
    notes: [
      'Istasyonlar ekranindaki Filtre kartina En az sarj gucu (kW) secimi eklendi: 22, 60, 120, 150, 180; Rotadakiler ve Yakindakiler listelerini suzer, tekrar dokununca kalkar. Plani ve dusuk pil onerisini etkilemez.',
    ],
  },
  {
    v: '0.87.8', date: '2026-11-09',
    notes: [
      'Durum ve kontroller penceresinde Ekranı açık tut simgesinin yanına Açık/Kapalı anahtarı eklendi (simgeyle aynı işi yapar, durumları eşit kalır).',
    ],
  },
  {
    v: '0.87.7', date: '2026-11-09',
    notes: [
      'Sayfaların (İstasyonlar, Daha fazla, Rota vb.) üstündeki başlık ve sağdaki kapat düğmesi kaydırırken sabit kalıyor: başlık kaydırma alanının dışına alındı, içerik altında kayar.',
    ],
  },
  {
    v: '0.87.6', date: '2026-11-09',
    notes: [
      'İstasyonlar ekranı yeniden düzenlendi: önce Rotadakiler, sonra Yakındakiler (ikisi de en çok 3 satır, + ile tümü), ardından Filtre, Şarj markaları (3 satır, + ile tümü) ve Ücretler. Yakındakiler 1 km çevreden başlar, boşsa 10, 25 ve 50 km çevreye genişler; sekme açılınca kendiliğinden aranır.',
    ],
  },
  {
    v: '0.87.5', date: '2026-11-09',
    notes: [
      'İstasyonlar ekranından Favoriler bağlantısı kaldırıldı: favoriler Daha fazla menüsünden açılır.',
    ],
  },
  {
    v: '0.87.4', date: '2026-11-08',
    notes: [
      'Telefonda varış kutusuna dokununca sayfanın yakınlaşıp ekrandan taşması düzeltildi: dokunmatik ekranda yazı alanları 16 px.',
    ],
  },
  {
    v: '0.87.3', date: '2026-11-08',
    notes: [
      'Ekran karartma (bekleme/standby benzeri siyah ekran) tamamen kaldırıldı: otomatik karartma, ay simgeli elle karartma düğmesi ve ilgili ayarlar yok. Navigasyonda ekran açık kalır.',
    ],
  },
  {
    v: '0.87.2', date: '2026-11-08',
    notes: [
      'Navigasyonda ekranı otomatik karartma artık varsayılan olarak kapalı: hareketsizlikten sonra bekleme (standby) benzeri siyah ekran kendiliğinden açılmaz. Ayarlar içinden yeniden açılabilir, elle karartma düğmesi aynen çalışır.',
    ],
  },
  {
    v: '0.87.1', date: '2026-11-08',
    notes: [
      'Haritada başlangıç ve varış işaretlerinde A/B harfleri kalktı: başlangıç beyaz nokta, varış bayrak simgesi.',
      'Rota sayfasında Rotayı Planla ve Navigasyonu başlat adımları tek Git düğmesinde birleşti: dokununca rota planlanır ve navigasyon başlar (başlangıç seçilmediyse şu anki konumdan). Navigasyon sürerken aynı varış için düğme durdurur.',
    ],
  },
  {
    v: '0.87.0', date: '2026-11-08',
    notes: [
      'Yeni görünüm: koyu arayüz, ince çizgi simgeler, geniş harita; alt menüde Harita, İstasyonlar ve Daha fazla. Favoriler Daha fazla ve İstasyonlar içinde.',
      'Üst panel manevra ve şarj önerisini tek kartta gösterir; az kullanılan harita düğmeleri üç nokta menüsünde, durum rozetleri başlıktaki menüde.',
      'Pil ve menzil tek düğmede: dokununca elle ayar penceresi açılır. Pil bilgisi yoksa %80 kullanılır ve Varsayılan yazar; son değer bu cihazda saklanır, kamera kapanınca korunur.',
    ],
  },
  {
    v: '0.86.0', date: '2026-11-08',
    notes: [
      'Üst navigasyon paneli sadeleşti: büyük ok ve mesafe, kısa komut ve yol adı; kalan yol ve varış saati alt çubukta.',
      'Şarj önerileri ayrı kahverengi kutu yerine aynı üst panelin içinde; satırlar açılır kapanır, Git düğmesi hep görünür. Navigasyon yokken de panel yalnızca şarj önerisini gösterir.',
      'Sesli yönlendirme yalnızca kısa manevra komutunu söyler; istasyon listesi, fiyat ve varış bilgisi okunmaz.',
    ],
  },
  {
    v: '0.85.3', date: '2026-11-08',
    notes: [
      'Sol kenardaki dikey pil ve menzil çubuğu artık navigasyon başlamadan da harita ekranında görünür.',
    ],
  },
  {
    v: '0.85.2', date: '2026-11-07',
    notes: [
      'Android paket adı com.evroutefinder.app oldu (Google Play yüklemesi için) ve davet bağlantısı evroutefinder://invite şemasını da kabul eder; eski evcopilot:// bağlantıları çalışmaya devam eder.',
    ],
  },
  {
    v: '0.85.1', date: '2026-11-06',
    notes: [
      'Şarj markaları artık keşfediliyor: rota planı ve istasyon verisinde görülen, sabit listede (Trugo, ZES, Eşarj...) olmayan işletmeci adları marka olarak listeye eklenir (Diğer fiyatıyla). Marka çiplerinde seçilebilir, fiyat ve kW tablosundan düzeltilir, istenmeyen marka çarpıyla silinir.',
    ],
  },
  {
    v: '0.85.0', date: '2026-11-06',
    notes: [
      'Araç listesine 13 yeni model eklendi: Kia EV2, Renault Twingo, Citroën ë-C5 Aircross, Peugeot e-5008, Zeekr 7GT, BYD Atto 2, Leapmotor B10, Opel Grandland, Volvo EX60, Mercedes CLA, Mazda 6e, Xpeng P7+ ve yeni BMW iX3 (toplam 61 araç). Değerler tahmindir, Araç ve tüketim bölümünden düzeltilebilir.',
      'Araç ve tüketim bölümünde seçili aracın WLTP menzili ve (varsa) test edilen gerçek menzili görünür.',
    ],
  },
  {
    v: '0.84.8', date: '2026-11-06',
    notes: [
      'Başlıkta sayfa açılırken geçici olarak sabit Togg T10X V2 LR yazısı görünmüyor; yalnızca kullanıcının seçili aracı (marka ve model) gösteriliyor.',
    ],
  },
  {
    v: '0.84.7', date: '2026-11-05',
    notes: [
      'Menzil sekmesine k çarpanını sıfırla düğmesi eklendi: eskiden yanlış öğrenilmiş düzeltme çarpanı (örn. 1,78) menzili ve planı olduğundan çok kısa gösteriyordu; sıfırlayınca model varsayımına (1,00) dönülür.',
    ],
  },
  {
    v: '0.84.6', date: '2026-11-05',
    notes: [
      'Menzil sekmesine Toplam menzil hesabı satırı eklendi: pil sürgüsü altındaki menzil rota profiline mi düz zemine mi göre hesaplandı, ima ettiği ortalama tüketim ve k çarpanı görünür (menzil beklenenden kısa ya da uzunsa nedenini göstermek için).',
    ],
  },
  {
    v: '0.84.5', date: '2026-11-04',
    notes: [
      'DÜZELTME: Pil sürgüsü altındaki toplam menzil artık planlı rotanın eğimini hesaba katıyor (uzun tırmanışta kısalır, inişte uzar); rota bitince ya da rota yokken düz zemin tüketimiyle devam ediyor, böylece kısa bir iniş menzili şişirmiyor.',
    ],
  },
  {
    v: '0.84.4', date: '2026-11-04',
    notes: [
      'DÜZELTME: Pil sürgüsü altındaki menzil kısa bir inişte (yerel eğim) 1000 km gibi şişiyordu: eğim sonsuza dek sürüyormuş gibi hesaplanıyordu. Rota dışı menzil, toplam menzil ve yakın istasyonlara varış pili artık düz zemin tüketimiyle hesaplanıyor.',
    ],
  },
  {
    v: '0.84.3', date: '2026-11-04',
    notes: [
      'DEĞİŞTİ: Navigasyondaki pil sürgüsünün altındaki menzil artık mevcut pille %0a kadar toplam menzili gösteriyor (eskiden eşik piline kadar menzildi; eşik pile eşitse 0 km yazıyordu). Eşik piline kadar menzil Menzil sekmesinde ve menzil kutusunun ipucunda.',
    ],
  },
  {
    v: '0.84.2', date: '2026-11-04',
    notes: [
      'DÜZELTME: Kamera pil okuması, kamera rakamı aşırı pozlayıp etrafında ışıma yaptığında (koyu ortamda parlak ekran) rakamı okuyamıyordu. Okunamazsa ya da güven düşükse artık rakamın yalnızca en parlak çekirdeğini ayıran ek yöntemler sırayla deneniyor.',
    ],
  },
  {
    v: '0.84.1', date: '2026-11-04',
    notes: [
      'DÜZELTME: Kamera pil okuması açık renkli zeminde (gündüz yansıması, açık gri kutuda beyaz rakam) rakamları siliyordu ve okuyamıyordu. Eşik ve yazı rengi artık her görüntüden otomatik bulunuyor; eşik sürgüsü bu otomatik değere kaydırma olarak çalışır.',
    ],
  },
  {
    v: '0.84.0', date: '2026-11-04',
    notes: [
      'YENİ: Başkasının istasyon fotoğrafını Bildir ile bildirebilirsin; bildirilen fotoğraf hemen herkesten gizlenir ve yönetici inceler (geri yükler ya da siler). Kendi fotoğrafların yeşil çerçeveli görünür; açıp Sil ile silebilirsin.',
      'GÜVENLİK: Android uygulaması artık telefon yedeğine ve cihaz aktarımına dahil edilmiyor (oturum belirteci yedeğe girmez; sonraki APK ile).',
    ],
  },
  {
    v: '0.83.0', date: '2026-11-04',
    notes: [
      'DEĞİŞTİ: Uygulamanın adı EV Route Finder oldu (arayüz, 11 dil, kurulum simgesi adı, davet e-postası ve sayfaları, yönetim ekranı). Android uygulama adı sonraki APK ile değişir.',
    ],
  },
  {
    v: '0.82.3', date: '2026-11-03',
    notes: [
      'YENİ: Sunucuya kısa süreli ulaşılamazsa istasyon araması hemen pes etmiyor; 4 sn arayla birkaç kez yeniden deniyor.',
    ],
  },
  {
    v: '0.82.2', date: '2026-11-03',
    notes: [
      'DÜZELTİLDİ: Kamera kapalıyken ya da pili şu an okuyamıyorken (okunamadı, reddedildi) pil sürgüleri ve + / − düğmeleri artık serbest. Kamera pili sorunsuz ve canlı okuyorken değer yine kilitli kalır.',
    ],
  },
  {
    v: '0.82.1', date: '2026-11-03',
    notes: [
      'DÜZELTİLDİ: Pil bilinmiyorken rota planlanınca "Pil okunamadı" uyarısı çıkıyordu ve navigasyon ekranında pil boş görünüyordu. Artık Mevcut pil sürgüsünün gösterdiği %80 elle girilmiş sayılır; plan, navigasyon ekranı ve sürgü aynı değeri kullanır. Kamera pili canlı okuyorsa kalibrasyondaki + ve − düğmeleri de kilitlenir.',
    ],
  },
  {
    v: '0.82.0', date: '2026-11-03',
    notes: [
      'YENİ: Premium için yol hız limiti artık HERE verisinden (güncel, şehir içi dahil) alınıyor; HERE bilmiyorsa Mapbox, o da bilmiyorsa OpenStreetMap kullanılır, hiçbiri yoksa tahmin yapılmaz. Limit kaynağı durum satırında görünür.',
    ],
  },
  {
    v: '0.81.0', date: '2026-11-03',
    notes: [
      'YENİ: Navigasyonda 3B/2B düğmesi. 3B açıkken harita eğilir ve binalar yüksekliğiyle çizilir; 2B görünümde düz harita. Navigasyon artık kuzey-yukarı kipte de varsayılan olarak eğik (3B) açılır; düz görünüm için 2B düğmesine dokun. Binalar, kullanıcıya atanan harita sağlayıcısından gelir (OpenFreeMap, Mapbox, Google).',
    ],
  },
  {
    v: '0.80.0', date: '2026-11-03',
    notes: [
      'YENİ: Premium için yönetici seçimli harita sağlayıcısına Google Haritalar seçeneği eklendi. Anahtar yoksa, reddedilirse ya da yüklenemezse harita kendiliğinden OpenFreeMap haritasına döner.',
    ],
  },
  {
    v: '0.79.0', date: '2026-11-03',
    notes: [
      'YENİ: Premium kullanıcılar için yönetici seçimli harita sağlayıcısı (OpenFreeMap / Mapbox). Yönetici, yönetim ekranından hangi haritanın kullanılacağını seçer; seçilen harita açılamazsa uygulama kendiliğinden OpenFreeMap haritasına döner. Google seçeneği sonraki sürümde.',
    ],
  },
  {
    v: '0.78.2', date: '2026-11-03',
    notes: [
      'DÜZELTİLDİ: Şarj planı kartındaki "En az şarj gücü (kW)" filtresi dar ekranda sığmıyordu; başlık artık üstte, düğmeler altta tam genişlikte.',
    ],
  },
  {
    v: '0.78.1', date: '2026-11-03',
    notes: [
      'DEĞİŞTİ: Şarj markası tercihi artık kesin filtre değil, öncelik. Rota planı önce seçtiğin markaları kullanır; şarj yetmezse (seçili markada yeterli istasyon yoksa) gerektiği kadar başka marka da plana girer ve listede "tercih dışı" etiketiyle görünür. Tercih edilen markalar istasyon listesinde önce gelir; haritada plandaki duraklar tercih dışı olsa da çizilir. DÜZELTİLDİ: Marka düğmeleri ekrana sığmıyordu, artık alt satıra sarılıyor.',
    ],
  },
  {
    v: '0.78.0', date: '2026-11-02',
    notes: [
      'YENİ: İstasyonlar sekmesinde "Şarj markası" tercihi. Trugo, ZES, Eşarj, Astor, Voltrun, Sharz.net ve Tesla arasından bir ya da birkaçını seç; plan, istasyon listesi, harita ve "Yakınımdaki istasyonlar" yalnızca seçtiğin markaları kullanır (hiçbiri seçili değilse hepsi). Seçim kaydedilir ve hesabınla eşitlenir. YENİ: Tesla Supercharger istasyonları. Togg gibi diğer markalara açık ve CCS2 soketli Supercharger yerleri (Türkiye\u0027de 38, Avrupa genelinde 1600+) sunucu üzerinden supercharge.info topluluk verisinden okunur; Tesla uygulaması gerekir. Tesla fiyatı diğer markalar tarifesi olarak 13 TL/kWh varsayıldı (haber kaynaklı, istasyona göre değişebilir); operatör tablosundan düzenleyebilirsin. Tesla istasyonları için hesapla giriş gerekir. Sunucu güncellemesi gerekir.',
    ],
  },
  {
    v: '0.77.0', date: '2026-11-02',
    notes: [
      'YENİ: İstasyon kartında topluluk bilgisi. 1-5 puan (aynı yıldıza tekrar dokunmak puanı geri alır), çevredeki olanaklar (AVM, tuvalet, restoran, kafe, market, mescit; dokunarak işaretlenir, sayı gösterilir) ve fotoğraflar (kameradan çek ya da galeriden seç; cihazda 1280 px JPEG\u0027e küçültülür, konum bilgisi atılır; kendi fotoğrafını silebilirsin). KALDIRILDI: Dolu / Boş bildirim düğmeleri. Puan, olanak ve fotoğraf için hesapla giriş gerekir. Sunucu tarafı da güncellendi.',
    ],
  },
  {
    v: '0.76.0', date: '2026-11-02',
    notes: [
      'DEĞİŞTİ: Türkiye dışındaki şarj istasyonlarında tahmini TL fiyat artık gösterilmez (liste fiyatı yalnızca Türkiye için geçerliydi; Yunanistan ve Avrupa ülkelerinde yanıltıcı TL rakamı çıkıyordu). İstasyon kartı Fiyat bilgisi yok der; plan, istasyon listesi, harita ipucu ve sesli uyarı bu istasyonlar için TL yazmaz. Gerçek canlı fiyat (şimdilik Hollanda, NDW) varsa € olarak yine gösterilir. Yurt dışı duraklarda plan fiyatı hesaba katmaz: Ekonomik mod orada süreye göre seçer.',
    ],
  },
  {
    v: '0.75.2', date: '2026-11-02',
    notes: [
      'DEĞİŞTİ: Plan modu adları kısaldı: Hızlı, Ekonomik, Optimum (önceden En Hızlı / En Ekonomik). Aynı üç seçenek artık Şarj planı kartında da, başlığın altında seçilebilir; İstasyonlar sekmesindekiyle ortaktır, birinde değişen diğerinde de değişir ve plan yeniden hesaplanır.',
    ],
  },
  {
    v: '0.75.1', date: '2026-11-02',
    notes: [
      'DEĞİŞTİ: En az şarj gücü filtresinde varsayılan 120 kW oldu ve 120 seçeneği eklendi (AC, 60, 100, 120, 150). Filtre değişince şarj planı baştan hesaplanır (yalnızca liste süzülmez). Seçilen güçte uygun zincir kurulamazsa plan metni filtreyi düşürmeyi önerir.',
    ],
  },
  {
    v: '0.75.0', date: '2026-11-02',
    notes: [
      'YENİ: Şarj planı kartında "En az şarj gücü" filtresi: AC (hepsi), 60, 100 ve 150 kW. Seçilen güç ve üstündeki istasyonlar plana girer, altındakiler plandan ve haritadan çıkar; plan ağ çağrısı olmadan hemen yeniden hesaplanır. 60 ve üstü seçiliyken yavaş AC yedek adaylar kullanılmaz.',
    ],
  },
  {
    v: '0.74.2', date: '2026-11-02',
    notes: [
      'YENİ: Plan 6 saniyeden uzun sürerse ekranda hangi aşamada ne kadar zaman gittiği gösterilir (rota, rakım/hava, istasyon, hesap). Yavaşlığın kaynağını bulmak için; süreler her planda tarayıcı konsoluna da yazılır.',
    ],
  },
  {
    v: '0.74.1', date: '2026-11-02',
    notes: [
      'DÜZELTME: HERE anahtarı iptal edilir, geçersiz olur ya da HERE hiç yanıt vermezse istasyon araması artık Mapbox veya Overpass kaynağına düşer. Önceden bu durumda plan istasyonsuz kalabiliyordu.',
    ],
  },
  {
    v: '0.74.0', date: '2026-11-02',
    notes: [
      'YENİ: HERE veri kaynağı (sunucuda). Şarj istasyonları önce HERE Search ile alınır: güç (kW) ve soket türü (CCS/CHAdeMO/Type 2) doğrudan gelir, Mapbox hakkı harcanmaz. HERE kullanılamazsa Mapbox, o da olmazsa Overpass devreye girer; istasyonsuz kesimler Overpass ile tamamlanır.',
      'YENİ: Canlı doluluk (Premium) için HERE bağlantı durumu eklendi (müsait / dolu / arızalı). Yalnızca beslemesi canlı istasyonlarda gösterilir; durumu bilinmeyen yuva varsa dolu denmez. Fiyat HERE tarafında yok.',
    ],
  },
  {
    v: '0.73.16', date: '2026-11-02',
    notes: [
      'Uygulama açılınca GPS açıksa harita ilk gerçek konumda bir kez konuma odaklanır (rota, navigasyon ya da Test Modu varsa görünüm bozulmaz).',
    ],
  },
  {
    v: '0.73.15', date: '2026-11-02',
    notes: [
      'GPS artık varsayılan olarak açık gelir (üst çubuktaki düğmeyle kapatılırsa kapalı kalır; izin ilk açılışta sorulur, reddedilirse yeniden denenmez).',
      'Test Modu (sürüş simülasyonu) sırasında otomatik Konumum A noktası konmaz; Test Modu açılırken plan yoksa var olan otomatik A kaldırılır, başlangıcı sen seçersin. Test Modu kapanınca A gerçek konuma döner.',
    ],
  },
  {
    v: '0.73.14', date: '2026-11-02',
    notes: [
      'DÜZELTME: Planlı şarj istasyonu dolu çıkınca Plan güncelleniyor diyordu ama plan değişmiyordu (planlayıcı dolu istasyona yalnızca 20 dk bekleme eklediği için aynı istasyonu seçmeye devam ediyordu). Artık taze bilgiye göre dolu olan yakın istasyonlar önce hiç aday sayılmaz, plan başka istasyonla yeniden kurulur; başka uygun zincir yoksa dolu olan bekleme süresiyle yine kullanılır. Sesli uyarı da gerçek sonucu söyler: Plan güncellendi ya da Başka uygun istasyon yok, plan değişmedi.',
    ],
  },
  {
    v: '0.73.13', date: '2026-11-02',
    notes: [
      'Varış yazıp rota planlayınca tarayıcının Şifreyi kaydet penceresi çıkıyordu: sayfadaki ABRP User Token ve API Key alanları şifre türündeydi. Artık normal metin alanı (içerik yine noktalı görünür), tarayıcı şifre kaydetmeyi önermez.',
    ],
  },
  {
    v: '0.73.12', date: '2026-11-02',
    notes: [
      'Haritayı gizle (veri tasarrufu) anahtarı tamamen kaldırıldı: harita her zaman açılır (tarayıcı Veri Tasarrufu açıkken haritanın kendiliğinden gizlenmesi de bitti). Eski kayıtlı gizle seçimi temizlenir.',
    ],
  },
  {
    v: '0.73.11', date: '2026-11-02',
    notes: [
      'Rota sayfasından Yerleri düzenle düğmesi kaldırıldı (Favoriler alt menüde). Favoriler sayfasında her yer için Haritadan seç düğmesi eklendi: haritaya dokunulan nokta Ev, İş ya da favori olarak kaydedilir (favori adı boşsa adres adı önerilir).',
      'ABRP gönderim aralığı seçimi kaldırıldı, aralık sabit 60 saniye (eski kayıtlı seçim yok sayılır).',
    ],
  },
  {
    v: '0.73.10', date: '2026-11-02',
    notes: [
      'ABRP (canlı telemetri köprüsü) de yalnızca Premium hesaplarda: Premium olmayan kullanıcıda menüde görünmez ve ABRP ye veri gönderimi durur (ayarlar silinmez, Premium dönünce kaldığı yerden sürer).',
    ],
  },
  {
    v: '0.73.9', date: '2026-11-02',
    notes: [
      'Kamera (pil okuma) ve Test (Test Modu, sürüş simülasyonu) yalnızca Premium hesaplarda kullanılır; Premium olmayan ve girişsiz kullanıcıların Daha Fazla menüsünde görünmez. Premium biterse açık kamera durur ve Test Modu kapanır.',
    ],
  },
  {
    v: '0.73.8', date: '2026-11-02',
    notes: [
      'DÜZELTME: Rota sayfasında şarj durakları görünmüyordu ve plan kartı yenilenmiyordu (v0.73.4 çeviri düzeltmesi bir değişkeni gölgelemişti); düzeltildi.',
      'Mapbox bir ülkede istasyon vermezse (ör. Yunanistan) ya da hakkı dolarsa plan artık durmaz: rotada istasyonsuz 60 km üstü kesimler Overpass ten tamamlanır, Mapbox hatası tüm planı bozmaz. Sunucu Mapbox arama isteklerini aylık sayar (varsayılan 4800 sınır) ve sınırda 402 döner; uygulama Overpass ve OpenChargeMap e geçer. Sayaç yönetim panelinde görünür.',
    ],
  },
  {
    v: '0.73.7', date: '2026-11-02',
    notes: [
      'Rota planlama hızlandı: istasyon arama parçaları 120 km yerine 60 km, aynı anda 3 parça ve farklı Overpass aynalarından paralel sorgulanır (önceden sırayla ve her biri 30-40 sn sürüyordu). Sunucuda her Overpass aynası ayrı şeritte paralel çalışır. Mapbox aramaları daha sık (6-7 istek/sn, 3 eşzamanlı) gider; sunucunun dakikalık istek sınırı 120 den 600 e çıkarıldı (uzun rotada kendi sınırına takılıp bekliyordu).',
    ],
  },
  {
    v: '0.73.6', date: '2026-11-02',
    notes: [
      'Google girişinde 4 haneli kod artık tarayıcı açılmadan önce büyük yazıyla gösterilir (önceden tarayıcı hemen açılıp kod görünmez oluyordu). Kodu görüp Tarayıcıda devam et düğmesine basınca tarayıcı açılır; bekleme sırasında kod ekranda kalır.',
    ],
  },
  {
    v: '0.73.5', date: '2026-11-02',
    notes: [
      'Giriş güvenliği: Google ile girişte uygulama ekranda 4 haneli bir kod gösterir; tarayıcıda bu kod girilince giriş tamamlanır. Başkasının gönderdiği bir giriş bağlantısını habersizce onaylayıp oturumu ona kaptırmak artık mümkün değil. 5 yanlış kod girişi iptal eder.',
    ],
  },
  {
    v: '0.73.4', date: '2026-11-02',
    notes: [
      'Genel denetim: yabancı dilde bazı satırlar Türkçe kalıyordu (Yakınımdaki istasyonlar satırları, rotada durak ve rüzgâr satırları, İstasyon sekmesi açıklaması, şarj zinciri kurulamadı açıklaması, Aday etiketi); hepsi 11 dilde çevrildi.',
      'Sunucu sağlamlaştırıldı: geçersiz adresle sunucuyu düşürme, disk yazma hatasında çökme, bekleyen girişlerle girişi kilitleme, aşırı büyük Overpass sorgusu ve önbellek şişmesi, günlüğe davet kodu yazılması gibi açıklar kapatıldı.',
    ],
  },
  {
    v: '0.73.3', date: '2026-11-02',
    notes: [
      'Premium Google modu (Google haritası, Google tarayıcı anahtarı) kaldırıldı. Harita yeniden yalnızca OpenStreetMap; istasyon doluluğu daha önceki gibi sunucudan gelir (Hollanda NDW, topluluk ve sunucudaki Google Places).',
    ],
  },
  {
    v: '0.73.2', date: '2026-11-02',
    notes: [
      'Sürüş simülasyonunda pil kritik seviyeye düşüp rota bir istasyon üzerinden yeniden kurulunca: A başlangıç noktası artık güncellenmez ve simülasyon durmaz, yeni rota kurulunca kaldığı yerden devam eder (önceden oynatma duruyordu).',
    ],
  },
  {
    v: '0.73.1', date: '2026-11-02',
    notes: [
      'Test Modu açıkken soldaki pil ve menzil çubuğu (şarj oranı ve kaç km gidilebileceği) navigasyon başlamasa da haritada görünür.',
    ],
  },
  {
    v: '0.73.0', date: '2026-11-02',
    notes: [
      'Premium Google modu (deneysel): Daha Fazla > Hesap içinde Google modu anahtarı. Açıkken harita Google Haritalar olur, istasyon kartında Google ayrıntıları (Places UI Kit: puan, fotoğraf, saatler) açılır ve Google doluluk verisi haritada da görünür. Sunucuda Google tarayıcı anahtarı tanımlı olmalıdır; anahtar yalnızca Premium üyelere verilir ve harita açılışı günlük sınırlıdır. Google haritası açılamazsa OpenStreetMap haritasına dönülür.',
      'Rota sayfasında Mevcut pil, kameradan okunamıyorsa varsayılan olarak %80 gösterir (plan zaten %80 varsayıyordu).',
    ],
  },
  {
    v: '0.72.8', date: '2026-11-02',
    notes: [
      'Giriş yapmamış her cihaza rastgele bir cihaz kimliği verilir; sunucu anonim cihazları sayar ve istek sınırını cihaza da uygular. Giriş yapınca bu kimlik hesabına bağlanır (yönetim panelinde Cihazlar sekmesi). Kimlikte kişisel veri ya da IP adresi yoktur.',
    ],
  },
  {
    v: '0.72.7', date: '2026-11-02',
    notes: [
      'Test Modu simülasyon hızına 2x, 4x ve 8x seçenekleri eklendi (1x ile 10x arası).',
      'APK: sesli uyarılar yeniden çalışır. Güncel Android WebView tarayıcı konuşma motorunu (speechSynthesis) sunmuyor, bu yüzden APK içinde sesler kayboldu. Uygulama artık APK içinde Android yerel metin okuma motorunu (TextToSpeech eklentisi) kullanır; tarayıcıda eskisi gibi çalışır. Yeni APK kurmak gerekir (sunucudaki /app sayfası).',
    ],
  },
  {
    v: '0.72.6', date: '2026-11-02',
    notes: [
      'Sesli uyarılar için tanı: Navigasyon kartına Sesi dene düğmesi eklendi; konuşma motoru gerçekten başlıyor mu, kaç ses var, başlamıyorsa nedeni ne gösterir. Konuşma reddedilirse artık sessizce kaybolmaz, ekranda Ses çıkmadı uyarısı çıkar (dakikada en çok bir kez). Kesme gerektiren yönlendirmelerde konuşma, Chrome da iptalin hemen ardından gelen konuşmayı yutmasın diye kısa bekleyerek başlatılır.',
    ],
  },
  {
    v: '0.72.5', date: '2026-11-01',
    notes: [
      'Doluluk bilgisi yalnızca verisi gelen istasyonda gösterilir: Yakınımdaki istasyonlar listesindeki doluluk bilgisi yok yazısı ve harita istasyon kartındaki veri yok satırı kaldırıldı; veri gelmeyen istasyonda doluluk bölümü hiç çıkmaz. Veri kaynakları değişmedi (Premium: Google Places, Hollanda NDW, topluluk).',
    ],
  },
  {
    v: '0.72.4', date: '2026-11-01',
    notes: [
      'Sürüş simülasyonunda (Test Modu) rota başlangıcı A artık araçla birlikte sürekli güncellenmez: simülasyon, navigasyon ya da kurulu plan varken A sabit kalır, rota durumu her adımda yeniden tetiklenmez. Test Modu açılınca (plan yoksa) A bir kez simülasyon konumuna alınır.',
    ],
  },
  {
    v: '0.72.3', date: '2026-11-01',
    notes: [
      'Yakınımdaki istasyonlar: arama yarıçapına 1 km ve 5 km seçenekleri eklendi (10, 25, 50 km ile birlikte). Pil kritikken çevrede istasyon bulunamazsa yarıçap yine otomatik 50 km e çıkar.',
    ],
  },
  {
    v: '0.72.2', date: '2026-11-01',
    notes: [
      'Veri kaynakları kartı sadeleşti: adı Veri ve önbellek oldu; OpenStreetMap atfı, hangi servisin neyi sağladığı ve Önbelleği temizle düğmesi duruyor. OpenChargeMap ve Mapbox anahtar alanları Kendi anahtarlarım (isteğe bağlı) başlıklı kapalı bir bölüme taşındı ve hesapla giriş yapanlarda gizlenir, çünkü anahtarları sunucu sağlıyor. Girişsiz kullanıcılar kendi anahtarını yine girebilir. Eski, yanlış hale gelen canlı trafik ve doluluk yok açıklaması kaldırıldı.',
    ],
  },
  {
    v: '0.72.1', date: '2026-11-01',
    notes: [
      'Google doluluk verisi Google kurallarına uygun gösterilir: Google kaynaklı doluluk satırının sonunda Google Maps etiketi çıkar, harita iğnesi kartında Google verisi gösterilmez (yalnızca listelerde), sunucu Google sonuçlarını saklamaz. Google Places EV kWh fiyatı vermediği için fiyat NDW, kullanıcı bildirimleri ve işletmeci tablosundan gelmeye devam eder.',
    ],
  },
  {
    v: '0.72.0', date: '2026-11-01',
    notes: [
      'Operatör fiyatları güncellendi (01.11.2026 liste tarifesi, kaynak arabamsarj.com.tr): DC hızlı şarj ZES 16,49, Trugo 14,98, Astor 13,99, Eşarj 13,50, Sharz 12,99, Voltrun 12,90 TL/kWh; eski değerler 9-10 TL civarındaydı. Yavaş AC istasyonlarda artık işletmecinin AC tarifesi kullanılır (yaklaşık 9,5-10 TL). Tabloda fiyatı kendin değiştirmediysen yeni fiyata otomatik geçer; değiştirdiysen senin değerin korunur. Planlama maliyeti, istasyon listesi ve şarj oturumu tahmini bu fiyatlarla hesaplanır. Canlı (Hollanda NDW) ve kullanıcı bildirimli fiyat varsa yine onlar öncelikli gösterilir.',
    ],
  },
  {
    v: '0.71.1', date: '2026-11-01',
    notes: [
      'Konumum düğmesi asıl nedeni düzeltildi: düğme önce görünümü sıfırlıyor ve bunu konuma gitme animasyonundan sonra yaptığı için animasyonu iptal ediyordu; GPS açılıyor ama harita kaymıyor, yakınlaşmıyordu. Artık önce görünüm sıfırlanır, sonra konuma animasyonla gidilir ve yakınlaşılır.',
    ],
  },
  {
    v: '0.71.0', date: '2026-11-01',
    notes: [
      'Kritik pilde Premium: pil eşiğin altına inince en yakın DC istasyonların canlı doluluğu ve fiyatı sorulur (dakikada bir yenilenir), tamamen dolu ya da arızalı olanlar önerilerden elenir, kalanların boş soket sayısı, canlı ya da bildirilen kWh fiyatı uyarıda ve listede gösterilir. Kaç istasyonun elendiği yazılır; hepsi doluysa en yakınlar yine listelenir. Sesli uyarı boş soket sayısını ve canlı fiyatı da söyler.',
      'Premium için canlı veri daha güncel: planlı duraklar 5 yerine 2 dakikada bir sorulur (pil %20 altında dakikada bir ve ilk 3 durak); istasyon listesi her yenilendiğinde ve sürüş sırasında yakındaki istasyonların doluluk ve fiyatı da yenilenir. Doluluk bilgisi liste yenilense de kaybolmaz.',
    ],
  },
  {
    v: '0.70.1', date: '2026-11-01',
    notes: [
      'Konumum düğmesi: GPS açılınca haritanın konuma gitmemesi düzeltildi. Telefonda ilk GPS konumu 10-40 saniye sürebiliyor ve düğme bu bekleme sırasında hata alınca beklemeyi bırakıyordu. Artık önce hızlı kaba konum (şebeke) alınır ve harita hemen oraya gider, GPS gelince hassaslaşır; GPS gecikirse de ilk konum geldiğinde harita yine ortalanır ve yakınlaşır (en çok 90 saniye beklenir). Kaba konumda (1,5 km ve üstü belirsiz) çok yakınlaşmaz.',
    ],
  },
  {
    v: '0.70.0', date: '2026-11-01',
    notes: [
      'Premium hesapta üst çubuktaki uygulama adı (EV Co-Pilot) kırmızı görünür; ücretsiz hesapta yeşil kalır. Yönetici hesapları da Premium sayıldığı için kırmızıdır. Plan açılışta yerel kayıttan okunur, sonra sunucuyla doğrulanır.',
    ],
  },
  {
    v: '0.69.0', date: '2026-11-01',
    notes: [
      'Harita istasyon kartı: haritada bir istasyon iğnesine dokununca kart açılır: ad, operatör, güç, tahmini fiyat, canlı ya da bildirilen kWh fiyatı, canlı doluluk, şu an şarj edenler ve son Dolu/Boş bildirimi. Kartta Git, Haritalar, Dolu, Boş ve Fiyat bildir düğmeleri var (bildirimler için hesapla giriş gerekir; canlı doluluk ve fiyat Premium).',
      'Topluluk doluluğu (resmi veri olmayan yerler, ör. Türkiye): şarj etmeye başlayınca ve bitirince bilinen herkese açık istasyonda anonim olarak bildirilir (ev ya da iş gibi kayıtsız yerler paylaşılmaz); Hesap kartındaki anahtardan kapatılır. Aynı yerde taze bir Dolu bildirimi varsa plan o durağa bekleme süresi ekler. Hesap silinince bildirimlerin de silinir.',
      'Konumum düğmesi düzeltildi: konum yoksa ya da izin reddedildiyse artık konum izni sorusunu dokunuşta açar, hata nedenini söyler (izin kapalıysa Android Ayarlar yolunu gösterir) ve ilk konum gelince haritayı ortalar.',
    ],
  },
  {
    v: '0.68.0', date: '2026-11-01',
    notes: [
      'Fiyat defteri: kullanıcıların bildirdiği kWh fiyatları sunucuda tutulur. Menzil sekmesindeki Şarj oturumları listesinde (hesapla girişte) her oturumda Fiyat bildir düğmesi var: o istasyonun kWh fiyatını yazarsın, oturumun maliyeti buna göre güncellenir ve fiyat defterine girer. Aynı yerin (yaklaşık 100 m) son 5 bildiriminin medyanı, canlı fiyat kaynağı olmayan istasyonlarda planda kWh fiyatı (bildirilen) olarak gösterilir. Aynı kişi aynı yer için günde bir kez bildirebilir.',
      'Google doluluk sorguları yalnızca pil yüzde 25 altındayken yapılır; Hollanda (NDW) ücretsiz olduğu için her zaman çalışır. Ölçüm: Ankara, İstanbul ve İzmir de 30 istasyonda Google soket sayısı ve doluluk vermedi. Google bir bölgede üst üste 3 kez veri vermezse o bölge 7 gün atlanır; böylece ücretli çağrı boşa gitmez.',
    ],
  },
  {
    v: '0.67.0', date: '2026-11-01',
    notes: [
      'Premium üyelik altyapısı: canlı istasyon doluluğu ve canlı kWh fiyatı yalnızca Premium hesaplara açılır. Ücretsiz hesapta Rota sayfasında Canlı doluluk ve kWh fiyatı Premium üyelere özeldir ipucu çıkar; Daha Fazla > Hesap kartında Plan: Ücretsiz ya da Plan: Premium (bitiş tarihi) görünür. Yönetici hesapları her zaman Premium sayılır.',
      'Yönetici için: node server/premium.mjs ornek@gmail.com 30 komutu 30 gün Premium verir (süre varsa üstüne eklenir), 0 kaldırır. Sunucuda PREMIUM_REQUIRED=0 yazılırsa herkes Premium sayılır (deneme). Ödeme sağlayıcısı henüz bağlı değil; abonelik webhook u aynı yetkilendirmeyi kullanacak.',
    ],
  },
  {
    v: '0.66.0', date: '2026-11-01',
    notes: [
      'Canlı istasyon doluluğu ve fiyatı: sunucu (hesapla giriş gerekir) planlı durakların dolu/boş soket sayısını ve kWh fiyatını getirir. Hollanda için NDW DOT-NL açık verisi kullanılır (OCPI 2.2.1 Locations ve Tariffs: soket durumu, tarife elemanları, saat/gün/güç koşulları, KDV dahil kWh fiyatı). Sunucuda Google Places anahtarı varsa diğer ülkelerde (Türkiye dahil) Google doluluğu denenir.',
      'Planlı duraklarda 🟢 7/16 boş · şimdi gibi doluluk satırı ve €0.46/kWh (canlı) fiyatı görünür; ek ücret (oturum başı ya da süre) varsa belirtilir. Durak dolu ya da arızalı çıkarsa plan güncellenir ve sesli söylenir. Her kullanıcı için günlük sorgu kotası vardır; sonuçlar 90 saniye saklanır.',
      'Doluluk etiketleri artık ayrı parçalar olarak yazılır: yabancı dillerde uzun satırların çevirisini bozmaz.',
    ],
  },
  {
    v: '0.65.0', date: '2026-11-01',
    notes: [
      'Yol önü sesli uyarıları: Dik eğim ve hız kamerası eklendi (yağış, trafik ve hız eşiği uyarıları zaten vardı). Navigasyon açıkken ve sesli yönlendirme açıkken çalışır; ekranda üstteki uyarı şeridinde de görünür. Navigasyon kartında Dik eğim uyarısı ve Hız kamerası uyarısı anahtarları var.',
      'Dik eğim: rota profilindeki rakım verisinden hesaplanır (internet gerekmez). 2 km lik dilimlerin ortalama eğimi %5 ve üstü olan iniş ya da yokuş kesimine 0,5-2,2 km kala bir kez uyarır: dik inişte hızı kontrol etmeni, dik yokuşta tüketimin artacağını söyler.',
      'Hız kamerası: OpenStreetMap te highway=speed_camera olarak işaretli sabit kameralar rota boyunca aranır (sonuçlar 7 gün saklanır); kameraya 1 km ve 300 m kala uyarır, limit biliniyorsa onu da söyler. Veri eksik olabilir: mobil kameralar ve işaretlenmemiş kameralar yoktur. Ara sunucu kullanılıyorsa sorgu ondan geçer.',
      'Kaza uyarısı yok: ücretsiz ve güvenilir canlı kaza verisi kaynağı bulunmuyor.',
    ],
  },
  {
    v: '0.64.0', date: '2026-11-01',
    notes: [
      'Daha Fazla > Sürüm kartına çalışma kaynağı satırı eklendi: APK ise APK, tarayıcıysa web ve adres (ör. APK · ozdemirumit.github.io). Güncelle düğmesi yenilenmiyorsa bu satır sebebi gösterir: localhost yazıyorsa eski gömülü APK çalışıyordur ve kendi kendine güncellenemez, APK yeniden kurulmalı.',
    ],
  },
  {
    v: '0.63.0', date: '2026-11-01',
    notes: [
      'Favoriler artık ayrı bir sekme: alt çubukta yıldızlı Favoriler düğmesi. İçinde iki kart var, ikisi de başlığın yanındaki + ve − ile açılıp kapanır (seçimin hatırlanır): Kayıtlı yerler (Ev, İş, F1-F3 ve kaydetme düğmeleri; eskiden Rota sayfasının en altındaydı) ve Son hedefler (tüm liste, tek tek silme, listeyi temizle).',
      'Rota sayfasında yer çipleri ve Son hedefler çipleri hızlı seçim için yerinde kaldı; Yerleri düzenle düğmesi Favoriler sekmesini açar. Kayıtlı olmayan bir çipe dokunmak da Favoriler sekmesini açar.',
    ],
  },
  {
    v: '0.62.0', date: '2026-11-01',
    notes: [
      'Test Modu: Test sekmesinde Oynat a basınca gerçek navigasyon gibi başlar: navigasyon ekranı açılır, yönlendirme kartı, hız ve varış çubuğu, pil çubuğu ve sesli yönlendirme çalışır. Önce rota planlanmış olmalı; yoksa Önce rotayı planla uyarısı çıkar. Test Modunu kapatınca testle açılan navigasyon da kapanır.',
    ],
  },
  {
    v: '0.61.0', date: '2026-11-01',
    notes: [
      'Hesap: Daha Fazla sayfasında Hesap kartı. Davet linkine dokunup Google ile giriş yapınca telefona hiçbir anahtar yazılmaz; Mapbox ve OpenChargeMap sunucudan gelir. Giriş tarayıcıda yapılır, uygulama oturumu kendiliğinden alır. Çok kullanıcılı: her kişinin kendi hesabı, günlük kotası ve verisi vardır. Hesabı sil düğmesi hesabı ve sunucudaki tüm veriyi siler.',
      'Hesapla senkron: ayarlar, favoriler, son hedefler, araç ve tüketim ölçümleri cihazlar arasında eşitlenir (çakışmada son yazan kazanır, ölçümler ve son hedefler birleştirilir). ABRP ve API anahtarları hiçbir zaman eşitlenmez.',
      'Kalıcı geçmiş: yolculuklar (tarih, mesafe, süre, ortalama hız, kWh, kWh/100 km, pil düşüşü, sıcaklık, konumlar) ve yeni şarj oturumları (nerede, hangi istasyon, pil başı ve sonu, kWh, süre, ortalama kW, tahmini maliyet) hesaba bağlı olarak sunucuda saklanır, cihazdan silinse de kalır. Şarj oturumu, kamera pili okurken araç dururken pil yükselince kendiliğinden kaydedilir; Menzil sekmesinde Şarj oturumları listesi var.',
      'Android: evcopilot://invite bağlantısı davet kodunu uygulamaya taşır (Capacitor App eklentisi eklendi). Sunucu tarafı server klasöründe, kurulum ve Google ayarı server/README.md içinde.',
    ],
  },
  {
    v: '0.60.0', date: '2026-11-01',
    notes: [
      'Uygulama açılınca eski rota artık kendiliğinden yüklenmez: harita boş, başlangıç Konumum, varış boş gelir.',
      'Son hedefler: planladığın rotaların varışları (en çok 8) Rota sayfasında Varış kutusunun altında listelenir. Birine dokununca varış olarak doldurulur, Rotayı Planla ile yeniden planlarsın. Her çipte x ile tek tek, Listeyi temizle ile hepsi silinir. Liste yalnızca bu telefonda saklanır.',
    ],
  },
  {
    v: '0.59.0', date: '2026-11-01',
    notes: [
      'İsteğe bağlı ara sunucu: Daha Fazla > Veri kaynakları bölümüne Ara sunucu adresi ve Erişim kodu eklendi. Adres girilirse Mapbox, OpenChargeMap ve Overpass istekleri sunucudan geçer; Mapbox ve OpenChargeMap anahtarları sunucuda durur, telefona yazılmaz. Sunucu Overpass ve arama yanıtlarını ortak önbelleğe alır, Overpass isteklerini sıraya koyar. Adres boşsa uygulama eskisi gibi servislere doğrudan gider; sunucuya ulaşılamazsa Overpass doğrudan, Mapbox yerine Valhalla ve Overpass kullanılır.',
      'Sunucu kodu server klasöründe (Node 18+, bağımlılık yok): erişim kodu, istek sınırı, yanlış koda engel, izinli kökenler, yalnızca sabit yollar. Kurulum, Windows görev betiği ve Cloudflare Tunnel, Tailscale Funnel ya da Caddy ile internete açma adımları server/README.md içinde. Gerçek anahtarlar yalnızca server/.env içinde durur ve repoya girmez.',
    ],
  },
  {
    v: '0.58.0', date: '2026-11-01',
    notes: [
      'Rota sayfasındaki Şarj planında her durağın altına Haritada düğmesi eklendi: dokununca sayfa kapanır ve harita o istasyona gider. Planın altındaki Durakları haritada göster düğmesi kalan tüm durakları ekrana sığdırır. Haritaya gidince araç takibi 15 saniye görünümü bozmaz.',
    ],
  },
  {
    v: '0.57.0', date: '2026-11-01',
    notes: [
      'Dil seçimi: Daha Fazla sayfasında Dil / Language. Varsayılan İngilizce; Türkçe, Deutsch, Français, Italiano, Español, Português, Nederlands, Polski, Română, Ελληνικά ve Български seçilebilir. Seçim telefonda saklanır, değişince sayfa yenilenir. Eskiden Türkçe kullanıyorsan Daha Fazla > Dil / Language bölümünden Türkçeyi seç.',
      'Arayüz metinleri, bildirimler, sesli uyarılar ve navigasyon talimatları seçilen dilde gelir; rota talimatı dili Valhalla ya, yer arama dili Photon ve Nominatim e, konuşma sesi tarayıcıya aktarılır.',
      'Çeviriler yapay zekâyla üretildi ve anadili konuşan biri tarafından henüz gözden geçirilmedi; hatalı bir ifade görürsen haber ver. Sürüm notları (bu pencere) şimdilik yalnızca Türkçedir.',
    ],
  },
  {
    v: '0.56.0', date: '2026-11-01',
    notes: [
      'Rota planlamada başlangıç varsayılan olarak Konumum (araç konumu) gelir, varış boş kalır. Konum 100 m değişince başlangıç güncellenir; kendi başlangıcını seçince (arama, haritadan, çip) güncelleme durur. Temizle yine Konumum a döner. Başlangıç ve varış kutusuna dokununca içi silinir; bir şey seçmeden bırakırsan eski metin geri gelir. Konumumu başlangıç yap ve Temizle artık çerçeveli düğme görünümünde.',
      'Menzil sekmesindeki geçmiş kartına Yolculuklar listesi eklendi (en yeni üstte): her yolculuk için tarih, mesafe (km), sürüş süresi, ortalama hız, harcanan enerji (kWh), kWh/100 km, pil düşüşü ve ölçüm sayısı. Veriler yalnızca kameradan okunan pil düşüşü olan (ölçülen) kısımlardır.',
    ],
  },
  {
    v: '0.55.1', date: '2026-11-01',
    notes: [
      'Sürüm notları penceresi sağ üstteki X ile de kapatılır (içerik kayarken de görünür kalır).',
    ],
  },
  {
    v: '0.55.0', date: '2026-11-01',
    notes: [
      'Navigasyonda akıcı hareket: GPS saniyede bir geldiği için harita ve araç saniyede bir adım atıyordu. Artık araç, son ölçümden hızıyla rota üzerinde kare kare (yaklaşık 30 kare/sn) ilerletilir, yeni GPS ölçümü gelince gösterilen konum ona yumuşakça yaklaşır; harita aracın biraz ilerisine kilitli kalır. Denemede 50 km/s hızda kamera adımı yaklaşık 0,8 m (eskiden saniyede 14 m).',
      'Yön-yukarı döndürme, görünen rotaya ve 150 m ilerideki noktaya göre değil, hemen önündeki yaklaşık 4 m yola göre yapılır; dönüş ve zoom üstel olarak yumuşatılır (kare başına en çok yarım derece). Rota dışındayken, hesaplama sürerken ve haritayı kaydırdığında eski davranış (15 sn kaydırma beklemesi) aynen kalır. Karartma modunda ve uygulama arka plandayken kare döngüsü durur.',
    ],
  },
  {
    v: '0.54.1', date: '2026-11-01',
    notes: [
      'ÖNEMLİ DÜZELTME: v0.52.0 ve sonrasında sürüm dosyası (version.js) içinde kaçışsız bir kesme işareti vardı. Dosya çalışmadığı için sürüm numarası görünmüyordu, ⓘ sürüm notları boştu ve service worker bu dosyayı yükleyemediği için uygulama güncellenmiyordu. Düzeltildi; yayından önce çalışan bir denetim betiği eklendi (npm run check: version.js, sürüm numarası ve tüm .js dosyalarının söz dizimi).',
      'Güncelleme: açılışta, her 20 dakikada ve uygulamaya dönünce yayındaki sürüm denetlenir; yeni sürüm varsa üstte "Güncelle" rozeti çıkar. Daha Fazla sayfasına Sürüm kartı eklendi (sürüm, yayındaki sürüm, Güncellemeyi denetle, Güncelle, Sürüm notları). ⓘ penceresi çalışan sürüm eskiyse bile yayındaki en son notları gösterir. Güncelle düğmesi service worker ve uygulama önbelleğini yenileyip sayfayı yeniden açar.',
      'Navigasyon artık rota planının başından değil, bulunduğun konumdan hedefe doğru başlar: araç planlanan rotanın üzerinde değilse (150 m den uzaksa) başlatırken önce konumundan yeni rota kurulur, durak planı yeni rotaya aktarılır. Rotanın üzerindeyken plan aynen kalır. İstasyona git de bulunduğun konumdan kurulur (zaten böyleydi).',
    ],
  },
  {
    v: '0.54.0', date: '2026-11-01',
    notes: [
      'Pil yüzdesi navigasyonda kendiliğinden düşmesi düzeltildi. Nedenleri: (1) kamera okurken pil çubuğuna yanlışlıkla dokunmak değeri değiştiriyor ve tahmin moduna sokuyordu: artık kamera pili canlı okurken elle ayar kapalı (çubuk ve Rota sürgüsü), çubuk yalnızca başparmağın yakınından tutulunca hareket eder; (2) tahmin ile kamera okuması arasında durum gidip gelebiliyordu (okumaya "lastOkAt" ile bakılıyordu, tahmin onu da güncelliyordu): artık yalnızca gerçek kamera okumasını sayan ayrı bir alan kullanılıyor; (3) kamera çalışırken 90 sn okuyamayınca tahmine geçiliyordu: artık kamera çalışıyorsa 3 dk, kapalıysa 1 dk sonra, ve o zamana kadar son okunan değer sabit kalır.',
      'Menzil artık rotaya göre hesaplanır: planlı rotadaki araç konumundan, önümüzdeki yolun enerji profiline (eğim, hız, rüzgâr, trafik, öğrenilmiş hız düzeltmesi) göre minimum varış pili eşiğine kadar gidilebilecek mesafe; enerji varışa yetiyorsa varışa kalan yol artı kalan enerjiyle düz tüketimle devam eder. Rota yoksa anlık tüketimle. Sol pil çubuğundaki ve Menzil sekmesindeki değer budur.',
      'Yeniden rota: rota, adımlar ve plan hemen kurulur (yaklaşık 1 sn); rakım ve hava arkadan gelip planı sessizce günceller (eskiden hepsi beklenirdi, navigasyon birkaç saniye "Rota hesaplanıyor"da kalırdı). Harita hesaplama sürerken de aracı takip eder ve yeni rota gelince zorla araca ortalanıp yakınlaştırılır.',
    ],
  },
  {
    v: '0.53.1', date: '2026-11-01',
    notes: [
      'Sürüm notu düzeltildi: %0\'a kadar menzil bilgisi dokunmatik ekranda uzun basınca değil, yalnızca masaüstünde fareyle üzerine gelince ipucu olarak görünür.',
    ],
  },
  {
    v: '0.53.0', date: '2026-11-01',
    notes: [
      'Navigasyon ekranında şarjla tahmini menzil (km): sol pil çubuğunun altında mavi rakam. Mevcut pilden, Rota sekmesindeki minimum varış pili eşiğine kadar gidilebilecek mesafe (Menzil sekmesindeki değerle aynı); %0\'a kadar menzil masaüstünde üzerine gelince ipucu olarak görünür. Karartma modunda da görünür.',
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
      'Not: Haritanın kendisi Mapbox değildir (MapLibre + OpenFreeMap, OpenStreetMap verisi); Mapbox yalnızca anahtar girilince rota, trafik ve istasyon araması için kullanılır. Türkiye\'de Mapbox trafik verisinin kapsamı gerçek anahtarla doğrulanmadı.',
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
