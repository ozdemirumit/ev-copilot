// Tanıtım sitesini site/ klasörüne üretir (evroutefinder.com için GitHub Pages'e koyulacak statik dosyalar).
// Kullanım: node site-src/build.mjs            (yerel önizleme; e-posta henüz yazılmadıysa uyarır)
//           node site-src/build.mjs --publish   (yayın: e-posta ayarlıysa yazar, değilse hata verir)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './layout.mjs';
import { pages as trPages } from './content-tr.mjs';
import { pages as enPages } from './content-en.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, 'site');
const cfg = JSON.parse(readFileSync(join(here, 'config.json'), 'utf8'));
const publish = process.argv.includes('--publish');
const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.email);
if (!emailOk) {
  if (publish) { console.error('site-src/config.json içindeki "email" geçerli bir adres değil: yayın yapılmaz.'); process.exit(1); }
  console.warn('Uyarı: "email" henüz yazılmadı; sayfalarda yer tutucu görünür (yayından önce doldur).');
}

const pages = [...trPages(cfg), ...enPages(cfg)];
rmSync(out, { recursive: true, force: true });
const write = (rel, data) => { const f = join(out, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, data); };

for (const p of pages) write(join(p.path.replace(/^\//, ''), 'index.html'), render(p, cfg, pages));

const bodyOf404 = (lang) => `<section class="block" style="border:0"><div class="wrap doc"><h1>404</h1><p>${lang === 'tr' ? 'Aradığın sayfa bulunamadı.' : 'This page could not be found.'}</p><p><a class="btn btn-primary" href="/">${lang === 'tr' ? 'Ana sayfaya dön' : 'Back to the home page'}</a> <a class="btn btn-ghost" href="/en/">English</a></p></div></section>`;
write('404.html', render({ key: 'notfound', lang: 'tr', path: '/404.html', title: '404 · EV Route Finder', desc: 'Sayfa bulunamadı', body: bodyOf404('tr'), noindex: true }, cfg, [
  ...pages, { key: 'notfound', lang: 'tr', path: '/404.html' },
]));

copyFileSync(join(here, 'site.css'), (mkdirSync(join(out, 'css'), { recursive: true }), join(out, 'css', 'site.css')));
mkdirSync(join(out, 'img'), { recursive: true });
copyFileSync(join(root, 'icons', 'icon-192.png'), join(out, 'img', 'logo-192.png'));
copyFileSync(join(root, 'icons', 'icon-512.png'), join(out, 'img', 'logo-512.png'));
copyFileSync(join(root, 'icons', 'icon.svg'), join(out, 'favicon.svg'));
write('CNAME', new URL(cfg.siteUrl).hostname + '\n');
write('.nojekyll', '');
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n`
  + pages.map((p) => {
    const alts = pages.filter((q) => q.key === p.key).map((q) => `    <xhtml:link rel="alternate" hreflang="${q.lang}" href="${cfg.siteUrl}${q.path}"/>`).join('\n');
    return `  <url>\n    <loc>${cfg.siteUrl}${p.path}</loc>\n    <lastmod>${cfg.updated}</lastmod>\n${alts}\n  </url>`;
  }).join('\n') + '\n</urlset>\n');
console.log(`${pages.length} sayfa → ${out}`);
