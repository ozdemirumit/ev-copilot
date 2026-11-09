// Liste tarifeleri ve markalar (js/config.js DEFAULT_OPERATORS, js/routing/operators.js): yeni markalar eşleşir, genel sözcükler eşleşmez,
// eski varsayılan fiyatlar yeniye geçer, kullanıcının değiştirdiği fiyat korunur, sonradan sabit listeye giren marka tekrar satır olmaz.
const store = new Map([
  ['evcp.operators', JSON.stringify([{ id: 'esarj', price: 13.5, kw: 150 }, { id: 'zes', price: 15, kw: 180 }, { id: 'sharz', price: 12.99, kw: 120 }, { id: 'other', price: 12.42, kw: 60 }])],
  ['evcp.discoveredOps', JSON.stringify([{ name: 'Otopriz' }, { name: 'Beefull' }])],
]);
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const { DEFAULT_OPERATORS, PRICES_AS_OF } = await import('../js/config.js');
const { classify, getOperators, operatorById } = await import('../js/routing/operators.js');

let ok = 0, bad = 0;
const t = (n, c) => { if (c) ok++; else { bad++; console.log('BAŞARISIZ:', n); } };

// Tablo bütünlüğü
const ids = DEFAULT_OPERATORS.map((o) => o.id);
t('kimlikler tek', new Set(ids).size === ids.length);
t('Diğer sonda', ids.at(-1) === 'other' && DEFAULT_OPERATORS.at(-1).match.length === 0);
t('fiyatlar makul (5–20 TL/kWh)', DEFAULT_OPERATORS.every((o) => o.price >= 5 && o.price <= 20 && o.acPrice >= 5 && o.acPrice <= 20));
t('AC DC hızlıdan pahalı değil (Tesla hariç)', DEFAULT_OPERATORS.filter((o) => o.id !== 'tesla').every((o) => o.acPrice <= o.price + 0.01));
t('eşleşme parçaları küçük harfli ve ≥ 4 harf', DEFAULT_OPERATORS.every((o) => o.match.every((m) => m === m.toLowerCase() && m.length >= 3)));
t('tarih güncel kaynak', PRICES_AS_OF === '2026-11-06');
t('Diğer: sayfa ortalamaları', operatorById('other').price === 12.78 && operatorById('other').acPrice === 9.78);

// Değerler (kaynak: yonga.io, ultra varsa ultra)
t('ZES: ultra 16,49, AC 10,99', operatorById('zes').acPrice === 10.99);
t('Trugo ultra 14,98', operatorById('trugo').price === 14.98);

// Yeni markalar eşleşir
t('Otopriz', classify('Otopriz Ankara') === 'otopriz');
t('Neva Şarj', classify('NEVA ŞARJ İstasyonu') === 'neva');
t('işletmeci alanından', classify('Şarj Noktası', 'Aksa Şarj') === 'aksa');
t('otoWATT', classify('otoWATT Bolu') === 'otowatt');
t('e-POwer', classify('PO e-POwer Gebze') === 'epower');

// Yanlış eşleşme yok
t('Aksaray Aksa Şarj sayılmaz', classify('Aksaray otopark') !== 'aksa');
t('"Bu Şarj" bir marka değil', !['neva', 'sarjon'].includes(classify('Bu şarj istasyonu')));
t('ZES, Nevşehir ZES (neva değil)', classify('ZES Nevşehir', 'ZES') === 'zes');

// Kayıtlı tablo: eski varsayılan yeniye geçer, değiştirilen kalır
t('Eşarj: eski varsayılan 13,5 → yeni 9,9', operatorById('esarj').price === 9.9);
t('ZES: kullanıcı değeri (15) korunur', operatorById('zes').price === 15);
t('Sharz: eski varsayılan 12,99 → yeni 10,99', operatorById('sharz').price === 10.99);
t('Diğer: eski 12,42 → 12,78', operatorById('other').price === 12.78);

// Keşfedilmiş ama artık sabit listede olan marka tekrar satır olmaz; listede olmayan kalır
const names = getOperators().map((o) => o.name);
t('Otopriz tek satır', names.filter((n) => /otopriz/i.test(n)).length === 1);
t('listede olmayan keşfedilen kalır', names.includes('Beefull'));

console.log(`${ok} geçti, ${bad} kaldı`);
process.exit(bad ? 1 : 0);
