// Küçük kalıcı anahtar-değer deposu (IndexedDB): LocalStorage'a sığmayan büyük kayıtlar için (kayıtlı rota gibi, birkaç yüz KB).
// Her işlem hata verirse sessizce null döner: özel pencere veya depolama kapalıysa uygulama yine çalışır (yalnızca saklama olmaz).
const DB = 'evcp-kv';
const STORE = 'kv';

let dbp = null;
const open = () => (dbp ??= new Promise((resolve, reject) => {
  const req = indexedDB.open(DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));

async function run(mode, fn) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? true);
      req.onerror = () => reject(req.error);
    });
  } catch {
    dbp = null;
    return null;
  }
}

export const kvDel = (key) => run('readwrite', (s) => s.delete(key));
