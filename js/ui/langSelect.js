// Daha Fazla sayfasındaki dil seçimi. Seçince dil kaydedilir ve sayfa yenilenir (çeviri açılışta uygulanır).
import { LANGS, getLang, setLang } from '../i18n/index.js';

export function initLangSelect() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.replaceChildren(...LANGS.map((l) => Object.assign(new Option(l.name, l.code), { lang: l.code })));
  sel.value = getLang();
  sel.addEventListener('change', () => setLang(sel.value));
}
