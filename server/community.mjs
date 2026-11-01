// Topluluk doluluğu (resmî canlı veri olmayan yerler, ör. Türkiye): kullanıcılar bir istasyonda şarj etmeye başlayınca/bitirince uygulama
// "varlık" bildirir; ayrıca kullanıcı "Dolu / Boş" bildirebilir. Konum ~100 m hücrelere ayrılır (komşu hücreler birlikte bakılır).
// Özet: { busy: şu an şarj eden kullanıcı sayısı, report: { status: 'full'|'free', at } (son 60 dk) }. Kullanıcı kimlikleri yalnızca tekrarı
// önlemek için içeride tutulur, dışarı verilmez; hesap silinince (forget) hepsi silinir.
const CELL = 3;
const ACTIVE_MS = 3 * 3600e3; // "bitti" gelmezse (uygulama kapandı) bir varlık bu süre sonra düşer
const REPORT_MS = 60 * 60e3;
const REPORT_COOLDOWN_MS = 10 * 60e3;
const KEEP_REPORTS = 10;

const cellKey = (lat, lon) => `${lat.toFixed(CELL)},${lon.toFixed(CELL)}`;
const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

export function createCommunity(store) {
  const cells = () => (store.data.community ||= {});
  const cellOf = (p) => (cells()[cellKey(p.lat, p.lon)] ||= { active: {}, reports: [] });

  /** Şarj başladı / bitti. state: 'start' | 'stop'. */
  function presence(userId, { lat, lon, state }) {
    const p = { lat: Number(lat), lon: Number(lon) };
    if (!valid(p) || !['start', 'stop'].includes(state)) return { error: 'geçersiz' };
    const c = cellOf(p);
    if (state === 'start') c.active[userId] = Date.now();
    else delete c.active[userId];
    store.save();
    return { ok: true };
  }

  /** Dolu / Boş bildirimi (aynı kullanıcı aynı hücreye 10 dakikada bir). */
  function report(userId, { lat, lon, status }) {
    const p = { lat: Number(lat), lon: Number(lon) };
    if (!valid(p) || !['full', 'free'].includes(status)) return { error: 'geçersiz' };
    const c = cellOf(p);
    const last = c.reports.findLast?.((r) => r.by === userId);
    if (last && Date.now() - last.at < REPORT_COOLDOWN_MS) return { error: 'çok sık' };
    c.reports.push({ status, at: Date.now(), by: userId });
    c.reports = c.reports.slice(-KEEP_REPORTS);
    store.save();
    return { ok: true };
  }

  /** İstasyon çevresi (≈ 100-150 m) özeti ya da null (hiç veri yoksa). */
  function summary(st) {
    const d = 10 ** -CELL;
    let busy = 0;
    let rep = null;
    const now = Date.now();
    for (const dy of [0, -d, d]) {
      for (const dx of [0, -d, d]) {
        const c = cells()[cellKey(st.lat + dy, st.lon + dx)];
        if (!c) continue;
        busy += Object.values(c.active).filter((t) => now - t < ACTIVE_MS).length;
        for (const r of c.reports) if (now - r.at < REPORT_MS && (!rep || r.at > rep.at)) rep = { status: r.status, at: r.at };
      }
    }
    return busy || rep ? { busy, report: rep } : null;
  }

  /** Bir kullanıcının tüm topluluk verisini sil (hesap silme). */
  function forget(userId) {
    for (const c of Object.values(cells())) {
      delete c.active[userId];
      c.reports = c.reports.filter((r) => r.by !== userId);
    }
    store.save();
  }

  // eski varlıkları ve boş hücreleri ayıkla
  const prune = () => {
    const now = Date.now();
    for (const [k, c] of Object.entries(cells())) {
      for (const [u, t] of Object.entries(c.active)) if (now - t >= ACTIVE_MS) delete c.active[u];
      c.reports = c.reports.filter((r) => now - r.at < 24 * 3600e3);
      if (!Object.keys(c.active).length && !c.reports.length) delete cells()[k];
    }
  };
  setInterval(prune, 30 * 60e3).unref();

  return { presence, report, summary, forget, _prune: prune };
}
