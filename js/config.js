// Araç sabitleri ve varsayılanlar.
import { load } from './utils/storage.js';
import { CATALOG, LEGACY_IDS } from './vehicleCatalog.js';

// Hazır araçlar. Değerler TAHMİNDİR (üretici verisi değil); "Özel araç" ile her biri düzeltilebilir.
export const VEHICLES = [
  ...CATALOG, // marka › model › pil (vehicleCatalog.js; Togg ilk sırada, diğerleri tahmini)
  { id: 'custom', brand: 'Özel araç', model: 'Özel', pack: 'Elle girilen değerler', name: 'Özel araç', batteryNetKwh: 88.5, massKg: 2150, cd: 0.29, frontalAreaM2: 2.55, maxDcKw: 180 },
];

// Seçili araç LocalStorage'dan başlangıçta okunur (araç değişince sayfa yenilenir; modüller bataryayı sabit olarak yakalar).
const savedVehicle = load('vehicle', null);
const savedId = LEGACY_IDS[savedVehicle?.id] || savedVehicle?.id;
export const VEHICLE = { ...VEHICLES[0], ...(savedVehicle?.spec || {}), id: VEHICLES.some((v) => v.id === savedId) ? savedId : savedVehicle ? 'custom' : VEHICLES[0].id };

// Fizik katsayıları TAHMİNDİR (üretici verisi değil). rangeEngine ölçülen tüketimle bir düzeltme çarpanı (k) öğrenir.
export const PHYSICS = {
  frontalAreaM2: 2.55,
  crr: 0.010,
  drivetrainEff: 0.90,
  regenEff: 0.65,
  regenMaxKw: 60,
  auxKw: 0.35,
  hvacBaseKw: 0.4,
  hvacPerDegKw: 0.07,
  hvacMaxKw: 4.0,
  comfortC: 21,
  rainCrrPerMm: 0.02,
  g: 9.81,
  consScale: 1 + load('consAdj', 0) / 100, // kullanıcının tüketim düzeltmesi (çarpan); sürgüyle canlı değişir
};

export const PLANNER = {
  chargerMinArrival: load('chargerMin', 10), // ara istasyona varışta güvenli minimum % (kullanıcı ayarlar)
  hardMinArrival: 5, // fallback'te kabul edilen mutlak minimum %
  minChargeTo: 20,
  minStopAdd: load('minStopAdd', 15), // bir durakta en az eklenecek pil puanı (6 puanlık anlamsız mola olmasın)
  tolerance: load('tolerance', 3), // giriş/varış eşiğinde ± puan: altına düşmek yasak değil, cezalı (eşikte "uçurum" olmasın)
  maxChargeTo: load('maxChargeTo', 80), // bir durakta en fazla şarj hedefi % (kullanıcı ayarlar)
  chargeStep: 5,
  stopOverheadMin: 4, // fişe takma/çıkarma
  timeValueTlPerMin: 3, // "Optimum" modunda 1 dk'nın TL karşılığı
  billedEff: 0.95, // faturalanan kWh = bataryaya giren / 0.95
  maxStations: 80,
  corridorM: 2500,
  baseKw: 40, // "hızlı DC" sayılma eşiği (istasyon sınıflandırması; sabit)
  minKw: load('minKw', 120), // kullanıcının seçtiği en düşük şarj gücü (Şarj planı filtresi: 40(AC)/60/100/120/150; varsayılan 120); bunun altı plana girmez
  allowSlow: load('allowSlow', true), // DC yetmediğinde yavaş AC/tipi belirsiz (herkese açık) istasyonlar yedek aday olsun
  brands: load('brandPref', []), // tercih edilen şarj markaları (operatör kimlikleri); boşsa hepsi. Plan ve liste yalnızca bunları kullanır
  detourKwhPerKm: 0.2,
  detourKmh: 50,
};

export const ABRP = {
  endpoint: 'https://api.iternio.com/1/tlm/send',
  intervalMs: 60000, // sabit gönderim aralığı (veri tasarrufu; seçenek kaldırıldı)
  parkedIntervalMs: 30000, // araç duruyorken (hız < 1 km/h) en az bu aralıkla gönder
  bytesPerPacket: 1130, // ölçülen: ≈ 780 B giden + 350 B gelen (veri tahmini için)
};

export const OCR = {
  intervalMs: 5000,
  samples: 3, // pil ve hız değer sabit kalsa da bu aralıkla okunur; bir çevrimde en az bu kadar kare
  maxSamples: 5, // kareler tutarsızsa en çok bu kadar
  sampleGapMs: 250, // kareler arası bekleme
  cycleBudgetMs: 3800, // çevrim içinde yeni kare/yöntem için süre sınırı (5 sn aralığa sığsın)
  cycleTimeoutMs: 12000, // bu süreyi aşan çevrim takılmış sayılır, işçi yeniden kurulur
  strongScore: 0.6, // bu skorda kareler yeterli sayılır, ek kare alınmaz
  maxJumpPct: 2, // 5 sn'de bundan fazla değişen pil okuması reddedilir
  maxJumpKmh: 40, // ekran hızı için
};

// Varsayılan liste tarifeleri (TL/kWh, KDV dahil): price = DC hızlı şarj (ağın ultra hızlı tarifesi varsa o, yoksa DC hızlı; ikisi de varsa yüksek olan),
// acPrice = AC/yavaş istasyon. Kaynak: yonga.io/sarj-fiyatlari, son kontrol 06.11.2026 (işgaliye, üyelik ve peak saat sürşarjı hariç);
// kullanıcı tabloda değiştirebilir. Yeni tarife çıkınca değerleri ve PRICES_AS_OF'u güncelle. kw: güç bilinmeyen istasyonda varsayılan
// (ultra tarifesi olan ağlarda 150, diğerlerinde 120). match: istasyon adı/işletmeci metninde aranan küçük harfli parçalar (kısa/genel sözcükler yok).
export const PRICES_AS_OF = '2026-11-06';
export const DEFAULT_OPERATORS = [
  { id: 'trugo', name: 'Trugo', price: 14.98, acPrice: 9.95, kw: 180, match: ['trugo'] },
  { id: 'zes', name: 'ZES', price: 16.49, acPrice: 10.99, kw: 180, match: ['zes'] },
  { id: 'esarj', name: 'Eşarj', price: 9.9, acPrice: 9.9, kw: 150, match: ['eşarj', 'esarj', 'e-şarj'] },
  { id: 'astor', name: 'Astor', price: 13.99, acPrice: 9.89, kw: 120, match: ['astor'] },
  { id: 'voltrun', name: 'Voltrun', price: 12.9, acPrice: 9.9, kw: 120, match: ['voltrun'] },
  { id: 'sharz', name: 'Sharz.net', price: 10.99, acPrice: 8.99, kw: 150, match: ['sharz'] },
  { id: 'tesla', name: 'Tesla', price: 13, acPrice: 13, kw: 250, match: ['tesla supercharger'] }, // Supercharger, diğer markalar tarifesi (haberlerdeki son liste; Tesla uygulaması gerekir, istasyona göre değişebilir)
  { id: 'neva', name: 'Neva Şarj', price: 13.9, acPrice: 9.9, kw: 120, match: ['neva şarj', 'neva sarj', 'nevasarj'] },
  { id: 'otojet', name: 'Otojet', price: 15.49, acPrice: 10.99, kw: 150, match: ['otojet'] },
  { id: 'otowatt', name: 'otoWATT', price: 13.99, acPrice: 10.99, kw: 120, match: ['otowatt', 'oto watt'] },
  { id: 'wat', name: 'WAT Mobilite', price: 14.49, acPrice: 9.99, kw: 150, match: ['wat mobilite', 'watmobilite'] },
  { id: 'sarjon', name: 'Şarjon', price: 13.99, acPrice: 10.99, kw: 150, match: ['şarjon', 'sarjon'] },
  { id: 'sepas', name: 'Sepaş', price: 12.9, acPrice: 9.9, kw: 120, match: ['sepaş', 'sepas'] },
  { id: 'aksa', name: 'Aksa Şarj', price: 11.99, acPrice: 9.9, kw: 120, match: ['aksa şarj', 'aksa sarj', 'aksasarj'] },
  { id: 'epower', name: 'e-POwer', price: 11.99, acPrice: 8.99, kw: 120, match: ['e-power', 'epower'] },
  { id: 'ovolt', name: 'ovolt', price: 11.99, acPrice: 9.99, kw: 120, match: ['ovolt'] },
  { id: 'electrise', name: 'Electrise', price: 11, acPrice: 8.5, kw: 150, match: ['electrise'] },
  { id: 'minus', name: 'Minus Energy', price: 12.5, acPrice: 9.2, kw: 150, match: ['minus energy', 'minusenergy'] },
  { id: 'tuncmatik', name: 'Tunçmatik', price: 11.5, acPrice: 8.99, kw: 150, match: ['tunçmatik', 'tuncmatik'] },
  { id: 'greenwatt', name: 'Greenwatt', price: 10.5, acPrice: 8, kw: 150, match: ['greenwatt', 'green watt'] },
  { id: 'pirim', name: 'Pirim Şarj', price: 10.49, acPrice: 8.49, kw: 150, match: ['pirim şarj', 'pirim sarj'] },
  { id: 'petroo', name: 'Petroo', price: 9.8, acPrice: 7.8, kw: 120, match: ['petroo'] },
  { id: 'otopriz', name: 'Otopriz', price: 9.73, acPrice: 7.92, kw: 120, match: ['otopriz'] },
  { id: 'elaris', name: 'Elaris', price: 10, acPrice: 9.49, kw: 120, match: ['elaris'] },
  { id: 'polestar', name: 'Polestar', price: 10.49, acPrice: 9.29, kw: 120, match: ['polestar'] },
  { id: 'other', name: 'Diğer', price: 12.78, acPrice: 9.78, kw: 60, match: [] }, // Diğer: kaynak sayfanın DC hızlı ve AC ortalaması (141 ağ)
];
/** Önceki varsayılan fiyatlar: kayıtlı fiyat bunlardan biriyse kullanıcı değiştirmemiştir, yeni varsayılana geçer (her marka için eski değerler listesi). */
export const OLD_DEFAULT_PRICES = { trugo: [9.5], zes: [10], esarj: [9.8, 13.5], astor: [9.2], voltrun: [9.9], sharz: [10.5, 12.99], other: [11, 12.42] };

export const DEFAULT_SIM = {
  enabled: false,
  speed: 90, soc: 70, grade: 0, heading: 90,
  windSpeed: 0, windDir: 0, rain: 0, traffic: 0, temp: 15,
  play: false, timeScale: 10, lat: null, lon: null, routeKm: 0,
};

export const DEFAULT_CAMERA = {
  roi: { x: 0.4, y: 0.38, w: 0.2, h: 0.2 }, // 0..1, video çerçevesine göre; yalnızca iri pil rakamlarını sarmalı
  roiSpeed: { x: 0.2, y: 0.4, w: 0.16, h: 0.2 }, // ekrandaki hız rakamları
  speedOn: false,
  engine: 'tess', // tess = OCR 1 (Tesseract), digit = OCR 2 (çevrimdışı rakam tanıyıcı)
  contrast: 1.5,
  threshold: 128,
  useThreshold: true,
  autoSkew: true, // telefon göstergeye eğik dururken rakamları otomatik düzelt
  rot: 0, // elle eğim düzeltme: dönme (derece)
  shear: 0, // elle eğim düzeltme: yatıklık (derece)
};

export const FALLBACK_POS = { lat: 39.9334, lon: 32.8597 }; // Test Modu'nda GPS yoksa Ankara
