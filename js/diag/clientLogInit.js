// İstemci log çekirdeğinin (clientLog.js) tarayıcı bağlaması: ayar, istemci bilgisi, gönderim ve window dinleyicileri.
// Gizlilik: tam kullanıcı-ajanı, konum, adres YOK (yalnız cihaz ailesi, sürüm, dil, ekran boyutu). Ücretsiz/herkese açık Beta kipinde
// (providerGate.js) hiçbir şey kuyruklanmaz ya da gönderilmez. Kullanıcı kapatınca kuyruk silinir. Oturumsuz çalışır (kimlik gerekmez).
import { load, save } from '../utils/storage.js';
import { publicFreeMode, freeOnlyMode } from '../net/providerGate.js';
import { proxyBase, deviceId } from '../net/proxy.js';
import { locale } from '../i18n/index.js';
import { deviceFamily } from './fieldLog.js';
import { createClientLog, byteLen, newSessionId, LIMITS } from './clientLog.js';

export const SETTING_KEY = 'clientLogOn';
export const FLUSH_EVERY_MS = 60_000;
export const SEND_TIMEOUT_MS = 10_000;
const KEEPALIVE_MAX_BYTES = 60_000;

const secureRand = () => {
  try { const b = new Uint32Array(1); globalThis.crypto.getRandomValues(b); return b[0] / 4294967296; } catch { return Math.random(); }
};
const SID = newSessionId(secureRand); // modül yüklenince bir kez: oturum başına rastgele

const defaultSetting = { get: () => load(SETTING_KEY, true), set: (v) => save(SETTING_KEY, !!v) };
const defaultStorage = { get: (k) => load(k, null), set: (k, v) => save(k, v, { silent: true }) }; // silent: hesap eşitlemesini tetiklemesin
const defaultGate = () => publicFreeMode() || freeOnlyMode();

let setting = defaultSetting;
let core = null;
let teardown = null;

const NOOP = Object.freeze({
  log: () => false, warn: () => false, error: () => false, clear: () => {}, restore: () => {},
  flush: () => Promise.resolve({ skipped: 'not-initialized' }), pending: () => [], state: () => ({ queued: 0, backoffUntil: 0, blockedUntil: 0, sent: 0, dropped: 0, failed: 0 }),
});

/** Kullanıcı tercihi (varsayılan AÇIK). Kısıtlı kipte (kapı) tercih açık olsa da hiçbir şey gönderilmez. */
export const clientLogEnabled = () => { try { return !!setting.get(); } catch { return true; } };

/** Açar/kapatır; kapatınca çekirdeğin kuyruğu hemen silinir. */
export function setClientLogEnabled(on) {
  try { setting.set(!!on); } catch { /* depo hatası */ }
  if (!on && core) core.clear();
}

/** Tekil çekirdek (init edilmemişse güvenli boş nesne döner). */
export const clientLog = () => core || NOOP;

/** Kısayol: init edilmemişse sessizce hiçbir şey yapmaz. */
export const logEvent = (k, m, d, lvl) => { try { core?.log(k, m, d, lvl); } catch { /* günlükleme uygulamayı bozmasın */ } };

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

function makeInfo(win) {
  return () => {
    const nav = win.navigator || {};
    let sa = false;
    try { sa = !!(win.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone); } catch { /* yoksay */ }
    let apk = false;
    try { apk = !!(win.Capacitor ?? globalThis.Capacitor)?.isNativePlatform?.(); } catch { /* yoksay */ }
    let lang = '';
    try { lang = String(locale() || nav.language || ''); } catch { lang = String(nav.language || ''); }
    lang = lang.split('-')[0].toLowerCase();
    let did;
    try { did = deviceId(); } catch { did = undefined; }
    const fam = deviceFamily(nav.userAgent);
    return {
      v: String(globalThis.APP_VERSION || ''),
      p: fam === 'bilinmiyor' ? 'other' : fam,
      sa, apk, lang,
      tz: (() => { try { return -new Date().getTimezoneOffset() || 0; } catch { return undefined; } })(),
      online: typeof nav.onLine === 'boolean' ? nav.onLine : undefined,
      vw: num(win.innerWidth), vh: num(win.innerHeight),
      net: nav.connection?.effectiveType,
      sid: SID, did,
    };
  };
}

function makeSend(deps) {
  return async (batch) => {
    const body = JSON.stringify(batch);
    let ctl = null, timer = null, signal;
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') signal = AbortSignal.timeout(SEND_TIMEOUT_MS);
    else if (typeof AbortController !== 'undefined') { ctl = new AbortController(); signal = ctl.signal; timer = setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS); }
    const url = proxyBase() + '/v1/clientlog';
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Id': deviceId() }, body, keepalive: byteLen(body) <= KEEPALIVE_MAX_BYTES, signal };
    try {
      const res = deps.fetch ? await deps.fetch(url, opts) : await fetch(url, opts);
      const out = { status: res.status };
      let ra = Number(res.headers?.get?.('Retry-After'));
      if (res.status === 429) {
        try { const j = await res.json(); const r = Number(j?.retryAfterSec); if (Number.isFinite(r) && r > 0) ra = Number.isFinite(ra) && ra > 0 ? Math.max(ra, r) : r; } catch { /* gövde yok/JSON değil */ }
      }
      if (Number.isFinite(ra) && ra > 0) out.retryAfterSec = ra;
      return out;
    } finally { if (timer) clearTimeout(timer); }
  };
}

/** Çekirdeği kurar ve window dinleyicilerini bağlar (idempotent: ikinci çağrı mevcut çekirdeği döner). */
export function initClientLog({ win = window, gate = defaultGate, deps = {} } = {}) {
  if (core) return core;
  setting = deps.setting || defaultSetting;
  const timers = { set: deps.setInterval || ((fn, ms) => win.setInterval(fn, ms)), clear: deps.clearInterval || ((id) => win.clearInterval(id)) };
  const c = createClientLog({
    now: deps.now || (() => Date.now()),
    send: makeSend(deps),
    storage: deps.storage || defaultStorage,
    info: makeInfo(win),
    enabled: () => clientLogEnabled() && !gate(),
    rand: deps.rand || secureRand,
  });
  core = c;
  const num0 = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  const onError = (e) => c.log('js.error', e?.message ?? e?.error, { line: num0(e?.lineno), col: num0(e?.colno) }, 'error');
  const onReject = (e) => { const r = e?.reason; c.log('js.reject', typeof r === 'string' ? r : r?.message, undefined, 'error'); };
  const onVis = () => { if (win.document?.visibilityState === 'hidden') c.flush({ force: true }); };
  const onHide = () => { c.flush({ force: true }); };
  const onOnline = () => { c.flush(); };
  const evs = [['error', onError], ['unhandledrejection', onReject], ['visibilitychange', onVis], ['pagehide', onHide], ['online', onOnline]];
  for (const [n, fn] of evs) win.addEventListener(n, fn);
  const tick = timers.set(() => { c.flush(); }, FLUSH_EVERY_MS);
  teardown = () => { for (const [n, fn] of evs) win.removeEventListener?.(n, fn); try { timers.clear(tick); } catch { /* yoksay */ } };
  c.restore();
  const info = makeInfo(win)();
  c.log('app.start', 'uygulama açıldı', { sa: info.sa, apk: info.apk });
  return c;
}

/** Dinleyicileri söker ve tekil çekirdeği bırakır (testler ve yeniden başlatma için). */
export function disposeClientLog() {
  try { teardown?.(); } catch { /* yoksay */ }
  teardown = null; core = null; setting = defaultSetting;
}

export { LIMITS };
