// Fiyat defteri: kullanıcıların bildirdiği gerçek kWh fiyatları (ör. şarj bitince ödenen tutar / kWh) sunucuda tutulur. Resmî canlı fiyat kaynağı
// olmayan yerlerde (Türkiye) istasyon başına "son bilinen" fiyatı verir. Konum ~100 m'lik hücrelere ayrılır (komşu hücreler de aranır);
// bir hücrede son 5 bildirimin medyanı (90 günden eskiler sayılmaz) kullanılır. Aynı kullanıcı aynı hücre için günde bir kez bildirebilir.
const CELL = 3; // ondalık basamak (≈ 100 m)
const KEEP = 5;
const MAX_AGE_MS = 90 * 86400e3;

const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cell = (lat, lon) => `${lat.toFixed(CELL)},${lon.toFixed(CELL)}`;

export function createPriceBook(store) {
  const data = () => (store.data.prices ||= {});
  const prune = (e) => { e.reports = e.reports.filter((r) => Date.now() - r.at < MAX_AGE_MS).slice(-KEEP); return e; };

  /** Fiyat bildir. Dönüş: { ok } ya da { error }. */
  function report(userId, { lat, lon, kwh, currency }) {
    if (![lat, lon, kwh].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'geçersiz' };
    if (kwh < 0.05 || kwh > 100) return { error: 'fiyat aralık dışı' };
    const cur = /^[A-Z]{3}$/.test(String(currency)) ? currency : 'TRY';
    const k = cell(lat, lon);
    const e = (data()[k] ||= { lat, lon, reports: [] });
    e.reports = e.reports.filter((r) => !(r.by === userId && Date.now() - r.at < 86400e3)); // günde bir kez: yenisi eskisinin yerine geçer
    e.reports.push({ kwh: Math.round(kwh * 100) / 100, currency: cur, at: Date.now(), by: userId });
    prune(e);
    store.save();
    return { ok: true };
  }

  /** İstasyonun çevresindeki (≈ 100-150 m) son bilinen fiyat: { kwh, currency, n, at } ya da null. */
  function nearest(st) {
    const d = 10 ** -CELL;
    let best = null;
    for (const dy of [0, -d, d]) {
      for (const dx of [0, -d, d]) {
        const e = data()[cell(st.lat + dy, st.lon + dx)];
        if (!e) continue;
        const rs = e.reports.filter((r) => Date.now() - r.at < MAX_AGE_MS);
        if (!rs.length) continue;
        const at = Math.max(...rs.map((r) => r.at));
        if (!best || at > best.at) best = { kwh: Math.round(med(rs.map((r) => r.kwh)) * 100) / 100, currency: rs.at(-1).currency, n: rs.length, at };
      }
    }
    return best;
  }
  /** Bir kullanıcının bildirimlerini sil (hesap silme). */
  function forget(userId) {
    for (const e of Object.values(data())) e.reports = e.reports.filter((r) => r.by !== userId);
    store.save();
  }
  return { report, nearest, forget };
}
