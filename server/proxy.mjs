// EV Co-Pilot ara sunucusu (isteğe bağlı). Telefon yerine bu sunucu Mapbox, OpenChargeMap ve Overpass'e gider:
//  - anahtarlar yalnızca burada (server/.env) durur, uygulamaya ve repoya girmez;
//  - Overpass/OpenChargeMap/Mapbox arama yanıtları ortak önbelleğe alınır, Overpass istekleri sıraya konur (429 azalır);
//  - istemci davetle kayıt olmuş bir hesapla (Google girişi, oturum belirteci uygulamada kendiliğinden saklanır) ya da yönetici erişim koduyla doğrulanır;
//  - hesaplar ve hesapla senkron: server/accounts.mjs; istek sınırı, kullanıcı başına günlük kota ve izin verilen köken (origin) denetimi vardır;
//  - yalnızca sabit yollar ve parametreler iletilir (açık vekil değildir).
// Bağımlılık yok (Node 18+). Çalıştırma ve kurulum: server/README.md
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { createAccounts } from './accounts.mjs';

const here = dirname(fileURLToPath(import.meta.url));

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
loadEnv(join(here, '.env'));

const env = process.env;
const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || '127.0.0.1';
const CODES = list(env.ACCESS_CODES);
const MAPBOX = env.MAPBOX_TOKEN || '';
const OCM = env.OCM_KEY || '';
const ORIGINS = new Set(list(env.ALLOW_ORIGINS || 'https://ozdemirumit.github.io,https://localhost,capacitor://localhost,http://localhost'));
const RATE = Number(env.RATE_PER_MIN || 120);
const TRUST_PROXY = env.TRUST_PROXY === '1'; // Cloudflare Tunnel arkasında: gerçek istemci adresi CF-Connecting-IP'den okunur
const MAPBOX_BASE = env.MAPBOX_BASE || 'https://api.mapbox.com'; // yalnızca denemeler için değiştirilir
const OCM_BASE = env.OCM_BASE || 'https://api.openchargemap.io';
const OVERPASS = list(env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter');
const GAP_MS = Number(env.OVERPASS_GAP_MS || 1500);

if (!CODES.length || CODES.some((c) => c.length < 16)) {
  console.error('ACCESS_CODES gerekli: virgülle ayrılmış, her biri en az 16 karakter (server/.env.example).');
  process.exit(1);
}

const sha = (s) => createHash('sha256').update(s).digest();
const CODE_HASHES = CODES.map(sha);
const authOk = (code) => {
  const h = sha(String(code || ''));
  let ok = false;
  for (const c of CODE_HASHES) if (timingSafeEqual(h, c)) ok = true; // hepsi karşılaştırılır (süre sabit)
  return ok;
};

// ---------- sınırlar ----------
const hits = new Map(); // ip → { min, n }
const fails = new Map(); // ip → { until, n }
function limited(ip) {
  const min = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.min !== min) { hits.set(ip, { min, n: 1 }); return false; }
  return ++h.n > RATE;
}
const blocked = (ip) => (fails.get(ip)?.until ?? 0) > Date.now();
function noteFail(ip) {
  const f = fails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 10) { f.until = Date.now() + 10 * 60e3; f.n = 0; } // 10 yanlış kod: 10 dk engel
  fails.set(ip, f);
}
setInterval(() => { const m = Math.floor(Date.now() / 60000); for (const [k, v] of hits) if (v.min < m - 1) hits.delete(k); for (const [k, v] of fails) if (v.until < Date.now() && !v.n) fails.delete(k); }, 60000).unref();

// ---------- önbellek ----------
const cache = new Map();
const MAX_ENTRIES = 600;
const MAX_ITEM = 6e6;
function cget(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (e.exp < Date.now()) { cache.delete(k); return null; }
  return e;
}
function cset(k, e, ttlMs) {
  if (e.body.length > MAX_ITEM) return;
  cache.set(k, { ...e, exp: Date.now() + ttlMs });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}
const inflight = new Map();
const once = (k, fn) => {
  if (inflight.has(k)) return inflight.get(k);
  const p = fn().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
};

// ---------- kullanıcı başına günlük kota (Mapbox faturasını ve ortak Overpass'i korur) ----------
const DAILY = { mapbox: Number(env.MAPBOX_DAILY_PER_USER || 400), ocm: Number(env.OCM_DAILY_PER_USER || 200), overpass: Number(env.OVERPASS_DAILY_PER_USER || 300) };
const usage = new Map();
const today = () => new Date().toISOString().slice(0, 10);
/** Hesaplı (yönetici olmayan) kullanıcının günlük hakkı bittiyse true. Eski erişim kodu ve yönetici sınırsızdır. */
function overQuota(id, kind) {
  if (!id || id.kind !== 'user' || id.admin) return false;
  const k = `${id.key}|${today()}|${kind}`;
  const n = (usage.get(k) || 0) + 1;
  usage.set(k, n);
  return n > DAILY[kind];
}
setInterval(() => { const d = today(); for (const k of usage.keys()) if (!k.includes(`|${d}|`)) usage.delete(k); }, 3600e3).unref();

async function readJson(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > max) return undefined; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return undefined; }
}

// ---------- yardımcılar ----------
const scrub = (s) => { let t = s; for (const secret of [MAPBOX, OCM]) if (secret) t = t.split(secret).join('***'); return t; };
function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers, 'Content-Length': buf.length });
  res.end(buf);
}
const json = (res, status, obj, headers) => send(res, status, obj, { 'Content-Type': 'application/json; charset=utf-8', ...headers });

async function upstream(url, { method = 'GET', body, headers, timeoutMs = 30000 } = {}) {
  const r = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = /json|text/.test(r.headers.get('content-type') || '') ? Buffer.from(scrub(buf.toString('utf8'))) : buf;
  return {
    status: r.status,
    type: r.headers.get('content-type') || 'application/json',
    body: text,
    pass: Object.fromEntries(['retry-after', 'x-rate-limit-reset', 'x-rate-limit-limit'].map((h) => [h, r.headers.get(h)]).filter(([, v]) => v)),
  };
}
const reply = (res, u, extra = {}) => send(res, u.status, u.body, { 'Content-Type': u.type, ...u.pass, ...extra });

// ---------- Mapbox ----------
const MB_PATHS = [
  [/^\/directions\/v5\/mapbox\/(driving|driving-traffic)\/[-0-9.,;]+$/, 0], // trafikli rota: önbelleğe alınmaz
  [/^\/search\/searchbox\/v1\/category\/[A-Za-z0-9_%-]{1,60}$/, 3600e3],
  [/^\/search\/searchbox\/v1\/list\/category$/, 24 * 3600e3],
];
async function mapbox(req, res, url, id) {
  if (!MAPBOX) return json(res, 501, { error: 'Sunucuda Mapbox anahtarı yok' });
  const path = url.pathname.slice('/mapbox'.length);
  const rule = MB_PATHS.find(([re]) => re.test(path));
  if (!rule || req.method !== 'GET') return json(res, 404, { error: 'yol yok' });
  if (url.search.length > 2000) return json(res, 414, { error: 'sorgu çok uzun' });
  const q = new URLSearchParams(url.search);
  q.delete('access_token');
  q.sort();
  const key = `mb:${path}?${q}`;
  const hit = rule[1] ? cget(key) : null;
  if (hit) return reply(res, hit, { 'X-Cache': 'hit' });
  if (overQuota(id, 'mapbox')) return json(res, 429, { error: 'günlük Mapbox hakkı doldu' }, { 'Retry-After': '3600' });
  const u = await once(key, () => {
    const real = new URLSearchParams(q);
    real.set('access_token', MAPBOX);
    return upstream(`${MAPBOX_BASE}${path}?${real}`);
  });
  if (rule[1] && u.status === 200) cset(key, u, rule[1]);
  reply(res, u, { 'X-Cache': 'miss' });
}

// ---------- OpenChargeMap ----------
const OCM_PARAMS = new Set(['output', 'compact', 'verbose', 'maxresults', 'distanceunit', 'distance', 'latitude', 'longitude', 'countrycode']);
async function ocm(req, res, url, id) {
  if (!OCM) return json(res, 501, { error: 'Sunucuda OpenChargeMap anahtarı yok' });
  if (url.pathname !== '/ocm/poi' || req.method !== 'GET') return json(res, 404, { error: 'yol yok' });
  const q = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    if (!OCM_PARAMS.has(k) || v.length > 40) continue;
    q.set(k, v);
  }
  if (Number(q.get('maxresults')) > 500) q.set('maxresults', '500');
  q.sort();
  const key = `ocm:${q}`;
  const hit = cget(key);
  if (hit) return reply(res, hit, { 'X-Cache': 'hit' });
  if (overQuota(id, 'ocm')) return json(res, 429, { error: 'günlük OpenChargeMap hakkı doldu' }, { 'Retry-After': '3600' });
  const u = await once(key, () => {
    const real = new URLSearchParams(q);
    real.set('key', OCM);
    return upstream(`${OCM_BASE}/v3/poi/?${real}`);
  });
  if (u.status === 200) cset(key, u, 6 * 3600e3);
  reply(res, u, { 'X-Cache': 'miss' });
}

// ---------- Overpass ----------
const OP_QUERY = /^\[out:json\]\[timeout:\d{1,3}\];nwr\["amenity"="charging_station"\]\(around:[0-9.,-]{1,4000}\);out tags center;$/;
let opChain = Promise.resolve();
let opLast = 0;
const opDead = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Overpass sunucularına sırayla ve aralıklı gider (adil kullanım): tüm kullanıcıların istekleri tek sıradan geçer. */
function overpassQueued(query) {
  const run = async () => {
    const wait = opLast + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    const now = Date.now();
    const alive = OVERPASS.filter((u) => (opDead.get(u) ?? 0) < now);
    let last = null;
    for (const url of alive.length ? alive : OVERPASS) {
      try {
        opLast = Date.now();
        const u = await upstream(url, { method: 'POST', body: new URLSearchParams({ data: query }), timeoutMs: 50000 });
        if (u.status === 200) return u;
        last = u;
        if (u.status === 429 || u.status === 406) await sleep(2500);
      } catch (err) {
        opDead.set(url, Date.now() + 10 * 60e3);
      }
    }
    return last || { status: 502, type: 'application/json', body: Buffer.from('{"error":"Overpass yanıt vermedi"}'), pass: {} };
  };
  const p = opChain.then(run, run);
  opChain = p.catch(() => {});
  return p;
}
async function overpass(req, res, url, id) {
  if (url.pathname !== '/overpass' || req.method !== 'POST') return json(res, 404, { error: 'yol yok' });
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 20000) return json(res, 413, { error: 'gövde çok büyük' }); chunks.push(c); }
  const query = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('data') || '';
  if (!OP_QUERY.test(query)) return json(res, 400, { error: 'desteklenmeyen sorgu' });
  const key = 'op:' + createHash('sha1').update(query).digest('hex');
  const hit = cget(key);
  if (hit) return reply(res, hit, { 'X-Cache': 'hit' });
  if (overQuota(id, 'overpass')) return json(res, 429, { error: 'günlük Overpass hakkı doldu' }, { 'Retry-After': '3600' });
  const u = await once(key, () => overpassQueued(query));
  if (u.status === 200) cset(key, u, 6 * 3600e3);
  reply(res, u, { 'X-Cache': 'miss' });
}

// ---------- sunucu ----------
const clientIp = (req) => {
  const raw = req.socket.remoteAddress || '?';
  if (TRUST_PROXY && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(raw)) return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || raw).split(',')[0].trim();
  return raw;
};

const store = openStore(env.DATA_DIR || join(here, 'data'));
const accounts = createAccounts({ env, store, send, json, readJson, caps: () => ({ mapbox: !!MAPBOX, ocm: !!OCM, overpass: true }) });

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const ip = clientIp(req);
  const url = new URL(req.url, 'http://x');
  const origin = req.headers.origin;
  let status = 0;
  const done = res.end.bind(res);
  res.end = (...a) => { status = res.statusCode; return done(...a); };
  res.on('close', () => console.log(`${new Date().toISOString()} ${ip} ${req.method} ${url.pathname} ${status} ${Date.now() - t0}ms`));
  try {
    if (origin) {
      if (!ORIGINS.has(origin)) return json(res, 403, { error: 'köken izinli değil' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Rate-Limit-Reset, X-Cache');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-Access-Code, Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      return send(res, 204, '');
    }
    if (blocked(ip)) return json(res, 429, { error: 'çok fazla yanlış kod, sonra dene' }, { 'Retry-After': '600' });
    // kimlik gerektirmeyen yollar: giriş akışı, davet sayfası, yapılandırma
    const pp = url.pathname;
    if (pp === '/v1/config' || pp === '/v1/auth/poll' || pp.startsWith('/auth/') || pp.startsWith('/i/')) {
      if (limited(ip)) return json(res, 429, { error: 'istek sınırı' }, { 'Retry-After': '30' });
      if (await accounts.handlePublic(req, res, url, ip)) return;
    }
    const code = req.headers['x-access-code'];
    let id = null;
    if (code && authOk(code)) id = { kind: 'legacy', admin: true, key: 'c:' + ip };
    else { const u = accounts.userFromRequest(req); if (u) id = { kind: 'user', user: u, admin: !!u.admin, key: u.id }; }
    if (!id) { if (code || accounts.hasCredentials(req)) noteFail(ip); return json(res, 401, { error: 'giriş gerekli' }); }
    if (limited(id.key)) return json(res, 429, { error: 'istek sınırı' }, { 'Retry-After': '30' });
    const p = url.pathname;
    if (p === '/health') return json(res, 200, { ok: true, mapbox: !!MAPBOX, ocm: !!OCM, overpass: true, v: 2 });
    if (p.startsWith('/mapbox/')) return await mapbox(req, res, url, id);
    if (p.startsWith('/ocm/')) return await ocm(req, res, url, id);
    if (p === '/overpass') return await overpass(req, res, url, id);
    if (await accounts.handleAuthed(req, res, url, id)) return;
    return json(res, 404, { error: 'yol yok' });
  } catch (err) {
    console.error('hata:', scrub(String(err?.message || err)));
    if (!res.headersSent) json(res, err?.name === 'TimeoutError' ? 504 : 502, { error: err?.name === 'TimeoutError' ? 'üst sunucu zaman aşımı' : 'üst sunucuya ulaşılamadı' });
  }
});
server.requestTimeout = 120000;
server.headersTimeout = 15000;
server.listen(PORT, HOST, () => {
  console.log(`EV Co-Pilot ara sunucusu ${HOST}:${PORT} · Mapbox ${MAPBOX ? 'var' : 'yok'} · OpenChargeMap ${OCM ? 'var' : 'yok'} · Google girişi ${accounts.googleOn ? 'açık' : 'kapalı'} · ${CODES.length} yönetici kodu`);
});
