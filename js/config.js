// Araç sabitleri ve varsayılanlar.
import { load } from './utils/storage.js';

// Hazır araçlar. Değerler TAHMİNDİR (üretici verisi değil); "Özel araç" ile her biri düzeltilebilir.
export const VEHICLES = [
  { id: 'togg-v2-lr', name: 'Togg T10X V2 Uzun Menzil', batteryNetKwh: 88.5, massKg: 2150, cd: 0.29, frontalAreaM2: 2.55, maxDcKw: 180 },
  { id: 'togg-v2-sr', name: 'Togg T10X V2 Standart Menzil (tahmini)', batteryNetKwh: 52.4, massKg: 1950, cd: 0.29, frontalAreaM2: 2.55, maxDcKw: 150 },
  { id: 'custom', name: 'Özel araç', batteryNetKwh: 88.5, massKg: 2150, cd: 0.29, frontalAreaM2: 2.55, maxDcKw: 180 },
];

// Seçili araç LocalStorage'dan başlangıçta okunur (araç değişince sayfa yenilenir; modüller bataryayı sabit olarak yakalar).
const savedVehicle = load('vehicle', null);
export const VEHICLE = { ...VEHICLES[0], ...(savedVehicle?.spec || {}), id: savedVehicle?.id || VEHICLES[0].id };

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
  maxJumpPct: 2, // 5 sn'de bundan fazla değişen pil okuması reddedilir
  maxJumpKmh: 40, // ekran hızı için
};

// Birim fiyatlar YER TUTUCUDUR; kullanıcı tabloda günceller.
export const DEFAULT_OPERATORS = [
  { id: 'trugo', name: 'Trugo', price: 9.5, kw: 180, match: ['trugo'] },
  { id: 'zes', name: 'ZES', price: 10.0, kw: 180, match: ['zes'] },
  { id: 'esarj', name: 'Eşarj', price: 9.8, kw: 150, match: ['eşarj', 'esarj', 'e-şarj'] },
  { id: 'astor', name: 'Astor', price: 9.2, kw: 120, match: ['astor'] },
  { id: 'voltrun', name: 'Voltrun', price: 9.9, kw: 120, match: ['voltrun'] },
  { id: 'sharz', name: 'Sharz.net', price: 10.5, kw: 120, match: ['sharz'] },
  { id: 'other', name: 'Diğer', price: 11.0, kw: 60, match: [] },
];

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
};

export const FALLBACK_POS = { lat: 39.9334, lon: 32.8597 }; // Test Modu'nda GPS yoksa Ankara
