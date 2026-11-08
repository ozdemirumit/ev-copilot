// Beta (paralel) sürüm üretir: genel uygulama dosyalarını ayrı bir klasöre kopyalar ve canlı uygulamayla çakışan adları değiştirir.
// Kullanım: node scripts/build-beta.mjs [çıktı-klasörü]   (varsayılan: ../ev-copilot-beta)
// Neden: beta ve canlı uygulama aynı alan adında (ozdemirumit.github.io) çalışır; localStorage öneki, IndexedDB adı ve
// servis çalışanı önbellek adları ortak olursa iki sürüm birbirinin verisini ve önbelleğini bozar.
// Gizli bilgi içermez: yalnızca index.html, css, js, vendor, icons, sw.js, manifest, version.js kopyalanır (server/ ve .env asla).
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, '..', 'ev-copilot-beta'));
const ITEMS = ['index.html', 'offline.html', 'manifest.webmanifest', 'version.js', 'sw.js', 'css', 'js', 'vendor', 'icons'];
const KEEP = new Set(['.git', 'README.md']); // çıktı klasörünün kendi git deposu ve açıklaması silinmez

if (out === root || out.startsWith(root + '\\') || out.startsWith(root + '/')) throw new Error('Çıktı klasörü proje içinde olamaz: ' + out);
mkdirSync(out, { recursive: true });
for (const name of readdirSync(out)) if (!KEEP.has(name)) rmSync(join(out, name), { recursive: true, force: true });
for (const item of ITEMS) {
  const from = join(root, item);
  if (!existsSync(from)) throw new Error(`Eksik: ${item}`);
  cpSync(from, join(out, item), { recursive: true });
}

// Ad değişiklikleri (yalnızca tırnaklı dize başlangıçları: yorumlar ve çeviri anahtarları etkilenmez)
const RENAMES = [
  [/'evcp\./g, "'evcpb."], // localStorage / sessionStorage öneki
  [/'evcp-kv'/g, "'evcpb-kv'"], // IndexedDB adı
  [/'ev-copilot-/g, "'ev-copilot-beta-"], // servis çalışanı önbellekleri (sw.js + versionInfo.js temizliği)
];
const counts = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor') walk(p); continue; }
    if (!p.endsWith('.js')) continue;
    let s = readFileSync(p, 'utf8');
    let changed = false;
    for (const [re, to] of RENAMES) {
      const n = (s.match(re) || []).length;
      if (n) { s = s.replace(re, to); counts[to] = (counts[to] || 0) + n; changed = true; }
    }
    if (changed) writeFileSync(p, s);
  }
};
walk(join(out, 'js'));
{
  const p = join(out, 'sw.js');
  let s = readFileSync(p, 'utf8');
  for (const [re, to] of RENAMES) { const n = (s.match(re) || []).length; if (n) { s = s.replace(re, to); counts[to] = (counts[to] || 0) + n; } }
  writeFileSync(p, s);
}

// Manifest ve başlık: ana ekrana eklenince canlı uygulamadan ayırt edilsin
{
  const p = join(out, 'manifest.webmanifest');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  m.name = 'EV Route Finder (Beta)';
  m.short_name = 'EV RF Beta';
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
}
{
  const p = join(out, 'index.html');
  const s = readFileSync(p, 'utf8');
  if (!s.includes('<title>EV Route Finder</title>')) throw new Error('index.html başlığı beklenen biçimde değil');
  writeFileSync(p, s.replace('<title>EV Route Finder</title>', '<title>EV Route Finder (Beta)</title>'));
}
writeFileSync(join(out, '.nojekyll'), '');

// Doğrulama: çakışan adlar kalmadı mı?
const leftovers = [];
const scan = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'vendor' && name !== '.git') scan(p); continue; }
    if (!p.endsWith('.js')) continue;
    const s = readFileSync(p, 'utf8');
    if (/'evcp\.|'evcp-kv'|'ev-copilot-(?!beta-)/.test(s)) leftovers.push(p);
  }
};
scan(out);
if (leftovers.length) { console.error('Çakışan ad kaldı:', leftovers); process.exit(1); }
console.log('Beta hazır:', out);
console.log('Değişen ad sayıları:', counts);
