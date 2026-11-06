// Şarj markası keşfi (js/routing/operators.js) testi: bilinen markalar sabit listede kalır, yeni işletmeci adları listeye eklenir, çöp adlar eklenmez.
// Kullanım: node scripts/test-operators.mjs
import { cleanBrand, classify, getOperators, removeDiscovered, resetOperators, operatorById } from '../js/routing/operators.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

// cleanBrand
ok('hukuki ek atılır', cleanBrand('Aksa Enerji Üretim A.Ş.') === 'Aksa Enerji Üretim');
ok('birden çok değerde ilki', cleanBrand('Beefull;ZES') === 'Beefull');
ok('genel kelime reddedilir', cleanBrand('Şarj İstasyonu') === null && cleanBrand('EV') === null && cleanBrand('unknown') === null);
ok('çok kısa/uzun reddedilir', cleanBrand('ab') === null && cleanBrand('x'.repeat(40)) === null);
ok('adres/link reddedilir', cleanBrand('https://example.com') === null && cleanBrand('info@firma.com') === null);
ok('rakam ağırlıklı reddedilir', cleanBrand('1234 56') === null);
ok('Tesla reddedilir', cleanBrand('Tesla Supercharger') === null);

// classify: sabit liste
ok('ZES sabit listeden', classify('ZES Gebze', 'ZES') === 'zes');
ok('Trugo sabit listeden', classify('Trugo Kartal') === 'trugo');
const before = getOperators().length;

// classify: keşif
const id = classify('Otopark şarj', 'Beefull');
ok('yeni marka kimliği f- ile başlar', id === 'f-beefull');
ok('liste bir arttı', getOperators().length === before + 1);
ok('Diğer hep sonda', getOperators().at(-1).id === 'other');
ok('yeni marka Diğer fiyatını alır', operatorById(id).price === getOperators().at(-1).price);
ok('aynı marka tekrar eklenmez', classify('Başka ad', 'Beefull') === id && getOperators().length === before + 1);
ok('sonra adın içinde geçen marka da eşleşir', classify('Beefull Ankara') === id);

// classify: eklenmeyenler
ok('işletmeci yoksa Diğer', classify('Bilinmeyen istasyon') === 'other');
ok('genel işletmeci adı Diğer', classify('Bilinmeyen', 'Şarj İstasyonu') === 'other');
ok('Tesla işletmeci olarak eklenmez', classify('X', 'Tesla Supercharger') === 'tesla' || classify('X', 'Tesla Supercharger') === 'other');

// silme ve sıfırlama
removeDiscovered(id);
ok('silinince listeden çıkar', !getOperators().some((o) => o.id === id));
ok('silinen marka bir daha eklenmez (kayıt yoksa bellek içi: en az Diğer)', classify('Y', 'Beefull') !== undefined);
resetOperators();
ok('sıfırlamada Diğer sonda', getOperators().at(-1).id === 'other');

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
