// G2a sunucu kota yardımcıları (Q-SRV-2 / Q-SRV-3). Saf: ağ, ortam değişkeni, anahtar yok; depo (server/store.mjs) dışarıdan verilir.
// Kota DEĞERİ burada yoktur: varsayılanlar çağıran yerde (server/proxy.mjs) kaynaktaki eski değerlerdir.
import { parseCap } from './mapboxGate.mjs';

/**
 * Aylık sağlayıcı sınırı metni → { cap, valid }. Boş/tanımsız: kaynaktaki varsayılan (eski politika korunur). Yalnız rakam: o sınır
 * (0 = hiç istek yok). Başka her değer geçersizdir ve cap 0 olur (fail-closed): yanlış yazılmış sınır faturayı sınırsız açmaz (eskiden NaN → açık).
 */
export function parseMonthlyCap(raw, def) {
  const r = parseCap(raw);
  return r.cap == null ? { cap: def, valid: true } : r;
}

/**
 * Kullanıcı başına günlük istek sayacı, depo verisinde (db.json → dailyUsage = { day: 'YYYY-AA-GG' (UTC), counts: { 'anahtar|tür': n } }).
 * Sunucu yeniden başlasa da o günün sayısı korunur; gün değişince sayaç sıfırlanır (eski gün kaydı atılır). Kayıt store.save() ile
 * gecikmeli yazılır (server/store.mjs: 800 ms; düzgün kapanışta hemen). Bozuk kayıt sunucuyu düşürmez: o girdi 0 sayılır.
 * Kişisel veri: yalnız hesap kimliği (ya da 'code') ve sayı; adres (IP) yok.
 */
export function createDailyUsage(store, { now = () => Date.now() } = {}) {
  const day = () => new Date(now()).toISOString().slice(0, 10);
  const cur = () => {
    const d = day();
    let u = store.data.dailyUsage;
    if (!u || typeof u !== 'object' || u.day !== d || !u.counts || typeof u.counts !== 'object' || Array.isArray(u.counts)) {
      u = store.data.dailyUsage = { day: d, counts: {} };
    }
    return u.counts;
  };
  const val = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
  return {
    get: (key, kind) => val(cur()[`${key}|${kind}`]),
    add(key, kind) {
      const c = cur();
      const k = `${key}|${kind}`;
      c[k] = val(c[k]) + 1;
      store.save();
      return c[k];
    },
    /** Bugünkü [anahtar, tür, sayı] listesi (yönetim özeti için). */
    entries: () => Object.entries(cur()).map(([k, n]) => { const i = k.lastIndexOf('|'); return [k.slice(0, i), k.slice(i + 1), val(n)]; }).filter(([, , n]) => n > 0),
  };
}
