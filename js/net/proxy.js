// Ara sunucu (server/proxy.mjs). Hesapla giriş yapılmışsa (davet + Google) oturum belirteci uygulamada kendiliğinden saklanır, kullanıcı hiçbir şey yazmaz;
// Mapbox, OpenChargeMap ve Overpass istekleri sunucudan geçer, anahtarlar sunucuda durur. Eski yöntem (yönetici erişim kodu) gelişmiş ayar olarak durur.
// Hesap yoksa ya da sunucuya ulaşılamazsa uygulama servislere doğrudan gider.
import { load, save } from '../utils/storage.js';

export const DEFAULT_SERVER = 'https://evcopilot.duckdns.org'; // herkese açık adres (gizli değil); gelişmiş ayardan değiştirilebilir

export const proxyBase = () => (String(load('proxyUrl', '') || '').trim() || DEFAULT_SERVER).replace(/\/+$/, '');
export const proxyCode = () => String(load('proxyCode', '') || '').trim();
export const getSession = () => { const s = load('session', null); return s?.token ? s : null; };
export const setSession = (s) => { save('session', s); document.dispatchEvent(new Event('account-changed')); };
let caps = load('proxyCaps', null); // sunucunun bildirdiği özellikler: { mapbox, here, ocm, overpass, occupancy (kullanıcı Premium ise), occupancyLocked (sunucuda var ama Premium değil) }
let plan = load('proxyPlan', null); // hesap planı: { premium, until }

/** Cihaz kimliği: giriş yapmamış kullanıcı için rastgele (d_...), cihazda kalıcı. Giriş yapınca sunucu bu kimliği hesaba bağlar; kimlik hesabın kimliğiyle değişir. */
export function deviceId() {
  let id = load('deviceId', '');
  if (!/^d_[A-Za-z0-9_-]{16,40}$/.test(id)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    id = 'd_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    save('deviceId', id);
  }
  return id;
}

const hasCreds = () => !!(getSession() || proxyCode());
export const proxyReady = hasCreds; // hesapla giriş ya da yönetici kodu var mı

/** Sunucu kullanılabilir mi ve istenen özelliği (mapbox | ocm | overpass) sağlıyor mu. */
export const proxyHas = (what) => !!(hasCreds() && caps?.[what]);
export const getPlan = () => (getSession() ? plan : null);
/**
 * Sunucunun Premium saydığı erişim (sunucudaki premiumOk ile aynı): hesapla girişte plan Premium (ya da yönetici), hesapsız eski yönetici erişim koduyla her zaman.
 * ui/premiumGate.js isPremium() FARKLIDIR: o yalnızca hesap planına bakar (eski kodla false) ve Premium menülerini gizler. Premium sunucu verisi isteyen yerler (hız limiti) premiumAccess() kullanır.
 */
export const premiumAccess = () => (getSession() ? !!plan?.premium : !!proxyCode());

export function proxyFetch(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('X-Device-Id', deviceId());
  const s = getSession();
  if (s) headers.set('Authorization', 'Bearer ' + s.token);
  else if (proxyCode()) headers.set('X-Access-Code', proxyCode());
  return fetch(proxyBase() + path, { ...init, headers });
}

// ---- Kısa süreli sunucu kesintisinde yeniden deneme (istasyon araması) ----
// Sunucu yeniden başlarken (~10 sn) Caddy 502 verir ya da tarayıcı "Failed to fetch" görür (uygulama sunucuyla farklı kökenli: Caddy'nin 502'sinde CORS başlığı yoktur, tarayıcı çoğunlukla TypeError verir). Yalnızca bu GEÇİCİ durumlar yeniden denenir:
// ağ hatası (TypeError) ve JSON OLMAYAN HTTP 502/503/504 (Caddy'nin gövdesiz/düz metin yanıtı). Okunabilen JSON hatalı 502/503/504 bizim Node sunucusundan gelir
// (üst servis hatası: iptal edilmiş HERE anahtarı, aktarılan Mapbox/OCM/Overpass durumu): sunucu ayakta, yeniden denemek yalnızca 12 sn ve kota harcar → denenmez. Başka durum (401, 402, 403, 404, 429, 501…), zaman aşımı ve çağıranın iptali ASLA yeniden denenmez.
// ORTAK KAPI (gate): istasyon araması onlarca paralel istek atar; her biri kendi 12 sn'lik döngüsünü çalıştırırsa kapalı sunucuya yük biner
// ve bekleme çarpılır. Bu yüzden kesinti tek bir ortak "tur" olarak ele alınır:
//   - ilk başarısız istek turu başlatır (tek 'proxy-retrying' olayı → arayüz tek toast gösterir);
//   - tur boyunca TEK ortak zamanlayıcı çalışır, bekleyen tüm istekler aynı anda uyanıp yeniden dener (en çok `retries` uyanış ≈ 12 sn);
//   - hak bitince kapı "down" olur ve 20 sn boyunca yeni istekler yeniden DENEMEZ (tek deneme, bugünkü davranış); bir istek başarırsa kapı sıfırlanır.
// Böylece bir aramanın toplam ek beklemesi ~13,5 sn'yi (3 × 4 sn ± 0,5) aşmaz ve tükenince mevcut hata yolu çalışır.
const RETRY_STATUS = new Set([502, 503, 504]);
const DOWN_COOLDOWN_MS = 20000; // hak tükenince bu süre yeni istekler yeniden denemez
const EVENT_GAP_MS = 20000; // 'proxy-retrying' olayı (toast) tur yeniden başlasa da en çok bu sıklıkta
const STALE_MS = 30000; // tur bu kadar süredir sessizse (istekler bitti/iptal edildi) eski sayılır, yenisi başlar
const gate = { phase: 'ok', ticks: 0, wait: null, downUntil: 0, lastFail: 0 }; // phase: ok | retrying | down
let lastEventAt = -Infinity;
export const retryTuning = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() }; // testler uykuyu ve saati değiştirir
const clearGate = () => Object.assign(gate, { phase: 'ok', ticks: 0, wait: null, downUntil: 0, lastFail: 0 });
export function resetRetryGate() { clearGate(); lastEventAt = -Infinity; } // test için: olay sıklığı sınırını da sıfırlar

/** Geçici sunucu kesintisi mi: JSON olmayan 502/503/504 (JSON hatalı olanı bizim sunucumuz üretir). Content-Type CORS'ta okunabilir. */
const isTransient = (res) => RETRY_STATUS.has(res.status) && !/json/i.test(res.headers.get('content-type') || '');

const isNetworkError = (err) => err?.name === 'TypeError'; // fetch ağ hatası ("Failed to fetch"); TimeoutError / AbortError değildir
const abortError = (signal) => signal?.reason ?? new DOMException('Aborted', 'AbortError');

function combine(a, b) {
  if (!a || !b) return a || b;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([a, b]);
  const c = new AbortController();
  for (const s of [a, b]) { if (s.aborted) c.abort(s.reason); else s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
  return c.signal;
}

/** Ortak kapıdan yeniden deneme izni iste. true: ortak bekleme bitti, yeniden dene. false: vazgeç (hak tükendi / soğuma). */
async function gateWait(o, signal) {
  const now = retryTuning.now();
  if (gate.phase === 'down') { if (now < gate.downUntil) return false; clearGate(); }
  if (gate.phase === 'retrying' && now - gate.lastFail > STALE_MS) clearGate();
  gate.lastFail = now;
  if (gate.phase === 'ok') {
    gate.phase = 'retrying'; gate.ticks = 0;
    if (now - lastEventAt >= EVENT_GAP_MS && typeof document !== 'undefined' && typeof CustomEvent === 'function') { lastEventAt = now; document.dispatchEvent(new CustomEvent('proxy-retrying')); } // arayüz tek toast gösterir
  }
  if (gate.ticks >= o.retries) { gate.phase = 'down'; gate.downUntil = now + DOWN_COOLDOWN_MS; gate.wait = null; return false; }
  if (!gate.wait) {
    const ms = Math.max(0, o.delayMs + (Math.random() * 2 - 1) * o.jitterMs);
    const w = Promise.resolve(o.sleep(ms)).then(() => { if (gate.wait === w) { gate.ticks++; gate.wait = null; } }); // kapı ara sıfırlandıysa eski zamanlayıcı yeni turu bozmaz
    gate.wait = w;
  }
  if (!signal) { await gate.wait; return true; }
  if (signal.aborted) throw abortError(signal);
  let onAbort;
  const aborted = new Promise((_, rej) => { onAbort = () => rej(abortError(signal)); signal.addEventListener('abort', onAbort, { once: true }); });
  try { await Promise.race([gate.wait, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
  return true;
}

/**
 * proxyFetch + yalnızca geçici sunucu kesintisinde yeniden deneme (ağ hatası, 502/503/504). Her denemeye TAZE zaman aşımı sinyali verilir
 * (timeoutMs); çağıran init.signal verirse iptali denemeler arasında da geçerlidir. Dönüş: son Response (son 502/503/504 olduğu gibi) ya da son ağ hatası fırlatılır.
 */
export async function proxyFetchRetry(path, init = {}, { timeoutMs, retries = 3, delayMs = 4000, jitterMs = 500, sleep = retryTuning.sleep } = {}) {
  const o = { retries, delayMs, jitterMs, sleep };
  const outer = init.signal;
  for (let attempt = 0; ; attempt++) {
    let res = null;
    let err = null;
    try {
      const own = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
      res = await proxyFetch(path, { ...init, signal: combine(own, outer) });
    } catch (e) { err = e; }
    if (res && !isTransient(res)) { if (gate.phase !== 'ok') clearGate(); return res; } // sunucu ayakta: kapı sıfırlanır
    if (err && !isNetworkError(err)) throw err; // zaman aşımı, iptal ya da beklenmeyen hata
    if (outer?.aborted) throw abortError(outer);
    if (attempt >= retries || !(await gateWait(o, outer))) { if (err) throw err; return res; }
    try { res?.body?.cancel?.().catch(() => {}); } catch { /* gövde zaten kilitli */ } // atılan 502 gövdesi serbest kalsın
  }
}

/** Herkese açık yapılandırma (giriş sağlayıcıları). Sunucuya ulaşılamazsa null. */
export async function serverConfig() {
  try {
    const r = await fetch(proxyBase() + `/v1/config?v=${globalThis.APP_VERSION || ''}&p=${globalThis.Capacitor?.isNativePlatform?.() ? 'apk' : 'web'}`, { headers: { 'X-Device-Id': deviceId() }, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/** Giriş yapmamış cihaz: sunucuya cihaz kimliğiyle uğra (anonim cihaz sayımı); en çok 6 saatte bir. */
function pingAnon() {
  const last = Number(load('devicePing', 0)) || 0;
  if (Date.now() - last < 6 * 3600e3) return;
  save('devicePing', Date.now());
  serverConfig();
}

/** Sunucunun özelliklerini yenile (oturum varsa /v1/me, yoksa yönetici kodu varsa /health). 401'de oturum silinir. Dönüş: { ok, text, caps }. */
export async function refreshCaps() {
  if (!hasCreds()) { caps = null; save('proxyCaps', null); pingAnon(); return { ok: false, text: '', caps: null }; }
  try {
    const sess = getSession();
    const res = await proxyFetch(sess ? '/v1/me' : '/health', { signal: AbortSignal.timeout(10000) });
    if (res.status === 401) {
      if (sess) setSession(null); // oturum geçersiz (yönetici kapattı ya da hesap silindi)
      throw new Error('Erişim kodu reddedildi');
    }
    if (!res.ok) throw new Error(`Sunucu HTTP ${res.status}`);
    const j = await res.json();
    const c = sess ? j.caps : j;
    const prem = !sess || !!j.user?.premium; // Premium özellikler yalnızca Premium (ya da yönetici) hesapta açılır
    caps = { mapbox: !!c?.mapbox, here: !!c?.here, ocm: !!c?.ocm, overpass: !!c?.overpass, occupancy: !!c?.occupancy && prem, occupancyLocked: !!c?.occupancy && !prem };
    plan = sess ? { premium: !!j.user?.premium, until: j.user?.premiumUntil || null } : null;
    save('proxyCaps', caps);
    save('proxyPlan', plan);
    document.dispatchEvent(new Event('plan-changed'));
    return { ok: true, text: '', caps, user: j.user || null };
  } catch (err) {
    caps = null;
    save('proxyCaps', null);
    return { ok: false, text: err.message === 'Erişim kodu reddedildi' ? err.message : 'Sunucuya ulaşılamadı', caps: null };
  }
}

/** Hesap planı ve sunucu özelliklerini açılışta, uygulamaya dönünce (en çok 5 dakikada bir) ve her 30 dakikada tazele. */
export function watchCaps() {
  let last = 0;
  const run = () => { if (Date.now() - last > 5 * 60e3) { last = Date.now(); refreshCaps(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  setInterval(run, 30 * 60e3);
  run();
}

/** Gelişmiş ayar: sunucu adresi ve yönetici kodu kaydedilir ve sunucu sınanır. Dönüş: { ok, text, caps }. */
export async function testProxy(url, code) {
  save('proxyUrl', String(url || '').trim().replace(/\/+$/, ''));
  save('proxyCode', String(code || '').trim());
  return refreshCaps();
}
