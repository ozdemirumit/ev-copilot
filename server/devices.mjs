// Cihaz kimliği: giriş yapmamış kullanıcıya uygulama rastgele bir kimlik (d_...) üretir ve X-Device-Id başlığında yollar.
// Sunucu bu kimlikle anonim cihazı sayar (ilk/son görülme, istek sayısı, etkin gün) ve istek sınırını IP'ye ek olarak cihaza da uygular.
// Kullanıcı giriş yapınca cihaz hesaba bağlanır (kimlik hesabın kimliğiyle değişir); anonim listeden çıkar, kullanıcı satırında görünür.
// IP adresi saklanmaz. Hesap silinince ona bağlı cihaz kayıtları da silinir. Kayıtlar server/data/db.json içinde "devices" altında durur.
const ID = /^d_[A-Za-z0-9_-]{16,40}$/;
const MAX_DEVICES = 20000;
const NEW_PER_IP_HOUR = 20; // bir adresten saatte açılabilecek yeni cihaz kaydı (kimlik uydurarak veritabanını şişirmeyi önler)
const STALE_MS = 90 * 86400e3;
const day = () => new Date().toISOString().slice(0, 10);
const clean = (s, n) => String(s ?? '').replace(/[^A-Za-z0-9._ -]/g, '').slice(0, n);

export function createDevices(store) {
  const book = () => (store.data.devices ||= {});
  const fresh = new Map(); // ip → { hour, n }

  setInterval(() => { const h = Math.floor(Date.now() / 3600e3); for (const [k, v] of fresh) if (v.hour < h) fresh.delete(k); }, 3600e3).unref();

  const valid = (id) => (typeof id === 'string' && ID.test(id) ? id : null);

  function prune() {
    const b = book();
    const cut = Date.now() - STALE_MS;
    for (const [k, r] of Object.entries(b)) if (!r.linked?.length && r.lastSeen < cut) delete b[k];
  }

  function create(id, ip) {
    const b = book();
    const hour = Math.floor(Date.now() / 3600e3);
    const f = fresh.get(ip);
    if (!f || f.hour !== hour) fresh.set(ip, { hour, n: 1 });
    else if (++f.n > NEW_PER_IP_HOUR) return null;
    if (Object.keys(b).length >= MAX_DEVICES) { prune(); if (Object.keys(b).length >= MAX_DEVICES) return null; }
    b[id] = { id, firstSeen: Date.now(), lastSeen: Date.now(), hits: 0, days: 0, lastDay: '', linked: [] };
    return b[id];
  }

  /** Anonim ya da bağlı cihaz sunucuya uğradı (uygulama açılışı). Dönüş: kayıt ya da null (geçersiz kimlik / sınır). */
  function touch(rawId, ip, meta = {}) {
    const id = valid(rawId);
    if (!id) return null;
    const r = book()[id] || create(id, ip);
    if (!r) return null;
    r.hits += 1;
    r.lastSeen = Date.now();
    if (r.lastDay !== day()) { r.lastDay = day(); r.days += 1; }
    if (meta.app) r.app = clean(meta.app, 16);
    if (meta.platform) r.platform = clean(meta.platform, 12);
    store.save();
    return r;
  }

  /** Cihazı hesaba bağla (giriş anı ya da hesaplı bir isteğin başlığı). Kayıt yoksa oluşturulur. */
  function link(rawId, uid, ip = '?') {
    const id = valid(rawId);
    if (!id || !uid) return false;
    const r = book()[id] || create(id, ip);
    if (!r) return false;
    if (r.linked.at(-1) === uid) return true;
    r.linked = [...r.linked.filter((x) => x !== uid), uid].slice(-5);
    r.linkedAt = Date.now();
    store.save();
    return true;
  }

  /** Hesap silindi: ona bağlı kayıtlar silinir (başka hesaba da bağlıysa yalnızca bu bağ kalkar). */
  function forget(uid) {
    const b = book();
    for (const [k, r] of Object.entries(b)) {
      if (!r.linked.includes(uid)) continue;
      r.linked = r.linked.filter((x) => x !== uid);
      if (!r.linked.length) delete b[k];
    }
    store.save();
  }

  const forUser = (uid) => Object.values(book()).filter((r) => r.linked.includes(uid));

  /** Yönetim paneli için: anonim (hiçbir hesaba bağlı olmayan) ve bağlı cihazlar. */
  function list(emailOf) {
    return Object.values(book())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, 1000)
      .map((r) => ({ id: r.id, firstSeen: r.firstSeen, lastSeen: r.lastSeen, hits: r.hits, days: r.days, app: r.app || null, platform: r.platform || null, linkedAt: r.linkedAt || null, users: r.linked.map((u) => ({ id: u, email: emailOf(u) })) }));
  }

  function stats() {
    const rows = Object.values(book());
    const week = Date.now() - 7 * 86400e3;
    const anon = rows.filter((r) => !r.linked.length);
    return { total: rows.length, anonymous: anon.length, anonymousActive7d: anon.filter((r) => r.lastSeen > week).length, linked: rows.length - anon.length };
  }

  return { valid, touch, link, forget, forUser, list, stats };
}
