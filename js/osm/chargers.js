// Şarj istasyonları sırayla: HERE (sunucuda anahtar varsa) → Mapbox (anahtar varsa) → Overpass/OpenStreetMap (yedek ve boşluk doldurma);
// ek olarak Google Places (Premium, sunucuda anahtar varsa), OpenChargeMap (anahtar varsa) ve Tesla Supercharger; hepsi birleştirilip yinelenenler ayıklanır.
// Canlı yuva doluluğu BURADA YOKTUR (slots hep null; doluluk ayrı katman). Fiyat burada da operatör tablosundan gelir.
// Ortak işlevler (yinelenenleri ele, koridora izdüşür, fiyatla, kendi istasyonlarım) routing/chargerSource.js içindedir.
import { PLANNER } from '../config.js';
import { classify } from '../routing/operators.js';
import { haversineKm } from '../utils/geo.js';
import { load } from '../utils/storage.js';
import { proxyFetchRetry, proxyHas } from '../net/proxy.js';
import { cached, cacheGet, cacheSet, TTL } from '../utils/cache.js';
import { candidate, customRaw, dedupe, finalize, priced, summarize } from '../routing/chargerSource.js';
import { teslaAlong, teslaAround } from '../routing/tesla.js';
import { mapboxKey } from '../mapbox/api.js';
import { stationsAlong, stationsAround } from '../mapbox/chargers.js';
import { hereOn, stationsAlong as hereAlong, stationsAround as hereAround } from '../here/chargers.js';
import { googleOn, stationsAlong as googleAlong, stationsAround as googleAround } from '../google/chargers.js';

// Herkese açık Overpass sunucuları; biri 429/406/hata verirse sıradakine geçilir (adil kullanım: paralel sorgu yok).
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const SEG_KM = 60; // rota bu uzunlukta parçalara bölünüp her parça tek sorgu olur (parça başına önbelleğe alınır); küçük parça = kısa sorgu, paralel çalışır
const SEG_PARALLEL = 3; // aynı anda en çok bu kadar parça sorgusu (Overpass aynaları arasında dağılır)
const STEP_KM = 8; // sorguya verilen çizgi noktaları arası
const AROUND_M = 3000; // çizgiye uzaklık (koridor payı)
const DC_SOCKETS = ['type2_combo', 'type1_combo', 'chademo', 'ccs'];
const AC_SOCKETS = ['type2', 'type2_cable', 'type1', 'type3'];
const TESLA_SOCKETS = ['tesla_supercharger', 'tesla_destination', 'tesla_supercharger_ccs', 'nacs'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ocmKey = () => (proxyHas('ocm') ? 'proxy' : load('ocmKey', '')); // ara sunucuda anahtar varsa o kullanılır

/** "50 kW", "350 kW;90 kW", "22000", "7,4 kW" → en büyük kW (bilinmiyorsa null). Birimsiz ve >1000 ise watt sayılır. */
export function parseKw(v) {
  if (!v) return null;
  const nums = String(v).split(';').map((x) => {
    const m = /([\d.,]+)\s*(kw|w)?/i.exec(x.trim());
    if (!m) return null;
    let n = parseFloat(m[1].replace(',', '.'));
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'w' || (!unit && n > 1000)) n /= 1000;
    return n;
  }).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : null;
}

/** OSM öğesi (amenity=charging_station) → aday istasyon. Tesla/NACS'a özel, herkese açık olmayan ya da konumsuz kayıtlar elenir. */
export function fromOsm(el, drop = {}) {
  const no = (why) => { drop[why] = (drop[why] || 0) + 1; return null; };
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return no('konumsuz');
  if (/^(private|no|customers|permit)$/i.test(t.access || '')) return no('herkese açık değil');
  const name = t.name || t.brand || t.operator || t.network || 'Şarj istasyonu';
  if (/tesla/i.test([t.name, t.brand, t.operator, t.network].join(' '))) return no('Tesla');
  const has = (k) => { const v = t[`socket:${k}`]; return !!v && v !== 'no' && v !== '0'; };
  const out = (k) => parseKw(t[`socket:${k}:output`]);
  const hasDc = DC_SOCKETS.some(has);
  const anyAc = AC_SOCKETS.some(has);
  const anyInfo = hasDc || anyAc || TESLA_SOCKETS.some(has) || Object.keys(t).some((k) => k.startsWith('socket:'));
  if (anyInfo && !hasDc && !anyAc && TESLA_SOCKETS.some(has)) return no('Tesla/NACS');
  const maxOf = (keys) => Math.max(0, ...keys.filter(has).map((k) => out(k) ?? 0)) || null;
  return candidate({
    id: 'o' + (el.type || 'n')[0] + el.id, name, lat, lon, opId: classify(name, t.operator, t.brand, t.network), src: 'OSM',
    hasDc, dcKw: maxOf(DC_SOCKETS), acKw: maxOf(AC_SOCKETS), anyInfo, extraKw: parseKw(t['charging_station:output']),
  });
}

// OpenChargeMap bağlantı türü kimlikleri (compact yanıtta ad yok, kimlik var): CHAdeMO 2, CCS1 32, CCS2 33; Tesla 27, 30.
const OCM_DC = new Set([2, 32, 33]);
const OCM_TESLA = new Set([27, 30]);

/** OpenChargeMap kaydı → aday istasyon. Yanıt biçimi anahtarsız doğrulanamadığı için savunmacı okunur. */
export function fromOcm(p, drop = {}) {
  const no = (why) => { drop[why] = (drop[why] || 0) + 1; return null; };
  const a = p.AddressInfo || {};
  if (a.Latitude == null || a.Longitude == null) return no('konumsuz');
  if (p.StatusType?.IsOperational === false || [100, 150, 200, 210].includes(p.StatusTypeID)) return no('kapalı');
  if ([2, 6].includes(p.UsageTypeID) || p.UsageType?.IsPublicAccess === false) return no('herkese açık değil');
  const conns = p.Connections || [];
  const idOf = (c) => c.ConnectionTypeID ?? c.ConnectionType?.ID;
  const title = (c) => c.ConnectionType?.Title || '';
  const isDc = (c) => OCM_DC.has(idOf(c)) || /CCS|Combo|CHAdeMO/i.test(title(c));
  const isTesla = (c) => OCM_TESLA.has(idOf(c)) || /Tesla|NACS/i.test(title(c));
  if (conns.length && conns.every(isTesla)) return no('Tesla/NACS');
  const op = p.OperatorInfo?.Title || '';
  const name = a.Title || op || 'Şarj istasyonu';
  if (/tesla/i.test(`${name} ${op}`)) return no('Tesla');
  const kw = (list) => Math.max(0, ...list.map((c) => c.PowerKW || 0)) || null;
  const dc = conns.filter(isDc);
  return candidate({
    id: 'c' + p.ID, name, lat: a.Latitude, lon: a.Longitude, opId: classify(name, op), src: 'OCM',
    hasDc: dc.length > 0, dcKw: kw(dc), acKw: kw(conns.filter((c) => !isDc(c) && !isTesla(c))), anyInfo: conns.length > 0,
  });
}

const deadUntil = new Map(); // yanıt vermeyen sunucu 10 dk atlanır (her sorguda tekrar beklenmesin)
const DEAD_MS = 10 * 60e3;

/** Overpass sorgusu; sunucular sırayla denenir. Dönüş: öğe dizisi. Hepsi ulaşılamazsa `unreachable: true` işaretli hata fırlatır. */
export async function overpass(query, pref = 0) {
  if (proxyHas('overpass')) { // ara sunucu: ortak önbellek ve sıralı istek; ulaşılamazsa halka açık sunuculara düşülür
    try {
      const res = await proxyFetchRetry('/overpass', { method: 'POST', body: new URLSearchParams({ data: query }) }, { timeoutMs: 60000 }); // sunucu kısa süre kapalıysa yeniden dener, olmazsa doğrudan sunuculara düşer
      if (res.ok) {
        const j = await res.json();
        if (!(j.remark && /runtime error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length)) return j.elements || [];
      }
    } catch { /* sunucuya ulaşılamadı: doğrudan dene */ }
  }
  const now = Date.now();
  const alive0 = OVERPASS.filter((u) => (deadUntil.get(u) ?? 0) < now);
  const rot = alive0.length ? pref % alive0.length : 0;
  const alive = [...alive0.slice(rot), ...alive0.slice(0, rot)]; // paralel sorgular farklı aynadan başlar
  let lastErr = null;
  let reached = false;
  for (const url of alive.length ? alive : OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(45000) });
      reached = true;
      if (res.ok) {
        const j = await res.json();
        if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length) throw new Error('Overpass: ' + j.remark);
        return j.elements || [];
      }
      lastErr = new Error(res.status === 429 ? 'Overpass istek sınırı (429)' : `Overpass HTTP ${res.status}`);
      if (res.status === 429 || res.status === 406) await sleep(2500);
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'TypeError') deadUntil.set(url, Date.now() + DEAD_MS); // ağ hatası / zaman aşımı
      lastErr = err.name === 'TimeoutError' ? new Error('Overpass zaman aşımı') : err;
    }
  }
  throw Object.assign(lastErr || new Error('Overpass yanıt vermedi'), { unreachable: !reached });
}

const fmt = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;

/**
 * İstasyonsuz kesimler: rotaya ≤ NEAR_KM uzakta olan istasyonların rotadaki km'leri alınır; ardışık iki istasyon (başlangıç ve varış dahil)
 * arası GAP_FILL_KM'den uzunsa o aralık bir "boşluk"tur. Dönüş: [{ from, to }] (km).
 */
const GAP_FILL_KM = 60;
const NEAR_KM = 5;
export function coverageGaps(pts, stations) {
  const total = pts.at(-1)?.km ?? 0;
  const kms = [0, total];
  const cosLat = Math.cos((pts[0].lat * Math.PI) / 180);
  for (const st of stations) {
    let best = Infinity;
    let at = 0;
    for (const p of pts) {
      const dy = (p.lat - st.lat) * 111.2;
      const dx = (p.lon - st.lon) * 111.2 * cosLat;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; at = p.km; }
    }
    if (best <= NEAR_KM * NEAR_KM) kms.push(at);
  }
  kms.sort((a, b) => a - b);
  const holes = [];
  for (let i = 1; i < kms.length; i++) if (kms[i] - kms[i - 1] > GAP_FILL_KM) holes.push({ from: kms[i - 1], to: kms[i] });
  return holes;
}

/** Rota noktalarını SEG_KM'lik parçalara böl; her parçada çizgi noktaları STEP_KM aralıkla seyreltilir. */
function segments(pts) {
  const total = pts.at(-1).km;
  const segs = [];
  for (let from = 0; from < total; from += SEG_KM) {
    const sel = [];
    let next = from;
    for (const p of pts) {
      if (p.km < from - 0.5 || p.km > from + SEG_KM + 0.5) continue;
      if (p.km >= next) { sel.push(p); next = p.km + STEP_KM; }
    }
    const last = pts.findLast((p) => p.km <= from + SEG_KM + 0.5);
    if (last && sel.at(-1) !== last) sel.push(last);
    if (sel.length) segs.push(sel);
  }
  return segs;
}

const overpassQuery = (around) => `[out:json][timeout:60];nwr["amenity"="charging_station"](around:${around});out tags center;`;

function parseOverpass(elements) {
  const drop = {};
  const out = elements.map((el) => fromOsm(el, drop)).filter(Boolean);
  return { out, raw: elements.length, drop };
}

async function ocmQuery(lat, lon, km, key) {
  const q = `output=json&compact=true&verbose=false&maxresults=250&distanceunit=KM&distance=${km}&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
  const viaProxy = proxyHas('ocm');
  const res = viaProxy
    ? await proxyFetchRetry(`/ocm/poi?${q}`, {}, { timeoutMs: 30000 }) // anahtarı sunucu ekler
    : await fetch(`https://api.openchargemap.io/v3/poi/?${q}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(30000) }); // anahtar sorguda: basit GET (ön istek yok)
  if (!res.ok) throw new Error(viaProxy && res.status === 401 ? 'Sunucu erişim kodu geçersiz' : res.status === 401 || res.status === 403 ? 'OpenChargeMap anahtarı reddedildi' : `OpenChargeMap HTTP ${res.status}`);
  const list = await res.json();
  const drop = {};
  return { out: list.map((p) => fromOcm(p, drop)).filter(Boolean), raw: list.length, drop };
}

function addDrop(into, from) { for (const [k, v] of Object.entries(from)) into[k] = (into[k] || 0) + v; }

/** Anahtarın çalışıp çalışmadığını sına (Ankara çevresi, 5 kayıt). Dönüş: { ok, text }. */
export async function testOcm() {
  const key = ocmKey();
  if (!key) return { ok: false, text: 'Önce anahtarı gir' };
  try {
    const r = await ocmQuery(39.92, 32.85, 10, key);
    return { ok: true, text: `çalışıyor (${r.raw} kayıt, ${r.out.length} aday)` };
  } catch (err) {
    return { ok: false, text: err.message };
  }
}

/**
 * Rota boyunca istasyonlar: her ~120 km'lik parça bir Overpass sorgusu (parça başına 6 saat önbellek); OpenChargeMap anahtarı varsa
 * ~40 km aralıklı dairelerle ek olarak sorgulanır. Dönüş: { stations, errors, cached, summary }.
 */
export async function fetchChargers(pts, profile) {
  const ctx = { raw: 0, drop: {}, calls: 0, textCalls: 0, textFound: 0 };
  const errors = [];
  const found = new Map();
  let failed = 0;
  let lastErr = '';
  const take = (r) => { ctx.raw += r.raw; addDrop(ctx.drop, r.drop); r.out.forEach((s) => found.set(s.id, s)); };

  // Sunucuda HERE varsa istasyonlar önce HERE'den gelir (güç ve soket türü dahil; Mapbox hakkını harcamaz); olmazsa Mapbox, o da olmazsa Overpass
  let usedMapbox = false;
  if (hereOn()) {
    let r;
    try { r = await hereAlong(pts); } catch (err) { r = { out: new Map(), raw: 0, calls: 0, failed: 0, skipped: 0, fatal: err }; }
    ctx.calls += r.calls;
    take({ out: [...r.out.values()], raw: r.raw, drop: {} });
    if (r.failed) errors.push(`HERE: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
    if (r.skipped) errors.push(`HERE: ${r.skipped} arama üst sınır nedeniyle yapılmadı`);
    if (r.fatal) errors.push(r.fatal.message + ' (Mapbox/Overpass denendi)');
    usedMapbox = !r.fatal; // (adı eski: "ana kaynak kullanıldı")
  }
  // Mapbox anahtarı varsa istasyonlar Mapbox'tan (hızlı); anahtar reddedilirse Overpass'e düşülür
  if (!usedMapbox && mapboxKey()) {
    let r;
    try { r = await stationsAlong(pts); } catch (err) { // anahtar/izin/aylık hak sorunu (kategori sorgusu dahil): plan durmasın, Overpass'e düşülür
      r = { out: new Map(), raw: 0, drop: {}, calls: 0, failed: 0, skipped: 0, fatal: err };
    }
    ctx.calls += r.calls;
    take({ out: [...r.out.values()], raw: r.raw, drop: r.drop });
    if (r.failed) errors.push(`Mapbox: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
    if (r.skipped) errors.push(`Mapbox: ${r.skipped} arama üst sınır nedeniyle yapılmadı`);
    if (r.fatal) errors.push(r.fatal.message + ' (Overpass denendi)');
    usedMapbox = !r.fatal;
  }

  // Overpass parçaları paralel (en çok SEG_PARALLEL) ve farklı aynalardan başlayarak sorgulanır; gerçek sorguların başlangıçları arasında kısa aralık (adil kullanım)
  const overpassSegs = async (segs) => {
    let nextSeg = 0;
    let dead = false;
    let lastStart = 0;
    const segWorker = async () => {
      while (nextSeg < segs.length && !dead) {
        const idx = nextSeg++;
        const seg = segs[idx];
        const key = `ovp:${fmt(seg[0])}:${seg.length}:${fmt(seg.at(-1))}`;
        try {
          const r = await cached(key, TTL.long, async () => {
            const slot = Math.max(Date.now(), lastStart + 600); // başlangıçlar en az 600 ms arayla
            lastStart = slot;
            if (slot > Date.now()) await sleep(slot - Date.now());
            ctx.calls++;
            return parseOverpass(await overpass(overpassQuery(`${AROUND_M},${seg.map((p) => fmt(p)).join(',')}`), idx));
          });
          take(r);
        } catch (err) {
          failed++;
          lastErr = err.message;
          if (err.unreachable) dead = true; // hiçbir sunucuya ulaşılamıyor: kalan parçaları denemenin anlamı yok
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SEG_PARALLEL, segs.length) }, segWorker));
  };

  if (!usedMapbox) await overpassSegs(segments(pts));
  else {
    // Mapbox bazı ülkelerde (ör. Yunanistan) istasyon vermez: rotada istasyonsuz uzun kesim kalırsa yalnızca o kesimler Overpass'ten tamamlanır
    const holes = coverageGaps(pts, [...found.values()]);
    if (holes.length) {
      ctx.gapFill = holes.length;
      await overpassSegs(segments(pts).filter((seg) => holes.some((h) => seg.at(-1).km > h.from && seg[0].km < h.to)));
    }
  }
  if (failed) errors.push(`Overpass: ${failed} parça alınamadı${lastErr ? ' — ' + lastErr : ''}`);

  // Google Places (ücretli, yalnızca Premium): ek kaynak; yinelenenleri dedupe eler (önce gelen kayıt kalır), hata olursa öteki kaynaklarla sürülür
  if (googleOn()) {
    let r;
    try { r = await googleAlong(pts); } catch (err) { r = { out: new Map(), raw: 0, calls: 0, failed: 0, skipped: 0, fatal: err }; }
    ctx.calls += r.calls;
    take({ out: [...r.out.values()], raw: r.raw, drop: {} });
    if (r.failed) errors.push(`Google: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
    if (r.skipped) errors.push(`Google: ${r.skipped} arama üst sınır nedeniyle yapılmadı`);
    if (r.fatal) errors.push(r.fatal.message);
  }

  const key = ocmKey();
  if (key) {
    const circles = [];
    let nextKm = 0;
    for (const p of pts) if (p.km >= nextKm) { circles.push(p); nextKm = p.km + 40; }
    let next = 0;
    let ocmFailed = 0;
    let ocmErr = '';
    const worker = async () => {
      while (next < circles.length) {
        const c = circles[next++];
        try {
          take(await cached(`ocm:${c.lat.toFixed(2)},${c.lon.toFixed(2)}`, TTL.long, () => { ctx.calls++; return ocmQuery(c.lat, c.lon, 25, key); }));
        } catch (err) { ocmFailed++; ocmErr = err.message; if (/anahtar/i.test(err.message)) next = circles.length; }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (ocmFailed) errors.push(`OpenChargeMap: ${ocmFailed} arama başarısız${ocmErr ? ' — ' + ocmErr : ''}`);
  }

  // Tesla Supercharger (diğer markalara açık, CCS2): ayrı kaynaktan (supercharge.info, sunucu üzerinden); öteki kaynaklar Tesla kayıtlarını eler
  const tesla = await teslaAlong(pts);
  ctx.raw += tesla.length;
  tesla.forEach((s) => found.set(s.id, s));

  const stations = finalize([...customRaw(), ...found.values()], profile);
  if (!found.size && failed && !usedMapbox) errors.unshift('İstasyon kaynağına ulaşılamadı: internet veya Overpass sunucusu');
  return { stations, errors, cached: ctx.calls === 0 && found.size > 0, summary: summarize(stations, profile, ctx) };
}

const NEAR_TTL_MS = 20 * 60e3;

/** Bir noktanın etrafındaki (yarıçap km, en çok 50) istasyonlar, uzaklığa göre sıralı: { stations, errors, cached }. */
export async function fetchAround(lat, lon, radiusKm, force = false) {
  const here = { lat, lon };
  const km = Math.min(radiusKm, 50);
  const errors = [];
  let ran = false;
  const run = async () => {
    ran = true;
    const out = [];
    let usedMapbox = false;
    if (hereOn()) {
      const r = await hereAround(lat, lon, km).catch((err) => ({ out: new Map(), failed: 0, fatal: err }));
      out.push(...r.out.values());
      if (r.failed) errors.push(`HERE: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
      if (r.fatal) errors.push(r.fatal.message + ' (Mapbox/Overpass denendi)');
      usedMapbox = !r.fatal;
    }
    if (!usedMapbox && mapboxKey()) {
      const r = await stationsAround(lat, lon, km);
      out.push(...r.out.values());
      if (r.failed) errors.push(`Mapbox: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
      if (r.fatal) errors.push(r.fatal.message + ' (Overpass denendi)');
      usedMapbox = !r.fatal;
    }
    if (!usedMapbox) {
      try {
        out.push(...parseOverpass(await overpass(overpassQuery(`${km * 1000},${lat.toFixed(5)},${lon.toFixed(5)}`))).out);
      } catch (err) { errors.push(err.message); }
    }
    if (googleOn()) {
      const r = await googleAround(lat, lon, km).catch((err) => ({ out: new Map(), failed: 0, fatal: err }));
      out.push(...r.out.values());
      if (r.failed) errors.push(`Google: ${r.failed} arama başarısız${r.lastError ? ' — ' + r.lastError : ''}`);
      if (r.fatal) errors.push(r.fatal.message);
    }
    const key = ocmKey();
    if (key) {
      try { out.push(...(await ocmQuery(lat, lon, km, key)).out); } catch (err) { errors.push(err.message); }
    }
    out.push(...await teslaAround(lat, lon, km));
    return out;
  };
  const ckey = `nearO:${lat.toFixed(2)},${lon.toFixed(2)}:${km}`;
  let list = force ? undefined : cacheGet(ckey);
  if (list === undefined) {
    list = await run();
    if (!errors.length && list.length) cacheSet(ckey, list, NEAR_TTL_MS);
  }
  const out = [];
  for (const s of dedupe([...customRaw(), ...list])) {
    const distKm = haversineKm(here, s);
    if (distKm <= radiusKm) out.push({ ...priced(s), distKm });
  }
  return { stations: out.sort((a, b) => a.distKm - b.distKm), errors, cached: !ran };
}

/** Canlı doluluk verisi yok: boş sonuç (istasyonlar "bilinmiyor" görünür). */
// Canlı doluluk: routing/occupancyClient.js (ara sunucu)
