// İstemci log yükleme (js/diag/clientLog.js çekirdek + js/diag/clientLogInit.js bağlama) testleri (bağımsız, düz node): node scripts/test-client-log.mjs
// Tamamen çevrimdışı: sahte saat/send/depo/window; gerçek ağ yok. Kurallar: konum/URL/e-posta/koordinat loglanmaz; kapalıyken hiçbir şey
// kuyruklanmaz ve kuyruk silinir; toplu gönderim 40 olay / 14000 bayt; geri çekilme 30 sn → 600 sn; 4xx'te düşür + 30 dk dur; tek uçuş.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}`); } }
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// Sahte yerel depo: kararlı deviceId ve gerçek ağa çıkmama için (Node'un kendi localStorage'ı yok).
const lsMap = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null), setItem: (k, v) => lsMap.set(k, String(v)), removeItem: (k) => lsMap.delete(k) },
});
globalThis.APP_VERSION = '0.99.123';

const C = await import('../js/diag/clientLog.js');
const I = await import('../js/diag/clientLogInit.js');
const { LIMITS } = C;

const T0 = 1_732_300_000_000;
const SEC = 1000, MIN = 60 * SEC;
const CLIENT_KEYS = ['apk', 'did', 'lang', 'net', 'online', 'p', 'sa', 'sid', 'tz', 'v', 'vh', 'vw'];
const goodInfo = () => ({ v: '0.99.123', p: 'Android', sa: true, apk: false, lang: 'tr', tz: 180, online: true, vw: 390, vh: 844, net: '4g', sid: 's_AbC123xyz', did: 'd_AbCdEfGhIjKlMnOpQrSt' });

/** Sahte ortam: saat, depo (JSON gidiş-dönüş, yazma sayacı), send (sıralı yanıtlar), açma/kapama. */
function mk(opts = {}) {
  const st = new Map();
  const env = { t: T0, on: true, writes: 0, sent: [], resp: [], pend: null, store: st, info: opts.info || goodInfo };
  const storage = {
    get: (k) => (st.has(k) ? JSON.parse(st.get(k)) : null),
    set: (k, v) => { env.writes++; st.set(k, JSON.stringify(v)); },
  };
  const send = async (batch) => {
    env.sent.push(JSON.parse(JSON.stringify(batch)));
    if (env.pend) return env.pend.promise;
    const r = env.resp.length ? env.resp.shift() : { status: 200 };
    if (r instanceof Error) throw r;
    return r;
  };
  env.make = (extra = {}) => C.createClientLog({ now: () => env.t, send, storage, info: () => env.info(), enabled: () => env.on, rand: () => 0.5, ...extra });
  env.log = env.make(opts.core);
  return env;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const storedQ = (env) => { const v = env.store.get('clientLogQ'); return v ? JSON.parse(v).q : null; };

// ---- A) temizleme ----
{
  const e = mk();
  e.log.log('app.start', 'Hata https://evil.example/x?token=1 foo@bar.com 41.015137,28.979530 sonu', { a: 1 });
  const ev = e.log.pending()[0];
  ok('A URL/e-posta/koordinat iletiden çıkar', ev.m === 'Hata sonu');
  e.log.log('long', 'x'.repeat(1000));
  ok('A uzun ileti kırpılır (<= 160 <= 300)', e.log.pending()[1].m.length <= 160 && e.log.pending()[1].m.length <= LIMITS.mMax);
  e.log.error('err.x', new Error('Boom http://a.b/c'));
  ok('A error(): Error nesnesi iletisi temizlenir, lvl error', e.log.pending()[2].lvl === 'error' && e.log.pending()[2].m === 'Boom');
  e.log.warn('w.x', 'uyarı');
  ok('A warn(): lvl warn', e.log.pending()[3].lvl === 'warn');
  e.log.log('w.y', 'bilinmeyen düzey', null, 'debug');
  ok('A geçersiz düzey info olur', e.log.pending()[4].lvl === 'info');
  e.log.log('z.empty', '');
  ok('A boş ileti "(boş)"', e.log.pending()[5].m === '(boş)');
  ok('A olay zamanı now()', e.log.pending().every((x) => x.t === T0));
}

// ---- B) k normalizasyonu ----
{
  const e = mk();
  const bad = ['Bad Key!', '', 'A.b', '1abc', 'a'.repeat(40), null, undefined, 42, { x: 1 }, 'ünicode'];
  bad.forEach((k, i) => { e.t += 1000; e.log.log(k, 'm' + i); });
  ok('B geçersiz k hepsi "other" (olay düşmez)', e.log.pending().length === bad.length && e.log.pending().every((x) => x.k === 'other'));
  const e2 = mk();
  ['a', 'voice.error', 'a-b_c.d9', 'a'.repeat(32)].forEach((k) => e2.log.log(k, k));
  ok('B geçerli k aynen kalır', e2.log.pending().map((x) => x.k).join() === ['a', 'voice.error', 'a-b_c.d9', 'a'.repeat(32)].join());
  ok('B 33 karakter k other', (() => { const e3 = mk(); e3.log.log('a'.repeat(33), 'x'); return e3.log.pending()[0].k === 'other'; })());
}

// ---- C) d süzme ----
{
  const e = mk();
  e.log.log('d.test', 'm', { a: 1, b: true, c: 'y'.repeat(100), url: 'https://evil.example/x', coord: '41.015137,28.979530', mail: 'a@b.com', obj: { x: 1 }, arr: [1, 2], nan: NaN, inf: Infinity, nul: null, und: undefined, 'bad key': 1, n: 99, ok2: 'tamam', f: false });
  const d = e.log.pending()[0].d;
  ok('C sayı/boolean/metin kalır', d.a === 1 && d.b === true && d.f === false && d.ok2 === 'tamam');
  ok('C uzun metin 60 karaktere kırpılır', d.c.length === 60);
  ok('C URL/koordinat/e-posta değerleri atılır', !('url' in d) && !('coord' in d) && !('mail' in d));
  ok('C iç içe nesne/dizi/NaN/Infinity/null/geçersiz anahtar atılır', !('obj' in d) && !('arr' in d) && !('nan' in d) && !('inf' in d) && !('nul' in d) && !('und' in d) && !('bad key' in d));
  ok('C ayrılmış n anahtarı kullanıcıdan alınmaz', !('n' in d));
  const many = {}; for (let i = 0; i < 20; i++) many['k' + i] = i;
  e.log.log('d.many', 'm', many);
  ok('C en çok 8 anahtar', Object.keys(e.log.pending()[1].d).length === 8);
  e.log.log('d.none', 'm', { obj: {} });
  ok('C hiç geçerli alan yoksa d yok', !('d' in e.log.pending()[2]));
  e.log.log('d.str', 'm', 'metin');
  ok('C d nesne değilse yoksayılır', !('d' in e.log.pending()[3]));
  e.log.log('d.mixed', 'm', { text: 'Bakınız https://x.y/z sonra' });
  ok('C metin içindeki URL temizlenir', e.log.pending()[4].d.text === 'Bakınız sonra');
}

// ---- D) tekilleştirme ----
{
  const e = mk();
  e.log.log('dup.x', 'aynı', { a: 1 });
  e.t += 10 * SEC; e.log.log('dup.x', 'aynı');
  e.t += 10 * SEC; e.log.log('dup.x', 'aynı');
  ok('D 60 sn içinde tekrar yeni olay üretmez; n artar', e.log.pending().length === 1 && e.log.pending()[0].d.n === 3 && e.log.pending()[0].d.a === 1);
  e.t += 45 * SEC; // ilk olaydan 65 sn
  e.log.log('dup.x', 'aynı');
  ok('D 60 sn sonra yeni olay', e.log.pending().length === 2 && !('n' in (e.log.pending()[1].d || {})));
  e.log.log('dup.x', 'aynı', null, 'warn');
  e.log.log('dup.x', 'başka');
  ok('D farklı lvl / ileti ayrı olay', e.log.pending().length === 4);
  const e2 = mk();
  const q = []; for (let i = 0; i < 8; i++) q.push(i);
  const d8 = {}; q.forEach((i) => { d8['k' + i] = i; });
  e2.log.log('dup.y', 'm', d8); e2.log.log('dup.y', 'm');
  const dd = e2.log.pending()[0].d;
  ok('D 8 anahtarlı d tekrarda n ile 8 sınırını aşmaz', Object.keys(dd).length === 8 && dd.n === 2);
  ok('D tekrar sayacı kalıcı depoya yazılır', storedQ(e2)[0].d.n === 2);
}

// ---- E) hız sınırı ----
{
  const e = mk();
  const results = [];
  for (let i = 0; i < 25; i++) results.push(e.log.log('rate.x', 'olay' + i));
  const p = e.log.pending();
  ok('E dakikada en çok 20 olay kuyruğa girer', results.slice(0, 20).every(Boolean) && results.slice(20).every((r) => r === false));
  const sums = p.filter((x) => x.k === 'log.dropped');
  ok('E aşan olaylar için tek bir log.dropped özeti (n = düşen sayı)', sums.length === 1 && sums[0].d.n === 5 && sums[0].lvl === 'warn' && p.length === 21);
  ok('E state().dropped düşenleri sayar', e.log.state().dropped === 5);
  e.t += 61 * SEC;
  ok('E pencere dolunca yeniden kabul', e.log.log('rate.x', 'yeni') === true);
  for (let i = 0; i < 25; i++) e.log.log('rate.y', 'b' + i);
  ok('E sonraki aşımda yeni (ikinci) özet açılır', e.log.pending().filter((x) => x.k === 'log.dropped').length === 2);
}

// ---- F) kuyruk tavanı + kalıcılık + bozuk depo ----
{
  const e = mk();
  for (let i = 0; i < 130; i++) { e.t += 4 * SEC; e.log.log('q.x', 'olay' + i); }
  const p = e.log.pending();
  ok('F kuyruk tavanı 100, en yeniler kalır', p.length === 100 && p[0].m === 'olay30' && p[99].m === 'olay129');
  ok('F aşan en eskiler dropped sayılır', e.log.state().dropped === 30);
  ok('F depoda da <= 100 olay', storedQ(e).length === 100);
  const e2 = mk(); e2.store = e.store;
  const other = C.createClientLog({ now: () => e.t, send: async () => ({ status: 200 }), storage: { get: (k) => (e.store.has(k) ? JSON.parse(e.store.get(k)) : null), set: () => {} }, info: goodInfo, enabled: () => true });
  other.restore();
  ok('F restore() depodaki kuyruğu okur', other.pending().length === 100 && other.pending()[99].m === 'olay129');

  const mkBad = (value) => { const s = new Map([['clientLogQ', JSON.stringify(value)]]); return C.createClientLog({ now: () => T0, send: async () => ({ status: 200 }), storage: { get: (k) => (s.has(k) ? JSON.parse(s.get(k)) : null), set: (k, v) => s.set(k, JSON.stringify(v)) }, info: goodInfo, enabled: () => true }); };
  for (const bad of ['çöp', 42, null, { q: 'x' }, { v: 1 }, [1, 2], { q: [1, null, 'a', { t: 'x' }, { t: -5 }] }]) {
    const c = mkBad(bad); c.restore();
    ok(`F bozuk depo yoksayılır (${JSON.stringify(bad).slice(0, 24)})`, c.pending().length === 0);
  }
  const mixed = mkBad({ v: 1, q: [{ t: T0, lvl: 'error', k: 'BAD KEY', m: 'iletişim https://a.b/c', d: { x: 1, u: 'https://a.b' } }, { t: 'x' }] });
  mixed.restore();
  ok('F depodan gelen olay yeniden temizlenir', mixed.pending().length === 1 && mixed.pending()[0].k === 'other' && mixed.pending()[0].m === 'iletişim' && mixed.pending()[0].d.x === 1 && !('u' in mixed.pending()[0].d));
  const throwing = C.createClientLog({ now: () => T0, send: async () => ({ status: 200 }), storage: { get: () => { throw new Error('depo'); }, set: () => { throw new Error('depo'); } }, info: goodInfo, enabled: () => true });
  throwing.restore(); throwing.log('x.y', 'z');
  ok('F depo hata verirse sessiz kalır, bellekte çalışır', throwing.pending().length === 1);
  const big = mkBad({ v: 1, q: Array.from({ length: 150 }, (_, i) => ({ t: T0 + i, lvl: 'info', k: 'a.b', m: 'm' + i })) });
  big.restore();
  ok('F restore tavanı: en yeni 100', big.pending().length === 100 && big.pending()[0].m === 'm50');
}

// ---- G) toplu gönderim sınırları + başarı ----
{
  const e = mk();
  for (let i = 0; i < 100; i++) { e.t += 4 * SEC; e.log.log('b.x', 'olay' + i); }
  e.t += 1000;
  const r = await e.log.flush();
  ok('G başarıda kuyruk boşalır', r.status === 200 && e.log.pending().length === 0 && e.log.state().sent === 100);
  ok('G her istekte <= 40 olay', e.sent.length === 3 && e.sent.every((b) => b.events.length <= 40) && e.sent.map((b) => b.events.length).join() === '40,40,20');
  ok('G olay sırası korunur (eski → yeni)', e.sent[0].events[0].m === 'olay0' && e.sent[2].events[19].m === 'olay99');
  ok('G başarıdan sonra depo boş', storedQ(e).length === 0);
  const r2 = await e.log.flush();
  ok('G boş kuyrukta flush ağa çıkmaz', r2.skipped === 'empty' && e.sent.length === 3);

  const f = mk();
  const d8 = {}; for (let i = 0; i < 8; i++) d8['key' + i] = 'v'.repeat(60);
  for (let i = 0; i < 60; i++) { f.t += 4 * SEC; f.log.log('big.ev', 'ş'.repeat(150) + i, d8); }
  await f.log.flush();
  const sizes = f.sent.map((b) => Buffer.byteLength(JSON.stringify(b)));
  ok('G gövde <= 14000 bayt (sunucu sınırı 16000)', sizes.length >= 2 && sizes.every((s) => s <= LIMITS.softBodyBytes) && LIMITS.softBodyBytes < LIMITS.maxBodyBytes);
  ok('G bayt sınırı olsa da hiçbir olay kaybolmaz', f.sent.reduce((a, b) => a + b.events.length, 0) === 60 && f.log.pending().length === 0);
}

// ---- H) hata ve geri çekilme ----
{
  const e = mk();
  e.log.log('h.x', 'bir');
  e.resp.push({ status: 503 });
  let r = await e.log.flush();
  ok('H 5xx olay kuyrukta kalır, 30 sn geri çekilme', r.status === 503 && e.log.pending().length === 1 && e.log.state().backoffUntil === T0 + 30 * SEC && e.log.state().failed === 1);
  const n1 = e.sent.length;
  r = await e.log.flush();
  ok('H geri çekilmede flush hiçbir şey yapmaz', r.skipped === 'backoff' && e.sent.length === n1);
  e.t = T0 + 29 * SEC; await e.log.flush();
  ok('H süre dolmadan yine yok', e.sent.length === n1);
  const delays = [];
  let prev = T0;
  for (let i = 0; i < 7; i++) {
    e.t = e.log.state().backoffUntil; e.resp.push(i % 2 ? { status: 500 } : new Error('ağ yok'));
    await e.log.flush();
    delays.push((e.log.state().backoffUntil - e.t) / SEC);
    prev = e.t;
  }
  ok('H üstel: 60,120,240,480,600,600,600 sn (ağ hatası dahil)', delays.join() === '60,120,240,480,600,600,600');
  const n2 = e.sent.length;
  e.resp.push({ status: 500 });
  await e.log.flush({ force: true });
  ok('H force geri çekilmeyi atlar (istek gider)', e.sent.length === n2 + 1);
  ok('H force sayaç/üssü sıfırlamaz (ardışık hata sürer)', e.log.state().backoffUntil - e.t === 600 * SEC);
  e.t = e.log.state().backoffUntil; e.resp.push({ status: 200 });
  r = await e.log.flush();
  ok('H başarı kuyruğu boşaltır ve geri çekilmeyi sıfırlar', r.status === 200 && e.log.pending().length === 0 && e.log.state().backoffUntil === 0 && e.log.state().sent === 1);
  e.log.log('h.y', 'iki'); e.resp.push({ status: 502 }); await e.log.flush();
  ok('H başarıdan sonra yeni hata yine 30 sn ile başlar', e.log.state().backoffUntil - e.t === 30 * SEC);
  ok('H 5xx olay depoda saklı kalır', storedQ(e).length === 1);
  e.t = e.log.state().backoffUntil; e.resp.push({ status: 408 }); await e.log.flush();
  ok('H 408 yeniden denenir (düşürülmez)', e.log.pending().length === 1 && e.log.state().blockedUntil === 0);
}

// ---- I) 429 Retry-After ----
{
  const e = mk();
  e.log.log('r.x', 'bir');
  e.resp.push({ status: 429, retryAfterSec: 300 });
  await e.log.flush();
  ok('I 429: Retry-After (300 sn) 30 sn geri çekilmeden büyükse onu bekler', e.log.state().backoffUntil === T0 + 300 * SEC && e.log.pending().length === 1);
  e.t = T0 + 301 * SEC; e.resp.push({ status: 429, retryAfterSec: 5 });
  await e.log.flush();
  ok('I 429: küçük Retry-After üstel geri çekilmenin altına inmez (en az onu bekle: max)', e.log.state().backoffUntil === e.t + 60 * SEC);
  e.t = e.log.state().backoffUntil; e.resp.push({ status: 429, retryAfterSec: 999999 });
  await e.log.flush();
  ok('I 429: aşırı Retry-After en çok 1 saat', e.log.state().backoffUntil === e.t + 3600 * SEC);
  e.t = e.log.state().backoffUntil; e.resp.push({ status: 429 });
  await e.log.flush();
  ok('I 429 Retry-After yoksa üstel geri çekilme', e.log.state().backoffUntil - e.t === 240 * SEC && e.log.pending().length === 1);
}

// ---- J) 4xx: düşür + 30 dk dur ----
for (const code of [400, 401, 403, 404, 413]) {
  const e = mk();
  e.log.log('j.x', 'bir'); e.log.log('j.y', 'iki');
  e.resp.push({ status: code });
  const r = await e.log.flush();
  const s = e.log.state();
  ok(`J ${code}: toplu istek düşürülür (yeniden deneme yok)`, r.status === code && e.log.pending().length === 0 && s.dropped === 2 && e.sent.length === 1 && storedQ(e).length === 0);
  ok(`J ${code}: 30 dk gönderim durur`, s.blockedUntil === T0 + 30 * MIN);
  e.log.log('j.z', 'üç');
  const n = e.sent.length;
  await e.log.flush(); await e.log.flush({ force: true });
  ok(`J ${code}: engelde flush/force ağa çıkmaz`, e.sent.length === n && (await e.log.flush({ force: true })).skipped === 'blocked');
  e.t = T0 + 30 * MIN + 1;
  await e.log.flush();
  ok(`J ${code}: 30 dk sonra yeniden gönderir`, e.sent.length === n + 1 && e.log.pending().length === 0);
}
{
  const e = mk();
  e.log.log('j.a', 'a'); e.resp.push({ status: 400 }); await e.log.flush();
  const cont = e.make(); cont.restore();
  cont.log('j.b', 'b'); const n = e.sent.length; await cont.flush();
  ok('J engel yeniden başlatmada da sürer (depoda kalıcı)', e.sent.length === n && cont.state().blockedUntil === T0 + 30 * MIN);
}

// ---- K) tek uçuş ----
{
  const e = mk();
  e.log.log('k.x', 'bir');
  e.pend = deferred();
  const p1 = e.log.flush(); const p2 = e.log.flush(); const p3 = e.log.flush({ force: true });
  ok('K eşzamanlı flush tek isteğe birleşir (aynı söz)', p1 === p2 && p2 === p3 && e.sent.length === 1);
  e.log.log('k.y', 'iki'); // uçuş sırasında yeni olay
  e.pend.resolve({ status: 200 }); e.pend = null;
  await p1;
  ok('K uçuş sırasında eklenen olay silinmez: ikinci toplu istekte gider', e.sent.length === 2 && e.sent[0].events.length === 1 && e.sent[1].events.length === 1 && e.sent[1].events[0].k === 'k.y' && e.log.pending().length === 0);
  await e.log.flush();
  ok('K uçuş bitince boş kuyrukta yeni istek yok', e.sent.length === 2);
}

// ---- L) kapatma ----
{
  const e = mk();
  e.log.log('l.x', 'bir'); e.log.log('l.y', 'iki');
  ok('L açıkken kuyruk dolu', e.log.pending().length === 2);
  e.on = false;
  const w = e.writes;
  const r1 = e.log.log('l.z', 'üç');
  ok('L kapanınca log() reddeder, kuyruk SİLİNİR', r1 === false && e.log.pending().length === 0 && storedQ(e).length === 0);
  const w2 = e.writes;
  e.log.log('a.b', 'x'); e.log.warn('a.b', 'y'); e.log.error('a.b', 'z'); await e.log.flush({ force: true });
  ok('L kapalıyken hiçbir yazma ve gönderim yok', e.writes === w2 && e.sent.length === 0 && e.log.state().queued === 0);
  ok('L silme için yalnız bir kez yazıldı', w2 - w <= 4);
  e.on = true;
  ok('L yeniden açılınca çalışır', e.log.log('l.a', 'tekrar') === true && e.log.pending().length === 1);
  // başlangıçta kapalı + depoda eski veri
  const s = mk();
  s.log.log('l.old', 'eski');
  s.on = false;
  const re = s.make(); re.restore();
  ok('L restore() kapalıyken depodaki eski veriyi siler', re.pending().length === 0 && storedQ(s).length === 0);
  // uçuş sırasında kapatma
  const m = mk(); m.log.log('l.m', 'orta'); m.pend = deferred();
  const p = m.log.flush(); m.on = false; m.pend.resolve({ status: 500 }); m.pend = null; await p;
  ok('L uçuş sırasında kapatma: kuyruk boş, geri çekilme yok', m.log.pending().length === 0 && m.log.state().backoffUntil === 0);
}

// ---- M) gönderilen gövde şemaya uyar ----
{
  const e = mk();
  e.log.log('app.start', 'Hata https://evil.example/p?x=1 u@x.com 41.015137,28.979530', { sa: true, apk: false, n2: 1, loc: '41.015137,28.979530', page: 'https://a.b/c', obj: { a: 1 } });
  e.log.error('js.error', 'at https://app.example/a.js:1:2', { line: 12, col: 3 });
  e.log.warn('voice.error', 'not-allowed', { r: 'not-allowed' });
  await e.log.flush();
  const b = e.sent[0];
  ok('M gövde anahtarları: schema/client/events', Object.keys(b).sort().join() === 'client,events,schema' && b.schema === 'evrf-client-log/1');
  ok('M client alan kümesi tam', Object.keys(b.client).sort().join() === CLIENT_KEYS.join());
  ok('M client değerleri sözleşmeye uygun', b.client.p === 'Android' && b.client.tz === 180 && b.client.vw === 390 && /^s_[A-Za-z0-9_-]{6,24}$/.test(b.client.sid) && /^d_/.test(b.client.did) && b.client.net === '4g' && typeof b.client.sa === 'boolean');
  ok('M events sınırları (<= 40, k kuralı, lvl, m <= 300, d <= 8)', b.events.length === 3 && b.events.every((x) => x.k.length <= 32 && LIMITS.kRegex.test(x.k) && ['info', 'warn', 'error'].includes(x.lvl) && x.m.length <= 300 && typeof x.t === 'number' && (!x.d || Object.keys(x.d).length <= 8)));
  ok('M d değerleri yalnız sayı/boolean/kısa metin', b.events.every((x) => !x.d || Object.values(x.d).every((v) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 60))));
  const txt = JSON.stringify(b);
  ok('M gövdede URL / e-posta / koordinat yok', !/https?:|\/\/|@/.test(txt) && !/\d{1,3}\.\d{3,}/.test(JSON.stringify(b.events)) && !/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(txt));
  ok('M gövde <= 16000 bayt', Buffer.byteLength(txt) <= LIMITS.maxBodyBytes);
  // hostile info: fazlalık alan / geçersiz değer atılır
  const h = mk({ info: () => ({ ...goodInfo(), ua: 'Mozilla/5.0 (X11) AppleWebKit', lat: 41.01, lon: 28.97, address: 'Sok. 1', p: 'bilinmiyor', sid: 'kötü sid', did: 'x', lang: 'tr-TR-ÜÖ', net: 'wifi', vw: 'geniş' }) });
  h.log.log('m.x', 'bir'); await h.log.flush();
  const c = h.sent[0].client;
  ok('M bilinmeyen client alanları atılır (ua/lat/lon/address)', !('ua' in c) && !('lat' in c) && !('lon' in c) && !('address' in c));
  ok('M geçersiz değerler: p→other, sid→yeni rastgele, did/lang/net/vw atılır', c.p === 'other' && /^s_[A-Za-z0-9_-]{6,24}$/.test(c.sid) && !('did' in c) && !('lang' in c) && !('net' in c) && !('vw' in c));
  const t = mk({ info: () => { throw new Error('info'); } });
  t.log.log('m.y', 'iki'); await t.log.flush();
  ok('M info() hata verirse istek yine kurallı gider', t.sent.length === 1 && t.sent[0].client.p === 'other' && /^s_/.test(t.sent[0].client.sid));
}

// ---- N) kaynak denetimi ----
{
  const core = strip(read('js/diag/clientLog.js'));
  ok('N çekirdek saf: Date.now/setTimeout/setInterval/fetch/localStorage/navigator/window yok', !/Date\.now|setTimeout|setInterval|\bfetch\b|localStorage|\bnavigator\b|\bwindow\b|\bdocument\b|sendBeacon|XMLHttpRequest|WebSocket|EventSource/.test(core));
  ok('N çekirdek sanitizeMessage kullanır (kopya değil)', /import \{ sanitizeMessage \} from '\.\/fieldLog\.js'/.test(core) && !/replace\(\/https\?/.test(core));
  const init = strip(read('js/diag/clientLogInit.js'));
  const bare = (init.match(/(?<![\w.$])fetch\(/g) || []).length;
  ok('N bağlama dosyasında TAM 1 çıplak fetch(', bare === 1);
  ok('N başka ağ ilkeli yok (XHR/sendBeacon/WebSocket/EventSource/proxyFetch)', !/XMLHttpRequest|sendBeacon|WebSocket|EventSource|proxyFetch|mbfetch|importScripts/.test(init));
  ok('N konum/adres okunmaz (geolocation)', !/geolocation|userAgent\s*[,;)]/.test(strip(read('js/diag/clientLog.js') + init).replace(/deviceFamily\(nav\.userAgent\)/g, '')));
  ok('N globalThis.__evrfClientLogState yok', !/__evrfClientLogState/.test(read('js/diag/clientLogInit.js') + read('js/diag/clientLog.js')));
}

// ---- O) tarayıcı bağlama: sahte window ----
class FakeWin extends EventTarget {
  constructor({ ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', standalone = false, cap = false } = {}) {
    super();
    this.navigator = { userAgent: ua, language: 'tr-TR', onLine: true, connection: { effectiveType: '4g' }, standalone: undefined };
    this.matchMedia = (q) => ({ matches: standalone && /standalone/.test(q) });
    this.innerWidth = 390; this.innerHeight = 844;
    this.document = { visibilityState: 'visible' };
    this.Capacitor = cap ? { isNativePlatform: () => true } : undefined;
    this.intervals = [];
    this.setInterval = (fn, ms) => { this.intervals.push({ fn, ms }); return this.intervals.length; };
    this.clearInterval = () => {};
  }
  fire(type, props = {}) { const ev = new Event(type); Object.assign(ev, props); this.dispatchEvent(ev); return ev; }
}
function mkInit(o = {}) {
  const env = { t: T0, fetches: [], resp: { status: 200 }, setting: o.on !== false, gate: !!o.gate, store: new Map(), writes: 0 };
  env.win = new FakeWin(o.win);
  env.fetch = async (url, init) => { env.fetches.push({ url, init, body: JSON.parse(init.body) }); const r = env.resp; return { status: r.status, headers: { get: (h) => (h === 'Retry-After' && r.retryAfter ? String(r.retryAfter) : null) }, json: async () => ({ ok: true }) }; };
  env.deps = {
    now: () => env.t,
    fetch: o.noInjectedFetch ? undefined : env.fetch,
    storage: { get: (k) => (env.store.has(k) ? JSON.parse(env.store.get(k)) : null), set: (k, v) => { env.writes++; env.store.set(k, JSON.stringify(v)); } },
    setting: { get: () => env.setting, set: (v) => { env.setting = !!v; } },
    setInterval: (fn, ms) => env.win.setInterval(fn, ms),
    clearInterval: () => {},
  };
  env.init = () => I.initClientLog({ win: env.win, gate: () => env.gate, deps: env.deps });
  return env;
}

{
  I.disposeClientLog();
  ok('O init öncesi clientLog() boş nesne, logEvent sessizce yok sayılır', I.clientLog().log('a.b', 'x') === false && (() => { try { I.logEvent('a.b', 'x'); return true; } catch { return false; } })());
  const env = mkInit({ win: { standalone: true, cap: true, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' } });
  const c = env.init();
  ok('O initClientLog idempotent (aynı çekirdek)', env.init() === c && I.clientLog() === c);
  const start = c.pending();
  ok('O açılışta app.start olayı (d: sa/apk boolean)', start.length === 1 && start[0].k === 'app.start' && start[0].d.sa === true && start[0].d.apk === true);
  env.win.fire('error', { message: 'ReferenceError: x is not defined at https://app.example/a.js', lineno: 12, colno: 7, filename: 'https://app.example/a.js', error: new Error('yığın') });
  let ev = c.pending().find((x) => x.k === 'js.error');
  ok('O error olayı kuyruğa girer (ileti temiz, d: yalnız line/col sayı)', !!ev && ev.lvl === 'error' && ev.m === 'ReferenceError: x is not defined at' && ev.d.line === 12 && ev.d.col === 7 && Object.keys(ev.d).length === 2);
  env.win.fire('unhandledrejection', { reason: new Error('söz reddedildi 41.015137,28.979530') });
  ev = c.pending().find((x) => x.k === 'js.reject');
  ok('O unhandledrejection kuyruğa girer, koordinat temizlenir', !!ev && ev.lvl === 'error' && ev.m === 'söz reddedildi');
  env.win.fire('unhandledrejection', { reason: 'metin neden' });
  ok('O metin nedeni de alınır', c.pending().some((x) => x.k === 'js.reject' && x.m === 'metin neden'));
  env.win.fire('error', { message: 'Script error.' }); env.win.fire('error', {});
  ok('O eksik alanlı error olayı bozmaz', c.pending().length >= 5);
  ok('O visible iken visibilitychange gönderim yapmaz', (env.win.fire('visibilitychange'), env.fetches.length === 0));
  env.win.document.visibilityState = 'hidden';
  env.win.fire('visibilitychange');
  await new Promise((r) => setTimeout(r, 0));
  const f = env.fetches[0];
  ok('O hidden → send çağrılır: POST /v1/clientlog', env.fetches.length === 1 && f.url === 'https://evcopilot.duckdns.org/v1/clientlog' && f.init.method === 'POST');
  ok('O başlıklar: JSON + X-Device-Id (d_...)', f.init.headers['Content-Type'] === 'application/json' && /^d_[A-Za-z0-9_-]{16,40}$/.test(f.init.headers['X-Device-Id']));
  ok('O keepalive true, AbortSignal var', f.init.keepalive === true && !!f.init.signal);
  ok('O gövde şeması + client alanları (iPhone → iOS, sa/apk, lang tr, vw/vh)', f.body.schema === 'evrf-client-log/1' && Object.keys(f.body.client).sort().join() === CLIENT_KEYS.join() && f.body.client.p === 'iOS' && f.body.client.sa === true && f.body.client.apk === true && f.body.client.v === '0.99.123' && f.body.client.vw === 390 && f.body.client.vh === 844 && f.body.client.net === '4g' && f.body.client.did === f.init.headers['X-Device-Id']);
  ok('O gövdede tam kullanıcı-ajanı/dosya adı/URL yok', !/Mozilla|iPhone OS|a\.js|https?:/.test(JSON.stringify(f.body)));
  ok('O gönderim sonrası kuyruk boş', c.pending().length === 0 && c.state().sent >= 5);
  c.log('o.p', 'pagehide öncesi'); env.win.document.visibilityState = 'visible';
  env.win.fire('pagehide'); await new Promise((r) => setTimeout(r, 0));
  ok('O pagehide flush eder', env.fetches.length === 2 && env.fetches[1].body.events.some((x) => x.m === 'pagehide öncesi'));
  c.log('o.i', 'aralık'); const iv = env.win.intervals[0];
  ok('O 60 sn aralıklı flush kurulur', iv && iv.ms === 60_000);
  iv.fn(); await new Promise((r) => setTimeout(r, 0));
  ok('O aralık tetiklenince gönderir', env.fetches.length === 3);
  env.resp = { status: 503 }; c.log('o.o', 'çevrimdışıydı'); env.win.fire('pagehide'); await new Promise((r) => setTimeout(r, 0));
  const n = env.fetches.length; env.resp = { status: 200 };
  env.win.fire('online'); await new Promise((r) => setTimeout(r, 0));
  ok('O online olayı flush çağırır (geri çekilme sürerse beklemez)', env.fetches.length === n && c.pending().length === 1);
  env.t += 31 * SEC; env.win.fire('online'); await new Promise((r) => setTimeout(r, 0));
  ok('O geri çekilme bitince online ile gider', env.fetches.length === n + 1 && c.pending().length === 0);
  // ayar kapat
  c.log('o.k', 'kapatılacak');
  I.setClientLogEnabled(false);
  ok('O setClientLogEnabled(false): kuyruk silinir, tercih kapalı', c.pending().length === 0 && I.clientLogEnabled() === false && JSON.parse(env.store.get('clientLogQ')).q.length === 0);
  const w = env.writes, nf = env.fetches.length;
  env.win.fire('error', { message: 'x' }); I.logEvent('o.x', 'y'); env.win.document.visibilityState = 'hidden'; env.win.fire('visibilitychange'); env.win.fire('pagehide');
  await new Promise((r) => setTimeout(r, 0));
  ok('O kapalıyken hiçbir şey kuyruklanmaz/yazılmaz/gönderilmez', c.pending().length === 0 && env.writes === w && env.fetches.length === nf);
  I.setClientLogEnabled(true);
  ok('O yeniden açılınca çalışır; logEvent kısayolu çekirdeğe yazar', I.clientLogEnabled() === true && (I.logEvent('o.y', 'tekrar', { a: 1 }, 'warn'), c.pending().length === 1 && c.pending()[0].lvl === 'warn'));
  I.disposeClientLog();
  env.win.fire('error', { message: 'sökülmüş' });
  ok('O disposeClientLog dinleyicileri söker', c.pending().length === 1 && I.clientLog() !== c);
}

// ---- P) gizlilik kapısı + kapalı ayar ----
{
  const env = mkInit({ gate: true });
  const c = env.init();
  env.win.fire('error', { message: 'x', lineno: 1, colno: 1 }); env.win.fire('unhandledrejection', { reason: 'y' });
  env.win.document.visibilityState = 'hidden'; env.win.fire('visibilitychange'); env.win.fire('pagehide'); env.win.fire('online'); env.win.intervals[0].fn();
  await new Promise((r) => setTimeout(r, 0));
  ok('P publicFreeMode/freeOnlyMode kapısı açıkken hiçbir şey kuyruklanmaz/gönderilmez/yazılmaz', c.pending().length === 0 && env.fetches.length === 0 && env.writes === 0 && c.state().queued === 0);
  env.gate = false;
  ok('P kapı kalkınca çalışır', c.log('p.x', 'şimdi') === true);
  env.gate = true;
  ok('P kapı yeniden kapanınca kuyruk silinir', c.log('p.y', 'z') === false && c.pending().length === 0);
  I.disposeClientLog();

  const off = mkInit({ on: false });
  off.store.set('clientLogQ', JSON.stringify({ v: 1, q: [{ t: T0, lvl: 'info', k: 'eski.x', m: 'eski' }] }));
  const c2 = off.init();
  ok('P ayar kapalıyken init: eski depo silinir, app.start yok', c2.pending().length === 0 && JSON.parse(off.store.get('clientLogQ')).q.length === 0);
  off.win.fire('error', { message: 'x' }); off.win.document.visibilityState = 'hidden'; off.win.fire('visibilitychange');
  await new Promise((r) => setTimeout(r, 0));
  ok('P ayar kapalıyken gönderim yok', off.fetches.length === 0 && c2.pending().length === 0);
  I.disposeClientLog();

  // gerçek kapı: varsayılan gate (beta-full) kapalı olmalı → çalışır
  const real = mkInit(); real.win = new FakeWin();
  const c3 = I.initClientLog({ win: real.win, deps: real.deps });
  ok('P varsayılan kapı gerçek providerGate: kaynak kipinde (beta-full) açık değil → app.start kuyruklanır', c3.pending().some((x) => x.k === 'app.start'));
  const G = await import('../js/net/providerGate.js');
  G.setProviderMode('public-free');
  ok('P gerçek providerGate public-free → kuyruklama durur', c3.log('p.z', 'x') === false && c3.pending().length === 0);
  G.setProviderMode('free-only');
  ok('P gerçek providerGate free-only → durur', c3.log('p.z', 'x') === false);
  G.setProviderMode('beta-full');
  ok('P beta-full → çalışır', c3.log('p.z', 'x') === true);
  I.disposeClientLog();
}

// ---- Q) varsayılan gönderim yolu: genel fetch (sahte) + Retry-After ----
{
  const env = mkInit({ noInjectedFetch: true });
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { status: 429, headers: { get: (h) => (h === 'Retry-After' ? '120' : null) }, json: async () => ({ retryAfterSec: 200 }) }; };
  try {
    const c = env.init();
    env.win.document.visibilityState = 'hidden'; env.win.fire('visibilitychange');
    await new Promise((r) => setTimeout(r, 0));
    ok('Q varsayılan yol genel fetch kullanır (sahte), URL /v1/clientlog', calls.length === 1 && /\/v1\/clientlog$/.test(calls[0].url));
    ok('Q 429: başlık ile gövdedeki retryAfterSec büyüğü bekletir; olay kuyrukta kalır', c.state().backoffUntil === T0 + 200 * SEC && c.pending().length === 1);
  } finally { globalThis.fetch = realFetch; I.disposeClientLog(); }
}

// ---- R) ağ hatası bağlamada ----
{
  const env = mkInit();
  env.deps.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const c = env.init();
  env.win.document.visibilityState = 'hidden'; env.win.fire('visibilitychange');
  await new Promise((r) => setTimeout(r, 0));
  ok('R ağ hatası: olay kuyrukta, 30 sn geri çekilme, işlenmemiş ret yok', c.pending().length === 1 && c.state().failed === 1 && c.state().backoffUntil === T0 + 30 * SEC);
  I.disposeClientLog();
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
