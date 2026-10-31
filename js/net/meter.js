import { load, save } from '../utils/storage.js';

/**
 * Veri kullanımı sayacı (uygulama düzeyinde, TAHMİNİ). Operatör faturası TLS/TCP/DNS yükü nedeniyle
 * genelde %5–15 farklı çıkar. Sayılanlar:
 *  - fetch() çağrıları: gönderilen = URL + başlıklar + gövde (başlık yükü sabit tahmin), alınan = Content-Length
 *    (yoksa gövde baytları). Önbellekten gelen yanıtlar da sayıldığı için bu kalem üst sınırdır.
 *  - Betik/CSS/harita karosu gibi diğer yüklemeler: Resource Timing (transferSize). Önbellekten gelenler 0 sayılır;
 *    ölçüm izni olmayan harita karoları ortalama boyutla tahmin edilir.
 *  - Tesseract motoru bir Web Worker içinde indirdiği için sayfadan görünmez; ilk kurulumda bir kez tahmini eklenir.
 */
export const CATS = {
  abrp: 'ABRP',
  services: 'Rota / hava / arama servisleri',
  tiles: 'Harita karoları',
  libs: 'Kütüphaneler ve OCR motoru',
  app: 'Uygulama dosyaları',
  other: 'Diğer (webhook vb.)',
};

const HOSTS = [
  [/(^|\.)iternio\.com$/, 'abrp'],
  [/(^|\.)(gstatic\.com|googleusercontent\.com)$|^(mt\d|khms\d)\.google\.com$|^tiles\.openfreemap\.org$/, 'tiles'],
  [/^(maps\.googleapis\.com|routes\.googleapis\.com|places\.googleapis\.com|weather\.googleapis\.com|roads\.googleapis\.com|valhalla1\.openstreetmap\.de|api\.open-meteo\.com|photon\.komoot\.io|nominatim\.openstreetmap\.org|api\.openchargemap\.io|overpass[\w.-]*)$/, 'services'],
  [/^(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)$/, 'libs'],
];
const REQ_OVERHEAD = 450; // tarayıcının eklediği başlıklar (User-Agent, Accept-*, Origin, Referer, Sec-*) için tahmin
const RES_OVERHEAD = 250; // yanıt başlıkları
const EST_TILE = 18000; // ölçülemeyen harita karosu için ortalama
const EST_OCR_ENGINE = 4.4e6; // Tesseract çekirdek + dil verisi, ilk kurulum (ölçüm: ~4.36 MB)
// Ölçüm izni (Timing-Allow-Origin) vermeyen CDN dosyaları için sıkıştırılmış aktarım boyutları (ölçüldü).
const EST_BY_URL = [
  [/tesseract\.min\.js/, 10200],
];

export function categoryOf(url) {
  let host;
  try {
    const u = new URL(url, location.href);
    host = u.hostname;
    if (u.origin === location.origin) return 'app';
  } catch {
    return 'other';
  }
  return (HOSTS.find(([re]) => re.test(host)) || [null, 'other'])[1];
}

const fresh = () => ({
  since: Date.now(),
  cats: Object.fromEntries(Object.keys(CATS).map((k) => [k, { up: 0, down: 0, n: 0, est: false }])),
});

let total = load('netUsage', null);
if (!total?.cats) total = fresh();
Object.keys(CATS).forEach((k) => { total.cats[k] ||= { up: 0, down: 0, n: 0, est: false }; });
let session = fresh();

const listeners = new Set();
let persistTimer = null;
let notifyTimer = null;

function persist() {
  clearTimeout(persistTimer);
  persistTimer = null;
  save('netUsage', total);
}

function add(cat, up, down, est = false) {
  for (const d of [total, session]) {
    const c = d.cats[cat] || d.cats.other;
    c.up += up;
    c.down += down;
    c.n += 1;
    if (est) c.est = true;
  }
  persistTimer ||= setTimeout(persist, 2000);
  notifyTimer ||= setTimeout(() => { notifyTimer = null; listeners.forEach((fn) => fn()); }, 500);
}

export const getUsage = () => ({ total, session });
export const subscribeUsage = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const sum = (d) => Object.values(d.cats).reduce((a, c) => ({ up: a.up + c.up, down: a.down + c.down, n: a.n + c.n }), { up: 0, down: 0, n: 0 });

/** Sayacı sıfırla (toplam ve bu oturum). */
export function resetUsage() {
  total = fresh();
  session = fresh();
  persist();
  listeners.forEach((fn) => fn());
}

/** Sayfadan görünmeyen indirmeler için elle ekleme (ör. OCR motoru). */
export function addEstimate(cat, up, down) {
  add(cat, up, down, true);
}

/** İlk OCR kurulumunda Tesseract motorunun indirme boyutunu bir kez ekle (cihaz başına). */
export function countOcrEngineOnce() {
  if (load('ocrEngineCounted', false)) return;
  save('ocrEngineCounted', true);
  addEstimate('libs', 3000, EST_OCR_ENGINE);
}

function bodyBytes(body) {
  if (body == null) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).length;
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  return 0; // FormData / ReadableStream: bilinmiyor
}

function headerBytes(headers) {
  if (!headers) return 0;
  let n = 0;
  new Headers(headers).forEach((v, k) => { n += k.length + v.length + 4; });
  return n;
}

async function countStream(res) {
  const cl = Number(res.headers.get('content-length'));
  if (Number.isFinite(cl) && cl > 0) return cl;
  try {
    const reader = res.clone().body?.getReader();
    if (!reader) return 0;
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return n;
      n += value.byteLength;
    }
  } catch {
    return 0;
  }
}

export function installMeter() {
  if (window.__meterInstalled) return;
  window.__meterInstalled = true;

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const isReq = typeof Request !== 'undefined' && input instanceof Request;
    const url = isReq ? input.url : String(input);
    const method = (init.method || (isReq ? input.method : 'GET')).toUpperCase();
    const cat = categoryOf(url);
    const up = method.length + url.length + REQ_OVERHEAD + headerBytes(init.headers || (isReq ? input.headers : null)) + bodyBytes(init.body);

    let res;
    try {
      res = await origFetch(input, init);
    } catch (err) {
      add(cat, up, 0); // istek çıktı, yanıt gelmedi
      throw err;
    }
    if (res.type === 'opaque') {
      add(cat, up, 300, true); // no-cors: yanıt okunamaz, yaklaşık
    } else {
      countStream(res).then((n) => add(cat, up, n + headerBytes(res.headers) + RES_OVERHEAD, false));
    }
    return res;
  };

  // fetch dışındaki yüklemeler: betikler, stiller, harita karoları (<img>)
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (['fetch', 'xmlhttprequest', 'beacon'].includes(e.initiatorType)) continue; // sarmalayıcı sayıyor
        const cat = categoryOf(e.name);
        if (e.deliveryType === 'cache') continue;
        if (e.transferSize > 0) add(cat, e.name.length + REQ_OVERHEAD, e.transferSize);
        else if (e.decodedBodySize > 0 || e.encodedBodySize > 0) continue; // önbellek
        else { // ölçüm izni yok: tahmin
          const known = EST_BY_URL.find(([re]) => re.test(e.name));
          add(cat, e.name.length + REQ_OVERHEAD, known ? known[1] : cat === 'tiles' ? EST_TILE : 0, true);
        }
      }
    }).observe({ type: 'resource', buffered: true });
  } catch { /* eski tarayıcı: yalnızca fetch sayılır */ }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  window.addEventListener('pagehide', persist);
}
