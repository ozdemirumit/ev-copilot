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

// --- BL-P2-05c-2d T1: isteğe bağlı order / required / errorStyle seçenekleri (varsayılan davranış birebir korunur)
{
  const SE = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const run = walkAllowlist(SPEC);
  const ALL = { order: 'spec', required: 'inline', errorStyle: 'compact' };
  const FAKE_PK = 'pk.FAKEFAKEFAKEFAKE';

  // Varsayılan eşdeğerliği: seçeneksiz çağrı = açık varsayılan değerler (çıktı ve hata iletisi birebir)
  const DEF = { unknown: 'reject', order: 'input', required: 'upfront', errorStyle: 'default' };
  const cases = [
    { total: 5, items: [{ kind: 'beta', flagged: true, distance: 2.6 }], status: 'ok' },
    { items: [] },
    { status: 'ok' },
    { items: 'x', status: 'bad' },
    { status: 'bad', items: 'x' },
    { items: [{ level: 1.5 }] },
    { items: [{ distance: -1 }] },
    { items: [{ zz: 1 }] },
    { items: [], zz: 1 },
    { items: [1] },
    { items: [{}, {}, {}, {}, {}, {}] },
    { items: [{ tags: ['x', 'q'] }] },
    { items: [{ flagged: 'yes' }] },
  ];
  let parity = true;
  for (const c of cases) {
    const a = SE(() => run(c)), b = SE(() => run(c, DEF));
    const oa = a ? null : run(c), ob = b ? null : run(c, DEF);
    if (a || b) { if (!a || !b || a.message !== b.message || !(a instanceof SanitizeError) || !(b instanceof SanitizeError)) parity = false; }
    else if (JSON.stringify(oa) !== JSON.stringify(ob)) parity = false; // anahtar sırası dahil
    const sa = SE(() => sanitize(c, SPEC, { source: 'synthetic-core' })), sb = SE(() => sanitize(c, SPEC, { source: 'synthetic-core', ...DEF }));
    if (sa || sb) { if (!sa || !sb || sa.message !== sb.message) parity = false; }
    else if (JSON.stringify(sanitize(c, SPEC, { source: 'synthetic-core' })) !== JSON.stringify(sanitize(c, SPEC, { source: 'synthetic-core', ...DEF }))) parity = false;
  }
  ok('varsayılan eşdeğerliği: seçeneksiz = açık varsayılanlar (çıktı + ileti birebir)', parity);
  ok('varsayılan ileti biçimi korunur ($ önekli, aralık iletisi)', errMsg(() => run({ items: [{ distance: -1 }] })) === '$.items[0].distance: aralık dışı sayı (0..1000000)');
  ok('varsayılan zorunlu alan iletisi korunur', errMsg(() => run({ status: 'ok' })) === '$.items: zorunlu alan yok; reddedildi');
  ok('varsayılan: zorunlu alan denetimi alanlardan önce (upfront)', errMsg(() => run({ status: 'bad' })) === '$.items: zorunlu alan yok; reddedildi');
  ok('varsayılan: girdi sırasıyla dolaşılır', /^\$\.items:/.test(errMsg(() => run({ items: 'x', status: 'bad' }))) && /^\$\.status:/.test(errMsg(() => run({ status: 'bad', items: 'x' }))));
  ok('varsayılan: çıktı anahtarları girdi sırasında', Object.keys(run({ total: 1, items: [], status: 'ok' })).join() === 'total,items,status');
  ok('varsayılan: tam sayı iletisi korunur', errMsg(() => run({ items: [{ level: 1.5 }] })) === '$.items[0].level: tam sayı bekleniyor');
  ok('varsayılan: tür iletisi korunur', errMsg(() => run({ items: [{ distance: 'x' }] })) === '$.items[0].distance: sayı (number) bekleniyor');

  // order:'spec'
  const o1 = run({ total: 1, items: [{ tags: ['x'], flagged: false, kind: 'alpha', level: 2, distance: 3 }], status: 'ok' }, { order: 'spec' });
  ok("order:'spec' kök çıktı anahtarları şema sırasında", Object.keys(o1).join() === 'status,total,items');
  ok("order:'spec' iç içe çıktı anahtarları şema sırasında", Object.keys(o1.items[0]).join() === 'kind,distance,level,flagged,tags');
  ok("order:'spec' değerler varsayılanla aynı (yalnızca sıra değişir)", same(o1, run({ total: 1, items: [{ tags: ['x'], flagged: false, kind: 'alpha', level: 2, distance: 3 }], status: 'ok' })));
  ok("order:'spec' yalnızca girdide olan alanlar yazılır", Object.keys(run({ items: [{ level: 1 }] }, { order: 'spec' }).items[0]).join() === 'level');
  ok("order:'spec' dolaşma şema sırasında (status, items'tan önce)", /^\$\.status:/.test(errMsg(() => run({ items: 'x', status: 'bad' }, { order: 'spec' }))));
  ok("order:'spec' iç içe dolaşma şema sırasında (kind, distance'tan önce)", /^\$\.items\[0\]\.kind:/.test(errMsg(() => run({ items: [{ distance: -1, kind: 'q' }] }, { order: 'spec' }))));
  ok("order:'spec' + reject: izin dışı alan, alan hatalarından önce reddedilir", errMsg(() => run({ status: 'bad', zz: 1, items: [] }, { order: 'spec' })) === '$: izin listesi dışı alan; reddedildi');
  ok("order:'spec' + reject: iç içe izin dışı alan", errMsg(() => run({ items: [{ kind: 'alpha', zz: 1 }] }, { order: 'spec' })) === '$.items[0]: izin listesi dışı alan; reddedildi');
  const dropped = run({ zz: 'ham-deger-1', items: [{ yy: 2, kind: 'beta' }], status: 'none' }, { order: 'spec', unknown: 'drop' });
  ok("order:'spec' + drop: izin dışı alanlar atılır", Object.keys(dropped).join() === 'status,items' && Object.keys(dropped.items[0]).join() === 'kind' && !JSON.stringify(dropped).includes('ham-deger-1'));
  ok("order:'spec' + upfront: zorunlu alan yine önce", errMsg(() => run({ status: 'bad' }, { order: 'spec' })) === '$.items: zorunlu alan yok; reddedildi');
  ok("order:'spec' + upfront: zorunlu alan, izin dışı alandan önce", errMsg(() => run({ zz: 1 }, { order: 'spec' })) === '$.items: zorunlu alan yok; reddedildi');

  // required:'inline' (yalnızca order:'spec' ile)
  const RSPEC = {
    type: 'object', required: ['level', 'rows'],
    fields: {
      status: { type: 'enum', values: ['ok', 'none'] },
      level: { type: 'number', min: 0, max: 9 },
      rows: { type: 'array', max: 4, items: { type: 'object', required: ['kind'], fields: { total: { type: 'number', min: 0, max: 50 }, kind: { type: 'enum', values: ['alpha'] } } } },
    },
  };
  const rrun = walkAllowlist(RSPEC);
  const IN = { order: 'spec', required: 'inline' };
  ok("required:'inline': önceki alan hatası, eksik zorunlu alandan önce", /^\$\.status: izin listesi dışı enum/.test(errMsg(() => rrun({ status: 'bad' }, IN))));
  ok("required:'upfront' (karşılaştırma): eksik zorunlu alan önce", errMsg(() => rrun({ status: 'bad' }, { order: 'spec' })) === '$.level: zorunlu alan yok; reddedildi');
  ok("required:'inline': eksik zorunlu alan kendi sırasında bildirilir", errMsg(() => rrun({ status: 'ok' }, IN)) === '$.level: zorunlu alan yok; reddedildi');
  ok("required:'inline': ilk zorunlu varsa sonraki eksik bildirilir", errMsg(() => rrun({ level: 1 }, IN)) === '$.rows: zorunlu alan yok; reddedildi');
  ok("required:'inline': geçersiz önceki zorunlu alan, sonraki eksikten önce", /^\$\.level: aralık dışı/.test(errMsg(() => rrun({ level: 99 }, IN))));
  ok("required:'inline': iç içe yol", errMsg(() => rrun({ level: 1, rows: [{ kind: 'alpha' }, { total: 3 }] }, IN)) === '$.rows[1].kind: zorunlu alan yok; reddedildi');
  ok("required:'inline': iç içe önceki alan hatası önce", /^\$\.rows\[0\]\.total: aralık dışı/.test(errMsg(() => rrun({ level: 1, rows: [{ total: 99 }] }, IN))));
  ok("required:'inline' + reject: izin dışı alan, eksik zorunludan önce", errMsg(() => rrun({ zz: 1 }, IN)) === '$: izin listesi dışı alan; reddedildi');
  ok("required:'inline' + drop: izin dışı alan atılır, eksik zorunlu yine reddedilir", errMsg(() => rrun({ zz: 1, level: 2 }, { ...IN, unknown: 'drop' })) === '$.rows: zorunlu alan yok; reddedildi');
  ok("required:'inline': geçerli girdi kabul, değerler varsayılanla aynı", same(rrun({ rows: [{ kind: 'alpha', total: 2 }], level: 3 }, IN), rrun({ rows: [{ kind: 'alpha', total: 2 }], level: 3 })));
  ok("required:'inline' order:'input' ile reddedilir", SE(() => run({ items: [] }, { required: 'inline' })) instanceof SanitizeError
    && SE(() => run({ items: [] }, { required: 'inline', order: 'input' })) instanceof SanitizeError
    && SE(() => sanitize({ items: [] }, SPEC, { source: 'synthetic-core', required: 'inline' })) instanceof SanitizeError);

  // errorStyle:'compact' (Mapbox uyumlu: '$.' öneki yok, sabit sayı iletisi)
  const C1 = { errorStyle: 'compact' };
  ok("compact: sayı aralık dışı → sabit ileti", errMsg(() => run({ items: [{ distance: -1 }] }, C1)) === 'items[0].distance: geçersiz sayı (number; 0..1000000)');
  ok("compact: sayı türü yanlış → aynı sabit ileti", errMsg(() => run({ items: [{ distance: '5' }] }, C1)) === 'items[0].distance: geçersiz sayı (number; 0..1000000)');
  ok("compact: null sayı → aynı sabit ileti", errMsg(() => run({ items: [{ distance: null }] }, C1)) === 'items[0].distance: geçersiz sayı (number; 0..1000000)');
  ok("compact: tam sayı değil → aynı sabit ileti (negatif aralık)", errMsg(() => run({ items: [{ level: 1.5 }] }, C1)) === 'items[0].level: geçersiz sayı (number; -10..10)');
  ok("compact: kök sayı alanı", errMsg(() => run({ total: 100001, items: [] }, C1)) === 'total: geçersiz sayı (number; 0..100000)');
  ok("compact: enum iletisi", errMsg(() => run({ status: 'bad', items: [] }, C1)) === 'status: izin listesi dışı enum değeri; reddedildi');
  ok("compact: dizi içi enum", errMsg(() => run({ items: [{ tags: ['x', 'q'] }] }, C1)) === 'items[0].tags[1]: izin listesi dışı enum değeri; reddedildi');
  ok("compact: dizi bekleniyor", errMsg(() => run({ items: 'x' }, C1)) === 'items: dizi (array) bekleniyor');
  ok("compact: eleman sınırı", errMsg(() => run({ items: [{}, {}, {}, {}, {}, {}] }, C1)) === 'items: eleman sınırı (limit 5) aşıldı');
  ok("compact: nesne bekleniyor", errMsg(() => run({ items: [1] }, C1)) === 'items[0]: nesne (object) bekleniyor');
  ok("compact: boolean bekleniyor", errMsg(() => run({ items: [{ flagged: 'x' }] }, C1)) === 'items[0].flagged: boolean bekleniyor');
  ok("compact: zorunlu alan iletisi (kök)", errMsg(() => run({ status: 'ok' }, C1)) === 'items yok; reddedildi');
  ok("compact: zorunlu alan iletisi (iç içe, inline)", errMsg(() => rrun({ level: 1, rows: [{ total: 3 }] }, { ...IN, ...C1 })) === 'rows[0].kind yok; reddedildi');
  ok("compact: kök izin dışı alan → 'kök' etiketi", errMsg(() => run({ items: [], zz: 1 }, C1)) === 'kök: izin listesi dışı alan; reddedildi');
  ok("compact: iç içe izin dışı alan", errMsg(() => run({ items: [{ zz: 1 }] }, C1)) === 'items[0]: izin listesi dışı alan; reddedildi');
  ok("compact: kök nesne değil → 'kök' etiketi", errMsg(() => run([], C1)) === 'kök: nesne (object) bekleniyor');
  const aRun = walkAllowlist({ type: 'array', max: 2, items: { type: 'number', min: 0, max: 3 } });
  ok("compact: kökü dizi olan şema yolu", errMsg(() => aRun([1, 9], C1)) === '[1]: geçersiz sayı (number; 0..3)' && errMsg(() => aRun([1, 9])) === '$[1]: aralık dışı sayı (0..3)');
  ok("compact: hiçbir ileti '$' ile başlamaz", cases.every((c) => { const e = SE(() => run(c, C1)); return !e || !e.message.startsWith('$'); }));
  ok("compact: geçerli girdide çıktı varsayılanla birebir", JSON.stringify(run(cases[0], C1)) === JSON.stringify(run(cases[0])));

  // Mapbox biçimini taklit eden SENTETİK şema; üç seçenek birlikte (golden göç korkuluklarıyla aynı iletiler)
  const MSPEC = {
    type: 'object', required: ['routes'],
    fields: {
      code: { type: 'enum', values: ['Ok', 'NoRoute'] },
      routes: { type: 'array', max: 3, items: { type: 'object', fields: {
        distance: { type: 'number', min: 0, max: 10000000 },
        duration: { type: 'number', min: 0, max: 10000000 },
        legs: { type: 'array', max: 3, items: { type: 'object', fields: { distance: { type: 'number', min: 0, max: 10000000 } } } },
      } } },
    },
  };
  const mrun = walkAllowlist(MSPEC);
  const MO = { ...ALL, unknown: 'drop' };
  ok('Mapbox biçimi: routes yok iletisi', /^routes yok; reddedildi$/.test(errMsg(() => mrun({ code: 'Ok' }, MO))));
  ok('Mapbox biçimi: $ öneksiz yol ve sabit sayı iletisi', /^routes\[0\]\.distance: geçersiz sayı \(number; 0\.\.10000000\)$/.test(errMsg(() => mrun({ routes: [{ distance: -1 }] }, MO))));
  ok('Mapbox biçimi: sabit alan sırası (distance, legs’ten önce)', /^routes\[0\]\.distance:/.test(errMsg(() => mrun({ routes: [{ legs: 'x', distance: -1 }] }, MO))));
  ok('Mapbox biçimi: code hatası, eksik routes’tan önce (inline)', /^code: izin listesi dışı enum/.test(errMsg(() => mrun({ code: 'Bad' }, MO))));
  ok('Mapbox biçimi: iç içe yol', errMsg(() => mrun({ routes: [{ legs: [{}, { distance: 1e9 }] }] }, MO)) === 'routes[0].legs[1].distance: geçersiz sayı (number; 0..10000000)');
  const mOut = mrun({ routes: [{ legs: [{ distance: 4.4 }], duration: 2.5, distance: 9.6, extra: 1 }], code: 'Ok', other: 'x' }, MO);
  ok('Mapbox biçimi: çıktı şema sırasında, atılanlar yok, yuvarlama aynı', JSON.stringify(mOut) === '{"code":"Ok","routes":[{"distance":10,"duration":3,"legs":[{"distance":4}]}]}');

  // Seçenek doğrulama: katı enum, ham değer iletiye girmez
  const SENT = 'ZZsentinelQQ';
  const BADV = [null, '', 'SPEC', 'Spec', ' spec', 'spec ', 1, 0, true, false, {}, [], ['spec'], SENT, 'pk.abcdefghijkl12', 'toString', '__proto__'];
  for (const key of ['order', 'required', 'errorStyle']) {
    const allRej = BADV.every((val) => {
      const opt = { [key]: val };
      if (key === 'required') opt.order = 'spec';
      const e1 = SE(() => run({ items: [] }, opt));
      const e2 = SE(() => sanitize({ items: [] }, SPEC, { source: 'synthetic-core', ...opt }));
      return e1 instanceof SanitizeError && e2 instanceof SanitizeError;
    });
    ok(`${key}: geçersiz değerler (tür/harf/boşluk/prototip adı) SanitizeError ile reddedilir`, allRej);
    const m1 = errMsg(() => run({ items: [] }, { [key]: SENT, order: key === 'required' ? 'spec' : SENT }));
    const m2 = errMsg(() => sanitize({ items: [] }, SPEC, { source: 'synthetic-core', [key]: 'pk.abcdefghijkl12' }));
    ok(`${key}: hata iletisi ham seçenek değerini içermez`, m1 && !m1.includes(SENT) && m2 && !m2.includes('pk.abcdefghijkl12'));
  }
  ok('undefined seçenek = varsayılan', JSON.stringify(run(cases[0], { order: undefined, required: undefined, errorStyle: undefined })) === JSON.stringify(run(cases[0])));
  ok('geçersiz seçenekte girdi dolaşılmaz (seçenek denetimi önce)', errMsg(() => run({ status: 'bad' }, { order: 'x' })) !== errMsg(() => run({ status: 'bad' })) && !/^\$/.test(errMsg(() => run({ status: 'bad' }, { order: 'x' }))));
  ok('mevcut unknown iletisi korunur (öncelik: unknown önce)', errMsg(() => run({ items: [] }, { unknown: 'x', order: 'x' })) === "unknown kipi yalnızca 'reject' ya da 'drop'"
    && errMsg(() => sanitize({ items: [] }, SPEC, { source: 'synthetic-core', unknown: 'x', order: 'x' })) === "unknown kipi yalnızca 'reject' ya da 'drop'");
  ok('source denetimi seçeneklerden önce', /source/.test(errMsg(() => sanitize({ items: [] }, SPEC, { source: 'BAD', order: 'x' }))));

  // Güvenlik: seçenekler kabul edilen kümeyi genişletmez, preScan / leakScan zayıflamaz
  const combos = [];
  for (const order of ['input', 'spec']) for (const required of ['upfront', 'inline']) for (const errorStyle of ['default', 'compact']) for (const unknown of ['reject', 'drop'])
    if (!(required === 'inline' && order === 'input')) combos.push({ order, required, errorStyle, unknown });
  ok('geçerli seçenek kombinasyon sayısı 12', combos.length === 12);
  const deepSecret = { items: [{ kind: 'alpha', tags: ['x'] }], status: 'ok', nested: { z: [{ q: FAKE_PK }] } };
  const ctxs = [
    ['iç içe sır her kombinasyonda reddedilir, ileti ham değer içermez', (o) => { const e = SE(() => sanitize(deepSecret, SPEC, { source: 'synthetic-core', ...o })); return e instanceof SanitizeError && /sır|secret/i.test(e.message) && !e.message.includes(FAKE_PK); }],
    ['Authorization anahtarı her kombinasyonda reddedilir', (o) => SE(() => sanitize({ items: [], Authorization: 'x' }, SPEC, { source: 'synthetic-core', ...o })) instanceof SanitizeError],
    ['__proto__ her kombinasyonda reddedilir', (o) => SE(() => sanitize(JSON.parse('{"items":[],"__proto__":{"p":1}}'), SPEC, { source: 'synthetic-core', ...o })) instanceof SanitizeError && ({}).p === undefined],
    ['sayı alanında dize her kombinasyonda reddedilir', (o) => SE(() => sanitize({ items: [{ distance: '5' }] }, SPEC, { source: 'synthetic-core', ...o })) instanceof SanitizeError],
    ['izin dışı enum her kombinasyonda reddedilir (düşürülmez)', (o) => SE(() => sanitize({ items: [{ kind: 'serbest metin' }] }, SPEC, { source: 'synthetic-core', ...o })) instanceof SanitizeError],
    ['aşırı derin girdi her kombinasyonda reddedilir', (o) => { let d = { v: 1 }; for (let i = 0; i < 80; i++) d = { a: d }; return SE(() => sanitize({ items: [], d }, SPEC, { source: 'synthetic-core', ...o, unknown: 'drop' })) instanceof SanitizeError; }],
    ['geçerli girdide değerler varsayılanla aynı, işaretler doğru, leakScan temiz', (o) => {
      const inp = { _synthetic: true, _verified: true, total: 7.7, items: [{ level: -3, kind: 'beta', tags: ['y'] }], status: 'none' };
      const out = sanitize(inp, SPEC, { source: 'synthetic-core', ...o });
      return same(out, sanitize(inp, SPEC, { source: 'synthetic-core' })) && out._verified === false && out._synthetic === true && leakScan(inp, out, SPEC).length === 0;
    }],
    ['girdi değiştirilmez', (o) => { const inp = { status: 'ok', items: [{ kind: 'alpha', distance: 1.5 }], zz: 1 }; const before = JSON.stringify(inp); SE(() => sanitize(inp, SPEC, { source: 'synthetic-core', ...o })); return JSON.stringify(inp) === before; }],
    ['hata iletileri ham girdi değeri içermez', (o) => { const e = SE(() => sanitize({ status: 'HAMdegerQQ', items: [{ zzHAM: 'HAMdegerQQ' }] }, SPEC, { source: 'synthetic-core', ...o })); return e instanceof SanitizeError && !e.message.includes('HAMdegerQQ') && !e.message.includes('zzHAM'); }],
  ];
  for (const [name, f] of ctxs) ok(`seçenekler: ${name}`, combos.every((o) => { try { return f(o); } catch { return false; } }));
  ok('seçenekler: drop + spec çıktısında izin dışı anahtar yok, leakScan temiz', (() => {
    const inp = { zz: 'gizli-olmayan-ham', items: [{ yy: 1, kind: 'alpha' }] };
    const out = sanitize(inp, SPEC, { source: 'synthetic-core', order: 'spec', unknown: 'drop' });
    return !('zz' in out) && !('yy' in out.items[0]) && leakScan(inp, out, SPEC).length === 0 && Object.keys(out).slice(-1)[0] === 'items';
  })());
  ok('seçenekler: sanitize çıktısında işaretler önce, gövde şema sırasında', Object.keys(sanitize({ items: [], status: 'ok' }, SPEC, { source: 'synthetic-core', order: 'spec' })).join()
    === '_sanitized,_recorded,_synthetic,_verified,_evidence,_source,_sanitizerVersion,status,items');
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
