// İstemci günlüğü alıcısı (POST /v1/clientlog arkasındaki iş mantığı). Ağ dinlemez; HTTP katmanı (proxy.mjs) yalnızca ingest() çağırır.
//
// Akış: istemci -> ingest() -> doğrula + temizle -> disk (client-logs/YYYY-MM-DD.jsonl) -> isteğe bağlı ileri gönderme (yerel alıcı).
// Gizlilik: konum, adres, konuşma metni, tam IP ALINMAZ/YAZILMAZ. İleti ve metin değerlerinden URL, e-posta, IP ve enlem/boylam benzeri
// sayılar çıkarılır; .env'deki gizli değerler scrub() ile '***' olur. Şema dışı alan hiçbir zaman yazılmaz.
// İleri gönderme global fetch ile DEĞİL, node:http/https ile yapılır: sunucu fetch'i providerGate.mjs ile loopback dışına kapatılır.
// ingest() ASLA fırlatmaz. Token (forwardToken) yalnızca Authorization başlığına girer; günlüğe/yanıta/denetime asla.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

export const LIMITS = Object.freeze({
  schema: 'evrf-client-log/1',
  bodyBytes: 16000,
  maxEvents: 40,
  msgChars: 300,
  dKeys: 8,
  dTextChars: 60,
  langChars: 8,
  versionChars: 16,
  auditDayBytes: 5 * 1024 * 1024,
  forwardFailedBytes: 2 * 1024 * 1024,
  forwardResponseBytes: 4096,
  levels: Object.freeze(['info', 'warn', 'error']),
  platforms: Object.freeze(['iOS', 'Android', 'Windows', 'Mac', 'Linux', 'other']),
  kRe: /^[a-z][a-z0-9._-]{0,31}$/,
  didRe: /^d_[A-Za-z0-9_-]{16,40}$/,
  sidRe: /^s_[A-Za-z0-9_-]{6,24}$/,
});

const DAY_MS = 86400000;
const MAIN_RE = /^(uploads-)?(\d{4}-\d{2}-\d{2})\.jsonl$/;
const D_KEY_RE = /^[A-Za-z][A-Za-z0-9._-]{0,23}$/;
const NET_RE = /^[A-Za-z0-9-]{1,12}$/;
const LANG_RE = /^[A-Za-z0-9_-]{1,8}$/;
const VER_RE = /^[0-9A-Za-z._+-]{1,16}$/;

// Metin temizliği (sıra önemli: önce gizli değerler, sonra URL, e-posta, IP, konum). Sürüm numarası (0.99.123) bozulmaz.
const URL_RE = /\b(?:https?|wss?|ftp|file|data):[^\s"'<>]*|\bwww\.[^\s"'<>]+/gi;
const MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IP4_RE = /(?<![\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.]*\d)/g;
const GEO_RE = /(?<![\d.])-?\d{1,3}\.\d{3,}(?!\.\d)/g;
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\u0000-\u001f\u007f]/g;

/** IP maskesi: IPv4 son sekizli 0 (a.b.c.0), IPv6 ilk 4 grup + '::'. Tam IP diske yazılmaz. */
export function maskIp(ip) {
  let s = String(ip ?? '').trim();
  if (!s) return 'unknown';
  s = s.replace(/%.*$/, '');
  const m4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(s);
  if (m4) return `${m4[1]}.${m4[2]}.${m4[3]}.0`;
  if (s.includes(':')) {
    const halves = s.split('::');
    if (halves.length > 2) return 'unknown';
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    if (halves.length === 1 && head.length !== 8) return 'unknown';
    const groups = halves.length === 2 ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
    if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return 'unknown';
    return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::';
  }
  return 'unknown';
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const sizeOf = (f) => { try { return statSync(f).size; } catch { return 0; } };

const defaultRequest = (url, options, cb) => (url.protocol === 'https:' ? https : http).request(url, options, cb);

export function createClientLogs({
  dir, scrub = (s) => s, forwardUrl = '', forwardToken = '', dayCapBytes = 50 * 1024 * 1024, keepDays = 30,
  perDevicePerMin = 12, perIpPerMin = 40, now = Date.now, forwardTimeoutMs = 5000, request = defaultRequest,
} = {}) {
  const root = join(dir, 'client-logs');
  const mainFile = (day) => join(root, `${day}.jsonl`);
  const auditFile = (day) => join(root, `uploads-${day}.jsonl`);
  const failedFile = join(root, 'forward-failed.jsonl');
  const workFile = join(root, 'forward-failed.work.jsonl');
  const warnings = [];
  const counters = { accepted: 0, dropped: 0, rejected: 0, forwardOk: 0, forwardFail: 0, forwardDropped: 0 };

  // ---- ileri gönderme ayarı ----
  let fwdUrl = null;
  if (String(forwardUrl || '').trim()) {
    try {
      const u = new URL(String(forwardUrl).trim());
      if (u.protocol === 'http:' || u.protocol === 'https:') fwdUrl = u;
      else warnings.push('CLIENT_LOG_FORWARD_URL http/https değil: ileri gönderme kapalı');
    } catch { warnings.push('CLIENT_LOG_FORWARD_URL geçerli bir adres değil: ileri gönderme kapalı'); }
  }
  const token = String(forwardToken || '');

  const safeScrub = (s) => { try { return String(scrub(s)); } catch { return ''; } };
  /** Metin temizliği: gizli değer, URL, e-posta, IP, konum benzeri sayı çıkar; kontrol karakterlerini sil; kırp. */
  const clean = (s, max) => {
    let t = safeScrub(String(s));
    t = t.replace(URL_RE, '[url]').replace(MAIL_RE, '[eposta]').replace(IP4_RE, '[ip]').replace(GEO_RE, '[konum]').replace(CTRL_RE, ' ').trim();
    return t.length > max ? t.slice(0, max) : t;
  };

  // ---- gün durumu + saklama ----
  let st = { day: '', bytes: 0, audit: 0 };
  const ensureDir = () => { try { mkdirSync(root, { recursive: true }); return true; } catch { return false; } };
  function prune(today) {
    try {
      const cutoff = dayOf(Date.parse(today + 'T00:00:00Z') - keepDays * DAY_MS);
      for (const f of readdirSync(root)) {
        const m = MAIN_RE.exec(f);
        if (m && m[2] < cutoff) { try { unlinkSync(join(root, f)); } catch { /* sonraki sefer */ } }
      }
    } catch { /* klasör yok / okunamadı */ }
  }
  function rollDay(doPrune) {
    const day = dayOf(now());
    if (st.day === day) return st;
    ensureDir();
    st = { day, bytes: sizeOf(mainFile(day)), audit: sizeOf(auditFile(day)) };
    if (doPrune) prune(day);
    return st;
  }
  ensureDir();
  let backlog = existsSync(failedFile) || existsSync(workFile);

  // ---- denetim günlüğü (en çok LIMITS.auditDayBytes/gün; yazma hatası yutulur) ----
  function audit(obj) {
    try {
      const s = rollDay(false);
      const line = JSON.stringify(obj) + '\n';
      const lb = Buffer.byteLength(line);
      if (s.audit + lb > LIMITS.auditDayBytes) return;
      appendFileSync(auditFile(s.day), line);
      s.audit += lb;
    } catch { /* denetim yazılamadı: istemciye yansıtılmaz */ }
  }

  // ---- hız sınırı (bellekte, dakikalık sabit pencere; ham IP yalnızca bellekte) ----
  let win = -1;
  const devHits = new Map();
  const ipHits = new Map();
  function hit(map, key, limit, t) {
    const w = Math.floor(t / 60000);
    if (w !== win) { win = w; devHits.clear(); ipHits.clear(); }
    if (map.size > 20000) map.clear();
    const n = (map.get(key) || 0) + 1;
    map.set(key, n);
    return n > limit ? Math.max(1, Math.ceil(((w + 1) * 60000 - t) / 1000)) : 0;
  }

  // ---- doğrulama ----
  function cleanEvent(e, t) {
    if (!isObj(e)) return null;
    if (!LIMITS.levels.includes(e.lvl)) return null;
    if (typeof e.k !== 'string' || !LIMITS.kRe.test(e.k)) return null;
    if (e.m !== undefined && typeof e.m !== 'string') return null;
    if (e.d !== undefined && !isObj(e.d)) return null;
    let ts = Number.isFinite(e.t) ? Math.trunc(e.t) : t;
    if (ts < t - 30 * DAY_MS || ts > t + DAY_MS) ts = t;
    const out = { t: ts, lvl: e.lvl, k: e.k };
    if (typeof e.m === 'string') { const m = clean(e.m, LIMITS.msgChars); if (m) out.m = m; }
    if (e.d) {
      const d = {};
      let n = 0;
      for (const [key, val] of Object.entries(e.d)) {
        if (n >= LIMITS.dKeys) break;
        if (!D_KEY_RE.test(key)) continue;
        if (typeof val === 'number') { if (!Number.isFinite(val)) continue; d[key] = val; }
        else if (typeof val === 'boolean') d[key] = val;
        else if (typeof val === 'string') d[key] = clean(val, LIMITS.dTextChars);
        else continue;
        n++;
      }
      if (n) out.d = d;
    }
    return out;
  }

  function cleanClient(c, did) {
    const out = {};
    if (typeof c.v === 'string') { const v = c.v.trim(); if (VER_RE.test(v)) out.v = v; }
    out.p = LIMITS.platforms.includes(c.p) ? c.p : 'other';
    if (typeof c.sa === 'boolean') out.sa = c.sa;
    if (typeof c.apk === 'boolean') out.apk = c.apk;
    if (typeof c.lang === 'string' && LANG_RE.test(c.lang.trim())) out.lang = c.lang.trim();
    if (Number.isFinite(c.tz) && Math.abs(c.tz) <= 840) out.tz = Math.trunc(c.tz);
    if (typeof c.online === 'boolean') out.online = c.online;
    if (Number.isFinite(c.vw) && c.vw >= 0 && c.vw <= 20000) out.vw = Math.trunc(c.vw);
    if (Number.isFinite(c.vh) && c.vh >= 0 && c.vh <= 20000) out.vh = Math.trunc(c.vh);
    if (typeof c.net === 'string' && NET_RE.test(c.net.trim())) out.net = c.net.trim();
    if (typeof c.sid === 'string' && LIMITS.sidRe.test(c.sid)) out.sid = c.sid;
    out.did = did;
    return out;
  }

  function validate(body, deviceHeader, t) {
    if (!isObj(body)) return { error: 'gövde geçersiz' };
    if (body.schema !== LIMITS.schema) return { error: 'şema desteklenmiyor' };
    if (!Array.isArray(body.events) || body.events.length === 0) return { error: 'olay yok' };
    const c = isObj(body.client) ? body.client : {};
    const hdr = typeof deviceHeader === 'string' ? deviceHeader.trim() : '';
    const did = typeof c.did === 'string' && LIMITS.didRe.test(c.did) ? c.did : (LIMITS.didRe.test(hdr) ? hdr : '');
    if (!did) return { error: 'cihaz kimliği yok' };
    const events = [];
    let dropped = 0;
    for (let i = 0; i < body.events.length; i++) {
      const ev = i < LIMITS.maxEvents ? cleanEvent(body.events[i], t) : null;
      if (ev) events.push(ev); else dropped++;
    }
    if (!events.length) return { error: 'geçerli olay yok', total: body.events.length, did, client: cleanClient(c, did) };
    return { client: cleanClient(c, did), events, dropped, total: body.events.length, did };
  }

  // ---- ileri gönderme (node:http/https; yönlendirme izlenmez; yanıt gövdesi en çok 4 KB okunur) ----
  function postJson(payload) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let settled = false;
      let timer = null;
      let req = null;
      const done = (ok, status) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve({ ok, status, ms: Date.now() - t0 });
      };
      try {
        const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
        if (token) headers.Authorization = `Bearer ${token}`;
        timer = setTimeout(() => { try { req && req.destroy(); } catch { /* yok say */ } done(false, 0); }, forwardTimeoutMs);
        req = request(fwdUrl, { method: 'POST', headers }, (res) => {
          const status = Number(res.statusCode) || 0;
          let got = 0;
          const fin = () => done(status >= 200 && status < 300, status);
          res.on('data', (c) => { got += c.length; if (got > LIMITS.forwardResponseBytes) { try { res.destroy(); } catch { /* yok say */ } fin(); } });
          res.on('end', fin);
          res.on('close', fin);
          res.on('error', fin);
        });
        req.on('error', () => done(false, 0));
        req.end(payload);
      } catch { done(false, 0); }
    });
  }

  function saveFailed(rec, ref) {
    try {
      const line = JSON.stringify({ ts: new Date(now()).toISOString(), ref, rec }) + '\n';
      if (sizeOf(failedFile) + Buffer.byteLength(line) > LIMITS.forwardFailedBytes) {
        counters.forwardDropped++;
        audit({ ts: new Date(now()).toISOString(), type: 'forward-failed-full', ref });
        return;
      }
      ensureDir();
      appendFileSync(failedFile, line);
      backlog = true;
    } catch { counters.forwardDropped++; }
  }

  const pending = new Set();
  const track = (p) => { pending.add(p); p.then(() => pending.delete(p), () => pending.delete(p)); return p; };
  const refOf = (line) => createHash('sha1').update(line).digest('hex').slice(0, 12);

  function startForward(rec, ref) {
    if (!fwdUrl) return;
    track((async () => {
      try {
        const r = await postJson(JSON.stringify({ src: 'evrf-proxy', ...rec }));
        audit({ ts: new Date(now()).toISOString(), type: 'forward', ok: r.ok, status: r.status, ms: r.ms, ref });
        if (r.ok) {
          counters.forwardOk++;
          if (backlog) flushForwards().catch(() => {});
        } else { counters.forwardFail++; saveFailed(rec, ref); }
      } catch { /* ileri gönderme hatası istemciyi etkilemez */ }
    })());
  }

  let flushing = null;
  /** forward-failed.jsonl'deki kayıtları yeniden dener (başarılılar silinir). İlk hatada durur, kalanı dosyada bırakır. */
  function flushForwards() {
    if (flushing) return flushing;
    flushing = (async () => {
      const res = { tried: 0, ok: 0, failed: 0 };
      if (!fwdUrl) return res;
      try {
        if (existsSync(failedFile)) {
          if (!existsSync(workFile)) renameSync(failedFile, workFile);
          else { appendFileSync(workFile, readFileSync(failedFile)); unlinkSync(failedFile); }
        }
        if (!existsSync(workFile)) { backlog = false; return res; }
        const items = [];
        for (const ln of readFileSync(workFile, 'utf8').split('\n')) {
          if (!ln.trim()) continue;
          try { const o = JSON.parse(ln); if (isObj(o) && isObj(o.rec)) items.push(o); } catch { /* bozuk satır atlanır */ }
        }
        let stopped = false;
        for (const it of items) {
          if (stopped) { saveFailed(it.rec, it.ref); res.failed++; continue; }
          res.tried++;
          const r = await postJson(JSON.stringify({ src: 'evrf-proxy', ...it.rec }));
          audit({ ts: new Date(now()).toISOString(), type: 'forward', ok: r.ok, status: r.status, ms: r.ms, ref: it.ref, retry: true });
          if (r.ok) { counters.forwardOk++; res.ok++; } else { counters.forwardFail++; res.failed++; stopped = true; saveFailed(it.rec, it.ref); }
        }
        try { unlinkSync(workFile); } catch { /* sonraki sefer yeniden işlenir */ }
        backlog = existsSync(failedFile);
      } catch { /* flush hatası yutulur */ }
      return res;
    })().finally(() => { flushing = null; });
    return track(flushing);
  }

  // ---- ana giriş ----
  async function ingest({ body, ip, deviceHeader, bytes } = {}) {
    let row = null;
    try {
      const t = now();
      const s = rollDay(true);
      const nBytes = Number.isFinite(bytes) ? bytes : (() => { try { return Buffer.byteLength(JSON.stringify(body) ?? ''); } catch { return 0; } })();
      const mip = maskIp(ip);
      const ipKey = String(ip ?? 'unknown');
      const hdrDid = typeof deviceHeader === 'string' && LIMITS.didRe.test(deviceHeader.trim()) ? deviceHeader.trim() : null;
      row = { ts: new Date(t).toISOString(), ip: mip, did: hdrDid, sid: null, v: null, p: null, bytes: nBytes, events: Array.isArray(body?.events) ? body.events.length : 0, accepted: 0, dropped: 0, result: 'invalid', status: 400 };
      const reject = (result, status, resp) => {
        row.result = result; row.status = status; counters.rejected++;
        audit(row);
        return { status, body: resp };
      };

      const ipWait = hit(ipHits, ipKey, perIpPerMin, t);
      if (ipWait) return reject('rate', 429, { error: 'çok sık istek', retryAfterSec: ipWait });
      if (nBytes > LIMITS.bodyBytes) return reject('invalid', 400, { error: 'gövde çok büyük' });

      const v = validate(body, deviceHeader, t);
      if (v.did) { row.did = v.did; }
      if (v.client) { row.sid = v.client.sid || null; row.v = v.client.v || null; row.p = v.client.p || null; }
      if (v.error) { row.dropped = v.total || 0; return reject('invalid', 400, { error: v.error }); }
      row.dropped = v.dropped;

      const devWait = hit(devHits, v.did, perDevicePerMin, t);
      if (devWait) { row.dropped = v.total; return reject('rate', 429, { error: 'çok sık istek', retryAfterSec: devWait }); }

      const rec = { rcv: new Date(t).toISOString(), ip: mip, client: v.client, events: v.events };
      const line = JSON.stringify(rec) + '\n';
      const lb = Buffer.byteLength(line);
      if (s.bytes + lb > dayCapBytes) {
        row.dropped = v.total;
        const wait = Math.max(1, Math.ceil((Date.parse(s.day + 'T00:00:00Z') + DAY_MS - t) / 1000));
        return reject('cap', 429, { error: 'günlük kayıt tavanı doldu', retryAfterSec: wait });
      }
      try {
        ensureDir();
        appendFileSync(mainFile(s.day), line);
        s.bytes += lb;
      } catch {
        row.dropped = v.total;
        return reject('error', 500, { error: 'yazılamadı' });
      }
      counters.accepted += v.events.length;
      counters.dropped += v.dropped;
      row.accepted = v.events.length; row.result = 'ok'; row.status = 200;
      audit(row);
      startForward(rec, refOf(line));
      return { status: 200, body: { ok: true, accepted: v.events.length, dropped: v.dropped } };
    } catch {
      try { if (row) { row.result = 'error'; row.status = 500; counters.rejected++; audit(row); } } catch { /* yut */ }
      return { status: 500, body: { error: 'yazılamadı' } };
    }
  }

  function stats() {
    let bytes = 0;
    try { bytes = rollDay(false).bytes; } catch { /* 0 */ }
    return { ...counters, forwardEnabled: !!fwdUrl, today: { bytes }, warnings: [...warnings] };
  }

  /** Uçuştaki ileri gönderme/flush işlemlerinin bitmesini bekler (testler ve düzgün kapanış için). */
  async function idle() { while (pending.size) await Promise.allSettled([...pending]); }

  return { ingest, stats, flushForwards, idle };
}
