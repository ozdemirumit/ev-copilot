// Çevrimdışı harita indirme işçisi (module worker). Dosyayı R2'den 8 MiB'lık Range parçalarıyla indirip OPFS'e (tarayıcının özel dosya
// alanı) yazar. Bayt konumu OPFS dosyasının boyutundan okunur: kesilen indirme kaldığı yerden sürer (dosya adı sürümlüdür, içerik değişmez).
// Mesajlar: { cmd: 'start', url, name, size } / { cmd: 'cancel' }  →  { type: 'progress'|'done'|'cancelled'|'error', ... }
const CHUNK = 8 * 1024 * 1024;
const RETRIES = 4;
let cancelled = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chunk(url, from, to, size) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES && !cancelled; attempt++) {
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, cache: 'no-store' });
      if (res.status !== 206) throw new Error(res.status === 200 ? 'Sunucu Range (parçalı indirme) desteklemiyor' : `Sunucu HTTP ${res.status} döndü`);
      const total = Number((res.headers.get('Content-Range') || '').split('/')[1]);
      if (total !== size) throw new Error('Dosya boyutu bildirimle uyuşmuyor (sunucudaki dosya değişmiş olabilir)');
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length !== to - from + 1) throw new Error('Parça eksik geldi');
      return buf;
    } catch (err) {
      lastErr = err;
      if (/Range|boyutu/.test(err.message)) throw err; // yeniden denemenin anlamı yok
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('İndirme iptal edildi');
}

async function run({ url, name, size }) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('maps', { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const ah = await fh.createSyncAccessHandle();
  try {
    let pos = ah.getSize();
    if (pos > size) { ah.truncate(0); pos = 0; }
    postMessage({ type: 'progress', pos, size });
    while (pos < size && !cancelled) {
      const to = Math.min(pos + CHUNK, size) - 1;
      const buf = await chunk(url, pos, to, size);
      ah.write(buf, { at: pos });
      ah.flush();
      pos += buf.length;
      postMessage({ type: 'progress', pos, size });
    }
    postMessage(cancelled ? { type: 'cancelled', pos } : { type: 'done', size: ah.getSize() });
  } finally {
    ah.close();
  }
}

self.onmessage = (e) => {
  if (e.data.cmd === 'cancel') { cancelled = true; return; }
  if (e.data.cmd === 'start') {
    cancelled = false;
    run(e.data).catch((err) => postMessage({ type: 'error', message: err.message || String(err) }));
  }
};
