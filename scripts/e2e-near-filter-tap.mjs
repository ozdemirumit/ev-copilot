// İstasyonlar > Filtre > Ara — gerçek tarayıcıda dokunuş/tıklama/klavye regresyon testi (v0.99.106).
// WebKit (iPhone 13 görünümü, dokunmatik) ve Chromium (Pixel 7) ile uygulama yerelden açılır, İstasyonlar sayfası (harita üstü
// panel) açıkken "Yakınımdaki istasyonlar" kartı kapalı ve sayfa Ara'ya kaydırılmışken düğmenin ORTASINA dokunulur.
// Denetlenen: elementFromPoint düğmenin kendisi (örtü yok), click işleyiciye ulaşır, dokunuş başına tam bir arama başlar,
// düğmenin hemen altındaki #near-filter-status görünür ve her dokunuşta değişir (aynı sonuçta bile), hata açıkça yazılır.
// Ağ tamamen çevrimdışı (dış istekler kesilir) → kaynak hatası yolu; ücretli/gerçek API çağrısı yok.
//
// Gereken: playwright-core + kurulu WebKit/Chromium. Yeni bağımlılık eklenmez; yol ortamdan verilir:
//   PW_CORE=<playwright-core/index.mjs>  PW_WEBKIT=<Playwright.exe>  PW_CHROMIUM=<chrome.exe>
// Kullanım: node scripts/e2e-near-filter-tap.mjs   (test-*.mjs döngüsünde değildir: tarayıcı ister)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const LA = process.env.LOCALAPPDATA || '';
const PW_CORE = process.env.PW_CORE || join(process.env.TEMP || '', 'evrf-ocr/node_modules/playwright-core/index.mjs');
const EXE = {
  webkit: process.env.PW_WEBKIT || join(LA, 'ms-playwright/webkit-2336/Playwright.exe'),
  chromium: process.env.PW_CHROMIUM || join(LA, 'ms-playwright/chromium-1234/chrome-win64/chrome.exe'),
};
if (!existsSync(PW_CORE)) { console.error('playwright-core bulunamadı: PW_CORE ortam değişkenini ver (' + PW_CORE + ')'); process.exit(2); }
const { webkit, chromium, devices } = await import(pathToFileURL(PW_CORE).href);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE_ARG = process.argv[2]; // isteğe bağlı: canlı Beta adresi (ör. https://ozdemirumit.github.io/EV-Route-Finder/)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/json', '.png': 'image/png' };
let srv = null;
let base = BASE_ARG;
if (!base) {
  srv = createServer(async (q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    try { const b = await readFile(join(ROOT, p)); r.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); r.end(b); } catch { r.writeHead(404); r.end(); }
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${srv.address().port}/`;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

const probe = () => {
  const el = document.getElementById('near-refresh');
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const fs = document.getElementById('near-filter-status');
  const fr = fs ? fs.getBoundingClientRect() : { width: 0, height: 0, top: 0, bottom: 0 }; // eski sürümde satır yok
  const body = el.closest('.sheet-body') || document.documentElement;
  const br = body.getBoundingClientRect();
  return {
    hit: hit === el || el.contains(hit), hitDesc: hit ? hit.tagName + '#' + hit.id + '.' + hit.className : null,
    btnInView: r.width > 0 && r.top >= br.top && r.bottom <= Math.min(br.bottom, innerHeight),
    fsInView: fr.width > 0 && fr.height > 0 && fr.top >= br.top && fr.bottom <= Math.min(br.bottom, innerHeight),
    fsText: fs ? fs.textContent : null, clicks: window.__clicks, searches: window.__searches,
  };
};

for (const [name, bt, dev] of [['webkit', webkit, devices['iPhone 13']], ['chromium', chromium, devices['Pixel 7']]]) {
  if (!existsSync(EXE[name])) { ok(`${name}: tarayıcı kurulu`, false, EXE[name]); continue; }
  const browser = await bt.launch({ executablePath: EXE[name] });
  const ctx = await browser.newContext({ ...dev, locale: 'tr-TR', geolocation: { latitude: 41.0, longitude: 29.0 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const origin = new URL(base).origin;
  await page.route((u) => new URL(String(u)).origin !== origin, (r) => r.abort()); // çevrimdışı: Overpass/sunucu/karo yok
  await page.addInitScript(() => { // "Yakınımdaki istasyonlar" kartı kapalı: eski sürümde sonuç tamamen gizli kalıyordu
    for (const p of ['evcp.', 'evcpb.']) localStorage.setItem(p + 'collapsed', JSON.stringify({ 'near-card': true }));
  });
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.locator('.dock [data-tab="stations"]').first().tap();
  await page.waitForTimeout(2500); // sekme açılışındaki sessiz arama biter
  await page.locator('#near-refresh').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.__clicks = 0; window.__searches = 0;
    document.getElementById('near-refresh').addEventListener('click', () => { window.__clicks++; });
    const b = document.getElementById('near-refresh'); // arama başlangıcı = busy sınıfının eklenmesi (metin dile göre çevrilir, sınıf çevrilmez)
    let was = b.classList.contains('busy');
    new MutationObserver(() => { const on = b.classList.contains('busy'); if (on && !was) window.__searches++; was = on; }).observe(b, { attributes: true, attributeFilter: ['class'] });
  });

  const before = await page.evaluate(probe);
  ok(`${name}: Ara ekranda ve ortasındaki nokta düğmenin kendisi (örtü/panel engellemiyor)`, before.hit && before.btnInView, JSON.stringify(before));

  const box = await page.locator('#near-refresh').boundingBox();
  let last = before.fsText;
  const act = async (label, fn, n) => {
    await page.waitForTimeout(1100); // saat damgası saniyede değişir
    await fn();
    await page.waitForFunction((k) => window.__clicks >= k && !document.getElementById('near-refresh').classList.contains('busy'), n, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    const s = await page.evaluate(probe);
    ok(`${name}/${label}: click işleyiciye ulaştı`, s.clicks === n, JSON.stringify(s));
    ok(`${name}/${label}: dokunuş başına tam bir arama (çift istek yok)`, s.searches === n, JSON.stringify(s));
    ok(`${name}/${label}: Ara altındaki durum satırı görünür`, s.fsInView, JSON.stringify(s));
    ok(`${name}/${label}: durum satırı değişti (görünür yanıt) ve saatli`, s.fsText !== last && /\(\d\d:\d\d:\d\d\)$/.test(s.fsText), `önce="${last}" sonra="${s.fsText}"`);
    ok(`${name}/${label}: çevrimdışı kaynak hatası açıkça yazılır ("istasyon yok" denmez)`, /ulaşılamadı|kota|sınır/i.test(s.fsText) && !/bulunamadı/.test(s.fsText), s.fsText);
    last = s.fsText;
  };
  await act('dokunuş', () => page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2), 1);
  await act('fare tıklaması', () => page.mouse.click(box.x + box.width / 2, box.y + box.height / 2), 2);
  await act('klavye Enter', async () => { await page.focus('#near-refresh'); await page.keyboard.press('Enter'); }, 3);
  await act('klavye Boşluk', async () => { await page.focus('#near-refresh'); await page.keyboard.press(' '); }, 4);
  const css = await page.evaluate(() => getComputedStyle(document.getElementById('near-refresh')).touchAction);
  ok(`${name}: touch-action manipulation (iOS dokunuş gecikmesi yok)`, /manipulation/.test(css), css);
  await browser.close();
}
srv?.close();
console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
