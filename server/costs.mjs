// Kullanıcı başına dış sağlayıcı istek kaydı: gün gün istek sayısı (db.json içinde kalıcı, günlük yedeklere girer). Yalnızca üst sunucuya GERÇEKTEN giden istekler yazılır
// (önbellek isabeti, kota/kimlik reddi yazılmaz); normal kullanıcı, yönetici hesabı ve yönetici erişim kodu ('code') dahil. Türler (KINDS):
//   google      Google Places doluluk çağrısı (ücretli; tahmini USD yalnızca bunun için)
//   here        HERE Browse: istasyon araması ve doluluk sorgusu      slimit  HERE Routing: Premium yol hız limiti
//   mapbox      Mapbox API vekili (rota, arama)                         ocm     OpenChargeMap   overpass  Overpass
//   map_mapbox, map_google  /v1/map/config harita ANAHTARI verme (gerçek harita yüklemesi değil: döşemeler tarayıcıdan doğrudan sağlayıcıya gider)
// Google birim fiyatı GOOGLE_COST_PER_CALL_USD ile ayarlanır (varsayılan 0.04: Places Nearby Search, EV alanı Enterprise + Atmosphere
// katmanında ~40 USD / 1000 çağrı, ayda ilk 1000 çağrı ücretsiz; Google fiyatı değiştirirse .env'den güncelle, geçmiş kayıtlar çağrı sayısından yeniden hesaplanır).
// Diğer sağlayıcılar için fiyat tahmini yapılmaz (kendi fatura panelleri). Hesap silinince kişiye bağlı kayıt silinir, toplamlar anonim "_silinen" kovasına eklenir.
const KEEP_DAYS = 400;
const day = () => new Date().toISOString().slice(0, 10);
export const KINDS = ['google', 'here', 'slimit', 'mapbox', 'map_mapbox', 'map_google', 'ocm', 'overpass'];

/** Kayıttaki gün sayısı KEEP_DAYS'i aşarsa en eskiler silinir. */
function prune(rec) {
  const old = Object.keys(rec.days).sort();
  while (old.length > KEEP_DAYS) delete rec.days[old.shift()];
}

export function createCosts(store, env = {}) {
  const unit = Number(env.GOOGLE_COST_PER_CALL_USD) > 0 ? Number(env.GOOGLE_COST_PER_CALL_USD) : 0.04;
  const book = () => (store.data.costs ||= {}); // anahtar (kullanıcı id'si, 'code' ya da '_silinen') → { total: {tür: n}, days: { 'YYYY-AA-GG': {tür: n} } }

  /** Bir üst sağlayıcı isteği kaydet. who: kimlik nesnesi (hesap → kullanıcı id'si, yönetici erişim kodu/belirteci → 'code'). Kayıt gecikmeli (store.save). */
  function add(who, kind = 'google', n = 1) {
    const key = who?.kind === 'user' ? who.user.id : 'code';
    const rec = (book()[key] ||= { total: {}, days: {} });
    const d = (rec.days[day()] ||= {});
    d[kind] = (d[kind] || 0) + n;
    rec.total[kind] = (rec.total[kind] || 0) + n;
    prune(rec);
    store.save();
  }

  const usd = (calls) => Math.round(calls * unit * 10000) / 10000;

  /** Bir anahtarın tür başına { today, month, total } sayıları (ay: bu takvim ayı, UTC). Kayıt yoksa sıfır. */
  function counts(uid) {
    const rec = book()[uid];
    const t = day();
    const out = {};
    for (const k of KINDS) out[k] = { today: rec?.days?.[t]?.[k] || 0, month: 0, total: rec?.total?.[k] || 0 };
    for (const [dk, dv] of Object.entries(rec?.days || {})) if (dk.slice(0, 7) === t.slice(0, 7)) for (const k of KINDS) out[k].month += dv[k] || 0;
    return out;
  }

  /** Google Places: { calls, usd } × { today, month, total } (eski biçim, değişmedi). */
  function summary(uid) {
    const calls = counts(uid).google;
    return { calls, usd: { today: usd(calls.today), month: usd(calls.month), total: usd(calls.total) } };
  }

  /** Tüm anahtarların (silinenler dahil) tür başına toplamı. */
  function totals() {
    const out = Object.fromEntries(KINDS.map((k) => [k, { today: 0, month: 0, total: 0 }]));
    for (const key of keys()) { const c = counts(key); for (const k of KINDS) for (const f of ['today', 'month', 'total']) out[k][f] += c[k][f]; }
    return out;
  }

  function forget(uid) {
    const rec = book()[uid];
    if (!rec) return;
    const sink = (book()._silinen ||= { total: {}, days: {} });
    for (const [k, v] of Object.entries(rec.total)) sink.total[k] = (sink.total[k] || 0) + v;
    for (const [dk, dv] of Object.entries(rec.days)) { const s = (sink.days[dk] ||= {}); for (const [k, v] of Object.entries(dv)) s[k] = (s[k] || 0) + v; }
    prune(sink);
    delete book()[uid];
    store.save();
  }

  /** Yönetici raporu için tüm kayıt anahtarları (kullanıcı id'leri, 'code', '_silinen'). */
  const keys = () => Object.keys(book());

  return { add, summary, counts, totals, forget, keys, unit, kinds: KINDS };
}
