// Mapbox anahtarını sına: her kullandığımız API için en küçük istek. Dönüş: [{ name, ok, text }].
import { mbfetch } from './api.js';
import { categoryId } from './chargers.js';

export async function testMapbox() {
  const checks = [
    ['Directions (trafikli rota)', async () => {
      const j = await mbfetch('/directions/v5/mapbox/driving-traffic/32.8541,39.9208;32.8700,39.9300', { overview: 'false' });
      const r = j.routes?.[0];
      if (!r) throw new Error('rota dönmedi');
      return r.duration_typical > 0 ? `çalışıyor (trafik verisi var, ${Math.round(r.duration / 60)} dk)` : 'çalışıyor (olağan süre verisi yok: trafik oranı 1 sayılır)';
    }],
    ['Search Box (istasyon araması)', async () => {
      const cat = await categoryId();
      const j = await mbfetch(`/search/searchbox/v1/category/${encodeURIComponent(cat)}`, { bbox: '32.60,39.75,33.10,40.10', proximity: '32.85,39.92', limit: 25 });
      return `çalışıyor ("${cat}" kategorisi, Ankara çevresinde ${(j.features || []).length} kayıt)`;
    }],
  ];
  return Promise.all(checks.map(async ([name, fn]) => {
    try { return { name, ok: true, text: await fn() }; } catch (err) { return { name, ok: false, text: err.message || String(err) }; }
  }));
}
