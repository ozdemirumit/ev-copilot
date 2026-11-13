// Görünüm teması (RM-02 aşama 1): Açık / Koyu / Otomatik. Varsayılan "light" (mevcut beyaz kart görünümü değişmez).
// Otomatik: sistemin prefers-color-scheme değeri canlı izlenir. Sonuç <html data-theme="light|dark"> olarak yazılır;
// renkler css/styles.css içindeki :root[data-theme="dark"] değişkenlerinden gelir. Harita karo stili bu aşamada değişmez.
export const THEME_KEY = 'evcp.theme';
export const THEME_PREFS = ['light', 'dark', 'auto'];
const MQ = '(prefers-color-scheme: dark)';

export function normalizePref(v) { return THEME_PREFS.includes(v) ? v : 'light'; }
export function resolveTheme(pref, systemDark) {
  const p = normalizePref(pref);
  return p === 'auto' ? (systemDark ? 'dark' : 'light') : p;
}

function readPref(storage) { try { return normalizePref(storage?.getItem(THEME_KEY)); } catch { return 'light'; } }

// Bağımlılıklar dışarıdan verilebilir (test için); tarayıcıda varsayılanlar kullanılır.
export function createTheme({ storage = globalThis.localStorage, matchMedia = globalThis.matchMedia?.bind(globalThis), root = globalThis.document?.documentElement } = {}) {
  const mql = typeof matchMedia === 'function' ? matchMedia(MQ) : null;
  let pref = readPref(storage);
  const listeners = new Set();
  const apply = () => {
    const theme = resolveTheme(pref, !!mql?.matches);
    if (root) { root.dataset.theme = theme; root.dataset.themePref = pref; }
    for (const fn of listeners) fn(theme, pref);
    return theme;
  };
  const onSystem = () => { if (pref === 'auto') apply(); };
  if (mql) {
    if (mql.addEventListener) mql.addEventListener('change', onSystem);
    else if (mql.addListener) mql.addListener(onSystem);
  }
  apply();
  return {
    get pref() { return pref; },
    get theme() { return root?.dataset.theme || resolveTheme(pref, !!mql?.matches); },
    set(next) {
      pref = normalizePref(next);
      try { storage?.setItem(THEME_KEY, pref); } catch { /* özel mod: yalnızca bu oturum */ }
      return apply();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

// Daha Fazla sayfasındaki seçici (#theme-select)
export function initTheme() {
  const t = createTheme();
  const sel = document.getElementById('theme-select');
  if (sel) {
    sel.value = t.pref;
    sel.addEventListener('change', () => t.set(sel.value));
  }
  return t;
}
