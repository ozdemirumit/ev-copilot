// Web dosyalarını Capacitor'un okuduğu www/ klasörüne kopyalar (uygulamanın derleme adımı yok, olduğu gibi paketlenir).
// sw.js paketlenmez: dosyalar zaten APK içinde, güncelleme yeni APK ile gelir.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const ITEMS = ['index.html', 'offline.html', 'manifest.webmanifest', 'version.js', 'css', 'js', 'vendor', 'icons'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const item of ITEMS) {
  const from = join(root, item);
  if (!existsSync(from)) throw new Error(`Eksik: ${item}`);
  cpSync(from, join(out, item), { recursive: true });
}
console.log(`www/ hazır (${ITEMS.length} öğe)`);
