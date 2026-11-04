// Menzil hesabı (js/physics/rangeCalc.js) testi: rota yok → düz zemin; rota sonu yakın → kısa iniş menzili şişirmez; rota tırmanışı menzili düşürür.
// Kullanım: node scripts/test-range.mjs
import { rangeForEnergy } from '../js/physics/rangeCalc.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// Sahte profil: her km için sabit kWh/km (dilim dilim): [{ len, kwhPerKm }]
const profile = (segs) => {
  const total = segs.reduce((t, s) => t + s.len, 0);
  const energyBetween = (a, b) => {
    let e = 0, pos = 0;
    for (const s of segs) {
      const lo = Math.max(a, pos), hi = Math.min(b, pos + s.len);
      if (hi > lo) e += (hi - lo) * s.kwhPerKm;
      pos += s.len;
    }
    return e;
  };
  return { totalKm: total, energyBetween };
};

const FLAT = 18.5; // kWh/100 km
const E = 0.78 * 88.5; // %78 pil, 88,5 kWh

// 1) Rota yok: düz zemin
ok('rota yok: enerji / düz tüketim', near(rangeForEnergy({ energyKwh: E, estFlat: FLAT, prof: null, routeKm: null, offKm: null, kp: 1 }), (E / FLAT) * 100));
ok('enerji null → null', rangeForEnergy({ energyKwh: null, estFlat: FLAT, prof: null, routeKm: null, offKm: null, kp: 1 }) === null);

// 2) Rota sonu çok yakın, son dilim güçlü iniş (-0,18 kWh/km): menzil şişmez (1092 km hatası)
{
  const prof = profile([{ len: 0.2, kwhPerKm: -0.18 }]);
  const km = rangeForEnergy({ energyKwh: E, estFlat: FLAT, prof, routeKm: 0.0, offKm: 0, kp: 1 });
  ok('rota 0,2 km (iniş): düz zemin menzili ± 1 km', near(km, (E / FLAT) * 100 + 0.2, 1)); // 0,2 km rota + kalan enerjiyle düz
  ok('rota sonu yakın: 1000 km\'yi aşmaz', km < 500);
}

// 3) Uzun rota, sonda tırmanış: eğim hesaba katılır → menzil düz zeminden kısa
{
  const prof = profile([{ len: 40, kwhPerKm: 0.18 }, { len: 260, kwhPerKm: 0.45 }]); // 40 km ılımlı, sonra uzun tırmanış (enerji rota bitmeden tükenir)
  const km = rangeForEnergy({ energyKwh: E, estFlat: FLAT, prof, routeKm: 0, offKm: 0, kp: 1 });
  const flatKm = (E / FLAT) * 100;
  ok('tırmanışlı rota: menzil düz zeminden kısa', km < flatKm - 20);
  ok('menzil rota enerjisiyle tutarlı (enerji bitince durur)', near(prof.energyBetween(0, km), E, 0.3));
}

// 4) Rota bitiyor ve enerji fazla: kalan yol + düz tüketimle devam
{
  const prof = profile([{ len: 30, kwhPerKm: 0.2 }]);
  const km = rangeForEnergy({ energyKwh: E, estFlat: FLAT, prof, routeKm: 10, offKm: 0, kp: 1 });
  const toEnd = 20 * 0.2;
  ok('rotadan sonra düz tüketimle devam', near(km, 20 + ((E - toEnd) / FLAT) * 100, 0.5));
}

// 5) Rotadan uzakta (offKm > 3): profil kullanılmaz, düz zemin
{
  const prof = profile([{ len: 100, kwhPerKm: 0.6 }]);
  const km = rangeForEnergy({ energyKwh: E, estFlat: FLAT, prof, routeKm: 5, offKm: 8, kp: 1 });
  ok('rotadan 8 km uzakta: düz zemin', near(km, (E / FLAT) * 100));
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
