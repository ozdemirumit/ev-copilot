// Saha testi özetinin otomatik yüklenmesi (v0.99.125): (A) js/diag/fieldUpload.js saf çekirdek, (B) server/clientLogs.mjs ingestField,
// (C) GERÇEK ara sunucu süreci (port 18842) + yerel alıcıya ileri gönderme uçtan uca, (D) kaynak/bağlantı denetimi.
// Çevrimdışı: yalnız 127.0.0.1; sahte token; 8787 ve 445 KULLANILMAZ. Kullanım: node scripts/test-field-upload.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirs = [], children = [], servers = [];
const files = (d, re) => (existsSync(d) ? readdirSync(d).filter((n) => re.test(n)).map((n) => join(d, n)) : []);
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const { FIELD_UPLOAD, createFieldUpload, isEmptyReport, PENDING_KEY } = await import('../js/diag/fieldUpload.js');
const F = await import('../js/diag/fieldLog.js');

// örnek özet: gerçek fieldLog çekirdeğinden (konum yok)
function sampleReport() {
  const log = F.createFieldLog(); log.start(1_000_000);
  log.ocr({ readCount: 10, readAt: 100, status: 'ok', rejected: null }, 1_000_000);
  log.ocr({ readCount: 11, readAt: 200, status: 'ok', rejected: null }, 1_010_000);
  log.ocr({ readCount: 12, readAt: 200, status: 'rejected', rejected: { at: 300, reason: 'range', value: 77 } }, 1_020_000);
  log.gps('ok', 1_000_000); log.gps('stale', 1_030_000); log.nav(true, 1_000_000); log.nav(false, 1_050_000);
  log.spoken('road:41.015137,28.979530', 1_040_000); log.spoken('speed', 1_041_000);
  log.error('Hata https://x.example/a?b=1 kisi@ornek.com 41.015137,28.979530', 1_045_000);
  return F.reportJson(log.snapshot(1_100_000), { version: '0.99.125', platform: 'iOS', standalone: true, at: '2026-11-22T12:00:00.000Z' });
}
const REP = sampleReport();

// ===================== A) saf çekirdek =====================
{
  ok('A şema fieldLog ile aynı', FIELD_UPLOAD.schema === F.REPORT_SCHEMA && REP.schema === FIELD_UPLOAD.schema);
  ok('A boş özet gönderilmez (isEmptyReport)', isEmptyReport(F.reportJson(F.createFieldLog().snapshot(0), {})) && !isEmptyReport(REP));
  const mk = (over = {}) => {
    const st = { t: 5_000_000, enabledV: true, sends: [], resp: [{ status: 200 }], kv: new Map() };
    const up = createFieldUpload({
      now: () => st.t, enabled: () => st.enabledV, info: () => ({ v: '0.99.125', p: 'iOS', did: 'd_AAAAAAAAAAAAAAAAAAAA' }),
      storage: { get: (k) => st.kv.get(k), set: (k, v) => st.kv.set(k, v) },
      send: async (b) => { st.sends.push(b); const r = st.resp.length > 1 ? st.resp.shift() : st.resp[0]; if (r instanceof Error) throw r; return r; },
      ...over,
    });
    return { st, up };
  };
  { const { st, up } = mk(); const r = await up.submit(REP, { force: true });
    ok('A başarılı gönderim: gövde şema + meta + özet + client, tek istek', r.sent === true && st.sends.length === 1 && st.sends[0].schema === FIELD_UPLOAD.schema && st.sends[0].summary?.v === 1 && st.sends[0].client?.did === 'd_AAAAAAAAAAAAAAAAAAAA' && st.sends[0].meta?.version === '0.99.125');
    ok('A gönderimden sonra bekleyen yok', up.pending() === null && st.kv.get(PENDING_KEY) === null);
    const body = JSON.stringify(st.sends[0]);
    ok('A gövdede konum/URL/e-posta yok (raporun kendisi temiz)', !/41\.015137|28\.979530|x\.example|kisi@ornek/.test(body), body.slice(0, 200));
    ok('A gövde sınırın altında', Buffer.byteLength(body) <= FIELD_UPLOAD.maxBodyBytes);
  }
  { const { st, up } = mk(); await up.submit(REP, { force: true }); st.t += 30_000; const r = await up.submit(REP, { force: false });
    ok('A zorlanmayan ikinci gönderim 2 dk içinde atlanır, bekleyen tutulur', r.skipped === 'interval' && st.sends.length === 1 && up.pending() !== null);
    st.t += 120_000; const r2 = await up.flush();
    ok('A aralık dolunca bekleyen gider', r2.sent === true && st.sends.length === 2);
    st.t += 1; const r3 = await up.submit(REP, { force: true });
    ok('A force (kayıt durdu/sürüş bitti) aralığı atlar', r3.sent === true && st.sends.length === 3);
  }
  { const { st, up } = mk(); st.resp = [new Error('ağ')]; const r = await up.submit(REP, { force: true });
    ok('A ağ hatasında bekleyen tutulur, geri çekilme 30 sn', r.skipped === 'network' && up.pending() !== null && up.state().backoffUntil === st.t + 30_000);
    const early = await up.flush({ force: true });
    ok('A geri çekilme süresince gönderilmez (force bile)', early.skipped === 'backoff' && st.sends.length === 1);
    st.t += 30_001; st.resp = [new Error('ağ')]; await up.flush({ force: true });
    ok('A ikinci hata: 60 sn', up.state().backoffUntil === st.t + 60_000);
    for (let i = 0; i < 8; i++) { st.t = up.state().backoffUntil + 1; st.resp = [new Error('ağ')]; await up.flush({ force: true }); }
    ok('A üst sınır 10 dk', up.state().backoffUntil - st.t === FIELD_UPLOAD.backoffMaxMs);
    st.t = up.state().backoffUntil + 1; st.resp = [{ status: 200 }]; const ok200 = await up.flush({ force: true });
    ok('A düzelince gider ve sayaç sıfırlanır', ok200.sent === true && up.state().backoffUntil === 0);
  }
  { const { st, up } = mk(); st.resp = [{ status: 429, retryAfterSec: 300 }]; await up.submit(REP, { force: true });
    ok('A 429 Retry-After: en az 300 sn bekler', up.state().backoffUntil >= st.t + 300_000 && up.pending() !== null);
  }
  { const { st, up } = mk(); st.resp = [{ status: 503 }]; await up.submit(REP, { force: true });
    ok('A 5xx tutar ve yeniden dener', up.pending() !== null && up.state().backoffUntil === st.t + 30_000);
  }
  { const { st, up } = mk(); st.resp = [{ status: 400 }]; const r = await up.submit(REP, { force: true });
    ok('A 4xx (400) düşürür ve 30 dk durur', r.skipped === 'rejected' && up.pending() === null && up.state().blockedUntil === st.t + FIELD_UPLOAD.blockMs);
    const again = await up.submit(REP, { force: true });
    ok('A durma süresince gönderilmez', again.skipped === 'blocked' && st.sends.length === 1);
  }
  { const { st, up } = mk(); st.resp = [{ status: 404 }]; await up.submit(REP, { force: true });
    ok('A 404 (eski sunucu) düşürür ve durur', up.pending() === null && up.state().blockedUntil > st.t);
  }
  { const { st, up } = mk(); st.enabledV = false; const r = await up.submit(REP, { force: true });
    ok('A kapalıyken hiçbir şey gönderilmez/saklanmaz', r.skipped === 'disabled' && st.sends.length === 0 && up.pending() === null);
    st.enabledV = true; st.resp = [new Error('ağ')]; await up.submit(REP, { force: true }); st.enabledV = false; up.clear(); await up.flush({ force: true });
    ok('A kapatınca bekleyen silinir', up.pending() === null && st.kv.get(PENDING_KEY) === null);
  }
  { const { st, up } = mk(); st.resp = [new Error('ağ')]; await up.submit(REP, { force: true });
    const up2 = createFieldUpload({ now: () => st.t + 60_000, enabled: () => true, info: () => ({}), storage: { get: (k) => st.kv.get(k), set: (k, v) => st.kv.set(k, v) }, send: async (b) => { st.sends.push(b); return { status: 200 }; } });
    up2.restore(); const r = await up2.flush({ force: true });
    ok('A yeniden başlatmada saklanan özet gönderilir (kalıcı bekleyen)', r.sent === true);
    const bad = createFieldUpload({ now: () => 1, enabled: () => true, info: () => ({}), storage: { get: () => ({ report: { schema: 'x' } }), set() {} }, send: async () => ({ status: 200 }) });
    bad.restore(); ok('A bozuk/yabancı depo verisi yok sayılır', bad.pending() === null);
  }
  { const { st, up } = mk(); const big = { ...REP, summary: { ...REP.summary, errors: { total: 1, top: Array.from({ length: 12 }, (_, i) => ({ message: 'x'.repeat(2000) + i, count: 1 })) } } };
    const r = await up.submit(big, { force: true });
    ok('A aşırı büyük gövde gönderilmez ve düşürülür', r.skipped === 'too-big' && st.sends.length === 0 && up.pending() === null);
  }
  { const { up } = mk(); const r = await up.submit({ schema: 'yanlis' }, { force: true });
    ok('A yabancı şema reddedilir', r.skipped === 'empty');
  }
}

// ===================== B) sunucu ingestField =====================
const { createClientLogs, LIMITS } = await import('../server/clientLogs.mjs');
{
  const dir = mkdtempSync(join(tmpdir(), 'field-b-')); dirs.push(dir);
  let T = Date.parse('2026-11-22T10:00:00Z');
  const cl = createClientLogs({ dir, now: () => T, scrub: (s) => String(s).split('SECRETVAL').join('***') });
  const did = 'd_BBBBBBBBBBBBBBBBBBBB';
  const body = (over = {}) => JSON.parse(JSON.stringify({ ...REP, client: { v: '0.99.125', p: 'iOS', did, sid: 's_abcdef12' }, ...over }));
  const r = await cl.ingestField({ body: body(), ip: '203.0.113.77', deviceHeader: did });
  ok('B geçerli özet 200', r.status === 200 && r.body.ok === true, JSON.stringify(r));
  const f = files(join(dir, 'client-logs'), /^field-reports-\d{4}-\d{2}-\d{2}\.jsonl$/);
  ok('B ayrı dosyaya yazıldı (field-reports-GÜN.jsonl)', f.length === 1);
  const rec = f.length ? lines(f[0])[0] : null;
  ok('B kayıt: tür field, istemci bilgisi, meta, özet beyaz listeli', rec?.kind === 'field' && rec.client?.did === did && rec.client?.p === 'iOS' && rec.meta?.version === '0.99.125' && rec.summary?.v === 1 && rec.summary.ocr.reads === 2);
  const raw = f.length ? readFileSync(f[0], 'utf8') : '';
  ok('B IP maskeli, konum/URL/e-posta diske yazılmadı', rec?.ip === '203.0.113.0' && !raw.includes('203.0.113.77') && !/41\.015137|28\.979530|x\.example|kisi@ornek/.test(raw), raw.slice(0, 300));
  const aud = lines(files(join(dir, 'client-logs'), /^uploads-/)[0]);
  ok('B denetim satırı: tür field, ok, cihaz, sürüm, platform', aud.some((a) => a.kind === 'field' && a.result === 'ok' && a.did === did && a.v === '0.99.125' && a.p === 'iOS' && a.bytes > 0));
  ok('B stats.fieldAccepted', cl.stats().fieldAccepted === 1);

  const bad = async (b, h = did) => (await cl.ingestField({ body: b, ip: '203.0.113.78', deviceHeader: h })).status;
  T += 61_000; // hız penceresi
  ok('B şema yanlış 400', await bad({ ...body(), schema: 'x' }) === 400);
  ok('B özet yok 400', await bad({ ...body(), summary: null }) === 400);
  ok('B özet sürümü yanlış 400', await bad({ ...body(), summary: { ...REP.summary, v: 2 } }) === 400);
  ok('B cihaz kimliği yok 400', await bad({ ...REP }, '') === 400);
  ok('B gövde nesne değil 400', await bad('x') === 400 && await bad(undefined) === 400);
  const tooBig = await cl.ingestField({ body: body(), ip: '203.0.113.79', deviceHeader: did, bytes: LIMITS.bodyBytes + 1 });
  ok('B gövde sınırı 400', tooBig.status === 400);

  // beyaz liste: fazla alan, kötü anahtarlar, sayı olmayanlar, uzun/gizli ileti
  T += 61_000;
  const evil = body();
  evil.summary.ocr.rejectedByReason = { range: 2, 'kötü anahtar!': 5, ['k'.repeat(60)]: 1, ok_key: 'metin', neg: -4 };
  evil.summary.errors.top = [{ message: 'SECRETVAL ' + 'u'.repeat(400) + ' https://gizli.example/x', count: 3 }, 'metin', null];
  evil.summary.extraField = 'yazılmamalı'; evil.summary.ocr.reads = 'çok'; evil.extraTop = 1;
  evil.client.extra = 'yazılmamalı'; evil.meta.platform = 'Palm'; evil.meta.at = 'dün';
  const re = await cl.ingestField({ body: evil, ip: '203.0.113.80', deviceHeader: did });
  ok('B kötü niyetli gövde yine 200 (alanlar temizlenir)', re.status === 200, JSON.stringify(re));
  const rec2 = lines(files(join(dir, 'client-logs'), /^field-reports-/)[0]).at(-1);
  ok('B kötü anahtarlar/sayı olmayan değerler elendi, negatif 0', JSON.stringify(rec2.summary.ocr.rejectedByReason) === JSON.stringify({ range: 2, ok_key: 0, neg: 0 }), JSON.stringify(rec2.summary.ocr.rejectedByReason));
  ok('B ileti: gizli değer ***, URL [url], 160 karaktere kırpık; yalnız nesne öğeler', rec2.summary.errors.top.length === 1 && rec2.summary.errors.top[0].message.startsWith('*** ') && rec2.summary.errors.top[0].message.length <= 160 && !rec2.summary.errors.top[0].message.includes('SECRETVAL'));
  ok('B şema dışı alanlar yazılmadı', rec2.summary.extraField === undefined && rec2.extraTop === undefined && rec2.client.extra === undefined && rec2.summary.ocr.reads === 0);
  ok('B bilinmeyen platform other, bozuk tarih null', rec2.meta.platform === 'other' && rec2.meta.at === null);

  // hız sınırı: aynı cihaz dakikada 12
  T += 61_000;
  let last = 200; for (let i = 0; i < 14; i++) last = (await cl.ingestField({ body: body(), ip: '198.51.100.' + (i + 1), deviceHeader: did })).status;
  ok('B cihaz başına dakikada 12 sonrası 429', last === 429);

  // günlük tavan
  const dir2 = mkdtempSync(join(tmpdir(), 'field-b2-')); dirs.push(dir2);
  const cl2 = createClientLogs({ dir: dir2, now: () => T, perDevicePerMin: 1000, perIpPerMin: 1000 });
  let code = 200, n = 0; while (code === 200 && n < 3000) { code = (await cl2.ingestField({ body: body(), ip: '203.0.113.9', deviceHeader: did })).status; n++; }
  ok('B günlük saha özeti tavanı (5 MB) sonrası 429', code === 429 && n > 10, `n=${n} code=${code}`);

  // saklama: eski field-reports dosyası silinir
  const { writeFileSync } = await import('node:fs');
  const dir3 = mkdtempSync(join(tmpdir(), 'field-b3-')); dirs.push(dir3);
  const cl3 = createClientLogs({ dir: dir3, now: () => T, keepDays: 30 });
  const old = join(dir3, 'client-logs', 'field-reports-2026-01-01.jsonl'); writeFileSync(old, '{}\n');
  await cl3.ingestField({ body: body(), ip: '203.0.113.5', deviceHeader: did });
  ok('B 30 günden eski saha özeti dosyası silindi', !existsSync(old));
}

// ===================== C) uçtan uca: gerçek istemci yükleyici → gerçek sunucu → yerel alıcı =====================
try {
  const dir = mkdtempSync(join(tmpdir(), 'field-e2e-')); dirs.push(dir);
  const recvDir = mkdtempSync(join(tmpdir(), 'field-recv-')); dirs.push(recvDir);
  const TOK = 'test-forward-token-0123456789abcdef';
  const { createReceiver } = await import('../server/log-receiver.mjs');
  const rcv = createReceiver({ dir: recvDir, token: TOK });
  const recvSrv = http.createServer((req, res) => rcv.handle(req, res)); servers.push(recvSrv);
  await new Promise((r) => recvSrv.listen(0, '127.0.0.1', r));
  const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'MAPBOX_MAP_TOKEN', 'GOOGLE_MAP_ID', 'TRUST_PROXY', 'TRUST_CF_HEADER', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'ADMIN_TOKEN_TTL_SEC', 'RATE_PER_MIN', 'PROVIDER_REQUESTS_PAUSED'].map((k) => [k, '']));
  const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...blank, PORT: '18842', HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: 'test-dummy-access-code-0123456789', CLIENT_LOG_FORWARD_URL: `http://127.0.0.1:${recvSrv.address().port}/ingest`, CLIENT_LOG_FORWARD_TOKEN: TOK } });
  children.push(child);
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await sleep(100);
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out.slice(0, 300));
  const BASE = 'http://127.0.0.1:18842';
  const did = 'd_' + 'E2EtestDevice0123456';
  const up = createFieldUpload({
    now: () => Date.now(), enabled: () => true, info: () => ({ v: '0.99.125', p: 'iOS', sa: true, apk: false, lang: 'tr', did, sid: 's_e2eTest01' }),
    storage: { get: () => null, set: () => {} },
    send: async (b) => { const r = await fetch(BASE + '/v1/fieldreport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': did, Origin: 'https://ozdemirumit.github.io' }, body: JSON.stringify(b) }); return { status: r.status, retryAfterSec: Number(r.headers.get('retry-after')) || undefined }; },
  });
  const res = await up.submit(REP, { force: true });
  ok('C gerçek sunucuya yükleme başarılı', res.sent === true, JSON.stringify(res));
  const cdir = join(dir, 'client-logs');
  const ff = files(cdir, /^field-reports-/);
  const rec = ff.length ? lines(ff[0])[0] : null;
  ok('C diske yazıldı (özet sayıları, istemci bilgisi)', rec?.summary?.ocr?.reads === 2 && rec?.client?.did === did && rec?.client?.p === 'iOS' && rec?.summary?.spoken?.total === 2);
  ok('C diskte konum/URL/e-posta yok', !/41\.015137|28\.979530|x\.example|kisi@ornek/.test(readFileSync(ff[0], 'utf8')));
  let got = []; for (let i = 0; i < 50 && !got.length; i++) { await sleep(100); got = files(recvDir, /^\d{4}-\d{2}-\d{2}\.jsonl$/).flatMap(lines); }
  ok('C yerel alıcıya iletildi (tür field)', got.length === 1 && got[0].body?.kind === 'field' && got[0].body?.summary?.ocr?.reads === 2, JSON.stringify(got).slice(0, 160));
  const aud = lines(files(cdir, /^uploads-/)[0]);
  ok('C denetim: field ok + ileri gönderme ok', aud.some((a) => a.kind === 'field' && a.result === 'ok' && a.did === did) && aud.some((a) => a.type === 'forward' && a.ok === true));
  const every = [...files(cdir, /./), ...files(recvDir, /./)].map((f) => readFileSync(f, 'utf8')).join('\n') + out;
  ok('C token hiçbir yerde yok', !every.includes(TOK));
  const bad = await fetch(BASE + '/v1/fieldreport', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': did, Origin: 'https://ozdemirumit.github.io' }, body: '{ bozuk' });
  ok('C bozuk gövde 400', bad.status === 400);
  const evil = await fetch(BASE + '/v1/fieldreport', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://kotu.example' }, body: '{}' });
  ok('C izinsiz köken 403', evil.status === 403);
  const getr = await fetch(BASE + '/v1/fieldreport', { headers: { Origin: 'https://ozdemirumit.github.io' } });
  ok('C GET kimliksiz 401 (yalnız POST yazar, okuma yok)', getr.status === 401);
  const sum = await (await fetch(BASE + '/admin/summary', { headers: { 'X-Access-Code': 'test-dummy-access-code-0123456789' } })).json().catch(() => ({}));
  ok('C yönetim özeti fieldAccepted sayar', sum.clientLogs?.fieldAccepted === 1, JSON.stringify(sum.clientLogs));
} catch (e) { ok('C uçtan uca çalıştı: ' + e.message, false); }

// ===================== D) kaynak ve bağlantı =====================
{
  const ft = read('js/ui/fieldTest.js'), ci = read('js/diag/clientLogInit.js'), fu = read('js/diag/fieldUpload.js'), sw = read('sw.js'), html = read('index.html');
  ok('D fieldTest kayıt durunca zorlu gönderim', /log\.stop\(now\(\)\); upload\(true\)/.test(ft));
  ok('D fieldTest sürüş bitince (nav aktif→pasif, kayıt açıkken) zorlu gönderim', /navWas && !n\.active && log\.active\(\)\) upload\(true\)/.test(ft));
  ok('D fieldTest arka plana geçerken ve 10 dk\'da bir zorlanmayan gönderim', /document\.hidden && log\.active\(\)\) \{ persist\(\); upload\(false\); \}/.test(ft) && /10 \* 60e3/.test(ft) && /upload\(false\)/.test(ft));
  ok('D fieldTest yükleyiciyi clientLogInit\'ten alır (Hata günlüğü anahtarına bağlı)', /fieldUploader\(\)\.submit\(reportJson\(summary\(\), meta\(\)\), \{ force \}\)/.test(ft));
  ok('D clientLogInit: ikinci yol /v1/fieldreport, tek çıplak fetch( korunur', /makePost\('\/v1\/fieldreport'/.test(ci) && (ci.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').match(/(?<![\w.$])fetch\(/g) || []).length === 1);
  ok('D yükleyici aynı etkin/kapı koşuluna bağlı ve kapatınca temizlenir', /enabled: \(\) => clientLogEnabled\(\) && !gate\(\)/.test(ci) && /fieldUp\.clear\(\)/.test(ci));
  ok('D fieldUpload.js saf: ağ/DOM/depolama/zaman çağrısı yok', !/\b(fetch|XMLHttpRequest|localStorage|document|window|setTimeout|setInterval)\b|Date\.now/.test(fu.replace(/\/\/.*$/gm, '')));
  ok('D sw.js SHELL fieldUpload.js içerir', sw.includes("'./js/diag/fieldUpload.js'"));
  ok('D index.html saha kartı: otomatik gönderim açıklaması (yalnız sayılar), eski "hiçbir yere gönderilmez" yok', /Hata günlüğü açıkken özet/.test(html) && !/hiçbir yere gönderilmez/.test(html));
}

for (const c of children) c.kill();
for (const s of servers) s.close();
await sleep(200);
for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows kilidi */ } }
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
