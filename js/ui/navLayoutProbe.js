// RM-07 A3 navigasyon yerleşim tanılaması (saf; DOM yok, ağ yok, yan etki yok).
// shell.js içindeki window.__navLayout() DOM'dan salt okunur bir ölçüm anlık görüntüsü toplar; karar/özet burada hesaplanır.
// Sonuç yalnızca rapordur: hiçbir değer arayüze geri yazılmaz.
export const HIT_MIN = 44; // en küçük dokunma hedefi (px)

const num = (v) => (Number.isFinite(+v) ? +v : 0);
const r1 = (v) => Math.round(num(v) * 10) / 10;

// Bir öğenin taşması: içerik genişliği/yüksekliği görünür kutudan büyükse (ellipsis ile kesilen metin dahil).
export function overflowOf(part) {
  const x = Math.max(0, num(part.scrollWidth) - num(part.clientWidth));
  const y = Math.max(0, num(part.scrollHeight) - num(part.clientHeight));
  return { x: r1(x), y: r1(y), overflow: x > 0.5 || y > 0.5 };
}

// Metrik hücresi: hücrenin kendisi ve iç parçaları (değer, etiket, alt satır) ayrı ayrı denetlenir.
export function cellReport(cell) {
  const parts = (cell.parts || []).map((p) => ({ sel: p.sel, ...overflowOf(p) }));
  const self = overflowOf(cell);
  const clipped = parts.filter((p) => p.overflow).map((p) => p.sel);
  return { id: cell.id, width: r1(cell.width), overflow: self.overflow || clipped.length > 0, overflowX: Math.max(self.x, ...parts.map((p) => p.x)), clipped };
}

// #banners kendi içinde kayar mı ve görünmeyen içerik kaç px.
export function bannerScroll(b) {
  if (!b) return null;
  const hidden = Math.max(0, num(b.scrollHeight) - num(b.clientHeight));
  return { scrolls: hidden > 0.5, hidden: r1(hidden), scrollTop: r1(b.scrollTop), clientHeight: r1(b.clientHeight), scrollHeight: r1(b.scrollHeight) };
}

// Etkin dokunma kutusu: kenarlık kutusu ∪ ::after kutusu. position:relative düğmede ::after'ın kapsayan bloğu dolgu kutusudur
// (kenarlık kutusundan kenarlık kalınlığı kadar içeride); inset negatifse dışarı taşar.
export function hitBox(rect, border = {}, after = null) {
  const box = { left: num(rect.left), top: num(rect.top), right: num(rect.left) + num(rect.width), bottom: num(rect.top) + num(rect.height) };
  if (after) {
    const pad = { left: box.left + num(border.left), top: box.top + num(border.top), right: box.right - num(border.right), bottom: box.bottom - num(border.bottom) };
    box.left = Math.min(box.left, pad.left + num(after.left));
    box.top = Math.min(box.top, pad.top + num(after.top));
    box.right = Math.max(box.right, pad.right - num(after.right));
    box.bottom = Math.max(box.bottom, pad.bottom - num(after.bottom));
  }
  const width = box.right - box.left, height = box.bottom - box.top;
  return { left: r1(box.left), top: r1(box.top), right: r1(box.right), bottom: r1(box.bottom), width: r1(width), height: r1(height), hit44: width >= HIT_MIN - 0.05 && height >= HIT_MIN - 0.05 };
}

// Liste düğmesi ile kapat (X) arası: görünür boşluk ve görünmez dokunma alanı dahil boşluk (negatif = Liste'ye biner).
export function listGap(listRect, closeRect, closeHit) {
  if (!listRect || !closeRect) return null;
  const listRight = num(listRect.left) + num(listRect.width);
  const visible = num(closeRect.left) - listRight;
  const hit = closeHit ? num(closeHit.left) - listRight : visible;
  return { visible: r1(visible), hit: r1(hit), overlap: hit < -0.05 };
}

/**
 * Anlık görüntüden rapor üretir. snap alanları (hepsi isteğe bağlı, eksikse null raporlanır):
 *  viewport {width, height, clientWidth}, navActive, cells [{id, width, clientWidth, scrollWidth, clientHeight, scrollHeight, parts:[{sel,...}]}],
 *  banners {clientHeight, scrollHeight, scrollTop}, close {rect, border, after}, list {rect} | null, rail {side, maxHeight}
 */
export function navLayoutReport(snap = {}) {
  const cells = (snap.cells || []).map(cellReport);
  const close = snap.close && snap.close.rect ? hitBox(snap.close.rect, snap.close.border, snap.close.after) : null;
  const vp = snap.viewport || {};
  return Object.freeze({
    viewportWidth: vp.width == null ? null : r1(vp.width),
    viewportHeight: vp.height == null ? null : r1(vp.height),
    navActive: !!snap.navActive,
    cells,
    overflowCells: cells.filter((c) => c.overflow).map((c) => c.id),
    banner: bannerScroll(snap.banners),
    close: close && { ...close, visibleWidth: r1(snap.close.rect.width), visibleHeight: r1(snap.close.rect.height) },
    listGap: snap.list && snap.list.rect && snap.close ? listGap(snap.list.rect, snap.close.rect, close) : null,
    railSide: snap.rail ? !!snap.rail.side : null,
    railMaxHeight: snap.rail && snap.rail.maxHeight != null ? r1(snap.rail.maxHeight) : null,
  });
}
