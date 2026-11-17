// İstasyon ayrıntı kartında rota mesafesi (v0.99.104): kart, İstasyonlar listesindeki "… km ileride" değerinin AYNISINI gösterir.
// Yeni mesafe hesabı yok: plan.stops / plan.stations içindeki rota km'si (planlayıcının verdiği) − progressKm(), listeyle aynı biçimleyici.
// 1) Saf yardımcı (js/ui/routeDist.js): değer, geride kalma eşiği, araç ilerledikçe güncelleme.
// 2) Statik bağlama: liste ve kart aynı biçimleyiciyi kullanır; kart engine/plan aboneliğiyle günceller; ağ/geometri çağrısı yok.
// 3) Tarayıcı (Playwright varsa): kart açılır, değer liste biçimiyle aynı; engine ilerleyince güncellenir, geçince gizlenir.
// Kullanım: node scripts/test-station-route-dist.mjs   (EVRF_REQUIRE_BROWSER=1 ise tarayıcı yoksa başarısız)
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import http from 'node:http';
import { join, resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const { aheadKmText, routeStationKm, BEHIND_KM } = await import(pathToFileURL(join(ROOT, 'js/ui/routeDist.js')).href);

// --- 1) Saf yardımcı
// Listedeki eski ifade (v0.99.103 stationsView.js:87): `${Math.max(0, r.station.km - here).toFixed(0)} km ileride`
const legacy = (km, here) => Math.max(0, km - here).toFixed(0);
for (const [km, here] of [[124.6, 100], [24.6, 0], [50, 49.9], [50, 50.2], [312.49, 12], [0.4, 0]]) {
  ok(`aheadKmText(${km}, ${here}) listedeki eski ifadeyle aynı`, aheadKmText(km, here) === legacy(km, here), `${aheadKmText(km, here)} != ${legacy(km, here)}`);
}
ok('örnek: 24,6 km ileride → "25" (liste biçimi, tam km)', aheadKmText(24.6, 0) === '25');
ok('geride kalma eşiği listeyle aynı (0.3 km)', BEHIND_KM === 0.3);

const stA = { id: 'a', km: 124.6 }, stB = { id: 'b', km: 80 }, stC = { id: 'c', km: 210 };
const plan = { profile: {}, stations: [stA, stB, stC], stops: [{ station: stC, km: 210 }] };
ok('rotadaki aday istasyon: plan.stations km', routeStationKm(plan, 'a', 100) === 124.6);
ok('plandaki durak: stop.km', routeStationKm(plan, 'c', 100) === 210);
ok('geride kalan istasyon gösterilmez (liste gibi)', routeStationKm(plan, 'b', 100) === null);
ok('eşik içinde (0.3 km geride) hâlâ gösterilir', routeStationKm(plan, 'b', 80.2) === 80);
ok('rotada olmayan istasyon: null', routeStationKm(plan, 'zz', 0) === null);
ok('rota yok (profile yok): null', routeStationKm({ stations: [stA], stops: [] }, 'a', 0) === null);
ok('plan yok: null', routeStationKm(null, 'a', 0) === null);
ok('km sayı değilse: null', routeStationKm({ profile: {}, stations: [{ id: 'x', km: NaN }], stops: [] }, 'x', 0) === null);

// Araç ilerledikçe sonraki güncellemeler: aynı istasyon, artan progressKm → değer listeyle aynı adımlarla azalır, geçince kaybolur.
const seq = [100, 105.4, 110, 124, 124.5, 124.8, 124.9].map((here) => {
  const km = routeStationKm(plan, 'a', here);
  return km == null ? null : aheadKmText(km, here);
});
ok('ilerleme dizisi: 25 → 19 → 15 → 1 → 0 → 0 → (geçti)', JSON.stringify(seq) === JSON.stringify(['25', '19', '15', '1', '0', '0', null]), JSON.stringify(seq));
ok('her adımda listeyle aynı', [100, 105.4, 110, 124].every((h) => aheadKmText(stA.km, h) === legacy(stA.km, h)));

// --- 2) Statik bağlama
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const card = strip(readFileSync(join(ROOT, 'js/ui/stationCard.js'), 'utf8'));
const list = strip(readFileSync(join(ROOT, 'js/ui/stationsView.js'), 'utf8'));
const helper = strip(readFileSync(join(ROOT, 'js/ui/routeDist.js'), 'utf8'));
ok('liste aynı biçimleyiciyi kullanır (2 satır)', (list.match(/aheadKmText\(r\.station\.km, here\)} km ileride/g) || []).length === 2);
ok('listede eski satır içi ifade kalmadı', !/Math\.max\(0, r\.station\.km - here\)\.toFixed\(0\)/.test(list));
ok('liste geride kalma eşiği 0.3 (yardımcıyla aynı)', /st\.km > here - 0\.3/.test(list));
ok('kart yardımcıyı içe aktarır', /import \{[^}]*aheadKmText[^}]*routeStationKm[^}]*\} from '\.\/routeDist\.js'/.test(card));
ok('kart progressKm() ile aynı konumu kullanır', /routeStationKm\(getState\('plan'\), current\.id, here\)/.test(card) && /const here = progressKm\(\)/.test(card));
ok('kart etiketi: Rotada {0} km ileride', /t\('Rotada \{0\} km ileride', aheadKmText\(/.test(card));
ok('kart mesafe satırı sc-dist sınıfıyla kurulur', /el\('div', 'sc-dist/.test(card));
ok('kart engine aboneliğiyle güncellenir', /subscribe\('engine', paintDist\)/.test(card));
ok('kart plan aboneliğiyle güncellenir', /subscribe\('plan', paintDist\)/.test(card));
ok('kapalı kartta güncelleme yok', /if \(!current \|\| !distEl\) return/.test(card));
ok('yardımcıda ağ/geometri çağrısı yok', !/fetch|project\(|haversine|distKm|import /.test(helper));
ok('kartta yeni ağ uç noktası yok', (card.match(/proxyFetch\(/g) || []).length === 1 && !/routeDist[^;]*fetch/.test(card));
ok('kapat (X), Git, Şarj et, Değiştir/Kaldır korunur',
  /setAttribute\('aria-label', tr\('Kapat'\)\)/.test(card) && /🧭 Git/.test(card) && /⚡ Şarj et/.test(card) && /🔁 Değiştir/.test(card) && /🗑️ Kaldır/.test(card));
const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');
ok('CSS: .station-card .sc-dist kuralı var', /\.station-card \.sc-dist\s*\{/.test(css));

// --- 3) Tarayıcı (Playwright varsa; yoksa "atlandı", EVRF_REQUIRE_BROWSER=1 ise başarısız). Dış ağ yok, sahte plan durumu.
const pwPath = process.env.PLAYWRIGHT_CORE || join(process.env.TEMP || '/tmp', 'evrf-ocr', 'node_modules', 'playwright-core');
const chrome = process.env.EVRF_CHROMIUM || join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
let pw = null;
try { if (existsSync(pwPath) && existsSync(chrome)) pw = createRequire(import.meta.url)(pwPath); } catch { pw = null; }
if (!pw) {
  console.log('atlandı: tarayıcı denetimi (playwright-core / chromium bulunamadı)');
  if (process.env.EVRF_REQUIRE_BROWSER === '1') fail++;
} else {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const allowed = ['/index.html', '/version.js', '/manifest.webmanifest'].includes(p) || ['/css/', '/js/', '/icons/', '/vendor/'].some((d) => p.startsWith(d));
    const full = resolve(ROOT, '.' + p);
    if (!allowed || p.includes('..') || !full.startsWith(ROOT + sep) || !existsSync(full) || !statSync(full).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(full).pipe(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const b = await pw.chromium.launch({ executablePath: chrome });
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: 'block', locale: 'tr-TR' });
    await ctx.addInitScript(() => localStorage.setItem('evcp.lang', JSON.stringify('tr')));
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 404, body: '' }))); // dış ağ yok
    await p.goto(BASE, { waitUntil: 'load' });
    await p.waitForTimeout(1200);
    const got = await p.evaluate(async () => {
      const { patch } = await import('/js/state.js');
      const { mapApi } = await import('/js/ui/mapView.js');
      const on = { id: 'sd1', name: 'Rota DC', opName: 'Op', kw: 120, lat: 40, lon: 29, price: 9.5, km: 124.6 };
      const off = { id: 'sd2', name: 'Rota dışı', opName: 'Op', kw: 60, lat: 41, lon: 30, price: 9 };
      patch('plan', { profile: { totalKm: 400 }, stations: [on], stops: [], fromKm: 100 });
      const d = () => { const n = document.querySelector('#station-card .sc-dist'); return !n ? '(yok)' : n.classList.contains('hidden') ? '(gizli)' : n.textContent; };
      const r = [];
      mapApi.onStation(on); r.push(d()); // park: plan başı (fromKm 100)
      patch('nav', { active: true });
      patch('engine', { routeKm: 110, offRouteKm: 0 }); r.push(d());
      patch('engine', { routeKm: 124.5, offRouteKm: 0 }); r.push(d());
      patch('engine', { routeKm: 125, offRouteKm: 0 }); r.push(d()); // geçti
      mapApi.onStation(off); r.push(d());
      const x = document.querySelector('#station-card .sheet-x');
      return { r, x: !!x && x.getAttribute('aria-label') };
    });
    const num = (s) => (s.match(/\d+/) || [null])[0];
    ok('tarayıcı: açılışta liste değeriyle aynı (25)', num(got.r[0]) === aheadKmText(124.6, 100), JSON.stringify(got.r));
    ok('tarayıcı: araç ilerleyince güncellenir (15)', num(got.r[1]) === aheadKmText(124.6, 110), JSON.stringify(got.r));
    ok('tarayıcı: 0,1 km kala 0', num(got.r[2]) === '0', JSON.stringify(got.r));
    ok('tarayıcı: istasyon geçilince satır gizli', got.r[3] === '(gizli)', JSON.stringify(got.r));
    ok('tarayıcı: rotada olmayan istasyonda satır gizli', got.r[4] === '(gizli)', JSON.stringify(got.r));
    ok('tarayıcı: etiket "Rotada … km ileride"', /^Rotada 25 km ileride$/.test(got.r[0]), got.r[0]);
    ok('tarayıcı: kapat (X) yerinde', !!got.x, String(got.x));
    ok('tarayıcı: sayfa hatası yok', !errs.length, errs.join(' | '));
  } finally { await b.close(); srv.close(); }
}

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
