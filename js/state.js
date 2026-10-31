// Tek doğruluk kaynağı. Sensörler/simülatör yazar, fizik ve UI okur.
import { DEFAULT_SIM, DEFAULT_CAMERA, FALLBACK_POS } from './config.js';
import { load } from './utils/storage.js';

const store = {
  // Gerçek sensör verisi (GPS + OCR). null = henüz yok.
  live: {
    soc: null, speed: null, speedScr: null, speedScrAt: 0,
    lat: null, lon: null, alt: null, heading: null, extTemp: null, acc: null, gps: 'off',
  },
  // Test Modu değerleri (sürgüler + simülatör konumu).
  sim: { ...DEFAULT_SIM, ...load('sim', {}), enabled: false, play: false },
  // Konumdaki hava durumu (Open-Meteo); rota hava durumu plan.profile.wx içinde.
  weather: { temp: null, rain: null, windSpeed: null, windDir: null, at: 0, lat: null, lon: null },
  // Rota seçimleri ve kullanıcı tahminleri.
  route: {
    start: null, end: null,
    minArrivalSoc: load('minArrival', 15),
    cruise: load('cruise', 100),
    traffic: load('trafficEst', 0),
    consAdj: load('consAdj', 0), // % tüketim düzeltmesi (PHYSICS.consScale ile eşleşir)
    chargerMin: load('chargerMin', 10), // ara istasyona varışta en az %
    maxChargeTo: load('maxChargeTo', 90), // durakta şarj hedefi üst sınırı %
    minStopAdd: load('minStopAdd', 15), // durakta en az eklenen pil puanı
    tolerance: load('tolerance', 3), // eşik toleransı ± puan
    allowSlow: load('allowSlow', true), // yavaş AC/belirsiz istasyonlar yedek aday
  },
  // OCR ayarları ve okuma durumu.
  ocr: { ...DEFAULT_CAMERA, ...load('camera', {}), raw: null, accepted: null, status: 'idle', rawSpeed: null, speedStatus: 'idle', lastOkAt: 0 },
  // Menzil motoru çıktıları (rangeEngine yazar, kartlar okur).
  engine: {
    k: load('kCal', 1), grade: null, routeKm: null, offRouteKm: null,
    kwh100Measured: null, kmPerPct: null, measuredKm: null,
    kwh100Est: null, rangeKm: null, netWind: null, aeroPct: null, traffic: null,
  },
  // Planlanan rota ve şarj planı.
  plan: { status: 'none', text: '', route: null, profile: null, wxInfo: null, stations: [], stationInfo: null, stops: [], mode: load('planMode', 'opt'), totals: null },
  // Dinamik uyarılar (fallback / eco-hız).
  advisor: { level: 'ok', text: '', at: 0 },
  // ABRP köprüsü: status = idle | wait | ok | err
  abrp: { enabled: false, status: 'idle', text: 'Pasif', http: null, lastSentAt: null, webhook: null },
  system: { wakeLock: false, camera: false, ocr: false },
  // Navigasyon: active = dönüş dönüş yönlendirme açık; voice = sesli yönlendirme; lowSoc = düşük pil uyarı eşiği (%).
  nav: { active: false, voice: load('voiceOn', true), lowSoc: load('lowSoc', 20), step: null, alert: null },
};

const listeners = {};

export function getState(slice) {
  return store[slice];
}

export function patch(slice, part) {
  Object.assign(store[slice], part);
  (listeners[slice] || []).forEach((fn) => fn(store[slice]));
}

export function subscribe(slices, fn) {
  const list = Array.isArray(slices) ? slices : [slices];
  list.forEach((s) => (listeners[s] ||= []).push(fn));
}

/** Test Modu açıksa sürgü değerleri, değilse gerçek sensörler. UI, fizik ve ABRP bunu okur. */
export function effective() {
  const { live, sim, weather, engine, route } = store;
  if (sim.enabled) {
    return {
      source: 'sim',
      soc: sim.soc, speed: sim.speed, heading: sim.heading, alt: live.alt,
      lat: sim.lat ?? live.lat ?? FALLBACK_POS.lat,
      lon: sim.lon ?? live.lon ?? FALLBACK_POS.lon,
      extTemp: sim.temp, grade: sim.grade, windSpeed: sim.windSpeed, windDir: sim.windDir,
      rain: sim.rain, traffic: sim.traffic,
    };
  }
  // GPS hızı yoksa (kapalı/tünel) ekrandaki hız okumasına düş (15 sn tazelik).
  const scr = live.speedScr != null && Date.now() - live.speedScrAt < 15000 ? live.speedScr : null;
  const hasWx = weather.at > 0;
  return {
    source: 'live',
    soc: live.soc, speed: live.speed ?? scr, heading: live.heading, alt: live.alt, lat: live.lat, lon: live.lon,
    extTemp: live.extTemp ?? (hasWx ? weather.temp : null),
    grade: engine.grade,
    windSpeed: hasWx ? weather.windSpeed : null,
    windDir: hasWx ? weather.windDir : null,
    rain: hasWx ? weather.rain : null,
    traffic: route.traffic,
  };
}
