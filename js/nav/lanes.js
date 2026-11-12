// Şerit bilgisi (yalnızca sağlayıcının gönderdiği veri; kamerayla şerit tespiti YOK). Kaynak: Mapbox Directions / OSRM biçimi,
// adımın manevra kavşağındaki (intersections[0]) `lanes` dizisi: [{ indications: ['left','straight'], valid: true, active?, valid_indication? }].
// valid: bu şerit rotadaki manevra için kullanılabilir. Tüm şeritler uygunsa şerit seçimi önemsizdir: gösterilmez (gereksiz kalabalık yok).

const ARROW = {
  uturn: '↶', 'sharp left': '↙', left: '←', 'slight left': '↖', straight: '↑', none: '↑',
  'slight right': '↗', right: '→', 'sharp right': '↘',
};

export const LANES_SHOW_M = 2000; // manevraya bu kadar kala gösterilir

/** Sağlayıcı lanes dizisi → [{ arrow, ok }] ya da null (veri yok, geçersiz ya da şerit seçimi önemsiz). */
export function parseLanes(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;
  const lanes = raw.map((l) => {
    const ind = Array.isArray(l?.indications) ? l.indications.filter((d) => d in ARROW) : [];
    const ok = l?.valid === true;
    const dir = (ok && l.valid_indication in ARROW ? l.valid_indication : ind[0]) || 'none';
    return { arrow: ARROW[dir], ok };
  });
  const okCount = lanes.filter((l) => l.ok).length;
  if (!okCount || okCount === lanes.length) return null;
  return lanes;
}

/** Panelde gösterilecek şeritler: adımda veri varsa ve manevraya LANES_SHOW_M içinde kaldıysa; yoksa null. */
export function lanesToShow(step, distM) {
  if (!step?.lanes?.length || !(distM <= LANES_SHOW_M)) return null;
  return step.lanes;
}
