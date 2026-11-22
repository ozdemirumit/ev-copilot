// Yol olayı kaynakları (v0.99.128): (A) trace_attributes mesafeye göre parçalama (Valhalla 200 km sınırı), (B) gişe/direk düğümleri trace'ten (Overpass'siz),
// gerçek kayıtlı Bolu rotasıyla; (C) iki kaynak arası gişe tekilleştirme; (D) sunucu Overpass vekili: User-Agent + gişe sorgusu izin listesi (gerçek proxy süreci, sahte üst sunucu);
// (E) bağlantı denetimi. Çevrimdışı: yalnız 127.0.0.1; 8787 ve 445 KULLANILMAZ. Kullanım: node scripts/test-road-sources.mjs
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const X = await import('../js/nav/roadExtras.js');
const O = await import('../js/osm/roadExtras.js');
const { buildTrack } = await import('../js/nav/track.js');
const { decodePolyline6 } = await import('../js/osm/route.js');
const { fromValhallaOsrm } = await import('../js/nav/valhallaRoadEvents.js');

// uzun düz rota (İstanbul → Ankara ölçeğinde ~460 km, 5457 nokta: gerçek rota boyutu)
const long = Array.from({ length: 5457 }, (_, i) => [28.9784 + (5.0 * i) / 5456, 41.0082 - (1.4 * i) / 5456]);
const kmOf = (cs) => buildTrack(cs).totalKm;

// ===================== A) parçalama =====================
{
  const total = kmOf(long);
  const rs = X.traceRanges(long);
  const spans = rs.map((r) => kmOf(long.slice(r.start, r.end + 1)));
  ok('A 460 km rota birden çok parçaya bölünür', total > 400 && rs.length >= 4, `${total} ${rs.length}`);
  ok('A her parça < 200 km (Valhalla sınırı; eskiden 2500 nokta ≈ 210 km idi)', spans.every((k) => k < 200) && Math.max(...spans) <= X.TRACE_MAX_KM + 1, spans.map((k) => k.toFixed(0)).join());
  ok('A her parça ≤ 2500 nokta + örtüşme', rs.every((r) => r.end - r.start + 1 <= X.TRACE_MAX_POINTS + X.TRACE_OVERLAP));
  ok('A parçalar rotayı kesintisiz kapsar, ardışık parçalar ≥ 3 nokta örtüşür', rs[0].start === 0 && rs.at(-1).end === long.length - 1 && rs.every((r, i) => i === 0 || (r.start <= rs[i - 1].end - X.TRACE_OVERLAP + 1 && r.start > rs[i - 1].start)));
  // eski yöntem gerçekten sınırı aşıyordu (hatanın kanıtı)
  ok('A KANIT: eski 2500 nokta parçası bu rotada > 200 km', kmOf(long.slice(0, 2500 + 3)) > 200, String(kmOf(long.slice(0, 2503))));
  const short = Array.from({ length: 300 }, (_, i) => [30 + i * 0.0003, 40]);
  ok('A kısa rota tek parça', X.traceRanges(short).length === 1 && X.traceRanges(short)[0].end === 299);
  ok('A bozuk/kısa girdi → []', X.traceRanges(null).length === 0 && X.traceRanges([[1, 2]]).length === 0 && X.traceRanges('x').length === 0);
  const sparse = [[30, 40], [33, 40], [36, 40]]; // iki köşe arası 250 km: ilerlemeyi engellemez
  ok('A tek kenar maxKm\'den uzunsa bile sonsuz döngü yok', X.traceRanges(sparse).length >= 1 && X.traceRanges(sparse).at(-1).end === 2);

  // fetchRoadExtras gerçekten bu parçalarla çağırır
  const bodies = [];
  const r = await O.fetchRoadExtras(long, { trace: async (b) => { bodies.push(b); return { edges: [] }; }, tolls: async () => [], pauseMs: 0 });
  const bodyKm = bodies.map((b) => kmOf(b.shape.map((p) => [p.lon, p.lat])));
  ok('A fetchRoadExtras: tüm trace istekleri < 200 km ve rota kapsanır', bodies.length === rs.length && bodyKm.every((k) => k < 200), bodyKm.map((k) => k.toFixed(0)).join());
  ok('A trace isteği node.type ister (gişe/direk düğümleri)', bodies.every((b) => b.filters.attributes.includes('node.type') && b.filters.attributes.includes('edge.bridge')));
  ok('A boş yanıtta olay yok → null (uydurma yok)', r === null);
}

// ===================== B) gişe düğümleri: gerçek kayıt =====================
{
  const route = JSON.parse(read('scripts/fixtures/road-events/osm-valhalla-bolu-recorded.json'));
  const trace = JSON.parse(read('scripts/fixtures/road-events/osm-valhalla-trace-bolu-nodes-recorded.json'));
  const coords = decodePolyline6((route.response || route).routes[0].geometry);
  const model = X.fromTraceAttributes([{ json: trace.response, offset: 0 }], coords);
  const by = (k) => model.events.filter((e) => e.kind === k);
  const rm = fromValhallaOsrm(route.response || route, coords).events.filter((e) => e.kind === 'toll').map((e) => e.atM);
  ok('B gerçek Bolu kaydı: iki gişe düğümü okunur (düğüm türü toll_booth)', by('toll').length === 2 && trace.response.edges.filter((e) => e.end_node?.type === 'toll_booth').length === 2, JSON.stringify(by('toll')));
  // rota yanıtı ücretli yola GİRİŞ kavşağını, trace kapının kendi düğümünü (kenar sonu) verir: ≈ 160 m fark beklenir
  ok('B trace gişeleri rota yanıtının gişeleriyle ≤ 250 m içinde aynı yerde (iki bağımsız kaynak tutarlı)', rm.length === 2 && by('toll').every((e) => rm.some((m) => Math.abs(m - e.atM) <= 250)), `${rm} ${by('toll').map((e) => e.atM)}`);
  ok('B köprü/tünel/alt geçit okuması aynı kalır (8 köprü, 1 tünel, 1 alt geçit)', by('bridge').length === 8 && by('tunnel').length === 1 && by('underpass').length === 1);
  ok('B gişe NOKTA olayıdır (atM), kaynağı osm', by('toll').every((e) => typeof e.atM === 'number' && e.source === 'osm' && e.fromM === undefined));
  ok('B model toll desteği ilan eder', model.supports.includes('toll'));

  // sentetik: diğer düğüm türleri gişe değildir; 500 m içindeki gişe+direk tek olay; bozuk end_node atılır
  const c2 = Array.from({ length: 60 }, (_, i) => [30 + i * 0.0003, 40]); // ~25 m aralık
  const e = (b, en, type, extra = {}) => ({ begin_shape_index: b, end_shape_index: en, ...(type ? { end_node: { type } } : {}), ...extra });
  const m2 = X.fromTraceAttributes([{ json: { edges: [e(0, 10, 'street_intersection'), e(10, 20, 'toll_booth'), e(20, 25, 'toll_gantry'), e(25, 40, 'motor_way_junction'), e(40, 50, null), e(50, 58, 'toll_gantry', { end_node: 5 })] }, offset: 0 }], c2);
  const t = m2.events.filter((x) => x.kind === 'toll');
  ok('B yalnız toll_booth/toll_gantry gişedir; 500 m içindeki booth+gantry tek olay', t.length === 1, JSON.stringify(t));
  ok('B bozuk end_node (sayı) atılır, çökmez', X.fromTraceAttributes([{ json: { edges: [e(0, 5, null, { end_node: 5 }), e(5, 9, null, { end_node: null })] }, offset: 0 }], c2).events.length === 0);
}

// ===================== C) iki kaynak arası tekilleştirme =====================
{
  const coords = Array.from({ length: 400 }, (_, i) => [30 + i * 0.0003, 40]);
  const e = (b, en, type) => ({ begin_shape_index: b, end_shape_index: en, end_node: { type } });
  const tr = X.fromTraceAttributes([{ json: { edges: [e(0, 60, 'toll_booth')] }, offset: 0 }], coords); // ≈ 1,5 km
  const at = tr.events[0].atM;
  const merged = X.buildExtras({ trace: tr, tolls: [at + 200, at + 2000, at + 2300] });
  const tolls = merged.events.filter((x) => x.kind === 'toll').map((x) => x.atM);
  ok('C Overpass noktası Valhalla gişesine ≤ 500 m ise atılır (aynı kapı iki kez söylenmez)', !tolls.includes(at + 200) && tolls.includes(at));
  ok('C uzaktaki Overpass noktaları korunur (kendi içi tekilleştirmesi Overpass katmanında)', tolls.includes(at + 2000) && tolls.includes(at + 2300) && tolls.length === 3, JSON.stringify(tolls));
  ok('C yalnız Overpass (trace yok) eskisi gibi çalışır', X.buildExtras({ trace: null, tolls: [500, 5000] }).events.length === 2);
  ok('C hiçbir kaynak yoksa null', X.buildExtras({ trace: null, tolls: [] }) === null);
}

// ===================== D) sunucu Overpass vekili (gerçek süreç + sahte üst sunucu) =====================
{
  const seen = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { seen.push({ ua: req.headers['user-agent'], accept: req.headers.accept, body: b, ct: req.headers['content-type'] }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"elements":[]}'); });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'road-src-'));
  const blank = Object.fromEntries(['MAPBOX_TOKEN', 'OCM_KEY', 'HERE_API_KEY', 'GOOGLE_PLACES_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SMTP_USER', 'SMTP_PASS', 'PUBLIC_URL', 'ADMIN_EMAILS', 'GOOGLE_MAPS_BROWSER_KEY', 'MAPBOX_MAP_TOKEN', 'GOOGLE_MAP_ID', 'TRUST_PROXY', 'TRUST_CF_HEADER', 'PREMIUM_REQUIRED', 'ADMIN_TOTP_SECRET', 'ADMIN_TOKEN_TTL_SEC', 'RATE_PER_MIN', 'PROVIDER_REQUESTS_PAUSED'].map((k) => [k, '']));
  const CODE = 'test-dummy-access-code-0123456789';
  const child = spawn(process.execPath, ['server/proxy.mjs'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...blank, PORT: '18843', HOST: '127.0.0.1', DATA_DIR: dir, ACCESS_CODES: CODE, PROVIDER_REQUESTS_PAUSED: '0', OVERPASS_URLS: `http://127.0.0.1:${fake.address().port}/api/interpreter`, OVERPASS_GAP_MS: '10' } });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && !out.includes('ara sunucusu'); i++) await sleep(100);
    if (!out.includes('ara sunucusu')) throw new Error('sunucu başlamadı: ' + out.slice(0, 300));
    const post = (query) => fetch('http://127.0.0.1:18843/overpass', { method: 'POST', headers: { 'X-Access-Code': CODE, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
    const around = '(around:40,40.12345,31.12345,40.12400,31.12500)';
    const tollQ = `[out:json][timeout:60];(nwr["barrier"="toll_booth"]${around};nwr["highway"="toll_gantry"]${around};);out tags center;`;
    const r1 = await post(tollQ);
    ok('D gişe/direk sorgusu izin listesinde (200; eskiden 400 "desteklenmeyen sorgu")', r1.status === 200, String(r1.status));
    ok('D üst sunucuya anlamlı User-Agent gider (Node varsayılanı değil)', seen.length === 1 && /^EVRouteFinder-proxy\/\d+ \(\+https:\/\/github\.com\//.test(seen[0].ua || '') && !/^node/i.test(seen[0].ua || ''), JSON.stringify(seen[0]));
    ok('D Accept başlığı gider', seen[0]?.accept === 'application/json');
    ok('D sorgu gövdesi form olarak aynen iletilir', /data=/.test(seen[0]?.body || '') && decodeURIComponent((seen[0]?.body || '').replace(/^data=/, '').replace(/\+/g, ' ')) === tollQ);
    const camQ = '[out:json][timeout:25];nwr["highway"="speed_camera"](around:100,40.1,31.1,40.2,31.2);out tags center;';
    const r2 = await post(camQ);
    ok('D mevcut kamera sorgusu hâlâ geçer, UA onda da var', r2.status === 200 && seen.length === 2 && !!seen[1]?.ua && !/^node/i.test(seen[1].ua));
    const evil = await post(`[out:json][timeout:60];(nwr["barrier"="toll_booth"]${around};node["amenity"="bank"]${around};);out tags center;`);
    ok('D izin dışı sorgu (gişe + başka etiket karışımı) reddedilir', evil.status === 400);
    const evil2 = await post(tollQ.replace('out tags center;', 'out body;'));
    ok('D çıktı biçimi değiştirilmiş gişe sorgusu reddedilir', evil2.status === 400);
    const big = await post(tollQ.replace('(around:40,', '(around:25000,'));
    ok('D 20 km üstü yarıçap reddedilir (gişe sorgusunda da)', big.status === 400);
    const noAuth = await fetch('http://127.0.0.1:18843/overpass', { method: 'POST', body: 'data=' + encodeURIComponent(tollQ) });
    ok('D kimliksiz istek 401', noAuth.status === 401);
    ok('D hiçbir istek izin dışı sorguyu üst sunucuya taşımadı', seen.length === 2);
  } catch (e) { ok('D sunucu denemesi çalıştı: ' + e.message, false); }
  child.kill(); fake.close(); await sleep(200);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows kilidi */ }
}

// ===================== E) kaynak/bağlantı denetimi =====================
{
  const osm = read('js/osm/roadExtras.js'), px = read('server/proxy.mjs');
  ok('E osm/roadExtras.js mesafeye göre parçalar (traceRanges), eski yalnız-nokta döngüsü yok', /traceRanges\(coords\)/.test(osm) && !/s \+= CHUNK_POINTS/.test(osm));
  ok('E sunucu: User-Agent ve gişe izin listesi tanımlı', /OVERPASS_HEADERS = \{ 'User-Agent': 'EVRouteFinder-proxy\/1/.test(px) && /OP_QUERY_TOLL/.test(px) && /headers: OVERPASS_HEADERS/.test(px));
  ok('E gişe düğüm türleri yalnız toll_booth/toll_gantry', JSON.stringify(X.TOLL_NODE_TYPES) === '["toll_booth","toll_gantry"]');
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
