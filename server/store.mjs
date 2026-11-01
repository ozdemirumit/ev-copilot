// Basit dosya tabanlı depo (bağımlılık yok): kullanıcılar, davetler, oturumlar ve senkron verisi server/data/db.json içinde durur.
// Yazma gecikmeli ve atomiktir (geçici dosya + yeniden adlandırma); süreç kapanırken son durum yazılır. Küçük kullanıcı sayısı (onlarca) için yeterlidir.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'db.json');
  let data = { users: {}, invites: {}, sessions: {}, docs: {} };
  if (existsSync(file)) {
    try {
      data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (err) {
      copyFileSync(file, join(dir, `db.bozuk-${Date.now()}.json`)); // bozuk dosya yedeklenir, sessizce ezilmez
      throw new Error('db.json okunamadı (yedeği alındı): ' + err.message);
    }
  }
  let dirty = false;
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!dirty) return;
    dirty = false;
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  };
  const save = () => {
    dirty = true;
    timer ||= setTimeout(flush, 800);
  };
  process.on('exit', flush);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
  return { data, save, flush };
}
