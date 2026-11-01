// Premium üyelik ver ya da kaldır (yönetici gerekmez, sunucu çalışıyor olmalı):
//   node server/premium.mjs ali@gmail.com 30     → 30 gün ekler (mevcut süre varsa üstüne)
//   node server/premium.mjs ali@gmail.com 0      → Premium'u kaldırır
//   node server/premium.mjs list                  → herkesin planını listeler
//   node server/premium.mjs costs                 → kullanıcı başına Google maliyeti (çağrı ve tahmini USD: bugün / bu ay / toplam)
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
const base = `http://127.0.0.1:${env.PORT || 8787}`;
if (email === 'list') { // node server/premium.mjs list → kullanıcılar ve Premium durumu
  const r = await fetch(`${base}/admin/users`, { headers: { 'X-Access-Code': code } }).catch((e) => { console.error('Sunucuya ulaşılamadı:', e.message); process.exit(1); });
  const { users = [] } = await r.json();
  const fmt = (t) => new Date(t).toLocaleDateString('tr-TR');
  for (const u of users.sort((x, y) => String(x.email).localeCompare(String(y.email)))) {
    const plan = u.admin ? 'Premium (yönetici)' : u.premiumUntil > Date.now() ? `Premium · ${fmt(u.premiumUntil)} tarihine kadar` : u.premiumUntil ? `Ücretsiz (Premium ${fmt(u.premiumUntil)} bitti)` : 'Ücretsiz';
    const g = u.google?.calls?.total ? ` · Google: ${u.google.calls.month} çağrı bu ay ($${u.google.usd.month.toFixed(2)}), toplam $${u.google.usd.total.toFixed(2)}` : '';
    console.log(`${String(u.email).padEnd(34)} ${plan}${u.disabled ? ' · KAPALI' : ''}${g}`);
  }
  console.log(`${users.length} kullanıcı`);
  process.exit(0);
}
if (email === 'costs') {
  const r = await fetch(`${base}/admin/costs`, { headers: { 'X-Access-Code': code } }).catch((e) => { console.error('Sunucuya ulaşılamadı:', e.message); process.exit(1); });
  const { rows = [], unitUsd } = await r.json();
  const usd = (v) => '$' + v.toFixed(v > 0 && v < 1 ? 3 : 2);
  console.log(`Google birim fiyatı: ${unitUsd} USD/çağrı (GOOGLE_COST_PER_CALL_USD)`);
  console.log(`${'Kullanıcı'.padEnd(34)} ${'bugün'.padStart(14)} ${'bu ay'.padStart(14)} ${'toplam'.padStart(14)}`);
  const t = { today: 0, month: 0, total: 0 };
  const cell = (c, u) => `${c} / ${usd(u)}`.padStart(14);
  for (const x of rows.sort((a, b) => b.usd.total - a.usd.total)) {
    console.log(`${String(x.email).padEnd(34)} ${cell(x.calls.today, x.usd.today)} ${cell(x.calls.month, x.usd.month)} ${cell(x.calls.total, x.usd.total)}`);
    for (const k of Object.keys(t)) t[k] += x.usd[k];
  }
  console.log(`${'TOPLAM'.padEnd(34)} ${usd(t.today).padStart(14)} ${usd(t.month).padStart(14)} ${usd(t.total).padStart(14)}`);
  process.exit(0);
}
if (!code || !email || days === undefined) { console.error('Kullanım: node server/premium.mjs <e-posta> <gün>   (0 = kaldır)'); process.exit(1); }
const res = await fetch(`${base}/admin/premium`, {
  method: 'POST', headers: { 'X-Access-Code': code, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, days: Number(days) }),
}).catch((e) => { console.error('Sunucuya ulaşılamadı:', e.message); process.exit(1); });
const j = await res.json().catch(() => ({}));
if (!res.ok) { console.error('Hata:', res.status, j.error || ''); process.exit(1); }
console.log(j.premiumUntil ? `${j.email}: Premium ${new Date(j.premiumUntil).toLocaleString('tr-TR')} tarihine kadar` : `${j.email}: Premium kaldırıldı`);
