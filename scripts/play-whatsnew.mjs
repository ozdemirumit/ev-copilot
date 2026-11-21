// Play "Yenilikler" metni: version.js APP_CHANGELOG'un EN ÜST kaydının notları, Play sınırı olan 500 karaktere sığdırılmış.
// Kullanım (CI): node scripts/play-whatsnew.mjs distribution/whatsnew  → <klasör>/whatsnew-tr-TR (UTF-8, BOM yok)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_CHARS = 500;
export const FALLBACK = 'Hata düzeltmeleri ve iyileştirmeler.';

const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();

/** Değişiklik günlüğünden (en yeni kayıt başta) Play metni. Geçerli not yoksa FALLBACK. */
export function whatsNew(changelog) {
  const notes = Array.isArray(changelog?.[0]?.notes) ? changelog[0].notes : [];
  const text = notes.filter((n) => typeof n === 'string').map(clean).filter(Boolean).join('\n');
  if (!text) return FALLBACK;
  if (text.length <= MAX_CHARS) return text;
  const cut = text.slice(0, MAX_CHARS - 1);
  const sp = cut.search(/\s\S*$/); // son kelimeyi yarım bırakma
  return (sp > MAX_CHARS * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const box = {};
  new Function('self', readFileSync(join(root, 'version.js'), 'utf8'))(box); // aynı depodaki kendi dosyamız
  const out = resolve(process.argv[2] || 'distribution/whatsnew');
  mkdirSync(out, { recursive: true });
  const text = whatsNew(box.APP_CHANGELOG);
  writeFileSync(join(out, 'whatsnew-tr-TR'), text, 'utf8');
  console.log(`Play yenilikler (${text.length} karakter): ${join(out, 'whatsnew-tr-TR')}`);
}
