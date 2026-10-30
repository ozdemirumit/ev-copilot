/**
 * Sıçrama (outlier) filtresi — pil yüzdesi ve ekran hızı için.
 *
 * Kural: bir okuma, son geçerli değerden 5 sn'de `maxJump`'tan fazla saparsa reddedilir ve son geçerli değer korunur.
 * İki ek güvenlik (kilitlenmeyi önlemek için):
 *  - Okumalar arası süre 5 sn'den uzunsa izin verilen sapma süreyle orantılı büyür.
 *  - Ardışık `resyncCount` okuma birbiriyle ±1 içinde tutarlıysa, bu yeni gerçek kabul edilir
 *    (ilk okuma yanlışsa veya kamera uzun süre kapalı kaldıysa referans düzelir).
 */
export function createFilter({ maxJump = 2, windowMs = 5000, resyncCount = 3, min = 0, max = 100 } = {}) {
  let last = null; // { value, t }
  let pending = []; // reddedilen ama birbirine yakın okumalar

  function accept(value, t = Date.now()) {
    if (!Number.isInteger(value) || value < min || value > max) {
      return { ok: false, reason: 'range', value: last?.value ?? null };
    }
    if (!last) {
      last = { value, t };
      return { ok: true, reason: 'first', value };
    }

    const allowed = maxJump * Math.max(1, (t - last.t) / windowMs);
    if (Math.abs(value - last.value) <= allowed) {
      last = { value, t };
      pending = [];
      return { ok: true, reason: 'ok', value };
    }

    pending.push(value);
    if (pending.length > resyncCount) pending.shift();
    if (pending.length === resyncCount && Math.max(...pending) - Math.min(...pending) <= 1) {
      last = { value, t };
      pending = [];
      return { ok: true, reason: 'resync', value };
    }
    return { ok: false, reason: 'jump', value: last.value };
  }

  /** Manuel kalibrasyon veya dış kaynak: referansı doğrudan ayarla. */
  function reset(value = null, t = Date.now()) {
    last = value == null ? null : { value, t };
    pending = [];
  }

  return { accept, reset, get last() { return last?.value ?? null; } };
}

export const createSocFilter = createFilter;
