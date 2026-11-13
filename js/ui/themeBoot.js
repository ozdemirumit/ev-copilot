// Erken tema (sayfa çizilmeden önce, klasik betik): kayıtlı Koyu/Otomatik tercihinde beyaz parlamayı önler.
// Mantık js/ui/theme.js ile aynı olmalı (scripts/test-theme.mjs denetler). Hata olursa açık tema kalır.
(function () {
  try {
    var p = localStorage.getItem('evcp.theme');
    if (p !== 'dark' && p !== 'auto') p = 'light';
    var dark = p === 'dark' || (p === 'auto' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme-pref', p);
  } catch (e) { /* açık tema */ }
})();
