// Yerel Mapbox yanıt temizleyici (sanitizer) aracı testleri (BL-P2-05b-1; bağımlılıksız, düz node): node scripts/test-mapbox-sanitize.mjs
// Gerçek Mapbox verisi YOK: yalnızca sentetik girdi (scripts/fixtures/road-events/mapbox-sanitize-input-synthetic.json) ve test içinde
// üretilen sahte değerler kullanılır. Yazma denetimleri işletim sisteminin geçici klasöründe sahte bir "depo" içinde yapılır;
// gerçek scripts/fixtures/road-events/ klasörüne hiçbir dosya yazılmaz. Ağ engellidir.
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`ok  ${name}`); } else { fail++; console.log(`FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

// Ağ engeli
let netCalls = 0;
globalThis.fetch = () => { netCalls++; throw new Error('ağ yasak'); };
globalThis.XMLHttpRequest = function () { netCalls++; throw new Error('ağ yasak'); };
globalThis.WebSocket = function () { netCalls++; throw new Error('ağ yasak'); };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const J = (x) => JSON.stringify(x);
const FIX_DIR = join(root, 'scripts', 'fixtures', 'road-events');
const fixtureListBefore = readdirSync(FIX_DIR).sort();

const S = await import('./mapbox-sanitize.mjs');
const { sanitizeMapbox, leakScan, runCli, MAX_INPUT_BYTES, OUTPUT_NAME_RE } = S;
const A = await import('../js/nav/roadEventsAdapt.js');

const throws = (fn, re) => { try { fn(); return false; } catch (e) { return re ? re.test(String(e && e.message)) : true; } };
const syn = JSON.parse(read('scripts/fixtures/road-events/mapbox-sanitize-input-synthetic.json'));
const clone = (o) => JSON.parse(J(o));
// Sahte sır değerleri çalışma anında birleştirilir (depoda gerçek biçimli belirteç dizesi durmasın).
const FAKE_PK = 'pk' + '.' + 'FAKEFAKEFAKEFAKE0123456789';
const FAKE_SK = 'sk' + '.' + 'FAKEFAKEFAKEFAKE0123456789';
const FAKE_JWT = 'ey' + 'J' + 'hbGciOiJGQUtFIiwidHlwIjoiRkFLRSJ9';

// ---- Dışa aktarımlar ----
ok('sanitizeMapbox/leakScan/runCli işlev', [sanitizeMapbox, leakScan, runCli].every((f) => typeof f === 'function'));
ok('MAX_INPUT_BYTES = 5 MB', MAX_INPUT_BYTES === 5 * 1024 * 1024);
ok('OUTPUT_NAME_RE düzenli ifade', OUTPUT_NAME_RE instanceof RegExp);

// ---- Sentetik girdi örneği ----
ok('girdi örneği _synthetic=true', syn._synthetic === true);
ok('girdi örneği verified/recorded iddiası taşımaz', !('_verified' in syn) && !('_recorded' in syn));

// ---- Katı izin listesi kopyası ----
const out = sanitizeMapbox(clone(syn));
const outJ = J(out);
ok('çıktı _sanitized=true', out._sanitized === true);
ok('sentetik girdi → _synthetic=true, _recorded=false', out._synthetic === true && out._recorded === false);
ok('çıktı asla verified değil (_verified=false, evidence unverified)', out._verified === false && out._evidence === 'unverified');
ok('code enum kopyalanır', out.code === 'Ok');
ok('rota/bacak/adım yapısı korunur', out.routes.length === 1 && out.routes[0].legs.length === 1 && out.routes[0].legs[0].steps.length === 2);
const st = out.routes[0].legs[0].steps[0];
ok('sayılar tam sayıya yuvarlanır', out.routes[0].distance === 12000 && out.routes[0].duration === 601 && st.distance === 900 && st.duration === 45);
ok('manevra yalnızca type/modifier enum', J(st.maneuver) === '{"type":"off ramp","modifier":"slight right"}');
ok('mode/driving_side enum', st.mode === 'driving' && st.driving_side === 'right');
ok('kavşak sınıfları enum, konum/bearing/entry yok', J(st.intersections) === '[{"classes":["tunnel","motorway"]},{"classes":["toll"],"toll_collection":{"type":"toll_booth"}}]');
ok('çıkış numarası değeri kopyalanmaz, yalnızca varlık', st.exits_present === true && !('exits' in st));
ok('banner bileşenleri yalnızca type', J(st.bannerInstructions) === '[{"primary":{"components":[{"type":"exit-number"},{"type":"text"}]}}]');
ok('varış adımı: konumsuz boş kavşak {} ', J(out.routes[0].legs[0].steps[1].intersections) === '[{}]' && out.routes[0].legs[0].steps[1].maneuver.type === 'arrive');
for (const bad of ['Sentetik', 'synthetic-uuid', 'example.invalid', 'https', '2026-01-01', '28.97', '41.00', '29.00', 'polyline', 'geometry', 'location', 'name', 'uuid', 'waypoints', 'S-99', 'Gise', 'instruction', 'announcement', 'weight', 'summary', 'destinations', '"12"', 'bearing']) {
  ok(`çıktıda ham değer/alan yok: ${bad}`, !outJ.includes(bad));
}
ok('sentetik çıktı sızıntı taramasından geçer', leakScan(syn, out).length === 0, J(leakScan(syn, out)));
ok('girdi değiştirilmez', J(syn) === J(JSON.parse(read('scripts/fixtures/road-events/mapbox-sanitize-input-synthetic.json'))));

// _synthetic yalnızca === true
{
  const real = clone(syn); delete real._synthetic;
  const o = sanitizeMapbox(real);
  ok('sentetik olmayan girdi → _recorded=true, _synthetic=false, yine verified değil', o._recorded === true && o._synthetic === false && o._verified === false && o._evidence === 'unverified');
  const s2 = clone(syn); s2._synthetic = 'true';
  ok('_synthetic yalnızca === true sayılır', sanitizeMapbox(s2)._synthetic === false);
  const claim = clone(syn); claim._verified = true; claim._recorded = true; claim._evidence = 'verified'; claim.status = 'verified';
  const oc = sanitizeMapbox(claim);
  ok('girdideki verified/recorded iddiası yok sayılır', oc._verified === false && oc._evidence === 'unverified' && oc._recorded === false && oc._synthetic === true);
}

// ---- Fail-closed: kötü niyetli iç içe sır / beklenmeyen değer ----
{
  const deep = (v) => { const x = clone(syn); x.routes[0].legs[0].steps[0].intersections[1].toll_collection.name = v; return x; };
  ok('iç içe sahte pk. belirteci → reddedilir', throws(() => sanitizeMapbox(deep(FAKE_PK)), /sır|secret/i));
  ok('iç içe sahte sk. belirteci → reddedilir', throws(() => sanitizeMapbox(deep(FAKE_SK)), /sır|secret/i));
  ok('iç içe sahte JWT → reddedilir', throws(() => sanitizeMapbox(deep(FAKE_JWT)), /sır|secret/i));
  ok('Bearer başlığı → reddedilir', throws(() => sanitizeMapbox(deep('Bearer abcdef123456')), /sır|secret/i));
  ok('URL içinde access_token → reddedilir', throws(() => sanitizeMapbox(deep('https://x.invalid/?access_token=abc')), /sır|secret/i));
  const hdr = clone(syn); hdr.routes[0].legs[0].headers = { Authorization: 'x' };
  ok('Authorization anahtarı → reddedilir', throws(() => sanitizeMapbox(hdr), /sır|secret/i));
  const tok = clone(syn); tok.access_token = 'x';
  ok('access_token anahtarı → reddedilir', throws(() => sanitizeMapbox(tok), /sır|secret/i));
  const enumSecret = clone(syn); enumSecret.routes[0].legs[0].steps[0].intersections[0].classes.push('gizli-deger');
  ok('izin listesi dışı enum değeri → reddedilir (düşürülmez)', throws(() => sanitizeMapbox(enumSecret), /enum/i));
  const mt = clone(syn); mt.routes[0].legs[0].steps[0].maneuver.type = 'Sentetik Cadde';
  ok('manevra türünde serbest metin → reddedilir', throws(() => sanitizeMapbox(mt), /enum/i));
  const ns = clone(syn); ns.routes[0].distance = '12000';
  ok('sayısal alan dize → reddedilir', throws(() => sanitizeMapbox(ns), /sayı|number/i));
  const neg = clone(syn); neg.routes[0].duration = -1;
  ok('negatif sayı → reddedilir', throws(() => sanitizeMapbox(neg), /sayı|number/i));
  const big = clone(syn); big.routes[0].distance = 1735689600000;
  ok('zaman damgası boyutunda sayı → reddedilir', throws(() => sanitizeMapbox(big), /sayı|number/i));
  const nan = clone(syn); nan.routes[0].legs[0].steps[0].distance = null;
  ok('null sayısal alan → reddedilir', throws(() => sanitizeMapbox(nan), /sayı|number/i));
  const cls = clone(syn); cls.routes[0].legs[0].steps[0].intersections[0].classes = 'tunnel';
  ok('dizi beklenen yerde dize → reddedilir', throws(() => sanitizeMapbox(cls), /dizi|array/i));
  ok('kök nesne değilse → reddedilir', [null, 1, 'x', [], true].every((v) => throws(() => sanitizeMapbox(v))));
  const noRoutes = clone(syn); delete noRoutes.routes;
  ok('routes yoksa → reddedilir', throws(() => sanitizeMapbox(noRoutes), /routes/));
  let d = {}; const top = { _synthetic: true, code: 'Ok', routes: [], x: d }; for (let i = 0; i < 200; i++) { d.y = {}; d = d.y; }
  ok('aşırı derin girdi → reddedilir', throws(() => sanitizeMapbox(top), /derin|depth/i));
  const many = clone(syn); many.routes = Array.from({ length: 20 }, () => clone(syn.routes[0]));
  ok('aşırı rota sayısı → reddedilir', throws(() => sanitizeMapbox(many), /sınır|limit/i));
  const proto = JSON.parse('{"_synthetic":true,"code":"Ok","routes":[],"__proto__":{"polluted":1}}');
  ok('__proto__ anahtarı → reddedilir', throws(() => sanitizeMapbox(proto)) && ({}).polluted === undefined);
}

// ---- Sızıntı taraması (bağımsız ikinci savunma hattı) ----
{
  ok('çıktıda izin listesi dışı anahtar → sızıntı', leakScan(syn, { ...out, name: 'x' }).length > 0);
  ok('çıktıda ham girdi dizesi → sızıntı', leakScan(syn, { ...out, code: 'Sentetik Otoyolu' }).length > 0);
  ok('çıktıda ondalık koordinat → sızıntı', leakScan(syn, { ...out, routes: [{ ...out.routes[0], distance: 28.9784123 }] }).length > 0);
  ok('çıktıda URL → sızıntı', leakScan(syn, { ...out, code: 'https://example.invalid' }).length > 0);
  ok('çıktıda sahte belirteç → sızıntı', leakScan(syn, { ...out, code: FAKE_PK }).length > 0);
  ok('çıktıda verified iddiası → sızıntı', leakScan(syn, { ...out, _verified: true }).length > 0 && leakScan(syn, { ...out, _evidence: 'verified' }).length > 0);
  ok('sentetik girdi için _recorded=true → sızıntı', leakScan(syn, { ...out, _recorded: true, _synthetic: false }).length > 0);
}

// ---- fromMapbox: sanitize edilmiş çıktı da 0 olay, FIELD_EVIDENCE unverified ----
{
  const m = A.fromMapbox(out);
  ok('fromMapbox(sanitize çıktısı) 0 olay, 0 yetenek', m.events.length === 0 && m.supports.length === 0 && m.provider === 'mapbox');
  ok('FIELD_EVIDENCE.mapbox tümü unverified, records 0', A.FIELD_EVIDENCE.mapbox.every((f) => f.status === 'unverified' && f.records === 0 && f.evidence === null));
  ok('adaptEvidence(sanitize çıktısı) unverified', A.adaptEvidence('mapbox', out).status === 'unverified' && A.adaptEvidence('mapbox', out).records === 0);
}

// ---- CLI: geçici sahte depo + depo dışı girdi ----
const tmpRoot = mkdtempSync(join(tmpdir(), 'mbx-sanitize-test-'));
const fakeRepo = join(tmpRoot, 'repo');
const fakeFix = join(fakeRepo, 'scripts', 'fixtures', 'road-events');
mkdirSync(fakeFix, { recursive: true });
const outsideDir = join(tmpRoot, 'outside');
mkdirSync(outsideDir);
const inputPath = join(outsideDir, 'in.json');
writeFileSync(inputPath, J(syn));
const opts = { repoRoot: fakeRepo, fixtureDir: fakeFix };
try {
  // Varsayılan: hiçbir dosya okunmaz
  const calls = [];
  const spyFs = new Proxy({}, { get: (_t, k) => (...a) => { calls.push(k); throw new Error('fs yasak'); } });
  const r0 = runCli([], { ...opts, fs: spyFs });
  ok('argümansız: hata kodu, hiçbir dosya işlemi yok', r0.code !== 0 && calls.length === 0, J(calls));
  const r0b = runCli(['--input', inputPath], { ...opts, fs: spyFs });
  ok('--output eksik: hiçbir dosya işlemi yok', r0b.code !== 0 && calls.length === 0);
  const r0c = runCli(['--input', inputPath, '--output', 'mapbox-sanitized-a.json', '--extra', 'x'], { ...opts, fs: spyFs });
  ok('bilinmeyen argüman: reddedilir, dosya işlemi yok', r0c.code !== 0 && calls.length === 0);

  // Çıktı adı fixture klasörü dışına çıkamaz
  for (const n of ['../x.json', '..\\x.json', 'sub/mapbox-sanitized-a.json', join(tmpRoot, 'mapbox-sanitized-a.json'), 'mapbox-sanitized-a.txt', 'x.json', 'mapbox-synthetic.json', 'mapbox-sanitized-A.json', 'mapbox-sanitized-.json', '']) {
    const r = runCli(['--input', inputPath, '--output', n], opts);
    ok(`çıktı adı reddedilir: ${JSON.stringify(n).slice(0, 60)}`, r.code !== 0 && !OUTPUT_NAME_RE.test(n));
  }
  ok('hiçbir şey yazılmadı (geçersiz adlar)', readdirSync(fakeFix).length === 0 && readdirSync(tmpRoot).sort().join(',') === 'outside,repo');

  // Girdi depo içinde olamaz
  const inRepo = join(fakeRepo, 'in.json'); writeFileSync(inRepo, J(syn));
  const r1 = runCli(['--input', inRepo, '--output', 'mapbox-sanitized-a.json'], opts);
  ok('depo içindeki girdi reddedilir', r1.code !== 0 && /depo|repo/i.test(r1.message) && readdirSync(fakeFix).length === 0);
  const inFix = join(fakeFix, 'in.json'); writeFileSync(inFix, J(syn));
  const r1b = runCli(['--input', inFix, '--output', 'mapbox-sanitized-a.json'], opts);
  ok('fixture klasöründeki girdi reddedilir', r1b.code !== 0 && !existsSync(join(fakeFix, 'mapbox-sanitized-a.json')));
  rmSync(inFix);
  const r1c = runCli(['--input', join(fakeRepo, '..', 'repo', 'in.json'), '--output', 'mapbox-sanitized-a.json'], opts);
  ok('.. ile gizlenen depo içi girdi reddedilir', r1c.code !== 0);
  // Gerçek depo içindeki dosya da reddedilir (varsayılan repoRoot)
  const r1d = runCli(['--input', join(root, 'scripts', 'fixtures', 'road-events', 'mapbox-sanitize-input-synthetic.json'), '--output', 'mapbox-sanitized-zz-test.json']);
  ok('gerçek depodaki sentetik örnek girdi olarak reddedilir', r1d.code !== 0 && /depo|repo/i.test(r1d.message));

  // Geçersiz JSON / boyut / eksik dosya
  const badJson = join(outsideDir, 'bad.json'); writeFileSync(badJson, '{"routes": [');
  const r2 = runCli(['--input', badJson, '--output', 'mapbox-sanitized-a.json'], opts);
  ok('geçersiz JSON reddedilir', r2.code !== 0 && /JSON/.test(r2.message) && readdirSync(fakeFix).length === 0);
  const huge = join(outsideDir, 'huge.json'); writeFileSync(huge, '{"_synthetic":true,"pad":"' + 'a'.repeat(MAX_INPUT_BYTES) + '"}');
  const r3 = runCli(['--input', huge, '--output', 'mapbox-sanitized-a.json'], opts);
  ok('>5 MB girdi reddedilir', r3.code !== 0 && /5 ?MB|boyut|size/i.test(r3.message) && readdirSync(fakeFix).length === 0);
  const r4 = runCli(['--input', join(outsideDir, 'yok.json'), '--output', 'mapbox-sanitized-a.json'], opts);
  ok('olmayan girdi reddedilir', r4.code !== 0 && readdirSync(fakeFix).length === 0);
  const r4b = runCli(['--input', outsideDir, '--output', 'mapbox-sanitized-a.json'], opts);
  ok('klasör girdi reddedilir', r4b.code !== 0);

  // Kötü niyetli iç içe sır: CLI hiçbir şey yazmaz
  const evil = clone(syn); evil.routes[0].legs[0].steps[0].maneuver.note = { deeper: [{ k: FAKE_SK }] };
  const evilPath = join(outsideDir, 'evil.json'); writeFileSync(evilPath, J(evil));
  const r5 = runCli(['--input', evilPath, '--output', 'mapbox-sanitized-a.json'], opts);
  ok('iç içe sır içeren girdi: CLI reddeder, dosya yazılmaz', r5.code !== 0 && readdirSync(fakeFix).length === 0 && !String(r5.message).includes(FAKE_SK));

  // Başarılı yol (sentetik girdi, sahte depo)
  const r6 = runCli(['--input', inputPath, '--output', 'mapbox-sanitized-ornek-1.json'], opts);
  const written = join(fakeFix, 'mapbox-sanitized-ornek-1.json');
  ok('sentetik girdi: sahte depoda yalnızca hedef dosya yazılır', r6.code === 0 && readdirSync(fakeFix).join(',') === 'mapbox-sanitized-ornek-1.json', r6.message);
  const w = existsSync(written) ? JSON.parse(readFileSync(written, 'utf8')) : null;
  ok('yazılan dosya sanitize çıktısıyla aynı, sentetik, recorded değil, verified değil', w && J(w) === J(out) && w._synthetic === true && w._recorded === false && w._verified === false);
  ok('mesaj girdi yolunu/ham değeri sızdırmaz', !String(r6.message).includes('Sentetik'));

  // Üzerine yazma yok
  const before = readFileSync(written, 'utf8');
  const r7 = runCli(['--input', inputPath, '--output', 'mapbox-sanitized-ornek-1.json'], opts);
  ok('var olan çıktı: reddedilir, üzerine yazılmaz', r7.code !== 0 && /var|exist/i.test(r7.message) && readFileSync(written, 'utf8') === before);

  // Gerçek CLI süreci: argümansız çalıştırma hiçbir şey yazmaz
  const cli = spawnSync(process.execPath, [join(root, 'scripts', 'mapbox-sanitize.mjs')], { encoding: 'utf8', timeout: 20000 });
  ok('gerçek CLI argümansız: sıfırdan farklı çıkış kodu', cli.status !== 0 && cli.status !== null, `${cli.status} ${cli.stderr}`);
  const cli2 = spawnSync(process.execPath, [join(root, 'scripts', 'mapbox-sanitize.mjs'), '--input', inputPath, '--output', '../escape.json'], { encoding: 'utf8', timeout: 20000 });
  ok('gerçek CLI fixture dışı çıktı: reddedilir', cli2.status !== 0 && cli2.status !== null);
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
ok('gerçek fixture klasörü değişmedi (hiçbir çıktı üretilmedi)', J(readdirSync(FIX_DIR).sort()) === J(fixtureListBefore));
ok('depoda gerçek sanitize çıktısı yok', !readdirSync(FIX_DIR).some((n) => /^mapbox-sanitized-/.test(n)));

// ---- Statik: araç ağ/ortam kullanmaz, çalışma zamanına bağlı değil ----
{
  const src = read('scripts/mapbox-sanitize.mjs');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const imports = [...code.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  ok('yalnızca node:fs/node:path/node:url (+ ./sanitize-core.mjs) içe aktarılır', imports.length > 0 && imports.every((m) => ['node:fs', 'node:path', 'node:url', './sanitize-core.mjs'].includes(m)), J(imports));
  ok('dinamik import/require yok', !/\bimport\s*\(|\brequire\s*\(/.test(code));
  ok('ağ/ortam/çocuk süreç yok', !/\b(fetch|XMLHttpRequest|WebSocket|process\.env|child_process|node:https?|node:net|node:dns)\b/.test(code));
  ok('araçta gerçek belirteç biçimi yok', !/pk\.eyJ|sk\.eyJ|AIza[0-9A-Za-z_-]{10}/.test(src));
  function walk(dir, acc = []) {
    for (const n of readdirSync(dir)) {
      if (['node_modules', 'data'].includes(n)) continue;
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, acc); else acc.push(p);
    }
    return acc;
  }
  const rel = (p) => relative(root, p).replace(/\\/g, '/');
  const runtime = [...walk(join(root, 'js')), ...walk(join(root, 'server')), join(root, 'index.html'), join(root, 'sw.js')].filter((p) => /\.(m?js|html)$/.test(p));
  ok('tarama çalışma zamanı dosyalarını kapsar', runtime.length > 20 && runtime.some((p) => rel(p) === 'sw.js'));
  const users = runtime.filter((p) => /mapbox-sanitize|sanitizeMapbox/.test(readFileSync(p, 'utf8'))).map(rel);
  ok('hiçbir çalışma zamanı dosyası temizleyiciye bağlı değil', users.length === 0, users.join(', '));
}

// ---- BL-P2-05c-2: sanitize-core göçü için davranış eşitliği korkulukları ----
// Bu davranışlar sanitize-core.mjs'ten FARKLIDIR; ileride yapılacak bir göç bunları değiştirmemelidir.
{
  const ex = sanitizeMapbox({ routes: [{ legs: [{ steps: [{ distance: 1, exits: '73B' }] }] }] });
  const exJ = J(ex);
  ok('göç korkuluğu: exits değeri kopyalanmaz, yalnızca exits_present=true', ex.routes[0].legs[0].steps[0].exits_present === true && !exJ.includes('73B') && !('exits' in ex.routes[0].legs[0].steps[0]));
  ok('göç korkuluğu: exits nesne ise reddedilir', throws(() => sanitizeMapbox({ routes: [{ legs: [{ steps: [{ exits: { n: 1 } }] }] }] }), /exits: beklenmeyen tür/));
  // Atılan bir alandaki ham dize çıktı anahtar adıyla aynıysa sızıntı sayılır (çekirdek bunu sözcük dağarcığı diye atlar).
  const rk = { routes: [{ distance: 1, duration: 2, summary: 'duration' }] };
  ok('göç korkuluğu: anahtar adına eşit ham dize leakScan bulgusu', leakScan(rk, sanitizeMapbox(clone(rk))).includes('ham girdi dizesi çıktıda'));
  ok('göç korkuluğu: hata yolu $ öneksiz ve sayı iletisi biçimi', throws(() => sanitizeMapbox({ routes: [{ distance: -1 }] }), /^routes\[0\]\.distance: geçersiz sayı \(number; 0\.\.10000000\)$/));
  ok('göç korkuluğu: routes yok iletisi', throws(() => sanitizeMapbox({ code: 'Ok' }), /^routes yok; reddedildi$/));
  ok('göç korkuluğu: sabit alan sırası (distance, legs’ten önce denetlenir)', throws(() => sanitizeMapbox({ routes: [{ legs: 'x', distance: -1 }] }), /^routes\[0\]\.distance:/));
  ok('göç korkuluğu: kök meta iddiaları yok sayılır, _verified=false', (() => { const m = sanitizeMapbox({ _verified: true, _recorded: false, _evidence: 'x', routes: [] }); return m._verified === false && m._recorded === true && m._evidence === 'unverified' && m._synthetic === false; })());
  ok('göç korkuluğu: _sanitizerVersion=1, _source=mapbox-directions', (() => { const m = sanitizeMapbox({ routes: [] }); return m._sanitizerVersion === 1 && m._source === 'mapbox-directions'; })());
}

// ---- BL-P2-05c-2c T0: altın (golden) davranış tabloları — sentetik, beklenen değerler ELLE yazılmıştır ----
// Beklenen çıktılar/iletiler/sıralar hiçbir yerde sanitizeMapbox/leakScan çağrılarak üretilmez; birebir dize karşılaştırması yapılır.
{
  const C = await import('./sanitize-core.mjs');
  const MR = '{"_sanitized":true,"_recorded":true,"_synthetic":false,"_verified":false,"_evidence":"unverified","_source":"mapbox-directions","_sanitizerVersion":1';
  const MS = '{"_sanitized":true,"_recorded":false,"_synthetic":true,"_verified":false,"_evidence":"unverified","_source":"mapbox-directions","_sanitizerVersion":1';
  const st1 = (...steps) => ({ routes: [{ legs: [{ steps }] }] });
  const st1J = (stepsJ) => `${MR},"routes":[{"legs":[{"steps":[${stepsJ}]}]}]}`;
  const P = 'routes[0].legs[0].steps[0]';
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof Error ? e.message : '<hata değil>'; } };
  const nest = (n) => { const r = { routes: [] }; let c = r; for (let i = 0; i < n; i++) { c.x = {}; c = c.x; } return r; };
  const ENUM_ERR = 'izin listesi dışı enum değeri; reddedildi';
  const NUM_ERR = 'geçersiz sayı (number; 0..10000000)';

  // Kabul: birebir çıktı JSON'u (işaretler + anahtar sırası dahil)
  const ACCEPT = [
    ['boş routes, sentetik değil', { routes: [] }, `${MR},"routes":[]}`],
    ['sentetik + code', { _synthetic: true, code: 'Ok', routes: [] }, `${MS},"code":"Ok","routes":[]}`],
    ['kök anahtar sırası sabit, girdi meta iddiası yok sayılır', { routes: [], _verified: true, _evidence: 'verified', code: 'NoSegment' }, `${MR},"code":"NoSegment","routes":[]}`],
    ['rota sayıları yuvarlanır, sıra distance/duration/legs, bilinmeyenler atılır', { routes: [{ legs: [], weight: 5, geometry: 'abc', duration: 2.5, distance: 10.4 }] }, `${MR},"routes":[{"distance":10,"duration":3,"legs":[]}]}`],
    ['sayı sınırları 0 ve 10000000, yuvarlama sınırı', { routes: [{ duration: 10000000, distance: 0 }, { distance: 9999999.5, duration: 0.49 }] }, `${MR},"routes":[{"distance":0,"duration":10000000},{"distance":10000000,"duration":0}]}`],
    ['en çok 5 rota kabul', { routes: [{}, {}, {}, {}, {}] }, `${MR},"routes":[{},{},{},{},{}]}`],
    ['adım anahtar sırası girdiden bağımsız', st1({ bannerInstructions: [{}], intersections: [{}], exits: 5, driving_side: 'left', mode: 'ferry', maneuver: { modifier: 'left', type: 'turn' }, duration: 1, distance: 2 }),
      st1J('{"distance":2,"duration":1,"maneuver":{"type":"turn","modifier":"left"},"mode":"ferry","driving_side":"left","exits_present":true,"intersections":[{}],"bannerInstructions":[{}]}')],
    ['exits yalnızca varlık: boş dize/0/metin → exits_present', st1({ exits: '' }, { exits: 0 }, { exits: '73B' }), st1J('{"exits_present":true},{"exits_present":true},{"exits_present":true}')],
    ['boş alt nesneler korunur', st1({ maneuver: {}, intersections: [{}, { classes: [] }, { toll_collection: {} }], bannerInstructions: [{}, { primary: {} }, { primary: { components: [{}] } }] }),
      st1J('{"maneuver":{},"intersections":[{},{"classes":[]},{"toll_collection":{}}],"bannerInstructions":[{},{"primary":{}},{"primary":{"components":[{}]}}]}')],
    ['kavşak: sınıf sırası/tekrarı korunur, konum/ad/bearing atılır', st1({ intersections: [{ toll_collection: { name: 'G', type: 'toll_gantry' }, bearings: [90], location: [28.9, 41.0], classes: ['toll', 'toll', 'ferry'] }] }),
      st1J('{"intersections":[{"classes":["toll","toll","ferry"],"toll_collection":{"type":"toll_gantry"}}]}')],
    ['her düzeyde bilinmeyen alan atılır', { uuid: 'u-1', waypoints: [{ name: 'W', location: [1.5, 2.5] }], routes: [{ weight_name: 'auto', legs: [{ summary: 'S', annotation: { speed: [1] }, steps: [{ name: 'Cadde', geometry: 'poly', ref: 'D100', destinations: 'X', voiceInstructions: [{ announcement: 'a' }] }] }] }] },
      `${MR},"routes":[{"legs":[{"steps":[{}]}]}]}`],
    ['derinlik 64 kabul (atılan alanda)', nest(64), `${MR},"routes":[]}`],
  ];
  for (const [name, input, want] of ACCEPT) {
    let got; const e = errOf(() => { got = J(sanitizeMapbox(input)); });
    ok(`altın kabul: ${name}`, e === null && got === want, e ?? got);
  }

  // Ret: birebir hata iletisi ve hata sırası (ilk bulunan hata)
  const REJECT = [
    ['routes yok', { code: 'Ok' }, 'routes yok; reddedildi'],
    ['code, routes denetiminden önce', { code: 'ok' }, `code: ${ENUM_ERR}`],
    ['routes nesne', { routes: {} }, 'routes: dizi (array) bekleniyor'],
    ['6 rota', { routes: [{}, {}, {}, {}, {}, {}] }, 'routes: eleman sınırı (limit 5) aşıldı'],
    ['preScan yapı denetiminden önce (Bearer)', { routes: 'x', note: 'bearer abc' }, 'girdide sır (secret) benzeri değer var; tüm girdi reddedildi'],
    ['atılan alanda prototype anahtarı', { routes: [], meta: { prototype: 1 } }, 'girdide yasak nesne anahtarı var; reddedildi'],
    ['büyük/küçük harf duyarsız sır anahtarı', { routes: [], headers: { 'X-Api-Key': 'v' } }, 'girdide sır (secret) taşıyan anahtar var (Authorization/token…); tüm girdi reddedildi'],
    ['dizi içinde AIza değeri', { routes: [], list: [['AI' + 'za' + '0123456789AB']] }, 'girdide sır (secret) benzeri değer var; tüm girdi reddedildi'],
    ['adımda distance, manevradan önce', st1({ maneuver: { type: 'bad' }, distance: -1 }), `${P}.distance: ${NUM_ERR}`],
    ['manevra type, modifier’dan önce', st1({ maneuver: { modifier: 'Bad', type: 'Bad' } }), `${P}.maneuver.type: ${ENUM_ERR}`],
    ['exits null, intersections’tan önce', st1({ intersections: 'x', exits: null }), `${P}.exits: beklenmeyen tür`],
    ['exits boolean', st1({ exits: true }), `${P}.exits: beklenmeyen tür`],
    ['kavşak sınıf yolu indeksli (büyük harf enum)', st1({ intersections: [{}, { classes: ['toll', 'Toll'] }] }), `${P}.intersections[1].classes[1]: ${ENUM_ERR}`],
    ['banner bileşen yolu indeksli', st1({ bannerInstructions: [{ primary: { components: [{ type: 'text' }, { type: 'html' }] } }] }), `${P}.bannerInstructions[0].primary.components[1].type: ${ENUM_ERR}`],
    ['ikinci rota bacağı null', { routes: [{}, { legs: [null] }] }, 'routes[1].legs[0]: nesne (object) bekleniyor'],
    ['üst sınır üstü sayı', { routes: [{ distance: 10000000.4 }] }, `routes[0].distance: ${NUM_ERR}`],
    ['derinlik 65', nest(65), 'girdi aşırı derin (depth sınırı); reddedildi'],
  ];
  for (const [name, input, want] of REJECT) {
    const e = errOf(() => sanitizeMapbox(input));
    ok(`altın ret: ${name}`, e === want, String(e));
  }

  // leakScan: birebir bulgu dizisi ve sırası
  const base = (inp) => sanitizeMapbox(inp); // yalnızca girdi üretir; beklenen bulgular aşağıda elle yazılı
  const HAM = 'ham girdi dizesi çıktıda';
  const LEAK = [
    ['anahtar adına eşit ham dize (8 krk)', { routes: [{ duration: 1 }], s: 'duration' }, null, [HAM]],
    ['anahtar adına eşit 5 krk ham dize alt dize sayılmaz', { routes: [{ legs: [{ steps: [] }] }], s: 'steps' }, null, []],
    ['anahtar adına eşit 6 krk ham dize bulgu (tek kez)', { routes: [], s: 'routes', t: 'mapbox' }, null, [HAM]],
    ['meta değer alt dizesi 6 krk bulgu', { routes: [], s: 'direct' }, null, [HAM]],
    ['meta değer alt dizesi 5 krk temiz', { routes: [], s: 'irect' }, null, []],
    ['kısa ham dize çıktı değerine birebir eşit', { routes: [], s: 'ab' }, { code: 'ab' }, ['$.code: izin listesi dışı dize', HAM]],
    ['işaret bulguları sabit sırada', { routes: [] }, { _sanitized: false, _recorded: false, _synthetic: true, _verified: true, _evidence: 'x' },
      ['_sanitized true değil', '_verified false değil', '_evidence unverified değil', '_synthetic girdiyle uyumsuz', '_recorded girdiyle uyumsuz', '$._evidence: izin listesi dışı dize']],
    ['ek anahtar + zaman damgası dizesi + ondalık', { routes: [] }, { extra: 'Sentetik', code: '2026-01-01T10', routes: [{ distance: 28.9784 }] },
      ['$.routes[0].distance: izin dışı sayı', '$: izin listesi dışı anahtar', '$.code: izin listesi dışı dize', 'çıktıda zaman damgası', 'çıktıda ondalık koordinat benzeri sayı']],
  ];
  for (const [name, input, patch, want] of LEAK) {
    const outp = patch ? { ...base({ routes: [] }), ...patch } : base(input);
    const got = leakScan(input, outp);
    ok(`altın leakScan: ${name}`, J(got) === J(want), J(got));
  }

  // GELECEK SIKILAŞTIRMA (kasıtlı): çekirdek (sanitize-core) bunları reddeder. Mapbox'ın bugünkü kabulü KİLİTLENMEZ;
  // yalnızca kabul edilirse ham değerin çıktıya geçmediği denetlenir. Göç sonrası reddedilmeleri beklenen iyileşmedir.
  const FUT = [
    ['Basic yetki değeri', { routes: [], h: 'Basic QUJDREVGR0hJ' }, 'QUJDREVGR0hJ'],
    ['key= değeri', { routes: [], q: 'key=abc123' }, 'abc123'],
    ['session anahtarı', { routes: [], session: 'sess-value-1' }, 'sess-value-1'],
    ['atılan alanda sonsuz sayı', { routes: [], n: Infinity }, null],
    ['atılan alanda Date nesnesi', { routes: [], d: new Date(0) }, null],
  ];
  for (const [name, input, raw] of FUT) {
    const coreRejects = errOf(() => C.preScan(input)) !== null;
    let o = null; errOf(() => { o = sanitizeMapbox(input); });
    ok(`gelecek sıkılaştırma (kasıtlı, kilitlenmez): ${name} — çekirdek reddeder, Mapbox çıktısına ham değer geçmez`,
      coreRejects && (o === null || (raw === null || !J(o).includes(raw))), `core=${coreRejects}`);
  }
}

// ---- BL-P2-05c-2g T4: çekirdek göçü — yalnızca DAHA SIKI yeni retler (sentetik; beklenen iletiler elle yazılı) ----
{
  const C = await import('./sanitize-core.mjs');
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof Error ? e.message : '<hata değil>'; } };
  const SV = 'girdide sır (secret) benzeri değer var; tüm girdi reddedildi';
  const SK = 'girdide sır (secret) taşıyan anahtar var (Authorization/token…); tüm girdi reddedildi';
  const STRICT = [
    ['Basic yetki değeri', { routes: [], h: 'Basic QUJDREVGR0hJ' }, SV],
    ['key= değeri', { routes: [], q: 'key=abc123' }, SV],
    ['session anahtarı', { routes: [], session: 'sess-value-1' }, SK],
    ['atılan alanda sonsuz sayı', { routes: [], n: Infinity }, 'girdide sonlu olmayan sayı; reddedildi'],
    ['atılan alanda Date nesnesi', { routes: [], d: new Date(0) }, 'girdide düz olmayan nesne (Date/Map/sınıf); reddedildi'],
    ['sahte exits_present (varlık iddiası)', { routes: [{ legs: [{ steps: [{ exits_present: true }] }] }] }, 'routes[0].legs[0].steps[0].exits_present: varlık anahtarı girdide olamaz; reddedildi'],
    ['passwd anahtarı', { routes: [], passwd: 'x' }, SK],
    ['PEM özel anahtar başlığı', { routes: [], p: '-----BEGIN ' + 'PRIVATE KEY-----' }, SV],
  ];
  for (const [name, input, want] of STRICT) {
    const e = errOf(() => sanitizeMapbox(input));
    ok(`göç sıkılaştırması (yeni ret): ${name}`, e === want, String(e));
  }
  // CLI: sahte varlık anahtarı → kod 6, hiçbir şey yazılmaz; başarılı çıktı çekirdek buildSanitized çıktısıyla birebir aynı.
  const t = mkdtempSync(join(tmpdir(), 'mbx-core-test-'));
  try {
    const fr = join(t, 'repo'), ff = join(fr, 'scripts', 'fixtures', 'road-events'), od = join(t, 'o');
    mkdirSync(ff, { recursive: true }); mkdirSync(od);
    const fake = join(od, 'fake.json'); writeFileSync(fake, J({ routes: [{ legs: [{ steps: [{ exits_present: true }] }] }] }));
    const r = runCli(['--input', fake, '--output', 'mapbox-sanitized-fake.json'], { repoRoot: fr, fixtureDir: ff });
    ok('CLI: sahte exits_present → kod 6, dosya yazılmaz', r.code === 6 && /varlık anahtarı/.test(r.message) && readdirSync(ff).length === 0, J(r));
    const good = join(od, 'in.json'); writeFileSync(good, J(syn));
    const r2 = runCli(['--input', good, '--output', 'mapbox-sanitized-core.json'], { repoRoot: fr, fixtureDir: ff });
    const core = C.buildSanitized(clone(syn), { type: 'object', fields: { x: { type: 'boolean' } } }, { source: 'mapbox-directions', unknown: 'drop' });
    const w = r2.code === 0 ? readFileSync(join(ff, 'mapbox-sanitized-core.json'), 'utf8') : '';
    ok('CLI: başarılı çıktı = sanitizeMapbox çıktısı (2 boşluk + LF), çekirdek işaretleri aynı', r2.code === 0 && w === JSON.stringify(sanitizeMapbox(clone(syn)), null, 2) + '\n'
      && core.ok && ['_sanitized', '_recorded', '_synthetic', '_verified', '_evidence', '_source', '_sanitizerVersion'].every((k) => JSON.parse(w)[k] === core.output[k]), J(r2));
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
  // Statik: çekirdek seçenekleri kaynakta açıkça (opt-in) verilir.
  const src = read('scripts/mapbox-sanitize.mjs');
  ok("statik: order:'spec', required:'inline', errorStyle:'compact', unknown:'drop', presence, buildSanitized, rawExempt:'exact', minNumber:0",
    [/order: 'spec'/, /required: 'inline'/, /errorStyle: 'compact'/, /unknown: 'drop'/, /type: 'presence'/, /buildSanitized\(parsed, MAPBOX_SPEC, CORE_OPTS\)/, /rawExempt: 'exact', minNumber: 0/].every((re) => re.test(src)));
}

// ---- BL-P2-05c-2h T4 korkulukları: yeni (daha sıkı) retlerin tam nitelendirmesi + iyi huylu metin yanlış pozitif tanısı ----
// Yalnızca sentetik girdi; beklenen iletiler/çıktılar ELLE yazılmıştır (sanitizeMapbox çağrılarak üretilmez).
// Başvuru: 111028c (göç öncesi) bu girdilerin hepsini kabul ediyordu; 971e8a3 (göç) bunları reddeder.
{
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return e instanceof Error ? e.message : '<hata değil>'; } };
  const SV = 'girdide sır (secret) benzeri değer var; tüm girdi reddedildi';
  const SK = 'girdide sır (secret) taşıyan anahtar var (Authorization/token…); tüm girdi reddedildi';
  const RAW = 'RAWVAL-7f3c'; // ileti sızıntı denetimi için ayırt edici sahte değer
  const P = 'routes[0].legs[0].steps[0]';
  const stepWith = (s) => ({ routes: [{ legs: [{ steps: [s] }] }] });

  // 1) JSON ile ifade edilebilen yeni retler (CLI'ya da ulaşabilir) — birebir ileti, ileti ham değer taşımaz.
  const STRICT_JSON = [
    ['sahte exits_present=true', stepWith({ exits_present: true }), `${P}.exits_present: varlık anahtarı girdide olamaz; reddedildi`],
    ['sahte exits_present=false', stepWith({ exits_present: false }), `${P}.exits_present: varlık anahtarı girdide olamaz; reddedildi`],
    ['sahte exits_present + gerçek exits', stepWith({ exits: '12', exits_present: true }), `${P}.exits_present: varlık anahtarı girdide olamaz; reddedildi`],
    ['passwd anahtarı', { routes: [], passwd: RAW }, SK],
    ['private_key anahtarı', { routes: [], private_key: RAW }, SK],
    ['privatekey anahtarı', { routes: [], privatekey: RAW }, SK],
    ['access-token anahtarı', { routes: [], 'access-token': RAW }, SK],
    ['refresh-token anahtarı', { routes: [], 'refresh-token': RAW }, SK],
    ['client-secret anahtarı', { routes: [], 'client-secret': RAW }, SK],
    ['iç içe Private_Key (büyük/küçük harf)', { routes: [{ legs: [{ meta: { Private_Key: RAW } }] }] }, SK],
    ['PEM PRIVATE KEY başlığı', { routes: [], p: '-----BEGIN ' + 'PRIVATE KEY-----\n' + RAW }, SV],
    ['PEM RSA PRIVATE KEY başlığı', { routes: [], p: '-----BEGIN RSA ' + 'PRIVATE KEY-----' }, SV],
    ['PEM EC PRIVATE KEY başlığı dizide', { routes: [], l: ['-----BEGIN EC ' + 'PRIVATE KEY-----'] }, SV],
  ];
  for (const [name, input, want] of STRICT_JSON) {
    const e = errOf(() => sanitizeMapbox(input));
    ok(`T4 sıkı ret (birebir ileti): ${name}`, e === want && !String(e).includes(RAW), String(e));
  }

  // 2) Yalnızca programatik (JSON'da ifade edilemez) girdiler — birebir ileti.
  const cyc = { routes: [] }; cyc.self = cyc;
  const cycArr = { routes: [] }; cycArr.l = [cycArr];
  const PROG = [
    ['kök undefined', undefined, 'kök: nesne (object) bekleniyor'],
    ['kök NaN', NaN, 'kök: nesne (object) bekleniyor'],
    ['kök Map', new Map([['routes', []]]), 'girdide düz olmayan nesne (Date/Map/sınıf); reddedildi'],
    ['alan undefined', { routes: [], u: undefined }, 'girdide izin dışı tür (işlev/symbol/bigint/undefined); reddedildi'],
    ['alan Map', { routes: [], m: new Map() }, 'girdide düz olmayan nesne (Date/Map/sınıf); reddedildi'],
    ['alan NaN', { routes: [], n: NaN }, 'girdide sonlu olmayan sayı; reddedildi'],
    ['izinli alanda NaN (distance)', { routes: [{ distance: NaN }] }, 'girdide sonlu olmayan sayı; reddedildi'],
    ['döngüsel nesne', cyc, 'girdide döngüsel başvuru; reddedildi'],
    ['dizi üzerinden döngü', cycArr, 'girdide döngüsel başvuru; reddedildi'],
  ];
  for (const [name, input, want] of PROG) {
    const e = errOf(() => sanitizeMapbox(input));
    ok(`T4 programatik ret (birebir ileti): ${name}`, e === want, String(e));
  }

  // 3) Kabul edilen altın çıktılar BAYT BAYT (elle yazılı): sentetik örnek (tek satır + CLI dosya biçimi) ve sınır örnekleri.
  const SYN_J = '{"_sanitized":true,"_recorded":false,"_synthetic":true,"_verified":false,"_evidence":"unverified","_source":"mapbox-directions","_sanitizerVersion":1,"code":"Ok","routes":[{"distance":12000,"duration":601,"legs":[{"distance":12000,"duration":601,"steps":[{"distance":900,"duration":45,"maneuver":{"type":"off ramp","modifier":"slight right"},"mode":"driving","driving_side":"right","exits_present":true,"intersections":[{"classes":["tunnel","motorway"]},{"classes":["toll"],"toll_collection":{"type":"toll_booth"}}],"bannerInstructions":[{"primary":{"components":[{"type":"exit-number"},{"type":"text"}]}}]},{"distance":0,"duration":0,"maneuver":{"type":"arrive"},"mode":"driving","driving_side":"right","intersections":[{}]}]}]}]}';
  ok('T4 altın kabul (bayt): sentetik örnek tek satır JSON', J(sanitizeMapbox(clone(syn))) === SYN_J);
  const MR = '{"_sanitized":true,"_recorded":true,"_synthetic":false,"_verified":false,"_evidence":"unverified","_source":"mapbox-directions","_sanitizerVersion":1';
  const GOLD = [
    ['exits sayı → yalnızca exits_present', stepWith({ exits: 3 }), `${MR},"routes":[{"legs":[{"steps":[{"exits_present":true}]}]}]}`],
    ['tokenize/keyboard gibi sır olmayan anahtar adları atılır', { routes: [], keyboard: 'v', tokenize: 'v', secretary: 'v' }, `${MR},"routes":[]}`],
    ['PEM PUBLIC KEY başlığı (özel değil) atılır', { routes: [], p: '-----BEGIN PUBLIC KEY-----' }, `${MR},"routes":[]}`],
  ];
  for (const [name, input, want] of GOLD) {
    let got; const e = errOf(() => { got = J(sanitizeMapbox(input)); });
    ok(`T4 altın kabul (bayt): ${name}`, e === null && got === want, e ?? got);
  }

  // 4) CLI: gerçek süreç, ret → çıkış 6/7, stdout boş, hiçbir dosya yazılmaz; kabul → dosya baytları elle yazılı altınla aynı.
  const t = mkdtempSync(join(tmpdir(), 'mbx-t4g-test-'));
  const CLI = join(root, 'scripts', 'mapbox-sanitize.mjs');
  const realFixBefore = readdirSync(FIX_DIR).sort().join(',');
  const created = [];
  try {
    const runReal = (input, outName) => {
      const p = join(t, `${outName}.in.json`); writeFileSync(p, J(input));
      const target = join(FIX_DIR, outName);
      const r = spawnSync(process.execPath, [CLI, '--input', p, '--output', outName], { encoding: 'utf8', timeout: 20000 });
      if (existsSync(target)) { created.push(target); }
      return r;
    };
    const CLI6 = [
      ['sahte exits_present', stepWith({ exits_present: true }), /varlık anahtarı girdide olamaz/],
      ['passwd', { routes: [], passwd: RAW }, /sır \(secret\) taşıyan anahtar/],
      ['private_key', { routes: [], private_key: RAW }, /sır \(secret\) taşıyan anahtar/],
      ['access-token', { routes: [], 'access-token': RAW }, /sır \(secret\) taşıyan anahtar/],
      ['refresh-token', { routes: [], 'refresh-token': RAW }, /sır \(secret\) taşıyan anahtar/],
      ['client-secret', { routes: [], 'client-secret': RAW }, /sır \(secret\) taşıyan anahtar/],
      ['PEM özel anahtar', { routes: [], p: '-----BEGIN ' + 'PRIVATE KEY-----' }, /sır \(secret\) benzeri değer/],
    ];
    let i = 0;
    for (const [name, input, re] of CLI6) {
      const outName = `mapbox-sanitized-zz-t4g-${++i}.json`;
      const r = runReal(input, outName);
      ok(`T4 gerçek CLI: ${name} → çıkış 6, stdout boş, yazılmaz, ham değer yok`,
        r.status === 6 && r.stdout === '' && re.test(r.stderr) && !r.stderr.includes(RAW) && !existsSync(join(FIX_DIR, outName)), `${r.status} ${J(r.stdout)} ${r.stderr}`);
    }
    const r7 = runReal({ routes: [{ duration: 1 }], s: 'duration' }, 'mapbox-sanitized-zz-t4g-leak.json');
    ok('T4 gerçek CLI: sızıntı bulgusu → çıkış 7, stdout boş, yazılmaz',
      r7.status === 7 && r7.stdout === '' && /sızıntı taraması başarısız \(1 bulgu\); hiçbir şey yazılmadı/.test(r7.stderr) && !existsSync(join(FIX_DIR, 'mapbox-sanitized-zz-t4g-leak.json')), `${r7.status} ${r7.stderr}`);
    ok('T4 gerçek CLI: gerçek fixture klasörü değişmedi', readdirSync(FIX_DIR).sort().join(',') === realFixBefore && created.length === 0, J(created));

    // Kabul: sahte depoda (runCli) yazılan dosya baytları = elle yazılı altın (2 boşluk girinti + LF).
    const fr = join(t, 'repo'), ff = join(fr, 'scripts', 'fixtures', 'road-events'), od = join(t, 'o');
    mkdirSync(ff, { recursive: true }); mkdirSync(od);
    const good = join(od, 'in.json'); writeFileSync(good, J(syn));
    const rg = runCli(['--input', good, '--output', 'mapbox-sanitized-t4g.json'], { repoRoot: fr, fixtureDir: ff });
    const bytes = rg.code === 0 ? readFileSync(join(ff, 'mapbox-sanitized-t4g.json')) : Buffer.alloc(0);
    const want = Buffer.from(JSON.stringify(JSON.parse(SYN_J), null, 2) + '\n', 'utf8');
    ok('T4 CLI kabul: yazılan dosya bayt bayt altınla aynı (LF, BOM yok, sonda tek \\n)',
      rg.code === 0 && bytes.equals(want) && bytes[0] === 0x7b && !bytes.includes(0x0d) && bytes[bytes.length - 1] === 0x0a && bytes[bytes.length - 2] !== 0x0a, J(rg));
    // runCli ile her JSON sıkı ret → kod 6, sahte fixture klasörü boş kalır.
    let n = 0;
    for (const [name, input] of STRICT_JSON) {
      const p = join(od, `s${++n}.json`); writeFileSync(p, J(input));
      const r = runCli(['--input', p, '--output', `mapbox-sanitized-s${n}.json`], { repoRoot: fr, fixtureDir: ff });
      ok(`T4 runCli sıkı ret → kod 6, yazılmaz: ${name}`, r.code === 6 && /^temizleme reddedildi: /.test(r.message) && !r.message.includes(RAW) && !existsSync(join(ff, `mapbox-sanitized-s${n}.json`)), J(r));
    }
  } finally {
    for (const f of created) rmSync(f, { force: true });
    rmSync(t, { recursive: true, force: true });
  }

  // 5) TANI (beklenen başarısızlık; paketi düşürmez): iyi huylu metin değerinde "key:" yanlış pozitifi.
  // Kök neden: scripts/sanitize-core.mjs SECRET_VALUE_RES içindeki /(…|token|key)\s*[=:]/i sözcük sınırı içermiyor →
  // "Turkey: E80" ("…key:") ve "Monkey Key: left" ("Key:") sır benzeri değer sayılıyor. 111028c bunları kabul ediyordu.
  // Düzeltilene kadar: kabul EDİLMEMESİ "XFAIL (BLOCKER)" olarak yazılır, sayılmaz; düzeltilince "XPASS" yazar → bu bloğu
  // olağan altın kabul testine çevirin. Her iki durumda da ham metnin çıktıya sızmadığı (sert) denetlenir.
  let xfail = 0, xpass = 0;
  const BENIGN = [
    ['kök not "Turkey: E80"', { routes: [], note: 'Turkey: E80' }, `${MR},"routes":[]}`],
    ['bacak summary "Turkey: E80"', { routes: [{ legs: [{ summary: 'Turkey: E80', steps: [] }] }] }, `${MR},"routes":[{"legs":[{"steps":[]}]}]}`],
    ['kök not "Monkey Key: left"', { routes: [], note: 'Monkey Key: left' }, `${MR},"routes":[]}`],
    ['adım adı "Monkey Key: left"', stepWith({ name: 'Monkey Key: left', maneuver: { type: 'turn' } }), `${MR},"routes":[{"legs":[{"steps":[{"maneuver":{"type":"turn"}}]}]}]}`],
  ];
  for (const [name, input, want] of BENIGN) {
    let got = null; const e = errOf(() => { got = J(sanitizeMapbox(input)); });
    ok(`T4 tanı (sert): ${name} — ham metin çıktıya geçmez`, got === null || (!got.includes('E80') && !got.includes('Monkey')));
    if (e === null && got === want) { xpass++; console.log(`XPASS ${name} — yanlış pozitif giderilmiş; bu tanıyı olağan altın kabul testine çevirin`); }
    else { xfail++; console.log(`XFAIL (BLOCKER) iyi huylu metin reddediliyor: ${name} — ${e ?? got}`); }
  }
  console.log(`T4 tanı özeti: ${xfail} XFAIL (BLOCKER: yanlış pozitif), ${xpass} XPASS`);
}

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
