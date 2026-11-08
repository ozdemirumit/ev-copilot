// Tek tip çizgi simgeler: index.html başındaki SVG sprite'ına başvurur. Manevra gösterimi: nav/steps.js düz metin glif üretir (dimmer ve testler onu okur),
// üst panelde bu glif aynı biçimde çizgi simgeye çevrilir.
export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${name}"/></svg>`;

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
