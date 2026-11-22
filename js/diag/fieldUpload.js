// Saha testi özetinin otomatik yüklenmesi (v0.99.125). SAF çekirdek: ağ/DOM/depolama/zaman doğrudan okunmaz, hepsi enjekte edilir.
// Özet js/diag/fieldLog.js reportJson() çıktısıdır (yalnız SAYILAR: konum, adres, konuşma metni, ham OCR değeri yoktur). Özetler birikimlidir:
// sonraki özet öncekinin yerine geçer, bu yüzden tek bir "bekleyen" özet tutulur. Ağ hatasında üstel geri çekilme; sunucu reddederse (4xx) düşürülür ve durulur.
// Kullanıcı hata günlüğünü kapatınca bekleyen özet silinir ve hiçbir şey gönderilmez (enabled()).
import { byteLen } from './clientLog.js';

export const FIELD_UPLOAD = Object.freeze({
  schema: 'evrf-field-report/1', // fieldLog.js REPORT_SCHEMA ile aynı (testle doğrulanır)
  maxBodyBytes: 14000,
  minIntervalMs: 120_000, // zorlanmayan (periyodik/arka plan) gönderimler arası en az süre
  backoffBaseMs: 30_000,
  backoffMaxMs: 600_000,
  blockMs: 1_800_000,
  retryAfterMaxSec: 3600,
  dropStatuses: Object.freeze([400, 401, 403, 404, 413]),
});
export const PENDING_KEY = 'fieldUploadQ';

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Gönderilecek bir şey var mı: hiç OCR okuması, sesli uyarı, navigasyon, hata, kamera olayı ya da planlama yoksa boş sayılır. */
export function isEmptyReport(r) {
  const s = r?.summary;
  if (!isObj(s)) return true;
  const n = (x) => (typeof x === 'number' && x > 0 ? x : 0);
  return !(n(s.ocr?.reads) || n(s.ocr?.unreadable) || n(s.spoken?.total) || n(s.nav?.sessions) || n(s.errors?.total) || n(s.camera?.lost) || n(s.camera?.recovered) || n(s.plans));
}

/**
 * createFieldUpload({ now, send, storage, info, enabled })
 *  send(body) → Promise<{status, retryAfterSec?}> (ağ hatasında reddeder) · storage {get,set} · info() → client nesnesi · enabled() → boolean
 */
export function createFieldUpload({ now, send, storage, info, enabled }) {
  let pending = null; // { report, at }
  let lastSentAt = 0;
  let fails = 0;
  let backoffUntil = 0;
  let blockedUntil = 0;
  let inflight = null;
  const st = { sent: 0, dropped: 0, failed: 0 };

  const persist = () => { try { storage.set(PENDING_KEY, pending); } catch { /* depo dolu/yok: bellekte kalır */ } };
  const clear = () => { pending = null; persist(); };

  function restore() {
    try {
      const v = storage.get(PENDING_KEY);
      if (isObj(v) && isObj(v.report) && v.report.schema === FIELD_UPLOAD.schema) pending = { report: v.report, at: Number(v.at) || 0 };
    } catch { /* bozuk depo yok sayılır */ }
  }

  const backoff = (extraSec) => {
    fails++;
    const exp = Math.min(FIELD_UPLOAD.backoffMaxMs, FIELD_UPLOAD.backoffBaseMs * 2 ** (fails - 1));
    const ra = Number.isFinite(extraSec) && extraSec > 0 ? Math.min(extraSec, FIELD_UPLOAD.retryAfterMaxSec) * 1000 : 0;
    backoffUntil = now() + Math.max(exp, ra);
  };

  async function flush({ force = false } = {}) {
    if (!enabled()) { if (pending) clear(); return { skipped: 'disabled' }; }
    if (!pending) return { skipped: 'empty' };
    const t = now();
    if (t < blockedUntil) return { skipped: 'blocked' };
    if (t < backoffUntil) return { skipped: 'backoff' };
    if (!force && lastSentAt && t - lastSentAt < FIELD_UPLOAD.minIntervalMs) return { skipped: 'interval' };
    if (inflight) return inflight;
    const item = pending;
    inflight = (async () => {
      let body;
      try { body = { ...item.report, client: info() }; } catch { body = { ...item.report }; }
      if (byteLen(JSON.stringify(body)) > FIELD_UPLOAD.maxBodyBytes) { clear(); st.dropped++; return { skipped: 'too-big' }; }
      let res;
      try { res = await send(body); } catch { st.failed++; backoff(); return { skipped: 'network' }; }
      const status = Number(res?.status) || 0;
      if (status >= 200 && status < 300) {
        fails = 0; backoffUntil = 0; lastSentAt = now(); st.sent++;
        if (pending === item) clear(); // gönderim sürerken daha yeni bir özet geldiyse o kalır
        return { sent: true, status };
      }
      if (FIELD_UPLOAD.dropStatuses.includes(status)) {
        st.dropped++; blockedUntil = now() + FIELD_UPLOAD.blockMs;
        if (pending === item) clear();
        return { skipped: 'rejected', status };
      }
      st.failed++; backoff(res?.retryAfterSec); // 429, 5xx, 408, 3xx
      return { skipped: 'retry', status };
    })().finally(() => { inflight = null; });
    return inflight;
  }

  /** Güncel özeti bekleyen yap (öncekinin yerine geçer) ve gönder. force: kayıt durdu / sürüş bitti → aralık sınırı uygulanmaz. */
  function submit(report, { force = false } = {}) {
    if (!enabled()) { if (pending) clear(); return Promise.resolve({ skipped: 'disabled' }); }
    if (!isObj(report) || report.schema !== FIELD_UPLOAD.schema || isEmptyReport(report)) return Promise.resolve({ skipped: 'empty' });
    pending = { report, at: now() };
    persist();
    return flush({ force });
  }

  return { submit, flush, restore, clear, pending: () => (pending ? { at: pending.at } : null), state: () => ({ ...st, queued: pending ? 1 : 0, backoffUntil, blockedUntil, lastSentAt }) };
}
