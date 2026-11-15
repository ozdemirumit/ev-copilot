// RM-07 A3 navigasyon yerleşim tanılaması: saf yardımcı (js/ui/navLayoutProbe.js) + shell.js window.__navLayout salt okunur bağlantı.
// Kullanım: node scripts/test-nav-layout-probe.mjs
// ÖNEMLİ: fikstürler 360/375/399/412 px için BELİRLENİMCİ, ELLE KURULMUŞ ölçüm anlık görüntüleridir (gerçek tarayıcı/düzen motoru yok).
// Test yardımcının hesabını (taşma, kaydırma, 44 px dokunma kutusu, Liste boşluğu, sütun, genişlik) doğrular; cihaz yerleşimini DEĞİL.
import { readFileSync } from 'node:fs';
import { navLayoutReport, hitBox, overflowOf, cellReport, bannerScroll, listGap, HIT_MIN } from '../js/ui/navLayoutProbe.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---- 1) Yardımcı birimleri ----
ok('HIT_MIN 44', HIT_MIN === 44);
ok('overflowOf: sığan', overflowOf({ clientWidth: 50, scrollWidth: 50, clientHeight: 20, scrollHeight: 20 }).overflow === false);
ok('overflowOf: yatay taşma px', overflowOf({ clientWidth: 50, scrollWidth: 61, clientHeight: 20, scrollHeight: 20 }).x === 11);
ok('overflowOf: dikey taşma', overflowOf({ clientWidth: 50, scrollWidth: 50, clientHeight: 20, scrollHeight: 24 }).overflow === true);
ok('overflowOf: eksik alanlar → taşma yok', overflowOf({}).overflow === false);
ok('bannerScroll null → null', bannerScroll(null) === null);
ok('bannerScroll kaymaz', bannerScroll({ clientHeight: 200, scrollHeight: 200, scrollTop: 0 }).scrolls === false);
ok('bannerScroll kayar + gizli px', (() => { const b = bannerScroll({ clientHeight: 217.6, scrollHeight: 260, scrollTop: 0 }); return b.scrolls && b.hidden === 42.4; })());
const h36 = hitBox({ left: 300, top: 100, width: 36, height: 36 });
ok('hitBox ::after yok → 36x36, hit44 değil', h36.width === 36 && h36.height === 36 && h36.hit44 === false);
const h44 = hitBox({ left: 300, top: 100, width: 36, height: 36 }, { left: 1, top: 1, right: 1, bottom: 1 }, { left: -5, top: -5, right: -5, bottom: -5 });
ok('hitBox kenarlık 1 + inset -5 → 44x44 hit44', h44.width === 44 && h44.height === 44 && h44.hit44 && h44.left === 296 && h44.right === 340, JSON.stringify(h44));
const hIn = hitBox({ left: 0, top: 0, width: 36, height: 36 }, { left: 1, top: 1, right: 1, bottom: 1 }, { left: 0, top: 0, right: 0, bottom: 0 });
ok('hitBox ::after içeride → kenarlık kutusu korunur (36)', hIn.width === 36 && !hIn.hit44);
const g = listGap({ left: 200, top: 0, width: 94, height: 36 }, { left: 300, top: 0, width: 36, height: 36 }, h44);
ok('listGap görünür 6, dokunma 2, binme yok', g.visible === 6 && g.hit === 2 && g.overlap === false, JSON.stringify(g));
ok('listGap binme negatif', listGap({ left: 200, width: 99 }, { left: 300, width: 36 }, h44).overlap === true);
ok('listGap Liste yok → null', listGap(null, { left: 0, width: 36 }, h44) === null);
const cr = cellReport({ id: 'x', width: 40, clientWidth: 40, scrollWidth: 40, clientHeight: 44, scrollHeight: 44, parts: [{ sel: 'b', clientWidth: 36, scrollWidth: 52, clientHeight: 20, scrollHeight: 20 }] });
ok('cellReport iç parça kesilmesi hücre taşması sayılır', cr.overflow && cr.clipped[0] === 'b' && cr.overflowX === 16);

// ---- 2) Genişlik fikstürleri ----
// Model (yalnızca fikstür üretimi): kullanılabilir = W - 20 (#banners kenar boşluğu) - 2 (kenarlık) - 16 (navbar dolgusu); 6 sütun fr oranı.
const FR = [['nb-speed', 1], ['ne-limit-box', 1], ['ne-soc-btn', 1.15], ['ne-range-box', 1.1], ['ne-next-box', 1.5], ['ne-arrive-box', 1.1]];
const FR_SUM = FR.reduce((s, [, f]) => s + f, 0);
// Sabit içerik genişlikleri (px): "≈100%" pil, "199" hız, uzun sonraki şarj adı, "Varışta 18%".
const CONTENT = { 'nb-speed': 34, 'ne-limit-box': 30, 'ne-soc-btn': 52, 'ne-range-box': 36, 'ne-next-box': 76, 'ne-arrive-box': 40 };
function fixture(W) {
  const avail = W - 20 - 2 - 16;
  const cells = FR.map(([id, f]) => {
    const w = Math.floor((avail * f) / FR_SUM * 10) / 10, inner = Math.floor(w - 4); // padding 0 2px
    return { id, width: w, clientWidth: Math.floor(w), scrollWidth: Math.floor(w), clientHeight: 44, scrollHeight: 44,
      parts: [{ sel: 'b', clientWidth: inner, scrollWidth: Math.max(inner, CONTENT[id]), clientHeight: 22, scrollHeight: 22 }] };
  });
  const closeLeft = W - 10 - 1 - 8 - 36; // sağ kenar boşluğu + kenarlık + .tp-charge dolgusu
  return {
    viewport: { width: W, height: 640 }, navActive: true, cells,
    banners: { clientHeight: 217.6, scrollHeight: W < 380 ? 262 : 210, scrollTop: 0 },
    close: { rect: { left: closeLeft, top: 180, width: 36, height: 36 }, border: { left: 1, top: 1, right: 1, bottom: 1 }, after: { left: -5, top: -5, right: -5, bottom: -5 } },
    list: { rect: { left: closeLeft - 6 - 70, top: 180, width: 70, height: 36 } },
    rail: { side: W < 380, maxHeight: W < 380 ? 300 : 176 },
  };
}
const EXPECT = { 360: ['ne-soc-btn', 'ne-next-box'], 375: ['ne-next-box'], 399: ['ne-next-box'], 412: [] };
for (const W of [360, 375, 399, 412]) {
  const snap = fixture(W);
  const before = JSON.stringify(snap);
  const r = navLayoutReport(snap);
  ok(`${W}: anlık görüntü değişmez (salt okunur)`, JSON.stringify(snap) === before);
  ok(`${W}: rapor dondurulmuş`, Object.isFrozen(r));
  ok(`${W}: viewportWidth`, r.viewportWidth === W);
  ok(`${W}: navActive`, r.navActive === true);
  ok(`${W}: 6 metrik hücresi`, r.cells.length === 6);
  ok(`${W}: taşan hücreler ${EXPECT[W].join(',') || '—'}`, JSON.stringify(r.overflowCells) === JSON.stringify(EXPECT[W]), JSON.stringify(r.overflowCells));
  ok(`${W}: banner kaydırma ${W < 380}`, r.banner.scrolls === (W < 380) && r.banner.hidden === (W < 380 ? 44.4 : 0), JSON.stringify(r.banner));
  ok(`${W}: kapat görünür 36x36, etkin 44x44 hit44`, r.close.visibleWidth === 36 && r.close.visibleHeight === 36 && r.close.width === 44 && r.close.height === 44 && r.close.hit44 === true, JSON.stringify(r.close));
  ok(`${W}: kapat etkin kutu konumu`, r.close.left === W - 59 && r.close.right === W - 15 && r.close.top === 176 && r.close.bottom === 220, JSON.stringify(r.close));
  ok(`${W}: Liste boşluğu görünür 6 / dokunma 2, binme yok`, r.listGap.visible === 6 && r.listGap.hit === 2 && !r.listGap.overlap, JSON.stringify(r.listGap));
  ok(`${W}: rail side ${W < 380}`, r.railSide === (W < 380) && r.railMaxHeight === (W < 380 ? 300 : 176));
}
// Eksik veri: nav kapalı, kapat/Liste yok
const empty = navLayoutReport({});
ok('boş anlık görüntü: null alanlar, çökme yok', empty.viewportWidth === null && empty.close === null && empty.listGap === null && empty.banner === null && empty.railSide === null && empty.cells.length === 0 && empty.navActive === false);
ok('kapat var, Liste gizli → listGap null', navLayoutReport({ close: fixture(360).close }).listGap === null);

// ---- 3) Kaynak denetimleri: saf modül + salt okunur bağlantı ----
const probe = read('js/ui/navLayoutProbe.js');
const code = probe.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok('navLayoutProbe.js DOM/ağ/global kullanmaz', !/\b(document|window|navigator|fetch|XMLHttpRequest|localStorage|addEventListener|setTimeout|setInterval|import\b)/.test(code));
const shell = read('js/ui/shell.js');
ok('shell.js navLayoutReport içe aktarır', /import \{ navLayoutReport \} from '\.\/navLayoutProbe\.js';/.test(shell));
const m = shell.match(/\/\/ NAVLAYOUT-READ-BEGIN\n([\s\S]*?)\/\/ NAVLAYOUT-READ-END/);
ok('shell.js __navLayout bloğu bulundu', !!m);
const blk = m ? m[1] : '';
ok('__navLayout tek atama: window.__navLayout = () =>', /^\s*window\.__navLayout = \(\) => \{/.test(blk));
ok('__navLayout DOM yazmaz / dinleyici / ağ / zamanlayıcı yok',
  !/(\.style\.|setProperty|classList\.(add|remove|toggle)|setAttribute|removeAttribute|innerHTML|textContent\s*=|\.append|\.remove\(|scrollTo\(|scrollBy\(|scrollIntoView|scroll(Top|Left)\s*=(?!=)|addEventListener|Observer|fetch\(|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame|save\(|setState|localStorage|focus\(|click\()/.test(blk.replace(/more\.style\.maxHeight\)/, '')), blk.slice(0, 120));
ok('__navLayout yalnızca more.style.maxHeight OKUR', (blk.match(/\.style\./g) || []).length === 1 && /parseFloat\(more\.style\.maxHeight\)/.test(blk));
ok('__navLayout rapor alanlarını verir', ['viewport:', 'cells', 'banners:', 'close:', 'list:', 'rail:'].every((k) => blk.includes(k)));
const sw = read('sw.js');
ok('sw.js navLayoutProbe.js önbelleğe alır', sw.includes("'./js/ui/navLayoutProbe.js'"));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
