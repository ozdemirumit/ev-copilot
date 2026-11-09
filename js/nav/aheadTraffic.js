// Yol önü trafik özeti (saf hesap, tarayıcıya bağımlı değil): konumdan varışa alınan trafikli rotadan (TomTom ya da Mapbox)
// ilk önemli sıkışıklık ve gecikme çıkarılır.

/**
 * Bitişik yoğun/yavaş kesimlerin ilk önemli kümesi (km, konumdan itibaren): { from, to, jam } ya da null.
 * spans: [{ from, to, lvl: 'moderate' | 'heavy' | 'severe' }] (rota başı = bulunulan konum). Önemli: sıkışık (heavy/severe) ≥ 0,5 km ya da yavaş ≥ 3 km.
 */
export function jamFromSpans(spans, maxAheadKm = 150) {
  const out = [];
  for (const s of Array.isArray(spans) ? spans : []) {
    if (s?.lvl !== 'moderate' && s?.lvl !== 'heavy' && s?.lvl !== 'severe') continue;
    const jam = s.lvl === 'heavy' || s.lvl === 'severe';
    const last = out.at(-1);
    if (last && s.from - last.to < 0.5) { last.to = s.to; last.jam ||= jam; } else out.push({ from: s.from, to: s.to, jam });
  }
  return out.find((s) => s.from <= maxAheadKm && s.to - s.from >= (s.jam ? 0.5 : 3)) || null;
}

/** Trafikli rota → { jam, delayMin (olağan süreye göre fazla dakika), remainH (kalan süre, saat), rt (rotanın kendisi: hız profilini yenilemek için) }. */
export function aheadFromRoute(rt) {
  const ratio = rt?.trafficRatio > 1 ? rt.trafficRatio : 1;
  return {
    jam: jamFromSpans(rt?.trafficSpans),
    delayMin: Math.max(0, Math.round((rt?.durationH || 0) * 60 * (1 - 1 / ratio))),
    remainH: rt?.durationH || 0,
    rt,
  };
}
