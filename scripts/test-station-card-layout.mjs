// İstasyon kartı (#station-card) dar telefonda görünür alanın içinde kalır, X her zaman görünür ve dokunulabilir (v0.99.57).
// Kök neden: grid sütunu (auto) olanak çiplerinin min-content genişliğine büyüyor, X sağda ekran dışına düşüyordu.
// 1) Statik denetim (her zaman): CSS kuralları ve JS işaretlemesi.
// 2) Tarayıcı denetimi (Playwright varsa): 320/360/390 genişlikte sınır kutusu, elementFromPoint ile X isabeti, tıklayınca kapanma,
//    kart sonuna kaydırınca X yine görünür. Chromium + WebKit. playwright-core yolu PLAYWRIGHT_CORE ortam değişkeniyle verilir,
//    yoksa %TEMP%\evrf-ocr\node_modules\playwright-core denenir; bulunamazsa tarayıcı bölümü "atlandı" yazar (başarısızlık değil).
// Kullanım: node scripts/test-station-card-layout.mjs   (EVRF_REQUIRE_BROWSER=1 ise tarayıcı yoksa başarısız)
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const js = readFileSync(join(ROOT, 'js/ui/stationCard.js'), 'utf8');

// --- 1) Statik
const rule = (sel) => [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';');
ok('kart grid sütunu minmax(0, 1fr)', /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(rule('.station-card')));
ok('kart yatay taşmaz (overflow-x: hidden)', /overflow-x:\s*hidden/.test(rule('.station-card')));
ok('kart kenarları güvenli alanı gözetir', /safe-area-inset-left/.test(rule('.station-card')) && /safe-area-inset-right/.test(rule('.station-card')));
ok('kart yüksekliği görünür alanla sınırlı (dvh)', /100dvh/.test(rule('.station-card')));
ok('kart çocukları daralabilir', /min-width:\s*0/.test(rule('.station-card > *')));
ok('olanak çipleri sarar', /flex-wrap:\s*wrap/.test(rule('.station-card .chips')));
ok('başlık yapışık', /position:\s*sticky/.test(rule('.station-card .sc-head')));
ok('X 44x44', /width:\s*44px/.test(rule('.station-card .sheet-x')) && /height:\s*44px/.test(rule('.station-card .sheet-x')));
ok('başlık sc-head sınıfı ile kurulur', /el\('div', 'row between sc-head'\)/.test(js));
ok('X erişilebilir ad taşır', /setAttribute\('aria-label', tr\('Kapat'\)\)/.test(js));

// --- 2) Tarayıcı
const pwPath = process.env.PLAYWRIGHT_CORE || join(process.env.TEMP || '/tmp', 'evrf-ocr', 'node_modules', 'playwright-core');
let pw = null;
try { if (existsSync(pwPath)) pw = createRequire(import.meta.url)(pwPath); } catch { pw = null; }
const MS = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const exe = {
  chromium: process.env.EVRF_CHROMIUM || join(MS, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  webkit: process.env.EVRF_WEBKIT || join(MS, 'webkit-2336', 'Playwright.exe'),
};

if (!pw) {
  console.log('atlandı: tarayıcı denetimi (playwright-core bulunamadı:', pwPath + ')');
  if (process.env.EVRF_REQUIRE_BROWSER === '1') fail++;
} else {
  // Yalnızca genel dosyaları sunan yerel sunucu (127.0.0.1)
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
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
  // Sahte hesap verisi: tüm olanaklar oylu (en geniş çip satırı), puan var
  const info = { rating: { avg: 4.3, n: 12, mine: 4 }, facilities: { mall: { yes: 3, no: 0, mine: true }, wc: { yes: 5, no: 1, mine: null }, restaurant: { yes: 2, no: 0, mine: null }, cafe: { yes: 7, no: 0, mine: null }, market: { yes: 1, no: 0, mine: null }, mosque: { yes: 4, no: 0, mine: null } }, photos: [] };
  const station = { id: 'x', name: 'EKO Charge&Go 180kW Şarj İstasyonu', opName: 'EKO Charge&Go', kw: 180, lat: 40.9, lon: 29.1, price: 9.99, tariffSrc: 'published' };
  for (const kind of ['chromium', 'webkit']) {
    if (!existsSync(exe[kind])) { console.log('atlandı:', kind, '(tarayıcı yok)'); continue; }
    const b = await pw[kind].launch({ executablePath: exe[kind] });
    for (const [w, h] of [[320, 568], [360, 640], [390, 844]]) {
      const tag = `${kind} ${w}x${h}`;
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: kind === 'chromium', serviceWorkers: 'block' });
      await ctx.addInitScript(() => { localStorage.setItem('evcp.session', JSON.stringify({ token: 'test', user: { id: 'test' } })); });
      const p = await ctx.newPage();
      await p.route('**/*', (r) => {
        const u = r.request().url();
        if (u.startsWith(BASE)) return r.continue();
        if (u.includes('/v1/station/info')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(info) });
        return r.fulfill({ status: 404, body: '' }); // dış ağ yok
      });
      await p.goto(BASE, { waitUntil: 'load' });
      await p.waitForTimeout(1200);
      await p.evaluate(async (s) => { const { mapApi } = await import('/js/ui/mapView.js'); mapApi.onStation(s); }, station);
      await p.waitForFunction(() => document.querySelectorAll('#station-card .chips .btn').length > 0, null, { timeout: 5000 }).catch(() => {});
      const measure = () => p.evaluate(() => {
        const c = document.getElementById('station-card'), x = c.querySelector('.sheet-x');
        const r = c.getBoundingClientRect(), xr = x.getBoundingClientRect();
        const hit = document.elementFromPoint(xr.left + xr.width / 2, xr.top + xr.height / 2);
        return { vw: innerWidth, vh: innerHeight, card: [r.left, r.right, r.top, r.bottom], sw: c.scrollWidth, cw: c.clientWidth, x: [xr.left, xr.right, xr.top, xr.bottom, xr.width, xr.height], hit: !!hit && (hit === x || x.contains(hit)), chips: c.querySelectorAll('.chips .btn').length, stars: c.querySelectorAll('.star').length };
      });
      const m = await measure();
      ok(`${tag}: kart ve olanaklar yüklendi`, m.chips === 6 && m.stars === 5, JSON.stringify(m));
      ok(`${tag}: kart görünür alanın içinde`, m.card[0] >= 0 && m.card[1] <= m.vw && m.card[2] >= 0 && m.card[3] <= m.vh, JSON.stringify(m.card));
      ok(`${tag}: yatay taşma yok`, m.sw <= m.cw + 1, `${m.sw} > ${m.cw}`);
      ok(`${tag}: X kartın ve ekranın içinde`, m.x[0] >= m.card[0] && m.x[1] <= m.card[1] && m.x[1] <= m.vw && m.x[2] >= m.card[2], JSON.stringify(m.x));
      ok(`${tag}: X dokunma alanı >= 44x44`, m.x[4] >= 44 && m.x[5] >= 44, JSON.stringify(m.x));
      ok(`${tag}: X noktasında üstte başka öğe yok`, m.hit);
      // D3-T4: doluluk üç durumu (Müsait / Dolu / Bilinmiyor) kartta taşmadan çizilir. Sentetik slots, sayfa içi modül; ağ yok.
      const occ = await p.evaluate(async () => {
        const { slotEl } = await import('/js/routing/slots.js');
        const now = Date.now();
        const counts = (c) => ({ AVAILABLE: 0, CHARGING: 0, RESERVED: 0, BLOCKED: 0, OUTOFORDER: 0, INOPERATIVE: 0, UNKNOWN: 0, ...c });
        const av = (c, kind, ago) => { const k = counts(c); const total = Object.values(k).reduce((a, b) => a + b, 0); return { source: 'tomtom', simulated: false, granularity: 'counts', total, available: k.AVAILABLE, counts: k, evses: null, at: now - ago * 60e3, timestampKind: kind }; };
        const sl = (a, community = null) => ({ slots: { total: a.total, available: a.available, out: 0, at: a.at, checked: now, src: 'tomtom', price: null, community, availability: a } });
        const box = document.createElement('div');
        box.className = 'live-slots occ-test';
        const fx = [sl(av({ AVAILABLE: 3, CHARGING: 1 }, 'provider', 2)), sl(av({ CHARGING: 4 }, 'provider', 0)), sl(av({ AVAILABLE: 2, CHARGING: 2 }, 'fetched', 0), { busy: 12, report: { status: 'full', at: now - 5 * 60e3 } }), sl(av({ AVAILABLE: 1 }, 'provider', 16))];
        for (const s of fx) { const d = document.createElement('div'); d.append(slotEl(s, '')); box.append(d); }
        const card = document.getElementById('station-card');
        card.querySelector('.sc-head').after(box);
        await new Promise((r) => setTimeout(r, 150)); // çeviri gözlemcisi
        const states = [...box.querySelectorAll('.occ-state')].map((e) => e.textContent);
        const res = { lang: document.documentElement.lang, states, text: box.textContent, sw: card.scrollWidth, cw: card.clientWidth, bw: box.scrollWidth, bcw: box.clientWidth };
        box.remove();
        return res;
      });
      const L = occ.lang === 'tr' ? ['🟢 Müsait', '🔴 Dolu', '⚪ Bilinmiyor', '⚪ Bilinmiyor'] : occ.lang === 'en' ? ['🟢 Available', '🔴 Full', '⚪ Unknown', '⚪ Unknown'] : null;
      ok(`${tag}: doluluk üç durum (${occ.lang}) Müsait/Dolu/Bilinmiyor/Bilinmiyor(16 dk)`, L && JSON.stringify(occ.states) === JSON.stringify(L), JSON.stringify(occ.states));
      ok(`${tag}: doluluk eski metinleri yok (boş/dolu (0/N)/arızalı)`, !/boş\b|dolu \(|arızalı/.test(occ.text), occ.text);
      ok(`${tag}: doluluk satırı kartı yatay taşırmaz`, occ.sw <= occ.cw + 1 && occ.bw <= occ.bcw + 1, JSON.stringify(occ));
      await p.evaluate(() => { const c = document.getElementById('station-card'); c.scrollTop = c.scrollHeight; });
      await p.waitForTimeout(100);
      const m2 = await measure();
      ok(`${tag}: kaydırınca X yine görünür ve isabetli`, m2.hit && m2.x[2] >= m2.card[2] - 1 && m2.x[3] <= m2.card[3], JSON.stringify(m2.x));
      await p.mouse.click(m2.x[0] + m2.x[4] / 2, m2.x[2] + m2.x[5] / 2); // kaydırmadan doğrudan koordinata dokun
      const closed = await p.evaluate(() => document.getElementById('station-card').classList.contains('hidden'));
      ok(`${tag}: X dokununca kart kapanır`, closed);
      await ctx.close();
    }
    await b.close();
  }
  srv.close();
}
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
