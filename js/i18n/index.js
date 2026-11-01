// Çeviri çekirdeği. Kaynak dil Türkçedir: uygulamadaki metinler Türkçe yazılıdır ve sözlük (js/i18n/lang/<kod>.js) Türkçe metni
// hedef dile eşler. Sayfa DOM'u (metinler ve title/placeholder/aria-label/data-title/alt) açılışta çevrilir ve MutationObserver ile
// sonradan yazılan metinler de anında çevrilir; böylece toast, banner, liste vb. kodda değişiklik gerektirmez. Değişken parçalı
// metinler {0}, {1} yer tutuculu desenlerle eşleşir (ör. "{0} km ileride" → "{0} km ahead"); yakalanan parçalar da ayrıca çevrilir.
// Varsayılan dil İngilizcedir; seçim yerel depoda saklanır ve değişince sayfa yenilenir.
import { load, save } from '../utils/storage.js';

export const LANGS = [
  { code: 'en', name: 'English', locale: 'en-US', route: 'en-US', photon: 'en' },
  { code: 'tr', name: 'Türkçe', locale: 'tr-TR', route: 'tr-TR', photon: 'default' },
  { code: 'de', name: 'Deutsch', locale: 'de-DE', route: 'de-DE', photon: 'de' },
  { code: 'fr', name: 'Français', locale: 'fr-FR', route: 'fr-FR', photon: 'fr' },
  { code: 'it', name: 'Italiano', locale: 'it-IT', route: 'it-IT', photon: 'default' },
  { code: 'es', name: 'Español', locale: 'es-ES', route: 'es-ES', photon: 'default' },
  { code: 'pt', name: 'Português', locale: 'pt-PT', route: 'pt-PT', photon: 'default' },
  { code: 'nl', name: 'Nederlands', locale: 'nl-NL', route: 'nl-NL', photon: 'default' },
  { code: 'pl', name: 'Polski', locale: 'pl-PL', route: 'pl-PL', photon: 'default' },
  { code: 'ro', name: 'Română', locale: 'ro-RO', route: 'ro-RO', photon: 'default' },
  { code: 'el', name: 'Ελληνικά', locale: 'el-GR', route: 'el-GR', photon: 'default' },
  { code: 'bg', name: 'Български', locale: 'bg-BG', route: 'bg-BG', photon: 'default' },
];

const saved = load('lang', null);
let lang = LANGS.some((l) => l.code === saved) ? saved : 'en'; // varsayılan İngilizce
let exact = new Map();
let patterns = [];
const cache = new Map();
export const missing = new Set(); // çevirisi bulunamayan Türkçe görünümlü metinler (geliştirme: window.__i18nMissing)

export const getLang = () => lang;
export const langInfo = () => LANGS.find((l) => l.code === lang) || LANGS[0];
export const locale = () => langInfo().locale;

/** Dil seç ve sayfayı yenile (rota planı kayıtlı yolculuktan geri gelir). */
export function setLang(code) {
  if (!LANGS.some((l) => l.code === code) || code === lang) return;
  save('lang', code);
  location.reload();
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const upFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1) : s);
const lowFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase(locale()) + s.slice(1) : s);

function compile(map) {
  exact = new Map();
  patterns = [];
  for (const [src, dst] of Object.entries(map)) {
    if (!/\{\d+\}/.test(src)) { exact.set(src, dst); continue; }
    const idx = [];
    let re = '^';
    for (const part of src.split(/(\{\d+\})/)) {
      const m = /^\{(\d+)\}$/.exec(part);
      if (m) { idx.push(Number(m[1])); re += '([\\s\\S]*?)'; } else re += esc(part);
    }
    const srcStart = /^\{(\d+)\}/.exec(src)?.[1]; // kaynakta cümle başında duran parça (büyük harfle başlar)
    patterns.push({ re: new RegExp(re + '$'), idx, dst, srcStart: srcStart == null ? null : Number(srcStart), weight: src.replace(/\{\d+\}/g, '').length });
  }
  patterns.sort((a, b) => b.weight - a.weight); // daha çok sabit metni olan (özgül) desen önce
}

function lookup(x, depth = 0) {
  const hit = exact.get(x);
  if (hit != null) return hit;
  const first = x.charAt(0);
  if (first && first !== first.toLocaleUpperCase('tr')) { // küçük harfle başlıyor: büyük harfli anahtarı dene
    const h = exact.get(upFirst(x)) ?? exact.get(first.toLocaleUpperCase('tr') + x.slice(1));
    if (h != null) return lowFirst(h);
  } else if (first && first !== first.toLocaleLowerCase('tr')) { // büyük harfle başlıyor: küçük harfli anahtarı dene
    const h = exact.get(first.toLocaleLowerCase('tr') + x.slice(1));
    if (h != null) return upFirst(h);
  }
  if (depth > 2) return null;
  for (const p of patterns) {
    const m = p.re.exec(x);
    if (!m) continue;
    let out = p.dst;
    p.idx.forEach((n, i) => {
      const arg = m[i + 1];
      const a = arg.trim();
      const r = a ? lookup(a, depth + 1) : null; // yakalanan parça da çevrilebilir bir ifadeyse çevir
      let rr = r;
      if (rr != null) { // büyük/küçük harf: parça cümle başındaysa büyük, ortadaysa küçük harfle başlasın (kaynak ve hedef konumuna göre)
        const dstStart = p.dst.startsWith(`{${n}}`);
        const aLower = a.charAt(0) !== a.charAt(0).toLocaleUpperCase('tr'); // kaynakta küçük harfle başlıyorsa cümle ortası biçimi
        if ((p.srcStart === n || aLower) && !dstStart) rr = lowFirst(rr);
        else if (p.srcStart !== n && dstStart) rr = upFirst(rr);
      }
      out = out.split(`{${n}}`).join(rr != null ? arg.replace(a, rr) : arg);
    });
    return out;
  }
  return null;
}

const HAS_LETTER = /\p{L}/u;
const TR_HINT = /[çğıöşüÇĞİÖŞÜ]/;

/** Metni çevir (Türkçe kaynak → seçili dil). Bulunamazsa aynen döner. */
export function tr(s) {
  if (lang === 'tr' || typeof s !== 'string' || !HAS_LETTER.test(s)) return s;
  const hit = cache.get(s);
  if (hit != null) return hit;
  const norm = s.replace(/\s+/g, ' ').trim();
  const lead = s.slice(0, s.length - s.trimStart().length);
  const trail = s.slice(s.trimEnd().length);
  const r = lookup(norm);
  const out = r == null ? s : lead + r + trail;
  if (r == null && TR_HINT.test(s) && missing.size < 500) missing.add(norm);
  if (cache.size > 3000) cache.clear();
  cache.set(s, out);
  return out;
}

/** Şablonlu çeviri: t('{0} sonra {1}', a, b). Şablon çevrilir, parametreler (varsa çevrilerek) yerleşir. */
export function t(template, ...params) {
  let out = lang === 'tr' ? template : (lookup(template.replace(/\s+/g, ' ').trim()) ?? template);
  params.forEach((p, i) => { out = out.split(`{${i}}`).join(typeof p === 'string' ? tr(p) : String(p)); });
  return out;
}

// ---------- DOM ----------
const ATTRS = ['title', 'placeholder', 'aria-label', 'data-title', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE']);

function textNode(n) {
  if (!n.parentElement || SKIP.has(n.parentElement.tagName) || n.parentElement.closest('[data-i18n-skip]')) return;
  const out = tr(n.data);
  if (out !== n.data) n.data = out;
}
function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v) { const o = tr(v); if (o !== v) el.setAttribute(a, o); }
  }
}
function walk(root) {
  if (root.nodeType === 3) return textNode(root);
  if (root.nodeType !== 1) return;
  if (SKIP.has(root.tagName) || root.closest?.('[data-i18n-skip]')) return;
  attrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n = w.nextNode();
  while (n) {
    if (n.nodeType === 3) textNode(n); else if (!SKIP.has(n.tagName)) attrs(n);
    n = w.nextNode();
  }
}

function observe() {
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  obs.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Açılışta bir kez: sözlüğü yükle, sayfayı çevir, gözlemciyi başlat. Türkçede yalnızca dil kodu yazılır. */
export async function initI18n() {
  document.documentElement.lang = lang;
  if (lang !== 'tr') {
    try {
      let map = (await import(`./lang/${lang}.js`)).default;
      try { map = { ...map, ...(await import(`./lang/${lang}.extra.js`)).default }; } catch { /* ek sözlük yok */ }
      compile(map);
    } catch (err) {
      console.warn('Dil dosyası yüklenemedi, Türkçe kalır:', err.message);
      lang = 'tr';
    }
  }
  if (lang !== 'tr') {
    document.title = tr(document.title);
    walk(document.body);
    observe();
    for (const fn of ['confirm', 'alert']) { const o = window[fn].bind(window); window[fn] = (m) => o(tr(String(m))); } // tarayıcı iletişim kutuları
  }
  document.documentElement.classList.add('i18n-ready');
  window.__i18nMissing = missing;
}

export const __test = { compile }; // yalnızca denemeler için
