// Tek sürüm kaynağı. Sayfa (klasik <script>) ve service worker (importScripts) buradan okur.
// KURAL: her değişiklikte APP_VERSION artırılır ve APP_CHANGELOG'un EN ÜSTÜNE bir kayıt eklenir.
//   x.y.z → z: düzeltme · y: yeni özellik · x: uyumsuz/büyük değişiklik. Commit mesajı "vX.Y.Z: ..." ile başlar.
// Sürüm değişince sw.js'in önbellek adı da değişir; telefon yeni sürümü indirir.
self.APP_VERSION = '0.5.0';
self.APP_CHANGELOG = [
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
