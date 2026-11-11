// İşletmeci yayımlanmış tarifeleri (sunucu → VeriApi.Pro) istemci tarafı: operatör tablosuna işleme ve istasyon fiyatı. Kullanım: node scripts/test-tariffs.mjs
import { setPublishedTariffs, operatorById, getOperators, resetOperators, persistOperators } from '../js/routing/operators.js';
import { priced } from '../js/routing/chargerSource.js';
import { priceInfo } from '../js/nav/chargePick.js';
import { DEFAULT_OPERATORS } from '../js/config.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const rows = [
  { code: 'trugo', name: 'Trugo', ac: 9.95, dc: 14.98 },
  { code: 'zes', name: 'ZES', ac: 10.99, dc: 16.49 },
  { code: 'ovolt', name: 'Ovolt (Sharz.net)', ac: 8.99, dc: 13.49 },
  { code: 'wat-mobilite', name: 'WAT Mobilite', ac: 9.99, dc: 14.49 },
  { code: 'bozuk', name: 'Bozuk', ac: 0, dc: -2 },
];
const st = (opId, slow = false) => ({ id: 'x-' + opId + slow, name: 'Test', lat: 41.0, lon: 29.0, opId, slow, srcKw: 150 });

const defTrugo = DEFAULT_OPERATORS.find((d) => d.id === 'trugo');
ok('başlangıç: yayımlanmış tarife yok → liste fiyatı, kaynak documented', priced(st('trugo')).price === defTrugo.price && priced(st('trugo')).tariffSrc === 'documented');

setPublishedTariffs(rows);
const dc = priced(st('trugo'));
ok('DC: yayımlanmış tarife (14.98), kaynak published', dc.price === 14.98 && dc.tariffSrc === 'published' && dc.tariff === 'list');
const ac = priced(st('trugo', true));
ok('AC: yayımlanmış AC tarifesi (9.95)', ac.price === 9.95 && ac.tariffSrc === 'published');
ok('ZES DC 16.49 / AC 10.99', priced(st('zes')).price === 16.49 && priced(st('zes', true)).price === 10.99);
ok('WAT Mobilite (boşluklu ad) eşleşir', priced(st('wat')).price === 14.49);
ok('"Ovolt (Sharz.net)" yalnızca ovolt operatörüne, sharz\'a değil', priced(st('ovolt')).price === 13.49 && priced(st('sharz')).tariffSrc === 'documented');
ok('tabloda olmayan operatör (Eşarj) liste fiyatında kalır', priced(st('esarj')).tariffSrc === 'documented' && priced(st('esarj')).price === DEFAULT_OPERATORS.find((d) => d.id === 'esarj').price);
ok('sıfır/negatif fiyat atılır (bozuk satır etkisiz)', getOperators().every((o) => !o.pub || (o.pub.price == null || o.pub.price > 0)));
ok('"Diğer" tahmini kalır', priced(st('other')).tariff === 'estimate' && priced(st('other')).tariffSrc == null);
ok('yurt dışı istasyonda fiyat yok', priced({ ...st('trugo'), lat: 52.37, lon: 4.89 }).price === 0);

// kullanıcı DC fiyatını değiştirdiyse onunki geçerli (AC yine yayımlanmış)
const op = operatorById('trugo');
const before = op.price;
op.price = 12.5; persistOperators();
const u = priced(st('trugo'));
ok('kullanıcı DC fiyatı yayımlanmışın önünde, kaynak user', u.price === 12.5 && u.tariffSrc === 'user');
ok('kullanıcı DC\'yi değiştirse de AC yayımlanmış kalır', priced(st('trugo', true)).price === 9.95);
op.price = before;

// priceInfo: published → documented, karşılaştırılabilir
const info = priceInfo(priced(st('zes')));
ok('priceInfo: kaynak documented, karşılaştırılabilir', info.source === 'documented' && info.comparable && info.value === 16.49);

// sıfırlama sonrası da tablo uygulanır; geçersiz giriş tabloyu bozmaz
resetOperators();
ok('sıfırlama sonrası yayımlanmış tarife korunur', priced(st('zes')).price === 16.49);
setPublishedTariffs([]); setPublishedTariffs(null);
ok('boş/geçersiz giriş mevcut tabloyu silmez', priced(st('zes')).price === 16.49);

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
