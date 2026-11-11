// Ortalama hız (km/s): örnek hızların aritmetik ortalaması DEĞİL, geçerli GPS parçalarında gidilen yol / sürüş süresi.
// İki oturum:
//  - Sürüş (rotasız panel): uygulama açılınca başlar, ilk geçerli konum çiftinden itibaren sayar. Araç 20 dk kesintisiz durursa
//    ya da konum 20 dk gelmezse (park, uzun arka plan) yeni sürüş sayılır: sonraki hareketle sıfırdan başlar. Navigasyon sırasında da sürer.
//  - Navigasyon (navigasyon paneli): navigasyon her başlatıldığında sıfırlanır (yeniden rota kurmak sıfırlamaz), yalnızca navigasyon açıkken
//    sayar; durdurulunca donar, sonraki başlatışta sıfırlanır.
// Süre: iki geçerli konum arası parça ya "sürüş" (hareket) ya "duruş" sayılır. Ortalama = yol / (sürüş + kısa bekleme): kırmızı ışık ve trafikte
// bekleme (en çok SHORT_STOP_MS süren duruş) sayılır; daha uzun duruş (şarj molası, park) sayılmaz; yol / tüm süre ayrıca (overallKmh) verilir. Arka plan, GPS kesintisi, eski (önbellek) konum, zaman damgası
// tutarsızlığı ve sıçramalar hiçbir süreye ve yola yazılmaz: boşluktan sonraki ilk konum yeni çapa olur.
import { haversineKm } from '../utils/geo.js';

export const MAX_SEG_MS = 10_000; // iki konum arası bundan uzunsa boşluk (arka plan, tünel, takılan GPS): yol da süre de sayılmaz
export const MAX_FIX_AGE_MS = 10_000; // zaman damgası duvar saatinden bu kadar eskiyse önbellek/kuyruk konumu: kullanılmaz
export const CLOCK_SLACK_MS = 3000; // GPS zaman farkı ile varış zamanı farkı bundan çok ayrışırsa (toplu teslim, saat sıçraması) boşluk
export const MAX_ACC_M = 50; // doğruluğu bundan kötü konum yok sayılır (çapa da değişmez)
export const MAX_JUMP_KMH = 250; // parçanın ima ettiği hız bunu aşarsa GPS sıçraması: konum reddedilir
export const JUMP_REANCHOR = 2; // art arda bu kadar ret: çapa hatalıdır, son konumdan yeniden başlanır (yol/süre sayılmadan)
export const MOVE_KMH = 3; // bu hızın altı duruş (GPS titreşimi yola eklenmez)
export const MOVE_WINDOW_MS = 3000; // cihaz hız vermiyorsa hareket, son ~3 sn'lik yer değiştirmeden anlaşılır (tek parçadaki titreşim yanıltır)
export const MIN_SHOW_KM = 0.3; // ortalama ancak bu kadar yol ...
export const MIN_SHOW_MS = 60_000; // ... ve bu kadar sürüş süresinden sonra gösterilir (ilk saniyelerin oynaklığı gösterilmez)
export const PARK_RESET_MS = 20 * 60_000; // sürüş oturumu: bu kadar duruş ya da konumsuz süre yeni sürüş demektir
export const SHORT_STOP_MS = 3 * 60_000; // bu süreye kadar duruş (kırmızı ışık, trafik) ortalamaya girer; daha uzunu (şarj, park) girmez

/**
 * Saf çekirdek (test edilebilir, zaman parametreyle verilir).
 * fix({ lat, lon, ts, acc, speedKmh }, now) → 'start' | 'move' | 'stop' | 'gap' | 'reject'
 *   ts: konumun GPS zaman damgası (ms), now: alındığı duvar saati (ms), speedKmh: cihazın bildirdiği hız (yoksa null).
 * gap(): dışarıdan bilinen boşluk (driveGuard: arka plan dönüşü); sonraki konum çapa olur.
 * reset(now): oturumu sıfırla. snapshot() → { kmh, overallKmh, km, movingMs, stoppedMs, gapMs, startedAt }
 */
export function createTripAvg({ parkResetMs = null } = {}) {
  let km = 0, movingMs = 0, stoppedMs = 0, gapMs = 0, gaps = 0;
  let waitMs = 0, runMs = 0; // ortalamaya giren kısa beklemeler; süren (henüz bitmemiş) duruşun uzunluğu
  let startedAt = null;
  let anchor = null; // { lat, lon, ts, at (duvar saati), acc }
  let recent = []; // son kabul edilen konumlar (hareket penceresi), boşlukta temizlenir
  let rejects = 0;
  let stillRunMs = 0; // kesintisiz duruş süresi (park algısı)
  let pendingReset = false; // park oldu: sonraki harekette oturum sıfırlanır

  const clear = (now) => { km = movingMs = stoppedMs = gapMs = gaps = waitMs = runMs = 0; startedAt = now ?? null; stillRunMs = 0; pendingReset = false; };
  const closeRun = () => { if (runMs > 0 && runMs <= SHORT_STOP_MS) waitMs += runMs; runMs = 0; }; // biten duruş kısaysa bekleme sayılır
  const anchorAt = (p, now, fresh = false) => {
    anchor = { lat: p.lat, lon: p.lon, ts: p.ts, at: now, acc: p.acc ?? null };
    rejects = 0;
    recent = fresh ? [anchor] : [...recent.filter((q) => p.ts - q.ts <= 2 * MOVE_WINDOW_MS), anchor];
  };

  const movedNet = (p) => {
    const ref = recent.find((q) => p.ts - q.ts >= MOVE_WINDOW_MS) ?? recent[0];
    if (!ref || p.ts <= ref.ts) return false;
    const m = haversineKm(ref, p) * 1000;
    const noiseM = Math.max(10, Math.max(ref.acc ?? 0, p.acc ?? 0));
    return m >= noiseM && m / 1000 / ((p.ts - ref.ts) / 3600e3) >= MOVE_KMH;
  };

  return {
    reset(now) { clear(now); anchor = null; rejects = 0; recent = []; },
    gap() { closeRun(); anchor = null; rejects = 0; recent = []; },

    fix(p, now) {
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.ts)) return 'reject';
      if (Number.isFinite(p.acc) && p.acc > MAX_ACC_M) return 'reject';
      if (now - p.ts > MAX_FIX_AGE_MS) return 'reject'; // eski (önbellek / arka planda biriken kuyruk) konum
      if (anchor && p.ts <= anchor.ts) return 'reject'; // yinelenen ya da geriye giden zaman damgası
      if (startedAt == null) startedAt = now;
      if (!anchor) { anchorAt(p, now, true); return 'start'; }

      const dt = p.ts - anchor.ts;
      const wall = now - anchor.at;
      if (dt > MAX_SEG_MS || Math.abs(wall - dt) > CLOCK_SLACK_MS) {
        closeRun();
        gaps++;
        gapMs += Math.max(dt, wall);
        if (parkResetMs != null && Math.max(dt, wall) >= parkResetMs) pendingReset = true;
        anchorAt(p, now, true);
        return 'gap';
      }
      const dKm = haversineKm(anchor, p);
      const implied = dKm / (dt / 3600e3);
      if (implied > MAX_JUMP_KMH) {
        if (++rejects >= JUMP_REANCHOR) { closeRun(); gaps++; anchorAt(p, now, true); return 'gap'; } // çapa sıçramış olabilir: yeniden başla
        return 'reject';
      }
      // Hareket: cihazın bildirdiği hız varsa o karar verir (duran araçta konum titrer, ima edilen hız yanıltır);
      // yoksa son ~3 sn'deki net yer değiştirme doğruluk gürültüsünü aşmalı (ileri geri titreşim net yol üretmez).
      const moving = Number.isFinite(p.speedKmh) ? p.speedKmh >= MOVE_KMH : movedNet(p);
      anchorAt(p, now);
      if (!moving) {
        stoppedMs += dt;
        runMs += dt;
        stillRunMs += dt;
        if (parkResetMs != null && stillRunMs >= parkResetMs) pendingReset = true;
        return 'stop';
      }
      if (pendingReset) clear(now - dt); // park sonrası ilk hareket: yeni sürüş bu parçayla başlar
      closeRun();
      stillRunMs = 0;
      km += dKm;
      movingMs += dt;
      return 'move';
    },

    snapshot() {
      const ready = km >= MIN_SHOW_KM && movingMs >= MIN_SHOW_MS && !pendingReset;
      const total = movingMs + stoppedMs;
      const waited = waitMs + (runMs <= SHORT_STOP_MS ? runMs : 0); // şu an ışıkta beklenen süre de sayılır; uzun duruş (şarj, park) sayılmaz
      const counted = movingMs + waited;
      return {
        kmh: ready ? km / (counted / 3600e3) : null,
        movingKmh: ready ? km / (movingMs / 3600e3) : null,
        overallKmh: ready && total > 0 ? km / (total / 3600e3) : null,
        km, movingMs, stoppedMs, waitMs: waited, gapMs, gaps, startedAt, parked: pendingReset,
      };
    },
  };
}

// ---- Uygulama örnekleri: gps.js taze konumları besler, panel (ui/avgSpeedView.js) okur -----------------------------------
export const driveTrip = createTripAvg({ parkResetMs: PARK_RESET_MS });
export const navTrip = createTripAvg();
let navOn = false;

/** Navigasyon açıldı/kapandı: açılış oturumu sıfırlar; kapanınca sayaç donar (gösterilen değer korunur). */
export function setNavTrip(active, now = Date.now()) {
  if (active && !navOn) navTrip.reset(now);
  navOn = !!active;
}

/** gps.js: driveGuard'ın taze saydığı her konum. gap=true: bu konum arka plan/GPS boşluğunu kapattı (öncesiyle birleştirilmez). */
export function tripFix(p, now, { gap = false } = {}) {
  if (gap) { driveTrip.gap(); navTrip.gap(); }
  driveTrip.fix(p, now);
  if (navOn) navTrip.fix(p, now);
}
