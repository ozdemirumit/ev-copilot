// Premium yol hız limiti kesimleri: navigasyon başlarken planlanan rota için bir kez alınır, sürüşte ağ isteği olmadan konuma göre okunur.
// Kaynak sırası (konum başına): 1) HERE (sunucu /v1/speedlimits), 2) rota Mapbox'tan geldiyse Mapbox maxspeed ek açıklaması,
// 3) OpenStreetMap (nav/speedLimit.js'teki bugünkü tek nokta sorgusu), 4) bilinmiyor (null: kullanıcının eşiği; tahmin YAPILMAZ).
// Ücretsiz kullanıcıda bu modül hiçbir şey yüklemez ve istek atmaz (yalnızca OSM).
// Kesim biçimi: [lat1, lon1, lat2, lon2, kph] (rota yönünde). Uzun rotada binlerce kesim olur: arama son eşleşmenin çevresinde başlar.
import { proxyFetch, proxyHas, premiumAccess } from '../net/proxy.js';
import { buildTrack, pointAtKm } from './track.js';

const NEAR_M = 40; // konum kesime en çok bu kadar uzaksa o kesim sayılır
const HEADING_DEG = 70; // gidiş yönüyle kesim yönü arasındaki en büyük fark
const BLOCK_MS = 3600e3; // 401/402/403/429/501 sonrası bu süre yeni rota için de sorulmaz (döngü yok)
const WIN_BACK = 40;
const WIN_AHEAD = 400;

export const validKph = (k) => Number.isInteger(k) && k >= 5 && k <= 150;
/** HERE maxSpeed (m/s) → km/s; geçersizse null. */
export function kphFromMs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const k = Math.round(ms * 3.6);
  return validKph(k) ? k : null;
}
/** Mapbox maxspeed { speed, unit: 'km/h' | 'mph' } → km/s; { unknown: true } / { none: true } / birimsiz → null. */
export function kphFromMapbox(m) {
  if (!m || typeof m !== 'object' || m.unknown || m.none) return null;
  const s = m.speed;
  if (typeof s !== 'number' || !Number.isFinite(s)) return null;
  const k = m.unit === 'km/h' ? Math.round(s) : m.unit === 'mph' ? Math.round(s * 1.609344) : null;
  return validKph(k) ? k : null;
}

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const TOL_M = 10;
const MAX_RUN = 64; // sınırlı geri bakış: maliyet O(n·64), uzun rotada O(n²) yok
/** Nokta p → [a, b] doğru parçası uzaklığı (m), yerel düzlem. Noktalar [lat, lon]. */
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

/** Köşeler [[lat, lon]] + kesim limitleri (kph[i]: pts[i] → pts[i+1], bilinmiyorsa null) → kesim listesi; bitişik eşit limitler yol şekli korunarak birleşir. */
export function mergeSegments(pts, kph) {
  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    const k = kph[i];
    if (k == null) { i++; continue; }
    let j = i + 1;
    while (j < pts.length - 1 && kph[j] === k && j - i < MAX_RUN) {
      let fits = true;
      for (let m = i + 1; m <= j; m++) if (offM(pts[m], pts[i], pts[j + 1]) > TOL_M) { fits = false; break; }
      if (!fits) break;
      j++;
    }
    out.push([r5(pts[i][0]), r5(pts[i][1]), r5(pts[j][0]), r5(pts[j][1]), k]);
    i = j;
  }
  return out;
}

/** Rota koordinatları [[lon, lat]] → en çok max nokta {lat, lon} (ilk = başlangıç, son = varış, mesafeye göre eşit aralık). */
export function sampleRoute(coords, max = 60) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const n = Math.max(2, Math.min(max, coords.length));
  const tr = buildTrack(coords);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? { lat: coords[0][1], lon: coords[0][0] } : i === n - 1 ? { lat: coords.at(-1)[1], lon: coords.at(-1)[0] } : pointAtKm(tr, (tr.totalKm * i) / (n - 1));
    const q = { lat: r5(p.lat), lon: r5(p.lon) };
    const last = out.at(-1);
    if (!last || last.lat !== q.lat || last.lon !== q.lon) out.push(q);
  }
  if (out.length < 2) return [];
  return out;
}

/** Kesim listesini aramaya hazırla: geçersizleri at, yönleri hesapla. Boşsa null. */
function prepare(list) {
  if (!Array.isArray(list)) return null;
  const segs = [];
  for (const s of list) {
    if (!Array.isArray(s) || s.length < 5) continue;
    const [a, b, c, d, k] = s;
    if (![a, b, c, d].every((x) => typeof x === 'number' && Number.isFinite(x)) || Math.abs(a) > 90 || Math.abs(c) > 90 || Math.abs(b) > 180 || Math.abs(d) > 180 || !validKph(k)) continue;
    const kx = Math.cos((a * Math.PI) / 180);
    const brg = ((Math.atan2((d - b) * kx, c - a) * 180) / Math.PI + 360) % 360; // yerel düzlemde yön (kısa kesimde yeterli)
    segs.push({ a, b, c, d, k, brg });
  }
  return segs.length ? { segs, last: 0 } : null;
}

const angDiff = (x, y) => Math.abs(((x - y + 540) % 360) - 180);

/** Bir kaynağın kesimlerinde konuma en uygun kesim: 40 m içinde, yön biliniyorsa yönle uyumlu olanların en yakını. Yoksa null. */
function lookup(src, lat, lon, heading) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  const useH = typeof heading === 'number' && Number.isFinite(heading);
  const scan = (from, to) => {
    let best = -1;
    let bd = Infinity;
    for (let i = from; i <= to; i++) {
      const s = src.segs[i];
      const ax = (s.b - lon) * kx;
      const ay = (s.a - lat) * ky;
      const dx = (s.d - s.b) * kx;
      const dy = (s.c - s.a) * ky;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0;
      const dist = Math.hypot(ax + dx * t, ay + dy * t);
      if (dist > NEAR_M || dist >= bd) continue;
      if (useH && angDiff(s.brg, heading) > HEADING_DEG) continue; // karşı yön / kesişen yol: bu kesimin limiti bizim için değil
      best = i;
      bd = dist;
    }
    return best;
  };
  const n = src.segs.length;
  let i = scan(Math.max(0, src.last - WIN_BACK), Math.min(n - 1, src.last + WIN_AHEAD));
  if (i < 0) i = scan(0, n - 1); // pencerede yok: tüm rota (sıçrama, yeniden başlatma)
  if (i < 0) return null;
  src.last = i;
  return src.segs[i].k;
}

/**
 * Bağımlılıkları verilebilen örnek (denemeler için). post(body) → Response; premium() → Premium mu; hasHere() → sunucuda HERE var mı.
 */
export function createLimitSpans({
  post = (body) => proxyFetch('/v1/speedlimits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(20000) }),
  premium = premiumAccess,
  hasHere = () => proxyHas('here'),
} = {}) {
  let cur = null; // { route, here, mapbox, failed }
  let pending = null;
  let blockedUntil = 0;

  function clear({ unblock = false } = {}) {
    cur = null;
    pending = null;
    if (unblock) blockedUntil = 0;
  }

  /** Rota için kesimleri kur: Mapbox kesimleri rotada hazırdır; fetchHere ise HERE bir kez sorulur (hata olursa sessizce sonraki kaynağa). */
  function loadForRoute(route, { fetchHere = false } = {}) {
    const me = { route, here: null, mapbox: prepare(route?.limitSpans), failed: Date.now() < blockedUntil }; // engelliyken de "HERE alınamadı" notu kalır
    cur = me;
    if (!fetchHere) { pending = null; return Promise.resolve(); }
    const p = (async () => {
      try {
        const res = await post(JSON.stringify({ points: sampleRoute(route.coords) }));
        if (!res?.ok) {
          if ([401, 402, 403, 429, 501].includes(res?.status)) blockedUntil = Date.now() + BLOCK_MS; // hak/plan/anahtar sorunu: bir süre hiç sorma
          me.failed = true;
          return;
        }
        const j = await res.json();
        me.here = prepare(j?.v === 1 ? j.s : null);
      } catch {
        me.failed = true; // ağ/zaman aşımı: aynı rota için tekrar sorulmaz; yeni rota (yeniden rota) bir kez daha dener
      } finally {
        if (pending === p) pending = null;
      }
    })();
    pending = p;
    return p;
  }

  /** Her denetimde çağrılır: navigasyon + limit açık + Premium iken rota değiştiyse kesimleri yükle. Yükleme başladıysa sözünü döner. */
  function ensure({ active, limitOn, route }) {
    if (!active || !limitOn || !route?.coords?.length) return null;
    if (!premium()) { if (cur) clear(); return null; }
    if (cur && cur.route === route) return pending;
    return loadForRoute(route, { fetchHere: hasHere() && Date.now() >= blockedUntil });
  }

  /** Konumdaki limit: { kph, src: 'here' | 'mapbox' } ya da null (bu kaynaklar bilmiyor; çağıran OSM'e düşer). */
  function limitAt(lat, lon, heading = null) {
    if (!cur || typeof lat !== 'number' || typeof lon !== 'number') return null;
    for (const src of ['here', 'mapbox']) {
      if (!cur[src]) continue;
      const k = lookup(cur[src], lat, lon, heading);
      if (k != null) return { kph: k, src };
    }
    return null;
  }

  return {
    loadForRoute, ensure, limitAt, clear,
    loading: () => !!pending,
    idle: () => pending || Promise.resolve(),
    /** Durum: here/mapbox kesim kümesi var mı (1/0), HERE alınamadı mı. */
    status: () => ({ here: cur?.here ? 1 : 0, mapbox: cur?.mapbox ? 1 : 0, failed: !!cur?.failed, active: !!cur }),
  };
}

/** Uygulamanın kullandığı örnek. */
export const limitSpans = createLimitSpans();
