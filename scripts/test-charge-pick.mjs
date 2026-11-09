// Düşük pil önerisi: tek kart seçimi (kesin >150 kW, ulaşılabilir, gerçek fiyat), fiyat etiketleri ve üst panel yapısı.
// Kullanım: node scripts/test-charge-pick.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { pickEmergency, priceInfo, priceText, isFast, knownKw } = await import('../js/nav/chargePick.js');
const { priced } = await import('../js/routing/chargerSource.js');

const st = (id, o = {}) => ({ id, name: id, srcKw: 180, kw: 180, uncertain: false, slow: false, reachable: true, arrive: 12, roadKm: 5, distKm: 4, price: 13, tariff: 'list', foreign: false, slots: null, ...o });
const ids = (l) => l.map((s) => s.id).join();
const live = (kwh, x = {}) => ({ total: 4, available: 2, out: 0, checked: Date.now(), price: { currency: 'TRY', kwh, src: 'ocpi', ...x } });

// Güç eşiği
ok('tam 150 kW uygun değil', !isFast(st('a', { srcKw: 150, kw: 150 })));
ok('151 kW uygun', isFast(st('a', { srcKw: 151, kw: 151 })));
ok('güç bilinmiyorsa (operatör varsayımı 180) uygun değil', !isFast(st('a', { srcKw: null, uncertain: true })) && knownKw(st('a', { srcKw: null, uncertain: true })) === null);
ok('operatör düzeltmesi tablodaki gücü gerçek güç yapmaz', knownKw(st('a', { srcKw: 60, kw: 180, corrected: true })) === 60);
ok('AC uygun değil', !isFast(st('a', { slow: true })));

// En ucuz seçim
{
  const list = [st('yakin', { price: 16.49 }), st('ucuz', { price: 13.5, roadKm: 20 }), st('orta', { price: 14.98 })];
  const p = pickEmergency(list);
  ok('tüm fiyatlar biliniyorsa en ucuz', p.station.id === 'ucuz' && p.kind === 'cheapest', JSON.stringify(p));
  ok('liste en ucuzdan pahalıya', ids(p.fast) === 'ucuz,orta,yakin', ids(p.fast));
}
{
  const p = pickEmergency([st('eq1', { price: 13 }), st('eq2', { price: 13 })]);
  ok('eşit fiyatta yakın olan', p.station.id === 'eq1');
}
ok('150 kW istasyon daha ucuz olsa da seçilmez', pickEmergency([st('s150', { srcKw: 150, kw: 150, price: 5 }), st('a', { price: 15 }), st('b', { price: 14 })]).station.id === 'b');
ok('canlı fiyat liste fiyatının önüne geçer', pickEmergency([st('a', { price: 12 }), st('b', { price: 15, slots: live(9.5) })]).station.id === 'b');

// Ulaşılabilirlik ve uygunluk
ok('ulaşılamayan en ucuz seçilmez', pickEmergency([st('u', { price: 5, reachable: false, arrive: -1 }), st('a', { price: 15 }), st('b', { price: 14 })]).station.id === 'b');
ok('varış pili güvenli sınırın altındaysa seçilmez', pickEmergency([st('u', { price: 5, arrive: 4 }), st('a', { price: 15 }), st('b', { price: 14 })]).station.id === 'b');
ok('rota dışı istasyon seçilmez', pickEmergency([st('off', { price: 5 }), st('a', { price: 15 }), st('b', { price: 14 })], { onRoute: (s) => s.id !== 'off' }).station.id === 'b');
{
  const full = { total: 4, available: 0, out: 0, checked: Date.now() };
  const out = { total: 4, available: 0, out: 4, checked: Date.now() };
  ok('dolu ve arızalı seçilmez', pickEmergency([st('f', { price: 5, slots: full }), st('o', { price: 6, slots: out }), st('a', { price: 15 }), st('b', { price: 14 })]).station.id === 'b');
}
ok('tercih edilen marka önce', pickEmergency([st('a', { price: 12, opId: 'x' }), st('b', { price: 15, opId: 'y' }), st('c', { price: 16, opId: 'y' })], { brandOk: (s) => s.opId === 'y' }).station.id === 'b');
ok('tercih edilen markada hızlı yoksa tüm markalar', pickEmergency([st('a', { price: 12, opId: 'x' }), st('b', { price: 15, opId: 'x' }), st('c', { srcKw: 60, kw: 60, opId: 'y' })], { brandOk: (s) => s.opId === 'y' }).station.id === 'a');

// Eksik fiyat: "en ucuz" iddiası yok
const est = { tariff: 'estimate', price: 12.42 };
{
  const p = pickEmergency([st('a', est), st('b', est)]);
  ok('hiç fiyat yoksa en yakın hızlı, en ucuz denmez', p.station.id === 'a' && p.kind === 'nearestFast', JSON.stringify(p.kind));
  ok('fiyat etiketi: bilinmiyor', priceText(p.station) === 'Fiyat bilinmiyor', priceText(p.station));
}
{
  const p = pickEmergency([st('a', est), st('b', { price: 15 })]);
  ok('tek fiyat varsa karşılaştırma yok: en yakın', p.station.id === 'a' && p.kind === 'nearestFast');
}
{
  const p = pickEmergency([st('a', est), st('b', { price: 15 }), st('c', { price: 14 })]);
  ok('bazı fiyatlar eksikse fiyatı bilinenlerde en ucuz', p.station.id === 'c' && p.kind === 'cheapestKnown', p.kind);
  ok('fiyatsız aday listede sonda', ids(p.fast) === 'c,b,a', ids(p.fast));
}
ok('yurt dışı liste fiyatı yok: bilinmiyor', priceInfo(st('a', { foreign: true, tariff: null, price: 0 })) === null && priceText(st('a', { foreign: true, tariff: null, price: 0 })) === 'Fiyat bilinmiyor');
ok('ek ücretli canlı tarife karşılaştırılmaz', pickEmergency([st('a', { price: 15 }), st('b', { price: 16 }), st('c', { price: 20, slots: live(1, { flat: 2 }) })]).station.id === 'a');
ok('ek ücret karta yazılır', priceText(st('c', { slots: live(9, { flat: 2 }) })).includes('+ ek ücret'));
ok('farklı para birimleri sıralanmaz', pickEmergency([st('e', { foreign: true, tariff: null, price: 0, slots: live(0.3, { currency: 'EUR' }) }), st('a', { price: 15 }), st('b', { price: 14 })]).station.id === 'b');
ok('liste fiyatı etiketli', priceText(st('a', { price: 13.5 })) === '13.50 TL/kWh (liste)');

// 150 kW üstü yok
{
  const p = pickEmergency([st('a', { srcKw: 120, kw: 120 }), st('b', { srcKw: 150, kw: 150 })]);
  ok('>150 kW yoksa station null, none', p.station === null && p.kind === 'none' && p.fast.length === 0);
  ok('boş listede hata yok', pickEmergency([]).station === null);
}

// priced: fiyat kaynağı işareti
{
  const base = { id: 'x', name: 'x', lat: 39.9, lon: 32.8, srcKw: 180, slow: false, uncertain: false };
  ok('bilinen işletmeci: liste', priced({ ...base, opId: 'trugo' }).tariff === 'list');
  ok('Diğer ortalaması: tahmin (gerçek fiyat değil)', priced({ ...base, opId: 'other' }).tariff === 'estimate');
  const f = priced({ ...base, opId: 'other', lat: 52.4, lon: 4.9 });
  ok('Türkiye dışı: tarife yok', f.tariff === null && f.price === 0 && f.foreign);
}

// Yapı: tek üst panel, varsayılan tek kart, Liste aç/kapa
const nb = read('js/nav/nearby.js');
const html = read('index.html');
const css = read('css/styles.css');
ok('varsayılan kapalı (navigasyon yokken de)', /let listOpen = false;/.test(nb) && !/listOpen \?\?/.test(nb));
ok('kapalıyken yalnızca ilk istasyon', /\(open \? stations : stations\.slice\(0, 1\)\)\.map\(alertEntry\)/.test(nb));
ok('kapatılınca seçim sıfırlanır', /alertSig = ''; listOpen = false;/.test(nb));
ok('Liste düğmesi metni', /open \? 'Daralt' : 'Liste'/.test(nb) && />Liste</.test(html));
ok('Liste üst panelin içinde', html.indexOf('id="top-panel"') < html.indexOf('id="near-alert-toggle"') && html.indexOf('id="near-alert-toggle"') < html.indexOf('id="road-alert"'));
ok('düşük pilde otomatik arama en az 25 km', /EMERGENCY_KM = 25/.test(nb) && /r >= EMERGENCY_KM/.test(nb));
ok('yeniden rota ve ses karttaki istasyonla aynı', /goTo\(card, \{ auto: true \}\)/.test(nb) && /Önerilen şarj istasyonu/.test(nb));
ok('üst panel kaydırma sınırı duruyor', /#banners\s*\{[^}]*max-height:\s*38dvh/.test(css));
ok('uzun ad kapalıyken tek satır', /\.near-name \{[^}]*white-space: nowrap/.test(css));
ok('seçim modülü çevrimdışı kabukta', read('sw.js').includes("'./js/nav/chargePick.js'"));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
