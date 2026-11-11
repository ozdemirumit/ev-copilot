// TomTom canlı doluluk adaptörü (sunucu): sahte yanıtlarla, gerçek anahtar/ağ olmadan. Kullanım: node scripts/test-tomtom.mjs
import { readFileSync } from 'node:fs';
import { tomtomLookup, tomtomSlots, pickStation, brandTokens, sameBrand, tomtomAllowed, tomtomUsage, tomtomRoute, validPts, _clearIds } from '../server/tomtom.mjs';
import { lookupAll, _clearCache } from '../server/occupancy.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const KEY = 'TEST-KEY-NOT-REAL';
const st = { id: 's1', lat: 41.0, lon: 28.98, dc: true };
const search = (id, lat = 41.0, lon = 28.98) => ({ results: [{ position: { lat, lon }, dataSources: { chargingAvailability: { id } } }] });
const avail = (cur, per = [{ powerKW: 60 }]) => ({ connectors: [{ type: 'IEC62196Type2CCS', total: 4, availability: { current: cur, perPowerLevel: per.map((p) => ({ available: cur.available, occupied: cur.occupied, outOfService: cur.outOfService, unknown: cur.unknown, reserved: 0, ...p })) } }] });
const mk = (routes) => {
  const calls = [];
  const fetchImpl = async (u) => {
    const url = new URL(u);
    calls.push(url.pathname);
    const r = routes(url);
    return { ok: r.status ? r.status < 400 : true, status: r.status || 200, json: async () => r.body };
  };
  return { fetchImpl, calls };
};

// --- saf işlevler
ok('pickStation: ≤150 m ve kimlikli en yakın', pickStation([{ position: { lat: 41.0, lon: 28.98 }, dataSources: { chargingAvailability: { id: 'a' } } }], st)?.id === 'a');
ok('pickStation: uzak (>150 m) ya da kimliksiz elenir', pickStation([{ position: { lat: 41.01, lon: 28.98 }, dataSources: { chargingAvailability: { id: 'a' } } }, { position: { lat: 41.0, lon: 28.98 }, dataSources: {} }], st) === null);
// --- marka denetimli eşleşme
{
  const at = (dLat, brand, id) => ({ position: { lat: 41.0 + dLat, lon: 28.98 }, poi: { name: 'x', brands: brand ? [{ name: brand }] : [] }, dataSources: { chargingAvailability: { id } } });
  const near = 0.0005; // ~55 m
  const mid = 0.003; // ~330 m
  ok('markaTokenları: büyük/küçük harf, Türkçe harf ve genel sözcükler', eq(brandTokens('Eşarj'), ['esarj']) && eq(brandTokens('ZES', 'Zes Şarj'), ['zes']) && eq(brandTokens('Trugo Şarj İstasyonu'), ['trugo']) && eq(brandTokens('Diğer'), []));
  ok('sameBrand: aynı marka true, farklı false, bilinmeyen null', sameBrand(['zes'], ['zes']) === true && sameBrand(['otopriz'], ['zes']) === false && sameBrand([], ['zes']) === null && sameBrand(['zes'], []) === null);
  ok('aynı marka 330 m uzakta kabul edilir', pickStation([at(mid, 'ZES', 'z1')], { ...st, op: 'Zes' })?.id === 'z1');
  ok('farklı marka çok yakında (55 m) bile reddedilir (başka operatörün doluluğu gösterilmez)', pickStation([at(near, 'ZES', 'z1')], { ...st, op: 'Otopriz' }) === null);
  ok('aynı otoparkta iki marka: doğru markanın kaydı seçilir', pickStation([at(near, 'ZES', 'z1'), at(mid, 'Trugo', 't1')], { ...st, op: 'Trugo' })?.id === 't1');
  ok('marka bilinmiyorsa (op yok) eski kural: 150 m kabul, 330 m red', pickStation([at(near, 'ZES', 'z1')], st)?.id === 'z1' && pickStation([at(mid, 'ZES', 'z1')], st) === null);
  ok('TomTom kaydında marka yoksa 150 m kuralı', pickStation([at(near, null, 'n1')], { ...st, op: 'Zes' })?.id === 'n1' && pickStation([at(mid, null, 'n1')], { ...st, op: 'Zes' }) === null);
  ok('işletmeci genel ("Diğer") ise istasyon adındaki marka kullanılır', pickStation([at(mid, 'Trugo', 't1')], { ...st, op: 'Diğer', n: 'Trugo Bolu' })?.id === 't1');
  ok('400 m dışı aynı marka da reddedilir', pickStation([at(0.005, 'ZES', 'z1')], { ...st, op: 'Zes' }) === null);
}
ok('tomtomSlots: sayılar (boş/dolu/arızalı)', eq(tomtomSlots(avail({ available: 2, occupied: 1, outOfService: 1, unknown: 0, reserved: 0 }), true), { total: 4, available: 2, out: 1 }));
ok('tomtomSlots: hepsi dolu → 0/4 (dolu)', eq(tomtomSlots(avail({ available: 0, occupied: 4, outOfService: 0, unknown: 0, reserved: 0 }), true), { total: 4, available: 0, out: 0 }));
ok('tomtomSlots: boş yok ama bilinmeyen var → belirsiz (null), "dolu" denmez', tomtomSlots(avail({ available: 0, occupied: 2, outOfService: 0, unknown: 2, reserved: 0 }), true) === null);
ok('tomtomSlots: hiçbiri canlı değil (hepsi bilinmiyor) → null', tomtomSlots(avail({ available: 0, occupied: 0, outOfService: 0, unknown: 4, reserved: 0 }), true) === null);
ok('tomtomSlots: DC isteğinde yalnızca ≥40 kW seviyeler', eq(tomtomSlots({ connectors: [{ availability: { current: { available: 5, occupied: 0, outOfService: 0, unknown: 0, reserved: 0 }, perPowerLevel: [{ powerKW: 22, available: 3, occupied: 0, outOfService: 0, unknown: 0 }, { powerKW: 60, available: 2, occupied: 0, outOfService: 0, unknown: 0 }] } }] }, true), { total: 2, available: 2, out: 0 }));
ok('tomtomSlots: boş/bozuk yanıt → null', tomtomSlots(null, true) === null && tomtomSlots({}, false) === null && tomtomSlots({ connectors: [{}] }, false) === null);

// --- ağ akışı (sahte)
{
  _clearIds();
  const { fetchImpl, calls } = mk((u) => (u.pathname.includes('categorySearch') ? { body: search('abc') } : { body: avail({ available: 3, occupied: 1, outOfService: 0, unknown: 0, reserved: 0 }) }));
  const r = await tomtomLookup(st, KEY, { fetchImpl, now: 1000 });
  ok('arama + durum: iki istek, sonuç tomtom', calls.length === 2 && r?.src === 'tomtom' && r.available === 3 && r.total === 4 && r.price === null && r.at === 1000);
  await tomtomLookup(st, KEY, { fetchImpl, now: 2000 });
  ok('doluluk kimliği saklanır: ikinci sorguda yalnızca durum isteği', calls.length === 3 && calls[2].includes('chargingAvailability'));
}
{
  _clearIds();
  const { fetchImpl, calls } = mk(() => ({ body: { results: [] } }));
  const r = await tomtomLookup({ ...st, lat: 40.5 }, KEY, { fetchImpl });
  await tomtomLookup({ ...st, lat: 40.5 }, KEY, { fetchImpl });
  ok('kimlik yoksa null ve sonuçsuzluk da saklanır (tekrar arama yok)', r === null && calls.length === 1);
}
{
  _clearIds();
  const { fetchImpl } = mk(() => ({ status: 403, body: {} }));
  let err = null;
  try { await tomtomLookup({ ...st, lat: 39.9 }, KEY, { fetchImpl }); } catch (e) { err = e; }
  ok('HTTP hatası fırlatır, iletide anahtar yok', err?.status === 403 && !String(err.message).includes(KEY));
}


// --- rota (sunucu): sabit parametreler, nokta doğrulama, hata iletisi
{
  ok('validPts: geçerli noktalar', validPts('39.92080,32.85410:41.00820,28.97840') && validPts('39.9,32.8:40.1,31.2:41.0,29.0'));
  ok('validPts: tek nokta, harf, enjeksiyon, çok uzun reddedilir', !validPts('39.9,32.8') && !validPts('a,b:c,d') && !validPts('39.9,32.8:41.0,29.0&key=x') && !validPts('39.9,32.8:41.0,29.0/../x') && !validPts(null) && !validPts('1.1,1.1:'.repeat(120) + '1.1,1.1'));
  let seen = null;
  const fetchImpl = async (u) => { seen = new URL(u); return { ok: true, status: 200, json: async () => ({ routes: [] }) }; };
  await tomtomRoute(KEY, '39.9208,32.8541:41.0082,28.9784', { fetchImpl });
  ok('rota isteği: trafik, Türkçe, trafik + hız limiti bölümleri, anahtar sorguda', seen.pathname === '/routing/1/calculateRoute/39.9208,32.8541:41.0082,28.9784/json' && seen.searchParams.get('traffic') === 'true' && seen.searchParams.get('language') === 'tr-TR' && seen.searchParams.getAll('sectionType').join() === 'traffic,speedLimit' && seen.searchParams.get('key') === KEY);
  let err = null;
  try { await tomtomRoute(KEY, '39.9208,32.8541:41.0082,28.9784', { fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }) }); } catch (e) { err = e; }
  ok('rota: HTTP hatası status taşır, iletide anahtar yok', err?.status === 403 && !String(err.message).includes(KEY));
  let bad = null;
  try { await tomtomRoute(KEY, 'x', { fetchImpl }); } catch (e) { bad = e; }
  ok('rota: geçersiz noktalar HTTP çağrısı yapmadan 400', bad?.status === 400);
}

// --- günlük tavan
{
  const before = tomtomUsage().used;
  ok('günlük sayaç istek başına artar', before > 0 && tomtomAllowed());
  process.env.TOMTOM_DAILY_CAP = '1';
  ok('tavan aşılınca izin verilmez', tomtomAllowed() === false);
  delete process.env.TOMTOM_DAILY_CAP;
}

// --- birleştirici: HERE yoksa TomTom, TomTom yoksa/boşsa sonraki
{
  _clearCache(); _clearIds();
  const { fetchImpl } = mk((u) => (u.pathname.includes('categorySearch') ? { body: search('x1', 38.0, 27.0) } : { body: avail({ available: 1, occupied: 3, outOfService: 0, unknown: 0, reserved: 0 }) }));
  const out = await lookupAll([{ id: 'a', lat: 38.0, lon: 27.0, dc: true }], { tomtom: { key: KEY, allow: () => true }, fetchImpl });
  ok('lookupAll: TomTom sonucu istasyona yazılır', out.a?.src === 'tomtom' && out.a.available === 1 && out.a.total === 4);
  _clearCache();
  const out2 = await lookupAll([{ id: 'b', lat: 38.1, lon: 27.1, dc: true }], { tomtom: { key: KEY, allow: () => false }, fetchImpl });
  ok('lookupAll: kota doluysa TomTom sorulmaz', out2.b == null);
  _clearCache();
  const out3 = await lookupAll([{ id: 'c', lat: 38.2, lon: 27.2, dc: true }], { fetchImpl });
  ok('lookupAll: TomTom ayarı yoksa eskisi gibi (boş)', out3.c == null);
}

// --- kaynak sözleşmeleri: anahtar yalnızca sunucuda, günlüğe ve çıktıya sızmaz
const proxy = readFileSync(new URL('../server/proxy.mjs', import.meta.url), 'utf8');
const tt = readFileSync(new URL('../server/tomtom.mjs', import.meta.url), 'utf8');
ok('anahtar günlük temizleyicisinde (scrub)', /GOOGLE_PLACES, HERE, TOMTOM, env\.VERIAPI_KEY, env\.TOMTOM_MAP_KEY,/.test(proxy));
ok('rota uç noktası: Premium şart, kullanıcı başı kota, günlük tavan, anahtar sunucuda', /p === '\/tomtom\/route'/.test(proxy) && /premiumOk\(id\)\) return json\(res, 402, \{ error: 'premium_required' \}\)/.test(proxy) && /overQuota\(id, 'tomtom'\)/.test(proxy) && /tomtom_cap/.test(proxy));
ok('TomTom anahtarı istemciye (js/) gitmez', !/TOMTOM_KEY|tomtom\.mjs/i.test(readFileSync(new URL('../js/routing/occupancyClient.js', import.meta.url), 'utf8')));
ok('hata iletisi yanıt gövdesi/anahtar içermez', /new Error\('TomTom HTTP ' \+ res\.status\)/.test(tt) && !/res\.text\(\)/.test(tt));
ok('istemcide TomTom adı gösterilir (atıf)', /sl\.src === 'tomtom'/.test(readFileSync(new URL('../js/routing/slots.js', import.meta.url), 'utf8')));

console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
