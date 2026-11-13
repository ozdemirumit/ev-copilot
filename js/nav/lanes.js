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

export const LANE_VOICE_MIN_M = 120; // son komut eşiği (steps.js VOICE_TIERS_M[0]): orada şerit söylenmez, komut kısa kalır

/**
 * Sesli şerit önerisi (Türkçe): yalnızca uygun (valid) şeritler bitişik ve konumları kesinse (kenarda ya da tam ortada); değilse null.
 * Girdi parseLanes çıktısıdır: veri yoksa, tüm şeritler uygunsa ya da hiçbiri uygun değilse zaten null gelir.
 */
export function laneHint(lanes) {
  if (!Array.isArray(lanes) || lanes.length < 2) return null;
  const first = lanes.findIndex((l) => l?.ok);
  const last = lanes.length - 1 - [...lanes].reverse().findIndex((l) => l?.ok);
  if (first < 0) return null;
  const n = last - first + 1;
  if (n === lanes.length || lanes.slice(first, last + 1).some((l) => !l?.ok)) return null; // hepsi uygun / bitişik değil
  const many = n > 1;
  if (first === 0) return many ? 'Sol şeritleri kullanın.' : 'En sol şeridi kullanın.';
  if (last === lanes.length - 1) return many ? 'Sağ şeritleri kullanın.' : 'En sağ şeridi kullanın.';
  if (first === lanes.length - 1 - last) return many ? 'Orta şeritleri kullanın.' : 'Orta şeridi kullanın.';
  return null; // ortada ama simetrik değil: "orta" belirsiz, söylenmez
}

/**
 * Dönüş anonsuna şerit önerisini ekler: adım başına bir kez, şerit paneli görünürken (LANES_SHOW_M) ve son komut eşiğinden önce.
 * Ayrı bir konuşma üretmez (dönüş anonsu kesilmez, sıra bozulmaz); öneri yoksa metin aynen döner.
 */
export function addLaneHint(said, idx, st, distM, text) {
  if (!(distM > LANE_VOICE_MIN_M) || said.has(`${idx}:lane`)) return text;
  const hint = laneHint(lanesToShow(st, distM));
  if (!hint) return text;
  said.add(`${idx}:lane`);
  return `${text} ${hint}`;
}
