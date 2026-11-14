// Sağlayıcıdan bağımsız temizleyici (sanitizer) ÇEKİRDEĞİ (BL-P2-05c-1; saf, bağımlılıksız, FAIL-CLOSED, deny-by-default).
//
// - Saf modül: yalnızca node:path içe aktarılır; dosya sistemi, ağ, ortam değişkeni, anahtar YOK. Hiçbir şey okumaz/yazmaz.
//   Yol yardımcıları yalnızca dize/yol hesabı yapar; gerçek yol (realpath) çözümü ve dosya işlemleri çağıranın sorumluluğundadır.
// - preScan: tüm girdiyi dolaşır; derinlik/düğüm sınırı, döngü, düz olmayan nesne, işlev/symbol/bigint/undefined,
//   __proto__/constructor/prototype anahtarı ve (iç içe dahil) sır benzeri anahtar/değer → tüm girdi reddedilir.
// - walkAllowlist(spec): açık izin listesi şemasını doğrular ve kopyalayıcı döndürür. Yalnızca enum, sayı (aralıklı, tam sayıya
//   yuvarlanır), boolean, dizi (eleman sınırlı) ve nesne (adlandırılmış alanlar) desteklenir; serbest dize türü YOKTUR.
//   Konum/koordinat/geometri/kimlik/URL/zaman damgası/ad/sır çağrıştıran alan adları şemada bile kabul edilmez.
//   İzin listesi dışı alan: varsayılan 'reject' (tüm girdi reddedilir); açıkça unknown:'drop' verilirse yalnızca atılır.
// - leakScan: çıktıyı bağımsız denetler (izinli anahtar/dize, güvenli tam sayı, URL/zaman damgası/ondalık/sır kalıbı,
//   ham girdi dizesi, işaretler). Bulgu iletileri ham değer içermez.
// - sanitize: kök nesne → preScan → izin listesi kopyası → işaretler → leakScan; herhangi bir bulgu → hata.
//   Çıktı ASLA doğrulanmış değildir (_verified:false, _evidence:'unverified'); girdideki iddialar yok sayılır,
//   yalnızca input._synthetic === true okunur.
// - Hiçbir çalışma zamanı dosyası bu modülü içe aktarmaz. scripts/mapbox-sanitize.mjs'in bu çekirdeğe göçü ayrı bir iştir.
import * as nodePath from 'node:path';

export const SANITIZER_CORE_VERSION = 1;
export const LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 2_000_000,
  maxNum: 10_000_000,
  maxArray: 100_000,
  maxSpecDepth: 32,
  maxSpecNodes: 2_000,
  maxEnumValues: 200,
  maxNameLen: 128,
});
export const META_KEYS = Object.freeze(['_sanitized', '_recorded', '_synthetic', '_verified', '_evidence', '_source', '_sanitizerVersion']);
const EVIDENCE = 'unverified';
const SOURCE_RE = /^[a-z][a-z0-9-]{1,40}$/;

export class SanitizeError extends Error {}
const bad = (msg) => { throw new SanitizeError(msg); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

const FORBIDDEN_OBJ_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_KEY_RE = /^(authorization|proxy-authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|token|api[_-]?key|apikey|x-api-key|client[_-]?secret|secret|password|passwd|cookie|set-cookie|session|private[_-]?key)$/i;
export const SECRET_VALUE_RES = Object.freeze([
  /(^|[^A-Za-z0-9])(pk|sk|tk)\.[A-Za-z0-9_-]{8,}/,
  /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+\S/i,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/,
  /(access_token|refresh_token|api[_-]?key|apikey|client_secret|password|secret|token|key)\s*[=:]/i,
  /\bAIza[0-9A-Za-z_-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]);
const isSecretLike = (s) => SECRET_VALUE_RES.some((re) => re.test(s));
const URL_RE = /[a-z][a-z0-9+.-]*:\/\//i;
const TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}([T ]\d{2})?/;
const DECIMAL_RE = /\d\.\d/;

// ---------------------------------------------------------------------------------------------------------------------
// preScan
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Tüm girdiyi dolaşır; sorun → SanitizeError. Hata iletileri ham anahtar/değer İÇERMEZ.
 * @param {*} input
 * @param {{maxDepth?:number, maxNodes?:number}} [opts] yalnızca varsayılandan DAHA SIKI sınırlar uygulanır.
 */
export function preScan(input, opts = {}) {
  const maxDepth = Math.min(LIMITS.maxDepth, Number.isInteger(opts.maxDepth) && opts.maxDepth > 0 ? opts.maxDepth : LIMITS.maxDepth);
  const maxNodes = Math.min(LIMITS.maxNodes, Number.isInteger(opts.maxNodes) && opts.maxNodes > 0 ? opts.maxNodes : LIMITS.maxNodes);
  let nodes = 0;
  const stack = new Set();
  const walk = (v, depth) => {
    if (depth > maxDepth) bad('girdi aşırı derin (depth sınırı); reddedildi');
    if (++nodes > maxNodes) bad('girdi düğüm sayısı sınırı (limit) aşıldı; reddedildi');
    const t = typeof v;
    if (v === null || t === 'boolean') return;
    if (t === 'number') { if (!Number.isFinite(v)) bad('girdide sonlu olmayan sayı; reddedildi'); return; }
    if (t === 'string') { if (isSecretLike(v)) bad('girdide sır (secret) benzeri değer var; tüm girdi reddedildi'); return; }
    if (t !== 'object') bad('girdide izin dışı tür (işlev/symbol/bigint/undefined); reddedildi');
    if (stack.has(v)) bad('girdide döngüsel başvuru; reddedildi');
    stack.add(v);
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) bad('girdide düz olmayan dizi; reddedildi');
      for (let i = 0; i < v.length; i++) walk(v[i], depth + 1);
    } else {
      if (!isPlain(v)) bad('girdide düz olmayan nesne (Date/Map/sınıf); reddedildi');
      if (Object.getOwnPropertySymbols(v).length) bad('girdide symbol anahtarı; reddedildi');
      for (const k of Object.keys(v)) {
        if (FORBIDDEN_OBJ_KEYS.has(k)) bad('girdide yasak nesne anahtarı (prototip kirlenmesi) var; reddedildi');
        if (SECRET_KEY_RE.test(k)) bad('girdide sır (secret) taşıyan anahtar var (Authorization/token…); tüm girdi reddedildi');
        if (isSecretLike(k)) bad('girdide sır (secret) benzeri anahtar var; tüm girdi reddedildi');
        walk(v[k], depth + 1);
      }
    }
    stack.delete(v);
  };
  walk(input, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Şema (spec) doğrulama
// ---------------------------------------------------------------------------------------------------------------------

const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_WORDS = new Set([
  'id', 'ids', 'uuid', 'guid', 'uid', 'lat', 'lng', 'lon', 'long', 'latitude', 'longitude', 'coord', 'coords', 'coordinate',
  'coordinates', 'geometry', 'geometries', 'geojson', 'polyline', 'location', 'locations', 'position', 'positions', 'bbox',
  'waypoint', 'waypoints', 'url', 'urls', 'uri', 'href', 'link', 'links', 'timestamp', 'timestamps', 'date', 'datetime',
  'created', 'updated', 'name', 'names', 'address', 'email', 'phone', 'token', 'tokens', 'key', 'keys', 'apikey', 'secret',
  'password', 'auth', 'authorization', 'cookie', 'header', 'headers', 'session', 'user', 'device', 'ip', 'mac',
]);
const FORBIDDEN_SUBSTR = ['location', 'coord', 'geometr', 'geojson', 'polyline', 'url', 'timestamp', 'token', 'secret',
  'password', 'apikey', 'latitude', 'longitude', 'uuid', 'email'];
const nameWords = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').toLowerCase().split(/_+/).filter(Boolean);

function checkFieldName(n) {
  if (!FIELD_NAME_RE.test(n)) bad('şema: geçersiz alan adı (yalnızca harf ile başlayan [A-Za-z0-9_]; _ önekli adlar işaretlere ayrılmıştır)');
  const low = n.toLowerCase();
  if (FORBIDDEN_OBJ_KEYS.has(low) || SECRET_KEY_RE.test(n) || isSecretLike(n)) bad('şema: yasak/sır alan adı');
  if (nameWords(n).some((w) => FORBIDDEN_WORDS.has(w)) || FORBIDDEN_SUBSTR.some((s) => low.includes(s)))
    bad('şema: konum/koordinat/geometri/kimlik/URL/zaman damgası/ad/sır alanı izin listesine konamaz');
}

const ENUM_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
function checkEnumValue(v) {
  if (typeof v !== 'string' || !ENUM_VALUE_RE.test(v)) bad('şema: enum değeri geçersiz biçim');
  if (isSecretLike(v) || URL_RE.test(v) || TIMESTAMP_RE.test(v) || DECIMAL_RE.test(v)) bad('şema: enum değeri sır/URL/zaman damgası/ondalık olamaz');
  if (v === EVIDENCE) bad('şema: enum değeri ayrılmış işaret değeri olamaz');
}

const NODE_KEYS = {
  object: ['type', 'fields', 'required'],
  array: ['type', 'max', 'items'],
  number: ['type', 'min', 'max', 'integer'],
  enum: ['type', 'values'],
  boolean: ['type'],
};
const isBoundInt = (x) => Number.isSafeInteger(x) && Math.abs(x) <= LIMITS.maxNum;

/** Şemayı doğrular; geçersizse SanitizeError. Derinlik/düğüm sınırı ve döngü denetimi yapılır. */
export function validateSpec(spec) {
  let count = 0;
  const stack = new Set();
  const visit = (s, depth) => {
    if (depth > LIMITS.maxSpecDepth) bad('şema aşırı derin (depth sınırı)');
    if (++count > LIMITS.maxSpecNodes) bad('şema düğüm sınırı aşıldı');
    if (!isPlain(s)) bad('şema düğümü düz nesne olmalı');
    if (stack.has(s)) bad('şemada döngü var');
    const keys = Object.keys(s);
    if (keys.some((k) => FORBIDDEN_OBJ_KEYS.has(k))) bad('şemada yasak anahtar');
    const allowed = typeof s.type === 'string' && own(NODE_KEYS, s.type) ? NODE_KEYS[s.type] : null;
    if (!allowed) bad('şema: bilinmeyen tür (yalnızca object/array/number/enum/boolean)');
    if (keys.some((k) => !allowed.includes(k))) bad('şema: düğümde bilinmeyen anahtar');
    stack.add(s);
    switch (s.type) {
      case 'object': {
        if (!isPlain(s.fields)) bad('şema: object için fields gerekli');
        const names = Object.keys(s.fields);
        if (!names.length) bad('şema: fields boş olamaz');
        if (Object.getOwnPropertySymbols(s.fields).length) bad('şema: symbol alan adı');
        for (const n of names) { checkFieldName(n); visit(s.fields[n], depth + 1); }
        if (own(s, 'required')) {
          if (!Array.isArray(s.required) || s.required.some((r) => typeof r !== 'string' || !names.includes(r))) bad('şema: required yalnızca tanımlı alanları içerebilir');
        }
        break;
      }
      case 'array':
        if (!Number.isSafeInteger(s.max) || s.max < 0 || s.max > LIMITS.maxArray) bad(`şema: array max 0..${LIMITS.maxArray} tam sayı olmalı`);
        visit(s.items, depth + 1);
        break;
      case 'number':
        if (!isBoundInt(s.min) || !isBoundInt(s.max) || s.min > s.max) bad(`şema: number min/max ±${LIMITS.maxNum} içinde tam sayı ve min ≤ max olmalı`);
        if (own(s, 'integer') && typeof s.integer !== 'boolean') bad('şema: integer boolean olmalı');
        break;
      case 'enum':
        if (!Array.isArray(s.values) || !s.values.length || s.values.length > LIMITS.maxEnumValues) bad('şema: enum values 1..200 eleman olmalı');
        s.values.forEach(checkEnumValue);
        break;
      default:
        break;
    }
    stack.delete(s);
  };
  visit(spec, 0);
  return true;
}

function collectSpec(spec) {
  const keys = new Set(META_KEYS);
  const enums = new Set();
  const visit = (s) => {
    if (s.type === 'object') for (const [n, c] of Object.entries(s.fields)) { keys.add(n); visit(c); }
    else if (s.type === 'array') visit(s.items);
    else if (s.type === 'enum') for (const v of s.values) enums.add(v);
  };
  visit(spec);
  return { keys, enums };
}

// ---------------------------------------------------------------------------------------------------------------------
// İzin listesi kopyası
// ---------------------------------------------------------------------------------------------------------------------

const UNKNOWN_MODES = new Set(['reject', 'drop']);

/**
 * Şemayı doğrular ve (value, {unknown}) → izinli kopya döndüren işlev üretir. Kopyalayıcı preScan YAPMAZ (bkz. sanitize).
 * Hata yolları yalnızca şemadaki alan adlarını ve dizinleri içerir; ham girdi anahtarı/değeri içermez.
 */
export function walkAllowlist(spec) {
  validateSpec(spec);
  const copy = (s, v, path, unknown) => {
    switch (s.type) {
      case 'enum':
        if (typeof v !== 'string' || !s.values.includes(v)) bad(`${path}: izin listesi dışı enum değeri; reddedildi`);
        return v;
      case 'boolean':
        if (typeof v !== 'boolean') bad(`${path}: boolean bekleniyor`);
        return v;
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v)) bad(`${path}: sayı (number) bekleniyor`);
        if (s.integer && !Number.isInteger(v)) bad(`${path}: tam sayı bekleniyor`);
        if (v < s.min || v > s.max) bad(`${path}: aralık dışı sayı (${s.min}..${s.max})`);
        const r = Math.round(v);
        return r === 0 ? 0 : r; // -0 → 0
      }
      case 'array':
        if (!Array.isArray(v)) bad(`${path}: dizi (array) bekleniyor`);
        if (v.length > s.max) bad(`${path}: eleman sınırı (limit ${s.max}) aşıldı`);
        return v.map((x, i) => copy(s.items, x, `${path}[${i}]`, unknown));
      case 'object': {
        if (!isPlain(v)) bad(`${path}: nesne (object) bekleniyor`);
        for (const r of s.required || []) if (!own(v, r)) bad(`${path}.${r}: zorunlu alan yok; reddedildi`);
        const o = {};
        for (const k of Object.keys(v)) {
          if (!own(s.fields, k)) {
            if (unknown === 'reject') bad(`${path}: izin listesi dışı alan; reddedildi`);
            continue;
          }
          o[k] = copy(s.fields[k], v[k], `${path}.${k}`, unknown);
        }
        return o;
      }
      default:
        return bad('şema: bilinmeyen tür');
    }
  };
  return (value, { unknown = 'reject' } = {}) => {
    if (!UNKNOWN_MODES.has(unknown)) bad("unknown kipi yalnızca 'reject' ya da 'drop'");
    return copy(spec, value, '$', unknown);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// leakScan
// ---------------------------------------------------------------------------------------------------------------------

/** Bağımsız sızıntı taraması. Bulgu dizisi döner (boş = temiz). Bulgular ham değer içermez. */
export function leakScan(input, output, spec) {
  const problems = [];
  try { validateSpec(spec); } catch { return ['şema geçersiz']; }
  if (!isPlain(output)) return ['çıktı nesne değil'];
  const { keys, enums } = collectSpec(spec);
  const synthetic = isPlain(input) && input._synthetic === true;
  if (output._sanitized !== true) problems.push('_sanitized true değil');
  if (output._verified !== false) problems.push('_verified false değil');
  if (output._evidence !== EVIDENCE) problems.push('_evidence unverified değil');
  if (output._synthetic !== synthetic) problems.push('_synthetic girdiyle uyumsuz');
  if (output._recorded !== !synthetic) problems.push('_recorded girdiyle uyumsuz');
  if (typeof output._source !== 'string' || !SOURCE_RE.test(output._source) || isSecretLike(output._source)) problems.push('_source geçersiz');
  if (output._sanitizerVersion !== SANITIZER_CORE_VERSION) problems.push('_sanitizerVersion geçersiz');
  const outStrings = new Set();
  let nodes = 0;
  const walk = (v, path, depth) => {
    if (depth > LIMITS.maxDepth || ++nodes > LIMITS.maxNodes) { problems.push('çıktı sınırları aşıyor'); return; }
    if (typeof v === 'string') {
      outStrings.add(v);
      const okStr = path === '$._source' ? true : path === '$._evidence' ? v === EVIDENCE : enums.has(v);
      if (!okStr) problems.push(`${path}: izin listesi dışı dize`);
    } else if (typeof v === 'number') {
      if (!Number.isSafeInteger(v) || Math.abs(v) > LIMITS.maxNum) problems.push(`${path}: izin dışı sayı`);
    } else if (typeof v === 'boolean') {
      // izinli
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    } else if (isPlain(v)) {
      for (const k of Object.keys(v)) {
        if (!keys.has(k) || (META_KEYS.includes(k) && path !== '$')) { problems.push(`${path}: izin listesi dışı anahtar`); continue; }
        walk(v[k], `${path}.${k}`, depth + 1);
      }
    } else {
      problems.push(`${path}: izin dışı tür`);
    }
  };
  walk(output, '$', 0);
  let outJ = '';
  try { outJ = JSON.stringify(output); } catch { problems.push('çıktı serileştirilemedi'); }
  const raw = [];
  let rawNodes = 0;
  const collect = (v, depth) => {
    if (depth > LIMITS.maxDepth || ++rawNodes > LIMITS.maxNodes) return;
    if (typeof v === 'string') { if (!enums.has(v) && v !== EVIDENCE) raw.push(v); } else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x, depth + 1);
  };
  collect(input, 0);
  // Yalnızca izinli sabit sözcük dağarcığının (enum, alan/işaret adları) parçası olan ham dize bilgi taşımaz; diğerleri çıktıda olamaz.
  const vocab = [...enums, ...keys, EVIDENCE];
  for (const s of raw) {
    if (vocab.some((w) => w.includes(s))) continue;
    if (outStrings.has(s) || (s.length >= 6 && outJ.includes(s))) { problems.push('ham girdi dizesi çıktıda'); break; }
  }
  if (URL_RE.test(outJ)) problems.push('çıktıda URL');
  if (TIMESTAMP_RE.test(outJ)) problems.push('çıktıda zaman damgası');
  if (DECIMAL_RE.test(outJ)) problems.push('çıktıda ondalık (koordinat benzeri) sayı');
  if (isSecretLike(outJ)) problems.push('çıktıda sır benzeri değer');
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------------
// sanitize (birleşik, fail-closed)
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Girdi → izin listesiyle temizlenmiş nesne. Girdi değiştirilmez. Herhangi bir sorun → SanitizeError.
 * @param {object} input
 * @param {object} spec kök türü 'object' olmalı
 * @param {{source:string, unknown?:'reject'|'drop', maxDepth?:number, maxNodes?:number}} opts
 */
export function sanitize(input, spec, opts = {}) {
  const { source, unknown = 'reject' } = opts || {};
  if (typeof source !== 'string' || !SOURCE_RE.test(source) || isSecretLike(source)) bad('source geçersiz (a-z0-9- biçiminde olmalı)');
  if (!UNKNOWN_MODES.has(unknown)) bad("unknown kipi yalnızca 'reject' ya da 'drop'");
  const run = walkAllowlist(spec);
  if (spec.type !== 'object') bad('şema kökü object olmalı');
  if (!isPlain(input)) bad('kök: nesne (object) bekleniyor');
  preScan(input, opts);
  const synthetic = input._synthetic === true;
  // Kökteki işaret anahtarları (_synthetic vb.) içerik değildir: kopyalanmaz; yalnızca _synthetic === true okunur, diğer iddialar yok sayılır.
  const view = {};
  for (const k of Object.keys(input)) if (!META_KEYS.includes(k)) view[k] = input[k];
  const body = run(view, { unknown });
  const out = {
    _sanitized: true, _recorded: !synthetic, _synthetic: synthetic, _verified: false, _evidence: EVIDENCE,
    _source: source, _sanitizerVersion: SANITIZER_CORE_VERSION,
  };
  for (const k of Object.keys(body)) out[k] = body[k];
  const problems = leakScan(input, out, spec);
  if (problems.length) bad(`sızıntı taraması başarısız (${problems.length} bulgu); reddedildi`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Saf yol doğrulama yardımcıları (dosya sistemi erişimi YOK; çağıran realpath ile çözülmüş yolları vermelidir)
// ---------------------------------------------------------------------------------------------------------------------

const pathLib = (platform) => {
  const p = platform === undefined ? (process.platform === 'win32' ? 'win32' : 'posix') : platform;
  return p === 'win32' ? { lib: nodePath.win32, ci: true } : p === 'posix' ? { lib: nodePath.posix, ci: false } : null;
};
const hasCtrl = (s) => /[\u0000-\u001f]/.test(s);

/** Çıktı dosya adı: yalnızca düz ad (ayraç, sürücü, NUL, '..' yok) ve verilen desene tam uyum. */
export function validateOutputName(name, nameRe) {
  if (typeof name !== 'string' || !(nameRe instanceof RegExp)) return false;
  if (!name || name.length > LIMITS.maxNameLen || hasCtrl(name) || /[\\/:]/.test(name) || name === '.' || name === '..') return false;
  nameRe.lastIndex = 0;
  const m = nameRe.test(name);
  nameRe.lastIndex = 0;
  return m;
}

/** child, parent'ın içinde (ya da kendisi) mi? Her iki yol da mutlak olmalı. win32'de büyük/küçük harf duyarsız. */
export function isInside(child, parent, platform) {
  const P = pathLib(platform);
  if (!P || typeof child !== 'string' || typeof parent !== 'string' || hasCtrl(child) || hasCtrl(parent)) return false;
  const { lib, ci } = P;
  if (!lib.isAbsolute(child) || !lib.isAbsolute(parent)) return false;
  const n = (x) => (ci ? lib.resolve(x).toLowerCase() : lib.resolve(x));
  const r = lib.relative(n(parent), n(child));
  return r === '' || (r !== '..' && !r.startsWith('..' + lib.sep) && !lib.isAbsolute(r));
}

/** Çıktı hedefi: outDir mutlak ve repoRoot içinde, ad desene uygun, hedef doğrudan outDir altında. */
export function resolveOutputTarget({ repoRoot, outDir, name, nameRe, platform } = {}) {
  const P = pathLib(platform);
  if (!P) return { ok: false, reason: 'bilinmeyen platform' };
  const { lib } = P;
  if (typeof repoRoot !== 'string' || typeof outDir !== 'string' || !lib.isAbsolute(repoRoot) || !lib.isAbsolute(outDir)) return { ok: false, reason: 'yollar mutlak olmalı' };
  if (!isInside(outDir, repoRoot, platform)) return { ok: false, reason: 'çıktı klasörü depo dışında' };
  if (!validateOutputName(name, nameRe)) return { ok: false, reason: 'çıktı adı geçersiz' };
  const dir = lib.resolve(outDir);
  const target = lib.join(dir, name);
  if (lib.dirname(target) !== dir || !isInside(target, dir, platform)) return { ok: false, reason: 'çıktı klasör dışında' };
  return { ok: true, path: target };
}

/** Girdi yolu: mutlak, .json, .env* değil, depo DIŞINDA. Dosyanın varlığı/boyutu çağıran tarafından denetlenir. */
export function validateInputPath({ inputPath, repoRoot, platform } = {}) {
  const P = pathLib(platform);
  if (!P) return { ok: false, reason: 'bilinmeyen platform' };
  const { lib } = P;
  if (typeof inputPath !== 'string' || !inputPath || hasCtrl(inputPath) || !lib.isAbsolute(inputPath)) return { ok: false, reason: 'girdi yolu mutlak olmalı' };
  if (typeof repoRoot !== 'string' || !lib.isAbsolute(repoRoot)) return { ok: false, reason: 'depo kökü mutlak olmalı' };
  const base = lib.basename(inputPath).toLowerCase();
  if (base.startsWith('.env')) return { ok: false, reason: 'ortam dosyası okunmaz' };
  if (lib.extname(base) !== '.json') return { ok: false, reason: 'girdi .json olmalı' };
  if (isInside(inputPath, repoRoot, platform)) return { ok: false, reason: 'girdi depo içinde olamaz' };
  return { ok: true, path: lib.resolve(inputPath) };
}
