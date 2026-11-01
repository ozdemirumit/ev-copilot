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
  maxChargeTo: load('maxChargeTo', 90), // bir durakta en fazla şarj hedefi % (kullanıcı ayarlar)
  chargeStep: 5,
  stopOverheadMin: 4, // fişe takma/çıkarma
  timeValueTlPerMin: 3, // "Optimum" modunda 1 dk'nın TL karşılığı
  billedEff: 0.95, // faturalanan kWh = bataryaya giren / 0.95
  maxStations: 80,
  corridorM: 2500,
  minKw: 40,
  allowSlow: load('allowSlow', true), // DC yetmediğinde yavaş AC/tipi belirsiz (herkese açık) istasyonlar yedek aday olsun
  detourKwhPerKm: 0.2,
  detourKmh: 50,
};

export const ABRP = {
  endpoint: 'https://api.iternio.com/1/tlm/send',
  intervalMs: 10000, // varsayılan gönderim aralığı (ABRP tüketim kalibrasyonu için ~10 sn önerir); kullanıcı ayarlar
  parkedIntervalMs: 30000, // araç duruyorken (hız < 1 km/h) en az bu aralıkla gönder
  intervalOptionsS: [5, 10, 15, 30, 60],
  bytesPerPacket: 1130, // ölçülen: ≈ 780 B giden + 350 B gelen (veri tahmini için)
};

export const OCR = {
  intervalMs: 5000,
  idleIntervalMs: 15000, // pil değeri 3 okumadır değişmediyse bu aralıkla oku (telefon pili)
  maxJumpPct: 2, // 5 sn'de bundan fazla değişen pil okuması reddedilir
  maxJumpKmh: 40, // ekran hızı için
};

// Varsayılan liste tarifeleri (TL/kWh): price = DC hızlı şarj, acPrice = AC/yavaş istasyon. Kaynak: arabamsarj.com.tr/fiyatlar, 01.11.2026
// itibarıyla (üyelik/roaming indirimleri yok); kullanıcı tabloda değiştirebilir. Yeni tarife çıkınca değerleri ve PRICES_AS_OF'u güncelle.
export const PRICES_AS_OF = '2026-11-01';
export const DEFAULT_OPERATORS = [
  { id: 'trugo', name: 'Trugo', price: 14.98, acPrice: 9.95, kw: 180, match: ['trugo'] },
  { id: 'zes', name: 'ZES', price: 16.49, acPrice: 9.99, kw: 180, match: ['zes'] },
  { id: 'esarj', name: 'Eşarj', price: 13.5, acPrice: 9.9, kw: 150, match: ['eşarj', 'esarj', 'e-şarj'] },
  { id: 'astor', name: 'Astor', price: 13.99, acPrice: 9.89, kw: 120, match: ['astor'] },
  { id: 'voltrun', name: 'Voltrun', price: 12.9, acPrice: 9.9, kw: 120, match: ['voltrun'] },
  { id: 'sharz', name: 'Sharz.net', price: 12.99, acPrice: 9.49, kw: 120, match: ['sharz'] },
  { id: 'other', name: 'Diğer', price: 12.42, acPrice: 9.49, kw: 60, match: [] }, // Diğer: sayfanın DC ve AC ortalaması
];
/** Önceki varsayılan fiyatlar (yer tutucu): kayıtlı fiyat bunlardan biriyse kullanıcı değiştirmemiştir, yeni varsayılana geçer. */
export const OLD_DEFAULT_PRICES = { trugo: 9.5, zes: 10, esarj: 9.8, astor: 9.2, voltrun: 9.9, sharz: 10.5, other: 11 };

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
  contrast: 1.5,
  threshold: 128,
  useThreshold: true,
  autoSkew: true, // telefon göstergeye eğik dururken rakamları otomatik düzelt
  rot: 0, // elle eğim düzeltme: dönme (derece)
  shear: 0, // elle eğim düzeltme: yatıklık (derece)
};

export const FALLBACK_POS = { lat: 39.9334, lon: 32.8597 }; // Test Modu'nda GPS yoksa Ankara
