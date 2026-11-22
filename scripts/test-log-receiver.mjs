// Yerel günlük alıcısı (server/log-receiver.mjs) — çevrimdışı/yerel: geçici dizin, 127.0.0.1 üzerinde port 0 (8787 ve 445 KULLANILMAZ), yer tutucu token.
// Kapsam: /health, /ingest token doğrulaması (yok/yanlış/farklı uzunluk/doğru), gövde sınırı, bozuk JSON, yol/yöntem, makbuz satırları,
// token sızıntısı, readConfig kuralları, loopback dışı + tokensız başlatmanın reddi (alt süreç), EADDRINUSE iletisi,
// ayrı süreç olarak uçtan uca POST, clientLogs -> alıcı ileri gönderme (gerçek yerel HTTP).
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { createReceiver, readConfig, isLoopbackHost } from '../server/log-receiver.mjs';
import { createClientLogs } from '../server/clientLogs.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('BAŞARISIZ:', name); } };

const here = dirname(fileURLToPath(import.meta.url));
const RECEIVER = join(here, '..', 'server', 'log-receiver.mjs');
const base = mkdtempSync(join(tmpdir(), 'evrf-logrecv-'));
let seq = 0;
const newDir = () => join(base, 'r' + (seq++));
const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const DAY = '2026-11-22';
const DID = 'd_' + 'A'.repeat(20);
const TOKEN = 'PLACEHOLDER-receiver-token-not-real';

const readLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const allText = (d) => (existsSync(d) ? readdirSync(d).map((f) => readFileSync(join(d, f), 'utf8')).join('\n') : '');

function startServer(receiver) {
  return new Promise((resolve) => {
    const s = http.createServer(receiver.handle);
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}
function call(port, { method = 'POST', path = '/ingest', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(data !== undefined ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      let t = '';
      res.on('data', (c) => { t += c; });
      res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* json değil */ } resolve({ status: res.statusCode, json: j, text: t, headers: res.headers }); });
    });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
const rec = (extra = {}) => ({ src: 'evrf-proxy', rcv: new Date(T0).toISOString(), ip: '203.0.113.0', client: { did: DID, v: '0.99.123' }, events: [{ t: T0, lvl: 'info', k: 'app.start' }], ...extra });
const cleanEnv = () => { const e = { ...process.env }; for (const k of Object.keys(e)) if (k.startsWith('LOG_RECEIVER_')) delete e[k]; return e; };
function run(env, { waitFor, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [RECEIVER], { env: { ...cleanEnv(), LOG_RECEIVER_ENV_FILE: join(base, 'yok.env'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const out0 = { p, get out() { return out; }, get err() { return err; } };
    const t = setTimeout(() => { try { p.kill(); } catch { /* yok say */ } }, timeoutMs);
    p.stdout.on('data', (c) => { out += c; if (waitFor && waitFor.test(out)) resolve({ ...out0, out, err, exited: false }); });
    p.stderr.on('data', (c) => { err += c; });
    p.on('exit', (code) => { clearTimeout(t); resolve({ ...out0, out, err, code, exited: true }); });
  });
}

// ---- 1) readConfig / isLoopbackHost ----
{
  ok('loopback: 127.0.0.1, ::1, [::1], localhost, 127.5.5.5', ['127.0.0.1', '::1', '[::1]', 'localhost', '127.5.5.5'].every(isLoopbackHost));
  ok('loopback değil: 0.0.0.0, LAN, boş', !isLoopbackHost('0.0.0.0') && !isLoopbackHost('192.168.1.5') && !isLoopbackHost('example.test') && !isLoopbackHost('::'));
  const c = readConfig({}, '/veri');
  ok('varsayılanlar: port 445, host 127.0.0.1, token boş, dizin /veri/received-logs', c.port === 445 && c.host === '127.0.0.1' && c.token === '' && /received-logs$/.test(c.dir) && c.dir.replace(/\\/g, '/').includes('/veri/'));
  ok('DATA_DIR ve LOG_RECEIVER_DIR', readConfig({ DATA_DIR: '/d' }, '/veri').dir.replace(/\\/g, '/') === '/d/received-logs' && readConfig({ LOG_RECEIVER_DIR: '/x/y' }, '/veri').dir === '/x/y');
  ok('port 0 geçerli, boş port 445', readConfig({ LOG_RECEIVER_PORT: '0' }).port === 0 && readConfig({ LOG_RECEIVER_PORT: '' }).port === 445);
  ok('geçersiz port reddedilir', !!readConfig({ LOG_RECEIVER_PORT: 'abc' }).error && !!readConfig({ LOG_RECEIVER_PORT: '70000' }).error && !!readConfig({ LOG_RECEIVER_PORT: '-1' }).error);
  ok('loopback dışı + tokensız -> hata', !!readConfig({ LOG_RECEIVER_HOST: '0.0.0.0' }).error && !!readConfig({ LOG_RECEIVER_HOST: '192.168.1.5', LOG_RECEIVER_TOKEN: '' }).error);
  ok('loopback dışı + token -> geçerli', readConfig({ LOG_RECEIVER_HOST: '0.0.0.0', LOG_RECEIVER_TOKEN: TOKEN }).error === undefined);
  ok('hata iletisinde token değeri yok', !JSON.stringify(readConfig({ LOG_RECEIVER_HOST: '0.0.0.0', LOG_RECEIVER_PORT: 'x', LOG_RECEIVER_TOKEN: TOKEN })).includes(TOKEN));
}

// ---- 2) tokensız (yalnız loopback) alıcı ----
{
  const dir = newDir();
  const R = createReceiver({ dir, now: () => T0 });
  const { server, port } = await startServer(R);
  let r = await call(port, { method: 'GET', path: '/health' });
  ok('GET /health 200 {ok:true} kimliksiz, ayrıntısız', r.status === 200 && JSON.stringify(r.json) === '{"ok":true}');
  r = await call(port, { body: rec() });
  ok('POST /ingest 200 {ok:true}', r.status === 200 && r.json.ok === true);
  const rows = readLines(join(dir, `${DAY}.jsonl`));
  ok('günlük satırı: rcv + maskeli remote + body', rows.length === 1 && rows[0].rcv === new Date(T0).toISOString() && rows[0].remote === '127.0.0.0' && rows[0].body.client.did === DID && rows[0].body.src === 'evrf-proxy');
  ok('diskte tam 127.0.0.1 yok', !allText(dir).includes('127.0.0.1'));
  const rc = readLines(join(dir, `receipts-${DAY}.jsonl`));
  ok('makbuz: kabul satırı alanları + did', rc.length === 2 && rc[1].result === 'ok' && rc[1].status === 200 && rc[1].method === 'POST' && rc[1].path === '/ingest' && rc[1].did === DID && rc[1].bytes > 10 && rc[1].remote === '127.0.0.0');

  r = await call(port, { body: '{bozuk' });
  ok('bozuk JSON 400', r.status === 400);
  r = await call(port, { body: '[1,2]' });
  ok('dizi gövde 400', r.status === 400);
  r = await call(port, { body: 'null' });
  ok('null gövde 400', r.status === 400);
  r = await call(port, { path: '/baska', body: {} });
  ok('bilinmeyen yol 404', r.status === 404);
  r = await call(port, { method: 'GET', path: '/ingest' });
  ok('GET /ingest 405 + Allow', r.status === 405 && r.headers.allow === 'POST');
  r = await call(port, { method: 'POST', path: '/health', body: {} });
  ok('POST /health 405', r.status === 405);
  const rc2 = readLines(join(dir, `receipts-${DAY}.jsonl`));
  ok('makbuz: reddedilenler de yazıldı (400/404/405)', rc2.some((x) => x.status === 400 && x.result === 'bad-json') && rc2.some((x) => x.status === 404) && rc2.filter((x) => x.status === 405).length === 2);
  ok('reddedilen gövde günlüğe yazılmadı', readLines(join(dir, `${DAY}.jsonl`)).length === 1);
  ok('stats sayaçları', R.stats().received === 1 && R.stats().rejected >= 5);
  server.close();
}

// ---- 3) gövde sınırı + zaman aşımı ----
{
  const dir = newDir();
  const R = createReceiver({ dir, now: () => T0, maxBody: 200, timeoutMs: 150 });
  const { server, port } = await startServer(R);
  let r = await call(port, { body: { x: 'y'.repeat(500) } });
  ok('Content-Length > maxBody -> 413', r.status === 413);
  ok('büyük gövde günlüğe yazılmadı', readLines(join(dir, `${DAY}.jsonl`)).length === 0);
  ok('sınır altı küçük gövde kabul', (await call(port, { body: { a: 1 } })).status === 200);
  // chunked (Content-Length yok) büyük gövde
  r = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/ingest', headers: { 'Content-Type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(0));
    req.write('{"x":"' + 'z'.repeat(400)); req.end('"}');
  });
  ok('chunked büyük gövde 413 (ya da bağlantı kesilir)', r === 413 || r === 0);
  // yarım gövde -> zaman aşımı
  r = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/ingest', headers: { 'Content-Type': 'application/json', 'Content-Length': '100' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', () => resolve(0));
    req.write('{"a":');
  });
  ok('yarım gövde zaman aşımında 408 (ya da bağlantı kesilir)', r === 408 || r === 0);
  ok('makbukta 413 ve 408 satırları', (() => { const rc = readLines(join(dir, `receipts-${DAY}.jsonl`)); return rc.some((x) => x.status === 413) && rc.some((x) => x.status === 408); })());
  server.close();
}

// ---- 4) token doğrulaması ----
{
  const dir = newDir();
  const R = createReceiver({ dir, token: TOKEN, now: () => T0 });
  const { server, port } = await startServer(R);
  const auth = (v) => ({ Authorization: v });
  ok('token yok -> 401', (await call(port, { body: rec() })).status === 401);
  ok('yanlış token -> 401', (await call(port, { headers: auth('Bearer PLACEHOLDER-yanlis'), body: rec() })).status === 401);
  ok('farklı uzunlukta token -> 401 (fırlatmaz)', (await call(port, { headers: auth('Bearer x'), body: rec() })).status === 401 && (await call(port, { headers: auth('Bearer ' + 'y'.repeat(5000)), body: rec() })).status === 401);
  ok('Bearer olmayan şema -> 401', (await call(port, { headers: auth(`Basic ${TOKEN}`), body: rec() })).status === 401 && (await call(port, { headers: auth(TOKEN), body: rec() })).status === 401);
  ok('token önekle eşleşmesi yetmez', (await call(port, { headers: auth(`Bearer ${TOKEN}x`), body: rec() })).status === 401 && (await call(port, { headers: auth(`Bearer ${TOKEN.slice(0, -1)}`), body: rec() })).status === 401);
  ok('doğru token -> 200', (await call(port, { headers: auth(`Bearer ${TOKEN}`), body: rec() })).status === 200);
  ok('yetkisiz istekler günlüğe yazılmadı, yalnızca 1 kabul', readLines(join(dir, `${DAY}.jsonl`)).length === 1);
  const rc = readLines(join(dir, `receipts-${DAY}.jsonl`));
  ok('makbuz: yetkisiz satırlar (unauthorized/401) var', rc.filter((x) => x.result === 'unauthorized' && x.status === 401).length === 8);
  ok('/health token olmadan 200', (await call(port, { method: 'GET', path: '/health' })).status === 200);
  ok('token hiçbir dosyada yok', !allText(dir).includes(TOKEN));
  ok('yanıtlarda token yok', !(JSON.stringify(await call(port, { headers: auth('Bearer yanlis'), body: rec() }))).includes(TOKEN));
  server.close();
}

// ---- 5) alt süreç: loopback dışı + tokensız başlatma reddi, EADDRINUSE iletisi ----
{
  const r = await run({ LOG_RECEIVER_HOST: '0.0.0.0', LOG_RECEIVER_PORT: '0', LOG_RECEIVER_DIR: newDir() });
  ok('0.0.0.0 + tokensız: çıkış kodu 1, açık Türkçe hata, dinlemedi', r.exited && r.code === 1 && /BAŞLATILMADI/.test(r.err) && /LOG_RECEIVER_TOKEN/.test(r.err) && !/dinliyor/.test(r.out));

  const blocker = net.createServer();
  await new Promise((res) => blocker.listen(0, '127.0.0.1', res));
  const busy = blocker.address().port;
  const r2 = await run({ LOG_RECEIVER_HOST: '127.0.0.1', LOG_RECEIVER_PORT: String(busy), LOG_RECEIVER_DIR: newDir() });
  ok('meşgul bağlantı noktası: çıkış 1 + SMB/445 açıklaması + 4450 önerisi', r2.exited && r2.code === 1 && /445/.test(r2.err) && /SMB/.test(r2.err) && /KAPATMA/.test(r2.err) && /4450/.test(r2.err) && /LOG_RECEIVER_PORT/.test(r2.err));
  blocker.close();
}

// ---- 6) alt süreç: gerçekten ayrı süreç, uçtan uca POST (port 0, basılan adresten okunur) ----
{
  const dir = newDir();
  const r = await run({ LOG_RECEIVER_HOST: '127.0.0.1', LOG_RECEIVER_PORT: '0', LOG_RECEIVER_DIR: dir, LOG_RECEIVER_TOKEN: TOKEN }, { waitFor: /dinliyor: 127\.0\.0\.1:\d+/ });
  const m = /dinliyor: 127\.0\.0\.1:(\d+)/.exec(r.out);
  ok('alt süreç dinliyor, adres:port basıldı', !r.exited && !!m);
  if (m) {
    const port = Number(m[1]);
    ok('başlangıç çıktısında token yok', !r.out.includes(TOKEN) && !r.err.includes(TOKEN));
    ok('alt süreç /health', (await call(port, { method: 'GET', path: '/health' })).status === 200);
    ok('alt süreç tokensız 401', (await call(port, { body: rec() })).status === 401);
    const ok1 = await call(port, { headers: { Authorization: `Bearer ${TOKEN}` }, body: rec() });
    ok('alt süreç doğru token 200', ok1.status === 200 && ok1.json.ok === true);
    const day = new Date().toISOString().slice(0, 10);
    const rows = readLines(join(dir, `${day}.jsonl`));
    ok('alt süreç diske yazdı (maskeli remote, token yok)', rows.length === 1 && rows[0].remote === '127.0.0.0' && rows[0].body.client.did === DID && !allText(dir).includes(TOKEN));
  }
  try { r.p.kill(); } catch { /* yok say */ }
  await new Promise((res) => (r.p.exitCode !== null ? res() : r.p.on('exit', res)));
}

// ---- 7) clientLogs -> alıcı (gerçek yerel HTTP, node:http ile ileri gönderme) ----
{
  const rdir = newDir();
  const R = createReceiver({ dir: rdir, token: TOKEN });
  const { server, port } = await startServer(R);
  const ldir = newDir();
  const body = { schema: 'evrf-client-log/1', client: { v: '0.99.123', p: 'Android', did: DID, sid: 's_AbC123xyz' }, events: [{ t: Date.now(), lvl: 'info', k: 'app.start', m: 'başladı' }] };

  const L = createClientLogs({ dir: ldir, forwardUrl: `http://127.0.0.1:${port}/ingest`, forwardToken: TOKEN });
  const r = await L.ingest({ body, ip: '203.0.113.77', deviceHeader: DID, bytes: 400 });
  await L.idle();
  const got = readLines(join(rdir, `${new Date().toISOString().slice(0, 10)}.jsonl`));
  ok('uçtan uca: istemci günlüğü alıcıya ulaştı', r.status === 200 && got.length === 1 && got[0].body.src === 'evrf-proxy' && got[0].body.client.did === DID && got[0].body.ip === '203.0.113.0' && L.stats().forwardOk === 1);
  ok('uçtan uca: tam IP ve token hiçbir tarafta yok', !allText(rdir).includes('203.0.113.77') && !allText(rdir).includes(TOKEN) && !allText(join(ldir, 'client-logs')).includes(TOKEN) && !allText(join(ldir, 'client-logs')).includes('203.0.113.77'));

  // yanlış token -> 401 -> başarısız -> forward-failed
  const ldir2 = newDir();
  const Lbad = createClientLogs({ dir: ldir2, forwardUrl: `http://127.0.0.1:${port}/ingest`, forwardToken: 'PLACEHOLDER-yanlis' });
  await Lbad.ingest({ body, ip: '203.0.113.78', deviceHeader: DID, bytes: 400 });
  await Lbad.idle();
  ok('yanlış token: 401 -> forward-failed.jsonl’de bekler', Lbad.stats().forwardFail === 1 && readLines(join(ldir2, 'client-logs', 'forward-failed.jsonl')).length === 1);

  // alıcı kapalı -> bağlantı hatası -> kayıp yok
  server.close();
  const ldir3 = newDir();
  const Ldown = createClientLogs({ dir: ldir3, forwardUrl: `http://127.0.0.1:${port}/ingest`, forwardToken: TOKEN, forwardTimeoutMs: 1500 });
  const rd = await Ldown.ingest({ body, ip: '203.0.113.79', deviceHeader: DID, bytes: 400 });
  await Ldown.idle();
  ok('alıcı kapalı: istemci yine 200, kayıt forward-failed’de', rd.status === 200 && readLines(join(ldir3, 'client-logs', 'forward-failed.jsonl')).length === 1);
}

rmSync(base, { recursive: true, force: true });
console.log(`test-log-receiver: ${pass} geçti, ${fail} başarısız`);
if (fail) process.exit(1);
process.exit(0);
