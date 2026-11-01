// Premium üyelik ver ya da kaldır (yönetici gerekmez, sunucu çalışıyor olmalı):
//   node server/premium.mjs ali@gmail.com 30     → 30 gün ekler (mevcut süre varsa üstüne)
//   node server/premium.mjs ali@gmail.com 0      → Premium'u kaldırır
// Ödeme sağlayıcısı bağlanınca abonelik webhook'u aynı uç noktayı (sunucu içinden) kullanır.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
const file = join(here, '.env');
if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2'); }
const code = String(env.ACCESS_CODES || '').split(',')[0].trim();
const [email, days] = process.argv.slice(2);
if (!code || !email || days === undefined) { console.error('Kullanım: node server/premium.mjs <e-posta> <gün>   (0 = kaldır)'); process.exit(1); }
const res = await fetch(`http://127.0.0.1:${env.PORT || 8787}/admin/premium`, {
  method: 'POST', headers: { 'X-Access-Code': code, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, days: Number(days) }),
}).catch((e) => { console.error('Sunucuya ulaşılamadı:', e.message); process.exit(1); });
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error('Hata:', res.status, j.error || ''); process.exit(1); }
console.log(j.premiumUntil ? `${j.email}: Premium ${new Date(j.premiumUntil).toLocaleString('tr-TR')} tarihine kadar` : `${j.email}: Premium kaldırıldı`);
