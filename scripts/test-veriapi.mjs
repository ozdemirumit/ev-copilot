// VeriApi.Pro tarife adaptörü: sahte yanıtlarla, gerçek anahtar/ağ olmadan. Kullanım: node scripts/test-veriapi.mjs
// UYARI: gerçek yanıt şeması belgelenmemiştir; fikstürler VARSAYILAN şekillerdir. Gerçek anahtarla ilk çekimden sonra gerçek şekle göre güncellenmeli.
import { extractTariffs, priceFromTariffs, createVeriApi } from '../server/veriapi.mjs';
import { lookupAll, _clearCache } from '../server/occupancy.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };

const KEY = 'va_TEST-NOT-REAL';
const body = { veri: { operatorler: [
  { kod: 'zes', ad: 'ZES', ac: 10.99, dc: [{ min_kw: 0, max_kw: 100, tl_kwh: 14.5 }, { min_kw: 101, max_kw: 400, tl_kwh: 16.49 }] },
  { kod: 'esarj', ad: 'Eşarj', ac_tl_kwh: 9.9, dc_tl_kwh: 11.5 },
  { kod: 'x', ad: 'Bozuk', ac: 0, dc: -3 },
  { kod: 'y', ad: 'Fahiş', ac: 999 },
] }, kaynak: [], bayat: false };

// --- çözücü
const rows = extractTariffs(body);
ok('çözücü: geçerli iki işletmeci, sıfır/negatif/fahiş değerli olanlar atılır', rows.length === 2 && rows.map((r) => r.code).join() === 'zes,esarj');
ok('çözücü: düz dizi de kabul edilir', extractTariffs([{ kod: 'zes', ad: 'ZES', dc: 15 }]).length === 1);
ok('çözücü: anlaşılmayan gövde → []', extractTariffs({ veri: { x: 1 } }).length === 0 && extractTariffs(null).length === 0 && extractTariffs('?').length === 0);
// --- fiyat
const st = { id: 's1', lat: 41, lon: 28.9, dc: true, op: 'Zes' };
ok('AC/DC ayrımı: DC istasyonda DC, AC istasyonda AC', priceFromTariffs(rows, st).kwh === 16.49 && priceFromTariffs(rows, { ...st, dc: false }).kwh === 10.99);
ok('güç bilinmiyorsa en pahalı kademe (maliyet düşük gösterilmez); güç biliniyorsa kademesi', priceFromTariffs(rows, { ...st, kw: 60 }).kwh === 14.5 && priceFromTariffs(rows, { ...st, kw: 180 }).kwh === 16.49);
ok('Türkçe harf: "Eşarj" ↔ "esarj"', priceFromTariffs(rows, { ...st, op: 'ESARJ' }).kwh === 11.5);
ok('işletmeci adı yoksa istasyon adındaki marka kullanılır', priceFromTariffs(rows, { ...st, op: 'Diğer', n: 'ZES Bolu' }).kwh === 16.49);
ok('farklı marka ya da markasız istasyon → fiyat yok (yanlış işletmeci fiyatı gösterilmez)', priceFromTariffs(rows, { ...st, op: 'Trugo' }) === null && priceFromTariffs(rows, { ...st, op: '', n: '' }) === null);
const p = priceFromTariffs(rows, st, 123);
ok('fiyat şekli: TRY, kaynak veriapi, zaman damgası', p.currency === 'TRY' && p.src === 'veriapi' && p.at === 123 && p.flat === null);

// --- ağ katmanı
const mk = (res) => { const calls = []; return { calls, fetchImpl: async (u, o) => { calls.push({ u: String(u), key: o.headers['X-API-Key'] }); return res(); } }; };
const okRes = () => ({ ok: true, status: 200, json: async () => body });
{
  let t = 1e12;
  const m = mk(okRes);
  const v = createVeriApi({ key: KEY, fetchImpl: m.fetchImpl, now: () => t });
  ok('ilk istekte fiyat henüz yok (arka planda çekilir), sonra gelir', v.priceFor(st) === null && (await v.refresh(), v.priceFor(st)?.kwh === 16.49));
  ok('doğru uç ve anahtar başlığı, tek çağrı', m.calls.length === 1 && m.calls[0].u.endsWith('/v1/sarj/fiyatlar') && m.calls[0].key === KEY);
  v.priceFor(st); v.priceFor(st);
  ok('24 saat dolmadan yeniden çekilmez', m.calls.length === 1);
  t += 25 * 3600e3; v.priceFor(st); await v.refresh();
  ok('24 saat sonra tazelenir', m.calls.length === 2 || m.calls.length === 3);
}
{
  let t = 1e12;
  const m = mk(() => ({ ok: false, status: 429, json: async () => ({}) }));
  const v = createVeriApi({ key: KEY, fetchImpl: m.fetchImpl, now: () => t });
  const err = console.error; console.error = () => {};
  v.priceFor(st); await v.refresh(); v.priceFor(st); v.priceFor(st);
  const afterFail = m.calls.length;
  t += 61 * 60e3; v.priceFor(st); await v.refresh();
  console.error = err;
  ok('hata sonrası 1 saat beklenir (kotayı tüketmez), sonra yeniden dener, fiyat üretmez', afterFail === 1 && m.calls.length === 2 && v.priceFor(st) === null);
}
{
  const m = mk(() => ({ ok: true, status: 200, json: async () => ({ veri: { x: 1 } }) }));
  const v = createVeriApi({ key: KEY, fetchImpl: m.fetchImpl });
  const err = console.error; console.error = () => {};
  await v.refresh(); console.error = err;
  ok('anlaşılmayan şema: fiyat üretilmez (sessizce kapalı)', v.priceFor(st) === null && v.status().operators === 0);
}
{
  const m = mk(okRes);
  const v = createVeriApi({ key: '', fetchImpl: m.fetchImpl });
  ok('anahtar yok: pasif, ağ çağrısı yok', v.enabled === false && v.priceFor(st) === null && (await v.refresh()) === false && m.calls.length === 0);
}
{
  const store = { data: {}, save() { this.saved = true; } };
  const m = mk(okRes);
  const a = createVeriApi({ key: KEY, store, fetchImpl: m.fetchImpl });
  await a.refresh();
  const b = createVeriApi({ key: KEY, store, fetchImpl: m.fetchImpl });
  ok('yeniden başlatma: kalıcı tablo okunur, yeniden çekilmez', store.saved && b.priceFor(st)?.kwh === 16.49 && m.calls.length === 1);
}

// --- doluluk birleştiricisi
{
  _clearCache();
  const veri = { priceFor: () => ({ currency: 'TRY', kwh: 16.49, flat: null, hour: null, parkingHour: null, src: 'veriapi', at: 1 }) };
  const r = await lookupAll([{ id: 'a', lat: 41, lon: 28.9, dc: true, op: 'Zes' }], { veri });
  ok('canlı veri yokken tarife fiyatı döner, doluluk bilinmiyor kalır', r.a.price.src === 'veriapi' && r.a.total === null && r.a.available === null);
  _clearCache();
  const book = { nearest: () => ({ kwh: 12, currency: 'TRY', n: 2, at: 5 }) };
  const r2 = await lookupAll([{ id: 'b', lat: 41, lon: 28.9, dc: true, op: 'Zes' }], { veri, book });
  ok('kullanıcı bildirimi VeriApi.Pro tarifesinden önceliklidir', r2.b.price.src === 'user' && r2.b.price.kwh === 12);
  _clearCache();
  const r3 = await lookupAll([{ id: 'c', lat: 41, lon: 28.9, dc: true, op: 'Zes' }], { veri: { priceFor: () => null } });
  ok('tarife de yoksa sonuç null', r3.c === null);
}

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
