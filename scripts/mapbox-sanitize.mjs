// Yerel Mapbox Directions yanıt TEMİZLEYİCİ (sanitizer) aracı (BL-P2-05b-1; yerel, çevrimdışı, FAIL-CLOSED, bağımlılıksız).
//
// Kullanım (yalnızca açık argümanlarla; argümansız çalıştırma HİÇBİR dosya okumaz/yazmaz):
//   node scripts/mapbox-sanitize.mjs --input <depo DIŞINDAKİ yanıt.json> --output mapbox-sanitized-<ad>.json
//
// - Girdi: yalnızca kullanıcının açıkça verdiği, depo dışındaki tek bir JSON dosyası (≤ 5 MB). Ağ, anahtar, ortam değişkeni yok;
//   bu araç hiçbir yanıt TOPLAMAZ. Varsayılan girdi yoktur.
// - Çıktı: yalnızca scripts/fixtures/road-events/ içinde, kullanıcının verdiği YENİ ad (mapbox-sanitized-*.json). Üzerine yazma yok.
// - Katı izin listesi kopyası: yalnızca izinli enum değerleri ve yapısal sayılar (mesafe/süre, tam sayıya yuvarlanır) kopyalanır.
//   Adlar, kimlikler (uuid), konum/koordinatlar, geometriler, metinler, URL'ler, zaman damgaları, başlıklar ve izin listesi dışındaki
//   HER alan atılır. İzinli bir enum alanında beklenmeyen değer, yanlış tür ya da sınır aşımı → reddedilir (düşürülmez).
// - Girdinin herhangi bir yerinde sır benzeri değer/anahtar (belirteç, Authorization, access_token, Bearer, JWT…) → tüm girdi reddedilir.
// - Yazmadan önce bağımsız sızıntı taraması (leakScan): çıktıdaki her anahtar/değer izin listesinde olmalı, ham girdi dizeleri,
//   URL, ondalık koordinat, zaman damgası ve belirteç kalıbı bulunmamalı. Herhangi bir bulgu → hiçbir şey yazılmaz.
// - İşaretler: _sanitized:true. Girdi _synthetic === true ise _synthetic:true, _recorded:false; değilse _synthetic:false, _recorded:true.
//   Çıktı ASLA doğrulanmış sayılmaz: _verified:false, _evidence:'unverified' (lisans/şema doğrulaması ayrı karardır).
// - Hiçbir çalışma zamanı dosyası bu aracı içe aktarmaz; js/nav/roadEventsAdapt.js fromMapbox yine 0 olay döndürür.
// Lisans izni olmadan gerçek bir yanıttan üretilen çıktı depoya eklenmemelidir.
import * as nodeFs from 'node:fs';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SANITIZER_VERSION = 1;
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const OUTPUT_NAME_RE = /^mapbox-sanitized-[a-z0-9][a-z0-9-]{0,48}\.json$/;
const MAX_DEPTH = 64;
const MAX_NODES = 2_000_000;
const MAX_NUM = 10_000_000;
const LIMITS = { routes: 5, legs: 100, steps: 10000, intersections: 500, classes: 10, bannerInstructions: 20, components: 50 };

const set = (a) => new Set(a);
export const ENUMS = Object.freeze({
  code: set(['Ok', 'NoRoute', 'NoSegment']),
  maneuverType: set(['turn', 'new name', 'depart', 'arrive', 'merge', 'on ramp', 'off ramp', 'fork', 'end of road', 'continue',
    'roundabout', 'rotary', 'roundabout turn', 'notification', 'exit roundabout', 'exit rotary', 'use lane']),
  modifier: set(['uturn', 'sharp right', 'right', 'slight right', 'straight', 'slight left', 'left', 'sharp left']),
  mode: set(['driving', 'ferry', 'unaccessible']),
  drivingSide: set(['left', 'right']),
  classes: set(['toll', 'ferry', 'restricted', 'motorway', 'tunnel']),
  tollType: set(['toll_booth', 'toll_gantry']),
  componentType: set(['text', 'icon', 'delimiter', 'exit-number', 'exit', 'lane', 'guidance-view']),
});
const META_STRINGS = set(['unverified', 'mapbox-directions']);
const ALL_ENUM = new Set([...Object.values(ENUMS).flatMap((s) => [...s]), ...META_STRINGS]);
const OUT_KEYS = set(['_sanitized', '_recorded', '_synthetic', '_verified', '_evidence', '_source', '_sanitizerVersion',
  'code', 'routes', 'distance', 'duration', 'legs', 'steps', 'maneuver', 'type', 'modifier', 'mode', 'driving_side',
  'exits_present', 'intersections', 'classes', 'toll_collection', 'bannerInstructions', 'primary', 'components']);

const SECRET_KEY_RE = /^(authorization|proxy-authorization|access_token|refresh_token|id_token|token|api[_-]?key|apikey|x-api-key|client_secret|secret|password|cookie|set-cookie)$/i;
const SECRET_VALUE_RES = [
  /(^|[^A-Za-z0-9])(pk|sk|tk)\.[A-Za-z0-9_-]{8,}/,
  /(^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+\S/i,
  /(access_token|refresh_token|api[_-]?key|apikey|client_secret|password|secret|token)\s*[=:]/i,
  /\bAIza[0-9A-Za-z_-]{10,}/,
];

class SanitizeError extends Error {}
const bad = (msg) => { throw new SanitizeError(msg); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Tüm girdiyi dolaşır: derinlik/düğüm sınırı, __proto__/constructor anahtarı ve sır benzeri anahtar/değer → reddedilir.
// Hata iletileri ham değeri/anahtarı İÇERMEZ.
function preScan(input) {
  let nodes = 0;
  const walk = (v, depth) => {
    if (depth > MAX_DEPTH) bad('girdi aşırı derin (depth sınırı); reddedildi');
    if (++nodes > MAX_NODES) bad('girdi düğüm sayısı sınırı (limit) aşıldı; reddedildi');
    if (typeof v === 'string') {
      if (SECRET_VALUE_RES.some((re) => re.test(v))) bad('girdide sır (secret) benzeri değer var; tüm girdi reddedildi');
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
    } else if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') bad('girdide yasak nesne anahtarı var; reddedildi');
        if (SECRET_KEY_RE.test(k)) bad('girdide sır (secret) taşıyan anahtar var (Authorization/token…); tüm girdi reddedildi');
        if (SECRET_VALUE_RES.some((re) => re.test(k))) bad('girdide sır (secret) benzeri anahtar var; tüm girdi reddedildi');
        walk(v[k], depth + 1);
      }
    }
  };
  walk(input, 0);
}

const obj = (v, path) => (isObj(v) ? v : bad(`${path}: nesne (object) bekleniyor`));
const arr = (v, path, max) => {
  if (!Array.isArray(v)) bad(`${path}: dizi (array) bekleniyor`);
  if (v.length > max) bad(`${path}: eleman sınırı (limit ${max}) aşıldı`);
  return v;
};
const num = (v, path) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_NUM) bad(`${path}: geçersiz sayı (number; 0..${MAX_NUM})`);
  return Math.round(v);
};
const en = (v, s, path) => (typeof v === 'string' && s.has(v) ? v : bad(`${path}: izin listesi dışı enum değeri; reddedildi`));

function copyNums(src, dst, path) {
  for (const k of ['distance', 'duration']) if (own(src, k)) dst[k] = num(src[k], `${path}.${k}`);
}

function step(s, path) {
  obj(s, path);
  const o = {};
  copyNums(s, o, path);
  if (own(s, 'maneuver')) {
    const m = obj(s.maneuver, `${path}.maneuver`);
    const mo = {};
    if (own(m, 'type')) mo.type = en(m.type, ENUMS.maneuverType, `${path}.maneuver.type`);
    if (own(m, 'modifier')) mo.modifier = en(m.modifier, ENUMS.modifier, `${path}.maneuver.modifier`);
    o.maneuver = mo;
  }
  if (own(s, 'mode')) o.mode = en(s.mode, ENUMS.mode, `${path}.mode`);
  if (own(s, 'driving_side')) o.driving_side = en(s.driving_side, ENUMS.drivingSide, `${path}.driving_side`);
  if (own(s, 'exits')) {
    // Çıkış numarası/tabela değeri kopyalanmaz; yalnızca alanın varlığı kaydedilir.
    if (typeof s.exits !== 'string' && typeof s.exits !== 'number') bad(`${path}.exits: beklenmeyen tür`);
    o.exits_present = true;
  }
  if (own(s, 'intersections')) {
    o.intersections = arr(s.intersections, `${path}.intersections`, LIMITS.intersections).map((x, i) => {
      const p = `${path}.intersections[${i}]`;
      obj(x, p);
      const io = {};
      if (own(x, 'classes')) io.classes = arr(x.classes, `${p}.classes`, LIMITS.classes).map((c, j) => en(c, ENUMS.classes, `${p}.classes[${j}]`));
      if (own(x, 'toll_collection')) {
        const t = obj(x.toll_collection, `${p}.toll_collection`);
        const to = {};
        if (own(t, 'type')) to.type = en(t.type, ENUMS.tollType, `${p}.toll_collection.type`);
        io.toll_collection = to;
      }
      return io;
    });
  }
  if (own(s, 'bannerInstructions')) {
    o.bannerInstructions = arr(s.bannerInstructions, `${path}.bannerInstructions`, LIMITS.bannerInstructions).map((b, i) => {
      const p = `${path}.bannerInstructions[${i}]`;
      obj(b, p);
      const bo = {};
      if (own(b, 'primary')) {
        const pr = obj(b.primary, `${p}.primary`);
        const po = {};
        if (own(pr, 'components')) {
          po.components = arr(pr.components, `${p}.primary.components`, LIMITS.components).map((c, j) => {
            obj(c, `${p}.primary.components[${j}]`);
            const co = {};
            if (own(c, 'type')) co.type = en(c.type, ENUMS.componentType, `${p}.primary.components[${j}].type`);
            return co;
          });
        }
        bo.primary = po;
      }
      return bo;
    });
  }
  return o;
}

/**
 * Mapbox Directions yanıtı → katı izin listesiyle temizlenmiş nesne. Girdi değiştirilmez. Fail-closed: herhangi bir sorun → hata.
 * İşaretler girdideki iddialardan bağımsızdır; yalnızca input._synthetic === true okunur. Çıktı asla verified değildir.
 */
export function sanitizeMapbox(input) {
  if (!isObj(input)) bad('kök: nesne (object) bekleniyor');
  preScan(input);
  const synthetic = input._synthetic === true;
  const out = {
    _sanitized: true, _recorded: !synthetic, _synthetic: synthetic, _verified: false, _evidence: 'unverified',
    _source: 'mapbox-directions', _sanitizerVersion: SANITIZER_VERSION,
  };
  if (own(input, 'code')) out.code = en(input.code, ENUMS.code, 'code');
  if (!own(input, 'routes')) bad('routes yok; reddedildi');
  out.routes = arr(input.routes, 'routes', LIMITS.routes).map((r, i) => {
    const p = `routes[${i}]`;
    obj(r, p);
    const ro = {};
    copyNums(r, ro, p);
    if (own(r, 'legs')) {
      ro.legs = arr(r.legs, `${p}.legs`, LIMITS.legs).map((l, j) => {
        const lp = `${p}.legs[${j}]`;
        obj(l, lp);
        const lo = {};
        copyNums(l, lo, lp);
        if (own(l, 'steps')) lo.steps = arr(l.steps, `${lp}.steps`, LIMITS.steps).map((s, k) => step(s, `${lp}.steps[${k}]`));
        return lo;
      });
    }
    return ro;
  });
  return out;
}

/**
 * Bağımsız sızıntı taraması. Bulgular dizisi döner (boş = temiz). Bulgu iletileri ham değer içermez.
 */
export function leakScan(input, output) {
  const problems = [];
  const synthetic = isObj(input) && input._synthetic === true;
  if (!isObj(output)) return ['çıktı nesne değil'];
  if (output._sanitized !== true) problems.push('_sanitized true değil');
  if (output._verified !== false) problems.push('_verified false değil');
  if (output._evidence !== 'unverified') problems.push('_evidence unverified değil');
  if (output._synthetic !== synthetic) problems.push('_synthetic girdiyle uyumsuz');
  if (output._recorded !== !synthetic) problems.push('_recorded girdiyle uyumsuz');
  const outStrings = new Set();
  const walk = (v, path) => {
    if (typeof v === 'string') {
      outStrings.add(v);
      if (!ALL_ENUM.has(v)) problems.push(`${path}: izin listesi dışı dize`);
    } else if (typeof v === 'number') {
      if (!Number.isSafeInteger(v) || v < 0 || v > MAX_NUM) problems.push(`${path}: izin dışı sayı`);
    } else if (typeof v === 'boolean') {
      // izinli
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (isObj(v)) {
      for (const k of Object.keys(v)) {
        if (!OUT_KEYS.has(k)) { problems.push(`${path}: izin listesi dışı anahtar`); continue; }
        walk(v[k], `${path}.${k}`);
      }
    } else {
      problems.push(`${path}: izin dışı tür`);
    }
  };
  walk(output, '$');
  const outJ = JSON.stringify(output);
  const rawStrings = [];
  const collect = (v, depth) => {
    if (depth > MAX_DEPTH) return;
    if (typeof v === 'string') { if (!ALL_ENUM.has(v)) rawStrings.push(v); } else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x, depth + 1);
  };
  collect(input, 0);
  for (const s of rawStrings) {
    if (outStrings.has(s) || (s.length >= 6 && outJ.includes(s))) { problems.push('ham girdi dizesi çıktıda'); break; }
  }
  if (/https?:\/\//i.test(outJ)) problems.push('çıktıda URL');
  if (/\d{4}-\d{2}-\d{2}T\d{2}/.test(outJ)) problems.push('çıktıda zaman damgası');
  if (/\d\.\d{3,}/.test(outJ)) problems.push('çıktıda ondalık koordinat benzeri sayı');
  if (SECRET_VALUE_RES.some((re) => re.test(outJ))) problems.push('çıktıda sır benzeri değer');
  return problems;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(REPO_ROOT, 'scripts', 'fixtures', 'road-events');
const USAGE = 'kullanım: node scripts/mapbox-sanitize.mjs --input <depo dışındaki yanıt.json> --output mapbox-sanitized-<ad>.json';

function isInside(child, parent) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const r = relative(norm(parent), norm(child));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) return null;
  const a = {};
  for (let i = 0; i < 4; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if ((k !== '--input' && k !== '--output') || k.slice(2) in a || typeof v !== 'string' || v === '') return null;
    a[k.slice(2)] = v;
  }
  return a.input && a.output ? a : null;
}

/**
 * CLI çekirdeği (test edilebilir). { code, message } döner; code 0 yalnızca dosya yazıldıysa.
 * Argümanlar ve çıktı adı doğrulanmadan HİÇBİR dosya işlemi yapılmaz.
 */
export function runCli(argv, { repoRoot = REPO_ROOT, fixtureDir = FIXTURE_DIR, fs = nodeFs } = {}) {
  const args = parseArgs(argv);
  if (!args) return { code: 2, message: USAGE };
  if (!OUTPUT_NAME_RE.test(args.output)) return { code: 2, message: 'çıktı adı geçersiz: yalnızca scripts/fixtures/road-events/ içinde mapbox-sanitized-<a-z0-9->.json' };
  try {
    const repoReal = fs.realpathSync(repoRoot);
    const fixReal = fs.realpathSync(fixtureDir);
    if (!isInside(fixReal, repoReal)) return { code: 2, message: 'fixture klasörü depo dışında; reddedildi' };
    const target = join(fixReal, args.output);
    if (dirname(target) !== fixReal) return { code: 2, message: 'çıktı fixture klasörü dışında; reddedildi' };
    if (fs.existsSync(target)) return { code: 3, message: 'çıktı zaten var (exists); üzerine yazılmaz' };
    let inReal;
    try { inReal = fs.realpathSync(resolve(args.input)); } catch { return { code: 4, message: 'girdi bulunamadı/okunamadı' }; }
    if (isInside(inReal, repoReal)) return { code: 4, message: 'girdi depo (repo) içinde olamaz; reddedildi' };
    const st = fs.statSync(inReal);
    if (!st.isFile()) return { code: 4, message: 'girdi bir dosya değil' };
    if (st.size > MAX_INPUT_BYTES) return { code: 4, message: 'girdi 5 MB boyut sınırını aşıyor; reddedildi' };
    const raw = fs.readFileSync(inReal, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_INPUT_BYTES) return { code: 4, message: 'girdi 5 MB boyut sınırını aşıyor; reddedildi' };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { code: 5, message: 'geçersiz JSON; reddedildi' }; }
    let out;
    try { out = sanitizeMapbox(parsed); } catch (e) {
      if (e instanceof SanitizeError) return { code: 6, message: `temizleme reddedildi: ${e.message}` };
      return { code: 6, message: 'temizleme reddedildi' };
    }
    const problems = leakScan(parsed, out);
    if (problems.length) return { code: 7, message: `sızıntı taraması başarısız (${problems.length} bulgu); hiçbir şey yazılmadı` };
    try {
      fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    } catch (e) {
      if (e && e.code === 'EEXIST') return { code: 3, message: 'çıktı zaten var (exists); üzerine yazılmaz' };
      return { code: 8, message: 'çıktı yazılamadı' };
    }
    return { code: 0, message: `yazıldı: scripts/fixtures/road-events/${args.output} (_synthetic=${out._synthetic}, _recorded=${out._recorded}, verified DEĞİL)` };
  } catch {
    return { code: 9, message: 'beklenmeyen hata; hiçbir şey yazılmadı' };
  }
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self)) {
  const r = runCli(process.argv.slice(2));
  (r.code === 0 ? console.log : console.error)(r.message);
  process.exit(r.code);
}
