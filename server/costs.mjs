// Kullanıcı başına dış sağlayıcı istek kaydı: gün gün istek sayısı (db.json içinde kalıcı, günlük yedeklere girer). Yalnızca üst sunucuya GERÇEKTEN giden istekler yazılır
// (önbellek isabeti, kota/kimlik reddi yazılmaz); normal kullanıcı, yönetici hesabı ve yönetici erişim kodu ('code') dahil.
// Zamanlama: istek GÖNDERİLİRKEN sayılır, yanıtı beklenmez; bu yüzden hata/zaman aşımı da sayılır (HERE aylık sayacı hereCount gibi). İstisna: doluluk sorgusundaki HERE ve Google çağrıları yalnızca başarılı yanıttan sonra sayılır.
// Overpass istemci isteği başına bir kez sayılır (yanıt vermeyen aynadan sonra birden çok ayna denense de). Türler (KINDS):
//   google      Google Places doluluk çağrısı (ücretli; tahmini USD yalnızca bunun için)
//   here        HERE Browse: istasyon araması ve doluluk sorgusu      slimit  HERE Routing: Premium yol hız limiti
//   mapbox      Mapbox Directions (rota; eski kayıtlarda arama da)      mapbox_search  Mapbox Search Box (istasyon araması)
//   ocm         OpenChargeMap                                           overpass  Overpass
//   map_mapbox, map_google  /v1/map/config harita ANAHTARI verme (gerçek harita yüklemesi değil: döşemeler tarayıcıdan doğrudan sağlayıcıya gider)
// Google birim fiyatı GOOGLE_COST_PER_CALL_USD ile ayarlanır (varsayılan 0.04: Places Nearby Search, EV alanı Enterprise + Atmosphere
// katmanında ~40 USD / 1000 çağrı, ayda ilk 1000 çağrı ücretsiz; Google fiyatı değiştirirse .env'den güncelle, geçmiş kayıtlar çağrı sayısından yeniden hesaplanır).
// Tahmini USD (estimate): ücretli türlerde istek × birim fiyat, ücretsiz aylık kota DÜŞÜLEREK (kota hesap geneli geçerlidir, bu yüzden tahmin kişi başına değil sağlayıcı geneli;
// kişi başına yalnızca brüt = kotasız hesaplanır). Birim fiyat ve kota RATES'te varsayılan; .env'den COST_<TÜR>_PER_1K_USD ve COST_<TÜR>_FREE_MONTHLY ile değiştirilir (TÜR büyük harf: HERE, SLIMIT,
// MAPBOX, MAPBOX_SEARCH, MAP_MAPBOX, MAP_GOOGLE, GOOGLE). Fiyatlar sağlayıcı sayfalarından/üçüncü taraf özetlerinden; HERE doğrulanmadı. Asıl fatura sağlayıcı panellerindedir. OpenChargeMap ve Overpass ücretsizdir, tahmin yok.
// Not: 'mapbox' türü Search Box eklenmeden önce rota + aramayı birlikte saydı (eski kayıtlar karışık, rota fiyatıyla hesaplanır); yeni aramalar 'mapbox_search'e yazılır.
// Hesap silinince kişiye bağlı kayıt silinir, toplamlar anonim "_silinen" kovasına eklenir.
const KEEP_DAYS = 400;
const day = () => new Date().toISOString().slice(0, 10);
export const KINDS = ['google', 'here', 'slimit', 'mapbox', 'mapbox_search', 'map_mapbox', 'map_google', 'ocm', 'overpass'];
/** Varsayılan fiyat (çağrı başına USD, "per1k" 1000 çağrı fiyatı) ve aylık ücretsiz kota. Yalnızca ücretli türler. */
export const RATES = {
  google: { per1k: 40, free: 1000 }, // Places Nearby (EV: Enterprise + Atmosphere); GOOGLE_COST_PER_CALL_USD hâlâ geçerli
  here: { per1k: 0.75, free: 30000 }, // HERE Browse; doğrulanmadı (üçüncü taraf: 30.000 ücretsiz, ~0,4–1 USD / 1000)
  slimit: { per1k: 0.75, free: 30000 }, // HERE Routing (hız limiti); doğrulanmadı
  mapbox: { per1k: 2, free: 100000 }, // Mapbox Directions
  mapbox_search: { per1k: 1.7, free: 25000 }, // Mapbox Search Box /category (istek başına; tanıtım fiyatı 50.000 ücretsiz / 1,00 USD olabilir)
  map_mapbox: { per1k: 5, free: 50000 }, // Mapbox GL JS harita yüklemesi (anahtar verme ≈ yükleme)
  map_google: { per1k: 7, free: 10000 }, // Google Maps JS dinamik harita (anahtar verme ≈ yükleme)
};

/** Kayıttaki gün sayısı KEEP_DAYS'i aşarsa en eskiler silinir. */
function prune(rec) {
  const old = Object.keys(rec.days).sort();
  while (old.length > KEEP_DAYS) delete rec.days[old.shift()];
}

export function createCosts(store, env = {}) {
  const unit = Number(env.GOOGLE_COST_PER_CALL_USD) > 0 ? Number(env.GOOGLE_COST_PER_CALL_USD) : 0.04;
  const num = (v, min) => { const n = v == null || String(v).trim() === '' ? NaN : Number(v); return Number.isFinite(n) && n >= min ? n : null; };
  /** Tür → { unit (USD / çağrı), free (aylık ücretsiz çağrı) }; .env geçersizse varsayılan. */
  const rates = Object.fromEntries(Object.entries(RATES).map(([k, d]) => {
    const E = k.toUpperCase();
    const per1k = k === 'google' ? unit * 1000 : (num(env[`COST_${E}_PER_1K_USD`], 0) ?? d.per1k);
    return [k, { unit: per1k / 1000, free: Math.floor(num(env[`COST_${E}_FREE_MONTHLY`], 0) ?? d.free) }];
  }));
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

  const round = (v) => Math.round(v * 10000) / 10000;

  /**
   * Ücretli türler için sağlayıcı geneli tahmin (tüm kayıtlar toplanır, ücretsiz aylık kota ay ay düşülür):
   * { tür: { unit, free, freeLeft, calls: {today, month, total}, usd: {today, month, total} } }.
   * bugün = bu ayın kota sonrası maliyetine bugünün eklediği pay; toplam = tutulan günlerdeki (≤400 gün) ayların toplamı; freeLeft = bu ay kalan ücretsiz çağrı.
   */
  function estimate() {
    const t = day();
    const ym = t.slice(0, 7);
    const months = Object.fromEntries(Object.keys(rates).map((k) => [k, {}]));
    for (const key of keys()) for (const [dk, dv] of Object.entries(book()[key].days || {})) for (const k of Object.keys(rates)) if (dv[k]) months[k][dk.slice(0, 7)] = (months[k][dk.slice(0, 7)] || 0) + dv[k];
    const tot = totals();
    const out = {};
    for (const [k, r] of Object.entries(rates)) {
      const over = (n) => Math.max(0, n - r.free);
      const monthN = months[k][ym] || 0;
      const todayN = tot[k].today;
      out[k] = {
        unit: r.unit, free: r.free, freeLeft: Math.max(0, r.free - monthN),
        calls: { today: todayN, month: tot[k].month, total: tot[k].total },
        usd: { today: round((over(monthN) - over(Math.max(0, monthN - todayN))) * r.unit), month: round(over(monthN) * r.unit), total: round(Object.values(months[k]).reduce((s, n) => s + over(n), 0) * r.unit) },
      };
    }
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

  return { add, summary, counts, totals, estimate, forget, keys, unit, rates, kinds: KINDS };
}
