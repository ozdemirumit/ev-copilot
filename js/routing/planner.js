import { VEHICLE, PLANNER as P } from '../config.js';
import { chargeMinutes } from './chargeCurve.js';

const BAT = VEHICLE.batteryNetKwh;

/** Mod başına maliyet fonksiyonu (düşük = iyi). minutes: şarj + fiş + sapma, cost: TL. */
export function metric(mode, minutes, cost) {
  if (mode === 'fast') return minutes;
  if (mode === 'cheap') return cost + minutes * 0.001; // eşitlikte hızlı olanı seç
  return cost + minutes * P.timeValueTlPerMin; // optimum
}

/** Planlanabilir istasyon: hızlı DC (≥ minKw) veya yedek olarak izin verilmişse yavaş AC/belirsiz. */
export const usable = (s) => s.kw >= P.minKw || (P.allowSlow && s.slow);

/**
 * Hızlı DC istasyon bulunmayan uzun rota aralıkları (km). Veri eksikliğini (özellikle Google'ın istasyon kaydının seyrek olduğu bölgeler)
 * kullanıcıya göstermek için; yalnızca `minGapKm`'den uzun boşluklar döner.
 */
export function stationGaps(stations, totalKm, minGapKm = 150) {
  const km = stations.filter((s) => s.kw >= P.minKw).map((s) => s.km).sort((a, b) => a - b);
  const pts = [0, ...km, totalKm];
  const gaps = [];
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > minGapKm) gaps.push({ from: pts[i - 1], to: pts[i] });
  return gaps;
}

const detourKwh = (s) => s.offKm * 2 * P.detourKwhPerKm;
const detourMin = (s) => ((s.offKm * 2) / P.detourKmh) * 60;

/**
 * Çok duraklı şarj planı (dinamik programlama). Düğümler: başlangıç, istasyonlar (rota sırasıyla), varış.
 * Durum: (istasyon, şarjdan ayrılış SoC'si ∈ {20,25,…,90}). Kenar: rota enerjisi (k ile ölçekli) + sapma enerjisi.
 *  - ara istasyona varış SoC ≥ chargerMinArrival, varışa varış SoC ≥ minArrival
 *  - maxFirstStopKm: dinamik fallback'te ilk durağın bu km'den ileride olmasını yasaklar.
 *  - forceFirstId: ilk durak bu istasyon olmak zorundadır (kullanıcı "Git" ile seçti).
 */
export function planRoute(args) {
  const strict = solve(args, P.minStopAdd);
  // Çok kısıtlı rotada (az/uzak istasyon) "en az ekleme" kuralı çözümü engelliyorsa kuralsız yeniden dene.
  return strict.feasible || !P.minStopAdd ? strict : solve(args, 0);
}

/** Eşik altına düşme cezası: puan başına ≈ 7 dk veya 20 TL (hızlı modda 3 dk). */
const dipPenalty = (mode, pts) => Math.max(0, pts) * (mode === 'fast' ? 3 : 20);

function solve({ profile, stations, startKm = 0, startSoc, minArrival, mode = 'opt', k = 1, maxFirstStopKm = Infinity, forceFirstId = null }, minAdd) {
  const tol = P.tolerance;
  const endKm = profile.totalKm;
  const cands = stations.filter((s) => s.km > startKm + 0.5 && s.km < endKm - 0.5 && usable(s)).sort((a, b) => a.km - b.km);
  const levels = [];
  for (let l = P.minChargeTo; l <= P.maxChargeTo; l += P.chargeStep) levels.push(l);

  // states[0] = başlangıç (tek durum), states[i] = i. istasyon × ayrılış seviyeleri
  const states = [[{ leave: startSoc, metric: 0, prev: null }], ...cands.map(() => levels.map(() => null))];
  const nodeKm = [startKm, ...cands.map((s) => s.km)];
  let best = null;

  for (let n = 0; n < states.length; n++) {
    for (let si = 0; si < states[n].length; si++) {
      const st = states[n][si];
      if (!st) continue;
      const fromKm = nodeKm[n];

      const arriveEnd = st.leave - (profile.energyBetween(fromKm, endKm, k) / BAT) * 100;
      if (arriveEnd >= minArrival - tol && !(n === 0 && forceFirstId)) { // zorunlu ilk durak varsa durak atlanamaz
        const total = st.metric + dipPenalty(mode, minArrival - arriveEnd);
        if (!best || total < best.metric) best = { metric: total, from: [n, si], arriveEnd };
      }

      for (let j = n + 1; j < states.length; j++) {
        const s = cands[j - 1];
        if (n === 0 && s.km > maxFirstStopKm) break;
        if (n === 0 && forceFirstId && s.id !== forceFirstId) continue; // ilk durak seçilen istasyon olmalı
        const eRoute = profile.energyBetween(fromKm, s.km, k);
        if (st.leave - (eRoute / BAT) * 100 < P.chargerMinArrival - tol) break; // daha ilerisi daha da zor
        const arrive = st.leave - ((eRoute + detourKwh(s) * k) / BAT) * 100;
        if (arrive < P.chargerMinArrival - tol) continue;
        const dip = dipPenalty(mode, P.chargerMinArrival - arrive);

        levels.forEach((L, li) => {
          if (L < arrive + Math.max(3, minAdd)) return;
          const mins = chargeMinutes(s.kw, arrive, L);
          const cost = (((L - arrive) / 100) * BAT / P.billedEff) * s.price;
          const m = st.metric + dip + metric(mode, mins + P.stopOverheadMin + detourMin(s), cost);
          if (!states[j][li] || m < states[j][li].metric) {
            states[j][li] = { leave: L, metric: m, prev: [n, si], arrive, mins, cost };
          }
        });
      }
    }
  }

  if (!best) {
    const need = (profile.energyBetween(startKm, endKm, k) / BAT) * 100;
    return { feasible: false, reason: explainBreak({ profile, cands, states, nodeKm, startKm, endKm, startSoc, k, need }), stops: [] };
  }

  // Geriye doğru izle
  const stops = [];
  let ref = best.from;
  while (ref && ref[0] > 0) {
    const [n, si] = ref;
    const st = states[n][si];
    const s = cands[n - 1];
    stops.unshift({
      station: s, km: s.km, arriveSoc: st.arrive, leaveSoc: st.leave,
      minutes: st.mins, overheadMin: P.stopOverheadMin + detourMin(s), cost: st.cost,
      kwhAdded: ((st.leave - st.arrive) / 100) * BAT,
    });
    ref = st.prev;
  }

  const driveMin = profile.timeBetween(startKm, endKm) * 60 + stops.reduce((a, s) => a + detourMin(s.station), 0);
  const chargeMin = stops.reduce((a, s) => a + s.minutes + P.stopOverheadMin, 0);
  return {
    feasible: true, mode, startKm, stops,
    totals: {
      driveMin, chargeMin, totalMin: driveMin + chargeMin,
      cost: stops.reduce((a, s) => a + s.cost, 0),
      arriveSoc: best.arriveEnd,
    },
  };
}

/**
 * Zincir neden kurulamadı? Ulaşılabilen en uzak istasyonu ve oradan sonraki boşluğu bulup açıklar
 * (genelde iki aday arası, tam şarjla gidilebilecek mesafeden uzundur: veri eksikliği veya çok uzun rota).
 */
function explainBreak({ profile, cands, states, nodeKm, startKm, endKm, startSoc, k, need }) {
  let last = 0;
  for (let n = 1; n < states.length; n++) if (states[n].some(Boolean)) last = n;
  const fromKm = nodeKm[last];
  const leave = last === 0 ? startSoc : P.maxChargeTo;
  // fromKm'den `leave` pille eşik (giriş pili - tolerans) altına düşmeden gidilebilecek en uzak km (ikili arama)
  let lo = fromKm;
  let hi = endKm;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (leave - (profile.energyBetween(fromKm, mid, k) / BAT) * 100 >= P.chargerMinArrival - P.tolerance) lo = mid; else hi = mid;
  }
  const reach = Math.max(0, lo - fromKm);
  const nextKm = cands[last]?.km ?? endKm;
  const where = last === 0 ? 'Başlangıçtan' : `${fromKm.toFixed(0)}. km'deki ${cands[last - 1].name} istasyonundan`;
  const next = cands[last] ? `sonraki aday istasyon ${nextKm.toFixed(0)}. km'de (${(nextKm - fromKm).toFixed(0)} km)` : `varışa ${(endKm - fromKm).toFixed(0)} km var`;
  return `Uygun şarj zinciri bulunamadı: ${where} sonra ${next}, ama %${Math.round(leave)} pille en fazla ~${reach.toFixed(0)} km gidilebilir. `
    + `Bu aralıkta haritada istasyon eksik olabilir: İstasyon sekmesindeki "Kendi istasyonlarım"a bildiğin istasyonları ekle; ayrıca tüketimi, giriş pilini veya şarj hedefini gözden geçir (toplam tüketim ≈ %${need.toFixed(0)} pil, ${cands.length} aday istasyon).`;
}

/**
 * İstasyon sıralaması (tek istasyon bakışıyla): başlangıçtan ek şarj olmadan varış SoC'si ve %80'e şarj süresi/maliyeti.
 * Erişilemeyenler (varış < chargerMinArrival) elenir.
 */
export function rankStations({ profile, stations, startKm = 0, startSoc, k = 1, mode = 'opt', target = 80 }) {
  const rows = [];
  for (const s of stations) {
    if (s.km <= startKm + 0.5 || !usable(s)) continue;
    const arrive = startSoc - ((profile.energyBetween(startKm, s.km, k) + detourKwh(s) * k) / BAT) * 100;
    if (arrive < P.chargerMinArrival) continue;
    const to = Math.max(target, Math.min(P.maxChargeTo, arrive + 10));
    const minutes = chargeMinutes(s.kw, arrive, to) + P.stopOverheadMin + detourMin(s);
    const cost = (((to - arrive) / 100) * BAT / P.billedEff) * s.price;
    rows.push({ station: s, arrive, to, minutes, cost, score: metric(mode, minutes, cost) });
  }
  return rows.sort((a, b) => a.score - b.score);
}
