// Navigasyon üst paneli okunabilirlik (v0.99.103): sol (ok + mesafe + talimat + yol adı) ≈ %60, sağ metrikler ≈ %40.
// 1) Statik denetim (her zaman): CSS kuralları, HTML kimlikleri değişmedi.
// 2) Tarayıcı denetimi (yalnız EVRF_NAV_BROWSER=1): yerel 127.0.0.1 sunucu, dış ağ isteği 404; sahte manevra/metrik metni DOM'a yazılır
//    (navigasyon mantığı çalıştırılmaz). 320/360/390/430 dikey, 844x390 yatay, büyük yazı (zoom 1.3) — Chromium + WebKit.
//    Bilerek satır sınırlı (… ile biten) öğeler taşma sayılmaz: talimat/yol adı (3 satır), uyarı (3 satır), hücre etiketi (2 satır; durak adı v0.99.102'de de 1 satırda …).
//    Ölçülür: sol/sağ oranı, yatay taşma yok, Yunanca uzun yol adı sarar ve görünür, tüm metrik kimlikleri görünür alanda.
//    EVRF_SHOTS=<dizin> verilirse ekran görüntüleri oraya yazılır (depo dışı).
// Kullanım: node scripts/test-nav-toppanel-layout.mjs   |   EVRF_NAV_BROWSER=1 node scripts/test-nav-toppanel-layout.mjs
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const css = readFileSync(join(ROOT, 'css/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

// --- 1) Statik
const navGrid = [...css.matchAll(/(^|\n)\.navbar \{ grid-template-columns: ([^;]+);/g)].map((m) => m[2]);
ok('son .navbar ızgarası sol 3fr / sağ 2fr (%60/%40)', navGrid.at(-1) === 'minmax(0, 3fr) minmax(0, 2fr)', navGrid.at(-1));
ok('dar ekranda (≤ 360 px) pratik oran 11fr/9fr', /@media \(max-width: 360px\) \{[^}]*\.navbar \{ grid-template-columns: minmax\(0, 11fr\) minmax\(0, 9fr\);/.test(css));
ok('talimat ve yol adı ortak kural, 20 px kalın, en çok 3 satır, kelime içi sarma',
  /\.nb-man \.nav-text, \.nb-man \.nav-road \{ font-size: 20px; font-weight: 700;[^}]*-webkit-line-clamp: 3;[^}]*overflow-wrap: anywhere;/.test(css));
ok('ok ve mesafe büyüdü (ok 44 px, mesafe 34 px)', /\.nb-man \.nav-arrow \{ font-size: 44px;/.test(css) && /\.nb-man \.nav-dist \{ font-size: 34px;/.test(css));
ok('sağ alt satırlar kesilmez, sarar (veri kaybı yok)', /\.nb-metrics \.ne-sub, \.nb-metrics \.nb-cell small, #ne-next-t \{[^}]*white-space: normal;[^}]*text-overflow: clip;/.test(css));
ok('panel güvenli alanı gözetir (sol/sağ çentik)', /#banners > \.toppanel \{[^}]*safe-area-inset-left[^}]*safe-area-inset-right/.test(css));
const ids = ['nav-arrow', 'nav-dist', 'nav-text', 'nav-road', 'nh-speed', 'nh-limit', 'nh-avg-v', 'ne-soc', 'ne-range', 'nh-eta', 'ne-arrive', 'nh-rem', 'ne-next', 'ne-next-n', 'ne-next-t', 'nb-alert'];
ok('tüm üst panel kimlikleri yerinde (sol + sağ + uyarı)', ids.every((id) => html.includes(`id="${id}"`)));

// --- 2) Tarayıcı
if (process.env.EVRF_NAV_BROWSER !== '1') {
  console.log('atlandı: tarayıcı denetimi (EVRF_NAV_BROWSER=1 değil)');
} else {
  const pwPath = process.env.PLAYWRIGHT_CORE || join(process.env.TEMP || '/tmp', 'evrf-ocr', 'node_modules', 'playwright-core');
  const pw = existsSync(pwPath) ? createRequire(import.meta.url)(pwPath) : null;
  const MS = join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  const exe = { chromium: process.env.EVRF_CHROMIUM || join(MS, 'chromium-1234', 'chrome-win64', 'chrome.exe'), webkit: process.env.EVRF_WEBKIT || join(MS, 'webkit-2336', 'Playwright.exe') };
  if (!pw) { ok('playwright-core bulundu', false, pwPath); } else {
    const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/index.html';
      const allowed = ['/index.html', '/version.js', '/manifest.webmanifest'].includes(p) || ['/css/', '/js/', '/icons/', '/vendor/', '/i18n/'].some((d) => p.startsWith(d));
      const full = resolve(ROOT, '.' + p);
      if (!allowed || p.includes('..') || !full.startsWith(ROOT + sep) || !existsSync(full) || !statSync(full).isFile()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      createReadStream(full).pipe(res);
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const BASE = `http://127.0.0.1:${srv.address().port}/`;
    const GREEK = 'Λεωφόρος Βασιλίσσης Σοφίας και Κηφισίας Θεσσαλονίκης–Αλεξανδρουπόλεως';
    const views = [[320, 568, 'dikey'], [360, 640, 'dikey'], [390, 844, 'dikey'], [430, 932, 'dikey'], [844, 390, 'yatay'], [390, 844, 'büyük yazı']];
    for (const kind of ['chromium', 'webkit']) {
      if (!existsSync(exe[kind])) { console.log('atlandı:', kind, '(tarayıcı yok)'); continue; }
      const b = await pw[kind].launch({ executablePath: exe[kind] });
      for (const [w, h, mode] of views) {
        const tag = `${kind} ${w}x${h} ${mode}`;
        const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: kind === 'chromium', serviceWorkers: 'block' });
        const p = await ctx.newPage();
        await p.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 404, body: '' })));
        await p.goto(BASE, { waitUntil: 'load' });
        await p.waitForTimeout(800);
        const m = await p.evaluate(({ GREEK, big }) => {
          const $ = (id) => document.getElementById(id);
          $('top-panel').classList.remove('hidden'); $('nav-banner').classList.remove('hidden');
          document.body.classList.add('navmode');
          $('nav-dist').textContent = '1,2 km';
          $('nav-text').textContent = 'Sağa dönün ve Θεσσαλονίκη yönüne devam edin';
          $('nav-road').textContent = GREEK;
          $('nh-speed').textContent = '199'; $('nh-limit').textContent = '120'; $('nh-limit').classList.remove('hidden'); $('nh-avg-v').textContent = '96';
          $('ne-soc').textContent = '%100'; $('ne-soc').classList.add('approx'); $('ne-range').textContent = '999';
          $('nh-eta').textContent = '23:59'; $('ne-arrive').textContent = '%100'; $('nh-rem').textContent = '1234 km';
          $('ne-next-n').textContent = ' · ZES Αλεξανδρούπολη'; $('ne-next').textContent = '1234 km'; $('ne-next-t').textContent = '%100 · 1 sa 59 dk';
          $('nb-alert').textContent = 'Trafik yoğun: 4 km sonra 12 dk gecikme'; $('nb-alert').classList.remove('hidden');
          if (big) $('nav-banner').style.zoom = '1.3';
          const r = (el) => el.getBoundingClientRect();
          const nb = $('nav-banner'), L = nb.querySelector('.nb-left'), R = nb.querySelector('.nb-right');
          const inner = r(nb).width - parseFloat(getComputedStyle(nb).paddingLeft) - parseFloat(getComputedStyle(nb).paddingRight);
          const over = [...nb.querySelectorAll('*')].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && !e.matches('.nb-alert, .nav-text, .nav-road, .nb-cell > small')).map((e) => e.id || e.className || (e.tagName + ":" + e.parentElement.id + ":" + e.scrollWidth + ">" + e.clientWidth));
          const road = $('nav-road'), text = $('nav-text');
          const lh = parseFloat(getComputedStyle(road).lineHeight);
          const vis = ['nh-speed', 'nh-limit', 'nh-avg-v', 'ne-soc', 'ne-range', 'nh-eta', 'ne-arrive', 'nh-rem', 'ne-next', 'ne-next-t', 'nb-alert'].filter((id) => { const e = $(id), q = r(e); return !(q.width > 0 && q.height > 0 && q.left >= r(nb).left - 1 && q.right <= r(nb).right + 1 && e.scrollWidth <= e.clientWidth + 1); });
          return {
            vw: innerWidth, vh: innerHeight, panel: [r(nb).left, r(nb).right, r(nb).height], leftShare: r(L).width / inner, rightShare: r(R).width / inner,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1, over, hidden: vis,
            bannersScroll: [$('banners').scrollHeight, $('banners').clientHeight],
            roadLines: Math.round(r(road).height / lh), roadW: [road.scrollWidth, road.clientWidth], roadInLeft: r(road).right <= r(L).right + 1,
            fs: { text: getComputedStyle(text).fontSize, road: getComputedStyle(road).fontSize, tw: getComputedStyle(text).fontWeight, rw: getComputedStyle(road).fontWeight, dist: getComputedStyle($('nav-dist')).fontSize },
          };
        }, { GREEK, big: mode === 'büyük yazı' });
        ok(`${tag}: sol ≈ %${Math.round(m.leftShare * 100)} / sağ ≈ %${Math.round(m.rightShare * 100)} (sol %53–64)`, m.leftShare >= 0.53 && m.leftShare <= 0.64, JSON.stringify(m));
        ok(`${tag}: sayfa ve panel yatay taşmaz`, !m.pageOverflow && m.panel[0] >= 0 && m.panel[1] <= m.vw + 1 && m.over.length === 0, JSON.stringify(m.over));
        ok(`${tag}: Yunanca uzun yol adı sarar, sol yarıda kalır (${m.roadLines} satır)`, m.roadW[0] <= m.roadW[1] + 1 && m.roadInLeft && m.roadLines >= 2, JSON.stringify(m));
        ok(`${tag}: talimat ve yol adı aynı boy/ağırlık (${m.fs.text})`, m.fs.text === m.fs.road && m.fs.tw === m.fs.rw && parseFloat(m.fs.text) >= 16, JSON.stringify(m.fs));
        ok(`${tag}: hız/limit/Ø/pil/menzil/varış/varışta pil/kalan/sonraki şarj/uyarı görünür, kesilmez`, m.hidden.length === 0, JSON.stringify(m.hidden));
        ok(`${tag}: panel yüksekliği ekranın yarısından az (${Math.round(m.panel[2])} px)`, m.panel[2] < m.vh * (mode === 'yatay' ? 0.8 : 0.5), JSON.stringify(m.panel));
        ok(`${tag}: panel üst kutuya sığar, kaydırma gerekmez (uyarı kesilmez; < 640 px yükseklikte #banners kendi içinde kayar — v0.99.102'de de öyle)`, mode === 'büyük yazı' || h < 640 || m.bannersScroll[0] <= m.bannersScroll[1] + 1, JSON.stringify(m.bannersScroll));
        if (process.env.EVRF_SHOTS) await p.screenshot({ path: join(process.env.EVRF_SHOTS, `toppanel-${kind}-${w}x${h}-${mode.replace(/\s/g, '')}.png`) });
        await ctx.close();
      }
      await b.close();
    }
    srv.close();
  }
}
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
