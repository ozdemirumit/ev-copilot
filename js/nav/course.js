// Gidiş yönü (GPS course) süzgeci: harita yön-yukarı dönerken düşük hızda ya da kararsız GPS'te yön zıplamasın.
// Hız eşiğin altındaysa, doğruluk kötüyse ya da yön yoksa son güvenilir yön korunur. Güvenilir ölçümler dairesel üstel ortalamayla
// yumuşatılır (hız arttıkça yeni ölçüme daha çok güvenilir). Yavaşken tek ölçümde büyük sapma (ör. GPS sıçraması) bir onay bekler.
// Saf modül: gps.js kullanır, scripts/test-course-up.mjs dener.

export const MIN_COURSE_KMH = 8; // bunun altında GPS yönü güvenilmez (park, kavşakta bekleme)
export const MAX_COURSE_ACC_M = 50; // konum doğruluğu bundan kötüyse yön alınmaz
const JUMP_DEG = 100; // yavaşken bundan büyük tek seferlik sapma onay bekler
const JUMP_KMH = 30;

const norm = (h) => ((h % 360) + 360) % 360;
/** a'dan b'ye en kısa dönüş (−180…180°). */
export const turnDelta = (a, b) => ((b - a + 540) % 360) - 180;

export function createCourseFilter({ minKmh = MIN_COURSE_KMH, maxAcc = MAX_COURSE_ACC_M } = {}) {
  let cur = null;
  let pending = null;
  return {
    /** Yeni ölçüm: { heading (°, null olabilir), speedKmh, acc (m) } → süzülmüş yön (güvenilir ölçüm yoksa son güvenilir yön, hiç yoksa null). */
    push({ heading, speedKmh, acc = null }) {
      if (heading == null || !Number.isFinite(heading) || heading < 0 || speedKmh == null || !(speedKmh >= minKmh) || (acc != null && acc > maxAcc)) return cur;
      const h = norm(heading);
      if (cur == null) { cur = h; return cur; }
      const d = turnDelta(cur, h);
      if (Math.abs(d) > JUMP_DEG && speedKmh < JUMP_KMH) {
        if (pending != null && Math.abs(turnDelta(pending, h)) < 30) { pending = null; cur = h; return cur; } // iki ölçüm aynı yönde: gerçek dönüş (U dönüşü)
        pending = h;
        return cur;
      }
      pending = null;
      const a = Math.min(0.8, Math.max(0.35, 0.35 + (speedKmh - minKmh) / 120));
      cur = norm(cur + d * a);
      return cur;
    },
    get value() { return cur; },
  };
}
