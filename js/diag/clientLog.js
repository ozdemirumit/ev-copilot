// İstemci tarafı otomatik log yükleme çekirdeği (SAF: ağ/DOM/depolama/zaman doğrudan okunmaz; now/send/storage/info/enabled enjekte edilir).
// Olaylar kısa, temizlenmiş kayıtlardır: KONUM, adres, konuşma metni, ham OCR değeri, URL, e-posta ve koordinat TUTULMAZ (fieldLog.js gizlilik ilkesi;
// ileti sanitizeMessage ile temizlenir). Kuyruk cihazda kalıcıdır (en çok 100 olay), toplu ve sınırlı gönderilir; hata olursa üstel geri çekilir,
// sunucu reddederse (400/401/403/404/413) toplu istek düşürülür ve 30 dk gönderim durur (sonsuz yeniden deneme yok).
// Sözleşme: POST /v1/clientlog, şema "evrf-client-log/1" (sunucu aynı sınırları uygular). Tarayıcı bağlaması: js/diag/clientLogInit.js.
import { sanitizeMessage } from './fieldLog.js';

export const SCHEMA = 'evrf-client-log/1';
export const QUEUE_KEY = 'clientLogQ';
export const STATE_KEY = 'clientLogS';
export const LIMITS = Object.freeze({
  maxBodyBytes: 16000, // sunucunun kabul ettiği üst sınır
  softBodyBytes: 14000, // istemci bu sınırda keser
  maxEvents: 40, // istek başına
  maxQueue: 100, // cihazda bekleyen
  kRegex: /^[a-z][a-z0-9._-]{0,31}$/,
  mMax: 300,
  dMaxKeys: 8,
  dStrMax: 60,
  sidRegex: /^s_[A-Za-z0-9_-]{6,24}$/,
  didRegex: /^d_[A-Za-z0-9_-]{16,40}$/,
  platforms: Object.freeze(['iOS', 'Android', 'Windows', 'Mac', 'Linux', 'other']),
  levels: Object.freeze(['info', 'warn', 'error']),
  dedupeMs: 60_000,
  ratePerMin: 20,
  backoffBaseMs: 30_000,
  backoffMaxMs: 600_000,
  blockMs: 30 * 60_000,
  retryAfterMaxSec: 3600, // sunucu çok büyük Retry-After verse de en çok 1 sa beklenir
  dropStatuses: Object.freeze([400, 401, 403, 404, 413]),
});

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const D_KEY = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;
const SID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const NETS = ['slow-2g', '2g', '3g', '4g'];

/** UTF-8 bayt uzunluğu (TextEncoder'a bağlı değil). */
export function byteLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; } else n += 3;
  }
  return n;
}

/** Oturum kimliği: s_ + 10 rastgele karakter. rand() ∈ [0,1). */
export function newSessionId(rand = Math.random) {
  let s = 's_';
  for (let i = 0; i < 10; i++) s += SID_ALPHABET[Math.min(63, Math.floor(rand() * 64))];
  return s;
}

/** Olay anahtarı: kurala uymazsa 'other'. */
export const cleanKind = (k) => (typeof k === 'string' && LIMITS.kRegex.test(k) ? k : 'other');

/** Ek veri: ≤ 8 anahtar; yalnız sonlu sayı | boolean | ≤ 60 karakter temizlenmiş metin. İç içe nesne/dizi ve geçersiz anahtar atılır. */
export function cleanData(d, reserved = 'n') {
  const out = {};
  if (!isObj(d)) return out;
  let count = 0;
  for (const [key, v] of Object.entries(d)) {
    if (count >= LIMITS.dMaxKeys) break;
    if (key === reserved || !D_KEY.test(key)) continue;
    if (isNum(v)) { out[key] = v; count++; } else if (typeof v === 'boolean') { out[key] = v; count++; } else if (typeof v === 'string') {
      const s = sanitizeMessage(v);
      if (s === '(boş)' && v !== '(boş)') continue; // yalnız URL/e-posta/koordinattan oluşuyordu: at
      out[key] = s.slice(0, LIMITS.dStrMax); count++;
    }
  }
  return out;
}

/** İstemci bilgisini izinli alan kümesine indirger (fazlalık/geçersiz alan atılır). */
export function cleanClient(c, sidFallback) {
  const x = isObj(c) ? c : {};
  const out = {};
  if (typeof x.v === 'string' && /^[0-9A-Za-z._+-]{1,24}$/.test(x.v)) out.v = x.v;
  out.p = LIMITS.platforms.includes(x.p) ? x.p : 'other';
  if (typeof x.sa === 'boolean') out.sa = x.sa;
  if (typeof x.apk === 'boolean') out.apk = x.apk;
  if (typeof x.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(x.lang)) out.lang = x.lang;
  if (isNum(x.tz) && Math.abs(x.tz) <= 1440) out.tz = Math.round(x.tz);
  if (typeof x.online === 'boolean') out.online = x.online;
  if (isNum(x.vw) && x.vw >= 0 && x.vw <= 20000) out.vw = Math.round(x.vw);
  if (isNum(x.vh) && x.vh >= 0 && x.vh <= 20000) out.vh = Math.round(x.vh);
  if (NETS.includes(x.net)) out.net = x.net;
  out.sid = typeof x.sid === 'string' && LIMITS.sidRegex.test(x.sid) ? x.sid : sidFallback;
  if (typeof x.did === 'string' && LIMITS.didRegex.test(x.did)) out.did = x.did;
  return out;
}

/** Bir olayı (depodan okunan dahil) şemaya uygun hâle getirir; geçersizse null. */
function normEvent(e) {
  if (!isObj(e) || !isNum(e.t) || e.t < 0) return null;
  const lvl = LIMITS.levels.includes(e.lvl) ? e.lvl : 'info';
  const d = cleanData(e.d, '');
  if (isNum(e.d?.n) && e.d.n >= 2) d.n = Math.floor(e.d.n); // yineleme sayacı
  const ev = { t: Math.floor(e.t), lvl, k: cleanKind(e.k), m: sanitizeMessage(typeof e.m === 'string' ? e.m : '').slice(0, LIMITS.mMax) };
  if (Object.keys(d).length) ev.d = d;
  return ev;
}

export function createClientLog({ now, send, storage, info, enabled, rand = Math.random, limits } = {}) {
  const L = { ...LIMITS, ...(limits || {}) };
  const sidFallback = newSessionId(rand);
  let queue = []; // en eski → en yeni
  let stamps = []; // son dakikada oluşan olayların zamanı (hız sınırı)
  let summary = null; // sürmekte olan 'log.dropped' özeti (bir kerelik)
  let inflight = null;
  let fails = 0; // ardışık hata sayısı (üstel geri çekilme)
  let backoffUntil = 0;
  let blockedUntil = 0;
  let sent = 0, dropped = 0, failed = 0;

  const tNow = () => { const t = now(); return isNum(t) ? t : 0; };
  const isOn = () => { try { return !!enabled(); } catch { return false; } };
  const put = (key, value) => { try { storage.set(key, value); } catch { /* depo hatası kaydı bozmasın */ } };
  const persist = () => put(QUEUE_KEY, { v: 1, q: queue });
  const persistState = () => put(STATE_KEY, { v: 1, fails, backoffUntil, blockedUntil });

  const clear = () => {
    const had = queue.length > 0;
    queue = []; stamps = []; summary = null; fails = 0; backoffUntil = 0; blockedUntil = 0;
    if (had) { persist(); persistState(); }
  };
  /** Kapalıysa kuyruğu siler; açıksa true. */
  const gate = () => { if (isOn()) return true; clear(); return false; };

  const trim = () => {
    if (queue.length > L.maxQueue) { const over = queue.length - L.maxQueue; queue = queue.slice(over); dropped += over; }
  };

  function restore() {
    let q = [], s = null;
    try {
      const a = storage.get(QUEUE_KEY);
      if (isObj(a) && Array.isArray(a.q)) q = a.q;
      const b = storage.get(STATE_KEY);
      if (isObj(b)) s = b;
    } catch { /* bozuk/okunamaz depo: boş başla */ }
    if (!isOn()) { if (q.length) { put(QUEUE_KEY, { v: 1, q: [] }); put(STATE_KEY, { v: 1, fails: 0, backoffUntil: 0, blockedUntil: 0 }); } return; }
    const clean = [];
    for (const e of q) { const n = normEvent(e); if (n) clean.push(n); }
    queue = clean; trim();
    if (s) {
      const t = tNow();
      fails = isNum(s.fails) && s.fails >= 0 ? Math.min(Math.floor(s.fails), 30) : 0;
      backoffUntil = isNum(s.backoffUntil) ? Math.min(s.backoffUntil, t + L.backoffMaxMs) : 0;
      blockedUntil = isNum(s.blockedUntil) ? Math.min(s.blockedUntil, t + L.blockMs) : 0;
    }
    if (queue.length !== q.length) persist();
  }

  function addDropped(t) {
    dropped++;
    if (summary && queue.includes(summary)) { summary.d.n = (summary.d.n || 1) + 1; } else {
      summary = { t, lvl: 'warn', k: 'log.dropped', m: 'hız sınırı aşıldı', d: { n: 1 } };
      queue.push(summary); trim();
    }
    persist();
  }

  function add(lvl, k, m, d) {
    if (!gate()) return false;
    const t = tNow();
    const kk = cleanKind(k);
    const mm = sanitizeMessage(m).slice(0, L.mMax);
    const level = L.levels.includes(lvl) ? lvl : 'info';
    // Aynı (k, m, lvl) 60 sn içinde: yeni olay yok, sayaç artar.
    for (let i = queue.length - 1; i >= 0; i--) {
      const e = queue[i];
      if (e === summary) continue;
      if (e.k === kk && e.m === mm && e.lvl === level && t - e.t >= 0 && t - e.t < L.dedupeMs) {
        const n = (e.d && isNum(e.d.n) ? e.d.n : 1) + 1;
        e.d = { ...(e.d || {}), n };
        if (Object.keys(e.d).length > L.dMaxKeys) { const keys = Object.keys(e.d).filter((x) => x !== 'n'); delete e.d[keys[keys.length - 1]]; }
        persist();
        return true;
      }
    }
    stamps = stamps.filter((x) => t - x < 60_000);
    if (stamps.length >= L.ratePerMin) { addDropped(t); return false; }
    summary = null; // pencerede yer var: sonraki aşım yeni özet açar
    stamps.push(t);
    const ev = { t, lvl: level, k: kk, m: mm };
    const dd = cleanData(d);
    if (Object.keys(dd).length) ev.d = dd;
    queue.push(ev); trim();
    persist();
    return true;
  }

  const log = (k, m, d, lvl = 'info') => add(lvl, k, m, d);
  const warn = (k, m, d) => add('warn', k, m, d);
  const error = (k, errOrMsg, d) => add('error', k, errOrMsg, d);

  const backoffDelay = (n) => Math.min(L.backoffBaseMs * 2 ** Math.max(0, n - 1), L.backoffMaxMs);

  /** Kuyruğun başından ≤ maxEvents olay ve ≤ softBodyBytes gövde sığacak toplu istek. */
  function buildBatch() {
    const client = cleanClient((() => { try { return info(); } catch { return {}; } })(), sidFallback);
    for (;;) {
      if (!queue.length) return null;
      const events = [];
      const head = JSON.stringify({ schema: SCHEMA, client, events: [] });
      let size = byteLen(head);
      for (const e of queue) {
        if (events.length >= L.maxEvents) break;
        const add1 = byteLen(JSON.stringify(e)) + 1;
        if (size + add1 > L.softBodyBytes) break;
        size += add1; events.push(e);
      }
      if (events.length) return { batch: { schema: SCHEMA, client, events }, events, bytes: size };
      queue.shift(); dropped++; // tek başına sığmayan olay kuyruğu tıkamasın
      persist();
    }
  }

  async function run() {
    for (let round = 0; round < 5; round++) {
      if (!gate()) return { skipped: 'disabled' };
      const built = buildBatch();
      if (!built) return { sent: 0, skipped: 'empty' };
      const { batch, events } = built;
      let res = null;
      try { res = await send(batch); } catch { res = null; }
      if (!isOn()) { clear(); return { skipped: 'disabled' }; }
      const status = res && isNum(res.status) ? res.status : 0;
      const t = tNow();
      const removeSent = () => { const set = new Set(events); queue = queue.filter((e) => !set.has(e)); };
      if (status >= 200 && status < 300) {
        removeSent(); sent += events.length; fails = 0; backoffUntil = 0;
        persist(); persistState();
        if (!queue.length) return { sent: events.length, status };
        continue; // kalan olaylar için sonraki toplu istek
      }
      failed++;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) { // sunucu reddetti: düşür, 30 dk dur
        removeSent(); dropped += events.length; blockedUntil = t + L.blockMs;
        persist(); persistState();
        return { sent: 0, status, dropped: events.length, blockedUntil };
      }
      fails++;
      let wait = backoffDelay(fails);
      if (status === 429 && isNum(res.retryAfterSec) && res.retryAfterSec > 0) wait = Math.max(wait, Math.min(res.retryAfterSec, L.retryAfterMaxSec) * 1000);
      backoffUntil = t + wait;
      persistState();
      return { sent: 0, status, backoffUntil };
    }
    return { sent: 0, skipped: 'rounds' };
  }

  /** Kuyruğu gönderir. Geri çekilmede (force değilse) ve engelde hiçbir şey yapmaz; aynı anda tek istek uçuşta olur. */
  function flush({ force = false } = {}) {
    if (!gate()) return Promise.resolve({ skipped: 'disabled' });
    if (inflight) return inflight;
    if (!queue.length) return Promise.resolve({ sent: 0, skipped: 'empty' });
    const t = tNow();
    if (t < blockedUntil) return Promise.resolve({ sent: 0, skipped: 'blocked', blockedUntil });
    if (!force && t < backoffUntil) return Promise.resolve({ sent: 0, skipped: 'backoff', backoffUntil });
    inflight = run().catch(() => ({ sent: 0, skipped: 'error' })).finally(() => { inflight = null; });
    return inflight;
  }

  return {
    log, warn, error, flush, restore, clear,
    pending: () => queue.map((e) => (e.d ? { ...e, d: { ...e.d } } : { ...e })),
    state: () => ({ queued: queue.length, backoffUntil, blockedUntil, sent, dropped, failed }),
  };
}
