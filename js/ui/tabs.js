// Ekran düzeni: harita tam ekran arka plandır; "Harita" dışındaki her sekme haritanın üstünde açılan bir sayfadır (<main>).
// [data-tab] taşıyan her düğme sekme değiştirir; açık sayfanın düğmesine tekrar dokunmak (ya da ✕) haritaya döner.
const PARENT = { range: 'more', camera: 'more', abrp: 'more', test: 'more', route: 'map' }; // alt sayfa açıkken alt çubukta vurgulanan düğme

let showFn = null;
/** Başka modüllerden sekme aç ('map' = sayfaları kapat). */
export const showTab = (id) => showFn?.(id);
export const currentTab = () => document.body.dataset.view || 'map';

export function initTabs() {
  const main = document.querySelector('main');
  const pill = [...document.querySelectorAll('.bottomnav [data-tab]')];

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
    close.textContent = '✕';
    head.append(grab, title, close);
    sec.prepend(head);
  });

  function show(id) {
    const section = document.getElementById('tab-' + id);
    const open = !!section;
    const shown = open ? id : 'map';
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === section));
    document.body.classList.toggle('sheet-open', open);
    document.body.dataset.view = shown;
    const on = PARENT[shown] || shown;
    pill.forEach((b) => {
      const cur = b.dataset.tab === on;
      b.classList.toggle('active', cur);
      b.setAttribute('aria-current', cur ? 'page' : 'false');
    });
    main.scrollTop = 0;
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
