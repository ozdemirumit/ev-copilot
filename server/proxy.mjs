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
import { createCosts } from './costs.mjs';
import { createDevices } from './devices.mjs';
import { createMailer } from './mailer.mjs';
import { createAppFiles } from './appfiles.mjs';
import { lookupAll } from './occupancy.mjs';
import { hereBrowse, compact } from './here.mjs';
import { createPriceBook } from './prices.mjs';
import { createCommunity } from './community.mjs';
import { createStationInfo, MAX_PHOTO_BYTES } from './stationinfo.mjs';
import { createTesla } from './tesla.mjs';

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
const HERE = env.HERE_API_KEY || ''; // istasyon listesi ve canlı durum (HERE Search, show=ev); yalnızca sunucuda durur
const GOOGLE_PLACES = env.GOOGLE_PLACES_KEY || ''; // isteğe bağlı: istasyon doluluğu (NDW'nin kapsamadığı yerler); yalnızca sunucuda durur
const ORIGINS = new Set(list(env.ALLOW_ORIGINS || 'https://ozdemirumit.github.io,https://localhost,capacitor://localhost,http://localhost'));
if (env.PUBLIC_URL) ORIGINS.add(String(env.PUBLIC_URL).replace(/\/+$/, '')); // yönetim paneli (/yonetim) aynı kökenden POST/DELETE yapar
const RATE = Number(env.RATE_PER_MIN || 600); // adres/kullanıcı başına dakikada istek (uzun rotada istasyon araması yüzlerce Mapbox isteği atar)
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
  f.at = Date.now();
  if (f.n >= 10) { f.until = Date.now() + 10 * 60e3; f.n = 0; } // 10 yanlış kod: 10 dk engel
  fails.set(ip, f);
}
setInterval(() => { const m = Math.floor(Date.now() / 60000); for (const [k, v] of hits) if (v.min < m - 1) hits.delete(k); for (const [k, v] of fails) if (v.until < Date.now() && (!v.n || (v.at ?? 0) < Date.now() - 600e3)) fails.delete(k); }, 60000).unref();

// ---------- önbellek ----------
const cache = new Map();
const MAX_ENTRIES = 600;
const MAX_ITEM = 6e6;
function cget(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (e.exp < Date.now()) { cacheBytes -= e.body.length; cache.delete(k); return null; }
  return e;
}
const MAX_BYTES = 200e6; // önbelleğin toplam bayt tavanı (yüzlerce farklı sorgu belleği şişirmesin)
let cacheBytes = 0;
function cset(k, e, ttlMs) {
  if (e.body.length > MAX_ITEM) return;
  const old = cache.get(k);
  if (old) cacheBytes -= old.body.length;
  cache.set(k, { ...e, exp: Date.now() + ttlMs });
  cacheBytes += e.body.length;
  while (cache.size > MAX_ENTRIES || cacheBytes > MAX_BYTES) { const first = cache.keys().next().value; cacheBytes -= cache.get(first).body.length; cache.delete(first); }
}
const inflight = new Map();
const once = (k, fn) => {
  if (inflight.has(k)) return inflight.get(k);
  const p = fn().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
};

// ---------- kullanıcı başına günlük kota (Mapbox faturasını ve ortak Overpass'i korur) ----------
const DAILY = { mapbox: Number(env.MAPBOX_DAILY_PER_USER || 400), ocm: Number(env.OCM_DAILY_PER_USER || 200), overpass: Number(env.OVERPASS_DAILY_PER_USER || 300), occupancy: Number(env.OCCUPANCY_DAILY_PER_USER || 600), google: Number(env.GOOGLE_DAILY_PER_USER || 40), here: Number(env.HERE_DAILY_PER_USER || 800), price: 20, presence: 60, status: 30, sinfo: 600, srate: 60, sfac: 120, sphoto: 15 };
const GOOGLE_TOTAL = Number(env.GOOGLE_DAILY_TOTAL || 150); // tüm kullanıcılar için günlük Google çağrısı tavanı (fatura üst sınırı)
let gToday = { d: '', n: 0 };
function googleAllowed(id) {
  const d = new Date().toISOString().slice(0, 10);
  if (gToday.d !== d) gToday = { d, n: 0 };
  if (gToday.n >= GOOGLE_TOTAL || overQuota(id, 'google')) return false;
  gToday.n++;
  return true;
}
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
/** Yönetim paneli özeti: kullanıcı/davet sayıları, bugünkü çağrılar, Google kotası, Google maliyeti, sunucu durumu. Anahtar değerleri YOK, yalnızca tanımlı mı bilgisi. */
function adminSummary() {
  const now = Date.now();
  const users = Object.values(store.data.users);
  const byKind = {};
  for (const [k, n] of usage) { const [, d, kind] = k.split('|'); if (d === today()) byKind[kind] = (byKind[kind] || 0) + n; }
  const invites = Object.values(store.data.invites || {});
  const inv = { open: 0, used: 0, expired: 0, revoked: 0 };
  for (const i of invites) { if (i.revoked) inv.revoked++; else if (i.usedBy) inv.used++; else if (i.expiresAt < now) inv.expired++; else inv.open++; }
  const keys = costs.keys();
  const tot = { today: 0, month: 0, total: 0 };
  for (const k of keys) { const c = costs.summary(k).usd; for (const f of Object.keys(tot)) tot[f] += c[f]; }
  return {
    server: { uptimeSec: Math.round(process.uptime()), node: process.version, memMb: Math.round(process.memoryUsage().rss / 1048576), publicUrl: env.PUBLIC_URL || null },
    users: {
      total: users.length, premium: users.filter((u) => u.admin || u.premiumUntil > now).length, disabled: users.filter((u) => u.disabled).length,
      active7d: users.filter((u) => u.lastLogin > now - 7 * 86400e3).length, new7d: users.filter((u) => u.createdAt > now - 7 * 86400e3).length,
    },
    invites: inv,
    mapbox: { month: mbUsage().month, used: mbUsage().n, cap: MB_CAP },
    here: { month: hereUsage().month, used: hereUsage().n, cap: HERE_CAP },
    devices: devices.stats(),
    configured: { mapbox: !!MAPBOX, here: !!HERE, ocm: !!OCM, googlePlaces: !!GOOGLE_PLACES, googleLogin: !!accounts.googleOn, smtp: !!mailer, premiumRequired: String(env.PREMIUM_REQUIRED ?? '1') !== '0' },
    usageToday: byKind,
    google: { callsToday: gToday.d === today() ? gToday.n : 0, dailyCap: GOOGLE_TOTAL, unitUsd: costs.unit, usd: tot },
  };
}
setInterval(() => { const d = today(); for (const k of usage.keys()) if (!k.includes(`|${d}|`)) usage.delete(k); }, 3600e3).unref();

async function readJson(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > max) return undefined; chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return undefined; }
}

// ---------- yardımcılar ----------
const scrub = (s) => { let t = s; for (const secret of [MAPBOX, OCM, GOOGLE_PLACES, HERE]) if (secret) t = t.split(secret).join('***'); return t; };
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
// Mapbox aylık arama sınırı (ücretsiz katman ≈ 5000 istek): sunucu yalnızca önbellekte olmayan, Mapbox'a giden arama (/search/) isteklerini sayar ve sınırda 402 döner;
// uygulama o durumda istasyonları Overpass/OpenChargeMap'ten alır. Sayaç db.json'da kalıcıdır. MAPBOX_MONTH_USED_SEED="2026-11:4899" ayın başlangıç sayısını verir.
const MB_CAP = Number(env.MAPBOX_MONTHLY_CAP || 4800);
function mbUsage() {
  const ym = new Date().toISOString().slice(0, 7);
  const c = (store.data.counters ||= {});
  if (c.mapbox?.month !== ym) {
    const [sm, sn] = String(env.MAPBOX_MONTH_USED_SEED || '').split(':');
    c.mapbox = { month: ym, n: sm === ym ? Number(sn) || 0 : 0 };
    store.save();
  }
  return c.mapbox;
}
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
  const isSearch = path.startsWith('/search/');
  if (isSearch && mbUsage().n >= MB_CAP) return json(res, 402, { error: 'mapbox_cap' }); // aylık hak doldu: ücretli kullanıma geçmesin
  const u = await once(key, () => {
    const real = new URLSearchParams(q);
    real.set('access_token', MAPBOX);
    if (isSearch) { mbUsage().n++; store.save(); }
    return upstream(`${MAPBOX_BASE}${path}?${real}`);
  });
  if (rule[1] && u.status === 200) cset(key, u, rule[1]);
  reply(res, u, { 'X-Cache': 'miss' });
}

// ---------- HERE (istasyon listesi + doluluk) ----------
// HERE kullanımı aylık sayılır (HERE_MONTHLY_CAP, varsayılan 20000 istek); sınırda 402 döner, uygulama Mapbox/Overpass'e düşer. Sayaç db.json'da kalıcıdır.
const HERE_CAP = Number(env.HERE_MONTHLY_CAP || 20000);
function hereUsage() {
  const ym = new Date().toISOString().slice(0, 7);
  const c = (store.data.counters ||= {});
  if (c.here?.month !== ym) { c.here = { month: ym, n: 0 }; store.save(); }
  return c.here;
}
const hereAllowed = () => hereUsage().n < HERE_CAP;
const hereCount = () => { hereUsage().n++; store.save(); };
async function hereStations(req, res, url, id) {
  if (!HERE) return json(res, 501, { error: 'Sunucuda HERE anahtarı yok' });
  if (url.pathname !== '/here/stations' || req.method !== 'GET') return json(res, 404, { error: 'yol yok' });
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const r = Math.min(40, Math.max(1, Number(url.searchParams.get('r')) || 20));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json(res, 400, { error: 'geçersiz konum' });
  const key = `here:${lat.toFixed(3)},${lon.toFixed(3)}:${r}`;
  const hit = cget(key);
  if (hit) return reply(res, hit, { 'X-Cache': 'hit' });
  if (overQuota(id, 'here')) return json(res, 429, { error: 'günlük HERE hakkı doldu' }, { 'Retry-After': '3600' });
  if (!hereAllowed()) return json(res, 402, { error: 'here_cap' });
  const u = await once(key, async () => {
    hereCount();
    const items = await hereBrowse(HERE, { lat, lon, r: r * 1000 });
    const body = Buffer.from(JSON.stringify({ items: items.map(compact).filter(Boolean), full: items.length >= 100 }));
    return { status: 200, type: 'application/json; charset=utf-8', body, pass: {} };
  }).catch((err) => ({ status: err.status === 429 ? 429 : 502, type: 'application/json', body: Buffer.from(JSON.stringify({ error: err.status ? 'HERE HTTP ' + err.status : 'HERE yanıt vermedi' })), pass: {} }));
  if (u.status === 200) cset(key, u, 6 * 3600e3);
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
const OP_QUERY = /^\[out:json\]\[timeout:\d{1,3}\];nwr\["(?:amenity"="charging_station|highway"="speed_camera)"\]\(around:[0-9.,-]{1,12000}\);out tags center;$/; // şarj istasyonu ve hız kamerası sorguları
const opDead = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Overpass: her ayna için bir "şerit" (aynı anda en çok bir istek, istekler arası GAP_MS). İstekler ortak sıraya girer, boş şerit sıradakini alır:
// aynalar paralel çalışır (3 ayna ≈ 3 kat hızlı), tek aynaya adil kullanım sınırı aşılmaz. Şeridin aynası yanıt vermezse diğerleri denenir.
const opLanes = OVERPASS.map((url) => ({ url, last: 0, busy: false }));
const opQueue = [];
function overpassQueued(query) {
  return new Promise((resolve) => { opQueue.push({ query, resolve }); opPump(); });
}
function opPump() {
  for (const lane of opLanes) {
    if (lane.busy || !opQueue.length) continue;
    if ((opDead.get(lane.url) ?? 0) > Date.now() && opLanes.some((l) => (opDead.get(l.url) ?? 0) <= Date.now())) continue; // ölü ayna şeridi, canlı varken iş almaz
    const job = opQueue.shift();
    lane.busy = true;
    opRun(lane, job).catch((err) => job.resolve({ status: 502, type: 'application/json', body: Buffer.from('{"error":"Overpass yanıt vermedi"}'), pass: {}, err })).finally(() => { lane.busy = false; opPump(); });
  }
}
async function opRun(lane, { query, resolve }) {
  const wait = lane.last + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  const now = Date.now();
  const alive = OVERPASS.filter((u) => (opDead.get(u) ?? 0) < now);
  const order = [lane.url, ...(alive.length ? alive : OVERPASS).filter((u) => u !== lane.url)];
  let last = null;
  for (const url of order) {
    try {
      lane.last = Date.now();
      const u = await upstream(url, { method: 'POST', body: new URLSearchParams({ data: query }), timeoutMs: 50000 });
      if (u.status === 200) return resolve(u);
      last = u;
      if (u.status === 429 || u.status === 406) await sleep(2500);
    } catch (err) {
      opDead.set(url, Date.now() + 10 * 60e3);
    }
  }
  resolve(last || { status: 502, type: 'application/json', body: Buffer.from('{"error":"Overpass yanıt vermedi"}'), pass: {} });
}
async function overpass(req, res, url, id) {
  if (url.pathname !== '/overpass' || req.method !== 'POST') return json(res, 404, { error: 'yol yok' });
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 40000) return json(res, 413, { error: 'gövde çok büyük' }); chunks.push(c); }
  const query = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('data') || '';
  if (!OP_QUERY.test(query) || Number(/around:([0-9.]+),/.exec(query)?.[1]) > 20000) return json(res, 400, { error: 'desteklenmeyen sorgu' }); // yarıçap üst sınırı 20 km
  const key = 'op:' + createHash('sha1').update(query).digest('hex');
  const hit = cget(key);
  if (hit) return reply(res, hit, { 'X-Cache': 'hit' });
  if (overQuota(id, 'overpass')) return json(res, 429, { error: 'günlük Overpass hakkı doldu' }, { 'Retry-After': '3600' });
  const u = await once(key, () => overpassQueued(query));
  if (u.status === 200) cset(key, u, 6 * 3600e3);
  reply(res, u, { 'X-Cache': 'miss' });
}

// ---------- Doluluk ve canlı fiyat ----------
async function occupancyRoute(req, res, id) {
  if (id.kind === 'user' && !accounts.isPremium(id.user)) return json(res, 402, { error: 'premium_required' }); // canlı doluluk ve fiyat yalnızca Premium üyelere
  const b = await readJson(req, 4000);
  if (!b || !Array.isArray(b.stations) || b.stations.length < 1 || b.stations.length > 6) return json(res, 400, { error: 'geçersiz gövde' });
  const stations = b.stations.filter((s) => s && typeof s === 'object').map((s) => ({ id: String(s.id).slice(0, 40), lat: Number(s.lat), lon: Number(s.lon), dc: !!s.dc }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180);
  if (!stations.length) return json(res, 400, { error: 'geçersiz istasyon' });
  if (overQuota(id, 'occupancy')) return json(res, 429, { error: 'günlük doluluk hakkı doldu' }, { 'Retry-After': '3600' });
  const google = GOOGLE_PLACES ? { key: GOOGLE_PLACES, allow: () => googleAllowed(id), onCall: () => costs.add(id, 'google') } : null; // her başarılı Google çağrısı kullanıcıya yazılır
  const here = HERE ? { key: HERE, allow: hereAllowed, onCall: hereCount } : null;
  const soc = Number.isFinite(Number(b.soc)) ? Number(b.soc) : null; // pil %: Google (ücretli) yalnızca düşük pilde sorulur
  json(res, 200, { results: await lookupAll(stations, { google, here, soc, book: priceBook, community }) });
}

// Topluluk: şarj başladı/bitti (varlık) ve Dolu/Boş bildirimi. Okumak Premium (/v1/occupancy), katkı vermek her hesaba açık.
async function communityRoute(req, res, id, kind) {
  if (id.kind !== 'user') return json(res, 403, { error: 'hesap gerekli' });
  if (overQuota(id, kind)) return json(res, 429, { error: 'günlük bildirim hakkı doldu' }, { 'Retry-After': '3600' });
  const b = await readJson(req, 1000);
  const r = b ? (kind === 'presence' ? community.presence(id.user.id, b) : community.report(id.user.id, b)) : { error: 'geçersiz gövde' };
  json(res, r.ok ? 200 : r.error === 'çok sık' ? 429 : 400, r);
}

// İstasyon bilgisi: puan (1-5), olanaklar (AVM, tuvalet…) ve fotoğraflar. Okumak her kimlikle; yazmak hesap ister.
async function readBytes(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > max) return undefined; chunks.push(c); }
  return Buffer.concat(chunks);
}
async function stationInfoRoute(req, res, id, url) {
  const p = url.pathname;
  const uid = id.kind === 'user' ? id.user.id : null;
  const need = (kind) => { // true: yanıt verildi (hesap yok ya da günlük hak doldu)
    if (id.kind !== 'user') json(res, 403, { error: 'hesap gerekli' });
    else if (overQuota(id, kind)) json(res, 429, { error: 'günlük hak doldu' }, { 'Retry-After': '3600' });
    else return false;
    return true;
  };
  const answer = (r) => json(res, r.ok ? 200 : r.error === 'yetkisiz' ? 403 : r.error === 'yok' ? 404 : 400, r);
  if (p.startsWith('/v1/station/photo/') && (req.method === 'GET' || req.method === 'DELETE')) {
    const pid = p.slice('/v1/station/photo/'.length);
    if (req.method === 'DELETE') { if (need('sfac')) return; return answer(stationInfo.deletePhoto(uid, pid, id.admin)); }
    const buf = stationInfo.readPhoto(pid);
    if (!buf) return json(res, 404, { error: 'yok' });
    return send(res, 200, buf, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' }); // yalnızca kimlikli istek ulaşır; içerik değişmez
  }
  if (p === '/v1/station/photo' && req.method === 'POST') {
    if (need('sphoto')) return;
    const buf = await readBytes(req, MAX_PHOTO_BYTES);
    return answer(buf ? stationInfo.addPhoto(uid, { lat: url.searchParams.get('lat'), lon: url.searchParams.get('lon') }, buf) : { error: 'fotoğraf çok büyük' });
  }
  if (req.method !== 'POST') return json(res, 404, { error: 'yol yok' });
  const b = await readJson(req, 1000);
  if (!b) return json(res, 400, { error: 'geçersiz gövde' });
  if (p === '/v1/station/info') {
    if (overQuota(id, 'sinfo')) return json(res, 429, { error: 'günlük hak doldu' }, { 'Retry-After': '3600' });
    const pos = { lat: Number(b.lat), lon: Number(b.lon) };
    if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lon) || Math.abs(pos.lat) > 90 || Math.abs(pos.lon) > 180) return json(res, 400, { error: 'geçersiz konum' });
    return json(res, 200, stationInfo.summary(pos, uid));
  }
  if (p === '/v1/station/rate') { if (need('srate')) return; return answer(stationInfo.rate(uid, b)); }
  if (p === '/v1/station/facility') { if (need('sfac')) return; return answer(stationInfo.facility(uid, b)); }
  return json(res, 404, { error: 'yol yok' });
}

// Kullanıcı fiyat bildirimi: şarj sonrası ödenen tutar / kWh (kendi fiyat defterimiz)
async function priceRoute(req, res, id) {
  if (id.kind !== 'user') return json(res, 403, { error: 'hesap gerekli' });
  if (overQuota(id, 'price')) return json(res, 429, { error: 'günlük bildirim hakkı doldu' }, { 'Retry-After': '3600' });
  const b = await readJson(req, 1000);
  const r = b ? priceBook.report(id.user.id, { lat: Number(b.lat), lon: Number(b.lon), kwh: Number(b.kwh), currency: b.currency }) : { error: 'geçersiz gövde' };
  json(res, r.ok ? 200 : 400, r);
}

// ---------- sunucu ----------
const clientIp = (req) => {
  const raw = req.socket.remoteAddress || '?';
  if (TRUST_PROXY && /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(raw)) return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || raw).split(',')[0].trim();
  return raw;
};

process.on('unhandledRejection', (err) => console.error('yakalanmamış söz reddi:', scrub(String(err?.message || err)))); // tek bir hatalı istek süreci düşürmesin
const store = openStore(env.DATA_DIR || join(here, 'data'));
const priceBook = createPriceBook(store);
const community = createCommunity(store);
const stationInfo = createStationInfo(store, join(env.DATA_DIR || join(here, 'data'), 'photos'));
const tesla = createTesla(env.DATA_DIR || join(here, 'data'));
const costs = createCosts(store, env);
const devices = createDevices(store);
const mailer = createMailer(env); // SMTP_USER/SMTP_PASS yoksa null
const accounts = createAccounts({ onDelete: (uid) => { priceBook.forget(uid); community.forget(uid); stationInfo.forget(uid); costs.forget(uid); devices.forget(uid); }, onLink: (deviceId, uid, ip) => devices.link(deviceId, uid, ip), devicesOf: (uid) => devices.forUser(uid), costs, mailer, env, store, send, json, readJson, caps: () => ({ mapbox: !!MAPBOX, here: !!HERE, ocm: !!OCM, overpass: true, occupancy: true }) });

const appFiles = createAppFiles({ dir: join(here, 'public'), send });

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const ip = clientIp(req);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400); return res.end(); } // geçersiz adres ("//" gibi) süreci düşürmesin
  const origin = req.headers.origin;
  let status = 0;
  const done = res.end.bind(res);
  res.end = (...a) => { status = res.statusCode; return done(...a); };
  res.on('close', () => console.log(`${new Date().toISOString()} ${ip} ${req.method} ${url.pathname.replace(/^\/i\/.*/, '/i/…')} ${status} ${Date.now() - t0}ms`)); // davet kodu günlüğe yazılmaz
  try {
    if (origin) {
      if (!ORIGINS.has(origin)) return json(res, 403, { error: 'köken izinli değil' });
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Rate-Limit-Reset, X-Cache');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'X-Access-Code, Authorization, Content-Type, X-Device-Id');
      res.setHeader('Access-Control-Max-Age', '600');
      return send(res, 204, '');
    }
    if (blocked(ip)) return json(res, 429, { error: 'çok fazla yanlış kod, sonra dene' }, { 'Retry-After': '600' });
    // kimlik gerektirmeyen yollar: giriş akışı, davet sayfası, yapılandırma
    const pp = url.pathname;
    if (pp === '/app' || pp.startsWith('/app/')) { // Android kurulum sayfası ve APK (herkese açık)
      if (limited(ip)) return json(res, 429, { error: 'istek sınırı' }, { 'Retry-After': '30' });
      if (appFiles.handle(req, res, url, ip)) return;
    }
    if (pp === '/yonetim' || pp === '/yonetim/') { // yönetim paneli: statik sayfa (gizli bilgi yok); veriler /admin/* ile yönetici kodu ya da yönetici hesabıyla gelir
      if (limited(ip)) return json(res, 429, { error: 'istek sınırı' }, { 'Retry-After': '30' });
      let html;
      try { html = readFileSync(join(here, 'admin.html'), 'utf8'); } catch { return json(res, 404, { error: 'panel dosyası yok' }); }
      return send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
    }
    const dev = devices.valid(req.headers['x-device-id']);
    if (pp === '/v1/config' || pp === '/v1/auth/poll' || pp.startsWith('/auth/') || pp.startsWith('/i/')) {
      if (limited(ip) || (dev && limited('d:' + dev))) return json(res, 429, { error: 'istek sınırı' }, { 'Retry-After': '30' });
      if (pp === '/v1/config') devices.touch(dev, ip, { app: url.searchParams.get('v'), platform: url.searchParams.get('p') }); // uygulama açılışı: anonim cihaz sayımı
      if (await accounts.handlePublic(req, res, url, ip)) return;
    }
    const code = req.headers['x-access-code'];
    let id = null;
    if (code && authOk(code)) id = { kind: 'legacy', admin: true, key: 'c:' + ip };
    else { const u = accounts.userFromRequest(req); if (u) id = { kind: 'user', user: u, admin: !!u.admin, key: u.id }; }
    if (!id) { if (code || accounts.hasCredentials(req)) noteFail(ip); return json(res, 401, { error: 'giriş gerekli' }); }
    if (limited(id.key) || (dev && id.kind !== 'user' && limited('d:' + dev))) return json(res, 429, { error: 'istek sınırı' }, { 'Retry-After': '30' });
    if (dev && id.kind === 'user') devices.link(dev, id.user.id, ip); // oturumlu istek: cihaz hesaba bağlanır (giriş öncesi anonim kayıt birleşir)
    const p = url.pathname;
    if (p === '/health') return json(res, 200, { ok: true, mapbox: !!MAPBOX, here: !!HERE, ocm: !!OCM, overpass: true, occupancy: true, v: 3 });
    if (p.startsWith('/mapbox/')) return await mapbox(req, res, url, id);
    if (p.startsWith('/here/')) return await hereStations(req, res, url, id);
    if (p.startsWith('/ocm/')) return await ocm(req, res, url, id);
    if (p === '/overpass') return await overpass(req, res, url, id);
    if (p === '/v1/occupancy' && req.method === 'POST') return await occupancyRoute(req, res, id);
    if (p === '/v1/price' && req.method === 'POST') return await priceRoute(req, res, id);
    if (p === '/v1/presence' && req.method === 'POST') return await communityRoute(req, res, id, 'presence');
    if (p === '/v1/status' && req.method === 'POST') return await communityRoute(req, res, id, 'status');
    if (p.startsWith('/v1/station/')) return await stationInfoRoute(req, res, id, url);
    if (p === '/v1/tesla' && req.method === 'GET') { // Togg'un kullanabildiği Tesla Supercharger'lar (günlük önbellek)
      const l = await tesla.get();
      return l ? json(res, 200, l, { 'Cache-Control': 'private, max-age=3600' }) : json(res, 503, { error: 'Tesla listesi şu an alınamıyor' });
    }
    if (p === '/admin/summary' && req.method === 'GET' && id.admin) return json(res, 200, adminSummary());
    if (p === '/admin/devices' && req.method === 'GET' && id.admin) return json(res, 200, { stats: devices.stats(), devices: devices.list((u) => store.data.users[u]?.email || u) });
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
  console.log(`EV Co-Pilot ara sunucusu ${HOST}:${PORT} · Mapbox ${MAPBOX ? 'var' : 'yok'} · OpenChargeMap ${OCM ? 'var' : 'yok'} · HERE ${HERE ? 'var' : 'yok'} · Google girişi ${accounts.googleOn ? 'açık' : 'kapalı'} · doluluk: NDW${HERE ? ' + HERE' : ''}${GOOGLE_PLACES ? ' + Google' : ''} · ${CODES.length} yönetici kodu`);
});
