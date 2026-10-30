import { VEHICLE } from '../config.js';

/**
 * Gerçek tüketim izleyicisi. SoC tam sayı olduğu için (%1 ≈ 0.885 kWh) yalnızca SoC'nin DEĞİŞTİĞİ anlar
 * ("kenar" örnekleri) ölçüm sınırı sayılır; pencere iki kenar arasındaki mesafedir. Böylece yarım yüzdelik
 * belirsizlik oluşmaz. Kısa mesafede oynak olmasın diye pencere ≥ minDrop puan düşüş veya windowKm dolana kadar büyür.
 *
 * Her örnek, o ana kadar entegre edilen model enerjisini de taşır; ölçülen/model oranı (k) fizik katsayılarının
 * gerçek araca göre ne kadar sapık olduğunu söyler.
 */
export function createTracker({ windowKm = 15, minDrop = 3, battery = VEHICLE.batteryNetKwh } = {}) {
  let samples = []; // { km, soc, modelKwh, edge }
  let km = 0;
  let modelKwh = 0;
  let lastSoc = null;

  return {
    addDistance(dKm, modelStepKwh) {
      km += dKm;
      modelKwh += modelStepKwh;
    },

    addSoc(soc) {
      if (soc == null) return;
      if (lastSoc != null && soc > lastSoc) samples = []; // şarj/manuel düzeltme: geçmiş geçersiz
      if (soc !== lastSoc) {
        samples.push({ km, soc, modelKwh, edge: lastSoc != null });
        samples = samples.filter((s) => km - s.km <= windowKm * 3);
      }
      lastSoc = soc;
    },

    /** { kwh100, kmPerPct, k, distKm, dropPct } veya yeterli veri yoksa null. */
    stats() {
      const edges = samples.filter((s) => s.edge);
      const end = edges.at(-1);
      if (!end) return null;
      let pick = null;
      for (const s of edges) {
        const dist = end.km - s.km;
        const drop = s.soc - end.soc;
        if (dist <= 0 || dist > windowKm || drop < 1) continue;
        if (!pick || drop > pick.drop) pick = { s, dist, drop }; // pencerede en geniş düşüş
      }
      if (!pick || (pick.drop < minDrop && pick.dist < windowKm * 0.5)) return null;
      const measuredKwh = (pick.drop / 100) * battery;
      const modelDelta = end.modelKwh - pick.s.modelKwh;
      return {
        kwh100: (measuredKwh / pick.dist) * 100,
        kmPerPct: pick.dist / pick.drop,
        k: modelDelta > 0.05 ? measuredKwh / modelDelta : null,
        distKm: pick.dist,
        dropPct: pick.drop,
        at: end.km,
      };
    },
  };
}
