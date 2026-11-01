// Yayından önce hızlı denetim: version.js çalışıyor mu (bozuk olursa sürüm "v?" görünür ve service worker güncellenmez),
// sürüm numarası değişiklik günlüğünün en üstüyle aynı mı, tüm .js dosyalarında söz dizimi hatası var mı.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
const fail = (msg) => { console.error('HATA:', msg); bad++; };

// version.js
try {
  const self = {};
  new Function('self', readFileSync(join(root, 'version.js'), 'utf8'))(self);
  if (!/^\d+\.\d+\.\d+$/.test(self.APP_VERSION || '')) fail('APP_VERSION geçersiz');
  if (self.APP_CHANGELOG?.[0]?.v !== self.APP_VERSION) fail(`Değişiklik günlüğünün en üstü (${self.APP_CHANGELOG?.[0]?.v}) APP_VERSION (${self.APP_VERSION}) ile aynı değil`);
  console.log(`version.js tamam: v${self.APP_VERSION}, ${self.APP_CHANGELOG.length} kayıt`);
} catch (err) {
  fail('version.js çalışmıyor: ' + err.message + ' (dize içinde kaçışsız kesme işareti olabilir: \\\')');
}

// Tüm uygulama .js dosyaları
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['node_modules', 'android', 'www', 'vendor', '.git', 'local-test'].includes(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = walk(root);
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (err) { fail(`${f}\n${String(err.stderr).split('\n').slice(0, 4).join('\n')}`); }
}
console.log(`${files.length} dosya söz dizimi denetlendi`);
if (bad) process.exit(1);
