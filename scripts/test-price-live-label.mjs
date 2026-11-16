// D3-T5 (K6): fiyat "canlı" etiketi — çevrimdışı regresyon testi (ağ yok, anahtar yok, sağlayıcı çağrısı yok; sentetik fikstür).
// node scripts/test-price-live-label.mjs
//
// Kural (K6): "canlı" yalnız bağımsız olarak doğrulanmış, güncel, resmî fiyata verilir: resmî kaynak (NDW / OCPI), kWh > 0,
// geçerli para birimi, SAĞLAYICI zaman damgası (price.at; doluluk okuma anı slots.at / slots.checked sayılmaz), gelecekte değil,
// en çok PRICE_LIVE_MAX_AGE_MS eski ve sağlayıcının verdiği geçerlilik sonu (expires / validUntil) geçmemiş.
// Bilinmeyen / eski / zaman damgasız / topluluk (user) / VeriApi.Pro tarifesi / kaynaksız fiyat → "canlı" DEĞİL.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const read = (p) => readFileSync(join(root, p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log('FAIL', name, extra); } };
const J = (v) => JSON.stringify(v);

const slots = await imp('js/routing/slots.js');
const { livePrice, isLivePrice, PRICE_LIVE_SOURCES, PRICE_LIVE_MAX_AGE_MS } = slots;
const { priceText } = await imp('js/nav/chargePick.js');

ok('isLivePrice dışa aktarılır', typeof isLivePrice === 'function');
ok('PRICE_LIVE_SOURCES yalnız resmî kaynaklar (ndw, ocpi)', J([...(PRICE_LIVE_SOURCES || [])].sort()) === J(['ndw', 'ocpi']), J(PRICE_LIVE_SOURCES));
ok('PRICE_LIVE_SOURCES dondurulmuş', Object.isFrozen(PRICE_LIVE_SOURCES));
ok('PRICE_LIVE_MAX_AGE_MS = 6 sa', PRICE_LIVE_MAX_AGE_MS === 6 * 3600e3, String(PRICE_LIVE_MAX_AGE_MS));

const NOW = Date.now();
const MIN = 60e3;
const base = (o = {}) => ({ currency: 'EUR', kwh: 0.42, flat: null, hour: null, parkingHour: null, src: 'ndw', at: NOW - 5 * MIN, ...o });
const st = (price, sx = {}) => ({ id: 'a', price: 13, tariff: 'list', slots: { src: 'ndw', total: 4, available: 2, out: 0, at: NOW, checked: NOW, ...sx, price } });
const isLive = (p, now = NOW) => (typeof isLivePrice === 'function' ? isLivePrice(p, now) : null);
const text = (p, sx) => livePrice(st(p, sx))?.text ?? null;
const hasCanli = (s) => typeof s === 'string' && /canl[ıi]/i.test(s);

// ---- 1. Pozitif: doğrulanmış güncel resmî fiyat ----
for (const src of ['ndw', 'ocpi']) {
  ok(`${src} + taze sağlayıcı zamanı → canlı`, isLive(base({ src })) === true);
  ok(`${src} metni "(canlı)"`, text(base({ src })) === '€0.42/kWh (canlı)', text(base({ src })));
  ok(`${src} livePrice.live true`, livePrice(st(base({ src })))?.live === true);
}
ok('ISO zaman damgası kabul', isLive(base({ at: new Date(NOW - 10 * MIN).toISOString() })) === true);
ok('sınırda (tam 6 sa) canlı', isLive(base({ at: NOW - PRICE_LIVE_MAX_AGE_MS })) === true);
ok('gelecek geçerlilik sonu → canlı', isLive(base({ expires: NOW + 30 * MIN })) === true);
ok('gelecek validUntil (ISO) → canlı', isLive(base({ validUntil: new Date(NOW + 30 * MIN).toISOString() })) === true);
ok('2 dk saat kayması tolere edilir', isLive(base({ at: NOW + 60e3 })) === true);
ok('TRY sembolü korunur', text(base({ currency: 'TRY', kwh: 9.5 })) === '₺9.50/kWh (canlı)', text(base({ currency: 'TRY', kwh: 9.5 })));
ok('ek ücret bayrağı korunur', livePrice(st(base({ flat: 1 })))?.extra === true);

// ---- 2. Negatif: canlı OLMAMALI ----
const neg = [
  ['zaman damgası yok', base({ at: undefined })],
  ['zaman damgası null', base({ at: null })],
  ['zaman damgası çözülemez', base({ at: 'dün' })],
  ['zaman damgası 0', base({ at: 0 })],
  ['eski (6 sa + 1 dk)', base({ at: NOW - PRICE_LIVE_MAX_AGE_MS - MIN })],
  ['çok eski (3 gün)', base({ at: NOW - 3 * 864e5 })],
  ['gelecekte (10 dk)', base({ at: NOW + 10 * MIN })],
  ['geçerlilik süresi dolmuş (expires)', base({ expires: NOW - MIN })],
  ['geçerlilik süresi dolmuş (validUntil ISO)', base({ validUntil: new Date(NOW - MIN).toISOString() })],
  ['geçerlilik sonu çözülemez', base({ expires: 'yakında' })],
  ['topluluk / fiyat defteri (user)', base({ src: 'user', n: 3 })],
  ['VeriApi.Pro tarifesi', base({ src: 'veriapi', currency: 'TRY', kwh: 9.5 })],
  ['kaynak yok', base({ src: undefined })],
  ['bilinmeyen kaynak', base({ src: 'tomtom' })],
  ['topluluk kaynağı', base({ src: 'community' })],
  ['simüle', base({ src: 'sim' })],
  ['büyük harf / boşluklu kaynak (sıkı eşleşme)', base({ src: ' NDW ' })],
  ['kWh 0', base({ kwh: 0 })],
  ['kWh negatif', base({ kwh: -1 })],
  ['kWh NaN', base({ kwh: NaN })],
  ['kWh metin', base({ kwh: '0.42' })],
  ['para birimi yok', base({ currency: undefined })],
  ['para birimi geçersiz', base({ currency: '€' })],
  ['açıkça doğrulanmamış (verified false)', base({ verified: false })],
];
for (const [name, p] of neg) ok(`canlı değil: ${name}`, isLive(p) === false, J(p));
ok('canlı değil: null', isLive(null) === false);
ok('canlı değil: dizi', isLive([]) === false);
ok('canlı değil: metin', isLive('canlı') === false);

// Doluluk okuma anı (slots.at / slots.checked) fiyat zamanı yerine geçmez
ok('slots.at taze ama price.at yok → canlı değil', livePrice(st(base({ at: undefined }), { at: NOW, checked: NOW }))?.live === false);
ok('slots.at taze ama price.at yok → metinde "canlı" yok', !hasCanli(text(base({ at: undefined }), { at: NOW, checked: NOW })), text(base({ at: undefined })));
ok('saat geçersiz (now NaN) → canlı değil', isLive(base(), NaN) === false);

// ---- 3. Metin: canlı olmayan fiyat görünür ama "canlı" yazmaz ----
for (const [name, p] of neg) {
  const lp = livePrice(st(p));
  if (lp) ok(`metinde "canlı" yok: ${name}`, !hasCanli(lp.text) && lp.live === false, lp.text);
}
ok('user → "(bildirilen)" korunur', text(base({ src: 'user', currency: 'TRY', kwh: 12.5 })) === '₺12.50/kWh (bildirilen)', text(base({ src: 'user', currency: 'TRY', kwh: 12.5 })));
ok('veriapi → atıf korunur', text(base({ src: 'veriapi', currency: 'TRY', kwh: 9.5 })) === '₺9.50/kWh (tarife · VeriApi.Pro)', text(base({ src: 'veriapi', currency: 'TRY', kwh: 9.5 })));
ok('zaman damgasız NDW → niteleyicisiz fiyat', text(base({ at: undefined })) === '€0.42/kWh', text(base({ at: undefined })));
ok('eski OCPI → niteleyicisiz fiyat', text(base({ src: 'ocpi', at: NOW - 864e5 })) === '€0.42/kWh', text(base({ src: 'ocpi', at: NOW - 864e5 })));
ok('fiyat yok → null', livePrice(st(null)) === null && livePrice({ slots: null }) === null && livePrice({}) === null);
ok('kwh null → null', livePrice(st(base({ kwh: null }))) === null);

// Sunucunun bugünkü NDW biçimi (server/occupancy.mjs ndwLookup: price.src='ndw', price.at YOK; slots.at = okuma anı) → canlı değil
const ndwToday = { src: 'ndw', total: 4, available: 2, out: null, at: NOW, price: { currency: 'EUR', kwh: 0.39, flat: null, hour: null, parkingHour: null, src: 'ndw' } };
ok('bugünkü NDW yanıtı (fiyat zamanı yok) → canlı değil', livePrice({ slots: ndwToday })?.live === false && !hasCanli(livePrice({ slots: ndwToday }).text), J(livePrice({ slots: ndwToday })));

// ---- 4. Tüketiciler: kart metni (chargePick.priceText) aynı karardan ----
ok('priceText: canlı fiyat "(canlı)"', priceText(st(base())) === '€0.42/kWh (canlı)', priceText(st(base())));
ok('priceText: zaman damgasız fiyat "canlı" yazmaz', !hasCanli(priceText(st(base({ at: undefined })))), priceText(st(base({ at: undefined }))));
ok('priceText: eski fiyat "canlı" yazmaz', !hasCanli(priceText(st(base({ at: NOW - 864e5 })))), priceText(st(base({ at: NOW - 864e5 }))));
ok('priceText: ek ücret eki korunur', priceText(st(base({ flat: 1 }))) === '€0.42/kWh (canlı) + ek ücret', priceText(st(base({ flat: 1 }))));

// Tüm arayüz tüketicileri fiyat metnini yalnız livePrice'tan alır (ayrı "canlı" fiyat metni üretmez)
for (const f of ['js/nav/chargePick.js', 'js/nav/nearby.js', 'js/ui/routePanel.js', 'js/ui/stationCard.js']) {
  const src = read(f);
  ok(`${f} livePrice kullanır`, /livePrice\(/.test(src));
  ok(`${f} kendi "(canlı)" fiyat metnini üretmez`, !/kWh \(canlı\)/.test(src));
}
const slotsSrc = read('js/routing/slots.js');
ok('slots.js: "(canlı)" yalnız isLivePrice kararına bağlı', /isLivePrice\(/.test(slotsSrc.slice(slotsSrc.indexOf('export function livePrice'))));

console.log(`test-price-live-label: ${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
