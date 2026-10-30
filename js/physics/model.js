import { VEHICLE, PHYSICS as P } from '../config.js';

export const airDensity = (tC) => 101325 / (287.05 * (tC + 273.15));

export function hvacKw(tC) {
  return Math.min(P.hvacMaxKw, P.hvacBaseKw + P.hvacPerDegKw * Math.abs(tC - P.comfortC));
}

/**
 * Bataryadan çekilen güç (kW). Negatif = rejenerasyon.
 * v: km/h · grade: eğim oranı (0.05 = %5) · headwind: km/h (+ kafa, − arka) · temp: °C · rain: mm/sa
 * v = 0 iken yalnızca yardımcı yükler + HVAC kalır.
 */
export function batteryPowerKw({ v, grade = 0, headwind = 0, temp = 15, rain = 0 }) {
  const vm = v / 3.6;
  const va = vm + headwind / 3.6;
  const cda = VEHICLE.cd * P.frontalAreaM2;
  const theta = Math.atan(grade);
  const fAero = 0.5 * airDensity(temp) * cda * va * Math.abs(va);
  const fRoll = P.crr * (1 + P.rainCrrPerMm * rain) * VEHICLE.massKg * P.g * Math.cos(theta);
  const fGrade = VEHICLE.massKg * P.g * Math.sin(theta);
  const pWheel = ((fAero + fRoll + fGrade) * vm) / 1000;
  const pBatt = pWheel >= 0 ? pWheel / P.drivetrainEff : Math.max(-P.regenMaxKw, pWheel * P.regenEff);
  return pBatt + P.auxKw + hvacKw(temp);
}

/** kWh/100km (yaklaşık, v ≥ 5 km/h). */
export function kwhPer100(cond) {
  const v = Math.max(cond.v, 5);
  return (batteryPowerKw({ ...cond, v }) / v) * 100;
}
