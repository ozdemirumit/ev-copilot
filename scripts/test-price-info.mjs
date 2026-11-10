// Fiyat veri katmanı: priceInfo/priceStatus kaynak ve bilinmeyen fiyat kuralları, priced/reprice tarife kaynağı (tariffSrc).
// Gerçek fiyat yalnızca: belgelenmiş liste tarifesi, kullanıcının girdiği tarife, canlı (OCPI/NDW) fiyat, kullanıcı bildirimi.
// "Diğer" ortalaması, keşfedilen markaya kopyalanan ortalama, yurt dışında liste fiyatı ve 0/eksik değer BİLİNMİYOR sayılır (0 değil).
// Kullanım: node scripts/test-price-info.mjs
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { priceInfo, priceStatus, PRICE_SOURCES } = await import('../js/nav/chargePick.js');
const { priced, reprice } = await import('../js/routing/chargerSource.js');
const { getOperators, persistOperators } = await import('../js/routing/operators.js');
const { DEFAULT_OPERATORS } = await import('../js/config.js');

const st = (o = {}) => ({ id: 'a', srcKw: 180, slow: false, tariff: 'list', tariffSrc: 'documented', foreign: false, price: 13, slots: null, ...o });
const slots = (price, x = {}) => ({ total: 4, available: 2, out: 0, checked: 1700000000000, ...x, price });
const J = (v) => JSON.stringify(v);

// Kaynak listesi sabit
ok('izinli kaynaklar', J(PRICE_SOURCES) === J(['live', 'reported', 'user', 'documented', 'list']), J(PRICE_SOURCES));

// Bilinen: belgelenmiş liste tarifesi
{
  const i = priceInfo(st({ price: 14.98 }));
  ok('liste: değer, TRY, karşılaştırılabilir', i.value === 14.98 && i.currency === 'TRY' && i.comparable === true, J(i));
  ok('liste: kaynak documented, zaman bilinmiyor (null)', i.source === 'documented' && i.at === null, J(i));
  const s = priceStatus(st({ price: 14.98 }));
  ok('priceStatus bilinen: known true', s.known === true && s.value === 14.98 && s.reason === null, J(s));
}
ok('liste: kullanıcı tarifesi kaynağı korunur', priceInfo(st({ tariffSrc: 'user', price: 11 })).source === 'user');
ok('eski nesne (tariffSrc yok): kaynak list', priceInfo(st({ tariffSrc: undefined })).source === 'list');

// Bilinen: canlı ve bildirilen
{
  const i = priceInfo(st({ slots: slots({ currency: 'EUR', kwh: 0.42, src: 'ocpi' }) }));
  ok('canlı: kaynak live, para birimi EUR', i.source === 'live' && i.currency === 'EUR' && i.value === 0.42, J(i));
  ok('canlı: zaman doluluk denetim zamanı', i.at === 1700000000000, J(i));
  const j = priceInfo(st({ slots: slots({ currency: 'EUR', kwh: 0.42, src: 'ndw' }, { at: 1700000005000 }) }));
  ok('canlı: kaynağın kendi zamanı önce', j.at === 1700000005000, J(j));
  const r = priceInfo(st({ slots: slots({ currency: 'TRY', kwh: 12.5, src: 'user', n: 3, at: 1690000000000 }) }));
  ok('bildirilen: kaynak reported, zaman bildirim zamanı', r.source === 'reported' && r.at === 1690000000000 && r.value === 12.5, J(r));
}
ok('canlı fiyat liste fiyatının önüne geçer', priceInfo(st({ price: 15, slots: slots({ currency: 'TRY', kwh: 9.5, src: 'ocpi' }) })).value === 9.5);
ok('ek ücretli canlı fiyat: bilinen ama karşılaştırılamaz', (() => { const i = priceInfo(st({ slots: slots({ currency: 'EUR', kwh: 0.3, flat: 1, src: 'ocpi' }) })); return i && i.comparable === false && i.extra === true; })());

// Para birimi
ok('para birimi küçük harf: büyük harfe çevrilir', priceInfo(st({ slots: slots({ currency: 'eur', kwh: 0.4, src: 'ocpi' }) })).currency === 'EUR');
ok('canlı fiyatta para birimi yok: liste fiyatına düşer', priceInfo(st({ price: 15, slots: slots({ kwh: 0.4, src: 'ocpi' }) })).source === 'documented');
ok('canlı fiyatta para birimi yok, liste de yok: bilinmiyor', priceInfo(st({ tariff: null, foreign: true, price: 0, slots: slots({ kwh: 0.4, src: 'ocpi' }) })) === null);
ok('geçersiz para birimi: bilinmiyor', priceInfo(st({ tariff: null, foreign: true, price: 0, slots: slots({ currency: '€', kwh: 0.4, src: 'ocpi' }) })) === null);

// Bilinmeyen: 0 değil, null
{
  const est = st({ tariff: 'estimate', tariffSrc: null, price: 12.42 });
  ok('Diğer ortalaması: bilinmiyor', priceInfo(est) === null);
  const s = priceStatus(est);
  ok('Diğer ortalaması: nedeni estimate, değer null (0 değil)', s.known === false && s.value === null && s.reason === 'estimate' && s.source === null, J(s));
  const f = priceStatus(st({ tariff: null, tariffSrc: null, foreign: true, price: 0 }));
  ok('yurt dışı liste fiyatı yok: nedeni foreign, değer null', f.known === false && f.value === null && f.reason === 'foreign', J(f));
  ok('yurt dışı: priceInfo null', priceInfo(st({ tariff: null, foreign: true, price: 0 })) === null);
  const m = priceStatus({ id: 'x' });
  ok('alan yok: nedeni missing', m.known === false && m.reason === 'missing' && m.value === null, J(m));
}
ok('liste fiyatı 0: bilinmiyor (zero)', priceInfo(st({ price: 0 })) === null && priceStatus(st({ price: 0 })).reason === 'zero');
ok('canlı kWh 0: bilinmiyor (bedava ile eksik ayırt edilemez)', priceInfo(st({ tariff: null, foreign: true, price: 0, slots: slots({ currency: 'EUR', kwh: 0, src: 'ocpi' }) })) === null);
ok('canlı kWh null: bilinmiyor', priceInfo(st({ tariff: null, foreign: true, price: 0, slots: slots({ currency: 'EUR', kwh: null, src: 'ocpi' }) })) === null);
ok('negatif/NaN fiyat: bilinmiyor', priceInfo(st({ price: -3 })) === null && priceInfo(st({ price: NaN })) === null && priceInfo(st({ price: '13' })) === null);
ok('yurt dışında liste işareti olsa da fiyat yok', priceInfo(st({ foreign: true, tariff: 'list', price: 13 })) === null);

// priced / reprice: tarife kaynağı
{
  const base = { id: 'x', name: 'x', lat: 39.9, lon: 32.8, srcKw: 180, slow: false, uncertain: false };
  const t = priced({ ...base, opId: 'trugo' });
  ok('belgelenmiş liste tarifesi: tariffSrc documented', t.tariff === 'list' && t.tariffSrc === 'documented', J({ tariff: t.tariff, src: t.tariffSrc }));
  ok('priced sonrası priceInfo documented', priceInfo(t).source === 'documented' && priceInfo(t).value === DEFAULT_OPERATORS.find((d) => d.id === 'trugo').price);
  const o = priced({ ...base, opId: 'other' });
  ok('Diğer: tariffSrc null, fiyat bilinmiyor', o.tariffSrc === null && priceInfo(o) === null);
  const f = priced({ ...base, opId: 'trugo', lat: 52.4, lon: 4.9 });
  ok('yurt dışı: tariffSrc null, price 0 geriye uyumlu, priceInfo null', f.tariffSrc === null && f.price === 0 && priceInfo(f) === null);

  const op = getOperators().find((x) => x.id === 'trugo');
  const old = op.price;
  op.price = old + 1;
  persistOperators();
  const [u] = reprice([t]);
  ok('kullanıcı fiyatı değiştirdi: reprice tariffSrc user', u.tariffSrc === 'user' && u.price === old + 1 && priceInfo(u).source === 'user', J({ src: u.tariffSrc, price: u.price }));
  op.price = old;
  persistOperators();
  ok('varsayılana dönünce yeniden documented', reprice([u])[0].tariffSrc === 'documented');
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
