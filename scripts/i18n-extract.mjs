// Arayüz metinlerini (Türkçe kaynak) JS dosyalarından çıkarır. Çıktı: i18n/candidates-js.json
// Şablon dizeler (`...${x}...`) {0}, {1} yer tutucularıyla anahtar olur. HTML metinleri tarayıcıdan ayrıca çıkarılır (scripts/i18n-html.js).
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', 'android', 'www', 'vendor', '.git', 'local-test', 'i18n', 'lang']);
const SKIP_FILES = new Set(['version.js', 'vehicleCatalog.js']);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.endsWith('.js') && !SKIP_FILES.has(n)) out.push(p);
  }
  return out;
}

/** Basit bir tarayıcı: yorumları ve regex değil dizeleri bulur; şablonlarda ${} içini yer tutucuya çevirir. */
function scan(src) {
  const found = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  const readTemplate = (startLine) => {
    // i, açılış ` işaretinden sonra
    let out = '';
    let k = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { out += src[i + 1] === 'n' ? ' ' : src[i + 1]; i += 2; continue; }
      if (c === '`') { i++; return out; }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < n && depth) { // ifade: iç içe dize/şablonları atla
          const d = src[i];
          if (d === '{') depth++;
          else if (d === '}') depth--;
          else if (d === "'" || d === '"') { const q = d; const from = ++i; while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; } found.push({ s: src.slice(from, i).replace(/\\(.)/g, '$1'), line: startLine }); }
          else if (d === '`') { i++; found.push({ s: readTemplate(startLine), line: startLine }); continue; } // ${} içindeki iç şablonlar da çevrilecek metindir
          else if (d === '\n') line++;
          i++;
        }
        out += `{${k++}}`;
        continue;
      }
      if (c === '\n') line++;
      out += c;
      i++;
    }
    return out;
  };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === "'" || c === '"') {
      const q = c; const startLine = line; i++;
      let s = '';
      while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') { s += src[i + 1] === 'n' ? ' ' : src[i + 1]; i += 2; } else { s += src[i]; i++; } }
      i++;
      found.push({ s, line: startLine });
      continue;
    }
    if (c === '`') { const startLine = line; i++; found.push({ s: readTemplate(startLine), line: startLine }); continue; }
    if (c === '/' && /[=(,:;!&|?{}\n]\s*$/.test(src.slice(Math.max(0, i - 3), i))) { // regex literal
      i++; while (i < n && src[i] !== '/' && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; continue;
    }
    i++;
  }
  return found;
}

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
const LETTER = /\p{L}/u;
const looksTech = (s) => /^[a-z0-9_.:/#?&=%+@\-[\]*, ()<>|~'"!^$\\]+$/i.test(s) && !/\s[A-ZÇĞİÖŞÜ]/.test(s) && !TR_CHARS.test(s) && !/ \p{L}{4,} \p{L}{3,}/u.test(s);

const files = walk(join(root, 'js'));
const map = new Map();
const skipped = [];
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  for (const { s, line } of scan(readFileSync(f, 'utf8'))) {
    const t = s.replace(/\s+/g, ' ').trim();
    if (t.length < 2 || !LETTER.test(t)) continue;
    if (/^(https?:|\.\.?\/|\/)/.test(t)) continue;
    if (!TR_CHARS.test(t) && looksTech(t)) { if (/\s/.test(t) && t.length > 6) skipped.push(`${rel}:${line} ${t}`); continue; } // kimlik, URL, CSS sınıfı, olay adı vb.
    if (/^[a-z][a-zA-Z0-9]*$/.test(t)) continue; // tek küçük harfli kimlik
    const key = t;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(`${rel}:${line}`);
  }
}
const out = [...map.entries()].map(([key, where]) => ({ key, where: where.slice(0, 3) }));
mkdirSync(join(root, 'i18n'), { recursive: true });
writeFileSync(join(root, 'i18n', 'candidates-js.json'), JSON.stringify(out, null, 1));
writeFileSync(join(root, 'i18n', 'skipped-tech.txt'), skipped.join(String.fromCharCode(10)));
console.log(`${files.length} dosya, ${out.length} aday dize`);
