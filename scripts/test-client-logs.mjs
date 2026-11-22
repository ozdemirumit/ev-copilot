// İstemci günlüğü modülü (server/clientLogs.mjs) — çevrimdışı: geçici dizin, sabit saat, sahte ağ (gerçek istek yok), yalnızca yer tutucu değerler.
// Kapsam: kabul, şema ihlalleri, gizlilik temizliği + scrub, IP maskesi, denetim satırları, hız sınırı, günlük tavan, saklama,
// ileri gönderme (başarı/başarısız/zaman aşımı/ağ hatası/flush/otomatik flush), token sızıntısı, fırlatmama.
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { createClientLogs, LIMITS, maskIp } from '../server/clientLogs.mjs';
import { makeScrub } from '../server/scrub.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('BAŞARISIZ:', name); } };

const base = mkdtempSync(join(tmpdir(), 'evrf-clientlogs-'));
let seq = 0;
const newDir = () => { const d = join(base, 't' + (seq++)); mkdirSync(d, { recursive: true }); return d; };

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0); // 2026-11-22 12:00:00 UTC
const DAY = '2026-11-22';
const DID = 'd_' + 'A'.repeat(20);
const DID2 = 'd_' + 'B'.repeat(20);
const FAKE_TOKEN = 'PLACEHOLDER-forward-token-not-real';
const FAKE_SECRET = 'PLACEHOLDER-secret-env-value-not-real';

const readLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const clog = (d) => join(d, 'client-logs');
const allFiles = (d) => { const r = clog(d); return existsSync(r) ? readdirSync(r).map((f) => join(r, f)) : []; };
const allText = (d) => allFiles(d).map((f) => readFileSync(f, 'utf8')).join('\n');
const ev = (o = {}) => ({ t: T0, lvl: 'info', k: 'app.start', m: 'başladı', d: { n: 1, ok: true, r: 'not-allowed' }, ...o });
const body = (events = [ev()], client = {}) => ({ schema: 'evrf-client-log/1', client: { v: '0.99.123', p: 'Android', sa: true, apk: false, lang: 'tr', tz: 180, online: true, vw: 390, vh: 844, net: '4g', sid: 's_AbC123xyz', did: DID, ...client }, events });

function fakeNet() {
  const f = { calls: [], mode: 'ok', status: 200, bigBody: false };
  f.request = (url, options, cb) => {
    const req = new EventEmitter();
    const call = { url: String(url), options, body: '' };
    f.calls.push(call);
    req.destroy = () => { req.destroyed = true; };
    req.end = (payload) => {
      call.body = String(payload);
      if (f.mode === 'hang') return;
      if (f.mode === 'error') { setImmediate(() => req.emit('error', new Error('ECONNREFUSED'))); return; }
      if (f.mode === 'throw') throw new Error('boom');
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = f.status;
        res.destroy = () => { res.destroyed = true; };
        cb(res);
        setImmediate(() => { res.emit('data', Buffer.from(f.bigBody ? 'x'.repeat(9000) : '{"ok":true}')); res.emit('end'); });
      });
    };
    return req;
  };
  return f;
}

// ---- 0) maskIp birim ----
ok('maskIp IPv4', maskIp('203.0.113.77') === '203.0.113.0');
ok('maskIp IPv4-eşlemeli IPv6', maskIp('::ffff:198.51.100.9') === '198.51.100.0');
ok('maskIp IPv6 tam', maskIp('2001:0db8:85a3:08d3:1319:8a2e:0370:7348') === '2001:db8:85a3:8d3::');
ok('maskIp IPv6 kısaltmalı', maskIp('2001:db8::1') === '2001:db8:0:0::');
ok('maskIp bozuk/boş', maskIp('') === 'unknown' && maskIp(undefined) === 'unknown' && maskIp('abc') === 'unknown');
ok('LIMITS sabitleri', LIMITS.maxEvents === 40 && LIMITS.bodyBytes === 16000 && LIMITS.msgChars === 300 && LIMITS.dKeys === 8 && LIMITS.dTextChars === 60 && Object.isFrozen(LIMITS));

// ---- 1) geçerli kabul ----
{
  const d = newDir();
  const L = createClientLogs({ dir: d, now: () => T0 });
  const r = await L.ingest({ body: body([ev(), ev({ lvl: 'warn', k: 'gps.fail', m: 'izin yok', d: { code: 1 } })]), ip: '203.0.113.77', deviceHeader: DID, bytes: 500 });
  ok('geçerli: 200 + sayılar', r.status === 200 && r.body.ok === true && r.body.accepted === 2 && r.body.dropped === 0);
  const rows = readLines(join(clog(d), `${DAY}.jsonl`));
  ok('geçerli: tek satır, rcv + maskeli ip + client + 2 olay', rows.length === 1 && rows[0].rcv === new Date(T0).toISOString() && rows[0].ip === '203.0.113.0' && rows[0].events.length === 2);
  ok('geçerli: client alanları temiz yazıldı', rows[0].client.did === DID && rows[0].client.p === 'Android' && rows[0].client.v === '0.99.123' && rows[0].client.sid === 's_AbC123xyz' && rows[0].client.tz === 180 && rows[0].client.net === '4g' && rows[0].client.vw === 390);
  ok('geçerli: olay şekli', rows[0].events[0].k === 'app.start' && rows[0].events[0].d.ok === true && rows[0].events[0].d.r === 'not-allowed' && rows[0].events[0].t === T0);
  const st = L.stats();
  ok('stats: kabul sayısı + bugün baytı + ileri gönderme kapalı', st.accepted === 2 && st.rejected === 0 && st.forwardEnabled === false && st.today.bytes > 0);
}

// ---- 2) şema ihlalleri ----
{
  const d = newDir();
  const L = createClientLogs({ dir: d, now: () => T0, perDevicePerMin: 1000, perIpPerMin: 1000 });
  const evs = Array.from({ length: 45 }, (_, i) => ev({ m: 'o' + i }));
  let r = await L.ingest({ body: body(evs), ip: '1.2.3.4', deviceHeader: DID, bytes: 9000 });
  ok('45 olay: ilk 40 kabul, 5 atıldı', r.status === 200 && r.body.accepted === 40 && r.body.dropped === 5);

  r = await L.ingest({ body: body([ev({ k: 'Bad Key' }), ev({ k: '1abc' }), ev({ lvl: 'debug' }), ev({ lvl: undefined }), 'x', null, ev({ m: 5 }), ev({ d: [1] }), ev({ k: 'ok.key' })]), ip: '1.2.3.4', bytes: 800 });
  ok('geçersiz olaylar tek tek atılır (regex/lvl/tip)', r.status === 200 && r.body.accepted === 1 && r.body.dropped === 8);

  r = await L.ingest({ body: body([ev({ k: 'a'.repeat(33) })]), ip: '1.2.3.4', bytes: 300 });
  ok('k 33 karakter: tümü geçersiz -> 400', r.status === 400 && typeof r.body.error === 'string');

  r = await L.ingest({ body: body([ev({ m: 'u'.repeat(500) })]), ip: '1.2.3.4', bytes: 800 });
  ok('uzun ileti 300 karaktere kırpılır', r.status === 200);
  let rows = readLines(join(clog(d), `${DAY}.jsonl`));
  ok('uzun ileti dosyada tam 300', rows[rows.length - 1].events[0].m.length === 300);

  r = await L.ingest({ body: body([ev({ d: { a: 1, b: { x: 1 }, c: [1, 2], e: null, f: 'ok', g: Infinity, h: true, i1: 1, i2: 2, i3: 3, i4: 4, i5: 5, i6: 6, 'bad key': 1, __proto__x: 1 } })]), ip: '1.2.3.4', bytes: 400 });
  rows = readLines(join(clog(d), `${DAY}.jsonl`));
  const dd = rows[rows.length - 1].events[0].d;
  ok('d: iç içe nesne/dizi/null/sonsuz/kötü anahtar atılır, en çok 8 anahtar', r.status === 200 && Object.keys(dd).length === 8 && dd.a === 1 && dd.b === undefined && dd.c === undefined && dd.e === undefined && dd.g === undefined && dd.f === 'ok' && dd.h === true && !('bad key' in dd));

  r = await L.ingest({ body: body([ev({ d: { r: 'z'.repeat(100) } })]), ip: '1.2.3.4', bytes: 300 });
  rows = readLines(join(clog(d), `${DAY}.jsonl`));
  ok('d metin değeri 60 karaktere kırpılır', rows[rows.length - 1].events[0].d.r.length === 60);

  ok('gövde undefined -> 400', (await L.ingest({ body: undefined, ip: '1.2.3.4', deviceHeader: DID, bytes: 0 })).status === 400);
  ok('gövde dizi -> 400', (await L.ingest({ body: [], ip: '1.2.3.4', deviceHeader: DID, bytes: 2 })).status === 400);
  ok('gövde metin -> 400', (await L.ingest({ body: 'x', ip: '1.2.3.4', deviceHeader: DID, bytes: 3 })).status === 400);
  ok('yanlış şema -> 400', (await L.ingest({ body: { ...body(), schema: 'x/1' }, ip: '1.2.3.4', bytes: 300 })).status === 400);
  ok('events dizi değil -> 400', (await L.ingest({ body: { ...body(), events: 'x' }, ip: '1.2.3.4', bytes: 300 })).status === 400);
  ok('events boş -> 400', (await L.ingest({ body: body([]), ip: '1.2.3.4', bytes: 300 })).status === 400);
  ok('16000 baytı aşan gövde -> 400', (await L.ingest({ body: body(), ip: '1.2.3.4', deviceHeader: DID, bytes: 16001 })).status === 400);
  ok('16000 bayt sınırda kabul', (await L.ingest({ body: body(), ip: '1.2.3.4', deviceHeader: DID, bytes: 16000 })).status === 200);

  // kimlik kuralları
  ok('did yok (ne gövde ne başlık) -> 400', (await L.ingest({ body: body([ev()], { did: undefined }), ip: '1.2.3.4', bytes: 300 })).status === 400);
  ok('did bozuk + başlık yok -> 400', (await L.ingest({ body: body([ev()], { did: 'xyz' }), ip: '1.2.3.4', bytes: 300 })).status === 400);
  ok('did kısa (15) -> 400', (await L.ingest({ body: body([ev()], { did: 'd_' + 'a'.repeat(15) }), ip: '1.2.3.4', bytes: 300 })).status === 400);
  ok('did yok, başlık geçerli -> 200', (await L.ingest({ body: body([ev()], { did: undefined }), ip: '1.2.3.4', deviceHeader: DID2, bytes: 300 })).status === 200);
  rows = readLines(join(clog(d), `${DAY}.jsonl`));
  ok('başlık did client.did olarak yazıldı', rows[rows.length - 1].client.did === DID2);
  ok('did bozuk, başlık geçerli -> 200', (await L.ingest({ body: body([ev()], { did: 'bozuk' }), ip: '1.2.3.4', deviceHeader: DID, bytes: 300 })).status === 200);
  ok('başlık bozuk, gövde did geçerli -> 200', (await L.ingest({ body: body(), ip: '1.2.3.4', deviceHeader: 'zzz', bytes: 300 })).status === 200);

  // client alanları
  await L.ingest({ body: body([ev()], { p: 'Symbian', sid: 'kötü', lang: 'uzun-dil-kodu-x', v: 'v'.repeat(40), tz: 99999, vw: -3, net: 'a b', evil: 'x', extra: { a: 1 } }), ip: '1.2.3.4', bytes: 400 });
  rows = readLines(join(clog(d), `${DAY}.jsonl`));
  const c = rows[rows.length - 1].client;
  ok('client: p kümede değilse other; bozuk sid/lang/v/tz/vw/net atılır; şema dışı alan yok', c.p === 'other' && c.sid === undefined && c.lang === undefined && c.v === undefined && c.tz === undefined && c.vw === undefined && c.net === undefined && c.evil === undefined && c.extra === undefined);
}

// ---- 3) gizlilik temizliği + scrub ----
{
  const d = newDir();
  const scrub = makeScrub({ TOMTOM_KEY: FAKE_SECRET });
  const L = createClientLogs({ dir: d, scrub, now: () => T0 });
  const m = `hata https://example.test/rota?lat=41.0082&lon=28.9784 mail kisi@example.test konum 41.0082, 28.9784 ip 192.168.10.20 anahtar ${FAKE_SECRET} sürüm 0.99.123 ok`;
  const r = await L.ingest({ body: body([ev({ m, d: { u: 'bak http://example.test/x', s: FAKE_SECRET, g: '-33.8688 151.2093' } })], { v: '0.99.123' }), ip: '1.2.3.4', bytes: 600 });
  ok('gizlilik: kabul edildi', r.status === 200);
  const txt = readFileSync(join(clog(d), `${DAY}.jsonl`), 'utf8');
  const e = JSON.parse(txt.trim()).events[0];
  ok('URL temizlendi', !txt.includes('example.test/') && !/https?:/.test(txt) && e.m.includes('[url]'));
  ok('e-posta temizlendi', !txt.includes('kisi@') && e.m.includes('[eposta]'));
  ok('enlem/boylam benzeri sayılar temizlendi', !txt.includes('41.0082') && !txt.includes('28.9784') && !txt.includes('33.8688') && !txt.includes('151.2093'));
  ok('IP temizlendi', !txt.includes('192.168.10.20'));
  ok('scrub uygulandı (ileti + d)', !txt.includes(FAKE_SECRET) && e.m.includes('***') && e.d.s === '***');
  ok('sürüm numarası bozulmadı', e.m.includes('0.99.123'));
  ok('denetim günlüğünde de ham değer yok', !allText(d).includes(FAKE_SECRET) && !allText(d).includes('41.0082'));
}

// ---- 4) IP maskesi: tam IP diske yazılmaz + denetim satırları ----
{
  const d = newDir();
  const L = createClientLogs({ dir: d, now: () => T0, perIpPerMin: 1000, perDevicePerMin: 1000 });
  await L.ingest({ body: body(), ip: '203.0.113.77', deviceHeader: DID, bytes: 300 });
  await L.ingest({ body: body(), ip: '2001:0db8:85a3:08d3:1319:8a2e:0370:7348', deviceHeader: DID, bytes: 300 });
  await L.ingest({ body: body(), ip: '::ffff:198.51.100.9', deviceHeader: DID, bytes: 300 });
  await L.ingest({ body: undefined, ip: '192.0.2.200', deviceHeader: DID, bytes: 10 });
  const txt = allText(d);
  ok('diskte tam IPv4 yok', !txt.includes('203.0.113.77') && !txt.includes('198.51.100.9') && !txt.includes('192.0.2.200'));
  ok('diskte tam IPv6 yok', !txt.includes('0db8:85a3') && !txt.includes('db8:85a3:8d3:1319') && !txt.includes('7348'));
  ok('maskeli IP’ler yazıldı', txt.includes('203.0.113.0') && txt.includes('2001:db8:85a3:8d3::') && txt.includes('198.51.100.0') && txt.includes('192.0.2.0'));
  const au = readLines(join(clog(d), `uploads-${DAY}.jsonl`));
  ok('denetim: kabul + ret satırları (4 istek)', au.length === 4 && au.filter((x) => x.result === 'ok').length === 3 && au.filter((x) => x.result === 'invalid').length === 1);
  const a0 = au[0];
  ok('denetim satır alanları', a0.did === DID && a0.sid === 's_AbC123xyz' && a0.v === '0.99.123' && a0.p === 'Android' && a0.bytes === 300 && a0.events === 1 && a0.accepted === 1 && a0.dropped === 0 && a0.status === 200 && a0.ip === '203.0.113.0' && typeof a0.ts === 'string');
  ok('denetim: reddedilen satırda status 400 + did başlıktan', au[3].status === 400 && au[3].accepted === 0 && au[3].did === DID);
}

// ---- 5) hız sınırı ----
{
  const d = newDir();
  let T = T0;
  const L = createClientLogs({ dir: d, now: () => T, perDevicePerMin: 12, perIpPerMin: 40 });
  const rs = [];
  for (let i = 0; i < 13; i++) rs.push(await L.ingest({ body: body(), ip: '9.9.9.9', deviceHeader: DID, bytes: 300 }));
  ok('cihaz: ilk 12 kabul', rs.slice(0, 12).every((r) => r.status === 200));
  ok('cihaz: 13. istek 429 + retryAfterSec', rs[12].status === 429 && Number.isFinite(rs[12].body.retryAfterSec) && rs[12].body.retryAfterSec >= 1 && rs[12].body.retryAfterSec <= 60 && typeof rs[12].body.error === 'string');
  ok('başka cihaz aynı IP’den hâlâ kabul', (await L.ingest({ body: body([ev()], { did: DID2 }), ip: '9.9.9.9', bytes: 300 })).status === 200);
  T += 60000;
  ok('yeni dakikada cihaz yeniden kabul', (await L.ingest({ body: body(), ip: '9.9.9.9', deviceHeader: DID, bytes: 300 })).status === 200);
  const au = readLines(join(clog(d), `uploads-${DAY}.jsonl`));
  ok('denetim: rate sonucu 429', au.some((x) => x.result === 'rate' && x.status === 429));
  ok('stats.rejected arttı', L.stats().rejected >= 1);

  // IP sınırı: her istek başka cihaz
  const d2 = newDir();
  const L2 = createClientLogs({ dir: d2, now: () => T0, perDevicePerMin: 100, perIpPerMin: 3 });
  const out = [];
  for (let i = 0; i < 5; i++) out.push(await L2.ingest({ body: body([ev()], { did: 'd_' + String(i).repeat(20) }), ip: '8.8.8.8', bytes: 300 }));
  ok('IP: ilk 3 kabul, 4.-5. 429', out.slice(0, 3).every((r) => r.status === 200) && out[3].status === 429 && out[4].status === 429);
  ok('başka IP etkilenmez', (await L2.ingest({ body: body(), ip: '8.8.4.4', deviceHeader: DID, bytes: 300 })).status === 200);
  ok('geçersiz istekler de IP sayacına girer', (await (async () => { const L3 = createClientLogs({ dir: newDir(), now: () => T0, perIpPerMin: 2 }); await L3.ingest({ body: undefined, ip: '7.7.7.7' }); await L3.ingest({ body: undefined, ip: '7.7.7.7' }); return L3.ingest({ body: body(), ip: '7.7.7.7', bytes: 300 }); })()).status === 429);
}

// ---- 6) günlük tavan ----
{
  const d = newDir();
  let T = T0;
  const L = createClientLogs({ dir: d, now: () => T, dayCapBytes: 700, perDevicePerMin: 1000, perIpPerMin: 1000 });
  const rs = [];
  for (let i = 0; i < 4; i++) rs.push(await L.ingest({ body: body(), ip: '5.5.5.5', deviceHeader: DID, bytes: 300 }));
  const accepted = rs.filter((r) => r.status === 200).length;
  ok('tavan: en az biri kabul, sonrası 429', accepted >= 1 && accepted < 4 && rs[3].status === 429 && rs[3].body.retryAfterSec > 0);
  ok('tavan: dosya boyutu tavanı aşmaz', statSync(join(clog(d), `${DAY}.jsonl`)).size <= 700);
  const au = readLines(join(clog(d), `uploads-${DAY}.jsonl`));
  ok('tavan: denetim satırı result=cap (denetim yine yazılır)', au.some((x) => x.result === 'cap' && x.status === 429));
  T += 86400000;
  ok('ertesi gün yeniden kabul', (await L.ingest({ body: body(), ip: '5.5.5.5', deviceHeader: DID, bytes: 300 })).status === 200);
  ok('ertesi gün yeni dosya', existsSync(join(clog(d), '2026-11-23.jsonl')));

  // denetim dosyası 5 MB tavanı
  const d2 = newDir();
  mkdirSync(clog(d2), { recursive: true });
  writeFileSync(join(clog(d2), `uploads-${DAY}.jsonl`), 'x'.repeat(LIMITS.auditDayBytes - 10));
  const L2 = createClientLogs({ dir: d2, now: () => T0 });
  const r = await L2.ingest({ body: body(), ip: '5.5.5.5', deviceHeader: DID, bytes: 300 });
  ok('denetim tavanı: istek yine kabul edilir ama denetim 5 MB’ı aşmaz', r.status === 200 && statSync(join(clog(d2), `uploads-${DAY}.jsonl`)).size <= LIMITS.auditDayBytes);
}

// ---- 7) saklama ----
{
  const d = newDir();
  mkdirSync(clog(d), { recursive: true });
  const put = (n, c = '{}\n') => writeFileSync(join(clog(d), n), c);
  put('2026-10-01.jsonl'); put('uploads-2026-10-01.jsonl'); put('2026-10-22.jsonl'); put('2026-10-23.jsonl'); put('2026-11-10.jsonl');
  put('forward-failed.jsonl'); put('notlar.txt'); put('2026-10-01.jsonl.bak');
  const L = createClientLogs({ dir: d, now: () => T0, keepDays: 30 });
  await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
  const names = readdirSync(clog(d));
  ok('saklama: 30 günden eski gün ve denetim dosyaları silindi', !names.includes('2026-10-01.jsonl') && !names.includes('uploads-2026-10-01.jsonl') && !names.includes('2026-10-22.jsonl'));
  ok('saklama: sınır gün ve yenisi duruyor', names.includes('2026-10-23.jsonl') && names.includes('2026-11-10.jsonl') && names.includes(`${DAY}.jsonl`));
  ok('saklama: desen dışı dosyalara (forward-failed, .txt, .bak) dokunulmadı', names.includes('forward-failed.jsonl') && names.includes('notlar.txt') && names.includes('2026-10-01.jsonl.bak'));
}

// ---- 8) ileri gönderme ----
{
  const d = newDir();
  const net = fakeNet();
  const L = createClientLogs({ dir: d, now: () => T0, forwardUrl: 'http://127.0.0.1:4450/ingest', forwardToken: FAKE_TOKEN, request: net.request });
  ok('ileri gönderme etkin', L.stats().forwardEnabled === true);
  const r = await L.ingest({ body: body(), ip: '203.0.113.77', deviceHeader: DID, bytes: 300 });
  ok('ingest ileri gönderme bitmeden yanıt verir (istemci bekletilmez)', r.status === 200 && net.calls.length <= 1);
  await L.idle();
  ok('ileri gönderme: tek POST, URL + başlıklar', net.calls.length === 1 && net.calls[0].url === 'http://127.0.0.1:4450/ingest' && net.calls[0].options.method === 'POST' && net.calls[0].options.headers['Content-Type'] === 'application/json' && net.calls[0].options.headers.Authorization === `Bearer ${FAKE_TOKEN}`);
  const sent = JSON.parse(net.calls[0].body);
  ok('ileri gönderme gövdesi: src + kayıt (maskeli ip, tam IP yok)', sent.src === 'evrf-proxy' && sent.client.did === DID && sent.events.length === 1 && sent.ip === '203.0.113.0' && !net.calls[0].body.includes('203.0.113.77'));
  const au = readLines(join(clog(d), `uploads-${DAY}.jsonl`));
  const fw = au.find((x) => x.type === 'forward');
  ok('denetim: forward satırı ok/status/ms/ref', fw && fw.ok === true && fw.status === 200 && Number.isFinite(fw.ms) && typeof fw.ref === 'string' && fw.ref.length > 5);
  ok('başarıda forward-failed.jsonl yok, forwardOk=1', !existsSync(join(clog(d), 'forward-failed.jsonl')) && L.stats().forwardOk === 1);

  // token hiçbir yerde yok
  const resp = JSON.stringify([r, L.stats()]);
  ok('token dosyalarda/yanıtta/stats’ta yok', !allText(d).includes(FAKE_TOKEN) && !resp.includes(FAKE_TOKEN));
  ok('ileri gönderme URL’si stats’ta yok', !resp.includes('4450'));
}
{
  // başarısız ileri gönderme kaybolmaz + flush
  const d = newDir();
  const net = fakeNet();
  net.status = 503;
  const L = createClientLogs({ dir: d, now: () => T0, forwardUrl: 'http://127.0.0.1:4450/ingest', forwardToken: FAKE_TOKEN, request: net.request });
  const r503 = await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
  await L.idle();
  const ff = join(clog(d), 'forward-failed.jsonl');
  const failed = readLines(ff);
  ok('başarısız (503): forward-failed.jsonl’e yazıldı', failed.length === 1 && failed[0].rec.client.did === DID && typeof failed[0].ref === 'string' && failed[0].rec.events.length === 1);
  ok('başarısız: forwardFail=1, denetimde ok=false status=503', L.stats().forwardFail === 1 && readLines(join(clog(d), `uploads-${DAY}.jsonl`)).some((x) => x.type === 'forward' && x.ok === false && x.status === 503));
  ok('başarısız ileri gönderme istemci yanıtını bozmaz', r503.status === 200 && r503.body.accepted === 1);
  let rf = await L.flushForwards();
  ok('flush: alıcı hâlâ kapalıyken kayıt dosyada kalır', rf.tried === 1 && rf.ok === 0 && rf.failed === 1 && readLines(ff).length === 1 && !existsSync(join(clog(d), 'forward-failed.work.jsonl')));
  net.status = 200;
  rf = await L.flushForwards();
  ok('flush: başarılı kayıtlar silinir', rf.tried === 1 && rf.ok === 1 && rf.failed === 0 && !existsSync(ff) && !existsSync(join(clog(d), 'forward-failed.work.jsonl')));
  ok('flush: yeniden gönderim denetimde retry olarak', readLines(join(clog(d), `uploads-${DAY}.jsonl`)).some((x) => x.type === 'forward' && x.retry === true && x.ok === true));
  ok('flush: token sızmadı', !allText(d).includes(FAKE_TOKEN));
  rf = await L.flushForwards();
  ok('flush: boş dosyada sıfır', rf.tried === 0 && rf.ok === 0 && rf.failed === 0);
}
{
  // ilk hatada flush durur (kalanları denemez); otomatik flush: sonraki başarılı gönderim birikmişi boşaltır
  const d = newDir();
  const net = fakeNet();
  net.status = 500;
  let T = T0;
  const L = createClientLogs({ dir: d, now: () => T, forwardUrl: 'http://127.0.0.1:4450/ingest', request: net.request, perDevicePerMin: 1000, perIpPerMin: 1000 });
  for (let i = 0; i < 3; i++) { await L.ingest({ body: body([ev({ m: 'k' + i })]), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 }); await L.idle(); }
  const ff = join(clog(d), 'forward-failed.jsonl');
  ok('3 başarısız kayıt biriktirildi', readLines(ff).length === 3);
  const before = net.calls.length;
  await L.flushForwards();
  ok('flush ilk hatada durur: yalnız 1 deneme, 3 kayıt dosyada', net.calls.length === before + 1 && readLines(ff).length === 3);
  net.status = 200;
  const before2 = net.calls.length;
  await L.ingest({ body: body([ev({ m: 'yeni' })]), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
  await L.idle();
  ok('otomatik flush: başarılı gönderim sonrası birikmiş 3 kayıt gönderildi', net.calls.length === before2 + 4 && !existsSync(ff));
}
{
  // zaman aşımı, ağ hatası, fırlatan istek, büyük yanıt
  for (const mode of ['hang', 'error', 'throw']) {
    const d = newDir();
    const net = fakeNet();
    net.mode = mode;
    const L = createClientLogs({ dir: d, now: () => T0, forwardUrl: 'http://127.0.0.1:4450/ingest', request: net.request, forwardTimeoutMs: 40 });
    const r = await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
    await L.idle();
    ok(`ileri gönderme ${mode}: istemci 200, kayıt forward-failed’e, status 0`, r.status === 200 && readLines(join(clog(d), 'forward-failed.jsonl')).length === 1 && readLines(join(clog(d), `uploads-${DAY}.jsonl`)).some((x) => x.type === 'forward' && x.ok === false && x.status === 0));
  }
  const d = newDir();
  const net = fakeNet();
  net.bigBody = true;
  const L = createClientLogs({ dir: d, now: () => T0, forwardUrl: 'https://127.0.0.1:4450/ingest', request: net.request });
  await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
  await L.idle();
  ok('https URL + büyük yanıt (4 KB üstü) yine başarı sayılır', net.calls[0].url.startsWith('https://') && L.stats().forwardOk === 1);
}
{
  // geçersiz ileri gönderme adresi -> kapalı + uyarı
  for (const u of ['ftp://example.test/x', 'not a url', 'file:///etc/x']) {
    const net = fakeNet();
    const L = createClientLogs({ dir: newDir(), now: () => T0, forwardUrl: u, request: net.request });
    await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
    await L.idle();
    const s = L.stats();
    ok(`geçersiz forwardUrl (${u}): kapalı, çağrı yok, uyarı var`, s.forwardEnabled === false && net.calls.length === 0 && s.warnings.length === 1 && !JSON.stringify(s).includes('example.test'));
  }
  const L = createClientLogs({ dir: newDir(), now: () => T0, forwardUrl: '' });
  ok('forwardUrl boş: uyarı yok', L.stats().warnings.length === 0 && (await L.flushForwards()).tried === 0);
}
{
  // forward-failed.jsonl 2 MB tavanı: yazmayı durdur + denetime yaz
  const d = newDir();
  mkdirSync(clog(d), { recursive: true });
  const ff = join(clog(d), 'forward-failed.jsonl');
  writeFileSync(ff, 'x'.repeat(LIMITS.forwardFailedBytes - 20));
  const net = fakeNet();
  net.status = 500;
  const L = createClientLogs({ dir: d, now: () => T0, forwardUrl: 'http://127.0.0.1:4450/ingest', request: net.request });
  await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 });
  await L.idle();
  ok('2 MB tavan: dosya büyümedi, denetime forward-failed-full yazıldı', statSync(ff).size === LIMITS.forwardFailedBytes - 20 && readLines(join(clog(d), `uploads-${DAY}.jsonl`)).some((x) => x.type === 'forward-failed-full'));
}

// ---- 9) ingest asla fırlatmaz ----
{
  // yazılamayan dizin -> 500
  const blocker = join(base, 'blocker');
  writeFileSync(blocker, 'dosya');
  const L = createClientLogs({ dir: join(blocker, 'alt'), now: () => T0 });
  let threw = false, r;
  try { r = await L.ingest({ body: body(), ip: '1.1.1.1', deviceHeader: DID, bytes: 300 }); } catch { threw = true; }
  ok('yazılamayan dizin: fırlatmaz, 500 {error:yazılamadı}', !threw && r.status === 500 && r.body.error === 'yazılamadı');
  ok('stats yazma hatasından sonra da çalışır', typeof L.stats().accepted === 'number');

  const L2 = createClientLogs({ dir: newDir(), now: () => T0, scrub: () => { throw new Error('x'); } });
  const weird = [undefined, {}, { body: null }, { body: { get schema() { throw new Error('boom'); } }, ip: 5 }, { body: body(), ip: { toString() { throw new Error('x'); } } }, { body: body(), bytes: NaN }];
  let t2 = false;
  for (const w of weird) { try { const x = await L2.ingest(w); if (!x || typeof x.status !== 'number') t2 = true; } catch { t2 = true; } }
  ok('tuhaf girdiler ve fırlatan scrub: ingest fırlatmaz, hep {status, body}', !t2);
}

rmSync(base, { recursive: true, force: true });
console.log(`test-client-logs: ${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
