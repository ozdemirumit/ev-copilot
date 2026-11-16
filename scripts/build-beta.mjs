// Beta (paralel) sürüm üretir: genel uygulama dosyalarını ayrı bir klasöre kopyalar ve canlı uygulamayla çakışan adları değiştirir.
// Kullanım: node scripts/build-beta.mjs [çıktı-klasörü]   (varsayılan: ../ev-copilot-beta)
//          node scripts/build-beta.mjs --free-only <depo-dışı-boş-klasör>   (YALNIZ kapalı cihaz testi; YAYIMLANMAZ)
// --free-only: js/net/providerGate.js PROVIDER_MODE_BUILD 'paused' → 'free-only' (yalnız ücretsiz izin listesi). Kaynak dosya değişmez.
// Fail-closed: klasör açıkça verilmeli; ../ev-copilot-beta (herkese açık Beta deposu), git deposu olan ya da proje içi klasör reddedilir.
// Neden: beta ve canlı uygulama aynı alan adında (ozdemirumit.github.io) çalışır; localStorage öneki, IndexedDB adı ve
// servis çalışanı önbellek adları ortak olursa iki sürüm birbirinin verisini ve önbelleğini bozar.
// Gizli bilgi içermez: yalnızca index.html, css, js, vendor, icons, sw.js, manifest, version.js kopyalanır (server/ ve .env asla).
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const positional = args.filter((a) => !a.startsWith('--'));
const unknown = flags.filter((a) => a !== '--free-only');
if (unknown.length || positional.length > 1) throw new Error('Bilinmeyen bağımsız değişken: ' + [...unknown, ...positional.slice(1)].join(' '));
const FREE_ONLY = flags.includes('--free-only');
const PUBLIC_REPO = resolve(join(root, '..', 'ev-copilot-beta'));
if (FREE_ONLY && !positional[0]) throw new Error('--free-only için çıktı klasörü açıkça verilmeli (varsayılan yayın deposu kullanılmaz)');
const out = resolve(positional[0] || PUBLIC_REPO);
if (FREE_ONLY && out.toLowerCase() === PUBLIC_REPO.toLowerCase()) throw new Error('--free-only çıktısı herkese açık Beta deposuna yazılamaz: ' + out);
if (FREE_ONLY && existsSync(join(out, '.git'))) throw new Error('--free-only çıktısı bir git deposuna yazılamaz (yayımlanmasın): ' + out);
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
  writeFileSync(p, s.replace('<title>EV Route Finder</title>', FREE_ONLY ? '<title>EV Route Finder (Beta – yerel ücretsiz test)</title>' : '<title>EV Route Finder (Beta)</title>'));
}
// offline.html "Tekrar dene": Beta önizleme adresinde kalsın (kaynak/üretim offline.html ve Android server.url değişmez)
{
  const p = join(out, 'offline.html');
  const s = readFileSync(p, 'utf8');
  const prod = "location.replace('https://ozdemirumit.github.io/ev-copilot/')";
  if (!s.includes(prod)) throw new Error('offline.html yeniden deneme adresi beklenen biçimde değil');
  writeFileSync(p, s.replace(prod, "location.replace('https://ozdemirumit.github.io/EV-Route-Finder/')"));
}
writeFileSync(join(out, '.nojekyll'), '');

// Yalnız ücretsiz mod (kapalı cihaz testi): derleme modu satırı tam bir kez değiştirilir; bulunamazsa derleme durur (fail-closed).
if (FREE_ONLY) {
  const p = join(out, 'js', 'net', 'providerGate.js');
  const s = readFileSync(p, 'utf8');
  const from = "export const PROVIDER_MODE_BUILD = 'paused';";
  if (s.split(from).length !== 2) throw new Error('providerGate.js derleme modu satırı tam bir kez bulunamadı');
  writeFileSync(p, s.replace(from, "export const PROVIDER_MODE_BUILD = 'free-only';"));
  writeFileSync(join(out, 'FREE-ONLY-LOCAL-TEST.txt'), 'EV Route Finder Beta — YALNIZ UCRETSIZ SAGLAYICI MODU, kapali cihaz testi icin yerel derleme.\n' +
    'YAYIMLAMAYIN (GitHub Pages / ev-copilot-beta / herhangi bir genel sunucu). Ayrinti: docs/free-only-device-test.md\n');
}

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
console.log(FREE_ONLY ? 'Beta (YALNIZ ÜCRETSİZ, yerel test — yayımlamayın) hazır:' : 'Beta hazır:', out);
console.log('Değişen ad sayıları:', counts);
