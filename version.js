// Tek sürüm kaynağı. Sayfa (klasik <script>) ve service worker (importScripts) buradan okur.
// KURAL: her değişiklikte APP_VERSION artırılır ve APP_CHANGELOG'un EN ÜSTÜNE bir kayıt eklenir.
//   x.y.z → z: düzeltme · y: yeni özellik · x: uyumsuz/büyük değişiklik. Commit mesajı "vX.Y.Z: ..." ile başlar.
// Sürüm değişince sw.js'in önbellek adı da değişir; telefon yeni sürümü indirir.
self.APP_VERSION = '0.12.1';
self.APP_CHANGELOG = [
  {
    v: '0.12.1', date: '2026-10-30',
    notes: [
      'DÜZELTME: Şarj istasyonu bulunamıyordu — herkese açık Overpass sunucuları yanıtsız kalınca liste boş geliyor ve uyarı 5 sn'de kayboluyordu. Sunucular artık paralel/kademeli denenir (5 ayna, yanıtsız olan atlanır): toplam bekleme ~2 dk yerine ~30–55 sn.',
      'Overpass tamamen yanıtsızsa Photon'dan tanınan operatör adlarıyla (ZES, Trugo, Eşarj, Voltrun, Astor…) yaklaşık bir liste alınır.',
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
