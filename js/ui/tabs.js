import { load, save } from '../utils/storage.js';

export function initTabs() {
  const buttons = [...document.querySelectorAll('.bottomnav [data-tab]')];
  const main = document.querySelector('main');

  function show(id) {
    const section = document.getElementById('tab-' + id);
    if (!section) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === section));
    buttons.forEach((b) => {
      const on = b.dataset.tab === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    main.scrollTop = 0;
    save('tab', id);
    document.dispatchEvent(new CustomEvent('tabchange', { detail: id }));
  }

  buttons.forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  show(load('tab', 'route'));
}
