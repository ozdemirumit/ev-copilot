// İstemci günlüğü uçtan uca (v0.99.123): GERÇEK istemci çekirdeği (js/diag/clientLog.js) → GERÇEK ara sunucu süreci (server/proxy.mjs, port 18841) → diske + yerel alıcıya (log-receiver) ileri gönderme.
// Çevrimdışı: yalnız 127.0.0.1; sahte token; 8787 ve 445 KULLANILMAZ. Kullanım: node scripts/test-client-log-e2e.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dirs = [], children = [], servers = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FWD_TOKEN = 'test-forward-token-0123456789abcdef';
const ORIGIN = 'https://ozdemirumit.github.io';
const files = (d, re) => (existsSync(d) ? readdirSync(d).filter((n) => re.test(n)).map((n) => join(d, n)) : []);
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

try {
  const dir = mkdtempSync(join(tmpdir(), 'clientlog-e2e-')); dirs.push(dir);
  const recvDir = mkdtempSync(join(tmpdir(), 'clientlog-recv-')); dirs.push(recvDir);

  // yerel alıcı (log-receiver.mjs'in gerçek işleyicisi), token'lı, port 0
  const { createReceiver } = await import('../server/log-receiver.mjs');
  const rcv = createReceiver({ dir: recvDir, token: FWD_TOKEN });
  const recvSrv = http.createServer((req, res) => rcv.handle(req, res));
  servers.push(recvSrv);
  await new Promise((r) => recvSrv.listen(0, '127.0.0.1', r));
  const recvPort = recvSrv.address().port;

  // ara sunucu: sağlayıcı koruması DURAKLATILMIŞ (varsayılan) — ileri gönderme node:http ile olduğundan etkilenmemeli
  const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'MAPBOX_MAP_TOKEN', 'GOOGLE_MAP_ID', 'TRUST_PROXY', 'TRUST_CF_HEADER', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'ADMIN_TOKEN_TTL_SEC', 'RATE_PER_MIN', 'PROVIDER_REQUESTS_PAUSED'].map((k) => [k, '']));
  const child = spawn(process.execPath, ['server/proxy.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...blank, PORT: '18841', HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: 'test-dummy-access-code-0123456789', CLIENT_LOG_FORWARD_URL: `http://127.0.0.1:${recvPort}/ingest`, CLIENT_LOG_FORWARD_TOKEN: FWD_TOKEN },
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await sleep(100);
  if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out.slice(0, 300));
  const BASE = 'http://127.0.0.1:18841';

  // ---- gerçek istemci çekirdeği → gerçek sunucu ----
  const { createClientLog } = await import('../js/diag/clientLog.js');
  const did = 'd_' + 'A1b2C3d4E5f6G7h8I9j0';
  const kv = new Map();
  const wire = [];
  const log = createClientLog({
    now: () => Date.now(), rand: Math.random, enabled: () => true,
    storage: { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) },
    info: () => ({ v: '0.99.123', p: 'iOS', sa: true, apk: false, lang: 'tr', tz: 180, online: true, vw: 390, vh: 844, net: '4g', did }),
    send: async (batch) => {
      wire.push(batch);
      const r = await fetch(BASE + '/v1/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': did, Origin: ORIGIN }, body: JSON.stringify(batch) });
      return { status: r.status, retryAfterSec: Number(r.headers.get('retry-after')) || undefined };
    },
  });
  log.log('app.start', 'uygulama açıldı', { sa: true, apk: false });
  log.warn('voice.error', 'not-allowed', { r: 'not-allowed' });
  log.error('js.error', 'Hata https://secret.example/x?a=1 kullanici@ornek.com 41.015137,28.979530 oldu', { line: 12, col: 5 });
  const res = await log.flush({ force: true });
  ok('A istemci toplu gönderimi başarılı (200)', res.sent === 3 || res.status === 200, JSON.stringify(res));
  ok('A kuyruk boşaldı', log.pending().length === 0 && log.state().queued === 0);

  // ---- sunucu diski ----
  const cdir = join(dir, 'client-logs');
  const dayFiles = files(cdir, /^\d{4}-\d{2}-\d{2}\.jsonl$/);
  ok('B günlük dosyası yazıldı', dayFiles.length === 1);
  const rec = dayFiles.length ? lines(dayFiles[0]) : [];
  ok('B tek toplu kayıt, 3 olay, istemci bilgisi', rec.length === 1 && rec[0].events?.length === 3 && rec[0].client?.p === 'iOS' && rec[0].client?.v === '0.99.123' && rec[0].client?.did === did);
  const raw = dayFiles.length ? readFileSync(dayFiles[0], 'utf8') : '';
  ok('B URL/e-posta/koordinat diske yazılmadı', !/secret\.example|kullanici@|41\.015137|28\.979530/.test(raw), raw.slice(0, 300));
  ok('B tam IP diske yazılmadı (maskeli)', !raw.includes('"127.0.0.1"') && /127\.0\.0\.0|"ip":/.test(raw));
  const auditF = files(cdir, /^uploads-\d{4}-\d{2}-\d{2}\.jsonl$/);
  const aud = auditF.length ? lines(auditF[0]) : [];
  ok('B denetim satırı: sonuç ok, cihaz, sürüm, platform, bayt', aud.some((a) => a.result === 'ok' && a.did === did && a.v === '0.99.123' && a.p === 'iOS' && a.bytes > 0 && a.accepted === 3));

  // ---- ileri gönderme: yerel alıcı (sağlayıcı koruması duraklatılmışken de) ----
  let got = [];
  for (let i = 0; i < 50 && !got.length; i++) { await sleep(100); got = files(recvDir, /^\d{4}-\d{2}-\d{2}\.jsonl$/).flatMap(lines); }
  ok('C yerel alıcıya ulaştı (koruma duraklatılmış olsa da)', got.length === 1 && got[0].body?.events?.length === 3 && got[0].body?.src === 'evrf-proxy', JSON.stringify(got).slice(0, 200));
  const auditAll = auditF.length ? readFileSync(auditF[0], 'utf8') : '';
  let fwdAudit = [];
  for (let i = 0; i < 30; i++) { fwdAudit = lines(auditF[0]).filter((a) => a.type === 'forward'); if (fwdAudit.length) break; await sleep(100); }
  ok('C ileri gönderme denetim satırı ok', fwdAudit.length >= 1 && fwdAudit[0].ok === true, JSON.stringify(fwdAudit));
  const everything = [...files(cdir, /./), ...files(recvDir, /./)].map((f) => readFileSync(f, 'utf8')).join('\n') + out + auditAll;
  ok('C ileri gönderme token\'ı hiçbir dosyada/süreç çıktısında yok', !everything.includes(FWD_TOKEN));
  ok('C alıcı makbuzu yazıldı (cihaz kimliği ile)', files(recvDir, /^receipts-/).flatMap(lines).some((x) => x.result === 'ok' && x.did === did));

  // ---- protokol sınırları ----
  const post = (body, headers = {}) => fetch(BASE + '/v1/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body });
  const bad = await post('{ bozuk json');
  ok('D bozuk gövde 400', bad.status === 400, String(bad.status));
  const noDev = await post(JSON.stringify({ schema: 'evrf-client-log/1', client: { v: '1' }, events: [{ t: 1, lvl: 'info', k: 'x.y', m: 'a' }] }));
  ok('D kimliksiz (cihaz kimliği yok) 400', noDev.status === 400, String(noDev.status));
  const badSchema = await post(JSON.stringify({ schema: 'x', client: { did }, events: [] }));
  ok('D şema yanlış 400', badSchema.status === 400, String(badSchema.status));
  const big = await post(JSON.stringify({ schema: 'evrf-client-log/1', client: { did }, events: [{ t: 1, lvl: 'info', k: 'a.b', m: 'x'.repeat(20000) }] }));
  ok('D 16 KB üstü gövde 400', big.status === 400, String(big.status));
  const evil = await fetch(BASE + '/v1/clientlog', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://kotu.example' }, body: '{}' });
  ok('D izinsiz köken 403', evil.status === 403, String(evil.status));
  const pre = await fetch(BASE + '/v1/clientlog', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-device-id' } });
  ok('D ön kontrol (CORS) 204 ve X-Device-Id izinli', pre.status === 204 && /x-device-id/i.test(pre.headers.get('access-control-allow-headers') || ''), `${pre.status} ${pre.headers.get('access-control-allow-headers')}`);
  const get = await fetch(BASE + '/v1/clientlog', { headers: { Origin: ORIGIN } });
  ok('D GET kimliksiz 401 (yazma yolu yalnız POST; okuma yok)', get.status === 401, String(get.status));
  const sum = await fetch(BASE + '/admin/summary', { headers: { 'X-Access-Code': 'test-dummy-access-code-0123456789' } });
  const sj = await sum.json().catch(() => ({}));
  ok('E yönetim özetinde istemci günlüğü sayaçları (içerik yok)', sj.clientLogs && sj.clientLogs.accepted >= 3 && !JSON.stringify(sj.clientLogs).includes(FWD_TOKEN), JSON.stringify(sj.clientLogs));
} catch (e) { ok('uçtan uca çalıştı: ' + e.message, false); }

for (const c of children) c.kill();
for (const s of servers) s.close();
await sleep(200);
for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows kilidi: geçici klasör */ } }
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
