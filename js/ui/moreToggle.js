// "+ N" / "−" düğmesi: listede sınırdan fazla öğe varsa görünür; kapalıyken kalan sayıyı, açıkken "−" yazar.
import { tr } from '../i18n/index.js';

/** Düğmeyi güncelle. total: öğe sayısı, limit: kapalıyken gösterilen sayı, open: tümü açık mı. Dönüş: düğme görünür mü. */
export function paintMore(btn, total, limit, open) {
  const needed = total > limit;
  btn.classList.toggle('hidden', !needed);
  if (!needed) return false;
  const label = tr(open ? 'Daha az göster' : 'Tümünü göster');
  btn.textContent = open ? '−' : `+${total - limit}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', String(open));
  return true;
}
