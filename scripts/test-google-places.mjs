// Google Places istasyon araması (js/google/chargers.js) — RM-14: kullanım: node scripts/test-google-places.mjs
// Denetler: 30 ücretli çağrı/arama sınırı korunur (yeniden denemeler dahil); taranmayan alt bölge "bilgi" olarak, kota/hata gibi değil;
// 402 google_cap (sunucu günlük tavanı), 429 (Google geçici hız sınırı), 402 premium_required, 400/403 anahtar ayrı mesaj;
// JSON 502/503/504 sınırlı yeniden deneme; yeni rota planlanınca (AbortSignal) arama durur ve sonuç sessizdir; i18n anahtarları 11 dilde.
// Ağ, localStorage ve uyku sahtedir. Gerçek anahtar, gerçek Google/sunucu çağrısı YOK.
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond || !extra ? '' : '— ' + extra); };

const store = new Map([
  ['evcp.proxyUrl', JSON.stringify('http://proxy.test')],
  ['evcp.proxyCode', JSON.stringify('testcode-fake-000000000')],
  ['evcp.proxyCaps', JSON.stringify({ googleStations: true })],
  ['evcp.deviceId', JSON.stringify('d_abcdefghijklmnopqrstu')],
]);
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
globalThis.document = { dispatchEvent() { return true; }, addEventListener() {}, getElementById() { return null; } };

// Sahte sunucu: handler(url, n) → Response. Her istek sayılır.
let handler = () => json(200, { items: [], full: false });
let reqs = [];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError');
  reqs.push(String(url));
  return handler(String(url), reqs.length, init);
};

const G = await import('../js/google/chargers.js');
const { clearCache } = await import('../js/utils/cache.js');
const { resetRetryGate } = await import('../js/net/proxy.js');
const sleeps = [];
G.googleTuning.sleep = async (ms) => { sleeps.push(ms); };

let base = 30; // her senaryo farklı koordinat: istemci önbelleği senaryolar arasında karışmaz
const reset = (h) => { clearCache(); resetRetryGate(); reqs = []; sleeps.length = 0; handler = h; base += 3; };
const routePts = (nCircles) => Array.from({ length: nCircles }, (_, i) => ({ lat: base, lon: 20 + i * 0.5, km: i * 35 }));
const items = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, n: 'İstasyon', la: base, lo: 20 + i * 0.001, dc: 120, ac: 0, k: 1 }));

// ---------- 1) Maliyet sınırı: 30 korunur; taranmayan alt bölge bilgi notu (hata değil) ----------
ok('MAX_CALLS 30 (artırılmadı)', G.MAX_CALLS === 30, String(G.MAX_CALLS));
reset((u) => json(200, { items: items(20, u.length), full: true })); // her daire dolu → 4 alt daire
{
  const r = await G.stationsAlong(routePts(12)); // 12 daire + 48 alt daire = 60 > 30
  ok('sınır: en çok 30 ücretli istek', reqs.length === 30 && r.calls === 30, `${reqs.length} ${r.calls}`);
  ok('sınır: taranmayan alt bölge sayısı = 60 − 30', r.skipped === 30, String(r.skipped));
  const n = G.googleNotes(r);
  ok('sınır: hata listesi boş (Google kotası/hatası değil)', n.errors.length === 0, JSON.stringify(n.errors));
  ok('sınır: bilgi notu "N alt bölge taranmadı" + 30 sorgu sınırı', n.notices.length === 1 && n.notices[0] === 'Google: 30 alt bölge taranmadı (arama başına 30 ücretli sorgu sınırı)', JSON.stringify(n.notices));
  ok('sınır: eski yanıltıcı metin yok ("arama üst sınır nedeniyle yapılmadı")', !JSON.stringify(n).includes('üst sınır nedeniyle'));
}

// ---------- 2) 402 google_cap ≠ 429 ≠ premium_required ≠ anahtar ----------
const fatalOf = async (h) => { reset(h); const r = await G.stationsAlong(routePts(3)); return { r, n: G.googleNotes(r), reqs: reqs.length }; };
{
  const cap = await fatalOf(() => json(402, { error: 'google_cap' }));
  const rate = await fatalOf(() => json(429, { error: 'Google HTTP 429' }));
  const prem = await fatalOf(() => json(402, { error: 'premium_required' }));
  const key = await fatalOf(() => json(502, { error: 'Google HTTP 403' }));
  ok('402 google_cap: tür cap, sunucu günlük sınırı mesajı', cap.r.fatal?.kind === 'cap' && /sunucudaki günlük sınırı/.test(cap.n.errors[0] || ''), JSON.stringify(cap.n));
  ok('429: tür rate, Google geçici istek sınırı mesajı (günlük değil)', rate.r.fatal?.kind === 'rate' && /geçici istek sınırı.*429/.test(rate.n.errors[0] || '') && !/günlük/.test(rate.n.errors[0]), JSON.stringify(rate.n));
  ok('402 premium_required: Premium mesajı', prem.r.fatal?.kind === 'premium' && prem.n.errors[0] === 'Google istasyonları Premium gerektirir');
  ok('502 + Google HTTP 403: anahtar/izin, yeniden denenmez', key.r.fatal?.kind === 'key' && key.r.retries === 0 && sleeps.length === 0, JSON.stringify({ k: key.r.fatal?.kind, rt: key.r.retries }));
  ok('cap / rate / premium / anahtar mesajları birbirinden farklı', new Set([cap, rate, prem, key].map((x) => x.n.errors[0])).size === 4);
  ok('fatal hata: aramayı durdurur, ek ücretli istek atılmaz (≤ paralel 3)', cap.reqs <= 3 && rate.reqs <= 3, `${cap.reqs} ${rate.reqs}`);
  ok('429 / 402 yeniden denenmez', cap.r.retries === 0 && rate.r.retries === 0);
}

// ---------- 3) 502/503/504 geçici: kontrollü yeniden deneme ----------
for (const st of [502, 503, 504]) {
  reset((u, n) => (n === 1 ? json(st, { error: st === 502 ? 'Google HTTP 500' : 'Google yanıt vermedi' }) : json(200, { items: items(3, 'r' + st), full: false })));
  const r = await G.stationsAlong(routePts(1));
  ok(`${st} bir kez: yeniden denenir ve başarılı olur`, r.failed === 0 && r.retries === 1 && reqs.length === 2 && r.out.size === 3, JSON.stringify({ f: r.failed, rt: r.retries, q: reqs.length }));
  ok(`${st}: bekleme var (kontrollü, sahte uyku)`, sleeps.length === 1 && sleeps[0] > 0, JSON.stringify(sleeps));
}
reset(() => json(502, { error: 'Google yanıt vermedi' }));
{
  const r = await G.stationsAlong(routePts(10));
  const n = G.googleNotes(r);
  ok('kalıcı 502: daire başına en çok 1, aramada en çok 4 yeniden deneme', r.retries <= 4 && reqs.length === 10 + r.retries, JSON.stringify({ rt: r.retries, q: reqs.length }));
  ok('kalıcı 502: başarısız daire sayısı, fatal değil (diğer kaynaklar sürer)', r.failed === 10 && !r.fatal, JSON.stringify({ f: r.failed, fatal: r.fatal?.message }));
  ok('kalıcı 502: anlaşılır mesaj', n.errors[0] === 'Google: 10 arama başarısız — Google geçici olarak yanıt vermedi (HTTP 502)', JSON.stringify(n.errors));
}
reset(() => json(502, { error: 'Google yanıt vermedi' }));
{
  const r = await G.stationsAlong(routePts(40)); // 40 daire, hepsi 502: yeniden denemeler 30 sınırını aşmaz
  ok('yeniden denemeler dahil 30 sınırı aşılmaz', reqs.length <= 30 && r.calls <= 30 && r.calls === reqs.length, `${reqs.length} ${r.calls}`);
  ok('sınır dolunca kalanlar taranmayan alt bölge', r.skipped > 0 && r.skipped + r.failed === 40, JSON.stringify({ s: r.skipped, f: r.failed }));
}
reset(() => json(502, { error: 'Google HTTP 404' }));
{
  const r = await G.stationsAlong(routePts(2));
  ok('502 + Google HTTP 4xx (400/403 dışı): yeniden denenmez, başarısız sayılır', r.retries === 0 && r.failed === 2 && !r.fatal, JSON.stringify({ rt: r.retries, f: r.failed }));
}

// ---------- 4) Yeni rota: önceki arama iptal edilir, stale sonuç yok ----------
{
  const ac = new AbortController();
  let started = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  reset(async (u, n, init) => {
    started++;
    await Promise.race([gate, new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(init.signal.reason), { once: true }))]);
    return json(200, { items: items(20, 'old' + n), full: true });
  });
  const p = G.stationsAlong(routePts(12), { signal: ac.signal });
  await new Promise((r) => setTimeout(r, 5));
  const before = reqs.length;
  ac.abort();
  release();
  const r = await p;
  const n = G.googleNotes(r);
  ok('iptal: süren paralel istekler (≤3) dışında yeni ücretli istek atılmaz', before <= 3 && reqs.length === before, `${before} → ${reqs.length}`);
  ok('iptal: cancelled, başarısız/taranmadı sayılmaz', r.cancelled === true && r.failed === 0 && r.skipped === 0 && !r.fatal, JSON.stringify({ c: r.cancelled, f: r.failed, s: r.skipped, fatal: r.fatal?.message }));
  ok('iptal: kullanıcıya mesaj yok (stale uyarı yok)', n.errors.length === 0 && n.notices.length === 0, JSON.stringify(n));
  ok('iptal: eski rotanın istasyonları sonuca girmez', r.out.size === 0, String(r.out.size));
  reset(() => json(200, { items: [], full: false }));
  const pre = new AbortController(); pre.abort();
  const r2 = await G.stationsAlong(routePts(3), { signal: pre.signal });
  ok('önceden iptal edilmiş sinyal: hiç istek atılmaz', reqs.length === 0 && r2.cancelled === true);
}
{ // iptal edilen eski aramanın ortak (in-flight) isteğini paylaşan yeni arama kendi isteğini atar
  const old = new AbortController();
  reset(async (u, n, init) => {
    if (n === 1) { await new Promise((_, rej) => init.signal?.addEventListener('abort', () => rej(init.signal.reason), { once: true })); }
    return json(200, { items: items(2, 'new' + n), full: false });
  });
  const pts = routePts(1);
  const p1 = G.stationsAlong(pts, { signal: old.signal });
  await new Promise((r) => setTimeout(r, 2));
  const p2 = G.stationsAlong(pts, { signal: new AbortController().signal });
  await new Promise((r) => setTimeout(r, 2));
  old.abort();
  const [r1, r2] = await Promise.all([p1, p2]);
  ok('aynı daire: yeni arama iptalden etkilenmez, sonucu alır', r1.cancelled === true && r2.cancelled === false && r2.failed === 0 && r2.out.size === 2, JSON.stringify({ c1: r1.cancelled, c2: r2.cancelled, f2: r2.failed, n2: r2.out.size }));
}

// ---------- 5) Kaynak denetimi: osm/chargers.js ve controller.js bağlantısı ----------
{
  const osm = readFileSync(new URL('../js/osm/chargers.js', import.meta.url), 'utf8');
  ok('osm: yanıltıcı Google metni kaldırıldı', !/Google: \$\{r\.skipped\} arama üst sınır/.test(osm));
  ok('osm: Google notları googleNotes ile; taranmayan bölge notices\'a', /googleNotes\(r\)/.test(osm) && /notices\.push\(\.\.\.g\.notices\)/.test(osm));
  ok('osm: fetchChargers sinyali Google aramasına geçirir ve notices döndürür', /googleAlong\(pts, \{ signal \}\)/.test(osm) && /return \{ stations, errors, notices,/.test(osm));
  const c = readFileSync(new URL('../js/routing/controller.js', import.meta.url), 'utf8');
  ok('controller: loadStations önceki aramayı iptal eder ve sinyali verir', /stationsCtl\?\.abort\(\)/.test(c) && /fetchChargers\(pts, profile, cacheKey, \{ signal: ctl\.signal \}\)/.test(c));
  ok('controller: planTrip yeni nesilde süren aramayı iptal eder', /const seq = \+\+tripSeq;[\s\S]{0,200}stationsCtl\?\.abort\(\)/.test(c));
  const sv = readFileSync(new URL('../js/ui/stationsView.js', import.meta.url), 'utf8');
  ok('İstasyonlar sekmesi bilgi notlarını gösterir', /stationInfo\?\.notices/.test(sv));
}

// ---------- 6) i18n: yeni Google metinleri 11 dilde, yer tutucular korunur ----------
{
  const KEYS = [
    'Google: {0} alt bölge taranmadı (arama başına {1} ücretli sorgu sınırı)',
    'Google: {0} arama başarısız{1}',
    'Google istasyon aramasının sunucudaki günlük sınırı doldu; yarın yenilenir',
    'Google geçici istek sınırına ulaşıldı (HTTP 429); biraz sonra yeniden dene',
    'Google geçici olarak yanıt vermedi (HTTP {0})',
    'Google anahtarı ya da API izni geçersiz',
    'Google istasyonları Premium gerektirir',
    'Sunucuda Google anahtarı yok',
  ];
  const keys = JSON.parse(readFileSync(new URL('../i18n/keys.extra.json', import.meta.url), 'utf8'));
  ok('anahtarlar i18n/keys.extra.json içinde (tekil)', KEYS.every((k) => keys.filter((x) => x === k).length === 1));
  const ph = (s) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort().join(',');
  const LANGS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'ro', 'bg', 'el'];
  let bad = [];
  for (const l of LANGS) {
    const d = (await import(`../js/i18n/lang/${l}.extra.js`)).default;
    for (const k of KEYS) if (!d[k] || ph(d[k]) !== ph(k) || d[k] === k) bad.push(`${l}:${k}`);
  }
  ok('11 dilde çeviri var, yer tutucular aynı, Türkçe kopya değil', bad.length === 0, bad.slice(0, 5).join(' | '));
  store.set('evcp.lang', JSON.stringify('en'));
  const I = await import('../js/i18n/index.js?en');
  I.__test.compile((await import('../js/i18n/lang/en.extra.js')).default);
  const out = I.tr('Google: 36 alt bölge taranmadı (arama başına 30 ücretli sorgu sınırı)');
  ok('desen eşleşmesi: bilgi notu İngilizceye çevrilir (sayılar korunur)', out === 'Google: 36 sub-areas not scanned (limit of 30 paid queries per search)', `${I.getLang()} ${out}`);
  ok('desen eşleşmesi: 502 ayrıntısı çevrilir', I.tr('Google geçici olarak yanıt vermedi (HTTP 504)') === 'Google temporarily did not respond (HTTP 504)', I.tr('Google geçici olarak yanıt vermedi (HTTP 504)'));
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
