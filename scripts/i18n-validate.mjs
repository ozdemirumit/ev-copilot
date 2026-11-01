// Çeviri dosyası doğrulama: node scripts/i18n-validate.mjs <dil kodu> [<dil kodu> ...]  (örn. de)
// Denetler: js/i18n/lang/<kod>.js yüklenir, i18n/keys.json'daki her anahtar için çeviri var, boş değil,
// {0}, {1} yer tutucuları kaynakla aynı kümede, fazladan anahtar yok.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const loadKeys = (name) => JSON.parse(readFileSync(join(root, 'i18n', name), 'utf8'));
const ph = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
let bad = 0;
for (const arg of process.argv.slice(2)) {
  const [code, kind] = arg.split(':'); // 'de' ana sözlük, 'de:extra' ek sözlük
  const keys = loadKeys(kind === 'extra' ? 'keys.extra.json' : 'keys.json');
  const file = join(root, 'js', 'i18n', 'lang', kind === 'extra' ? `${code}.extra.js` : `${code}.js`);
  if (!existsSync(file)) { console.error(`${code}: dosya yok (${file})`); bad++; continue; }
  let dict;
  try { dict = (await import(pathToFileURL(file).href + '?t=' + Date.now())).default; } catch (e) { console.error(`${code}: dosya yüklenemedi: ${e.message}`); bad++; continue; }
  const missing = keys.filter((k) => !(k in dict));
  const empty = keys.filter((k) => k in dict && !String(dict[k]).trim());
  const wrongPh = keys.filter((k) => k in dict && ph(k) !== ph(String(dict[k])));
  const extra = Object.keys(dict).filter((k) => !keys.includes(k));
  console.log(`${code}: ${keys.length - missing.length}/${keys.length} anahtar, eksik ${missing.length}, boş ${empty.length}, yer tutucu uyuşmaz ${wrongPh.length}, fazla ${extra.length}`);
  for (const [label, list] of [['EKSİK', missing], ['BOŞ', empty], ['YER TUTUCU', wrongPh], ['FAZLA', extra]]) {
    if (list.length) { bad++; console.error(`  ${label}:`, list.slice(0, 15).map((k) => JSON.stringify(k)).join(' | ') + (list.length > 15 ? ` … (+${list.length - 15})` : '')); }
  }
}
process.exit(bad ? 1 : 0);
