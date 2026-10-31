// Çevrimdışı vektör harita stili: cihazdaki PMTiles dosyası (OPFS) + Protomaps koyu teması + yerel yazı tipi/simge dosyaları.
// pmtiles ve @protomaps/basemaps kütüphaneleri vendor/ içinde klasik betik olarak gelir (genel değişkenler `pmtiles`, `basemaps`).
import { packFile } from './pack.js';

const VENDOR = new URL('../../vendor/', import.meta.url).href;
const loaded = new Map();

function script(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = Object.assign(document.createElement('script'), { src, async: true });
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error('Çevrimdışı harita kütüphanesi yüklenemedi')); };
      document.head.append(s);
    }));
  }
  return loaded.get(src);
}

/** Kütüphaneleri belleğe al (ağ varken çağrılırsa internet kesilince hazır olur). */
export const preload = () => Promise.all([script(VENDOR + 'pmtiles/pmtiles.js'), script(VENDOR + 'basemaps/basemaps.js')]);

let protocol = null;
const opened = new Map(); // anahtar → true (aynı paket iki kez eklenmesin)

/**
 * Paketi MapLibre'e kaydet ve stili kur. Dönüş: stil nesnesi veya paket yoksa/eksikse null.
 * ml: window.maplibregl.
 */
export async function offlineStyle(ml, countryId) {
  const pf = await packFile(countryId);
  if (!pf) return null;
  await preload();
  if (!protocol) {
    protocol = new pmtiles.Protocol();
    ml.addProtocol('pmtiles', protocol.tile);
  }
  const key = `offline-${countryId}-${pf.info.build ?? pf.info.at}`;
  if (!opened.has(key)) {
    const file = pf.file;
    // OPFS dosyası tembel okunur: yalnızca istenen bayt aralığı belleğe gelir
    const source = { getKey: () => key, getBytes: async (offset, length) => ({ data: await file.slice(offset, offset + length).arrayBuffer() }) };
    const p = new pmtiles.PMTiles(source);
    await p.getHeader(); // geçerlilik (sihirli sayı) kontrolü: bozuksa burada hata verir
    protocol.add(p);
    opened.set(key, true);
  }
  const assets = `${VENDOR}basemaps-assets/`; // mutlak adres: MapLibre göreli sprite adresini sevmez
  return {
    version: 8,
    glyphs: `${assets}fonts/{fontstack}/{range}.pbf`,
    sprite: `${assets}sprites/v4/dark`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${key}`,
        attribution: '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: basemaps.layers('protomaps', basemaps.namedFlavor('dark'), { lang: 'tr' }), // lang verilmezse etiket katmanları eklenmez
  };
}
