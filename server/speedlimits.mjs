// Premium yol hız limiti: HERE Routing v8 (spans=maxSpeed) ile planlanan rota boyunca hız limiti kesimleri. Yalnızca sunucuda çalışır (HERE_API_KEY).
// İstemci rotanın örneklenmiş noktalarını (2..60) yollar; ilk = başlangıç, son = varış, aradakiler HERE'ye "via=lat,lon!passThrough=true" olarak gider
// (HERE'nin yolu uygulamanın rotasını izlesin; ara noktada durak/manevra oluşmaz). Yanıt kısa biçimdedir: { v: 1, s: [[lat1, lon1, lat2, lon2, kph], ...] }.
// Limitsiz (HERE bilmiyor) kesim yazılmaz; uygulama orada Mapbox'a, sonra OpenStreetMap'e düşer, tahmin YAPILMAZ.
// Ölçüm (2026-11): tek istekte 100 via sorunsuz, 200 via'da adres çok uzun (HTTP 414); 60 nokta (58 via) tek isteğe sığar, bölmeye gerek yok.
import { createHash } from 'node:crypto';

const REAL_BASE = 'https://router.hereapi.com';
/**
 * HERE Routing adresi. HERE_ROUTER_BASE yalnızca denemeler içindir (çağrı anında okunur) ve yalnızca https ya da 127.0.0.1/localhost'a http kabul edilir;
 * başka her değer yok sayılır (anahtar yanlış yapılandırmayla düz http üzerinden dışarı gitmesin).
 */
export function routerBase() {
  const v = String(process.env.HERE_ROUTER_BASE || '').trim();
  if (!v) return REAL_BASE;
  let u;
  try { u = new URL(v); } catch { return REAL_BASE; }
  if (u.username || u.password) return REAL_BASE;
  const local = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  return u.protocol === 'https:' || local ? u.origin : REAL_BASE;
}
export const MAX_POINTS = 60;
export const MAX_ROUTE_KM = 2000; // örnek noktaların toplam büyük daire uzunluğu üst sınırı
export const MAX_GAP_KM = 300; // komşu iki nokta arası üst sınır (60 noktada 2000 km ≈ 34 km aralık; daha büyüğünü HERE uygulamanın yolunu izleyerek bağlayamaz)
export const MAX_REPLY_BYTES = 4e6; // HERE yanıtı bundan büyükse okunmaz (502)
export const MAX_CACHE_ITEM = 512 * 1024; // bundan büyük sonuç önbelleğe alınmaz
const rad = (d) => (d * Math.PI) / 180;
const gcKm = (a, b) => 12742 * Math.asin(Math.sqrt(Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2));
const TAB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const DEC = new Map([...TAB].map((c, i) => [c, i]));
const r5 = (x) => Math.round(x * 1e5) / 1e5;

/** HERE esnek çoklu çizgi (flexible polyline) → [[lat, lon], ...]. 3. boyut (rakım vb.) varsa atlanır. Bozuk dize hata fırlatır. */
export function decodeFlexPolyline(str) {
  const vals = [];
  let v = 0;
  let mul = 1;
  for (const ch of String(str)) {
    const d = DEC.get(ch);
    if (d === undefined) throw new Error('geçersiz çoklu çizgi karakteri');
    v += (d % 32) * mul; // 5 bitlik parçalar; bit işlemi yerine çarpma (32 biti aşan ara değerler bozulmasın)
    if (d & 32) { mul *= 32; continue; }
    vals.push(v);
    v = 0;
    mul = 1;
  }
  if (mul !== 1 || vals.length < 2) throw new Error('yarım çoklu çizgi');
  if (vals[0] !== 1) throw new Error('desteklenmeyen çoklu çizgi sürümü');
  const h = vals[1];
  const prec = h & 15;
  const third = (h >> 4) & 7;
  const dims = third ? 3 : 2;
  const body = vals.slice(2);
  if (body.length % dims) throw new Error('yarım çoklu çizgi');
  const m = 10 ** prec;
  const out = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < body.length; i += dims) {
    const z = (u) => (u % 2 ? -(u + 1) / 2 : u / 2);
    lat += z(body[i]);
    lon += z(body[i + 1]);
    out.push([lat / m, lon / m]);
  }
  return out;
}

export const validKph = (k) => Number.isInteger(k) && k >= 5 && k <= 150;
/** HERE maxSpeed (m/s) → km/s tam sayı; 5..150 dışı ya da sayı değilse null (10'un katı şartı yok: 82 gibi gerçek limitler var). */
export function kphFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const k = Math.round(ms * 3.6);
  return validKph(k) ? k : null;
}

/** İstek gövdesi → [[lat, lon], ...] (5 basamak) ya da geçersizse null. 2..60 nokta, sayı ve aralık denetimi; toplam ≤ 2000 km, komşu noktalar arası ≤ 300 km. */
export function parsePoints(b) {
  const pts = b && typeof b === 'object' ? b.points : null;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > MAX_POINTS) return null;
  const out = [];
  for (const p of pts) {
    if (!p || typeof p !== 'object' || typeof p.lat !== 'number' || typeof p.lon !== 'number') return null;
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null;
    out.push([r5(p.lat), r5(p.lon)]);
  }
  let total = 0;
  for (let i = 1; i < out.length; i++) {
    const d = gcKm(out[i - 1], out[i]);
    if (d > MAX_GAP_KM) return null;
    total += d;
  }
  if (total > MAX_ROUTE_KM) return null;
  return out;
}

/** Önbellek anahtarı: yuvarlanmış noktaların özeti. */
export const pointsKey = (pts) => 'sl:' + createHash('sha1').update(JSON.stringify(pts)).digest('hex');

const TOL_M = 10; // birleştirilen kiriş, aradaki köşelerden en çok bu kadar sapabilir (yol şekli korunur)
const MAX_RUN = 64; // bir kesimde en çok bu kadar köşe: her uzatmada en çok 64 köşe denetlenir, maliyet O(n·64) (binlerce kesimde O(n²) yok)
/** Nokta → [a, b] doğru parçası uzaklığı (m), yerel düzlem yaklaşımı. */
function offM(p, a, b) {
  const kx = 111320 * Math.cos((a[0] * Math.PI) / 180);
  const ky = 110574;
  const bx = (b[1] - a[1]) * kx;
  const by = (b[0] - a[0]) * ky;
  const px = (p[1] - a[1]) * kx;
  const py = (p[0] - a[0]) * ky;
  const l2 = bx * bx + by * by;
  const t = l2 ? Math.min(1, Math.max(0, (px * bx + py * by) / l2)) : 0;
  return Math.hypot(px - bx * t, py - by * t);
}

/**
 * Köşeler + kesim limitleri (kph[i]: pts[i] → pts[i+1], bilinmiyorsa null) → [[lat1, lon1, lat2, lon2, kph], ...].
 * Bitişik, aynı limitli kesimler, kiriş aradaki köşelerden 10 m'den fazla sapmadıkça tek kesimde birleşir.
 */
export function mergeSegments(pts, kph) {
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    const k = kph[i];
    if (k == null) { i++; continue; }
    let j = i + 1; // kesim pts[i] → pts[j]
    while (j < pts.length - 1 && kph[j] === k && j - i < MAX_RUN) {
      const a = pts[i];
      const b = pts[j + 1];
      let fits = true;
      for (let m = i + 1; m <= j; m++) if (offM(pts[m], a, b) > TOL_M) { fits = false; break; }
      if (!fits) break;
      j++;
    }
    out.push([r5(pts[i][0]), r5(pts[i][1]), r5(pts[j][0]), r5(pts[j][1]), k]);
    i = j;
  }
  return out;
}

/** HERE Routing v8 yanıtı → kısa kesim listesi. Bölümler (sections) art arda eklenir; bozuk yanıt boş liste verir. */
export function spansFromRoute(json) {
  const pts = [];
  const kph = [];
  for (const sec of json?.routes?.[0]?.sections || []) {
    let line;
    try { line = decodeFlexPolyline(sec.polyline); } catch { continue; }
    if (line.length < 2) continue;
    const spans = (Array.isArray(sec.spans) ? sec.spans : []).filter((s) => Number.isInteger(s?.offset)).sort((a, b) => a.offset - b.offset);
    const segK = new Array(line.length - 1).fill(null);
    spans.forEach((s, n) => {
      const end = n + 1 < spans.length ? spans[n + 1].offset : line.length - 1;
      const k = kphFromMs(s.maxSpeed);
      for (let x = Math.max(0, s.offset); x < Math.min(end, line.length - 1); x++) segK[x] = k;
    });
    const joined = pts.length && pts.at(-1)[0] === line[0][0] && pts.at(-1)[1] === line[0][1]; // bölüm sınırında ortak nokta tekrarlanmaz
    if (pts.length && !joined) kph.push(null); // bölümler arasında boşluk varsa onu limitsiz say
    pts.push(...(joined ? line.slice(1) : line));
    kph.push(...segK);
  }
  return mergeSegments(pts, kph);
}

/** HERE'den rota boyunca hız limitleri. Anahtar yalnızca isteğe eklenir; hata iletileri anahtarı ya da yanıt gövdesini içermez. */
export async function hereSpeedLimits(key, pts, { fetchImpl = fetch } = {}) {
  const u = new URL('/v8/routes', routerBase());
  const q = u.searchParams;
  const ll = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  q.set('transportMode', 'car');
  q.set('origin', ll(pts[0]));
  q.set('destination', ll(pts.at(-1)));
  for (const p of pts.slice(1, -1)) q.append('via', `${ll(p)}!passThrough=true`);
  q.set('return', 'polyline');
  q.set('spans', 'maxSpeed,length');
  q.set('apiKey', key);
  const res = await fetchImpl(u, { signal: AbortSignal.timeout(20000), redirect: 'error' });
  if (!res.ok) throw Object.assign(new Error('HERE HTTP ' + res.status), { status: res.status });
  return { v: 1, s: spansFromRoute(JSON.parse(await readCapped(res, MAX_REPLY_BYTES))) };
}

/** Yanıt gövdesini en çok max bayt oku: Content-Length büyükse hiç okunmaz, akış sınırı aşarsa kesilir (bellek şişmesin). */
async function readCapped(res, max) {
  const big = () => Object.assign(new Error('HERE yanıtı çok büyük'), { status: 'too_large' });
  const len = Number(res.headers.get('content-length'));
  if (Number.isFinite(len) && len > max) { try { await res.body?.cancel(); } catch { /* yoksay */ } throw big(); }
  if (!res.body?.getReader) { const t = await res.text(); if (Buffer.byteLength(t) > max) throw big(); return t; }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* yoksay */ } throw big(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
}

/** Bellek içi LRU: en çok max kayıt, ttl süresince, toplam en çok maxBytes (Buffer/dize uzunluğu); bütçeden büyük tek kayıt saklanmaz. */
export function createLru(max = 100, ttlMs = 24 * 3600e3, maxBytes = 32e6) {
  const m = new Map();
  let bytes = 0;
  const drop = (k) => { const e = m.get(k); if (e) { bytes -= e.n; m.delete(k); } };
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return null;
      m.delete(k);
      if (e.exp < Date.now()) { bytes -= e.n; return null; }
      m.set(k, e); // en son kullanılan sona
      return e.v;
    },
    set(k, v) {
      drop(k);
      const n = v?.length ?? 0;
      if (n > maxBytes) return;
      m.set(k, { v, n, exp: Date.now() + ttlMs });
      bytes += n;
      while (m.size > max || bytes > maxBytes) drop(m.keys().next().value);
    },
    get size() { return m.size; },
    get bytes() { return bytes; },
  };
}
