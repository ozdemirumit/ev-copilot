// Sürüş ölçümü koruması: sayfa arka plana geçince (iPhone iOS Chrome/Safari'de zamanlayıcılar ve GPS durur) ya da GPS bir süre
// susunca, menzil motoru son bilinen hızla mesafe/enerji toplamaya devam etmesin. Boşluk sonrası ilk taze konum gelene kadar hiçbir
// şey toplanmaz; tüketim ölçüm pencereleri (consumption.js, history.js) bozulmasın diye boşlukta kırılır. Boşlukta gidilen yol
// bilinmez: taze konum gelince boşluğun iki ucu arasındaki kuş uçuşu mesafe (gerçek yolun alt sınırı) yalnızca tahmini pil için
// kullanılır (gerçek ölçüm/öğrenmeye girmez). Arka planda kesintisiz ölçüm vaat edilmez: tarayıcı sayfayı durdurabilir.
import { haversineKm } from '../utils/geo.js';

export const STEP_GAP_MS = 4000; // iki menzil adımı arası bundan uzunsa zamanlayıcı durmuş demektir (normalde 1 sn)
export const STALE_FIX_MS = 8000; // bu kadar süredir konum gelmiyorsa hız bilinmiyor sayılır (kısa tünelde son hızla devam edilir)
export const FRESH_SKEW_MS = 2000; // dönüşte gelen konumun zaman damgası, dönüş anından en çok bu kadar eski olabilir
export const MAX_CATCHUP_KMH = 200; // boşluk sonrası kuş uçuşu mesafe bu ortalama hızı aşarsa GPS sıçraması sayılır, kullanılmaz
export const MIN_CATCHUP_KM = 0.05;

/**
 * Saf çekirdek (test edilebilir): zaman parametreyle verilir.
 * step(t, { still }): her menzil adımında çağrılır (still: son bilinen hız 0; duran araçta konum gelmemesi boşluk sayılmaz) → { integrate, dt (sn), gap } — integrate=false ise bu adımda mesafe/enerji toplanmaz;
 *   gap=true ise ölçüm pencereleri kırılmalıdır (aynı boşluk için bir kez).
 * fix({lat, lon, ts}, t): her GPS konumunda → { fresh, closed (bu konum bir boşluğu kapattı), catchup: { km, gapMs } | null }.
 */
export function createDriveGuard({ stepGapMs = STEP_GAP_MS, staleFixMs = STALE_FIX_MS } = {}) {
  let lastStep = null;
  let hidden = false;
  let resumeAt = 0;
  let awaiting = false; // dönüşten sonra taze konum bekleniyor
  let fixesSinceResume = 0;
  let lastFixAt = null; // son taze konumun alındığı an (duvar saati)
  let lastGood = null; // son toplanan (boşluk öncesi) konum: { lat, lon, t }
  let gapOpen = false; // açık boşluk: pencereler kırıldı, kapanınca (taze konum) kuş uçuşu hesap yapılır
  let gapSince = null;
  let mustBreak = false; // boşluk açıldı (hide/show/adım/GPS), pencerelerin kırılması sonraki adımda bir kez bildirilir

  const openGap = (t) => {
    if (gapOpen) return;
    gapOpen = true;
    mustBreak = true;
    gapSince = lastFixAt ?? t;
  };
  // hide()/show() olaylarda boşluk açar ama pencereleri kıran menzil adımıdır: bildirim kaybolmasın diye bekletilir
  const takeBreak = () => { const b = mustBreak; mustBreak = false; return b; };

  return {
    hide(t) { if (!hidden) { hidden = true; openGap(t); } },
    show(t) {
      if (!hidden && !gapOpen) { lastStep = t; return; } // zaten görünür
      hidden = false;
      resumeAt = t;
      awaiting = true;
      fixesSinceResume = 0;
      lastStep = t; // dönüş anına kadar geçen süre hiçbir adıma yazılmaz
      openGap(t);
    },
    get hidden() { return hidden; },
    get open() { return gapOpen; },

    step(t, { still = false } = {}) {
      const ms = lastStep == null ? 1000 : t - lastStep;
      lastStep = t;
      const stop = () => ({ integrate: false, dt: 0, gap: takeBreak() });
      if (hidden) { openGap(t); return stop(); }
      if (!(ms >= 0) || ms > stepGapMs) { openGap(t); return stop(); } // zamanlayıcı durmuş/saat geri
      if (awaiting) return stop();
      if (lastFixAt != null && t - lastFixAt > staleFixMs && !still) { openGap(t); return stop(); } // GPS sustu (iOS duran araçta konum göndermeyebilir: o boşluk değildir)
      if (gapOpen) return stop(); // taze konum bekleniyor (fix kapatır)
      return { integrate: true, dt: ms / 1000, gap: takeBreak() }; // boşluk adım gelmeden kapandıysa kırma yine yapılır
    },

    fix(p, t) {
      if (hidden) return { fresh: false, closed: false, catchup: null };
      if (awaiting) {
        fixesSinceResume++;
        // Dönüşteki ilk konum önbellekten (eski) gelebilir: zaman damgası dönüşten yeni olan ya da dönüşten sonraki ikinci konum taze sayılır
        const fresh = (Number.isFinite(p.ts) && p.ts >= resumeAt - FRESH_SKEW_MS) || fixesSinceResume >= 2;
        if (!fresh) return { fresh: false, closed: false, catchup: null };
        awaiting = false;
      }
      let catchup = null;
      const closed = gapOpen;
      if (gapOpen) {
        gapOpen = false;
        if (lastGood) {
          const km = haversineKm(lastGood, p);
          const hours = Math.max(1, t - (gapSince ?? lastGood.t)) / 3600e3;
          if (km >= MIN_CATCHUP_KM && km / hours <= MAX_CATCHUP_KMH) catchup = { km, gapMs: t - (gapSince ?? lastGood.t) };
        }
        lastStep = t; // boşluk süresi sonraki adıma yazılmasın
      }
      lastFixAt = t;
      lastGood = { lat: p.lat, lon: p.lon, t };
      return { fresh: true, closed, catchup };
    },

    /** Son taze konum bu kadar ms önce mi alındı? (null: hiç) */
    fixAge(t) { return lastFixAt == null ? null : t - lastFixAt; },
  };
}

// ---- Uygulama örneği: sayfa yaşam döngüsü olaylarına bağlı tek koruma -----------------------------------------------------
export const guard = createDriveGuard();
const listeners = new Set();
/** Boşluk kapanınca (taze konum) kuş uçuşu tahmini dinleyicisi: fn({ km, gapMs }). */
export const onCatchup = (fn) => listeners.add(fn);
export const emitCatchup = (c) => listeners.forEach((fn) => { try { fn(c); } catch (err) { console.warn(err); } });

let wired = false;
/**
 * visibilitychange / pagehide / pageshow / freeze / resume / focus: iOS'ta arka plan için en güvenilir işaret visibilitychange + pagehide.
 * iPhone Chrome dönüşte bazen yalnızca focus ya da pageshow (bfcache) gönderir; show() zaten görünürken bir şey yapmaz, tekrar güvenlidir.
 */
export function initDriveGuard() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  const sync = () => (document.visibilityState === 'hidden' ? guard.hide(Date.now()) : guard.show(Date.now()));
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('freeze', () => guard.hide(Date.now()));
  document.addEventListener('resume', sync);
  window.addEventListener('pagehide', () => guard.hide(Date.now()));
  window.addEventListener('pageshow', sync);
  window.addEventListener('focus', sync);
  if (document.visibilityState === 'hidden') guard.hide(Date.now());
}
