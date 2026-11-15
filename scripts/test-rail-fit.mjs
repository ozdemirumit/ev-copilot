// RM-07 A2a: sağ kontrol sütunu (fitMore) sınırı, #banners kaydırma kabının GÖRÜNÜR altında kırpılır.
// #banners max-height + overflow-y:auto: içerik taşınca alt çocukların getBoundingClientRect().bottom değeri
// kabın görünür altının ötesine (gizli içerik altı) uzanır; bu değer sınır alınırsa üstteki boşluk eksik ölçülür
// ve sütun gereksiz yere konum düğmelerinin soluna (side) geçer. Saf yardımcı + shell.js kaynak denetimi.
// Kullanım: node scripts/test-rail-fit.mjs
import { readFileSync } from 'node:fs';
import { railLimitTop, railFit, RAIL_PITCH } from '../js/ui/railFit.js';

const shell = readFileSync(new URL('../js/ui/shell.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(cond ? 'ok  ' : 'FAIL', name, cond ? '' : extra); };

// Önceki satır içi hesap (4721532 shell.js fitMore) — karşılaştırma için birebir
const oldFit = ({ anchorTop, boxBottom, bottoms, count }) => {
  const top = Math.max(0, ...bottoms);
  const above = anchorTop - top - 16;
  const side = count > 2 * Math.floor((above + 4) / 44);
  return { top, side, maxHeight: Math.max(40, side ? boxBottom - top - 8 : above) };
};

ok('RAIL_PITCH 44 (40 px düğme + 4 px aralık) değişmedi', RAIL_PITCH === 44);

// 1) Taşmış #banners: görünür alt 200, kayan içerikteki son uyarının altı 500 (gizli)
const clip = 200;
const limits = [
  { bottom: 60 },                    // .hudtop çocuğu (kırpılmaz)
  { bottom: 180, clipBottom: clip }, // #banners > görünür uyarı
  { bottom: 500, clipBottom: clip }, // #banners > görünür alt sınırın altında kalan (kaydırılarak görülür)
];
const geo = { anchorTop: 600, boxBottom: 700, count: 6 };
const before = oldFit({ ...geo, bottoms: limits.map((l) => l.bottom) });
ok('önceki hesap gizli içerik altını sınır alıyordu (hata kanıtı: top=500, side=true)', before.top === 500 && before.side === true, JSON.stringify(before));
const top = railLimitTop(limits);
ok('yeni: #banners çocuğu görünür kap altına (200) kırpılır', top === 200, String(top));
const now = railFit({ ...geo, top });
ok('yeni: 6 düğme görünür boşluğa sığar → side=false', now.side === false, JSON.stringify(now));
ok('yeni: maxHeight = görünür boşluk (600−200−16=384)', now.maxHeight === 384, JSON.stringify(now));

// 2) Taşma yoksa (çocuk altı ≤ kap altı) sonuç önceki hesapla birebir aynı
for (const g of [
  { anchorTop: 600, boxBottom: 700, count: 6, lim: [{ bottom: 60 }, { bottom: 180, clipBottom: 200 }] },
  { anchorTop: 300, boxBottom: 400, count: 7, lim: [{ bottom: 120 }, { bottom: 250, clipBottom: 250 }] },
  { anchorTop: 200, boxBottom: 300, count: 3, lim: [{ bottom: 190 }] },
  { anchorTop: 500, boxBottom: 560, count: 4, lim: [] },
]) {
  const o = oldFit({ ...g, bottoms: g.lim.map((l) => l.bottom) });
  const n = railFit({ ...g, top: railLimitTop(g.lim) });
  ok(`taşma yok: önceki hesapla aynı (anchor ${g.anchorTop}, ${g.count} düğme)`, o.top === railLimitTop(g.lim) && o.side === n.side && o.maxHeight === n.maxHeight, JSON.stringify({ o, n }));
}

// 3) Kırpma yalnızca alt değeri küçültür; kırpılmayan (hud/pickbar) sınırlar aynen kalır; boş liste 0
ok('kırpma yalnızca küçültür (kap altının üstündeki çocuk değişmez)', railLimitTop([{ bottom: 150, clipBottom: 200 }]) === 150);
ok('kırpılmayan sınır (clipBottom yok) aynen', railLimitTop([{ bottom: 520 }, { bottom: 500, clipBottom: 200 }]) === 520);
ok('boş liste → 0', railLimitTop([]) === 0);
ok('negatif değerler 0 altına inmez', railLimitTop([{ bottom: -30 }]) === 0);

// 4) side=true yolunda maxHeight sütun kutusunun altına göre (önceki formül korunur)
const s = railFit({ anchorTop: 300, boxBottom: 400, count: 8, top: 250 });
ok('side=true: maxHeight = box.bottom − top − 8 (142), en az 40', s.side === true && s.maxHeight === 142, JSON.stringify(s));
ok('maxHeight en az 40', railFit({ anchorTop: 100, boxBottom: 120, count: 9, top: 100 }).maxHeight === 40);

// 5) shell.js yardımcıyı kullanır, #banners çocuklarını kabın görünür altıyla kırpar
ok('shell.js railFit.js içe aktarır', /import \{[^}]*railLimitTop[^}]*railFit[^}]*\} from '\.\/railFit\.js';/.test(shell));
ok('shell.js #banners çocuklarına clipBottom = #banners görünür alt verir', /clipBottom: el\.parentElement === banners \? bannersBox\.bottom : null/.test(shell) && /const bannersBox = banners\.getBoundingClientRect\(\)/.test(shell));
ok('shell.js eski satır içi Math.max(...limits.map) hesabını kullanmaz', !/Math\.max\(0, \.\.\.limits\.map/.test(shell));
ok('fitMore sözleşmesi korunur: maxHeight, hud.children, ResizeObserver, side sınıfı', /more\.style\.maxHeight = /.test(shell) && /hud\.children/.test(shell) && /new ResizeObserver\(fitMore\)/.test(shell) && /classList\.toggle\('side', side\)/.test(shell));

console.log(`\n${pass} geçti, ${fail} başarısız`);
process.exit(fail ? 1 : 0);
