// Ekran düzeni: harita tam ekran arka plandır; "Harita" dışındaki her sekme haritanın üstünde açılan bir sayfadır (<main>).
// [data-tab] taşıyan her düğme sekme değiştirir; açık sayfanın düğmesine tekrar dokunmak (ya da ✕) haritaya döner.
import { icon } from './icons.js';

let showFn = null;
/** Başka modüllerden sekme aç ('map' = sayfaları kapat). */
export const showTab = (id) => showFn?.(id);
export const currentTab = () => document.body.dataset.view || 'map';

export function initTabs() {
  const main = document.querySelector('main');

  // Her sayfanın başına başlık satırı + kapat düğmesi
  document.querySelectorAll('.tab').forEach((sec) => {
    const head = document.createElement('div');
    head.className = 'sheet-head';
    const grab = document.createElement('span');
    grab.className = 'grab';
    grab.setAttribute('aria-hidden', 'true');
    const title = document.createElement('b');
    title.textContent = sec.dataset.title || '';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sheet-x';
    close.dataset.tab = 'map';
    close.setAttribute('aria-label', 'Kapat');
    close.innerHTML = icon('close');
    head.append(grab, title, close);
    // Başlık sabit kalsın diye içerik ayrı bir kaydırma alanına (.sheet-body) alınır; başlık bunun dışında durur
    const body = document.createElement('div');
    body.className = 'sheet-body';
    body.append(...sec.childNodes);
    sec.append(head, body);
  });

  function show(id) {
    let section = document.getElementById('tab-' + id);
    if (section?.hasAttribute('data-premium-only') && !document.body.classList.contains('is-premium')) section = null; // Premium'a özel sayfa: değilse açılmaz (harita kalır)
    const open = !!section;
    const shown = open ? id : 'map';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === section));
    document.body.classList.toggle('sheet-open', open);
    document.body.dataset.view = shown;
    section?.querySelector('.sheet-body')?.scrollTo(0, 0);
    document.dispatchEvent(new CustomEvent('tabchange', { detail: shown }));
  }
  showFn = show;

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const id = b.dataset.tab;
    show(currentTab() === id ? 'map' : id);
  });
  show('map');
}
