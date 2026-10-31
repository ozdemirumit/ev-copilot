import { batteryPowerKw, hvacKw } from './model.js';
import { PHYSICS as P } from '../config.js';

/**
 * Trafik yoğunluğu (0..100) → ortalama hız çarpanı. Yoğunluk Google'ın trafikli süresinden otomatik
 * türetilir (densityFromRatio) ya da kullanıcı tahmini (Rota sekmesi) / Test Modu sürgüsüdür.
 */
export function speedFactor(density) {
  const d = Math.min(100, Math.max(0, density)) / 100;
  return 1 - 0.7 * d ** 1.3;
}

/**
 * Google'ın trafikli/trafiksiz süre oranından (≥ 1) yoğunluk (0..100): speedFactor'ün tersi (hız çarpanı = 1/oran).
 * %3'ten az yavaşlama "trafik yok" sayılır (süre tahmin gürültüsü).
 */
export function densityFromRatio(ratio) {
  if (!(ratio > 1.03)) return 0;
  const f = 1 / ratio;
  return Math.min(100, Math.round(((1 - f) / 0.7) ** (1 / 1.3) * 100));
}

/** Dur-kalk enerji çarpanı (yoğunlukta fren/kalkış kayıpları; rejenerasyon bir kısmını geri alır). */
export function stopGoOverhead(density) {
  const d = Math.min(100, Math.max(0, density)) / 100;
  return d > 0.6 ? 1 + (0.15 * (d - 0.6)) / 0.4 : 1;
}

/**
 * Trafiğin etkisi: ekstra süre, ekstra HVAC/yardımcı yük enerjisi, düşük hız aero/yuvarlanma tasarrufu ve net.
 * cond: { grade, headwind, temp, rain }, vFree: serbest akış hızı (km/h), distKm.
 */
export function trafficBreakdown({ distKm, vFree, density, grade = 0, headwind = 0, temp = 15, rain = 0 }) {
  const vEff = Math.max(5, vFree * speedFactor(density));
  const hFree = distKm / vFree;
  const hTraf = distKm / vEff;
  const fixedKw = hvacKw(temp) + P.auxKw;
  const pFree = batteryPowerKw({ v: vFree, grade, headwind, temp, rain });
  const pTraf = batteryPowerKw({ v: vEff, grade, headwind, temp, rain });
  const eFree = pFree * hFree;
  const eTraf = pTraf * hTraf * stopGoOverhead(density);
  const driveFree = (pFree - fixedKw) * hFree;
  const driveTraf = (pTraf - fixedKw) * hTraf;
  return {
    vEff,
    extraMin: (hTraf - hFree) * 60,
    hvacExtraKwh: fixedKw * (hTraf - hFree),
    driveSavingKwh: driveFree - driveTraf, // + = tasarruf
    overheadKwh: pTraf * hTraf * (stopGoOverhead(density) - 1),
    netKwh: eTraf - eFree,
  };
}
