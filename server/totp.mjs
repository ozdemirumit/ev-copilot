// Yönetim ekranı için ikinci adım: TOTP (RFC 6238; HMAC-SHA1, 6 hane, 30 sn) — Microsoft Authenticator ve benzeri uygulamalarla uyumlu.
// Bağımlılık yok. proxy.mjs ADMIN_TOTP_SECRET tanımlı ve geçerliyse createAdminAuth ile kullanır; setup betiği (totp-setup.mjs) base32Encode'u kullanır.
// Gizli anahtar, kodlar ve oturum belirteçleri hiçbir yerde günlüğe yazılmaz; belirteç yalnızca SHA-256 özeti olarak bellekte tutulur.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const MIN_KEY_BYTES = 16; // RFC 4226 R6: en az 128 bit

/** Bayt dizisi → base32 (RFC 4648, dolgu "=" olmadan; büyük harf). */
export function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(val >>> bits) & 31]; }
    val &= (1 << bits) - 1;
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}

/** Katı base32 çözümü: boşluklar yok sayılır, küçük harf büyüğe çevrilir; yalnızca A-Z2-7, geçerli uzunluk, (varsa) doğru dolgu ve sıfır artık bitler kabul edilir. Geçersizse null. */
export function base32Decode(s) {
  if (typeof s !== 'string' || s.length > 1024) return null;
  const m = /^([A-Z2-7]+)(=*)$/.exec(s.replace(/\s+/g, '').toUpperCase());
  if (!m) return null;
  const body = m[1];
  if (![0, 2, 4, 5, 7].includes(body.length % 8)) return null;
  if (m[2] && (body.length + m[2].length) % 8 !== 0) return null;
  let bits = 0, val = 0;
  const out = [];
  for (const c of body) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >>> bits) & 255); }
    val &= (1 << bits) - 1;
  }
  if (val !== 0) return null; // artık bitler sıfır olmalı (aynı anahtarın tek yazımı)
  return Buffer.from(out);
}

/** ADMIN_TOTP_SECRET → anahtar baytları (en az 16 bayt) ya da null (tanımsız/geçersiz). */
export function parseSecret(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const k = base32Decode(s);
  return k && k.length >= MIN_KEY_BYTES ? k : null;
}

/** RFC 4226 HOTP: 6 haneli dize. */
export function hotp(key, counter) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', key).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}

/** RFC 6238 TOTP: t saniye (Unix) anındaki kod (30 sn adım). */
export const totpAt = (key, tSec, step = 30) => hotp(key, Math.floor(tSec / step));

const sha = (s) => createHash('sha256').update(s).digest('hex');
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 bayt base64url

/**
 * Yönetim girişi: TOTP doğrulama (±window adım, sabit süreli karşılaştırma, tekrar oynatma koruması), oturum belirteçleri ve deneme kilidi.
 * secret geçersizse null döner (TOTP kapalı: sunucu bugünkü gibi davranır).
 * now: test için enjekte edilebilen saat (ms).
 */
export function createAdminAuth(secret, {
  now = Date.now, step = 30, window = 1, ttlMs = 12 * 3600e3, maxTokens = 20,
  ipMax = 5, ipBlockMs = 3600e3, globalMax = 25, globalWindowMs = 600e3, globalBlockMs = 600e3,
  stateFile = null, onError = () => {},
} = {}) {
  const key = parseSecret(secret);
  if (!key) return null;

  // ---- TOTP ----
  // Tekrar oynatma: başarıyla kullanılan son adım tutulur; aynı ya da daha eski adımın kodu bir daha kabul edilmez (RFC 6238 §5.2).
  // Tek bir sayı olduğu için büyüyen bir küme ve temizlik gerekmez. stateFile verilirse (DATA_DIR/totp-last.json) yeniden başlatmada da korunur:
  // yalnızca adım numarası yazılır (gizli değildir); dosya yoksa/bozuksa ya da pencerenin ötesinde bir gelecek adımsa (saat geri alınmış) yok sayılır.
  let lastUsed = -Infinity;
  if (stateFile) {
    try {
      const v = JSON.parse(readFileSync(stateFile, 'utf8'))?.lastUsed;
      if (Number.isSafeInteger(v) && v <= Math.floor(now() / 1000 / step) + window) lastUsed = v;
    } catch { /* yok ya da bozuk: boş durum */ }
  }
  /** Kod eşleşen (henüz kullanılmamış) adımı döndürür, yoksa null. Kodu TÜKETMEZ (giriş iki adım da doğruysa consume çağrılır). */
  function matchTotp(code) {
    const s = typeof code === 'string' && code.length <= 32 ? code.replace(/\s+/g, '') : '';
    const wellFormed = /^\d{6}$/.test(s);
    const given = Buffer.from(wellFormed ? s : '------'); // biçimsiz girişte de aynı hesap yapılır (süre farkı yok), eşleşme imkânsız
    const cur = Math.floor(now() / 1000 / step);
    let found = null;
    for (let d = -window; d <= window; d++) { // erken çıkış yok: her adım karşılaştırılır
      const st = cur + d;
      const eq = timingSafeEqual(Buffer.from(hotp(key, st)), given);
      if (eq && wellFormed && st > lastUsed && found === null) found = st;
    }
    return found;
  }
  function consume(st) {
    if (!(st > lastUsed)) return;
    lastUsed = st;
    if (stateFile) try { writeFileSync(stateFile, JSON.stringify({ lastUsed })); } catch (e) { onError(e); }
  }

  // ---- belirteçler (yalnızca SHA-256 özeti bellekte; yeniden başlatma herkesi çıkarır) ----
  const tokens = new Map(); // özet → bitiş (ms)
  const purge = () => { const t = now(); for (const [k, exp] of tokens) if (exp <= t) tokens.delete(k); };
  function issueToken() {
    purge();
    while (tokens.size >= maxTokens) tokens.delete(tokens.keys().next().value); // en eski belirteç düşer
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now() + ttlMs;
    tokens.set(sha(token), expiresAt);
    return { token, expiresAt };
  }
  /** Belirteç geçerli mi? Arama, belirtecin SHA-256 özetiyle yapılır (karşılaştırma süresi belirteç hakkında bilgi vermez). */
  function tokenValid(t) {
    if (typeof t !== 'string' || !TOKEN_RE.test(t)) return false;
    const k = sha(t);
    const exp = tokens.get(k);
    if (exp === undefined) return false;
    if (exp <= now()) { tokens.delete(k); return false; }
    return true;
  }
  /** Çıkış: belirteç sunucuda da geçersiz olur. */
  const revoke = (t) => { if (typeof t === 'string' && TOKEN_RE.test(t)) tokens.delete(sha(t)); };
  /** Her yerden çıkış: tüm belirteçler silinir; silinen sayı döner. */
  const revokeAll = () => { const n = tokens.size; tokens.clear(); return n; };

  // ---- deneme kilidi: adres başına ipMax yanlışta ipBlockMs; tüm adreslerde globalWindowMs içinde globalMax yanlışta globalBlockMs ----
  const ipFails = new Map(); // ip → { n, first, until }
  let gFails = [];
  let gUntil = 0;
  /** Giriş denenebilir mi? 0: evet; değilse beklenecek saniye (Retry-After). */
  function gate(ip) {
    const t = now();
    if (gUntil > t) return Math.ceil((gUntil - t) / 1000);
    const f = ipFails.get(ip);
    if (f && f.until > t) return Math.ceil((f.until - t) / 1000);
    return 0;
  }
  /**
   * Yanlış deneme. countGlobal: yalnızca erişim kodu DOĞRU (TOTP yanlış) denemeler genel sınıra sayılır; yanlış erişim kodu yalnızca adres sınırına sayılır
   * (kodu bilmeyen biri çok adresten deneyerek sahibin girişini kilitleyemesin). Dönüş: yeni açılan kilit 'global' | 'ip' | null.
   */
  function fail(ip, countGlobal = true) {
    const t = now();
    let tripped = null;
    let f = ipFails.get(ip);
    if (!f || (f.until <= t && f.first <= t - ipBlockMs)) f = { n: 0, first: t, until: 0 };
    if (++f.n >= ipMax) { f.until = t + ipBlockMs; f.n = 0; f.first = t; tripped = 'ip'; }
    ipFails.set(ip, f);
    if (countGlobal) {
      gFails = gFails.filter((x) => x > t - globalWindowMs);
      gFails.push(t);
      if (gFails.length >= globalMax) { gUntil = t + globalBlockMs; gFails = []; tripped = 'global'; }
    }
    return tripped;
  }
  const success = (ip) => { ipFails.delete(ip); };
  function sweep() {
    purge();
    const t = now();
    for (const [ip, f] of ipFails) if (f.until <= t && f.first <= t - ipBlockMs) ipFails.delete(ip);
  }

  return { matchTotp, consume, issueToken, tokenValid, revoke, revokeAll, gate, fail, success, sweep, stats: () => ({ tokens: tokens.size, ipFails: ipFails.size }) };
}
