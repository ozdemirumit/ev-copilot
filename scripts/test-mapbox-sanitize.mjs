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
  ok('yalnızca node:fs/node:path/node:url içe aktarılır', imports.length > 0 && imports.every((m) => ['node:fs', 'node:path', 'node:url'].includes(m)), J(imports));
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

ok('ağ çağrısı yapılmadı', netCalls === 0);
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
