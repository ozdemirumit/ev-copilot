// Sağlayıcıdan bağımsız temizleyici ÇEKİRDEĞİ testleri (BL-P2-05c-1; bağımlılıksız, düz node): node scripts/test-sanitize-core.mjs
// Yalnızca test içinde üretilen SENTETİK ve kötü niyetli girdiler kullanılır; gerçek sağlayıcı verisi, ağ, anahtar yok.
// Diske hiçbir şey yazılmaz; yol denetimleri saf yardımcılarla (dosya sistemi erişimi olmadan) sınanır.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}
const throws = (fn, re) => {
  try { fn(); return false; } catch (e) { return re ? re.test(String(e && e.message)) : true; }
};
const errMsg = (fn) => { try { fn(); return ''; } catch (e) { return String(e && e.message); } };

// Ağ engeli
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(root, 'scripts', 'sanitize-core.mjs'), 'utf8');
const C = await import('./sanitize-core.mjs');
const { preScan, leakScan, walkAllowlist, sanitize, validateSpec, validateOutputName, isInside, resolveOutputTarget,
  validateInputPath, SanitizeError, LIMITS, META_KEYS } = C;

// --- modül yüzeyi / bağımlılıksızlık / disk erişimi yok
{
  ok('dışa aktarımlar mevcut', [preScan, leakScan, walkAllowlist, sanitize, validateSpec, validateOutputName, isInside,
    resolveOutputTarget, validateInputPath].every((f) => typeof f === 'function') && typeof SanitizeError === 'function');
  const imports = [...SRC.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  ok('yalnızca node:path içe aktarılır (fs/ağ/child_process yok)', imports.every((m) => m === 'node:path'), imports.join(','));
  ok('dinamik import / require / fetch / process.env yok', !/\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|process\.env/.test(SRC));
  ok('LIMITS dondurulmuş', Object.isFrozen(LIMITS) && LIMITS.maxDepth > 0 && LIMITS.maxNodes > 0);
}

// --- sentetik izin listesi şeması
const SPEC = {
  type: 'object',
  required: ['items'],
  fields: {
    status: { type: 'enum', values: ['ok', 'none'] },
    total: { type: 'number', min: 0, max: 100000 },
    items: {
      type: 'array', max: 5,
      items: {
        type: 'object',
        fields: {
          kind: { type: 'enum', values: ['alpha', 'beta'] },
          distance: { type: 'number', min: 0, max: 1000000 },
          level: { type: 'number', min: -10, max: 10, integer: true },
          flagged: { type: 'boolean' },
          tags: { type: 'array', max: 3, items: { type: 'enum', values: ['x', 'y'] } },
        },
      },
    },
  },
};
const good = () => ({
  _synthetic: true, status: 'ok', total: 12.4,
  items: [{ kind: 'alpha', distance: 120.6, level: -2, flagged: true, tags: ['x', 'y'], extra: 'drop me?' }],
});

// --- şema doğrulaması (spec)
{
  ok('geçerli şema kabul edilir', !throws(() => validateSpec(SPEC)));
  const run = walkAllowlist(SPEC);
  ok('walkAllowlist işlev döndürür', typeof run === 'function');
  const badSpecs = {
    'bilinmeyen tür': { type: 'string' },
    'nesne alanı yok': { type: 'object' },
    'koordinat alanı': { type: 'object', fields: { lat: { type: 'number', min: 0, max: 90 } } },
    'coordinates alanı': { type: 'object', fields: { coordinates: { type: 'array', max: 2, items: { type: 'number', min: 0, max: 1 } } } },
    'geometry alanı': { type: 'object', fields: { geometry: { type: 'boolean' } } },
    'location alanı': { type: 'object', fields: { startLocation: { type: 'boolean' } } },
    'id alanı': { type: 'object', fields: { id: { type: 'number', min: 0, max: 9 } } },
    'x_id alanı': { type: 'object', fields: { station_id: { type: 'number', min: 0, max: 9 } } },
    'uuid alanı': { type: 'object', fields: { uuid: { type: 'boolean' } } },
    'url alanı': { type: 'object', fields: { url: { type: 'boolean' } } },
    'timestamp alanı': { type: 'object', fields: { timestamp: { type: 'number', min: 0, max: 9 } } },
    'name alanı': { type: 'object', fields: { name: { type: 'enum', values: ['a'] } } },
    'token alanı': { type: 'object', fields: { access_token: { type: 'boolean' } } },
    'proto alanı': { type: 'object', fields: JSON.parse('{"__proto__":{"type":"boolean"}}') },
    'meta alanı taklidi': { type: 'object', fields: { _verified: { type: 'boolean' } } },
    'enum URL': { type: 'enum', values: ['https://x.example'] },
    'enum zaman damgası': { type: 'enum', values: ['2026-01-01T00:00'] },
    'enum sır': { type: 'enum', values: ['pk.abcdefghijklmnop'] },
    'enum boş': { type: 'enum', values: [] },
    'enum ondalık': { type: 'enum', values: ['41.0123'] },
    'sayı sınırsız': { type: 'number', min: 0 },
    'sayı aralık ters': { type: 'number', min: 5, max: 1 },
    'sayı aralık aşırı': { type: 'number', min: 0, max: 1e12 },
    'dizi sınırsız': { type: 'array', items: { type: 'boolean' } },
    'dizi sınır aşırı': { type: 'array', max: 1e9, items: { type: 'boolean' } },
    'bilinmeyen şema anahtarı': { type: 'boolean', copyAll: true },
    'required alanı yok': { type: 'object', fields: { a: { type: 'boolean' } }, required: ['b'] },
  };
  for (const [n, s] of Object.entries(badSpecs)) ok(`şema reddedilir: ${n}`, throws(() => walkAllowlist(s)));
  let deep = { type: 'boolean' };
  for (let i = 0; i < 40; i++) deep = { type: 'array', max: 1, items: deep };
  ok('şema derinlik sınırı', throws(() => validateSpec(deep), /derin|depth/i));
  const cyc = { type: 'object', fields: {} }; cyc.fields.self = cyc;
  ok('döngüsel şema reddedilir', throws(() => validateSpec(cyc)));
}

// --- olumlu yol: yalnızca izinli sayısal/enum alanlar
{
  const input = good();
  const before = JSON.stringify(input);
  const out = sanitize(input, SPEC, { source: 'synthetic-test', unknown: 'drop' });
  ok('girdi değiştirilmez', JSON.stringify(input) === before);
  ok('izinli enum kopyalanır', out.status === 'ok' && out.items[0].kind === 'alpha');
  ok('sayı tam sayıya yuvarlanır', out.total === 12 && out.items[0].distance === 121);
  ok('negatif izinli tam sayı', out.items[0].level === -2);
  ok('boolean kopyalanır', out.items[0].flagged === true);
  ok('enum dizisi kopyalanır', JSON.stringify(out.items[0].tags) === '["x","y"]');
  ok('drop kipinde izinsiz alan atılır', !('extra' in out.items[0]));
  ok('işaretler: _sanitized, sentetik, verified değil',
    out._sanitized === true && out._synthetic === true && out._recorded === false && out._verified === false && out._evidence === 'unverified');
  ok('_source ve sürüm', out._source === 'synthetic-test' && Number.isInteger(out._sanitizerVersion));
  ok('çıktı prototipi Object (kirlenme yok)', Object.getPrototypeOf(out) === Object.prototype && Object.getPrototypeOf(out.items[0]) === Object.prototype);
  ok('leakScan temiz', leakScan(input, out, SPEC).length === 0, leakScan(input, out, SPEC).join('; '));
  const nonSyn = good(); delete nonSyn._synthetic;
  const o2 = sanitize(nonSyn, SPEC, { source: 'synthetic-test', unknown: 'drop' });
  ok('_synthetic yoksa recorded true, yine verified değil', o2._synthetic === false && o2._recorded === true && o2._verified === false);
  const liar = { ...good(), _verified: true, _evidence: 'verified', _sanitized: false, _synthetic: 'yes' };
  const o3 = sanitize(liar, SPEC, { source: 'synthetic-test', unknown: 'drop' });
  ok('girdideki verified iddiası yok sayılır', o3._verified === false && o3._evidence === 'unverified' && o3._sanitized === true);
  ok('_synthetic yalnızca === true ile', o3._synthetic === false);
  ok('opsiyonel alan yoksa çıktıda da yok', !('status' in sanitize({ items: [] }, SPEC, { source: 'synthetic-test' })));
}

// --- varsayılan: izinsiz alan → REDDET (deny-by-default)
{
  ok('varsayılan kipte izinsiz alan reddedilir', throws(() => sanitize(good(), SPEC, { source: 'synthetic-test' }), /izin/));
  const g = good(); delete g.items[0].extra;
  ok('izinsiz alan yoksa varsayılan kip geçer', !throws(() => sanitize(g, SPEC, { source: 'synthetic-test' })));
  const sensitive = {
    coordinates: [29.0123, 41.0456], location: { lat: 41.01, lon: 29.02 }, geometry: 'abc}~polyline', id: 'r-1',
    uuid: '123e4567-e89b-12d3-a456-426614174000', url: 'https://example.invalid/x', timestamp: '2026-01-01T10:00:00Z', name: 'Sokak',
  };
  for (const [k, v] of Object.entries(sensitive)) {
    const x = good(); delete x.items[0].extra; x.items[0][k] = v;
    ok(`hassas alan reddedilir (varsayılan): ${k}`, throws(() => sanitize(x, SPEC, { source: 'synthetic-test' })));
    const out = sanitize(x, SPEC, { source: 'synthetic-test', unknown: 'drop' });
    ok(`hassas alan drop kipinde çıktıya girmez: ${k}`, !(k in out.items[0]) && !JSON.stringify(out).includes(JSON.stringify(v).slice(1, 8)));
  }
  ok('geçersiz unknown kipi reddedilir', throws(() => sanitize(good(), SPEC, { source: 'synthetic-test', unknown: 'keep' })));
  ok('geçersiz source reddedilir', throws(() => sanitize(good(), SPEC, { source: 'https://x' })) && throws(() => sanitize(good(), SPEC, {})));
}

// --- tür / enum / aralık / sınırlar
{
  const S = (mut, unknown = 'drop') => { const x = good(); mut(x); return () => sanitize(x, SPEC, { source: 'synthetic-test', unknown }); };
  ok('enum dışı değer reddedilir', throws(S((x) => { x.status = 'OK '; })));
  ok('enum yanlış tür reddedilir', throws(S((x) => { x.status = 1; })));
  ok('sayı yerine dize reddedilir', throws(S((x) => { x.total = '12'; })));
  ok('NaN reddedilir', throws(S((x) => { x.total = NaN; })));
  ok('Infinity reddedilir', throws(S((x) => { x.total = Infinity; })));
  ok('aralık üstü reddedilir', throws(S((x) => { x.total = 100001; })));
  ok('aralık altı reddedilir', throws(S((x) => { x.total = -1; })));
  ok('integer:true ondalığı reddeder', throws(S((x) => { x.items[0].level = 1.5; })));
  ok('boolean yerine 1 reddedilir', throws(S((x) => { x.items[0].flagged = 1; })));
  ok('nesne yerine dizi reddedilir', throws(S((x) => { x.items[0] = []; })));
  ok('dizi yerine nesne reddedilir', throws(S((x) => { x.items = { 0: {} }; })));
  ok('dizi sınırı aşımı reddedilir', throws(S((x) => { x.items = Array.from({ length: 6 }, () => ({})); })));
  ok('zorunlu alan yok → reddedilir', throws(S((x) => { delete x.items; })));
  ok('kök nesne değil → reddedilir', throws(() => sanitize([], SPEC, { source: 'synthetic-test' })) && throws(() => sanitize(null, SPEC, { source: 'synthetic-test' })));
  ok('hata iletisi ham değeri içermez', !errMsg(S((x) => { x.status = 'GIZLI-DEGER-XYZ'; })).includes('GIZLI-DEGER-XYZ'));
}

// --- preScan: sırlar (iç içe), prototip kirlenmesi, derinlik/düğüm sınırı
{
  const pre = (v, o) => () => preScan(v, o);
  ok('temiz girdi geçer', !throws(pre(good())));
  ok('iç içe Authorization anahtarı', throws(pre({ a: { b: [{ Authorization: 'x' }] } }), /sır|secret/i));
  ok('iç içe access_token anahtarı', throws(pre({ a: [[{ access_token: 'x' }]] })));
  ok('api_key / apiKey / x-api-key', throws(pre({ api_key: 1 })) && throws(pre({ q: { apiKey: 1 } })) && throws(pre({ 'x-api-key': 1 })));
  ok('password / client_secret / cookie', throws(pre({ password: 1 })) && throws(pre({ client_secret: 1 })) && throws(pre({ cookie: 1 })));
  ok('derin değerde pk. belirteci', throws(pre({ a: { b: { c: ['pk.FAKEFAKEFAKEFAKE'] } } })));
  ok('sk. belirteci', throws(pre(['sk.FAKEFAKEFAKE123'])));
  ok('JWT benzeri', throws(pre({ v: 'eyJhbGciOiJIUzI1NiJ9.FAKE.FAKE' })));
  ok('Bearer', throws(pre({ v: 'Bearer FAKE' })));
  ok('URL sorgusunda key=', throws(pre({ v: 'https://example.invalid/?api_key=FAKE' })));
  ok('Google tarzı AIza', throws(pre({ v: 'AIzaFAKEFAKEFAKEFAKE' })));
  ok('anahtarın kendisi sır benzeri', throws(pre(JSON.parse('{"pk.FAKEFAKEFAKEFAKE": 1}'))));
  ok('__proto__ anahtarı (JSON.parse)', throws(pre(JSON.parse('{"a":{"__proto__":{"polluted":1}}}')), /yasak/));
  ok('constructor anahtarı', throws(pre({ a: { constructor: { prototype: { x: 1 } } } })));
  ok('prototype anahtarı', throws(pre({ prototype: 1 })));
  let d = {}; const top = d; for (let i = 0; i < 200; i++) { d.n = {}; d = d.n; }
  ok('derinlik sınırı', throws(pre(top), /derin|depth/i));
  ok('düğüm sınırı (özel)', throws(pre({ a: Array.from({ length: 50 }, (_, i) => i) }, { maxNodes: 20 }), /düğüm|limit/i));
  const cyc = { a: 1 }; cyc.self = cyc;
  ok('döngüsel girdi reddedilir', throws(pre(cyc)));
  ok('işlev/symbol/bigint/undefined reddedilir', throws(pre({ f() {} })) && throws(pre({ s: Symbol('x') })) && throws(pre({ b: 1n })) && throws(pre({ u: undefined })));
  ok('düz olmayan nesne (Date/Map) reddedilir', throws(pre({ d: new Date(0) })) && throws(pre({ m: new Map() })));
  ok('sır hata iletisinde görünmez', !errMsg(pre({ v: 'Bearer GIZLIBELIRTEC' })).includes('GIZLIBELIRTEC'));
  ok('sanitize preScan uygular (sırlı alan drop kipinde de)', throws(() => sanitize({ ...good(), hdr: { authorization: 'x' } }, SPEC, { source: 'synthetic-test', unknown: 'drop' })));
  ok('Object.prototype kirlenmedi', ({}).polluted === undefined && Object.prototype.polluted === undefined);
}

// --- leakScan bağımsız savunma
{
  const input = good();
  const out = sanitize(input, SPEC, { source: 'synthetic-test', unknown: 'drop' });
  const mut = (f) => { const o = JSON.parse(JSON.stringify(out)); f(o); return leakScan(input, o, SPEC); };
  ok('izinsiz anahtar bulunur', mut((o) => { o.items[0].extra = 1; }).length > 0);
  ok('izinsiz dize bulunur', mut((o) => { o.status = 'zzz'; }).length > 0);
  ok('URL bulunur', mut((o) => { o.status = 'https://example.invalid'; }).length > 0);
  ok('ondalık (koordinat) bulunur', mut((o) => { o.total = 41.0123; }).length > 0);
  ok('zaman damgası bulunur', mut((o) => { o.status = '2026-01-01T10:00'; }).length > 0);
  ok('verified iddiası bulunur', mut((o) => { o._verified = true; }).length > 0);
  ok('evidence iddiası bulunur', mut((o) => { o._evidence = 'verified'; }).length > 0);
  ok('synthetic uyumsuzluğu bulunur', mut((o) => { o._synthetic = false; }).length > 0);
  ok('sır bulunur', mut((o) => { o.status = 'pk.FAKEFAKEFAKEFAKE'; }).length > 0);
  ok('ham girdi dizesi bulunur', (() => { const i2 = { ...good(), note: 'alpha-secret-raw' }; const o = JSON.parse(JSON.stringify(out)); o.status = 'alpha-secret-raw'; return leakScan(i2, o, SPEC).length > 0; })());
  ok('null/tanımsız tür bulunur', mut((o) => { o.total = null; }).length > 0);
  ok('çıktı nesne değil', leakScan(input, [], SPEC).length > 0);
  ok('bulgu iletisi ham değer içermez', !mut((o) => { o.status = 'GIZLI-XYZ-1'; }).join(' ').includes('GIZLI-XYZ-1'));
}

// --- saf yol doğrulama yardımcıları (disk erişimi yok)
{
  const RE = /^core-sanitized-[a-z0-9][a-z0-9-]{0,48}\.json$/;
  ok('geçerli çıktı adı', validateOutputName('core-sanitized-a1.json', RE) === true);
  for (const n of ['../core-sanitized-a.json', 'core-sanitized-a.json/..', 'sub/core-sanitized-a.json', 'sub\\core-sanitized-a.json',
    'core-sanitized-A.json', 'core-sanitized-.json', 'x.json', '', 'core-sanitized-a.json\u0000', 'C:core-sanitized-a.json'])
    ok(`geçersiz çıktı adı: ${JSON.stringify(n)}`, validateOutputName(n, RE) === false);
  ok('desen RegExp değilse reddedilir', validateOutputName('core-sanitized-a.json', '.*') === false);
  ok('isInside win32 büyük/küçük harf', isInside('C:\\Repo\\scripts\\x', 'c:\\repo', 'win32') === true);
  ok('isInside win32 dışarı', isInside('C:\\Repo2\\x', 'C:\\Repo', 'win32') === false);
  ok('isInside win32 ..', isInside('C:\\Repo\\..\\Other', 'C:\\Repo', 'win32') === false);
  ok('isInside posix', isInside('/repo/a/b', '/repo', 'posix') === true && isInside('/repository', '/repo', 'posix') === false);
  ok('isInside posix büyük/küçük harf duyarlı', isInside('/Repo/a', '/repo', 'posix') === false);
  const t = resolveOutputTarget({ repoRoot: '/repo', outDir: '/repo/scripts/fixtures/x', name: 'core-sanitized-a.json', nameRe: RE, platform: 'posix' });
  ok('çıktı hedefi çözülür', t.ok === true && t.path === '/repo/scripts/fixtures/x/core-sanitized-a.json');
  ok('çıktı klasörü depo dışında reddedilir', resolveOutputTarget({ repoRoot: '/repo', outDir: '/tmp/x', name: 'core-sanitized-a.json', nameRe: RE, platform: 'posix' }).ok === false);
  ok('kötü ad reddedilir', resolveOutputTarget({ repoRoot: '/repo', outDir: '/repo/f', name: '../core-sanitized-a.json', nameRe: RE, platform: 'posix' }).ok === false);
  ok('göreli klasör reddedilir', resolveOutputTarget({ repoRoot: '/repo', outDir: 'f', name: 'core-sanitized-a.json', nameRe: RE, platform: 'posix' }).ok === false);
  ok('win32 hedef', resolveOutputTarget({ repoRoot: 'C:\\Repo', outDir: 'C:\\Repo\\f', name: 'core-sanitized-a.json', nameRe: RE, platform: 'win32' }).path === 'C:\\Repo\\f\\core-sanitized-a.json');
  ok('girdi depo dışında kabul', validateInputPath({ inputPath: '/home/u/in.json', repoRoot: '/repo', platform: 'posix' }).ok === true);
  ok('girdi depo içinde reddedilir', validateInputPath({ inputPath: '/repo/server/data/x.json', repoRoot: '/repo', platform: 'posix' }).ok === false);
  ok('girdi .env reddedilir', validateInputPath({ inputPath: '/home/u/.env', repoRoot: '/repo', platform: 'posix' }).ok === false);
  ok('girdi .json değilse reddedilir', validateInputPath({ inputPath: '/home/u/in.txt', repoRoot: '/repo', platform: 'posix' }).ok === false);
  ok('girdi göreli reddedilir', validateInputPath({ inputPath: 'in.json', repoRoot: '/repo', platform: 'posix' }).ok === false);
  ok('girdi NUL içerirse reddedilir', validateInputPath({ inputPath: '/home/u/in\u0000.json', repoRoot: '/repo', platform: 'posix' }).ok === false);
  ok('win32 girdi depo içinde (harf farkı) reddedilir', validateInputPath({ inputPath: 'c:\\repo\\a.json', repoRoot: 'C:\\Repo', platform: 'win32' }).ok === false);
  ok('bilinmeyen platform reddedilir', validateInputPath({ inputPath: '/a.json', repoRoot: '/repo', platform: 'beos' }).ok === false);
}

// --- çalışma zamanı bu modülü içe aktarmaz; mapbox-sanitize.mjs bu göreve bağlı değil
{
  function walk(dir, acc = []) {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, acc); else acc.push(p);
    }
    return acc;
  }
  const rel = (p) => relative(root, p).replace(/\\/g, '/');
  const runtime = [...walk(join(root, 'js')), ...walk(join(root, 'server')), join(root, 'index.html'), join(root, 'sw.js')]
    .filter((p) => /\.(m?js|html)$/.test(p) && !/[\\/](node_modules|data)[\\/]/.test(p));
  ok('tarama çalışma zamanı dosyalarını kapsar', runtime.length > 20);
  const users = runtime.filter((p) => /sanitize-core/.test(readFileSync(p, 'utf8'))).map(rel);
  ok('hiçbir çalışma zamanı dosyası sanitize-core içe aktarmaz', users.length === 0, users.join(', '));
  ok('META_KEYS dondurulmuş ve verified içerir', Object.isFrozen(META_KEYS) && META_KEYS.includes('_verified'));
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
