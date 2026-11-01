// Kullanıcı başına ücretli dış çağrı kaydı (şimdilik Google Places): gün gün çağrı sayısı ve tahmini maliyet (USD). db.json içinde kalıcıdır
// (günlük yedeklere girer). Birim fiyat GOOGLE_COST_PER_CALL_USD ile ayarlanır (varsayılan 0.035: Places Nearby Search, Enterprise katmanı
// ~35 USD / 1000 çağrı; Google fiyatı değiştirirse .env'den güncelle, geçmiş kayıtlar çağrı sayısından yeniden hesaplanır).
// Hesap silinince kişiye bağlı kayıt silinir, toplamlar anonim "_silinen" kovasına eklenir (maliyet geçmişi bozulmasın).
const KEEP_DAYS = 400;
const day = () => new Date().toISOString().slice(0, 10);

export function createCosts(store, env = {}) {
  const unit = Number(env.GOOGLE_COST_PER_CALL_USD) > 0 ? Number(env.GOOGLE_COST_PER_CALL_USD) : 0.035;
  const book = () => (store.data.costs ||= {}); // anahtar (kullanıcı id'si ya da 'code') → { total: {google}, days: { 'YYYY-AA-GG': {google} } }

  /** Bir ücretli çağrı kaydet. who: kullanıcı kimliği (id nesnesi). */
  function add(who, kind = 'google', n = 1) {
    const key = who?.kind === 'user' ? who.user.id : 'code';
    const rec = (book()[key] ||= { total: {}, days: {} });
    const d = (rec.days[day()] ||= {});
    d[kind] = (d[kind] || 0) + n;
    rec.total[kind] = (rec.total[kind] || 0) + n;
    const old = Object.keys(rec.days).sort();
    while (old.length > KEEP_DAYS) delete rec.days[old.shift()];
    store.save();
  }

  const usd = (calls) => Math.round(calls * unit * 10000) / 10000;

  /** { today, month, total } çağrı ve USD (anahtar yoksa sıfır). */
  function summary(uid) {
    const rec = book()[uid];
    const g = (o) => o?.google || 0;
    const t = day();
    const month = Object.entries(rec?.days || {}).filter(([k]) => k.slice(0, 7) === t.slice(0, 7)).reduce((s, [, v]) => s + g(v), 0);
    const calls = { today: g(rec?.days?.[t]), month, total: g(rec?.total) };
    return { calls, usd: { today: usd(calls.today), month: usd(calls.month), total: usd(calls.total) } };
  }

  function forget(uid) {
    const rec = book()[uid];
    if (!rec) return;
    const sink = (book()._silinen ||= { total: {}, days: {} });
    for (const [k, v] of Object.entries(rec.total)) sink.total[k] = (sink.total[k] || 0) + v;
    for (const [dk, dv] of Object.entries(rec.days)) { const s = (sink.days[dk] ||= {}); for (const [k, v] of Object.entries(dv)) s[k] = (s[k] || 0) + v; }
    delete book()[uid];
    store.save();
  }

  /** Yönetici raporu için tüm kayıt anahtarları (kullanıcı id'leri, 'code', '_silinen'). */
  const keys = () => Object.keys(book());

  return { add, summary, forget, keys, unit };
}
