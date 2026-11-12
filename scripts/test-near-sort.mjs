// Yakınımdaki istasyonlar: En yakın / En ucuz / En hızlı sıralaması, eksik fiyat/güç etiketleri, doluluk tazeliği ve mevcut davranış.
// Kullanım: node scripts/test-near-sort.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { sortNearby, sortNote, availability, priceLabel, powerLabel, NEAR_SORTS } = await import('../js/nav/nearSort.js');
const { FRESH_MS } = await import('../js/routing/slots.js');
const { pickEmergency } = await import('../js/nav/chargePick.js');

const NOW = 1_800_000_000_000;
const st = (id, o = {}) => ({ id, name: id, opName: 'Op', distKm: 1, kw: 180, srcKw: 180, uncertain: false, slow: false, tariff: 'list', price: 10, ...o });
const ids = (r) => r.list.map((s) => s.id).join(',');
const fresh = (available, total = 4, extra = {}) => ({ slots: { available, total, out: 0, checked: NOW - 60e3, ...extra } });

// ---- En yakın ----
{
  const l = [st('c', { distKm: 3 }), st('a', { distKm: 1 }), st('b', { distKm: 2 })];
  const before = ids({ list: l });
  ok('en yakın: mesafeye göre', ids(sortNearby(l, 'near', NOW)) === 'a,b,c');
  ok('girdi dizisi değişmez', ids({ list: l }) === before);
  ok('eşit mesafede id ile belirlenimci', ids(sortNearby([st('z'), st('m'), st('a')], 'near', NOW)) === 'a,m,z');
  ok('bilinmeyen sıralama adı en yakına düşer', ids(sortNearby(l, 'xyz', NOW)) === 'a,b,c');
  ok('boş liste', sortNearby([], 'cheap', NOW).list.length === 0 && sortNearby(undefined, 'fast', NOW).list.length === 0);
  ok('üç sıralama', NEAR_SORTS.join() === 'near,cheap,fast');
}

// ---- En ucuz: bilinmeyen/tahmini fiyat bilinenlerden sonra ----
{
  const l = [
    st('est', { distKm: 0.5, tariff: 'estimate', price: 1 }), // tahmini ve "en ucuz" görünüyor: bilinen sayılmamalı
    st('miss', { distKm: 0.6, tariff: undefined, price: undefined }),
    st('zero', { distKm: 0.7, price: 0 }),
    st('foreign', { distKm: 0.8, foreign: true, price: 2 }),
    st('p12', { distKm: 5, price: 12 }),
    st('p9', { distKm: 9, price: 9 }),
    st('p9b', { distKm: 4, price: 9 }),
  ];
  const r = sortNearby(l, 'cheap', NOW);
  ok('en ucuz: bilinen fiyatlar artan, eşitlikte yakın önce', ids(r).startsWith('p9b,p9,p12'), ids(r));
  ok('en ucuz: tahmini/bilinmeyen/0/yurt dışı sona, mesafeyle', ids(r).endsWith('est,miss,zero,foreign'), ids(r));
  ok('en ucuz: bilinmeyen sayısı 4', r.unknown === 4);
  ok('not: bilinmeyen fiyat açıklanır', /4 istasyonun fiyatı bilinmiyor/.test(sortNote('cheap', r)));
  ok('tahmini fiyat etiketli', priceLabel(l[0]) === '≈1.00 TL/kWh (tahmini)');
  ok('eksik fiyat etiketli', priceLabel(l[1]) === 'Fiyat bilinmiyor' && priceLabel(l[2]) === 'Fiyat bilinmiyor' && priceLabel(l[3]) === 'Fiyat bilinmiyor');
  ok('bilinen fiyatta etiket yok', priceLabel(l[4]) === null);
  // canlı fiyat ek ücretli ya da farklı para birimi: bilinir ama karşılaştırılan TL fiyatlarından sonra, bilinmeyenlerden önce
  const live = (kwh, currency, extra = {}) => ({ slots: { price: { kwh, currency, ...extra }, checked: NOW } });
  const m = [st('fee', { distKm: 0.1, ...live(1, 'TRY', { flat: 5 }) }), st('eur', { distKm: 0.2, ...live(0.3, 'EUR') }),
    st('unk', { distKm: 0.05, tariff: 'estimate' }), st('t11', { price: 11, distKm: 3 }), st('t10', { price: 10, distKm: 4 })];
  ok('karşılaştırılamayan bilinen fiyat ortada, bilinmeyen en sonda', ids(sortNearby(m, 'cheap', NOW)) === 't10,t11,fee,eur,unk', ids(sortNearby(m, 'cheap', NOW)));
}

// ---- En hızlı: bilinmeyen güç sona ----
{
  const l = [
    st('u', { distKm: 0.1, kw: 400, srcKw: null }), // operatör varsayımı 400: bilinen sayılmaz
    st('k120', { distKm: 1, kw: 120, srcKw: 120 }),
    st('k300', { distKm: 5, kw: 300, srcKw: 300 }),
    st('unc', { distKm: 0.2, kw: 350, srcKw: 350, uncertain: true }),
    st('k300b', { distKm: 2, kw: 300, srcKw: 300 }),
  ];
  const r = sortNearby(l, 'fast', NOW);
  ok('en hızlı: bilinen kW azalan, eşitlikte yakın önce', ids(r) === 'k300b,k300,k120,u,unc', ids(r));
  ok('en hızlı: bilinmeyen güç sayısı', r.unknown === 2 && /2 istasyonun gücü/.test(sortNote('fast', r)));
  ok('bilinmeyen güç etiketli', powerLabel(l[0]) === '≈400 kW (tahmini)' && powerLabel(st('x', { kw: 0, srcKw: null })) === 'Güç bilinmiyor');
  ok('bilinen güçte etiket yok', powerLabel(l[1]) === null);
}

// ---- Doluluk ve tazelik ----
{
  ok('taze boş = free', availability(st('a', fresh(2)), NOW) === 'free');
  ok('taze dolu = full', availability(st('a', fresh(0)), NOW) === 'full');
  ok('arızalı = out', availability(st('a', fresh(0, 2, { out: 2 })), NOW) === 'out');
  const old = { slots: { available: 3, total: 4, out: 0, checked: NOW - FRESH_MS - 1 } };
  ok('eski "boş" veri boş sayılmaz (stale)', availability(st('a', old), NOW) === 'stale');
  ok('zamanı olmayan sayısal veri stale', availability(st('a', { slots: { available: 3, total: 4, out: 0 } }), NOW) === 'stale');
  ok('gelecekteki zaman damgası taze sayılmaz', availability(st('a', fresh(2, 4, { checked: NOW + 60e3 })), NOW) === 'stale');
  ok('doluluk yok = unknown', availability(st('a'), NOW) === 'unknown');

  const l = [st('full', { distKm: 0.1, price: 5, ...fresh(0) }), st('out', { distKm: 0.2, price: 4, ...fresh(0, 2, { out: 2 }) }),
    st('staleFull', { distKm: 0.3, price: 6, slots: { available: 0, total: 4, out: 0, checked: NOW - FRESH_MS - 1 } }),
    st('free', { distKm: 3, price: 9, ...fresh(1) })];
  for (const by of NEAR_SORTS) {
    const r = sortNearby(l, by, NOW);
    ok(`${by}: taze dolu/arızalı sona, eski veri elenmez`, ids(r).split(',').slice(-2).sort().join() === 'full,out' && r.unusable === 2, ids(r));
  }
  ok('en ucuz: kullanılabilirler arasında fiyat sırası', ids(sortNearby(l, 'cheap', NOW)).startsWith('staleFull,free'));
  ok('not: dolu/arızalı açıklanır', /2 dolu\/arızalı/.test(sortNote('near', sortNearby(l, 'near', NOW))));
}

// ---- Mevcut davranış ve bağlantı ----
{
  const nb = read('js/nav/nearby.js');
  const html = read('index.html');
  ok('liste render sortNearby ile sıralanır', /sortNearby\(visible\(\), nearSort\)/.test(nb));
  ok('düşük pil önerisi sıralamadan etkilenmez (rankNearby değişmedi)', /function rankNearby[\s\S]*?visible\(\{ power: false, brand: !anyBrand \}\)/.test(nb) && !/rankNearby[^\n]*nearSort/.test(nb));
  ok('seçim kaydedilir', /save\('nearSort', nearSort\)/.test(nb) && /load\('nearSort', 'near'\)/.test(nb));
  ok('eski doluluk "boş" gösterilmez', /av === 'stale' \?/.test(nb));
  ok('bilinmeyen fiyatta TL maliyet yazılmaz', /s\.foreign \|\| !known \?/.test(nb));
  const card = html.slice(html.indexOf('id="near-card"'), html.indexOf('id="filter-card"'));
  ok('Yakınımdaki kartında 3 sıralama düğmesi', ['near', 'cheap', 'fast'].every((k) => card.includes(`data-nearsort="${k}"`)) && card.includes('id="near-sort-note"'));
  ok('plan modu data-sort düğmeleri ile çakışmaz', !/data-sort=/.test(card));
  ok('modül çevrimdışı kabukta', read('sw.js').includes("'./js/nav/nearSort.js'"));
  // pickEmergency hâlâ aynı: tahmini fiyat "en ucuz" sayılmaz
  const e = pickEmergency([st('e1', { tariff: 'estimate', price: 1, reachable: true }), st('k1', { price: 9, reachable: true }), st('k2', { price: 8, reachable: true })]);
  ok('düşük pil kartı: tahmini fiyat en ucuz seçilmez', e.station.id === 'k2' && e.kind === 'cheapestKnown');
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
