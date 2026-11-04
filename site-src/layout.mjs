// Ortak sayfa kabuğu: üst çubuk, alt bilgi, <head> (başlık, açıklama, hreflang, Open Graph). İçerik content-<dil>.mjs'ten gelir.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const T = {
  tr: {
    nav: [['/#ozellikler', 'Özellikler'], ['/#nasil', 'Nasıl çalışır'], ['/#indir', 'İndir']],
    openApp: 'Uygulamayı aç', skip: 'İçeriğe geç', otherLang: 'EN', otherLabel: 'English',
    footTag: 'Elektrikli araçlar için fizik tabanlı rota ve şarj planlayıcı.',
    footProduct: 'Ürün', footLegal: 'Yasal', footContact: 'İletişim',
    privacy: 'Gizlilik politikası', del: 'Hesap silme', features: 'Özellikler', download: 'İndir',
    legal: 'Togg, Tesla, ABRP (A Better Routeplanner), Google, Mapbox, HERE ve diğer adlar ilgili sahiplerinin ticari markalarıdır; EV Route Finder bu kuruluşlarla bağlantılı ya da onlarca onaylı değildir. Menzil, süre ve fiyat bilgileri tahmindir.',
    rights: 'EV Route Finder',
  },
  en: {
    nav: [['/en/#features', 'Features'], ['/en/#how', 'How it works'], ['/en/#download', 'Download']],
    openApp: 'Open the app', skip: 'Skip to content', otherLang: 'TR', otherLabel: 'Türkçe',
    footTag: 'A physics-based route and charging planner for electric cars.',
    footProduct: 'Product', footLegal: 'Legal', footContact: 'Contact',
    privacy: 'Privacy policy', del: 'Delete your account', features: 'Features', download: 'Download',
    legal: 'Togg, Tesla, ABRP (A Better Routeplanner), Google, Mapbox, HERE and other names are trademarks of their respective owners; EV Route Finder is not affiliated with or endorsed by them. Range, time and price figures are estimates.',
    rights: 'EV Route Finder',
  },
};

/** pages: tüm sayfaların { key, lang, path } listesi (hreflang için). page: { key, lang, path, title, desc, body, noindex? } */
export function render(page, cfg, pages) {
  const t = T[page.lang];
  const alt = (lang) => pages.find((p) => p.key === page.key && p.lang === lang)?.path;
  const url = (p) => cfg.siteUrl + p;
  const other = page.lang === 'tr' ? 'en' : 'tr';
  const otherPath = alt(other);
  const links = [
    `<link rel="canonical" href="${esc(url(page.path))}">`,
    ...['tr', 'en'].filter(alt).map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(url(alt(l)))}">`),
    alt('tr') ? `<link rel="alternate" hreflang="x-default" href="${esc(url(alt('tr')))}">` : '',
  ].filter(Boolean).join('\n  ');
  const homeHref = page.lang === 'tr' ? '/' : '/en/';
  const priv = pages.find((p) => p.key === 'privacy' && p.lang === page.lang).path;
  const del = pages.find((p) => p.key === 'delete' && p.lang === page.lang).path;
  return `<!doctype html>
<html lang="${page.lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(page.title)}</title>
  <meta name="description" content="${esc(page.desc)}">
  <meta name="theme-color" content="#0b0f14">
  ${page.noindex ? '<meta name="robots" content="noindex">' : ''}
  ${links}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="EV Route Finder">
  <meta property="og:title" content="${esc(page.title)}">
  <meta property="og:description" content="${esc(page.desc)}">
  <meta property="og:url" content="${esc(url(page.path))}">
  <meta property="og:image" content="${esc(cfg.siteUrl)}/img/logo-512.png">
  <meta name="twitter:card" content="summary">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/img/logo-192.png">
  <link rel="stylesheet" href="/css/site.css">
</head>
<body>
  <a class="skip" href="#main">${t.skip}</a>
  <header class="top">
    <div class="wrap">
      <a class="brand" href="${homeHref}"><img src="/img/logo-192.png" width="34" height="34" alt="">EV Route Finder</a>
      <nav aria-label="${page.lang === 'tr' ? 'Ana menü' : 'Main menu'}">
        ${t.nav.map(([h, l]) => `<a href="${h}">${l}</a>`).join('\n        ')}
        ${otherPath ? `<a class="lang" href="${otherPath}" hreflang="${other}" lang="${other}" title="${t.otherLabel}">${t.otherLang}</a>` : ''}
        <a class="btn btn-primary btn-sm" href="${esc(cfg.appUrl)}">${t.openApp}</a>
      </nav>
    </div>
  </header>
  <main id="main">
${page.body}
  </main>
  <footer>
    <div class="wrap">
      <div><a class="brand" href="${homeHref}" style="padding:0"><img src="/img/logo-192.png" width="30" height="30" alt="">EV Route Finder</a><p>${t.footTag}</p></div>
      <div><h4>${t.footProduct}</h4><a href="${page.lang === 'tr' ? '/#ozellikler' : '/en/#features'}">${t.features}</a><a href="${page.lang === 'tr' ? '/#indir' : '/en/#download'}">${t.download}</a><a href="${esc(cfg.appUrl)}">${t.openApp}</a></div>
      <div><h4>${t.footLegal}</h4><a href="${priv}">${t.privacy}</a><a href="${del}">${t.del}</a><h4 style="margin-top:14px">${t.footContact}</h4><a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a></div>
      <p class="legal">${t.legal}</p>
    </div>
  </footer>
</body>
</html>
`;
}

/** Ana sayfa ilk ekran çizimi: rota, iki şarj durağı, pil çubuğu. Sayılar örnektir. t: { a, b, stop1, stop2, arrive, label, sample } */
export function routeArt(t) {
  return `<div class="route-art"><svg viewBox="0 0 520 400" role="img" aria-label="${esc(t.label)}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="g" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="var(--line)" stroke-width=".6" opacity=".6"/></pattern>
    <linearGradient id="r" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2ee6a6"/><stop offset=".55" stop-color="#5aa9ff"/><stop offset="1" stop-color="#2ee6a6"/></linearGradient>
  </defs>
  <rect width="520" height="400" rx="14" fill="var(--bg)"/>
  <rect width="520" height="400" rx="14" fill="url(#g)"/>
  <path d="M60 330 C 150 330, 140 230, 215 215 S 330 250, 360 165 S 430 80, 470 70" fill="none" stroke="var(--line)" stroke-width="12" stroke-linecap="round"/>
  <path d="M60 330 C 150 330, 140 230, 215 215 S 330 250, 360 165 S 430 80, 470 70" fill="none" stroke="url(#r)" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 11"/>
  <g font-family="system-ui, sans-serif" font-size="13" font-weight="600">
    <circle cx="60" cy="330" r="13" fill="var(--accent)"/><text x="60" y="335" text-anchor="middle" fill="var(--accent-ink)">A</text>
    <circle cx="470" cy="70" r="13" fill="var(--accent)"/><text x="470" y="75" text-anchor="middle" fill="var(--accent-ink)">B</text>
    <g transform="translate(215 215)"><circle r="17" fill="var(--card-2)" stroke="var(--accent)" stroke-width="2"/><path d="M3 -9 L-5 2 H0 L-3 9 L5 -2 H0 Z" fill="var(--accent)"/></g>
    <g transform="translate(360 165)"><circle r="17" fill="var(--card-2)" stroke="var(--accent)" stroke-width="2"/><path d="M3 -9 L-5 2 H0 L-3 9 L5 -2 H0 Z" fill="var(--accent)"/></g>
    <g transform="translate(105 250)"><rect width="104" height="30" rx="15" fill="var(--card-2)" stroke="var(--line)"/><text x="52" y="20" text-anchor="middle" fill="var(--text)">${esc(t.stop1)}</text></g>
    <g transform="translate(262 100)"><rect width="104" height="30" rx="15" fill="var(--card-2)" stroke="var(--line)"/><text x="52" y="20" text-anchor="middle" fill="var(--text)">${esc(t.stop2)}</text></g>
    <g transform="translate(24 24)"><rect width="196" height="56" rx="12" fill="var(--card)" stroke="var(--line)"/>
      <text x="14" y="22" fill="var(--muted)" font-size="11" font-weight="500">${esc(t.arrive)}</text>
      <rect x="14" y="32" width="168" height="10" rx="5" fill="var(--line)"/><rect x="14" y="32" width="64" height="10" rx="5" fill="var(--accent)"/></g>
  </g>
  <text x="496" y="388" text-anchor="end" font-family="system-ui, sans-serif" font-size="10.5" fill="var(--muted)">${esc(t.sample)}</text>
</svg></div>`;
}

export const icons = {
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/></svg>',
  gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14l4-4"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  nav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
};
