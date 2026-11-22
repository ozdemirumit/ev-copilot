// Tek tip çizgi simgeler: index.html başındaki SVG sprite'ına başvurur. Manevra gösterimi: nav/steps.js düz metin glif üretir (testler onu okur),
// üst panelde bu glif aynı biçimde çizgi simgeye çevrilir.
export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Düğme/çip içeriği: çizgi simge + metin. Metin kendi <span>'ında durur (çeviri gözlemcisi metin düğümünü çevirir); simge dekoratiftir (aria-hidden). */
export function iconLabel(el, name, label) {
  el.classList.add('has-ic');
  el.replaceChildren();
  el.insertAdjacentHTML('afterbegin', icon(name));
  const s = document.createElement('span');
  s.textContent = label;
  el.append(s);
  return el;
}

const GLYPH = {
  '⬅️': 'turn-left', '➡️': 'turn-right', '↖️': 'slight-left', '↗️': 'slight-right', '↙️': 'sharp-left', '↘️': 'sharp-right', '⬆️': 'straight', '↩️': 'uturn',
  '🚗': 'car', '🏁': 'flag', '⚡': 'bolt', '🔄': 'roundabout', '⛴️': 'ferry', '🧭': 'compass', '📍': 'gps', '⚠️': 'warn',
};

/** Manevra alanını yaz: glif data-glyph'te saklanır, bilinen glif çizgi simge olur (bilinmeyen glif metin olarak kalır). */
export function setManeuverIcon(el, glyph) {
  el.dataset.glyph = glyph;
  if (GLYPH[glyph]) el.innerHTML = icon(GLYPH[glyph]);
  else el.textContent = glyph;
}
