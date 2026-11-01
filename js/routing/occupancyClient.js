// Canlı istasyon doluluğu ve fiyatı: ara sunucudan (server/occupancy.mjs). Hollanda'da NDW/DOT-NL açık verisi (OCPI Locations + Tariffs),
// diğer yerlerde sunucuda Google Places anahtarı varsa o. Sunucu yoksa ya da veri yoksa boş döner (istasyon "bilinmiyor" kalır).
import { proxyFetch, proxyHas } from '../net/proxy.js';

/** stations (en çok `max`) → Map(id → slots). slots: { total, available, out, at, checked, src, price } */
export async function fetchAvailability(stations, max = 2, soc = null) {
  const out = new Map();
  if (!proxyHas('occupancy')) return out;
  const list = stations.slice(0, max).map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, dc: !s.slow }));
  if (!list.length) return out;
  try {
    const res = await proxyFetch('/v1/occupancy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stations: list, soc }), signal: AbortSignal.timeout(20000) });
    if (!res.ok) return out;
    const { results } = await res.json();
    for (const [id, r] of Object.entries(results || {})) {
      if (!r) continue; // veri yok: istasyon bilinmiyor kalır
      // total/available null olabilir (yalnızca fiyat biliniyor): istasyon doluluk bakımından "bilinmiyor" kalır, fiyat gösterilir
      out.set(id, { total: r.total, available: r.available, out: r.out ?? 0, at: r.at, checked: Date.now(), src: r.src, price: r.price || null });
    }
  } catch (err) {
    console.warn('Doluluk alınamadı:', err.message);
  }
  return out;
}
