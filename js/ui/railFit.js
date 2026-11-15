// Sağ kenar kontrol sütunu yerleşim hesabı (saf; DOM yok). shell.js fitMore ölçer, burası karar verir.
export const RAIL_PITCH = 44; // 40 px düğme + 4 px aralık

// Sütunun aşmaması gereken üst sınır: sınır öğelerinin en alt kenarı.
// clipBottom verilmişse (#banners kaydırma kabının çocukları) alt kenar kabın GÖRÜNÜR altına kırpılır;
// taşan içerik kap içinde kayar, gizli kısmın altı ekranda yer kaplamaz.
export function railLimitTop(limits) {
  return Math.max(0, ...limits.map((l) => (l.clipBottom == null ? l.bottom : Math.min(l.bottom, l.clipBottom))));
}

// anchorTop: konum düğmelerinin üstü, boxBottom: sütun kutusunun altı, count: görünür düğme sayısı, top: railLimitTop.
export function railFit({ anchorTop, boxBottom, count, top }) {
  const above = anchorTop - top - 16;
  const side = count > 2 * Math.floor((above + 4) / RAIL_PITCH);
  return { side, maxHeight: Math.max(40, side ? boxBottom - top - 8 : above) };
}
