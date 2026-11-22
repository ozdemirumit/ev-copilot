// Yerel istemci-günlüğü alıcısı (AYRI süreç): proxy'nin CLIENT_LOG_FORWARD_URL ile gönderdiği toplu kayıtları diske yazar.
//   node server/log-receiver.mjs
// Ortam (server/.env okunur ama süreçte zaten tanımlı değişkenleri ezmez; dosya yolu LOG_RECEIVER_ENV_FILE ile değiştirilebilir):
//   LOG_RECEIVER_PORT (445) · LOG_RECEIVER_HOST (127.0.0.1) · LOG_RECEIVER_TOKEN · LOG_RECEIVER_DIR (DATA_DIR/received-logs)
// Yollar: POST /ingest (JSON; token tanımlıysa Authorization: Bearer şart) · GET /health (kimliksiz, ayrıntısız).
// Düz HTTP şifresizdir: loopback dışına açılacaksa token zorunludur (yoksa başlamayı reddeder); mümkünse TLS/VPN kullan.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { maskIp, LIMITS } from './clientLogs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REQ_TIMEOUT_MS = 15000;
const RECEIPT_DAY_BYTES = 10 * 1024 * 1024;

/** Adres loopback mu? (127.x.x.x, ::1, localhost) */
export function isLoopbackHost(h) {
  const s = String(h ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return s === 'localhost' || s === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s);
}

/** Ortamdan ayar üretir; geçersizse { error }. Saf (dosya/ağ yok). */
export function readConfig(env = {}, dataDirDefault = join(here, 'data')) {
  const host = String(env.LOG_RECEIVER_HOST || '127.0.0.1').trim();
  const token = String(env.LOG_RECEIVER_TOKEN || '');
  const rawPort = env.LOG_RECEIVER_PORT;
  const port = rawPort === undefined || String(rawPort).trim() === '' ? 445 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return { error: `LOG_RECEIVER_PORT geçersiz: ${String(rawPort).slice(0, 12)}` };
  if (!isLoopbackHost(host) && !token) {
    return { error: 'LOG_RECEIVER_HOST loopback değil ve LOG_RECEIVER_TOKEN boş: açık ağda tokensız alıcı başlatılmaz. Ya HOST=127.0.0.1 yap ya da bir LOG_RECEIVER_TOKEN tanımla.' };
  }
  const dir = String(env.LOG_RECEIVER_DIR || '').trim() || join(env.DATA_DIR || dataDirDefault, 'received-logs');
  return { host, port, token, dir };
}

const sha = (s) => createHash('sha256').update(String(s)).digest();
/** Zamanda sabit karşılaştırma (uzunluk farkı güvenli: iki taraf da özetlenir). */
function tokenOk(expected, header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || '').trim());
  if (!m) return false;
  return timingSafeEqual(sha(expected), sha(m[1].trim()));
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export function createReceiver({ dir, token = '', now = Date.now, maxBody = 65536, dayCapBytes = 200 * 1024 * 1024, timeoutMs = REQ_TIMEOUT_MS } = {}) {
  const counters = { received: 0, rejected: 0 };
  const sizes = new Map(); // dosya -> bayt (günlük tavan için)
  const sizeOf = (f) => { if (!sizes.has(f)) { try { sizes.set(f, statSync(f).size); } catch { sizes.set(f, 0); } } return sizes.get(f); };
  const append = (f, line) => {
    mkdirSync(dir, { recursive: true });
    appendFileSync(f, line);
    sizes.set(f, sizeOf(f) + Buffer.byteLength(line));
  };

  function receipt(req, path, bytes, result, status, did) {
    try {
      const f = join(dir, `receipts-${dayOf(now())}.jsonl`);
      const line = JSON.stringify({ ts: new Date(now()).toISOString(), remote: maskIp(req.socket?.remoteAddress), method: String(req.method || '').slice(0, 8), path: String(path).slice(0, 64), bytes, result, status, did: did || null }) + '\n';
      if (sizeOf(f) + Buffer.byteLength(line) > RECEIPT_DAY_BYTES) return;
      append(f, line);
    } catch { /* makbuz yazılamadı: yanıtı etkilemez */ }
  }

  function send(res, status, obj, extra = {}) {
    if (res.headersSent || res.writableEnded) return;
    const s = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s), ...extra });
    res.end(s);
  }

  function handle(req, res) {
    let path = '/';
    try { path = new URL(req.url || '/', 'http://x').pathname; } catch { /* '/' kalır */ }
    const method = req.method;
    const finish = (status, obj, result, bytes = 0, did = null, extra = {}) => {
      if (status >= 400) counters.rejected++;
      receipt(req, path, bytes, result, status, did);
      send(res, status, obj, extra);
    };

    if (path === '/health') {
      if (method !== 'GET') { req.resume?.(); return finish(405, { error: 'yöntem desteklenmiyor' }, 'method', 0, null, { Allow: 'GET' }); }
      return finish(200, { ok: true }, 'health');
    }
    if (path !== '/ingest') { req.resume?.(); return finish(404, { error: 'bulunamadı' }, 'notfound'); }
    if (method !== 'POST') { req.resume?.(); return finish(405, { error: 'yöntem desteklenmiyor' }, 'method', 0, null, { Allow: 'POST' }); }
    if (token && !tokenOk(token, req.headers?.authorization)) { req.resume?.(); return finish(401, { error: 'yetkisiz' }, 'unauthorized'); }
    const declared = Number(req.headers?.['content-length']);
    if (Number.isFinite(declared) && declared > maxBody) { req.resume?.(); return finish(413, { error: 'gövde çok büyük' }, 'too-large', declared); }

    let size = 0;
    let over = false;
    let done = false;
    const chunks = [];
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      finish(408, { error: 'zaman aşımı' }, 'timeout', size);
      try { req.destroy(); } catch { /* yok say */ }
    }, timeoutMs);
    const end = (fn) => { if (done) return; done = true; clearTimeout(timer); fn(); };
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > maxBody) { over = true; chunks.length = 0; end(() => finish(413, { error: 'gövde çok büyük' }, 'too-large', size)); return; }
      chunks.push(c);
    });
    req.on('error', () => end(() => finish(400, { error: 'istek okunamadı' }, 'read-error', size)));
    req.on('aborted', () => { done = true; clearTimeout(timer); });
    req.on('end', () => end(() => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(400, { error: 'JSON geçersiz' }, 'bad-json', size); }
      if (!isObj(body)) return finish(400, { error: 'gövde nesne olmalı' }, 'bad-body', size);
      const did = isObj(body.client) && typeof body.client.did === 'string' && LIMITS.didRe.test(body.client.did) ? body.client.did : null;
      const day = dayOf(now());
      const f = join(dir, `${day}.jsonl`);
      const line = JSON.stringify({ rcv: new Date(now()).toISOString(), remote: maskIp(req.socket?.remoteAddress), body }) + '\n';
      if (sizeOf(f) + Buffer.byteLength(line) > dayCapBytes) return finish(429, { error: 'günlük tavan doldu' }, 'cap', size, did);
      try { append(f, line); } catch { return finish(500, { error: 'yazılamadı' }, 'write-error', size, did); }
      counters.received++;
      finish(200, { ok: true }, 'ok', size, did);
    }));
  }

  function stats() { return { ...counters }; }
  return { handle, stats };
}

// ---- doğrudan çalıştırma ----
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

function main() {
  loadEnv(process.env.LOG_RECEIVER_ENV_FILE || join(here, '.env'));
  const cfg = readConfig(process.env, join(here, 'data'));
  if (cfg.error) { console.error('log-receiver BAŞLATILMADI: ' + cfg.error); process.exit(1); }
  const receiver = createReceiver({ dir: cfg.dir, token: cfg.token });
  const server = http.createServer(receiver.handle);
  server.requestTimeout = REQ_TIMEOUT_MS;
  server.headersTimeout = REQ_TIMEOUT_MS;
  server.on('error', (e) => {
    if (e && (e.code === 'EADDRINUSE' || e.code === 'EACCES')) {
      console.error(`log-receiver BAŞLATILMADI: ${cfg.host}:${cfg.port} kullanılamıyor (${e.code}). 445 başka bir hizmette (Windows'ta SMB sunucusu) olabilir; SMB'yi KAPATMA; LOG_RECEIVER_PORT ile başka bağlantı noktası seç (ör. 4450).`);
    } else {
      console.error('log-receiver BAŞLATILMADI: ' + (e && e.code ? e.code : 'bilinmeyen hata'));
    }
    process.exit(1);
  });
  server.listen(cfg.port, cfg.host, () => {
    const a = server.address();
    console.log(`log-receiver dinliyor: ${cfg.host}:${a && typeof a === 'object' ? a.port : cfg.port} -> ${cfg.dir}${cfg.token ? ' (token zorunlu)' : ' (tokensız, yalnız loopback)'}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();
