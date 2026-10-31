// Çevrimdışı ülke haritası paketi . Paket, Protomaps verisinden üretilmiş tek bir .pmtiles dosyasıdır
// (GitHub Actions üretir, Cloudflare R2'de durur). Burada: bildirim (manifest) okuma, OPFS'e indirme, silme, depolama bilgisi.
// Dosya adresi (R2) koda yazılmaz: kullanıcı telefonda girer (localStorage `mapBase`).
import { load, save, remove } from '../utils/storage.js';

export const COUNTRIES = [{ id: 'tur', name: 'Türkiye' }];
const DIR = 'maps';

export const mapBase = () => String(load('mapBase', '') || '').replace(/\/+$/, '');
export const setMapBase = (v) => save('mapBase', String(v || '').trim().replace(/\/+$/, ''));
export const supported = () => !!(navigator.storage?.getDirectory && window.Worker);

/** Tamamlanmış paketin bilgisi { file, size, build, maxzoom, at } veya yok. */
export const packInfo = (id) => load(`pack.${id}`, null);

const fmtMb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`);
export { fmtMb };

/** R2'deki bildirim: { file, size, build, maxzoom, sha256? }. */
export async function fetchManifest(id) {
  const base = mapBase();
  if (!/^https?:\/\//i.test(base)) throw new Error('Önce harita dosyası adresini gir');
  let res;
  try {
    res = await fetch(`${base}/maps/${id}-latest.json`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error('Harita sunucusuna ulaşılamadı (adres veya internet?)');
  }
  if (!res.ok) throw new Error(`Bildirim dosyası bulunamadı (HTTP ${res.status}): adresi ve "${id}-latest.json" dosyasını kontrol et`);
  const m = await res.json();
  if (!m.file || !(m.size > 0)) throw new Error('Bildirim dosyası geçersiz');
  return { ...m, url: `${base}/${m.file}`, name: m.file.split('/').pop() };
}

/** Depolama: { quota, usage, free } (tahmin; bilinmiyorsa null) ve kalıcılık isteği. */
export async function storageInfo() {
  try {
    const { quota, usage } = await navigator.storage.estimate();
    return { quota, usage, free: quota - usage };
  } catch {
    return null;
  }
}

async function dirHandle(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create });
}

/**
 * Kaydedilmiş paketin dosyası (OPFS File) veya paket yoksa/eksikse null. Dosya silinmişse (tarayıcı depolamayı temizlemiş olabilir,
 * özellikle iPhone'da) ya da boyutu tutmuyorsa kayıt da düşürülür: arayüz "indirildi" demeye devam etmesin.
 */
export async function packFile(id) {
  const info = packInfo(id);
  if (!info) return null;
  try {
    const fh = await (await dirHandle()).getFileHandle(info.file.split('/').pop());
    const file = await fh.getFile();
    if (file.size === info.size) return { file, info };
  } catch { /* dosya yok */ }
  remove(`pack.${id}`);
  return null;
}

/** Tamamlanmamış (yarım) indirme baytı: pakette kayıtlı olmayan dosyaların toplam boyutu (0 = yok). */
export async function partialBytes(id) {
  try {
    const keep = packInfo(id)?.file.split('/').pop();
    let sum = 0;
    for await (const [name, h] of (await dirHandle()).entries()) if (name !== keep && h.kind === 'file') sum += (await h.getFile()).size;
    return sum;
  } catch {
    return 0;
  }
}

/** Stilin ihtiyaç duyduğu sabit dosyaları (kütüphaneler, yazı tipleri, simgeler) çekip service worker önbelleğine al: internetsiz açılışta gerekir. */
export async function precacheAssets() {
  const base = new URL('../../vendor/', import.meta.url).href;
  const urls = [
    'maplibre/maplibre-gl.js', 'maplibre/maplibre-gl.css', 'pmtiles/pmtiles.js', 'basemaps/basemaps.js',
    'basemaps-assets/sprites/v4/dark.json', 'basemaps-assets/sprites/v4/dark.png', 'basemaps-assets/sprites/v4/dark@2x.json', 'basemaps-assets/sprites/v4/dark@2x.png',
  ];
  for (const font of ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic']) {
    for (const r of ['0-255', '256-511', '512-767', '768-1023', '8192-8447', '8448-8703']) urls.push(`basemaps-assets/fonts/${font}/${r}.pbf`);
  }
  await Promise.all(urls.map((u) => fetch(base + u.split('/').map(encodeURIComponent).join('/')).catch(() => null)));
}

let worker = null;

/**
 * Paketi indir (kaldığı yerden devam eder). onProgress({ pos, size }). Dönüş: Promise → tamamlanınca paket bilgisi.
 * İptal için cancelDownload(); iptalde Promise 'iptal' hatasıyla reddedilir (dosya kısmi kalır, sonra devam edilebilir).
 */
export async function downloadPack(id, onProgress = () => {}) {
  if (!supported()) throw new Error('Bu tarayıcı çevrimdışı harita saklamayı desteklemiyor');
  if (worker) throw new Error('İndirme zaten sürüyor');
  const m = await fetchManifest(id);
  const st = await storageInfo();
  const have = (await (async () => { try { return (await (await (await dirHandle()).getFileHandle(m.name)).getFile()).size; } catch { return 0; } })());
  if (st && m.size - have > st.free * 0.9) throw new Error(`Yeterli boş yer yok: ${fmtMb(m.size)} gerekli, ~${fmtMb(Math.max(0, st.free))} var`);
  try { await navigator.storage.persist?.(); } catch { /* izin verilmezse de çalışır */ }
  let lock = null;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* desteklenmiyor */ }

  worker = new Worker(new URL('./dl-worker.js', import.meta.url), { type: 'module' });
  try {
    await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') onProgress({ pos: d.pos, size: d.size });
        else if (d.type === 'done') resolve();
        else if (d.type === 'cancelled') reject(new Error('iptal'));
        else if (d.type === 'error') reject(new Error(d.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'İndirme işçisi hata verdi'));
      worker.postMessage({ cmd: 'start', url: m.url, name: m.name, size: m.size });
    });
  } finally {
    worker.terminate();
    worker = null;
    lock?.release?.();
  }
  const info = { file: m.file, size: m.size, build: m.build ?? null, maxzoom: m.maxzoom ?? null, at: Date.now() };
  // Geçerli bir PMTiles mi? Tamamlandı işareti yalnızca doğrulanınca konur.
  const f = await (await (await dirHandle()).getFileHandle(m.name)).getFile();
  const head = new Uint8Array(await f.slice(0, 7).arrayBuffer());
  if (f.size !== m.size || String.fromCharCode(...head) !== 'PMTiles') throw new Error('İndirilen dosya geçersiz: silip yeniden indir');
  save(`pack.${id}`, info);
  await removeOld(m.name);
  await precacheAssets();
  return info;
}

export const cancelDownload = () => worker?.postMessage({ cmd: 'cancel' });
export const downloading = () => !!worker;

/** Verilen adın dışındaki eski harita dosyalarını sil. */
async function removeOld(keepName) {
  try {
    const dir = await dirHandle();
    for await (const name of dir.keys()) if (name !== keepName) await dir.removeEntry(name);
  } catch { /* yoksay */ }
}

/** Paketi ve kısmi dosyaları sil. */
export async function deletePack(id) {
  remove(`pack.${id}`);
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
  } catch { /* hiç yoktu */ }
}
